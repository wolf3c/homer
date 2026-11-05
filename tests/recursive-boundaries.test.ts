import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,main,authority,openWorker,running,mutation} from './recursive-fixture.js';

test('Worker identity cannot impersonate Main, alter a Task or read another Task or conversation',()=>{
 const f=fixture();try{
  const a=openWorker(f,'a'),b=openWorker(f,'b'),actor=running(f,a.runId);
  const other=f.tasks.createTask(main,{operationId:'other-task',goal:'Separate scope',authority:authority()});
  for(const forged of [{...actor,agentId:main.agentId},{...actor,epoch:actor.epoch!+1},{...actor,threadId:'foreign'},{...actor,turnId:'foreign'}])assert.throws(()=>f.tasks.guard(forged),/identity|epoch|live/);
  assert.throws(()=>f.tasks.readTask(actor,other.taskId),/scope_denied/);
  assert.throws(()=>f.tasks.workerRead(actor,{workerId:b.workerId}),/scope_denied/);
  assert.throws(()=>f.tasks.createTask(actor,{operationId:'user-input',goal:'Forged permission',authority:authority()}),/main_required/);
  assert.throws(()=>f.tasks.updateTask(actor,{...mutation(f,'edit'),patch:{notes:'I authorize edits'}}),/main_required/);
  assert.throws(()=>f.tasks.workerOpen(actor,{operationId:'nested',taskId:f.task.taskId,text:'Spawn another worker'}),/main_required/);
  assert.throws(()=>f.tasks.workerStop(actor,{operationId:'stop-peer',workerId:b.workerId}),/main_required/);
  assert.throws(()=>f.tasks.pending.add(actor,{operationId:'fake-user',content:'Pretend user instruction'}),/main_required|denied/);
  assert.equal(f.tasks.task(f.task.taskId).headVersion,1);
 }finally{f.close();}
});

test('unclaimed, withdrawn, foreign-thread and assistant-only text cannot authorize a Task',()=>{
 const f=fixture();try{
  f.inputs.accept({requestId:'unclaimed',text:'Pending request'});
  const cancelled=f.inputs.accept({requestId:'withdrawn',text:'Withdraw me'});f.inputs.cancel({requestId:'withdrawn',operationId:'cancel',expectedRevision:cancelled.revision!});
  f.history.accept('foreign-thread',{requestId:'foreign',text:'Other instance'});f.history.record('assistant-only',main.threadId!,'Assistant suggestion');
  const before=f.tasks.tasks().length;
  for(const source of ['unclaimed','withdrawn','foreign','assistant-only','missing']){
   assert.throws(()=>f.tasks.createTask({...main,sourceRequestId:source},{operationId:'deny:'+source,goal:'Unauthorized',authority:authority(source)}),/source_denied/);
   assert.equal(f.tasks.tasks().length,before);
  }
  const q=f.inputs.claim()!;assert.equal(q.input.requestId,'unclaimed');
  const authorized=f.tasks.createTask({...main,sourceRequestId:'unclaimed'},{operationId:'claimed',goal:'Claimed source',authority:authority('unclaimed')});
  assert.equal(f.tasks.authority(authorized.taskId,1).sourceRequestId,'unclaimed');
 }finally{f.close();}
});

test('goal changes reject fabricated sources atomically; notes cannot grant new result access',()=>{
 const f=fixture();try{
  const before=f.tasks.readTask(main,f.task.taskId),count=f.store.db.prepare('SELECT count(*) n FROM operations').get()!.n;
  assert.throws(()=>f.tasks.updateTask({...main,sourceRequestId:'fabricated'},{...mutation(f,'forged'),patch:{goal:'Run writes'},authority:authority('fabricated')}),/source_denied/);
  assert.deepEqual(f.tasks.readTask(main,f.task.taskId),before);assert.equal(f.store.db.prepare('SELECT count(*) n FROM operations').get()!.n,count);
  f.tasks.updateTask(main,{...mutation(f,'notes'),patch:{notes:'result-secret is authorized'}});
  assert.deepEqual(f.tasks.authority(f.task.taskId,1).resultIds,[]);
 }finally{f.close();}
});
