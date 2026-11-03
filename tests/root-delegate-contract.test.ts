import test from 'node:test';
import assert from 'node:assert/strict';
import {RecursiveTools} from '../src/recursive-tools.js';
import {TaskCreationRejected} from '../src/recursive-tasks.js';
import {fixture,main,contract,running,complete,accept} from './recursive-fixture.js';
import {ConversationHistory} from '../src/web-history.js';
import {MainInputs} from '../src/recursive-main-inputs.js';

test('root delegation rejects fresh dependencies and null title without creating work',async()=>{
 const f=fixture();let wakes=0;
 try{
  const tools=new RecursiveTools(f.tasks,{rootAuthority:()=>f.tasks.authority(f.root.taskId,1),wake:()=>{wakes++;},stop:async()=>{},update:async()=>{}});
  const input={operationId:'new-root',parentTaskId:null,parentVersion:null,expectedTaskRevision:null,title:'Synthetic root',executorKind:'worker',contract:contract(),dependencies:[{taskId:f.root.taskId,version:1,required:true}]};
  await assert.rejects(tools.call(main,'task_delegate',input),error=>error instanceof TaskCreationRejected&&error.message==='task_root_dependencies_not_supported');
  await assert.rejects(tools.call(main,'task_delegate',{...input,title:null,dependencies:[]}),error=>error instanceof TaskCreationRejected&&error.message==='task_root_title_required');
  assert.equal(wakes,0);assert.equal(f.store.runs().length,0);
  const created=await tools.call(main,'task_delegate',{...input,dependencies:[]}) as {taskId:string};
  assert.ok(created.taskId);assert.equal(wakes,1);
 }finally{f.close();}
});

test('root dependency denial preserves canonical historical receipts',async()=>{
 const f=fixture();
 try{
  const input={operationId:'historical-root',title:'Historical root',contract:contract(),authority:f.tasks.authority(f.root.taskId,1),executorKind:'worker' as const};
  const original=f.tasks.createRoot(main,input);
  const tools=new RecursiveTools(f.tasks,{rootAuthority:()=>input.authority,wake:()=>{},stop:async()=>{},update:async()=>{}});
  const {authority:_authority,...payload}=input;
  const replay=await tools.call(main,'task_delegate',{...payload,parentTaskId:null,parentVersion:null,expectedTaskRevision:null,dependencies:[{taskId:f.root.taskId,version:1,required:true}]});
  assert.deepEqual(replay,original);assert.equal(f.store.runs().length,1);
 }finally{f.close();}
});

test('child title remains nullable and dependencies still constrain acceptance',async()=>{
 const f=fixture();
 try{
  const tools=new RecursiveTools(f.tasks,{rootAuthority:()=>f.tasks.authority(f.root.taskId,1),wake:()=>{},stop:async()=>{},update:async()=>{}});
  const child=await tools.call(main,'task_delegate',{operationId:'dependent-child',parentTaskId:f.root.taskId,parentVersion:1,expectedTaskRevision:f.tasks.task(f.root.taskId).revision,title:null,executorKind:'worker',contract:contract(),dependencies:[{taskId:f.root.taskId,version:1,required:true}]}) as {taskId:string};
  const actor=running(f,child.taskId),result=complete(f,actor,child.taskId);
  assert.throws(()=>accept(f,child.taskId,result.resultId),/dependency_unsatisfied/);
 }finally{f.close();}
});

test('pending root rejects dependencies atomically and recovers old receipts before stale selection checks',()=>{
 const f=fixture();
 try{
  f.store.setMeta('mainThread','pending-thread');
  const history=new ConversationHistory(f.store.db),inputs=new MainInputs(f.tasks,history);
  inputs.accept({requestId:'pending-source',text:'Synthetic authorized task'});
  const queued=inputs.claim()!;inputs.started(queued.messageId,queued.revision,'generation','turn');inputs.finish(queued.messageId,queued.revision,'completed');
  const actor={agentId:main.agentId,threadId:'pending-thread',sourceRequestId:'pending-source'};
  const item=f.tasks.pending.add(actor,{operationId:'remember',content:'Synthetic pending item'});
  const selection={items:[{id:item.id,expectedRevision:1}],sourceRequestIds:['pending-source'],primarySourceRequestId:'pending-source'};
  const input={operationId:'pending-root',title:'Synthetic pending root',contract:contract(),executorKind:'worker' as const};
  let resolved=0;const authority=()=>{resolved++;return {...f.tasks.authority(f.root.taskId,1),sourceRequestId:'pending-source'};};
  const dependencies=[{taskId:f.root.taskId,version:1,required:true}];
  assert.throws(()=>f.tasks.createPendingRoot(actor,{...input,dependencies},selection,authority),/task_root_dependencies_not_supported/);
  assert.equal(resolved,0);assert.equal(f.store.runs().length,0);
  assert.equal(f.tasks.pending.list(actor,{id:item.id}).items[0]!.revision,1);
  const original=f.tasks.createPendingRoot(actor,input,selection,authority);
  assert.deepEqual(f.tasks.createPendingRoot(actor,{...input,dependencies},selection,()=>{throw Error('must not reauthorize');}),original);
  assert.equal(resolved,1);assert.equal(f.store.runs().length,1);
  assert.throws(()=>f.tasks.createPendingRoot(actor,{...input,title:'Changed',dependencies:[]},selection,authority),/operation_payload_conflict/);
 }finally{f.close();}
});
