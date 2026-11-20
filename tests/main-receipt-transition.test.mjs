import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {chmodSync,copyFileSync,existsSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,rmdirSync,rmSync,symlinkSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {chatFixture} from './task-chat-fixture.ts';
import {MainProcessHistory} from '../src/main-process.ts';
import {WorkerInteractions} from '../src/worker-interactions.ts';
import {Store as LegacyStore} from './fixtures/store-v7.ts';
import {inspectMainReceiptEvidence,migrateMainReceiptsInTransaction} from '../scripts/legacy-main-receipts-v8.ts';
import {previewLegacyMainReceipts,applyLegacyMainReceiptsInTransaction} from '../scripts/reconcile-main-receipts.mjs';

function legacy(){
 const f=chatFixture();new WorkerInteractions(f.store.db);const task=f.create(),worker=f.tasks.workerOpen(f.actor,{operationId:'original',taskId:task.taskId,text:'Synthetic work'}),run=f.start(worker.workerId);
 f.tasks.endSegment(run.id,run.epoch,{status:'completed',text:'Synthetic preserved answer'},true);
 const input=f.inputs.claim([],'all'),processes=new MainProcessHistory(f.store.db);
 f.store.transaction(()=>{processes.start({id:'synthetic-process',threadId:'thread:main',sourceKind:'worker',sourceMessageIds:[input.messageId],messageId:'synthetic-process'},'native:receipt');f.tasks.receiveMainMessagesInTransaction([input.messageId],'native:receipt');});
 processes.finish('synthetic-process','failed','turn:native:receipt:terminal:completed');
 f.store.db.prepare("UPDATE agent_receipts SET state='blocked' WHERE messageId=?").run(input.messageId);
 f.store.db.prepare("UPDATE agent_receipts SET state='processed' WHERE messageId=?").run(f.actor.inputMessageId);
 f.store.finishRequest('source:test','Synthetic source completed');f.store.setMeta('recursiveSchemaVersion','7');
 return {...f,input,processes};
}

test('legacy transition previews are read-only and their receipt closure preserves the failed process and old schema',()=>{
 const f=legacy();try{
  const before=f.store.db.prepare('SELECT total_changes() n').get().n,preview=previewLegacyMainReceipts(f.store.db);
  assert.equal(f.store.db.prepare('SELECT total_changes() n').get().n,before);assert.deepEqual(preview.blocked,[]);assert.equal(preview.rows.length,1);
  const messages=f.store.db.prepare('SELECT * FROM agent_messages ORDER BY seq').all();
  const result=f.store.transaction(()=>applyLegacyMainReceiptsInTransaction(f.store.db,preview,'synthetic:bridge'));
  assert.equal(result.changed,1);assert.equal(result.requiresRuntimeProbe,true);
  assert.equal(f.store.meta('recursiveSchemaVersion'),'7');assert.equal(f.processes.exact('synthetic-process').status,'failed');
  assert.equal(f.store.db.prepare('SELECT state FROM agent_receipts WHERE messageId=?').get(f.input.messageId).state,'processed');
  assert.deepEqual(f.store.db.prepare('SELECT * FROM agent_messages ORDER BY seq').all(),messages);
  assert.deepEqual(f.store.transaction(()=>applyLegacyMainReceiptsInTransaction(f.store.db,preview,'synthetic:bridge')),result);
 }finally{f.close();}
});

test('an idle current main lease does not create a stop-before-repair deadlock; worker leases remain blockers',()=>{
 const f=legacy();try{
  f.store.setMeta('lease:main',JSON.stringify({pid:12345,identity:'synthetic-current-main'}));
  assert.deepEqual(previewLegacyMainReceipts(f.store.db).blocked,[]);
  f.store.setMeta('lease:worker',JSON.stringify({pid:12346,identity:'synthetic-worker'}));
  const preview=previewLegacyMainReceipts(f.store.db);assert.ok(preview.blocked.includes('worker_owner_unconfirmed'));
  assert.throws(()=>f.store.transaction(()=>applyLegacyMainReceiptsInTransaction(f.store.db,preview,'blocked')),/bridge_blocked/);
 }finally{f.close();}
});

test('stale input, active processing, unconfirmed operations and a new schema never authorize legacy writes',()=>{
 const f=legacy();try{
  const preview=previewLegacyMainReceipts(f.store.db);f.inputs.accept({requestId:'new',text:'New synthetic input'});
  assert.throws(()=>f.store.transaction(()=>applyLegacyMainReceiptsInTransaction(f.store.db,preview,'stale')),/preview_stale/);
  const blocked=previewLegacyMainReceipts(f.store.db);assert.ok(blocked.blocked.includes('delivery_unconfirmed'));
  assert.throws(()=>f.store.transaction(()=>applyLegacyMainReceiptsInTransaction(f.store.db,blocked,'blocked')),/bridge_blocked/);
  f.store.setMeta('recursiveSchemaVersion','8');
  assert.throws(()=>previewLegacyMainReceipts(f.store.db),/bridge_schema_unsupported/);
 }finally{f.close();}
});

test('legacy write failures roll back receipts and audit while retaining actual pending business',()=>{
 const f=legacy();try{
  const preview=previewLegacyMainReceipts(f.store.db),before=f.store.db.prepare('SELECT * FROM agent_receipts ORDER BY messageId').all();
  f.store.db.exec("CREATE TEMP TRIGGER synthetic_bridge_fail BEFORE UPDATE ON agent_receipts BEGIN SELECT RAISE(ABORT,'synthetic_write_failure');END");
  assert.throws(()=>f.store.transaction(()=>applyLegacyMainReceiptsInTransaction(f.store.db,preview,'rollback')),/synthetic_write_failure/);
  assert.deepEqual(f.store.db.prepare('SELECT * FROM agent_receipts ORDER BY messageId').all(),before);
  assert.equal(f.store.db.prepare("SELECT count(*) n FROM meta WHERE key GLOB 'mainReceiptBridge:*'").get().n,0);
 }finally{f.close();}
});

test('pending and unsent decisions, unknown effects and changed business evidence prevent legacy closure',async()=>{
 const f=legacy();try{
  const original=previewLegacyMainReceipts(f.store.db),run=f.store.runs()[0],interactions=new WorkerInteractions(f.store.db);
  const opened=interactions.open({runId:run.id,threadId:run.threadId,turnId:run.turnId,requestId:'synthetic-live',source:'ask_main',kind:'question',runEpoch:run.epoch,taskVersion:run.version,details:{question:'Synthetic pending question'},authority:{sourceRequestId:'source:test',description:'Synthetic only',nativeApprovals:false}},()=>true);
  assert.throws(()=>f.store.transaction(()=>applyLegacyMainReceiptsInTransaction(f.store.db,original,'old-preview')),/preview_stale/);
  assert.ok(previewLegacyMainReceipts(f.store.db).blocked.includes('interaction_unresolved'));
  interactions.respond(opened.id,{action:'answer',reason:'Synthetic allowed answer',answer:'Synthetic'});await opened.response;
  assert.ok(previewLegacyMainReceipts(f.store.db).blocked.includes('interaction_unresolved'),'a recorded decision without delivery is unresolved');
  interactions.markDelivered(opened.id);assert.deepEqual(previewLegacyMainReceipts(f.store.db).blocked,[]);
  f.store.db.prepare("UPDATE operations SET state='uncertain' WHERE kind='worker_open'").run();
  const uncertain=previewLegacyMainReceipts(f.store.db);assert.ok(uncertain.blocked.includes('operation_unconfirmed'));
  assert.throws(()=>f.store.transaction(()=>applyLegacyMainReceiptsInTransaction(f.store.db,uncertain,'unknown-effect')),/bridge_blocked/);
  assert.equal(f.store.db.prepare('SELECT state FROM agent_receipts WHERE messageId=?').get(f.input.messageId).state,'blocked');
 }finally{f.close();}
});

test('private CLI preview applies once to its exact database, is read by the old code, then migrates once to new semantics',()=>{
 const f=legacy(),other=legacy(),privateRoot=resolve('.codex/private'),hadPrivate=existsSync(privateRoot);
 mkdirSync(privateRoot,{recursive:true,mode:0o700});const directory=mkdtempSync(join(privateRoot,'synthetic-receipt-'));
 try{
  const path=join(directory,'preview.json');
  const run=(...args)=>spawnSync(process.execPath,['--import','tsx','scripts/reconcile-main-receipts.mjs',...args],{encoding:'utf8',timeout:15000});
  const preview=run('--db',f.path,'--preview-out',path);assert.equal(preview.status,0,preview.stderr);assert.equal(lstatSync(path).mode&0o077,0);
  const wrong=run('--db',other.path,'--apply',path,'--operation-id','synthetic-cli');assert.notEqual(wrong.status,0);assert.match(wrong.stderr,/preview_stale/);
  const alias=join(directory,'alias.json');symlinkSync(path,alias);
  assert.notEqual(run('--db',f.path,'--apply',alias,'--operation-id','synthetic-cli').status,0);
  const applied=run('--db',f.path,'--apply',path,'--operation-id','synthetic-cli');assert.equal(applied.status,0,applied.stderr);assert.equal(JSON.parse(applied.stdout).changed,1);
  assert.equal(run('--db',f.path,'--apply',path,'--operation-id','synthetic-cli').status,0);
  const old=new LegacyStore(f.path);old.close();assert.equal(f.store.meta('recursiveSchemaVersion'),'7');
  const scope={mainAgentId:'main:test',mainThreadId:'thread:main'},candidate=inspectMainReceiptEvidence(f.store.db,scope);
  f.store.transaction(()=>migrateMainReceiptsInTransaction(f.store.db,candidate,'synthetic-new-start'));
  assert.equal(f.store.db.prepare('SELECT state FROM agent_receipts WHERE messageId=?').get(f.input.messageId).state,'received');
  assert.equal(f.processes.exact('synthetic-process').status,'failed');assert.throws(()=>new LegacyStore(f.path),/recursive_schema_unsupported/);
 }finally{f.close();other.close();rmSync(directory,{recursive:true,force:true});if(!hadPrivate)rmdirSync(privateRoot);}
});

test('the real maintenance CLI defaults to no writes, prints no content and refuses nonexistent or new-format targets',()=>{
 const f=legacy();try{
  const bytes=readFileSync(f.path),before=f.store.db.prepare('SELECT * FROM agent_receipts ORDER BY messageId').all();
  const run=(...args)=>spawnSync(process.execPath,['--import','tsx','scripts/reconcile-main-receipts.mjs',...args],{encoding:'utf8',timeout:15000});
  const preview=run('--db',f.path);assert.equal(preview.status,0,preview.stderr);assert.equal(JSON.parse(preview.stdout).mode,'preview');
  assert.ok(!preview.stdout.includes(f.input.messageId));assert.ok(!preview.stdout.includes('Synthetic preserved answer'));
  assert.deepEqual(readFileSync(f.path),bytes);assert.deepEqual(f.store.db.prepare('SELECT * FROM agent_receipts ORDER BY messageId').all(),before);
  assert.notEqual(run('--db',f.path+'.missing').status,0);
  assert.notEqual(run('--db',f.path,'--apply','missing-preview').status,0);
  f.store.setMeta('recursiveSchemaVersion','8');assert.notEqual(run('--db',f.path).status,0);
 }finally{f.close();}
});

test('private preview ancestors are checked before creating directories or applying receipts',()=>{
 const f=legacy();try{
  const root=join(f.dir,'synthetic-repository'),outside=join(f.dir,'outside');
  mkdirSync(join(root,'scripts'),{recursive:true});mkdirSync(outside,{mode:0o700});
  for(const name of ['reconcile-main-receipts.mjs','legacy-main-receipts-v8.ts'])copyFileSync(join('scripts',name),join(root,'scripts',name));
  symlinkSync(resolve('src'),join(root,'src'),process.platform==='win32'?'junction':'dir');
  const run=(...args)=>spawnSync(process.execPath,['--import',resolve('node_modules/tsx/dist/loader.mjs'),join(root,'scripts/reconcile-main-receipts.mjs'),'--db',f.path,...args],{encoding:'utf8',timeout:15000});
  const before=f.store.db.prepare('SELECT * FROM agent_receipts ORDER BY messageId').all();
  for(const ancestor of ['.codex','.codex/private','.codex/private/nested']){
   const alias=join(root,ancestor),parent=resolve(alias,'..');mkdirSync(parent,{recursive:true,mode:0o700});
   symlinkSync(outside,alias,process.platform==='win32'?'junction':'dir');
   const path=join(alias,'created','preview.json'),result=run('--preview-out',path);
   assert.notEqual(result.status,0,'aliased ancestor '+ancestor+' must be rejected');
   assert.match(result.stderr,/private_(permissions|path_required)/);
   assert.equal(existsSync(join(outside,'created')),false,'rejection must precede mkdir through an alias');
   assert.notEqual(run('--apply',path,'--operation-id','synthetic-aliased').status,0);
   rmSync(alias,{force:true});
  }
  for(const ancestor of [root,join(root,'.codex')]){
   chmodSync(ancestor,0o777);
   const denied=run('--preview-out',join(root,'.codex/private/permissive/preview.json'));
   assert.notEqual(denied.status,0,'writable ancestor must be rejected');assert.match(denied.stderr,/private_permissions/);
   assert.equal(existsSync(join(root,'.codex/private/permissive')),false);
   chmodSync(ancestor,0o755);
  }
  chmodSync(join(root,'.codex'),0o755);
  mkdirSync(join(root,'.codex/private/unprotected'),{mode:0o755});
  const denied=run('--preview-out',join(root,'.codex/private/unprotected/created/preview.json'));
  assert.notEqual(denied.status,0);assert.match(denied.stderr,/private_permissions/);
  assert.equal(existsSync(join(root,'.codex/private/unprotected/created')),false);
  const path=join(root,'.codex/private/canonical/nested/preview.json');
  const preview=run('--preview-out',path);assert.equal(preview.status,0,preview.stderr);
  for(const name of ['.codex/private/canonical','.codex/private/canonical/nested'])assert.equal(lstatSync(join(root,name)).mode&0o077,0);
  assert.equal(lstatSync(path).mode&0o077,0);
  assert.deepEqual(f.store.db.prepare('SELECT * FROM agent_receipts ORDER BY messageId').all(),before);
  assert.equal(f.store.db.prepare("SELECT count(*) n FROM meta WHERE key GLOB 'mainReceiptBridge:*'").get().n,0);
 }finally{f.close();}
});

test('a processed historical input with unknown native effects blocks the whole legacy transition',()=>{
 const f=legacy();try{
  f.processes.start({id:'old-native-effect',threadId:'thread:main',sourceKind:'user',sourceMessageIds:[f.actor.inputMessageId],messageId:'old-effect-reply'},'turn:source:test');
  f.processes.native('old-native-effect',{threadId:'thread:main',turnId:'turn:source:test',itemId:'old-write',category:'fileChange',status:'running',completed:false});
  f.processes.finish('old-native-effect','unknown','host:engine_closed:old');
  const preview=previewLegacyMainReceipts(f.store.db);assert.equal(preview.rows.length,1);
  assert.ok(preview.blocked.includes('native_effect_unconfirmed'));
  assert.throws(()=>f.store.transaction(()=>applyLegacyMainReceiptsInTransaction(f.store.db,preview,'old-effect')),/bridge_blocked/);
 }finally{f.close();}
});
