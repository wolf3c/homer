// Pure migration fixtures. Never opens an installed profile or starts an engine.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,rmSync} from 'node:fs';
import * as persistence from '../scripts/legacy-main-receipts-v8.js';
import {Store} from '../src/store.js';
import {Store as LegacyStore} from './fixtures/store-v7.js';
import {chatFixture} from './task-chat-fixture.js';
import {MainProcessHistory} from '../src/main-process.js';
import {WorkerInteractions} from '../src/worker-interactions.js';

const scope={mainAgentId:'main:test',mainThreadId:'thread:main'};
const inspect=(db:DatabaseSync)=>persistence.inspectMainReceiptEvidence(db,scope);
const apply=(db:DatabaseSync,preview:persistence.MainReceiptPreview,id='migration:test')=>persistence.migrateMainReceiptsInTransaction(db,preview,id);
function internal(f:ReturnType<typeof chatFixture>,id='worker'){
 const task=f.create('Synthetic task',id),worker=f.tasks.workerOpen(f.actor,{operationId:id,taskId:task.taskId,text:'Synthetic work'}),run=f.start(worker.workerId);
 f.tasks.endSegment(run.id,run.epoch,{status:'completed',text:'Synthetic unchanged result'},true);
 const notice=f.inputs.claim([],'all')!;assert.equal(notice.origin,'worker');
 const processes=new MainProcessHistory(f.store.db);
 f.store.transaction(()=>{
  processes.start({id:'process:'+id,threadId:scope.mainThreadId,sourceKind:'worker',sourceMessageIds:[notice.messageId],messageId:'process:'+id},'native:'+id);
  f.tasks.receiveMainMessagesInTransaction([notice.messageId],'native:'+id);
 });
 processes.finish('process:'+id,'failed','turn:native:'+id+':terminal:completed');
 f.store.db.prepare("UPDATE agent_receipts SET state='blocked' WHERE messageId=?").run(notice.messageId);
 return notice;
}
function preserved(db:DatabaseSync){
 return ['tasks','task_versions','runs','operations','agent_messages','conversation_messages'].map(table=>[table,db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()]);
}

for(const version of ['6','7'])test('legacy '+version+' receipt migration is atomic and retains original business data',()=>{
 const f=chatFixture();try{
  const notice=internal(f);f.store.setMeta('recursiveSchemaVersion',version);
  f.store.db.prepare("UPDATE agent_receipts SET state='processed' WHERE messageId=?").run(f.actor.inputMessageId!);
  if(version==='6')f.store.db.exec('DROP TABLE schedules');
  const before=preserved(f.store.db),preview=inspect(f.store.db),target=preview.rows.find((row:any)=>row.messageId===notice.messageId);
  assert.equal(target!.targetState,'received');
  const result=f.store.transaction(()=>apply(f.store.db,preview));
  assert.equal(f.store.meta('recursiveSchemaVersion'),persistence.STORE_SCHEMA_VERSION);
  assert.equal(f.store.db.prepare('SELECT state FROM agent_receipts WHERE messageId=?').get(notice.messageId)!.state,'received');
  assert.deepEqual(preserved(f.store.db),before);
  const receipts=f.store.db.prepare('SELECT * FROM agent_receipts ORDER BY messageId').all();
  assert.deepEqual(f.store.transaction(()=>apply(f.store.db,preview)),result);
  assert.deepEqual(f.store.db.prepare('SELECT * FROM agent_receipts ORDER BY messageId').all(),receipts);
 }finally{f.close();}
});

test('missing evidence is unknown, never a fabricated receipt from old processed state',()=>{
 const f=chatFixture();try{
  f.inputs.accept({requestId:'unknown',text:'Same synthetic body'});const input=f.inputs.claim()!;
  f.inputs.finish(input.messageId,input.revision,'completed');
  f.store.db.prepare("UPDATE agent_receipts SET state='processed' WHERE messageId=?").run(input.messageId);
  f.inputs.accept({requestId:'never-sent',text:'Same synthetic body'});
  f.store.setMeta('recursiveSchemaVersion','7');
  const rows=inspect(f.store.db).rows;
  assert.equal(rows.find(row=>row.messageId===input.messageId)!.targetState,'uncertain');
  assert.equal(rows.find(row=>row.kind==='user_input'&&row.sourceState==='pending')!.targetState,'pending');
 }finally{f.close();}
});

