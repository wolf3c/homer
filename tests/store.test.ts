import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,rmSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {Store} from '../src/store.js';
import {RecursiveTasks} from '../src/recursive-tasks.js';
import {chatFixture} from './task-chat-fixture.js';

test('durable conversation operations are idempotent and followups retain one task and thread',()=>{
 const f=chatFixture();try{
  const task=f.create(),input={operationId:'open',taskId:task.taskId,text:'Inspect the first source'};
  const first=f.tasks.workerOpen(f.actor,input);assert.deepEqual(f.tasks.workerOpen(f.actor,input),first);assert.equal(f.store.runs().length,1);
  const run=f.start(first.workerId);assert.equal(f.tasks.claim(run.id),undefined);f.tasks.failRun(run.id,run.epoch,'observed_failure');
  const next=f.tasks.workerSend(f.actor,{operationId:'followup',workerId:first.workerId,text:'Explain the failure'});
  assert.equal(f.tasks.run(next.runId!).workerId,first.workerId);assert.equal(f.tasks.run(next.runId!).threadId,run.threadId);assert.equal(f.tasks.run(next.runId!).taskId,task.taskId);
  assert.equal(f.store.runs().length,2);assert.equal(f.tasks.run(run.id).errorCode,'observed_failure');
 }finally{f.close();}
});

test('independent conversations claim together and changing one task fences only its old executions',()=>{
 const f=chatFixture();try{
  const a=f.create(),b=f.create('Independent task','other');
  const aa=f.tasks.workerOpen(f.actor,{operationId:'a',taskId:a.taskId,text:'A'}),bb=f.tasks.workerOpen(f.actor,{operationId:'b',taskId:b.taskId,text:'B'}),ar=f.start(aa.workerId),br=f.start(bb.workerId);
  assert.equal(f.store.runs().filter(run=>run.status==='running').length,2);
  const change=f.tasks.updateTask(f.actor,{operationId:'change',taskId:a.taskId,expectedRevision:1,patch:{goal:'Revised scope'},authority:f.authority});
  assert.deepEqual(change.targets,[ar.id]);assert.ok(f.tasks.run(ar.id).stopRequestedAt);assert.deepEqual(f.tasks.run(br.id),br);
  assert.equal(f.tasks.task(a.taskId).controlState,'stopping');assert.equal(f.tasks.task(b.taskId).controlState,'normal');
 }finally{f.close();}
});

test('stop intent is separate from confirmed exit and restart never replays old queued work',()=>{
 const f=chatFixture();try{
  const task=f.create(),a=f.tasks.workerOpen(f.actor,{operationId:'a',taskId:task.taskId,text:'A'}),b=f.tasks.workerOpen(f.actor,{operationId:'b',taskId:task.taskId,text:'B'}),run=f.start(a.workerId);
  const stop=f.tasks.workerStop(f.actor,{operationId:'stop',workerId:a.workerId});assert.equal(f.tasks.run(run.id).status,'running');assert.ok(f.tasks.run(run.id).stopRequestedAt);
  f.tasks.confirmStop(stop.operationKey,false);f.tasks.reconcile();assert.equal(f.tasks.run(run.id).phase,'uncertain');assert.equal(f.tasks.run(b.runId).status,'interrupted');assert.equal(f.tasks.claim(),undefined);
  assert.equal(f.tasks.endSegment(run.id,run.epoch,{status:'completed',text:'Late output'},true),undefined);
 }finally{f.close();}
});

test('terminal replies are idempotent and unknown steering survives reconciliation',()=>{
 const f=chatFixture();try{
  const task=f.create(),first=f.tasks.workerOpen(f.actor,{operationId:'open',taskId:task.taskId,text:'Inspect'}),run=f.start(first.workerId);
  const terminal={status:'completed' as const,text:'Observed answer'},reply=f.tasks.endSegment(run.id,run.epoch,terminal,true)!;
  assert.deepEqual(f.tasks.endSegment(run.id,run.epoch,terminal,true),reply);
  assert.equal(f.tasks.inbox(f.actor).filter(message=>message.kind==='worker_reply').length,1);
  const worker=f.tasks.workerOpen(f.actor,{operationId:'new',taskId:task.taskId,text:'Inspect next'}),second=f.start(worker.workerId);
  const sent=f.tasks.workerSend(f.actor,{operationId:'supplement',workerId:second.workerId,text:'Confirm unknown effect',immediate:true});
  f.tasks.markSteer(sent.operationKey,'dispatching');f.tasks.reconcile();f.tasks.reconcile();
  assert.equal(f.tasks.operation(sent.operationKey).state,'uncertain');
  assert.equal(f.tasks.claim(),undefined);
  assert.throws(()=>f.tasks.workerSend(f.actor,{operationId:'retry',workerId:second.workerId,text:'Retry unknown',immediate:true}),/operation_uncertain/);
 }finally{f.close();}
});

