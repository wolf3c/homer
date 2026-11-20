// Durable native call identity and raw-message transactions; no model/account.
import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {RecursiveTools,toolOperationId} from '../src/recursive-tools.js';
import {commitSyntheticMessage} from './fixtures/synthetic-message.js';
import {fixture as hostFixture} from './fixtures/worker-chat-host.js';
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

test('original committed actions travel with their received input and unknown effects independently block upgrade',()=>{
 const f=fixture();try{
  const w=openWorker(f),actor=running(f,w.runId),reply=complete(f,actor),input=f.inputs.claim([],'all')!;
  f.store.transaction(()=>{f.processes.start({id:'generation:coordination',threadId:main.threadId!,sourceKind:'worker',sourceMessageIds:[input.messageId],messageId:'generation:coordination'},'turn:coordination');f.tasks.receiveMainMessagesInTransaction([input.messageId],'turn:coordination');});
  const owner={...main,inputMessageId:reply.messageId,turnId:'turn:coordination'},opened=f.tasks.workerOpen(owner,{operationId:'committed-action',taskId:f.task.taskId,text:'Follow the evidence'});
  assert.equal(f.tasks.operationsForInput(main,reply.messageId)[0]!.response.runId,opened.runId);
  f.store.db.prepare("UPDATE operations SET state='uncertain' WHERE id=?").run(opened.operationKey);
  f.processes.finish('generation:coordination','unknown','turn:turn:coordination:terminal:completed');
  assert.equal(f.store.db.prepare('SELECT state FROM agent_receipts WHERE messageId=?').get(reply.messageId)!.state,'received');
  assert.equal(f.tasks.safeToUpgrade(),false);
  assert.equal(f.tasks.operationsForInput(main,reply.messageId)[0]!.state,'uncertain');
 }finally{f.close();}
});

test('a cached pre-change final remains readable under its original version after requirements are withdrawn',()=>{
 const f=fixture();try{
  const w=openWorker(f),actor=running(f,w.runId);f.tasks.recordWorkerTerminal(w.runId,actor.epoch!,{status:'completed',text:'Original-version draft'});
  const source=f.source('changed','Read only now');f.tasks.updateTask(source,{...mutation(f,'change'),patch:{goal:'New read-only goal'},authority:authority(source.sourceRequestId)});
  const stop=f.tasks.workerStop(source,{operationId:'stop',workerId:w.workerId});
  assert.equal(complete(f,actor,'Late output'),undefined);f.tasks.confirmWorkerExit(w.runId,undefined);f.tasks.confirmStop(stop.operationKey,true);
  const reply=f.tasks.inbox(main).find(message=>message.kind==='worker_reply')!;assert.equal(reply.taskVersion,1);assert.equal(reply.payload.text,'Original-version draft');
  assert.equal(f.tasks.run(w.runId).version,1);assert.equal(f.tasks.task(f.task.taskId).headVersion,2);
 }finally{f.close();}
});

test('an unknown native terminal and restart preserve the historical message, receipt and attachment',async()=>{
 const f=hostFixture(),requestId='historical-send';
 try{
  await f.app.start();
  const threadId=f.app.store.meta('mainThread')!,actor={agentId:f.app.store.meta('mainAgentId')!,threadId};
  f.app.inputs.accept({requestId,text:'Publish the historical report'});
  const input=f.app.inputs.claim()!;
  f.app.inputs.started(input.messageId,input.revision,'historical-generation','historical-turn');
  const sent=commitSyntheticMessage(f.app,threadId,'Historical report',[{filename:'report.md',content:'# Preserved bytes'}],requestId);
  const operationKey=f.app.history.message(sent.messageId)!.operationKey!;
  f.app.inputs.uncertain(input.messageId,input.revision);
  assert.equal(f.app.inputs.list().find(row=>row.messageId===input.messageId)?.state,'uncertain');
  await f.restart();
  const operation=f.app.tasks.inspectOperation(actor,operationKey).operations[0]!;
  assert.equal(operation.state,'confirmed');
  assert.equal(operation.response.messageId,sent.messageId);
  const committed=f.app.readCommittedMessage(sent.messageId,{requestId});
  assert.equal(committed?.status,'completed');
  assert.deepEqual(committed?.attachments,sent.attachments);
  const data=f.app.readAttachment({messageId:sent.messageId,...sent.attachments[0]!}).data;
  assert.equal(Buffer.from(data,'base64').toString(),'# Preserved bytes');
  assert.equal(f.app.media.gc(Date.now()+31*86400000),0);

  f.app.store.db.prepare("UPDATE operations SET responseJson=NULL WHERE id=?").run(operationKey);
  assert.equal(f.app.tasks.inspectOperation(actor,operationKey).operations[0]!.response,null);
  f.setScript(async engine=>{
   await assert.rejects(engine.call('send_user_message',{text:'Duplicate historical report'},operation.operationId),/send_user_message_retired_use_final_answer/);
   const text='Independent final reply';
   return {status:'completed',text,messages:[{itemId:'final',phase:'final_answer',text}]};
  });
  assert.equal(await f.app.message('Continue independently','new-request'),'Independent final reply');
  assert.equal(f.app.store.db.prepare("SELECT count(*) n FROM operations WHERE kind='send_user_message'").get()?.n,1);
  assert.deepEqual(f.app.history.message(sent.messageId)?.attachments,sent.attachments);
 }finally{await f.close();}
});