test('a previous main conversation keeps its original receive evidence after the current conversation changes',()=>{
 const f=chatFixture();try{
  const notice=internal(f);f.store.setMeta('recursiveSchemaVersion','7');f.store.setMeta('mainThread','new-synthetic-main');
  const preview=persistence.inspectMainReceiptEvidence(f.store.db,{mainAgentId:'main:test',mainThreadId:'new-synthetic-main'});
  assert.ok(preview.rows.every(row=>row.targetState==='received'));
  f.store.transaction(()=>apply(f.store.db,preview));
  assert.equal(f.store.db.prepare('SELECT state FROM agent_receipts WHERE messageId=?').get(notice.messageId)!.state,'received');
  assert.equal(f.store.meta('mainThread'),'new-synthetic-main');
 }finally{f.close();}
});

test('user generation identity is not used as the native turn and mismatched evidence refuses application',()=>{
 const f=chatFixture();try{
  const notice=internal(f);f.store.setMeta('recursiveSchemaVersion','7');
  const preview=inspect(f.store.db),source=preview.rows.find((row:any)=>row.messageId===f.actor.inputMessageId);
  assert.equal(source!.nativeTurnId,'turn:source:test');assert.notEqual(source!.nativeTurnId,'generation:source:test');
  f.store.db.prepare("UPDATE agent_receipts SET offeredTurnId='wrong-native' WHERE messageId=?").run(notice.messageId);
  const invalid=inspect(f.store.db);assert.ok(invalid.rows.some((row:any)=>row.targetState==='invalid'));
  assert.throws(()=>f.store.transaction(()=>apply(f.store.db,invalid)),/evidence_invalid/);
  assert.equal(f.store.meta('recursiveSchemaVersion'),'7');
 }finally{f.close();}
});

test('a receipt remains received while its original interaction is still pending',()=>{
 const f=chatFixture();try{
  const notice=internal(f);f.store.setMeta('recursiveSchemaVersion','7');
  const run=f.store.runs()[0]!,interactions=new WorkerInteractions(f.store.db);
  const item=interactions.open({runId:run.id,threadId:run.threadId!,turnId:run.turnId!,requestId:'synthetic-pending',source:'ask_main',kind:'question',details:{question:'Synthetic pending question'},authority:{description:'Synthetic original scope',sourceRequestId:'source:test',nativeApprovals:false},runEpoch:run.epoch,taskVersion:run.version},()=>true);
  const before=interactions.inspect(item.id);
  f.store.transaction(()=>apply(f.store.db,inspect(f.store.db)));
  assert.equal(f.store.db.prepare('SELECT state FROM agent_receipts WHERE messageId=?').get(notice.messageId)!.state,'received');
  assert.deepEqual(interactions.inspect(item.id),before);assert.equal(before.state,'pending_main');
 }finally{f.close();}
});

test('stale previews and failures roll back every receipt, audit and version update',()=>{
 const f=chatFixture();try{
  internal(f);f.store.setMeta('recursiveSchemaVersion','7');const preview=inspect(f.store.db);
  f.store.db.prepare('UPDATE agent_receipts SET revision=revision+1 WHERE messageId=?').run(f.actor.inputMessageId!);
  assert.throws(()=>f.store.transaction(()=>apply(f.store.db,preview)),/preview_stale/);
  const fresh=inspect(f.store.db),before=f.store.db.prepare('SELECT * FROM agent_receipts ORDER BY messageId').all();
  f.store.db.exec("CREATE TEMP TRIGGER synthetic_abort_receipt BEFORE UPDATE ON agent_receipts WHEN OLD.state='blocked' BEGIN SELECT RAISE(ABORT,'synthetic_write_failure');END");
  assert.throws(()=>f.store.transaction(()=>apply(f.store.db,fresh)),/synthetic_write_failure/);
  assert.equal(f.store.meta('recursiveSchemaVersion'),'7');
  assert.deepEqual(f.store.db.prepare('SELECT * FROM agent_receipts ORDER BY messageId').all(),before);
  assert.equal(f.store.db.prepare("SELECT count(*) n FROM meta WHERE key GLOB 'mainReceiptMigration:*'").get()!.n,0);
 }finally{f.close();}
});

