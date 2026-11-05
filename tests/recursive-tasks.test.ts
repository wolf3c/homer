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
  assert.equal(f.tasks.readTask(main,f.task.taskId).results.length,0);
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

test('ordinary followups queue in order and start one successor on the same native thread',()=>{
 const f=fixture();try{
  const worker=openWorker(f),actor=running(f,worker.runId);
  const a=f.tasks.workerSend(main,{operationId:'send-a',workerId:worker.workerId,text:'First followup'}),b=f.tasks.workerSend(main,{operationId:'send-b',workerId:worker.workerId,text:'Second followup'});
  assert.equal(a.runId,null);assert.equal(b.runId,null);assert.equal(f.tasks.claim(worker.runId),undefined);
  complete(f,actor);const next=f.tasks.claim()!;assert.ok(next);
  assert.equal(next.workerId,worker.workerId);assert.equal(next.threadId,actor.threadId);assert.equal(next.prompt,'First followup\n\nSecond followup');
  assert.equal(f.tasks.claim(),undefined);f.tasks.bind(next.id,next.epoch,actor.threadId!,'turn:followup');
  const messages=f.tasks.workerRead(main,{workerId:worker.workerId}).messages;
  assert.deepEqual(messages.filter(m=>[a.messageId,b.messageId].includes(m.id)).map(m=>m.targetRunId),[next.id,next.id]);
 }finally{f.close();}
});

test('immediate supplementation targets the exact native turn without changing the adopted version',()=>{
 const f=fixture();try{
  const w=openWorker(f),actor=running(f,w.runId),input={operationId:'steer',workerId:w.workerId,text:'Keep unknown dates',immediate:true};
  const r=f.tasks.workerSend(main,input);assert.equal(r.threadId,actor.threadId);assert.equal(r.expectedTurnId,actor.turnId);
  f.tasks.markSteer(r.operationKey,'dispatching');f.tasks.markSteer(r.operationKey,'received');
  assert.equal(f.tasks.operation(r.operationKey).state,'confirmed');assert.equal(f.tasks.run(w.runId).version,1);
  assert.deepEqual(f.tasks.workerSend(main,input),r);assert.equal(f.tasks.guard(actor).id,f.task.taskId);
 }finally{f.close();}
});

test('uncertain steer fences execution and does not create a fallback Run or a new adopted version',()=>{
 const f=fixture();try{
  const w=openWorker(f),actor=running(f,w.runId),input={operationId:'unknown-steer',workerId:w.workerId,text:'Supplement',immediate:true};
  const r=f.tasks.workerSend(main,input);f.tasks.markSteer(r.operationKey,'dispatching');f.tasks.markSteer(r.operationKey,'uncertain');
  assert.deepEqual(f.tasks.workerSend(main,input),r);assert.equal(f.tasks.run(w.runId).version,1);assert.equal(f.tasks.run(w.runId).phase,'uncertain');
  assert.equal(f.tasks.runs().length,1);assert.equal(f.tasks.safeToUpgrade(),false);assert.throws(()=>f.tasks.guard(actor),/phase/);
  assert.throws(()=>f.tasks.workerSend(main,{...input,operationId:'blind-retry'}),/uncertain|not_applicable/);
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
  f.tasks.workerSend(main,{operationId:'followup',workerId:w.workerId,text:'Continue after recovery'});assert.equal(f.tasks.claim(),undefined);
  assert.ok(f.tasks.confirmWorkerExit(w.runId,undefined));const next=f.tasks.claim()!;
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
  assert.equal(f.tasks.readTask(main,f.task.taskId).results.length,0);assert.equal(f.tasks.deliveries().length,0);
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
  f.tasks.workerSend(main,{operationId:'followup',workerId:w.workerId,text:'Continue only after exit'});
  assert.equal(f.tasks.confirmWorkerExit(w.runId,'wrong-owner'),false);assert.equal(f.store.meta('lease:'+w.runId),'current-owner');assert.equal(f.tasks.claim(),undefined);
  assert.equal(f.tasks.confirmWorkerExit(w.runId,'current-owner'),true);assert.equal(f.store.meta('lease:'+w.runId),undefined);
  const next=f.tasks.claim()!;assert.equal(next.workerId,w.workerId);assert.equal(f.tasks.claim(),undefined);
 }finally{f.close();}
});
