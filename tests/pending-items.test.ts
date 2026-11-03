// Synthetic only: local SQLite, no model, account, production paths or network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { Store } from '../src/store.js';
import { Files } from '../src/files.js';
import { WorkerInteractions } from '../src/worker-interactions.js';
import { ConversationHistory } from '../src/web-history.js';
import { MainInputs } from '../src/recursive-main-inputs.js';
import { RecursiveTasks, type Actor } from '../src/recursive-tasks.js';
import { PendingTools } from '../src/pending-tools.js';
import { HOST_MCP_TOOLS, WORKER_HOST_MCP_TOOLS } from '../src/worker-interaction-mcp.js';
import { contract } from './recursive-fixture.js';

const scratch=resolve('.codex/scratch/main-pending-implementation');mkdirSync(scratch,{recursive:true});
function fixture(){
 const dir=mkdtempSync(join(scratch,'records-')),path=join(dir,'synthetic.sqlite');
 const store=new Store(path);new WorkerInteractions(store.db);const history=new ConversationHistory(store.db);
 const tasks=new RecursiveTasks(store,new Files(join(dir,'workspace')));tasks.migrate();
 store.setMeta('mainAgentId','main:pending');store.setMeta('mainThread','thread:pending');
 const actor:Actor={agentId:'main:pending',threadId:'thread:pending',sourceRequestId:'user:pending'};
 const inputs=new MainInputs(tasks,history);inputs.accept({requestId:actor.sourceRequestId!,text:'先记下导出建议，暂不执行。'});const q=inputs.claim()!;inputs.started(q.messageId,q.revision,'generation','turn');inputs.finish(q.messageId,q.revision,'completed');
 const tools=new PendingTools(tasks);
 return {store,tasks,actor,history,inputs,tools,path,dir,close(){store.close();rmSync(dir,{recursive:true,force:true});}};
}

test('AC01/04/06: record without execution, durable receipt, CAS, explicit close/reopen and source binding',async()=>{
 const f=fixture();try{
  const a={operationId:'remember',content:'PDF 导出'};
  const row=await f.tools.call(f.actor,'pending_add',a) as any;
  assert.equal(row.revision,1);assert.equal(row.state,'open');assert.ok(row.id);
  assert.deepEqual(await f.tools.call(f.actor,'pending_add',a),row);
  await assert.rejects(()=>f.tools.call(f.actor,'pending_add',{...a,content:'different'}),/operation_payload_conflict/);
  assert.equal(f.tasks.tasks().length,0);assert.equal(f.store.runs().length,0);
  const list=await f.tools.call(f.actor,'pending_list',{id:row.id}) as any;
  assert.deepEqual(list.items[0].sourceRequestIds,['user:pending']);assert.match(list.items[0].sources[0].text,/暂不执行/);
  const closed=await f.tools.call(f.actor,'pending_update',{operationId:'close',id:row.id,expectedRevision:1,patch:{state:'closed',handlingNote:'暂缓'}}) as any;
  assert.equal(closed.revision,2);
  await assert.rejects(()=>f.tools.call(f.actor,'pending_update',{operationId:'stale',id:row.id,expectedRevision:1,patch:{content:'clobber'}}),/pending_revision_conflict/);
  const reopened=await f.tools.call(f.actor,'pending_update',{operationId:'reopen',id:row.id,expectedRevision:2,patch:{state:'open'}}) as any;
  assert.equal(reopened.state,'open');assert.equal(f.tasks.tasks().length,0);
  const receipt=await f.tools.call(f.actor,'pending_list',{operationId:'remember'}) as any;
  assert.deepEqual(receipt.operation.response,row);
  assert.equal((await f.tools.call(f.actor,'pending_list',{operationId:'absent'}) as any).operation.state,'not_found');
  f.store.db.prepare("UPDATE operations SET state='uncertain',responseJson=NULL WHERE operationId='remember'").run();
  assert.equal((await f.tools.call(f.actor,'pending_list',{operationId:'remember'}) as any).operation.state,'uncertain');
  await assert.rejects(()=>f.tools.call(f.actor,'pending_add',a),/operation_uncertain/);
 }finally{f.close();}
});

