import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {promisify} from 'node:util';
import {EventEmitter} from 'node:events';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {transpileModule,ModuleKind,ScriptTarget} from 'typescript';
const require=createRequire(import.meta.url);

async function fixture(){
 let FixtureError=Error;
 const state={failStart:false,failRead:false,helperCode:0,badGeometry:false,badReply:false,cleanup:true,failAction:false,starts:0,reclaims:0,shutdowns:0,approvals:0,options:undefined,calls:[]};
 const target={pid:17,window_id:314},window={x:0,y:0,width:800,height:600};
 const geometry={window,viewport:{x:0,y:100,width:800,height:500},page:'fixture',origin:'https://example.test'};
 const driver={metadata:async()=>({pid:777,driverVersion:'0.46.1'}),shutdown:async()=>{state.shutdowns++;if(state.hangShutdown)await new Promise(()=>{});},uniffiDestroy(){state.destroyed=true;},
  async callTool(name,input){
   state.calls.push(name);const args=JSON.parse(input);
   if(name==='hotkey'&&state.actionPending){state.actionStarted();await state.actionPending;}
   if(name==='get_window_state'&&state.failRead)return {isError:true,errorCode:'fixture_unreadable'};
   if(name==='get_window_state'&&state.badReadReply)return state.badReadReply;
   if(name==='get_window_state'&&state.badReply)return {isError:false,structuredJson:state.badReply===true?'not json':state.badReply};
   if(name==='hotkey'&&state.badActionReply)return state.badActionReply===true?{isError:false,structuredJson:'not json'}:state.badActionReply;
   if(name==='hotkey'&&state.failAction)return {isError:true,errorCode:'fixture_action'};
   const data=name==='list_windows'?{windows:[{...target,title:'Fixture',app_name:'Fixture',layer:0,is_on_screen:true,z_index:1}]}:
    name==='check_permissions'?{accessibility:true,screen_recording:true}:name==='bring_to_front'?{activated:true}:
    name==='get_window_state'?{...target,window_bounds:window,screenshot_frame_valid:true,screenshot_width:800,screenshot_height:600,capture_id:'fixture',elements:[{role:'AXWindow',depth:0,element_index:0,element_token:'fixture-token'}]}:{};
   return {isError:false,structuredJson:JSON.stringify(data),images:args.include_screenshot===false?undefined:[{mimeType:'image/png',dataBase64:'AQ=='}]};
  }};
 const start=options=>{state.starts++;state.options=options;if(state.failStart)throw Object.assign(Error('DriverError.ActionInterrupted'),{tag:'ActionInterrupted',inner:{reason:'private worker did not answer request 0 within 3000ms'}});return driver;};
 const exec=()=>assert.fail('use promisified fixture');
 exec[promisify.custom]=async(file,args,options)=>{
  if(file==='/usr/bin/plutil')return {stdout:'app.homer.desktop'};
  if(file==='/usr/bin/codesign')return {stdout:''};
  state.helperTimeout=options.timeout;
  if(state.helperCode)throw Object.assign(Error('private stderr must not escape'),{code:state.helperCode,stderr:'private fixture content'});
  return {stdout:args[2]==='window'?'':args[2]==='address'?createHash('sha256').update('https://example.test/').digest('hex'):state.badGeometry?'not json':JSON.stringify(geometry)};
 };
 const resources='/fixture/Homer.app/Contents/Resources';
 const trusted={bundleRoot:'/fixture/Homer.app',resources,imageDecoder:'/fixture/decoder',files:[{path:'runtime/cua/chrome-viewport',sha256:createHash('sha256').update('helper').digest('hex')}]};
 const modules={
  'node:fs':{...require('node:fs'),existsSync:()=>true,realpathSync:path=>path,readFileSync:()=>Buffer.from('helper'),mkdtempSync:()=>'/fixture/runtime/homer-cua-Ab123c',mkdirSync(){},symlinkSync(){},writeFileSync(){}},
  'node:child_process':{execFile:exec,spawn(_file,args){state.launchArgs=args;const child=Object.assign(new EventEmitter(),{pid:17,unref(){}});queueMicrotask(()=>child.emit('spawn'));return child;}},
  'node:timers/promises':{setTimeout:async()=>{}},
  './desktop-resources.js':{verifiedDesktopResources:()=>trusted},
  './desktop-cua-driver.js':{cuaDriverFailure:()=> 'cua_driver_unavailable',createPrivateCuaDriver(_url,options){
   state.starts++;state.options=options;return state.failStart?{...driver,metadata:async()=>{throw FixtureError('cua_driver_startup_timeout');}}:driver;
  }},
  './interaction-limits.js':{TOOL_IMAGE_BYTES:1024},'./media-decode.js':{mediaProcess:async()=>Buffer.from([2])},
  './media-policy.js':{MEDIA_POLICY:{imageBytes:1024,maxPixels:1000000},imageDimensions:bytes=>bytes[0]===2?{width:800,height:500}:{width:800,height:600}},
  './processes.js':{processIdentity:()=>'fixture-owner'},
  './cua-processes.js':{CUA_SESSION_PREFIX:'homer-cua-',WINDOWS_CUA_HELPER:'runtime/cua/homer-cua-windows.exe',holdCuaWindowsJob(){},pinCuaChrome(){},runCuaWindows(){throw Error('wrong platform');},reclaimCuaSession:async()=>{state.reclaims++;assert.ok(state.shutdowns>0);return state.cleanup;}},
  '../scripts/windows-security.mjs':{windowsCommandAsync(){throw Error('wrong platform');}},
  ['file://'+resources+'/runtime/cua/node_modules/@trycua/cua-driver/dist/index.js']:{SessionPermissionMode:{Bounded:'bounded'},CuaDriver:{create:()=>({...driver,shutdown:async()=>{}}),createPrivateWorker:start}},
 };
 const context=vm.createContext({process:{platform:'darwin',arch:'arm64',env:{},kill(){throw Object.assign(Error('gone'),{code:'ESRCH'});}},URL,Buffer,setTimeout:(fn,ms)=>setTimeout(fn,state.hangShutdown&&[2000,4000].includes(ms)?10:ms),clearTimeout,queueMicrotask});
 FixtureError=vm.runInContext('Error',context);
 async function synthetic(name){const exports=modules[name]??require(name);const module=new vm.SyntheticModule(Object.keys(exports),function(){for(const[key,value]of Object.entries(exports))this.setExport(key,value);},{context});await module.link(()=>{});await module.evaluate();return module;}
 const source=transpileModule(readFileSync('src/desktop-cua.ts','utf8'),{compilerOptions:{module:ModuleKind.ESNext,target:ScriptTarget.ES2023}}).outputText;
 const entry=new vm.SourceTextModule(source,{context,initializeImportMeta:meta=>{meta.url='file:///fixture/desktop-cua.js';},importModuleDynamically:synthetic});
 await entry.link(synthetic);await entry.evaluate();
 const cua=entry.namespace.DesktopCua.create({bundleRoot:trusted.bundleRoot},'/fixture/runtime');
 const invoke=(name,args={},guard=()=>{})=>cua.invoke('owner',name,args,guard,()=>{},async()=>{state.approvals++;});
 return {state,cua,invoke};
}

