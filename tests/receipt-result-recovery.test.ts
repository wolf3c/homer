// Durable native call identity and raw-message transactions; no model/account.
import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {RecursiveTools,toolOperationId} from '../src/recursive-tools.js';
import {RecursiveTasks} from '../src/recursive-tasks.js';
import {fixture,main,authority,openWorker,running,complete,mutation,processReplies} from './recursive-fixture.js';

test('committed Worker open survives lost tool response; same native call replays, different payload conflicts',async()=>{
 const f=fixture();try{
  let lose=true;const tools=new RecursiveTools(f.tasks,{rootAuthority:()=>authority(),wake(){if(lose)throw Error('synthetic_response_lost');},stop:async r=>r,steer:async r=>r});
  const args={taskId:f.task.taskId,message:'Inspect exact source'},callId='native-open';
  await assert.rejects(()=>tools.call(main,'worker_open',args,callId),/synthetic_response_lost/);assert.equal(f.tasks.workers(f.task.taskId).length,1);
  const recovered=f.tasks.inspectOperation({...main,sourceRequestId:undefined},toolOperationId(main,callId),f.task.taskId).operations[0]!;assert.equal(recovered.state,'confirmed');
  lose=false;const replay=await tools.call(main,'worker_open',args,callId) as {runId:string;operationKey:string};
  assert.deepEqual(recovered.response,replay);assert.equal(f.tasks.runs().length,1);
  await assert.rejects(()=>tools.call(main,'worker_open',{...args,message:'Changed'},callId),/payload_conflict/);
  await tools.call(main,'worker_open',args,'different-native-call');assert.equal(f.tasks.runs().length,2,'equal text with a distinct call identity is separate work');
 }finally{f.close();}
});

test('task-create receipt remains discoverable without its lost taskId or original source context',()=>{
 const f=fixture();try{
  const input={operationId:'lost-create',goal:'A second task',authority:authority()},created=f.tasks.createTask(main,input),actor={...main,sourceRequestId:undefined};
  const result=f.tasks.inspectOperation(actor,'lost-create');assert.equal(result.operations.length,1);assert.deepEqual(result.operations[0]!.response,created);
  assert.deepEqual(f.tasks.createTask(main,input),created);assert.equal(f.tasks.tasks().length,2);
  assert.equal(f.tasks.inspectOperation(actor,'missing').operations.length,0);assert.equal(f.tasks.inspectOperation(actor,'lost-create','wrong-scope').operations.length,0);
  assert.throws(()=>f.tasks.inspectOperation({...main,agentId:'foreign-main'},'lost-create'),/main_required|identity/);
 }finally{f.close();}
});

for(const count of [2,20,21])test('same-name operation scopes stay bounded and require explicit selection: '+count,()=>{
 const f=fixture();try{
  for(let i=0;i<count;i++){const task=f.tasks.createTask(main,{operationId:'create:'+i,goal:'Scope '+i,authority:authority()});openWorker(f,'same-name',task.taskId);}
  const page=f.tasks.inspectOperation(main,'same-name');assert.equal(page.operations.length,Math.min(count,20));assert.equal(page.truncated,count>20);
  assert.equal(new Set(page.operations.map(op=>op.scopeId)).size,page.operations.length);assert.deepEqual(f.tasks.inspectOperation(main,'same-name'),page);
  const chosen=page.operations[0]!;assert.deepEqual(f.tasks.inspectOperation(main,'same-name',chosen.scopeId).operations,[chosen]);
 }finally{f.close();}
});

for(const fault of ['message','receipt'] as const)test('return '+fault+' persistence failure rolls back terminal state and keeps the raw checkpoint recoverable',()=>{
 const f=fixture();try{
  const w=openWorker(f),actor=running(f,w.runId),raw='Original raw answer\n\nParagraph two.';
  f.tasks.recordWorkerOutput(w.runId,actor.epoch!,{threadId:actor.threadId,turnId:actor.turnId,itemId:'native-final',phase:'final_answer',text:raw});
  const table=fault==='message'?'agent_messages':'agent_receipts';f.store.db.exec("CREATE TEMP TRIGGER reject_return BEFORE INSERT ON "+table+" BEGIN SELECT RAISE(ABORT,'synthetic_return_failure'); END");
  assert.throws(()=>complete(f,actor,'Ignored fallback'),/synthetic_return_failure/);assert.equal(f.tasks.run(w.runId).status,'running');assert.match(f.tasks.run(w.runId).checkpointJson!,/Original raw answer/);
  f.store.db.exec('DROP TRIGGER reject_return');const reply=complete(f,actor,'Ignored fallback'),snapshot=f.tasks.workerRead(main,{workerId:w.workerId,messageId:reply.messageId});
  assert.equal(snapshot.messages[0]!.text,raw);assert.deepEqual(complete(f,actor,'Duplicate callback'),reply);
  assert.equal(f.tasks.inbox(main).filter(m=>m.kind==='worker_reply').length,1);assert.equal(f.tasks.readTask(main,f.task.taskId).results.length,0);
  assert.equal(JSON.parse(f.tasks.run(w.runId).checkpointJson!).workerOutput,undefined);
 }finally{f.close();}
});