test('live owners and a preview from another database cannot authorize migration',()=>{
 const f=chatFixture(),other=chatFixture();try{
  f.store.setMeta('recursiveSchemaVersion','7');other.store.setMeta('recursiveSchemaVersion','7');
  assert.throws(()=>other.store.transaction(()=>apply(other.store.db,inspect(f.store.db))),/preview_stale/);
  const task=f.create();f.tasks.workerOpen(f.actor,{operationId:'live',taskId:task.taskId,text:'Still queued'});
  assert.throws(()=>f.store.transaction(()=>apply(f.store.db,inspect(f.store.db))),/owner_unconfirmed/);
  assert.equal(f.store.meta('recursiveSchemaVersion'),'7');
 }finally{f.close();other.close();}
});

for(const corruption of ['recipient','operation','missing-receipt'])test('migration refuses incomplete '+corruption+' linkage instead of omitting or relabelling a message',()=>{
 const f=chatFixture();try{
  const notice=internal(f);f.store.setMeta('recursiveSchemaVersion','7');
  if(corruption==='recipient')f.store.db.prepare("UPDATE agent_receipts SET recipientAgentId='other' WHERE messageId=?").run(notice.messageId);
  if(corruption==='operation'){f.store.db.exec('PRAGMA foreign_keys=OFF');f.store.db.prepare("UPDATE agent_messages SET operationKey='nonexistent' WHERE id=?").run(notice.messageId);f.store.db.exec('PRAGMA foreign_keys=ON');}
  if(corruption==='missing-receipt')f.store.db.prepare('DELETE FROM agent_receipts WHERE messageId=?').run(notice.messageId);
  assert.throws(()=>f.store.transaction(()=>apply(f.store.db,inspect(f.store.db))),/evidence_invalid/);
  assert.equal(f.store.meta('recursiveSchemaVersion'),'7');
 }finally{f.close();}
});

test('malformed migration evidence reports a safe static error without exposing its contents',()=>{
 const f=chatFixture();try{
  f.store.setMeta('recursiveSchemaVersion','7');f.store.setMeta('publicMainNode:v1:corrupt','private-synthetic-content');
  assert.throws(()=>inspect(f.store.db),{message:'main_receipt_evidence_invalid'});
 }finally{f.close();}
});

test('an audit cannot hide a missing schema commit on idempotent migration retry',()=>{
 const f=chatFixture();try{
  internal(f);f.store.setMeta('recursiveSchemaVersion','7');const preview=inspect(f.store.db);
  f.store.transaction(()=>apply(f.store.db,preview));f.store.setMeta('recursiveSchemaVersion','7');
  assert.throws(()=>f.store.transaction(()=>apply(f.store.db,preview)),/main_receipt_audit_inconsistent/);
 }finally{f.close();}
});

for(const version of ['6','7','8','9'])test('older schema '+version+' is refused before writes and cannot read the current store',()=>{
 const f=chatFixture();try{
  assert.throws(()=>new LegacyStore(f.path),/recursive_schema_unsupported/);
  f.store.setMeta('recursiveSchemaVersion',version);f.store.close();
  const before=readFileSync(f.path);assert.throws(()=>new Store(f.path),version==='8'||version==='9'?/desktop_store_migration_required/:/recursive_schema_unsupported/);assert.deepEqual(readFileSync(f.path),before);
 }finally{rmSync(f.dir,{recursive:true,force:true});}
});

test('edited and moved pending inputs retain their original order and remain claimable through migration',()=>{
 const f=chatFixture();try{
  f.inputs.accept({requestId:'edited',text:'Before edit'});f.inputs.accept({requestId:'moved',text:'Move before edited'});
  f.inputs.edit({requestId:'edited',operationId:'edit',expectedRevision:0,input:{requestId:'edited',text:'Original edited text'}});
  f.inputs.move({requestId:'moved',operationId:'move',expectedRevision:0,expectedOrderVersion:f.inputs.dispatchPage().orderVersion,beforeRequestId:'edited',threadId:'thread:main',readEpoch:'synthetic'});
  f.store.setMeta('recursiveSchemaVersion','7');const preview=inspect(f.store.db);
  assert.equal(preview.rows.filter(row=>row.sourceState==='pending'&&row.targetState==='pending').length,2);
  f.store.transaction(()=>apply(f.store.db,preview));
  assert.equal(f.inputs.claim()!.input.requestId,'moved');
 }finally{f.close();}
});

