import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
// The caller points this at the complete bounded maintenance-source build.
const {Homer}=await import(process.env.HOMER_TEST_SERVICE_MODULE);
const {Store}=await import(new URL('./store.js',process.env.HOMER_TEST_SERVICE_MODULE));
const {CodexEngine}=await import(new URL('./engine.js',process.env.HOMER_TEST_SERVICE_MODULE));
const parent=resolve('.codex/scratch/macos-desktop-application/startup-unit-tests');mkdirSync(parent,{recursive:true});
function fixture(t){const root=mkdtempSync(join(parent,'synthetic-'));t.after(()=>rmSync(root,{recursive:true,force:true}));mkdirSync(join(root,'runtime'));let starts=0;
 class Engine extends EventEmitter{async start(){starts++;throw Error('synthetic_start_failed');}async close(){return true;}async interrupt(){return true;}async turn(){return {status:'completed',text:''};}}
 const cfg={workspace:join(root,'workspace'),runtime:join(root,'runtime'),codexHome:join(root,'codex'),nativeCodexHome:join(root,'codex'),codexBin:'/usr/bin/false',model:'synthetic',requiresOpenaiAuth:false,stopGraceMs:100};
 const app=new Homer(cfg,async()=>{},()=>new Engine());return {root,app,starts:()=>starts};
}
test('desktop retains an unconfirmed old main lease when no new main was created',async t=>{
 const f=fixture(t),lease=JSON.stringify({pid:process.pid,identity:'synthetic-unverified-identity'});
 f.app.store.setMeta('lease:main',lease);
 await assert.rejects(f.app.start({keepManagementOnFailure:true}),/orphan_stop_unconfirmed/);
 assert.equal(f.starts(),0);assert.equal(f.app.store.meta('lease:main'),lease);
 await assert.rejects(f.app.start({keepManagementOnFailure:true}),/desktop_start_owner_unconfirmed/);
 assert.equal(f.starts(),0);
 await assert.rejects(f.app.close({requireAllOwnersConfirmed:true}),/desktop_owner_stop_unconfirmed/);
 const db=new Store(join(f.root,'runtime/homer.sqlite'));assert.equal(db.meta('lease:main'),lease);db.close();
});
test('desktop closes only a newly created failed main and keeps management store open',async t=>{
 const f=fixture(t),cwd=process.cwd();process.chdir(f.root);
 try{await assert.rejects(f.app.start({keepManagementOnFailure:true}),/synthetic_start_failed/);}finally{process.chdir(cwd);}
 assert.equal(f.starts(),1);assert.equal(f.app.store.meta('lease:main'),undefined);
 assert.equal(f.app.conversationState().threadId,'');await f.app.close({requireAllOwnersConfirmed:true});
});
test('desktop shutdown rejects a leftover Worker owner even when close() did not throw',async t=>{
 const f=fixture(t),{app}=f,threadId='synthetic-thread',sourceRequestId='synthetic-owner-source';
 app.store.setMeta('mainThread',threadId);
 app.inputs.accept({requestId:sourceRequestId,text:'Synthetic authorized work'});const input=app.inputs.claim();app.inputs.finish(input.messageId,input.revision,'completed');
 const actor={agentId:app.store.meta('mainAgentId'),threadId,sourceRequestId};
 const opened=app.tasks.workerOpen(actor,{operationId:'open-synthetic-owner',text:'Check synthetic ownership',workingDirectory:app.config.workspace,authority:{sourceRequestId,description:'Synthetic authorized work'}});
 const run=app.tasks.claim(opened.runId);app.tasks.bind(run.id,run.epoch,'synthetic-worker-thread','synthetic-worker-turn');
 const key='lease:'+run.id,lease=JSON.stringify({pid:99999999,identity:'synthetic'});
 app.store.setMeta(key,lease);
 app.workers.set(run.id,{id:run.id,epoch:run.epoch,lease,engine:{close:async()=>false}});
 await assert.rejects(app.close({requireAllOwnersConfirmed:true}),/desktop_owner_stop_unconfirmed/);
 const db=new Store(join(f.root,'runtime/homer.sqlite'));try{assert.equal(db.meta(key),lease);}finally{db.close();}

});
for(const kind of ['main','native-control'])test(`desktop shutdown never claims ${kind} stop=false as confirmed`,async t=>{
 const f=fixture(t);f.app[kind==='main'?'main':'nativeControl']={close:async()=>false};
 f.app.store.setMeta('lease:'+kind,JSON.stringify({pid:99999999,identity:'synthetic'}));
 await assert.rejects(f.app.close({requireAllOwnersConfirmed:true}),/stop_unconfirmed/);
 const db=new Store(join(f.root,'runtime/homer.sqlite'));assert.ok(db.meta('lease:'+kind));db.close();
});

for(const scenario of ['close during startup','startup failure','different persisted owner','unconfirmed control stop'])test('native control lease: '+scenario,async t=>{
 const {app,root}=fixture(t),key='lease:native-control';
 let failStartup,closes=0,starts=0;
 t.mock.method(CodexEngine.prototype,'start',function(){
  starts++;this.pid=process.pid;this.emit('spawn');
  return new Promise((_,reject)=>{failStartup=reject;});
 });
 t.mock.method(CodexEngine.prototype,'close',async function(){
  if(++closes===1&&scenario==='close during startup'){
   failStartup(Error('engine_closed'));await new Promise(resolve=>setImmediate(resolve));
  }
  return scenario!=='unconfirmed control stop';
 });
 const request=app.nativeRpc('account/read',{});request.catch(()=>{});
 const lease=app.store.meta(key);assert.equal(JSON.parse(lease).pid,process.pid);
 const other=JSON.stringify({pid:process.pid,identity:'different synthetic owner'});
 if(scenario==='different persisted owner')app.store.setMeta(key,other);
 if(scenario==='close during startup')await app.close({requireAllOwnersConfirmed:true});
 else{
  failStartup(Error('synthetic_control_start_failed'));
  await assert.rejects(request,/synthetic_control_start_failed/);
  if(scenario==='different persisted owner'){
   await assert.rejects(app.nativeRpc('account/read',{}),/synthetic_control_start_failed/);
   assert.equal(starts,1);assert.equal(app.store.meta(key),other);
   await assert.rejects(app.close({requireAllOwnersConfirmed:true}),/desktop_owner_stop_unconfirmed/);
  }
  else if(scenario==='unconfirmed control stop')await assert.rejects(app.close({requireAllOwnersConfirmed:true}),/capability_control_stop_unconfirmed/);
  else await app.close({requireAllOwnersConfirmed:true});
 }
 if(scenario==='close during startup')await assert.rejects(request,/engine_closed/);
 const saved=new Store(join(root,'runtime/homer.sqlite'));
 try{assert.equal(saved.meta(key),scenario==='different persisted owner'?other:scenario==='unconfirmed control stop'?lease:undefined);}finally{saved.close();}
});