test('native item identity preserves equal bodies and ordering while one repeated item updates only itself',()=>{
 const f=fixture();try{
  const w=openWorker(f),actor=running(f,w.runId);
  for(const [itemId,text] of [['item:a','First draft'],['item:a','Equal body'],['item:b','Equal body']])f.tasks.recordWorkerOutput(w.runId,actor.epoch!,{threadId:actor.threadId,turnId:actor.turnId,itemId:itemId!,phase:'final_answer',text:text!});
  const reply=complete(f,actor),row=f.store.db.prepare('SELECT payloadJson FROM agent_messages WHERE id=?').get(reply.messageId)!;const body=JSON.parse(String(row.payloadJson));
  assert.equal(body.text,'Equal body\n\nEqual body');assert.deepEqual(body.messages.map((m:{itemId:string;text:string})=>[m.itemId,m.text]),[['item:a','Equal body'],['item:b','Equal body']]);
  assert.equal(body.runId,w.runId);assert.equal(body.epoch,actor.epoch);assert.equal(body.threadId,actor.threadId);assert.equal(body.turnId,actor.turnId);
 }finally{f.close();}
});

test('long raw originals are recoverable in exact chunks and paging does not adopt a formal Result',()=>{
 const f=fixture();try{
  const w=openWorker(f),actor=running(f,w.runId),raw=('汉字🙂\n\n').repeat(14000),reply=complete(f,actor,raw);
  let text='',offset=0;for(;;){const message=f.tasks.workerRead(main,{workerId:w.workerId,messageId:reply.messageId,offset}).messages[0]!;text+=message.text;if(message.nextOffset===null)break;offset=message.nextOffset;}
  assert.equal(text,raw);assert.equal(f.tasks.readTask(main,f.task.taskId).results.length,0);
  assert.throws(()=>f.tasks.workerRead(main,{workerId:w.workerId,messageId:reply.messageId,offset:-1}),/message_offset_invalid/);
  const page=f.tasks.workerRead(main,{workerId:w.workerId,limit:1});assert.ok(page.nextCursor);assert.notEqual(f.tasks.workerRead(main,{workerId:w.workerId,after:page.nextCursor!,limit:1}).messages[0]!.id,page.messages[0]!.id);
 }finally{f.close();}
});

test('original committed actions travel with their input and unresolved actions block completion of that input',()=>{
 const f=fixture();try{
  const w=openWorker(f),actor=running(f,w.runId),reply=complete(f,actor),input=f.inputs.claim([],'all')!;
  f.inputs.started(input.messageId,input.revision,'generation:coordination','turn:coordination');
  const owner={...main,inputMessageId:reply.messageId,turnId:'turn:coordination'},opened=f.tasks.workerOpen(owner,{operationId:'committed-action',taskId:f.task.taskId,text:'Follow the evidence'});
  assert.equal(f.tasks.operationsForInput(main,reply.messageId)[0]!.response.runId,opened.runId);
  f.store.db.prepare("UPDATE operations SET state='uncertain' WHERE id=?").run(opened.operationKey);
  assert.throws(()=>f.store.transaction(()=>f.tasks.completeMainMessagesInTransaction([reply.messageId],'generation:coordination')),/coordination_operations_unresolved/);
  assert.notEqual(f.store.db.prepare('SELECT state FROM agent_receipts WHERE messageId=?').get(reply.messageId)!.state,'processed');
  assert.equal(f.tasks.operationsForInput(main,reply.messageId)[0]!.state,'uncertain');
 }finally{f.close();}
});

test('a cached pre-change final remains readable under its original version after requirements are withdrawn',()=>{
 const f=fixture();try{
  const w=openWorker(f),actor=running(f,w.runId);f.tasks.recordWorkerTerminal(w.runId,actor.epoch!,{status:'completed',text:'Original-version draft'});
  const source=f.source('changed','Read only now'),change=f.tasks.updateTask(source,{...mutation(f,'change'),patch:{goal:'New read-only goal'},authority:authority(source.sourceRequestId)});
  assert.equal(complete(f,actor,'Late output'),undefined);f.tasks.confirmWorkerExit(w.runId,undefined);f.tasks.confirmStop(change.operationKey,true);
  const reply=f.tasks.inbox(main).find(message=>message.kind==='worker_reply')!;assert.equal(reply.taskVersion,1);assert.equal(reply.payload.text,'Original-version draft');
  assert.equal(f.tasks.run(w.runId).version,1);assert.equal(f.tasks.task(f.task.taskId).headVersion,2);
 }finally{f.close();}
});

