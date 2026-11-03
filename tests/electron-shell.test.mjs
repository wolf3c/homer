import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// Link the real entry to OS fixtures. No test switches or probes in the app.
async function fixture(args=['Homer','--test-profile','/synthetic/profile'],openExternal=async()=>{},platform='darwin',native={}){
 let monotonic=0;
 const handlers=new Map(),windows=[],messages=[],sent=[],nativeCalls=[],launches=[],credentials=[],tokenFiles=[];let spawnCount=0,prompts=0;
 const app=new EventEmitter();
 Object.assign(app,{isPackaged:true,whenReady:async()=>{},setPath(){},getPath:()=>'/synthetic',requestSingleInstanceLock:()=>true,getVersion:()=> '0.1.0',relaunch(){nativeCalls.push(['relaunch']);},quit(){const e={preventDefault(){this.prevented=true;}};app.emit('before-quit',e);if(!e.prevented)app.emit('quit');},setAboutPanelOptions(){}});
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
  constructor(options){super();this.options=options;this.webContents=new EventEmitter();this.webContents.session=session;this.settingsMessages=[];this.webContents.getURL=()=>this.url??'about:blank';this.webContents.isDestroyed=()=>this.contentsDestroyed??false;this.webContents.setWindowOpenHandler=cb=>handlers.set('window-open',cb);windows.push(this);}
  async loadURL(url){this.webContents.emit('did-start-navigation',{url,isSameDocument:false,isMainFrame:true});this.url=url;this.webContents.mainFrame={url,origin:new URL(url).origin,detached:false,isDestroyed:()=>false,send:(...args)=>this.settingsMessages.push(args)};}isMinimized(){return this.minimized??false;}restore(){this.minimized=false;}show(){this.hidden=false;}hide(){this.hidden=true;}focus(){this.focused=true;}isDestroyed(){return this.destroyed??false;}setTitle(){}
  getContentBounds(){return {width:this.contentWidth??this.options.width};}
  getWindowButtonPosition(){return this.buttonPosition??this.options.trafficLightPosition;}
  setWindowButtonPosition(value){this.buttonPosition=value;this.buttonMoves=(this.buttonMoves??0)+1;}
 }
 const electron={app,BrowserWindow,ipcMain:{handle:(name,cb)=>{assert.equal(handlers.has(name),false);handlers.set(name,cb);}},systemPreferences:{isTrustedAccessibilityClient:prompt=>{nativeCalls.push(['ax',prompt]);return native.ax?native.ax(prompt):false;},getMediaAccessStatus:kind=>{nativeCalls.push(['screen',kind]);return native.screen?native.screen(kind):'not-determined';}},Menu:{buildFromTemplate:value=>value,setApplicationMenu:value=>handlers.set('menu',value)},dialog:{showMessageBox:async(_window,options)=>{const o=options??_window;messages.push({...o,parent:options?_window:undefined});return {response:native.response??1};}},shell:{openExternal:url=>{nativeCalls.push(['external',url]);return native.external?native.external(url):openExternal(url);},openPath:path=>{nativeCalls.push(['open',path]);return native.open?native.open(path):Promise.resolve('');}}};
 const fs={readFileSync:()=>Buffer.from(JSON.stringify({format:2,preparation:!native.published,localWorkingTree:native.localWorkingTree,publishable:native.publishable,version:'0.1.0',build:5,account:{websiteOrigin:'https://website.example.invalid',gatewayOrigin:'https://models.super-tree.com'}})),existsSync:()=>true,mkdirSync(){},realpathSync:value=>value};
 const cp={execFileSync:()=>Buffer.alloc(0),spawn(bin,args,options){spawnCount++;launches.push({bin,args,options});return child;}};
 const config=()=>({main:{baseUrl:'https://models.super-tree.com/v1',model:'deepseek-flash',effort:'max',fast:false},worker:{baseUrl:'https://models.super-tree.com/v1',model:'deepseek-flash',effort:'max',fast:false}});
 let stored=native.connection??{token:'synthetic-file-token',subject:'fixture_user',config:config()};
 const account={queryHomerRuntimeConfig:async options=>{nativeCalls.push(['config']);return native.config?native.config(options):config();},saveHomerRuntimeConfig:(_path,value)=>{if(native.writeError)throw Error('CONNECTION_WRITE_FAILED');stored={token:stored.token,subject:stored.subject,config:value};nativeCalls.push(['save-config']);return stored;},readHomerConnection:path=>{tokenFiles.push(path);if(native.invalidTokenFile)throw Error('CONNECTION_FILE_INVALID');return stored;},validateHomerOrigins:v=>v,authorizeHomerConnection:async options=>{const value=native.authorize?await native.authorize(options):{token:'synthetic-website-token',subject:'fixture_user',config:config()};if(!options.signal.aborted)stored=value;return value;},disconnectHomerConnection:()=>{nativeCalls.push(['disconnect']);if(native.disconnectError)throw Error('CONNECTION_WRITE_FAILED');stored=stored?.subject?{...stored,token:undefined}:null;},queryHomerWallet:async()=>{nativeCalls.push(['wallet']);return native.wallet?native.wallet():{available:5,used:2,unit:'原生额度'};}};
 const modules={'../homer/dist/homer-account.js':account,'electron':electron,'node:fs':fs,'node:child_process':cp,'../homer/scripts/desktop-profile.mjs':{prepareDesktopProfile:()=>native.adopted?{adoption:{appData:"/synthetic/original-app"}}:{},assertDesktopControlPaths(){},readDesktopModelSource:(_root,fallback)=>native.modelSource??fallback,saveDesktopModelSource:(_root,source)=>{if(native.sourceWriteError)throw Error('desktop_source_write_failed');nativeCalls.push(['source',source]);}},'../homer/scripts/desktop-deepseek.mjs':{assertDeepSeekProfile(){if(native.invalidProfile)throw Error('deepseek_profile_invalid');},prepareDeepSeekProfile:()=>({}),promptDeepSeekToken:async options=>{prompts++;return native.prompt?native.prompt(options):'synthetic-private-token';}}};
 let timer;const context=vm.createContext({process:{argv:['Homer','--test-profile','/synthetic/profile'],resourcesPath:'/synthetic/Homer.app/Contents/Resources',platform:'darwin'},Buffer,URL,AbortController,console,performance:{now:()=>monotonic},setTimeout:cb=>{timer=cb;return 1;},clearTimeout(){}});
 context.process.argv=args;context.process.platform=platform;
 const path=resolve('packaging/electron/main.mjs');
 // Lifecycle controls exist only in this VM copy, never in the product entry.
 const entry=new vm.SourceTextModule(readFileSync(path,'utf8')+'\nexport {createWindow}; export const forgetWindowForTest=()=>{window=undefined;};',{context,identifier:path,initializeImportMeta:meta=>{meta.url='file://'+path;}});
 await entry.link(async name=>{const exports=modules[name]??createRequire(import.meta.url)(name);const m=new vm.SyntheticModule(Object.keys(exports),function(){for(const [key,value]of Object.entries(exports))this.setExport(key,value);},{context});return m;});
 await entry.evaluate();await new Promise(r=>setImmediate(r));
 return {advance:ms=>{monotonic+=ms;},BrowserWindow,nativeCalls,launches,credentials,tokenFiles,prompts:()=>prompts,setPlatform:value=>{context.process.platform=value;},createWindow:entry.namespace.createWindow,forgetWindow:entry.namespace.forgetWindowForTest,app,child,windows,handlers,messages,sent,spawnCount:()=>spawnCount,timeout:()=>timer?.(),tick:()=>new Promise(r=>setImmediate(r)),event:value=>child.stdout.write(JSON.stringify(value)+'\n')};
}
if(!vm.SourceTextModule){
 test('Electron shell contracts run with Node VM module support',()=>{execFileSync(process.execPath,['--experimental-vm-modules','--test',fileURLToPath(import.meta.url)],{stdio:'pipe'});});
}else{

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
test('native startup does not forward website credentials; saved website balance and switching back remain available',async()=>{
 const f=await accountFixture({modelSource:'codex',nativeState:{account:'chatgpt',connected:true,phase:'idle'}});
 assert.deepEqual(f.credentials,['null']);const state=await accountCall(f,'state');assert.equal(state.source,'codex');assert.equal(state.connection,'website');assert.equal(state.active,'disconnected');assert.equal(state.needsRestart,false);assert.equal(f.nativeCalls.some(c=>c[0]==='wallet'),false);
 assert.ok((await accountCall(f,'refresh')).wallet);assert.equal(f.nativeCalls.filter(c=>c[0]==='wallet').length,1);
 await accountCall(f,'applyWebsite');await f.tick();f.event({kind:'stopped'});f.child.emit('close',0,null);await f.tick();
 assert.deepEqual(f.nativeCalls.filter(c=>['source','relaunch','disconnect'].includes(c[0])),[['source','website'],['relaunch']]);
});
for(const account of ['none','other','unknown'])test(`native ${account} cannot activate a ChatGPT source`,async()=>{
 const f=await accountFixture({nativeState:{account,connected:false,phase:'idle'}});await accountCall(f,'applyCodex');await f.tick();assert.equal(f.sent.length,0);assert.equal(f.nativeCalls.some(c=>c[0]==='source'),false);
});
test('daily desktop reuses a legacy Token without website login or config writes',async()=>{
 const f=await accountFixture({connection:{token:'synthetic-development-key'}});
 assert.deepEqual(f.credentials,[JSON.stringify({token:'synthetic-development-key'})]);
 const state=await accountCall(f,'state');assert.equal(state.active,'legacy');assert.equal(state.connection,'legacy');assert.equal(state.websiteReady,true);assert.equal(state.needsRestart,false);
 assert.equal(JSON.stringify(state).includes('synthetic-development-key'),false);
 await accountCall(f,'refresh');assert.equal(f.nativeCalls.some(c=>c[0]==='wallet'),true);
 assert.equal(f.nativeCalls.some(c=>['config','save-config','external'].includes(c[0])),false);
 await f.handlers.get('menu')[0].submenu.find(item=>item.label==='模型连接信息…').click();
 assert.equal(f.messages.at(-1).message,'已连接（原凭据）');assert.doesNotMatch(f.messages.at(-1).detail,/通过网站登录/);
 const codex=await accountFixture({modelSource:'codex',connection:{token:'synthetic-development-key'}});
 assert.deepEqual(codex.credentials,['null']);assert.equal((await accountCall(codex,'state')).connection,'legacy');
 await accountCall(codex,'applyWebsite');await codex.tick();assert.equal(codex.nativeCalls.some(c=>c[0]==='source'),false);
 codex.event({kind:'stopped'});codex.child.emit('close',0,null);await codex.tick();
 assert.deepEqual(codex.nativeCalls.filter(c=>['source','relaunch','disconnect'].includes(c[0])),[['source','website'],['relaunch']]);
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
test('account methods reject arguments, foreign frames, and responses after navigation',async()=>{
 const f=await accountFixture();for(const name of ['state','connect','cancel','reopen','refresh','openWebsite','disconnect','restart','nativeConnect','nativeCancel','nativeReopen','applyCodex','applyWebsite']){
  await assert.rejects(()=>accountCall(f,name,'extra'),/desktop_account_forbidden/);
  await assert.rejects(()=>f.handlers.get('homer:account:'+name)({sender:{},senderFrame:f.windows[0].webContents.mainFrame}),/desktop_account_forbidden/);
 }
 let settle;const g=await accountFixture({wallet:()=>new Promise(r=>settle=r)});const pending=accountCall(g,'refresh');
 await g.tick();await g.windows[0].loadURL('http://127.0.0.1:56789/preview/x');settle({available:1,used:1,unit:'额度'});
 await assert.rejects(pending,/desktop_account_forbidden/);
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
test('wallet refresh merges concurrent reads and runtime events only expose invalidation',async()=>{
 let settle;const f=await accountFixture({wallet:()=>new Promise(r=>settle=r)});
 const a=accountCall(f,'refresh'),b=accountCall(f,'refresh');await f.tick();assert.equal(f.nativeCalls.filter(c=>c[0]==='wallet').length,1);
 settle({available:0,used:2,unit:'额度'});const states=await Promise.all([a,b]);assert.equal(states[0].wallet.available,0);
 f.event({kind:'account_usage_dirty',text:'must-not-forward'});await f.tick();assert.ok(f.windows[0].settingsMessages.some(([name,value])=>name==='homer:account:changed'&&value===undefined));
});

const websiteConnection=()=>({token:'synthetic-account-token',subject:'fixture_user',config:{main:{baseUrl:'https://models.super-tree.com/v1',model:'deepseek-flash',effort:'max',fast:false},worker:{baseUrl:'https://models.super-tree.com/v1',model:'deepseek-flash',effort:'max',fast:false}}});
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
test('DeepSeek opt-in prompts once, sends its credential only on FD3 and leaves native account mode unchanged',async()=>{
 const f=await fixture(['Homer','--deepseek-profile','/synthetic/deepseek']);
 assert.equal(f.prompts(),1);assert.equal(f.spawnCount(),1);assert.deepEqual(f.credentials,['synthetic-private-token']);
 assert.equal(JSON.stringify(f.launches).includes('synthetic-private-token'),false);
 assert.equal(f.launches[0].options.cwd,'/synthetic/deepseek');assert.ok(f.launches[0].args.includes('--deepseek'));
 assert.deepEqual(plain(f.launches[0].options.stdio),['pipe','pipe','ignore','pipe']);
 assert.ok(f.handlers.get('menu')[0].submenu.some(item=>item.label==='DeepSeek 连接信息…'));
 const original=await fixture();assert.equal(original.prompts(),0);assert.deepEqual(original.credentials,[]);
 assert.equal(original.launches[0].args.includes('--deepseek'),false);
});
test('DeepSeek cancellation, invalid profile and malformed path never launch a backend',async()=>{
 for(const [args,native]of [
  [['Homer','--deepseek-profile','/synthetic/deepseek'],{prompt:async()=>{throw Error('deepseek_token_input_cancelled');}}],
  [['Homer','--deepseek-profile','/synthetic/deepseek'],{invalidProfile:true}],
  [['Homer','--deepseek-profile'],{}],
  [['Homer','--test-profile','/synthetic/test','--deepseek-profile','/synthetic/other'],{}],
 ]){const f=await fixture(args,undefined,undefined,native);assert.equal(f.spawnCount(),0);assert.deepEqual(f.credentials,[]);}
});
test('quitting during a native Token prompt aborts it and cannot start a late backend',async()=>{
 let finish,signal;const f=await fixture(['Homer','--deepseek-profile','/synthetic/deepseek'],undefined,undefined,{prompt:options=>{signal=options.signal;return new Promise(r=>finish=r);}});
 f.app.quit();assert.equal(signal.aborted,true);finish('synthetic-late-token');await f.tick();assert.equal(f.spawnCount(),0);assert.deepEqual(f.credentials,[]);
});
test('offline DeepSeek profile uses the explicit fixture path without opening a real credential prompt',async()=>{
 const f=await fixture(['Homer','--test-profile','/synthetic/test','--deepseek']);
 assert.equal(f.prompts(),0);assert.equal(f.spawnCount(),1);assert.deepEqual(f.credentials,['synthetic-desktop-deepseek']);
 assert.ok(f.launches[0].args.includes('--test-profile'));assert.ok(f.launches[0].args.includes('--deepseek'));
});
const permissionEvent=f=>({sender:f.windows[0].webContents,senderFrame:f.windows[0].webContents.mainFrame});
async function permissionFixture(native){const f=await fixture(undefined,undefined,undefined,native);f.event({kind:'url',url:'http://127.0.0.1:56789/',desktopAccessToken:'a'.repeat(64)});await f.tick();return f;}
const settingsItem=f=>f.handlers.get('menu')[0].submenu.find(item=>item.label==='设置…');
const settingsReady=(f,w=f.windows.at(-1),...args)=>f.handlers.get('homer:settings:ready')({sender:w.webContents,senderFrame:w.webContents.mainFrame},...args);
test('explicit daily DeepSeek entry uses only an adopted profile and forwards a private token',async()=>{
 const f=await fixture(['Homer','--deepseek-daily'],undefined,undefined,{adopted:true,published:true});
 assert.equal(f.prompts(),0);assert.equal(f.spawnCount(),1);assert.ok(f.launches[0].args.includes('--deepseek-daily'));
 assert.equal(JSON.parse(f.credentials[0]).token,'synthetic-file-token');
 assert.deepEqual(f.tokenFiles,['/synthetic/original-app/runtime-config.json']);
 assert.equal(JSON.stringify(f.launches).includes('synthetic-file-token'),false);
 const rejected=await fixture(['Homer','--deepseek-daily'],undefined,undefined,{published:true});assert.equal(rejected.spawnCount(),1);assert.equal(rejected.prompts(),0);
});
test('ordinary adopted desktop launch selects DeepSeek; explicit native rollback keeps the original provider',async()=>{
 const daily=await fixture(['Homer'],undefined,undefined,{adopted:true,published:true});
 assert.equal(daily.prompts(),0);assert.ok(daily.launches[0].args.includes('--deepseek-daily'));
 assert.deepEqual(daily.tokenFiles,['/synthetic/original-app/runtime-config.json']);
 const native=await fixture(['Homer','--native'],undefined,undefined,{adopted:true,published:true});
 assert.equal(native.prompts(),0);assert.equal(native.launches[0].args.includes('--deepseek-daily'),false);
});
test('invalid daily token file opens management mode without a model credential',async()=>{
 const f=await fixture(['Homer'],undefined,undefined,{adopted:true,published:true,invalidTokenFile:true});
 assert.equal(f.spawnCount(),1);assert.equal(f.prompts(),0);assert.deepEqual(f.credentials,['null']);
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
  assert.equal(exposed.length,3);const [name,api]=exposed.find(([name])=>name==='homerDesktopPermissions');assert.equal(name,'homerDesktopPermissions');assert.deepEqual(Object.keys(api),['check','promptAccessibility','openSystemSettings']);
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
for(const platform of ['win32','linux'])test(`${platform} retains the packaged macOS guard without invoking window controls`,async()=>{
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
}
