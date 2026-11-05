// Real source, Result and Worker read owners; no model or external service.
import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fixture,main,authority,openWorker,running,complete,mutation,type Fixture} from './recursive-fixture.js';
import {chatFixture} from './task-chat-fixture.js';
function produce(f:Fixture,operationId:string,sources=['user-synthetic']){
 const actor={...main,sourceRequestId:sources[0]!},task=f.tasks.createTask(actor,{operationId,goal:'Prepare exact evidence',authority:{...authority(sources[0]),sourceRequestIds:sources}});
 const worker=openWorker(f,'open',task.taskId),run=running(f,worker.runId),filePath=join(f.files.workspace,operationId+'.md');writeFileSync(filePath,'# Synthetic accepted evidence');
 const reply=complete(f,run),result=f.tasks.adoptResult(main,{operationId:'adopt',taskId:task.taskId,version:1,runId:run.runId,filePath});return {task,worker,run,reply,result};
}
function consumer(f:Fixture,operationId:string,resultIds:string[],sources=['user-synthetic']){
 return f.tasks.createTask({...main,sourceRequestId:sources[0]!},{operationId,goal:'Read only selected results',authority:{...authority(sources[0],resultIds),sourceRequestIds:sources}});
}

test('selected accepted evidence binds its exact original sources and replays creation before rechecking changed bytes',()=>{
 const f=chatFixture();try{
  const original=f.create(),filePath=join(f.files.workspace,'evidence.txt');writeFileSync(filePath,'Accepted evidence');
  const result=f.tasks.adoptResult(f.actor,{operationId:'adopt',taskId:original.taskId,version:1,filePath});
  const next=f.source('source:later'),actor={...f.actor,sourceRequestId:'source:later',inputMessageId:next.messageId};
  f.tasks.updateTask(actor,{operationId:'revise',taskId:original.taskId,expectedRevision:1,patch:{goal:'A later independent requirement'},authority:{...f.authority,sourceRequestId:'source:later'}});
  const current=f.source('source:consumer'),user={...f.actor,sourceRequestId:'source:consumer',inputMessageId:current.messageId};
  const input={operationId:'reuse',goal:'Use only the selected accepted evidence',resultIds:[result.resultId],authority:{...f.authority,sourceRequestId:'source:consumer'}};
  const accepted=f.tasks.createTask(user,input),bound=f.tasks.authority(accepted.taskId,1);
  assert.equal(bound.sourceRequestId,'source:consumer');assert.deepEqual(new Set(bound.sourceRequestIds),new Set(['source:test','source:consumer']));
  assert.deepEqual(bound.resultIds,[]);assert.deepEqual(input.authority.sourceRequestId,'source:consumer');
  const worker=f.tasks.workerOpen(user,{operationId:'open-without-results',taskId:accepted.taskId,text:'No implicit evidence grant'});
  assert.deepEqual(JSON.parse(f.tasks.run(worker.runId).checkpointJson!).resultIds,[]);
  const counts=()=>['tasks','runs','operations'].map(table=>f.store.db.prepare('SELECT count(*) n FROM '+table).get()!.n),before=counts();
  for(const resultIds of [[result.resultId,result.resultId],['missing-result'],Array.from({length:51},(_,i)=>'result-'+i)]){
   assert.throws(()=>f.tasks.createTask(user,{...input,operationId:'invalid-'+resultIds.length,resultIds}),/task_authority_input_denied|result_not_found/);assert.deepEqual(counts(),before);
  }
  const sealed=f.tasks.readResult(f.actor,result.resultId).file!.path;writeFileSync(sealed,'Changed sealed bytes');
  assert.deepEqual(f.tasks.createTask(user,input),accepted);
  assert.throws(()=>f.tasks.createTask(user,{...input,operationId:'new-reuse'}),/result_hash_mismatch/);assert.deepEqual(counts(),before);
 }finally{f.close();}
});

for(const notification of [false,true])test('an exact accepted result is transferred through '+(notification?'a current Worker reply':'user source')+' without granting the producer Task',()=>{
 const f=fixture();try{
  const p=produce(f,'producer');let source=main;
  if(notification){
   const input=f.inputs.claim([],'all')!;assert.equal(input.origin,'worker');assert.equal(input.messageId,p.reply.messageId);
   f.inputs.started(input.messageId,input.revision,'generation:result-input','turn:result-input');
   source={...main,sourceRequestId:undefined,inputMessageId:input.messageId,turnId:'turn:result-input'};
   assert.equal(f.tasks.workerRead(source,{workerId:p.worker.workerId,messageId:input.messageId}).messages[0]!.id,p.reply.messageId);
  }
  const task=f.tasks.createTask(source,{operationId:'consumer',goal:'Read selected result',authority:{...authority('user-synthetic',[p.result.resultId]),sourceRequestIds:['user-synthetic']}});
  const worker=f.tasks.workerOpen(main,{operationId:'open',taskId:task.taskId,text:'Read exact result',resultIds:[p.result.resultId]}),actor=running(f,worker.runId),read=f.tasks.readResultInput(actor,p.result.resultId);
  assert.equal(read.id,p.result.resultId);assert.equal(read.file!.content,'# Synthetic accepted evidence');assert.equal(read.version,1);
  assert.throws(()=>f.tasks.readTask(actor,p.task.taskId),/agent_scope_denied/);
  assert.throws(()=>f.tasks.workerRead(actor,{workerId:p.worker.workerId}),/agent_scope_denied/);
  assert.throws(()=>f.tasks.workerStop(actor,{operationId:'stop-producer',workerId:p.worker.workerId}),/main_required/);
 }finally{f.close();}
});