for(const state of ['recorded','uncertain'] as const)test('lost publication response retains the original receipt and '+state+' sending fact without replay',()=>{
 const f=fixture();try{
  const w=openWorker(f),actor=running(f,w.runId),reply=complete(f,actor),result=f.tasks.adoptResult(main,{operationId:'adopt',taskId:f.task.taskId,version:1,messageId:reply.messageId});
  const args={operationId:'publish',taskId:f.task.taskId,version:1,resultIds:[result.resultId],text:'Synthetic formal result'},published=f.tasks.publish(main,args);
  f.tasks.markDelivery(published.deliveryId,'submitting');f.tasks.markDelivery(published.deliveryId,state);f.tasks.reconcile();
  assert.deepEqual(f.tasks.publish(main,args),published);assert.equal(f.tasks.delivery(published.deliveryId).state,state);assert.equal(f.tasks.pendingDeliveries().length,0);
  assert.throws(()=>f.tasks.publish(main,{...args,operationId:'blind-new-call'}),/delivery_already_prepared/);assert.equal(f.tasks.deliveries().length,1);
  if(state==='uncertain'){processReplies(f);assert.throws(()=>f.tasks.settleTask(main,{...mutation(f,'settle'),outcome:'succeeded'}),/operation_uncertain/);}
 }finally{f.close();}
});

test('reopen turns submitting into uncertain and retains exact adopted file bytes',()=>{
 const f=fixture();try{
  const w=openWorker(f),actor=running(f,w.runId),filePath=join(f.files.workspace,'report.md');writeFileSync(filePath,'# Preserved bytes');complete(f,actor);
  const result=f.tasks.adoptResult(main,{operationId:'adopt',taskId:f.task.taskId,version:1,runId:w.runId,filePath}),delivery=f.tasks.publish(main,{operationId:'publish',taskId:f.task.taskId,version:1,resultIds:[result.resultId],text:'Synthetic file'});
  f.tasks.markDelivery(delivery.deliveryId,'submitting');const restarted=new RecursiveTasks(f.store,f.files);restarted.reconcile();
  assert.equal(restarted.delivery(delivery.deliveryId).state,'uncertain');assert.equal(restarted.readResult(main,result.resultId).file!.content,'# Preserved bytes');assert.equal(restarted.pendingDeliveries().length,0);
 }finally{f.close();}
});

test('equal raw bodies from different Workers retain distinct messages and both original native identities',()=>{
 const f=fixture();try{
  const a=openWorker(f,'a'),b=openWorker(f,'b'),aa=running(f,a.runId),bb=running(f,b.runId),first=complete(f,aa,'Same raw body'),second=complete(f,bb,'Same raw body');
  assert.notEqual(first.messageId,second.messageId);const replies=f.tasks.inbox(main).filter(message=>message.kind==='worker_reply');
  assert.equal(replies.length,2);assert.deepEqual(replies.map(message=>message.senderRunId),[aa.runId,bb.runId]);assert.deepEqual(replies.map(message=>message.payload.text),['Same raw body','Same raw body']);
 }finally{f.close();}
});

test('explicit Result adoption survives a lost outer response without creating a second Result or Delivery',async()=>{
 const f=fixture();try{
  const w=openWorker(f),actor=running(f,w.runId),reply=complete(f,actor),args={runId:w.runId,messageId:reply.messageId};let lose=true;
  const tools=new RecursiveTools(f.tasks,{rootAuthority:()=>authority(),wake(){if(lose)throw Error('synthetic_response_lost');},stop:async r=>r,steer:async r=>r});
  await assert.rejects(()=>tools.call(main,'accept_result',args,'adopt-native-call'),/synthetic_response_lost/);assert.equal(f.tasks.readTask(main,f.task.taskId).results.length,1);
  const lookup=f.tasks.inspectOperation(main,toolOperationId(main,'adopt-native-call'),f.task.taskId).operations[0]!;lose=false;
  assert.deepEqual(await tools.call(main,'accept_result',args,'adopt-native-call'),lookup.response);assert.equal(f.tasks.readTask(main,f.task.taskId).results.length,1);assert.equal(f.tasks.deliveries().length,0);
 }finally{f.close();}
});