if(!vm.SourceTextModule){
 test('CUA lifecycle contracts use only synthetic resources',()=>{
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  const output=execFileSync(process.execPath,['--experimental-vm-modules','--test',fileURLToPath(import.meta.url)],{stdio:'pipe',env}).toString();
  assert.match(output,/# tests [1-9]\d*/);
 });
}else{
 test('macOS startup gets a 15 second SDK budget',async()=>{const f=await fixture();try{await f.invoke('desktop_read',{app:'Fixture'});assert.equal(f.state.options.startupTimeoutMs,15000n);}finally{await f.cua.close('owner');}});
 test('failed startup is cleaned before an explicit switch to browser',async()=>{
  const f=await fixture();f.state.failStart=true;
  await assert.rejects(f.invoke('desktop_read',{app:'Fixture'}),{message:'cua_driver_startup_timeout'});
  assert.equal(f.state.reclaims,1);f.state.failStart=false;
  try{await f.invoke('browser_read');assert.equal(f.state.starts,2);}finally{await f.cua.close('owner');}
 });
 test('failed first read rolls back even after the driver became ready',async()=>{
  const f=await fixture();f.state.failRead=true;
  await assert.rejects(f.invoke('desktop_read',{app:'Fixture'}),/cua_driver_refused_fixture_unreadable/);
  assert.equal(f.state.reclaims,1);f.state.failRead=false;
  try{await f.invoke('browser_read');assert.equal(f.state.starts,2);}finally{await f.cua.close('owner');}
 });
 test('unconfirmed cleanup retains ownership and blocks another target',async()=>{
  const f=await fixture();f.state.failRead=true;f.state.cleanup=false;
  await assert.rejects(f.invoke('desktop_read',{app:'Fixture'}),{message:'cua_cleanup_unconfirmed'});
  await assert.rejects(Promise.resolve().then(()=>f.invoke('browser_read')),{message:'cua_session_stopped'});
  assert.equal(f.state.starts,1);
 });
 test('hanging SDK shutdown is force-stopped before ownership is released',async()=>{
  const f=await fixture();await f.invoke('browser_read');f.state.hangShutdown=true;
  assert.equal(await f.cua.close('owner'),true);assert.equal(f.state.destroyed,true);assert.equal(f.state.reclaims,1);
  f.state.hangShutdown=false;try{await f.invoke('browser_read');assert.equal(f.state.starts,2);}finally{await f.cua.close('owner');}
 });
 test('failed isolated startup cannot fall back to a personal Chrome target',async()=>{
  const f=await fixture();f.state.failStart=true;
  await assert.rejects(f.invoke('browser_open',{url:'https://example.test/',isolated:true}),{message:'cua_driver_startup_timeout'});
  assert.ok(f.state.launchArgs.includes('--force-renderer-accessibility'));
  await assert.rejects(Promise.resolve().then(()=>f.invoke('browser_read')),{message:'cua_session_stopped'});
  assert.equal(f.state.starts,1);
 });
 for(const[code,message]of [[3,'chrome_bound_window_unavailable'],[5,'chrome_process_unavailable'],[6,'cua_macos_permissions_required'],[7,'chrome_ax_web_area_unavailable'],[8,'chrome_viewport_invalid'],[9,'chrome_page_unsupported'],[10,'chrome_ax_window_list_unavailable'],[11,'cua_screen_locked']])test('helper exit '+code+' preserves '+message,async()=>{
  const f=await fixture();f.state.helperCode=code;
  await assert.rejects(f.invoke('browser_read'),{message});assert.equal(f.state.reclaims,1);
 });
 test('invalid helper output is classified without leaking parser text',async()=>{const f=await fixture();f.state.badGeometry=true;await assert.rejects(f.invoke('browser_read'),{message:'chrome_helper_invalid_response'});});
 for(const reply of ['not json','null','[]'])test('invalid SDK reply '+reply+' has a safe protocol error',async()=>{const f=await fixture();f.state.badReply=reply;await assert.rejects(f.invoke('desktop_read',{app:'Fixture'}),{message:'cua_driver_protocol_failed'});});
 test('read replies require a boolean error flag',async()=>{
  for(const reply of [{structuredJson:'{}'},{isError:null,structuredJson:'{}'}]){
   const f=await fixture();f.state.badReadReply=reply;
   await assert.rejects(f.invoke('desktop_read',{app:'Fixture'}),{message:'cua_driver_protocol_failed'});
  }
 });
 test('action replies require a boolean error flag and keep the target bound',async()=>{
  for(const reply of [{structuredJson:'{}'},{isError:null,structuredJson:'{}'}]){
   const f=await fixture();f.state.badActionReply=reply;
   try{
    await assert.rejects(f.invoke('browser_open',{url:'https://example.test/'}),{message:'cua_action_unconfirmed'});
    await assert.rejects(Promise.resolve().then(()=>f.invoke('desktop_read',{app:'Fixture'})),{message:'cua_target_already_bound'});
    assert.equal(f.state.calls.filter(x=>x==='hotkey').length,1);assert.equal(f.state.calls.filter(x=>x==='type_text').length,0);
   }finally{await f.cua.close('owner');}
  }
 });
 test('successful action replies may omit structured JSON',async()=>{
  const f=await fixture();f.state.badActionReply={isError:false};
  try{assert.equal((await f.invoke('browser_open',{url:'https://example.test/'})).state,'submitted');}
  finally{await f.cua.close('owner');}
 });
 test('cancellation after input dispatch keeps its outcome unconfirmed',{timeout:5000},async()=>{
  const f=await fixture();let finish,started,allowed=true;
  const dispatched=new Promise(resolve=>{started=resolve;});f.state.actionStarted=started;
  f.state.actionPending=new Promise(resolve=>{finish=resolve;});
  const pending=f.invoke('browser_open',{url:'https://example.test/'},()=>{if(!allowed)throw Error('tool_scope_denied');});
  try{
   await dispatched;allowed=false;finish();
   await assert.rejects(pending,{message:'cua_action_unconfirmed'});
   await assert.rejects(Promise.resolve().then(()=>f.invoke('desktop_read',{app:'Fixture'})),{message:'cua_target_already_bound'});
   assert.equal(f.state.calls.filter(x=>x==='hotkey').length,1);assert.equal(f.state.calls.filter(x=>x==='type_text').length,0);
  }finally{finish();await f.cua.close('owner');}
 });
 test('page AX preparation gets five seconds without weakening normal helper timeouts',async()=>{const f=await fixture();try{await f.invoke('browser_read');assert.equal(f.state.helperTimeout,5000);}finally{await f.cua.close('owner');}});
 for(const failure of ['failAction','badActionReply'])test('uncertain input '+failure+' preserves the bound target and is never replayed',async()=>{
  const f=await fixture();f.state[failure]=true;
  try{
   await assert.rejects(f.invoke('browser_open',{url:'https://example.test/'}),/cua_action_unconfirmed/);
   await assert.rejects(Promise.resolve().then(()=>f.invoke('desktop_read',{app:'Fixture'})),{message:'cua_target_already_bound'});
   assert.equal(f.state.calls.filter(x=>x==='hotkey').length,1);assert.equal(f.state.calls.filter(x=>x==='type_text').length,0);
  }finally{await f.cua.close('owner');}
 });
}
