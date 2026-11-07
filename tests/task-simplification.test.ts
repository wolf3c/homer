import assert from 'node:assert/strict';
import test from 'node:test';
import {authority, fixture, main, mutation, openWorker, running} from './recursive-fixture.js';

test('first dispatch is atomic and reuses its original task and run',()=>{
 const f=fixture();
 try {
  const input={operationId:'first-dispatch',text:'Investigate locally',authority:authority()};
  const opened=f.tasks.workerOpen(main,input);
  assert.deepEqual(f.tasks.workerOpen(main,input),opened);
  assert.equal(f.tasks.runs(opened.taskId).length,1);
  assert.equal(f.tasks.version(opened.taskId,1).goal,input.text);
  const taskCount=f.tasks.tasks().length;
  assert.throws(()=>f.tasks.workerOpen(main,{...input,operationId:'failed-first-dispatch'},()=>{throw Error('attachment_failed');}),/attachment_failed/);
  assert.equal(f.tasks.tasks().length,taskCount);
 } finally {f.close();}
});

test('recording an idea without authority creates no Worker and cannot dispatch',()=>{
 const f=fixture();
 try {
  const idea=f.tasks.createTask(main,{operationId:'idea',goal:'Possibly write a handbook'});
  assert.equal(f.tasks.version(idea.taskId,1).authorityJson,null);
  assert.throws(()=>f.tasks.workerOpen(main,{operationId:'idea-dispatch',taskId:idea.taskId,text:'Write the handbook'}),/task_authority_source_denied/);
  assert.equal(f.tasks.runs(idea.taskId).length,0);
 } finally {f.close();}
});

test('archiving a record made without a user source routes its fact without granting execution',()=>{
 const f=fixture();
 try {
  const idea=f.tasks.createTask({...main,sourceRequestId:undefined},{operationId:'internal-idea',goal:'Note an idea for later'});
  assert.equal(f.tasks.version(idea.taskId,1).sourceRequestId,null);
  const archiver=f.source('archive-idea');
  f.tasks.settleTask(archiver,{...mutation(f,'close-idea',idea.taskId),outcome:'failed'});
  assert.equal(f.tasks.archiveHistory(archiver,mutation(f,'archive-idea',idea.taskId),true).state,'archived');
  const input=f.inputs.claim([],'all');
  assert.ok(input?.origin==='worker');
  assert.equal(input.kind,'task_archived');
  assert.equal(input.taskId,idea.taskId);
  assert.deepEqual(input.payload,{historyState:'archived',revision:f.tasks.task(idea.taskId).revision});
  f.inputs.started(input.messageId,input.revision,'archive-generation','archive-turn');
  const event={...main,sourceRequestId:undefined,inputMessageId:input.messageId};
  assert.throws(()=>f.tasks.workerOpen(event,{operationId:'dispatch-from-record',text:'Start work',authority:authority('archive-idea')}),/task_authority_source_denied/);
  f.inputs.reconcile();
  const resumed=f.inputs.claim([],'all');
  assert.ok(resumed?.origin==='worker');
  assert.equal(resumed.messageId,input.messageId);
  f.inputs.started(resumed.messageId,resumed.revision,'retry-archive-generation','retry-archive-turn');
  f.store.transaction(()=>f.tasks.completeMainMessagesInTransaction([resumed.messageId],'retry-archive-generation'));
  assert.equal(f.tasks.safeToUpgrade(),true);
 } finally {f.close();}
});

test('paused edits do not start work and settled tasks require newer real input',()=>{
 const f=fixture();
 try {
  f.tasks.controlTask(main,{...mutation(f,'pause'),action:'pause'});
  const revised=f.source('revised');
  f.tasks.updateTask(revised,{...mutation(f,'edit'),patch:{goal:'Change requirements'},authority:authority('revised')});
  assert.equal(f.tasks.task(f.task.taskId).state,'paused');
  assert.equal(f.tasks.claim(),undefined);
  f.tasks.controlTask(revised,{...mutation(f,'resume'),action:'resume'});
  assert.equal(f.tasks.task(f.task.taskId).headVersion,2);
  f.tasks.settleTask(revised,{...mutation(f,'settle'),outcome:'failed'});
  assert.throws(()=>f.tasks.controlTask(revised,{...mutation(f,'invalid-resume'),action:'resume',authority:authority('revised')}),/task_authority_source_denied/);
  const next=f.source('next');
  const input={...mutation(f,'continue'),action:'resume' as const,authority:authority('next'),goal:'Continue with a new requirement'};
  const receipt=f.tasks.controlTask(next,input);
  assert.deepEqual(f.tasks.controlTask(next,input),receipt);
  const current=f.tasks.task(f.task.taskId);
  assert.equal(current.headVersion,3);
  assert.equal(current.state,'open');
  assert.equal(current.outcome,null);
  assert.equal(current.settledAt,null);
  assert.equal(f.tasks.version(f.task.taskId,2).goal,'Change requirements');
  assert.equal(f.tasks.claim(),undefined);
 } finally {f.close();}
});

