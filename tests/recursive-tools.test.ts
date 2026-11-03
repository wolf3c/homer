// Synthetic public tool boundary tests; effects never call an engine or channel.
import test from 'node:test';
import assert from 'node:assert/strict';
import { RecursiveTools } from '../src/recursive-tools.js';
import { fixture, main, contract, delegate, running } from './recursive-fixture.js';
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
