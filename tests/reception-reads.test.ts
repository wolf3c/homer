import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { Files } from '../src/files.js';
import { WorkerInteractions } from '../src/worker-interactions.js';
import { ConversationHistory } from '../src/web-history.js';
import { RecursiveTasks } from '../src/recursive-tasks.js';
import { MainInputs, MainInputClaimError } from '../src/recursive-main-inputs.js';
function fixture(readiness?: (input:{requestId:string})=>'ready'|'preparing'|'failed') {
 const store=new Store(':memory:');new WorkerInteractions(store.db);const history=new ConversationHistory(store.db),tasks=new RecursiveTasks(store,new Files('.codex/scratch/main-agent-reception-optimization/synthetic-workspace'));tasks.migrate();store.setMeta('mainThread','synthetic-thread');
 return {store,history,tasks,queue:new MainInputs(tasks,history,undefined,readiness?{claim(){},readiness}:undefined)};
}
test('reception: queue projection, runnable and claim never hydrate full conversation history',()=>{
 const f=fixture();try{
  f.queue.accept({requestId:'one',text:'Synthetic input',interactionId:'synthetic-interaction'});
  f.history.list=()=>{throw Error('full_history_forbidden');};
  assert.equal(f.queue.list()[0]!.input.interactionId,'synthetic-interaction');assert.equal(f.queue.runnable(),true);
  assert.equal(f.queue.claim()!.input.requestId,'one');
 }finally{f.store.close();}
});
test('reception: terminal interrupt lookup returns only IDs for the original generation',()=>{
 const f=fixture(input=>input.requestId==='preparing'?'preparing':'ready');try{
  for(let i=0;i<160;i++){
   f.queue.accept({requestId:'history-'+i,text:'Synthetic history'});
   const row=f.queue.claim()!;f.queue.finish(row.messageId,row.revision,'completed');
  }
  f.queue.accept({requestId:'active',text:'Synthetic target'});
  const target=f.queue.claim()!;
  f.queue.started(target.messageId,target.revision,'generation','turn');
  f.queue.finish(target.messageId,target.revision,'interrupted');
  const interrupt={messageId:target.replyId,generationId:'generation'};
  const pending=f.queue.accept({requestId:'preparing',text:'Synthetic preparing'},undefined,interrupt);
  const unknown=f.queue.accept({requestId:'unknown',text:'Synthetic unknown'},undefined,interrupt);
  const late=f.queue.accept({requestId:'late',text:'Synthetic late'},undefined,interrupt);
  const confirmed=f.queue.accept({requestId:'confirmed',text:'Synthetic confirmed'},undefined,interrupt);
  f.queue.accept({requestId:'unrelated',text:'Synthetic unrelated'},undefined,{...interrupt,generationId:'other'});
  f.queue.interruptReceipt(unknown.queueMessageId!,'uncertain');
  f.queue.interruptReceipt(late.queueMessageId!,'failed');
  f.queue.interruptReceipt(confirmed.queueMessageId!,'confirmed');
  assert.equal(f.queue.list().length,166);
  f.history.inputs=()=>{throw Error('terminal_lookup_must_not_hydrate_input');};
  const sql:string[]=[],prepare=f.store.db.prepare.bind(f.store.db);
  f.store.db.prepare=query=>{sql.push(query);return prepare(query);};
  assert.deepEqual(f.queue.interruptIdsForGeneration('generation'),[pending.queueMessageId,unknown.queueMessageId,late.queueMessageId]);
  assert.equal(sql.filter(query=>query.includes('agent_messages')).length,1);
  assert.doesNotMatch(sql.join('\n'),/conversation_messages|conversation_inputs/);
 }finally{f.store.close();}
});
test('reception: history association loading is batched and does not duplicate messages',()=>{
 const f=fixture();try{
  for(let i=0;i<1100;i++){const r=f.history.accept('synthetic-thread',{requestId:'input-'+i,text:'Synthetic '+i});f.history.feedback('synthetic-thread',r.replyId,'up');for(let t=0;t<2;t++)f.history.tool(r.replyId,{id:'t'+t,label:'Synthetic tool',phase:'start'});}
  let count=0;const prepare=f.store.db.prepare.bind(f.store.db);f.store.db.prepare=sql=>{count++;return prepare(sql);};
  const messages=f.history.list('synthetic-thread');assert.equal(messages.length,2200);assert.equal(new Set(messages.map(m=>m.id)).size,2200);assert.equal(messages[1]!.toolActivities!.length,2);assert.equal(messages[1]!.feedback,'up');assert.ok(count<=12,`history prepares=${count}`);
 }finally{f.store.close();}
});
test('reception: durable FIFO ignores legacy priorities and only a preparing head blocks later inputs',()=>{
 const preparing=new Set(['ordinary']);const f=fixture(input=>preparing.has(input.requestId)?'preparing':'ready');try{
  f.queue.accept({requestId:'first',text:'Synthetic first input'});
  f.queue.accept({requestId:'ordinary',text:'Synthetic ordinary'});
  const urgent=f.queue.accept({requestId:'urgent',text:'Synthetic interrupt'},undefined,{messageId:'synthetic-reply',generationId:'synthetic-generation'});
  f.store.db.prepare("UPDATE agent_messages SET payloadJson=json_set(payloadJson,'$.priority',1) WHERE id=?").run(urgent.queueMessageId!);
  assert.equal(f.queue.runnable(),true);const claimed=f.queue.claim()!;assert.equal(claimed.input.requestId,'first');f.queue.finish(claimed.messageId,claimed.revision,'completed');
  assert.equal(f.queue.runnable(),false);assert.equal(f.queue.claim(),undefined);preparing.clear();
  for(const id of ['ordinary','urgent']){assert.equal(f.queue.runnable(),true);const next=f.queue.claim()!;assert.equal(next.input.requestId,id);f.queue.finish(next.messageId,next.revision,'completed');}
  assert.equal(f.queue.runnable(),false);assert.deepEqual(f.queue.list().map(q=>q.state),['completed','completed','completed']);
 }finally{f.store.close();}
});
test('reception: failed head remains visible and is rejected by original fenced failure path',()=>{
 const f=fixture(()=> 'failed');try{f.queue.accept({requestId:'bad',text:'Synthetic failed material'});assert.equal(f.queue.runnable(),true);assert.throws(()=>f.queue.claim(),MainInputClaimError);assert.equal(f.queue.list()[0]!.preparation,'failed');}finally{f.store.close();}
});
test('reception: current queue index avoids historical receipt scans',()=>{
 const f=fixture();try{
  f.tasks.migrate();f.tasks.migrate();
  assert.equal(f.store.db.prepare("SELECT count(*) n FROM sqlite_master WHERE type='index' AND name='agent_receipt_state'").get()!.n,1);
  f.queue.accept({requestId:'indexed',text:'Synthetic indexed input'});
  const original=f.store.db.prepare.bind(f.store.db);let candidate='';f.store.db.prepare=sql=>{if(/\br\.state\s*=\s*'pending'/.test(sql))candidate=sql;return original(sql);};
  assert.equal(f.queue.runnable(),true);assert.ok(candidate);
  const plan=original('EXPLAIN QUERY PLAN '+candidate).all(f.store.meta('mainAgentId')!,f.store.meta('mainThread')!);
  assert.ok(plan.some(row=>/SEARCH r USING (?:COVERING )?INDEX .*\(recipientAgentId=\? AND state=\?\)/.test(String(row.detail))),JSON.stringify(plan));
  assert.ok(!plan.some(row=>/\bSCAN r\b/.test(String(row.detail))),JSON.stringify(plan));
 }finally{f.store.close();}
});
test('reception: runnable and claim share durable FIFO for preparing, ready and failed interrupts',()=>{
 for(const initial of ['preparing','ready','failed'] as const){
  let preparation:'preparing'|'ready'|'failed'=initial;
  const f=fixture(input=>input.requestId==='first-interrupt'?preparation:'ready');try{
   const target={generationId:'synthetic-generation',messageId:'synthetic-reply'};
   const first=f.queue.accept({requestId:'first-interrupt',text:'Synthetic first interrupt'},undefined,target);
   f.queue.accept({requestId:'ordinary-interrupt',text:'Synthetic ordinary interrupt'},undefined,target);
   f.queue.accept({requestId:'first-normal',text:'Synthetic first ordinary input'});
   for(const id of ['ordinary-1','ordinary-2'])f.queue.accept({requestId:id,text:'Synthetic ordinary FIFO'});
   if(initial==='preparing'){
    assert.equal(f.queue.runnableHead(),undefined);assert.equal(f.queue.runnable(),false);assert.equal(f.queue.claim(),undefined);
    assert.equal(f.queue.list()[0]!.preparation,'preparing');preparation='ready';
   }
   assert.equal(f.queue.runnableHead()!.input.requestId,'first-interrupt');assert.equal(f.queue.runnable(),true);
   if(initial==='failed'){
    let failure:MainInputClaimError|undefined;try{f.queue.claim();}catch(error){assert.ok(error instanceof MainInputClaimError);failure=error;}
    assert.ok(failure);assert.equal(failure.message,'media_preparation_failed');assert.equal(failure.messageId,first.queueMessageId);
    f.queue.failClaim(failure);
    assert.deepEqual({...f.store.db.prepare('SELECT state,revision FROM agent_receipts WHERE messageId=?').get(first.queueMessageId!)},{state:'rejected',revision:1});
    assert.equal(f.queue.list()[0]!.state,'failed');assert.match(f.history.list('synthetic-thread').find(m=>m.id===first.replyId)!.text,/附件准备失败/);
   }
   for(const id of [...(initial==='failed'?[]:['first-interrupt']),'ordinary-interrupt','first-normal','ordinary-1','ordinary-2']){
    assert.equal(f.queue.runnableHead()!.input.requestId,id);
    const next=f.queue.claim()!;assert.equal(next.input.requestId,id);
    assert.deepEqual({...f.store.db.prepare('SELECT state,revision FROM agent_receipts WHERE messageId=?').get(next.messageId)},{state:'offered',revision:1});
    f.queue.started(next.messageId,next.revision,'generation-'+id,'turn-'+id);
    assert.equal(f.store.db.prepare('SELECT state FROM agent_receipts WHERE messageId=?').get(next.messageId)!.state,'received');
    if(next.interruptTarget)f.queue.interruptReceipt(next.messageId,'failed');
    f.queue.finish(next.messageId,next.revision,'completed');
    assert.deepEqual({...f.store.db.prepare('SELECT state,revision FROM agent_receipts WHERE messageId=?').get(next.messageId)},{state:'processed',revision:2});
   }
   assert.equal(f.queue.runnable(),false);assert.equal(f.queue.claim(),undefined);
   assert.ok(f.queue.list().every(row=>row.state==='completed'||(initial==='failed'&&row.input.requestId==='first-interrupt'&&row.state==='failed')));
  }finally{f.store.close();}
 }
});
