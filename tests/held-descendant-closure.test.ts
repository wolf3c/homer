// Requirements-derived synthetic checks for main-root -> direct Worker closure.
// Prototype host only; no production database, native process, model or account.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Homer} from '../src/service.js';
import {WorkerInteractions} from '../src/worker-interactions.js';
import {fixture,delegate,running,main,contract,complete,accept} from './recursive-fixture.js';
function setup(mode='confirmed'){
 const f=fixture('.codex/scratch/worker-native-subagent-convergence-implementation-20261024/closure');
 const a=delegate(f,'a'),b=delegate(f,'b'),aa=running(f,a.taskId),bb=running(f,b.taskId);
 const other=f.tasks.createRoot(main,{operationId:'other',title:'Independent synthetic',contract:contract(),authority:f.tasks.authority(f.root.taskId,1),executorKind:'worker'}),peer=running(f,other.taskId);
 const workers=new Map<string,any>(),counts=new Map<string,{interrupt:number;close:number}>(),interactions=new WorkerInteractions(f.store.db);
 for(const actor of [aa,bb,peer]){
  const id=actor.runId!,count={interrupt:0,close:0};counts.set(id,count);
  workers.set(id,{id,epoch:actor.epoch,requests:new Map(),engine:{threadId:actor.threadId,turnId:actor.turnId,
   async interrupt(){count.interrupt++;if(id===bb.runId&&mode==='interrupt_throw')throw Error('synthetic_interrupt_failure');return true;},
   async close(){count.close++;if(id===bb.runId&&mode==='throw')throw Error('synthetic_close_failure');return !(id===bb.runId&&mode==='false');}}});
  f.store.setMeta('lease:'+id,'synthetic-opaque');
 }
 const host:any=Object.create(Homer.prototype);Object.assign(host,{store:f.store,tasks:f.tasks,interactions,workers,mainApprovals:{end(){}}});
 const hold=()=>{const root=f.tasks.task(f.root.taskId);return f.tasks.stop(main,{operationId:'hold',taskId:root.id,version:1,expectedTaskRevision:root.revision,scope:'self',reason:'Synthetic root stopped'});};
 return {...f,a,b,aa,bb,peer,host,workers,counts,interactions,hold};
}
for(const mode of ['confirmed','false','throw','interrupt_throw'])test('direct Worker closure '+mode+' preserves exit/lease certainty and independent peer',async()=>{
 const f=setup(mode);try{
  const sibling={task:f.tasks.task(f.peer.agentId.replace('worker:','')),run:f.tasks.run(f.peer.runId!)};
  const wait=f.tasks.wait(f.bb,{operationId:'wait',taskId:f.b.taskId,version:1,expectedTaskRevision:f.tasks.task(f.b.taskId).revision,condition:{type:'message',messageId:'synthetic'}});
  const req=f.interactions.open({runId:f.bb.runId!,threadId:f.bb.threadId!,turnId:f.bb.turnId!,requestId:'synthetic',source:'native',kind:'question',details:{question:'Synthetic?'},authority:{sourceRequestId:main.sourceRequestId!,description:'Synthetic',nativeApprovals:false}},()=>true);
  let callbacks=0;void req.response.then(()=>callbacks++);
  f.hold();const epoch=f.tasks.run(f.bb.runId!).epoch;
  assert.equal(f.tasks.task(f.b.taskId).controlState,'held');assert.ok(epoch>f.bb.epoch!);
  assert.equal(f.store.db.prepare('SELECT state FROM run_waits WHERE id=?').get(wait.waitId)!.state,'cancelled');
  await Promise.all([f.host.holdDirectWorkers(f.root.taskId),f.host.holdDirectWorkers(f.root.taskId)]);
  await f.host.holdDirectWorkers(f.root.taskId);
  const confirmed=['confirmed','interrupt_throw'].includes(mode),run=f.tasks.run(f.bb.runId!);
  assert.equal(run.phase,confirmed?'ended':'uncertain');assert.equal(f.workers.has(run.id),!confirmed);assert.equal(!!f.store.meta('lease:'+run.id),!confirmed);
  assert.deepEqual(f.counts.get(run.id),{interrupt:1,close:1});assert.equal(run.epoch,epoch);
  assert.equal((await req.response).status,'cancelled');assert.equal(callbacks,1);
  assert.throws(()=>f.tasks.writeMarkdown(f.bb,{operationId:'late',filename:'late.md',content:'Synthetic'}),/epoch|held|live/);
  assert.deepEqual({task:f.tasks.task(sibling.task.id),run:f.tasks.run(f.peer.runId!)},sibling);assert.deepEqual(f.counts.get(f.peer.runId!),{interrupt:0,close:0});
  if(!confirmed)assert.throws(()=>f.tasks.takeover(main,{operationId:'take',taskId:f.b.taskId,version:1,expectedTaskRevision:f.tasks.task(f.b.taskId).revision,coordinatorAgentId:main.agentId}),/unconfirmed/);
 }finally{f.close();}
});
test('direct Worker lease without a slot remains uncertain',async()=>{
 const f=setup();try{f.workers.delete(f.bb.runId!);f.hold();await f.host.holdDirectWorkers(f.root.taskId);assert.equal(f.tasks.run(f.bb.runId!).phase,'uncertain');assert.ok(f.store.meta('lease:'+f.bb.runId));}finally{f.close();}
});
test('accepted direct Worker outcome survives closing a residual owned engine',async()=>{
 const f=setup();try{
  f.store.db.prepare('DELETE FROM meta WHERE key=?').run('lease:'+f.bb.runId);const result=complete(f,f.bb,f.b.taskId);accept(f,f.b.taskId,result.resultId);
  const before=f.tasks.inspect(main,{resultId:result.resultId});f.hold();await f.host.holdDirectWorkers(f.root.taskId);
  assert.equal(f.tasks.run(f.bb.runId!).status,'succeeded');assert.equal(f.workers.has(f.bb.runId!),false);
  assert.deepEqual(f.tasks.inspect(main,{resultId:result.resultId}).actualResult,before.actualResult);assert.equal(f.tasks.task(f.b.taskId).outcome,'succeeded');
 }finally{f.close();}
});
