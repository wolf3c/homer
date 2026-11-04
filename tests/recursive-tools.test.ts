// Synthetic public tool boundary tests; effects never call an engine or channel.
import test from 'node:test';
import assert from 'node:assert/strict';
import { RecursiveTools, RECURSIVE_TOOLS, validateToolArguments } from '../src/recursive-tools.js';
import { recursiveHash } from '../src/recursive-tasks.js';
import { fixture, main, contract, delegate, running, complete } from './recursive-fixture.js';
test('HMR-RECURSIVE-005: runtime tool validation rejects forged identity, malformed collections and invalid control modes before effects', async () => {
  const f = fixture();
  try {
    let effects = 0;
    const tools = new RecursiveTools(f.tasks, { rootAuthority: () => { effects++; return f.tasks.authority(f.root.taskId, 1); }, wake: () => { effects++; }, stop: async () => { effects++; }, update: async () => { effects++; } });
    const base = { operationId: 'child', parentTaskId: f.root.taskId, parentVersion: 1, expectedTaskRevision: f.tasks.task(f.root.taskId).revision, title: null, executorKind: 'worker', contract: contract(), dependencies: [] };
    await assert.rejects(() => tools.call(main, 'task_delegate', { ...base, agentId: 'host' }), /invalid_tool_arguments/);
    await assert.rejects(() => tools.call(main, 'task_delegate', { ...base, dependencies: { taskId: 'invalid' } }), /invalid_tool_arguments/);
    await assert.rejects(() => tools.call(main, 'task_delegate', { ...base, contract: { ...contract(), inputs: [{ type: 'material', id: 'sample.md', authority: 'spoof' }] } }), /invalid_tool_arguments/);
    await assert.rejects(() => tools.call(main, 'task_stop', { operationId: 'stop', taskId: f.root.taskId, version: 1, expectedTaskRevision: f.tasks.task(f.root.taskId).revision, scope: 'anything', reason: 'Synthetic invalid scope' }), /invalid_tool_arguments/);
    assert.equal(effects, 0);
    assert.equal(f.store.runs().length, 0);
    const child = await tools.call(main, 'task_delegate', base) as {
      taskId: string;
    };
    assert.equal(f.tasks.task(child.taskId).parentTaskId, f.root.taskId);
    assert.equal(effects, 1);
  }
  finally {
    f.close();
  }
});
test('public presentation length limits reject invalid delegation before any effects',async()=>{const f=fixture();try{let effects=0;const tools=new RecursiveTools(f.tasks,{rootAuthority:()=>{effects++;return f.tasks.authority(f.root.taskId,1);},wake:()=>{effects++;},stop:async()=>{effects++;},update:async()=>{effects++;}});const base={operationId:'public-text-limit',parentTaskId:null,parentVersion:null,expectedTaskRevision:null,title:'核对日期',executorKind:'worker',dependencies:[],contract:{...contract(),presentation:{title:'核对日期',description:'核对公开日期。'}}};for(const presentation of [{title:'x'.repeat(81),description:'描述'},{title:'标题',description:'x'.repeat(321)},{title:'',description:'描述'},{title:'标题',description:''}])await assert.rejects(()=>tools.call(main,'task_delegate',{...base,contract:{...base.contract,presentation}}),/invalid_tool_arguments/);assert.equal(effects,0);}finally{f.close();}});

test('main wait is rejected before stale revision repair while a Worker can still yield',async()=>{
 const f=fixture();try{
  const api=new RecursiveTools(f.tasks,{rootAuthority:()=>f.tasks.authority(f.root.taskId,1),wake(){},stop:async r=>r,update:async r=>r});
  const child=delegate(f),actor=running(f,child.taskId),t=f.tasks.task(child.taskId);
  const args={operationId:'wait',taskId:t.id,version:1,expectedTaskRevision:t.revision,condition:{type:'message',taskId:null,version:null,messageId:'synthetic-later-message',replyTo:null}};
  const before=f.store.db.prepare('SELECT count(*) n FROM operations').get()!.n;
  for(const revision of [t.revision+1,t.revision])await assert.rejects(()=>api.call(main,'task_wait',{...args,expectedTaskRevision:revision}),/task_wait_requires_run/);
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM operations').get()!.n,before);
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM run_waits').get()!.n,0);
  const waiting=await api.call(actor,'task_wait',args) as any;
  assert.equal(waiting.state,'waiting');assert.equal(f.tasks.run(actor.runId!).phase,'yielding');
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM run_waits').get()!.n,1);
 }finally{f.close();}
});

function coordinatorFixture() {
 const f=fixture('.codex/scratch/fixed-coordinator-parameters');
 const tools=new RecursiveTools(f.tasks,{rootAuthority:()=>f.tasks.authority(f.root.taskId,1),wake(){},stop:async r=>r,update:async r=>r});
 const current=(taskId:string,operationId:string)=>{const t=f.tasks.task(taskId);return {operationId,taskId,version:t.headVersion,expectedTaskRevision:t.revision};};
 return {...f,tools,current};
}
const schema=(name:string)=>RECURSIVE_TOOLS.find(t=>t.name===name)!.inputSchema;

