// Requirements-derived synthetic contracts. No native model, account or production data.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {historyFixture} from './web-history-loading-fixture.js';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {Homer} from '../src/service.js';
import {MainInputs} from '../src/recursive-main-inputs.js';
import {RecursiveTools} from '../src/recursive-tools.js';
import {queueMoveBefore} from '../ui/queue-operations.js';

function fixture(database=':memory:'){
 const f=historyFixture(0,160,false,database);
 f.inputs.accept({requestId:'source',text:'Synthetic authority'});
 const source=f.inputs.claim()!;f.inputs.finish(source.messageId,source.revision,'completed');
 const agentId=f.store.meta('mainAgentId')!;
 const root=f.tasks.createRoot({agentId,sourceRequestId:'source'},{operationId:'root',title:'Same title',executorKind:'worker',contract:{goal:'Synthetic work',inputs:[],resultKind:'structured',acceptance:{criteria:[]}},authority:{sourceRequestId:'source',description:'Synthetic work only',materials:[],resultIds:[],collaborateTaskIds:[],maxActiveMs:10000}});
 const run=f.tasks.claim(root.runId!)!;f.tasks.bind(run.id,run.epoch,'worker-thread','worker-turn');
 const worker={agentId:f.tasks.task(root.taskId).executorAgentId,runId:run.id,epoch:run.epoch,threadId:'worker-thread',turnId:'worker-turn'};
 const send=(operationId:string,payload:unknown={text:'Same text',queueOrder:-999})=>{const task=f.tasks.task(root.taskId);return f.tasks.send(worker,{operationId,taskId:task.id,version:task.headVersion,expectedTaskRevision:task.revision,recipientAgentId:agentId,kind:'progress',payload});};
 return {...f,send,agentId};
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
  f.tasks.ack({agentId:f.agentId},{operationId:'ack-worker',messageId:first.messageId,disposition:'processed',reason:'Synthetic processed'});
  for(const requestId of ['web','wechat','telegram']){const next=f.inputs.claim([],'all')!;assert.equal(next.origin,'user');if(next.origin==='user'){assert.equal(next.input.requestId,requestId);f.inputs.finish(next.messageId,next.revision,'completed');}}
 }finally{f.close();}
});
test('main queue: valid scalar and null business payloads preserve original data without breaking readiness',()=>{
 const f=fixture();try{
  f.send('null-payload',null);f.send('scalar-payload','Original scalar');
  const page=f.inputs.dispatchPage(undefined,'epoch','all');
  assert.deepEqual(page.items.map(item=>item.origin==='worker'?item.payload:undefined),[null,'Original scalar']);
  assert.equal(f.inputs.runnableHead('all')!.origin,'worker');
 }finally{f.close();}
});
test('main queue: processed ACK cannot release a live or unknown main process; confirmed closure never replays it',()=>{
 const f=fixture();try{
  const worker=f.send('ack-before-final');f.inputs.accept({requestId:'later',text:'Next input'});
  f.inputs.claim([],'all');
  f.processes.start({id:'live-process',threadId:'synthetic-history',sourceKind:'worker',sourceMessageIds:[worker.messageId],messageId:'live-process'},'live-turn');
  f.tasks.ack({agentId:f.agentId},{operationId:'ack-before-final',messageId:worker.messageId,disposition:'processed',reason:'Synthetic consumed'});
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
test('main queue: user recovery reads only previously claimed ended inputs and cannot ACK later business',async()=>{
 const f=fixture();try{
  const prior=f.send('prior'),later=f.send('later');f.inputs.claim([],'all');
  f.processes.start({id:'failed-process',threadId:'synthetic-history',sourceKind:'worker',sourceMessageIds:[prior.messageId],messageId:'failed-process'},'failed-turn');
  f.store.db.prepare("UPDATE agent_receipts SET state='blocked' WHERE messageId=?").run(prior.messageId);
  assert.deepEqual(f.inputs.recoveryMessages(),[],'a live process cannot become recovery history');
  assert.deepEqual(f.inputs.recoveryQueue(),[]);
  f.processes.finish('failed-process','failed','turn:failed-turn:terminal');
  const context={event:false,requestId:'user-recovery',inspected:new Set()};
  const host=Object.create(Homer.prototype) as Homer;
  Object.assign(host,{store:f.store,tasks:f.tasks,inputs:f.inputs,recursiveTools:new RecursiveTools(f.tasks,{rootAuthority(){throw Error('unexpected_authority');},wake(){},async stop(){throw Error('unexpected_stop');},async update(){throw Error('unexpected_update');}}),mainContext:context,accountClocks(){}});
  const messages=await host['recursiveTool']({agentId:f.agentId},'inbox_read',{after:0}) as {id:string}[];
  assert.deepEqual(messages.map(message=>message.id),[prior.messageId]);
  assert.deepEqual(f.inputs.recoveryQueue(),[],'hidden blocked history is not automatically reconciled');
  const ack={operationId:'recover-original',messageId:later.messageId,disposition:'processed',reason:'Synthetic recovery',resultId:null};
  await assert.rejects(host['recursiveTool']({agentId:f.agentId},'inbox_ack',ack),/message_not_claimed/);
  await host['recursiveTool']({agentId:f.agentId},'inbox_ack',{...ack,messageId:prior.messageId});
  assert.deepEqual(f.inputs.recoveryMessages(),[]);
  assert.equal(f.inputs.claim([],'all')!.messageId,later.messageId,'recovery never auto-requeues the old business');
 }finally{f.close();}
});
for(const state of ['blocked','uncertain'] as const)test('user recovery can inspect and ACK ended pre-start Worker history without replay: '+state,async()=>{
 const f=fixture();try{
  const prior=f.send('old-recovery');f.inputs.claim([],'all');
  f.processes.start({id:'old-process',threadId:'synthetic-history',sourceKind:'worker',sourceMessageIds:[prior.messageId],messageId:'old-process'},'old-turn');
  f.store.db.prepare('UPDATE agent_receipts SET state=? WHERE messageId=?').run(state,prior.messageId);
  f.processes.finish('old-process',state==='blocked'?'failed':'unknown',state==='blocked'?'turn:old-turn:terminal':'host:restart:engine_closed');
  const pending=f.send('old-pending');
  const cutoff=Number(f.store.db.prepare('SELECT max(seq) n FROM agent_messages').get()!.n),inputs=new MainInputs(f.tasks,f.history,undefined,undefined,{pausedThroughSeq:cutoff});
  const host=Object.create(Homer.prototype) as Homer;
  const context={event:true,requestId:'new-user',inspected:new Set<string>()};
  Object.assign(host,{store:f.store,tasks:f.tasks,inputs,recursiveTools:new RecursiveTools(f.tasks,{rootAuthority(){throw Error('unexpected_authority');},wake(){},async stop(){throw Error('unexpected_stop');},async update(){throw Error('unexpected_update');}}),mainContext:context,accountClocks(){}});
  const ack={operationId:'old-ack',messageId:prior.messageId,disposition:'processed',reason:'Synthetic reviewed original work',resultId:null};
  assert.deepEqual(await host['recursiveTool']({agentId:f.agentId},'inbox_read',{after:0}),[]);
  await assert.rejects(host['recursiveTool']({agentId:f.agentId},'inbox_ack',ack),/message_not_claimed/);
  context.event=false;
  const changes=f.store.db.prepare('SELECT total_changes() n').get()!.n;
  const messages=await host['recursiveTool']({agentId:f.agentId},'inbox_read',{after:0}) as {id:string;seq:number}[];
  assert.deepEqual(messages.map(message=>message.id),[prior.messageId]);
  assert.deepEqual(inputs.recoveryQueue().map(row=>({...row})),state==='uncertain'?[{id:prior.messageId,seq:messages[0]!.seq}]:[],'only visible uncertain history is selected, never hidden blocked or pending inputs');
  assert.equal(f.store.db.prepare('SELECT total_changes() n').get()!.n,changes,'recovery read does not alter receipts');
  assert.deepEqual(inputs.recoveryMessages(messages[0]!.seq),[],'after remains a cursor');
  assert.equal(inputs.claim([],'all'),undefined,'reading history does not release the startup fence');
  await assert.rejects(host['recursiveTool']({agentId:f.agentId},'inbox_ack',{...ack,messageId:pending.messageId}),/message_not_claimed/);
  f.store.setMeta('mainThread','another-thread');
  assert.deepEqual(await host['recursiveTool']({agentId:f.agentId},'inbox_read',{after:0}),[]);
  await assert.rejects(host['recursiveTool']({agentId:f.agentId},'inbox_ack',ack),/message_not_claimed/);
  f.store.setMeta('mainThread','synthetic-history');
  await host['recursiveTool']({agentId:f.agentId},'inbox_ack',ack);
  assert.equal(f.store.db.prepare('SELECT state FROM agent_receipts WHERE messageId=?').get(prior.messageId)!.state,'processed');
  assert.deepEqual(inputs.recoveryMessages(),[]);
  inputs.resumeWorkerMessages();
  assert.equal(inputs.claim([],'all')!.messageId,pending.messageId,'only the unclaimed pending input is dispatched');
 }finally{f.close();}
});
test('a new turn cannot continue or otherwise mutate a historical task while paused',async()=>{
 const f=fixture();try{
  const task=f.tasks.tasks()[0]!,host=Object.create(Homer.prototype) as Homer;
  let invoked=false;
  Object.assign(host,{store:f.store,tasks:f.tasks,inputs:f.inputs,pausedTaskIds:new Set([task.id]),recursiveTools:{async call(){invoked=true;return {}; }},mainContext:{event:false,requestId:'new-user',inspected:new Set()},accountClocks(){}});
  await assert.rejects(host['recursiveTool']({agentId:f.agentId},'task_continue',{operationId:'old-continue',taskId:task.id,version:task.headVersion,expectedTaskRevision:task.revision}),/desktop_old_task_paused/);
  assert.equal(invoked,false);
 }finally{f.close();}
});
test('paused pending items and historical sources cannot be edited or dispatched by a new turn',async()=>{
 const f=fixture();try{
  const host=Object.create(Homer.prototype) as Homer;let invoked=false;
  Object.assign(host,{store:f.store,tasks:f.tasks,inputs:f.inputs,pausedTaskIds:new Set(),pausedPendingIds:new Set(['old-pending']),pausedSourceIds:new Set(['old-source']),pendingTools:{async call(){invoked=true;}},recursiveTools:{async call(){invoked=true;}},mainContext:{event:false,requestId:'new-user',inspected:new Set()},accountClocks(){}});
  await assert.rejects(host['pendingTool']('pending_update',{id:'old-pending'}),/desktop_old_pending_paused/);
  for(const pending of [{items:[{id:'old-pending',expectedRevision:1}],sourceRequestIds:['new'],primarySourceRequestId:'new'},{items:[],sourceRequestIds:['old-source'],primarySourceRequestId:'old-source'}])
   await assert.rejects(host['recursiveTool']({agentId:f.agentId},'task_delegate',{parentTaskId:null,pending}),/desktop_old_pending_paused/);
  assert.equal(invoked,false);
 }finally{f.close();}
});
test('legacy dispatch and old interaction actions remain fenced while paused',async()=>{
 const f=fixture();try{
  const host=Object.create(Homer.prototype) as Homer,task=f.tasks.tasks()[0]!,main={threadId:'synthetic-thread',turnId:'synthetic-turn'};
  Object.assign(host,{store:f.store,tasks:f.tasks,inputs:f.inputs,main,pausedMatterIds:new Set([task.matterId]),pausedInteractionIds:new Set(['old-interaction']),mainContext:{event:false,requestId:'new-user',inspected:new Set(),inspectedInteractions:new Set(['old-interaction'])},closing:false});
  await assert.rejects(host['mainTool']({threadId:main.threadId,turnId:main.turnId,callId:'synthetic',tool:'dispatch_work',arguments:{matterId:task.matterId}}),/desktop_old_task_paused/);
  await assert.rejects(host['interactionTool']('escalate_interaction',{interactionId:'old-interaction'}),/desktop_old_interaction_paused/);
 }finally{f.close();}
});
test('a repeated native approval reply cannot touch a paused old interaction',()=>{
 const host=Object.create(Homer.prototype) as Homer;let responded=false;
 Object.assign(host,{closing:false,closed:false,mainBroken:false,pausedInteractionIds:new Set(['old-approval']),mainApprovals:{owns:()=>true,respond(){responded=true;}}});
 assert.throws(()=>host.submitMessage({requestId:'old-reply',text:'Synthetic',interactionId:'old-approval'}),/desktop_old_interaction_paused/);
 assert.equal(responded,false);
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
test('main queue: result previews hydrate one bounded page without a query per Worker',()=>{
 const f=fixture();try{
  for(let n=0;n<100;n++){
   const notice=f.send('preview-'+n),resultId='preview-result-'+n;
   f.store.db.prepare(`INSERT INTO results(id,taskId,version,runId,producerAgentId,kind,payloadJson,state,evidenceJson,operationKey)
    SELECT ?,taskId,taskVersion,senderRunId,senderAgentId,'structured',?,'offered','{}',operationKey FROM agent_messages WHERE id=?`).run(resultId,JSON.stringify({summary:'Result '+n}),notice.messageId);
   f.store.db.prepare("UPDATE agent_messages SET senderAgentId='host',kind='result_ready',payloadJson=? WHERE id=?").run(JSON.stringify({resultId}),notice.messageId);
  }
  let queries=0;const prepare=f.store.db.prepare.bind(f.store.db);
  f.store.db.prepare=(...args:Parameters<typeof prepare>)=>{queries++;return prepare(...args);};
  const page=f.inputs.dispatchPage(undefined,'epoch','all');
  assert.equal(page.items.length,80);assert.equal(page.totalWaiting,100);assert.ok(page.nextCursor);
  assert.deepEqual(page.items.map(item=>item.origin==='worker'?item.text:undefined),Array.from({length:80},(_,n)=>'Result '+n));
  assert.ok(queries<=6,`one page must not query every result separately: ${queries}`);
 }finally{f.close();}
});
test('main queue: U1/W1/U2/W2 interleave and orphan sources never gain current-thread authority',()=>{
 const f=fixture();try{
  f.inputs.accept({requestId:'U1',text:'Same name'});const w1=f.send('W1');
  f.inputs.accept({requestId:'U2',text:'Same name'});const w2=f.send('W2');
  const page=f.inputs.dispatchPage(undefined,'epoch','all'),row=page.items.find(item=>item.messageId===w2.messageId)!;
  f.inputs.move({messageId:w2.messageId,operationId:'first-W2',expectedRevision:row.revision,threadId:'synthetic-history',readEpoch:'epoch',expectedOrderVersion:page.orderVersion,beforeMessageId:page.items[0]!.messageId});
  const expected=[w2.messageId,page.items[0]!.messageId,w1.messageId,page.items[2]!.messageId];
  for(const messageId of expected){const next=f.inputs.claim([],'all')!;assert.equal(next.messageId,messageId);if(next.origin==='user')f.inputs.finish(next.messageId,next.revision,'completed');else f.tasks.ack({agentId:f.agentId},{operationId:'consume-'+messageId,messageId,disposition:'processed',reason:'Synthetic ordered consumption'});}
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
   f.tasks.ack({agentId:f.agentId},{operationId:'ack-'+message.messageId,messageId:message.messageId,disposition:'processed',reason:'Synthetic handled'});
  }
  assert.equal(resumed.claim([],'all'),undefined);assert.equal(resumed.dispatchSummary().awaitingUser,undefined);
  assert.equal(f.inputs.byRequestIds(['old-user'])[0]!.state,'queued');
  assert.equal(f.store.db.prepare('SELECT state FROM agent_receipts WHERE messageId=?').get(active.messageId)!.state,'offered');
  assert.deepEqual({...f.store.db.prepare('SELECT state,revision FROM agent_receipts WHERE messageId=?').get(uncertain.messageId)},{state:'uncertain',revision:3});
 }finally{f.close();}
});
