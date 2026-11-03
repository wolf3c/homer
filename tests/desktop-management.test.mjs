import {test} from 'node:test';
import assert from 'node:assert/strict';
import {desktopManagementAllowed} from '../src/desktop-management.ts';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {EventEmitter} from 'node:events';
import {transpileModule,ModuleKind} from 'typescript';
test('desktop before readiness exposes state only; removed capability APIs stay removed',()=>{
 for(const method of ['state','history.state'])assert.equal(desktopManagementAllowed(method),true);
 for(const method of ['capabilities.state','capabilities.manage','submit','history.page','queue.move','media.upload','respond']){
  for(const action of ['account_state','account_login','mcp_save'])assert.equal(desktopManagementAllowed(method,{action,approve:true}),false);
 }
});
test('desktop private IPC reuses native state/login/cancel and exposes no web account mutation',async()=>{
 const calls=[],sent=[],process=new EventEmitter();
 Object.assign(process,{connected:true,env:{},send:(value,callback)=>{sent.push(value);callback();},disconnect(){}});
 let state={account:'none',connected:false,phase:'idle'};
 class Homer{
  constructor(config){this.config=config;this.modelConfig={keyEnv:'SYNTHETIC_MISSING',baseUrl:'http://127.0.0.1'};}
  onStateChange(){}
  async close(){}
  async manageCapabilities(input){calls.push(input);if(input.action==='account_login')return state={...state,phase:'waiting',loginId:'synthetic-login'};if(input.action==='account_cancel')return state={account:'none',connected:false,phase:'cancelled'};return state;}
 }
 const require=createRequire(import.meta.url),code=transpileModule(readFileSync('src/dev-host.ts','utf8'),{compilerOptions:{module:ModuleKind.CommonJS}}).outputText;
 const receive=Function('require','process','exports',code+'\nreturn receive;')(name=>{
  if(name==='./service.js')return {Homer,DesktopReviewRequired:class extends Error{}};
  if(name==='./engine.js')return {engineError:error=>error.message};
  if(name==='./desktop-management.js')return {desktopManagementAllowed};
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