test('fixed coordinator: new takeover needs no target and retries return its original receipt',async()=>{
 const f=coordinatorFixture();try{
  const child=delegate(f),args=f.current(child.taskId,'takeover');
  validateToolArguments(args,schema('task_takeover'));
  assert.throws(()=>validateToolArguments({...args,coordinatorAgentId:main.agentId},schema('task_takeover')),/invalid_tool_arguments/);
  const receipt=await f.tools.call(main,'task_takeover',args) as any;
  assert.equal(receipt.state,'taken_over');assert.equal(f.tasks.task(child.taskId).coordinatorAgentId,main.agentId);
  const task=f.tasks.task(child.taskId);
  assert.deepEqual(await f.tools.call(main,'task_takeover',args),receipt);
  assert.deepEqual(f.tasks.task(child.taskId),task);
 }finally{f.close();}
});

test('fixed coordinator: replacement derives only explicit transfers and retains the unconfirmed-exit fence',async()=>{
 const f=coordinatorFixture();try{
  const child=delegate(f,'transfer'),peer=delegate(f,'retain');running(f,child.taskId);running(f,peer.taskId);
  const peerBefore=f.tasks.task(peer.taskId),args={...f.current(f.root.taskId,'replace'),mode:'stop_replace',contract:contract('aggregate'),children:[{taskId:child.taskId,action:'transfer'},{taskId:peer.taskId,action:'retain'}],queuedDisposition:[],independent:false};
  validateToolArguments(args,schema('task_update'));
  const receipt=await f.tools.call(main,'task_update',args) as any;
  assert.deepEqual(receipt.childActions,[{taskId:child.taskId,action:'transfer',state:'transfer_pending_stop_confirmation',coordinatorAgentId:main.agentId},{taskId:peer.taskId,action:'retain',state:'retained'}]);
  assert.equal(f.tasks.task(child.taskId).controlState,'held');assert.deepEqual(f.tasks.task(peer.taskId),peerBefore);
  await assert.rejects(()=>f.tools.call(main,'task_takeover',f.current(child.taskId,'take-too-early')),/run_stop_unconfirmed/);
  const state=f.tasks.inspect(main,{taskId:f.root.taskId});
  assert.deepEqual(await f.tools.call(main,'task_update',args),receipt);
  assert.deepEqual(f.tasks.inspect(main,{taskId:f.root.taskId}),state);
 }finally{f.close();}
});

test('fixed coordinator: publication omits transfer target but requires completed takeover and preserves formal references',async()=>{
 const f=coordinatorFixture();try{
  const child=delegate(f);
  f.tasks.update(main,{...f.current(f.root.taskId,'hold'),mode:'stop_replace',contract:contract('aggregate'),children:[{taskId:child.taskId,action:'transfer',coordinatorAgentId:main.agentId}],queuedDisposition:[]});
  const resolution={childTaskId:child.taskId,childVersion:1,disposition:'transferred',resultId:null,reason:'Independent work remains under main supervision'};
  const args={...f.current(f.root.taskId,'publish'),resultId:null,text:'Synthetic partial result',publishedFileResultId:null,outcome:'partial',evidence:{facts:true,gaps:'Child remains active'},children:[resolution]};
  for(const name of ['task_review','publish_delivery']){
   const call=name==='task_review'?{...f.current(child.taskId,'review'),resultId:'schema-only',outcome:'partial',reason:'Schema validation only',children:[resolution]}:args;
   validateToolArguments(call,schema(name));
   assert.throws(()=>validateToolArguments({...call,children:[{...resolution,nextCoordinatorId:main.agentId}]},schema(name)),/invalid_tool_arguments/);
  }
  await assert.rejects(()=>f.tools.call(main,'publish_delivery',args),/child_transfer_unconfirmed/);
  await f.tools.call(main,'task_takeover',f.current(child.taskId,'take-child'));
  await assert.rejects(()=>f.tools.call(main,'publish_delivery',{...args,outcome:'succeeded'}),/child_transferred_gap/);
  const receipt=await f.tools.call(main,'publish_delivery',args) as any;
  const row=f.store.db.prepare('SELECT nextCoordinatorId FROM child_resolutions WHERE parentTaskId=? AND childTaskId=?').get(f.root.taskId,child.taskId)!;
  assert.equal(row.nextCoordinatorId,main.agentId);
  assert.equal(f.tasks.delivery(receipt.deliveryId).resultId,receipt.resultId);
  assert.equal(f.tasks.inspect(main,{resultId:receipt.resultId}).actualResult!.payload.text,'Synthetic partial result');
  const before=f.tasks.inspect(main,{resultId:receipt.resultId});
  assert.deepEqual(await f.tools.call(main,'publish_delivery',args),receipt);
  assert.deepEqual(f.tasks.inspect(main,{resultId:receipt.resultId}),before);
  assert.equal(f.tasks.deliveries().length,1);
 }finally{f.close();}
});

