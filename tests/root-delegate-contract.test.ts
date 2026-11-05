import test from 'node:test';
import assert from 'node:assert/strict';
import {RecursiveTools} from '../src/recursive-tools.js';
import {chatFixture} from './task-chat-fixture.js';

test('goal-only creation starts no Worker and rejects retired contract/dependency arguments atomically',async()=>{
 const f=chatFixture();try{
  let wakes=0;const tools=new RecursiveTools(f.tasks,{rootAuthority:()=>f.authority,wake:()=>{wakes++;},stop:async()=>{},steer:async()=>{}});
  const args={goal:'Inspect one source'};
  for(const extra of [{contract:{goal:'Old contract'}},{dependencies:[]},{parentTaskId:null},{title:null}])await assert.rejects(tools.call(f.actor,'task_create',{...args,...extra},'invalid'),/invalid_tool_arguments/);
  assert.equal(f.tasks.tasks().length,0);assert.equal(f.store.runs().length,0);assert.equal(wakes,0);
  const created=await tools.call(f.actor,'task_create',args,'create') as {taskId:string};assert.ok(created.taskId);assert.equal(f.store.runs().length,0);assert.equal(wakes,1);
  assert.deepEqual(await tools.call(f.actor,'task_create',args,'create'),created);assert.equal(f.tasks.tasks().length,1);
  await assert.rejects(tools.call(f.actor,'task_delegate',args,'old'),/tool_denied/);
 }finally{f.close();}
});

test('task creation cannot borrow unrelated authorization or accepted-result references',()=>{
 const f=chatFixture();try{
  f.source('other','A separate user source');
  for(const authority of [{...f.authority,sourceRequestId:'other'},{...f.authority,resultIds:['result-missing']}])assert.throws(()=>f.tasks.createTask(f.actor,{operationId:'invalid-'+authority.sourceRequestId,goal:'Inspect',authority}),/source_denied|result_not_found/);
  assert.equal(f.tasks.tasks().length,0);assert.equal(f.store.runs().length,0);
 }finally{f.close();}
});

test('a real user source creates no execution; explicit Pending links retain CAS and original receipts',()=>{
 const f=chatFixture();try{
  const item=f.tasks.pending.add(f.actor,{operationId:'remember',content:'Inspect synthetic source'}),input={operationId:'pending-task',goal:'Inspect selected real user source',authority:f.authority};
  assert.throws(()=>f.tasks.createTask({...f.actor,sourceRequestId:undefined},input),/source_denied/);
  assert.equal(f.tasks.tasks().length,0);assert.equal(f.tasks.pending.list(f.actor,{id:item.id}).items[0]!.revision,1);
  const created=f.tasks.createTask(f.actor,input);assert.equal(f.store.runs().length,0);assert.equal(f.tasks.pending.list(f.actor,{id:item.id}).items[0]!.linkedTaskId,null);
  const link={operationId:'link',id:item.id,expectedRevision:1,patch:{linkedTaskId:created.taskId}};
  assert.throws(()=>f.tasks.pending.update(f.actor,{...link,expectedRevision:2}),/revision_conflict/);assert.equal(f.tasks.pending.list(f.actor,{id:item.id}).items[0]!.revision,1);
  const linked=f.tasks.pending.update(f.actor,link);assert.equal(linked.linkedTaskId,created.taskId);assert.deepEqual(f.tasks.pending.update(f.actor,link),linked);assert.equal(f.store.runs().length,0);
  assert.deepEqual(f.tasks.createTask(f.actor,input),created);assert.equal(f.tasks.tasks().length,1);assert.throws(()=>f.tasks.createTask(f.actor,{...input,goal:'Different goal'}),/payload_conflict/);
 }finally{f.close();}
});
