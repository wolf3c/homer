// Real host and original replies; no native engine, account or channel calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,until} from './fixtures/worker-chat-host.js';

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
    taskId=(await main.call('task_create',{goal:'Inspect a synthetic source; retain any unresolved gaps'})).taskId;
    await main.call('worker_open',{taskId,message:'Inspect the source'});
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
  assert.equal(JSON.parse(String(row.payloadJson)).text,body);assert.equal(row.state,'processed');
  assert.equal(f.app.tasks.task(taskId).state,'open');assert.equal(f.app.tasks.runs(taskId)[0]!.status,status==='completed'?'succeeded':status);
  assert.equal(f.app.tasks.deliveries().length,0);
  assert.equal(f.events.filter(event=>event.type==='coordination'||event.type==='delivery').length,0);
  assert.equal(f.inputs.length,2);
 }finally{await f.close();}
});
