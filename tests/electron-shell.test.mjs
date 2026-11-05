import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import * as filesystem from 'node:fs';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,realpathSync,rmSync,symlinkSync,statSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createServer} from 'node:http';
import {transpileModule,ModuleKind,ScriptTarget} from 'typescript';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// Link the real entry to OS fixtures. No test switches or probes in the app.
async function fixture(args=['Homer','--test-profile','/synthetic/profile'],openExternal=async()=>{},platform='darwin',native={}){
 let monotonic=0;
 const handlers=new Map(),windows=[],messages=[],sent=[],nativeCalls=[],ownershipCalls=[],launches=[],credentials=[],tokenFiles=[];let spawnCount=0;
 const app=new EventEmitter(),paths=new Map();let ownsLock=false;
 Object.assign(app,{isPackaged:true,whenReady:async()=>{},setPath(name,path){paths.set(name,path);ownershipCalls.push(['set-path',name,path]);},getPath:()=>'/synthetic',requestSingleInstanceLock(){const key=paths.get('userData');ownershipCalls.push(['single-instance',key]);if(native.lockAvailable===false||native.locks?.has(key))return false;native.locks?.add(key);ownsLock=true;return true;},hasSingleInstanceLock:()=>ownsLock,getVersion:()=> '0.1.0',relaunch(){nativeCalls.push(['relaunch']);},quit(){const e={preventDefault(){this.prevented=true;}};app.emit('before-quit',e);if(!e.prevented)app.emit('quit');},setAboutPanelOptions(){}});
 const session={webRequest:{onBeforeSendHeaders:(...args)=>handlers.set('desktop-request',args.at(-1))},setPermissionRequestHandler:cb=>handlers.set('permission-request',cb),setPermissionCheckHandler:cb=>handlers.set('permission-check',cb),on:(name,cb)=>handlers.set(name,cb)};
 const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();child.stdin.on('data',value=>{
  const message=JSON.parse(String(value));
  if(message.kind==='native_account'){
   nativeCalls.push(['native-account',message.action]);
   void Promise.resolve().then(()=>native.nativeAction?native.nativeAction(message.action):native.nativeState??{account:'none',connected:false,phase:'idle'}).then(value=>child.stdout.write(JSON.stringify({kind:'native_account_result',id:message.id,value})+'\n'),()=>child.stdout.write(JSON.stringify({kind:'native_account_result',id:message.id,error:'native_account_unconfirmed'})+'\n'));
  }else sent.push(String(value));
 });child.exitCode=null;child.signalCode=null;
 child.stdio=[child.stdin,child.stdout,child.stderr,new PassThrough()];child.stdio[3].on('data',value=>credentials.push(String(value)));
 class BrowserWindow extends EventEmitter{
  constructor(options){super();this.options=options;this.webContents=new EventEmitter();this.webContents.session=session;this.settingsMessages=[];this.webContents.executeJavaScript=async()=>{if(this.contentsDestroyed)throw Error('Object has been destroyed');return native.unsaved!==true;};this.webContents.getURL=()=>this.url??'about:blank';this.webContents.isDestroyed=()=>this.contentsDestroyed??false;this.webContents.setWindowOpenHandler=cb=>handlers.set('window-open',cb);windows.push(this);}
  async loadURL(url){this.webContents.emit('did-start-navigation',{url,isSameDocument:false,isMainFrame:true});this.url=url;this.webContents.mainFrame={url,origin:new URL(url).origin,detached:false,isDestroyed:()=>false,send:(...args)=>this.settingsMessages.push(args)};}isMinimized(){return this.minimized??false;}restore(){this.minimized=false;}show(){this.hidden=false;}hide(){this.hidden=true;}focus(){this.focused=true;}isDestroyed(){return this.destroyed??false;}setTitle(){}
  getContentBounds(){return {width:this.contentWidth??this.options.width};}
  getWindowButtonPosition(){return this.buttonPosition??this.options.trafficLightPosition;}
  setWindowButtonPosition(value){this.buttonPosition=value;this.buttonMoves=(this.buttonMoves??0)+1;}
  close(){const event={preventDefault(){this.prevented=true;}};this.emit('close',event);if(event.prevented)return;this.destroyed=true;this.contentsDestroyed=true;this.emit('closed');if(windows.every(w=>w.isDestroyed()))app.emit('window-all-closed');}
 }
 const updater=new EventEmitter();Object.assign(updater,{setFeedURL:value=>nativeCalls.push(['feed',value]),checkForUpdates:()=>{nativeCalls.push(['check-update']);if(native.checkError)throw Error('private_network_detail');},quitAndInstall:()=>{nativeCalls.push(['install-update']);if(native.installError)throw Error('private_install_detail');app.quit();}});
 const electron={autoUpdater:updater,app,BrowserWindow,ipcMain:{handle:(name,cb)=>{assert.equal(handlers.has(name),false);handlers.set(name,cb);}},systemPreferences:{isTrustedAccessibilityClient:prompt=>{nativeCalls.push(['ax',prompt]);return native.ax?native.ax(prompt):false;},getMediaAccessStatus:kind=>{nativeCalls.push(['screen',kind]);return native.screen?native.screen(kind):'not-determined';}},Menu:{buildFromTemplate:value=>value,setApplicationMenu:value=>handlers.set('menu',value)},dialog:{showMessageBox:async(_window,options)=>{const o=options??_window;messages.push({...o,parent:options?_window:undefined});return {response:typeof native.response==='function'?await native.response(o):native.response??1};}},shell:{openExternal:url=>{nativeCalls.push(['external',url]);return native.external?native.external(url):openExternal(url);},openPath:path=>{nativeCalls.push(['open',path]);return native.open?native.open(path):Promise.resolve('');}}};
 const fs={readFileSync:path=>Buffer.from(JSON.stringify(String(path).endsWith('app-update.yml')?{publisherName:native.publisher??['CN=Homer, O=Homer, C=CN'],...native.updateConfig}:({format:2,preparation:!native.published,localWorkingTree:native.localWorkingTree,publishable:native.publishable,version:'0.1.0',build:5,account:{websiteOrigin:'https://website.example.invalid',gatewayOrigin:'https://models.super-tree.com'},...native.manifest}))),existsSync:()=>true,mkdirSync(){},realpathSync:value=>value};
 const cp={execFile:(bin,args,options,done)=>{nativeCalls.push(['verify',bin,args]);const finish=()=>done(native.verifyError&&!options.env.HOMER_UPDATE_FILE.endsWith('Homer.exe')?Error('private_verify'):null,native.verifyOutput&&!options.env.HOMER_UPDATE_FILE.endsWith('Homer.exe')?native.verifyOutput:JSON.stringify({valid:options.env.HOMER_UPDATE_FILE.endsWith('Homer.exe')||!native.invalidSignature,subject:options.env.HOMER_UPDATE_FILE.endsWith('Homer.exe')?'CN=Homer, O=Homer, C=CN':native.signer??'CN=Homer, O=Homer, C=CN',path:options.env.HOMER_UPDATE_FILE,embedded:true}));if(native.holdVerify)native.releaseVerify=finish;else queueMicrotask(finish);},execFileSync:(_bin,args)=>{if(args.includes('-R')&&native.untrustedSigner)throw Error('signer');return Buffer.alloc(0);},spawn(bin,args,options){spawnCount++;launches.push({bin,args,options});return child;}};
 const config=()=>({main:{baseUrl:'https://models.super-tree.com/v1',model:'deepseek-flash',context:{contextWindow:512000,autoCompactTokenLimit:400000,autoCompactTokenLimitScope:'total'},effort:'max',fast:false},worker:{baseUrl:'https://models.super-tree.com/v1',model:'deepseek-flash',context:{contextWindow:512000,autoCompactTokenLimit:400000,autoCompactTokenLimitScope:'total'},effort:'max',fast:false}});
 let stored=native.connection??{token:'synthetic-file-token',subject:'fixture_user',config:config()};
 const account={queryHomerRuntimeConfig:async options=>{nativeCalls.push(['config']);return native.config?native.config(options):config();},saveHomerRuntimeConfig:(_path,value)=>{if(native.writeError)throw Error('CONNECTION_WRITE_FAILED');stored={token:stored.token,subject:stored.subject,config:value};nativeCalls.push(['save-config']);return stored;},readHomerConnection:path=>{tokenFiles.push(path);if(native.invalidTokenFile)throw Error('CONNECTION_FILE_INVALID');return stored;},validateHomerOrigins:v=>v,authorizeHomerConnection:async options=>{const value=native.authorize?await native.authorize(options):{token:'synthetic-website-token',subject:'fixture_user',config:config()};if(!options.signal.aborted)stored=value;return value;},disconnectHomerConnection:()=>{nativeCalls.push(['disconnect']);if(native.disconnectError)throw Error('CONNECTION_WRITE_FAILED');stored=stored?.subject?{...stored,token:undefined}:null;},queryHomerWallet:async()=>{nativeCalls.push(['wallet']);return native.wallet?native.wallet():{available:5,used:2,unit:'原生额度'};}};
 class NsisUpdater extends EventEmitter{constructor(options){super();nativeCalls.push(['nsis',options]);this.on('error',()=>{if(this.logger!==null)console.error('private_library_log');});}checkForUpdates(){nativeCalls.push(['check-update',this.logger]);if(native.checkReject){this.emit('error',Error('private_check'));return Promise.reject(Error('private_check'));}return Promise.resolve(native.nullCheck?null:{downloadPromise:native.downloadReject?Promise.resolve().then(()=>{this.emit('error',Error('private_download'));throw Error('private_download');}):Promise.resolve([])});}quitAndInstall(...args){if(this.quitAndInstallCalled)return;this.quitAndInstallCalled=true;nativeCalls.push(['install-update',...args]);if(native.closeBeforeInstallError)for(const w of windows){w.destroyed=true;w.contentsDestroyed=true;}if(native.installError)throw Error('private_install');if(native.installAsyncError)this.emit('error',Error('EACCES UNKNOWN private_install'));queueMicrotask(()=>app.quit());}}
 const modules={'electron-updater':{default:{NsisUpdater}},'js-yaml':{default:{load:JSON.parse}},'../homer/dist/homer-account.js':account,'../homer/dist/processes.js':{processIdentity:()=> 'synthetic-process',leaseOwnerGone:()=>true},'electron':electron,'node:fs':fs,'node:child_process':cp,'../homer/scripts/desktop-profile.mjs':{prepareDesktopProfile:root=>({root,runtime:native.runtime??join(root,'runtime'),workspace:join(root,'workspace'),codexHome:native.codexHome??join(root,'codex'),...(native.adopted?{adoption:{appData:'/synthetic/original-app'}}:{})}),recoverDesktopOwner:home=>{assert.equal(ownsLock,true);ownershipCalls.push(['recover-owner',home]);if(native.recoveryError)throw Error('desktop_owner_unknown');},assertDesktopControlPaths(){},readDesktopModelSource:(_root,fallback)=>native.modelSource??fallback,saveDesktopModelSource:(_root,source)=>{if(native.sourceWriteError)throw Error('desktop_source_write_failed');nativeCalls.push(['source',source]);}}};
 Object.assign(account,native.accountApi);
 let timer;const context=vm.createContext({process:{argv:['Homer','--test-profile','/synthetic/profile'],resourcesPath:'/synthetic/Homer.app/Contents/Resources',platform:'darwin',execPath:'C:\\Homer\\Homer.exe',arch:native.arch??'arm64',env:{SystemRoot:'C:\\Windows',LOCALAPPDATA:'C:\\RedirectedLocal'}},Buffer,URL,AbortController,console:native.console??console,performance:{now:()=>monotonic},setTimeout:cb=>{timer=cb;return 1;},clearTimeout(){}});
 context.process.argv=args;context.process.platform=platform;
 const path=resolve('packaging/electron/main.mjs');
 // Lifecycle controls exist only in this VM copy, never in the product entry.
 async function synthetic(name){const exports=modules[name]??createRequire(import.meta.url)(name);const m=new vm.SyntheticModule(Object.keys(exports),function(){for(const [key,value]of Object.entries(exports))this.setExport(key,value);},{context});await m.link(()=>{});await m.evaluate();return m;}
 const entry=new vm.SourceTextModule(readFileSync(path,'utf8')+'\nexport {createWindow,windowsUpdater}; export const forgetWindowForTest=()=>{window=undefined;};',{context,identifier:path,importModuleDynamically:synthetic,initializeImportMeta:meta=>{meta.url='file://'+path;}});
 await entry.link(async name=>{const exports=modules[name]??createRequire(import.meta.url)(name);const m=new vm.SyntheticModule(Object.keys(exports),function(){for(const [key,value]of Object.entries(exports))this.setExport(key,value);},{context});return m;});
 await entry.evaluate();await new Promise(r=>setImmediate(r));
 return {options:native,paths,get updater(){return nativeCalls.some(c=>c[0]==='nsis')?entry.namespace.windowsUpdater:updater;},advance:ms=>{monotonic+=ms;},BrowserWindow,nativeCalls,ownershipCalls,launches,credentials,tokenFiles,setPlatform:value=>{context.process.platform=value;},createWindow:entry.namespace.createWindow,forgetWindow:entry.namespace.forgetWindowForTest,app,child,windows,handlers,messages,sent,spawnCount:()=>spawnCount,timeout:()=>timer?.(),tick:()=>new Promise(r=>setImmediate(r)),event:value=>child.stdout.write(JSON.stringify(value)+'\n')};
}
if(!vm.SourceTextModule){
 test('Electron shell contracts run with Node VM module support',()=>{execFileSync(process.execPath,['--experimental-vm-modules','--test',fileURLToPath(import.meta.url)],{stdio:'pipe'});});
}else{

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
 const parent=resolve('.codex/scratch/chat-architecture-implementation-20261105/adoption-runtime-tests');mkdirSync(parent,{recursive:true});
 const profile=mkdtempSync(join(parent,'case-'));t.after(()=>rmSync(profile,{recursive:true,force:true}));
 const runtime=join(profile,'old-runtime'),codexHome=join(profile,'codex'),workspace=join(profile,'workspace');
 for(const path of [runtime,join(runtime,'gateway'),codexHome,workspace,join(profile,'host-home'),join(profile,'tmp')])mkdirSync(path,{recursive:true,mode:0o700});
 const dead=Number(execFileSync(process.execPath,['-e','process.stdout.write(String(process.pid))'],{encoding:'utf8'}));assert.equal(processIdentity(dead),undefined);
 const locks=[join(runtime,'cli.lock'),join(runtime,'gateway/cli.lock')];
 for(const [index,path]of locks.entries())writeFileSync(path,mode==='runtime-unknown'&&index===0?'{}':JSON.stringify({pid:mode===(index===0?'runtime-live':'gateway-live')?process.pid:dead,identity:'unverified-old-identity'}),{mode:0o600});
 const database=join(runtime,'homer.sqlite'),db=new DatabaseSync(database);
 try{db.exec('CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT); CREATE TABLE retained(state TEXT); INSERT INTO retained VALUES(\'unknown\')');db.prepare('INSERT INTO meta VALUES(?,?)').run('mainThread','original-main');db.prepare('INSERT INTO meta VALUES(?,?)').run('lease:main',JSON.stringify({pid:mode==='lease-live'?process.pid:dead,identity:'old-native'}));}finally{db.close();}
 const config={runtime,codexHome,workspace,requiresOpenaiAuth:true},sourceConfig=join(profile,'source.json'),sourceBytes=Buffer.from(JSON.stringify(config));writeFileSync(sourceConfig,sourceBytes,{mode:0o600});
 const digest=bytes=>createHash('sha256').update(bytes).digest('hex'),paths={runtime,codexHome,workspace,adoption:{sourceConfig,sha256:digest(sourceBytes),appData:profile,nativeCodexHome:codexHome}};
 writeFileSync(join(profile,'.homer-desktop-test-profile'),'{"format":1}');writeFileSync(join(profile,'fixture-codex.mjs'),'synthetic');
 const ownerFile=join(codexHome,'desktop-owner.json');
 if(mode==='dead'){writeFileSync(ownerFile,JSON.stringify({format:1,pid:dead,identity:'old-runtime',runtime}),{mode:0o600});desktop.recoverDesktopOwner(codexHome,processIdentity,leaseOwnerGone);assert.equal(existsSync(ownerFile),false);for(const path of locks)assert.equal(existsSync(path),true);}
 if(mode==='home-owned')writeFileSync(ownerFile,JSON.stringify({format:1,pid:process.pid,identity:processIdentity(process.pid),runtime}),{mode:0o600});
 const before=readFileSync(database),lockBefore=locks.map(path=>readFileSync(path)),events=[],stdin=new PassThrough();let lockAttempts=0;
 const bundle='/synthetic/Homer.app',resources=bundle+'/Contents/Resources',homer=resources+'/homer',empty=Buffer.alloc(0);
 const manifest={format:2,node:'22.22.0',codex:'0.163.0',arch:'arm64',files:[],sourceHash:'synthetic-hash',codeFiles:['Contents/MacOS/homer-image-decoder','Contents/MacOS/node'].map(path=>({path,sha256:digest(empty)}))};
 const proc={argv:['node','desktop-runtime','--profile',profile,'--test-profile'],version:'v22.22.0',arch:'arm64',platform:'darwin',execPath:bundle+'/Contents/MacOS/node',stdin,stdout:new Writable({write(bytes,_encoding,done){events.push(JSON.parse(String(bytes)));done();}}),env:{HOME:join(profile,'host-home'),TMPDIR:join(profile,'tmp')},cwd:()=>profile};
 const modules={
  'node:fs':{...filesystem,realpathSync:path=>String(path).startsWith(bundle)?path:filesystem.realpathSync(path),readdirSync:path=>path===resources?[]:filesystem.readdirSync(path),readFileSync:(path,...args)=>path===join(resources,'desktop-manifest.json')?Buffer.from(JSON.stringify(manifest)):String(path).startsWith(bundle)?empty:filesystem.readFileSync(path,...args)},
  './desktop-profile.mjs':{...desktop,prepareDesktopProfile:()=>paths,readDesktopModelSource:()=> 'codex'},
  ['file://'+homer+'/dist/processes.js']:{processIdentity,leaseOwnerGone},
  ['file://'+homer+'/dist/model-config.js']:{PRODUCT_MODEL_DEFAULTS:{model:'synthetic'}},
  ['file://'+homer+'/dist/config.js']:{loadConfig:path=>{assert.equal(path,sourceConfig);return config;}},
  ['file://'+homer+'/dist/recursive-tasks.js']:{RECURSIVE_SCHEMA_VERSION:'5'},
  ['file://'+homer+'/dist/mobile-gateway.js']:{readMobileConfig:()=>({})},
  './trusted-build.mjs':{verifyBuild(){}},
  './dev.mjs':{runDev:async options=>{assert.equal(options.fixedBuild.thread,'original-main');const releases=[];try{for(const path of [join(runtime,'gateway'),runtime]){lockAttempts++;releases.push(acquireLock(path));}return {noHostStarted:true};}catch(error){return {noHostStarted:true,startupError:error.message};}finally{for(const release of releases.reverse())release();}}},
 };
 const context=vm.createContext({process:proc,Buffer,console}),require=createRequire(import.meta.url);
 async function synthetic(name){const exports=modules[name]??require(name),module=new vm.SyntheticModule(Object.keys(exports),function(){for(const [key,value]of Object.entries(exports))this.setExport(key,value);},{context});await module.link(()=>{});await module.evaluate();return module;}
 const entry=new vm.SourceTextModule(readFileSync('scripts/desktop-runtime.mjs','utf8'),{context,initializeImportMeta:meta=>{meta.url='file://'+homer+'/scripts/desktop-runtime.mjs';},importModuleDynamically:synthetic});
 await entry.link(synthetic);await entry.evaluate();stdin.destroy();
 if(mode==='dead'){assert.equal(proc.exitCode,undefined,JSON.stringify(events));assert.equal(lockAttempts,2);assert.ok(events.some(event=>event.kind==='stopped'));for(const path of locks)assert.equal(existsSync(path),false);}
 else{assert.equal(proc.exitCode,1);assert.equal(events.some(event=>event.kind==='stopped'),false);assert.equal(events.find(event=>event.kind==='error')?.code,mode==='home-owned'?'desktop_owner_conflict':mode==='lease-live'?'desktop_adoption_owner_unknown':mode==='runtime-unknown'?'runtime_already_open':'runtime_lock_identity_unverified');assert.equal(lockAttempts,mode==='gateway-live'?1:mode==='lease-live'||mode==='home-owned'?0:2);if(mode==='runtime-live'||mode==='runtime-unknown')assert.deepEqual(readFileSync(locks[0]),lockBefore[0]);if(mode==='gateway-live')assert.deepEqual(readFileSync(locks[1]),lockBefore[1]);}
 assert.deepEqual(readFileSync(database),before);assert.deepEqual(readFileSync(sourceConfig),sourceBytes);
 assert.equal(existsSync(ownerFile),mode==='home-owned');
});