test('AC02/05: bounded independent discovery, restart and host-only validated inputs',async()=>{
 const f=fixture();try{
  const event={agentId:f.actor.agentId,threadId:f.actor.threadId};
  for(let i=0;i<7;i++)await f.tools.call(event,'pending_add',{operationId:'item'+i,content:'Suggestion '+i});
  const page=await f.tools.call(event,'pending_list',{state:'open',limit:3}) as any;
  assert.equal(page.items.length,3);assert.ok(page.nextCursor);
  const next=await f.tools.call(event,'pending_list',{state:'open',limit:3,cursor:page.nextCursor}) as any;
  assert.equal(new Set([...page.items,...next.items].map((x:any)=>x.id)).size,6);
  assert.deepEqual(page.items[0].sourceRequestIds,[]);
  assert.equal(f.tasks.pending.summary(event).totalOpen,7);
  for(const args of [{operationId:'spoof',content:'x',actor:'user'},{operationId:'spoof',content:'x',sourceRequestIds:['unknown']}])await assert.rejects(()=>f.tools.call(event,'pending_add',args));
  await assert.rejects(()=>f.tools.call({...event,agentId:'worker:x'},'pending_list',{}),/denied/);
  await assert.rejects(()=>f.tools.call({...event,threadId:'another'},'pending_list',{}),/denied/);
  await assert.rejects(()=>f.tools.call(event,'pending_update',{operationId:'empty',id:page.items[0].id,expectedRevision:1,patch:{}}),/invalid/);
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM agent_messages').get()!.n,1);
  const reopened=new Store(f.path);try{const tasks=new RecursiveTasks(reopened,f.tasks.files);tasks.migrate();assert.equal(tasks.pending.list(event,{state:'open'}).items.length,7);}finally{reopened.close();}
  assert.ok(HOST_MCP_TOOLS.some(t=>t.name==='pending_add'));assert.ok(!WORKER_HOST_MCP_TOOLS.some(t=>t.name.startsWith('pending_')));
 }finally{f.close();}
});

test('AC05/06: explicit event dispatch keeps actor, chosen route and links atomic; no authority from suggestions',()=>{
 const f=fixture();try{
  const event={agentId:f.actor.agentId,threadId:f.actor.threadId};
  const a=f.tasks.pending.add(f.actor,{operationId:'add',content:'remember'}),b=f.tasks.pending.add(f.actor,{operationId:'add2',content:'another'});
  const selection={items:[{id:a.id,expectedRevision:1},{id:b.id,expectedRevision:1}],sourceRequestIds:['user:pending'],primarySourceRequestId:'user:pending'};
  const authority={sourceRequestId:'user:pending',description:'Actual synthetic user source',materials:['sample.md'],resultIds:[],collaborateTaskIds:[],maxActiveMs:10000};
  const input={operationId:'dispatch',title:'Explicit choice',contract:contract(),executorKind:'worker' as const};
  assert.throws(()=>f.tasks.createRoot(event,{...input,authority}),/source_denied/);
  const bad=f.tasks.pending.add(event,{operationId:'suggestion',content:'worker suggestion'});
  assert.throws(()=>f.tasks.createPendingRoot(event,input,{...selection,items:[{id:bad.id,expectedRevision:1}]},()=>authority),/source_denied/);
  assert.throws(()=>f.tasks.createPendingRoot(event,input,selection,()=>({...authority,attachments:[],materials:[]})),/input_denied/);
  f.store.db.exec("CREATE TRIGGER fail_link BEFORE UPDATE OF linkedTaskId ON pending_items BEGIN SELECT RAISE(ABORT,'synthetic_link_failure'); END");
  assert.throws(()=>f.tasks.createPendingRoot(event,input,selection,()=>authority),/synthetic_link_failure/);
  assert.equal(f.tasks.tasks().length,0);assert.equal(f.tasks.pending.list(f.actor,{id:a.id}).items[0]!.revision,1);
  assert.equal(f.store.db.prepare("SELECT count(*) n FROM operations WHERE scopeId='pending_dispatch'").get()!.n,0);
  f.store.db.exec('DROP TRIGGER fail_link');
  const receipt=f.tasks.createPendingRoot(event,input,selection,()=>authority);
  assert.equal(f.tasks.task(receipt.taskId).createdByAgentId,event.agentId);
  assert.equal(f.tasks.pending.list(event,{id:a.id}).items[0]!.linkedTaskId,receipt.taskId);
  assert.equal(f.tasks.pending.list(event,{id:b.id}).items[0]!.state,'open');
  assert.equal(f.tasks.authority(receipt.taskId,1).sourceRequestId,'user:pending');
  assert.deepEqual(f.tasks.createPendingRoot(event,input,selection,()=>{throw Error('must not reauthorize receipt');}),receipt);
  assert.equal(f.tasks.tasks().length,1);
  assert.throws(()=>f.tasks.createPendingRoot(event,{...input,operationId:'new'},selection,()=>authority),/revision_conflict/);
  f.tasks.failRun(receipt.runId!,f.tasks.run(receipt.runId!).epoch,'synthetic_failure');
  assert.equal(receipt.pendingItems[0]!.revision,2);
  const nextSelection={...selection,items:selection.items.map(ref=>({...ref,expectedRevision:2}))};
  const next=f.tasks.createPendingRoot(event,{...input,operationId:'another-explicit-choice'},nextSelection,()=>authority);
  assert.notEqual(next.taskId,receipt.taskId,'failure does not gate another explicit authorized choice');
  const oldReceipt=f.tasks.pending.list(event,{operationId:'dispatch',operationScope:'pending_dispatch'}).operation!;
  assert.deepEqual(oldReceipt.response,receipt,'historical receipt still contains the old item/task association');
  const saved=f.tasks.pending.list(event,{id:a.id}).items[0]!;assert.equal(saved.state,'open');
  f.tasks.pending.update(event,{operationId:'finish',id:a.id,expectedRevision:saved.revision,patch:{state:'closed'}});
  assert.equal(f.tasks.task(receipt.taskId).outcome,'failed');
 }finally{f.close();}
});

