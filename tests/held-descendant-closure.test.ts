// Isolated protocol host; no native engine, account or production database.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Homer} from '../src/service.js';
import {WorkerInteractions} from '../src/worker-interactions.js';
import {chatFixture} from './task-chat-fixture.js';
function setup(mode='confirmed'){
 const f=chatFixture(),task=f.create(),other=f.create('Independent task','other');
 const a=f.tasks.workerOpen(f.actor,{operationId:'a',taskId:task.taskId,text:'A'}),b=f.tasks.workerOpen(f.actor,{operationId:'b',taskId:task.taskId,text:'B'}),p=f.tasks.workerOpen(f.actor,{operationId:'peer',taskId:other.taskId,text:'Independent'});
 const aa=f.start(a.workerId),bb=f.start(b.workerId),peer=f.start(p.workerId),workers=new Map<string,any>(),counts=new Map<string,{interrupt:number;close:number}>(),interactions=new WorkerInteractions(f.store.db);
 for(const run of [aa,bb,peer]){
  const count={interrupt:0,close:0};counts.set(run.id,count);const lease='lease:'+run.id;
  workers.set(run.id,{id:run.id,epoch:run.epoch,lease,requests:new Map(),engine:{threadId:run.threadId,turnId:run.turnId,
   async interrupt(){count.interrupt++;if(run.id===bb.id&&mode==='interrupt_throw')throw Error('synthetic_interrupt_failure');return true;},
   async close(){count.close++;if(run.id===bb.id&&mode==='throw')throw Error('synthetic_close_failure');return !(run.id===bb.id&&mode==='false');}}});
  f.store.setMeta('lease:'+run.id,lease);
 }
 const host:any=Object.create(Homer.prototype);Object.assign(host,{store:f.store,tasks:f.tasks,interactions,workers,mainApprovals:{end(){}},pauseClock(){},pump(){},scheduleInternal(){},scheduleDelivery(){}});
 const pause=()=>f.tasks.controlTask(f.actor,{operationId:'pause',taskId:task.taskId,expectedRevision:f.tasks.task(task.taskId).revision,action:'pause'});
 return {...f,task,aa,bb,peer,host,workers,counts,interactions,pause};
}
for(const mode of ['confirmed','false','throw','interrupt_throw'])test('whole-task Worker closure '+mode+' preserves exit certainty and independent peer',async()=>{
 const f=setup(mode);try{
  const before={task:f.tasks.task(f.peer.taskId),run:f.tasks.run(f.peer.id)},request=f.interactions.open({runId:f.bb.id,threadId:f.bb.threadId!,turnId:f.bb.turnId!,requestId:'synthetic',source:'native',kind:'question',details:{question:'Synthetic?'},authority:{sourceRequestId:f.actor.sourceRequestId!,description:'Synthetic',nativeApprovals:false}},()=>true);
  let callbacks=0;void request.response.then(()=>callbacks++);
  const receipt=f.pause(),epoch=f.tasks.run(f.bb.id).epoch;assert.equal(f.tasks.task(f.task.taskId).controlState,'stopping');assert.ok(epoch>f.bb.epoch);
  const results=await Promise.all([f.host.applyStop(receipt),f.host.applyStop(receipt)]),confirmed=['confirmed','interrupt_throw'].includes(mode),run=f.tasks.run(f.bb.id);
  assert.equal(results[0].state,confirmed?'confirmed':'uncertain');assert.equal(run.phase,confirmed?'ended':'uncertain');assert.equal(f.workers.has(run.id),!confirmed);assert.equal(!!f.store.meta('lease:'+run.id),!confirmed);assert.deepEqual(f.counts.get(run.id),{interrupt:1,close:1});assert.equal(run.epoch,epoch);
  assert.equal((await request.response).status,'cancelled');assert.equal(callbacks,1);
  assert.throws(()=>f.tasks.writeMarkdown({agentId:'worker:'+f.bb.workerId,runId:f.bb.id,epoch:f.bb.epoch,threadId:f.bb.threadId!,turnId:f.bb.turnId!},{operationId:'late',filename:'late.md',content:'Synthetic'}),/epoch|stop|live/);
  assert.deepEqual({task:f.tasks.task(f.peer.taskId),run:f.tasks.run(f.peer.id)},before);assert.deepEqual(f.counts.get(f.peer.id),{interrupt:0,close:0});
  if(!confirmed)assert.throws(()=>f.tasks.controlTask(f.actor,{operationId:'resume',taskId:f.task.taskId,expectedRevision:f.tasks.task(f.task.taskId).revision,action:'resume'}),/unconfirmed/);
 }finally{f.close();}
});

test('a Worker lease without its owning slot stays uncertain',async()=>{
 const f=setup();try{f.workers.delete(f.bb.id);const receipt=f.pause();const result=await f.host.applyStop(receipt);assert.equal(result.state,'uncertain');assert.equal(f.tasks.run(f.bb.id).phase,'uncertain');assert.ok(f.store.meta('lease:'+f.bb.id));}finally{f.close();}
});

test('accepted original text survives closing a residual owned engine',async()=>{
 const f=setup();try{
  const reply=f.tasks.endSegment(f.bb.id,f.bb.epoch,{status:'completed',text:'Original accepted text'},true)!;
  const result=f.tasks.adoptResult(f.actor,{operationId:'accept',taskId:f.task.taskId,version:1,messageId:reply.messageId}),before=f.tasks.readResult(f.actor,result.resultId);
  assert.equal(await f.host.stopOwnedWorker(f.bb.id),true);assert.equal(f.tasks.run(f.bb.id).status,'succeeded');assert.equal(f.workers.has(f.bb.id),false);assert.deepEqual(f.tasks.readResult(f.actor,result.resultId),before);assert.equal(f.tasks.task(f.task.taskId).state,'open');
 }finally{f.close();}
});
