import test from 'node:test';
import assert from 'node:assert/strict';
import {RecursiveTools} from '../src/recursive-tools.js';
import {chatFixture} from './task-chat-fixture.js';

test('recording a titled goal starts no Worker and rejects retired contract/dependency arguments atomically',async()=>{
 const f=chatFixture();try{
  let wakes=0;const tools=new RecursiveTools(f.tasks,{rootAuthority:()=>f.authority,wake:()=>{wakes++;},stop:async()=>{},steer:async()=>{}});
  const args={goal:'Inspect one source',title:'Source inspection'};
  for(const extra of [{contract:{goal:'Old contract'}},{dependencies:[]},{parentTaskId:null},{title:null},{pendingIds:[]},{resultIds:[]}])await assert.rejects(tools.call(f.actor,'task_create',{...args,...extra},'invalid'),/invalid_tool_arguments/);
  assert.equal(f.tasks.tasks().length,0);assert.equal(f.store.runs().length,0);assert.equal(wakes,0);
  const created=await tools.call(f.actor,'task_create',args,'create') as {taskId:string};assert.ok(created.taskId);assert.equal(f.store.runs().length,0);assert.equal(wakes,1);
  assert.deepEqual(await tools.call(f.actor,'task_create',args,'create'),created);assert.equal(f.tasks.tasks().length,1);
  await assert.rejects(tools.call(f.actor,'task_delegate',args,'old'),/tool_denied/);
 }finally{f.close();}
});

test('task creation cannot borrow an unrelated historical user source',()=>{
 const f=chatFixture();try{
  f.source('other','A separate user source');
  assert.throws(()=>f.tasks.createTask(f.actor,{operationId:'invalid',goal:'Inspect',authority:{...f.authority,sourceRequestId:'other'}}),/source_denied/);
  assert.equal(f.tasks.tasks().length,0);assert.equal(f.store.runs().length,0);
 }finally{f.close();}
});

test('a real user source can record a task without authorizing execution',()=>{
 const f=chatFixture();try{
  const input={operationId:'record',goal:'Inspect later',notes:'Await the decision to start'};
  const created=f.tasks.createTask(f.actor,input);
  assert.equal(f.tasks.version(created.taskId,1).sourceRequestId,'source:test');
  assert.equal(f.tasks.version(created.taskId,1).authorityJson,null);
  assert.throws(()=>f.tasks.workerOpen(f.actor,{operationId:'open-record',taskId:created.taskId,text:'Start without new authorization'}),/task_authority_source_denied/);
  assert.deepEqual(f.tasks.createTask(f.actor,input),created);assert.equal(f.tasks.tasks().length,1);assert.equal(f.store.runs().length,0);
  assert.throws(()=>f.tasks.createTask(f.actor,{...input,goal:'Different goal'}),/payload_conflict/);
 }finally{f.close();}
});


test('first dispatch binds the later user instruction atomically and preserves registration',()=>{
 const f=chatFixture();try{
  const created=f.tasks.createTask(f.actor,{operationId:'record',goal:'Read build files',title:'Build review'});
  const original=f.tasks.version(created.taskId,1);
  const next=f.source('source:start','Start this review'),actor={...f.actor,inputMessageId:next.messageId,sourceRequestId:'source:start'};
  const args={operationId:'dispatch',taskId:created.taskId,authority:{sourceRequestId:'source:start',description:'Read only'}};
  assert.throws(()=>f.tasks.workerOpen(actor,args,()=>{throw Error('attachment failure');}),/attachment failure/);
  assert.deepEqual(f.tasks.version(created.taskId,1),original);
  assert.equal(f.tasks.runs().length,0);
  const opened=f.tasks.workerOpen(actor,args);
  assert.deepEqual(f.tasks.workerOpen(actor,args),opened);
  assert.deepEqual({...f.tasks.version(created.taskId,1)},{...original,authorityJson:JSON.stringify(args.authority)});
  assert.equal(f.tasks.run(opened.runId).prompt,original.goal);
  assert.equal(f.tasks.run(opened.runId).sourceRequestId,'source:start');
  const second=f.tasks.workerOpen(actor,{operationId:'second',taskId:created.taskId,text:'Inspect tests'},undefined,()=>{throw Error('must reuse bound authority');});
  assert.equal(f.tasks.run(second.runId).prompt,'Inspect tests');
  assert.deepEqual(f.tasks.authority(created.taskId,1),args.authority);
  assert.equal(f.tasks.captureActivity(actor,'worker_open',args,opened),undefined);
  assert.throws(()=>f.tasks.workerOpen(actor,{...args,operationId:'blank',text:'  '}),/task_invalid_input/);
 }finally{f.close();}
});

test('stale, revoked and unrelated background sources cannot commission a recorded task',()=>{
 const f=chatFixture();try{
  const next=f.source('source:later'),actor={...f.actor,sourceRequestId:'source:later',inputMessageId:next.messageId};
  const task=f.tasks.createTask(actor,{operationId:'record',goal:'Read build files'});
  const args={operationId:'dispatch',taskId:task.taskId,authority:f.authority};
  assert.throws(()=>f.tasks.workerOpen(f.actor,args),/source_denied/);
  assert.throws(()=>f.tasks.workerOpen({...actor,sourceRequestId:undefined},args),/source_denied/);
  const later=f.source('source:again');
  const message=f.store.db.prepare("SELECT id FROM conversation_messages WHERE role='user' AND requestId=?").get('source:later')!;
  f.history.revokeMessage(f.actor.threadId!,String(message.id));
  assert.throws(()=>f.tasks.workerOpen(actor,{...args,authority:{...f.authority,sourceRequestId:'source:later'}}),/source_denied/);
  assert.throws(()=>f.tasks.workerOpen({...actor,sourceRequestId:'source:again',inputMessageId:later.messageId},{...args,authority:{...f.authority,sourceRequestId:'source:again'}}),/source_denied/);
  assert.equal(f.tasks.runs().length,0);
  assert.equal(f.tasks.version(task.taskId,1).authorityJson,null);
 }finally{f.close();}
});

test('a Worker reply can dispatch its own follow-up record and preserves user routing',()=>{
 const f=chatFixture();try{
  const root=f.create(),other=f.tasks.createTask(f.actor,{operationId:'other',goal:'Unrelated note'});
  const opened=f.tasks.workerOpen(f.actor,{operationId:'open',taskId:root.taskId}),run=f.start(opened.workerId);
  f.tasks.endSegment(run.id,run.epoch,{status:'completed',text:'Ready for review'},true);
  const event=f.inputs.claim([],'all')!;
  const actor={...f.actor,sourceRequestId:undefined,inputMessageId:event.messageId};
  const follow=f.tasks.createTask(actor,{operationId:'follow',goal:'Review findings'});
  const args={taskId:follow.taskId,operationId:'dispatch',authority:f.authority};
  assert.throws(()=>f.tasks.workerOpen(actor,{...args,taskId:other.taskId}),/source_denied/);
  const worker=f.tasks.workerOpen(actor,args);
  assert.equal(f.tasks.version(follow.taskId,1).sourceRequestId,f.authority.sourceRequestId);
  assert.equal(f.tasks.run(worker.runId).prompt,'Review findings');
 }finally{f.close();}
});
