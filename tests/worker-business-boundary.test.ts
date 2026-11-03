// Requirements-derived synthetic boundary checks. No model or production access.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,delegate,running,main,contract} from './recursive-fixture.js';
import {WORKER_HOST_MCP_TOOLS} from '../src/worker-interaction-mcp.js';
import {RecursiveTools} from '../src/recursive-tools.js';
import {RecursiveTasks} from '../src/recursive-tasks.js';

test('only main creates business Workers; rejected management has no persisted effects',()=>{
 const f=fixture('.codex/scratch/worker-native-subagent-convergence-implementation-20261024/runtime');
 try{
  const a=delegate(f,'a'),b=delegate(f,'b'),actor=running(f,a.taskId);
  const counts=()=>['tasks','runs','operations'].map(table=>f.store.db.prepare('SELECT count(*) n FROM '+table).get()!.n);
  const before=counts(),t=f.tasks.task(a.taskId),input={operationId:'forged',taskId:t.id,version:t.headVersion,expectedTaskRevision:t.revision};
  for(const attempt of [
   ()=>delegate(f,'forged',a.taskId,actor),
   ()=>delegate(f,'wrong-parent',a.taskId,main),
   ()=>f.tasks.createRoot(actor,{operationId:'root-forged',title:'Synthetic',contract:contract(),authority:f.tasks.authority(t.id,1)}),
   ()=>f.tasks.stop(actor,{...input,scope:'self',reason:'Synthetic'}),
   ()=>f.tasks.update(actor,{...input,mode:'queue',contract:contract(),children:[],queuedDisposition:[]}),
   ()=>f.tasks.takeover(actor,{...input,coordinatorAgentId:actor.agentId}),
   ()=>f.tasks.continue(actor,input),
   ()=>f.tasks.addDependency(actor,{...input,dependsOnTaskId:b.taskId,dependsOnVersion:1,required:true}),
   ()=>f.tasks.deferReview(actor,{...input,runId:actor.runId!,code:'review_decision_required'}),
   ()=>f.tasks.review(actor,{...input,resultId:'not-a-result',accepted:true,outcome:'succeeded',reason:'Synthetic',children:[],evidence:{}}),
   ()=>f.tasks.publish(actor,{...input,resultId:null,text:'Synthetic',publishedFileResultId:null}),
  ]){assert.throws(attempt,/main_required|parent_denied/);assert.deepEqual(counts(),before);}
  const next=delegate(f,'c');assert.equal(f.tasks.task(next.taskId).parentTaskId,f.root.taskId);
  assert.equal(f.tasks.tasks().filter(t=>t.executorKind==='worker').length,3);
  assert.equal(f.tasks.children(a.taskId).length,0);
 }finally{f.close();}
});
test('forged Worker management calls are denied before host effects or argument interpretation',async()=>{
 const f=fixture('.codex/scratch/worker-native-subagent-convergence-implementation-20261024/runtime');try{
  const a=delegate(f),actor=running(f,a.taskId);let effects=0;
  const tools=new RecursiveTools(f.tasks,{rootAuthority:()=>{effects++;throw Error('unexpected_effect');},wake:()=>{effects++;},stop:async()=>{effects++;},update:async()=>{effects++;}});
  const count=f.store.db.prepare('SELECT count(*) n FROM operations').get()!.n;
  for(const name of ['task_delegate','task_review','task_update','task_stop','task_continue','task_takeover','publish_delivery'])await assert.rejects(()=>tools.call(actor,name,{}),/task_main_required/);
  assert.equal(effects,0);assert.equal(f.store.db.prepare('SELECT count(*) n FROM operations').get()!.n,count);
 }finally{f.close();}
});
test('Worker host tools retain peer communication and capability management without business management',()=>{
 const names=WORKER_HOST_MCP_TOOLS.map(t=>t.name);
 for(const name of ['agent_send','inbox_read','inbox_ack','task_wait','adopt_version','capabilities'])assert.ok(names.includes(name),name);
 for(const name of ['task_delegate','task_review','task_update','task_stop','task_continue','task_takeover','publish_delivery','archive_work','restore_work','delete_work'])assert.ok(!names.includes(name),name);
});
for(const invalid of ['nested-worker','worker-coordinator'])test('existing invalid business ownership is refused without rewriting history: '+invalid,()=>{
 const f=fixture('.codex/scratch/worker-native-subagent-convergence-implementation-20261024/runtime');try{
  const a=delegate(f,'a'),b=delegate(f,'b');
  // Emulate an old same-version layout; never enable this on a real database.
  f.store.db.exec('PRAGMA ignore_check_constraints=ON');
  if(invalid==='nested-worker')f.store.db.prepare('UPDATE tasks SET parentTaskId=? WHERE id=?').run(a.taskId,b.taskId);
  else f.store.db.prepare('UPDATE tasks SET coordinatorAgentId=? WHERE id=?').run(a.agentId,b.taskId);
  f.store.db.exec('PRAGMA ignore_check_constraints=OFF');
  const capture=()=>['tasks','runs','operations','meta'].map(table=>f.store.db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all());
  const before=capture();assert.throws(()=>new RecursiveTasks(f.store,f.files).migrate(),/task_business_layer_unsupported/);assert.deepEqual(capture(),before);
 }finally{f.close();}
});