test('an old reopened pending notice without receive or queue-change evidence remains unknown',()=>{
 const f=chatFixture();try{
  const notice=internal(f);f.store.setMeta('recursiveSchemaVersion','7');
  f.store.db.prepare("DELETE FROM meta WHERE key GLOB 'publicMainNode:v1:*'").run();
  f.store.db.prepare("UPDATE agent_receipts SET state='pending',offeredTurnId=NULL WHERE messageId=?").run(notice.messageId);
  assert.equal(inspect(f.store.db).rows.find(row=>row.messageId===notice.messageId)!.targetState,'uncertain');
 }finally{f.close();}
});

for(const field of ['scopeId','actorAgentId','kind','responseJson'])test('migration refuses a user source operation with contradictory '+field,()=>{
 const f=chatFixture();try{
  f.store.setMeta('recursiveSchemaVersion','7');
  f.store.db.prepare('UPDATE operations SET '+field+'=? WHERE id=(SELECT operationKey FROM agent_messages WHERE id=?)').run(field==='responseJson'?'{"messageId":"foreign","replyId":"foreign"}':'unrelated',f.actor.inputMessageId!);
  assert.throws(()=>f.store.transaction(()=>apply(f.store.db,inspect(f.store.db))),/evidence_invalid/);
 }finally{f.close();}
});

test('two different user inputs cannot share one native acceptance identity',()=>{
 const f=chatFixture();try{
  f.inputs.accept({requestId:'second',text:'Different original input'});const input=f.inputs.claim()!;
  f.inputs.started(input.messageId,input.revision,'generation:second','turn:source:test');f.inputs.finish(input.messageId,input.revision,'completed');f.store.setMeta('recursiveSchemaVersion','7');
  assert.throws(()=>f.store.transaction(()=>apply(f.store.db,inspect(f.store.db))),/evidence_invalid/);
 }finally{f.close();}
});

for(const kind of ['task_archived','interaction_required','scheduled_message'])test('migration accepts the exact original operation binding for '+kind,()=>{
 const f=chatFixture();try{
  if(kind==='task_archived'){
   const task=f.create();
   f.tasks.archiveHistory(f.actor,{operationId:'archive',taskId:task.taskId,expectedRevision:1},true);
  }else if(kind==='interaction_required'){
   const task=f.create(),worker=f.tasks.workerOpen(f.actor,{operationId:'open',taskId:task.taskId,text:'Synthetic request'}),run=f.start(worker.workerId),interactions=new WorkerInteractions(f.store.db);
   const opened=interactions.open({runId:run.id,threadId:run.threadId!,turnId:run.turnId!,requestId:'synthetic',source:'ask_main',kind:'question',details:{question:'Synthetic?'},authority:{...f.authority,nativeApprovals:false},runEpoch:run.epoch,taskVersion:run.version},()=>true);
   f.tasks.queueInteraction(opened.id);
  }else f.store.transaction(()=>f.inputs.enqueueScheduled({deliveryId:'synthetic-schedule',scheduleId:'original',scheduledAt:1,text:'Synthetic reminder',sourceRef:'synthetic-only'}));
  const input=f.inputs.claim([],'all')!,processes=new MainProcessHistory(f.store.db),turn='native:'+kind;
  f.store.transaction(()=>{processes.start({id:'process:'+kind,threadId:'thread:main',sourceKind:'worker',sourceMessageIds:[input.messageId],messageId:'process:'+kind},turn);f.tasks.receiveMainMessagesInTransaction([input.messageId],turn);});
  processes.finish('process:'+kind,'completed','turn:'+turn+':terminal:completed');f.store.setMeta('recursiveSchemaVersion','7');
  assert.equal(inspect(f.store.db).rows.find(row=>row.messageId===input.messageId)!.targetState,'received');
 }finally{f.close();}
});