test('AC05: original user role, exact instance, processed source and explicit source relation; bounded long pages',async()=>{
 const f=fixture();try{
  const event={agentId:f.actor.agentId,threadId:f.actor.threadId};
  f.history.accept('other-thread',{requestId:'cross-instance',text:'do something'});
  f.history.record('assistant-only','thread:pending','not user instruction');
  f.inputs.accept({requestId:'unclaimed',text:'queued user'});
  const cancelled=f.inputs.accept({requestId:'cancelled',text:'cancel me'});
  f.inputs.cancel({requestId:'cancelled',operationId:'cancel-request',expectedRevision:cancelled.revision!});
  for(const source of ['cross-instance','assistant-only','unclaimed','cancelled','missing'])await assert.rejects(()=>f.tools.call(event,'pending_add',{operationId:'deny-'+source,content:'x',sourceRequestIds:[source]}),/source_denied/);
  const row=f.tasks.pending.add(f.actor,{operationId:'good',content:'real user source'});
  const selection={items:[{id:row.id,expectedRevision:1}],sourceRequestIds:['unclaimed'],primarySourceRequestId:'unclaimed'};
  assert.throws(()=>f.tasks.pending.validateSelection(event,selection),/source_denied/);
  await assert.rejects(()=>f.tools.call(event,'pending_list',{id:row.id,sourceRequestId:'unclaimed'}),/source_denied/);
  const text='长'.repeat(24000);
  for(let i=0;i<8;i++)f.tasks.pending.add(event,{operationId:'long-'+i,content:text});
  const page=f.tasks.pending.list(event,{limit:50});
  assert.ok(page.items.length<9);assert.ok(page.nextCursor);assert.ok(Buffer.byteLength(JSON.stringify(page))<300000);
  const allIds=new Set(page.items.map(x=>x.id));let cursor:string|null=page.nextCursor;
  while(cursor){const page=f.tasks.pending.list(event,{limit:50,cursor});for(const item of page.items){assert.ok(!allIds.has(item.id));allIds.add(item.id);}cursor=page.nextCursor;}
  assert.equal(allIds.size,9);
 }finally{f.close();}
});