const stableManifest={releaseChannel:'stable',appId:'app.homer.desktop',publishable:true,preparation:false};
async function updateFixture(native={}){return accountFixture({manifest:stableManifest,...native});}
const updateCall=async(f,name,...args)=>{const action=f.handlers.get('homer:update:'+name);assert.equal(typeof action,'function','missing trusted update action: '+name);return action(accountEvent(f),...args);};
const updateMenu=f=>f.handlers.get('menu')[0].submenu.find(item=>item.id==='update');
async function windowsFixture(native={}){const f=await fixture(['Homer'],undefined,'win32',{arch:'x64',published:true,publishable:true,manifest:stableManifest,...native});f.event({kind:'url',url:'http://127.0.0.1:56789/',desktopAccessToken:'a'.repeat(64)});await f.tick();return f;}
test('Windows uses only NSIS generic latest with explicit safety switches and quiet logger',async()=>{
 const f=await windowsFixture();assert.ok(f.updater);assert.equal(f.nativeCalls.filter(c=>c[0]==='check-update').length,1);
 assert.equal(f.launches[0].options.env.LOCALAPPDATA,'C:\\RedirectedLocal');assert.equal(f.updater.logger,null);for(const [name,value]of Object.entries({autoDownload:true,autoInstallOnAppQuit:false,allowPrerelease:false,allowDowngrade:false,disableDifferentialDownload:true,disableWebInstaller:true}))assert.equal(f.updater[name],value);
 assert.equal(f.nativeCalls.find(c=>c[0]==='nsis')[1].url,'https://super-tree.com/homer/updates/stable/win32-x64/');
});
for(const readyFirst of [false,true])test('Windows startup stays usable while signature validation is pending '+readyFirst,async()=>{
 const f=await fixture(['Homer'],undefined,'win32',{arch:'x64',published:true,publishable:true,manifest:stableManifest,holdVerify:true});
 assert.equal(f.spawnCount(),1);assert.equal(f.windows.length,1);assert.equal(f.nativeCalls.filter(c=>c[0]==='check-update').length,0);
 const ready=()=>f.event({kind:'url',url:'http://127.0.0.1:56789/',desktopAccessToken:'a'.repeat(64)});
 if(readyFirst)ready();f.options.holdVerify=false;f.options.releaseVerify();await f.tick();if(!readyFirst)ready();await f.tick();
 assert.equal(f.nativeCalls.filter(c=>c[0]==='check-update').length,1);
});
for(const options of [{checkReject:true},{downloadReject:true},{nullCheck:true}])test('Windows consumes updater Promise rejection or null '+JSON.stringify(options),async()=>{const f=await windowsFixture(options);await f.tick();assert.equal(f.nativeCalls.filter(c=>c[0]==='check-update').length,1);assert.equal(f.sent.length,0);});
test('Windows signature verification preserves a Unicode path and full publisher subject',async()=>{
 const unicode=await windowsFixture({publisher:['CN=Homer, O=Homer, C=CN','CN=荷马, O=荷马, C=CN'],signer:'CN=荷马, O=荷马, C=CN'});
 unicode.updater.emit('update-downloaded',{version:'0.2.0',downloadedFile:'C:\\Users\\测试\\缓存\\安装.exe'});await unicode.tick();assert.equal((await updateCall(unicode,'state')).status,'ready');
 for(const call of unicode.nativeCalls.filter(c=>c[0]==='verify'))assert.ok(call[2].at(-1).includes('[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)'));
});
for(const invalid of [{invalidSignature:true},{verifyError:true},{signer:'CN=Other, O=Other, C=CN'}])test('Windows cached candidate is verified before ready '+JSON.stringify(invalid),async()=>{const f=await windowsFixture(invalid);f.updater.emit('update-downloaded',{version:'0.2.0',downloadedFile:'C:\\cache\\installer.exe'});await f.tick();assert.equal((await updateCall(f,'state')).status,'error');assert.equal(f.nativeCalls.some(c=>c[0]==='install-update'),false);});
test('Windows revalidates a replacement candidate for the same version without reopening a dismissed notice',async()=>{
 const f=await windowsFixture();f.updater.emit('update-downloaded',{version:'0.2.0',downloadedFile:'C:\\cache\\first.exe'});await f.tick();await updateCall(f,'dismiss');
 f.updater.emit('update-downloaded',{version:'0.2.0',downloadedFile:'C:\\cache\\second.exe'});await f.tick();assert.equal((await updateCall(f,'state')).noticeHidden,true);f.options.invalidSignature=true;
 f.updater.emit('update-downloaded',{version:'0.2.0',downloadedFile:'C:\\cache\\tampered.exe'});await f.tick();const state=await updateCall(f,'state');assert.equal(state.status,'error');assert.equal(state.noticeHidden,true);assert.equal(f.nativeCalls.some(c=>c[0]==='install-update'),false);
});
for(const closeFirst of [false,true])test('Windows verifies before ready and again only after safe stop closeFirst='+closeFirst,async()=>{
 const f=await windowsFixture();f.updater.emit('update-downloaded',{version:'0.2.0',downloadedFile:'C:\\cache\\installer.exe'});await f.tick();assert.equal((await updateCall(f,'state')).status,'ready');await updateCall(f,'dismiss');await updateCall(f,'restart');await f.tick();if(closeFirst)f.child.emit('close',0,null);f.event({kind:'update-stopped'});if(!closeFirst)f.child.emit('close',0,null);await f.tick();assert.equal(f.nativeCalls.filter(c=>c[0]==='verify').length,3);assert.deepEqual(JSON.parse(JSON.stringify(f.nativeCalls.filter(c=>c[0]==='install-update'))),[['install-update',true,true]]);
});
for(const closeFirst of [false,true])for(const failure of ['sync','async'])for(const action of ['cancel','quit'])test('Windows '+failure+' failed install '+(closeFirst?'after window destruction ':'')+action+' does not reuse installer state',async()=>{
 let response=0;const f=await windowsFixture({installError:failure==='sync',installAsyncError:failure==='async',closeBeforeInstallError:closeFirst,response:options=>options.buttons.includes('重启并更新')?1:response});let exits=0;f.app.on('quit',()=>exits++);
 f.updater.emit('update-downloaded',{version:'0.2.0',downloadedFile:'C:\\cache\\installer.exe'});await f.tick();await updateCall(f,'dismiss');await updateCall(f,'restart');await f.tick();f.event({kind:'update-stopped'});f.child.emit('close',0,null);await f.tick();
 assert.equal(f.updater.quitAndInstallCalled,true);const prompts=f.messages.filter(m=>m.type==='question').length;f.app.quit();await f.tick();assert.equal(f.messages.filter(m=>m.type==='question').length,prompts,'delayed library quit is intercepted');assert.equal(exits,0);
 f.updater.emit('update-downloaded',{version:'0.3.0',downloadedFile:'C:\\cache\\other.exe'});f.updater.emit('error',Error('private_late'));await f.tick();assert.equal(f.messages.filter(m=>m.type==='question').length,prompts);
 response=action==='quit'?1:0;updateMenu(f).click();await f.tick();assert.deepEqual(Array.from(f.messages.at(-1).buttons),['取消','退出荷马']);if(closeFirst)assert.equal(f.messages.at(-1).parent,undefined);assert.equal(exits,action==='quit'?1:0);assert.equal(f.nativeCalls.filter(c=>c[0]==='install-update').length,1);assert.equal(f.sent.length,1);assert.equal(f.nativeCalls.some(c=>c[0]==='relaunch'),false);
 if(action==='cancel'){response=1;f.windows[0].close();await f.tick();assert.equal(exits,1);}
 const reopened=await windowsFixture();reopened.event({kind:'update-stopped'});reopened.child.emit('close',0,null);await reopened.tick();assert.equal(reopened.nativeCalls.some(c=>c[0]==='install-update'),false);assert.equal(reopened.nativeCalls.filter(c=>c[0]==='check-update').length,1);
});
for(const destroyed of [false,true])for(const order of ['ack-close','close-ack'])for(const errorAfterFirst of [false,true])test('Windows stop-time error recovers cancel and exit '+order+' destroyed='+destroyed+' errorAfterFirst='+errorAfterFirst,async()=>{
 let response=0;const f=await windowsFixture({response:options=>options.buttons.includes('重启并更新')?1:response});let exits=0;f.app.on('quit',()=>exits++);
 f.updater.emit('update-downloaded',{version:'0.2.0',downloadedFile:'C:\\cache\\installer.exe'});await f.tick();await updateCall(f,'dismiss');await updateCall(f,'restart');await f.tick();
 if(destroyed){f.windows[0].destroyed=true;f.windows[0].contentsDestroyed=true;}
 if(errorAfterFirst){if(order==='ack-close')f.event({kind:'update-stopped'});else f.child.emit('close',0,null);}
 f.updater.emit('error',Error('synthetic_stop_error'));await f.tick();
 f.updater.emit('update-not-available');f.updater.emit('update-available',{version:'0.3.0'});f.updater.emit('update-downloaded',{version:'0.3.0',downloadedFile:'C:\\cache\\late.exe'});await f.tick();
 if(!errorAfterFirst){if(order==='ack-close')f.event({kind:'update-stopped'});else f.child.emit('close',0,null);}
 if(order==='ack-close')f.child.emit('close',0,null);else f.event({kind:'update-stopped'});await f.tick();
 assert.deepEqual(Array.from(f.messages.at(-1).buttons),['取消','退出荷马']);if(destroyed)assert.equal(f.messages.at(-1).parent,undefined);
 if(!destroyed){const state=await updateCall(f,'state');assert.equal(state.status,'error');assert.equal(state.noticeHidden,true);}
 const prompts=f.messages.filter(m=>m.type==='question').length;f.app.quit();f.updater.emit('error',Error('synthetic_late_error'));f.event({kind:'update-stopped'});await f.tick();assert.equal(exits,0);assert.equal(f.messages.filter(m=>m.type==='question').length,prompts);
 response=1;updateMenu(f).click();await f.tick();assert.equal(exits,1);assert.equal(f.nativeCalls.filter(c=>c[0]==='check-update').length,1);assert.equal(f.nativeCalls.some(c=>c[0]==='install-update'||c[0]==='relaunch'),false);assert.equal(f.sent.length,1);
});
for(const [name,ack,status,signal]of [['no-ack',false,0,null],['nonzero',true,1,null],['signal',true,null,'SIGTERM'],['timeout',false,0,null]])test('Windows stop-time error without proof still refuses exit '+name,async()=>{
 const f=await windowsFixture({response:1});let exits=0;f.app.on('quit',()=>exits++);f.updater.emit('update-downloaded',{version:'0.2.0',downloadedFile:'C:\\cache\\installer.exe'});await f.tick();await updateCall(f,'restart');await f.tick();f.updater.emit('error',Error('synthetic_stop_error'));if(ack)f.event({kind:'update-stopped'});f.child.emit('close',status,signal);await f.tick();if(name==='timeout'){f.timeout();f.event({kind:'update-stopped'});await f.tick();}updateMenu(f).click();f.app.quit();await f.tick();assert.equal(exits,0);assert.equal(f.nativeCalls.some(c=>c[0]==='install-update'),false);
});
test('Windows recovery invalidates an in-flight pre-install verification',async()=>{
 let response=0;const f=await windowsFixture({response:options=>options.buttons.includes('重启并更新')?1:response});let exits=0;f.app.on('quit',()=>exits++);
 f.updater.emit('update-downloaded',{version:'0.2.0',downloadedFile:'C:\\cache\\installer.exe'});await f.tick();await updateCall(f,'restart');await f.tick();f.options.holdVerify=true;f.event({kind:'update-stopped'});f.child.emit('close',0,null);await f.tick();
 assert.equal(typeof f.options.releaseVerify,'function');f.updater.emit('error',Error('synthetic_verification_error'));await f.tick();assert.deepEqual(Array.from(f.messages.at(-1).buttons),['取消','退出荷马']);
 f.options.holdVerify=false;f.options.releaseVerify();await f.tick();assert.equal(exits,0);assert.equal(f.nativeCalls.some(c=>c[0]==='install-update'),false);
 response=1;updateMenu(f).click();await f.tick();assert.equal(exits,1);assert.equal(f.sent.length,1);
});
test('Windows rejects malformed signature output and required elevation without leaking raw errors',async()=>{
 const f=await windowsFixture({verifyOutput:'private malformed response https://example.invalid/?secret=sentinel'});f.updater.emit('update-downloaded',{version:'0.2.0',downloadedFile:'C:\\cache\\installer.exe'});await f.tick();assert.equal((await updateCall(f,'state')).status,'error');assert.equal(JSON.stringify(f.messages).includes('sentinel'),false);
 const elevated=await windowsFixture();elevated.updater.emit('update-downloaded',{version:'0.2.0',downloadedFile:'C:\\cache\\installer.exe',files:[{isAdminRightsRequired:true}]});await elevated.tick();assert.equal((await updateCall(elevated,'state')).status,'error');
});
test('Windows installation-time signature failure preserves proof and requires exit/reopen',async()=>{
 let response=0;const f=await windowsFixture({response:options=>options.buttons.includes('重启并更新')?1:response});let exits=0;f.app.on('quit',()=>exits++);f.updater.emit('update-downloaded',{version:'0.2.0',downloadedFile:'C:\\cache\\installer.exe'});await f.tick();await updateCall(f,'restart');await f.tick();f.options.invalidSignature=true;f.event({kind:'update-stopped'});f.child.emit('close',0,null);await f.tick();assert.equal(f.nativeCalls.some(c=>c[0]==='install-update'),false);assert.equal(exits,0);response=1;updateMenu(f).click();await f.tick();assert.equal(exits,1);assert.equal(f.sent.length,1);
});
for(const publisher of [[],['CN=OnlyName'],['']])test('Windows disables updates without a full trusted publisher '+JSON.stringify(publisher),async()=>{const f=await windowsFixture({publisher});assert.equal(f.nativeCalls.some(c=>c[0]==='nsis'),false);assert.equal(await updateCall(f,'state'),null);});
test('Windows disables updates when packaged verification is disabled',async()=>{const f=await windowsFixture({updateConfig:{verifyUpdateCodeSignature:false}});assert.equal(f.nativeCalls.some(c=>c[0]==='nsis'),false);});
test('Windows errors publish safe state without library or signature output',async()=>{
 const logs=[],f=await windowsFixture({console:{error:(...v)=>logs.push(v),log:(...v)=>logs.push(v),warn:(...v)=>logs.push(v)}}),sentinel='synthetic_secret_body https://example.invalid/?private=1 C:\\Users\\Private';
 f.updater.emit('error',Error(sentinel));await f.tick();const state=await updateCall(f,'state');assert.equal(state.error,'update_check_failed');assert.equal(JSON.stringify([logs,f.messages,state,f.windows.map(w=>w.settingsMessages)]).includes(sentinel),false);assert.equal(logs.length,0);
});
for(const changed of ['valid-cache','tampered-cache','withdrawn'])test('Windows reopened process rechecks '+changed+' and cannot reuse a previous stop ACK',async()=>{
 const f=await windowsFixture({invalidSignature:changed==='tampered-cache',nullCheck:changed==='withdrawn'});f.event({kind:'update-stopped'});await f.tick();
 if(changed!=='withdrawn')f.updater.emit('update-downloaded',{version:'0.2.0',downloadedFile:'C:\\cache\\installer.exe'});await f.tick();const state=await updateCall(f,'state');assert.equal(state.status,changed==='valid-cache'?'ready':changed==='withdrawn'?'idle':'error');
 assert.equal(f.nativeCalls.filter(c=>c[0]==='check-update').length,1);assert.equal(f.nativeCalls.some(c=>c[0]==='install-update'),false);
});
test('stable Mac starts one native check after ready and deduplicates reconnect and manual checks',async()=>{
 const f=await updateFixture();assert.deepEqual(JSON.parse(JSON.stringify(f.nativeCalls.filter(c=>c[0]==='feed'))),[['feed',{url:'https://super-tree.com/homer/updates/stable/darwin-arm64/RELEASES.json',serverType:'json'}]]);
 assert.equal(f.nativeCalls.filter(c=>c[0]==='check-update').length,1);
 f.event({kind:'url',url:'http://127.0.0.1:56789/',desktopAccessToken:'a'.repeat(64)});f.app.emit('activate');updateMenu(f).click();await f.tick();
 assert.equal(f.nativeCalls.filter(c=>c[0]==='check-update').length,1);
 f.updater.emit('update-not-available');updateMenu(f).click();assert.equal(f.nativeCalls.filter(c=>c[0]==='check-update').length,2);
});
test('Intel Mac reads only its own feed',async()=>{
 const f=await updateFixture({arch:'x64'});assert.equal(f.nativeCalls.find(c=>c[0]==='feed')[1].url,'https://super-tree.com/homer/updates/stable/darwin-x64/RELEASES.json');
});
for(const [name,options]of [['missing channel',{manifest:{}}],['QA',{manifest:{...stableManifest,releaseChannel:'qa'}}],['candidate ID',{manifest:{...stableManifest,appId:'app.homer.desktop.candidate'}}],['local tree',{manifest:{...stableManifest,localWorkingTree:true}}],['untrusted signer',{untrustedSigner:true}],['unknown arch',{arch:'riscv64'}]])test('update remains disabled for '+name,async()=>{
 const f=await updateFixture(options);assert.equal(await updateCall(f,'state'),null);assert.equal(f.nativeCalls.some(c=>c[0]==='feed'||c[0]==='check-update'),false);
});
test('test profile never configures native updates even with stable metadata',async()=>{
 const f=await fixture(undefined,undefined,undefined,{manifest:stableManifest});assert.equal(f.nativeCalls.some(c=>c[0]==='feed'),false);
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
 const f=await updateFixture();f.app.quit();f.updater.emit('update-downloaded',{},'', '0.2.0');await f.tick();
 assert.deepEqual(f.sent.map(JSON.parse),[{kind:'update-stop'}]);
});
test('a staged update arriving after ordinary stop was sent cannot bypass update-stop proof',async()=>{
 const f=await updateFixture();let quits=0;f.app.on('quit',()=>quits++);f.app.quit();await f.tick();assert.equal(JSON.parse(f.sent[0]).kind,'quit');
 f.updater.emit('update-downloaded',{},'', '0.2.0');f.event({kind:'stopped'});f.child.emit('close',0,null);await f.tick();
 assert.equal(quits,0);assert.equal((await updateCall(f,'state')).error,'update_service_stopped');assert.equal(f.nativeCalls.some(c=>c[0]==='install-update'),false);
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
test('updater failures never expose native errors or report preparation success',async()=>{
 const f=await updateFixture({checkError:true});assert.equal((await updateCall(f,'state')).status,'error');assert.equal(JSON.stringify(await updateCall(f,'state')).includes('private'),false);
 const malformed=await updateFixture();malformed.updater.emit('update-downloaded',{},'', '<unsafe>');await updateCall(malformed,'restart');await malformed.tick();assert.equal(malformed.sent.length,0);
});
test('update bridge rejects extra arguments and stale or foreign frames',async()=>{
 const f=await updateFixture();for(const method of ['state','dismiss','restart']){
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
  let result;f.handlers.get('desktop-request')({url:origin+'/api/state',webContents:w.webContents,frame:w.webContents.mainFrame,resourceType:'xhr',initiatorOrigin:origin,requestHeaders:{Accept:'application/json','x-HoMeR-DeSkToP-aCcEsS':'synthetic-forged-header'},...overrides},value=>{result=value.requestHeaders;});
  return Object.fromEntries(Object.entries(result).map(([k,v])=>[k.toLowerCase(),v]));
 };
 assert.equal(headers({})['x-homer-desktop-access'],token);
 for(const overrides of [
  {url:'https://foreign.invalid/api/state'},{url:'http://127.0.0.1:56790/api/state'},
  {url:origin+'/preview/interactive'},{url:origin+'/api/state?q=1'},{url:'http://user:pass@127.0.0.1:56789/api/state'},
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
async function accountFixture(native={}){const f=await fixture(['Homer'],undefined,undefined,{adopted:true,published:true,...native});f.event({kind:'url',url:'http://127.0.0.1:56789/',desktopAccessToken:'a'.repeat(64)});await f.tick();return f;}
test('native login uses the private account channel and never exposes its URL or login ID to the page',async()=>{
 const f=await accountFixture({nativeAction:action=>action==='connect'?{account:'none',connected:false,phase:'waiting',loginId:'synthetic-private-id',authUrl:'https://auth.openai.com/synthetic-login'}:{account:'none',connected:false,phase:action==='cancel'?'cancelled':'idle'}});
 const result=await accountCall(f,'nativeConnect');assert.equal(result.native.pending,true);assert.equal(result.native.canReopen,true);
 assert.equal(JSON.stringify(result).includes('synthetic'),false);assert.ok(f.nativeCalls.some(c=>c[0]==='external'&&c[1]==='https://auth.openai.com/synthetic-login'));
 await accountCall(f,'nativeReopen');await accountCall(f,'nativeCancel');assert.equal((await accountCall(f,'state')).native.connected,false);
 assert.deepEqual(f.nativeCalls.filter(c=>c[0]==='native-account').map(c=>c[1]),['connect','cancel','state']);
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
  await assert.rejects(()=>accountCall(f,name,'extra'),/desktop_account_forbidden/);
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
 authorize({token:'synthetic-new-token',subject:'fixture_user',config:{main:{baseUrl:'https://models.super-tree.com/v1',model:'deepseek-flash',context:{contextWindow:512000,autoCompactTokenLimit:400000,autoCompactTokenLimitScope:'total'},effort:'max',fast:false},worker:{baseUrl:'https://models.super-tree.com/v1',model:'deepseek-flash',context:{contextWindow:512000,autoCompactTokenLimit:400000,autoCompactTokenLimitScope:'total'},effort:'max',fast:false}}});await f.tick();
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

const websiteConnection=()=>({token:'synthetic-account-token',subject:'fixture_user',config:{main:{baseUrl:'https://models.super-tree.com/v1',model:'deepseek-flash',context:{contextWindow:512000,autoCompactTokenLimit:400000,autoCompactTokenLimitScope:'total'},effort:'max',fast:false},worker:{baseUrl:'https://models.super-tree.com/v1',model:'deepseek-flash',context:{contextWindow:512000,autoCompactTokenLimit:400000,autoCompactTokenLimitScope:'total'},effort:'max',fast:false}}});
async function realAccountApi(){
 const source=transpileModule(readFileSync(resolve('src/homer-account.ts'),'utf8'),{compilerOptions:{module:ModuleKind.ESNext,target:ScriptTarget.ES2023}}).outputText;
 const module=new vm.SourceTextModule(source,{identifier:'homer-account-offline'});
 await module.link(async name=>{assert.ok(name.startsWith('node:')||name==='../scripts/windows-security.mjs'||['./deepseek-model.js','./model-context.js','./model-catalog.js','./model-config.js'].includes(name));const exports=name.startsWith('node:')?createRequire(import.meta.url)(name):name.startsWith('./')?await (await import('tsx/esm/api')).tsImport('../src/'+name.slice(2).replace(/\.js$/,'.ts'),import.meta.url):await import('../scripts/windows-security.mjs');return new vm.SyntheticModule(Object.keys(exports),function(){for(const [key,value]of Object.entries(exports))this.setExport(key,value);});});
 await module.evaluate();return module.namespace;
}
test('real account HTTP and private file preserve A until restart, adopt B, and roll back without replacing identity or history',async()=>{
 // Keep validation, HTTP and atomic persistence real; replace only Electron/OS and the local website response.
 const api=await realAccountApi();
 const parent=resolve('.codex/scratch/config-ab-offline-20261030/shell');mkdirSync(parent,{recursive:true});
 const root=realpathSync(mkdtempSync(join(parent,'synthetic-'))),file=join(root,'runtime-config.json'),history=join(root,'history.txt');
 const boundary={gatewayOrigin:'https://models.super-tree.com'},a=websiteConnection(),b={...a.config,worker:{...a.config.worker,effort:'high',context:{contextWindow:600000,autoCompactTokenLimit:450000,autoCompactTokenLimitScope:'total'}}};
 assert.deepEqual(api.validateHomerRuntimeConfig(b,boundary),b);
 api.saveHomerConnection(file,{subject:a.subject,modelToken:a.token,config:a.config},boundary);
 writeFileSync(history,'synthetic existing history\n');const historyBefore=readFileSync(history);
 let config=a.config,mode='good',release,received;const pending=join(root,'.runtime-config.json.pending');
 const server=createServer((req,res)=>{
  assert.equal(req.url,'/api/homer/v1/config');assert.equal(req.method,'GET');
  assert.equal(req.headers.authorization,undefined);assert.equal(req.headers.cookie,undefined);
  if(mode==='unavailable'){res.writeHead(503).end('{}');return;}
  if(mode==='late'){received?.();release=()=>res.end(JSON.stringify(config));return;}
  res.end(JSON.stringify(mode==='invalid'?{...config,worker:{...config.worker,effort:''}}:config));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const accountApi={...api,queryHomerWallet:async()=>{throw Error('USAGE_UNAVAILABLE');},readHomerConnection:()=>api.readHomerConnection(file,boundary),saveHomerRuntimeConfig:(_file,value)=>api.saveHomerRuntimeConfig(file,value,boundary),queryHomerRuntimeConfig:(_options,signal)=>api.queryHomerRuntimeConfig({...boundary,websiteOrigin:'http://127.0.0.1:'+server.address().port,allowSyntheticLoopback:true},signal)};
 const boot=async()=>{const f=await fixture(['Homer'],undefined,undefined,{adopted:true,published:true,accountApi});for(let i=0;i<300&&!f.credentials.length;i++)await new Promise(r=>setTimeout(r,5));assert.equal(f.credentials.length,1);f.event({kind:'url',url:'http://127.0.0.1:56789/',desktopAccessToken:'a'.repeat(64)});await f.tick();return f;};
 const waitFor=async(f,expected)=>{for(let i=0;i<300;i++){const state=await accountCall(f,'state');if(expected(state))return state;await new Promise(r=>setTimeout(r,5));}assert.fail('account state did not settle');};
 const check=async(f,expected)=>{f.advance(3600001);f.event({kind:'account_config_check'});return waitFor(f,expected);};
 const stop=async f=>{f.app.quit();await f.tick();f.event({kind:'stopped'});f.child.emit('close',0,null);await f.tick();};
 let f;
 try{
  f=await boot();assert.deepEqual(JSON.parse(f.credentials[0]),a);
  const bytesA=readFileSync(file);
  for(const [failure,error]of [['invalid','INVALID_REQUEST'],['unavailable','CONFIG_UNAVAILABLE']]){
   mode=failure;await check(f,s=>s.error===error);assert.deepEqual(readFileSync(file),bytesA);
   assert.equal((await accountCall(f,'state')).needsRestart,false);assert.deepEqual(JSON.parse(f.credentials[0]),a);
  }
  config=b;mode='good';symlinkSync(file,pending);
  await check(f,s=>s.error==='CONNECTION_WRITE_FAILED');assert.deepEqual(readFileSync(file),bytesA);rmSync(pending);
  await check(f,s=>s.needsRestart&&!s.error);
  assert.deepEqual(api.readHomerConnection(file,boundary),{...a,config:b});
  assert.equal(statSync(file).mode&0o777,0o600);assert.deepEqual(JSON.parse(f.credentials[0]),a);assert.equal(f.credentials.length,1);assert.equal(f.spawnCount(),1);
  const bytesB=readFileSync(file);await stop(f);f=await boot();assert.deepEqual(readFileSync(file),bytesB);
  assert.deepEqual(JSON.parse(f.credentials[0]),{...a,config:b});assert.equal((await accountCall(f,'state')).needsRestart,false);
  config=a.config;await check(f,s=>s.needsRestart);assert.deepEqual(JSON.parse(f.credentials[0]),{...a,config:b});
  await stop(f);f=await boot();assert.deepEqual(JSON.parse(f.credentials[0]),a);assert.equal((await accountCall(f,'state')).needsRestart,false);
  // A valid delayed response must not save after the shell begins shutting down.
  config=b;mode='late';const arrived=new Promise(r=>received=r);f.advance(3600001);f.event({kind:'account_config_check'});await arrived;
  f.app.quit();release();await new Promise(r=>setTimeout(r,20));assert.deepEqual(api.readHomerConnection(file,boundary),a);
  assert.deepEqual(readFileSync(history),historyBefore);
 }finally{if(f)await stop(f);server.closeAllConnections();await new Promise(r=>server.close(r));rmSync(root,{recursive:true,force:true});}
});
for(const cacheFormat of ['four','five'])for(const modelSource of ['website','codex'])test('old membership cache refreshes at startup without authorization in '+modelSource+' mode from '+cacheFormat+' fields',async()=>{
 const api=await realAccountApi(),parent=resolve('.codex/scratch/membership-context-cache/shell');mkdirSync(parent,{recursive:true});
 const root=realpathSync(mkdtempSync(join(parent,'startup-'))),file=join(root,'runtime-config.json'),pending=join(root,'.runtime-config.json.pending');
 const boundary={gatewayOrigin:'https://models.super-tree.com'},role={baseUrl:boundary.gatewayOrigin+'/v1',model:'deepseek-flash',effort:'max',fast:false};
 if(cacheFormat==='five')role.deepseek={contextWindow:512000,autoCompactTokenLimit:400000,autoCompactTokenLimitScope:'total'};
 const targetRole={baseUrl:boundary.gatewayOrigin+'/v1',model:'Qwen/future-model',effort:null,fast:false,capabilities:{inputModalities:['text'],reasoningEfforts:[],webSearch:false,toolSearch:false},context:{contextWindow:272000,autoCompactTokenLimit:244800,autoCompactTokenLimitScope:'total'}},target={main:targetRole,worker:targetRole};
 const old={subject:'fixture_user',token:'synthetic-retained-key',config:{main:role,worker:role}},bytes=JSON.stringify(old);
 let mode,requests=0,authorizations=0;
 const server=createServer((req,res)=>{
  requests++;assert.equal(req.url,'/api/homer/v1/config');assert.equal(req.headers.authorization,undefined);assert.equal(req.headers.cookie,undefined);
  if(mode==='unavailable'){res.writeHead(503).end('{}');return;}
  res.end(JSON.stringify(mode==='invalid'?old.config:target));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const accountApi={...api,authorizeHomerConnection:async()=>{authorizations++;throw Error('unexpected_authorization');},queryHomerWallet:async()=>{throw Error('USAGE_UNAVAILABLE');},readHomerConnection:()=>api.readHomerConnection(file,boundary),saveHomerRuntimeConfig:(_file,value)=>api.saveHomerRuntimeConfig(file,value,boundary),queryHomerRuntimeConfig:(_options,signal)=>api.queryHomerRuntimeConfig({...boundary,websiteOrigin:'http://127.0.0.1:'+server.address().port,allowSyntheticLoopback:true},signal)};
 const boot=async()=>{
  const f=await fixture(['Homer'],undefined,undefined,{adopted:true,published:true,modelSource,accountApi});
  for(let i=0;i<300&&!f.credentials.length;i++)await new Promise(r=>setTimeout(r,5));
  assert.equal(f.credentials.length,1);f.event({kind:'url',url:'http://127.0.0.1:56789/',desktopAccessToken:'a'.repeat(64)});await f.tick();return f;
 };
 const stop=async f=>{f.app.quit();await f.tick();f.event({kind:'stopped'});f.child.emit('close',0,null);await f.tick();};
 try{
  for(const failure of ['unavailable','invalid','write','good']){
   writeFileSync(file,bytes,{mode:0o600});mode=failure;if(mode==='write')symlinkSync(file,pending);
   let f=await boot();
   try{
    const state=await accountCall(f,'state');assert.equal(state.connection,'website');assert.equal(state.source,modelSource);
    if(failure!=='good'){
     assert.equal(state.error,{unavailable:'CONFIG_UNAVAILABLE',invalid:'INVALID_REQUEST',write:'CONNECTION_WRITE_FAILED'}[failure]);
     assert.equal(state.websiteReady,false);assert.equal(state.needsRestart,false);assert.deepEqual(f.credentials,['null']);assert.equal(readFileSync(file,'utf8'),bytes);
     if(mode==='write')rmSync(pending);mode='good';await stop(f);f=await boot();
    }
    const expected={subject:old.subject,token:old.token,config:target};
    assert.deepEqual(JSON.parse(f.credentials[0]),expected);assert.deepEqual(api.readHomerConnection(file,boundary),expected);
    assert.equal(statSync(file).mode&0o777,0o600);assert.equal((await accountCall(f,'state')).needsRestart,false);
    assert.equal((await accountCall(f,'state')).active,modelSource==='website'?'website':'disconnected');
   }finally{await stop(f);}
  }
  assert.equal(requests,7);assert.equal(authorizations,0);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));rmSync(root,{recursive:true,force:true});}
});
test('startup sync adopts website config; legacy startup failure keeps credential on disk but sends none to runtime',async()=>{
 const f=await accountFixture({connection:websiteConnection()});assert.equal(f.nativeCalls.filter(c=>c[0]==='config').length,1);
 assert.equal(JSON.parse(f.credentials[0]).config.main.model,'deepseek-flash');assert.equal((await accountCall(f,'state')).needsRestart,false);
 const cached=await accountFixture({connection:websiteConnection(),config:async()=>{throw Error('UNAVAILABLE');}});
 assert.equal(JSON.parse(cached.credentials[0]).token,'synthetic-account-token');assert.equal((await accountCall(cached,'state')).error,'CONFIG_UNAVAILABLE');
 const old={token:'synthetic-old',subject:'fixture_user',accountRef:'fixture_account',modelBaseUrl:'https://models.super-tree.com/v1',aliases:{main:'homer-main',worker:'homer-worker'}};
 const offline=await accountFixture({connection:old,config:async()=>{throw Error('UNAVAILABLE');}});assert.deepEqual(offline.credentials,['null']);assert.equal(offline.nativeCalls.some(c=>c[0]==='save-config'),false);assert.equal((await accountCall(offline,'state')).needsRestart,false);
});
test('user message checks only strictly after one hour, merges concurrent requests, and failed attempts consume the interval',async()=>{
 let reads=0,release;
 const f=await accountFixture({connection:websiteConnection(),config:()=>{reads++;if(reads===1)return websiteConnection().config;return new Promise(r=>release=r);}});
 assert.equal(reads,1);f.advance(3600000);f.event({kind:'account_config_check'});await f.tick();assert.equal(reads,1);
 f.advance(1);f.event({kind:'account_config_check'});f.event({kind:'account_config_check'});await f.tick();assert.equal(reads,2);
 assert.equal(f.spawnCount(),1);release(websiteConnection().config);await f.tick();assert.equal((await accountCall(f,'state')).needsRestart,false);
 let failReads=0;const g=await accountFixture({connection:websiteConnection(),config:async()=>{failReads++;throw Error('UNAVAILABLE');}});
 g.advance(3600001);g.event({kind:'account_config_check'});await g.tick();g.event({kind:'account_config_check'});await g.tick();assert.equal(failReads,2);assert.equal((await accountCall(g,'state')).active,'website');
});
test('in-flight config cannot save after disconnect begins, and a write failure preserves the active snapshot',async()=>{
 let release,reads=0;const f=await accountFixture({connection:websiteConnection(),config:()=>++reads===1?websiteConnection().config:new Promise(r=>release=r)});
 f.advance(3600001);f.event({kind:'account_config_check'});await f.tick();const saves=f.nativeCalls.filter(c=>c[0]==='save-config').length;
 await accountCall(f,'disconnect');await f.tick();release(websiteConnection().config);await f.tick();assert.equal(f.nativeCalls.filter(c=>c[0]==='save-config').length,saves);
 const old={token:'synthetic-old',subject:'fixture_user',accountRef:'fixture_account',modelBaseUrl:'https://models.super-tree.com/v1',aliases:{main:'homer-main',worker:'homer-worker'}};
 const g=await accountFixture({connection:old,writeError:true});assert.deepEqual(g.credentials,['null']);assert.equal((await accountCall(g,'state')).error,'CONNECTION_WRITE_FAILED');
});
test('config recovered during a running management session is pending until restart, without replacing the FD snapshot',async()=>{
 let reads=0;const old={token:'synthetic-old',subject:'fixture_user',accountRef:'fixture_account',modelBaseUrl:'https://models.super-tree.com/v1',aliases:{main:'homer-main',worker:'homer-worker'}};
 const f=await accountFixture({connection:old,config:async()=>{if(++reads===1)throw Error('UNAVAILABLE');return websiteConnection().config;}});
 assert.deepEqual(f.credentials,['null']);f.advance(3600001);f.event({kind:'account_config_check'});await f.tick();
 const state=await accountCall(f,'state');assert.equal(state.needsRestart,true);assert.equal(state.connection,'website');assert.equal(state.active,'disconnected');assert.equal(f.spawnCount(),1);assert.deepEqual(f.credentials,['null']);
});
test('login counts as a config check; retired development input never fetches website config',async()=>{
 const f=await accountFixture();await accountCall(f,'connect');await f.tick();f.event({kind:'account_config_check'});await f.tick();assert.equal(f.nativeCalls.filter(c=>c[0]==='config').length,1);
 const g=await accountFixture({connection:{token:'synthetic-development-key'}});g.advance(7200000);g.event({kind:'account_config_check'});await g.tick();assert.equal(g.nativeCalls.some(c=>c[0]==='config'),false);
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
async function permissionFixture(native){const f=await fixture(undefined,undefined,undefined,native);f.event({kind:'url',url:'http://127.0.0.1:56789/',desktopAccessToken:'a'.repeat(64)});await f.tick();return f;}
const settingsItem=f=>f.handlers.get('menu')[0].submenu.find(item=>item.label==='设置…');
const settingsReady=(f,w=f.windows.at(-1),...args)=>f.handlers.get('homer:settings:ready')({sender:w.webContents,senderFrame:w.webContents.mainFrame},...args);
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
test('settings menu restores the primary window and waits for its renderer subscription',async()=>{
 const f=await fixture(),w=f.windows[0],item=settingsItem(f);assert.ok(item);assert.equal(item.accelerator,'CmdOrCtrl+,');
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
 const api=exposed.homerDesktopUpdate;assert.deepEqual(Object.keys(api),['state','dismiss','restart','onChange']);let received;
 const off=api.onChange((...args)=>{received=args;});listeners.get('homer:update:changed')({sender:'private'},'ignored');assert.deepEqual(received,[]);off();off();assert.equal(listeners.size,0);assert.throws(()=>api.onChange(null),/desktop_update_callback/);
 for(const method of ['state','dismiss','restart']){await api[method]();await assert.rejects(api[method]('forbidden-url'),/desktop_permissions_arguments/);}
 assert.deepEqual(calls,[['homer:update:state'],['homer:update:dismiss'],['homer:update:restart']]);
});
test('settings preload subscribes before readiness, strips IPC event and disposes exactly its listener',async()=>{
 const listeners=new Map(),calls=[],exposed={};const source=readFileSync('packaging/electron/preload.cjs','utf8');
 vm.runInNewContext(source,{process:{isMainFrame:true},require:()=>({contextBridge:{exposeInMainWorld:(name,api)=>exposed[name]=api},ipcRenderer:{on:(channel,listener)=>listeners.set(channel,listener),removeListener:(channel,listener)=>{assert.equal(listeners.get(channel),listener);listeners.delete(channel);},invoke:async(...args)=>{calls.push(args);assert.ok(listeners.has('homer:settings:open')||args[1]===false);}}})});
 assert.ok(exposed.homerDesktopSettings);const received=[];const off=exposed.homerDesktopSettings.onOpen((...args)=>received.push(args));assert.deepEqual(calls,[['homer:settings:ready',true]]);listeners.get('homer:settings:open')({sender:'private'},'ignored');assert.deepEqual(received,[[]]);off();off();assert.equal(listeners.size,0);assert.deepEqual(calls.at(-1),['homer:settings:ready',false]);
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
  assert.deepEqual(f.nativeCalls,[['ax',false],['screen','screen']]);
 }
 for(const failing of ['ax','screen']){
  const f=await permissionFixture({ax:()=>{if(failing==='ax')throw Error('private');return true;},screen:()=>{if(failing==='screen')throw Error('private');return 'granted';}});
  const value=await f.handlers.get(permissionChannels[0])(permissionEvent(f));assert.equal(value.accessibility,failing==='ax'?'unknown':'granted');assert.equal(value.screen,failing==='screen'?'unknown':'granted');
 }
 const f=await permissionFixture({ax:()=>undefined});assert.equal((await f.handlers.get(permissionChannels[0])(permissionEvent(f))).accessibility,'unknown');
});
test('prompt ignores its boolean and accessibility settings uses a fixed URL with a manual fallback',async()=>{
 for(const value of [true,false]){const f=await permissionFixture({ax:()=>value});assert.deepEqual(plain(await f.handlers.get(permissionChannels[1])(permissionEvent(f))),{ok:true});assert.deepEqual(f.nativeCalls,[['ax',true]]);}
 const bad=await permissionFixture({ax:()=>{throw Error('private');}});assert.deepEqual(plain(await bad.handlers.get(permissionChannels[1])(permissionEvent(bad))),{ok:false,code:'prompt_failed'});
 const url='x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Accessibility';
 const direct=await permissionFixture();assert.deepEqual(plain(await direct.handlers.get(permissionChannels[2])(permissionEvent(direct))),{ok:true});assert.deepEqual(direct.nativeCalls,[['external',url]]);
 for(const result of ['', 'private error',undefined,new Error('private')]){
  const f=await permissionFixture({external:async()=>{throw Error('private');},open:async()=>{if(result instanceof Error)throw result;return result;}});
  assert.deepEqual(plain(await f.handlers.get(permissionChannels[2])(permissionEvent(f))),result===''?{ok:true,code:'manual_navigation'}:{ok:false,code:'open_failed'});
  assert.deepEqual(f.nativeCalls,[['external',url],['open','/System/Applications/System Settings.app']]);
 }
});
test('screen settings uses the fixed capture URL and falls back only when dispatch rejects',async()=>{
 const url='x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_ScreenCapture';
 const f=await permissionFixture();
 assert.deepEqual(plain(await f.handlers.get(permissionChannels[2])(permissionEvent(f),'screen')),{ok:true});
 assert.deepEqual(f.nativeCalls,[['external',url]]);
 for(const result of ['', 'private error',undefined,new Error('private')]){
  const fallback=await permissionFixture({external:async()=>{throw Error('private');},open:async()=>{if(result instanceof Error)throw result;return result;}});
  assert.deepEqual(plain(await fallback.handlers.get(permissionChannels[2])(permissionEvent(fallback),'screen')),result===''?{ok:true,code:'manual_navigation'}:{ok:false,code:'open_failed'});
  assert.deepEqual(fallback.nativeCalls,[['external',url],['open','/System/Applications/System Settings.app']]);
 }
});
test('only the settings channel accepts the single screen token; URLs, paths and extra values never reach the OS',async()=>{
 const f=await permissionFixture();
 for(const channel of permissionChannels)for(const args of [['screen',true],['accessibility'],['Screen'],['x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_ScreenCapture'],['https://example.invalid/'],[{target:'screen'}],['screen',undefined]])await assert.rejects(async()=>f.handlers.get(channel)(permissionEvent(f),...args),/desktop_permissions_forbidden/);
 for(const channel of permissionChannels.slice(0,2))await assert.rejects(async()=>f.handlers.get(channel)(permissionEvent(f),'screen'),/desktop_permissions_forbidden/);
 for(const [,invalidate] of invalidPermissionInputs){const bad=await permissionFixture(),event=permissionEvent(bad);invalidate(bad,event);await assert.rejects(async()=>bad.handlers.get(permissionChannels[2])(event,'screen'),/desktop_permissions_forbidden/);assert.equal(bad.nativeCalls.length,0);}
 for(const platform of ['linux','win32']){f.setPlatform(platform);assert.deepEqual(plain(await f.handlers.get(permissionChannels[2])(permissionEvent(f),'screen')),{supported:false});}
 assert.equal(f.nativeCalls.length,0);
});
for(const state of ['detached','destroyed','window replaced','frame replaced','navigation away and back'])test('pending screen link response rejects after '+state,async()=>{
 let finish;const f=await permissionFixture({external:()=>new Promise(r=>{finish=r;})}),event=permissionEvent(f);
 const pending=f.handlers.get(permissionChannels[2])(event,'screen');assert.equal(f.nativeCalls.length,1);
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
 for(const channel of permissionChannels){const f=await permissionFixture(),event=permissionEvent(f);invalidate(f,event);await assert.rejects(async()=>f.handlers.get(channel)(event),/desktop_permissions_forbidden/);assert.equal(f.nativeCalls.length,0);}
});
test('permissions reject all extra arguments before native calls',async()=>{
 const f=await permissionFixture();for(const channel of permissionChannels)for(const args of [[undefined],[null],['/tmp'],[{},false]])await assert.rejects(async()=>f.handlers.get(channel)(permissionEvent(f),...args),/desktop_permissions_forbidden/);assert.equal(f.nativeCalls.length,0);
});
test('permissions allow root hashes, deny old windows and decline non-Mac without native calls',async()=>{
 const f=await permissionFixture();await f.windows[0].loadURL('http://127.0.0.1:56789/#message');await f.handlers.get(permissionChannels[0])(permissionEvent(f));
 const old=permissionEvent(f);f.createWindow();await f.windows[1].loadURL('http://127.0.0.1:56789/');for(const c of permissionChannels)await assert.rejects(async()=>f.handlers.get(c)(old),/desktop_permissions_forbidden/);
 const other=await permissionFixture();for(const p of ['linux','win32']){other.setPlatform(p);for(const c of permissionChannels)assert.deepEqual(plain(await other.handlers.get(c)(permissionEvent(other))),{supported:false});}assert.equal(other.nativeCalls.length,0);
});
for(const state of ['detached','destroyed','window replaced','frame replaced','navigation away and back'])test('pending native response rejects after '+state,async()=>{
 let finish;const f=await permissionFixture({external:()=>new Promise(r=>{finish=r;})}),event=permissionEvent(f);
 const pending=f.handlers.get(permissionChannels[2])(event);assert.equal(f.nativeCalls.length,1);
 if(state==='detached')event.senderFrame.detached=true;
 if(state==='destroyed')f.windows[0].destroyed=true;
 if(state==='window replaced')f.createWindow();
 if(state==='frame replaced')f.windows[0].webContents.mainFrame={...event.senderFrame};
 if(state==='navigation away and back'){f.windows[0].webContents.emit('did-start-navigation',{url:'http://127.0.0.1:56789/',isSameDocument:false,isMainFrame:true});}
 finish('');await assert.rejects(pending,/desktop_permissions_forbidden/);
});
test('preload exposes fixed Promise methods and only the screen settings token in the main frame',async()=>{
 const source=readFileSync('packaging/electron/preload.cjs','utf8');
 for(const isMainFrame of [true,false,undefined]){
  const exposed=[],calls=[];vm.runInNewContext(source,{process:{isMainFrame},require:name=>{assert.equal(name,'electron');return {contextBridge:{exposeInMainWorld:(...args)=>exposed.push(args)},ipcRenderer:{invoke:async(...args)=>{calls.push(args);return {synthetic:true};}}};}});
  if(isMainFrame!==true){assert.equal(exposed.length,0);continue;}
  assert.equal(exposed.length,4);const [name,api]=exposed.find(([name])=>name==='homerDesktopPermissions');assert.equal(name,'homerDesktopPermissions');assert.deepEqual(Object.keys(api),['check','promptAccessibility','openSystemSettings']);
  await api.openSystemSettings('screen');assert.deepEqual(calls.at(-1),[permissionChannels[2],'screen']);
  for(const args of [[undefined],[null],['Screen'],['screen',true],['https://example.invalid/'],[{target:'screen'}]]){const n=calls.length;await assert.rejects(async()=>api.openSystemSettings(...args),/desktop_permissions_arguments/);assert.equal(calls.length,n);}
  for(const [i,method] of Object.keys(api).entries()){assert.equal(typeof api[method],'function');assert.equal((await api[method]()).synthetic,true);assert.deepEqual(calls.at(-1),[permissionChannels[i]]);const n=calls.length;await assert.rejects(async()=>api[method]('/tmp'),/desktop_permissions_arguments/);assert.equal(calls.length,n);}
 }
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

}
