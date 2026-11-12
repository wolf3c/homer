import {test} from 'node:test';
import assert from 'node:assert/strict';
import {desktopManagementAllowed} from '../src/desktop-management.ts';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createRequire} from 'node:module';
import {EventEmitter} from 'node:events';
import {transpileModule,ModuleKind} from 'typescript';
test('desktop before readiness exposes state only; removed capability APIs stay removed',()=>{
 assert.equal(desktopManagementAllowed('history.state'),true);
 for(const method of ['state','capabilities.state','capabilities.manage','submit','history.page','queue.move','media.upload','respond']){
  for(const action of ['account_state','account_login','mcp_save'])assert.equal(desktopManagementAllowed(method,{action,approve:true}),false);
 }
});
test('desktop private IPC reuses native state/login/cancel and exposes no web account mutation',async()=>{
 const calls=[],sent=[],process=new EventEmitter();
 Object.assign(process,{connected:true,env:{},send:(value,callback)=>{sent.push(value);callback();},disconnect(){}});
 let state={account:'none',connected:false,phase:'idle'};
 class Homer{
  constructor(config){this.config=config;this.modelConfig={keyEnv:'SYNTHETIC_MISSING',baseUrl:'http://127.0.0.1'};this.schedules={start(){}};}
  onStateChange(){}
  bindDesktopPowerProtection(){return ()=>{};}
  onScheduleChanged(){return ()=>{};}
  desktopPowerFacts(){return {executing:false,displayRequired:false};}
  nextScheduledMessageAt(){return null;}
  async close(){}
  async manageNativeAccount(input){calls.push(input);if(input.action==='account_login')return state={...state,phase:'waiting',loginId:'synthetic-login'};if(input.action==='account_cancel')return state={account:'none',connected:false,phase:'cancelled'};return state;}
 }
 const require=createRequire(import.meta.url),code=transpileModule(readFileSync('src/dev-host.ts','utf8'),{compilerOptions:{module:ModuleKind.CommonJS}}).outputText;
 const receive=Function('require','process','exports',code+'\nreturn receive;')(name=>{
  if(name==='./service.js')return {Homer,DesktopReviewRequired:class extends Error{}};
  if(name==='./engine.js')return {engineError:error=>error.message};
  if(name==='./desktop-management.js')return {desktopManagementAllowed};
  if(name==='./telegram-channel.js')return {telegramChannel:()=>undefined};
  if(name==='./wechat-channel.js')return {wechatChannel:()=>undefined};
  if(name==='./dingtalk-channel.js')return {dingtalkChannel:()=>undefined};
  if(name==='./media-decode.js')return {configureDesktopImageDecoder(){}};
  if(name.startsWith('./'))return {};
  return require(name);
 },process,{});
 const request=async(method,kind='desktop_account')=>{await receive({kind,id:'synthetic',method});return sent.findLast(value=>value.id==='synthetic');};
 assert.equal((await request('state')).error,'desktop_account_forbidden');
 await receive({kind:'init',desktop:true,config:{desktopResources:{},pauseOldDesktopWork:true}});
 assert.equal((await request('state')).value.account,'none');
 assert.equal((await request('connect')).value.phase,'waiting');
 assert.deepEqual(calls.at(-1),{action:'account_login',approve:true});
 assert.equal((await request('cancel')).value.phase,'cancelled');
 assert.deepEqual(calls.at(-1),{action:'account_cancel',approve:true,loginId:'synthetic-login'});
 const count=calls.length;
 assert.equal((await request('logout')).error,'desktop_account_forbidden');
 assert.ok((await request('capabilities.manage','web')).error);assert.equal(calls.length,count);
 await receive({kind:'stop'});assert.equal((await request('state')).error,'desktop_account_forbidden');
});

test('live model private IPC writes the real desktop profile separately from adopted appData and preserves it on failure',async()=>{
 const {Homer:RealHomer,DesktopReviewRequired}=await import('../src/service.ts'),engine=await import('../src/engine.ts'),models=await import('../src/model-config.ts');
 const parent=resolve('.codex/scratch/chatgpt-live-settings-20261112');mkdirSync(parent,{recursive:true});const root=mkdtempSync(join(parent,'host-'));
 const profile=join(root,'profile'),legacy=join(root,'legacy'),runtime=join(root,'runtime'),workspace=join(root,'work'),home=join(root,'home');for(const path of [profile,legacy,runtime,workspace,home])mkdirSync(path,{mode:0o700});
 const marker=join(profile,'desktop-profile.json');writeFileSync(marker,JSON.stringify({format:1,modelSource:'codex'}),{mode:0o600});
 const roles={main:{model:'synthetic-hot-image',effort:'low',serviceTier:'ultrafast'},worker:{model:'synthetic-hot-text',effort:'high',serviceTier:null}},sent=[],process=new EventEmitter();let app;
 Object.assign(process,{connected:true,env:{},send:(value,callback)=>{sent.push(value);callback();},disconnect(){this.connected=false;}});
 class Homer extends RealHomer{constructor(...args){super(...args);app=this;}}
 const require=createRequire(import.meta.url),code=transpileModule(readFileSync('src/dev-host.ts','utf8'),{compilerOptions:{module:ModuleKind.CommonJS}}).outputText;
 const receive=Function('require','process','exports',code+'\nreturn receive;')(name=>{
  if(name==='./service.js')return{Homer,DesktopReviewRequired};if(name==='./engine.js')return engine;if(name==='./model-config.js')return models;
  if(name==='./desktop-management.js')return{desktopManagementAllowed};
  if(name==='./telegram-channel.js')return{telegramChannel:()=>undefined};if(name==='./wechat-channel.js')return{wechatChannel:()=>undefined};if(name==='./dingtalk-channel.js')return{dingtalkChannel:()=>undefined};
  if(name==='./media-decode.js')return{configureDesktopImageDecoder(){}};
  if(name.startsWith('./'))return{};return require(name);
 },process,{});
 try{
  await receive({kind:'init',desktop:true,config:{appData:legacy,desktopProfile:profile,runtime,workspace,codexHome:home,nativeCodexHome:home,codexBin:resolve('tests/fixtures/model-settings-app-server.mjs'),model:'synthetic-hot-text',requiresOpenaiAuth:true,stopGraceMs:100,desktopModelSource:'codex',desktopResources:{bundleRoot:'synthetic',manifestSha256:'a'.repeat(64)},pauseOldDesktopWork:true}});
  await receive({kind:'desktop_account',id:'save',method:'apply-models',input:roles});assert.equal(sent.findLast(value=>value.id==='save').value,true);
  assert.deepEqual(JSON.parse(readFileSync(marker)).chatgpt,roles);assert.deepEqual(app.config.chatgpt,roles);assert.equal(existsSync(join(legacy,'desktop-profile.json')),false);
  const before=readFileSync(marker,'utf8');writeFileSync(marker+'.pending','held',{mode:0o600});
  await receive({kind:'desktop_account',id:'failed',method:'apply-models',input:{...roles,main:{model:'synthetic-hot-text',effort:'high',serviceTier:null}}});
  assert.equal(sent.findLast(value=>value.id==='failed').error,'chatgpt_model_save_failed');assert.equal(readFileSync(marker,'utf8'),before);assert.deepEqual(app.config.chatgpt,roles);
 }finally{await receive({kind:'stop'});await app?.close();rmSync(root,{recursive:true,force:true});}
});
