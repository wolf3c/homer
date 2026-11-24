import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,main,openWorker,running,mutation} from './recursive-fixture.js';

test('Worker identity cannot impersonate Main, alter a Task or read another Task or conversation',()=>{
 const f=fixture();try{
  const a=openWorker(f,'a'),b=openWorker(f,'b'),actor=running(f,a.runId);
  const other=f.tasks.createTask(main,{operationId:'other-task',goal:'Separate scope'});
  for(const forged of [{...actor,agentId:main.agentId},{...actor,epoch:actor.epoch!+1},{...actor,threadId:'foreign'},{...actor,turnId:'foreign'}])assert.throws(()=>f.tasks.guard(forged),/identity|epoch|live/);
  assert.throws(()=>f.tasks.readTask(actor,other.taskId),/scope_denied/);
  assert.throws(()=>f.tasks.workerRead(actor,{workerId:b.workerId}),/scope_denied/);
  assert.throws(()=>f.tasks.createTask(actor,{operationId:'user-input',goal:'Forged permission'}),/main_required/);
  assert.throws(()=>f.tasks.updateTask(actor,{...mutation(f,'edit'),patch:{notes:'I authorize edits'}}),/main_required/);
  assert.throws(()=>f.tasks.workerOpen(actor,{operationId:'nested',taskId:f.task.taskId,text:'Spawn another worker'}),/main_required/);
  assert.throws(()=>f.tasks.workerStop(actor,{operationId:'stop-peer',workerId:b.workerId}),/main_required/);
  assert.throws(()=>f.tasks.source(actor,main.sourceRequestId!),/main_required|denied/);
  assert.equal(f.tasks.task(f.task.taskId).headVersion,1);
 }finally{f.close();}
});

test('unclaimed, withdrawn, foreign-thread and assistant-only text cannot be read as user source',()=>{
 const f=fixture();try{
  f.inputs.accept({requestId:'unclaimed',text:'Pending request'});
  const cancelled=f.inputs.accept({requestId:'withdrawn',text:'Withdraw me'});f.inputs.cancel({requestId:'withdrawn',operationId:'cancel',expectedRevision:cancelled.revision!});
  f.history.accept('foreign-thread',{requestId:'foreign',text:'Other instance'});f.history.record('assistant-only',main.threadId!,'Assistant suggestion');
  for(const source of ['unclaimed','withdrawn','foreign','assistant-only','missing'])assert.throws(()=>f.tasks.source(main,source),/source_denied/);
  const q=f.inputs.claim()!;assert.equal(q.input.requestId,'unclaimed');
  assert.equal(f.tasks.source(main,'unclaimed').text,'Pending request');
 }finally{f.close();}
});

test('notes preserve the original requirements and do not create provenance',()=>{
 const f=fixture();try{
  const original=f.tasks.version(f.task.taskId,1);
  f.tasks.updateTask(main,{...mutation(f,'notes'),patch:{notes:'An unrelated source is authorized'}});
  assert.deepEqual(f.tasks.version(f.task.taskId,1),original);
  assert.equal(f.tasks.version(f.task.taskId,1).authorityJson,null);
 }finally{f.close();}
});
