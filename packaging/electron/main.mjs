import {app,BrowserWindow,Menu,dialog,shell,ipcMain,systemPreferences} from 'electron';
import {readFileSync,existsSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {userInfo} from 'node:os';
import {execFileSync,spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
// This entry is copied to Resources/app.asar/main.mjs by Forge.
import {prepareDesktopProfile,assertDesktopControlPaths,readDesktopModelSource,saveDesktopModelSource} from '../homer/scripts/desktop-profile.mjs';
import {assertDeepSeekProfile,prepareDeepSeekProfile,promptDeepSeekToken} from '../homer/scripts/desktop-deepseek.mjs';

import {validateHomerOrigins,readHomerConnection,authorizeHomerConnection,disconnectHomerConnection,queryHomerWallet,queryHomerRuntimeConfig,saveHomerRuntimeConfig} from '../homer/dist/homer-account.js';

const resources=process.resourcesPath,bundle=resolve(resources,'../..');
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
const connectionKind=value=>value?.token?(value.subject?'website':'legacy'):'disconnected';
const connectionReady=value=>!!value?.token&&(!value.subject||!!value.config);
const accountCode=error=>['INVALID_REQUEST','UNAUTHORIZED','FORBIDDEN','ACCOUNT_UNAVAILABLE','CONFLICT','RATE_LIMITED','UNAVAILABLE','ACCOUNT_MISMATCH','CONNECTION_FILE_INVALID','CONNECTION_WRITE_FAILED','CONNECTION_CANCELLED','TOKEN_UNAVAILABLE','USAGE_UNAVAILABLE','NOT_CONNECTED'].includes(error?.message)?error.message:'UNAVAILABLE';
const accountState=()=>({supported:!!dailyTokenFile,configured:!!accountOrigins,source:modelSource,websiteReady:connectionReady(connection),native:nativeStatus?{account:nativeStatus.account,connected:nativeStatus.connected,phase:nativeStatus.phase,pending:!!nativeStatus.loginId,canReopen:!!nativeStatus.authUrl}:undefined,nativeError,connection:connectionKind(connection),active:connectionKind(activeConnection),pending:!!pendingConnection,canReopen:!!pendingConnection&&!!pendingLoginUrl,needsRestart:modelSource==='website'&&connectionReady(connection)&&JSON.stringify(connection)!==JSON.stringify(activeConnection),error:connectionError,...(wallet?{wallet,updatedAt:walletUpdatedAt}:{}),walletError,stale:walletDirty});
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
  applyCodex:async()=>{await readNativeAccount();if(nativeStatus?.connected&&!quitPending){switchSource='codex';quitAction='restart';app.quit();}return accountState();},
  applyWebsite:()=>{if(connectionReady(connection)&&!quitPending){switchSource='website';quitAction='restart';app.quit();}return accountState();},
  connect:()=>{
   if(quitPending)return accountState();
   cancelConnection();connectionError=undefined;
   if(!accountOrigins){connectionError='CONFIGURATION_REQUIRED';return accountState();}
   const operation=new AbortController();pendingConnection=operation;
   void authorizeHomerConnection({...accountOrigins,allowSyntheticLoopback:accountSynthetic,file:dailyTokenFile,signal:operation.signal,openBrowser:url=>{if(pendingConnection!==operation||operation.signal.aborted)return Promise.resolve();pendingLoginUrl=url;accountChanged();return shell.openExternal(url);},onCallback:()=>{if(pendingConnection===operation){pendingLoginUrl=undefined;accountChanged();}}}).then(value=>{
    if(pendingConnection!==operation||operation.signal.aborted)return;
    connection=value;lastConfigCheck=performance.now();
   }).catch(error=>{if(pendingConnection===operation&&!operation.signal.aborted)connectionError=accountCode(error);})
   .finally(()=>{if(pendingConnection===operation){pendingConnection=undefined;pendingLoginUrl=undefined;accountChanged();}});
   return accountState();
  },
  cancel:()=>{cancelConnection();accountChanged();return accountState();},
  reopen:async()=>{if(pendingConnection&&!pendingConnection.signal.aborted&&pendingLoginUrl)await shell.openExternal(pendingLoginUrl);return accountState();},
  refresh:async()=>{
   if(walletRead)return walletRead;
   const credentials=modelSource==='codex'?connection:activeConnection;
   if(!accountOrigins||!credentials?.token){walletError=accountOrigins?'NOT_CONNECTED':'CONFIGURATION_REQUIRED';return accountState();}
   const revision=accountRevision;
   walletRead=(async()=>{
    try{do{
     const observed=walletRevision,value=await queryHomerWallet(credentials,accountBoundary());
     if(revision!==accountRevision)break;
     if(observed!==walletRevision)continue;
     wallet=value;walletUpdatedAt=new Date().toISOString();walletError=undefined;walletDirty=false;break;
    }while(true);}
    catch(error){if(revision===accountRevision){walletError=accountCode(error);walletDirty=true;}}
    finally{walletRead=undefined;}
    return accountState();
   })();
   return walletRead;
  },
  openWebsite:async()=>{if(!accountOrigins)return {...accountState(),error:'CONFIGURATION_REQUIRED'};await shell.openExternal(accountOrigins.websiteOrigin+'/homer');return accountState();},
  disconnect:()=>{if(!quitPending){quitAction='disconnect';app.quit();}return accountState();},
  restart:()=>{if(!quitPending){quitAction='restart';app.quit();}return accountState();},
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
const tokenPrompt=new AbortController();
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
// Only the current main page may announce its settings component is mounted.
let settingsPending=false,settingsSubscriber;
function flushSettings(){
 if(!settingsPending||!settingsSubscriber||!permissionCaller(settingsSubscriber,settingsSubscriber.senderFrame))return;
 settingsPending=false;
 settingsSubscriber.senderFrame.send('homer:settings:open');
}
function registerDesktopSettings(){
 ipcMain.handle('homer:settings:ready',async(event,...args)=>{
  if(args.length!==1||typeof args[0]!=='boolean'||!permissionCaller(event,event.senderFrame))throw Error('desktop_settings_forbidden');
  settingsSubscriber=args[0]?{sender:event.sender,senderFrame:event.senderFrame}:undefined;
  flushSettings();
 });
}
function openSettings(){
 settingsPending=true;
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
 if(!confirmed())return;
 clearTimeout(stopTimer);
 if(quitPending){
  cancelConnection();
  try{
   if(quitAction==='disconnect'){disconnectHomerConnection(dailyTokenFile,accountBoundary());connection=readHomerConnection(dailyTokenFile,accountBoundary());}
   if(switchSource)saveDesktopModelSource(desktopProfile,switchSource);
   if(quitAction)app.relaunch();
  }catch(error){quitPending=false;quitAction=undefined;switchSource=undefined;connectionError=accountCode(error);accountChanged();void showError('本机账号或来源设置未能保存，原设置已保留。请核对后重试。');return;}
  allowQuit=true;app.quit();
 }
}
app.on('before-quit',event=>{
 if(allowQuit||!child){tokenPrompt.abort();cancelConnection();return;}
 event.preventDefault();
 if(confirmed()){quitPending=true;finishQuit();return;}
 if(quitPending)return;
 quitPending=true;
 showWindow();
 const disconnecting=quitAction==='disconnect',restarting=quitAction==='restart';
 void dialog.showMessageBox(window,{type:'question',title:'荷马',message:disconnecting?'退出本机登录？':restarting?'重启荷马？':'退出荷马？',detail:disconnecting?'将先停止当前回复和后台工作，请先保存草稿。退出仅清除本机登录凭据，保留历史对话、任务和文件；不会注销网站账号。':restarting?'将先停止当前回复和后台工作，请先保存草稿。重启后应用已保存的配置，保留历史对话、任务和文件。':'退出会停止当前回复和后台工作。请先核对并保存草稿。',buttons:['取消，继续使用',disconnecting?'退出登录并重启':restarting?'重启并应用':'退出并停止工作'],defaultId:0,cancelId:0}).then(({response})=>{
  if(response!==1){quitPending=false;quitAction=undefined;switchSource=undefined;return;}
  cancelConnection();
  if(confirmed()){finishQuit();return;}
  if(closed){quitPending=false;quitAction=undefined;switchSource=undefined;void showError('停止尚未确认。请保留数据并核对后台 owner；不会强制终止或自动重发。');return;}
  if(!quitSent){quitSent=true;child.stdin.write('{"kind":"quit"}\n');}
  stopTimer=setTimeout(()=>{if(confirmed())return;quitPending=false;quitAction=undefined;switchSource=undefined;void showError('停止尚未确认。请保留此窗口并核对后台进程；不会清锁或强制终止。');},20000);
 });
});
app.on('activate',showWindow);
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
 const nativeMac=process.platform==='darwin';
 window=new BrowserWindow({title:'荷马 · 正在启动',width:1080,height:780,minWidth:380,minHeight:420,...(nativeMac?{titleBarStyle:'hiddenInset',titleBarOverlay:true,trafficLightPosition:{x:12,y:15}}:{}),webPreferences:{preload:fileURLToPath(new URL('./preload.cjs',import.meta.url)),nodeIntegration:false,contextIsolation:true,sandbox:true,webviewTag:false,partition:'homer-desktop'}});
 if(nativeMac)window.on('resize',()=>{
  const y=window.getContentBounds().width<=800?19:15,position=window.getWindowButtonPosition();
  if(position?.x!==12||position?.y!==y)window.setWindowButtonPosition({x:12,y});
 });
 window.on('close',event=>{if(!allowQuit){event.preventDefault();window.hide();}});
 const contents=window.webContents;
 // Main-process-only credential: never available to page JS, previews or other origins.
 contents.session.webRequest.onBeforeSendHeaders((details,callback)=>{
  const requestHeaders={...details.requestHeaders};
  for(const key of Object.keys(requestHeaders))if(key.toLowerCase()==='x-homer-desktop-access')delete requestHeaders[key];
  try{
   const target=new URL(details.url);
   if(desktopAccessToken&&owned(details.url)&&!target.search&&target.pathname.startsWith('/api/')
    &&['xhr','image','media','other'].includes(details.resourceType)&&details.initiatorOrigin===origin
    &&permissionCaller({sender:details.webContents,senderFrame:details.frame},details.frame))
     requestHeaders['X-Homer-Desktop-Access']=desktopAccessToken;
  }catch{} // Missing or detached request identity fails closed.
  callback({requestHeaders});
 });
 contents.on('did-start-navigation',details=>{if(details.isMainFrame){permissionNavigation++;if(!details.isSameDocument&&window?.webContents===contents)settingsSubscriber=undefined;}});
 contents.setWindowOpenHandler(({url})=>{void external(url).catch(()=>showError('链接未能打开，请核对系统浏览器后重试。'));return {action:'deny'};});
 contents.on('will-navigate',event=>{if(!owned(event.url))event.preventDefault();});
 contents.on('will-redirect',event=>{if(!owned(event.url))event.preventDefault();});
 contents.on('will-frame-navigate',event=>{if(!owned(event.url)&&!['about:blank','about:srcdoc'].includes(event.url))event.preventDefault();});
 contents.on('will-attach-webview',event=>event.preventDefault());
 contents.on('render-process-gone',()=>{void showError('页面进程已退出。后台工作状态需要核对；不会自动重发消息或重启服务。');});
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
 Menu.setApplicationMenu(Menu.buildFromTemplate([
  {label:'荷马',submenu:[{role:'about'},...(deepseek?[{label:dailyTokenFile?'模型连接信息…':'DeepSeek 连接信息…',click:()=>dialog.showMessageBox(window,{type:'info',title:'荷马 · DeepSeek',message:dailyTokenFile?(activeConnection?.config?'已连接网站账号':activeConnection?.token?'已连接（原凭据）':'未连接网站账号'):'主 Agent / Worker：deepseek-flash',detail:(activeConnection?.config?['main','worker'].map(role=>(role==='main'?'主 Agent':'Worker')+'：'+activeConnection.config[role].model+' · '+activeConnection.config[role].effort+' · Fast 关闭\n入口：'+activeConnection.config[role].baseUrl).join('\n'):dailyTokenFile?'':'effort：max · Fast：关闭\n入口：https://models.super-tree.com/v1')+'\nCodex：0.163.0\n'+(dailyTokenFile?(activeConnection?.token&&!activeConnection.subject?'沿用原凭据：Main / Worker · deepseek-flash · high · Fast 关闭。\n':'请在设置 → 账号中通过网站登录并连接。\n连接更新后正常重启生效。'):'Token 仅用于本次进程，退出后需要重新输入。')+'实际可用性以模型回复为准。',buttons:['返回会话']})}]:[]), {type:'separator'},{label:'设置…',accelerator:'CmdOrCtrl+,',click:openSettings},{type:'separator'},{label:'关闭窗口',accelerator:'Command+W',click:()=>window.hide()},{role:'hide'},{type:'separator'},{id:'quit',label:'退出荷马',accelerator:'Command+Q',click:()=>app.quit()}]},
  {label:'编辑',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},
  {label:'显示',submenu:[{role:'zoomIn'},{role:'zoomOut'},{role:'resetZoom'},{label:'显示主窗口',accelerator:'Command+1',click:showWindow}]},
 ]));
}
try{
 if(!app.isPackaged||process.platform!=='darwin')throw Error('desktop_packaged_macos_required');
 execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',bundle],{stdio:'ignore',timeout:30000});
 const manifest=JSON.parse(readFileSync(join(resources,'desktop-manifest.json'),'utf8'));
 const preparation=manifest.preparation&&!(manifest.localWorkingTree===true&&manifest.publishable===false);
 const args=process.argv,at=args.indexOf('--test-profile'),test=at>=0;
 accountSynthetic=test;accountOrigins=manifest.account?validateHomerOrigins(manifest.account,test):undefined;
 if(test&&(!args[at+1]||args[at+1].startsWith('--')))throw Error('desktop_test_fixture_required');
 const deepseekAt=args.indexOf('--deepseek-profile'),native=args.includes('--native'),daily=args.includes('--deepseek-daily')||!test&&!native&&deepseekAt<0;deepseek=daily||deepseekAt>=0||test&&args.includes('--deepseek');
 if(args.filter(arg=>arg==='--deepseek-daily').length>1||args.filter(arg=>arg==='--native').length>1||native&&(args.includes('--deepseek-daily')||deepseekAt>=0||args.includes('--deepseek'))||daily&&deepseekAt>=0||daily&&args.includes('--deepseek'))throw Error('deepseek_profile_invalid');
 if(deepseekAt>=0&&(test||!args[deepseekAt+1]||args[deepseekAt+1].startsWith('--')))throw Error('deepseek_profile_invalid');
 if(preparation&&daily&&!test)throw Error('desktop_preparation_profile_required');
 if(preparation&&!test&&!deepseek)throw Error('desktop_preparation_profile_required');
 const profile=deepseekAt>=0?resolve(args[deepseekAt+1]):test?resolve(args[at+1]):join(userInfo().homedir,'Library/Application Support/Homer Desktop');
 if(deepseek&&!daily)assertDeepSeekProfile(profile);
 if(!test&&!deepseek&&!existsSync(join(profile,'desktop-adoption.json')))throw Error('desktop_existing_account_required');
 const paths=deepseek&&!daily?prepareDeepSeekProfile(profile,manifest,{test}):prepareDesktopProfile(profile,manifest,{test,initialize:daily});
 if(daily||native){dailyTokenFile=join(paths.adoption?.appData??profile,'runtime-config.json');desktopProfile=profile;modelSource=readDesktopModelSource(profile,daily?'website':'codex');deepseek=daily||modelSource==='website';}
 assertDesktopControlPaths({...paths,root:profile});
 const userData=join(profile,'host-home/electron');
 // The backend owns business data. Electron has only its own cache directory.
 mkdirSync(userData,{recursive:true,mode:0o700});
 app.setPath('userData',userData);app.setPath('sessionData',userData);
 if(!app.requestSingleInstanceLock()){allowQuit=true;app.quit();}
 else{
  // Do not top-level await readiness: Electron waits for its ESM entry to load.
  app.whenReady().then(async()=>{
  registerDesktopPermissions();
  registerDesktopSettings();
  const accountActions=registerDesktopAccount();
  app.setAboutPanelOptions({applicationName:'荷马',applicationVersion:app.getVersion(),version:String(manifest.build),copyright:'本机候选 · Electron / Node 22.22.0 / Codex 0.163.0'});
  createWindow();
  let token;
  if(dailyTokenFile){try{connection=readHomerConnection(dailyTokenFile,accountBoundary());}catch(error){connection=null;connectionError=accountCode(error);}await syncHomerConfig('startup');activeConnection=modelSource==='website'&&connectionReady(connection)?connection:null;}
  if(deepseek){
   // Test profiles always select the offline protocol fixture in the runtime.
   try{
    if(dailyTokenFile)token=JSON.stringify(modelSource==='website'?activeConnection:null);
    else token=test?'synthetic-desktop-deepseek':await promptDeepSeekToken({signal:tokenPrompt.signal});
   }
   catch(error){if(error.message!=='deepseek_token_input_cancelled')await showError(daily?'网站连接未能读取，请在设置 → 账号中重新连接。':'Token 输入无效，未启动模型连接。请重新打开荷马。');allowQuit=true;app.quit();return;}
   if(tokenPrompt.signal.aborted)return;
  }
  if(daily&&activeConnection?.token&&accountOrigins)void accountActions.refresh();
  const runtime=spawn(join(bundle,'Contents/MacOS/node'),['--disable-warning=ExperimentalWarning',join(resources,'homer/scripts/desktop-runtime.mjs'),'--profile',profile,...(test?['--test-profile']:[]),...(daily||native&&modelSource==='website'?['--deepseek-daily']:deepseek?['--deepseek']:[])],{cwd:profile,env:{PATH:join(bundle,'Contents/MacOS')+':/usr/bin:/bin:/usr/sbin:/sbin',HOME:join(profile,'host-home'),TMPDIR:join(profile,'tmp'),LANG:'zh_CN.UTF-8'},stdio:['pipe','pipe','ignore',...(deepseek?['pipe']:[])]});
  if(deepseek){runtime.stdio[3].on('error',()=>{});runtime.stdio[3].end(token);token=undefined;}
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
    else if(value.kind==='stopped'){acknowledged=true;finishQuit();}
    else if(value.kind==='startup_refused'&&!origin)startupRefused=true;
    else if(value.kind==='url'&&!origin){
     let url;try{url=new URL(value.url);}catch{continue;}
     if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||url.username||url.password||url.search||url.hash||url.pathname!=='/')continue;
     if(typeof value.desktopAccessToken!=='string'||!/^[a-f0-9]{64}$/.test(value.desktopAccessToken)){
      void showError('桌面服务认证信息无效。请保留数据并核对应用完整性。');continue;
     }
     desktopAccessToken=value.desktopAccessToken;
     origin=url.origin;void window.loadURL(value.url).then(()=>window.setTitle(deepseek?'荷马 · DeepSeek':'荷马')).catch(()=>showError('页面加载未确认。请保留数据并核对本次服务。'));
    }else if(value.kind==='error')void showError('无法启动荷马（'+code({message:value.code})+'）。请保留原账号和数据，核对后重新打开。');
   }
  });
  runtime.on('error',error=>{if(!runtime.pid)child=undefined;void showError('无法启动随包服务（'+code(error)+'）。');});
  runtime.on('close',(status,signal)=>{
   for(const pending of nativeRequests.values()){clearTimeout(pending.timer);pending.reject(Error('native_account_unconfirmed'));}nativeRequests.clear();
   desktopAccessToken=undefined;
   closed=true;exitCode=status;exitSignal=signal;
   if(confirmed())finishQuit();
   else{clearTimeout(stopTimer);quitPending=false;quitAction=undefined;switchSource=undefined;void showError('停止尚未确认。请保留数据并核对后台 owner；不会自动重发请求。');}
  });
  }).catch(startupFailed);
 }
}catch(error){startupFailed(error);}
