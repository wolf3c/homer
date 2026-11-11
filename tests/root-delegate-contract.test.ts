import test from 'node:test';
import assert from 'node:assert/strict';
import {RecursiveTools} from '../src/recursive-tools.js';
import {chatFixture} from './task-chat-fixture.js';

test('goal-only creation starts no Worker and rejects retired contract/dependency arguments atomically',async()=>{
 const f=chatFixture();try{
  let wakes=0;const tools=new RecursiveTools(f.tasks,{rootAuthority:()=>f.authority,wake:()=>{wakes++;},stop:async()=>{},steer:async()=>{}});
  const args={goal:'Inspect one source'};
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


test('worker_open names new work without altering its goal or input',async()=>{
 const f=chatFixture();try{
  const tools=new RecursiveTools(f.tasks,{rootAuthority:()=>f.authority,wake(){},stop:async()=>{},steer:async()=>{}});
  const message='用户要求优化工作状态标题。'+'详细要求🙂'.repeat(30);
  const a=await tools.call(f.actor,'worker_open',{message,title:'优化事项标题'},'named') as {taskId:string;workerId:string};
  assert.equal(f.tasks.task(a.taskId).title,'优化事项标题');assert.equal(f.tasks.version(a.taskId,1).goal,message);
  assert.equal(f.tasks.run(a.workerId).prompt,message);
  const b=await tools.call(f.actor,'worker_open',{message:'🙂'.repeat(60)+'。详情'},'fallback') as {taskId:string};
  const title=f.tasks.task(b.taskId).title;assert.ok([...title].length<=49);assert.ok(!title.includes('�'));assert.equal(f.tasks.version(b.taskId,1).goal,'🙂'.repeat(60)+'。详情');
  await assert.rejects(tools.call(f.actor,'worker_open',{taskId:a.taskId,message:'继续',title:'误导性的名称'},'existing'),/invalid_tool_arguments/);
 }finally{f.close();}
});
