// Synthetic public-tool contracts; no model, account, channel or daily runtime.
import test from 'node:test';
import assert from 'node:assert/strict';
import {RecursiveTools} from '../src/recursive-tools.js';
import {RecursiveTasks} from '../src/recursive-tasks.js';
import {fixture,main,contract,running,delegate} from './recursive-fixture.js';

function tools(f:ReturnType<typeof fixture>){return new RecursiveTools(f.tasks,{rootAuthority:()=>f.tasks.authority(f.root.taskId,1),wake(){},stop:async r=>r,update:async r=>r});}
function reviewFixture(){const f=fixture();return {...f,tasks:new RecursiveTasks(f.store,f.files,{validateActor(){},reviewExitConfirmed:()=>true})};}

test('review schema errors identify missing nested dispositions and reject misplaced fields without mutation',async()=>{
 const f=reviewFixture();try{
  const api=tools(f),child=delegate(f),actor=running(f,child.taskId);
  const returned=f.tasks.endSegment(actor.runId!,actor.epoch!,{status:'completed',text:'Synthetic report'},true)!;
  f.tasks.inspect(main,{resultId:returned.resultId});
  const task=f.tasks.task(child.taskId),before=f.store.db.prepare('SELECT count(*) n FROM operations').get()!.n;
  const args={operationId:'revise',taskId:task.id,version:1,expectedTaskRevision:task.revision,resultId:returned.resultId,decision:'request_changes',outcome:'succeeded',reason:'Synthetic missing facts',revision:{contract:contract()},queuedDisposition:[]};
  const result=await api.call(main,'task_review',args) as any;
  assert.equal(result.code,'invalid_tool_arguments');assert.equal(result.applied,false);
  assert.ok(result.issues.some((i:any)=>i.path==='$.revision'&&i.rule==='required'&&i.fields.includes('children')&&i.fields.includes('queuedDisposition')));
  assert.ok(result.issues.some((i:any)=>i.path==='$'&&i.rule==='additionalProperties'));
  assert.equal(f.tasks.task(task.id).revision,task.revision);
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM operations').get()!.n,before);
  const {queuedDisposition,...valid}=args;
  const revised=await api.call(main,'task_review',{...valid,revision:{contract:contract(),children:[],queuedDisposition}}) as any;
  assert.equal(revised.decision,'request_changes');assert.equal(revised.version,2);
 }finally{f.close();}
});

test('review validation never echoes untrusted property names or values in diagnostics',async()=>{
 const f=fixture();try{
  const result=await tools(f).call(main,'task_review',{private_argument_name:'PRIVATE_VALUE'}) as any;
  assert.equal(result.applied,false);assert.equal(result.code,'invalid_tool_arguments');
  assert.ok(result.issues.some((i:any)=>i.path==='$'&&i.rule==='required'&&i.fields.includes('taskId')));
  assert.doesNotMatch(JSON.stringify(result),/private_argument_name|PRIVATE_VALUE/);
 }finally{f.close();}
});

for(const root of [true,false])test((root?'root':'child')+' acceptance points to explicit root publication only when appropriate',async()=>{
 const f=fixture();try{
  const created=root?f.tasks.createRoot(main,{operationId:'worker-root',title:'Synthetic report',contract:contract('markdown'),executorKind:'worker',authority:f.tasks.authority(f.root.taskId,1)}):delegate(f,'report',undefined,undefined,'markdown');
  const actor=running(f,created.taskId);f.tasks.markMaterialRead(actor);
  const file=f.tasks.writeMarkdown(actor,{operationId:'report',filename:'report.md',content:'# Synthetic report'});
  const returned=f.tasks.endSegment(actor.runId!,actor.epoch!,{status:'completed',text:'Synthetic final report'},true)!;
  f.tasks.inspect(main,{resultId:returned.resultId});
  const task=f.tasks.task(created.taskId),api=tools(f);
  const args={operationId:'accept',taskId:task.id,version:1,expectedTaskRevision:task.revision,resultId:returned.resultId,decision:'accept',outcome:'succeeded',reason:'Facts checked',evidence:{facts:true},children:[]};
  const accepted=await api.call(main,'task_review',args) as any;
  assert.equal(accepted.state,'accepted');assert.equal(f.tasks.deliveries().length,0);
  const confirmation=f.store.db.prepare("SELECT r.state,r.processedBy,r.resultRef FROM agent_receipts r JOIN agent_messages m ON m.id=r.messageId WHERE m.taskId=? AND m.kind='result_accepted'").get(task.id)!;
  assert.equal(confirmation.state,'processed');assert.equal(confirmation.processedBy,main.agentId);
  assert.equal(confirmation.resultRef,returned.resultId);
  assert.equal(f.tasks.inbox(main).some(m=>m.kind==='result_accepted'),false);
  assert.equal(f.tasks.publishedArtifact(actor.runId!),undefined);
  if(root){
   assert.equal(accepted.nextTool,'publish_delivery');assert.equal(accepted.taskId,task.id);assert.equal(accepted.version,1);
   assert.equal(accepted.taskRevision,f.tasks.task(task.id).revision);
   const publishArgs={operationId:'publish',taskId:accepted.taskId,version:accepted.version,expectedTaskRevision:accepted.taskRevision,resultId:accepted.resultId,text:'Synthetic final report',publishedFileResultId:file.resultId};
   const publication=await api.call(main,accepted.nextTool,publishArgs) as any;
   assert.equal(publication.state,'prepared');assert.equal(publication.nextAction,'end_turn');assert.equal(f.tasks.deliveries().length,1);
   assert.deepEqual(await api.call(main,accepted.nextTool,publishArgs),publication);
   assert.deepEqual(await api.call(main,'task_review',args),accepted);
   assert.equal(f.store.db.prepare("SELECT count(*) n FROM agent_messages WHERE taskId=? AND kind='result_accepted'").get(task.id)!.n,1);
  }else assert.equal(accepted.nextTool,undefined);
 }finally{f.close();}
});

for(const outcome of ['partial','failed'] as const)test(outcome+' review preserves its follow-up notification',async()=>{
 const f=fixture();try{
  const child=delegate(f),actor=running(f,child.taskId),returned=f.tasks.endSegment(actor.runId!,actor.epoch!,{status:'completed',text:'Synthetic limited result'},true)!;
  f.tasks.inspect(main,{resultId:returned.resultId});const task=f.tasks.task(child.taskId);
  const api=tools(f),args={operationId:'limited-review',taskId:task.id,version:1,expectedTaskRevision:task.revision,resultId:returned.resultId,accepted:true,outcome,reason:'Synthetic limitation',evidence:outcome==='partial'?{gaps:'Missing date'}:{},children:[]};
  const reviewed=await api.call(main,'task_review',args);
  assert.deepEqual(await api.call(main,'task_review',args),reviewed);
  const rows=f.store.db.prepare("SELECT r.state FROM agent_receipts r JOIN agent_messages m ON m.id=r.messageId WHERE m.taskId=? AND m.kind='result_accepted'").all(task.id);
  assert.equal(rows.length,1);assert.equal(rows[0]!.state,'pending');
 }finally{f.close();}
});
