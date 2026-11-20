// Requirements-derived synthetic inputs; no model, channel or daily runtime.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,main,authority,openWorker,running,complete,mutation,processReplies} from './recursive-fixture.js';

test('two Workers share one Task, open replay is exact and failure never settles the Task',()=>{
 const f=fixture();try{
  const input={operationId:'open-a',taskId:f.task.taskId,text:'Inspect page'},a=f.tasks.workerOpen(main,input),b=openWorker(f,'open-b');
  assert.deepEqual(f.tasks.workerOpen(main,input),a);assert.notEqual(a.workerId,b.workerId);
  assert.equal(f.tasks.tasks().length,1);assert.equal(f.tasks.runs().length,2);
  assert.throws(()=>f.tasks.workerOpen(main,{...input,text:'Changed'}),/operation_payload_conflict/);
  const aa=running(f,a.runId),bb=running(f,b.runId);
  f.tasks.failRun(aa.runId!,aa.epoch!,'synthetic_missing');complete(f,bb);
  assert.equal(f.tasks.task(f.task.taskId).state,'open');assert.equal(f.tasks.task(f.task.taskId).outcome,null);
  assert.equal(f.tasks.workerRead(main,{workerId:b.workerId}).messages.at(-1)?.text,'Checked synthetic input; date remains unknown.');
  assert.equal(f.tasks.inbox(main).filter(m=>m.kind==='worker_reply').length,2);
 }finally{f.close();}
});

test('notes CAS and operation replay preserve goal, version and authority',()=>{
 const f=fixture();try{
  const before=f.tasks.authority(f.task.taskId,1),input={...mutation(f,'notes'),patch:{notes:'Unknown date; inspect both sources'}};
  const receipt=f.tasks.updateTask(main,input);assert.deepEqual(f.tasks.updateTask(main,input),receipt);
  assert.equal(f.tasks.task(f.task.taskId).headVersion,1);assert.deepEqual(f.tasks.authority(f.task.taskId,1),before);
  assert.throws(()=>f.tasks.updateTask(main,{...input,operationId:'stale'}),/revision_conflict/);
  assert.equal(f.tasks.task(f.task.taskId).notes,input.patch.notes);
 }finally{f.close();}
});

test('queued, starting and RPC-waiting Workers return their current run without accepting a message',()=>{
 const f=fixture();try{
  const w=openWorker(f);
  for(const phase of ['queued','starting','rpc_wait']){
   if(phase==='starting')assert.ok(f.tasks.claim(w.runId));
   if(phase==='rpc_wait'){
    const run=f.tasks.run(w.runId);f.tasks.bind(run.id,run.epoch,'thread:a','turn:a');f.tasks.rpc(run.id,run.epoch,true);
   }
   const input={operationId:'send-'+phase,workerId:w.workerId,text:'Only for a live turn'};
   const blocked=f.tasks.workerMessage(main,input);
   assert.equal(blocked.state,'blocked');assert.equal(blocked.reason,'worker_not_ready');assert.equal(blocked.runId,w.runId);
   assert.equal(blocked.phase,phase==='queued'?'ready':phase);
   assert.deepEqual(f.tasks.workerMessage(main,input),blocked);
   assert.equal(f.tasks.workerRead(main,{workerId:w.workerId}).messages.length,1);
  }
  assert.equal(f.tasks.runs().length,1);
 }finally{f.close();}
});

test('immediate supplementation targets the exact native turn without changing the adopted version',()=>{
 const f=fixture();try{
  const w=openWorker(f),actor=running(f,w.runId),input={operationId:'steer',workerId:w.workerId,text:'Keep unknown dates'};
  const r=f.tasks.workerMessage(main,input);assert.equal(r.threadId,actor.threadId);assert.equal(r.expectedTurnId,actor.turnId);
  f.tasks.markSteer(r.operationKey,'dispatching');f.tasks.markSteer(r.operationKey,'received');
  assert.equal(f.tasks.operation(r.operationKey).state,'confirmed');assert.equal(f.tasks.run(w.runId).version,1);
  assert.deepEqual(f.tasks.workerMessage(main,input),r);assert.equal(f.tasks.guard(actor).id,f.task.taskId);
 }finally{f.close();}
});

test('uncertain steer fences execution and does not create a fallback Run or a new adopted version',()=>{
 const f=fixture();try{
  const w=openWorker(f),actor=running(f,w.runId),input={operationId:'unknown-steer',workerId:w.workerId,text:'Supplement'};
  const r=f.tasks.workerMessage(main,input);f.tasks.markSteer(r.operationKey,'dispatching');f.tasks.markSteer(r.operationKey,'uncertain');
  assert.deepEqual(f.tasks.workerMessage(main,input),r);assert.equal(f.tasks.run(w.runId).version,1);assert.equal(f.tasks.run(w.runId).phase,'uncertain');
  assert.equal(f.tasks.runs().length,1);assert.equal(f.tasks.safeToUpgrade(),false);assert.throws(()=>f.tasks.guard(actor),/phase/);
  assert.equal(f.tasks.workerMessage(main,{...input,operationId:'blind-retry'}).state,'blocked');
 }finally{f.close();}
});

