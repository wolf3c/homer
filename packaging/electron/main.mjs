import {app,BrowserWindow,Menu,dialog,shell,ipcMain,systemPreferences,autoUpdater,globalShortcut,screen,desktopCapturer} from 'electron';
import {readFileSync,existsSync,mkdirSync} from 'node:fs';
import {lstat,writeFile} from 'node:fs/promises';
import {join,resolve,win32} from 'node:path';
import {userInfo} from 'node:os';
import {execFileSync,execFile,spawn} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {types} from 'node:util';
// This entry is copied to Resources/app.asar/main.mjs by Forge.
import {prepareDesktopProfile,recoverDesktopOwner,assertDesktopControlPaths,readDesktopModelSource,saveDesktopModelSource,readDesktopCaptureShortcut,saveDesktopCaptureShortcut} from '../homer/scripts/desktop-profile.mjs';
import {processIdentity,leaseOwnerGone} from '../homer/dist/processes.js';
import {DesktopChannels} from '../homer/dist/desktop-channels.js';
import {webMediaRoute} from '../homer/dist/web-contract.js';
import {WEB_UPLOAD_BYTES} from '../homer/dist/web-upload.js';
import {MEDIA_POLICY,detectMedia,imageDimensions} from '../homer/dist/media-policy.js';
import {parseWindowAX,previewImageAnnotations} from '../homer/dist/preview-reference.js';

import {validateHomerOrigins,readHomerConnection,authorizeHomerConnection,disconnectHomerConnection,queryHomerWallet,queryHomerRuntimeConfig,saveHomerRuntimeConfig} from '../homer/dist/homer-account.js';