test('restart clears accepted historical send and attachment intents without publishing a reply',async()=>{
 const f=hostFixture();
 try{
  await f.app.start();
  const actor=f.app.store.meta('mainAgentId')!,send='send:interrupted',stage='stage:interrupted';
  const insert=f.app.store.db.prepare("INSERT INTO operations(id,actorAgentId,scopeId,operationId,kind,payloadHash,state,detailsJson,responseJson) VALUES(?,?,?,?,?,'synthetic','accepted','{}',?)");
  const ref=f.app.media.snapshot(stage,{filename:'interrupted.md',mime:'text/markdown',kind:'file',bytes:Buffer.from('# Uncommitted')});
  insert.run(send,actor,'user-messages','interrupted','send_user_message',null);
  insert.run(stage,actor,'message-attachments',stage,'attachment_stage',JSON.stringify([ref]));
  await f.restart();
  for(const key of [send,stage]){
   const operation=f.app.tasks.operation(key);
   assert.equal(operation.state,'failed');
   assert.equal(JSON.parse(operation.detailsJson).failureCode,'message_not_committed');
  }
  assert.equal(f.app.tasks.operation(send).responseJson,null);
  assert.equal(f.app.store.db.prepare('SELECT count(*) n FROM media_pins').get()?.n,0);
  assert.throws(()=>f.app.media.readAttachment(ref),/media/);
  assert.equal(f.app.history.list(f.app.store.meta('mainThread')!).filter(message=>message.attachments?.length).length,0);
 }finally{await f.close();}
});

test('equal raw bodies from different Workers retain distinct messages and both original native identities',()=>{
 const f=fixture();try{
  const a=openWorker(f,'a'),b=openWorker(f,'b'),aa=running(f,a.runId),bb=running(f,b.runId),first=complete(f,aa,'Same raw body'),second=complete(f,bb,'Same raw body');
  assert.notEqual(first.messageId,second.messageId);const replies=f.tasks.inbox(main).filter(message=>message.kind==='worker_reply');
  assert.equal(replies.length,2);assert.deepEqual(replies.map(message=>message.senderRunId),[aa.runId,bb.runId]);assert.deepEqual(replies.map(message=>message.payload.text),['Same raw body','Same raw body']);
 }finally{f.close();}
});

test('final transaction failure rolls back the reply and collects only failed staging',async()=>{
 const f=hostFixture();
 try{
  await f.app.start();
  const report=join(f.app.config.workspace,'report.md'),text='[Report]('+pathToFileURL(report).href+')';
  f.setScript(async ()=>({status:'completed',text,messages:[{itemId:'report',phase:'final_answer',text}]}));
  writeFileSync(report,'# Original report');
  await f.app.message('Publish original report','original-request');
  const thread=f.app.store.meta('mainThread')!,deliveries=()=>f.app.history.list(thread).filter(message=>message.attachments?.length);
  const original=deliveries()[0]!;

  writeFileSync(report,'# Updated report');
  f.app.store.db.exec("CREATE TEMP TRIGGER reject_final BEFORE INSERT ON operations WHEN NEW.kind='request_final' BEGIN SELECT RAISE(ABORT,'synthetic_commit_failure'); END");
  await assert.rejects(f.app.message('Publish updated report','fault-request'),/synthetic_commit_failure/);
  const input=f.app.inputs.byRequestIds(['fault-request'])[0]!,reply=f.app.history.message(input.replyId)!;
  assert.equal(input.state,'uncertain');
  assert.equal(reply.status,'interrupted');
  assert.equal(reply.operationKey,null);
  assert.equal(reply.attachments,undefined);
  const stage=f.app.store.db.prepare("SELECT state,detailsJson FROM operations WHERE kind='attachment_stage' AND state='failed'").get()!;
  assert.equal(JSON.parse(String(stage.detailsJson)).failureCode,'message_not_committed');
  assert.equal(f.app.store.db.prepare("SELECT count(*) n FROM media_assets WHERE originOperationKey IS NOT NULL AND state='deleted'").get()!.n,1);
  assert.equal(f.app.media.gc(),0);
  assert.equal(f.app.media.readAttachment(original.attachments![0]!).bytes.toString(),'# Original report');
  assert.deepEqual(deliveries().map(message=>message.requestId),['original-request']);

  await f.restart();
  await f.app.message('Authorize a new delivery','new-authorized-action');
  assert.deepEqual(deliveries().map(message=>message.requestId),['original-request','new-authorized-action']);
  assert.equal(f.app.media.readAttachment(deliveries()[1]!.attachments![0]!).bytes.toString(),'# Updated report');
 }finally{await f.close();}
});
