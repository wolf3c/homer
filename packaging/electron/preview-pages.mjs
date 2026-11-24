import{WebContentsView,session,protocol,shell}from'electron';
import{readFileSync,writeFileSync,renameSync}from'node:fs';
import{isAbsolute,join,posix}from'node:path';
import{randomUUID}from'node:crypto';
import{previewAutomation}from'./preview-automation.mjs';

export function registerPreviewScheme(){protocol.registerSchemesAsPrivileged([{scheme:'homer-preview',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);}
export function createBrowserPreview({window,runtimeDirectory,preload,ipcMain,uiCaller,fetchAttachment,fetchMessageFile,permissionFile,permissionEvent}){
 const pages=new Map(),pending=new Map();let selected;
 const permissions=new Map(),grants=new Set();
 const locationType=type=>type==='geolocation'||type==='geolocation-approximate';
 function locationOrigin(value){try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.origin:undefined;}catch{return undefined;}}
 if(permissionFile)try{
  for(const key of JSON.parse(readFileSync(permissionFile,'utf8'))){
   if(typeof key!=='string')continue;
   const [origin,type]=key.split(' ');
   if(origin===locationOrigin(origin)&&locationType(type)&&key===origin+' '+type)grants.add(key);
  }
 }catch{grants.clear();}
 function saveGrant(key,allow){
  if(!permissionFile)throw Error('preview_permission_unavailable');
  const next=new Set(grants);
  if(allow)next.add(key);else next.delete(key);
  const temporary=permissionFile+'.tmp';
  writeFileSync(temporary,JSON.stringify([...next]),{mode:0o600});
  renameSync(temporary,permissionFile);
  if(allow)grants.add(key);else grants.delete(key);
 }
 const automation=previewAutomation(join(runtimeDirectory,'automation.js'));
 const runtime=readFileSync(join(runtimeDirectory,'runtime.js'),'utf8'),css=readFileSync(join(runtimeDirectory,'runtime.css'),'utf8');
 const browserSession=session.fromPartition('persist:homer-preview');
 const localSession=session.fromPartition('homer-local-preview');
 const preferences={session:browserSession,preload,sandbox:true,contextIsolation:true,nodeIntegration:false,webviewTag:false,backgroundThrottling:false};
 const publicPage=p=>({id:p.id,threadId:p.threadId,owner:p.owner,url:p.view.webContents.getURL(),title:(p.view.webContents.getTitle()||p.source.title).slice(0,500),document:p.document,control:p.control,agentAssigned:!!p.agentAssigned,source:p.source,loading:!!p.loading,...(p.resource?{resource:p.resource}:{}),...(p.error?{error:p.error}:{}),...(p.locationDenied?{locationDenied:true}:{}),...(p.locationApproval?{locationApproval:p.locationApproval}:{})});
 const changed=()=>{const w=window();if(w&&!w.isDestroyed())w.webContents.send('homer:preview:changed');};
 const page=id=>{const p=pages.get(id);if(!p||p.closed||p.view.webContents.isDestroyed())throw Error('preview_page_unavailable');return p;};
 const sendState=p=>p.view.webContents.send('homer:preview:annotation-state',{document:p.document,active:false,revision:0,epoch:0,notes:[],...p.annotations});
 async function annotations(p){
  if(p.loading||!p.annotations)return;
  if(!p.annotations.active&&!p.annotations.notes.length&&!p.annotations.historyNote){if(p.runtime)sendState(p);return;}
  const document=p.document;
  if(!p.runtime)p.runtime=p.view.webContents.executeJavaScriptInIsolatedWorld(999,[{code:`globalThis.homerAnnotationCss=${JSON.stringify(css)};${runtime}`}]);
  const injection=p.runtime;
  try{await injection;if(!p.closed&&p.document===document)sendState(p);}catch{if(p.closed||p.document!==document||p.runtime!==injection)return;p.runtime=undefined;p.error='网页批注尚未接入，请重新加载后重试。';changed();}
 }
 function finishPermission(request,allow,expired=false){
  clearTimeout(request.timer);permissions.delete(request.id);
  request.page.locationApproval=[...permissions.values()].find(other=>other.page===request.page)?.cardId;
  request.page.locationDenied=!allow;
  for(const respond of request.callbacks)try{respond(allow);}catch{}
  if(expired)permissionEvent?.({id:request.id,expired:true});
  changed();
 }
 const expirePermissions=p=>{for(const request of permissions.values())if(request.page===p)finishPermission(request,false,true);};
 const settle=(p,error)=>{expirePermissions(p);p.locationDenied=false;for(const [id,call]of pending)if(call.page===p){clearTimeout(call.timer);pending.delete(id);call.resolve({changeId:id,error,document:p.document,active:false,revision:0,epoch:0,notes:[]});}};
 function close(id){const p=pages.get(id);if(!p)return;p.closed=true;settle(p,'preview_page_unavailable');if(selected===id)selected=undefined;const w=window();if(w&&!w.isDestroyed())w.contentView.removeChildView(p.view);if(!p.view.webContents.isDestroyed())p.view.webContents.close();pages.delete(id);changed();}
 function present(id,bounds){
  if(!bounds){if(selected===id){page(id).view.setVisible(false);selected=undefined;}return;}
  const p=page(id),w=window();if(!w||w.isDestroyed())throw Error('preview_unavailable');
  const area=w.getContentBounds(),scale=w.webContents.getZoomFactor();const x=Math.max(0,Math.round(bounds.x*scale)),y=Math.max(0,Math.round(bounds.y*scale));
  const width=Math.max(0,Math.min(area.width-x,Math.round(bounds.width*scale))),height=Math.max(0,Math.min(area.height-y,Math.round(bounds.height*scale)));
  if(!width||!height)return present(id,null);
  for(const other of pages.values())other.view.setVisible(other===p);
  p.view.setBounds({x,y,width,height});selected=id;
 }
 function make({threadId,owner,source,url},options={}){
  const id='page-'+randomUUID();
  const view=new WebContentsView({...options,webPreferences:{...options.webPreferences,...preferences,...(source.kind==='message-file'?{session:localSession}:{})}});
  const p={id,threadId,owner,source,view,document:0,operation:0,control:'user',closed:false,busy:false};pages.set(id,p);window().contentView.addChildView(view);
  const area=window().getContentBounds();view.setBounds({x:0,y:0,width:Math.max(320,area.width),height:Math.max(240,area.height)});view.setVisible(false);
  view.webContents.on('did-start-navigation',details=>{if(details.isMainFrame&&!details.isSameDocument){p.document++;p.loading=true;p.runtime=undefined;p.annotations=undefined;settle(p,'preview_document_changed');changed();}});
  view.webContents.on('did-finish-load',()=>{
   p.loading=false;p.error=undefined;changed();
  });
  view.webContents.on('did-navigate-in-page',(_event,_url,isMainFrame)=>{if(isMainFrame){p.document++;p.annotations=undefined;settle(p,'preview_document_changed');if(p.runtime)sendState(p);changed();}});
  view.webContents.on('page-title-updated',()=>changed());
  view.webContents.on('did-fail-load',(_,code,description,_url,isMainFrame)=>{if(isMainFrame&&code!==-3){p.loading=false;p.error=description;changed();}});
  view.webContents.on('render-process-gone',()=>{p.error='网页进程已退出，请核对未完成操作后重新加载。';p.control='user';settle(p,'preview_page_unavailable');changed();});
  view.webContents.once('destroyed',()=>close(id));
  view.webContents.setWindowOpenHandler(({url})=>{
   if(p.source.kind==='message-file')return{action:'deny'};
   if(!/^https?:/.test(url)&&url!=='about:blank')return{action:'deny'};
   const link=p.popupLink;p.popupLink=undefined;
   return{action:'allow',overrideBrowserWindowOptions:{webPreferences:preferences},createWindow:options=>{
    const child=make({threadId:p.threadId,owner:p.owner,source:p.source,url},options);child.agentAssigned=p.agentAssigned;
    if(link?.url===url&&link.document===p.document&&link.expires>=Date.now()&&selected===p.id&&p.control==='user'&&!p.busy)
     window().webContents.send('homer:preview:show',publicPage(child),{pageId:p.id,document:p.document});
    return child.view.webContents;
   }};
  });
  view.webContents.on('will-navigate',(event,url)=>{
   if(p.source.kind==='message-file'){
    if(url.split('#')[0]!=='homer-preview://'+id+'/local/index.html')event.preventDefault();
   }else if(p.resource&&url.startsWith('homer-preview:')&&url.split('#')[0]!==view.webContents.getURL().split('#')[0]
    ||!/^https?:/.test(url)&&!url.startsWith('homer-preview://'+id+'/')&&url!=='about:blank')event.preventDefault();
  });
  changed();return p;
 }
 for(const previewSession of [browserSession,localSession])previewSession.protocol.handle('homer-preview',async request=>{
  try{
   const url=new URL(request.url),p=page(url.hostname),s=p.source;
   if(p.view.webContents.session!==previewSession)throw Error('preview_source_mismatch');
   if(s.kind==='message-file'){
    if(url.pathname!=='/local/index.html'||request.method!=='GET'||url.search)return new Response(null,{status:403});
    const response=await fetchMessageFile(p.threadId,s);
    if(!response.ok||response.headers.get('Content-Type')?.split(';')[0]!=='text/html')return new Response('来源已不可用',{status:403});
    return new Response(await response.arrayBuffer(),{headers:{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src http: https: data: blob:; script-src 'unsafe-inline' 'unsafe-eval' http: https: data: blob:; style-src 'unsafe-inline' http: https:; connect-src http: https: ws: wss:; frame-src about: blob: http: https:; sandbox allow-scripts allow-forms"}});
   }
   if(s.kind!=='attachment')throw Error('preview_source_mismatch');
   const root=!p.resource&&url.pathname==='/attachment/index.html';
   const response=await fetchAttachment(s,root?undefined:posix.relative('/attachment',url.pathname));if(!response.ok)return new Response('资源读取失败',{status:response.status});
   if(root&&response.headers.get('X-Homer-Artifact-Hash')!==s.sha256)throw Error('preview_source_mismatch');
   return new Response(await response.arrayBuffer(),{headers:{'Content-Type':response.headers.get('Content-Type')??'application/octet-stream'}});
  }catch{return new Response('来源已不可用',{status:403});}
 });
 localSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
 localSession.setPermissionCheckHandler(()=>false);
 function locationPage(contents,permission,origin,details){
  if(!locationType(permission)||!origin||details?.isMainFrame!==true)return;
  const p=[...pages.values()].find(page=>page.view.webContents===contents);
  if(p&&!p.closed&&['browser','web'].includes(p.source.kind)&&origin===locationOrigin(contents.getURL()))return p;
 }
 browserSession.setPermissionCheckHandler((contents,permission,requestingOrigin,details)=>{
  const origin=locationOrigin(requestingOrigin);
  return !!locationPage(contents,permission,origin,details)&&grants.has(origin+' '+permission);
 });
 browserSession.setPermissionRequestHandler((contents,permission,callback,details)=>{
  const origin=locationOrigin(details?.requestingUrl),p=locationPage(contents,permission,origin,details);
  if(!p){callback(false);return;}
  const key=origin+' '+permission;
  if(grants.has(key)){p.locationDenied=false;callback(true);changed();return;}
  const existing=[...permissions.values()].find(request=>request.page===p&&request.key===key);
  if(existing){existing.callbacks.push(callback);return;}
  const interactive=p.control==='user'&&!p.taskPaused&&(!p.agentAssigned||selected===p.id),context=p.locationDenied?p.locationContext:undefined;
  if(!permissionEvent||!interactive&&!context){p.locationDenied=true;callback(false);changed();return;}
  const id=randomUUID(),request={id,page:p,document:p.document,key,callbacks:[callback]};
  request.timer=setTimeout(()=>finishPermission(request,false,true),120000);
  permissions.set(id,request);
  if(!permissionEvent({id,owner:p.owner,threadId:p.threadId,pageId:p.id,origin,permission,interactive,...(!interactive?context:{})}))
   finishPermission(request,false);
 });
 function contentCaller(event){const p=[...pages.values()].find(p=>p.view.webContents===event.sender);if(!p||event.senderFrame!==p.view.webContents.mainFrame)throw Error('preview_sender_denied');return p;}
 function visibleUserPage(event){
  const p=contentCaller(event);
  return selected===p.id&&p.control==='user'&&!p.busy?p:undefined;
 }
 ipcMain.on('homer:preview:popup-link',(event,url)=>{
  event.returnValue=false;
  try{
   const p=visibleUserPage(event);
   if(p&&/^https?:/.test(p.view.webContents.getURL())&&typeof url==='string'&&/^https?:/.test(url)&&url.length<=16000)
    p.popupLink={url,document:p.document,expires:Date.now()+250};
  }catch{/* Page closed before delivery. */}
 });
 ipcMain.on('homer:preview:link',(event,href)=>{
  const forward=()=>{
   try{
    const p=visibleUserPage(event);
    if(!p||typeof href!=='string'||href.length>16000)return false;
    const path=p.source.kind==='message-file'?'/local/index.html':'/attachment/'+(p.resource??'index.html');
    if(p.view.webContents.getURL().split('#')[0]!=='homer-preview://'+p.id+path)return false;
    if(p.resource&&!/^(?:https?:|file:|\/(?![\\/])|[a-z]:(?:[\\/]|%5c))/i.test(href))return false;
    window().webContents.send('homer:preview:link',{page:publicPage(p),href});
    return true;
   }catch{return false;}
  };
  event.returnValue=forward();
 });
 ipcMain.handle('homer:preview:annotation-read',event=>{const p=contentCaller(event);return {document:p.document,active:false,revision:0,epoch:0,notes:[],...p.annotations};});
 ipcMain.handle('homer:preview:annotation-begin',async event=>{const p=contentCaller(event);p.control='user';await p.inFlight?.catch(()=>{});changed();});
 ipcMain.handle('homer:preview:annotation-save',(event,input)=>{
  const p=contentCaller(event);if(p.control!=='user'||input?.document!==p.document)throw Error('preview_document_changed');
  if(typeof input.changeId!=='string'||input.changeId.length>100||!Array.isArray(input.notes)||input.notes.length>20||JSON.stringify(input).length>100000)throw Error('invalid_resource_reference');
  if(pending.has(input.changeId))throw Error('preview_save_pending');
  return new Promise(resolve=>{const timer=setTimeout(()=>{pending.delete(input.changeId);resolve({changeId:input.changeId,error:'草稿保存尚未确认，输入已保留。'});},15000);pending.set(input.changeId,{page:p,resolve,timer});window().webContents.send('homer:preview:annotation',{...input,pageId:p.id});});
 });
 for(const method of ['list','present','control','annotations','reply','location-grants','revoke-location'])ipcMain.handle('homer:preview:'+method,async(event,input)=>{
  if(!uiCaller(event))throw Error('preview_sender_denied');
  if(method==='list')return [...pages.values()].filter(p=>p.threadId===input).map(publicPage);
  if(method==='location-grants')return [...grants].sort();
  if(method==='revoke-location'){if(grants.has(input))saveGrant(input,false);return [...grants].sort();}
  const p=page(input?.pageId);if(method!=='reply'&&p.threadId!==input.threadId)throw Error('preview_scope_denied');
  if(method==='present')return present(p.id,input.bounds);
  if(method==='control'){
   const a=input.action;
   if(['back','forward','reload'].includes(a)){p.control='user';await p.inFlight?.catch(()=>{});}
   if(a==='close')return close(p.id);
   if(a==='takeover'){p.control='user';await p.inFlight?.catch(()=>{});}
   else if(a==='resume'){p.control='agent';p.taskPaused=false;p.annotations={...p.annotations,active:false};sendState(p);}
   else if(a==='back'&&p.view.webContents.navigationHistory.canGoBack())p.view.webContents.navigationHistory.goBack();
   else if(a==='forward'&&p.view.webContents.navigationHistory.canGoForward())p.view.webContents.navigationHistory.goForward();
   else if(a==='reload')p.view.webContents.reload();
   else if(!['back','forward'].includes(a))throw Error('preview_action_denied');
   changed();return;
  }
  if(method==='annotations'){
   if(input.state.document!==p.document||p.loading)return;
   p.annotations=input.state;if(input.state.active)p.control='user';await annotations(p);return;
  }
  const call=pending.get(input.changeId);if(!call||call.page!==p)return;
  clearTimeout(call.timer);pending.delete(input.changeId);
  if(input.state.document===p.document)p.annotations=input.state;
  call.resolve(input.state.document===p.document?{...input.state,changeId:input.changeId}:{changeId:input.changeId,error:'preview_document_changed'});
 });
 return {async execute(actor,action,input){
  if(action==='reveal-file'){
   if(typeof input.path!=='string'||!isAbsolute(input.path))throw Error('preview_reveal_unavailable');
   shell.showItemInFolder(input.path);
   return {requested:true};
  }
  if(action==='location-card'||action==='location-decision'){
   const request=permissions.get(input.id),p=request?.page;
   if(!request||p.owner!==actor.owner||p.threadId!==actor.threadId||p.document!==request.document||p.closed||p.view.webContents.isDestroyed())
    throw Error('preview_permission_expired');
   if(action==='location-card'){
    request.cardId=input.cardId;p.locationApproval=input.cardId;
    window().webContents.send('homer:preview:show',publicPage(p));changed();return;
   }
   try{if(input.remember===true&&input.allow===true)saveGrant(request.key,true);}
    catch{finishPermission(request,false);throw Error('preview_permission_storage_failed');}
   finishPermission(request,input.allow===true);return;
  }
  if(action==='open'){
   if(input.pageId){const p=page(input.pageId);if(p.threadId!==actor.threadId)throw Error('preview_scope_denied');
    if(input.claim?.url===p.view.webContents.getURL()&&actor.requestId&&p.claimRequest!==actor.requestId){if(p.busy)throw Error('preview_page_busy');expirePermissions(p);p.agentAssigned=true;p.claimRequest=actor.requestId;p.owner=actor.owner;p.control='agent';p.taskPaused=false;p.annotations={...p.annotations,active:false};sendState(p);changed();}
    if(p.owner!==actor.owner)throw Error('preview_scope_denied');return publicPage(p);}
   const existing=[...pages.values()].find(p=>p.threadId===actor.threadId&&p.owner===actor.owner&&p.resource===input.resource&&Object.keys(p.source).length===Object.keys(input.source).length&&Object.keys(p.source).every(key=>p.source[key]===input.source[key])&&(!input.url||input.url===p.openingUrl||input.url===p.view.webContents.getURL()));
   if(existing){if(input.source.kind==='message-file'&&!existing.loading)existing.view.webContents.reload();return publicPage(existing);}
   const p=make({...actor,source:input.source,url:input.url});p.control=input.user?'user':'agent';p.agentAssigned=!input.user;p.loading=true;
   p.resource=input.resource;
   const target=input.url??(input.source.kind==='message-file'?'homer-preview://'+p.id+'/local/index.html':input.source.kind==='attachment'?'homer-preview://'+p.id+'/attachment/'+(p.resource??'index.html'):input.source.url);
   p.openingUrl=target;
   const loaded=p.view.webContents.loadURL(target).catch(error=>{
    if(!p.closed){p.loading=false;p.error=error.message;changed();}
   }).finally(()=>{p.openingUrl=undefined;});
   if(input.user&&input.show!==false)window().webContents.send('homer:preview:show',publicPage(p));
   else if(!input.user)await loaded;
   return publicPage(p);
  }
  if(action==='pause'){for(const p of pages.values())if(p.owner===actor.owner&&p.threadId===actor.threadId){expirePermissions(p);p.taskPaused=true;p.control='user';changed();}return;}
  const p=page(input.pageId);if(p.threadId!==actor.threadId||p.owner!==actor.owner)throw Error('preview_scope_denied');
  if(action==='show'){window().webContents.send('homer:preview:show',publicPage(p));return publicPage(p);}
  if(p.loading){if(action==='read')return{...publicPage(p),content:'页面正在加载，请稍后重新读取。',offset:0,total:0,truncated:false};if(action==='act')throw Error('preview_page_loading');}
  const permissionPending=[...permissions.values()].some(request=>request.page===p);
  if(permissionPending&&!['read','screenshot'].includes(action))throw Error('preview_user_control');
  if(action==='close'){if(p.control!=='agent')throw Error('preview_user_control');return close(p.id);}
  if(p.busy)throw Error('preview_page_busy');const operation=++p.operation,document=input.document??p.document;
  const guard=()=>{if(p.closed||p.view.webContents.isDestroyed())throw Error('preview_page_unavailable');if(operation!==p.operation)throw Error('preview_result_unconfirmed');if(!['read','screenshot'].includes(action)&&(p.control!=='agent'||p.locationApproval))throw Error('preview_user_control');if(document!==p.document)throw Error('preview_document_changed');};
  guard();if(p.busy)throw Error('preview_page_busy');p.busy=true;
  const work=(async()=>{
   if(action==='read'){const result=await automation.read(p.view.webContents,input);guard();const related=[...pages.values()].filter(other=>other!==p&&other.owner===actor.owner&&other.threadId===actor.threadId);return {...publicPage(p),...result,relatedPages:related.slice(0,20).map(other=>({pageId:other.id,url:other.view.webContents.getURL(),title:other.view.webContents.getTitle(),control:other.control})),relatedPagesTruncated:related.length>20};}
   if(action==='screenshot'){const image=await p.view.webContents.capturePage(undefined,{stayHidden:true});guard();return {...publicPage(p),mime:'image/png',data:image.toPNG().toString('base64')};}
   if(action==='act'){
    if(input.action==='click'&&input.requestLocationApproval===true&&actor.turnId)p.locationContext={requestId:actor.requestId,turnId:actor.turnId,runId:actor.runId};
    try{const result=await automation.act(p.view.webContents,input,guard);return {...publicPage(p),...result};}
    finally{p.locationContext=undefined;}
   }
   if(action==='navigate'){await p.view.webContents.loadURL(input.url);return publicPage(p);}
   throw Error('preview_action_denied');
  })();
  let timer;p.inFlight=Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>{p.operation++;p.control='user';p.error='网页操作结果未确认，请先核对当前页面。';changed();reject(Error('preview_result_unconfirmed'));},15000);})]);
  try{return await p.inFlight;}finally{clearTimeout(timer);p.locationContext=undefined;p.busy=false;p.inFlight=undefined;}
 },expirePermissions(){for(const request of permissions.values())finishPermission(request,false,true);},
 close(){for(const id of [...pages.keys()])close(id);browserSession.protocol.unhandle('homer-preview');}};
}
