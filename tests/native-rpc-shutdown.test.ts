import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {Homer} from '../src/service.js';
import {CodexEngine} from '../src/engine.js';
import type {Config} from '../src/config.js';

const scratch=resolve('.codex/scratch/native-rpc-lifecycle-implementation');
mkdirSync(scratch,{recursive:true});
async function flush(){await new Promise<void>(done=>setImmediate(done));}
function fixture(){
 const dir=mkdtempSync(join(scratch,'shutdown-test-'));
 const config:Config={appData:dir,runtime:join(dir,'runtime'),workspace:join(dir,'workspace'),codexHome:join(dir,'codex'),codexBin:'/usr/bin/false',requiresOpenaiAuth:false,model:'synthetic',timeoutMs:1000,mainTimeoutMs:1000,stopGraceMs:100};
 for(const path of [config.runtime,config.workspace])mkdirSync(path);
 const app=new Homer(config,async()=>{});
 const engine=new CodexEngine(config,{cwd:config.workspace,readRoots:[],instructions:'synthetic',tools:[]},async()=>({}));
 const sent:{id:number;method:string}[]=[];let held='';
 engine['send']=(message:any)=>{
  sent.push(message);
  if(message.method===held)return;
  const result=message.method==='account/read'?{account:null}:message.method==='account/login/start'?{type:'chatgpt',loginId:'synthetic',authUrl:'http://127.0.0.1/synthetic'}:{status:'canceled'};
  void engine['receive'](JSON.stringify({id:message.id,result}));
 };
 app['nativeControl']=engine;app['nativeStarting']=Promise.resolve('');
 return {app,engine,sent,hold:(method:string)=>{held=method;},dispose:()=>rmSync(dir,{recursive:true,force:true})};
}

test('service shutdown releases a blocked account read, login start or cancellation before draining its queue',async()=>{
 for(const operation of ['account/read','account/login/start','account/login/cancel']){
  const f=fixture();let closing:Promise<void>|undefined,finished=false;
  try{
   if(operation==='account/login/cancel')await f.app.manageCapabilities({action:'account_login',approve:true});
   f.hold(operation);
   const work=f.app.manageCapabilities(operation==='account/read'?{action:'account_state'}:operation==='account/login/start'?{action:'account_login',approve:true}:{action:'account_cancel',loginId:'synthetic',approve:true});
   work.catch(()=>{});await flush();assert.equal(f.engine['pending'].size,1);
   closing=f.app.close().then(()=>{finished=true;});await flush();
   assert.equal(finished,true,'close must stop control transport before waiting for the account queue');
   await closing;await Promise.allSettled([work]);assert.equal(f.engine['pending'].size,0);
   assert.equal(f.app['closed'],true);assert.equal(f.app['nativeOperations'],0);
  }finally{
   // Also releases the deliberately blocked baseline path after a red assertion.
   await f.engine.close();if(closing)await closing;else await f.app.close();f.dispose();
  }
 }
});

test('native RPC cannot recreate a control process after service shutdown begins',async()=>{
 const f=fixture();
 try{
  await f.app.close();
  let writes=0;
  f.app['nativeControl']={request:async()=>{writes++;return {};}} as any;
  await assert.rejects(f.app['nativeRpc']('account/read',{}),/service_upgrading/);
  assert.equal(writes,0);
 }finally{f.dispose();}
});
