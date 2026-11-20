import {openTaskWorker} from './fixtures/open-task-worker.js';
// Real host and original replies; no native engine, account or channel calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,until} from './fixtures/worker-chat-host.js';
import {commitSyntheticMessage} from './fixtures/synthetic-message.js';

test('the retired send tool cannot write, while its published attachment survives restart',async()=>{
 const f=fixture();
 const scope={taskId:'task-previous-send',taskVersion:1};
 try{
  await f.app.start();
  const thread=f.app.store.meta('mainThread')!;
  assert.ok(!f.engines[0]!.options.tools.some(tool=>tool.name==='send_user_message'));
  const old=commitSyntheticMessage(f.app,thread,'Previously sent',[{filename:'old.patch',content:'exact previous bytes'}],undefined,scope);
  await f.restart();
  assert.equal(f.app.store.meta('mainThread'),thread);
  assert.ok(!f.engines.at(-1)!.options.tools.some(tool=>tool.name==='send_user_message'));
  let refused=false;
  f.setScript(async main=>{
   await assert.rejects(main.call('send_user_message',{text:'Forbidden duplicate'}),/send_user_message_retired/);
   refused=true;
   const text='Final answer uses the common delivery path.';
   return {status:'completed',text,messages:[{itemId:'f',phase:'final_answer',text}]};
  });
  assert.equal(await f.app.message('Use an old conversation','retired-send'),'Final answer uses the common delivery path.');
  assert.ok(refused);
  assert.equal(f.app.store.db.prepare("SELECT count(*) AS n FROM operations WHERE kind='send_user_message'").get()!.n,1);
  assert.equal(f.app.readCommittedMessage(old.messageId,scope)?.text,'Previously sent');
  assert.equal(Buffer.from(f.app.readAttachment({messageId:old.messageId,...old.attachments[0]!}).data,'base64').toString(),'exact previous bytes');
 }finally{await f.close();}
});

test('a silent user turn fails explicitly without retrying the input',async()=>{
 const f=fixture();try{
  f.setScript(async()=>({status:'completed',text:''}));
  await f.app.start();const reply=await f.app.message('A synthetic question','silent-user');
  assert.match(reply,/main_empty_reply/);assert.equal(f.inputs.length,1);
  assert.equal(f.app.store.db.prepare("SELECT m.status FROM conversation_messages m JOIN conversation_inputs i ON i.replyId=m.id WHERE i.requestId='silent-user'").get()!.status,'failed');
  assert.equal(f.app.tasks.tasks().length,0);
 }finally{await f.close();}
});

for(const status of ['completed','failed','interrupted'] as const)test(`internal coordination may be silent after ${status}, retaining raw reply and execution facts`,async()=>{
 const f=fixture();let taskId='';try{
  f.setScript(async(main,text)=>{
   if(text==='start'){
    taskId=(await openTaskWorker(main,"Inspect a synthetic source; retain any unresolve…",'Inspect a synthetic source; retain any unresolved gaps')).taskId;
    return {status:'completed',text:'Started'};
   }
   return {status:'completed',text:'',messages:[]};
  });
  await f.app.start();await f.app.message('start','silent-coordination');
  await until(()=>f.engines.some(engine=>engine.options.role==='worker'&&engine.finish));
  const worker=f.engines.find(engine=>engine.options.role==='worker')!,body='Observed facts.\n\nAn unresolved gap remains.';
  worker.finish!({status,text:body,messages:[{itemId:'original',phase:'final_answer',text:body}]});
  await f.app.idle();
  const row=f.app.store.db.prepare("SELECT m.payloadJson,r.state FROM agent_messages m JOIN agent_receipts r ON r.messageId=m.id WHERE m.kind='worker_reply'").get()!;
  assert.equal(JSON.parse(String(row.payloadJson)).text,body);assert.equal(row.state,'received');
  assert.equal(f.app.processes.list(f.app.store.meta('mainThread')!).find(node=>node.sourceMessageIds.includes(f.app.store.db.prepare("SELECT id FROM agent_messages WHERE kind='worker_reply'").get()!.id as string))?.status,'completed');
  assert.equal(f.app.tasks.task(taskId).state,'open');assert.equal(f.app.tasks.runs(taskId)[0]!.status,status==='completed'?'succeeded':status);
  assert.equal(f.app.store.db.prepare("SELECT count(*) n FROM operations WHERE kind='send_user_message'").get()!.n,0);
  assert.equal(f.events.filter(event=>event.type==='coordination').length,0);
  assert.equal(f.inputs.length,2);
 }finally{await f.close();}
});
