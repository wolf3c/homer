import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {Store} from '../src/store.js';
import {Files} from '../src/files.js';
import {RecursiveTasks} from '../src/recursive-tasks.js';

test('one task starts with only a goal, notes use CAS and two Worker replies do not settle it',()=>{
 const base=resolve('.codex/scratch/chat-architecture-implementation-20261105');mkdirSync(base,{recursive:true});
 const dir=mkdtempSync(join(base,'core-')),store=new Store(join(dir,'test.sqlite'));
 try{
  const tasks=new RecursiveTasks(store,new Files(join(dir,'workspace')));tasks.migrate();
  store.setMeta('mainAgentId','main:test');store.setMeta('mainThread','thread:main');store.startRequest('source:test','hash');
  const actor={agentId:'main:test',threadId:'thread:main',sourceRequestId:'source:test'};
  assert.equal(typeof tasks.createTask,'function','core task creation must exist without a Contract');
  const root=tasks.createTask(actor,{operationId:'create',goal:'Investigate without edits',authority:{sourceRequestId:'source:test',description:'Investigate only'}});
  assert.equal(tasks.task(root.taskId).state,'open');assert.equal(tasks.task(root.taskId).notes,'');
  const updated=tasks.updateTask(actor,{operationId:'notes',taskId:root.taskId,expectedRevision:1,patch:{notes:'Check both sources'}});
  assert.equal(tasks.task(root.taskId).notes,'Check both sources');
  assert.throws(()=>tasks.updateTask(actor,{operationId:'stale',taskId:root.taskId,expectedRevision:1,patch:{notes:'overwrite'}}),/revision_conflict/);
  const a=tasks.workerOpen(actor,{operationId:'open-a',taskId:root.taskId,text:'Inspect page'}),b=tasks.workerOpen(actor,{operationId:'open-b',taskId:root.taskId,text:'Inspect build'});
  const ar=tasks.claim(a.runId)!,br=tasks.claim(b.runId)!;assert.ok(ar);assert.ok(br);
  tasks.bind(ar.id,ar.epoch,'thread:a','turn:a');tasks.bind(br.id,br.epoch,'thread:b','turn:b');
  tasks.endSegment(ar.id,ar.epoch,{status:'completed',text:'Page answer'},true);tasks.endSegment(br.id,br.epoch,{status:'completed',text:'Build answer'},true);
  assert.equal(tasks.task(root.taskId).state,'open');assert.equal(tasks.task(root.taskId).outcome,null);assert.equal(tasks.task(root.taskId).notes,'Check both sources');
  assert.equal(tasks.inbox(actor).filter(m=>m.kind==='worker_reply').length,2);
  assert.equal(tasks.task(root.taskId).revision,updated.revision);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

import {chatFixture} from './task-chat-fixture.js';
import {writeFileSync,readFileSync} from 'node:fs';

test('current Run summaries disclose confirmed exit without rewriting an interrupted historical reply or granting continuation',async()=>{
 const f=chatFixture();try{
  const tools=new RecursiveTools(f.tasks,{rootAuthority:()=>f.authority,wake(){},stop:async()=>{},steer:async()=>{}}),task=f.create(),worker=f.tasks.workerOpen(f.actor,{operationId:'open',taskId:task.taskId,text:'Inspect the original scope'});
  const summaries=async()=>{const taskView=await tools.call(f.actor,'work_inspect',{taskId:task.taskId}) as any,workerView=await tools.call(f.actor,'worker_read',{workerId:worker.workerId}) as any;const values=[taskView.workers[0].run,workerView.runs.find((run:any)=>run.id===worker.runId)];assert.deepEqual(values[0],values[1]);return values;};
  for(const summary of await summaries())assert.notEqual(summary.exitConfirmed,true);
  const run=f.start(worker.workerId);for(const summary of await summaries())assert.notEqual(summary.exitConfirmed,true);
  f.tasks.reconcile();const reply=f.tasks.inbox(f.actor).find(message=>message.kind==='worker_reply')!,historical=f.store.db.prepare('SELECT payloadJson FROM agent_messages WHERE id=?').get(reply.id)!.payloadJson,unknown=await summaries();
  assert.equal(reply.payload.execution.exitConfirmed,false);assert.equal(reply.payload.execution.errorCode,'restart_unconfirmed');
  for(const summary of unknown){assert.equal(summary.status,'interrupted');assert.equal(summary.phase,'uncertain');assert.notEqual(summary.exitConfirmed,true);}
  assert.equal(f.tasks.confirmWorkerExit(run.id,undefined),true);
  for(const summary of await summaries()){assert.equal(summary.exitConfirmed,true);assert.equal(summary.status,'interrupted');assert.equal(summary.phase,'ended');assert.ok(summary.stateRevision>unknown[0].stateRevision);}
  assert.equal(f.tasks.task(task.taskId).state,'open');assert.equal(f.tasks.task(task.taskId).outcome,null);assert.equal(f.tasks.runs(task.taskId).length,1);const original=await tools.call(f.actor,'worker_read',{workerId:worker.workerId,messageId:reply.id}) as any;assert.equal(original.messages[0].payload.execution.exitConfirmed,false);assert.equal(f.store.db.prepare('SELECT payloadJson FROM agent_messages WHERE id=?').get(reply.id)!.payloadJson,historical);
  f.tasks.controlTask(f.actor,{operationId:'pause',taskId:task.taskId,expectedRevision:1,action:'pause'});for(const summary of await summaries())assert.equal(summary.exitConfirmed,true);
  await assert.rejects(tools.call(f.actor,'worker_send',{workerId:worker.workerId,message:'Reading history alone must not resume paused work'},'paused-send'),/task_not_open/);
  f.tasks.controlTask(f.actor,{operationId:'resume',taskId:task.taskId,expectedRevision:2,action:'resume'});assert.equal(f.tasks.runs(task.taskId).length,1);
  const sent=await tools.call(f.actor,'worker_send',{workerId:worker.workerId,message:'Continue within the original authorized scope'},'continue') as any,next=f.start(worker.workerId);
  assert.equal(sent.runId,next.id);assert.equal(next.workerId,worker.workerId);assert.equal(next.threadId,run.threadId);assert.equal(next.version,run.version);assert.equal(next.sourceRequestId,run.sourceRequestId);assert.equal(next.replacesRunId,run.id);assert.equal(next.phase,'executing');assert.equal(f.tasks.task(task.taskId).outcome,null);
  const continued=await tools.call(f.actor,'worker_read',{workerId:worker.workerId}) as any;assert.equal(continued.runs.find((row:any)=>row.id===next.id).exitConfirmed,false);assert.equal(continued.runs.find((row:any)=>row.id===run.id).exitConfirmed,true);
  assert.equal(f.store.db.prepare('SELECT payloadJson FROM agent_messages WHERE id=?').get(reply.id)!.payloadJson,historical);
 }finally{f.close();}
});

test('Run summaries retain lease and host-owner fences even when the stored checkpoint records an exit',()=>{
 let ownerClosed=false;const f=chatFixture({validateActor(){},reviewExitConfirmed:()=>ownerClosed});try{
  const task=f.create(),worker=f.tasks.workerOpen(f.actor,{operationId:'open',taskId:task.taskId,text:'Inspect'}),run=f.start(worker.workerId);f.tasks.endSegment(run.id,run.epoch,{status:'completed',text:'Original answer'},true);
  const summaries=()=>[f.tasks.readTask(f.actor,task.taskId).workers[0]!.run,f.tasks.workerRead(f.actor,{workerId:worker.workerId}).runs.find(row=>row.id===run.id)!];
  assert.equal(JSON.parse(f.tasks.run(run.id).checkpointJson!).workerExitConfirmed,1);for(const summary of summaries())assert.equal(summary.exitConfirmed,false);
  assert.throws(()=>f.tasks.workerSend(f.actor,{operationId:'owner-not-closed',workerId:worker.workerId,text:'Do not bypass the host owner'}),/run_stop_unconfirmed/);
  ownerClosed=true;const lease='synthetic-existing-owner';f.store.setMeta('lease:'+run.id,lease);for(const summary of summaries())assert.equal(summary.exitConfirmed,false);
  assert.equal(f.tasks.confirmWorkerExit(run.id,'different-owner'),false);assert.equal(f.store.meta('lease:'+run.id),lease);for(const summary of summaries())assert.equal(summary.exitConfirmed,false);
  assert.throws(()=>f.tasks.workerSend(f.actor,{operationId:'lease-not-closed',workerId:worker.workerId,text:'Do not bypass a different owner'}),/run_stop_unconfirmed/);
  assert.equal(f.tasks.confirmWorkerExit(run.id,lease),true);for(const summary of summaries())assert.equal(summary.exitConfirmed,true);
  assert.equal(f.tasks.runs(task.taskId).length,1);assert.equal(f.tasks.task(task.taskId).outcome,null);
 }finally{f.close();}
});

test('reading many historical Run summaries keeps lease-query cost constant and observes historical lease changes',()=>{
 let reviews=0;const f=chatFixture({validateActor(){},reviewExitConfirmed:run=>{reviews++;return !f.store.meta('lease:'+run.id);}});try{
  const task=f.create(),worker=f.tasks.workerOpen(f.actor,{operationId:'open',taskId:task.taskId,text:'Inspect'}),first=f.start(worker.workerId);f.tasks.endSegment(first.id,first.epoch,{status:'completed',text:'Original answer'},true);
  let metaReads=0;const prepare=f.store.db.prepare.bind(f.store.db);f.store.db.prepare=(sql:string)=>{if(/\bFROM\s+meta\b/i.test(sql))metaReads++;return prepare(sql);};
  reviews=0;const single=f.tasks.workerRead(f.actor,{workerId:worker.workerId}),singleReads=metaReads;assert.equal(single.runs.length,1);assert.equal(single.runs[0]!.exitConfirmed,true);assert.equal(reviews,1);
  for(let turn=0;turn<5;turn++){f.tasks.workerSend(f.actor,{operationId:'followup-'+turn,workerId:worker.workerId,text:'Continue within the same scope'});const run=f.start(worker.workerId);f.tasks.endSegment(run.id,run.epoch,{status:'completed',text:'Next original answer '+turn},true);}
  metaReads=0;reviews=0;const many=f.tasks.workerRead(f.actor,{workerId:worker.workerId});assert.equal(many.runs.length,6);assert.ok(many.runs.every(run=>run.exitConfirmed));assert.equal(metaReads,singleReads);assert.equal(reviews,1);
  f.store.setMeta('lease:'+first.id,'unknown-historical-owner');metaReads=0;reviews=0;const fenced=f.tasks.workerRead(f.actor,{workerId:worker.workerId});assert.equal(fenced.runs.find(run=>run.id===first.id)!.exitConfirmed,false);assert.equal(fenced.runs[0]!.exitConfirmed,true);assert.equal(metaReads,singleReads);assert.equal(reviews,1);assert.equal(f.tasks.runs(task.taskId).length,6);
 }finally{f.close();}
});

test('an idle conversation cannot resume while its immediate supplementation is uncertain',()=>{
 const f=chatFixture();try{
  const task=f.create(),worker=f.tasks.workerOpen(f.actor,{operationId:'open',taskId:task.taskId,text:'Investigate'}),run=f.start(worker.workerId);
  const steer=f.tasks.workerSend(f.actor,{operationId:'steer',workerId:worker.workerId,text:'Extra context',immediate:true});f.tasks.markSteer(steer.operationKey,'dispatching');f.tasks.markSteer(steer.operationKey,'uncertain');
  f.tasks.confirmWorkerExit(run.id,undefined);f.tasks.endSegment(run.id,run.epoch,{status:'completed',text:'Prior answer'},true);
  assert.throws(()=>f.tasks.workerSend(f.actor,{operationId:'new-message',workerId:worker.workerId,text:'Continue'}),/operation_uncertain/);
 }finally{f.close();}
});

test('public Worker files have durable idempotent receipts but no formal result',()=>{
 const f=chatFixture();try{
  const task=f.create(),worker=f.tasks.workerOpen(f.actor,{operationId:'open',taskId:task.taskId,text:'Write authorized draft'}),run=f.start(worker.workerId),actor={agentId:'worker:'+worker.workerId,runId:run.id,epoch:run.epoch,threadId:run.threadId!,turnId:run.turnId!};
  assert.equal(typeof f.tasks.writeFile,'function','file writing must not require a Contract or Result');
  const input={operationId:'native-file',filename:'draft.txt',bytes:Buffer.from('draft bytes')},written=f.tasks.writeFile(actor,input);assert.equal(readFileSync(written.path,'utf8'),'draft bytes');assert.deepEqual(f.tasks.writeFile(actor,input),written);
  assert.throws(()=>f.tasks.writeFile(actor,{...input,bytes:Buffer.from('different bytes')}),/payload_conflict/);
 }finally{f.close();}
});

test('an archive fact may carry its original authorized source into a new cleanup task only',()=>{
 const f=chatFixture();try{
  const task=f.create();f.source('unrelated','An unrelated task only');f.history.record('answer','thread:main','Investigation completed','completed','source:test');f.tasks.settleTask(f.actor,{operationId:'settle',taskId:task.taskId,expectedRevision:1,outcome:'succeeded'});
  const archived=f.tasks.archiveHistory(f.actor,{operationId:'archive',taskId:task.taskId,expectedRevision:2},true);assert.equal(archived.state,'archived');
  const notice=f.tasks.inbox(f.actor).find(message=>message.kind==='task_archived')!;
  f.store.db.prepare("UPDATE agent_receipts SET state='received',offeredTurnId='turn:archive' WHERE messageId=?").run(notice.id);
  const event={agentId:f.actor.agentId,threadId:f.actor.threadId,turnId:'turn:archive',inputMessageId:notice.id};
  const followup=f.tasks.createTask(event,{operationId:'cleanup',goal:'Review original temporary resources',authority:f.authority});
  assert.notEqual(followup.taskId,task.taskId);assert.equal(f.tasks.task(task.taskId).historyState,'archived');
  const cleanup=f.tasks.workerOpen(event,{operationId:'cleanup-worker',taskId:followup.taskId,text:'Review only authorized temporary resources'});assert.equal(f.start(cleanup.workerId).phase,'executing');
  assert.throws(()=>f.tasks.createTask(event,{operationId:'unrelated',goal:'Expand scope',authority:{...f.authority,sourceRequestId:'unrelated'}}),/source_denied/);
  assert.throws(()=>f.tasks.workerOpen(event,{operationId:'reopen',taskId:task.taskId,text:'Restart original'}),/history_not_visible/);
 }finally{f.close();}
});

for(const outcome of ['succeeded','partial'] as const)test('archive only accepts actual Main completion evidence for '+outcome,()=>{
 const f=chatFixture();try{
  f.source('unrelated-source','A separate unrelated request');
  const task=f.create(),authority=f.tasks.authority(task.taskId,1),originals=f.inputs.list().map(({seq,input})=>({seq,requestId:input.requestId,text:input.text}));
  f.history.record('unrelated-answer',f.actor.threadId!,'Only the unrelated request is completed','completed','unrelated-source');
  f.tasks.settleTask(f.actor,{operationId:'settle',taskId:task.taskId,expectedRevision:1,outcome});
  const missing=f.tasks.archiveHistory(f.actor,{operationId:'archive-with-unrelated-answer',taskId:task.taskId,expectedRevision:2},true);
  assert.equal(missing.state,'skipped');assert.deepEqual(missing.blockers,[{reason:'completion_evidence_missing'}]);
  f.history.record('actual-answer',f.actor.threadId!,'This is the actual completed answer','completed','source:test');
  const archived=f.tasks.archiveHistory(f.actor,{operationId:'archive-with-actual-answer',taskId:task.taskId,expectedRevision:2},true);
  assert.equal(archived.state,'archived');
  assert.deepEqual(f.tasks.authority(task.taskId,1),authority);assert.deepEqual(f.inputs.list().map(({seq,input})=>({seq,requestId:input.requestId,text:input.text})),originals);
  assert.equal(f.tasks.runs(task.taskId).length,0);assert.equal(f.tasks.inbox(f.actor).filter(message=>message.kind==='task_archived').length,1);
 }finally{f.close();}
});

test('a processed receipt alone cannot archive while its Main consumer is still running',()=>{
 const f=chatFixture();try{
  const task=f.create(),worker=f.tasks.workerOpen(f.actor,{operationId:'open',taskId:task.taskId,text:'Investigate'}),run=f.start(worker.workerId),reply=f.tasks.endSegment(run.id,run.epoch,{status:'completed',text:'Actual answer'},true)!;
  f.store.db.prepare("UPDATE agent_receipts SET state='processed' WHERE messageId=?").run(reply.messageId);
  f.tasks.settleTask(f.actor,{operationId:'settle',taskId:task.taskId,expectedRevision:1,outcome:'succeeded'});
  f.store.setMeta('publicMainNode:v1:pending',JSON.stringify({threadId:'thread:main',sourceMessageIds:[reply.messageId],state:'working',status:'running'}));
  const result=f.tasks.archiveHistory(f.actor,{operationId:'archive',taskId:task.taskId,expectedRevision:2},true);
  assert.equal(result.state,'skipped');assert.ok(result.blockers?.some(blocker=>blocker.reason==='coordination_consumer_unresolved'));
 }finally{f.close();}
});

test('public activity keeps a bounded real entity link without recording user content',()=>{
 const f=chatFixture();try{
  const task=f.create(),receipt=f.tasks.workerOpen(f.actor,{operationId:'open',taskId:task.taskId,text:'private worker instructions'});
  const activity=f.tasks.captureActivity(f.actor,'worker_open',{taskId:task.taskId,message:'private worker instructions'},receipt)!;
  assert.ok(activity);assert.equal(activity.target?.taskId,task.taskId);assert.equal(JSON.stringify(activity).includes('private worker instructions'),false);
  assert.equal(f.tasks.activityLink(activity.target!,'thread:main')!.task.taskId,task.taskId);assert.equal(f.tasks.activityLink(activity.target!,'another-thread'),undefined);
 }finally{f.close();}
});

test('a queued message cannot automatically resume a session with an unknown steer receipt',()=>{
 const f=chatFixture();try{
  const task=f.create(),worker=f.tasks.workerOpen(f.actor,{operationId:'open',taskId:task.taskId,text:'Investigate'}),run=f.start(worker.workerId);
  f.tasks.workerSend(f.actor,{operationId:'queued',workerId:worker.workerId,text:'Follow up'});
  const steer=f.tasks.workerSend(f.actor,{operationId:'steer',workerId:worker.workerId,text:'Immediate context',immediate:true});f.tasks.markSteer(steer.operationKey,'uncertain');
  f.tasks.confirmWorkerExit(run.id,undefined);f.tasks.endSegment(run.id,run.epoch,{status:'completed',text:'Prior answer'},true);
  assert.equal(f.tasks.claim(),undefined);assert.equal(f.tasks.runs(task.taskId).length,1);
 }finally{f.close();}
});

test('an empty terminal list cannot erase the public partial output checkpoint',()=>{
 const f=chatFixture();try{
  const task=f.create(),worker=f.tasks.workerOpen(f.actor,{operationId:'open',taskId:task.taskId,text:'Investigate'}),run=f.start(worker.workerId);
  f.tasks.recordWorkerOutput(run.id,run.epoch,{threadId:run.threadId!,turnId:run.turnId!,itemId:'public:partial',phase:'commentary',text:'Observed partial evidence.\n\nStill incomplete.'});
  const returned=f.tasks.endSegment(run.id,run.epoch,{status:'failed',text:'',messages:[],errorCode:'connection_lost'},true)!;
  const message=f.store.db.prepare('SELECT payloadJson FROM agent_messages WHERE id=?').get(returned.messageId)!;const payload=JSON.parse(String(message.payloadJson));
  assert.equal(payload.text,'Observed partial evidence.\n\nStill incomplete.');assert.equal(payload.messages[0].itemId,'public:partial');assert.equal(f.tasks.task(task.taskId).state,'open');
 }finally{f.close();}
});

test('a revoked goal stops every old Run and retains actual source/version for late output',()=>{
 const f=chatFixture();try{
  const task=f.create(),a=f.tasks.workerOpen(f.actor,{operationId:'a',taskId:task.taskId,text:'A'}),b=f.tasks.workerOpen(f.actor,{operationId:'b',taskId:task.taskId,text:'B'}),run=f.start(a.workerId);
  f.tasks.recordWorkerOutput(run.id,run.epoch,{threadId:run.threadId!,turnId:run.turnId!,itemId:'old',phase:'final_answer',text:'Original version answer'});
  f.source('source:changed','Withdraw previous scope; read only the new topic');const actor={...f.actor,sourceRequestId:'source:changed'};
  const update=f.tasks.updateTask(actor,{operationId:'requirements',taskId:task.taskId,expectedRevision:1,patch:{goal:'New topic; read only'},authority:{...f.authority,sourceRequestId:'source:changed',description:'New topic only'}});
  assert.deepEqual(new Set(update.targets),new Set([run.id,b.runId]));assert.equal(f.tasks.task(task.taskId).controlState,'stopping');assert.equal(f.tasks.claim(b.runId),undefined);
  assert.throws(()=>f.tasks.workerOpen(actor,{operationId:'forbidden',taskId:task.taskId,text:'Start new'}),/stop_requested/);assert.throws(()=>f.tasks.confirmStop(update.operationKey,true),/stop_unconfirmed/);
  assert.equal(f.tasks.endSegment(run.id,run.epoch,{status:'completed',text:'Late unsafe callback'},true),undefined);
  f.tasks.confirmWorkerExit(run.id,undefined);f.tasks.confirmStop(update.operationKey,true);assert.equal(f.tasks.task(task.taskId).controlState,'normal');
  const reply=f.tasks.inbox(f.actor).find(message=>message.senderRunId===run.id)!;assert.equal(reply.taskVersion,1);assert.equal(reply.payload.text,'Original version answer');
  assert.equal(f.tasks.version(task.taskId,2).sourceRequestId,'source:changed');assert.equal(f.tasks.operation(f.tasks.version(task.taskId,2).triggerOpId).operationId,'requirements');
  const followup=f.tasks.workerSend(actor,{operationId:'new-round',workerId:a.workerId,text:'Use the new topic'});assert.equal(f.tasks.run(followup.runId!).version,2);assert.equal(f.tasks.run(followup.runId!).threadId,run.threadId);
 }finally{f.close();}
});

test('same-thread ownership and concurrent followups leave only one active Run',()=>{
 const f=chatFixture();try{
  const task=f.create(),a=f.tasks.workerOpen(f.actor,{operationId:'a',taskId:task.taskId,text:'A'}),run=f.start(a.workerId);
  f.tasks.endSegment(run.id,run.epoch,{status:'completed',text:'Answer'},true);
  const first=f.tasks.workerSend(f.actor,{operationId:'followup-a',workerId:a.workerId,text:'Follow up one'}),second=f.tasks.workerSend(f.actor,{operationId:'followup-b',workerId:a.workerId,text:'Follow up two'});
  assert.ok(first.runId);assert.equal(second.runId,null);assert.equal(f.tasks.runs(task.taskId,a.workerId).filter(run=>run.status==='queued').length,1);
  const b=f.tasks.workerOpen(f.actor,{operationId:'b',taskId:task.taskId,text:'B'}),br=f.tasks.claim(b.runId)!;
  assert.throws(()=>f.tasks.bind(br.id,br.epoch,run.threadId!,'turn:b'),/thread_conflict/);
  assert.equal(f.tasks.run(first.runId!).threadId,run.threadId);
 }finally{f.close();}
});

test('reply/receipt/checkpoint cleanup is atomic, retriable, and native identities preserve equal text',()=>{
 const f=chatFixture();try{
  const task=f.create(),worker=f.tasks.workerOpen(f.actor,{operationId:'open',taskId:task.taskId,text:'Investigate'}),run=f.start(worker.workerId),message={threadId:run.threadId!,turnId:run.turnId!,itemId:'native:1',phase:'final_answer',text:'same'};
  f.tasks.recordWorkerOutput(run.id,run.epoch,message);f.tasks.recordWorkerOutput(run.id,run.epoch,message);f.tasks.recordWorkerOutput(run.id,run.epoch,{...message,itemId:'native:2'});
  f.store.db.exec("CREATE TRIGGER reject_return BEFORE INSERT ON agent_receipts WHEN NEW.recipientAgentId='main:test' BEGIN SELECT RAISE(ABORT,'return_write_failed'); END");
  assert.throws(()=>f.tasks.endSegment(run.id,run.epoch,{status:'completed',text:''},true),/return_write_failed/);assert.equal(f.tasks.inbox(f.actor).length,0);assert.equal(JSON.parse(f.tasks.run(run.id).checkpointJson!).workerOutput.length,2);
  f.store.db.exec('DROP TRIGGER reject_return');const returned=f.tasks.endSegment(run.id,run.epoch,{status:'completed',text:''},true)!;
  assert.deepEqual(f.tasks.endSegment(run.id,run.epoch,{status:'completed',text:''},true),returned);assert.equal(f.tasks.inbox(f.actor).length,1);
  const payload=f.tasks.inbox(f.actor)[0]!.payload;assert.equal(payload.text,'same\n\nsame');assert.deepEqual(payload.messages.map((message:{itemId:string})=>message.itemId),['native:1','native:2']);assert.equal(JSON.parse(f.tasks.run(run.id).checkpointJson!).workerOutput,undefined);
 }finally{f.close();}
});

test('a committed open is linked to its input after reopening and its receipt does not open another Worker',()=>{
 const f=chatFixture();let reopened:Store|undefined;try{
  const task=f.create(),input={operationId:'native:open',taskId:task.taskId,text:'Investigate'};const receipt=f.tasks.workerOpen(f.actor,input);
  reopened=new Store(f.path);const tasks=new RecursiveTasks(reopened,f.files);tasks.migrate();
  const actions=tasks.operationsForInput(f.actor,f.actor.inputMessageId!);assert.ok(actions.some(action=>action.kind==='worker_open'&&action.response.workerId===receipt.workerId));
  assert.deepEqual(tasks.workerOpen(f.actor,input),receipt);assert.equal(tasks.workers(task.taskId).length,1);
  assert.throws(()=>tasks.workerOpen(f.actor,{...input,text:'Different work'}),/payload_conflict/);
 }finally{reopened?.close();f.close();}
});

test('native-call payload survives refreshed hidden CAS while changed business arguments conflict',()=>{
 const f=chatFixture();try{
  const task=f.create(),actor={...f.actor,operationPayload:{tool:'task_update',arguments:{taskId:task.taskId,notes:'Preserve note'}}};
  const input={operationId:'native:notes',taskId:task.taskId,expectedRevision:1,patch:{notes:'Preserve note'}},receipt=f.tasks.updateTask(actor,input);
  assert.deepEqual(f.tasks.updateTask(actor,{...input,expectedRevision:2}),receipt);
  assert.throws(()=>f.tasks.updateTask({...actor,operationPayload:{tool:'task_update',arguments:{taskId:task.taskId,notes:'Different'}}},{...input,expectedRevision:2,patch:{notes:'Different'}}),/payload_conflict/);
  }finally{f.close();}
});

import {DatabaseSync} from 'node:sqlite';

test('an empty legacy layout and a relabeled incompatible layout are rejected before any database write',()=>{
 const base=resolve('.codex/scratch/chat-architecture-implementation-20261105');const dir=mkdtempSync(join(base,'schema-'));
 try{
  for(const version of [null,'5','6']){
   const path=join(dir,'old-'+String(version)+'.sqlite'),db=new DatabaseSync(path);db.exec('CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);CREATE TABLE matters(id TEXT PRIMARY KEY);CREATE TABLE runs(id TEXT PRIMARY KEY,matterId TEXT);');if(version)db.prepare('INSERT INTO meta VALUES(?,?)').run('recursiveSchemaVersion',version);db.close();
   const before=readFileSync(path);assert.throws(()=>new Store(path),/recursive_schema_unsupported/);assert.deepEqual(readFileSync(path),before);
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('notes remain editable while paused or settled and cannot release an outstanding stop',()=>{
 const f=chatFixture();try{
  const task=f.create(),worker=f.tasks.workerOpen(f.actor,{operationId:'open',taskId:task.taskId,text:'Investigate'}),run=f.start(worker.workerId),stop=f.tasks.controlTask(f.actor,{operationId:'pause',taskId:task.taskId,expectedRevision:1,action:'pause'});
  f.tasks.updateTask(f.actor,{operationId:'waiting-note',taskId:task.taskId,expectedRevision:2,patch:{notes:'Waiting for confirmed exit'}});assert.equal(f.tasks.task(task.taskId).controlState,'stopping');assert.equal(f.tasks.claim(),undefined);
  f.tasks.confirmWorkerExit(run.id,undefined);f.tasks.confirmStop(stop.operationKey,true);const paused=f.tasks.task(task.taskId);
  f.tasks.updateTask(f.actor,{operationId:'paused-note',taskId:task.taskId,expectedRevision:paused.revision,patch:{notes:'Paused deliberately'}});assert.equal(f.tasks.task(task.taskId).state,'paused');
  f.tasks.controlTask(f.actor,{operationId:'resume',taskId:task.taskId,expectedRevision:f.tasks.task(task.taskId).revision,action:'resume'});
  f.tasks.settleTask(f.actor,{operationId:'settle',taskId:task.taskId,expectedRevision:f.tasks.task(task.taskId).revision,outcome:'partial'});
  f.tasks.updateTask(f.actor,{operationId:'settled-note',taskId:task.taskId,expectedRevision:f.tasks.task(task.taskId).revision,patch:{notes:'Final limitation recorded'}});assert.equal(f.tasks.task(task.taskId).state,'settled');assert.equal(f.tasks.task(task.taskId).outcome,'partial');assert.equal(f.tasks.task(task.taskId).notes,'Final limitation recorded');
 }finally{f.close();}
});

test('task discovery omits raw bodies and Worker reads page the exact long original',()=>{
 const f=chatFixture();try{
  const task=f.create(),worker=f.tasks.workerOpen(f.actor,{operationId:'open',taskId:task.taskId,text:'Investigate'}),run=f.start(worker.workerId),body='汉'.repeat(49000)+'\n\n/file/report.txt';
  const reply=f.tasks.endSegment(run.id,run.epoch,{status:'completed',text:body,messages:[{itemId:'long-native',phase:'final_answer',text:body}]},true)!;
  const detail=f.tasks.readTask(f.actor,task.taskId);assert.equal(JSON.stringify(detail).includes('汉'.repeat(24001)),false,'task read must not expand original message bodies');
  const messages=f.tasks.workerRead(f.actor,{workerId:worker.workerId}).messages;assert.equal(JSON.stringify(messages).includes('汉'.repeat(24001)),false,'raw payloadJson must not bypass text pagination');
  let offset=0,all='';do{const page=f.tasks.workerRead(f.actor,{workerId:worker.workerId,messageId:reply.messageId,offset}).messages[0]!;all+=page.text;offset=page.nextOffset??-1;}while(offset>=0);assert.equal(all,body);
 }finally{f.close();}
});

test('public output observed while stopping stays attached to the actual old requirements version',()=>{
 const f=chatFixture();try{
  const task=f.create(),worker=f.tasks.workerOpen(f.actor,{operationId:'open',taskId:task.taskId,text:'Inspect v1'}),run=f.start(worker.workerId);
  const changed=f.tasks.updateTask(f.actor,{operationId:'change',taskId:task.taskId,expectedRevision:1,patch:{goal:'Follow the new user instruction'},authority:f.authority});
  const terminal={status:'completed' as const,text:'Final old-version paragraph.',messages:[{itemId:'late-old-final',phase:'final_answer',text:'Final old-version paragraph.'}]};
  f.tasks.recordWorkerOutput(run.id,run.epoch,{threadId:run.threadId!,turnId:run.turnId!,itemId:'late-old-final',phase:'final_answer',text:terminal.text});f.tasks.recordWorkerTerminal(run.id,run.epoch,terminal);
  assert.equal(f.tasks.confirmWorkerExit(run.id,undefined),true);f.tasks.confirmStop(changed.operationKey,true);
  const reply=f.tasks.inbox(f.actor).find(message=>message.kind==='worker_reply'&&message.senderRunId===run.id)!;
  assert.equal(reply.taskVersion,1);assert.equal(reply.payload.version,1);assert.equal(reply.payload.text,terminal.text);assert.equal(reply.payload.messages[0].itemId,'late-old-final');assert.equal(f.tasks.task(task.taskId).headVersion,2);
 }finally{f.close();}
});

test('file receipt replay cannot disclose a protected path',()=>{
 let deniedPath='';const f=chatFixture({validateActor(){},validateFileRead(path){if(path===deniedPath)throw Error('artifact_path_denied');}});
 try{
  const task=f.create(),worker=f.tasks.workerOpen(f.actor,{operationId:'write-worker',taskId:task.taskId,text:'Write authorized output'}),run=f.start(worker.workerId);
  const actor={agentId:'worker:'+run.workerId,runId:run.id,epoch:run.epoch,threadId:run.threadId!,turnId:run.turnId!,operationPayload:{tool:'stage_file_result',arguments:{filename:'report.txt',assetId:'source-one',revision:1}}};
  const output=f.tasks.writeFile(actor,{operationId:'write-report',filename:'report.txt',bytes:Buffer.from('legitimate report')});
  assert.deepEqual(f.tasks.readFileReceipt(actor,'write-report'),output);
  deniedPath=join(f.dir,'synthetic-private.txt');writeFileSync(deniedPath,'synthetic private bytes');
  f.store.db.prepare('UPDATE operations SET responseJson=? WHERE id=?').run(JSON.stringify({...output,path:deniedPath}),output.operationKey);
  assert.throws(()=>f.tasks.readFileReceipt(actor,'write-report'),/artifact_path_denied/);
  assert.equal(readFileSync(deniedPath,'utf8'),'synthetic private bytes');
 }finally{f.close();}
});

test('a different native file operation cannot claim an existing identical file',()=>{
 const f=chatFixture();try{
  const task=f.create(),worker=f.tasks.workerOpen(f.actor,{operationId:'open',taskId:task.taskId,text:'Write'}),run=f.start(worker.workerId),actor={agentId:'worker:'+worker.workerId,runId:run.id,epoch:run.epoch,threadId:run.threadId!,turnId:run.turnId!};
  const input={operationId:'original-call',filename:'same.txt',bytes:Buffer.from('identical bytes')},first=f.tasks.writeFile(actor,input);
  assert.deepEqual(f.tasks.writeFile(actor,input),first);
  for(let i=0;i<2;i++)assert.throws(()=>f.tasks.writeFile(actor,{...input,operationId:'different-call'}),/artifact_filename_conflict/);
  assert.equal(readFileSync(first.path,'utf8'),'identical bytes');assert.equal(f.store.db.prepare('SELECT state FROM operations WHERE operationId=?').get('different-call')!.state,'failed');
  const raw={...actor,operationPayload:{tool:'stage_file_result',arguments:{filename:'selected.txt',assetId:'source-one',revision:1}}},selected={...input,operationId:'selected-call',filename:'selected.txt'};f.tasks.writeFile(raw,selected);
  assert.throws(()=>f.tasks.writeFile({...raw,operationPayload:{tool:'stage_file_result',arguments:{filename:'selected.txt',assetId:'source-two',revision:1}}},selected),/operation_payload_conflict/);
 }finally{f.close();}
});

import {RecursiveTools} from '../src/recursive-tools.js';
test('deterministic file rejection terminates its operation without blocking explicit task settlement',()=>{
 const f=chatFixture();try{
  const task=f.create(),worker=f.tasks.workerOpen(f.actor,{operationId:'open',taskId:task.taskId,text:'Write'}),run=f.start(worker.workerId),actor={agentId:'worker:'+run.workerId,runId:run.id,epoch:run.epoch,threadId:run.threadId!,turnId:run.turnId!};
  assert.throws(()=>f.tasks.writeFile(actor,{operationId:'bad-name',filename:'bad name.txt',bytes:Buffer.from('Draft')}),/artifact_path_denied/);
  assert.throws(()=>f.tasks.writeFile(actor,{operationId:'empty-file',filename:'empty.txt',bytes:Buffer.alloc(0)}),/file_type_or_size_denied/);
  assert.deepEqual(f.store.db.prepare("SELECT state FROM operations WHERE operationId IN ('bad-name','empty-file')").all().map(row=>row.state),['failed','failed']);
  f.tasks.endSegment(run.id,run.epoch,{status:'completed',text:'No file was written'},true);assert.equal(f.tasks.settleTask(f.actor,{operationId:'settle',taskId:task.taskId,expectedRevision:1,outcome:'failed'}).state,'settled');
 }finally{f.close();}
});

test('a definitive steer failure rejects its targeted message while an unknown steer still blocks',()=>{
 const f=chatFixture();try{
  const task=f.create(),worker=f.tasks.workerOpen(f.actor,{operationId:'open',taskId:task.taskId,text:'Inspect'}),run=f.start(worker.workerId),steer=f.tasks.workerSend(f.actor,{operationId:'steer',workerId:worker.workerId,text:'Supplement',immediate:true});
  f.tasks.markSteer(steer.operationKey,'failed');f.tasks.markSteer(steer.operationKey,'received');assert.equal(f.tasks.operation(steer.operationKey).state,'failed');assert.equal(f.store.db.prepare('SELECT state FROM agent_receipts WHERE messageId=?').get(steer.messageId)!.state,'rejected');
  f.tasks.endSegment(run.id,run.epoch,{status:'completed',text:'Answer'},true);f.tasks.settleTask(f.actor,{operationId:'settle',taskId:task.taskId,expectedRevision:1,outcome:'succeeded'});
  for(const message of f.tasks.inbox(f.actor))f.store.db.prepare("UPDATE agent_receipts SET state='processed' WHERE messageId=?").run(message.id);
  assert.equal(f.tasks.archiveHistory(f.actor,{operationId:'archive',taskId:task.taskId,expectedRevision:2},true).state,'archived');
 }finally{f.close();}
});

test('cancelling without live executions rejects unbound queued conversation inputs atomically',()=>{
 const f=chatFixture();try{
  const task=f.create(),worker=f.tasks.workerOpen(f.actor,{operationId:'open',taskId:task.taskId,text:'Inspect'}),run=f.start(worker.workerId),queued=f.tasks.workerSend(f.actor,{operationId:'queue',workerId:worker.workerId,text:'Follow up'});assert.equal(queued.runId,null);
  f.tasks.endSegment(run.id,run.epoch,{status:'completed',text:'Answer'},true);const cancelled=f.tasks.controlTask(f.actor,{operationId:'cancel',taskId:task.taskId,expectedRevision:1,action:'cancel'});assert.deepEqual(cancelled.targets,[]);assert.equal(f.store.db.prepare('SELECT state FROM agent_receipts WHERE messageId=?').get(queued.messageId)!.state,'rejected');assert.equal(f.tasks.claim(),undefined);
  for(const message of f.tasks.inbox(f.actor))f.store.db.prepare("UPDATE agent_receipts SET state='processed' WHERE messageId=?").run(message.id);
  assert.equal(f.tasks.archiveHistory(f.actor,{operationId:'archive',taskId:task.taskId,expectedRevision:2},true).state,'archived');
 }finally{f.close();}
});

test('Worker original-message paging exposes native identity and every public phase without expanding bodies',()=>{
 const f=chatFixture();try{
  const task=f.create(),worker=f.tasks.workerOpen(f.actor,{operationId:'open',taskId:task.taskId,text:'Inspect'}),run=f.start(worker.workerId),commentary='🙂'.repeat(30000)+'\nOriginal paragraph.',final='Final exact answer.';
  const reply=f.tasks.endSegment(run.id,run.epoch,{status:'completed',text:final,messages:[{itemId:'original-commentary',phase:'commentary',text:commentary},{itemId:'original-final',phase:'final_answer',text:final}]},true)!;
  const listed=f.tasks.workerRead(f.actor,{workerId:worker.workerId}).messages.find(message=>message.id===reply.messageId)!;assert.deepEqual(listed.nativeMessages.map(message=>[message.itemId,message.phase]),[['original-commentary','commentary'],['original-final','final_answer']]);assert.equal(listed.text,final);assert.equal(JSON.stringify(listed).includes('🙂'.repeat(24001)),false);
  let offset=0,body='';do{const page=f.tasks.workerRead(f.actor,{workerId:worker.workerId,messageId:reply.messageId,itemId:'original-commentary',offset}).messages[0]!;assert.equal(page.itemId,'original-commentary');body+=page.text;offset=page.nextOffset??-1;}while(offset>=0);assert.equal(body,commentary);
  assert.throws(()=>f.tasks.workerRead(f.actor,{workerId:worker.workerId,messageId:reply.messageId,itemId:'unknown-native'}),/message_not_found/);
 }finally{f.close();}
});

for(const state of ['changed-goal','paused','stopping','cancelled'] as const)for(const explicitSources of [false,true])test(`a ${state} Task notification cannot derive fresh work using ${explicitSources?'explicit':'default'} historical sources`,()=>{
 const f=chatFixture();try{
  f.source('revised-source','Narrow the permitted work to the current requirement');
  const task=f.create(),worker=f.tasks.workerOpen(f.actor,{operationId:'open',taskId:task.taskId,text:'Inspect v1'}),run=f.start(worker.workerId),reply=f.tasks.endSegment(run.id,run.epoch,{status:'completed',text:'Original v1 paragraph.'},true)!;
  f.store.db.prepare("UPDATE agent_receipts SET state='received',offeredTurnId='turn:notification' WHERE messageId=?").run(reply.messageId);
  const event={agentId:f.actor.agentId,threadId:f.actor.threadId,turnId:'turn:notification',inputMessageId:reply.messageId};
  if(state==='changed-goal')f.tasks.updateTask({...f.actor,sourceRequestId:'revised-source'},{operationId:'change',taskId:task.taskId,expectedRevision:1,patch:{goal:'Follow only the narrowed v2 requirement'},authority:{...f.authority,sourceRequestId:'revised-source'}});
  else{
   if(state==='stopping'){const active=f.tasks.workerOpen(f.actor,{operationId:'active',taskId:task.taskId,text:'Still active'});f.start(active.workerId);}
   f.tasks.controlTask(f.actor,{operationId:'control',taskId:task.taskId,expectedRevision:1,action:state==='cancelled'?'cancel':'pause'});
  }
  const authority={...f.authority,...(explicitSources?{sourceRequestIds:['source:test']}:{})},before={tasks:f.tasks.tasks().length,runs:f.tasks.runs().length};
  assert.throws(()=>f.tasks.createTask(event,{operationId:'derive-stale-work',goal:'Repeat the old permitted scope',authority}),/task_authority_source_denied/);
  assert.deepEqual({tasks:f.tasks.tasks().length,runs:f.tasks.runs().length},before);assert.equal(f.store.db.prepare("SELECT 1 FROM operations WHERE operationId='derive-stale-work'").get(),undefined);
  assert.equal(f.tasks.workerRead(event,{workerId:worker.workerId,messageId:reply.messageId}).messages[0]!.text,'Original v1 paragraph.');
 }finally{f.close();}
});

test('a cancelled v1 interaction notification cannot derive work after v2 is effective',async()=>{
 const f=chatFixture();try{
  f.source('revised-source','Only the new narrower requirement remains authorized');
  const {WorkerInteractions}=await import('../src/worker-interactions.js'),interactions=new WorkerInteractions(f.store.db),task=f.create(),worker=f.tasks.workerOpen(f.actor,{operationId:'open',taskId:task.taskId,text:'Inspect v1'}),run=f.start(worker.workerId);
  const interaction=interactions.open({runId:run.id,threadId:run.threadId!,turnId:run.turnId!,requestId:'question',source:'native',kind:'question',details:{question:'Proceed with the old scope?'},authority:{sourceRequestId:'source:test',description:'Original scope',nativeApprovals:false}},()=>true);
  f.tasks.queueInteraction(interaction.id);const notice=f.tasks.inbox(f.actor).find(message=>message.kind==='interaction_required')!;
  f.store.db.prepare("UPDATE agent_receipts SET state='received',offeredTurnId='turn:old-interaction' WHERE messageId=?").run(notice.id);
  const change=f.tasks.updateTask({...f.actor,sourceRequestId:'revised-source'},{operationId:'change',taskId:task.taskId,expectedRevision:1,patch:{goal:'Use only v2'},authority:{...f.authority,sourceRequestId:'revised-source'}});
  interactions.cancelRun(run.id);assert.equal((await interaction.response).status,'cancelled');f.tasks.confirmWorkerExit(run.id,undefined);f.tasks.confirmStop(change.operationKey,true);
  const event={agentId:f.actor.agentId,threadId:f.actor.threadId,turnId:'turn:old-interaction',inputMessageId:notice.id};
  assert.throws(()=>f.tasks.createTask(event,{operationId:'derive-from-question',goal:'Proceed with the old scope',authority:f.authority}),/task_authority_source_denied/);
  assert.equal(f.tasks.task(task.taskId).headVersion,2);assert.equal(f.tasks.task(task.taskId).controlState,'normal');assert.equal(f.tasks.tasks().length,1);assert.equal(f.tasks.runs().length,1);
 }finally{f.close();}
});

test('a current visible Task reply may still derive authorized work and actually execute its Worker',()=>{
 const f=chatFixture();try{
  const task=f.create(),worker=f.tasks.workerOpen(f.actor,{operationId:'open',taskId:task.taskId,text:'Inspect'}),run=f.start(worker.workerId),reply=f.tasks.endSegment(run.id,run.epoch,{status:'completed',text:'Current original paragraph.'},true)!;
  f.store.db.prepare("UPDATE agent_receipts SET state='received',offeredTurnId='turn:current' WHERE messageId=?").run(reply.messageId);
  const event={agentId:f.actor.agentId,threadId:f.actor.threadId,turnId:'turn:current',inputMessageId:reply.messageId},derived=f.tasks.createTask(event,{operationId:'current-derived',goal:'Continue the authorized investigation',authority:f.authority}),next=f.tasks.workerOpen(event,{operationId:'current-worker',taskId:derived.taskId,text:'Inspect the current evidence'});
  assert.equal(f.start(next.workerId).phase,'executing');assert.equal(f.tasks.task(task.taskId).headVersion,1);
 }finally{f.close();}
});

test('an exact native file call can reread its committed receipt without producing source bytes again',()=>{
 const f=chatFixture();try{
  const task=f.create(),worker=f.tasks.workerOpen(f.actor,{operationId:'open',taskId:task.taskId,text:'Create the selected file'}),run=f.start(worker.workerId),actor={agentId:'worker:'+run.workerId,runId:run.id,epoch:run.epoch,threadId:run.threadId!,turnId:run.turnId!,operationPayload:{tool:'stage_file_result',arguments:{filename:'selected.txt',assetId:'original-source',revision:1}}};
  assert.equal(typeof f.tasks.readFileReceipt,'function','the receipt must be readable before media extraction or voice synthesis');assert.equal(f.tasks.readFileReceipt(actor,'native-write'),undefined);
  const written=f.tasks.writeFile(actor,{operationId:'native-write',filename:'selected.txt',bytes:Buffer.from('Original generated bytes')});assert.deepEqual(f.tasks.readFileReceipt(actor,'native-write'),written);assert.equal(f.tasks.readFileReceipt(actor,'new-call'),undefined);
  assert.throws(()=>f.tasks.readFileReceipt({...actor,operationPayload:{tool:'stage_file_result',arguments:{filename:'selected.txt',assetId:'different-source',revision:1}}},'native-write'),/operation_payload_conflict/);
  assert.throws(()=>f.tasks.readFileReceipt({...actor,epoch:actor.epoch+1},'native-write'),/run_epoch_stale/);}finally{f.close();}
});

for(const changed of ['bytes','receipt-size'] as const)test('file receipt replay verifies original '+changed,()=>{
 const f=chatFixture();try{
  const task=f.create(),worker=f.tasks.workerOpen(f.actor,{operationId:'open',taskId:task.taskId,text:'Write'}),run=f.start(worker.workerId),actor={agentId:'worker:'+run.workerId,runId:run.id,epoch:run.epoch,threadId:run.threadId!,turnId:run.turnId!,operationPayload:{tool:'create_voice_result',arguments:{filename:'voice',text:'Synthetic source text'}}};
  const written=f.tasks.writeFile(actor,{operationId:'native-voice',filename:'voice.silk',bytes:Buffer.from('Original audio bytes')});
  if(changed==='bytes')writeFileSync(written.path,'Changed audio bytes');else f.store.db.prepare('UPDATE operations SET responseJson=? WHERE id=?').run(JSON.stringify({...written,bytes:written.bytes+1}),written.operationKey);
  assert.throws(()=>f.tasks.readFileReceipt(actor,'native-voice'),/result_hash_mismatch/);assert.equal(f.tasks.operation(written.operationKey).state,'confirmed');
 }finally{f.close();}
});

test('file receipt rereading preserves unknown effects and definitive failure',()=>{
 let rejectCommit=true;const f=chatFixture({validateActor(){},operationConfirmed(_actor,_key,kind){if(kind==='write_file'&&rejectCommit)throw Error('synthetic_response_transaction_lost');}});
 try{
  const task=f.create(),worker=f.tasks.workerOpen(f.actor,{operationId:'open',taskId:task.taskId,text:'Write'}),run=f.start(worker.workerId),actor={agentId:'worker:'+run.workerId,runId:run.id,epoch:run.epoch,threadId:run.threadId!,turnId:run.turnId!,operationPayload:{tool:'stage_file_result',arguments:{filename:'pending.txt',assetId:'synthetic-media',revision:1}}},input={operationId:'uncertain-write',filename:'pending.txt',bytes:Buffer.from('Synthetic')};
  assert.throws(()=>f.tasks.writeFile(actor,input),/synthetic_response_transaction_lost/);assert.throws(()=>f.tasks.readFileReceipt(actor,input.operationId),/operation_uncertain/);
  rejectCommit=false;const recovered=f.tasks.writeFile(actor,input);assert.deepEqual(f.tasks.readFileReceipt(actor,input.operationId),recovered);
  const bad={...actor,operationPayload:{tool:'stage_file_result',arguments:{filename:'bad name.txt',assetId:'synthetic-media',revision:1}}};assert.throws(()=>f.tasks.writeFile(bad,{...input,operationId:'bad-name',filename:'bad name.txt'}),/artifact_path_denied/);assert.throws(()=>f.tasks.readFileReceipt(bad,'bad-name'),/artifact_path_denied/);
 }finally{f.close();}
});

test('a real cancelled-task archive permits lifecycle followup while old replies and restored archive facts stay fenced',()=>{
 const f=chatFixture();try{
  const task=f.create(),worker=f.tasks.workerOpen(f.actor,{operationId:'open',taskId:task.taskId,text:'Inspect'}),run=f.start(worker.workerId),reply=f.tasks.endSegment(run.id,run.epoch,{status:'completed',text:'Old business reply remains readable.'},true)!;
  f.tasks.controlTask(f.actor,{operationId:'cancel',taskId:task.taskId,expectedRevision:1,action:'cancel'});
  f.store.db.prepare("UPDATE agent_receipts SET state='received',offeredTurnId='turn:old' WHERE messageId=?").run(reply.messageId);
  const old={agentId:f.actor.agentId,threadId:f.actor.threadId,turnId:'turn:old',inputMessageId:reply.messageId};
  assert.throws(()=>f.tasks.createTask(old,{operationId:'recreate-cancelled',goal:'Repeat the cancelled business work',authority:f.authority}),/task_authority_source_denied/);
  f.store.db.prepare("UPDATE agent_receipts SET state='processed' WHERE messageId=?").run(reply.messageId);
  const archived=f.tasks.archiveHistory(f.actor,{operationId:'archive-cancelled',taskId:task.taskId,expectedRevision:2},true);assert.equal(archived.state,'archived');
  const notice=f.tasks.inbox(f.actor).find(message=>message.kind==='task_archived')!;f.store.db.prepare("UPDATE agent_receipts SET state='received',offeredTurnId='turn:archive-cancelled' WHERE messageId=?").run(notice.id);
  const event={agentId:f.actor.agentId,threadId:f.actor.threadId,turnId:'turn:archive-cancelled',inputMessageId:notice.id},cleanup=f.tasks.createTask(event,{operationId:'lifecycle-followup',goal:'Review only authorized temporary-resource lifecycle cleanup',authority:f.authority}),next=f.tasks.workerOpen(event,{operationId:'cleanup-worker',taskId:cleanup.taskId,text:'Preserve useful work and review authorized resource cleanup'});
  assert.equal(f.start(next.workerId).phase,'executing');assert.equal(f.tasks.task(task.taskId).state,'settled');assert.equal(f.tasks.task(task.taskId).outcome,'cancelled');assert.equal(f.tasks.task(task.taskId).historyState,'archived');assert.equal(f.tasks.workerRead(event,{workerId:worker.workerId,messageId:reply.messageId}).messages[0]!.text,'Old business reply remains readable.');
  assert.throws(()=>f.tasks.workerOpen(event,{operationId:'reopen-cancelled',taskId:task.taskId,text:'Repeat the cancelled work'}),/task_history_not_visible/);
  f.tasks.archiveHistory(f.actor,{operationId:'restore-cancelled',taskId:task.taskId,expectedRevision:3},false);
  assert.throws(()=>f.tasks.createTask(event,{operationId:'restored-old-archive',goal:'Act on an archive fact that no longer holds',authority:f.authority}),/task_authority_source_denied/);
  assert.equal(f.tasks.tasks().length,2);
 }finally{f.close();}
});

test('a later user reopens a settled Task without granting a stale Worker notification new work',()=>{
 const f=chatFixture();try{
  const task=f.create(),worker=f.tasks.workerOpen(f.actor,{operationId:'open',taskId:task.taskId,text:'Inspect v1'}),run=f.start(worker.workerId);
  const reply=f.tasks.endSegment(run.id,run.epoch,{status:'failed',text:'Exact original failure',errorCode:'synthetic_failure'},true)!;
  f.store.db.prepare("UPDATE agent_receipts SET state='received',offeredTurnId='turn:failure' WHERE messageId=?").run(reply.messageId);
  const event={agentId:f.actor.agentId,threadId:f.actor.threadId,turnId:'turn:failure',inputMessageId:reply.messageId};
  f.tasks.settleTask(event,{operationId:'settle',taskId:task.taskId,expectedRevision:1,outcome:'failed'});
  f.store.db.prepare("UPDATE agent_receipts SET state='processed' WHERE messageId=?").run(reply.messageId);
  const permission=f.source('later-permission','You may continue with the repair now'),permit={...f.actor,sourceRequestId:'later-permission',inputMessageId:permission.messageId},authority={...f.authority,sourceRequestId:'later-permission'};
  assert.throws(()=>f.tasks.createTask(event,{operationId:'borrow-permission',goal:'Borrow the later permission',authority}),/task_authority_source_denied/);
  assert.throws(()=>f.tasks.controlTask(f.actor,{operationId:'old-resume',taskId:task.taskId,expectedRevision:2,action:'resume',authority:f.authority}),/task_authority_source_denied/);
  const resumed=f.tasks.controlTask(permit,{operationId:'new-resume',taskId:task.taskId,expectedRevision:2,action:'resume',goal:'Repair after new permission',authority});
  assert.equal(resumed.state,'open');assert.equal(f.tasks.version(task.taskId,2).sourceRequestId,'later-permission');assert.equal(f.tasks.runs(task.taskId).length,1);
  f.store.db.prepare("UPDATE agent_receipts SET state='received' WHERE messageId=?").run(reply.messageId);
  assert.throws(()=>f.tasks.workerOpen(event,{operationId:'stale-open',taskId:task.taskId,text:'Continue old requirement'}),/task_authority_source_denied/);
  const next=f.tasks.workerOpen(permit,{operationId:'new-worker',taskId:task.taskId,text:'Repair only the newly approved scope'});
  assert.equal(f.start(next.workerId).version,2);
  assert.equal(f.tasks.workerRead(permit,{workerId:worker.workerId,messageId:reply.messageId}).messages[0]!.text,'Exact original failure');
  assert.equal(f.tasks.task(task.taskId).outcome,null);
 }finally{f.close();}
});

test('an archive notification cannot borrow a genuinely recorded but separate later source',()=>{
 const f=chatFixture();try{
  const task=f.create(),later=f.source('later-permission','Separate business followup');
  f.tasks.createTask({...f.actor,sourceRequestId:'later-permission',inputMessageId:later.messageId},{operationId:'separate',goal:'Record separate business followup'});
  f.tasks.settleTask(f.actor,{operationId:'settle',taskId:task.taskId,expectedRevision:1,outcome:'failed'});f.tasks.archiveHistory(f.actor,{operationId:'archive',taskId:task.taskId,expectedRevision:2},true);
  const notice=f.tasks.inbox(f.actor).find(message=>message.kind==='task_archived')!;
  f.store.db.prepare("UPDATE agent_receipts SET state='received',offeredTurnId='turn:archive' WHERE messageId=?").run(notice.id);
  const event={agentId:f.actor.agentId,threadId:f.actor.threadId,turnId:'turn:archive',inputMessageId:notice.id};
  assert.throws(()=>f.tasks.createTask(event,{operationId:'borrow',goal:'Restart unrelated work during cleanup',authority:{...f.authority,sourceRequestId:'later-permission'}}),/task_authority_source_denied/);
  assert.equal(f.tasks.tasks().length,2);
 }finally{f.close();}
});

test('a new Task cannot graft an older or reordered request into its execution authority',()=>{
 const f=chatFixture();try{
  const creator=f.inputs.accept({requestId:'creating-source',text:'Inspect the current requirement'}),restriction=f.inputs.accept({requestId:'latest-restriction',text:'Only narrower scope remains allowed'});
  const page=f.inputs.dispatchPage(undefined,'chronology','all'),latest=page.items.find(item=>item.messageId===restriction.queueMessageId)!;
  f.inputs.move({messageId:latest.messageId,operationId:'restriction-first',expectedRevision:latest.revision,threadId:f.actor.threadId!,readEpoch:'chronology',expectedOrderVersion:page.orderVersion,beforeMessageId:creator.queueMessageId!});
  const restricted=f.inputs.claim()!;assert.equal(restricted.input.requestId,'latest-restriction');f.inputs.started(restricted.messageId,restricted.revision,'generation:restriction','turn:restriction');f.inputs.finish(restricted.messageId,restricted.revision,'completed');
  const current=f.inputs.claim()!;assert.equal(current.input.requestId,'creating-source');f.inputs.started(current.messageId,current.revision,'generation:create','turn:create');
  const actor={...f.actor,sourceRequestId:'creating-source',inputMessageId:current.messageId,turnId:'turn:create'};
  const args={operationId:'create-current',text:'Inspect the current requirement',authority:{...f.authority,sourceRequestId:'creating-source'}};
  assert.throws(()=>f.tasks.workerOpen(actor,{...args,authority:{...args.authority,sourceRequestIds:['source:test','latest-restriction']}}),/task_authority_source_denied/);
  assert.equal(f.tasks.tasks().length,0);
  const accepted=f.tasks.workerOpen(actor,args);
  assert.equal(f.tasks.version(accepted.taskId,1).sourceRequestId,'creating-source');assert.equal(f.tasks.run(accepted.runId).sourceRequestId,'creating-source');
 }finally{f.close();}
});
