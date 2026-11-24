import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,main,openWorker,running,complete,mutation} from './recursive-fixture.js';
const receipt=(f:ReturnType<typeof fixture>,id:string)=>f.store.db.prepare('SELECT * FROM agent_receipts WHERE messageId=?').get(id)!;

test('an idle followup targets only its successor and original receipt retains its exact Run identity',()=>{
 const f=fixture();try{
  const worker=openWorker(f),actor=running(f,worker.runId),before=receipt(f,worker.messageId);
  complete(f,actor);assert.equal(f.tasks.claim(),undefined);
  const queued=f.tasks.workerMessage(main,{operationId:'followup',workerId:worker.workerId,text:'Exact next turn'});
  assert.equal(queued.route,'followup');
  const next=f.tasks.claim()!;assert.ok(next);assert.notEqual(next.id,worker.runId);
  assert.equal(receipt(f,worker.messageId).offeredRunId,before.offeredRunId);assert.equal(receipt(f,worker.messageId).state,'processed');
  assert.equal(receipt(f,queued.messageId).offeredRunId,next.id);assert.equal(f.tasks.inbox(main).some(m=>m.id===queued.messageId),false);
  f.tasks.bind(next.id,next.epoch,actor.threadId!,'turn:next');assert.equal(receipt(f,queued.messageId).offeredTurnId,'turn:next');
  assert.equal(f.tasks.claim(next.id),undefined);
 }finally{f.close();}
});

test('immediate delivery is bound to the captured native turn and cannot be acknowledged after stop',()=>{
 const f=fixture();try{
  const worker=openWorker(f),actor=running(f,worker.runId),sent=f.tasks.workerMessage(main,{operationId:'immediate',workerId:worker.workerId,text:'Supplement'});
  assert.equal(sent.route,'steer');
  const op=f.tasks.operation(sent.operationKey),details=JSON.parse(op.detailsJson);
  assert.deepEqual([details.runId,details.epoch,details.threadId,details.expectedTurnId],[actor.runId,actor.epoch,actor.threadId,actor.turnId]);
  const stopped=f.tasks.workerStop(main,{operationId:'stop',workerId:worker.workerId});
  const before=receipt(f,sent.messageId);assert.throws(()=>f.tasks.markSteer(sent.operationKey,'received'),/message_target_stale/);assert.deepEqual(receipt(f,sent.messageId),before);
  f.tasks.confirmWorkerExit(worker.runId,undefined);f.tasks.confirmStop(stopped.operationKey,true);
  assert.equal(receipt(f,sent.messageId).state,'rejected');
  const resumed=f.tasks.workerMessage(main,{operationId:'next',workerId:worker.workerId,text:'New turn'}),next=running(f,resumed.runId!);
  assert.equal(f.tasks.inbox(next).some(m=>m.id===sent.messageId),false);
  assert.throws(()=>f.tasks.guard(actor),/epoch|live/);
 }finally{f.close();}
});

test('a native thread cannot be rebound to another Worker conversation',()=>{
 const f=fixture();try{
  const a=openWorker(f,'a'),b=openWorker(f,'b'),actor=running(f,a.runId),run=f.tasks.claim(b.runId)!;
  assert.throws(()=>f.tasks.bind(run.id,run.epoch,actor.threadId!,'turn:foreign'),/worker_thread_conflict/);
  assert.equal(f.tasks.run(b.runId).threadId,null);assert.equal(f.tasks.run(b.runId).phase,'starting');
  f.tasks.bind(run.id,run.epoch,'thread:other','turn:other');assert.equal(f.tasks.run(b.runId).threadId,'thread:other');
 }finally{f.close();}
});

test('a legacy unbound input survives a goal edit without launching or joining a later turn',()=>{
 const f=fixture();try{
  const worker=openWorker(f),actor=running(f,worker.runId),db=f.store.db;
  const old={workerId:worker.workerId,text:'Previously accepted future instruction'};
  db.prepare("INSERT INTO operations(id,actorAgentId,scopeId,operationId,kind,payloadHash,state,detailsJson) VALUES('old-send',?,?,'old-native-call','worker_send','fixture-hash','confirmed','{}')").run(main.agentId,f.task.taskId);
  db.prepare("INSERT INTO agent_messages(id,senderAgentId,recipientAgentId,taskId,taskVersion,kind,operationKey,payloadJson) VALUES('old-message',?,?,?,1,'worker_input','old-send',?)").run(main.agentId,actor.agentId,f.task.taskId,JSON.stringify(old));
  db.prepare("INSERT INTO agent_receipts(messageId,recipientAgentId,state) VALUES('old-message',?,'pending')").run(actor.agentId);
  const source=f.source('edit','Revise the task goal');
  f.tasks.updateTask(source,{...mutation(f,'edit-goal'),patch:{goal:'Revised goal'}});
  complete(f,actor);assert.equal(f.tasks.claim(),undefined);
  const next=f.tasks.workerMessage(source,{operationId:'explicit',workerId:worker.workerId,text:'New explicit request'});
  assert.equal(f.tasks.claim(next.runId)?.prompt,'New explicit request');
  assert.equal(receipt(f,'old-message').state,'pending');
  const saved=f.tasks.workerRead(source,{workerId:worker.workerId,messageId:'old-message'}).messages[0]!;
  assert.equal(saved.targetRunId,null);assert.equal(saved.taskVersion,1);assert.equal(saved.text,old.text);
 }finally{f.close();}
});