const resources=process.resourcesPath,bundle=process.platform==='win32'?resolve(resources,'..'):resolve(resources,'../..');
let window,child,origin,acknowledged=false,startupRefused=false,closed=false,exitCode,exitSignal,quitPending=false,quitSent=false,allowQuit=false,stopTimer,permissionNavigation=0;
let deepseek=false;
let desktopAccessToken;
let desktopProfile,modelSource='codex',switchSource,nativeStatus,nativeError,nativeSequence=0,nativeRead;
const nativeRequests=new Map();
function nativeAccount(action){
 if(!child||closed||quitPending)return Promise.reject(Error('native_account_unconfirmed'));
 return new Promise((resolve,reject)=>{
  const id=++nativeSequence,timer=setTimeout(()=>{nativeRequests.delete(id);reject(Error('native_account_unconfirmed'));},20000);
  nativeRequests.set(id,{resolve,reject,timer});
  child.stdin.write(JSON.stringify({kind:'native_account',id,action})+'\n',error=>{if(error){clearTimeout(timer);nativeRequests.delete(id);reject(Error('native_account_unconfirmed'));}});
 });
}
async function readNativeAccount(action='state'){
 try{nativeStatus=await nativeAccount(action);nativeError=undefined;}catch{nativeStatus=undefined;nativeError='Codex 登录状态未能确认，请重试。';}
 return accountState();
}
let dailyTokenFile,accountOrigins,accountSynthetic=false,connection,activeConnection,connectionError,pendingConnection,wallet,walletError,walletUpdatedAt;
let configRead,configAbort,lastConfigCheck;
let accountRevision=0,walletRevision=0,walletDirty=true,walletRead,quitAction,pendingLoginUrl;
const accountBoundary=()=>({gatewayOrigin:accountOrigins?.gatewayOrigin??'',allowSyntheticLoopback:accountSynthetic});
const connectionKind=value=>value?.subject&&value.token?'website':'disconnected';
const connectionReady=value=>!!value?.subject&&!!value.token&&!!value.config;
const accountCode=error=>['INVALID_REQUEST','UNAUTHORIZED','FORBIDDEN','ACCOUNT_UNAVAILABLE','CONFLICT','RATE_LIMITED','UNAVAILABLE','ACCOUNT_MISMATCH','CONNECTION_FILE_INVALID','CONNECTION_WRITE_FAILED','CONNECTION_CANCELLED','TOKEN_UNAVAILABLE','USAGE_UNAVAILABLE','NOT_CONNECTED'].includes(error?.message)?error.message:'UNAVAILABLE';
const accountState=()=>({supported:!!dailyTokenFile,configured:!!accountOrigins,source:modelSource,websiteReady:connectionReady(connection),native:nativeStatus?{account:nativeStatus.account,connected:nativeStatus.connected,phase:nativeStatus.phase,pending:!!nativeStatus.loginId,canReopen:!!nativeStatus.authUrl}:undefined,nativeError,connection:connectionKind(connection),active:connectionKind(modelSource==='website'?activeConnection:null),pending:!!pendingConnection,canReopen:!!pendingConnection&&!!pendingLoginUrl,needsRestart:connectionReady(connection)&&JSON.stringify(connection)!==JSON.stringify(activeConnection),error:connectionError,...(wallet?{wallet,updatedAt:walletUpdatedAt}:{}),walletError,stale:walletDirty||!!wallet?.expiresAt&&wallet.expiresAt<=Date.now()/1000});
function accountChanged(){
 if(!window||window.isDestroyed()||!origin)return;
 const frame=window.webContents.mainFrame,event={sender:window.webContents,senderFrame:frame};
 if(permissionCaller(event,frame))frame.send('homer:account:changed');
}
function cancelConnection(){
 pendingConnection?.abort();pendingConnection=undefined;pendingLoginUrl=undefined;configAbort?.abort();accountRevision++;
}
async function syncHomerConfig(reason){
 if(!accountOrigins||!connection?.subject||!connection.token||pendingConnection||quitPending)return;
 if(configRead)return configRead;
 const now=performance.now();
 if(reason==='message'&&lastConfigCheck!==undefined&&now-lastConfigCheck<=3600000)return;
 lastConfigCheck=now;
 const revision=accountRevision,operation=new AbortController();configAbort=operation;
 configRead=(async()=>{
  try{
   const config=await queryHomerRuntimeConfig({...accountOrigins,allowSyntheticLoopback:accountSynthetic},operation.signal);
   if(operation.signal.aborted||revision!==accountRevision||quitPending)return;
   if(JSON.stringify(config)!==JSON.stringify(connection.config))connection=saveHomerRuntimeConfig(dailyTokenFile,config,accountBoundary());
   connectionError=undefined;
  }catch(error){if(!operation.signal.aborted&&revision===accountRevision)connectionError=accountCode(error)==='UNAVAILABLE'?'CONFIG_UNAVAILABLE':accountCode(error);}
  finally{if(configAbort===operation)configAbort=undefined;configRead=undefined;accountChanged();}
 })();
 return configRead;
}
function registerDesktopAccount(){
 const actions={
  state:()=>{if(!nativeRead)nativeRead=readNativeAccount().finally(()=>{nativeRead=undefined;});return nativeRead;},
  nativeConnect:async()=>{await readNativeAccount('connect');if(nativeStatus?.authUrl){try{await shell.openExternal(nativeStatus.authUrl);}catch{nativeError='登录页面未能打开，请重试。';}}return accountState();},
  nativeCancel:()=>readNativeAccount('cancel'),
  nativeReopen:async()=>{if(nativeStatus?.authUrl){try{await shell.openExternal(nativeStatus.authUrl);}catch{nativeError='登录页面未能打开，请重试。';}}return accountState();},
  applyCodex:async()=>{await readNativeAccount();if(nativeStatus?.connected&&!quitPending){switchSource='codex';quitAction='restart';requestQuit();}return accountState();},
  applyWebsite:()=>{if(connectionReady(connection)&&!quitPending){switchSource='website';quitAction='restart';requestQuit();}return accountState();},
  connect:()=>{
   if(quitPending)return accountState();
   cancelConnection();connectionError=undefined;
   if(!accountOrigins){connectionError='CONFIGURATION_REQUIRED';return accountState();}
   const operation=new AbortController();pendingConnection=operation;
   void authorizeHomerConnection({...accountOrigins,allowSyntheticLoopback:accountSynthetic,file:dailyTokenFile,signal:operation.signal,openBrowser:url=>{if(pendingConnection!==operation||operation.signal.aborted)return Promise.resolve();pendingLoginUrl=url;accountChanged();return shell.openExternal(url);},onCallback:()=>{if(pendingConnection===operation){pendingLoginUrl=undefined;accountChanged();}}}).then(value=>{
    if(pendingConnection!==operation||operation.signal.aborted||quitPending)return;
    connection=value;lastConfigCheck=performance.now();accountRevision++;
    wallet=undefined;walletUpdatedAt=undefined;walletError=undefined;walletDirty=true;walletRevision++;
   }).catch(error=>{if(pendingConnection===operation&&!operation.signal.aborted&&!quitPending)connectionError=accountCode(error);})
   .finally(()=>{if(pendingConnection===operation){pendingConnection=undefined;pendingLoginUrl=undefined;if(!operation.signal.aborted&&!quitPending){accountChanged();showWindow();}}});
   return accountState();
  },
  cancel:()=>{cancelConnection();accountChanged();return accountState();},
  reopen:async()=>{if(pendingConnection&&!pendingConnection.signal.aborted&&pendingLoginUrl)await shell.openExternal(pendingLoginUrl);return accountState();},
  refresh:async()=>{
   if(walletRead)return walletRead;
   const credentials=modelSource==='codex'?connection:activeConnection;
   if(!accountOrigins||!credentials?.subject||!credentials.token){walletError=accountOrigins?'NOT_CONNECTED':'CONFIGURATION_REQUIRED';return accountState();}
   const revision=accountRevision;
   walletRead=(async()=>{
    try{do{
     const observed=walletRevision,value=await queryHomerWallet(credentials,accountBoundary());
     if(revision!==accountRevision)break;
     if(observed!==walletRevision)continue;
     wallet=value;walletUpdatedAt=new Date().toISOString();walletError=undefined;walletDirty=false;break;
    }while(true);}
    catch(error){if(revision===accountRevision){walletError=accountCode(error);walletDirty=true;}}
    finally{walletRead=undefined;accountChanged();}
    return accountState();
   })();
   return walletRead;
  },
  openWebsite:async()=>{if(!accountOrigins)return {...accountState(),error:'CONFIGURATION_REQUIRED'};await shell.openExternal(accountOrigins.websiteOrigin+'/homer');return accountState();},
  disconnect:()=>{if(!quitPending){quitAction='disconnect';requestQuit();}return accountState();},
  restart:()=>{if(!quitPending){quitAction='restart';requestQuit();}return accountState();},
 };
 for(const [name,action]of Object.entries(actions))ipcMain.handle('homer:account:'+name,async(event,...args)=>{
  const frame=event.senderFrame,navigation=permissionNavigation;
  if(args.length||!permissionCaller(event,frame))throw Error('desktop_account_forbidden');
  const result=dailyTokenFile?await action():{supported:false};
  if(navigation!==permissionNavigation||!permissionCaller(event,frame))throw Error('desktop_account_forbidden');
  return result;
 });
 return actions;
}
const confirmed=()=>closed&&!exitSignal&&(acknowledged&&exitCode===0||startupRefused&&exitCode===1);
const code=error=>/^[a-z_]{1,70}$/.test(error?.message??'')?error.message:'desktop_start_failed';
const showError=detail=>{
 const options={type:'error',title:'荷马',message:'荷马需要核对',detail,buttons:['保留并核对']};
 if(window&&!window.isDestroyed()){window.show();return dialog.showMessageBox(window,options);}
 return dialog.showMessageBox(options);
};
const owned=url=>{try{const u=new URL(url);return !!origin&&!u.username&&!u.password&&u.origin===origin;}catch{return false;}};
const permissionPage=url=>{
 if(typeof url!=='string'||!owned(url))return false;
 const page=new URL(url);return page.pathname==='/'&&!page.search;
};
function permissionCaller(event,frame){
 try{
  if(!window||window.isDestroyed())return false;
  const contents=window.webContents;
  return event.sender===contents&&!contents.isDestroyed()&&!!frame
   &&event.senderFrame===frame&&contents.mainFrame===frame
   &&!frame.isDestroyed()&&frame.detached===false&&frame.origin===origin
   &&permissionPage(frame.url)&&permissionPage(contents.getURL());
 }catch{return false;}
}
let captureSubscriber,captureAbort,capturePanel;
const capturePanelPage=join(resources,'homer/dist/capture-panel/capture-panel.html');
const capturePanelUrl=pathToFileURL(capturePanelPage).href;
function cancelDesktopCapture(){
 captureAbort?.abort();
 capturePanel?.panel.destroy();
}
function currentCapture(target){
 return target===captureSubscriber&&!closed&&!quitPending&&permissionCaller(target,target.senderFrame);
}
function deliverCapture(target,result){
 if(!currentCapture(target))return;
 if(result.kind==='image'){
  if(window.isMinimized())window.restore();
  showWindow();
 }
 target.senderFrame.send('homer:capture:result',target.scope,result);
}
function prepareCapturePanel(target){
 const cursor=screen.getCursorScreenPoint(),display=screen.getDisplayNearestPoint(cursor),windows=process.platform==='win32';
 const panel=new BrowserWindow({...display.bounds,show:false,frame:false,alwaysOnTop:true,
  ...(windows?{skipTaskbar:true}:{type:'panel',enableLargerThanScreen:true,acceptFirstMouse:true,hiddenInMissionControl:true}),
  fullscreenable:false,resizable:false,transparent:true,hasShadow:false,
  webPreferences:{preload:fileURLToPath(new URL('./capture-panel-preload.cjs',import.meta.url)),sandbox:true,contextIsolation:true,nodeIntegration:false,webviewTag:false,
   partition:'homer-capture-panel',...(windows?{backgroundThrottling:false}:{})}});
 const ready=Promise.withResolvers();
 const owner={panel,target,ready,...(windows?{display,cursor}:{})};
 capturePanel=owner;
 const contents=panel.webContents,{session}=contents;
 contents.setWindowOpenHandler(()=>({action:'deny'}));
 contents.on('will-navigate',event=>event.preventDefault());
 contents.once('render-process-gone',()=>fallbackCapturePanel(owner));
 const denyPermissions=()=>{
  session.setPermissionRequestHandler((_contents,_permission,respond)=>respond(false));
  session.setPermissionCheckHandler(()=>false);
 };
 if(windows){
  const displayPermission=(sender,permission,details)=>sender===contents&&permission==='display-capture'&&details?.isMainFrame===true
   &&!!owner.choice?.source&&!panel.isDestroyed()&&capturePanelFrame(owner,contents.mainFrame);
  session.setPermissionRequestHandler((sender,permission,respond,details)=>respond(displayPermission(sender,permission,details)));
  session.setPermissionCheckHandler((sender,permission,_origin,details)=>displayPermission(sender,permission,details));
  session.setDisplayMediaRequestHandler((request,respond)=>{
   const choice=owner.choice;
   if(!choice?.source||choice.used||!capturePanelFrame(owner,request.frame)
    ||!request.userGesture||!request.videoRequested||request.audioRequested)return respond(null);
   if(choice.id===null){
    // The screen frame must be taken before the region picker is visible.
    if(!captureDisplayAvailable(owner.display))return respond(null);
    panel.hide();
    if(panel.isVisible())return respond(null);
   }
   choice.used=true;
   respond({video:choice.source});
  });
  owner.presentTimeout=setTimeout(()=>fallbackCapturePanel(owner),10000);
 }else denyPermissions();
 panel.once('closed',()=>{
  clearTimeout(owner.presentTimeout);
  ready.resolve();
  owner.handoff?.settle(false);
  if(capturePanel===owner){
   capturePanel=undefined;
   if(windows){
    session.setDisplayMediaRequestHandler((_request,respond)=>respond(null));
    denyPermissions();
   }
  }
 });
 void panel.loadFile(capturePanelPage).catch(()=>fallbackCapturePanel(owner));
 return owner;
}
function fallbackCapturePanel(owner){
 if(capturePanel!==owner||owner.panel.isDestroyed())return;
 const result=owner.handoff?undefined:owner.result??(owner.display?{kind:'unavailable'}:undefined);
 owner.panel.destroy();
 if(result)deliverCapture(owner.target,result);
}
function supplyCaptureImage(owner,result,bounds){
 const area=Array.isArray(bounds)&&bounds.length===4&&bounds.every(Number.isSafeInteger)&&bounds[2]>0&&bounds[3]>0
  ?{x:bounds[0],y:bounds[1],width:bounds[2],height:bounds[3]}:undefined;
 const cursor=owner.cursor??screen.getCursorScreenPoint();
 const display=owner.display??(area?screen.getDisplayMatching(area):screen.getDisplayNearestPoint(cursor));
 const work=owner.display&&area?display.bounds:display.workArea,top=display.bounds.y,bottom=work.y+work.height;
 const preferredWidth=Math.min(area?.width??Math.round(result.width/display.scaleFactor),work.width);
 // Small selections can zoom and scroll so the inset controls fit over the image.
 const imageWidth=Math.max(preferredWidth,result.ax?200:104,Math.ceil(60*result.width/result.height));
 const width=Math.min(imageWidth,work.width);
 const height=Math.min(Math.round(result.height*imageWidth/result.width),bottom-top);
 const clamp=(value,min,max)=>Math.max(min,Math.min(value,max));
 const x=clamp(area?.x??cursor.x-Math.floor(width/2),work.x,work.x+work.width-width);
 const y=clamp(area?.y??cursor.y-Math.floor(height/2),top,bottom-height);
 const placement={x:x-display.bounds.x,y:y-display.bounds.y,width,height};
 owner.panel.setBounds(display.bounds);
 owner.result=result;
 clearTimeout(owner.presentTimeout);
 owner.presentTimeout=setTimeout(()=>fallbackCapturePanel(owner),3000);
 const image={png:result.png,ax:result.ax,imageWidth,placement};
 owner.ready.resolve(image);
 return image;
}
function capturePanelFrame(owner,frame){
 return capturePanel===owner&&currentCapture(owner.target)&&!owner.panel.isDestroyed()
  &&!!frame&&frame===owner.panel.webContents.mainFrame&&!frame.isDestroyed()&&!frame.detached&&frame.url===capturePanelUrl;
}
function capturePanelCaller(event,actualArgs,expectedArgs){
 const owner=capturePanel;
 if(actualArgs!==expectedArgs||!owner||!capturePanelFrame(owner,event.senderFrame)||event.sender!==owner.panel.webContents)
  throw Error('capture_panel_forbidden');
 return owner;
}
const captureSources=type=>desktopCapturer.getSources({types:[type],thumbnailSize:{width:0,height:0}});
function captureDisplayAvailable(display){
 const current=screen.getDisplayMatching(display.bounds);
 return current.id===display.id&&current.scaleFactor===display.scaleFactor
  &&['x','y','width','height'].every(key=>current.bounds[key]===display.bounds[key]);
}
function captureDesktop(select=false){
 const target=captureSubscriber;
 if(!target||captureAbort||capturePanel||!currentCapture(target))return;
 if(process.platform==='win32'){
  if(target.panel)try{prepareCapturePanel(target);}catch{
   capturePanel?.panel.destroy();
   deliverCapture(target,{kind:'unavailable'});
  }
  return;
 }
 const operation=captureAbort=new AbortController();
 let owner;
 execFile(join(bundle,'Contents/MacOS/homer-window-capture'),select?['--select']:[],{
  signal:operation.signal,timeout:65000,maxBuffer:Math.ceil(WEB_UPLOAD_BYTES/3)*4+128*1024,
 },(error,output)=>{
  try{
   if(operation.signal.aborted||!currentCapture(target))return;
   let result={kind:'unavailable'};
   if(!error)try{
    const value=JSON.parse(output);
    if(value?.kind==='cancelled')return;
    if(value?.kind==='permission-required'&&!select){openSettings('permissions');return;}
    if(value?.kind==='too-large')result={kind:'too-large'};
    if(value?.kind==='image'&&typeof value.png==='string'){
     const png=Buffer.from(value.png,'base64'),dimensions=imageDimensions(png,'image/png'),{width,height}=value;
     if(png.length<=WEB_UPLOAD_BYTES&&detectMedia(png)==='image/png'&&width===dimensions?.width&&height===dimensions?.height
      &&width>0&&height>0&&width*height<=MEDIA_POLICY.maxPixels){
      result={kind:'image',png,width,height};
      if(value.ax!==undefined)try{result.ax=parseWindowAX(value.ax);}catch{}
      if(owner&&capturePanel===owner){
       supplyCaptureImage(owner,result,value.bounds);
       return;
      }
     }
    }
   }catch{}
   deliverCapture(target,result);
  }finally{if(owner&&capturePanel===owner&&!owner.result)owner.panel.destroy();}
 }).once('close',()=>{captureAbort=undefined;});
 if(target.panel)try{owner=prepareCapturePanel(target);}catch{capturePanel?.panel.destroy();}
}
function captureAccelerator(value){
 const order=['Control','Alt','Shift','Command'];
 if(typeof value!=='string'||value.length>32)return {error:'invalid'};
 const parts=value.split('+'),key=parts.pop(),mods=new Set(parts);
 if(process.platform==='win32')return parts.length===2&&mods.has('Control')&&mods.has('Shift')&&/^(?:[A-Z0-9]|F[1-9]|F1[01])$/.test(key)
  ?{shortcut:'Control+Shift+'+key}:{error:'invalid'};
 const controlDigit=parts.length===1&&mods.has('Control')&&/^[0-9]$/.test(key);
 if(!/^[A-Z0-9]$/.test(key)||(!controlDigit&&parts.length<2)||mods.size!==parts.length
  ||!parts.every(mod=>order.includes(mod))||!mods.has('Control')&&!mods.has('Command'))return {error:'invalid'};
 const shortcut=[...order.filter(mod=>mods.has(mod)),key].join('+');
 if(mods.has('Command')&&(key==='Q'||mods.has('Shift')&&/^[3-6]$/.test(key))
  ||['Alt+Command+D','Control+Command+F','Shift+Command+S','Shift+Command+Z'].includes(shortcut))return {error:'reserved'};
 return {shortcut};
}
function registerDesktopCapture(profile){
 const windows=process.platform==='win32';
 if(!windows&&process.platform!=='darwin')return;
 ipcMain.handle('homer:capture-panel:read',async(event,...args)=>{
  const owner=capturePanelCaller(event,args.length,0);
  if(windows){
   const sources=await captureSources('window').catch(error=>{fallbackCapturePanel(owner);throw error;});
   if(capturePanelCaller(event,args.length,0)!==owner||owner.windowIds)throw Error('capture_panel_forbidden');
   const panelId=owner.panel.getMediaSourceId();
   const windows=sources.filter(source=>source.id!==panelId&&/^window:[^:]+:[01]$/.test(source.id)&&source.name)
    .map(({id,name})=>({id,name}));
   owner.windowIds=new Set(windows.map(({id})=>id));
   return {windows};
  }
  const image=await owner.ready.promise;
  if(capturePanelCaller(event,args.length,0)!==owner||!image)throw Error('capture_panel_forbidden');
  return image;
 });
 ipcMain.handle('homer:capture-panel:present',(event,...args)=>{
  const owner=capturePanelCaller(event,args.length,0);
  if(!owner.result&&!owner.windowIds)throw Error('capture_panel_forbidden');
  owner.panel.show();
  clearTimeout(owner.presentTimeout);
 });
 ipcMain.handle('homer:capture-panel:close',(event,...args)=>{
  const {panel}=capturePanelCaller(event,args.length,0);
  panel.hide();
  panel.close();
 });
 if(windows){
  ipcMain.handle('homer:capture-panel:choose-source',async(event,...args)=>{
   const owner=capturePanelCaller(event,args.length,1),[id]=args;
   const unavailable='所选截图来源已不可用，请重试。';
   if(!owner.windowIds||owner.choice||(id!==null&&!owner.windowIds.has(id)))throw Error(unavailable);
   const choice=owner.choice={id,used:false};
   clearTimeout(owner.presentTimeout);
   owner.presentTimeout=setTimeout(()=>fallbackCapturePanel(owner),10000);
   try{
    const sources=await captureSources(id===null?'screen':'window');
    if(capturePanelCaller(event,args.length,1)!==owner)throw Error('capture_panel_forbidden');
    const matches=sources.filter(source=>id===null
     ?source.id.startsWith('screen:')&&source.display_id===String(owner.display.id)
     :source.id===id);
    if(matches.length!==1||id===null&&!captureDisplayAvailable(owner.display))throw Error(unavailable);
    choice.source=matches[0];
   }catch(error){
    owner.choice=undefined;
    clearTimeout(owner.presentTimeout);
    throw error;
   }
  });
  ipcMain.handle('homer:capture-panel:accept-image',async(event,...args)=>{
   const owner=capturePanelCaller(event,args.length,2),[bytes,region]=args;
   if(!owner.choice?.used||owner.result)throw Error('capture_panel_forbidden');
   if(!types.isUint8Array(bytes))throw Error('无法读取截图图片。');
   if(bytes.byteLength>WEB_UPLOAD_BYTES)throw Error('截图过大，请选择较小的区域或窗口。');
   const png=Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength),dimensions=imageDimensions(png,'image/png');
   if(detectMedia(png)!=='image/png'||!dimensions?.width||!dimensions.height)throw Error('无法读取截图图片。');
   if(dimensions.width*dimensions.height>MEDIA_POLICY.maxPixels)throw Error('截图过大，请选择较小的区域或窗口。');
   let bounds;
   if(owner.choice.id===null){
    if(!captureDisplayAvailable(owner.display)||!Array.isArray(region)||region.length!==4
     ||!Array.from(region).every(value=>Number.isFinite(value)&&value>=0&&value<=1))
     throw Error('截图区域无效。');
    const {x,y,width,height}=owner.display.bounds;
    const [left,top,right,bottom]=region.map((value,index)=>Math.round(value*(index%2?height:width)));
    if(right<=left||bottom<=top)throw Error('截图区域无效。');
    bounds=[x+left,y+top,right-left,bottom-top];
   }else if(region!==null)throw Error('截图区域无效。');
   return supplyCaptureImage(owner,{kind:'image',png,...dimensions},bounds);
  });
 }
 ipcMain.handle('homer:capture-panel:finish',(event,...args)=>{
  const owner=capturePanelCaller(event,args.length,2),{target,result}=owner;
  if(!result||owner.handoff)throw Error('主对话暂时无法接收截图。');
  const [notes,includeAX]=args;
  if(typeof includeAX!=='boolean')throw Error('capture_panel_arguments');
  let annotations;
  try{annotations=previewImageAnnotations(notes,result.width,result.height,true);}
  catch{throw Error('批注超出图片范围或长度限制。');}
  const id=randomUUID();
  return new Promise((resolve,reject)=>{
   const settle=accepted=>{
    clearTimeout(timer);
    owner.handoff=undefined;
    if(!accepted){reject(Error('主对话尚未确认接收。可在这里重试。'));return;}
    owner.panel.close();
    if(window.isMinimized())window.restore();
    showWindow();
    resolve();
   };
   const timer=setTimeout(()=>settle(false),6000);
   owner.handoff={id,settle};
   try{target.senderFrame.send('homer:capture:result',target.scope,{...result,ax:includeAX?result.ax:undefined,draft:{id,action:'send',annotations}});}
   catch{settle(false);}
  });
 });
 ipcMain.handle('homer:capture:accept-draft',(event,...args)=>{
  const owner=capturePanel;
  if(args.length!==1||!owner?.handoff||owner.handoff.id!==args[0]||!currentCapture(owner.target)
     ||!permissionCaller(event,owner.target.senderFrame))return false;
  owner.handoff.settle(true);
  return true;
 });
 const defaultShortcut=windows?'Control+Shift+F2':'Control+1';
 let override,active;
 try{override=captureAccelerator(readDesktopCaptureShortcut(profile)).shortcut;}catch{}
 const status=error=>({shortcut:override??defaultShortcut,defaultShortcut,active:active!==undefined,...(error?{error}:{})});
 const register=key=>{
  try{return globalShortcut.register(key,()=>{if(active===key)captureDesktop();});}catch{return false;}
 };
 const initial=override??defaultShortcut;
 if(register(initial))active=initial;
 app.once('will-quit',()=>{if(active)globalShortcut.unregister(active);active=undefined;});
 ipcMain.handle('homer:capture:shortcut-state',(event,...args)=>{
  if(args.length||!permissionCaller(event,event.senderFrame))throw Error('desktop_capture_forbidden');
  return status();
 });
 ipcMain.handle('homer:capture:shortcut-set',(event,...args)=>{
  if(args.length!==1||!permissionCaller(event,event.senderFrame))throw Error('desktop_capture_forbidden');
  if(closed||quitPending)return status('unavailable');
  const {shortcut,error}=args[0]===null?{}:captureAccelerator(args[0]);
  if(error)return status(error);
  const next=shortcut??defaultShortcut,changed=next!==active;
  if(changed&&!register(next))return status('unavailable');
  try{if(shortcut!==override)saveDesktopCaptureShortcut(profile,shortcut);}
  catch{if(changed)globalShortcut.unregister(next);return status('save_failed');}
  if(changed&&active)globalShortcut.unregister(active);
  active=next;override=shortcut;
  return status();
 });
 ipcMain.handle('homer:capture:ready',async(event,...args)=>{
  const scope=args[0],frame=event.senderFrame;
  const panel=args.length===2&&args[1]===true&&scope!==null;
  if(args.length!==1&&!panel||!permissionCaller(event,frame)||scope!==null&&(!scope||typeof scope!=='object'||Object.keys(scope).length!==3
   ||![scope.threadId,scope.requestId].every(id=>typeof id==='string'&&/^[\w:-]{1,100}$/.test(id))
   ||!Number.isSafeInteger(scope.epoch)||scope.epoch<0))throw Error('desktop_capture_forbidden');
  cancelDesktopCapture();
  captureSubscriber=scope?{sender:event.sender,senderFrame:frame,scope,panel}:undefined;
  return active!==undefined;
 });
}
let windowsUpdater,windowsCandidate,windowsPublishers,windowsInstall;
function requestQuit(){if(windowsRecovery())void recoverWindowsExit();else app.quit();}
const nativeUpdater=()=>windowsUpdater??autoUpdater;
const windowsRecovery=()=>!!windowsUpdater&&(closed||updateStopping)&&updateState?.status==='error';
let updateState=null,updateStopping=false,updateAcknowledged=false,updateManual=false;
const updateConfirmed=()=>updateAcknowledged&&closed&&exitCode===0&&!exitSignal;
function updateChanged(){
 refreshMenu();
 if(window&&!window.isDestroyed()){
  const frame=window.webContents.mainFrame;
  if(permissionCaller({sender:window.webContents,senderFrame:frame},frame))frame.send('homer:update:changed');
 }
}
function checkUpdate(manual=false){
 if(windowsRecovery()||!updateState||['checking','downloading','ready'].includes(updateState.status))return;
 updateManual=manual;updateState={status:'checking',noticeHidden:false};updateChanged();
 try{const checking=nativeUpdater().checkForUpdates();if(windowsUpdater)void Promise.resolve(checking).then(result=>{if(result===null){updateState={status:'idle',noticeHidden:false};updateChanged();return;}return result?.downloadPromise;}).catch(()=>{});}catch{updateCheckFailed();}
}
function updateCheckFailed(){
 if(!updateState)return;
 if(windowsUpdater&&closed&&(!updateStopping||updateConfirmed())){windowsUpdateFailed();return;}
 if(updateStopping&&allowQuit){allowQuit=false;updateFailed('update_install_unconfirmed');return;}
 if(windowsUpdater)windowsCandidate=undefined;
 updateState={...updateState,status:!windowsUpdater&&updateState.status==='ready'?'ready':'error',error:'update_check_failed'};updateChanged();
 if(updateManual)void showError('检查更新未能完成，请稍后从菜单重试。');updateManual=false;
}
async function setupDesktopUpdate(manifest,test){
 if(test||!app.isPackaged||manifest.preparation||manifest.localWorkingTree||manifest.publishable!==true||manifest.releaseChannel!=='stable'||manifest.appId!=='app.homer.desktop'||!(process.platform==='darwin'&&['arm64','x64'].includes(process.arch)||process.platform==='win32'&&process.arch==='x64')||!/^\d+\.\d+\.\d+$/.test(app.getVersion()))return;
 try{
  if(process.platform==='win32'){
   const {load}=(await import('js-yaml')).default;
   const config=load(readFileSync(join(resources,'app-update.yml'),'utf8'));
   windowsPublishers=Array.isArray(config?.publisherName)?config.publisherName:[config?.publisherName];
   if(config?.verifyUpdateCodeSignature===false||!windowsPublishers.length||windowsPublishers.some(name=>typeof name!=='string'||!/(?:^|,)\s*CN=/.test(name)||!/(?:^|,)\s*(?:O|OU|C|ST|L)=/.test(name)))return;
   if(await verifyWindowsUpdate(windowsPublishers,process.execPath))return;
   const {NsisUpdater}=(await import('electron-updater')).default;
   windowsUpdater=new NsisUpdater({provider:'generic',url:'https://super-tree.com/homer/updates/stable/win32-x64/',channel:'latest'});
   windowsUpdater.logger=null;
   Object.assign(windowsUpdater,{autoDownload:true,autoInstallOnAppQuit:false,allowPrerelease:false,allowDowngrade:false,disableDifferentialDownload:true,disableWebInstaller:true,verifyUpdateCodeSignature:verifyWindowsUpdate});
  }else{
  execFileSync('/usr/bin/codesign',['--verify','--strict','-R','anchor apple generic and identifier "app.homer.desktop" and certificate leaf[field.1.2.840.113635.100.6.1.13] exists',bundle],{stdio:'ignore',timeout:30000});
  autoUpdater.setFeedURL({url:`https://super-tree.com/homer/updates/stable/darwin-${process.arch}/RELEASES.json`,serverType:'json'});
  }
  updateState={status:'idle',noticeHidden:false};
  nativeUpdater().on('checking-for-update',()=>{if(windowsRecovery())return;updateState={status:'checking',noticeHidden:false};updateChanged();});
  nativeUpdater().on('update-available',info=>{if(windowsRecovery())return;if(windowsUpdater&&info?.files?.some(file=>file.isAdminRightsRequired===true)){updateCheckFailed();return;}updateState={status:'downloading',noticeHidden:false};updateChanged();});
  nativeUpdater().on('update-not-available',()=>{if(windowsRecovery())return;updateState={status:'idle',noticeHidden:false};updateChanged();if(updateManual)void dialog.showMessageBox(window,{type:'info',title:'荷马',message:'已是最新版本',buttons:['返回会话']});updateManual=false;});
  nativeUpdater().on('update-downloaded',(_event,_notes,version)=>{
   if(windowsUpdater){void windowsDownloaded(_event);return;}
   if(updateState?.status==='ready'&&updateState.version===version)return;
   updateManual=false;updateState={status:'ready',noticeHidden:false,...(typeof version==='string'&&/^\d+\.\d+\.\d+$/.test(version)?{version}:{error:'update_metadata_unconfirmed'})};updateChanged();if(!updateState.version)void showError('更新版本信息未确认，请核对安装包。暂存更新未被撤销。');
  });
  nativeUpdater().on('error',updateCheckFailed);
 }catch{updateState=null;}
}
async function verifyWindowsUpdate(publishers,path){
 if(!win32.isAbsolute(process.env.SystemRoot??'')||typeof path!=='string'||!win32.isAbsolute(path)||!publishers?.length)return 'update_signature_unconfirmed';
 try{
  const result=await new Promise((accept,reject)=>execFile(join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $s=Get-AuthenticodeSignature -LiteralPath $env:HOMER_UPDATE_FILE; @{valid=($s.Status -eq 'Valid');embedded=($s.SignatureType -eq 'Authenticode');subject=$s.SignerCertificate.Subject;path=$s.Path}|ConvertTo-Json -Compress"],{env:{SystemRoot:process.env.SystemRoot,HOMER_UPDATE_FILE:path},windowsHide:true,timeout:20000,maxBuffer:16384,encoding:'utf8'},(error,stdout)=>{if(error){reject(error);return;}try{accept(JSON.parse(stdout));}catch{reject(Error('update_signature_unconfirmed'));}}));
  return result.valid===true&&result.embedded===true&&publishers.includes(result.subject)&&typeof result.path==='string'&&win32.normalize(result.path).toLowerCase()===win32.normalize(path).toLowerCase()?null:'update_signature_unconfirmed';
 }catch{return 'update_signature_unconfirmed';}
}
async function windowsDownloaded(info){
 if(windowsRecovery())return;
 if(info?.isAdminRightsRequired===true||info?.files?.some(file=>file.isAdminRightsRequired===true)||typeof info?.version!=='string'||!/^\d+\.\d+\.\d+$/.test(info.version)||typeof info.downloadedFile!=='string'){updateCheckFailed();return;}
 const candidate={path:info.downloadedFile,version:info.version};windowsCandidate=candidate;
 const error=await verifyWindowsUpdate(windowsPublishers,candidate.path);
 if(windowsCandidate!==candidate||windowsRecovery())return;
 updateManual=false;updateState={...updateState,status:error?'error':'ready',version:info.version,error:error??undefined};updateChanged();
}
function windowsUpdateFailed(){
 if(windowsRecovery()&&!updateStopping)return;
 updateStopping=false;windowsCandidate=undefined;
 allowQuit=false;clearTimeout(stopTimer);quitPending=false;quitAction=undefined;switchSource=undefined;
 updateState={...updateState,status:'error',error:'update_install_unconfirmed'};updateChanged();
 void recoverWindowsExit();
}
async function recoverWindowsExit(){
 if(quitPending||!updateConfirmed())return;
 quitPending=true;quitAction=undefined;switchSource=undefined;
 const currentWindow=window,contents=currentWindow&&!currentWindow.isDestroyed()?currentWindow.webContents:undefined,navigation=permissionNavigation;
 try{
  if(contents&&!await contents.executeJavaScript("window.dispatchEvent(new Event('beforeunload',{cancelable:true}))"))return;
  if(window!==currentWindow||contents?.isDestroyed()||navigation!==permissionNavigation)return;
  const options={type:'question',title:'荷马',message:'服务已安全停止，更新未完成。请退出后重新打开荷马再试。',buttons:['取消','退出荷马'],defaultId:0,cancelId:0};
  const {response}=await(contents?dialog.showMessageBox(currentWindow,options):dialog.showMessageBox(options));
  if(response===1&&window===currentWindow&&!contents?.isDestroyed()&&navigation===permissionNavigation&&updateConfirmed()){cancelConnection();allowQuit=true;app.quit();}
 }catch{}finally{quitPending=false;}
}
function registerDesktopUpdate(){
 for(const name of ['state','dismiss','restart'])ipcMain.handle('homer:update:'+name,async(event,...args)=>{
  const frame=event.senderFrame,navigation=permissionNavigation;
  if(args.length||!permissionCaller(event,frame))throw Error('desktop_update_forbidden');
  if(name==='dismiss'&&updateState?.status==='ready'){updateState={...updateState,noticeHidden:true};updateChanged();}
  if(name==='restart'&&updateState?.status==='ready'&&updateState.version&&!quitPending){app.quit();}
  if(navigation!==permissionNavigation||!permissionCaller(event,frame))throw Error('desktop_update_forbidden');
  return updateState;
 });
}
function updateFailed(error){
 clearTimeout(stopTimer);quitPending=false;quitAction=undefined;switchSource=undefined;updateStopping=false;
 updateState={...updateState,error};updateChanged();
 if(error&&updateState.noticeHidden)void showError(error==='update_busy'?'当前工作尚未结束，请稍后重试。':closed?'服务已停止，更新尚未确认。请重新打开荷马后核对。':'重启更新未能确认，请保存未提交编辑并稍后重试。');
}
function registerDesktopPermissions(){
 const actions={
  check:()=>{
   let accessibility='unknown',screen='unknown';
   try{const trusted=systemPreferences.isTrustedAccessibilityClient(false);accessibility=trusted===true?'granted':trusted===false?'not-granted':'unknown';}catch{}
   try{const status=systemPreferences.getMediaAccessStatus('screen');if(['not-determined','denied','granted','restricted','unknown'].includes(status))screen=status;}catch{}
   return {supported:true,subject:'Homer',accessibility,screen};
  },
  'prompt-accessibility':()=>{
   try{systemPreferences.isTrustedAccessibilityClient(true);return {ok:true};}
   catch{return {ok:false,code:'prompt_failed'};}
  },
  'open-system-settings':async target=>{
   try{
    const pane=target==='screen'?'Privacy_ScreenCapture':'Privacy_Accessibility';
    await shell.openExternal('x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?'+pane);
    return {ok:true};
   }catch{} // Dispatch failed: keep the fixed app entry as a manual fallback.
   try{return await shell.openPath('/System/Applications/System Settings.app')===''?{ok:true,code:'manual_navigation'}:{ok:false,code:'open_failed'};}
   catch{return {ok:false,code:'open_failed'};}
  },
 };
 for(const [name,action]of Object.entries(actions))ipcMain.handle('homer:desktop-permissions:'+name,async(event,...args)=>{
  const frame=event.senderFrame,navigation=permissionNavigation;
  const screenTarget=name==='open-system-settings'&&args.length===1&&args[0]==='screen';
  if((args.length&&!screenTarget)||!permissionCaller(event,frame))throw Error('desktop_permissions_forbidden');
  if(process.platform!=='darwin')return {supported:false};
  const result=await action(...args);
  // Rechecking protects the response; an already issued OS action cannot be undone.
  if(navigation!==permissionNavigation||!permissionCaller(event,frame))throw Error('desktop_permissions_forbidden');
  return result;
 });
}
let channels,channelBindings,channelResult,channelReadError=false;
const channelPending=()=>channels?.snapshot().pending.length??0;
const channelStopConfirmed=()=>closed&&acknowledged&&exitCode===0&&!exitSignal;
async function channelState(refresh){
 if(refresh&&!closed&&!quitPending){
  try{
   const bindings=await nativeAccount('channel-state');
   if(!Array.isArray(bindings))throw Error('channel_status_invalid');
   channelBindings=bindings;channelReadError=false;
  }catch{channelReadError=true;}
 }
 let bindings=channelBindings,readError=channelReadError;
 if(!bindings){
  try{bindings=channels.configured();}
  catch{bindings=[];readError=true;}
 }
 if(closed&&channelResult){
  try{bindings=channels.configured();}catch{readError=true;}
 }
 return {bindings,...channels.snapshot(),readError,busy:quitPending&&quitAction==='channels',
  stopped:channelStopConfirmed(),result:channelResult};
}
function registerDesktopChannels(){
 ipcMain.handle('homer:chat-apps',async(event,action,input)=>{
  const frame=event.senderFrame,navigation=permissionNavigation;
  if(!channels||!permissionCaller(event,frame))throw Error('desktop_channels_forbidden');
  if(action==='state'){
   if(typeof input!=='boolean')throw Error('desktop_channels_arguments');
   const value=await channelState(input);
   if(navigation!==permissionNavigation||!permissionCaller(event,frame))throw Error('desktop_channels_forbidden');
   return value;
  }
  if(quitPending||updateStopping||(updateState?.status==='ready'&&!closed))throw Error('desktop_channels_busy');
  if(action==='apply'){
   if(input!==undefined||(!channelPending()&&!channelStopConfirmed())||channels.snapshot().flow||!child||closed&&!channelStopConfirmed())
    throw Error('desktop_channels_unavailable');
   quitAction='channels';
   requestQuit();
   return;
  }
  if(action==='discard'){if(input!==undefined)throw Error('desktop_channels_arguments');channels.discard();channelResult=undefined;return;}
  if(!input||typeof input!=='object')throw Error('desktop_channels_arguments');
  if(action==='cancel'){if(typeof input.id!=='string')throw Error('desktop_channels_arguments');channels.cancel(input.id);return;}
  if(action==='undo'){if(typeof input.key!=='string')throw Error('desktop_channels_arguments');channels.undo(input.channel,input.key);return;}
  if(closed)throw Error('desktop_channels_unavailable');
  if(action==='start')return channels.start(input.channel,input.target,input.token,input.credentials);
  if(action==='code')return channels.code(input.id,input.code);
  if(action==='confirm')return channels.confirm(input.id);
  if(action==='remove'&&typeof input.key==='string'){
   const label=channelBindings?.find(row=>row.adapterId===input.channel&&row.accountKey===input.key)?.label??input.key;
   return channels.remove(input.channel,input.key,label);
  }
  throw Error('desktop_channels_arguments');
 });
}

// Only the current main page may announce its settings component is mounted.
let settingsPending,settingsSubscriber;
function flushSettings(){
 if(!settingsPending||!settingsSubscriber||!permissionCaller(settingsSubscriber,settingsSubscriber.senderFrame))return;
 const args=settingsPending;
 settingsPending=undefined;
 settingsSubscriber.senderFrame.send('homer:settings:open',...args);
}
function registerDesktopSettings(){
 ipcMain.handle('homer:settings:ready',async(event,...args)=>{
  if(args.length!==1||typeof args[0]!=='boolean'||!permissionCaller(event,event.senderFrame))throw Error('desktop_settings_forbidden');
  settingsSubscriber=args[0]?{sender:event.sender,senderFrame:event.senderFrame}:undefined;
  flushSettings();
 });
 ipcMain.handle('homer:settings:version',async(event,...args)=>{
  if(args.length||!permissionCaller(event,event.senderFrame))throw Error('desktop_settings_forbidden');
  return app.getVersion();
 });
 ipcMain.handle('homer:settings:open-about-link',async(event,...args)=>{
  const [link]=args;
  if(args.length!==1||(link!=='website'&&link!=='github')||!permissionCaller(event,event.senderFrame))throw Error('desktop_settings_forbidden');
  try{await shell.openExternal(link==='website'?'https://super-tree.com/homer':'https://github.com/wolf3c/homer');}
  catch{throw Error('desktop_settings_link_unavailable');}
 });
}
function registerDesktopFeatureTour(profile){
 const marker=join(profile,'desktop-feature-tour-v1.seen');
 const actions={
  pending:async()=>{
   try{await lstat(marker);return false;}
   catch(error){if(error.code!=='ENOENT')throw error;return true;}
  },
  dismiss:async()=>{
   try{await writeFile(marker,'',{flag:'wx',mode:0o600});}
   catch(error){if(error.code!=='EEXIST')throw error;}
  },
 };
 for(const [name,action] of Object.entries(actions))ipcMain.handle('homer:feature-tour:'+name,async(event,...args)=>{
  if(args.length||!permissionCaller(event,event.senderFrame))throw Error('desktop_feature_tour_forbidden');
  try{return await action();}catch{throw Error('desktop_feature_tour_unavailable');}
 });
}
function openSettings(target){
 settingsPending=target==='permissions'?['permissions']:[];
 if(!window||window.isDestroyed()){
  createWindow();
  if(origin)void window.loadURL(origin+'/').then(()=>window.setTitle('荷马')).catch(()=>showError('页面加载未确认。请保留数据并核对本次服务。'));
 }
 if(window.isMinimized())window.restore();
 showWindow();
 flushSettings();
}
const showWindow=()=>{if(window&&!window.isDestroyed()){window.show();window.focus();}};
const startupFailed=error=>{void app.whenReady().then(async()=>{await showError('无法启动荷马（'+code(error)+'）。请保留原账号与数据，核对后重新打开。');if(!child){allowQuit=true;app.quit();}});};
function finishQuit(){
 if(allowQuit)return;
 if(!quitPending&&channelPending())return;
 if(updateStopping?!updateConfirmed():!confirmed())return;
 if(windowsUpdater&&updateStopping&&updateState?.status==='error'){windowsUpdateFailed();return;}
 if(updateState?.status==='ready'&&!updateStopping){updateFailed('update_service_stopped');return;}
 clearTimeout(stopTimer);
 if(quitPending){
  cancelConnection();
  try{
   if(quitAction==='disconnect'){disconnectHomerConnection(dailyTokenFile,accountBoundary());connection=readHomerConnection(dailyTokenFile,accountBoundary());}
   if(switchSource)saveDesktopModelSource(desktopProfile,switchSource);
   if(quitAction==='channels'){
    if(!channelStopConfirmed())throw Error('desktop_channel_stop_unconfirmed');
    try{
     const result=channels.apply();
     channelResult={saved:[...(channelResult?.saved??[]),...result.saved],failed:result.failed};
    }
    catch{channelResult={saved:channelResult?.saved??[],failed:[...new Set(channels.snapshot().pending.map(row=>row.channel))]};}
    if(channelResult.failed.length){
     quitPending=false;quitAction=undefined;
     const saved=channelResult.saved.join('、')||'无';
     void showError('连接变更未全部保存。已保存：'+saved+'。请回到「连接聊天应用」重试剩余变更。');
     return;
    }
   }
   if(quitAction&&!updateStopping)app.relaunch();
  }catch(error){if(updateStopping)updateFailed('update_service_stopped');quitPending=false;quitAction=undefined;switchSource=undefined;connectionError=accountCode(error);accountChanged();void showError('本机账号或来源设置未能保存，原设置已保留。请核对后重试。');return;}
  if(windowsUpdater&&updateStopping){
   if(windowsInstall)return;
   windowsInstall=(async()=>{const candidate=windowsCandidate;if(!candidate||await verifyWindowsUpdate(windowsPublishers,candidate.path)||candidate!==windowsCandidate||!updateConfirmed()){windowsUpdateFailed();return;}allowQuit=true;try{windowsUpdater.quitAndInstall(true,true);}catch{windowsUpdateFailed();}})().finally(()=>{windowsInstall=undefined;});return;
  }
  allowQuit=true;
  if(updateStopping){try{autoUpdater.quitAndInstall();}catch{allowQuit=false;updateFailed('update_install_unconfirmed');}}else app.quit();
 }
}
app.on('before-quit',event=>{
 cancelDesktopCapture();
 if(allowQuit||!child){cancelConnection();return;}
 event.preventDefault();
 if(windowsRecovery())return;
 if(confirmed()&&updateState?.status!=='ready'&&(!channelPending()||quitAction==='channels')){quitPending=true;finishQuit();return;}
 if(quitPending)return;
 quitPending=true;
 if(pendingConnection){cancelConnection();accountChanged();}
 showWindow();
 if(updateState?.status==='ready'){
  if(!updateState.version){updateFailed('update_metadata_unconfirmed');return;}
  const stopped=updateConfirmed();
  if(closed&&!stopped){updateFailed('update_service_stopped');return;}
  const currentWindow=window,contents=currentWindow&&!currentWindow.isDestroyed()?currentWindow.webContents:undefined,navigation=permissionNavigation;
  if(!contents&&!stopped){updateFailed('update_stop_unconfirmed');return;}
  void (async()=>{
   try{
    if(contents){
     const mayLeave=await contents.executeJavaScript("window.dispatchEvent(new Event('beforeunload',{cancelable:true}))");
     if(!mayLeave||window!==currentWindow||contents.isDestroyed()||navigation!==permissionNavigation){updateFailed('update_unsaved');return;}
    }
    const options={type:'question',title:'荷马',message:stopped?'更新尚未确认，如何继续？':'重启并更新荷马？',detail:stopped?'服务已安全停止。可重试更新，或退出后重新打开荷马；退出也可能应用已暂存更新。':'请先保存草稿及未提交编辑；仅在当前工作安全结束后重启。'+(channelPending()?' 待应用的聊天应用连接变更会丢弃。':''),buttons:stopped?['取消','重试更新','退出荷马']:['取消，继续使用','重启并更新'],defaultId:0,cancelId:0};
    const {response}=await(contents?dialog.showMessageBox(currentWindow,options):dialog.showMessageBox(options));
    if(window!==currentWindow||contents?.isDestroyed()||navigation!==permissionNavigation){updateFailed(undefined);return;}
    if(stopped&&response===2){cancelConnection();allowQuit=true;app.quit();return;}
    if(response!==1){updateFailed(undefined);return;}
    updateStopping=true;
    if(stopped){finishQuit();return;}
    updateAcknowledged=false;
    child.stdin.write('{"kind":"update-stop"}\n',error=>{if(error&&updateStopping)updateFailed('update_stop_unconfirmed');});
    stopTimer=setTimeout(()=>{if(updateStopping)updateFailed(closed?'update_service_stopped':'update_stop_unconfirmed');},20000);
   }catch{updateFailed('update_stop_unconfirmed');}
  })();
  return;
 }
 const disconnecting=quitAction==='disconnect',applyingChannels=quitAction==='channels',restarting=quitAction==='restart'||applyingChannels;
 const pendingHint=!applyingChannels&&channelPending()?' 「连接聊天应用」中待应用的变更会丢弃。':'';
 void dialog.showMessageBox(window,{type:'question',title:'荷马',message:disconnecting?'退出本机登录？':restarting?'重启荷马？':'退出荷马？',detail:(disconnecting?'将先停止当前回复和后台工作，请先保存草稿。退出仅清除本机登录凭据，保留历史对话、任务和文件；不会注销网站账号。':restarting?'将先停止当前回复和后台工作，请先保存草稿。重启后应用已保存的配置，保留历史对话、任务和文件。':'退出会停止当前回复和后台工作。请先核对并保存草稿。')+pendingHint,buttons:['取消，继续使用',disconnecting?'退出登录并重启':restarting?'重启并应用':'退出并停止工作'],defaultId:0,cancelId:0}).then(({response})=>{
  if(response!==1){quitPending=false;quitAction=undefined;switchSource=undefined;return;}
  if(updateState?.status==='ready'){quitPending=false;if(applyingChannels)quitAction=undefined;app.quit();return;}
  channels?.cancel();
  cancelConnection();
  if(confirmed()){finishQuit();return;}
  if(closed){quitPending=false;quitAction=undefined;switchSource=undefined;void showError('停止尚未确认。请保留数据并核对后台 owner；不会强制终止或自动重发。');return;}
  if(!quitSent){quitSent=true;child.stdin.write('{"kind":"quit"}\n');}
  stopTimer=setTimeout(()=>{if(confirmed())return;quitPending=false;quitAction=undefined;switchSource=undefined;void showError('停止尚未确认。请保留此窗口并核对后台进程；不会清锁或强制终止。');},20000);
 });
});
app.on('activate',()=>{if(!capturePanel)showWindow();});
app.on('second-instance',showWindow);
app.on('window-all-closed',()=>{});

async function external(raw){
 let url;try{url=new URL(raw);}catch{return;}
 if(!['https:','http:'].includes(url.protocol)||url.username||url.password)return;
 const {response}=await dialog.showMessageBox(window,{type:'question',title:'荷马',message:'在系统浏览器打开链接？',detail:url.href,buttons:['取消','打开浏览器'],defaultId:0,cancelId:0});
 if(response===1)await shell.openExternal(url.href);
}
function createWindow(){
 settingsSubscriber=undefined;
 captureSubscriber=undefined;cancelDesktopCapture();
 const nativeMac=process.platform==='darwin';
 window=new BrowserWindow({title:'荷马 · 正在启动',width:1080,height:780,minWidth:380,minHeight:420,...(nativeMac?{titleBarStyle:'hiddenInset',titleBarOverlay:true,trafficLightPosition:{x:12,y:15}}:{}),webPreferences:{preload:fileURLToPath(new URL('./preload.cjs',import.meta.url)),nodeIntegration:false,contextIsolation:true,sandbox:true,webviewTag:false,partition:'homer-desktop'}});
 if(nativeMac)window.on('resize',()=>{
  const y=window.getContentBounds().width<=800?19:15,position=window.getWindowButtonPosition();
  if(position?.x!==12||position?.y!==y)window.setWindowButtonPosition({x:12,y});
 });
 window.on('close',event=>{if(!allowQuit){event.preventDefault();if(process.platform==='win32'){if(windowsRecovery())void recoverWindowsExit();else app.quit();}else window.hide();}});
 const contents=window.webContents;
 // Main-process-only credential: never available to page JS, previews or other origins.
 contents.session.webRequest.onBeforeSendHeaders((details,callback)=>{
  const requestHeaders={...details.requestHeaders};
  for(const key of Object.keys(requestHeaders))if(key.toLowerCase()==='x-homer-desktop-access')delete requestHeaders[key];
  try{
   const target=new URL(details.url);
   if(desktopAccessToken&&owned(details.url)&&target.pathname.startsWith('/api/')
    &&(!target.search||webMediaRoute(details.method,target)?.preview)
    &&['xhr','image','media','other'].includes(details.resourceType)&&details.initiatorOrigin===origin
    &&permissionCaller({sender:details.webContents,senderFrame:details.frame},details.frame))
     requestHeaders['X-Homer-Desktop-Access']=desktopAccessToken;
  }catch{} // Missing or detached request identity fails closed.
  callback({requestHeaders});
 });
 contents.on('did-start-navigation',details=>{if(details.isMainFrame){permissionNavigation++;if(window?.webContents===contents){cancelDesktopCapture();if(!details.isSameDocument){captureSubscriber=undefined;settingsSubscriber=undefined;channels?.cancel();}}}});
 contents.setWindowOpenHandler(({url})=>{void external(url).catch(()=>showError('链接未能打开，请核对系统浏览器后重试。'));return {action:'deny'};});
 contents.on('will-navigate',event=>{if(!owned(event.url))event.preventDefault();});
 contents.on('will-redirect',event=>{if(!owned(event.url))event.preventDefault();});
 contents.on('will-frame-navigate',event=>{if(!owned(event.url)&&!['about:blank','about:srcdoc'].includes(event.url))event.preventDefault();});
 contents.on('will-attach-webview',event=>event.preventDefault());
 contents.on('render-process-gone',()=>{if(window?.webContents===contents){captureSubscriber=undefined;cancelDesktopCapture();}void showError('页面进程已退出。后台工作状态需要核对；不会自动重发消息或重启服务。');});
 const canWriteClipboard=(webContents,permission,details)=>{
  if(permission!=='clipboard-sanitized-write'||webContents!==contents
   ||!window||window.isDestroyed()||window.webContents!==contents
   ||contents.isDestroyed()||details?.isMainFrame!==true)return false;
  const current=contents.getURL(),requesting=details.requestingUrl;
  if(typeof current!=='string'||typeof requesting!=='string'||!owned(current)||!owned(requesting))return false;
  const page=new URL(current),frame=new URL(requesting);
  return page.pathname==='/'&&!page.search&&frame.pathname==='/'&&!frame.search;
 };
 contents.session.setPermissionRequestHandler((webContents,permission,callback,details)=>
  callback(canWriteClipboard(webContents,permission,details)));
 contents.session.setPermissionCheckHandler((webContents,permission,requestingOrigin,details)=>
  canWriteClipboard(webContents,permission,details)&&typeof requestingOrigin==='string'&&owned(requestingOrigin));
 contents.session.on('will-download',(event,item)=>{
  if(!item.getURLChain().every(owned)){event.preventDefault();return;}
  item.setSaveDialogOptions({title:'保存荷马成果'});
 });
 refreshMenu();
}
function refreshMenu(){
 Menu.setApplicationMenu(Menu.buildFromTemplate([
  {label:'荷马',submenu:[{role:'about'},...(updateState?[{id:'update',label:windowsRecovery()?'退出后重新打开以重试更新…':updateState.status==='ready'?'重启并更新…':updateState.status==='downloading'?'正在后台下载…':updateState.status==='checking'?'正在检查更新…':'检查更新…',enabled:!['checking','downloading'].includes(updateState.status)&&!quitPending&&!(updateState.status==='ready'&&!updateState.version),click:()=>windowsRecovery()?void recoverWindowsExit():updateState.status==='ready'?app.quit():checkUpdate(true)}]:[]),...(deepseek?[{label:'模型连接信息…',click:()=>dialog.showMessageBox(window,{type:'info',title:'荷马',message:activeConnection?'已连接网站账号':'未连接网站账号',detail:(activeConnection?['main','worker'].map(role=>(role==='main'?'主 Agent':'Worker')+'：'+activeConnection.config[role].model+' · '+activeConnection.config[role].effort+' · Fast 关闭\n入口：'+activeConnection.config[role].baseUrl).join('\n'):'请在设置 → 账号中通过网站登录并连接。')+'\nCodex：0.163.0\n连接更新后正常重启生效。实际可用性以模型回复为准。',buttons:['返回会话']})}]:[]), {type:'separator'},{label:'设置…',accelerator:'CmdOrCtrl+,',click:openSettings},{type:'separator'},{label:'关闭窗口',accelerator:'Command+W',click:()=>window.hide()},{role:'hide'},{type:'separator'},{id:'quit',label:'退出荷马',accelerator:'Command+Q',click:()=>windowsRecovery()?void recoverWindowsExit():app.quit()}]},
  {label:'编辑',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},
  {label:'显示',submenu:[{role:'zoomIn'},{role:'zoomOut'},{role:'resetZoom'},{label:'显示主窗口',accelerator:'Command+1',click:showWindow},
   ...(['darwin','win32'].includes(process.platform)?[{type:'separator'},{id:'capture-selection',label:'选取窗口或区域…',click:()=>captureDesktop(true)}]:[])]},
 ]));
}
try{
 if(!app.isPackaged||!['darwin','win32'].includes(process.platform))throw Error('desktop_packaged_macos_required');
 if(process.platform==='darwin')execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',bundle],{stdio:'ignore',timeout:30000});
 const manifest=JSON.parse(readFileSync(join(resources,'desktop-manifest.json'),'utf8'));
 const preparation=manifest.preparation&&!(manifest.localWorkingTree===true&&manifest.publishable===false);
 const args=process.argv,at=args.indexOf('--test-profile'),test=at>=0;
 accountSynthetic=test;accountOrigins=manifest.account?validateHomerOrigins(manifest.account,test):undefined;
 if(test&&(!args[at+1]||args[at+1].startsWith('--')))throw Error('desktop_test_fixture_required');
 const native=args.includes('--native'),daily=args.includes('--deepseek-daily')||!test&&!native;
 if(args.includes('--deepseek-profile')||args.includes('--deepseek')||args.filter(arg=>arg==='--deepseek-daily').length>1||args.filter(arg=>arg==='--native').length>1||native&&args.includes('--deepseek-daily'))throw Error('desktop_explicit_profile_required');
 if(preparation&&!test)throw Error('desktop_preparation_profile_required');
 const profile=test?resolve(args[at+1]):process.platform==='win32'?join(app.getPath('appData'),'Homer Desktop'):join(userInfo().homedir,'Library/Application Support/Homer Desktop');
 if(!test&&!daily&&!existsSync(join(profile,'desktop-adoption.json')))throw Error('desktop_existing_account_required');
 const paths=prepareDesktopProfile(profile,manifest,{test,initialize:daily});
 if(daily||native){dailyTokenFile=join(paths.adoption?.appData??profile,'runtime-config.json');desktopProfile=profile;modelSource=readDesktopModelSource(profile,daily?'website':'codex');}
 deepseek=daily||modelSource==='website';
 assertDesktopControlPaths({...paths,root:profile});
 const userData=join(profile,'host-home/electron');
 // The backend owns business data. Electron has only its own cache directory.
 mkdirSync(userData,{recursive:true,mode:0o700});
 app.setPath('userData',paths.codexHome);
 const ownsHome=app.requestSingleInstanceLock();
 app.setPath('userData',userData);app.setPath('sessionData',userData);
 if(!ownsHome){allowQuit=true;app.quit();}
 else{
  recoverDesktopOwner(paths.codexHome,processIdentity,leaseOwnerGone);
  // Do not top-level await readiness: Electron waits for its ESM entry to load.
  app.whenReady().then(async()=>{
  registerDesktopPermissions();
  registerDesktopSettings();
  registerDesktopFeatureTour(profile);
  registerDesktopCapture(profile);
  channels=new DesktopChannels(paths.runtime);
  registerDesktopChannels();
  registerDesktopUpdate();
  const updateReady=setupDesktopUpdate(manifest,test);
  if(process.platform!=='win32')await updateReady;
  const accountActions=registerDesktopAccount();
  app.setAboutPanelOptions({applicationName:'荷马',applicationVersion:app.getVersion(),version:String(manifest.build),copyright:'本机候选 · Electron / Node 22.22.0 / Codex 0.163.0'});
  createWindow();
  if(dailyTokenFile){try{connection=readHomerConnection(dailyTokenFile,accountBoundary());}catch(error){connection=null;connectionError=accountCode(error);}await syncHomerConfig('startup');activeConnection=connectionReady(connection)?connection:null;}
  if(daily&&modelSource==='website'&&activeConnection&&accountOrigins)void accountActions.refresh();
  const runtime=spawn(process.platform==='win32'?join(resources,'node.exe'):join(bundle,'Contents/MacOS/node'),['--disable-warning=ExperimentalWarning',join(resources,'homer/scripts/desktop-runtime.mjs'),'--profile',profile,...(test?['--test-profile']:[]),...(deepseek?['--deepseek-daily']:[])],{cwd:profile,env:{...(process.platform==='win32'?{SystemRoot:process.env.SystemRoot,LOCALAPPDATA:process.env.LOCALAPPDATA,APPDATA:app.getPath('appData'),USERPROFILE:join(profile,'host-home'),TEMP:join(profile,'tmp'),TMP:join(profile,'tmp')}:{ }),PATH:process.platform==='win32'?resources+';'+join(process.env.SystemRoot,'System32'):join(bundle,'Contents/MacOS')+':/usr/bin:/bin:/usr/sbin:/sbin',HOME:join(profile,'host-home'),TMPDIR:join(profile,'tmp'),LANG:'zh_CN.UTF-8'},stdio:['pipe','pipe','ignore',...(deepseek?['pipe']:[])]});
  if(deepseek){runtime.stdio[3].on('error',()=>{});runtime.stdio[3].end(JSON.stringify(activeConnection));}
  child=runtime;let buffer='';
  runtime.stdin.on('error',()=>{});
  runtime.stdout.on('data',bytes=>{
   buffer+=bytes;
   if(Buffer.byteLength(buffer)>65536){void showError('启动通道无效。请保留数据并核对应用完整性。');buffer='';return;}
   let at;while((at=buffer.indexOf('\n'))>=0){
    const line=buffer.slice(0,at);buffer=buffer.slice(at+1);let value;try{value=JSON.parse(line);}catch{continue;}
    if(value.kind==='native_account_result'){
     const pending=nativeRequests.get(value.id);if(pending){clearTimeout(pending.timer);nativeRequests.delete(value.id);value.error?pending.reject(Error('native_account_unconfirmed')):pending.resolve(value.value);}
    }
    else if(value.kind==='account_config_check'){if(modelSource==='website')void syncHomerConfig('message');}
    else if(value.kind==='account_usage_dirty'){walletRevision++;walletDirty=true;accountChanged();}
    else if(value.kind==='update-busy'&&updateStopping)updateFailed('update_busy');
    else if(value.kind==='update-stopped'&&updateStopping){updateAcknowledged=true;finishQuit();}
    else if(value.kind==='stopped'){acknowledged=true;finishQuit();}
    else if(value.kind==='startup_refused'&&!origin)startupRefused=true;
    else if(value.kind==='url'&&!origin){
     let url;try{url=new URL(value.url);}catch{continue;}
     if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||url.username||url.password||url.search||url.hash||url.pathname!=='/')continue;
     if(typeof value.desktopAccessToken!=='string'||!/^[a-f0-9]{64}$/.test(value.desktopAccessToken)){
      void showError('桌面服务认证信息无效。请保留数据并核对应用完整性。');continue;
     }
     desktopAccessToken=value.desktopAccessToken;
     origin=url.origin;if(process.platform==='win32')void updateReady.then(()=>{if(!closed)checkUpdate();});else checkUpdate();void window.loadURL(value.url).then(()=>window.setTitle(deepseek?'荷马 · DeepSeek':'荷马')).catch(()=>showError('页面加载未确认。请保留数据并核对本次服务。'));
    }else if(value.kind==='error')void showError('无法启动荷马（'+code({message:value.code})+'）。请保留原账号和数据，核对后重新打开。');
   }
  });
  runtime.on('error',error=>{if(!runtime.pid)child=undefined;void showError('无法启动随包服务（'+code(error)+'）。');});
  runtime.on('close',(status,signal)=>{
   for(const pending of nativeRequests.values()){clearTimeout(pending.timer);pending.reject(Error('native_account_unconfirmed'));}nativeRequests.clear();
   desktopAccessToken=undefined;
   closed=true;exitCode=status;exitSignal=signal;
   cancelDesktopCapture();
   if(windowsUpdater&&updateStopping&&status===0&&!signal&&!updateAcknowledged)return;
   if(updateStopping?updateConfirmed():confirmed())finishQuit();
   else if(updateState?.status==='ready'){updateFailed('update_service_stopped');}
   else{clearTimeout(stopTimer);quitPending=false;quitAction=undefined;switchSource=undefined;void showError('停止尚未确认。请保留数据并核对后台 owner；不会自动重发请求。');}
  });
  }).catch(startupFailed);
 }
}catch(error){startupFailed(error);}
