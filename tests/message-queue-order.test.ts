// Requirements-derived synthetic contracts. In-memory SQLite; no account or production service.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {historyFixture} from './web-history-loading-fixture.js';
import {WebHistoryPages} from '../src/web-history-pages.js';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';

function fixture(){
 const f=historyFixture(0);new WebHistoryPages(f.history,f.processes,f.inputs);
 for(const requestId of ['B','C','D'])f.inputs.accept({requestId,text:'同名合成消息'});
 return f;
}
function move(f:ReturnType<typeof fixture>,requestId='D',beforeRequestId:string|null='B',operationId='move-D'){
 const page=f.inputs.dispatchPage(undefined,'epoch');
 const item=f.inputs.byRequestIds([requestId])[0]!;
 return {threadId:'synthetic-history',readEpoch:'epoch',requestId,operationId,expectedRevision:item.revision,expectedOrderVersion:page.orderVersion,beforeRequestId};
}
test('queue order: durable slot permutation drives readiness and claim, preserving input and admission hashes',()=>{
 const f=fixture();try{
  const before=f.store.db.prepare('SELECT requestId,hash FROM conversation_inputs ORDER BY requestId').all();
  const operation=move(f),result=f.inputs.move(operation);
  assert.equal(result.action,'move');assert.equal(result.changed.length,3);
  assert.deepEqual(f.inputs.dispatchPage(undefined,'epoch').items.map(i=>i.input.requestId),['D','B','C']);
  assert.deepEqual(f.inputs.move(operation),result);
  assert.deepEqual(f.store.db.prepare('SELECT requestId,hash FROM conversation_inputs ORDER BY requestId').all(),before);
  for(const requestId of ['D','B','C']){assert.equal(f.inputs.runnableHead()!.input.requestId,requestId);const next=f.inputs.claim()!;assert.equal(next.input.requestId,requestId);assert.equal(next.inputRevision,1);f.inputs.finish(next.messageId,next.revision,'completed');}
  assert.deepEqual(f.inputs.move(operation),result,'committed operation survives claim');
  assert.throws(()=>f.inputs.move({...operation,beforeRequestId:null}),/queue_operation_conflict/);
 }finally{f.close();}
});
test('queue order: stale devices, claim winner, invalid anchors and no-op are explicit',()=>{
 const f=fixture();try{
  const stale=move(f,'C','B','device-two');f.inputs.move(move(f));
  assert.throws(()=>f.inputs.move(stale),/queue_(revision|order)_conflict/);
  assert.throws(()=>f.inputs.move({...move(f),beforeRequestId:'missing',operationId:'bad-anchor'}),/queue_anchor_invalid/);
  const noop=f.inputs.move(move(f,'D','D','no-op'));assert.equal(noop.noOp,true);assert.equal(noop.changed.length,0);
  const pending=move(f,'D','B','after-claim');f.inputs.claim();assert.throws(()=>f.inputs.move(pending),/queue_input_processing/);
 }finally{f.close();}
});
test('queue order: partial rank update failure rolls back slots, revisions and operation',()=>{
 const f=fixture();try{
  const snapshot=()=>['agent_messages','agent_receipts','operations'].map(t=>f.store.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all());
  const before=snapshot(),operation=move(f);
  f.store.db.exec("CREATE TEMP TRIGGER synthetic_move_failure BEFORE UPDATE OF revision ON agent_receipts WHEN new.revision>old.revision BEGIN SELECT RAISE(ABORT,'synthetic_move_failure'); END");
  assert.throws(()=>f.inputs.move(operation),/synthetic_move_failure/);assert.deepEqual(snapshot(),before);
  f.store.db.exec('DROP TRIGGER synthetic_move_failure');f.inputs.move(operation);
 }finally{f.close();}
});
test('queue order: interaction replies share all pending slots; preparing blocks only until moved',()=>{
 const f=historyFixture(0);try{
  f.inputs.accept({requestId:'A',text:'准备中'});f.inputs.accept({requestId:'answer',text:'待答',interactionId:'synthetic'});f.inputs.accept({requestId:'B',text:'后段'});
  assert.equal(f.inputs.dispatchPage().items.find(i=>i.input.requestId==='answer')!.movable,true);
  f.inputs.cancel({requestId:'answer',operationId:'cancel-answer',expectedRevision:0});
  f.inputs.preparation=input=>input.requestId==='A'?'preparing':'ready';assert.equal(f.inputs.runnableHead(),undefined);
  f.inputs.move(move(f,'B','A'));assert.equal(f.inputs.runnableHead()!.input.requestId,'B');
 }finally{f.close();}
});
test('queue order: bounded dispatch cursor expires after reorder; segment front is supplied beyond page one',()=>{
 const f=historyFixture(0);new WebHistoryPages(f.history,f.processes,f.inputs);try{
  for(let n=0;n<165;n++)f.inputs.accept({requestId:'q'+n,text:'合成 '+n});
  const first=f.inputs.dispatchPage(undefined,'epoch');assert.equal(first.items.length,80);assert.equal(first.totalWaiting,165);assert.ok(first.nextCursor);
  assert.equal(first.items.at(-1)!.nextRequestId,'q80','dropping after the page tail must retain its unloaded successor');
  const second=f.inputs.dispatchPage(first.nextCursor!,'epoch');assert.equal(second.items[0]!.input.requestId,'q80');assert.equal(second.items[0]!.segmentStartRequestId,'q0');assert.equal(second.items[0]!.position,81);
  assert.throws(()=>f.inputs.dispatchPage(first.nextCursor!,'other-epoch'),/queue_cursor_expired/);
  f.inputs.move(move(f,'q100','q0'));assert.throws(()=>f.inputs.dispatchPage(first.nextCursor!,'epoch'),/queue_cursor_expired/);
  assert.equal(f.inputs.dispatchPage(undefined,'epoch').items[0]!.input.requestId,'q100');
 }finally{f.close();}
});
test('queue order: reopen retains slots and operation; the old FIFO reader remains explicitly different',()=>{
 mkdirSync(resolve('.codex/scratch/message-queue-implementation'),{recursive:true});
 const dir=mkdtempSync(resolve('.codex/scratch/message-queue-implementation/reopen-')),database=join(dir,'synthetic.sqlite');
 let f=historyFixture(0,160,false,database);
 try{
  for(const requestId of ['B','C','D'])f.inputs.accept({requestId,text:'合成 '+requestId});
  const operation=move(f),result=f.inputs.move(operation);f.close();f=historyFixture(0,160,false,database);
  assert.deepEqual(f.inputs.dispatchPage(undefined,'reopened').items.map(item=>item.input.requestId),['D','B','C']);
  assert.deepEqual(f.inputs.move(operation),result);
  assert.deepEqual(f.inputs.list().map(item=>item.input.requestId),['B','C','D'],'legacy numeric reader intentionally keeps admission order');
  assert.equal(f.inputs.claim()!.input.requestId,'D');f.inputs.reconcile();
  assert.equal(f.inputs.byRequestIds(['D'])[0]!.state,'uncertain');assert.equal(f.inputs.dispatchPage().items.find(item=>item.input.requestId==='D')!.movable,false);
 }finally{f.close();rmSync(dir,{recursive:true,force:true});}
});
test('queue order: ordering metadata never reads request responses and hydrates at most one bounded body page',()=>{
 const f=historyFixture(0);try{
  for(let n=0;n<100;n++)f.inputs.accept({requestId:'bounded-'+n,text:'合成有界读取 '+n});
  f.store.request=()=>{throw Error('request_response_body_forbidden');};
  let bodies=0;const read=f.history.inputs.bind(f.history);f.history.inputs=(thread,ids)=>{assert.ok(ids.length<=80);bodies+=ids.length;return read(thread,ids);};
  let queries=0;const prepare=f.store.db.prepare.bind(f.store.db);f.store.db.prepare=(...args:Parameters<typeof prepare>)=>{queries++;return prepare(...args);};
  assert.equal(f.inputs.dispatchSummary().totalWaiting,100);assert.equal(bodies,0);
  assert.ok(queries<=4,`metadata summary must not issue one query per input: ${queries}`);
  assert.equal(f.inputs.dispatchPage().items.length,80);assert.equal(bodies,80);
 }finally{f.close();}
});
test('queue order: a recorded execution locks pending metadata without reading its response',()=>{
 const f=fixture();try{
  const before=f.inputs.dispatchSummary();
  f.store.db.prepare("INSERT INTO requests(id,hash,state,response,createdAt) VALUES('B','synthetic','running','private synthetic response',0)").run();
  f.store.request=()=>{throw Error('request_response_body_forbidden');};
  const page=f.inputs.dispatchPage(),item=page.items.find(item=>item.input.requestId==='B')!;
  assert.equal(item.editable,false);assert.equal(item.movable,false);assert.notEqual(page.orderVersion,before.orderVersion);
  assert.throws(()=>f.inputs.move(move(f,'B','C','locked-execution')),/queue_input_locked/);
 }finally{f.close();}
});
