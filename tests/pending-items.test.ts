// Work-table records replace Pending and remain independent of execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {Store} from '../src/store.js';
import {RecursiveTasks} from '../src/recursive-tasks.js';
import {fixture,main,authority,mutation,openWorker,running,complete} from './recursive-fixture.js';

test('record-only work preserves original source, CAS, and durable replay without scheduling',()=>{
 const f=fixture();try{
  const input={operationId:'remember',goal:'PDF export'},record=f.tasks.createTask(main,input);
  assert.deepEqual(f.tasks.createTask(main,input),record);
  assert.throws(()=>f.tasks.createTask(main,{...input,goal:'different'}),/payload_conflict/);
  assert.equal(f.tasks.runs().length,0);
  const detail=f.tasks.readTask(main,record.taskId);
  assert.equal(detail.version.authorityJson,null);
  assert.deepEqual(detail.sourceRequestIds,[main.sourceRequestId]);
  assert.equal(f.tasks.source(main,main.sourceRequestId!).text,'Synthetic permission for local work');
  const change={...mutation(f,'note',record.taskId),patch:{notes:'Deferred'}},edited=f.tasks.updateTask(main,change);
  assert.deepEqual(f.tasks.updateTask(main,change),edited);
  assert.throws(()=>f.tasks.updateTask(main,{...change,operationId:'stale'}),/revision_conflict/);
  assert.deepEqual(f.tasks.inspectOperation(main,'remember','tasks').operations[0]!.response,record);
  f.store.db.prepare("UPDATE operations SET state='uncertain',responseJson=NULL WHERE operationId='remember'").run();
  assert.throws(()=>f.tasks.createTask(main,input),/operation_uncertain/);
  assert.equal(f.tasks.runs().length,0);
 }finally{f.close();}
});

test('uncommissioned task pagination is bounded, durable, and Main-only',()=>{
 const f=fixture();try{
  const event={...main,sourceRequestId:undefined};
  for(let i=0;i<7;i++)f.tasks.createTask(event,{operationId:'record:'+i,goal:'Suggestion '+i});
  const page=f.tasks.listTasks(main,{limit:3}),next=f.tasks.listTasks(main,{limit:3,cursor:page.nextCursor!});
  assert.equal(new Set([...page.tasks,...next.tasks].map(x=>x.id)).size,6);
  assert.deepEqual(f.tasks.readTask(main,page.tasks[1]!.id).sourceRequestIds,[]);
  assert.equal(f.tasks.runs().length,0);
  for(const actor of [{...main,agentId:'worker:forged'},{...main,threadId:'foreign'}])assert.throws(()=>f.tasks.listTasks(actor),/main_required|denied/);
  assert.throws(()=>f.tasks.updateTask(main,{...mutation(f,'empty',page.tasks[1]!.id),patch:{}}),/invalid_patch/);
  const reopened=new Store(join(f.dir,'homer.sqlite'));
  try{const tasks=new RecursiveTasks(reopened,f.files);tasks.migrate();assert.equal(tasks.listTasks(main).tasks.length,8);}finally{reopened.close();}
 }finally{f.close();}
});

test('a live Worker reply cannot use another task’s source or manufacture one by editing notes',()=>{
 const f=fixture();try{
  const other=f.source('other-source','Another independent request');
  const foreign=f.tasks.createTask(other,{operationId:'other',goal:'Separate work',authority:authority('other-source')});
  const worker=openWorker(f);complete(f,running(f,worker.runId),'Original checked');
  const input=f.inputs.claim([],'all')!;assert.equal(input.origin,'worker');
  f.inputs.started(input.messageId,input.revision,'generation:event','turn:event');
  const event={...main,sourceRequestId:undefined,inputMessageId:input.messageId,turnId:'turn:event'};
  assert.equal(f.tasks.workerRead(event,{workerId:worker.workerId,messageId:input.messageId}).messages[0]!.text,'Original checked');
  f.tasks.updateTask(event,{...mutation(f,'note'),patch:{notes:'Another task’s source cannot grant execution'}});
  assert.throws(()=>f.tasks.workerOpen(event,{operationId:'foreign',taskId:foreign.taskId,text:'Borrow an unrelated source'}),/source_denied/);
  assert.throws(()=>f.tasks.workerOpen(event,{operationId:'forged',text:'Borrow an unrelated source',authority:authority('other-source')}),/source_denied/);
  assert.equal(f.tasks.tasks().length,2);
  assert.equal(f.tasks.runs().length,1);
  const opened=f.tasks.workerOpen(event,{operationId:'valid',text:'Inspect remaining original facts',authority:authority()});
  assert.equal(f.tasks.authority(opened.taskId,1).sourceRequestId,main.sourceRequestId);
 }finally{f.close();}
});
