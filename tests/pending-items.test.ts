// Pending facts use the real owner; recording never creates execution authority.
import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {Store} from '../src/store.js';
import {RecursiveTasks} from '../src/recursive-tasks.js';
import {fixture,main,authority,mutation,openWorker,running,complete,type Fixture} from './recursive-fixture.js';

function replyActor(f:Fixture){
 const worker=openWorker(f);complete(f,running(f,worker.runId),'Original checked');
 const input=f.inputs.claim([],'all')!;assert.equal(input.origin,'worker');
 f.inputs.started(input.messageId,input.revision,'generation:pending-event','turn:pending-event');
 const actor={...main,sourceRequestId:undefined,inputMessageId:input.messageId,turnId:'turn:pending-event'};
 assert.equal(f.tasks.workerRead(actor,{workerId:worker.workerId,messageId:input.messageId}).messages[0]!.text,'Original checked');
 return actor;
}

test('record, durable operation receipt, CAS, close/reopen and exact user source do not schedule work',()=>{
 const f=fixture();try{
  const input={operationId:'remember',content:'PDF export'},row=f.tasks.pending.add(main,input);
  assert.equal(row.revision,1);assert.equal(row.state,'open');assert.deepEqual(f.tasks.pending.add(main,input),row);
  assert.throws(()=>f.tasks.pending.add(main,{...input,content:'different'}),/payload_conflict/);
  assert.equal(f.tasks.tasks().length,1);assert.equal(f.tasks.runs().length,0);
  const selected=f.tasks.pending.list(main,{id:row.id}).items[0]!;
  assert.deepEqual(selected.sourceRequestIds,['user-synthetic']);assert.equal((selected.sources![0] as {text:string}).text,'Synthetic permission for local work');
  const closed=f.tasks.pending.update(main,{operationId:'close',id:row.id,expectedRevision:1,patch:{state:'closed',handlingNote:'Deferred'}});
  assert.equal(closed.revision,2);assert.throws(()=>f.tasks.pending.update(main,{operationId:'stale',id:row.id,expectedRevision:1,patch:{content:'clobber'}}),/revision_conflict/);
  assert.equal(f.tasks.pending.update(main,{operationId:'reopen',id:row.id,expectedRevision:2,patch:{state:'open'}}).state,'open');
  assert.deepEqual(f.tasks.inspectOperation(main,'remember','pending_items').operations[0]!.response,row);
  f.store.db.prepare("UPDATE operations SET state='uncertain',responseJson=NULL WHERE operationId='remember'").run();
  assert.throws(()=>f.tasks.pending.add(main,input),/operation_uncertain/);assert.equal(f.tasks.runs().length,0);
 }finally{f.close();}
});

test('independent suggestions remain bounded, durable and Main-only',()=>{
 const f=fixture();try{
  const event={...main,sourceRequestId:undefined};for(let i=0;i<7;i++)f.tasks.pending.add(event,{operationId:'item:'+i,content:'Suggestion '+i});
  const page=f.tasks.pending.list(main,{limit:3}),next=f.tasks.pending.list(main,{limit:3,cursor:page.nextCursor!});
  assert.equal(new Set([...page.items,...next.items].map(x=>x.id)).size,6);assert.deepEqual(page.items[0]!.sourceRequestIds,[]);assert.equal(f.tasks.pending.summary(main).totalOpen,7);
  for(const actor of [{...main,agentId:'worker:forged'},{...main,threadId:'foreign'}])assert.throws(()=>f.tasks.pending.list(actor),/main_required|denied/);
  assert.throws(()=>f.tasks.pending.update(main,{operationId:'empty',id:page.items[0]!.id,expectedRevision:1,patch:{}}),/invalid_patch/);
  const reopened=new Store(join(f.dir,'homer.sqlite'));try{const tasks=new RecursiveTasks(reopened,f.files);tasks.migrate();assert.equal(tasks.pending.list(main).items.length,7);}finally{reopened.close();}
 }finally{f.close();}
});

