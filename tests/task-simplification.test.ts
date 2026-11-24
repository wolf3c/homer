import assert from 'node:assert/strict';
import test from 'node:test';
import {authority, fixture, main, mutation, openWorker, running} from './recursive-fixture.js';

test('first dispatch is atomic and reuses its original task and run',()=>{
 const f=fixture();
 try {
  const task=f.tasks.createTask(main,{operationId:'record',goal:'Investigate locally'});
  const input={operationId:'first-dispatch',taskId:task.taskId,authority:authority()};
  const opened=f.tasks.workerOpen(main,input);
  assert.deepEqual(f.tasks.workerOpen(main,input),opened);
  assert.equal(f.tasks.runs(opened.taskId).length,1);
  assert.equal(f.tasks.version(opened.taskId,1).goal,'Investigate locally');
  const taskCount=f.tasks.tasks().length;
  assert.throws(()=>f.tasks.workerOpen(main,{...input,operationId:'failed-first-dispatch'},()=>{throw Error('attachment_failed');}),/attachment_failed/);
  assert.equal(f.tasks.tasks().length,taskCount);
 } finally {f.close();}
});

test('recording an idea leaves dispatch to a separate call',()=>{
 const f=fixture();
 try {
  const idea=f.tasks.createTask(main,{operationId:'idea',goal:'Possibly write a handbook'});
  assert.equal(f.tasks.version(idea.taskId,1).authorityJson,null);
  assert.equal(f.tasks.runs(idea.taskId).length,0);
  assert.equal(f.tasks.workerOpen({...main,sourceRequestId:undefined},{operationId:'idea-dispatch',taskId:idea.taskId,text:'Write the handbook'}).state,'queued');
 } finally {f.close();}
});

test('archiving a record made without a user source routes its fact and preserves its receipt',()=>{
 const f=fixture();
 try {
  const idea=f.tasks.createTask({...main,sourceRequestId:undefined},{operationId:'internal-idea',goal:'Note an idea for later'});
  assert.equal(f.tasks.version(idea.taskId,1).sourceRequestId,null);
  const archiver=f.source('archive-idea');
  assert.equal(f.tasks.archiveHistory(archiver,mutation(f,'archive-idea',idea.taskId),true).state,'archived');
  const input=f.inputs.claim([],'all');
  assert.ok(input?.origin==='worker');
  assert.equal(input.kind,'task_archived');
  assert.equal(input.taskId,idea.taskId);
  assert.deepEqual(input.payload,{historyState:'archived',revision:f.tasks.task(idea.taskId).revision});
  f.store.transaction(()=>{f.processes.start({id:'archive-generation',threadId:main.threadId!,sourceKind:'worker',sourceMessageIds:[input.messageId],messageId:'archive-generation'},'archive-turn');f.tasks.receiveMainMessagesInTransaction([input.messageId],'archive-turn');});
  const event={...main,sourceRequestId:undefined,inputMessageId:input.messageId};
  const {taskId}=f.tasks.createTask(event,{operationId:'record-followup',goal:'Start work'});
  assert.equal(f.tasks.version(taskId,1).sourceRequestId,null);
  f.processes.reconcileUnknown(main.threadId!,true);f.inputs.reconcile();
  assert.equal(f.inputs.claim([],'all'),undefined,'confirmed receipt is never reoffered after owner closure');
  assert.equal(f.store.db.prepare('SELECT state FROM agent_receipts WHERE messageId=?').get(input.messageId)!.state,'received');
  assert.equal(f.processes.exact('archive-generation')!.status,'unknown');
  assert.equal(f.tasks.safeToUpgrade(),true);
 } finally {f.close();}
});

test('paused edits wait and resuming does not change the accepted version',()=>{
 const f=fixture();
 try {
  f.tasks.controlTask(main,{...mutation(f,'pause'),action:'pause'});
  const revised=f.source('revised');
  f.tasks.updateTask(revised,{...mutation(f,'edit'),patch:{goal:'Change requirements'}});
  assert.equal(f.tasks.task(f.task.taskId).state,'paused');
  assert.equal(f.tasks.claim(),undefined);
  const actor={...main,sourceRequestId:undefined};
  const input={...mutation(f,'continue'),action:'resume' as const};
  const receipt=f.tasks.controlTask(actor,input);
  assert.deepEqual(f.tasks.controlTask(actor,input),receipt);
  const current=f.tasks.task(f.task.taskId);
  assert.equal(current.headVersion,2);
  assert.equal(current.state,'open');
  assert.equal(f.tasks.version(f.task.taskId,2).goal,'Change requirements');
  assert.equal(f.tasks.claim(),undefined);
 } finally {f.close();}
});