for(const name of ['task_takeover','task_update','publish_delivery'])test('fixed coordinator: legacy '+name+' keeps its payload hash and readonly receipt after task changes',async()=>{
 const f=coordinatorFixture();try{
  const child=delegate(f);
  const args=name==='task_takeover'?{...f.current(child.taskId,'legacy'),coordinatorAgentId:main.agentId}:name==='task_update'?{...f.current(f.root.taskId,'legacy'),mode:'stop_replace',contract:contract('aggregate'),children:[{taskId:child.taskId,action:'transfer',coordinatorAgentId:main.agentId}],queuedDisposition:[],independent:false}:{...f.current(f.root.taskId,'legacy'),resultId:null,text:'Legacy partial result',publishedFileResultId:null,outcome:'partial',evidence:{facts:true,gaps:'Child continues'},children:[{childTaskId:child.taskId,childVersion:1,disposition:'transferred',resultId:null,nextCoordinatorId:main.agentId,reason:'Main supervision continues'}]};
  const oldHash=recursiveHash(args),receipt=await f.tools.call(main,name,args) as any;
  assert.equal(f.tasks.operation(receipt.operationKey).payloadHash,oldHash);
  const inspected=await f.tools.call(main,'work_inspect',{taskId:null,runId:null,resultId:null,operationId:'legacy',operationScopeId:args.taskId}) as any;
  assert.deepEqual(inspected.operation.response,receipt);
  const before=['tasks','task_versions','results','child_resolutions','deliveries','operations'].map(table=>f.store.db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all());
  assert.deepEqual(await f.tools.call(main,name,args),receipt);
  const changed=structuredClone(args) as any;
  if(name==='task_takeover')delete changed.coordinatorAgentId;
  else if(name==='task_update')delete changed.children[0].coordinatorAgentId;
  else delete changed.children[0].nextCoordinatorId;
  await assert.rejects(()=>f.tools.call(main,name,changed),/operation_payload_conflict/);
  assert.deepEqual(['tasks','task_versions','results','child_resolutions','deliveries','operations'].map(table=>f.store.db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()),before);
 }finally{f.close();}
});

test('fixed coordinator: fresh legacy targets, unknown fields and stale calls retain existing rejection semantics',async()=>{
 const f=coordinatorFixture();try{
  const child=delegate(f),before=f.tasks.task(child.taskId);
  for(const coordinatorAgentId of ['worker:foreign','',null])await assert.rejects(()=>f.tools.call(main,'task_takeover',{...f.current(child.taskId,'bad-take'),coordinatorAgentId}),/task_coordinator_invalid|invalid_tool_arguments|tool_argument/);
  for(const coordinatorAgentId of ['worker:foreign',null])await assert.rejects(()=>f.tools.call(main,'task_update',{...f.current(f.root.taskId,'bad-transfer'),mode:'stop_replace',contract:contract('aggregate'),children:[{taskId:child.taskId,action:'transfer',coordinatorAgentId}],queuedDisposition:[],independent:false}),/task_coordinator_invalid/);
  for(const nextCoordinatorId of ['worker:foreign',null])await assert.rejects(()=>f.tools.call(main,'publish_delivery',{...f.current(f.root.taskId,'bad-publication'),resultId:null,text:'Synthetic',publishedFileResultId:null,outcome:'partial',evidence:{facts:true,gaps:true},children:[{childTaskId:child.taskId,childVersion:1,disposition:'transferred',resultId:null,nextCoordinatorId,reason:'Synthetic'}]}),/child_transfer_unconfirmed/);
  await assert.rejects(()=>f.tools.call(main,'task_takeover',{...f.current(child.taskId,'unknown-field'),coordinatorAgentId:main.agentId,authority:{}}),/invalid_tool_arguments/);
  await assert.rejects(()=>f.tools.call(main,'task_takeover',{...f.current(child.taskId,'stale'),expectedTaskRevision:before.revision+1,coordinatorAgentId:main.agentId}),/task_revision_conflict/);
  assert.deepEqual(f.tasks.task(child.taskId),before);assert.equal(f.tasks.task(f.root.taskId).headVersion,1);assert.equal(f.tasks.deliveries().length,0);
 }finally{f.close();}
});

test('fixed coordinator: legacy review child fields are parsed without bypassing child ownership',async()=>{
 const f=coordinatorFixture();try{
  const child=delegate(f),worker=running(f,child.taskId),result=complete(f,worker,child.taskId);
  f.tasks.inspect(main,{resultId:result.resultId});
  const args={...f.current(child.taskId,'review'),resultId:result.resultId,accepted:true,outcome:'partial',reason:'Synthetic',evidence:{facts:true,gaps:true},children:[{childTaskId:f.root.taskId,childVersion:1,disposition:'transferred',resultId:null,nextCoordinatorId:main.agentId,reason:'Forged child ownership'}]};
  await assert.rejects(()=>f.tools.call(main,'task_review',args),/child_resolution_missing/);
  const invalid=await f.tools.call(main,'task_review',{...args,children:[{...args.children[0],nextCoordinatorId:{}}]}) as any;
  assert.equal(invalid.code,'invalid_tool_arguments');assert.equal(invalid.applied,false);
  assert.equal(f.tasks.inspect(main,{resultId:result.resultId}).results.find(r=>r.id===result.resultId)!.state,'offered');
 }finally{f.close();}
});