test('a reopened Store keeps history and persists unfinished original text exactly once without replay',()=>{
 const f=chatFixture();let second:Store|undefined;
 try{
  const task=f.create(),done=f.tasks.workerOpen(f.actor,{operationId:'done',taskId:task.taskId,text:'Complete'}),finished=f.start(done.workerId);f.tasks.failRun(finished.id,finished.epoch,'observed_failure');
  const worker=f.tasks.workerOpen(f.actor,{operationId:'active',taskId:task.taskId,text:'Inspect'}),run=f.start(worker.workerId);
  f.tasks.recordWorkerOutput(run.id,run.epoch,{threadId:run.threadId!,turnId:run.turnId!,itemId:'partial',phase:'final_answer',text:'Persisted original paragraph.'});
  f.store.close();second=new Store(f.path);const tasks=new RecursiveTasks(second,f.files);tasks.migrate();tasks.reconcile();tasks.reconcile();
  assert.equal(second.meta('mainThread'),'thread:main');assert.equal(tasks.run(finished.id).errorCode,'observed_failure');assert.equal(tasks.run(run.id).status,'interrupted');assert.equal(tasks.run(run.id).phase,'uncertain');assert.equal(tasks.run(run.id).threadId,run.threadId);assert.equal(tasks.claim(),undefined);
  const replies=tasks.inbox(f.actor).filter(message=>message.senderRunId===run.id&&message.kind==='worker_reply');assert.equal(replies.length,1);assert.equal(replies[0]!.payload.text,'Persisted original paragraph.');
 }finally{if(second)second.close();else f.store.close();rmSync(f.dir,{recursive:true,force:true});}
});

test('unsupported older layouts are refused before writes; transactions and request identity remain durable',()=>{
 const f=chatFixture();try{
  assert.throws(()=>f.store.transaction(()=>{f.store.setMeta('rollback-test','written');throw Error('rollback');}),/rollback/);assert.equal(f.store.meta('rollback-test'),undefined);
  f.store.startRequest('request-id','same');f.store.finishRequest('request-id','saved response');assert.equal(f.store.startRequest('request-id','same').response,'saved response');assert.throws(()=>f.store.startRequest('request-id','different'),/request_conflict/);
  const path=f.dir+'/legacy.sqlite',legacy=new DatabaseSync(path);legacy.exec('CREATE TABLE matters(id TEXT PRIMARY KEY)');legacy.close();const before=readFileSync(path);assert.throws(()=>new Store(path),/schema_unsupported/);assert.deepEqual(readFileSync(path),before);
 }finally{f.close();}
});

for(const [name,ddl] of [
 ['old-media','CREATE TABLE media_schema(version INTEGER); INSERT INTO media_schema VALUES(1);'],
 ['old-attachments','CREATE TABLE conversation_attachments(requestId TEXT PRIMARY KEY,refsJson TEXT);'],
] as const)test('Store rejects '+name+' before any database mutation',()=>{
 const f=chatFixture();try{
  const path=f.dir+'/'+name+'.sqlite',db=new DatabaseSync(path);
  db.exec('CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT); '+ddl);db.close();
  const before=readFileSync(path);
  assert.throws(()=>new Store(path),/schema_unsupported/);
  assert.deepEqual(readFileSync(path),before);
 }finally{f.close();}
});

test('input uncertainty leaves committed reply and additions intact',()=>{
 const f=chatFixture();try{
  const requestId='explicit-unknown',threadId='thread:main';
  f.inputs.accept({requestId,text:'Give two replies'});
  const input=f.inputs.claim()!;
  f.inputs.started(input.messageId,input.revision,'generation:unknown','turn:unknown');
  const ids=f.store.transaction(()=>['first','second'].map(text=>f.history.commitAssistant({threadId,requestId,text,operationKey:'operation:'+text})));
  assert.equal(ids[0],input.replyId);
  assert.equal(f.inputs.uncertain(input.messageId,input.revision),true);
  assert.deepEqual(ids.map(id=>f.history.message(id)?.status),['completed','completed']);
  assert.deepEqual(ids.map(id=>f.history.message(id)?.text),['first','second']);
  f.inputs.reconcile();
  assert.deepEqual(ids.map(id=>f.history.message(id)?.status),['completed','completed']);
 }finally{f.close();}
});
