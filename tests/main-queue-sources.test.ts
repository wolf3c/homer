// Requirements-derived synthetic contracts. No native model, account or production data.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {historyFixture} from './web-history-loading-fixture.js';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {MainInputs} from '../src/recursive-main-inputs.js';
import {RecursiveTools} from '../src/recursive-tools.js';
import {queueMoveBefore} from '../ui/queue-operations.js';

function fixture(database=':memory:'){
 const f=historyFixture(0,160,false,database);
 f.inputs.accept({requestId:'source',text:'Synthetic authority'});
 const source=f.inputs.claim()!;f.inputs.finish(source.messageId,source.revision,'completed');
 const agentId=f.store.meta('mainAgentId')!;
 const actor={agentId,threadId:'synthetic-history',turnId:'main-turn',sourceRequestId:'source'};
 const task=f.tasks.createTask(actor,{operationId:'root',title:'Same title',goal:'Synthetic work',authority:{sourceRequestId:'source',description:'Synthetic work only',materials:[],resultIds:[]}});
 const send=(operationId:string,text='Same text')=>{
  const opened=f.tasks.workerOpen(actor,{operationId,taskId:task.taskId,text:'Synthetic work'}),run=f.tasks.claim(opened.runId);
  if(run)f.tasks.bind(run.id,run.epoch,'thread:'+run.workerId,'turn:'+run.id);
  const current=f.tasks.run(opened.runId);return f.tasks.endSegment(current.id,current.epoch,{status:'completed',text},true)!;
 };
 const consume=(input:{messageId:string;revision:number},generationId='generation:'+input.messageId)=>{
  f.inputs.started(input.messageId,input.revision,generationId,'turn:'+input.messageId);
  f.store.transaction(()=>f.tasks.completeMainMessagesInTransaction([input.messageId],generationId));
 };

 return {...f,send,agentId,actor,consume,task};
}
test('resume boundary preserves old worker events while accepting new user work',()=>{
 const f=fixture();try{
  const old=f.send('old-worker');
  const cutoff=Number(f.store.db.prepare('SELECT max(seq) n FROM agent_messages').get()!.n);
  const resumed=new MainInputs(f.tasks,f.history,undefined,undefined,{pausedThroughSeq:cutoff});
  assert.equal(resumed.claim([],'all'),undefined);
  resumed.accept({requestId:'new-user',text:'synthetic new work'});
  const next=resumed.claim([],'all')!;assert.equal(next.origin,'user');
  if(next.origin==='user')resumed.finish(next.messageId,next.revision,'completed');
  assert.equal(resumed.claim([],'all'),undefined);
  assert.equal(f.store.db.prepare('SELECT state FROM agent_receipts WHERE messageId=?').get(old.messageId)!.state,'pending');
  assert.equal(f.inputs.runnableHead('all')!.messageId,old.messageId);
 }finally{f.close();}
});
test('main queue: Web, Wechat, Worker and Telegram share durable order and claim',()=>{
 const f=fixture();try{
  f.inputs.accept({requestId:'web',text:'Web U1'});
  f.inputs.accept({requestId:'wechat',text:'Wechat U2'},{source:'wechat',persist:()=>{}});
  const worker=f.send('W1');
  f.inputs.accept({requestId:'telegram',text:'Telegram U3'},{source:'telegram',persist:()=>{}});
  const page=f.inputs.dispatchPage(undefined,'epoch','all');
  assert.deepEqual(page.items.map(item=>item.messageId),[...f.inputs.byRequestIds(['web','wechat']).map(item=>item.messageId),worker.messageId,f.inputs.byRequestIds(['telegram'])[0]!.messageId]);
  assert.equal(page.items.find(item=>item.messageId===worker.messageId)!.origin,'worker');
  const workerPayload=f.store.db.prepare('SELECT payloadJson FROM agent_messages WHERE id=?').get(worker.messageId)!.payloadJson;
  f.inputs.move({messageId:worker.messageId,operationId:'move-worker',expectedRevision:0,threadId:'synthetic-history',readEpoch:'epoch',expectedOrderVersion:page.orderVersion,beforeMessageId:page.items[0]!.messageId});
  assert.equal(f.store.db.prepare('SELECT payloadJson FROM agent_messages WHERE id=?').get(worker.messageId)!.payloadJson,workerPayload);
  assert.deepEqual(f.inputs.dispatchPage(undefined,'epoch','all').items.map(item=>item.messageId),[worker.messageId,...page.items.filter(item=>item.messageId!==worker.messageId).map(item=>item.messageId)]);
  const first=f.inputs.claim([],'all')!;assert.equal(first.messageId,worker.messageId);
  assert.throws(()=>f.inputs.move({messageId:worker.messageId,operationId:'late',expectedRevision:first.revision,threadId:'synthetic-history',readEpoch:'epoch',expectedOrderVersion:page.orderVersion,beforeMessageId:null}),/processing|conflict/);
  f.consume(first);
  for(const requestId of ['web','wechat','telegram']){const next=f.inputs.claim([],'all')!;assert.equal(next.origin,'user');if(next.origin==='user'){assert.equal(next.input.requestId,requestId);f.inputs.finish(next.messageId,next.revision,'completed');}}
 }finally{f.close();}
});
test('main queue: raw Worker text preserves whitespace, empty returns and Unicode without changing its body',()=>{
 const f=fixture();try{
  const original='  原文\n\nSame text\t';f.send('raw-text',original);f.send('empty-text','');
  const page=f.inputs.dispatchPage(undefined,'epoch','all');
  assert.deepEqual(page.items.map(item=>item.origin==='worker'?item.text:undefined),[original,'']);
  assert.equal(f.inputs.runnableHead('all')!.origin,'worker');assert.equal(f.store.db.prepare('SELECT count(*) n FROM results').get()!.n,0);
 }finally{f.close();}
});
test('main queue: automatic receipt cannot release a live or unknown main process; confirmed closure never replays it',()=>{
 const f=fixture();try{
  const worker=f.send('ack-before-final');f.inputs.accept({requestId:'later',text:'Next input'});
  const claimed=f.inputs.claim([],'all')!;
  f.processes.start({id:'live-process',threadId:'synthetic-history',sourceKind:'worker',sourceMessageIds:[worker.messageId],messageId:'live-process'},'live-turn');
  f.consume(claimed);
  assert.equal(f.inputs.claim([],'all'),undefined,'a processed receipt does not end the actual turn');
  f.processes.finish('live-process','unknown');assert.equal(f.inputs.claim([],'all'),undefined);
  f.processes.reconcileUnknown('synthetic-history',true);
  assert.equal(f.processes.exact('live-process')!.status,'unknown');
  const next=f.inputs.claim([],'all')!;assert.equal(next.origin,'user');
  assert.notEqual(next.messageId,worker.messageId,'confirmed engine closure releases ownership, not the old business input');
  f.processes.start({id:'lost-final',threadId:'synthetic-history',sourceKind:'user',sourceMessageIds:[next.messageId],messageId:'lost-final'},'lost-turn');
  f.processes.agent('lost-final',{turnId:'lost-turn',itemId:'partial-final',phase:'final_answer',text:'Original item without confirmed terminal',completed:true});
  f.processes.reconcileUnknown('synthetic-history',true);
  assert.equal(f.processes.exact('lost-final')!.final,undefined,'closing an engine never promotes an unconfirmed native final');
 }finally{f.close();}
});
test('main queue: recovery inspection reads only previously claimed closed inputs and cannot consume pending business',()=>{
 const f=fixture();try{
  const prior=f.send('prior'),later=f.send('later'),claimed=f.inputs.claim([],'all')!;
  f.processes.start({id:'failed-process',threadId:'synthetic-history',sourceKind:'worker',sourceMessageIds:[prior.messageId],messageId:'failed-process'},'failed-turn');
  f.store.db.prepare("UPDATE agent_receipts SET state='blocked' WHERE messageId=?").run(prior.messageId);
  assert.deepEqual(f.inputs.recoveryMessages(),[]);
  f.processes.finish('failed-process','failed','turn:failed-turn:terminal');
  const before=f.store.db.prepare('SELECT total_changes() n').get()!.n;
  assert.deepEqual(f.inputs.recoveryMessages().map(message=>message.id),[prior.messageId]);
  assert.equal(f.store.db.prepare('SELECT total_changes() n').get()!.n,before);
  f.store.transaction(()=>f.tasks.completeMainMessagesInTransaction([prior.messageId,later.messageId],'unrelated-turn'));
  assert.equal(f.store.db.prepare('SELECT state FROM agent_receipts WHERE messageId=?').get(later.messageId)!.state,'pending');
  assert.equal(f.store.db.prepare('SELECT state FROM agent_receipts WHERE messageId=?').get(claimed.messageId)!.state,'blocked');
  assert.equal(f.inputs.claim([],'all')!.messageId,later.messageId);
 }finally{f.close();}
});
for(const state of ['blocked','uncertain'] as const)test('recovery retains exact closed evidence and honors startup source boundary: '+state,()=>{
 const f=fixture();try{
  const prior=f.send('old-recovery');f.inputs.claim([],'all');
  f.processes.start({id:'old-process',threadId:'synthetic-history',sourceKind:'worker',sourceMessageIds:[prior.messageId],messageId:'old-process'},'old-turn');
  f.store.db.prepare('UPDATE agent_receipts SET state=? WHERE messageId=?').run(state,prior.messageId);
  f.processes.finish('old-process',state==='blocked'?'failed':'unknown','host:restart:engine_closed');
  const pending=f.send('old-pending'),cutoff=Number(f.store.db.prepare('SELECT max(seq) n FROM agent_messages').get()!.n);
  const inputs=new MainInputs(f.tasks,f.history,undefined,undefined,{pausedThroughSeq:cutoff});
  const messages=inputs.recoveryMessages();assert.deepEqual(messages.map(message=>message.id),[prior.messageId]);
  assert.deepEqual(inputs.recoveryMessages(Number(messages[0]!.seq)),[]);
  assert.equal(inputs.claim([],'all'),undefined);
  f.store.setMeta('mainThread','foreign-thread');assert.deepEqual(inputs.recoveryMessages(),[]);f.store.setMeta('mainThread','synthetic-history');
  inputs.resumeWorkerMessages();assert.equal(inputs.claim([],'all')!.messageId,pending.messageId);
  assert.equal(f.store.db.prepare('SELECT state FROM agent_receipts WHERE messageId=?').get(prior.messageId)!.state,state);
 }finally{f.close();}
});
test('paused Tasks reject new Worker execution until explicitly resumed; old coordination tools are denied',async()=>{
 const f=fixture();try{
  f.tasks.controlTask(f.actor,{operationId:'pause',taskId:f.task.taskId,expectedRevision:1,action:'pause'});
  const snapshot=()=>['tasks','runs','operations'].map(table=>f.store.db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all());const before=snapshot();
  assert.throws(()=>f.tasks.workerOpen(f.actor,{operationId:'open-paused',taskId:f.task.taskId,text:'Do work'}),/task_not_open/);
  assert.deepEqual(snapshot(),before);
  const tools=new RecursiveTools(f.tasks,{rootAuthority:()=>{throw Error('unexpected_authority');},wake(){},async stop(){},async steer(){}});
  for(const name of ['task_delegate','task_continue','inbox_read','inbox_ack','dispatch_work'])await assert.rejects(tools.call(f.actor,name,{},'legacy-'+name),/tool_denied/);
  f.tasks.controlTask(f.actor,{operationId:'resume',taskId:f.task.taskId,expectedRevision:f.tasks.task(f.task.taskId).revision,action:'resume'});
  assert.equal(f.tasks.workerOpen(f.actor,{operationId:'open-resumed',taskId:f.task.taskId,text:'Do work'}).state,'queued');
 }finally{f.close();}
});
test('historical source text cannot gain authority in another Main thread',()=>{
 const f=fixture();try{
  f.store.setMeta('mainThread','new-thread');const actor={...f.actor,threadId:'new-thread'};
  assert.throws(()=>f.tasks.pending.source(actor,'source'),/pending_source_denied/);
  assert.throws(()=>f.tasks.createTask(actor,{operationId:'cross-thread',goal:'Do work',authority:{sourceRequestId:'source',description:'Forged',materials:[],resultIds:[]}}),/pending_source_denied/);
 }finally{f.close();}
});
test('main queue: Worker order survives reopen and pagination; source identity cannot be forged',()=>{
 const parent=resolve('.codex/scratch/worker-return-main-queue-20261023');mkdirSync(parent,{recursive:true});
 const dir=mkdtempSync(join(parent,'reopen-')),database=join(dir,'queue.sqlite');
 const f=fixture(database);let reopened:ReturnType<typeof historyFixture>|undefined;
 try{
  for(let n=0;n<100;n++)f.inputs.accept({requestId:'page-'+n,text:'Same body'});
  const w1=f.send('page-w1'),w2=f.send('page-w2'),first=f.inputs.dispatchPage(undefined,'epoch','all');
  const second=f.inputs.dispatchPage(first.nextCursor!,'epoch','all');
  const worker=second.items.find(item=>item.messageId===w2.messageId)!;
  const move={messageId:worker.messageId,operationId:'cross-page',expectedRevision:worker.revision,threadId:'synthetic-history',readEpoch:'epoch',expectedOrderVersion:second.orderVersion,beforeMessageId:first.items[0]!.messageId};
  const result=f.inputs.move(move);
  assert.throws(()=>f.inputs.dispatchPage(first.nextCursor!,'epoch','all'),/cursor_expired/);
  f.close();reopened=historyFixture(0,160,false,database);
  assert.equal(reopened.inputs.runnableHead('all')!.messageId,w2.messageId);
  assert.deepEqual(reopened.inputs.move(move),result,'original opid returns its exact committed receipt across restart');
  const claimed=reopened.inputs.claim([],'all')!;assert.equal(claimed.messageId,w2.messageId);
  reopened.tasks.reconcile();
  assert.equal(reopened.inputs.dispatchPage(undefined,'restarted','all').items.find(item=>item.messageId===w2.messageId)!.state,'uncertain');
  assert.equal(reopened.inputs.claim([],'all')!.origin,'user','unknown Worker is retained but never replayed');
  assert.equal(reopened.inputs.dispatchPage(undefined,'restarted','all').items.filter(item=>item.messageId===w1.messageId).length,0,'unloaded later Worker is not lost or pulled into page one');
  const input={requestId:'different-channel',text:'Same body'};
  reopened.inputs.accept(input,{source:'wechat',persist(){}});
  assert.equal(reopened.inputs.accept(input,{source:'wechat',persist(){}}).fresh,false);
  assert.throws(()=>reopened!.inputs.accept(input,{source:'telegram',persist(){}}),/request_id_conflict/);
  reopened.inputs.accept({...input,requestId:'telegram-id'},{source:'telegram',persist(){}});
  assert.equal(reopened.inputs.byRequestIds(['different-channel','telegram-id']).length,2);
 }finally{if(reopened)reopened.close();else f.close();rmSync(dir,{recursive:true,force:true});}
});
test('main queue: duplicate Worker receipt is one input; same text with a different ID remains distinct',()=>{
 const f=fixture();try{
  const a=f.send('same-event');assert.equal(f.send('same-event').messageId,a.messageId);const b=f.send('another-event');
  assert.deepEqual(f.inputs.dispatchPage(undefined,'epoch','all').items.map(item=>item.messageId),[a.messageId,b.messageId]);
  assert.equal(f.history.list('synthetic-history').filter(item=>item.role==='user').length,1,'Worker is never fabricated as user history');
 }finally{f.close();}
});
test('main queue: raw reply previews hydrate one bounded page without a query per Worker',()=>{
 const f=fixture();try{
  for(let n=0;n<100;n++){
   f.send('preview-'+n,'Result '+n);
  }
  let queries=0;const prepare=f.store.db.prepare.bind(f.store.db);
  f.store.db.prepare=(...args:Parameters<typeof prepare>)=>{queries++;return prepare(...args);};
  const page=f.inputs.dispatchPage(undefined,'epoch','all');
  assert.equal(page.items.length,80);assert.equal(page.totalWaiting,100);assert.ok(page.nextCursor);
  assert.deepEqual(page.items.map(item=>item.origin==='worker'?item.text:undefined),Array.from({length:80},(_,n)=>'Result '+n));
  assert.ok(queries<=6,`one page must not query every reply separately: ${queries}`);
 }finally{f.close();}
});
test('main queue: U1/W1/U2/W2 interleave and orphan sources never gain current-thread authority',()=>{
 const f=fixture();try{
  f.inputs.accept({requestId:'U1',text:'Same name'});const w1=f.send('W1');
  f.inputs.accept({requestId:'U2',text:'Same name'});const w2=f.send('W2');
  const page=f.inputs.dispatchPage(undefined,'epoch','all'),row=page.items.find(item=>item.messageId===w2.messageId)!;
  f.inputs.move({messageId:w2.messageId,operationId:'first-W2',expectedRevision:row.revision,threadId:'synthetic-history',readEpoch:'epoch',expectedOrderVersion:page.orderVersion,beforeMessageId:page.items[0]!.messageId});
  const expected=[w2.messageId,page.items[0]!.messageId,w1.messageId,page.items[2]!.messageId];
  for(const messageId of expected){const next=f.inputs.claim([],'all')!;assert.equal(next.messageId,messageId);if(next.origin==='user')f.inputs.finish(next.messageId,next.revision,'completed');else f.consume(next);}
  const orphan=f.send('orphan');f.store.db.prepare('UPDATE agent_messages SET taskVersion=999 WHERE id=?').run(orphan.messageId);
  assert.equal(f.inputs.dispatchSummary().unscoped,1);assert.equal(f.inputs.runnableHead('all'),undefined);
  assert.deepEqual(f.inputs.dispatchPage(undefined,'epoch','all').items,[]);
  assert.equal(f.store.db.prepare('SELECT state FROM agent_receipts WHERE messageId=?').get(orphan.messageId)!.state,'pending');
 }finally{f.close();}
});
test('main queue: mixed segments keep a locked pending barrier and rejected races leave no operation or rank writes',()=>{
 const f=fixture();try{
  f.inputs.accept({requestId:'U1',text:'Same text'});const w1=f.send('left');
  f.inputs.accept({requestId:'barrier',text:'Claim already recorded'});
  f.store.db.prepare("INSERT INTO requests(id,hash,state,response,createdAt) VALUES('barrier','synthetic','running','',0)").run();
  f.inputs.accept({requestId:'U2',text:'Same text'});const w2=f.send('right');
  const page=()=>f.inputs.dispatchPage(undefined,'epoch','all'),move=(messageId:string,beforeMessageId:string|null,operationId:string)=>{const p=page(),row=p.items.find(i=>i.messageId===messageId)!;return {messageId,beforeMessageId,operationId,threadId:'synthetic-history',readEpoch:'epoch',expectedRevision:row.revision,expectedOrderVersion:p.orderVersion};};
  const first=page(),u1=first.items[0]!.messageId,barrier=first.items[2]!.messageId,u2=first.items[3]!.messageId;
  assert.equal(first.items[2]!.movable,false);
  f.inputs.move(move(w1.messageId,u1,'left-side'));f.inputs.move(move(w2.messageId,u2,'right-side'));
  const snapshot=()=>['agent_messages','agent_receipts','operations'].map(table=>f.store.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
  const before=snapshot();assert.throws(()=>f.inputs.move(move(w2.messageId,w1.messageId,'across-barrier')),/queue_input_locked/);assert.deepEqual(snapshot(),before);
  assert.deepEqual(page().items.map(i=>i.messageId),[w1.messageId,u1,barrier,w2.messageId,u2]);
  const stale=move(w2.messageId,u2,'new-arrival');f.inputs.accept({requestId:'later',text:'Concurrent arrival'});
  const afterArrival=snapshot();assert.throws(()=>f.inputs.move(stale),/queue_order_conflict/);assert.deepEqual(snapshot(),afterArrival);
  const deleted=move(u2,null,'after-cancel');f.inputs.cancel({requestId:'U2',operationId:'cancel-U2',expectedRevision:deleted.expectedRevision});
  assert.throws(()=>f.inputs.move(deleted),/queue_input_processing/);
 }finally{f.close();}
});
test('main queue: same-page final index retains the unloaded Worker successor across 165 mixed inputs and reopen',()=>{
 const parent=resolve('.codex/scratch/worker-return-main-queue-20261023');mkdirSync(parent,{recursive:true});
 const dir=mkdtempSync(join(parent,'page-tail-')),database=join(dir,'queue.sqlite');let f:ReturnType<typeof historyFixture>|ReturnType<typeof fixture>=fixture(database);
 try{
  for(let n=0;n<80;n++)f.inputs.accept({requestId:'page-'+n,text:'Same body'});
  const worker=(f as ReturnType<typeof fixture>).send('unloaded-worker');
  for(let n=80;n<164;n++)f.inputs.accept({requestId:'page-'+n,text:'Same body'});
  const first=f.inputs.dispatchPage(undefined,'epoch','all'),source=first.items[0]!;
  assert.equal(first.items.length,80);assert.equal(first.totalWaiting,165);assert.equal(first.items.at(-1)!.nextMessageId,worker.messageId);
  const beforeMessageId=queueMoveBefore(first.items,source.messageId,0,79);assert.equal(beforeMessageId,worker.messageId);
  const operation={messageId:source.messageId,beforeMessageId:beforeMessageId!,operationId:'page-tail',expectedRevision:source.revision,expectedOrderVersion:first.orderVersion,threadId:'synthetic-history',readEpoch:'epoch'},result=f.inputs.move(operation);
  assert.throws(()=>f.inputs.dispatchPage(first.nextCursor!,'epoch','all'),/cursor_expired/);
  f.close();f=historyFixture(0,160,false,database);assert.deepEqual(f.inputs.move(operation),result);
  const ids:string[]=[];let cursor:string|undefined;
  do{const page=f.inputs.dispatchPage(cursor,'reopen','all');ids.push(...page.items.map(i=>i.messageId));cursor=page.nextCursor??undefined;}while(cursor);
  assert.equal(ids.length,165);assert.equal(new Set(ids).size,165);assert.equal(ids[79],source.messageId);assert.equal(ids[80],worker.messageId);
  const claimed=f.inputs.claim([],'all')!;assert.equal(claimed.origin,'user');if(claimed.origin==='user')assert.equal(claimed.input.text,'Same body');
 }finally{f.close();rmSync(dir,{recursive:true,force:true});}
});

test('desktop release admits only pending Worker messages, preserving old user and unknown receipts',()=>{
 const f=fixture();try{
  f.inputs.accept({requestId:'old-user',text:'Do not replay this old user input'});
  const uncertain=f.send('uncertain'),active=f.send('old-active'),first=f.send('first'),second=f.send('second');
  f.store.db.prepare("UPDATE agent_receipts SET state='uncertain',revision=3 WHERE messageId=?").run(uncertain.messageId);
  f.store.db.prepare("UPDATE agent_receipts SET state='offered',revision=1,offeredTurnId='old-active-turn' WHERE messageId=?").run(active.messageId);
  const cutoff=Number(f.store.db.prepare('SELECT max(seq) n FROM agent_messages').get()!.n);
  const resumed=new MainInputs(f.tasks,f.history,undefined,undefined,{pausedThroughSeq:cutoff});
  assert.equal(resumed.dispatchSummary().awaitingUser,true);assert.equal(resumed.claim([],'all'),undefined);
  resumed.accept({requestId:'new-user',text:'New requirements first'});
  const user=resumed.claim([],'all')!;assert.equal(user.origin,'user');resumed.finish(user.messageId,user.revision,'completed');
  resumed.resumeWorkerMessages();
  for(const message of [first,second]){
   const next=resumed.claim([],'all')!;assert.equal(next.messageId,message.messageId);
   assert.equal(resumed.claim([],'all'),undefined,'one receipt owns dispatch until acknowledged');
   f.consume(next);
  }
  assert.equal(resumed.claim([],'all'),undefined);assert.equal(resumed.dispatchSummary().awaitingUser,undefined);
  assert.equal(f.inputs.byRequestIds(['old-user'])[0]!.state,'queued');
  assert.equal(f.store.db.prepare('SELECT state FROM agent_receipts WHERE messageId=?').get(active.messageId)!.state,'offered');
  assert.deepEqual({...f.store.db.prepare('SELECT state,revision FROM agent_receipts WHERE messageId=?').get(uncertain.messageId)},{state:'uncertain',revision:3});
 }finally{f.close();}
});