test('a real reply binds the selected source; explicit links preserve receipts, CAS and settled facts without dispatch',()=>{
 const f=fixture();try{
  const unbound={...main,sourceRequestId:undefined},a=f.tasks.pending.add(main,{operationId:'a',content:'Remember'}),b=f.tasks.pending.add(main,{operationId:'b',content:'Another'});
  const input={operationId:'dispatch',goal:'Explicit authorized work',authority:{...authority(),sourceRequestIds:['user-synthetic']}};
  assert.throws(()=>f.tasks.createTask(unbound,input),/source_denied/);
  const suggestion=f.tasks.pending.add(unbound,{operationId:'suggestion',content:'No user authority'});
  assert.deepEqual(suggestion.sourceRequestIds,[]);assert.equal(f.tasks.tasks().length,1);assert.equal(f.tasks.runs().length,0);
  const event=replyActor(f),created=f.tasks.createTask(event,input);assert.deepEqual(f.tasks.createTask(event,input),created);
  assert.throws(()=>f.tasks.createTask(event,{...input,goal:'Different work'}),/payload_conflict/);
  assert.equal(f.tasks.authority(created.taskId,1).sourceRequestId,'user-synthetic');
  for(const item of [a,b])assert.equal(f.tasks.pending.list(main,{id:item.id}).items[0]!.linkedTaskId,null);
  assert.equal(f.tasks.runs(created.taskId).length,0,'recording a Task does not open a Worker');
  const link={operationId:'link-a',id:a.id,expectedRevision:1,patch:{linkedTaskId:created.taskId}};
  f.store.db.exec("CREATE TEMP TRIGGER fail_link BEFORE UPDATE OF linkedTaskId ON pending_items BEGIN SELECT RAISE(ABORT,'synthetic_link_failure'); END");
  assert.throws(()=>f.tasks.pending.update(event,link),/synthetic_link_failure/);
  assert.equal(f.tasks.tasks().length,2);assert.equal(f.tasks.pending.list(main,{id:a.id}).items[0]!.revision,1);
  assert.equal(f.tasks.pending.list(main,{id:a.id}).items[0]!.linkedTaskId,null);assert.equal(f.tasks.inspectOperation(main,'link-a','pending_items').operations.length,0);
  f.store.db.exec('DROP TRIGGER fail_link');const linked=f.tasks.pending.update(event,link);assert.deepEqual(f.tasks.pending.update(event,link),linked);
  assert.equal(linked.linkedTaskId,created.taskId);assert.equal(f.tasks.pending.list(main,{id:b.id}).items[0]!.linkedTaskId,null);
  assert.throws(()=>f.tasks.pending.update(event,{...link,patch:{linkedTaskId:f.task.taskId}}),/payload_conflict/);
  assert.throws(()=>f.tasks.pending.update(event,{...link,operationId:'stale'}),/revision_conflict/);
  f.tasks.pending.update(event,{...link,operationId:'link-b',id:b.id});
  assert.equal(f.tasks.pending.list(main,{id:b.id}).items[0]!.linkedTaskId,created.taskId);assert.equal(f.tasks.runs().length,1);
  f.tasks.settleTask(main,{...mutation(f,'settle',created.taskId),outcome:'failed'});assert.equal(f.tasks.pending.list(main,{id:a.id}).items[0]!.state,'open');
  assert.equal(f.tasks.task(created.taskId).outcome,'failed');
 }finally{f.close();}
});

test('pending source selection cannot authorize a different user source',()=>{
 const f=fixture();try{
  const row=f.tasks.pending.add(main,{operationId:'note',content:'Original request',relatedTaskId:f.task.taskId}),source=f.source('other-source','Another independent request');
  const inputMessageId=String(f.store.db.prepare("SELECT id FROM agent_messages WHERE kind='user_input' AND json_extract(payloadJson,'$.requestId')='other-source'").get()!.id),actor={...source,inputMessageId};
  const other=f.tasks.createTask(actor,{operationId:'other',goal:'Another independent request',authority:authority(actor.sourceRequestId)});
  const unrelated=f.tasks.pending.add(actor,{operationId:'unrelated',content:'Other task only',relatedTaskId:other.taskId}),event=replyActor(f),before=f.tasks.tasks().length;
  const input={operationId:'mismatch',goal:'Wrong request',authority:{...authority(actor.sourceRequestId),sourceRequestIds:[actor.sourceRequestId!]}};
  assert.throws(()=>f.tasks.createTask(event,input),/source_denied/);
  f.tasks.pending.update(event,{operationId:'move',id:unrelated.id,expectedRevision:1,patch:{relatedTaskId:f.task.taskId}});
  assert.throws(()=>f.tasks.createTask(event,{...input,operationId:'moved'}),/source_denied/);
  assert.equal(f.tasks.tasks().length,before);assert.equal(f.tasks.pending.list(main,{id:row.id}).items[0]!.linkedTaskId,null);
  assert.equal(f.tasks.runs().length,1,'a moved note cannot dispatch another Task');
 }finally{f.close();}
});

test('pending originals require exact processed user source and long pages have no loss or duplicate entries',()=>{
 const f=fixture();try{
  const event={...main,sourceRequestId:undefined};f.history.accept('foreign',{requestId:'cross-instance',text:'Do something'});f.history.record('assistant-only',main.threadId!,'Suggestion');f.inputs.accept({requestId:'unclaimed',text:'Queued user'});
  const cancelled=f.inputs.accept({requestId:'cancelled',text:'Cancel me'});f.inputs.cancel({requestId:'cancelled',operationId:'cancel',expectedRevision:cancelled.revision!});
  for(const source of ['cross-instance','assistant-only','unclaimed','cancelled','missing'])assert.throws(()=>f.tasks.pending.add(event,{operationId:'deny:'+source,content:'x',sourceRequestIds:[source]}),/source_denied/);
  const row=f.tasks.pending.add(main,{operationId:'valid',content:'Real source'});assert.throws(()=>f.tasks.pending.list(main,{id:row.id,sourceRequestId:'unclaimed'}),/source_denied/);
  for(let i=0;i<8;i++)f.tasks.pending.add(event,{operationId:'long:'+i,content:'长'.repeat(24000)});
  const first=f.tasks.pending.list(main,{limit:50});assert.ok(first.items.length<9);assert.ok(first.nextCursor);assert.ok(Buffer.byteLength(JSON.stringify(first))<300000);
  const ids=new Set(first.items.map(item=>item.id));let cursor:string|null=first.nextCursor;
  while(cursor){const page=f.tasks.pending.list(main,{limit:50,cursor});for(const item of page.items){assert.ok(!ids.has(item.id));ids.add(item.id);}cursor=page.nextCursor;}
  assert.equal(ids.size,9);
 }finally{f.close();}
});