test('a long-running task keeps the required sources across many incremental edits',()=>{
 const f=fixture();
 try {
  for(let n=0;n<24;n++){
   const source='edit-'+n,actor=f.source(source);
   f.tasks.updateTask(actor,{...mutation(f,source),patch:{goal:'Revised goal '+n},authority:authority(source)});
  }
  const version=f.tasks.task(f.task.taskId).headVersion;
  const current=f.tasks.authority(f.task.taskId,version);
  assert.equal(current.sourceRequestId,'edit-23');
  assert.equal(f.tasks.validateAuthority(main,current).length,25);
 } finally {f.close();}
});

test('revocation removes authority while a later real request can supersede it',()=>{
 const f=fixture();
 try {
  const requestId=main.sourceRequestId!,threadId=main.threadId!;
  f.tasks.settleTask(main,{...mutation(f,'settle-revoked'),outcome:'failed'});
  const old=f.history.list(threadId).find(message=>message.requestId===requestId&&message.role==='user')!;
  assert.equal(f.history.revokeMessage(threadId,old.id),true);
  assert.throws(()=>f.tasks.source(main,requestId),/source_denied/);
  assert.throws(()=>f.tasks.validateAuthority(main,authority()),/source_denied/);
  const fresh=f.source('renewed','Authorize continuation');
  const resumed=f.tasks.controlTask(fresh,{...mutation(f,'resume-revoked'),action:'resume',authority:authority('renewed')});
  assert.equal(resumed.version,2);
  assert.equal(f.tasks.authority(f.task.taskId,2).sourceRequestId,'renewed');
  assert.equal(f.tasks.claim(),undefined);
 } finally {f.close();}
});

test('a partial stop retains each proven exit and stays fenced until every original owner is gone',()=>{
 const f=fixture();
 try {
  const exited=openWorker(f,'exited'),unconfirmed=openWorker(f,'unconfirmed');
  running(f,exited.runId);running(f,unconfirmed.runId);
  f.store.setMeta('lease:'+unconfirmed.runId,'synthetic-unconfirmed-owner');
  const stop=f.tasks.controlTask(main,{...mutation(f,'pause-both'),action:'pause'});
  f.tasks.confirmWorkerExit(exited.runId,undefined);
  assert.equal(f.tasks.confirmStop(stop.operationKey,false).state,'uncertain');
  assert.equal(f.tasks.workerRead(main,{workerId:exited.workerId}).runs[0]!.exitConfirmed,true);
  f.tasks.recoverWorkerOperations();
  assert.equal(f.tasks.operation(stop.operationKey).state,'uncertain');
  assert.equal(f.tasks.task(f.task.taskId).controlState,'stopping');
  f.tasks.confirmWorkerExit(unconfirmed.runId,'synthetic-unconfirmed-owner');
  f.tasks.recoverWorkerOperations();
  assert.equal(f.tasks.operation(stop.operationKey).state,'confirmed');
  assert.equal(f.tasks.task(f.task.taskId).state,'paused');
  const receipts=f.tasks.inbox(main).filter(message=>message.kind==='worker_reply');
  assert.equal(receipts.length,2);
  assert.equal(receipts.find(message=>message.senderRunId===unconfirmed.runId)?.payload.execution.exitConfirmed,false);
  const confirmed=f.tasks.operation(stop.operationKey);
  f.tasks.recoverWorkerOperations();
  assert.deepEqual(f.tasks.operation(stop.operationKey),confirmed);
 } finally {f.close();}
});
