import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,main,openWorker,running,mutation} from './recursive-fixture.js';

test('a goal edit preserves the exact version and original authority of both running Workers',()=>{
 const f=fixture();try{
  const a=openWorker(f,'a'),b=openWorker(f,'b'),aa=running(f,a.runId),bb=running(f,b.runId);
  const before=f.tasks.runs();
  const actor=f.source('revised','Use the revised goal for future work');
  f.tasks.updateTask(actor,{...mutation(f,'requirements'),patch:{goal:'Read only'}});
  assert.equal(f.tasks.task(f.task.taskId).headVersion,2);
  assert.deepEqual(f.tasks.runs(),before);
  for(const prior of [aa,bb])assert.equal(f.tasks.guard(prior).id,f.task.taskId);
  const steer=f.tasks.workerMessage(actor,{operationId:'clarify',workerId:b.workerId,text:'Clarify the original finding'});
  assert.equal(steer.route,'steer');assert.equal(steer.version,1);assert.equal(steer.runId,b.runId);assert.equal(steer.expectedTurnId,bb.turnId);
  f.tasks.markSteer(steer.operationKey,'dispatching');f.tasks.markSteer(steer.operationKey,'received');
  f.tasks.endSegment(a.runId,aa.epoch!,{status:'completed',text:'Findings under original grant'},true);
  const reply=f.tasks.workerRead(main,{workerId:a.workerId}).messages.at(-1)!;
  assert.equal(reply.text,'Findings under original grant');assert.equal(reply.taskVersion,1);
  assert.equal(f.tasks.claim(),undefined);
  const next=f.tasks.workerMessage(actor,{operationId:'new',workerId:a.workerId,text:'Inspect only'});
  const run=f.tasks.run(next.runId!);assert.equal(run.version,2);assert.equal(run.goal,'Read only');assert.equal(run.sourceRequestId,'revised');
  assert.equal(run.threadId,aa.threadId);assert.equal(f.tasks.guard(bb).id,f.task.taskId);
 }finally{f.close();}
});

test('a failed goal edit rolls back its new version and leaves Worker receipts and stop state intact',()=>{
 const f=fixture();try{
  const worker=openWorker(f),actor=running(f,worker.runId),source=f.source('edit','Revised goal');
  const before=f.tasks.task(f.task.taskId),runs=f.tasks.runs(),receipts=f.store.db.prepare('SELECT * FROM agent_receipts ORDER BY rowid').all();
  f.store.db.exec("CREATE TEMP TRIGGER reject_goal BEFORE UPDATE OF headVersion ON tasks BEGIN SELECT RAISE(ABORT,'synthetic_goal_write_failure'); END");
  assert.throws(()=>f.tasks.updateTask(source,{...mutation(f,'failed-edit'),patch:{goal:'Revised goal'}}),/synthetic_goal_write_failure/);
  assert.deepEqual(f.tasks.task(f.task.taskId),before);assert.throws(()=>f.tasks.version(f.task.taskId,2),/version_not_found/);
  assert.equal(f.store.db.prepare("SELECT 1 FROM operations WHERE operationId='failed-edit'").get(),undefined);
  assert.deepEqual(f.tasks.runs(),runs);assert.deepEqual(f.store.db.prepare('SELECT * FROM agent_receipts ORDER BY rowid').all(),receipts);
  assert.equal(f.tasks.guard(actor).id,f.task.taskId);
 }finally{f.close();}
});

test('editing a recorded goal preserves its uncommissioned state until a user dispatches the revised task',()=>{
 const f=fixture();try{
  const record=f.tasks.createTask(main,{operationId:'record-only',goal:'Consider an investigation'});
  const editor=f.source('edit-only','Revise the note, do not start');
  f.tasks.updateTask(editor,{...mutation(f,'edit',record.taskId),patch:{goal:'Inspect a specific report'}});
  assert.equal(f.tasks.version(record.taskId,2).authorityJson,null);assert.equal(f.tasks.runs(record.taskId).length,0);

  const user=f.source('dispatch','Now inspect the report');
  const worker=f.tasks.workerOpen(user,{operationId:'dispatch',taskId:record.taskId});
  const run=f.tasks.claim(worker.runId)!;assert.equal(run.version,2);assert.equal(run.sourceRequestId,'dispatch');assert.equal(run.prompt,'Inspect a specific report');
 }finally{f.close();}
});

test('a Worker checks live execution identity independently of a historical user receipt',()=>{
 const f=fixture();try{
  const actor=running(f,openWorker(f).runId);
  f.store.db.prepare("UPDATE operations SET responseJson=json_set(responseJson,'$.messageId','unrelated-input') WHERE kind='user_accept' AND scopeId=?").run(main.sourceRequestId!);
  assert.equal(f.tasks.guard(actor).id,f.task.taskId);
  assert.throws(()=>f.tasks.guard({...actor,turnId:'other-turn'}),/run_not_live/);
 }finally{f.close();}
});
