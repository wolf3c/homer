import{createContext,useEffect,useId,useLayoutEffect,useRef,useState}from'react';
import type{BrowserPage,BrowserPreviewBridge,BrowserAnnotationState,BrowserAnnotationChange,BrowserCaptureRegion,PreviewLinkResult}from'../src/browser-preview';
import{referenceKey,referencesOf,type PreviewSource,type PreviewRequest,type PreviewAnnotation}from'../src/preview-reference';
import{useAnnotationDraft,type AnnotationDraft}from'./annotation-draft';
import{connectionFetch}from'./web-connection-client';
import './browser-preview.css';
import{ArrowLeft,ArrowRight,RotateCw,Hand,Play,MapPin,Clock,X,ChevronRight}from'lucide-react';
import{TooltipIconButton}from'./vendor/assistant-ui/attachment-icon-button';
import{PreviewToolbar}from'./preview-toolbar';
import{AnnotationButton}from'./annotation-button';
import{attachmentMoreItems,localMoreItems,PreviewMoreMenu,runPreviewMore,type PreviewMoreItem}from'./preview-more';
declare global{interface Window{homerBrowserPreview?:BrowserPreviewBridge;}}
export const BrowserPreviewContext=createContext<{openLink:(url:string,trigger:HTMLAnchorElement)=>boolean;openReference:(reference:PreviewRequest,id:string,history?:boolean)=>void}>({openLink:()=>false,openReference:()=>{}});
async function requestPreview<T>(threadId:string,source:PreviewSource,target:{url?:string;href?:string;show?:false}):Promise<T>{
 const response=await connectionFetch('/api/preview/open',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({threadId,source,...target})});
 const result=await response.json();if(!response.ok)throw Error(result.error??'网页打开未确认，请重试。');return result;
}
export const openBrowserPreview=(threadId:string,source:PreviewSource,url?:string,show?:false)=>requestPreview<BrowserPage>(threadId,source,{url,show});
export const openPreviewLink=(threadId:string,source:PreviewSource,href:string)=>requestPreview<PreviewLinkResult>(threadId,source,{href});
export function useBrowserPages(threadId:string){
 const [pages,setPages]=useState<BrowserPage[]>([]),[error,setError]=useState('');
 useEffect(()=>{
  const bridge=window.homerBrowserPreview;setPages([]);if(!bridge||!threadId)return;let current=true,reading=false,again=false;
  const read=async()=>{if(reading){again=true;return;}reading=true;do{again=false;try{const next=await bridge.list(threadId);if(current){setPages(old=>JSON.stringify(old)===JSON.stringify(next)?old:next);setError('');}}catch{if(current)setError('网页列表读取失败，请重新打开预览。');}}while(again&&current);reading=false;};
  void read();const off=bridge.onChanged(()=>void read());return()=>{current=false;off();};
 },[threadId]);return{pages,error};
}
type LocationPanel={scope:string;session:symbol;grants?:string[];history?:boolean;busy?:boolean;notice?:string};
const locationLabel=(type:string)=>type==='geolocation-approximate'?'近似位置':'位置';
type Props={page:BrowserPage;annotationDraft:AnnotationDraft;onReference:(reference:PreviewRequest,file?:File,isCurrent?:()=>boolean,htmlNotes?:undefined,capture?:BrowserCaptureRegion)=>Promise<void>;enabled:boolean;focusId?:string;focusKey?:string;focusRequest?:string;historyNote?:PreviewAnnotation;suspended?:boolean;isCurrent?:()=>boolean;onLocationApproval?:(id:string)=>void};
export function BrowserPreview({page,annotationDraft,onReference,enabled:referenceEnabled,focusId:requestedFocus,focusKey,focusRequest,historyNote,suspended=false,isCurrent=()=>true,onLocationApproval}:Props){
 const enabled=referenceEnabled&&!page.resource&&(page.source.kind!=='browser'||!!(page.source.requestId||page.source.messageId));
 const draft=useAnnotationDraft(annotationDraft),viewport=useRef<HTMLDivElement>(null),latest=useRef({page,onReference,enabled,isCurrent});latest.current={page,onReference,enabled,isCurrent};
 const locationPanel=useRef<HTMLElement>(null),locationButton=useRef<HTMLButtonElement>(null);
 const locationHistoryButton=useRef<HTMLButtonElement>(null),locationId=useId();
 const [location,setLocation]=useState<LocationPanel>();
 const [morePopup,setMorePopup]=useState<HTMLDivElement|null>(null);
 const [active,setActive]=useState(false),[syncing,setSyncing]=useState(false),[notice,setNotice]=useState('');
 const key=referenceKey({kind:'web',source:page.source,page:{id:page.id,url:page.url,title:page.title}});
 const focusId=focusKey===key?requestedFocus:undefined;
 const reference=referencesOf(draft).find(r=>r.kind==='web'&&referenceKey(r)===key);
 const notes=reference?.kind==='web'?reference.annotations:[];
 const state:BrowserAnnotationState={document:page.document,active:active&&enabled&&!page.loading&&page.control==='user',revision:draft.revision,epoch:draft.epoch,notes:page.resource?[]:notes,...(focusId?{focusId,focusRequest,historyNote}:{})};
 const currentState=useRef(state);currentState.current=state;
 useEffect(()=>{if(page.control==='agent')setActive(false);},[page.control]);
 useEffect(()=>{if(focusId&&enabled&&!historyNote)setActive(true);},[focusId,focusRequest,enabled,historyNote]);
 useEffect(()=>{
  const bridge=window.homerBrowserPreview;if(!bridge)return;
  let current=true;setSyncing(state.active);
  void bridge.annotations({pageId:page.id,threadId:page.threadId,state}).catch(()=>{if(current)setNotice('批注同步未确认，已保存备注仍在草稿中。');}).finally(()=>{if(current)setSyncing(false);});return()=>{current=false;};
 },[page.id,page.document,page.control,page.loading,draft.revision,active,enabled,focusId,focusRequest,historyNote]);
 useEffect(()=>{
  const bridge=window.homerBrowserPreview;if(!bridge)return;
  const off=bridge.onAnnotation((change:BrowserAnnotationChange)=>{
   if(change.pageId!==page.id)return;
   void(async()=>{
    const current=latest.current,before=annotationDraft.read();let error:string|undefined;
    try{
     if(!current.enabled||!current.isCurrent()||change.document!==current.page.document||change.baseRevision!==before.revision||change.epoch!==before.epoch)throw Error('页面或草稿已变化，输入已保留，请重新保存。');
     const p=current.page;
     const {capture}=change;
     const fresh=()=>Date.now()<change.expiresAt&&latest.current.isCurrent()&&latest.current.page.document===change.document&&annotationDraft.read().epoch===before.epoch&&annotationDraft.read().revision===before.revision;
     const file=capture?annotationDraft.imageFile(JSON.stringify([p.id,p.document,key,capture.hash]),new File([Uint8Array.from(atob(capture.data),char=>char.charCodeAt(0))],'网页批注.png',{type:'image/png'})):undefined;
     await current.onReference({kind:'web',source:p.source,page:{id:p.id,url:p.url,title:p.title},annotations:change.notes},file,fresh,undefined,capture);
     if(change.captureFailed)setNotice('批注已保存，截图未附上。');
    }catch(e){error=e instanceof Error?e.message:'草稿保存尚未确认，输入已保留。';setNotice(error);}
    const after=annotationDraft.read(),p=latest.current.page;
    const saved=referencesOf(after).find(r=>r.kind==='web'&&referenceKey(r)===key);
    await bridge.reply({pageId:page.id,changeId:change.changeId,state:{document:p.document,active:currentState.current.active,revision:after.revision,epoch:after.epoch,notes:saved?.kind==='web'?saved.annotations:[],...(error?{error}:{})}}).catch(()=>setNotice('草稿确认未送达，请重新核对保存结果。'));
   })();
  });return off;
 },[page.id,key,annotationDraft]);
 useLayoutEffect(()=>{
  const bridge=window.homerBrowserPreview,node=viewport.current;if(!bridge||!node)return;
  let frame=0,disposed=false;
  const draw=()=>{
   if(disposed)return;
   const r=node.getBoundingClientRect(),panel=locationPanel.current,button=locationButton.current;
   if(panel&&button){
    const parent=panel.parentElement!.getBoundingClientRect();
    panel.style.marginInlineStart=Math.max(8,Math.min(button.getBoundingClientRect().left-parent.left,parent.width-panel.offsetWidth-8))+'px';
   }
   const covered=[...document.querySelectorAll<HTMLElement>('[role="dialog"]:not(#canvas-panel,[data-preview-local-quote]),[role="alertdialog"],[role="menu"]')].some(el=>el!==morePopup&&el.getClientRects().length>0);
   const top=Math.max(r.top,Math.ceil(morePopup?.getBoundingClientRect().bottom??r.top));
   const bounds=suspended||covered||!r.width||r.bottom<=top?null:{x:r.x,y:top,width:r.width,height:r.bottom-top};
   void bridge.present({pageId:page.id,threadId:page.threadId,bounds}).then(()=>{
    if(!disposed&&bounds&&panel&&locationPanel.current===panel&&!panel.dataset.ready&&node.getBoundingClientRect().top===r.top){
     panel.dataset.ready='true';
     if(document.activeElement===button||document.activeElement===document.body)panel.focus();
    }
   }).catch(()=>{
    if(disposed)return;
    setNotice('网页显示未确认，请重新打开。');
    if(panel&&locationPanel.current===panel&&!panel.dataset.ready)setLocation(undefined);
   });
  };
  const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(draw);};draw();
  const observer=new ResizeObserver(schedule);observer.observe(node);
  if(morePopup)observer.observe(morePopup);
  const portals=new MutationObserver(schedule);
  portals.observe(document.body,{childList:true});
  portals.observe(document.documentElement,{subtree:true,attributes:true,attributeFilter:['data-preview-local-quote']});
  if(morePopup?.parentElement)portals.observe(morePopup.parentElement,{attributes:true,attributeFilter:['style']});
  window.addEventListener('resize',schedule);window.addEventListener('scroll',schedule,true);
  return()=>{disposed=true;cancelAnimationFrame(frame);observer.disconnect();portals.disconnect();window.removeEventListener('resize',schedule);window.removeEventListener('scroll',schedule,true);};
 },[page.id,page.threadId,suspended,morePopup]);
 useLayoutEffect(()=>()=>{void window.homerBrowserPreview?.present({pageId:page.id,threadId:page.threadId,bounds:null}).catch(()=>{});},[page.id,page.threadId]);
 async function control(action:'takeover'|'resume'|'back'|'forward'|'reload'){
  try{await window.homerBrowserPreview?.control({pageId:page.id,threadId:page.threadId,action});setNotice('');if(action==='resume')setActive(false);return true;}catch(e){setNotice(e instanceof Error?e.message:'网页操作未确认。');return false;}
 }
 const locationBridge=window.homerBrowserPreview;
 const url=new URL(page.url||'about:blank');
 const origin=url.protocol==='https:'&&!url.username&&!url.password&&['browser','web'].includes(page.source.kind)?url.origin:undefined;
 const scope=JSON.stringify([page.id,page.document,origin]);
 const shown=location?.scope===scope?location:undefined;
 useEffect(()=>{setLocation(current=>current?.scope===scope?current:undefined);},[scope]);
 const canManage=!!locationBridge?.locationGrants, settings=!!origin&&!!window.homerDesktopPermissions;
 const approval=page.locationApproval;
 const domain=url.protocol==='homer-preview:'?(page.source.kind==='message-file'?'本地 HTML':'HTML 附件'):url.host;
 const stamp={pageId:page.id,document:page.document};
 const target={threadId:page.threadId,page:stamp};
 let items:PreviewMoreItem[]=[];
 if(locationBridge?.more&&!suspended&&!page.loading&&!page.error){
  if(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password)
   items=[{label:'在默认浏览器中打开',input:{...target,action:'browser'}}];
  else if(url.hostname===page.id&&url.protocol==='homer-preview:'&&!page.resource){
   const source=page.source;
   if(source.kind==='message-file'&&url.pathname==='/local/index.html'&&!url.search)
    items=localMoreItems({...target,file:source},source.title,locationBridge.platform);
   else if(source.kind==='attachment'&&url.pathname==='/attachment/index.html')
    items=attachmentMoreItems({...target,attachment:source});
  }
 }
 function dismissLocation(restore=false){
  setLocation(undefined);
  if(restore)locationButton.current?.focus();
 }
 useEffect(()=>{
  if(!shown)return;
  const outside=(event:PointerEvent)=>{
   const target=event.target as Node;
   if(!locationPanel.current?.contains(target)&&!locationButton.current?.contains(target))dismissLocation();
  };
  const escape=(event:KeyboardEvent)=>{
   const target=event.target as Node;
   if(event.key!=='Escape'||(target!==document.body&&!locationPanel.current?.contains(target)&&!locationButton.current?.contains(target)))return;
   event.preventDefault();
   event.stopPropagation();
   dismissLocation(true);
  };
  window.addEventListener('pointerdown',outside);
  document.addEventListener('keydown',escape,true);
  return()=>{
   window.removeEventListener('pointerdown',outside);
   document.removeEventListener('keydown',escape,true);
  };
 },[!!shown]);
 function updatePanel(session:symbol,patch:Partial<LocationPanel>){
  setLocation(current=>current?.session===session?{...current,...patch}:current);
 }
 async function readGrants(session:symbol,key?:string){
  updatePanel(session,{busy:true,notice:undefined});
  try{
   const grants=key?await locationBridge!.revokeLocation!(key):await locationBridge!.locationGrants!();
   updatePanel(session,{grants,busy:false});
  }catch{
   updatePanel(session,{busy:false,notice:'无法更新网站定位授权，请重试。'});
  }
 }
 function toggleLocation(){
  if(shown){dismissLocation(true);return;}
  const session=Symbol();
  setLocation({scope,session,history:!origin});
  if(canManage)void readGrants(session);
 }
 async function openLocationSettings(session:symbol){
  const manual='请在电脑的系统设置中打开「隐私与安全性」下的定位服务或位置设置。';
  updatePanel(session,{busy:true,notice:undefined});
  try{
   const result=await window.homerDesktopPermissions?.openSystemSettings('location');
   updatePanel(session,{busy:false,notice:result&&'ok'in result&&result.ok&&result.code!=='manual_navigation'?'请核对电脑的定位设置，再从原网页重新请求位置。':manual});
  }catch{updatePanel(session,{busy:false,notice:manual});}
 }
 const siteGrants=shown?.grants?.filter(key=>key.split(' ')[0]===origin);
 const grants=shown?.history?shown.grants:siteGrants;
 const siteButton=(canManage||settings)&&<button type="button" className="aui-button-icon" ref={locationButton} title="网站定位权限" aria-label="网站定位权限" aria-expanded={!!shown} aria-controls={shown?locationId:undefined} onClick={toggleLocation}><MapPin size={16} aria-hidden/></button>;
 return <div className="browser-preview" data-location-open={shown?'true':undefined}><PreviewToolbar title={page.title} detail={page.loading?domain+' · 加载中':domain} identityStart={siteButton} identityEnd={approval&&<button type="button" className="aui-button-icon browser-location-pending" title="查看定位审批" aria-label="查看定位审批" onClick={()=>{dismissLocation();onLocationApproval?.(approval);}}><Clock size={16} aria-hidden/><span>待审批</span></button>} leading={<>{([{action:'back',label:'后退',Icon:ArrowLeft},{action:'forward',label:'前进',Icon:ArrowRight},{action:'reload',label:'重新加载',Icon:RotateCw}]as const).map(({action,label,Icon})=><TooltipIconButton side="top" key={action} aria-label={label} tooltip={label} onClick={()=>void control(action)}><Icon size={16} aria-hidden/></TooltipIconButton>)}</>}>
  <AnnotationButton disabled={!enabled||page.loading||syncing} aria-busy={syncing} active={active} aria-label="批注" tooltip={active?'退出网页批注':'选择网页元素批注'} onClick={()=>void control('takeover').then(ok=>{if(ok)setActive(value=>!value);})}/>
  {page.agentAssigned&&<TooltipIconButton side="top" aria-label={page.control==='agent'?'用户接手':'交还 AI'} tooltip={page.control==='agent'?'暂停 AI 写入，由你操作':'结束用户接手，允许原任务继续操作此页'} onClick={()=>void control(page.control==='agent'?'takeover':'resume')}>{page.control==='agent'?<Hand size={16} aria-hidden/>:<Play size={16} aria-hidden/>}</TooltipIconButton>}
  {items.length>0&&<PreviewMoreMenu key={JSON.stringify([page.id,page.document])} nativePageId={page.id} onPopup={setMorePopup} items={items} onAction={input=>{
   void runPreviewMore(input,()=>latest.current.isCurrent()&&latest.current.page.id===stamp.pageId&&latest.current.page.document===stamp.document,setNotice);
  }}/>}
 </PreviewToolbar>
 {shown&&<section className="browser-location-panel" id={locationId} ref={locationPanel} tabIndex={-1} aria-labelledby={locationId+'-title'}>
  <header><div><h2 id={locationId+'-title'}>{shown.history?'已记住的网站':'网站定位'}</h2>{!shown.history&&origin&&<p>{origin}</p>}</div><button type="button" aria-label="关闭网站定位" onClick={()=>dismissLocation(true)}><X size={16} aria-hidden/></button></header>
  {!shown.history&&origin&&approval&&<p role="status">等待定位审批</p>}
  {!shown.history&&origin&&!approval&&page.locationDenied&&<p role="status">上次请求未获准</p>}
  {!!grants?.length&&<ul>{grants.map(key=>{
   const [site,type]=key.split(' '),label=locationLabel(type);
   return <li key={key}><span>{shown.history&&<>{site}<br/></>}{label}{!shown.history&&' · 已记住'}</span><button type="button" disabled={shown.busy} aria-label={'撤销 '+site+' 的'+label+'授权'} onClick={()=>{locationPanel.current?.focus();void readGrants(shown.session,key);}}>撤销</button></li>;
  })}</ul>}
  {grants?.length===0&&<p>{shown.history?'没有已记住的网站定位授权。':'未保存授权'}</p>}
  {canManage&&!shown.grants&&(shown.busy?<p role="status">正在读取网站定位授权…</p>:<button type="button" onClick={()=>void readGrants(shown.session)}>重新读取授权</button>)}
  {shown.notice&&<p role="status">{shown.notice}</p>}
  {shown.history?(origin&&<button type="button" onClick={()=>{const panel=locationPanel.current;updatePanel(shown.session,{history:false});requestAnimationFrame(()=>{if(locationPanel.current===panel)locationHistoryButton.current?.focus();});}}>返回当前站点</button>):<footer>
   {settings&&<button type="button" aria-disabled={!!shown.busy} onClick={()=>{if(!shown.busy)void openLocationSettings(shown.session);}}>打开系统位置设置</button>}
   {canManage&&<button type="button" ref={locationHistoryButton} onClick={()=>{locationPanel.current?.focus();updatePanel(shown.session,{history:true});}}>已记住的网站<ChevronRight size={14} aria-hidden/></button>}
  </footer>}
 </section>}
 {(notice||page.error)&&<p role="status" className="canvas-note">{notice||page.error}</p>}
 <div className="browser-preview-viewport" ref={viewport} aria-label="内置网页内容">{suspended&&<p>关闭对话框后继续查看网页。</p>}</div></div>;
}
export function AttachmentBrowserPreview(props:Omit<Props,'page'>&{threadId:string;source:PreviewSource;onFileError?:(code:string)=>void}){
 const [page,setPage]=useState<BrowserPage>(),[error,setError]=useState('');const{pages}=useBrowserPages(props.threadId);
 useEffect(()=>{let alive=true;void(async()=>{try{const existing=(await window.homerBrowserPreview!.list(props.threadId)).find(p=>!p.fileError&&referenceKey({kind:'web',source:p.source})===referenceKey({kind:'web',source:props.source}));const next=existing??await openBrowserPreview(props.threadId,props.source);if(alive)setPage(next);}catch(e){if(alive)setError(e instanceof Error?e.message:'HTML 打开未确认。');}})();return()=>{alive=false;};},[props.threadId,referenceKey({kind:'web',source:props.source})]);
 const actual=pages.find(p=>p.id===page?.id)??page;
 const fileError=error||actual?.fileError;
 useEffect(()=>{if(fileError)props.onFileError?.(fileError);},[fileError,actual?.document]);
 return error?<p role="alert">{error}</p>:actual&&!actual.fileError?<BrowserPreview {...props} page={actual}/>:<p role="status">正在打开 HTML…</p>;
}
