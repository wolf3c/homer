// The old child-disposition cases now protect all conversations of one Task.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,main,authority,openWorker,running,mutation} from './recursive-fixture.js';

test('withdrawing requirements freezes every old conversation and queued message in one transaction',()=>{
 const f=fixture();try{
  const a=openWorker(f,'a'),b=openWorker(f,'b'),aa=running(f,a.runId),bb=running(f,b.runId);
  const old=f.tasks.workerSend(main,{operationId:'old-queued',workerId:b.workerId,text:'Old authorized write'});
  const actor=f.source('withdrawal','Withdraw the write permission; read only');
  const input={...mutation(f,'requirements'),patch:{goal:'Read only'},authority:authority(actor.sourceRequestId)};
  const changed=f.tasks.updateTask(actor,input);assert.deepEqual(new Set(changed.targets),new Set([a.runId,b.runId]));
  assert.equal(f.tasks.task(f.task.taskId).controlState,'stopping');assert.equal(f.tasks.claim(),undefined);
  assert.equal(f.store.db.prepare('SELECT state FROM agent_receipts WHERE messageId=?').get(old.messageId)!.state,'rejected');
  for(const prior of [aa,bb]){assert.throws(()=>f.tasks.guard(prior),/epoch|stop|version|live/);assert.equal(f.tasks.run(prior.runId!).version,1);}
  assert.throws(()=>f.tasks.workerSend(actor,{operationId:'too-soon',workerId:a.workerId,text:'New request'}),/stop_requested/);
  assert.throws(()=>f.tasks.confirmStop(changed.operationKey,true),/run_stop_unconfirmed/);
  for(const runId of changed.targets)f.tasks.confirmWorkerExit(runId,undefined);
  f.tasks.confirmStop(changed.operationKey,true);assert.equal(f.tasks.task(f.task.taskId).headVersion,2);
  const next=f.tasks.workerSend(actor,{operationId:'new',workerId:a.workerId,text:'Inspect only'});assert.ok(next.runId);
  const run=f.tasks.run(next.runId!);assert.equal(run.version,2);assert.equal(run.sourceRequestId,'withdrawal');assert.equal(run.goal,'Read only');
  assert.equal(f.tasks.claim(next.runId!)!.id,next.runId);assert.equal(f.tasks.claim(),undefined);
 }finally{f.close();}
});

test('failure while stopping the second conversation rolls back version, first stop intent and pending receipts',()=>{
 const f=fixture();try{
  const a=openWorker(f,'a'),b=openWorker(f,'b');running(f,a.runId);running(f,b.runId);
  f.tasks.workerSend(main,{operationId:'queued',workerId:a.workerId,text:'Old queued action'});const source=f.source('withdrawal','Withdraw old permissions');
  const before={task:f.tasks.task(f.task.taskId),runs:f.tasks.runs(),messages:f.store.db.prepare('SELECT * FROM agent_receipts ORDER BY rowid').all()},ops=f.store.db.prepare('SELECT count(*) n FROM operations').get()!.n;
  f.store.db.exec("CREATE TEMP TRIGGER reject_second_stop BEFORE UPDATE OF stopRequestedAt ON runs WHEN OLD.id=(SELECT id FROM runs ORDER BY rowid DESC LIMIT 1) BEGIN SELECT RAISE(ABORT,'synthetic_stop_write_failure'); END");
  assert.throws(()=>f.tasks.updateTask(source,{...mutation(f,'change'),patch:{goal:'Read only'},authority:authority(source.sourceRequestId)}),/synthetic_stop_write_failure/);
  assert.deepEqual(f.tasks.task(f.task.taskId),before.task);assert.deepEqual(f.tasks.runs(),before.runs);assert.deepEqual(f.store.db.prepare('SELECT * FROM agent_receipts ORDER BY rowid').all(),before.messages);
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM operations').get()!.n,ops);assert.throws(()=>f.tasks.version(f.task.taskId,2),/version_not_found/);
 }finally{f.close();}
});
