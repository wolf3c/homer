import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import * as filesystem from 'node:fs';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,realpathSync,rmSync,statSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createServer} from 'node:http';
import {transpileModule,ModuleKind,ScriptTarget} from 'typescript';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';

const installerBytes=Buffer.from('synthetic Windows installer');
function windowsUpdate(info){return {files:[{url:'https://github.com/wolf3c/homer/releases/download/v'+info.version+'/Homer-windows-x64.exe',sha512:createHash('sha512').update(installerBytes).digest('base64'),size:installerBytes.length}],...info};}

// Link the real entry to OS fixtures. No test switches or probes in the app.
const defaultSelection={main:{model:'gpt-6.1-terra',effort:'medium'},worker:{model:'gpt-6.1-terra',effort:'high'}};
const channelLifecycleCall=call=>call.length===3&&call[0]==='native-account'&&call[1]==='channel-manage'&&
 call[2]?.action==='cancel'&&Object.keys(call[2]).sort().join(',')==='action,input'&&
 call[2].input&&typeof call[2].input==='object'&&!Array.isArray(call[2].input)&&Object.keys(call[2].input).length===0;
async function fixture(args=['Homer','--test-profile','/synthetic/profile'],openExternal=async()=>{},platform='darwin',native={}){
 let monotonic=0;
 const handlers=new Map(),windows=[],messages=[],sent=[],toasts=[],nativeCalls=[],ownershipCalls=[],launches=[],credentials=[],tokenFiles=[];let spawnCount=0;
 const app=new EventEmitter(),paths=new Map();let ownsLock=false;
 Object.assign(app,{isPackaged:true,whenReady:async()=>{},setAppUserModelId(){},setPath(name,path){paths.set(name,path);ownershipCalls.push(['set-path',name,path]);},getPath:()=>'/synthetic',requestSingleInstanceLock(){const key=paths.get('userData');ownershipCalls.push(['single-instance',key]);if(native.lockAvailable===false||native.locks?.has(key))return false;native.locks?.add(key);ownsLock=true;return true;},hasSingleInstanceLock:()=>ownsLock,getVersion:()=> '0.1.0',relaunch(){nativeCalls.push(['relaunch']);},quit(){const e={preventDefault(){this.prevented=true;}};app.emit('before-quit',e);if(!e.prevented)app.emit('quit');},setAboutPanelOptions(){}});
 const session={webRequest:{onBeforeSendHeaders:(...args)=>handlers.set('desktop-request',args.at(-1))},setPermissionRequestHandler:cb=>handlers.set('permission-request',cb),setPermissionCheckHandler:cb=>handlers.set('permission-check',cb),setDisplayMediaRequestHandler:cb=>handlers.set('display-media-request',cb),on:(name,cb)=>handlers.set(name,cb)};
 const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();child.stdin.on('data',value=>{
  const message=JSON.parse(String(value));
  if(message.kind==='native_account'){
   nativeCalls.push(['native-account',message.action,...(message.input===undefined?[]:[message.input])]);
   void Promise.resolve().then(()=>native.nativeAction?native.nativeAction(message.action,message.input):native.nativeState??{account:'none',connected:false,phase:'idle'}).then(value=>child.stdout.write(JSON.stringify({kind:'native_account_result',id:message.id,value})+'\n'),error=>child.stdout.write(JSON.stringify({kind:'native_account_result',id:message.id,error:error?.message??'native_account_unconfirmed'})+'\n'));
  }else sent.push(String(value));
 });child.exitCode=null;child.signalCode=null;
 child.stdio=[child.stdin,child.stdout,child.stderr,new PassThrough()];child.stdio[3].on('data',value=>credentials.push(String(value)));
 class BrowserWindow extends EventEmitter{
  constructor(options){super();this.options=options;this.hidden=options.show===false;this.webContents=new EventEmitter();this.webContents.session=session;this.settingsMessages=[];this.webContents.executeJavaScript=async()=>{if(this.contentsDestroyed)throw Error('Object has been destroyed');return native.unsaved!==true;};this.webContents.getURL=()=>this.url??'about:blank';this.webContents.isDestroyed=()=>this.contentsDestroyed??false;this.webContents.setWindowOpenHandler=cb=>handlers.set('window-open',cb);windows.push(this);}
  async loadURL(url){this.webContents.emit('did-start-navigation',{url,isSameDocument:false,isMainFrame:true});this.url=url;this.webContents.mainFrame={url,origin:new URL(url).origin,detached:false,isDestroyed:()=>false,send:(...args)=>this.settingsMessages.push(args)};}isMinimized(){return this.minimized??false;}restore(){this.minimized=false;}show(){this.hidden=false;}hide(){this.hidden=true;}focus(){this.focused=true;}isDestroyed(){return this.destroyed??false;}setTitle(value){this.title=value;}
  async loadFile(path){await this.loadURL(pathToFileURL(path).href);this.emit('ready-to-show');}
  showInactive(){this.show();}
  isVisible(){return !this.hidden&&!this.isDestroyed();}
  isFocused(){return this.focused===true;}
  getMediaSourceId(){return 'window:999:1';}
  destroy(){this.close();}
  setBounds(bounds){this.bounds=bounds;}
  getContentBounds(){return {width:this.contentWidth??this.options.width};}
  getWindowButtonPosition(){return this.buttonPosition??this.options.trafficLightPosition;}
  setWindowButtonPosition(value){this.buttonPosition=value;this.buttonMoves=(this.buttonMoves??0)+1;}
  close(){const event={preventDefault(){this.prevented=true;}};this.emit('close',event);if(event.prevented)return;this.destroyed=true;this.contentsDestroyed=true;this.emit('closed');if(windows.every(w=>w.isDestroyed()))app.emit('window-all-closed');}
 }
 const updater=new EventEmitter();Object.assign(updater,{setFeedURL:value=>nativeCalls.push(['feed',value]),checkForUpdates:()=>{nativeCalls.push(['check-update']);if(native.checkError)throw Error('private_network_detail');},quitAndInstall:()=>{nativeCalls.push(['install-update']);if(native.installError)throw Error('private_install_detail');app.quit();}});
 const display={id:7,scaleFactor:2,bounds:{x:0,y:0,width:1200,height:800},workArea:{x:0,y:24,width:1200,height:760}};
 class Notification extends EventEmitter{
  static isSupported(){return true;}
  constructor(options){super();this.options=options;}
  show(){toasts.push(this);}
 }
 const electron={Notification,autoUpdater:updater,app,BrowserWindow,screen:{getCursorScreenPoint:()=>({x:640,y:420}),getDisplayMatching:()=>display,getDisplayNearestPoint:()=>display},globalShortcut:{
  register(key,callback){if((typeof native.shortcutConflict==='function'?native.shortcutConflict(key):native.shortcutConflict)||handlers.has('shortcut:'+key))return false;handlers.set('shortcut:'+key,callback);return true;},
  unregister:key=>handlers.delete('shortcut:'+key),
 },ipcMain:{handle:(name,cb)=>{assert.equal(handlers.has(name),false);handlers.set(name,cb);}},systemPreferences:{isTrustedAccessibilityClient:prompt=>{nativeCalls.push(['ax',prompt]);return native.ax?native.ax(prompt):false;},getMediaAccessStatus:kind=>{nativeCalls.push(['screen',kind]);return native.screen?native.screen(kind):'not-determined';}},Menu:{buildFromTemplate:value=>value,setApplicationMenu:value=>handlers.set('menu',value)},dialog:{showMessageBox:async(_window,options)=>{const o=options??_window;messages.push({...o,parent:options?_window:undefined});return {response:typeof native.response==='function'?await native.response(o):native.response??1};}},shell:{openExternal:url=>{nativeCalls.push(['external',url]);return native.external?native.external(url):openExternal(url);},openPath:path=>{nativeCalls.push(['open',path]);return native.open?native.open(path):Promise.resolve('');}}};
 electron.desktopCapturer={getSources:async options=>{nativeCalls.push(['capture-sources',options]);return native.captureSources?.(options)??[];}};
 const fs={readFileSync:path=>Buffer.from(JSON.stringify(String(path).endsWith('app-update.yml')?{publisherName:native.publisher??['CN=Homer, O=Homer, C=CN'],...native.updateConfig}:({format:2,preparation:!native.published,localWorkingTree:native.localWorkingTree,publishable:native.publishable,version:'0.1.0',build:5,account:{websiteOrigin:'https://website.example.invalid',gatewayOrigin:'https://models.super-tree.com'},...native.manifest}))),existsSync:()=>true,mkdirSync(){},realpathSync:value=>value};
 const readUpdateConfig=fs.readFileSync;
 fs.readFileSync=path=>{if(String(path).endsWith('app-update.yml')&&native.missingUpdateConfig)throw Object.assign(Error('private_update_config'),{code:'ENOENT'});return readUpdateConfig(path);};
 fs.createReadStream=path=>{
  if(platform!=='win32'||!String(path).endsWith('.exe'))return filesystem.createReadStream(path);
  nativeCalls.push(['read-update',path]);const stream=new PassThrough(),body=native.fileData??installerBytes;
  const finish=()=>native.fileError?stream.destroy(Error('private_update_read_error')):stream.end(body);
  if(native.holdHash)native.releaseHash=finish;else queueMicrotask(finish);return stream;
 };
 const cp={execFile:(bin,args,options,done)=>{if(bin.endsWith('/homer-window-capture')){const process=new EventEmitter();native.capture?.(bin,args,options,(...result)=>{done(...result);process.emit('close');});return process;}nativeCalls.push(['verify',bin,args]);const finish=()=>done(native.verifyError&&!options.env.HOMER_UPDATE_FILE.endsWith('Homer.exe')?Error('private_verify'):null,native.verifyOutput&&!options.env.HOMER_UPDATE_FILE.endsWith('Homer.exe')?native.verifyOutput:JSON.stringify({valid:options.env.HOMER_UPDATE_FILE.endsWith('Homer.exe')||!native.invalidSignature,subject:options.env.HOMER_UPDATE_FILE.endsWith('Homer.exe')?'CN=Homer, O=Homer, C=CN':native.signer??'CN=Homer, O=Homer, C=CN',path:options.env.HOMER_UPDATE_FILE,embedded:true}));if(native.holdVerify)native.releaseVerify=finish;else queueMicrotask(finish);},execFileSync:(_bin,args)=>{if(args.includes('-R')&&native.untrustedSigner)throw Error('signer');return Buffer.alloc(0);},spawn(bin,args,options){spawnCount++;launches.push({bin,args,options});return child;}};
 let stored=Object.hasOwn(native,'connection')?native.connection:{token:'synthetic-file-token',subject:'fixture_user'};
 const account={queryHomerMemberSelection:async options=>{nativeCalls.push(['config']);return native.config?native.config(options):defaultSelection;},readHomerConnection:path=>{tokenFiles.push(path);if(native.invalidTokenFile)throw Error('CONNECTION_FILE_INVALID');return stored;},validateHomerOrigins:v=>v,authorizeHomerConnection:async options=>{const value=native.authorize?await native.authorize(options):{token:'synthetic-website-token',subject:'fixture_user',selection:defaultSelection};if(!options.signal.aborted)stored={token:value.token,subject:value.subject};return value;},disconnectHomerConnection:()=>{nativeCalls.push(['disconnect']);if(native.disconnectError)throw Error('CONNECTION_WRITE_FAILED');stored=stored?.subject?{subject:stored.subject}:null;},queryHomerWallet:async()=>{nativeCalls.push(['wallet']);return native.wallet?native.wallet():{available:5,used:2,unit:'原生额度'};}};
 class NsisUpdater extends EventEmitter{constructor(options){super();nativeCalls.push(['nsis',options]);this.on('error',()=>{if(this.logger!==null)console.error('private_library_log');});}checkForUpdates(){nativeCalls.push(['check-update',this.logger]);if(native.checkReject){this.emit('error',Error('private_check'));return Promise.reject(Error('private_check'));}return Promise.resolve(native.nullCheck?null:{downloadPromise:native.downloadReject?Promise.resolve().then(()=>{this.emit('error',Error('private_download'));throw Error('private_download');}):Promise.resolve([])});}quitAndInstall(...args){if(this.quitAndInstallCalled)return;this.quitAndInstallCalled=true;nativeCalls.push(['install-update',...args]);if(native.closeBeforeInstallError)for(const w of windows){w.destroyed=true;w.contentsDestroyed=true;}if(native.installError)throw Error('private_install');if(native.installAsyncError)this.emit('error',Error('EACCES UNKNOWN private_install'));queueMicrotask(()=>app.quit());}}
 const modules={'../homer/dist/model-config.js':await import('../src/model-config.ts'),'../homer/dist/web-contract.js':await import('../src/web-contract.ts'),'../homer/dist/desktop-channels.js':{DesktopChannels:class {start(...args){nativeCalls.push(['channel-start',...args]);return 'fixture-flow';} snapshot(){return {pending:native.channelPending??[]};} configured(){return [];} cancel(){} apply(){nativeCalls.push(['channel-apply']);return {saved:['Telegram@example_bot'],failed:[]};}}},'electron-updater':{default:{NsisUpdater}},'js-yaml':{default:{load:JSON.parse}},'../homer/dist/homer-account.js':account,'../homer/dist/processes.js':{processIdentity:()=> 'synthetic-process',leaseOwnerGone:()=>true},'electron':electron,'../homer/dist/web-upload.js':{WEB_UPLOAD_BYTES:8*1024*1024},'../homer/dist/media-policy.js':await import('../src/media-policy.ts'),'node:fs':fs,'node:child_process':cp,'../homer/scripts/desktop-profile.mjs':{prepareDesktopProfile:root=>({root,runtime:native.runtime??join(root,'runtime'),workspace:join(root,'workspace'),codexHome:native.codexHome??join(root,'codex'),...(native.adopted?{adoption:{appData:'/synthetic/original-app'}}:{})}),recoverDesktopOwner:home=>{assert.equal(ownsLock,true);ownershipCalls.push(['recover-owner',home]);if(native.recoveryError)throw Error('desktop_owner_unknown');},assertDesktopControlPaths(){},readDesktopModelSource:(_root,fallback)=>native.modelSource??fallback,readDesktopChatGPTConfig:()=>native.chatgpt,saveDesktopModelSource:(_root,source,chatgpt)=>{if(native.sourceWriteError)throw Error('desktop_source_write_failed');nativeCalls.push(chatgpt===undefined?['source',source]:['source',source,chatgpt]);if(chatgpt!==undefined)native.chatgpt=chatgpt;}}};
 modules['node:fs/promises']={...filesystem.promises,lstat:async path=>{
  if(platform!=='win32'||!String(path).endsWith('.exe'))return filesystem.promises.lstat(path);
  if(native.fileMissing)throw Object.assign(Error('private_update_missing'),{code:'ENOENT'});
  return {isFile:()=>!native.fileDirectory&&!native.fileSymlink,isSymbolicLink:()=>!!native.fileSymlink,size:(native.fileData??installerBytes).length,dev:1,ino:native.fileRevision??0,mtimeMs:1,ctimeMs:1};
 }};
 modules['../homer/dist/preview-reference.js']=await import('../src/preview-reference.ts');
 modules['../homer/dist/browser-preview.js']=await import('../src/browser-preview.ts');
 modules['./preview-pages.mjs']={registerPreviewScheme(){},createBrowserPreview(){return{close(){},expirePermissions(){},async execute(...args){if(native.previewExecute)return native.previewExecute(...args);throw Error('preview_unavailable');}};}};
 Object.assign(modules['../homer/scripts/desktop-profile.mjs'],{
  readDesktopCaptureShortcut:()=>native.captureShortcut,
  saveDesktopCaptureShortcut:(_root,shortcut)=>{if(native.shortcutWriteError)throw Error('private_write_failure');native.captureShortcut=shortcut;},
  readDesktopNotificationPreferences:()=>native.notifications,
  saveDesktopNotificationPreferences:(_root,prefs)=>{native.notifications=prefs;},
  readDesktopPowerConfig:()=>native.powerConfig,
  saveDesktopPowerConfig:(_root,power)=>{if(native.powerWriteError)throw Error('private_write_failure');native.powerConfig=power;},
 });
 const wakeEvents=[],powerMonitor=new EventEmitter(),powerLocks=new Map();let powerLockId=0;
 electron.powerMonitor=powerMonitor;
 electron.powerSaveBlocker={start:type=>{nativeCalls.push(['power-start',type]);const id=++powerLockId;powerLocks.set(id,type);return id;},stop:id=>{nativeCalls.push(['power-stop',id]);powerLocks.delete(id);}};
 const wakeAdapter={status:async()=>({supported:true,authorization:native.powerAuthorization??'authorized'}),authorize:async()=>{nativeCalls.push(['power-authorize']);return {supported:true,authorization:native.powerAuthorization??'authorized'};},list:async()=>wakeEvents.map(event=>({...event})),schedule:async event=>{nativeCalls.push(['power-schedule',event.at]);wakeEvents.push(event);return event;},cancel:async event=>{nativeCalls.push(['power-cancel',event.at]);const index=wakeEvents.findIndex(item=>item.id===event.id);if(index>=0)wakeEvents.splice(index,1);},close:async()=>{nativeCalls.push(['power-close']);if(platform==='darwin'){wakeEvents.length=0;return true;}}};
 wakeAdapter.prepareUpdate=async()=>{nativeCalls.push(['power-update-cleanup']);await native.powerUpdatePending;if(native.powerUpdateError)throw Error('private_power_failure');};
 if(native.powerStatus)wakeAdapter.status=async()=>native.powerStatus();
 if(native.powerClose)wakeAdapter.close=async()=>{nativeCalls.push(['power-close']);return native.powerClose();};
 const createWakeAdapter=options=>{if(native.powerConstructorError)throw Error('private_wake_context');native.onPowerWake=options.onWake;return wakeAdapter;};
 modules['../homer/scripts/macos-power.mjs']={createMacWakeAdapter:createWakeAdapter};
 modules['../homer/scripts/windows-power.mjs']={createWindowsWakeAdapter:createWakeAdapter};
 const powerSource=transpileModule(readFileSync('src/desktop-power.ts','utf8'),{compilerOptions:{module:ModuleKind.ESNext,target:ScriptTarget.ES2023}}).outputText;
 modules['../homer/dist/desktop-power.js']=await import('data:text/javascript;base64,'+Buffer.from(powerSource).toString('base64'));
 Object.assign(account,native.accountApi);
 modules['node:os']={userInfo:()=>({homedir:native.userHome??(platform==='win32'?'C:\\Synthetic User':'/synthetic/user')})};
 const clockStart=Date.now();
 let timer,clock=0,timerId=0;
 const timers=new Map();
 const runTimers=(ms=0)=>{
  clock+=ms;
  for(const [id,{at,callback}] of [...timers]){
   if(at<=clock&&timers.delete(id))callback();
  }
 };
 const context=vm.createContext({process:{argv:['Homer','--test-profile','/synthetic/profile'],resourcesPath:'/synthetic/Homer.app/Contents/Resources',platform:'darwin',execPath:'C:\\Homer\\Homer.exe',arch:native.arch??'arm64',env:{SystemRoot:'C:\\Windows',LOCALAPPDATA:'C:\\RedirectedLocal'}},Buffer,URL,AbortController,console:native.console??console,performance:{now:()=>monotonic},
  Date:class extends Date{static now(){return clockStart+clock;}},
  Math:Object.assign(Object.create(Math),{random:()=>0.5}),
  setTimeout:(callback,ms)=>{timer=callback;timers.set(++timerId,{at:clock+ms,callback});return timerId;},clearTimeout:id=>timers.delete(id)});
 context.process.argv=args;context.process.platform=platform;
 const path=resolve('packaging/electron/main.mjs');
 // Lifecycle controls exist only in this VM copy, never in the product entry.
 async function synthetic(name){const exports=modules[name]??createRequire(import.meta.url)(name);const m=new vm.SyntheticModule(Object.keys(exports),function(){for(const [key,value]of Object.entries(exports))this.setExport(key,value);},{context});await m.link(()=>{});await m.evaluate();return m;}
 const entry=new vm.SourceTextModule(readFileSync(path,'utf8')+'\nexport {createWindow,windowsUpdater}; export const forgetWindowForTest=()=>{window=undefined;};',{context,identifier:path,importModuleDynamically:synthetic,initializeImportMeta:meta=>{meta.url='file://'+path;}});
 await entry.link(async name=>{const exports=modules[name]??createRequire(import.meta.url)(name);const m=new vm.SyntheticModule(Object.keys(exports),function(){for(const [key,value]of Object.entries(exports))this.setExport(key,value);},{context});return m;});
 await entry.evaluate();await new Promise(r=>setImmediate(r));
 // Preserve every call; only trusted ID-less channel lifecycle cancellation has its own category.
 return {options:native,paths,wakeEvents,powerMonitor,powerLocks,get updater(){return nativeCalls.some(c=>c[0]==='nsis')?entry.namespace.windowsUpdater:updater;},advance:ms=>{monotonic+=ms;},runTimers,BrowserWindow,nativeCalls,allNativeCalls:nativeCalls,
  get nonLifecycleCalls(){return nativeCalls.filter(call=>!channelLifecycleCall(call));},get channelLifecycleCalls(){return nativeCalls.filter(channelLifecycleCall);},
  ownershipCalls,launches,credentials,tokenFiles,setPlatform:value=>{context.process.platform=value;},createWindow:entry.namespace.createWindow,forgetWindow:entry.namespace.forgetWindowForTest,app,child,windows,handlers,messages,sent,toasts,spawnCount:()=>spawnCount,timeout:()=>timer?.(),tick:()=>new Promise(r=>setImmediate(r)),event:value=>child.stdout.write(JSON.stringify(value)+'\n')};
}
if(!vm.SourceTextModule){
 test('Electron shell contracts run with Node VM module support',()=>{
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  const output=execFileSync(process.execPath,['--import','tsx','--experimental-vm-modules','--test',fileURLToPath(import.meta.url)],{stdio:'pipe',env}).toString();
  assert.match(output,/# tests [1-9]\d*/);
 });
}else{

test('macOS focus settings use a fixed target and fall back for the trusted page only',async()=>{
 let fail=false,fallbackError='',hold=false,rejectOpen;
 const f=await fixture(undefined,async()=>{
  if(hold)await new Promise((_resolve,reject)=>{rejectOpen=reject;});
  if(fail)throw Error('unavailable');
 },'darwin',{open:async()=>fallbackError});
 f.event({kind:'url',url:'http://127.0.0.1:4777/',desktopAccessToken:'a'.repeat(64)});
 await f.tick();
 const sender=f.windows[0].webContents,event={sender,senderFrame:sender.mainFrame};
 const command=f.handlers.get('homer:notification'),start=f.nativeCalls.length;
 const external=['external','x-apple.systempreferences:com.apple.Focus-Settings.extension'];
 const fallback=['open','/System/Applications/System Settings.app'];
 await assert.rejects(command({...event,senderFrame:{...event.senderFrame}},'focus-settings'),/desktop_notification_forbidden/);
 await assert.rejects(command(event,'focus-settings','https://example.invalid/'),/desktop_notification_invalid/);
 f.setPlatform('win32');
 await assert.rejects(command(event,'focus-settings'),/desktop_notification_invalid/);
 assert.equal(f.nativeCalls.length,start);
 f.setPlatform('darwin');
 await command(event,'focus-settings');
 fail=true;
 await command(event,'focus-settings');
 fallbackError='unavailable';
 await assert.rejects(command(event,'focus-settings'),/desktop_focus_settings_open_failed/);
 assert.deepEqual(f.nativeCalls.slice(start),[external,external,fallback,external,fallback]);
 hold=true;
 const pending=command(event,'focus-settings');
 sender.emit('did-start-navigation',{url:'http://127.0.0.1:56789/',isSameDocument:false,isMainFrame:true});
 rejectOpen(Error('unavailable'));
 await assert.rejects(pending,/desktop_notification_forbidden/);
 assert.equal(f.nativeCalls.filter(call=>call[0]==='open').length,2);
});

test('desktop notifications combine independent switches and open the original candidate once',async()=>{
 const f=await fixture();
 f.windows[0].hide();
 f.event({kind:'desktop_notification',notice:{kind:'message',id:'first-live',threadId:'thread'}});
 assert.equal(f.toasts.pop()?.options.body,'Homer 有新消息');
 f.event({kind:'url',url:'http://127.0.0.1:4777/',desktopAccessToken:'a'.repeat(64)});
 await f.tick();
 const w=f.windows[0],frame=w.webContents.mainFrame,event={sender:w.webContents,senderFrame:frame};
 const command=f.handlers.get('homer:notification');
 const notice=(kind,id,body)=>f.event({kind:'desktop_notification',notice:{kind,id,threadId:'thread',body}});
 assert.equal((await command(event,'preferences')).message,true);
 assert.equal((await command(event,'preferences')).attention,true);
 await command(event,'ready',true);
 w.show();w.focus();
 notice('message','m1','前台消息');
 assert.equal(f.toasts.length,0);
 notice('interaction','a1','有问题等待回复');
 const check=w.settingsMessages.at(-1);
 assert.equal(check[0],'homer:notification:check');
 assert.deepEqual({...check[2]},{kind:'interaction',id:'a1',threadId:'thread'});
 await command(event,'visibility',check[1],true);
 await f.tick();
 assert.equal(f.toasts.length,0);
 w.hide();
 notice('interaction','a2','有操作待你确认');notice('interaction','a2','有操作待你确认');notice('interaction','a3');
 assert.equal(f.toasts.length,2);
 assert.equal(f.toasts[0].options.body,'有操作待你确认');
 f.toasts[0].emit('click');
 assert.deepEqual({...w.settingsMessages.at(-1)[1]},{kind:'interaction',id:'a2',threadId:'thread'});
 await command(event,'set','attention',false);
 w.hide();
 notice('interaction','a4');
 assert.equal(f.toasts.at(-1).options.body,'Homer 有新消息');
 await command(event,'set','attention',true);
 await command(event,'set','message',false);
 notice('message','m2');notice('interaction','a5');
 assert.equal(f.toasts.length,4);
 await command(event,'set','attention',false);
 notice('message','m3');notice('interaction','a6');
 assert.equal(f.toasts.length,4);
 await assert.rejects(command({sender:w.webContents,senderFrame:{...frame}},'set','message',true),/desktop_notification_forbidden/);
 await command(event,'set','message',true);
 w.hide();
 notice('message','m4','已完成整理');
 assert.equal(f.toasts.at(-1).options.body,'已完成整理');
 f.toasts.at(-1).emit('click');
 assert.deepEqual({...w.settingsMessages.at(-1)[1]},{kind:'message',id:'m4',threadId:'thread'});
 w.hide();
 notice('pairing','p1');
 assert.equal(f.toasts.at(-1).options.body,'请确认新设备配对');
 notice('message','m5','中'.repeat(1024));
 assert.equal(f.toasts.at(-1).options.body,'Homer 有新消息');
});
for(const platform of ['darwin','win32'])test('formal '+platform+' startup passes the system user home while retaining profile-local cache and temp',async()=>{
 const userHome=platform==='win32'?'C:\\Synthetic User':'/synthetic/Real User';
 const f=await fixture(['Homer'],undefined,platform,{published:true,userHome});
 assert.equal(f.spawnCount(),1);const launch=f.launches[0],profile=launch.options.cwd;
 assert.equal(launch.options.env.HOME,userHome);
 assert.equal(launch.options.env.USERPROFILE,platform==='win32'?userHome:undefined);
 assert.equal(launch.options.env.TMPDIR,join(profile,'tmp'));
 assert.equal(f.paths.get('userData'),join(profile,'host-home/electron'));
 assert.equal(f.paths.get('sessionData'),join(profile,'host-home/electron'));
});
for(const platform of ['darwin','win32'])test('test '+platform+' startup uses the synthetic profile home even when the OS home differs',async()=>{
 const profile='/synthetic/qa profile',f=await fixture(['Homer','--test-profile',profile],undefined,platform,{userHome:'/synthetic/unused-real-user'});
 assert.equal(f.spawnCount(),1);assert.equal(f.launches[0].options.env.HOME,join(profile,'host-home'));
 assert.equal(f.launches[0].options.env.USERPROFILE,platform==='win32'?join(profile,'host-home'):undefined);
});

test('desktop home lock serializes different profiles and runtimes while caches remain profile-local',async()=>{
 const locks=new Set(),codexHome='/synthetic/shared-home';
 const first=await fixture(['Homer','--test-profile','/synthetic/profile-a'],undefined,'darwin',{locks,codexHome,runtime:'/synthetic/runtime-a'});
 assert.deepEqual(first.ownershipCalls.filter(call=>call[0]==='single-instance'||call[0]==='recover-owner'),[['single-instance',codexHome],['recover-owner',codexHome]]);
 assert.equal(first.paths.get('userData'),'/synthetic/profile-a/host-home/electron');assert.equal(first.paths.get('sessionData'),'/synthetic/profile-a/host-home/electron');
 assert.equal(first.spawnCount(),1);assert.equal(first.app.hasSingleInstanceLock(),true);
 const second=await fixture(['Homer','--test-profile','/synthetic/profile-b'],undefined,'darwin',{locks,codexHome,runtime:'/synthetic/runtime-b'});
 assert.equal(second.spawnCount(),0);assert.equal(second.ownershipCalls.some(call=>call[0]==='recover-owner'),false);
 const other=await fixture(['Homer','--test-profile','/synthetic/profile-c'],undefined,'darwin',{locks,codexHome:'/synthetic/other-home'});
 assert.equal(other.spawnCount(),1);
});
test('desktop owner recovery failure never starts the runtime',async()=>{
 const f=await fixture(undefined,undefined,'darwin',{recoveryError:true});assert.equal(f.spawnCount(),0);
 assert.equal(f.ownershipCalls.filter(call=>call[0]==='recover-owner').length,1);assert.equal(f.messages.some(message=>message.detail?.includes('desktop_owner_unknown')),true);
});
for(const mode of ['dead','runtime-live','gateway-live','runtime-unknown','lease-live','home-owned'])test('adoption runtime delegates to existing lock recovery: '+mode,async t=>{
 const desktop=await import('../scripts/desktop-profile.mjs'),{acquireLock,processIdentity,leaseOwnerGone}=await import('../src/processes.ts'),{DatabaseSync}=await import('node:sqlite');
 const {RECURSIVE_SCHEMA_VERSION}=await import('../src/recursive-tasks.ts');
 const parent=resolve('.codex/scratch/chat-architecture-implementation-20261105/adoption-runtime-tests');mkdirSync(parent,{recursive:true});
 const profile=mkdtempSync(join(parent,'case-'));t.after(()=>rmSync(profile,{recursive:true,force:true}));
 const runtime=join(profile,'old-runtime'),codexHome=join(profile,'codex'),workspace=join(profile,'workspace');
 for(const path of [runtime,join(runtime,'gateway'),codexHome,workspace,join(profile,'legacy-app'),join(profile,'host-home'),join(profile,'tmp')])mkdirSync(path,{recursive:true,mode:0o700});
 const dead=Number(execFileSync(process.execPath,['-e','process.stdout.write(String(process.pid))'],{encoding:'utf8'}));assert.equal(processIdentity(dead),undefined);
 const locks=[join(runtime,'cli.lock'),join(runtime,'gateway/cli.lock')];
 for(const [index,path]of locks.entries())writeFileSync(path,mode==='runtime-unknown'&&index===0?'{}':JSON.stringify({pid:mode===(index===0?'runtime-live':'gateway-live')?process.pid:dead,identity:'unverified-old-identity'}),{mode:0o600});
 const database=join(runtime,'homer.sqlite'),db=new DatabaseSync(database);
 try{
  db.exec("CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT); CREATE TABLE retained(state TEXT); INSERT INTO retained VALUES('unknown')");
  const meta=db.prepare('INSERT INTO meta VALUES(?,?)');
  meta.run('mainThread','original-main');
  meta.run('recursiveSchemaVersion',RECURSIVE_SCHEMA_VERSION);
  meta.run('lease:main',JSON.stringify({pid:mode==='lease-live'?process.pid:dead,identity:'old-native'}));
 }finally{db.close();}
 const config={runtime,codexHome,workspace,requiresOpenaiAuth:true},sourceConfig=join(profile,'source.json'),sourceBytes=Buffer.from(JSON.stringify(config));writeFileSync(sourceConfig,sourceBytes,{mode:0o600});
 const digest=bytes=>createHash('sha256').update(bytes).digest('hex'),paths={runtime,codexHome,workspace,adoption:{sourceConfig,sha256:digest(sourceBytes),appData:join(profile,'legacy-app'),nativeCodexHome:codexHome}};
 writeFileSync(join(profile,'.homer-desktop-test-profile'),'{"format":1}');writeFileSync(join(profile,'fixture-codex.mjs'),'synthetic');
 const ownerFile=join(codexHome,'desktop-owner.json');
 if(mode==='dead'){writeFileSync(ownerFile,JSON.stringify({format:1,pid:dead,identity:'old-runtime',runtime}),{mode:0o600});desktop.recoverDesktopOwner(codexHome,processIdentity,leaseOwnerGone);assert.equal(existsSync(ownerFile),false);for(const path of locks)assert.equal(existsSync(path),true);}
 if(mode==='home-owned')writeFileSync(ownerFile,JSON.stringify({format:1,pid:process.pid,identity:processIdentity(process.pid),runtime}),{mode:0o600});
 const before=readFileSync(database),lockBefore=locks.map(path=>readFileSync(path)),events=[],nativeModelCalls=[],stdin=new PassThrough();let lockAttempts=0;
 const bundle='/synthetic/Homer.app',resources=bundle+'/Contents/Resources',homer=resources+'/homer',empty=Buffer.alloc(0);
 const manifest={format:2,node:'22.22.0',codex:'0.171.0-alpha.7',arch:'arm64',files:[],sourceHash:'synthetic-hash',codeFiles:['Contents/MacOS/homer-image-decoder','Contents/MacOS/homer-window-capture','Contents/MacOS/node'].map(path=>({path,sha256:digest(empty)}))};
 const proc={argv:['node','desktop-runtime','--profile',profile,'--test-profile'],version:'v22.22.0',arch:'arm64',platform:'darwin',execPath:bundle+'/Contents/MacOS/node',stdin,stdout:new Writable({write(bytes,_encoding,done){events.push(JSON.parse(String(bytes)));done();}}),env:{HOME:join(profile,'host-home'),TMPDIR:join(profile,'tmp')},cwd:()=>profile};
 const modules={
  'node:fs':{...filesystem,realpathSync:path=>String(path).startsWith(bundle)?path:filesystem.realpathSync(path),readdirSync:path=>path===resources?[]:filesystem.readdirSync(path),readFileSync:(path,...args)=>path===join(resources,'desktop-manifest.json')?Buffer.from(JSON.stringify(manifest)):String(path).startsWith(bundle)?empty:filesystem.readFileSync(path,...args)},
  './desktop-profile.mjs':{...desktop,prepareDesktopProfile:()=>paths,readDesktopModelSource:()=> 'codex',readDesktopChatGPTConfig:()=>undefined},
  ['file://'+homer+'/dist/processes.js']:{processIdentity,leaseOwnerGone},
  ['file://'+homer+'/dist/model-config.js']:await import('../src/model-config.ts'),
  ['file://'+homer+'/dist/config.js']:{loadConfig:path=>{assert.equal(path,sourceConfig);return config;}},
  ['file://'+homer+'/dist/recursive-tasks.js']:{RECURSIVE_SCHEMA_VERSION},
  ['file://'+homer+'/dist/store.js']:await import('../src/store.ts'),
  ['file://'+homer+'/dist/mobile-gateway.js']:{readMobileConfig:()=>({})},
  './trusted-build.mjs':{verifyBuild(){}},
  './dev.mjs':{runDev:async options=>{
   assert.equal(options.fixedBuild.thread,'original-main');assert.equal(options.fixedBuild.config.desktopProfile,profile);assert.equal(options.fixedBuild.config.appData,join(profile,'legacy-app'));
   if(mode==='dead'){
    const roles={main:{model:'synthetic-model-main',effort:'high',serviceTier:'priority'},worker:{model:'synthetic-model-worker',effort:'low',serviceTier:null}};
    options.desktop.bindAccount(async(action,input)=>{nativeModelCalls.push({action,input});return true;});
    let browserResult;options.desktop.bindBrowserReply(value=>{browserResult=value;});
    stdin.write(JSON.stringify({kind:'browser_result',id:'browser-5000',value:{content:'x'.repeat(5000)}})+'\n');await new Promise(resolve=>setImmediate(resolve));assert.equal(browserResult.value.content.length,5000);
    stdin.write(JSON.stringify({kind:'native_account',id:78,action:'apply-models',input:{text:'x'.repeat(5000)}})+'\n');await new Promise(resolve=>setImmediate(resolve));assert.equal(nativeModelCalls.length,0);

    stdin.write(JSON.stringify({kind:'native_account',id:77,action:'apply-models',input:roles})+'\n');await new Promise(resolve=>setImmediate(resolve));
   }
   const releases=[];try{for(const path of [join(runtime,'gateway'),runtime]){lockAttempts++;releases.push(acquireLock(path));}return {noHostStarted:true};}catch(error){return {noHostStarted:true,startupError:error.message};}finally{for(const release of releases.reverse())release();}
  }},
 };
 const context=vm.createContext({process:proc,Buffer,console}),require=createRequire(import.meta.url);
 async function synthetic(name){const exports=modules[name]??require(name),module=new vm.SyntheticModule(Object.keys(exports),function(){for(const [key,value]of Object.entries(exports))this.setExport(key,value);},{context});await module.link(()=>{});await module.evaluate();return module;}
 const entry=new vm.SourceTextModule(readFileSync('scripts/desktop-runtime.mjs','utf8'),{context,initializeImportMeta:meta=>{meta.url='file://'+homer+'/scripts/desktop-runtime.mjs';},importModuleDynamically:synthetic});
 await entry.link(synthetic);await entry.evaluate();stdin.destroy();
 if(mode==='dead'){assert.equal(nativeModelCalls.length,1);assert.equal(nativeModelCalls[0].action,'apply-models');assert.equal(nativeModelCalls[0].input.worker.effort,'low');assert.ok(events.some(event=>event.kind==='native_account_result'&&event.id===77&&event.value===true));}
 if(mode==='dead'){assert.equal(proc.exitCode,undefined,JSON.stringify(events));assert.equal(lockAttempts,2);assert.ok(events.some(event=>event.kind==='stopped'));for(const path of locks)assert.equal(existsSync(path),false);}
 else{assert.equal(proc.exitCode,1);assert.equal(events.some(event=>event.kind==='stopped'),false);assert.equal(events.find(event=>event.kind==='error')?.code,mode==='home-owned'?'desktop_owner_conflict':mode==='lease-live'?'desktop_adoption_owner_unknown':mode==='runtime-unknown'?'runtime_already_open':'runtime_lock_identity_unverified');assert.equal(lockAttempts,mode==='gateway-live'?1:mode==='lease-live'||mode==='home-owned'?0:2);if(mode==='runtime-live'||mode==='runtime-unknown')assert.deepEqual(readFileSync(locks[0]),lockBefore[0]);if(mode==='gateway-live')assert.deepEqual(readFileSync(locks[1]),lockBefore[1]);}
 assert.deepEqual(readFileSync(database),before);assert.deepEqual(readFileSync(sourceConfig),sourceBytes);
 assert.equal(existsSync(ownerFile),mode==='home-owned');
});

const stableManifest={releaseChannel:'stable',appId:'app.homer.desktop',publishable:true,preparation:false};
async function updateFixture(native={}){const f=await accountFixture({manifest:stableManifest,...native});f.runTimers(150_000);return f;}
const updateCall=async(f,name,...args)=>{const action=f.handlers.get('homer:update:'+name);assert.equal(typeof action,'function','missing trusted update action: '+name);return action(accountEvent(f),...args);};
const updateMenu=f=>f.handlers.get('menu')[0].submenu.find(item=>item.id==='update');
async function windowsFixture(native={}){const f=await fixture(['Homer'],undefined,'win32',{arch:'x64',published:true,publishable:true,manifest:stableManifest,...native});f.event({kind:'url',url:'http://127.0.0.1:56789/',desktopAccessToken:'a'.repeat(64)});await f.tick();f.runTimers(150_000);await f.tick();return f;}
const unsignedConfig={verifyUpdateCodeSignature:false,publisherName:undefined};
test('Windows unsigned updates prepare a verified package without calling Authenticode or installing on ordinary quit',async()=>{
 const f=await windowsFixture({updateConfig:unsignedConfig});
 assert.equal(f.nativeCalls.filter(c=>c[0]==='check-update').length,1);
 assert.equal(f.updater.autoDownload,true);assert.equal(f.updater.autoInstallOnAppQuit,false);
 f.updater.emit('update-downloaded',windowsUpdate({version:'0.2.0',downloadedFile:'C:\\缓存\\installer.exe'}));await f.tick();
 assert.equal((await updateCall(f,'state')).status,'ready');
 f.app.quit();await f.tick();assert.equal(f.nativeCalls.some(c=>c[0]==='install-update'||c[0]==='verify'),false);
});
test('Windows unsigned updates install once after confirmation and complete stop proof',async()=>{
 const f=await windowsFixture({updateConfig:unsignedConfig,response:1});
 f.updater.emit('update-downloaded',windowsUpdate({version:'0.2.0',downloadedFile:'C:\\缓存\\installer.exe'}));await f.tick();
 await updateCall(f,'restart');await updateCall(f,'restart');await f.tick();
 f.event({kind:'update-stopped'});await f.tick();assert.equal(f.nativeCalls.some(c=>c[0]==='install-update'),false);
 f.child.emit('close',0,null);await f.tick();
 assert.deepEqual(f.nativeCalls.filter(c=>c[0]==='install-update'),[['install-update',true,true]]);
 assert.equal(f.nativeCalls.filter(c=>c[0]==='read-update').length,2);assert.equal(f.sent.length,1);
});
for(const [name,ack,code,signal]of [['no ACK',false,0,null],['nonzero exit',true,1,null],['signal exit',true,null,'SIGTERM']])test('Windows unsigned updates require stop proof: '+name,async()=>{
 const f=await windowsFixture({updateConfig:unsignedConfig,response:1});
 f.updater.emit('update-downloaded',windowsUpdate({version:'0.2.0',downloadedFile:'C:\\cache\\installer.exe'}));await f.tick();
 await updateCall(f,'restart');await f.tick();if(ack)f.event({kind:'update-stopped'});f.child.emit('close',code,signal);await f.tick();
 assert.equal(f.nativeCalls.some(c=>c[0]==='install-update'),false);
});
for(const [name,options,change,error='update_integrity_failed']of [
 ['wrong SHA-512',{fileData:Buffer.alloc(installerBytes.length)},{}],
 ['missing file',{fileMissing:true},{}],['directory',{fileDirectory:true},{}],['symlink',{fileSymlink:true},{}],['read failure',{fileError:true},{}],
 ['relative path',{}, {downloadedFile:'installer.exe'}],['wrong size',{}, {files:[{sha512:createHash('sha512').update(installerBytes).digest('base64'),size:1}]}],
 ['missing hash',{}, {files:[{size:installerBytes.length}]},'update_check_failed'],
 ['multiple files',{}, {files:[{},{}]},'update_check_failed'],
])for(const unsigned of [false,true])test('Windows candidate integrity rejects '+name+' unsigned='+unsigned,async()=>{
 const f=await windowsFixture({...options,...(unsigned?{updateConfig:unsignedConfig}:{})});
 f.updater.emit('update-downloaded',windowsUpdate({version:'0.2.0',downloadedFile:'C:\\cache\\installer.exe',...change}));await f.tick();
 const state=await updateCall(f,'state');assert.equal(state.status,'error');assert.equal(state.error,error);
 assert.equal(f.nativeCalls.some(c=>c[0]==='install-update'),false);
});
test('Windows unsigned update rechecks prepared bytes after stopping and recovers without installation',async()=>{
 const f=await windowsFixture({updateConfig:unsignedConfig,response:options=>options.buttons.includes('重启并更新')?1:0});
 f.updater.emit('update-downloaded',windowsUpdate({version:'0.2.0',downloadedFile:'C:\\cache\\installer.exe'}));await f.tick();
 await updateCall(f,'restart');await f.tick();f.options.fileData=Buffer.from('replaced after ready');
 f.event({kind:'update-stopped'});f.child.emit('close',0,null);await f.tick();
 assert.equal(f.nativeCalls.some(c=>c[0]==='install-update'),false);assert.deepEqual(Array.from(f.messages.at(-1).buttons),['取消','退出荷马']);
});
for(const unsigned of [false,true])for(const installing of [false,true])test('Windows integrity rejects replacement during hashing unsigned='+unsigned+' installing='+installing,async()=>{
 const f=await windowsFixture({holdHash:!installing,response:1,...(unsigned?{updateConfig:unsignedConfig}:{})});
 f.updater.emit('update-downloaded',windowsUpdate({version:'0.2.0',downloadedFile:'C:\\cache\\installer.exe'}));await f.tick();
 if(installing){
  assert.equal((await updateCall(f,'state')).status,'ready');f.options.holdHash=true;
  await updateCall(f,'restart');await f.tick();f.event({kind:'update-stopped'});f.child.emit('close',0,null);await f.tick();
 }
 f.options.fileRevision=1;f.options.releaseHash();await f.tick();
 assert.equal((await updateCall(f,'state')).status,'error');assert.equal(f.nativeCalls.some(c=>c[0]==='install-update'),false);
});
test('Windows unsigned update ignores obsolete hash results when another candidate arrives',async()=>{
 const f=await windowsFixture({updateConfig:unsignedConfig,holdHash:true});
 f.updater.emit('update-downloaded',windowsUpdate({version:'0.2.0',downloadedFile:'C:\\cache\\first.exe'}));await f.tick();
 const release=f.options.releaseHash;assert.equal(typeof release,'function');assert.notEqual((await updateCall(f,'state')).status,'ready');
 f.options.holdHash=false;f.updater.emit('update-downloaded',windowsUpdate({version:'0.3.0',downloadedFile:'C:\\cache\\second.exe'}));await f.tick();
 release();await f.tick();assert.equal((await updateCall(f,'state')).version,'0.3.0');assert.equal(f.nativeCalls.some(c=>c[0]==='install-update'),false);
});
test('Windows unsigned update keeps the candidate metadata snapshot while hashing',async()=>{
 const f=await windowsFixture({updateConfig:unsignedConfig,holdHash:true}),info=windowsUpdate({version:'0.2.0',downloadedFile:'C:\\cache\\installer.exe'});
 f.updater.emit('update-downloaded',info);await f.tick();
 info.version='0.3.0';info.files[0].sha512='replaced';info.files[0].size=1;
 f.options.releaseHash();await f.tick();assert.equal((await updateCall(f,'state')).version,'0.2.0');assert.equal((await updateCall(f,'state')).status,'ready');
});
for(const config of [undefined,{verifyUpdateCodeSignature:'false',publisherName:undefined},{verifyUpdateCodeSignature:false,publisherName:null},{verifyUpdateCodeSignature:true,publisherName:undefined}])test('Windows malformed or missing packaged verification config stays disabled '+JSON.stringify(config),async()=>{
 const f=await windowsFixture(config===undefined?{missingUpdateConfig:true}:{updateConfig:config});
 assert.equal(await updateCall(f,'state'),null);assert.equal(f.nativeCalls.some(c=>c[0]==='nsis'||c[0]==='check-update'),false);
});
test('Windows uses only NSIS generic latest with explicit safety switches and quiet logger',async()=>{
 const f=await windowsFixture();assert.ok(f.updater);assert.equal(f.nativeCalls.filter(c=>c[0]==='check-update').length,1);
 assert.equal(f.launches[0].options.env.LOCALAPPDATA,'C:\\RedirectedLocal');assert.equal(f.updater.logger,null);for(const [name,value]of Object.entries({autoDownload:true,autoInstallOnAppQuit:false,allowPrerelease:false,allowDowngrade:false,disableDifferentialDownload:true,disableWebInstaller:true}))assert.equal(f.updater[name],value);
 assert.equal(f.nativeCalls.find(c=>c[0]==='nsis')[1].url,'https://github.com/wolf3c/homer/releases/latest/download/');
});
for(const readyFirst of [false,true])test('Windows startup stays usable while signature validation is pending '+readyFirst,async()=>{
 const f=await fixture(['Homer'],undefined,'win32',{arch:'x64',published:true,publishable:true,manifest:stableManifest,holdVerify:true});
 assert.equal(f.spawnCount(),1);assert.equal(f.windows.length,1);assert.equal(f.nativeCalls.filter(c=>c[0]==='check-update').length,0);
 const ready=()=>f.event({kind:'url',url:'http://127.0.0.1:56789/',desktopAccessToken:'a'.repeat(64)});
 if(readyFirst)ready();f.options.holdVerify=false;f.options.releaseVerify();await f.tick();if(!readyFirst)ready();await f.tick();
 assert.equal(updateMenu(f).enabled,true);
 f.runTimers(150_000);
 assert.equal(f.nativeCalls.filter(c=>c[0]==='check-update').length,1);
});
for(const options of [{checkReject:true},{downloadReject:true},{nullCheck:true}])test('Windows consumes updater Promise rejection or null '+JSON.stringify(options),async()=>{const f=await windowsFixture(options);await f.tick();assert.equal(f.nativeCalls.filter(c=>c[0]==='check-update').length,1);assert.equal(f.sent.length,0);});
test('Windows signature verification preserves a Unicode path and full publisher subject',async()=>{
 const unicode=await windowsFixture({publisher:['CN=Homer, O=Homer, C=CN','CN=荷马, O=荷马, C=CN'],signer:'CN=荷马, O=荷马, C=CN'});
 unicode.updater.emit('update-downloaded',windowsUpdate({version:'0.2.0',downloadedFile:'C:\\Users\\测试\\缓存\\安装.exe'}));await unicode.tick();assert.equal((await updateCall(unicode,'state')).status,'ready');
 for(const call of unicode.nativeCalls.filter(c=>c[0]==='verify'))assert.ok(call[2].at(-1).includes('[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)'));
});
for(const invalid of [{invalidSignature:true},{verifyError:true},{signer:'CN=Other, O=Other, C=CN'}])test('Windows cached candidate is verified before ready '+JSON.stringify(invalid),async()=>{const f=await windowsFixture(invalid);f.updater.emit('update-downloaded',windowsUpdate({version:'0.2.0',downloadedFile:'C:\\cache\\installer.exe'}));await f.tick();assert.equal((await updateCall(f,'state')).status,'error');assert.equal(f.nativeCalls.some(c=>c[0]==='install-update'),false);});
test('Windows revalidates a replacement candidate for the same version without reopening a dismissed notice',async()=>{
 const f=await windowsFixture();f.updater.emit('update-downloaded',windowsUpdate({version:'0.2.0',downloadedFile:'C:\\cache\\first.exe'}));await f.tick();await updateCall(f,'dismiss');
 f.updater.emit('update-downloaded',windowsUpdate({version:'0.2.0',downloadedFile:'C:\\cache\\second.exe'}));await f.tick();assert.equal((await updateCall(f,'state')).noticeHidden,true);f.options.invalidSignature=true;
 f.updater.emit('update-downloaded',windowsUpdate({version:'0.2.0',downloadedFile:'C:\\cache\\tampered.exe'}));await f.tick();const state=await updateCall(f,'state');assert.equal(state.status,'error');assert.equal(state.noticeHidden,true);assert.equal(f.nativeCalls.some(c=>c[0]==='install-update'),false);
});
for(const closeFirst of [false,true])test('Windows verifies before ready and again only after safe stop closeFirst='+closeFirst,async()=>{
 const f=await windowsFixture();f.updater.emit('update-downloaded',windowsUpdate({version:'0.2.0',downloadedFile:'C:\\cache\\installer.exe'}));await f.tick();assert.equal((await updateCall(f,'state')).status,'ready');await updateCall(f,'dismiss');await updateCall(f,'restart');await f.tick();if(closeFirst)f.child.emit('close',0,null);f.event({kind:'update-stopped'});if(!closeFirst)f.child.emit('close',0,null);await f.tick();assert.equal(f.nativeCalls.filter(c=>c[0]==='verify').length,3);assert.deepEqual(JSON.parse(JSON.stringify(f.nativeCalls.filter(c=>c[0]==='install-update'))),[['install-update',true,true]]);
});
for(const closeFirst of [false,true])for(const failure of ['sync','async'])for(const action of ['cancel','quit'])test('Windows '+failure+' failed install '+(closeFirst?'after window destruction ':'')+action+' does not reuse installer state',async()=>{
 let response=0;const f=await windowsFixture({installError:failure==='sync',installAsyncError:failure==='async',closeBeforeInstallError:closeFirst,response:options=>options.buttons.includes('重启并更新')?1:response});let exits=0;f.app.on('quit',()=>exits++);
 f.updater.emit('update-downloaded',windowsUpdate({version:'0.2.0',downloadedFile:'C:\\cache\\installer.exe'}));await f.tick();await updateCall(f,'dismiss');await updateCall(f,'restart');await f.tick();f.event({kind:'update-stopped'});f.child.emit('close',0,null);await f.tick();
 assert.equal(f.updater.quitAndInstallCalled,true);const prompts=f.messages.filter(m=>m.type==='question').length;f.app.quit();await f.tick();assert.equal(f.messages.filter(m=>m.type==='question').length,prompts,'delayed library quit is intercepted');assert.equal(exits,0);
 f.updater.emit('update-downloaded',windowsUpdate({version:'0.3.0',downloadedFile:'C:\\cache\\other.exe'}));f.updater.emit('error',Error('private_late'));await f.tick();assert.equal(f.messages.filter(m=>m.type==='question').length,prompts);
 response=action==='quit'?1:0;updateMenu(f).click();await f.tick();assert.deepEqual(Array.from(f.messages.at(-1).buttons),['取消','退出荷马']);if(closeFirst)assert.equal(f.messages.at(-1).parent,undefined);assert.equal(exits,action==='quit'?1:0);assert.equal(f.nativeCalls.filter(c=>c[0]==='install-update').length,1);assert.equal(f.sent.length,1);assert.equal(f.nativeCalls.some(c=>c[0]==='relaunch'),false);
 if(action==='cancel'){response=1;f.windows[0].close();await f.tick();assert.equal(exits,1);}
 const reopened=await windowsFixture();reopened.event({kind:'update-stopped'});reopened.child.emit('close',0,null);await reopened.tick();assert.equal(reopened.nativeCalls.some(c=>c[0]==='install-update'),false);assert.equal(reopened.nativeCalls.filter(c=>c[0]==='check-update').length,1);
});
for(const destroyed of [false,true])for(const order of ['ack-close','close-ack'])for(const errorAfterFirst of [false,true])test('Windows stop-time error recovers cancel and exit '+order+' destroyed='+destroyed+' errorAfterFirst='+errorAfterFirst,async()=>{
 let response=0;const f=await windowsFixture({response:options=>options.buttons.includes('重启并更新')?1:response});let exits=0;f.app.on('quit',()=>exits++);
 f.updater.emit('update-downloaded',windowsUpdate({version:'0.2.0',downloadedFile:'C:\\cache\\installer.exe'}));await f.tick();await updateCall(f,'dismiss');await updateCall(f,'restart');await f.tick();
 if(destroyed){f.windows[0].destroyed=true;f.windows[0].contentsDestroyed=true;}
 if(errorAfterFirst){if(order==='ack-close')f.event({kind:'update-stopped'});else f.child.emit('close',0,null);}
 f.updater.emit('error',Error('synthetic_stop_error'));await f.tick();
 f.updater.emit('update-not-available');f.updater.emit('update-available',{version:'0.3.0'});f.updater.emit('update-downloaded',windowsUpdate({version:'0.3.0',downloadedFile:'C:\\cache\\late.exe'}));await f.tick();
 if(!errorAfterFirst){if(order==='ack-close')f.event({kind:'update-stopped'});else f.child.emit('close',0,null);}
 if(order==='ack-close')f.child.emit('close',0,null);else f.event({kind:'update-stopped'});await f.tick();
 assert.deepEqual(Array.from(f.messages.at(-1).buttons),['取消','退出荷马']);if(destroyed)assert.equal(f.messages.at(-1).parent,undefined);
 if(!destroyed){const state=await updateCall(f,'state');assert.equal(state.status,'error');assert.equal(state.noticeHidden,true);}
 const prompts=f.messages.filter(m=>m.type==='question').length;f.app.quit();f.updater.emit('error',Error('synthetic_late_error'));f.event({kind:'update-stopped'});await f.tick();assert.equal(exits,0);assert.equal(f.messages.filter(m=>m.type==='question').length,prompts);
 response=1;updateMenu(f).click();await f.tick();assert.equal(exits,1);assert.equal(f.nativeCalls.filter(c=>c[0]==='check-update').length,1);assert.equal(f.nativeCalls.some(c=>c[0]==='install-update'||c[0]==='relaunch'),false);assert.equal(f.sent.length,1);
});
for(const [name,ack,status,signal]of [['no-ack',false,0,null],['nonzero',true,1,null],['signal',true,null,'SIGTERM'],['timeout',false,0,null]])test('Windows stop-time error without proof still refuses exit '+name,async()=>{
 const f=await windowsFixture({response:1});let exits=0;f.app.on('quit',()=>exits++);f.updater.emit('update-downloaded',windowsUpdate({version:'0.2.0',downloadedFile:'C:\\cache\\installer.exe'}));await f.tick();await updateCall(f,'restart');await f.tick();f.updater.emit('error',Error('synthetic_stop_error'));if(ack)f.event({kind:'update-stopped'});f.child.emit('close',status,signal);await f.tick();if(name==='timeout'){f.timeout();f.event({kind:'update-stopped'});await f.tick();}updateMenu(f).click();f.app.quit();await f.tick();assert.equal(exits,0);assert.equal(f.nativeCalls.some(c=>c[0]==='install-update'),false);
});
test('Windows recovery invalidates an in-flight pre-install verification',async()=>{
 let response=0;const f=await windowsFixture({response:options=>options.buttons.includes('重启并更新')?1:response});let exits=0;f.app.on('quit',()=>exits++);
 f.updater.emit('update-downloaded',windowsUpdate({version:'0.2.0',downloadedFile:'C:\\cache\\installer.exe'}));await f.tick();await updateCall(f,'restart');await f.tick();f.options.holdVerify=true;f.event({kind:'update-stopped'});f.child.emit('close',0,null);await f.tick();
 assert.equal(typeof f.options.releaseVerify,'function');f.updater.emit('error',Error('synthetic_verification_error'));await f.tick();assert.deepEqual(Array.from(f.messages.at(-1).buttons),['取消','退出荷马']);
 f.options.holdVerify=false;f.options.releaseVerify();await f.tick();assert.equal(exits,0);assert.equal(f.nativeCalls.some(c=>c[0]==='install-update'),false);
 response=1;updateMenu(f).click();await f.tick();assert.equal(exits,1);assert.equal(f.sent.length,1);
});
test('Windows rejects malformed signature output and required elevation without leaking raw errors',async()=>{
 const f=await windowsFixture({verifyOutput:'private malformed response https://example.invalid/?secret=sentinel'});f.updater.emit('update-downloaded',windowsUpdate({version:'0.2.0',downloadedFile:'C:\\cache\\installer.exe'}));await f.tick();assert.equal((await updateCall(f,'state')).status,'error');assert.equal(JSON.stringify(f.messages).includes('sentinel'),false);
 const elevated=await windowsFixture(),info=windowsUpdate({version:'0.2.0',downloadedFile:'C:\\cache\\installer.exe',files:[{isAdminRightsRequired:true}]});
 elevated.updater.emit('update-available',info);
 assert.equal((await updateCall(elevated,'state')).status,'downloading');
 updateMenu(elevated).click();elevated.runTimers(3_600_000);
 assert.equal(elevated.nativeCalls.filter(c=>c[0]==='check-update').length,1);
 elevated.updater.emit('update-downloaded',info);await elevated.tick();assert.equal((await updateCall(elevated,'state')).status,'error');
});
test('Windows installation-time signature failure preserves proof and requires exit/reopen',async()=>{
 let response=0;const f=await windowsFixture({response:options=>options.buttons.includes('重启并更新')?1:response});let exits=0;f.app.on('quit',()=>exits++);f.updater.emit('update-downloaded',windowsUpdate({version:'0.2.0',downloadedFile:'C:\\cache\\installer.exe'}));await f.tick();await updateCall(f,'restart');await f.tick();f.options.invalidSignature=true;f.event({kind:'update-stopped'});f.child.emit('close',0,null);await f.tick();assert.equal(f.nativeCalls.some(c=>c[0]==='install-update'),false);assert.equal(exits,0);response=1;updateMenu(f).click();await f.tick();assert.equal(exits,1);assert.equal(f.sent.length,1);
});
for(const publisher of [[],['CN=OnlyName'],['']])test('Windows disables updates without a full trusted publisher '+JSON.stringify(publisher),async()=>{const f=await windowsFixture({publisher});assert.equal(f.nativeCalls.some(c=>c[0]==='nsis'),false);assert.equal(await updateCall(f,'state'),null);});
test('Windows rejects conflicting publisher and unsigned update configuration',async()=>{const f=await windowsFixture({updateConfig:{verifyUpdateCodeSignature:false}});assert.equal(f.nativeCalls.some(c=>c[0]==='nsis'),false);});
test('Windows errors publish safe state without library or signature output',async()=>{
 const logs=[],f=await windowsFixture({console:{error:(...v)=>logs.push(v),log:(...v)=>logs.push(v),warn:(...v)=>logs.push(v)}}),sentinel='synthetic_secret_body https://example.invalid/?private=1 C:\\Users\\Private';
 f.updater.emit('error',Error(sentinel));await f.tick();const state=await updateCall(f,'state');assert.equal(state.error,'update_check_failed');assert.equal(JSON.stringify([logs,f.messages,state,f.windows.map(w=>w.settingsMessages)]).includes(sentinel),false);assert.equal(logs.length,0);
});
for(const changed of ['valid-cache','tampered-cache','withdrawn'])test('Windows reopened process rechecks '+changed+' and cannot reuse a previous stop ACK',async()=>{
 const f=await windowsFixture({invalidSignature:changed==='tampered-cache',nullCheck:changed==='withdrawn'});f.event({kind:'update-stopped'});await f.tick();
 if(changed!=='withdrawn')f.updater.emit('update-downloaded',windowsUpdate({version:'0.2.0',downloadedFile:'C:\\cache\\installer.exe'}));await f.tick();const state=await updateCall(f,'state');assert.equal(state.status,changed==='valid-cache'?'ready':changed==='withdrawn'?'idle':'error');
 assert.equal(f.nativeCalls.filter(c=>c[0]==='check-update').length,1);assert.equal(f.nativeCalls.some(c=>c[0]==='install-update'),false);
});
test('stable Mac automatically calls the native updater when the runtime URL arrives after signature initialization',async()=>{
 const f=await fixture(['Homer'],undefined,'darwin',{adopted:true,published:true,manifest:stableManifest});
 assert.equal(f.nativeCalls.filter(c=>c[0]==='check-update').length,0);
 assert.equal(updateMenu(f),undefined);
 assert.deepEqual(JSON.parse(JSON.stringify(f.nativeCalls.filter(c=>c[0]==='feed'))),[['feed',{url:'https://github.com/wolf3c/homer/releases/latest/download/RELEASES-darwin-arm64.json',serverType:'json'}]]);
 f.event({kind:'url',url:'http://127.0.0.1:56789/',desktopAccessToken:'a'.repeat(64)});await f.tick();
 f.runTimers(150_000);
 assert.equal(f.nativeCalls.filter(c=>c[0]==='check-update').length,1);
 f.event({kind:'url',url:'http://127.0.0.1:56789/',desktopAccessToken:'a'.repeat(64)});f.app.emit('activate');updateMenu(f).click();await f.tick();
 assert.equal(f.nativeCalls.filter(c=>c[0]==='check-update').length,1);
});
test('stable Mac manual menu calls the native updater after signature initialization and a completed automatic check',async()=>{
 const f=await updateFixture();
 assert.equal(f.nativeCalls.filter(c=>c[0]==='check-update').length,1);
 f.updater.emit('update-not-available');assert.equal(updateMenu(f).enabled,true);
 updateMenu(f).click();assert.equal(f.nativeCalls.filter(c=>c[0]==='check-update').length,2);
});
for(const platform of ['darwin','win32'])test('desktop hourly updates share one check across startup, sleep, manual and ready '+platform,async()=>{
 const f=await fixture(['Homer'],undefined,platform,{arch:platform==='win32'?'x64':'arm64',published:true,publishable:true,manifest:stableManifest});
 const checkCount=()=>f.nativeCalls.filter(call=>call[0]==='check-update').length;
 f.event({kind:'url',url:'http://127.0.0.1:56789/',desktopAccessToken:'a'.repeat(64)});await f.tick();
 f.runTimers(149_999);assert.equal(checkCount(),0);
 f.runTimers(1);assert.equal(checkCount(),1);
 f.updater.emit('update-not-available');
 f.powerMonitor.emit('suspend');
 f.runTimers(600_000);
 f.powerMonitor.emit('resume');
 f.runTimers(2_999_999);assert.equal(checkCount(),1);
 updateMenu(f).click();
 f.runTimers(1);assert.equal(checkCount(),2);
 f.updater.emit('error',Error('synthetic update failure'));
 await f.tick();
 f.runTimers(3_599_999);assert.equal(checkCount(),2);
 f.runTimers(1);assert.equal(checkCount(),3);
 f.updater.emit('update-not-available');
 f.powerMonitor.emit('suspend');
 f.runTimers(10_800_000);assert.equal(checkCount(),3);
 f.powerMonitor.emit('resume');f.powerMonitor.emit('resume');
 f.runTimers(149_999);assert.equal(checkCount(),3);
 f.runTimers(1);assert.equal(checkCount(),4);
 f.updater.emit('update-available');
 f.runTimers(3_600_000);assert.equal(checkCount(),4);
 if(platform==='win32'){
  f.options.holdVerify=true;
  f.updater.emit('update-downloaded',windowsUpdate({version:'0.2.0',downloadedFile:'C:\\cache\\installer.exe'}));
  await f.tick();
  assert.equal((await updateCall(f,'state')).status,'downloading');
  updateMenu(f).click();f.runTimers(3_600_000);assert.equal(checkCount(),4);
  f.options.releaseVerify();
 }else f.updater.emit('update-downloaded',{},'','0.2.0');
 await f.tick();assert.equal((await updateCall(f,'state')).status,'ready');
 f.powerMonitor.emit('resume');
 f.runTimers(7_200_000);assert.equal(checkCount(),4);
});
test('desktop hourly checks pause for quit confirmation and stop when the service closes',async()=>{
 let cancelQuit;
 const f=await updateFixture({response:()=>new Promise(resolve=>{cancelQuit=()=>resolve(0);})});
 const checkCount=()=>f.nativeCalls.filter(call=>call[0]==='check-update').length;
 f.app.quit();f.updater.emit('update-not-available');
 assert.equal(updateMenu(f).enabled,false);
 f.runTimers(3_600_000);assert.equal(checkCount(),1);
 cancelQuit();await f.tick();assert.equal(updateMenu(f).enabled,true);
 f.runTimers();assert.equal(checkCount(),2);
 f.updater.emit('update-not-available');f.child.emit('close',0,null);
 f.powerMonitor.emit('resume');f.runTimers(7_200_000);assert.equal(checkCount(),2);
});
test('Intel Mac reads only its own feed',async()=>{
 const f=await updateFixture({arch:'x64'});assert.equal(f.nativeCalls.find(c=>c[0]==='feed')[1].url,'https://github.com/wolf3c/homer/releases/latest/download/RELEASES-darwin-x64.json');
});
for(const [name,options]of [['missing channel',{manifest:{}}],['QA',{manifest:{...stableManifest,releaseChannel:'qa'}}],['candidate ID',{manifest:{...stableManifest,appId:'app.homer.desktop.candidate'}}],['local tree',{manifest:{...stableManifest,localWorkingTree:true}}],['untrusted signer',{untrustedSigner:true}],['unknown arch',{arch:'riscv64'}]])test('update remains disabled for '+name,async()=>{
 const f=await updateFixture(options);assert.equal(await updateCall(f,'state'),null);assert.equal(f.nativeCalls.some(c=>c[0]==='feed'||c[0]==='check-update'),false);
});
test('test profile never configures native updates even with stable metadata',async()=>{
 const f=await fixture(undefined,undefined,undefined,{manifest:stableManifest});assert.equal(f.nativeCalls.some(c=>c[0]==='feed'),false);
});
test('About and native menu share one check and only a native no-update event confirms latest',async()=>{
 const f=await updateFixture(),count=()=>f.nativeCalls.filter(call=>call[0]==='check-update').length;
 assert.equal((await updateCall(f,'check')).status,'checking');assert.equal(count(),1);
 f.updater.emit('update-not-available');
 assert.equal((await updateCall(f,'state')).latest,true);
 const [check]=await Promise.all([updateCall(f,'check'),updateCall(f,'check')]);updateMenu(f).click();
 assert.equal(check.status,'checking');assert.equal(check.latest,undefined);assert.equal(count(),2);
 f.updater.emit('update-available');
 assert.equal((await updateCall(f,'check')).status,'downloading');assert.equal(count(),2);
 f.updater.emit('error',Error('private_network_detail'));
 assert.equal((await updateCall(f,'state')).error,'update_download_failed');
 assert.equal((await updateCall(f,'check')).status,'checking');assert.equal(count(),3);
 f.updater.emit('update-not-available');
 assert.equal((await updateCall(f,'state')).latest,true);assert.equal(f.messages.length,0);
 updateMenu(f).click();f.updater.emit('update-not-available');await f.tick();
 assert.ok(f.messages.some(message=>message.message==='已是最新版本'));
});
test('disabled updater and Windows null results never confirm latest or start an install',async()=>{
 const disabled=await updateFixture({manifest:{...stableManifest,publishable:false}});
 assert.equal(await updateCall(disabled,'check'),null);
 assert.equal(disabled.nativeCalls.some(call=>call[0]==='check-update'),false);
 const f=await windowsFixture({nullCheck:true});await updateCall(f,'check');await f.tick();
 const state=await updateCall(f,'state');
 assert.equal(state.status,'idle');assert.equal(state.latest,undefined);assert.equal(f.messages.length,0);
 assert.equal(f.nativeCalls.filter(call=>call[0]==='check-update').length,2);
 assert.equal(f.nativeCalls.some(call=>call[0]==='install-update'),false);
});
test('native preparation is required; dismissal survives page reload and keeps the menu restart',async()=>{
 const f=await updateFixture();f.updater.emit('update-available');assert.equal((await updateCall(f,'state')).status,'downloading');
 await updateCall(f,'restart');assert.equal(f.sent.length,0);
 f.updater.emit('update-downloaded',{},'ignored notes','0.2.0');assert.equal((await updateCall(f,'state')).version,'0.2.0');
 await updateCall(f,'dismiss');await f.windows[0].loadURL('http://127.0.0.1:56789/');f.updater.emit('update-downloaded',{},'ignored duplicate','0.2.0');assert.equal((await updateCall(f,'state')).noticeHidden,true);assert.equal(updateMenu(f).label,'重启并更新…');
});
test('manual errors and hidden restart failures give safe native feedback',async()=>{
 const f=await updateFixture();f.updater.emit('update-not-available');updateMenu(f).click();f.updater.emit('error',Error('private_details'));await f.tick();
 assert.ok(f.messages.some(m=>m.detail?.includes('检查更新未能完成')));assert.equal(JSON.stringify(f.messages).includes('private_details'),false);
 f.updater.emit('update-downloaded',{},'', '0.2.0');await updateCall(f,'dismiss');updateMenu(f).click();await f.tick();f.event({kind:'update-busy'});await f.tick();
 assert.ok(f.messages.some(m=>m.detail?.includes('当前工作尚未结束')));assert.equal((await updateCall(f,'state')).noticeHidden,true);
});
test('update becoming ready during an ordinary quit confirmation switches to the safe update gate',async()=>{
 const f=await updateFixture();f.updater.emit('update-not-available');f.app.quit();f.updater.emit('update-downloaded',{},'', '0.2.0');await f.tick();
 assert.deepEqual(f.sent.map(JSON.parse),[{kind:'update-stop'}]);
});
test('a staged update arriving after ordinary stop was sent cannot bypass update-stop proof',async()=>{
 const f=await updateFixture();f.updater.emit('update-not-available');let quits=0;f.app.on('quit',()=>quits++);f.app.quit();await f.tick();assert.equal(JSON.parse(f.sent[0]).kind,'quit');
 f.updater.emit('update-downloaded',{},'', '0.2.0');f.event({kind:'stopped'});f.child.emit('close',0,null);await f.tick();
 assert.equal(quits,0);assert.equal((await updateCall(f,'state')).error,'update_service_stopped');assert.equal(f.nativeCalls.some(c=>c[0]==='install-update'),false);
});
test('ordinary macOS quit cannot stop the runtime while native staging is unresolved',async()=>{
 const f=await updateFixture();
 for(const event of ['checking-for-update','update-available','error']){
  f.updater.emit(event,Error('synthetic'));f.app.quit();await f.tick();
  assert.equal(f.sent.length,0);
 }
 f.updater.emit('update-downloaded',{},'','0.2.0');f.app.quit();await f.tick();
 assert.deepEqual(f.sent.map(JSON.parse),[{kind:'update-stop'}]);
});
for(const error of [{domain:'NSURLErrorDomain'},{domain:'SQRLUpdaterErrorDomain',code:5},{domain:'SQRLUpdaterErrorDomain',code:9}])test('a known macOS transfer failure still permits ordinary quit: '+(error.code??error.domain),async()=>{
 const f=await updateFixture();
 f.updater.emit('update-available');
 f.updater.emit('error',Object.assign(Error('synthetic transfer error'),error));
 f.app.quit();await f.tick();
 assert.deepEqual(f.sent.map(JSON.parse),[{kind:'quit'}]);
});
test('native install failure keeps a recoverable ready state without relaunch or forced exit',async()=>{
 const f=await updateFixture({installError:true});f.updater.emit('update-downloaded',{},'', '0.2.0');await updateCall(f,'restart');await f.tick();
 f.event({kind:'update-stopped'});f.child.emit('close',0,null);await f.tick();const state=await updateCall(f,'state');assert.equal(state.status,'ready');assert.equal(state.error,'update_install_unconfirmed');assert.equal(f.nativeCalls.filter(c=>c[0]==='install-update').length,1);assert.equal(f.nativeCalls.some(c=>c[0]==='relaunch'),false);
});
test('asynchronous native install error also releases the quit gate and reports the stopped service',async()=>{
 const f=await updateFixture();f.updater.emit('update-downloaded',{},'', '0.2.0');await updateCall(f,'restart');await f.tick();f.event({kind:'update-stopped'});f.child.emit('close',0,null);await f.tick();
 f.updater.emit('error',Error('private_install_detail'));await f.tick();assert.equal((await updateCall(f,'state')).error,'update_install_unconfirmed');assert.equal(updateMenu(f).enabled,true);assert.equal(f.nativeCalls.filter(c=>c[0]==='install-update').length,1);
});
for(const failure of ['throw','event'])for(const action of ['retry','quit','cancel'])test('native install '+failure+' recovery permits '+action+' only after confirmed safe stop',async()=>{
 let response=1;
 const f=await updateFixture({response:()=>response});
 let exits=0;f.app.on('quit',()=>exits++);
 f.updater.quitAndInstall=()=>{f.nativeCalls.push(['install-update']);if(failure==='throw')throw Error('synthetic_install_failure');};
 f.updater.emit('update-downloaded',{},'', '0.2.0');await updateCall(f,'dismiss');await updateCall(f,'restart');await f.tick();
 f.event({kind:'update-stopped'});f.child.emit('close',0,null);await f.tick();
 if(failure==='event'){f.updater.emit('error',Error('synthetic_install_failure'));await f.tick();}
 assert.equal((await updateCall(f,'state')).error,'update_install_unconfirmed');assert.equal(exits,0);
 response=action==='retry'?1:action==='quit'?2:0;
 f.updater.quitAndInstall=()=>{f.nativeCalls.push(['install-update']);f.app.quit();};
 if(action==='retry')await updateCall(f,'restart');else f.app.quit();await f.tick();
 const recovery=f.messages.filter(m=>m.type==='question').at(-1);
 assert.deepEqual(Array.from(recovery.buttons),['取消','重试更新','退出荷马']);
 assert.equal(f.sent.length,1,'a stopped runtime must not receive another stop');
 assert.equal(f.nativeCalls.filter(c=>c[0]==='install-update').length,action==='retry'?2:1);
 assert.equal(exits,action==='cancel'?0:1);assert.equal(f.nativeCalls.some(c=>c[0]==='relaunch'),false);
 assert.equal((await updateCall(f,'state')).noticeHidden,true);
 if(action==='cancel'){response=1;updateMenu(f).click();await f.tick();assert.equal(exits,1);assert.equal(f.sent.length,1);assert.equal(f.nativeCalls.filter(c=>c[0]==='install-update').length,2);}
 f.event({kind:'update-stopped'});await f.tick();assert.equal(f.nativeCalls.filter(c=>c[0]==='install-update').length,action==='quit'?1:2);
});
for(const blocked of ['unsaved','navigation'])test('install recovery preserves '+blocked+' protection',async()=>{
 let f;f=await updateFixture({installError:true,response:async options=>{if(blocked==='navigation'&&options.buttons.includes('退出荷马'))await f.windows[0].loadURL('http://127.0.0.1:56789/');return options.buttons.includes('退出荷马')?2:1;}});
 let exits=0;f.app.on('quit',()=>exits++);
 f.updater.emit('update-downloaded',{},'', '0.2.0');await updateCall(f,'restart');await f.tick();f.event({kind:'update-stopped'});f.child.emit('close',0,null);await f.tick();
 if(blocked==='unsaved')f.windows[0].webContents.executeJavaScript=async()=>false;
 f.app.quit();await f.tick();assert.equal(exits,0);assert.equal(f.sent.length,1);assert.equal(f.nativeCalls.filter(c=>c[0]==='install-update').length,1);
});
for(const action of ['retry','quit','cancel'])test('native close-before-error recovery permits '+action+' without a live renderer',async()=>{
 let response=1;
 const f=await updateFixture({response:()=>response});let exits=0;f.app.on('quit',()=>exits++);
 f.updater.quitAndInstall=()=>{f.nativeCalls.push(['install-update']);for(const w of f.windows)w.close();};
 f.updater.emit('update-downloaded',{},'', '0.2.0');await updateCall(f,'dismiss');await updateCall(f,'restart');await f.tick();
 f.event({kind:'update-stopped'});f.child.emit('close',0,null);await f.tick();
 assert.equal(f.windows[0].isDestroyed(),true);assert.equal(f.windows[0].webContents.isDestroyed(),true);
 f.updater.emit('error',Error('synthetic_install_failure'));await f.tick();assert.equal(exits,0);
 response=action==='retry'?1:action==='quit'?2:0;
 f.updater.quitAndInstall=()=>{f.nativeCalls.push(['install-update']);f.app.quit();};
 if(action==='retry')updateMenu(f).click();else f.app.quit();await f.tick();
 const recovery=f.messages.filter(m=>m.type==='question').at(-1);
 assert.deepEqual(Array.from(recovery.buttons),['取消','重试更新','退出荷马']);assert.equal(recovery.parent,undefined);
 assert.equal(f.sent.length,1);assert.equal(f.windows.length,1,'recovery must not recreate the stopped service page');
 assert.equal(exits,action==='cancel'?0:1);assert.equal(f.nativeCalls.filter(c=>c[0]==='install-update').length,action==='retry'?2:1);
 if(action==='cancel'){response=1;updateMenu(f).click();await f.tick();assert.equal(exits,1);assert.equal(f.nativeCalls.filter(c=>c[0]==='install-update').length,2);assert.equal(f.sent.length,1);}
 f.event({kind:'update-stopped'});await f.tick();assert.equal(f.nativeCalls.filter(c=>c[0]==='install-update').length,action==='quit'?1:2);assert.equal(f.nativeCalls.some(c=>c[0]==='relaunch'),false);
});
test('parentless recovery rejects a window opened while confirmation is pending',async()=>{
 let f;f=await updateFixture({response:async options=>{if(options.buttons.includes('重试更新')){f.createWindow();await f.windows.at(-1).loadURL('http://127.0.0.1:56789/');return 2;}return 1;}});
 let exits=0;f.app.on('quit',()=>exits++);
 f.updater.quitAndInstall=()=>{f.nativeCalls.push(['install-update']);for(const w of f.windows)w.close();};
 f.updater.emit('update-downloaded',{},'', '0.2.0');await updateCall(f,'restart');await f.tick();f.event({kind:'update-stopped'});f.child.emit('close',0,null);await f.tick();
 f.updater.emit('error',Error('synthetic_install_failure'));await f.tick();f.app.quit();await f.tick();
 assert.equal(f.messages.filter(m=>m.type==='question').at(-1).parent,undefined);assert.equal(f.windows.length,2);assert.equal(exits,0);assert.equal(f.sent.length,1);assert.equal(f.nativeCalls.filter(c=>c[0]==='install-update').length,1);
});
test('ready update requires update-stop acknowledgement plus exit0 and never relaunches twice',async()=>{
 const f=await updateFixture();f.updater.emit('update-downloaded',{},'', '0.2.0');await updateCall(f,'restart');await f.tick();
 assert.deepEqual(f.sent.map(JSON.parse),[{kind:'update-stop'}]);f.app.quit();await f.tick();assert.equal(f.sent.length,1);
 f.event({kind:'stopped'});f.child.emit('close',0,null);await f.tick();assert.equal(f.nativeCalls.some(c=>c[0]==='install-update'),false);
 const ok=await updateFixture();ok.updater.emit('update-downloaded',{},'', '0.2.0');await updateCall(ok,'restart');await ok.tick();
 ok.event({kind:'update-stopped'});await ok.tick();assert.equal(ok.nativeCalls.some(c=>c[0]==='install-update'),false);
 ok.child.emit('close',0,null);await ok.tick();ok.event({kind:'update-stopped'});await ok.tick();assert.deepEqual(ok.nativeCalls.filter(c=>['install-update','relaunch'].includes(c[0])),[['install-update']]);
});
for(const [name,status,signal,ack]of [['exit1',1,null,true],['signal',0,'SIGTERM',true],['missing-ack',0,null,false]])test('update '+name+' does not install or relaunch',async()=>{
 const f=await updateFixture();let exits=0;f.app.on('quit',()=>exits++);f.updater.emit('update-downloaded',{},'', '0.2.0');await updateCall(f,'restart');await f.tick();if(ack)f.event({kind:'update-stopped'});f.child.emit('close',status,signal);await f.tick();
 assert.equal(f.nativeCalls.some(c=>['install-update','relaunch'].includes(c[0])),false);assert.equal((await updateCall(f,'state')).error,'update_service_stopped');
 await updateCall(f,'restart');f.app.quit();await f.tick();assert.equal(exits,0);assert.equal(f.sent.length,1);assert.equal(f.messages.some(m=>m.buttons?.includes('退出荷马')),false);assert.equal(f.nativeCalls.some(c=>c[0]==='install-update'),false);
 f.windows[0].destroyed=true;f.windows[0].contentsDestroyed=true;f.app.quit();await f.tick();assert.equal(exits,0);assert.equal(f.messages.some(m=>m.buttons?.includes('退出荷马')),false);assert.equal(f.nativeCalls.some(c=>c[0]==='install-update'),false);
});
test('busy update leaves service and configuration in place and permits an explicit retry',async()=>{
 const f=await updateFixture();f.updater.emit('update-downloaded',{},'', '0.2.0');await updateCall(f,'restart');await f.tick();f.event({kind:'update-busy'});await f.tick();
 assert.equal((await updateCall(f,'state')).error,'update_busy');assert.equal(f.nativeCalls.some(c=>['install-update','source','disconnect'].includes(c[0])),false);
 await updateCall(f,'restart');await f.tick();assert.equal(f.sent.length,2);
});
test('unsaved edits and timeout never stop or install automatically',async()=>{
 const unsaved=await updateFixture({unsaved:true});unsaved.updater.emit('update-downloaded',{},'', '0.2.0');await updateCall(unsaved,'restart');await unsaved.tick();assert.equal(unsaved.sent.length,0);
 const f=await updateFixture();f.updater.emit('update-downloaded',{},'', '0.2.0');await updateCall(f,'restart');await f.tick();f.timeout();await f.tick();
 f.event({kind:'update-stopped'});f.child.emit('close',0,null);await f.tick();assert.equal(f.nativeCalls.some(c=>c[0]==='install-update'),false);
});
test('Mac stop timeout keeps the original request and requires new confirmation after a late proof',async()=>{
 const f=await updateFixture();f.updater.emit('update-downloaded',{},'', '0.2.0');await updateCall(f,'restart');await f.tick();f.timeout();await f.tick();
 await updateCall(f,'restart');f.app.quit();await f.tick();
 assert.deepEqual(f.sent.map(JSON.parse),[{kind:'update-stop'}]);
 f.event({kind:'update-stopped'});f.child.emit('close',0,null);await f.tick();
 assert.equal(f.nativeCalls.filter(call=>call[0]==='install-update').length,0);
 await updateCall(f,'restart');await f.tick();
 assert.deepEqual(f.sent.map(JSON.parse),[{kind:'update-stop'}]);
 assert.equal(f.nativeCalls.filter(call=>call[0]==='install-update').length,1);
});
test('updater failures never expose native errors or report preparation success',async()=>{
 const f=await updateFixture({checkError:true});assert.equal((await updateCall(f,'state')).status,'error');assert.equal(JSON.stringify(await updateCall(f,'state')).includes('private'),false);
 const malformed=await updateFixture();malformed.updater.emit('update-downloaded',{},'', '<unsafe>');await updateCall(malformed,'restart');await malformed.tick();assert.equal(malformed.sent.length,0);
});
test('update bridge rejects extra arguments and stale or foreign frames',async()=>{
 const f=await updateFixture();for(const method of ['state','check','dismiss','restart']){
  await assert.rejects(()=>updateCall(f,method,'https://foreign.invalid/'),/desktop_update_forbidden/);
  await assert.rejects(()=>f.handlers.get('homer:update:'+method)({...accountEvent(f),senderFrame:{...accountEvent(f).senderFrame}}),/desktop_update_forbidden/);
 }
});

test('desktop access refuses a URL event without a valid private transport credential',async()=>{
 for(const desktopAccessToken of [undefined,null,'short','A'.repeat(64)]){
  const f=await fixture();f.event({kind:'url',url:'http://127.0.0.1:56789/',desktopAccessToken});await f.tick();
  assert.equal(f.windows[0].url,undefined);
  assert.ok(f.messages.some(m=>m.type==='error'));
 }
});
test('desktop access injects only into current main UI requests and strips credentials everywhere else',async()=>{
 const f=await fixture(),origin='http://127.0.0.1:56789',token='a'.repeat(64);
 f.event({kind:'url',url:origin+'/',desktopAccessToken:token});await f.tick();
 const w=f.windows[0],headers=overrides=>{
  let result;f.handlers.get('desktop-request')({url:origin+'/api/history/state',webContents:w.webContents,frame:w.webContents.mainFrame,resourceType:'xhr',initiatorOrigin:origin,requestHeaders:{Accept:'application/json','x-HoMeR-DeSkToP-aCcEsS':'synthetic-forged-header'},...overrides},value=>{result=value.requestHeaders;});
  return Object.fromEntries(Object.entries(result).map(([k,v])=>[k.toLowerCase(),v]));
 };
 assert.equal(headers({})['x-homer-desktop-access'],token);
 assert.equal(headers({url:origin+'/api/media/message-one/asset-00000000-0000-0000-0000-000000000000/1/resource/'+encodeURIComponent('../图%20表.png'),method:'GET'})['x-homer-desktop-access'],token);
 for(const overrides of [
  {url:'https://foreign.invalid/api/history/state'},{url:'http://127.0.0.1:56790/api/history/state'},
  {url:origin+'/preview/interactive'},{url:origin+'/api/history/state?q=1'},{url:'http://user:pass@127.0.0.1:56789/api/history/state'},
  {url:origin+'/api/preview/message-file/open'},{url:origin+'/api/preview/message-file/reveal'},
  {webContents:{}},{frame:null},{frame:{...w.webContents.mainFrame}},
  {initiatorOrigin:'null'},{initiatorOrigin:'https://foreign.invalid'},{initiatorOrigin:undefined},
  {resourceType:'mainFrame'},{resourceType:'subFrame'},
 ])assert.equal(headers(overrides)['x-homer-desktop-access'],undefined);
 await w.loadURL(origin+'/preview/interactive');assert.equal(headers({})['x-homer-desktop-access'],undefined);
 await w.loadURL(origin+'/');assert.equal(headers({})['x-homer-desktop-access'],token);
 f.child.emit('close',1,null);assert.equal(headers({})['x-homer-desktop-access'],undefined);
 assert.equal(JSON.stringify(f.messages).includes(token),false);
});

const accountEvent=f=>({sender:f.windows[0].webContents,senderFrame:f.windows[0].webContents.mainFrame});
const accountCall=(f,name,...args)=>f.handlers.get('homer:account:'+name)(accountEvent(f),...args);
test('real account preload forwards one complete role payload and keeps other account methods zero-argument',async()=>{
 const exposed={},calls=[];
 vm.runInNewContext(readFileSync('packaging/electron/preload.cjs','utf8'),{process:{isMainFrame:true},require:()=>({contextBridge:{exposeInMainWorld:(name,value)=>exposed[name]=value},ipcRenderer:{invoke:async(...args)=>{calls.push(args);return {supported:true};},on(){},removeListener(){}}})});
 const api=exposed.homerDesktopAccount,roles={main:{model:'synthetic-main',effort:'high',serviceTier:null},worker:{model:'synthetic-worker',effort:'low',serviceTier:'priority'}};
 await api.applyCodex(roles);assert.deepEqual(calls.at(-1),['homer:account:applyCodex',roles]);
 await api.applyCodex();assert.deepEqual(calls.at(-1),['homer:account:applyCodex']);
 const count=calls.length;await assert.rejects(api.applyCodex(roles,roles),/arguments/);await assert.rejects(api.state(roles),/arguments/);await assert.rejects(api.nativeModels(roles),/arguments/);assert.equal(calls.length,count);
});
async function accountFixture(native={}){const f=await fixture(['Homer'],undefined,undefined,{adopted:true,published:true,...native});f.event({kind:'url',url:'http://127.0.0.1:56789/',desktopAccessToken:'a'.repeat(64)});await f.tick();return f;}
test('native login uses the private account channel and never exposes its URL or login ID to the page',async()=>{
 const f=await accountFixture({nativeAction:action=>action==='connect'?{account:'none',connected:false,phase:'waiting',loginId:'synthetic-private-id',authUrl:'https://auth.openai.com/synthetic-login'}:{account:'none',connected:false,phase:action==='cancel'?'cancelled':'idle'}});
 const result=await accountCall(f,'nativeConnect');assert.equal(result.native.pending,true);assert.equal(result.native.canReopen,true);
 assert.equal(JSON.stringify(result).includes('synthetic'),false);assert.ok(f.nativeCalls.some(c=>c[0]==='external'&&c[1]==='https://auth.openai.com/synthetic-login'));
 await accountCall(f,'nativeReopen');await accountCall(f,'nativeCancel');assert.equal((await accountCall(f,'state')).native.connected,false);
 assert.deepEqual(f.nonLifecycleCalls.filter(c=>c[0]==='native-account').map(c=>c[1]),['connect','cancel','state']);
 assert.equal(f.nativeCalls.some(c=>c[0]==='source'||c[0]==='disconnect'),false);
});
test('Codex source is saved only after acknowledged owner stop and successful exit',async()=>{
 const f=await accountFixture({nativeState:{account:'chatgpt',connected:true,phase:'idle'}});
 await accountCall(f,'applyCodex');await f.tick();assert.equal(f.nativeCalls.some(c=>c[0]==='source'),false);
 f.event({kind:'stopped'});await f.tick();assert.equal(f.nativeCalls.some(c=>c[0]==='source'),false);
 f.child.emit('close',0,null);await f.tick();
 assert.deepEqual(f.nativeCalls.filter(c=>['source','relaunch','disconnect'].includes(c[0])),[['source','codex'],['relaunch']]);
});
for(const failure of ['cancel','stop','save'])test(`source switch ${failure} retains the previous source`,async()=>{
 const f=await accountFixture({response:failure==='cancel'?0:1,sourceWriteError:failure==='save',nativeState:{account:'chatgpt',connected:true,phase:'idle'}});
 await accountCall(f,'applyCodex');await f.tick();
 if(failure==='stop'){f.timeout();await f.tick();f.event({kind:'stopped'});f.child.emit('close',0,null);await f.tick();}
 if(failure==='save'){f.event({kind:'stopped'});f.child.emit('close',0,null);await f.tick();assert.ok(f.messages.some(m=>m.detail?.includes('原设置已保留')));}
 assert.equal(f.nativeCalls.some(c=>['source','relaunch','disconnect'].includes(c[0])),false);
});
test('Codex startup passes the applied Homer account only through the private host pipe',async()=>{
 const f=await accountFixture({modelSource:'codex',nativeState:{account:'chatgpt',connected:true,phase:'idle'}});
 assert.equal(JSON.parse(f.credentials[0]).token,'synthetic-file-token');const state=await accountCall(f,'state');assert.equal(state.source,'codex');assert.equal(state.connection,'website');assert.equal(state.active,'disconnected');assert.equal(state.needsRestart,false);assert.equal(f.nativeCalls.some(c=>c[0]==='wallet'),false);
 assert.ok((await accountCall(f,'refresh')).wallet);assert.equal(f.nativeCalls.filter(c=>c[0]==='wallet').length,1);
 await accountCall(f,'applyWebsite');await f.tick();f.event({kind:'stopped'});f.child.emit('close',0,null);await f.tick();
 assert.deepEqual(f.nativeCalls.filter(c=>['source','relaunch','disconnect'].includes(c[0])),[['source','website'],['relaunch']]);
});
for(const account of ['none','other','unknown'])test(`native ${account} cannot activate a ChatGPT source`,async()=>{
 const f=await accountFixture({nativeState:{account,connected:false,phase:'idle'}});await accountCall(f,'applyCodex');await f.tick();assert.equal(f.sent.length,0);assert.equal(f.nativeCalls.some(c=>c[0]==='source'),false);
});
test('manual Token cannot enter the runtime, query balance or select website source',async()=>{
 for(const modelSource of ['website','codex']){
  const f=await accountFixture({modelSource,connection:{token:'synthetic-development-key'}});
  assert.deepEqual(f.credentials,['null']);
  const state=await accountCall(f,'state');assert.equal(state.connection,'disconnected');assert.equal(state.websiteReady,false);
  await accountCall(f,'refresh');assert.equal(f.nativeCalls.some(c=>c[0]==='wallet'),false);
  await accountCall(f,'applyWebsite');assert.equal(f.sent.length,0);
 }
});
test('account bridge saves pending connection without changing running Token, and restarts only after stopped ACK and exit',async()=>{
 const f=await accountFixture();
 await accountCall(f,'connect');await f.tick();
 const state=await accountCall(f,'state');assert.equal(state.needsRestart,true);assert.equal(state.connection,'website');assert.equal(state.active,'website');
 assert.equal(JSON.stringify(state).includes('synthetic'),false);assert.equal(f.credentials.length,1);
 await accountCall(f,'restart');await f.tick();assert.deepEqual(f.sent,['{"kind":"quit"}\n']);assert.equal(f.nativeCalls.some(c=>c[0]==='relaunch'),false);
 f.event({kind:'stopped'});await f.tick();assert.equal(f.nativeCalls.some(c=>c[0]==='relaunch'),false);
 f.child.emit('close',0,null);await f.tick();assert.equal(f.nativeCalls.filter(c=>c[0]==='relaunch').length,1);
});
for(const action of ['restart','disconnect'])test(`account ${action} confirmation explains data retention and a cancellation changes no credential`,async()=>{
 const f=await accountFixture({response:0});await accountCall(f,action);await f.tick();
 const prompt=f.messages.at(-1);assert.match(prompt.detail,/保留历史对话、任务和文件/);
 if(action==='disconnect'){assert.equal(prompt.message,'退出本机登录？');assert.match(prompt.detail,/不会注销网站账号/);}else assert.equal(prompt.message,'重启荷马？');
 assert.equal(f.sent.length,0);assert.equal(f.nativeCalls.some(c=>['disconnect','relaunch'].includes(c[0])),false);
});
test('cancelled exit and unconfirmed stop never clear credentials or relaunch',async()=>{
 const f=await accountFixture({response:0});await accountCall(f,'disconnect');await f.tick();
 assert.equal(f.sent.length,0);assert.equal(f.nativeCalls.some(c=>c[0]==='disconnect'),false);
 const g=await accountFixture();await accountCall(g,'disconnect');await g.tick();g.timeout();await g.tick();
 assert.equal(g.nativeCalls.some(c=>['disconnect','relaunch'].includes(c[0])),false);
});
test('confirmed disconnect clears local Key only after owner stop, then relaunches offline',async()=>{
 const f=await accountFixture();await accountCall(f,'disconnect');await f.tick();
 assert.equal(f.nativeCalls.some(c=>c[0]==='disconnect'),false);
 f.event({kind:'stopped'});f.child.emit('close',0,null);await f.tick();
 assert.deepEqual(f.nativeCalls.filter(c=>['disconnect','relaunch'].includes(c[0])),[['disconnect'],['relaunch']]);
});
for(const action of ['restart','disconnect'])test(`Codex account ${action} preserves the applied channel account until confirmed stop`,async()=>{
 const f=await accountFixture({modelSource:'codex',response:0});
 const applied=f.credentials[0];await accountCall(f,'connect');await f.tick();
 assert.equal((await accountCall(f,'state')).needsRestart,true);
 await accountCall(f,action);await f.tick();assert.deepEqual(f.credentials,[applied]);
 assert.equal(f.sent.length,0);assert.equal(f.nativeCalls.some(c=>['disconnect','relaunch'].includes(c[0])),false);
});
test('account methods reject arguments, foreign frames, and responses after navigation',async()=>{
 const f=await accountFixture();for(const name of ['state','connect','cancel','reopen','refresh','openWebsite','disconnect','restart','nativeConnect','nativeCancel','nativeReopen','applyCodex','applyWebsite']){
  await assert.rejects(()=>accountCall(f,name,...(name==='applyCodex'?['extra','extra']:['extra'])),/desktop_account_forbidden/);
  await assert.rejects(()=>f.handlers.get('homer:account:'+name)({sender:{},senderFrame:f.windows[0].webContents.mainFrame}),/desktop_account_forbidden/);
 }
 let settle;const g=await accountFixture({wallet:()=>new Promise(r=>settle=r)});const pending=accountCall(g,'refresh');
 await g.tick();await g.windows[0].loadURL('http://127.0.0.1:56789/preview/x');settle({available:1,used:1,unit:'额度'});
 await assert.rejects(pending,/desktop_account_forbidden/);
});
for(const error of [undefined,'UNAVAILABLE','CONNECTION_WRITE_FAILED'])test(`website authorization completion presents final account state and focuses Homer: ${error??'success'}`,async()=>{
 let finish;
 const f=await accountFixture({authorize:()=>new Promise((resolve,reject)=>{finish=()=>error?reject(Error(error)):resolve({...websiteConnection(),token:'synthetic-new-token'});})});
 await accountCall(f,'connect');await f.tick();
 const w=f.windows[0];w.hide();w.focused=false;
 let stateAtFocus;w.focus=()=>{w.focused=true;stateAtFocus=accountCall(f,'state');};
 assert.equal((await accountCall(f,'state')).pending,true);
 finish();await f.tick();
 assert.equal(w.hidden,false);assert.equal(w.focused,true);
 const state=await stateAtFocus;assert.equal(state.pending,false);assert.equal(state.canReopen,false);assert.equal(state.error,error);
 if(!error)assert.equal(state.needsRestart,true);
 assert.equal(f.nativeCalls.filter(c=>c[0]==='external').length,0);
});
for(const boundary of ['cancel','replacement','quit'])test(`late website authorization cannot publish or focus after ${boundary}`,async()=>{
 for(const error of [undefined,'UNAVAILABLE']){
  let finish,started=0,finishQuit,signal;
  const f=await accountFixture({authorize:options=>{signal=options.signal;return ++started===1?new Promise((resolve,reject)=>{finish=()=>error?reject(Error(error)):resolve({...websiteConnection(),token:'synthetic-late-token'});}):new Promise(()=>{});},response:()=>new Promise(resolve=>{finishQuit=resolve;})});
  await accountCall(f,'connect');await f.tick();
  if(boundary==='cancel')await accountCall(f,'cancel');
  else if(boundary==='replacement')await accountCall(f,'connect');
  else {f.app.quit();assert.equal(signal.aborted,true);}
  const w=f.windows[0];w.hide();w.focused=false;
  const before=await accountCall(f,'state'),messages=w.settingsMessages.length;
  finish();await f.tick();
  assert.equal(w.hidden,true);assert.equal(w.focused,false);assert.deepEqual(await accountCall(f,'state'),before);
  assert.equal(w.settingsMessages.length,messages);
  await accountCall(f,'cancel');finishQuit?.(0);await f.tick();
 }
});
test('reopening a pending login uses the same private authorization and stops after callback or cancellation',async()=>{
 let options,complete;const login=new Promise(resolve=>complete=resolve);
 const f=await accountFixture({authorize:async value=>{options=value;await value.openBrowser('https://website.example.invalid/homer?state=synthetic');return login;}});
 await accountCall(f,'connect');await f.tick();
 assert.equal((await accountCall(f,'state')).pending,true);
 await accountCall(f,'reopen');assert.deepEqual(f.nativeCalls.filter(c=>c[0]==='external').map(c=>c[1]),['https://website.example.invalid/homer?state=synthetic','https://website.example.invalid/homer?state=synthetic']);
 assert.equal(JSON.stringify(await accountCall(f,'state')).includes('synthetic'),false);
 options.onCallback();await accountCall(f,'reopen');assert.equal(f.nativeCalls.filter(c=>c[0]==='external').length,2);
 await accountCall(f,'cancel');await accountCall(f,'reopen');assert.equal(f.nativeCalls.filter(c=>c[0]==='external').length,2);complete(websiteConnection());
});
test('a balance read started during website authorization cannot publish the previous Token balance',async()=>{
 let authorize,finishWallet,reads=0;
 const f=await accountFixture({modelSource:'codex',authorize:()=>new Promise(r=>authorize=r),wallet:()=>++reads===1?new Promise(r=>finishWallet=r):Promise.resolve({available:999,used:0,unit:'old'})});
 await accountCall(f,'connect');await f.tick();
 const pending=accountCall(f,'refresh');await f.tick();
 authorize({...websiteConnection(),token:'synthetic-new-token'});await f.tick();
 finishWallet({available:999,used:0,unit:'old'});await pending;
 const state=await accountCall(f,'state');assert.equal(state.wallet,undefined);assert.equal(state.stale,true);assert.equal(state.source,'codex');
});
test('wallet refresh merges concurrent reads and runtime events only expose invalidation',async()=>{
 let settle;const f=await accountFixture({wallet:()=>new Promise(r=>settle=r)});
 const a=accountCall(f,'refresh'),b=accountCall(f,'refresh');await f.tick();assert.equal(f.nativeCalls.filter(c=>c[0]==='wallet').length,1);
 settle({available:0,used:2,unit:'额度'});const states=await Promise.all([a,b]);assert.equal(states[0].wallet.available,0);
 f.event({kind:'account_usage_dirty',text:'must-not-forward'});await f.tick();assert.ok(f.windows[0].settingsMessages.some(([name,value])=>name==='homer:account:changed'&&value===undefined));
});

test('wallet refresh notifies existing account views on success and failure without exposing balances',async()=>{
 let fail=false;const f=await accountFixture({wallet:async()=>{if(fail)throw Error('USAGE_UNAVAILABLE');return {available:10,used:0,unit:'积分'};}});
 f.windows[0].settingsMessages.length=0;
 await accountCall(f,'refresh');
 assert.ok(f.windows[0].settingsMessages.some(([name,value])=>name==='homer:account:changed'&&value===undefined));
 f.windows[0].settingsMessages.length=0;fail=true;
 await accountCall(f,'refresh');
 assert.ok(f.windows[0].settingsMessages.some(([name,value])=>name==='homer:account:changed'&&value===undefined));
});

const websiteConnection=()=>({token:'synthetic-account-token',subject:'fixture_user',selection:defaultSelection});
for(const modelSource of ['website','codex'])test('startup migrates the cached identity and sends one selected pair through FD3 in '+modelSource+' mode',async()=>{
 const api=await import('../src/homer-account.ts');
 const parent=resolve('.codex/scratch/member-model-selection/shell');mkdirSync(parent,{recursive:true});
 const root=realpathSync(mkdtempSync(join(parent,'synthetic-'))),file=join(root,'runtime-config.json'),history=join(root,'history.txt');
 const identity={subject:'fixture_user',token:'synthetic-retained-key'},boundary={gatewayOrigin:'https://models.super-tree.com'};
 const legacy={baseUrl:boundary.gatewayOrigin+'/v1',model:'deepseek-flash',effort:'max',fast:false};
 writeFileSync(file,JSON.stringify({...identity,config:{main:legacy,worker:legacy}}),{mode:0o600});
 writeFileSync(history,'synthetic existing history');
 const alternate={main:defaultSelection.worker,worker:defaultSelection.main};
 let wire=alternate,status=200,reads=0;
 const server=createServer((req,res)=>{
  reads++;assert.equal(req.url,'/api/homer/v1/config');assert.equal(req.headers['x-homer-config-version'],'2');
  assert.equal(req.headers.authorization,undefined);res.writeHead(status).end(JSON.stringify(wire));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const accountApi={...api,queryHomerWallet:async()=>{throw Error('USAGE_UNAVAILABLE');},readHomerConnection:()=>api.readHomerConnection(file,boundary),
  queryHomerMemberSelection:(_options,signal)=>api.queryHomerMemberSelection({websiteOrigin:'http://127.0.0.1:'+server.address().port,allowSyntheticLoopback:true},signal)};
 try{
  for(const [body,responseStatus,expected]of [[alternate,200,alternate],[null,503,defaultSelection],[{main:legacy,worker:legacy},200,defaultSelection],[{...alternate,worker:{model:'deepseek-flash',effort:'medium'}},200,defaultSelection],[alternate,200,alternate]]){
   wire=body;status=responseStatus;const before=reads;
   const f=await fixture(['Homer'],undefined,undefined,{adopted:true,published:true,modelSource,accountApi});
   for(let i=0;i<300&&!f.credentials.length;i++)await new Promise(r=>setTimeout(r,5));
   assert.deepEqual(f.credentials.map(JSON.parse),[{...identity,selection:expected}]);assert.equal(reads,before+1);
   f.event({kind:'url',url:'http://127.0.0.1:56789/',desktopAccessToken:'a'.repeat(64)});await f.tick();
   const state=await accountCall(f,'state');assert.equal(state.websiteReady,true);assert.equal(state.needsRestart,false);assert.equal(state.active,modelSource==='website'?'website':'disconnected');
   assert.deepEqual(JSON.parse(readFileSync(file)),identity);assert.equal(statSync(file).mode&0o777,0o600);
   f.advance(3600001);f.event({kind:'account_config_check'});await f.tick();assert.equal(reads,before+1);
   assert.deepEqual(f.credentials.map(JSON.parse),[{...identity,selection:expected}]);
   f.app.quit();await f.tick();f.event({kind:'stopped'});f.child.emit('close',0,null);await f.tick();
  }
  assert.equal(readFileSync(history,'utf8'),'synthetic existing history');
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));rmSync(root,{recursive:true,force:true});}
});
test('login takes its exchange pair once, then a new desktop uses its own startup GET pair',async()=>{
 const alternate={main:defaultSelection.worker,worker:defaultSelection.main};
 let stored=null;
 const accountApi={readHomerConnection:()=>stored,authorizeHomerConnection:async()=>{
  const {subject,token}=websiteConnection();stored={subject,token};
  return {...stored,selection:alternate};
 }};
 const f=await accountFixture({accountApi});
 await accountCall(f,'connect');await f.tick();
 const state=await accountCall(f,'state');assert.equal(state.websiteReady,true);assert.equal(state.needsRestart,true);
 assert.deepEqual(f.credentials,['null']);assert.equal(f.nativeCalls.filter(c=>c[0]==='config').length,0);
 await accountCall(f,'restart');await f.tick();f.event({kind:'stopped'});f.child.emit('close',0,null);await f.tick();
 assert.ok(f.nativeCalls.some(call=>call[0]==='relaunch'));
 const next=await accountFixture({accountApi,config:()=>defaultSelection});
 assert.equal(next.nativeCalls.filter(c=>c[0]==='config').length,1);
 assert.deepEqual(next.credentials.map(JSON.parse),[{...stored,selection:defaultSelection}]);
 const active=await accountCall(next,'state');assert.equal(active.websiteReady,true);assert.equal(active.needsRestart,false);
});
const permissionChannels=['check','prompt-accessibility','open-system-settings'].map(name=>'homer:desktop-permissions:'+name);
const plain=value=>JSON.parse(JSON.stringify(value));
test('retired manual Token launch flags never prompt or spawn a backend',async()=>{
 for(const args of [
  ['Homer','--deepseek-profile','/synthetic/deepseek'],
  ['Homer','--test-profile','/synthetic/test','--deepseek'],
 ]){const f=await fixture(args);assert.equal(f.spawnCount(),0);assert.deepEqual(f.credentials,[]);}
});
const permissionEvent=f=>({sender:f.windows[0].webContents,senderFrame:f.windows[0].webContents.mainFrame});
test('desktop location settings use fixed native destinations',async()=>{
 for(const [platform,url] of [['darwin','x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_LocationServices'],['win32','ms-settings:privacy-location']]){
  const f=await permissionFixture();f.setPlatform(platform);
  const open=f.handlers.get(permissionChannels[2]);
  await assert.rejects(()=>open(permissionEvent(f),'location','https://example.invalid'),/desktop_permissions_forbidden/);
  assert.deepEqual(f.nonLifecycleCalls,[]);
  assert.deepEqual(plain(await open(permissionEvent(f),'location')),{ok:true});
  assert.deepEqual(f.nonLifecycleCalls,[['external',url]]);
 }
});
const powerFacts=patch=>({runtimeAvailable:true,executing:false,displayRequired:false,nextScheduledAt:null,channels:[],...patch});
test('Windows task wake keeps the passive channel check while the computer is already awake',async()=>{
 const f=await fixture(undefined,undefined,'win32');
 f.event({kind:'power_state',facts:powerFacts({})});await f.tick();f.options.onPowerWake();await f.tick();
 const call=f.sent.map(line=>JSON.parse(line)).find(x=>x.kind==='power_resume');assert.ok(call);assert.equal(call.afterSleep,false);
 f.event({kind:'power_result',id:call.id});await f.tick();f.child.emit('close',1,null);await f.tick();
});
for(const source of ['native','electron'])test('actual '+source+' Mac wake reaches the runtime once and retains preparation protection until its matching reply',async()=>{
 const f=await permissionFixture();
 f.event({kind:'power_state',facts:powerFacts({})});await f.tick();
 if(source==='native')f.options.onPowerWake();else f.powerMonitor.emit('resume');
 f.powerMonitor.emit('resume');await f.tick();
 const calls=f.sent.map(line=>JSON.parse(line)).filter(x=>x.kind==='power_resume');assert.equal(calls.length,1);
 assert.equal(calls[0].afterSleep,true);assert.ok(f.powerLocks.size>0);
 f.event({kind:'power_result',id:calls[0].id+100});await f.tick();assert.ok(f.powerLocks.size>0);
 f.event({kind:'power_result',id:calls[0].id});await f.tick();await f.tick();assert.equal(f.powerLocks.size,0);
 f.child.emit('close',1,null);await f.tick();
});
for(const platform of ['darwin','win32'])test('optional wake adapter construction cannot prevent startup or execution protection: '+platform,async()=>{
 const f=await fixture(undefined,undefined,platform,{powerConstructorError:true});
 assert.equal(f.spawnCount(),1);
 f.event({kind:'url',url:'http://127.0.0.1:56789/',desktopAccessToken:'a'.repeat(64)});await f.tick();
 f.event({kind:'power_acquire',id:31,facts:powerFacts({executing:true,nextScheduledAt:Date.now()+600_000})});await f.tick();
 const state=await f.handlers.get('homer:power:state')(permissionEvent(f));
 assert.equal(state.protection,'system');assert.equal(state.wake.status,'unavailable');
 assert.equal(state.preferences.wakeScheduled,true);
 assert.ok(f.sent.some(line=>JSON.parse(line).kind==='power_ack'&&JSON.parse(line).id===31));
 assert.equal(f.nativeCalls.some(call=>call[0]==='power-schedule'||call[0]==='power-authorize'),false);
 f.child.emit('close',1,null);await f.tick();assert.equal(f.powerLocks.size,0);
});
test('malformed saved power identity cannot block the normal desktop host',async()=>{
 const f=await permissionFixture({powerConfig:{instanceId:['a'.repeat(64)],preferences:{keepAwake:false,pollMessages:true,wakeScheduled:true,pollIntervalMinutes:15}}});
 assert.equal(f.spawnCount(),1);
 const state=await f.handlers.get('homer:power:state')(permissionEvent(f));assert.equal(state.wake.error,'power_preferences_unconfirmed');
 f.child.emit('close',1,null);await f.tick();
});

test('power preferences cannot turn a Mac recovery hash into a trusted update identity',async()=>{
 const preferences={keepAwake:false,pollMessages:true,wakeScheduled:true,pollIntervalMinutes:15};
 const recoveryId=createHash('sha256').update('homer-power-recovery:/synthetic/user/Library/Application Support/Homer Desktop').digest('hex');
 for(const instanceId of ['invalid',recoveryId]){
  const powerConfig={instanceId,preferences};
  const f=await updateFixture({powerConfig});
  await assert.rejects(()=>f.handlers.get('homer:power:update')(accountEvent(f),{keepAwake:true}),/power_preferences_unconfirmed/);
  assert.equal(f.options.powerConfig,powerConfig);
  f.updater.emit('update-downloaded',{},'','0.2.0');await updateCall(f,'restart');await f.tick();
  assert.deepEqual(f.sent,[]);
 }
});
test('the first actual wake demand offers authorization once and remembers postponement',async()=>{
 const response=options=>options.message==='允许 Homer 请求系统唤醒？'?0:1;
 const f=await permissionFixture({powerAuthorization:'required',response});
 assert.equal(f.messages.some(message=>message.message==='允许 Homer 请求系统唤醒？'),false);
 f.event({kind:'power_state',facts:powerFacts({nextScheduledAt:Date.now()+600_000})});await f.tick();
 assert.equal(f.messages.filter(message=>message.message==='允许 Homer 请求系统唤醒？').length,1);
 assert.equal(f.options.powerConfig.authorizationAsked,true);assert.equal(f.nativeCalls.some(call=>call[0]==='power-authorize'),false);
 f.event({kind:'power_state',facts:powerFacts({nextScheduledAt:Date.now()+300_000})});await f.tick();
 assert.equal(f.messages.filter(message=>message.message==='允许 Homer 请求系统唤醒？').length,1);
 const next=await permissionFixture({powerAuthorization:'required',powerConfig:f.options.powerConfig,response});
 next.event({kind:'power_state',facts:powerFacts({nextScheduledAt:Date.now()+600_000})});await next.tick();
 assert.equal(next.messages.some(message=>message.message==='允许 Homer 请求系统唤醒？'),false);
 f.child.emit('close',1,null);next.child.emit('close',1,null);await f.tick();await next.tick();
});
for(const failure of [false,true])test('macOS update cleans the authorized power helper before replacing the app '+failure,async()=>{
 const f=await updateFixture({powerUpdateError:failure});
 f.updater.emit('update-downloaded',{},'','0.2.0');await updateCall(f,'restart');await f.tick();
 f.event({kind:'update-stopped'});f.child.emit('close',0,null);await f.tick();
 const names=f.nativeCalls.map(call=>call[0]);
 assert.ok(names.includes('power-update-cleanup'));
 assert.ok(names.indexOf('power-close')<names.indexOf('power-update-cleanup'));
 assert.equal(names.includes('install-update'),!failure);
 if(failure)assert.equal((await updateCall(f,'state')).error,'update_power_cleanup_unconfirmed');
});
test('quitting a staged Mac update retries native cleanup and cannot bypass a prior cleanup failure',async()=>{
 const f=await updateFixture({powerUpdateError:true,response:options=>options.message==='更新尚未确认，如何继续？'?2:1});let exits=0;f.app.on('quit',()=>{exits++;});
 f.updater.emit('update-downloaded',{},'','0.2.0');await updateCall(f,'restart');await f.tick();
 f.event({kind:'update-stopped'});f.child.emit('close',0,null);await f.tick();
 assert.equal((await updateCall(f,'state')).error,'update_power_cleanup_unconfirmed');
 f.app.quit();await f.tick();assert.equal(exits,0);
 assert.equal(f.nativeCalls.filter(call=>call[0]==='power-update-cleanup').length,2);
 f.options.powerUpdateError=false;f.app.quit();await f.tick();assert.equal(exits,1);
 assert.equal(f.nativeCalls.filter(call=>call[0]==='power-update-cleanup').length,3);
 assert.equal(f.nativeCalls.some(call=>call[0]==='install-update'),false);
});
test('an unreachable macOS wake helper blocks update before stopping the runtime',async()=>{
 const f=await updateFixture({powerStatus:()=>({supported:false,authorization:'unavailable',reason:'macos_power_connection_failed'})});
 f.updater.emit('update-downloaded',{},'','0.2.0');await updateCall(f,'restart');await f.tick();
 assert.equal(f.sent.length,0);
 assert.equal((await updateCall(f,'state')).error,'update_power_cleanup_unconfirmed');
});
test('retry after macOS wake close failure keeps the runtime stop proof',async()=>{
 let failed=true;
 const f=await updateFixture({powerClose:()=>{if(failed)throw Error('macos_power_connection_failed');return true;}});
 f.updater.emit('update-downloaded',{},'','0.2.0');await updateCall(f,'restart');await f.tick();
 f.event({kind:'update-stopped'});f.child.emit('close',0,null);await f.tick();
 assert.equal(f.nativeCalls.some(call=>call[0]==='install-update'),false);
 failed=false;
 await updateCall(f,'restart');await f.tick();
 assert.deepEqual(f.sent.map(JSON.parse),[{kind:'update-stop'}]);
 assert.equal(f.nativeCalls.filter(call=>call[0]==='power-close').length,2);
 assert.equal(f.nativeCalls.filter(call=>call[0]==='install-update').length,1);
});
test('the runtime stop timeout ends before macOS wake cleanup begins',async()=>{
 let finishClose;
 const f=await updateFixture({powerClose:()=>new Promise(resolve=>{finishClose=()=>resolve(true);})});
 f.updater.emit('update-downloaded',{},'','0.2.0');await updateCall(f,'restart');await f.tick();
 f.event({kind:'update-stopped'});f.child.emit('close',0,null);await f.tick();
 f.runTimers(20_001);await f.tick();
 assert.equal((await updateCall(f,'state')).error,undefined);
 finishClose();await f.tick();
 assert.equal(f.nativeCalls.filter(call=>call[0]==='install-update').length,1);
});
test('staged Mac update quit rechecks its caller after asynchronous native cleanup',async()=>{
 const f=await updateFixture({powerUpdateError:true,response:options=>options.message==='更新尚未确认，如何继续？'?2:1});let exits=0;f.app.on('quit',()=>{exits++;});
 f.updater.emit('update-downloaded',{},'','0.2.0');await updateCall(f,'restart');await f.tick();
 f.event({kind:'update-stopped'});f.child.emit('close',0,null);await f.tick();
 let release;f.options.powerUpdateError=false;f.options.powerUpdatePending=new Promise(resolve=>{release=resolve;});
 f.app.quit();await f.tick();assert.equal(exits,0);
 await f.windows[0].loadURL('http://127.0.0.1:56789/');release();await f.tick();
 assert.equal(exits,0);assert.equal(f.nativeCalls.some(call=>call[0]==='install-update'),false);
});
test('unavailable native wake cleanup prevents replacing the Mac helper while ordinary startup remains usable',async()=>{
 const f=await updateFixture({powerConstructorError:true});
 assert.equal(f.spawnCount(),1);
 f.updater.emit('update-downloaded',{},'','0.2.0');await updateCall(f,'restart');await f.tick();
 assert.equal(f.sent.length,0);
 assert.equal(f.nativeCalls.some(call=>call[0]==='install-update'),false);
 assert.equal((await updateCall(f,'state')).error,'update_power_cleanup_unconfirmed');
});
test('desktop power IPC restricts settings to the trusted page and acknowledges protection before native wake work',async()=>{
 const f=await permissionFixture(),event=permissionEvent(f),state=f.handlers.get('homer:power:state'),update=f.handlers.get('homer:power:update');
 assert.equal(typeof state,'function');assert.equal(typeof update,'function');
 await assert.rejects(()=>state({...event,senderFrame:{...event.senderFrame}}),/desktop_power_forbidden/);
 await assert.rejects(()=>update(event,{keepAwake:true,command:'unsafe'}),/power_preferences_invalid/);
 f.event({kind:'power_acquire',id:17,facts:powerFacts({executing:true})});
 assert.equal(f.powerLocks.size,1);assert.ok(f.sent.some(line=>JSON.parse(line).kind==='power_ack'&&JSON.parse(line).id===17));
 const at=Math.ceil((Date.now()+600_000)/1000)*1000;
 f.event({kind:'power_state',facts:powerFacts({executing:true,nextScheduledAt:at})});await f.tick();
 await update(event,{keepAwake:true,pollMessages:false});assert.equal(f.wakeEvents.length,1);
 assert.equal(f.options.powerConfig.preferences.keepAwake,true);
 assert.equal(f.nativeCalls.some(call=>call[0]==='power-authorize'),false);
 f.child.emit('close',1,null);await f.tick();assert.equal(f.powerLocks.size,0);assert.equal(f.wakeEvents.length,0);
});
test('a failed preference save cannot apply unsaved power changes',async()=>{
 const f=await permissionFixture({powerWriteError:true}),event=permissionEvent(f),update=f.handlers.get('homer:power:update');
 assert.equal(typeof update,'function');
 await assert.rejects(()=>update(event,{keepAwake:true}),/power_preferences_unconfirmed/);
 assert.equal(f.powerLocks.size,0);
});
test('desktop power preload forwards fixed actions without exposing Electron events',async()=>{
 const exposed={},calls=[],listeners=new Map();
 vm.runInNewContext(readFileSync('packaging/electron/preload.cjs','utf8'),{process:{isMainFrame:true},require:()=>({contextBridge:{exposeInMainWorld:(name,api)=>exposed[name]=api},ipcRenderer:{invoke:async(...args)=>{calls.push(args);},on:(name,listener)=>listeners.set(name,listener),removeListener:(name,listener)=>{assert.equal(listeners.get(name),listener);listeners.delete(name);}}})});
 const api=exposed.homerDesktopPower;assert.ok(api);
 await api.state();await api.update({keepAwake:true});await api.authorize();
 assert.deepEqual(calls,[['homer:power:state'],['homer:power:update',{keepAwake:true}],['homer:power:authorize']]);
 await assert.rejects(api.state('extra'),/arguments/);await assert.rejects(api.update({},{}),/arguments/);
 let count=0;const off=api.onChanged((...args)=>{assert.deepEqual(args,[]);count++;});listeners.get('homer:power:changed')({secret:true});assert.equal(count,1);off();assert.equal(listeners.size,0);
});
async function permissionFixture(native){const f=await fixture(undefined,undefined,undefined,native);f.event({kind:'url',url:'http://127.0.0.1:56789/',desktopAccessToken:'a'.repeat(64)});await f.tick();return f;}
test('startup and replacement navigation cancellation remain in the full audit without OS actions',async()=>{
 const f=await fixture();assert.deepEqual(f.allNativeCalls,[]);
 const cancel=['native-account','channel-manage',{action:'cancel',input:{}}];
 f.event({kind:'url',url:'http://127.0.0.1:56789/',desktopAccessToken:'a'.repeat(64)});await f.tick();
 assert.deepEqual(f.allNativeCalls,[cancel]);assert.deepEqual(f.channelLifecycleCalls,[cancel]);assert.deepEqual(f.nonLifecycleCalls,[]);
 const sender=f.windows[0].webContents,before=f.allNativeCalls.slice();
 await assert.rejects(f.handlers.get('homer:chat-apps')({sender,senderFrame:sender.mainFrame},'cancel',{}),/desktop_channels_arguments/);
 await assert.rejects(f.handlers.get('homer:chat-apps')({sender,senderFrame:{...sender.mainFrame}},'cancel',{id:'untrusted'}),/desktop_channels_forbidden/);
 assert.deepEqual(f.allNativeCalls,before);
 f.createWindow();await f.windows[1].loadURL('about:blank');await f.tick();
 assert.deepEqual(f.allNativeCalls,[cancel,cancel]);assert.deepEqual(f.channelLifecycleCalls,[cancel,cancel]);assert.deepEqual(f.nonLifecycleCalls,[]);
});
const settingsItem=f=>f.handlers.get('menu')[0].submenu.find(item=>item.label==='设置…');
const settingsReady=(f,w=f.windows.at(-1),...args)=>f.handlers.get('homer:settings:ready')({sender:w.webContents,senderFrame:w.webContents.mainFrame},...args);
test('desktop about reads the running app version only from the trusted main page',async()=>{
 const f=await permissionFixture(),event=permissionEvent(f),version=f.handlers.get('homer:settings:version');
 assert.equal(await version(event),'0.1.0');
 await assert.rejects(()=>version(event,'extra'),/desktop_settings_forbidden/);
 await assert.rejects(()=>version({...event,senderFrame:{...event.senderFrame}}),/desktop_settings_forbidden/);
});
test('desktop about opens only the three product links from the trusted main page',async()=>{
 let unavailable=false;
 const f=await permissionFixture({external:async()=>{if(unavailable)throw Error('private_browser_detail');}});
 const event=permissionEvent(f),open=f.handlers.get('homer:settings:open-about-link');
 await assert.rejects(()=>open(event,'https://example.invalid/'),/desktop_settings_forbidden/);
 await assert.rejects(()=>open(event,'website','github'),/desktop_settings_forbidden/);
 await assert.rejects(()=>open({...event,senderFrame:{...event.senderFrame}},'github'),/desktop_settings_forbidden/);
 assert.deepEqual(f.nativeCalls.filter(call=>call[0]==='external'),[]);
 await open(event,'website');
 await open(event,'github');
 await open(event,'issue');
 assert.deepEqual(f.nativeCalls.filter(call=>call[0]==='external'),[
  ['external','https://super-tree.com/homer'],
  ['external','https://github.com/wolf3c/homer'],
  ['external','https://github.com/wolf3c/homer/issues/new?template=bug_report.yml'],
 ]);
 unavailable=true;
 await assert.rejects(()=>open(event,'website'),error=>error.message==='desktop_settings_link_unavailable');
});
test('desktop feature tour dismissal survives a different origin and is scoped to the profile',async t=>{
 mkdirSync(resolve('.codex/scratch'),{recursive:true});
 const parent=mkdtempSync(resolve('.codex/scratch/desktop-feature-tour-'));
 t.after(()=>rmSync(parent,{recursive:true,force:true}));
 const profile=join(parent,'profile'),other=join(parent,'other');
 for(const path of [profile,other])mkdirSync(path);
 const boot=async (path,port)=>{
  const f=await fixture(['Homer','--test-profile',path]);
  f.event({kind:'url',url:`http://127.0.0.1:${port}/`,desktopAccessToken:'a'.repeat(64)});await f.tick();return f;
 };
 const action=(f,name)=>f.handlers.get('homer:feature-tour:'+name);
 const first=await boot(profile,56789),event=accountEvent(first);
 const dismiss=action(first,'dismiss');
 assert.equal(await action(first,'pending')(event),true);
 await assert.rejects(()=>dismiss(event,'arbitrary-file'),/desktop_feature_tour_forbidden/);
 await assert.rejects(()=>dismiss({...event,senderFrame:{...event.senderFrame}}),/desktop_feature_tour_forbidden/);
 assert.equal(await action(first,'pending')(event),true);
 await Promise.all([dismiss(event),dismiss(event)]);
 assert.equal(await action(first,'pending')(event),false);
 const reopened=await boot(profile,56790),separate=await boot(other,56791);
 assert.equal(await action(reopened,'pending')(accountEvent(reopened)),false);
 assert.equal(await action(separate,'pending')(accountEvent(separate)),true);
});
test('explicit daily DeepSeek entry uses only an adopted profile and forwards a private token',async()=>{
 const f=await fixture(['Homer','--deepseek-daily'],undefined,undefined,{adopted:true,published:true});
 assert.equal(f.spawnCount(),1);assert.ok(f.launches[0].args.includes('--deepseek-daily'));
 assert.equal(JSON.parse(f.credentials[0]).token,'synthetic-file-token');
 assert.deepEqual(f.tokenFiles,['/synthetic/original-app/runtime-config.json']);
 assert.equal(JSON.stringify(f.launches).includes('synthetic-file-token'),false);
 const rejected=await fixture(['Homer','--deepseek-daily'],undefined,undefined,{published:true});assert.equal(rejected.spawnCount(),1);
});
test('ordinary adopted desktop launch selects DeepSeek; explicit native rollback keeps the original provider',async()=>{
 const daily=await fixture(['Homer'],undefined,undefined,{adopted:true,published:true});
 assert.ok(daily.launches[0].args.includes('--deepseek-daily'));
 assert.deepEqual(daily.tokenFiles,['/synthetic/original-app/runtime-config.json']);
 const native=await fixture(['Homer','--native'],undefined,undefined,{adopted:true,published:true});
 assert.equal(native.launches[0].args.includes('--deepseek-daily'),false);
});
test('invalid daily token file opens management mode without a model credential',async()=>{
 const f=await fixture(['Homer'],undefined,undefined,{adopted:true,published:true,invalidTokenFile:true});
 assert.equal(f.spawnCount(),1);assert.deepEqual(f.credentials,['null']);
});
for(const platform of ['darwin','win32'])test('application menu opens settings without a model connection dialog on '+platform,async()=>{
 const f=await fixture(['Homer'],undefined,platform,{adopted:true,published:true});
 assert.ok(!f.handlers.get('menu')[0].submenu.some(item=>item.label==='模型连接信息…'));
 const w=f.windows[0],item=settingsItem(f);assert.ok(item);assert.equal(item.accelerator,'CmdOrCtrl+,');
 w.hide();w.minimized=true;item.click();item.click();assert.equal(w.hidden,false);assert.equal(w.minimized,false);assert.equal(w.focused,true);assert.equal(f.windows.length,1);assert.equal(w.settingsMessages.length,0);
 f.event({kind:'url',url:'http://127.0.0.1:56789/',desktopAccessToken:'a'.repeat(64)});await f.tick();await settingsReady(f,w,true);assert.deepEqual(w.settingsMessages,[['homer:settings:open']]);
 item.click();assert.equal(w.settingsMessages.length,2);await settingsReady(f,w,false);item.click();assert.equal(w.settingsMessages.length,2);await settingsReady(f,w,true);assert.equal(w.settingsMessages.length,3);
});
test('settings recreates only a missing primary window and rejects foreign readiness',async()=>{
 const f=await permissionFixture(),old=f.windows[0];old.destroyed=true;settingsItem(f).click();await f.tick();const w=f.windows[1];assert.ok(w);assert.equal(w.url,'http://127.0.0.1:56789/');
 await assert.rejects(()=>settingsReady(f,old,true),/desktop_settings_forbidden/);await settingsReady(f,w,true);assert.deepEqual(w.settingsMessages,[['homer:settings:open']]);assert.equal(old.settingsMessages.length,0);assert.equal(f.spawnCount(),1);
 for(const args of [[],['true'],[true,'extra']])await assert.rejects(()=>settingsReady(f,w,...args),/desktop_settings_forbidden/);
});
test('settings readiness is revoked by navigation and rejects preview and subframe',async()=>{
 const f=await permissionFixture(),w=f.windows[0];await settingsReady(f,w,true);await w.loadURL('http://127.0.0.1:56789/preview/interactive');settingsItem(f).click();assert.equal(w.settingsMessages.length,0);await assert.rejects(()=>settingsReady(f,w,true),/desktop_settings_forbidden/);
 await w.loadURL('http://127.0.0.1:56789/');const ready=f.handlers.get('homer:settings:ready');await assert.rejects(()=>ready({sender:w.webContents,senderFrame:{...w.webContents.mainFrame}},true),/desktop_settings_forbidden/);await settingsReady(f,w,true);assert.equal(w.settingsMessages.length,1);
});
test('settings recreates an absent primary window without starting another backend or changing close and quit',async()=>{
 const f=await permissionFixture();f.forgetWindow();settingsItem(f).click();await f.tick();const w=f.windows.at(-1);await settingsReady(f,w,true);assert.equal(w.settingsMessages.length,1);assert.equal(f.spawnCount(),1);
 const menu=f.handlers.get('menu')[0].submenu;menu.find(item=>item.label==='关闭窗口').click();assert.equal(w.hidden,true);assert.ok(menu.some(item=>item.role==='hide'));assert.ok(menu.some(item=>item.role==='about'));
 menu.find(item=>item.id==='quit').click();await f.tick();assert.equal(w.hidden,false);assert.equal(f.messages.at(-1).message,'退出荷马？');
});
for(const state of ['detached','frame destroyed','contents destroyed','query','foreign origin'])test('settings rejects readiness from '+state,async()=>{
 const f=await permissionFixture(),w=f.windows[0],frame=w.webContents.mainFrame;
 if(state==='detached')frame.detached=true;
 if(state==='frame destroyed')frame.isDestroyed=()=>true;
 if(state==='contents destroyed')w.contentsDestroyed=true;
 if(state==='query')await w.loadURL('http://127.0.0.1:56789/?query=1');
 if(state==='foreign origin')await w.loadURL('http://127.0.0.1:56790/');
 await assert.rejects(()=>settingsReady(f,w,true),/desktop_settings_forbidden/);assert.equal(w.settingsMessages.length,0);
});
test('update preload exposes only zero-argument actions and removable event-free notifications',async()=>{
 const exposed={},calls=[],listeners=new Map();vm.runInNewContext(readFileSync('packaging/electron/preload.cjs','utf8'),{process:{isMainFrame:true},require:()=>({contextBridge:{exposeInMainWorld:(name,value)=>exposed[name]=value},ipcRenderer:{invoke:async(...args)=>{calls.push(args);return null;},on:(channel,fn)=>listeners.set(channel,fn),removeListener:(channel,fn)=>{assert.equal(listeners.get(channel),fn);listeners.delete(channel);}}})});
 const api=exposed.homerDesktopUpdate;assert.deepEqual(Object.keys(api),['state','check','dismiss','restart','onChange']);let received;
 const off=api.onChange((...args)=>{received=args;});listeners.get('homer:update:changed')({sender:'private'},'ignored');assert.deepEqual(received,[]);off();off();assert.equal(listeners.size,0);assert.throws(()=>api.onChange(null),/desktop_update_callback/);
 for(const method of ['state','check','dismiss','restart']){await api[method]();await assert.rejects(api[method]('forbidden-url'),/desktop_permissions_arguments/);}
 assert.deepEqual(calls,[['homer:update:state'],['homer:update:check'],['homer:update:dismiss'],['homer:update:restart']]);
});
test('settings preload subscribes before readiness, strips IPC event and disposes exactly its listener',async()=>{
 const listeners=new Map(),calls=[],exposed={};const source=readFileSync('packaging/electron/preload.cjs','utf8');
 vm.runInNewContext(source,{process:{isMainFrame:true},require:()=>({contextBridge:{exposeInMainWorld:(name,api)=>exposed[name]=api},ipcRenderer:{on:(channel,listener)=>listeners.set(channel,listener),removeListener:(channel,listener)=>{assert.equal(listeners.get(channel),listener);listeners.delete(channel);},invoke:async(...args)=>{calls.push(args);assert.ok(listeners.has('homer:settings:open')||args[1]===false);}}})});
 assert.ok(exposed.homerDesktopSettings);const received=[];const off=exposed.homerDesktopSettings.onOpen((...args)=>received.push(args));assert.deepEqual(calls,[['homer:settings:ready',true]]);
 const listener=listeners.get('homer:settings:open');listener({sender:'private'},'ignored');listener({sender:'private'},'permissions');assert.deepEqual(received,[[],['permissions']]);
 await exposed.homerDesktopSettings.getVersion();assert.deepEqual(calls.at(-1),['homer:settings:version']);
 await assert.rejects(()=>exposed.homerDesktopSettings.getVersion('extra'));
 await exposed.homerDesktopSettings.openAboutLink('github');assert.deepEqual(calls.at(-1),['homer:settings:open-about-link','github']);
 off();off();assert.equal(listeners.size,0);assert.deepEqual(calls.at(-1),['homer:settings:ready',false]);
});
const defaultCaptureShortcut='Control+1',captureShortcut='shortcut:'+defaultCaptureShortcut,captureReady='homer:capture:ready';
const captureShortcutRead='homer:capture:shortcut-state',captureShortcutWrite='homer:capture:shortcut-set';
test('capture shortcut validates the trusted frame, swaps registration and rolls back failure',async()=>{
 const native={shortcutConflict:key=>key==='Control+Shift+X'},f=await permissionFixture(native),event=permissionEvent(f);
 const read=f.handlers.get(captureShortcutRead),write=f.handlers.get(captureShortcutWrite);
 assert.deepEqual(plain(await read(event)),{shortcut:defaultCaptureShortcut,defaultShortcut:defaultCaptureShortcut,active:true});
 await assert.rejects(async()=>write({...event,senderFrame:{...event.senderFrame}},'Control+Shift+D'),/desktop_capture_forbidden/);
 for(const invalid of ['Shift+A','Control+A','Command+1','Control+Control+1','Control+Shift+1+2','Alt+Shift+S'])
  assert.equal((await write(event,invalid)).error,'invalid');
 for(const reserved of ['Command+Shift+4','Control+Command+Q','Alt+Command+D','Command+Shift+S','Command+Shift+Z'])
  assert.equal((await write(event,reserved)).error,'reserved');
 assert.equal((await write(event,'Control+Shift+X')).error,'unavailable');
 assert.ok(f.handlers.has(captureShortcut));
 assert.equal((await write(event,'Shift+Control+D')).shortcut,'Control+Shift+D');
 assert.equal(native.captureShortcut,'Control+Shift+D');
 assert.ok(!f.handlers.has(captureShortcut));
 native.shortcutWriteError=true;
 assert.equal((await write(event,'Control+Shift+E')).error,'save_failed');
 assert.ok(!f.handlers.has('shortcut:Control+Shift+E'));
 assert.ok(f.handlers.has('shortcut:Control+Shift+D'));
 assert.equal((await read(event)).shortcut,'Control+Shift+D');
 native.shortcutWriteError=false;
 assert.equal((await write(event,null)).shortcut,defaultCaptureShortcut);
 assert.equal(native.captureShortcut,undefined);
 f.app.emit('will-quit');assert.ok(!f.handlers.has(captureShortcut));
});
for(const [saved,blocked] of [[undefined,defaultCaptureShortcut],['Command+Shift+9','Shift+Command+9']])test('a startup shortcut conflict can be replaced on the existing draft: '+blocked,async()=>{
 let captures=0;
 const native={captureShortcut:saved,shortcutConflict:key=>key===blocked,capture:(_bin,_args,_options,done)=>{
  captures++;queueMicrotask(()=>done(null,'{"kind":"cancelled"}'));
 }};
 const f=await permissionFixture(native),event=permissionEvent(f);
 assert.deepEqual(plain(await f.handlers.get(captureShortcutRead)(event)),{shortcut:blocked,defaultShortcut:defaultCaptureShortcut,active:false});
 assert.equal(await f.handlers.get(captureReady)(event,captureScope),false);
 const write=f.handlers.get(captureShortcutWrite);
 assert.equal((await write(event,'Control+2')).active,true);
 if(blocked===defaultCaptureShortcut)assert.deepEqual(plain(await write(event,null)),{shortcut:'Control+2',defaultShortcut:defaultCaptureShortcut,active:true,error:'unavailable'});
 f.handlers.get('shortcut:Control+2')();await f.tick();assert.equal(captures,1);
 const reopened=await permissionFixture(native);
 assert.ok(reopened.handlers.has('shortcut:Control+2'));
 assert.ok(!reopened.handlers.has(captureShortcut));
});
const captureScope={threadId:'main',requestId:'request-1',epoch:1};
const capturePng='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=';
const panelEvent=panel=>({sender:panel.webContents,senderFrame:panel.webContents.mainFrame});
test('Windows capture shortcut defaults to Ctrl+Shift+F2 and retains the working key on failure',async()=>{
 const native={shortcutConflict:key=>key==='Control+Shift+F3'},f=await windowsFixture(native),event=permissionEvent(f);
 const read=f.handlers.get(captureShortcutRead),write=f.handlers.get(captureShortcutWrite);
 assert.ok(read&&write,'Windows must register the screenshot shortcut settings');
 const defaultShortcut='Control+Shift+F2';
 assert.deepEqual(plain(await read(event)),{shortcut:defaultShortcut,defaultShortcut,active:true});
 for(const invalid of ['Control+1','Command+Shift+F2','Control+Shift+F12','Control+Alt+Shift+A'])
  assert.equal((await write(event,invalid)).error,'invalid');
 assert.equal((await write(event,'Control+Shift+F3')).error,'unavailable');
 assert.equal((await write(event,'Shift+Control+F11')).shortcut,'Control+Shift+F11');
 f.options.shortcutWriteError=true;
 assert.equal((await write(event,'Control+Shift+1')).error,'save_failed');
 assert.ok(f.handlers.has('shortcut:Control+Shift+F11'));
 assert.ok(!f.handlers.has('shortcut:Control+Shift+1'));
 f.options.shortcutWriteError=false;
 assert.equal((await write(event,null)).shortcut,defaultShortcut);
 assert.ok(f.handlers.has('shortcut:'+defaultShortcut));
});
const winTargetA={id:'window:123:0',name:'Synthetic A',thumbnail:'private'};
const winTargetB={id:'window:456:0',name:'Synthetic B',thumbnail:'private'};
const winScreen={id:'screen:1:0',display_id:'7',name:'Synthetic screen'};
const winPng=()=>Buffer.from(capturePng,'base64');
const winGetSources=({types})=>types[0]==='window'?[winTargetA,winTargetB,{id:'window:999:1',name:'Capture overlay'}]
 :[{...winScreen,id:'screen:9:0',display_id:'9'},winScreen];
const winBridge=(f,method)=>f.handlers.get('homer:capture-panel:'+method);
function requestCapture(f,panel,overrides={}){
 let value;
 const grant=f.handlers.get('display-media-request');
 assert.ok(grant,'the isolated panel must own the display media request handler');
 grant({frame:panel.webContents.mainFrame,userGesture:true,videoRequested:true,audioRequested:false,...overrides},result=>{value=result;});
 assert.notEqual(value,undefined);
 return value;
}
async function windowsPanel(native={},useMenu=false){
 const f=await windowsFixture({captureSources:winGetSources,...native}),event=permissionEvent(f);
 const trigger=f.handlers.get('shortcut:Control+Shift+F2'),ready=f.handlers.get(captureReady);
 assert.ok(trigger&&ready,'Windows must register a global screenshot shortcut');
 trigger();assert.equal(f.windows.length,1);
 await ready(event,captureScope,true);
 if(useMenu){
  const item=f.handlers.get('menu').flatMap(menu=>menu.submenu).find(item=>item.id==='capture-selection');
  assert.ok(item,'the display menu must allow screenshot selection');item.click();
 }else trigger();
 trigger();
 await f.tick();
 assert.equal(f.windows.length,2);
 const panel=f.windows[1],fromPanel=panelEvent(panel);
 assert.equal(panel.hidden,true);
 assert.equal(f.windows[0].focused,undefined);
 const listing=await winBridge(f,'read')(fromPanel);
 assert.deepEqual(plain(listing),{windows:[{id:winTargetA.id,name:winTargetA.name},{id:winTargetB.id,name:winTargetB.name}]});
 await winBridge(f,'present')(fromPanel);
 assert.equal(panel.hidden,false);
 return {f,event,panel,fromPanel,ready};
}
test('Windows window capture grants one trusted source and uses the existing direct-send handoff',async()=>{
 const {f,event,panel,fromPanel}=await windowsPanel();
 const choose=winBridge(f,'choose-source'),accept=winBridge(f,'accept-image');
 await assert.rejects(choose(event,winTargetA.id),/capture_panel_forbidden/);
 await assert.rejects(choose(fromPanel,'window:unlisted:0'),/来源/);
 await choose(fromPanel,winTargetB.id);
 await assert.rejects(choose(fromPanel,winTargetA.id),/来源/);
 await assert.rejects(accept(fromPanel,winPng(),null),/capture_panel_forbidden/);
 const check=f.handlers.get('permission-check');
 assert.equal(check(panel.webContents,'display-capture','file://',{isMainFrame:true}),true);
 assert.equal(check(panel.webContents,'display-capture','file://',{isMainFrame:false}),false);
 assert.equal(check(event.sender,'display-capture','file://',{isMainFrame:true}),false);
 for(const request of [{frame:{...fromPanel.senderFrame}},{userGesture:false},{videoRequested:false},{audioRequested:true}])
  assert.equal(requestCapture(f,panel,request),null);
 assert.deepEqual(plain(requestCapture(f,panel)),{video:winTargetB});
 assert.equal(requestCapture(f,panel),null);
 assert.equal(panel.hidden,false);
 await assert.rejects(accept(fromPanel,Buffer.alloc(8*1024*1024+1),null),/过大/);
 await assert.rejects(accept(fromPanel,Buffer.from('invalid'),null),/图片/);
 const result=await accept(fromPanel,winPng(),null);
 assert.equal(Buffer.from(result.png).toString('base64'),capturePng);
 await winBridge(f,'present')(fromPanel);
 const note={id:'win-note',region:{x:0,y:0,width:1,height:1},comment:'合成批注'};
 const sent=winBridge(f,'finish')(fromPanel,[note]);
 await assert.rejects(async()=>winBridge(f,'finish')(fromPanel,[note]),/暂时无法接收/);
 const [channel,scope,submitted]=f.windows[0].settingsMessages.at(-1);
 assert.equal(channel,'homer:capture:result');assert.deepEqual(plain(scope),captureScope);
 assert.deepEqual(plain(submitted.draft.annotations),[note]);assert.equal(submitted.ax,undefined);
 assert.equal(await f.handlers.get('homer:capture:accept-draft')(event,submitted.draft.id),true);
 await sent;assert.equal(panel.isDestroyed(),true);
 assert.equal(f.windows[0].settingsMessages.filter(([channel])=>channel==='homer:capture:result').length,1);
});
test('Windows region capture binds to the triggering display, hides before grant and keeps the selection position',async()=>{
 const {f,panel,fromPanel}=await windowsPanel({},true);
 const choose=winBridge(f,'choose-source'),accept=winBridge(f,'accept-image');
 await choose(fromPanel,null);
 let granted;
 f.handlers.get('display-media-request')({frame:fromPanel.senderFrame,userGesture:true,videoRequested:true,audioRequested:false},value=>{
  assert.equal(panel.hidden,true);granted=value;
 });
 assert.deepEqual(plain(granted),{video:winScreen});
 await winBridge(f,'present')(fromPanel);
 await assert.rejects(accept(fromPanel,winPng(),[.2,.1,.1,.25]),/区域/);
 await assert.rejects(accept(fromPanel,winPng(),[,.1,.2,.25]),/区域/);
 const result=await accept(fromPanel,winPng(),[.1,.1,.2,.25]);
 assert.deepEqual(plain(result.placement),{x:120,y:80,width:120,height:120});
 assert.deepEqual(f.nativeCalls.filter(([kind])=>kind==='capture-sources').map(([,options])=>plain(options)),[
  {types:['window'],thumbnailSize:{width:0,height:0}},
  {types:['screen'],thumbnailSize:{width:0,height:0}},
 ]);
});
test('Windows capture rejects a disappeared source and discards an in-flight choice when the draft changes',async()=>{
 let release;
 const {f,event,panel,fromPanel,ready}=await windowsPanel();
 const choose=winBridge(f,'choose-source');
 f.options.captureSources=()=>[winTargetB];
 await assert.rejects(choose(fromPanel,winTargetA.id),/来源/);
 f.options.captureSources=()=>new Promise(resolve=>{release=resolve;});
 const pending=assert.rejects(choose(fromPanel,winTargetB.id),/capture_panel_forbidden/);
 await ready(event,{...captureScope,epoch:2},true);
 assert.equal(panel.isDestroyed(),true);
 release([winTargetB]);await pending;
 assert.equal(requestCapture(f,panel),null);
 await assert.rejects(winBridge(f,'accept-image')(fromPanel,winPng(),null),/capture_panel_forbidden/);
 assert.equal(f.windows[0].settingsMessages.filter(([channel])=>channel==='homer:capture:result').length,0);
});
test('Windows capture times out a hidden panel and rejects a late image',async()=>{
 const {f,panel,fromPanel}=await windowsPanel();
 await winBridge(f,'choose-source')(fromPanel,null);
 assert.deepEqual(plain(requestCapture(f,panel)),{video:winScreen});
 assert.equal(panel.hidden,true);
 f.timeout();assert.equal(panel.isDestroyed(),true);
 const notifications=f.windows[0].settingsMessages.filter(([channel])=>channel==='homer:capture:result');
 assert.equal(notifications.length,1);assert.equal(notifications[0][2].kind,'unavailable');
 await assert.rejects(winBridge(f,'accept-image')(fromPanel,winPng(),[.1,.1,.2,.25]),/capture_panel_forbidden/);
});
test('Windows capture closes the visible picker when the desktop runtime exits',async()=>{
 const {f,panel}=await windowsPanel();
 assert.equal(panel.isVisible(),true);
 f.child.emit('close',1,null);await f.tick();
 assert.equal(panel.isDestroyed(),true);
 assert.equal(requestCapture(f,panel),null);
});
test('a shortcut without screen permission opens the existing permissions tab and keeps explicit selection available',async()=>{
 const captures=[],f=await permissionFixture({capture:(...args)=>captures.push(args)});
 const window=f.windows[0],ready=f.handlers.get(captureReady),trigger=f.handlers.get(captureShortcut);
 await settingsReady(f,window,true);
 await ready(permissionEvent(f),captureScope,true);
 window.hide();window.minimized=true;
 trigger();assert.deepEqual(plain(captures[0][1]),[]);
 captures[0][3](null,'{"kind":"permission-required"}');
 assert.deepEqual(window.settingsMessages,[['homer:settings:open','permissions']]);
 assert.equal(window.focused,true);assert.equal(window.minimized,false);assert.equal(window.hidden,false);
 assert.deepEqual(f.windows.filter(candidate=>!candidate.isDestroyed()),[window]);

 const select=f.handlers.get('menu').flatMap(item=>item.submenu).find(item=>item.id==='capture-selection');
 select.click();assert.deepEqual(plain(captures[1][1]),['--select']);
 captures[1][3](null,'{"kind":"cancelled"}');
 assert.equal(window.settingsMessages.length,1);
 assert.deepEqual(f.windows.filter(candidate=>!candidate.isDestroyed()),[window]);
});
test('the macOS capture panel hands the screenshot and direct-send intent to the registered main frame once',async()=>{
 const captures=[],f=await permissionFixture({capture:(...args)=>captures.push(args)});
 const ready=f.handlers.get(captureReady),trigger=f.handlers.get(captureShortcut),event=permissionEvent(f),window=f.windows[0];
 assert.equal(typeof trigger,'function');
 trigger();assert.equal(captures.length,0);
 await assert.rejects(async()=>ready({...event,senderFrame:{...event.senderFrame}},captureScope),/desktop_capture_forbidden/);
 await assert.rejects(async()=>ready(event,{...captureScope,path:'/tmp'}),/desktop_capture_forbidden/);
 assert.equal(await ready(event,captureScope,true),true);
 trigger();trigger();assert.equal(captures.length,1);assert.equal(window.focused,undefined);
 const [bin,args,options,finish]=captures[0];
 assert.match(bin,/Homer\.app\/Contents\/MacOS\/homer-window-capture$/);
 assert.deepEqual(plain(args),[]);assert.ok(options.timeout>0&&options.maxBuffer<=12*1024*1024);
 await f.tick();
 const panel=f.windows[1];
 assert.equal(panel?.options.type,'panel');
 assert.equal(panel.hidden,true);
 assert.equal(panel.options.transparent,true);
 assert.equal(panel.options.enableLargerThanScreen,true);
 assert.equal(window.focused,undefined);
 assert.equal(window.settingsMessages.length,0);
 trigger();assert.equal(captures.length,1);
 const read=f.handlers.get('homer:capture-panel:read'),complete=f.handlers.get('homer:capture-panel:finish'),accept=f.handlers.get('homer:capture:accept-draft'),fromPanel=panelEvent(panel);
 const present=f.handlers.get('homer:capture-panel:present');
 await assert.rejects(async()=>read(event),/capture_panel_forbidden/);
 await assert.rejects(async()=>present(event),/capture_panel_forbidden/);
 await assert.rejects(async()=>present(fromPanel),/capture_panel_forbidden/);
 let loaded=false;
 const reading=read(fromPanel).then(data=>{loaded=true;return data;});
 await f.tick();assert.equal(loaded,false);
 finish(null,JSON.stringify({kind:'image',png:capturePng,width:1,height:1,bounds:[0,0,1200,800],ocrText:'Synthetic E101'}));
 const {png,placement}=await reading;
 assert.equal(panel.hidden,true);
 assert.deepEqual(plain(panel.bounds),{x:0,y:0,width:1200,height:800});
 await present(fromPanel);assert.equal(panel.hidden,false);
 await assert.rejects(async()=>complete({...fromPanel,senderFrame:{...fromPanel.senderFrame}},[]),/capture_panel_forbidden/);
 await assert.rejects(async()=>complete(fromPanel,[],false),/capture_panel_forbidden/);
 await assert.rejects(async()=>complete(fromPanel,[{id:'a',comment:'bad region',region:{x:0,y:0,width:2,height:1}}]),/批注超出/);
 assert.equal(Buffer.from(png).toString('base64'),capturePng);
 assert.deepEqual(plain(placement),{x:0,y:0,width:1200,height:784});
 const note={id:'note',region:{x:0,y:0,width:1,height:1},comment:'合成批注'};
 const completeOnce=complete(fromPanel,[note]);
 await assert.rejects(async()=>complete(fromPanel,[note]),/暂时无法接收/);
 const [channel,scope,result]=window.settingsMessages.at(-1);
 assert.equal(channel,'homer:capture:result');assert.deepEqual(plain(scope),captureScope);
 assert.equal(Buffer.from(result.png).toString('base64'),capturePng);
 assert.deepEqual(plain(result.draft),{id:result.draft.id,action:'send',annotations:[note]});
 assert.equal('ocrText' in result,false);assert.equal(result.ax,undefined);
 assert.equal(await accept(fromPanel,result.draft.id),false);
 assert.equal(await accept(event,'wrong'),false);
 assert.equal(await accept(event,result.draft.id),true);
 await completeOnce;
 assert.equal(panel.isDestroyed(),true);
 assert.equal(window.focused,true);
 assert.equal(await accept(event,result.draft.id),false);
});
test('changing the main draft invalidates a pending panel handoff',async()=>{
 let finish;
 const f=await permissionFixture({capture:(_bin,_args,_options,callback)=>{finish=callback;}});
 const event=permissionEvent(f),ready=f.handlers.get(captureReady);
 await ready(event,captureScope,true);f.handlers.get(captureShortcut)();
 finish(null,JSON.stringify({kind:'image',png:capturePng,width:1,height:1}));await f.tick();
 const panel=f.windows[1];
 assert.equal(panel?.options.type,'panel');
 const complete=f.handlers.get('homer:capture-panel:finish')(panelEvent(panel),[]);
 const rejection=assert.rejects(complete,/尚未确认接收/);
 const id=f.windows[0].settingsMessages.at(-1)[2].draft.id;
 await ready(event,{...captureScope,epoch:2});await rejection;
 assert.equal(panel.isDestroyed(),true);
 assert.equal(await f.handlers.get('homer:capture:accept-draft')(event,id),false);
 assert.equal(f.windows[0].focused,undefined);
});
test('a capture panel that does not present hands the validated image back to the main frame once',async()=>{
 let finish;
 const f=await permissionFixture({capture:(_bin,_args,_options,callback)=>{finish=callback;}});
 const window=f.windows[0];
 await f.handlers.get(captureReady)(permissionEvent(f),captureScope,true);
 f.handlers.get(captureShortcut)();
 finish(null,JSON.stringify({kind:'image',png:capturePng,width:1,height:1}));
 await f.tick();
 const panel=f.windows[1];
 assert.equal(panel.hidden,true);
 assert.equal(window.settingsMessages.length,0);
 f.timeout();f.timeout();
 assert.equal(panel.isDestroyed(),true);
 assert.equal(window.settingsMessages.length,1);
 assert.equal(Buffer.from(window.settingsMessages[0][2].png).toString('base64'),capturePng);
});
for(const sending of [false,true])test('a crashed capture panel is released '+(sending?'without replaying a pending send':'and returns its image'),async()=>{
 let finish;
 const f=await permissionFixture({capture:(_bin,_args,_options,callback)=>{finish=callback;}});
 const event=permissionEvent(f),trigger=f.handlers.get(captureShortcut);
 await f.handlers.get(captureReady)(event,captureScope,true);
 trigger();
 finish(null,JSON.stringify({kind:'image',png:capturePng,width:1,height:1}));await f.tick();
 const [window,panel]=f.windows;
 await f.handlers.get('homer:capture-panel:present')(panelEvent(panel));
 const rejected=sending?assert.rejects(f.handlers.get('homer:capture-panel:finish')(panelEvent(panel),[]),/尚未确认接收/):undefined;
 panel.webContents.emit('render-process-gone');
 assert.equal(panel.isDestroyed(),true);
 await rejected;
 assert.equal(window.settingsMessages.length,1);
 const result=window.settingsMessages[0][2];
 assert.equal(Buffer.from(result.png).toString('base64'),capturePng);
 if(sending)assert.equal(await f.handlers.get('homer:capture:accept-draft')(event,result.draft.id),false);
 else assert.equal(result.draft,undefined);
 trigger();assert.equal(f.windows.length,3);
 finish(null,'{"kind":"cancelled"}');
});
for(const valid of [true,false])test('native screenshot preserves the PNG with '+(valid?'valid':'invalid')+' AX',async()=>{
 let finish;const f=await permissionFixture({capture:(_bin,_args,_options,callback)=>{finish=callback;}});
 await f.handlers.get(captureReady)(permissionEvent(f),captureScope,true);f.handlers.get(captureShortcut)();
 const ax=[{role:'AXStaticText',value:valid?'Synthetic E101':'x'.repeat(513)}];
 finish(null,JSON.stringify({kind:'image',png:capturePng,width:1,height:1,ax}));
 await f.tick();
 const result=await f.handlers.get('homer:capture-panel:read')(panelEvent(f.windows[1]));
 assert.equal(Buffer.from(result.png).toString('base64'),capturePng);
 assert.deepEqual(plain(result.ax??null),valid?ax:null);
 const sent=f.handlers.get('homer:capture-panel:finish')(panelEvent(f.windows[1]),[]);
 const submitted=f.windows[0].settingsMessages.at(-1)[2];
 assert.deepEqual(plain(submitted.ax??null),valid?ax:null,'sending always preserves valid AX and never invents invalid AX');
 assert.equal(await f.handlers.get('homer:capture:accept-draft')(permissionEvent(f),submitted.draft.id),true);
 await sent;
});
test('cancelling an AX capture panel discards the image and text without sending',async()=>{
 let finish;const f=await permissionFixture({capture:(_bin,_args,_options,callback)=>{finish=callback;}});
 await f.handlers.get(captureReady)(permissionEvent(f),captureScope,true);f.handlers.get(captureShortcut)();
 finish(null,JSON.stringify({kind:'image',png:capturePng,width:1,height:1,ax:[{role:'AXButton',name:'Synthetic Save'}]}));
 await f.tick();const panel=f.windows[1];
 await f.handlers.get('homer:capture-panel:close')(panelEvent(panel));
 assert.equal(panel.isDestroyed(),true);assert.equal(f.windows[0].settingsMessages.length,0);
});
test('a main frame without the capture panel contract receives the original image result',async()=>{
 let finish;
 const f=await permissionFixture({capture:(_bin,_args,_options,callback)=>{finish=callback;}});
 const window=f.windows[0];
 await f.handlers.get(captureReady)(permissionEvent(f),captureScope);f.handlers.get(captureShortcut)();
 finish(null,JSON.stringify({kind:'image',png:capturePng,width:1,height:1}));
 assert.equal(f.windows.length,1);
 assert.equal(window.focused,true);
 assert.equal(Buffer.from(window.settingsMessages.at(-1)[2].png).toString('base64'),capturePng);
});
for(const stale of ['draft changed','main frame navigated','quit'])test('a native screenshot is ignored after '+stale,async()=>{
 let finish,signal;const f=await permissionFixture({capture:(_bin,_args,options,callback)=>{finish=callback;signal=options.signal;}});
 const ready=f.handlers.get(captureReady),window=f.windows[0];
 await ready(permissionEvent(f),captureScope,true);f.handlers.get(captureShortcut)();await f.tick();
 const panel=f.windows[1],read=f.handlers.get('homer:capture-panel:read');
 const rejected=assert.rejects(read(panelEvent(panel)),/capture_panel_forbidden/);
 if(stale==='draft changed')await ready(permissionEvent(f),{...captureScope,epoch:2});
 if(stale==='main frame navigated')window.webContents.emit('did-start-navigation',{isMainFrame:true,isSameDocument:false});
 if(stale==='quit')f.app.quit();
 assert.equal(signal.aborted,true);
 await rejected;assert.equal(panel.isDestroyed(),true);
 const focused=window.focused;
 finish(null,JSON.stringify({kind:'image',png:capturePng,width:1,height:1}));
 assert.equal(window.focused,focused);assert.equal(window.settingsMessages.length,0);
});
test('a shortcut conflict is reported to the draft, and cancel or malformed output cannot activate Homer',async()=>{
 const conflict=await permissionFixture({shortcutConflict:true});
 assert.equal(await conflict.handlers.get(captureReady)(permissionEvent(conflict),captureScope),false);
 let finish;const f=await permissionFixture({capture:(_bin,_args,_options,callback)=>{finish=callback;}});
 const window=f.windows[0],trigger=f.handlers.get(captureShortcut);
 await f.handlers.get(captureReady)(permissionEvent(f),captureScope);
 trigger();finish(null,'{"kind":"cancelled"}');assert.equal(window.settingsMessages.length,0);
 trigger();finish(null,JSON.stringify({kind:'image',png:capturePng,width:2,height:1}));
 assert.equal(window.focused,undefined);assert.equal(window.settingsMessages.at(-1)[2].kind,'unavailable');
});
test('capture panel preload forwards annotations alone on macOS and Windows and stays absent in subframes',async()=>{
 const source=readFileSync('packaging/electron/capture-panel-preload.cjs','utf8');
 for(const platform of ['darwin','win32'])for(const isMainFrame of [true,false]){
  const exposed={},calls=[];
  vm.runInNewContext(source,{process:{platform,isMainFrame},require:()=>({
   contextBridge:{exposeInMainWorld:(name,api)=>exposed[name]=api},
   ipcRenderer:{invoke:async(...args)=>calls.push(args)},
  })});
  if(!isMainFrame){assert.equal(exposed.homerCapturePanel,undefined);continue;}
  const notes=[{id:'note',region:{x:0,y:0,width:1,height:1},comment:'Synthetic note'}];
  await exposed.homerCapturePanel.finish(notes);
  assert.deepEqual(calls,[['homer:capture-panel:finish',notes]]);
 }
});
test('capture preload exposes readiness and result subscription only on supported desktop main frames',async()=>{
 const source=readFileSync('packaging/electron/preload.cjs','utf8');
 for(const [platform,isMainFrame] of [['darwin',true],['darwin',false],['win32',true],['win32',false],['linux',true]]){
  const exposed={},calls=[],listeners=new Map();
  vm.runInNewContext(source,{process:{platform,isMainFrame},require:()=>({contextBridge:{exposeInMainWorld:(name,api)=>exposed[name]=api},ipcRenderer:{
   invoke:async(...args)=>calls.push(args),on:(name,listener)=>listeners.set(name,listener),removeListener:(name,listener)=>{if(listeners.get(name)===listener)listeners.delete(name);},
  }})});
  const api=exposed.homerDesktopCapture;
  if(platform==='linux'||!isMainFrame){assert.equal(api,undefined);continue;}
  assert.ok(api,'supported platforms must expose capture controls');
  assert.deepEqual(Object.keys(api).sort(),['acceptDraft','getShortcut','onResult',...(platform==='win32'?['platform']:[]),'setReady','setShortcut']);
  if(platform==='win32')assert.equal(api.platform,'win32');
  const received=[],off=api.onResult((...args)=>received.push(args)),channel='homer:capture:result',result={kind:'too-large'};
  await api.setReady(captureScope);assert.deepEqual(calls,[[captureReady,captureScope]]);
  await api.getShortcut();await api.setShortcut(null);
  await api.acceptDraft('handoff');
  assert.deepEqual(calls.slice(1),[[captureShortcutRead],[captureShortcutWrite,null],['homer:capture:accept-draft','handoff']]);
  listeners.get(channel)({sender:'private'},captureScope,result);assert.deepEqual(received,[[captureScope,result]]);
  off();off();assert.equal(listeners.size,0);
 }
});
test('permissions expose three fixed handlers before any page loads',async()=>{
 const f=await fixture();assert.deepEqual([...f.handlers.keys()].filter(k=>k.startsWith('homer:desktop-permissions:')),permissionChannels);
 for(const channel of permissionChannels)await assert.rejects(async()=>f.handlers.get(channel)(permissionEvent(f)),/desktop_permissions_forbidden/);
 assert.equal(f.nativeCalls.length,0);
});
test('permissions read AX boolean and every raw screen status without prompting',async()=>{
 for(const ax of [true,false])for(const screen of ['not-determined','denied','granted','restricted','unknown','unexpected']){
  const f=await permissionFixture({ax:()=>ax,screen:()=>screen});
  assert.deepEqual(plain(await f.handlers.get(permissionChannels[0])(permissionEvent(f))),{supported:true,subject:'Homer',accessibility:ax?'granted':'not-granted',screen:screen==='unexpected'?'unknown':screen});
  assert.deepEqual(f.nonLifecycleCalls,[['ax',false],['screen','screen']]);
 }
 for(const failing of ['ax','screen']){
  const f=await permissionFixture({ax:()=>{if(failing==='ax')throw Error('private');return true;},screen:()=>{if(failing==='screen')throw Error('private');return 'granted';}});
  const value=await f.handlers.get(permissionChannels[0])(permissionEvent(f));assert.equal(value.accessibility,failing==='ax'?'unknown':'granted');assert.equal(value.screen,failing==='screen'?'unknown':'granted');
 }
 const f=await permissionFixture({ax:()=>undefined});assert.equal((await f.handlers.get(permissionChannels[0])(permissionEvent(f))).accessibility,'unknown');
});
test('prompt ignores its boolean and accessibility settings uses a fixed URL with a manual fallback',async()=>{
 for(const value of [true,false]){const f=await permissionFixture({ax:()=>value});assert.deepEqual(plain(await f.handlers.get(permissionChannels[1])(permissionEvent(f))),{ok:true});assert.deepEqual(f.nonLifecycleCalls,[['ax',true]]);}
 const bad=await permissionFixture({ax:()=>{throw Error('private');}});assert.deepEqual(plain(await bad.handlers.get(permissionChannels[1])(permissionEvent(bad))),{ok:false,code:'prompt_failed'});
 const url='x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Accessibility';
 const direct=await permissionFixture();assert.deepEqual(plain(await direct.handlers.get(permissionChannels[2])(permissionEvent(direct))),{ok:true});assert.deepEqual(direct.nonLifecycleCalls,[['external',url]]);
 for(const result of ['', 'private error',undefined,new Error('private')]){
  const f=await permissionFixture({external:async()=>{throw Error('private');},open:async()=>{if(result instanceof Error)throw result;return result;}});
  assert.deepEqual(plain(await f.handlers.get(permissionChannels[2])(permissionEvent(f))),result===''?{ok:true,code:'manual_navigation'}:{ok:false,code:'open_failed'});
  assert.deepEqual(f.nonLifecycleCalls,[['external',url],['open','/System/Applications/System Settings.app']]);
 }
});
test('screen settings uses the fixed capture URL and falls back only when dispatch rejects',async()=>{
 const url='x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_ScreenCapture';
 const f=await permissionFixture();
 assert.deepEqual(plain(await f.handlers.get(permissionChannels[2])(permissionEvent(f),'screen')),{ok:true});
 assert.deepEqual(f.nonLifecycleCalls,[['external',url]]);
 for(const result of ['', 'private error',undefined,new Error('private')]){
  const fallback=await permissionFixture({external:async()=>{throw Error('private');},open:async()=>{if(result instanceof Error)throw result;return result;}});
  assert.deepEqual(plain(await fallback.handlers.get(permissionChannels[2])(permissionEvent(fallback),'screen')),result===''?{ok:true,code:'manual_navigation'}:{ok:false,code:'open_failed'});
  assert.deepEqual(fallback.nonLifecycleCalls,[['external',url],['open','/System/Applications/System Settings.app']]);
 }
});
test('only the settings channel accepts the single screen token; URLs, paths and extra values never reach the OS',async()=>{
 const f=await permissionFixture();
 const before=f.allNativeCalls.slice();
 for(const channel of permissionChannels)for(const args of [['screen',true],['accessibility'],['Screen'],['x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_ScreenCapture'],['https://example.invalid/'],[{target:'screen'}],['screen',undefined]])await assert.rejects(async()=>f.handlers.get(channel)(permissionEvent(f),...args),/desktop_permissions_forbidden/);
 for(const channel of permissionChannels.slice(0,2))await assert.rejects(async()=>f.handlers.get(channel)(permissionEvent(f),'screen'),/desktop_permissions_forbidden/);
 for(const [,invalidate] of invalidPermissionInputs){
  const bad=await permissionFixture(),event=permissionEvent(bad);invalidate(bad,event);const before=bad.allNativeCalls.slice();
  await assert.rejects(async()=>bad.handlers.get(permissionChannels[2])(event,'screen'),/desktop_permissions_forbidden/);
  assert.deepEqual(bad.allNativeCalls,before);assert.equal(bad.nonLifecycleCalls.length,0);
 }
 for(const platform of ['linux','win32']){f.setPlatform(platform);assert.deepEqual(plain(await f.handlers.get(permissionChannels[2])(permissionEvent(f),'screen')),{supported:false});}
 assert.deepEqual(f.allNativeCalls,before);
 assert.equal(f.nonLifecycleCalls.length,0);
});
for(const state of ['detached','destroyed','window replaced','frame replaced','navigation away and back'])test('pending screen link response rejects after '+state,async()=>{
 let finish;const f=await permissionFixture({external:()=>new Promise(r=>{finish=r;})}),event=permissionEvent(f);
 const pending=f.handlers.get(permissionChannels[2])(event,'screen');assert.equal(f.nonLifecycleCalls.length,1);
 if(state==='detached')event.senderFrame.detached=true;
 if(state==='destroyed')f.windows[0].destroyed=true;
 if(state==='window replaced')f.createWindow();
 if(state==='frame replaced')f.windows[0].webContents.mainFrame={...event.senderFrame};
 if(state==='navigation away and back')f.windows[0].webContents.emit('did-start-navigation',{isMainFrame:true});
 finish();await assert.rejects(pending,/desktop_permissions_forbidden/);
});
const invalidPermissionInputs=[
 ['missing frame',(f,e)=>{e.senderFrame=null;}],['subframe',(f,e)=>{e.senderFrame={...e.senderFrame};}],
 ['foreign contents',(f,e)=>{e.sender=new f.BrowserWindow({}).webContents;}],['no sender',(f,e)=>{e.sender=null;}],
 ['window absent',f=>f.forgetWindow()],['window destroyed',f=>{f.windows[0].destroyed=true;}],['contents destroyed',f=>{f.windows[0].contentsDestroyed=true;}],
 ['contents replaced',f=>{f.windows[0].webContents=new f.BrowserWindow({}).webContents;}],
 ['main frame replaced',(f,e)=>{f.windows[0].webContents.mainFrame={...e.senderFrame};}],
 ['frame destroyed',(f,e)=>{e.senderFrame.isDestroyed=()=>true;}],['frame detached',(f,e)=>{e.senderFrame.detached=true;}],
 ['origin mismatch',(f,e)=>{e.senderFrame.origin='http://127.0.0.1:56790';}],
 ['origin throws',(f,e)=>{Object.defineProperty(e.senderFrame,'origin',{get(){throw Error('destroyed');}});}],
 ...['http://127.0.0.1:56790/','http://localhost:56789/','https://example.invalid/','http://u:p@127.0.0.1:56789/','http://127.0.0.1:56789/preview','http://127.0.0.1:56789/?q=1','about:blank','about:srcdoc','file:///tmp/a','',null,42].flatMap(url=>[
  ['frame URL '+url,(f,e)=>{e.senderFrame.url=url;}],['window URL '+url,f=>{f.windows[0].url=url;}],
 ]),
];
for(const [name,invalidate] of invalidPermissionInputs)test('permissions reject '+name+' with zero native calls',async()=>{
 for(const channel of permissionChannels){
  const f=await permissionFixture(),event=permissionEvent(f);invalidate(f,event);const before=f.allNativeCalls.slice();
  await assert.rejects(async()=>f.handlers.get(channel)(event),/desktop_permissions_forbidden/);
  assert.deepEqual(f.allNativeCalls,before);assert.equal(f.nonLifecycleCalls.length,0);
 }
});
test('permissions reject all extra arguments before native calls',async()=>{
 const f=await permissionFixture(),before=f.allNativeCalls.slice();
 for(const channel of permissionChannels)for(const args of [[undefined],[null],['/tmp'],[{},false]])await assert.rejects(async()=>f.handlers.get(channel)(permissionEvent(f),...args),/desktop_permissions_forbidden/);
 assert.deepEqual(f.allNativeCalls,before);assert.equal(f.nonLifecycleCalls.length,0);
});
test('permissions allow root hashes, deny old windows and decline non-Mac without native calls',async()=>{
 const f=await permissionFixture();await f.windows[0].loadURL('http://127.0.0.1:56789/#message');await f.handlers.get(permissionChannels[0])(permissionEvent(f));
 const old=permissionEvent(f);f.createWindow();await f.windows[1].loadURL('http://127.0.0.1:56789/');const before=f.allNativeCalls.slice();
 for(const c of permissionChannels)await assert.rejects(async()=>f.handlers.get(c)(old),/desktop_permissions_forbidden/);
 assert.deepEqual(f.allNativeCalls,before);
 const other=await permissionFixture(),initial=other.allNativeCalls.slice();for(const p of ['linux','win32']){other.setPlatform(p);for(const c of permissionChannels)assert.deepEqual(plain(await other.handlers.get(c)(permissionEvent(other))),{supported:false});}
 assert.deepEqual(other.allNativeCalls,initial);assert.equal(other.nonLifecycleCalls.length,0);
});
for(const state of ['detached','destroyed','window replaced','frame replaced','navigation away and back'])test('pending native response rejects after '+state,async()=>{
 let finish;const f=await permissionFixture({external:()=>new Promise(r=>{finish=r;})}),event=permissionEvent(f);
 const pending=f.handlers.get(permissionChannels[2])(event);assert.equal(f.nonLifecycleCalls.length,1);
 if(state==='detached')event.senderFrame.detached=true;
 if(state==='destroyed')f.windows[0].destroyed=true;
 if(state==='window replaced')f.createWindow();
 if(state==='frame replaced')f.windows[0].webContents.mainFrame={...event.senderFrame};
 if(state==='navigation away and back'){f.windows[0].webContents.emit('did-start-navigation',{url:'http://127.0.0.1:56789/',isSameDocument:false,isMainFrame:true});}
 finish('');await assert.rejects(pending,/desktop_permissions_forbidden/);
});
test('preload exposes fixed Promise methods and allowlisted settings tokens in the main frame',async()=>{
 const source=readFileSync('packaging/electron/preload.cjs','utf8');
 for(const isMainFrame of [true,false,undefined]){
  const exposed=[],calls=[],userActivation={isActive:false};vm.runInNewContext(source,{process:{isMainFrame,platform:'linux'},navigator:{userActivation},require:name=>{assert.equal(name,'electron');return {contextBridge:{exposeInMainWorld:(...args)=>exposed.push(args)},ipcRenderer:{invoke:async(...args)=>{calls.push(args);return {synthetic:true};}}};}});
  if(isMainFrame!==true){assert.equal(exposed.length,0);continue;}
  assert.equal(exposed.length,9);
  const notifications=exposed.find(([name])=>name==='homerDesktopNotifications')[1];
  assert.deepEqual(Object.keys(notifications),['preferences','set','openSystemSettings','subscribe','visibility']);
  await notifications.set('attention',false);
  assert.deepEqual(calls.at(-1),['homer:notification','set','attention',false]);
  const browser=exposed.find(([name])=>name==='homerBrowserPreview')[1];
  assert.deepEqual(Object.keys(browser),['platform','more','onNativePointer','list','present','control','annotations','reply','locationGrants','revokeLocation','onChanged','onAnnotation','onShow','onLink']);
  await assert.rejects(browser.more({action:'browser'}),/preview_user_action_required/);
  userActivation.isActive=true;await browser.more({action:'browser'});
  assert.deepEqual(calls.at(-1),['homer:preview:more',{action:'browser'}]);
  for(const method of ['list','present','control','annotations','reply']){await browser[method]({pageId:'fixture'});assert.equal(calls.at(-1)[0],'homer:preview:'+method);}
  const tour=exposed.find(([name])=>name==='homerDesktopFeatureTour')[1];
  assert.deepEqual(Object.keys(tour),['pending','dismiss']);
  for(const name of Object.keys(tour)){
   await tour[name]();assert.deepEqual(calls.at(-1),['homer:feature-tour:'+name]);
   const n=calls.length;await assert.rejects(()=>tour[name]('other'),/desktop_permissions_arguments/);assert.equal(calls.length,n);
  }
  const chatApps=exposed.find(([name])=>name==='homerDesktopChatApps')[1];
  assert.deepEqual(Object.keys(chatApps),['state','health','start','code','confirm','cancel','remove','apply']);
  await chatApps.state(true);assert.deepEqual(calls.at(-1),['homer:chat-apps','state',true]);
  await chatApps.health();assert.deepEqual(calls.at(-1),['homer:chat-apps','health',undefined]);
  const [name,api]=exposed.find(([name])=>name==='homerDesktopPermissions');assert.equal(name,'homerDesktopPermissions');assert.deepEqual(Object.keys(api),['check','promptAccessibility','openSystemSettings']);
  await api.openSystemSettings('screen');assert.deepEqual(calls.at(-1),[permissionChannels[2],'screen']);
  await api.openSystemSettings('location');assert.deepEqual(calls.at(-1),[permissionChannels[2],'location']);
  for(const args of [[undefined],[null],['Screen'],['screen',true],['https://example.invalid/'],[{target:'screen'}]]){const n=calls.length;await assert.rejects(async()=>api.openSystemSettings(...args),/desktop_permissions_arguments/);assert.equal(calls.length,n);}
  for(const [i,method] of Object.keys(api).entries()){assert.equal(typeof api[method],'function');assert.equal((await api[method]()).synthetic,true);assert.deepEqual(calls.at(-1),[permissionChannels[i]]);const n=calls.length;await assert.rejects(async()=>api[method]('/tmp'),/desktop_permissions_arguments/);assert.equal(calls.length,n);}
 }
});

for(const action of ['start','confirm','remove','apply'])test('trusted chat app '+action+' forwards once without stopping the owner',async()=>{
 const calls=[];
 const f=await permissionFixture({nativeAction:async(method,input)=>{calls.push([method,input]);return 'fixture-flow';}});
 assert.deepEqual(calls,[['channel-manage',{action:'cancel',input:{}}]]);calls.length=0;
 const handle=f.handlers.get('homer:chat-apps'),sender=f.windows[0].webContents;
 const value=action==='start'?{channel:'dingtalk',credentials:{appKey:'fixture',appSecret:'synthetic'}}:
   action==='remove'?{channel:'wechat',key:'fixture'}:action==='confirm'?{id:'fixture-flow'}:undefined;
 await assert.rejects(handle({sender,senderFrame:{...sender.mainFrame}},action,value),/desktop_channels_forbidden/);
 assert.equal(calls.length,0);
 assert.equal(await handle({sender,senderFrame:sender.mainFrame},action,value),'fixture-flow');
 assert.equal(calls.length,1);assert.equal(calls[0][0],'channel-manage');
 assert.equal(calls[0][1].action,action);
 assert.equal(JSON.stringify(calls[0][1].input),JSON.stringify(value));
 assert.equal(f.sent.length,0);assert.equal(f.nativeCalls.some(call=>call[0]==='relaunch'),false);
});
test('chat app state read after an unconfirmed action never replays the action',async()=>{
 const calls=[],state={bindings:[],busy:true,stopped:false,readError:false,flow:{id:'original',channel:'wechat',phase:'applying'}};
 const f=await permissionFixture({nativeAction:async(method,input)=>{calls.push([method,input.action]);if(input.action==='state')return state;throw Error('unconfirmed');}});
 assert.deepEqual(calls,[['channel-manage','cancel']]);calls.length=0;
 const handle=f.handlers.get('homer:chat-apps'),sender=f.windows[0].webContents,event={sender,senderFrame:sender.mainFrame};
 await assert.rejects(handle(event,'remove',{channel:'wechat',key:'fixture'}));
 const result=await handle(event,'state',true);
 assert.equal(result.flow.id,'original');assert.deepEqual(calls,[['channel-manage','remove'],['channel-manage','state']]);
 assert.equal(f.sent.length,0);
});

test('chat app health uses the trusted read-only channel route',async()=>{
 const calls=[],rows=[{adapterId:'telegram',accountKey:'fixture',label:'fixture',state:'ready'}];
 const f=await permissionFixture({nativeAction:async(method,input)=>{calls.push([method,input]);return rows;}});
 calls.length=0;
 const handle=f.handlers.get('homer:chat-apps'),sender=f.windows[0].webContents;
 await assert.rejects(handle({sender,senderFrame:{...sender.mainFrame}},'health'),/desktop_channels_forbidden/);
 const event={sender,senderFrame:sender.mainFrame};
 await assert.rejects(handle(event,'health',{}),/desktop_channels_arguments/);
 assert.deepEqual(calls,[]);
 assert.equal(JSON.stringify(await handle(event,'health')),JSON.stringify(rows));
 assert.deepEqual(calls,[['channel-state',undefined]]);
});

for(const snapshot of ['none','empty','old'])for(const delayed of [false,true])test('navigation cancels pending channel authorization with '+snapshot+' snapshot and delayed ACK '+delayed,async()=>{
 const calls=[];let release;const gate=new Promise(resolve=>{release=resolve;});
 const state={bindings:[],busy:false,stopped:false,readError:false,...(snapshot==='old'?{flow:{id:'old-flow',channel:'wechat',phase:'scan'}}:{})};
 const f=await permissionFixture({nativeAction:async(_method,input)=>{
  calls.push(input);if(input.action==='state')return state;
  if(input.action==='start'){if(delayed)await gate;return 'new-flow';}
 }});
 const handle=f.handlers.get('homer:chat-apps'),sender=f.windows[0].webContents,event={sender,senderFrame:sender.mainFrame};
 try{
  if(snapshot!=='none')await handle(event,'state',false);
  await assert.rejects(handle(event,'cancel',{}),/desktop_channels_arguments/);
  const started=handle(event,'start',{id:'new-flow',channel:'wechat'}).then(value=>({value}),error=>({error:error.message}));
  if(!delayed)assert.equal((await started).value,'new-flow');
  const before=calls.filter(input=>input.action==='cancel').length;
  sender.emit('did-start-navigation',{isMainFrame:true,isSameDocument:true});await f.tick();
  assert.equal(calls.filter(input=>input.action==='cancel').length,before);
  sender.emit('did-start-navigation',{isMainFrame:true,isSameDocument:false});await f.tick();
  const cancelled=calls.filter(input=>input.action==='cancel');assert.equal(cancelled.length,before+1);
  assert.equal(cancelled.at(-1).input.id,undefined);
  assert.equal(calls.filter(input=>input.action==='start').length,1);
  release();if(delayed)assert.match((await started).error,/desktop_channels_forbidden/);
 }finally{release();f.child.emit('close',1,null);await f.tick();}
});

test('desktop build copies the actual preload alongside main without packaging or installing',()=>{
 const source=readFileSync('scripts/build-desktop.mjs','utf8');const copy=source.split('\n').find(line=>line.includes("join(shell,'preload.cjs')"));assert.ok(copy);
 const files=new Map([['stage/packaging/electron/preload.cjs',readFileSync('packaging/electron/preload.cjs')]]);
 vm.runInNewContext(copy,{stage:'stage',shell:'shell',join:(...parts)=>parts.join('/'),cpSync:(from,to)=>{assert.ok(files.has(from));files.set(to,files.get(from));}});assert.deepEqual(files.get('shell/preload.cjs'),files.get('stage/packaging/electron/preload.cjs'));
});
test('macOS keeps real window controls aligned with the original 44/52px toolbar',async()=>{
 const f=await fixture(),w=f.windows[0],o=w.options;
 assert.equal(o.titleBarStyle,'hiddenInset');assert.equal(o.titleBarOverlay,true);
 assert.deepEqual(JSON.parse(JSON.stringify(o.trafficLightPosition)),{x:12,y:15});
 assert.equal(o.frame,undefined);assert.deepEqual([o.width,o.height,o.minWidth,o.minHeight],[1080,780,380,420]);
 for(let n=0;n<100;n++){w.contentWidth=[1440,1080,801][n%3];w.emit('resize');}
 assert.equal(w.buttonMoves??0,0);
 for(let n=0;n<100;n++){w.contentWidth=[800,799,380][n%3];w.emit('resize');}
 assert.deepEqual(JSON.parse(JSON.stringify(w.buttonPosition)),{x:12,y:19});assert.equal(w.buttonMoves,1);
 w.contentWidth=801;w.emit('resize');assert.equal(w.buttonPosition.y,15);assert.equal(w.buttonMoves,2);
 assert.equal(w.listenerCount('resize'),1);
});
for(const platform of ['linux'])test(`${platform} retains the packaged macOS guard without invoking window controls`,async()=>{
 const f=await fixture(undefined,undefined,platform);assert.equal(f.windows.length,0);assert.equal(f.spawnCount(),0);
 assert.ok(f.messages.some(m=>m.detail?.includes('desktop_packaged_macos_required')));
});
test('primary window title stays 荷马 across desktop startup modes and model sources',async()=>{
 for(const [args,modelSource]of [[['Homer'],'website'],[['Homer'],'codex'],[['Homer','--deepseek-daily'],'website'],[['Homer','--native'],'codex']]){
  const f=await fixture(args,undefined,'darwin',{published:true,modelSource});
  assert.equal(f.spawnCount(),1);
  f.event({kind:'url',url:'http://127.0.0.1:56789/',desktopAccessToken:'a'.repeat(64)});await f.tick();
  assert.equal(f.windows[0].title,'荷马',args.join(' ')+' / '+modelSource);
 }
});
test('production shell routes browser owner requests and bounded error results through runtime stdin',async()=>{
 const calls=[],f=await accountFixture({previewExecute:async(...args)=>{calls.push(args);if(args[1]==='bad')throw Error('private_browser_detail');return {content:'x'.repeat(5000)};}});
 f.event({kind:'browser_request',id:'browser-read',owner:{threadId:'t',owner:'worker:a:1'},action:'read',input:{pageId:'p'}});await f.tick();
 assert.equal(calls.length,1);assert.equal(calls[0][0].owner,'worker:a:1');assert.equal(calls[0][2].pageId,'p');
 const reply=f.sent.map(s=>JSON.parse(s)).find(m=>m.kind==='browser_result'&&m.id==='browser-read');assert.equal(reply.value.content.length,5000);
 f.event({kind:'browser_request',id:'browser-error',owner:{threadId:'t',owner:'worker:a:1'},action:'bad',input:{}});await f.tick();assert.equal(f.sent.map(s=>JSON.parse(s)).find(m=>m.id==='browser-error').error,'preview_result_unconfirmed');
});

test('shell starts one isolated bundled backend with sandbox and only the narrow preload',async()=>{
 const f=await fixture();assert.equal(f.spawnCount(),1);assert.equal(f.windows.length,1);
 const prefs=f.windows[0].options.webPreferences;assert.equal(prefs.nodeIntegration,false);assert.equal(prefs.contextIsolation,true);assert.equal(prefs.sandbox,true);assert.equal(prefs.preload,resolve('packaging/electron/preload.cjs'));
 f.event({kind:'url',url:'http://127.0.0.1:56789',desktopAccessToken:'a'.repeat(64)});await f.tick();assert.equal(f.windows[0].url,'http://127.0.0.1:56789');
 const close={preventDefault(){this.prevented=true;}};f.windows[0].emit('close',close);assert.equal(close.prevented,true);assert.equal(f.windows[0].hidden,true);assert.equal(f.sent.length,0);
 assert.equal(f.handlers.get('window-open')({url:'file:///private/secret'}).action,'deny');
 for(const name of ['will-navigate','will-redirect','will-frame-navigate']){
  const e={url:'file:///private/secret',preventDefault(){this.prevented=true;}};f.windows[0].webContents.emit(name,e);assert.equal(e.prevented,true);
 }
 const download={preventDefault(){this.prevented=true;}};
 f.handlers.get('will-download')(download,{getURLChain:()=>['http://127.0.0.1:56789/file','https://example.invalid/file'],setSaveDialogOptions(){throw Error('external_download_allowed');}});
 assert.equal(download.prevented,true);
});
// Each case changes one otherwise-valid input to catch an independently missing guard.
const clipboardOrigin='http://127.0.0.1:56789',clipboardRoot=clipboardOrigin+'/';
function clipboardInput(f){return {webContents:f.windows[0].webContents,permission:'clipboard-sanitized-write',requestingOrigin:clipboardOrigin,details:{isMainFrame:true,requestingUrl:clipboardRoot}};}
function assertClipboard(f,input,want,handlers=f.handlers){
 const {webContents,permission,requestingOrigin,details}=input,calls=[];
 handlers.get('permission-request')(webContents,permission,value=>calls.push(value),details);
 const checked=handlers.get('permission-check')(webContents,permission,requestingOrigin,details);
 assert.deepEqual({checked,calls},{checked:want,calls:[want]},'both handlers decide; request callback exactly once');
}
async function clipboardFixture(){const f=await fixture();f.event({kind:'url',url:clipboardRoot,desktopAccessToken:'a'.repeat(64)});await f.tick();return f;}
test('clipboard writes allow the current trusted root document and hash through both handlers',async()=>{
 const f=await clipboardFixture(),input=clipboardInput(f);
 assertClipboard(f,input,true);
 for(const url of [clipboardOrigin,clipboardRoot+'#message',clipboardRoot+'#anchor?text']){
  await f.windows[0].loadURL(url);input.details.requestingUrl=url;assertClipboard(f,input,true);
 }
});
for(const permission of ['clipboard-read','deprecated-sync-clipboard-read','clipboard-write','clipboard-sanitized-write-extra','Clipboard-sanitized-write','media','notifications','unknown',null,undefined])test('clipboard rejects permission '+String(permission),async()=>{
 const f=await clipboardFixture();assertClipboard(f,{...clipboardInput(f),permission},false);
});
for(const [name,details]of [
 ['missing',undefined],['null',null],['empty',{}],['missing URL',{isMainFrame:true}],['missing main-frame flag',{requestingUrl:clipboardRoot}],
 ['null URL',{isMainFrame:true,requestingUrl:null}],['numeric URL',{isMainFrame:true,requestingUrl:1}],
 ['coercible URL',{isMainFrame:true,requestingUrl:{toString:()=>clipboardRoot}}],
 ...[undefined,null,false,'true',1].map(isMainFrame=>['main-frame flag '+String(isMainFrame),{requestingUrl:clipboardRoot,isMainFrame}]),
 ...[clipboardRoot,'about:blank','about:srcdoc','blob:'+clipboardOrigin+'/synthetic','https://example.invalid/'].map(requestingUrl=>['subframe '+requestingUrl,{isMainFrame:false,requestingUrl}]),
])test('clipboard rejects details: '+name,async()=>{
 const f=await clipboardFixture();assertClipboard(f,{...clipboardInput(f),details},false);
});
const untrustedClipboardUrls=[
 undefined,null,'','not a URL',1,{toString:()=>clipboardRoot},
 'http://user@127.0.0.1:56789/','http://:secret@127.0.0.1:56789/',
 'http://127.0.0.1:56790/','http://127.0.0.1/','http://localhost:56789/',
 'https://127.0.0.1:56789/','https://example.invalid/','file:///synthetic/page','about:blank',
 clipboardOrigin+'/preview/interactive',clipboardOrigin+'/settings/update',clipboardOrigin+'/file',clipboardRoot+'?query=1',
];
for(const field of ['current URL','requesting URL'])for(const [i,url]of untrustedClipboardUrls.entries())test('clipboard rejects '+field+' case '+i,async()=>{
 const f=await clipboardFixture(),input=clipboardInput(f);
 if(field==='current URL')f.windows[0].url=url;else input.details.requestingUrl=url;
 assertClipboard(f,input,false);
});
for(const [i,requestingOrigin]of [undefined,null,'','not a URL',1,{toString:()=>clipboardOrigin},'http://user@127.0.0.1:56789','http://127.0.0.1:56790','http://localhost:56789','https://127.0.0.1:56789','https://example.invalid'].entries())test('clipboard check independently rejects requestingOrigin case '+i,async()=>{
 const f=await clipboardFixture(),input={...clipboardInput(f),requestingOrigin},calls=[];
 // The request entry has no independent origin argument and remains valid.
 f.handlers.get('permission-request')(input.webContents,input.permission,value=>calls.push(value),input.details);
 assert.deepEqual(calls,[true]);
 assert.equal(f.handlers.get('permission-check')(input.webContents,input.permission,requestingOrigin,input.details),false);
});
test('clipboard denies null and foreign contents even on the same Session and origin',async()=>{
 const f=await clipboardFixture(),other=new f.BrowserWindow({});await other.loadURL(clipboardRoot);
 assert.equal(other.webContents.session,f.windows[0].webContents.session);
 for(const webContents of [null,undefined,other.webContents,{}])assertClipboard(f,{...clipboardInput(f),webContents},false);
 assertClipboard(f,clipboardInput(f),true);
});
test('clipboard denies before the backend establishes its origin',async()=>{
 const f=await fixture();await f.windows[0].loadURL(clipboardRoot);assertClipboard(f,clipboardInput(f),false);
});
for(const state of ['window destroyed','contents destroyed','contents replaced','window absent'])test('clipboard denies '+state,async()=>{
 const f=await clipboardFixture(),input=clipboardInput(f),w=f.windows[0];
 assertClipboard(f,input,true);
 if(state==='window destroyed')w.destroyed=true;
 if(state==='contents destroyed')w.contentsDestroyed=true;
 if(state==='contents replaced')w.webContents=new f.BrowserWindow({}).webContents;
 if(state==='window absent')f.forgetWindow();
 assertClipboard(f,input,false);
});
test('clipboard old and re-registered Session handlers deny replaced windows',async()=>{
 const f=await clipboardFixture(),old=clipboardInput(f),oldHandlers=new Map(f.handlers);
 assertClipboard(f,old,true);f.createWindow();const current=f.windows[1];await current.loadURL(clipboardRoot);
 assert.equal(old.webContents.session,current.webContents.session);
 const input={...old,webContents:current.webContents};
 assertClipboard(f,old,false,oldHandlers);assertClipboard(f,input,false,oldHandlers);
 assertClipboard(f,old,false);assertClipboard(f,input,true);
});
test('clipboard decisions follow committed navigation and allow return to the root',async()=>{
 const f=await clipboardFixture(),w=f.windows[0],input=clipboardInput(f);
 assertClipboard(f,input,true);
 for(const name of ['will-navigate','will-redirect','will-frame-navigate']){
  const event={url:'https://example.invalid/',preventDefault(){this.prevented=true;}};
  w.webContents.emit(name,event);assert.equal(event.prevented,true);assertClipboard(f,input,true);
 }
 for(const url of [clipboardOrigin+'/preview/interactive','https://example.invalid/',clipboardRoot+'?query=1']){
  await w.loadURL(url);input.details.requestingUrl=url;assertClipboard(f,input,false);
  await w.loadURL(clipboardRoot);input.details.requestingUrl=clipboardRoot;assertClipboard(f,input,true);
 }
});
test('preparation builds refuse the real profile before launching any backend',async()=>{
 const f=await fixture(['Homer']);assert.equal(f.spawnCount(),0);assert.equal(f.windows.length,0);
 assert.ok(f.messages.some(m=>m.detail?.includes('desktop_preparation_profile_required')));
});
test('only explicitly non-publishable local builds can use real profiles without committing',async()=>{
 const f=await fixture(['Homer'],undefined,undefined,{localWorkingTree:true,publishable:false});
 assert.equal(f.spawnCount(),1);assert.equal(f.windows.length,1);
 for(const publishable of [undefined,true]){
  const denied=await fixture(['Homer'],undefined,undefined,{localWorkingTree:true,publishable});
  assert.equal(denied.spawnCount(),0);assert.ok(denied.messages.some(m=>m.detail?.includes('desktop_preparation_profile_required')));
 }
});
test('quit from a hidden window makes its native confirmation visible',async()=>{
 const f=await fixture();f.windows[0].hide();f.app.quit();await f.tick();
 assert.equal(f.windows[0].hidden,false);assert.equal(f.messages[0].message,'退出荷马？');
});
test('system browser failure is handled without reporting the raw external URL',async()=>{
 const f=await fixture(undefined,async()=>{throw Error('synthetic_browser_failure');});
 f.handlers.get('window-open')({url:'https://example.invalid/document?private=synthetic'});await f.tick();
 const error=f.messages.find(m=>m.type==='error');assert.ok(error?.detail.includes('系统浏览器'));
 assert.equal(error.detail.includes('private='),false);
});
test('mobile download link uses the existing confirmation before opening the fixed URL',async()=>{
 const url='https://super-tree.com/homer/app';
 for(const response of [0,1]){
  const f=await fixture(undefined,undefined,undefined,{response});
  assert.equal(f.handlers.get('window-open')({url}).action,'deny');await f.tick();
  assert.ok(f.messages.some(m=>m.message==='在系统浏览器打开链接？'&&m.detail===url));
  assert.deepEqual(f.nativeCalls.filter(c=>c[0]==='external'),response===1?[['external',url]]:[]);
 }
});
test('repeated quit cannot accept acknowledgement without actual exit0; timeout retains owner',async()=>{
 const f=await fixture();let quit=0;f.app.on('quit',()=>quit++);
 f.app.quit();await f.tick();assert.equal(f.sent.length,1);
 f.event({kind:'stopped'});await f.tick();f.app.quit();await f.tick();assert.equal(quit,0);assert.equal(f.sent.length,1);
 f.timeout();await f.tick();assert.equal(quit,0);assert.ok(f.messages.some(m=>m.detail?.includes('停止尚未确认')&&m.parent===f.windows[0]));
 f.child.exitCode=0;f.child.emit('close',0,null);await f.tick();assert.equal(quit,0);
 f.app.quit();await f.tick();assert.equal(quit,1);
});
test('a confirmed startup refusal reports its reason and permits quitting after exit 1',async()=>{
 const f=await fixture();let quit=0;f.app.on('quit',()=>quit++);
 f.event({kind:'startup_refused'});f.event({kind:'error',code:'desktop_delivery_review_required'});
 f.child.exitCode=1;f.child.emit('close',1,null);await f.tick();
 assert.ok(f.messages.some(m=>m.detail?.includes('desktop_delivery_review_required')));
 assert.equal(f.messages.some(m=>m.detail?.includes('停止尚未确认')),false);
 f.app.quit();await f.tick();assert.equal(quit,1);
});
for(const [code,ack]of [[1,true],[0,false]])test(`exit ${code}, ack ${ack} never confirms a successful quit`,async()=>{
 const f=await fixture();let quit=0;f.app.on('quit',()=>quit++);f.app.quit();await f.tick();
 if(ack)f.event({kind:'stopped'});f.child.exitCode=code;f.child.emit('close',code,null);await f.tick();assert.equal(quit,0);
});
test('ack plus actual exit0 completes normal quit once',async()=>{
 const f=await fixture();let quit=0;f.app.on('quit',()=>quit++);f.app.quit();await f.tick();f.event({kind:'stopped'});f.child.exitCode=0;f.child.emit('close',0,null);await f.tick();assert.equal(quit,1);assert.equal(f.sent.length,1);
});

test('expired wallet cache is stale even when no usage invalidation arrives',async()=>{
 const f=await accountFixture({modelSource:'codex',wallet:async()=>({available:0,used:0,unit:'积分',expiresAt:1})});
 await accountCall(f,'refresh');const state=await accountCall(f,'state');
 assert.equal(state.stale,true);assert.equal(state.wallet.expiresAt,1);
});

for(const modelSource of ['codex','website'])for(const response of [0,1])test(`relay account login and ordinary restart retain ${modelSource} source, confirmation ${response}`,async()=>{
 const f=await accountFixture({modelSource,response});
 const walletReads=f.nativeCalls.filter(c=>c[0]==='wallet').length;
 await accountCall(f,'connect');await f.tick();
 const saved=await accountCall(f,'state');assert.equal(saved.source,modelSource);assert.equal(saved.needsRestart,true);
 const previous=f.credentials.slice();await accountCall(f,'restart');await f.tick();
 assert.deepEqual(f.credentials,previous,'running owner keeps its applied account until exit');
 if(response===1){f.event({kind:'stopped'});f.child.emit('close',0,null);await f.tick();assert.equal(f.nativeCalls.filter(c=>c[0]==='relaunch').length,1);}
 else{assert.equal((await accountCall(f,'state')).needsRestart,true);assert.equal(f.sent.length,0);}
 assert.equal(f.nativeCalls.some(c=>c[0]==='source'||c[0]==='disconnect'),false);
 assert.equal(f.nativeCalls.filter(c=>c[0]==='wallet').length,walletReads);
});

const nativeCatalog=()=>['gpt-6.1-terra','custom-model'].map(model=>({model,displayName:model,defaultReasoningEffort:'high',supportedReasoningEfforts:['low','medium','high','xhigh'].map(reasoningEffort=>({reasoningEffort})),serviceTiers:[{id:'priority',name:'Fast'},{id:'ultrafast',name:'Ultrafast'}]}));
const selectedNativeRoles={main:{model:'custom-model',effort:'medium',serviceTier:'ultrafast'},worker:{model:'gpt-6.1-terra',effort:'xhigh',serviceTier:null}};
const nativeModelAction=action=>action==='models'?nativeCatalog():{account:'chatgpt',connected:true,phase:'idle'};
test('real preload and host forward live role settings to the running service without stopping or relaunching',async()=>{
 let applied;const f=await accountFixture({modelSource:'codex',nativeAction:(action,input)=>{if(action==='apply-models'){applied=input;return true;}return nativeModelAction(action);}}),exposed={};
 vm.runInNewContext(readFileSync('packaging/electron/preload.cjs','utf8'),{process:{isMainFrame:true},require:()=>({contextBridge:{exposeInMainWorld:(name,value)=>exposed[name]=value},ipcRenderer:{invoke:(channel,...args)=>f.handlers.get(channel)(accountEvent(f),...args),on(){},removeListener(){}}})});
 await exposed.homerDesktopAccount.applyCodex(selectedNativeRoles);await f.tick();
 assert.deepEqual(applied,selectedNativeRoles);assert.equal(f.sent.length,0);assert.equal(f.messages.some(message=>message.message==='重启荷马？'),false);assert.equal(f.nativeCalls.some(call=>['source','relaunch'].includes(call[0])),false);
});
for(const [error,want]of [['chatgpt_model_save_failed','chatgpt_model_save_failed'],['PRIVATE_DISK_PATH','chatgpt_model_apply_unconfirmed']])test(`live model errors preserve safe classifications through the host: ${error}`,async()=>{
 const f=await accountFixture({modelSource:'codex',nativeAction:action=>{if(action==='apply-models')throw Error(error);return nativeModelAction(action);}});
 await assert.rejects(accountCall(f,'applyCodex',selectedNativeRoles),new RegExp(want));assert.equal(f.nativeCalls.some(call=>call[0]==='source'||call[0]==='relaunch'),false);
});
test('native model settings project saved roles and defaults while failed reads preserve selections',async()=>{
 const f=await accountFixture({nativeAction:nativeModelAction,chatgpt:{main:selectedNativeRoles.main}});
 assert.equal(typeof f.handlers.get('homer:account:nativeModels'),'function');
 const result=await accountCall(f,'nativeModels');assert.equal(result.current.main.model,'custom-model');assert.equal(result.current.worker.serviceTier,null);assert.deepEqual(result.defaults,{main:{model:'gpt-6.1-terra',effort:'medium',serviceTier:null},worker:{model:'gpt-6.1-sol',effort:'high',serviceTier:null}});assert.equal(result.models.length,2);
 const failed=await accountFixture({chatgpt:{main:selectedNativeRoles.main},nativeAction:action=>{if(action==='models')throw Error('PRIVATE_READ');return nativeModelAction(action);}});
 const retained=await accountCall(failed,'nativeModels');assert.equal(retained.current.main.model,'custom-model');assert.equal(retained.models,undefined);assert.equal(retained.error,'native_models_unconfirmed');assert.equal(JSON.stringify(retained).includes('PRIVATE'),false);
});
test('ChatGPT model application saves source and normalized roles only after confirmed stop',async()=>{
 const f=await accountFixture({modelSource:'website',nativeAction:nativeModelAction});
 await accountCall(f,'applyCodex',selectedNativeRoles);await f.tick();assert.equal(f.nativeCalls.some(c=>c[0]==='source'),false);
 f.event({kind:'stopped'});await f.tick();assert.equal(f.nativeCalls.some(c=>c[0]==='source'),false);
 f.child.emit('close',0,null);await f.tick();
 assert.deepEqual(f.nativeCalls.filter(c=>['source','relaunch'].includes(c[0])),[['source','codex',selectedNativeRoles],['relaunch']]);
});
for(const failure of ['cancel','stop','save'])test(`ChatGPT role transaction ${failure} never writes a partial selection`,async()=>{
 const f=await accountFixture({modelSource:'website',nativeAction:nativeModelAction,response:failure==='cancel'?0:1,sourceWriteError:failure==='save'});
 await accountCall(f,'applyCodex',selectedNativeRoles);await f.tick();
 if(failure==='stop'){f.timeout();await f.tick();}
 if(failure!=='cancel'){f.event({kind:'stopped'});f.child.emit('close',0,null);await f.tick();}
 assert.equal(f.nativeCalls.some(c=>c[0]==='source'||c[0]==='relaunch'),false);
});
test('ChatGPT host rejects malformed and stale role selections without opening restart confirmation',async()=>{
 const f=await accountFixture({modelSource:'website',nativeAction:nativeModelAction});
 for(const roles of [{main:selectedNativeRoles.main},{main:undefined,worker:selectedNativeRoles.worker},{...selectedNativeRoles,extra:{}},{...selectedNativeRoles,main:{...selectedNativeRoles.main,serviceTier:'not-advertised'}},{...selectedNativeRoles,main:{...selectedNativeRoles.main,extra:true}}])await assert.rejects(accountCall(f,'applyCodex',roles));
 assert.equal(f.messages.some(m=>m.message==='重启荷马？'),false);assert.equal(f.nativeCalls.some(c=>c[0]==='source'),false);
 await assert.rejects(accountCall(f,'nativeModels',{}),/desktop_account_forbidden/);
});

test('ChatGPT restart confirmation invalidated by navigation cannot stop or save',async()=>{
 let confirm;const decision=new Promise(resolve=>confirm=resolve);
 const f=await accountFixture({modelSource:'website',nativeAction:nativeModelAction,response:options=>options.message==='重启荷马？'?decision:1});
 await accountCall(f,'applyCodex',selectedNativeRoles);await f.tick();
 await f.windows[0].loadURL('http://127.0.0.1:56789/preview/changed');confirm(1);await f.tick();
 assert.equal(f.sent.some(message=>JSON.parse(message).kind==='quit'),false);assert.equal(f.nativeCalls.some(call=>call[0]==='source'||call[0]==='relaunch'),false);
});
test('ChatGPT source transaction invalidated during stop cannot save or relaunch',async()=>{
 const f=await accountFixture({modelSource:'website',nativeAction:nativeModelAction});await accountCall(f,'applyCodex',selectedNativeRoles);await f.tick();
 assert.equal(f.sent.some(message=>JSON.parse(message).kind==='quit'),true);
 await f.windows[0].loadURL('http://127.0.0.1:56789/preview/changed');f.event({kind:'stopped'});f.child.emit('close',0,null);await f.tick();
 assert.equal(f.nativeCalls.some(call=>call[0]==='source'||call[0]==='relaunch'),false);
});

test('native usage is a zero-argument read through the trusted desktop account bridge',async()=>{
 const usage={windows:[{remainingPercent:63,windowDurationMins:10080,resetsAt:null}],credits:{hasCredits:true,unlimited:false,balance:'25.50'}},actions=[];
 const f=await accountFixture({nativeAction:(action,input)=>{actions.push([action,input]);return usage;}});
 const exposed={},listeners=new Map(),changes=[];
 vm.runInNewContext(readFileSync('packaging/electron/preload.cjs','utf8'),{process:{isMainFrame:true},require:()=>({contextBridge:{exposeInMainWorld:(name,value)=>exposed[name]=value},ipcRenderer:{invoke:(channel,...args)=>f.handlers.get(channel)(accountEvent(f),...args),on:(channel,listener)=>listeners.set(channel,listener),removeListener:channel=>listeners.delete(channel)}})});
 const api=exposed.homerDesktopAccount,dispose=api.onChange(reason=>changes.push(reason));
 actions.length=0;
 assert.deepEqual(JSON.parse(JSON.stringify(await api.nativeUsage())),usage);
 await assert.rejects(api.nativeUsage({}),/arguments/);
 const handler=f.handlers.get('homer:account:nativeUsage');
 await assert.rejects(handler({...accountEvent(f),senderFrame:{} }),/desktop_account_forbidden/);
 assert.deepEqual(actions,[['usage',undefined]]);
 f.event({kind:'native-account-changed'});await f.tick();
 const [channel,reason]=f.windows[0].settingsMessages.at(-1);
 assert.equal(channel,'homer:account:changed');
 listeners.get(channel)({},reason);
 assert.deepEqual(changes,['native-account-changed']);
 dispose();assert.equal(listeners.size,0);
});

test('member settings reject a stale connection revision and never expose the bound subject',async()=>{
 const updates=[];
 const {CHATGPT_MODEL_DEFAULTS}=await import('../src/model-config.ts');
 const f=await accountFixture({modelSource:'website',nativeAction:(action,input)=>{
  if(action==='member-models'||action==='apply-member-model'){
   assert.equal(input.subject,'fixture_user');
   if(action==='apply-member-model')updates.push(input.edit);
   return {current:CHATGPT_MODEL_DEFAULTS,defaults:CHATGPT_MODEL_DEFAULTS,inherited:{main:true,worker:true}};
  }
  return nativeModelAction(action);
 }});
 const settings=await accountCall(f,'memberModels'),edit={role:'worker',selection:null};
 assert.equal(JSON.stringify(settings).includes('fixture_user'),false);
 const result=await accountCall(f,'applyMemberModel',{revision:settings.revision,edit});
 assert.equal(result.revision,settings.revision);assert.equal(updates.length,1);
 await accountCall(f,'cancel');
 await assert.rejects(accountCall(f,'applyMemberModel',{revision:settings.revision,edit}),/chatgpt_model_source_changed/);
 await assert.rejects(accountCall(f,'applyMemberModel',{revision:settings.revision,edit},{}),/desktop_account_forbidden/);
 assert.equal(updates.length,1);
 assert.equal(f.nativeCalls.some(call=>call[0]==='source'||call[0]==='relaunch'),false);
});

}