test('stopping one Worker fences late callbacks while its peer continues and Task remains open',()=>{
 const f=fixture();try{
  const a=openWorker(f,'a'),b=openWorker(f,'b'),aa=running(f,a.runId),bb=running(f,b.runId);
  const stopped=f.tasks.workerStop(main,{operationId:'stop-a',workerId:a.workerId,reason:'Stop selected conversation'});
  assert.deepEqual(stopped.targets,[a.runId]);assert.throws(()=>f.tasks.guard(aa),/epoch|stop|live/);
  f.tasks.confirmStop(stopped.operationKey,false);assert.equal(f.tasks.claim(),undefined);
  assert.throws(()=>f.tasks.confirmStop(stopped.operationKey,true),/run_stop_unconfirmed/);f.tasks.confirmWorkerExit(a.runId,undefined);f.tasks.confirmStop(stopped.operationKey,true);assert.equal(f.tasks.run(a.runId).status,'cancelled');
  assert.equal(f.tasks.guard(bb).id,f.task.taskId);assert.equal(f.tasks.task(f.task.taskId).outcome,null);
  const count=f.tasks.inbox(main).length;complete(f,aa,'Late old output');assert.equal(f.tasks.inbox(main).length,count);
 }finally{f.close();}
});

test('restart preserves raw checkpoint, invalidates old epoch and needs confirmed exit before a successor',()=>{
 const f=fixture();try{
  const w=openWorker(f),actor=running(f,w.runId);
  f.tasks.recordWorkerOutput(w.runId,actor.epoch!,{threadId:actor.threadId,turnId:actor.turnId,itemId:'native-final',phase:'final_answer',text:'Preserved raw answer'});
  f.tasks.charge(w.runId,actor.epoch!,400);f.tasks.reconcile();
  assert.throws(()=>f.tasks.guard(actor),/epoch|live/);assert.equal(f.tasks.run(w.runId).activeMs,400);
  assert.equal(f.tasks.workerRead(main,{workerId:w.workerId}).messages.at(-1)!.text,'Preserved raw answer');
  assert.equal(f.tasks.workerMessage(main,{operationId:'followup',workerId:w.workerId,text:'Continue after recovery'}).state,'blocked');assert.equal(f.tasks.claim(),undefined);
  assert.ok(f.tasks.confirmWorkerExit(w.runId,undefined));assert.equal(f.tasks.claim(),undefined);
  f.tasks.workerMessage(main,{operationId:'after-exit',workerId:w.workerId,text:'Continue after recovery'});const next=f.tasks.claim()!;
  assert.equal(next.workerId,w.workerId);assert.equal(next.replacesRunId,w.runId);assert.equal(next.threadId,actor.threadId);
  assert.equal(f.tasks.claim(),undefined);
 }finally{f.close();}
});

for(const confirmed of [false,true])test('settlement waits for execution and exit confirmation: '+confirmed,()=>{
 const f=fixture();try{
  const w=openWorker(f),actor=running(f,w.runId);
  assert.throws(()=>f.tasks.settleTask(main,{...mutation(f,'too-early'),outcome:'succeeded'}),/run_stop_unconfirmed/);
  complete(f,actor,'Readable answer',confirmed);
  if(!confirmed){assert.throws(()=>f.tasks.settleTask(main,{...mutation(f,'unknown'),outcome:'succeeded'}),/unconfirmed|unresolved|live|closed|active|blocked/);f.tasks.confirmWorkerExit(w.runId,undefined);}
  processReplies(f);const input={...mutation(f,'settle'),outcome:'succeeded' as const};f.tasks.settleTask(main,input);
  assert.equal(f.tasks.task(f.task.taskId).state,'settled');assert.deepEqual(f.tasks.settleTask(main,input).taskId,f.task.taskId);
  assert.equal(f.tasks.workerRead(main,{workerId:w.workerId}).messages.at(-1)?.text,'Readable answer');
 }finally{f.close();}
});

test('goal changes bind the actual user source and cannot be authorized by work notes',()=>{
 const f=fixture();try{
  const before=f.tasks.task(f.task.taskId);
  assert.throws(()=>f.tasks.updateTask(main,{...mutation(f,'no-source'),patch:{goal:'New execution'}}),/authority_source_denied/);
  assert.deepEqual(f.tasks.task(before.id),before);
  const actor=f.source('user:changed','New request: inspect only');
  const changed=f.tasks.updateTask(actor,{...mutation(f,'change'),patch:{goal:'Inspect only'},authority:authority(actor.sourceRequestId)});
  assert.equal(changed.version,2);assert.equal(f.tasks.version(before.id,2).sourceRequestId,actor.sourceRequestId);
  assert.equal(f.tasks.operation(f.tasks.version(before.id,2).triggerOpId).operationId,'change');
 }finally{f.close();}
});

test('exit confirmation clears only the exact persisted execution lease before a successor starts',()=>{
 const f=fixture();try{
  const w=openWorker(f),actor=running(f,w.runId);f.store.setMeta('lease:'+w.runId,'current-owner');complete(f,actor,'Readable output',false);
  assert.equal(f.tasks.workerMessage(main,{operationId:'followup',workerId:w.workerId,text:'Continue only after exit'}).state,'blocked');
  assert.equal(f.tasks.confirmWorkerExit(w.runId,'wrong-owner'),false);assert.equal(f.store.meta('lease:'+w.runId),'current-owner');assert.equal(f.tasks.claim(),undefined);
  assert.equal(f.tasks.confirmWorkerExit(w.runId,'current-owner'),true);assert.equal(f.store.meta('lease:'+w.runId),undefined);
  assert.equal(f.tasks.claim(),undefined);f.tasks.workerMessage(main,{operationId:'after-exit',workerId:w.workerId,text:'Continue only after exit'});
  const next=f.tasks.claim()!;assert.equal(next.workerId,w.workerId);assert.equal(f.tasks.claim(),undefined);
 }finally{f.close();}
});
