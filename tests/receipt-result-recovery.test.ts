// Durable native call identity and raw-message transactions; no model/account.
import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {RecursiveTools,toolOperationId} from '../src/recursive-tools.js';
import {Store} from '../src/store.js';
import {ConversationHistory} from '../src/web-history.js';
import {MediaStore} from '../src/media-store.js';
import {htmlAttachmentFixture} from './canvas-html-publication-fixture.js';
import {fixture,main,authority,openWorker,running,complete,mutation} from './recursive-fixture.js';

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
  assert.equal(f.tasks.inbox(main).filter(m=>m.kind==='worker_reply').length,1);assert.equal(f.store.db.prepare("SELECT 1 FROM sqlite_master WHERE name='results'").get(),undefined);
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
  assert.equal(text,raw);assert.equal(f.store.db.prepare("SELECT 1 FROM sqlite_master WHERE name='results'").get(),undefined);
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

test('a committed message and exact attachment survive restart and a lost tool response',()=>{
 const f=htmlAttachmentFixture('report.md',Buffer.from('# Preserved bytes'));
 try{
  const sent=f.send();
  const operations=f.store.db.prepare("SELECT responseJson,state FROM operations WHERE kind='send_user_message'").all();
  assert.equal(operations.length,1);assert.equal(operations[0]!.state,'confirmed');
  assert.equal(JSON.parse(String(operations[0]!.responseJson)).messageId,sent.messageId);
  const store=new Store(join(f.dir,'homer.sqlite'));
  try{
   const history=new ConversationHistory(store.db),media=new MediaStore(store.db,join(f.dir,'runtime/media'));
   history.reconcile();media.reconcile();
   assert.deepEqual(history.message(sent.messageId)?.attachments,[{assetId:sent.assetId,revision:sent.revision}]);
   assert.equal(history.message(sent.messageId)?.status,'completed');
   assert.equal(media.readAttachment(sent).bytes.toString(),'# Preserved bytes');
   assert.equal(media.gc(Date.now()+31*86400000),0);
  }finally{store.close();}
  writeFileSync(f.original,'Changed after original response');
  assert.deepEqual(f.send(),sent);
  assert.equal(f.history.list(f.threadId).filter(message=>message.attachments?.length).length,1);
 }finally{f.close();}
});

test('an unknown native terminal cannot interrupt an already committed user-visible reply',()=>{
 const f=htmlAttachmentFixture();
 try{
  const sent=f.send(),input=f.queuedInput;
  f.inputs.uncertain(input.messageId,input.revision);
  assert.equal(f.inputs.list().find(row=>row.messageId===input.messageId)?.state,'uncertain');
  assert.equal(f.history.message(sent.messageId)?.status,'completed');
  assert.deepEqual(f.app.readAttachment(sent).data,f.bytes.toString('base64'));
  assert.deepEqual(f.send(),sent);
 }finally{f.close();}
});

test('a missing user-send receipt is uncertain and cannot commit or suppress another reply',()=>{
 const f=htmlAttachmentFixture();
 try{
  const sent=f.send(),context=f.app['mainContext']!;
  f.store.db.prepare("UPDATE operations SET responseJson=NULL WHERE kind='send_user_message'").run();
  context.explicitSent=false;
  assert.throws(()=>f.send(),/operation_uncertain/);
  assert.equal(context.explicitSent,false);
  assert.deepEqual(f.history.message(sent.messageId)?.attachments,[{assetId:sent.assetId,revision:sent.revision}]);
  assert.equal(f.store.db.prepare("SELECT count(*) n FROM operations WHERE kind='send_user_message'").get()?.n,1);
 }finally{f.close();}
});

test('equal raw bodies from different Workers retain distinct messages and both original native identities',()=>{
 const f=fixture();try{
  const a=openWorker(f,'a'),b=openWorker(f,'b'),aa=running(f,a.runId),bb=running(f,b.runId),first=complete(f,aa,'Same raw body'),second=complete(f,bb,'Same raw body');
  assert.notEqual(first.messageId,second.messageId);const replies=f.tasks.inbox(main).filter(message=>message.kind==='worker_reply');
  assert.equal(replies.length,2);assert.deepEqual(replies.map(message=>message.senderRunId),[aa.runId,bb.runId]);assert.deepEqual(replies.map(message=>message.payload.text),['Same raw body','Same raw body']);
 }finally{f.close();}
});

test('message transaction failure leaves the original reply mutable and collects only failed staging',()=>{
 const f=htmlAttachmentFixture();
 try{
  f.store.db.exec("CREATE TEMP TRIGGER reject_send BEFORE UPDATE ON conversation_messages WHEN NEW.operationKey IS NOT NULL BEGIN SELECT RAISE(ABORT,'synthetic_commit_failure'); END");
  assert.throws(()=>f.send(),/synthetic_commit_failure/);
  assert.equal(f.history.message(f.replyId)?.status,'running');
  assert.equal(f.history.message(f.replyId)?.attachments,undefined);
  const operation=f.store.db.prepare("SELECT state,detailsJson,responseJson FROM operations WHERE kind='send_user_message'").get()!;
  assert.equal(operation.state,'failed');
  assert.equal(JSON.parse(String(operation.detailsJson)).failureCode,'message_not_committed');
  assert.equal(operation.responseJson,null);
  assert.equal(f.store.db.prepare("SELECT count(*) n FROM media_assets WHERE originOperationKey IS NOT NULL AND state='deleted'").get()!.n,1);
  assert.equal(f.media.gc(),0);
  f.store.db.exec('DROP TRIGGER reject_send');
  assert.throws(()=>f.send(),/message_not_committed/);
  assert.equal(f.send([{path:f.original}],'new-authorized-action').messageId,f.replyId);
 }finally{f.close();}
});
