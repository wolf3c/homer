import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,main,openWorker,running,complete} from './recursive-fixture.js';
const receipt=(f:ReturnType<typeof fixture>,id:string)=>f.store.db.prepare('SELECT * FROM agent_receipts WHERE messageId=?').get(id)!;

test('an ordinary followup targets only its successor and original receipt retains its exact Run identity',()=>{
 const f=fixture();try{
  const worker=openWorker(f),actor=running(f,worker.runId),before=receipt(f,worker.messageId);
  const queued=f.tasks.workerSend(main,{operationId:'followup',workerId:worker.workerId,text:'Exact next turn'});
  assert.equal(f.store.db.prepare('SELECT targetRunId FROM agent_messages WHERE id=?').get(queued.messageId)!.targetRunId,null);
  complete(f,actor);const next=f.tasks.claim()!;assert.ok(next);assert.notEqual(next.id,worker.runId);
  assert.equal(receipt(f,worker.messageId).offeredRunId,before.offeredRunId);assert.equal(receipt(f,worker.messageId).state,'processed');
  assert.equal(receipt(f,queued.messageId).offeredRunId,next.id);assert.equal(f.tasks.inbox(main).some(m=>m.id===queued.messageId),false);
  f.tasks.bind(next.id,next.epoch,actor.threadId!,'turn:next');assert.equal(receipt(f,queued.messageId).offeredTurnId,'turn:next');
  assert.equal(f.tasks.claim(next.id),undefined);
 }finally{f.close();}
});

test('immediate delivery is bound to the captured native turn and cannot be acknowledged after stop',()=>{
 const f=fixture();try{
  const worker=openWorker(f),actor=running(f,worker.runId),sent=f.tasks.workerSend(main,{operationId:'immediate',workerId:worker.workerId,text:'Supplement',immediate:true});
  const op=f.tasks.operation(sent.operationKey),details=JSON.parse(op.detailsJson);
  assert.deepEqual([details.runId,details.epoch,details.threadId,details.expectedTurnId],[actor.runId,actor.epoch,actor.threadId,actor.turnId]);
  const stopped=f.tasks.workerStop(main,{operationId:'stop',workerId:worker.workerId});
  const before=receipt(f,sent.messageId);assert.throws(()=>f.tasks.markSteer(sent.operationKey,'received'),/message_target_stale/);assert.deepEqual(receipt(f,sent.messageId),before);
  f.tasks.confirmWorkerExit(worker.runId,undefined);f.tasks.confirmStop(stopped.operationKey,true);
  assert.equal(receipt(f,sent.messageId).state,'rejected');
  const resumed=f.tasks.workerSend(main,{operationId:'next',workerId:worker.workerId,text:'New turn'}),next=running(f,resumed.runId!);
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