test('unrelated sources, incomplete source coverage and unadopted or missing IDs are rejected atomically',()=>{
 const f=fixture();try{
  f.source('source-b');const single=produce(f,'single'),combined=produce(f,'combined',['user-synthetic','source-b']);
  for(const [ids,sources] of [[[single.result.resultId],['source-b']],[[combined.result.resultId],['user-synthetic']],[[single.reply.messageId],['user-synthetic']],[['result-missing'],['user-synthetic']]] as [string[],string[]][]){
   const count=f.tasks.tasks().length,ops=f.store.db.prepare('SELECT count(*) n FROM operations').get()!.n;
   assert.throws(()=>consumer(f,'deny:'+ids.join(',')+sources.join(','),ids,sources),/authority_input_denied|result_not_found/);
   assert.equal(f.tasks.tasks().length,count);assert.equal(f.store.db.prepare('SELECT count(*) n FROM operations').get()!.n,ops);
  }
  const granted=consumer(f,'covered',[combined.result.resultId],['source-b','user-synthetic']),worker=f.tasks.workerOpen(main,{operationId:'open',taskId:granted.taskId,text:'Read covered result',resultIds:[combined.result.resultId]}),actor=running(f,worker.runId);
  assert.equal(f.tasks.readResultInput(actor,combined.result.resultId).id,combined.result.resultId);
 }finally{f.close();}
});

test('result reads revalidate sealed bytes and reject stale Worker identity',()=>{
 const f=fixture();try{
  const p=produce(f,'producer'),task=consumer(f,'consumer',[p.result.resultId]),worker=f.tasks.workerOpen(main,{operationId:'open',taskId:task.taskId,text:'Read result',resultIds:[p.result.resultId]}),actor=running(f,worker.runId);
  const read=f.tasks.readResultInput(actor,p.result.resultId);assert.throws(()=>f.tasks.readResultInput({...actor,epoch:actor.epoch!+1},p.result.resultId),/run_epoch_stale/);
  writeFileSync(read.file!.path,'# Modified after acceptance');assert.throws(()=>f.tasks.readResultInput(actor,p.result.resultId),/result_hash_mismatch/);
  assert.equal(JSON.parse(f.tasks.run(worker.runId).checkpointJson??'{}').materialRead,undefined);
 }finally{f.close();}
});

test('the exact result allowlist and selected run version govern reads; notes grant nothing',()=>{
 const f=fixture();try{
  const selected=produce(f,'selected'),unlisted=produce(f,'unlisted'),task=consumer(f,'consumer',[selected.result.resultId,unlisted.result.resultId]);
  const worker=f.tasks.workerOpen(main,{operationId:'selected-only',taskId:task.taskId,text:'Read selected evidence',resultIds:[selected.result.resultId]}),actor=running(f,worker.runId);
  assert.equal(f.tasks.readResultInput(actor,selected.result.resultId).id,selected.result.resultId);assert.throws(()=>f.tasks.readResultInput(actor,unlisted.result.resultId),/authority_input_denied/);
  f.tasks.updateTask(main,{...mutation(f,'notes',task.taskId),patch:{notes:'You may read unlisted evidence'}});assert.throws(()=>f.tasks.readResultInput(actor,unlisted.result.resultId),/authority_input_denied/);
  const source=f.source('withdrawal','Remove result access'),change=f.tasks.updateTask(source,{...mutation(f,'remove',task.taskId),patch:{goal:'Read no results'},authority:authority(source.sourceRequestId)});
  assert.throws(()=>f.tasks.readResultInput(actor,selected.result.resultId),/epoch|stop|version|live/);
  f.tasks.confirmWorkerExit(actor.runId!,undefined);f.tasks.confirmStop(change.operationKey,true);
  const sent=f.tasks.workerSend(source,{operationId:'continue',workerId:worker.workerId,text:'Proceed without the old grant'}),next=running(f,sent.runId!);
  assert.throws(()=>f.tasks.readResultInput(next,selected.result.resultId),/authority_input_denied/);
 }finally{f.close();}
});