test('a long-running task keeps the required sources across many incremental edits',()=>{
 const f=fixture();
 try {
  for(let n=0;n<24;n++){
   const source='edit-'+n,actor=f.source(source);
   f.tasks.updateTask(actor,{...mutation(f,source),patch:{goal:'Revised goal '+n}});
  }
  const version=f.tasks.task(f.task.taskId).headVersion;
  const current=f.tasks.version(f.task.taskId,version);
  assert.equal(current.sourceRequestId,'edit-23');
  assert.equal(f.tasks.readTask(main,f.task.taskId).sourceRequestIds.length,25);
 } finally {f.close();}
});

test('revocation removes the original message from readable history while resume keeps version',()=>{
 const f=fixture();
 try {
  const requestId=main.sourceRequestId!,threadId=main.threadId!;
  f.tasks.controlTask(main,{...mutation(f,'pause'),action:'pause'});
  const old=f.history.list(threadId).find(message=>message.requestId===requestId&&message.role==='user')!;
  assert.equal(f.history.revokeMessage(threadId,old.id),true);
  assert.throws(()=>f.tasks.source(main,requestId),/source_denied/);
  const fresh=f.source('renewed','Authorize continuation');
  const resumed=f.tasks.controlTask(fresh,{...mutation(f,'resume-revoked'),action:'resume'});
  assert.equal(resumed.version,1);
  assert.equal(f.tasks.version(f.task.taskId,1).sourceRequestId,requestId);
  assert.equal(f.tasks.claim(),undefined);
 } finally {f.close();}
});

test('a partial stop retains each proven exit and stays fenced until every original owner is gone',()=>{
 const f=fixture();
 try {
  const exited=openWorker(f,'exited'),unconfirmed=openWorker(f,'unconfirmed');
  running(f,exited.runId);running(f,unconfirmed.runId);
  f.store.setMeta('lease:'+unconfirmed.runId,'synthetic-unconfirmed-owner');
  const first=f.tasks.workerStop(main,{operationId:'first-stop',workerId:exited.workerId});
  const stop=f.tasks.workerStop(main,{operationId:'second-stop',workerId:unconfirmed.workerId});
  f.tasks.confirmWorkerExit(exited.runId,undefined);f.tasks.confirmStop(first.operationKey,true);
  assert.equal(f.tasks.confirmStop(stop.operationKey,false).state,'uncertain');
  assert.equal(f.tasks.workerRead(main,{workerId:exited.workerId}).runs[0]!.exitConfirmed,true);
  f.tasks.recoverWorkerOperations();
  assert.equal(f.tasks.operation(stop.operationKey).state,'uncertain');
  const paused=f.tasks.controlTask(main,{...mutation(f,'pause'),action:'pause'});
  assert.equal(paused.state,'paused');assert.ok(paused.blockers?.some(blocker=>blocker.runId===unconfirmed.runId));
  assert.equal(f.tasks.operation(stop.operationKey).state,'uncertain');
  f.tasks.confirmWorkerExit(unconfirmed.runId,'synthetic-unconfirmed-owner');
  f.tasks.recoverWorkerOperations();
  assert.equal(f.tasks.operation(stop.operationKey).state,'confirmed');
  assert.equal(f.tasks.controlTask(main,{...mutation(f,'pause-after-exits'),action:'pause'}).state,'paused');
  const receipts=f.tasks.inbox(main).filter(message=>message.kind==='worker_reply');
  assert.equal(receipts.length,2);
  assert.equal(receipts.find(message=>message.senderRunId===unconfirmed.runId)?.payload.execution.exitConfirmed,false);
  const confirmed=f.tasks.operation(stop.operationKey);
  f.tasks.recoverWorkerOperations();
  assert.deepEqual(f.tasks.operation(stop.operationKey),confirmed);
 } finally {f.close();}
});
