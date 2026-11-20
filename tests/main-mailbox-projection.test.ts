import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {chatFixture} from './task-chat-fixture.js';
import {WebHistoryPages} from '../src/web-history-pages.js';
import {MainProcessHistory} from '../src/main-process.js';
import {MediaStore} from '../src/media-store.js';
import {WorkerInteractions} from '../src/worker-interactions.js';
import {readTaskOverview} from '../src/task-overview.js';
import {workerStatus} from '../src/task-status.js';
import {Homer} from '../src/service.js';
import {NativeThreadBindings} from '../src/native-thread-bindings.js';
import {freshMainReadiness} from '../scripts/native-fresh-main-preview.js';
const {previewLegacyMainReceipts}=await import(new URL('../scripts/reconcile-main-receipts.mjs',import.meta.url).href);

test('finished received inputs leave the active history index at cold initialization and incremental completion',()=>{
 const f=chatFixture();try{
  new WorkerInteractions(f.store.db);
  new WebHistoryPages(f.history,new MainProcessHistory(f.store.db),f.inputs);
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM web_active_inputs').get()!.n,0);
  f.inputs.accept({requestId:'active',text:'Synthetic active'});const input=f.inputs.claim()!;
  f.inputs.started(input.messageId,input.revision,'generation:active','native:active');
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM web_active_inputs').get()!.n,1);
  f.inputs.finish(input.messageId,input.revision,'failed');
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM web_active_inputs').get()!.n,0);
  assert.equal(f.store.db.prepare('SELECT state FROM agent_receipts WHERE messageId=?').get(input.messageId)!.state,'received');
 }finally{f.close();}
});

for(const outcome of ['completed','uncertain'] as const)test('media retention reads consumer state independently of received transport: '+outcome,()=>{
 const f=chatFixture();try{
  const media=new MediaStore(f.store.db,join(f.dir,'media')),id='media-request';
  const original=media.intent(id,'synthetic','file'),pinned=media.intent(id,'synthetic','file');
  for(const ref of [original,pinned]){const lease=media.claim(ref)!;media.ready(ref,lease,Buffer.from('Synthetic bytes'),'text/plain');}
  media.pin(id,pinned,'message:retained');
  f.store.db.prepare('UPDATE media_assets SET expiresAt=0').run();
  f.inputs.accept({requestId:id,text:'Synthetic source'});const input=f.inputs.claim()!;
  f.inputs.started(input.messageId,input.revision,'generation:media','native:media');
  media.gc(1);assert.equal(media.asset(original).state,'ready');
  if(outcome==='uncertain')f.inputs.uncertain(input.messageId,input.revision);else f.inputs.finish(input.messageId,input.revision,'completed');
  const reopened=new DatabaseSync(f.path);
  try{
   const recovered=new MediaStore(reopened,join(f.dir,'media'));recovered.reconcile();recovered.gc(1);
   assert.equal(recovered.asset(original).state,outcome==='completed'?'deleted':'ready');
   assert.equal(recovered.asset(pinned).state,'ready');assert.equal(recovered.readAttachment(pinned).bytes.toString(),'Synthetic bytes');
  }finally{reopened.close();}
 }finally{f.close();}
});

test('a record-only task archives without a completion report',()=>{
 const f=chatFixture();try{
  const task=f.create();
  assert.equal(f.tasks.archiveHistory(f.actor,{operationId:'archive',taskId:task.taskId,expectedRevision:f.tasks.task(task.taskId).revision},true).state,'archived');
 }finally{f.close();}
});

test('waiting for Main approval is labelled as that wait and never as a user decision',()=>{
 const f=chatFixture();try{
  const task=f.create(),worker=f.tasks.workerOpen(f.actor,{operationId:'open',taskId:task.taskId,text:'Synthetic work'}),run=f.start(worker.workerId),interactions=new WorkerInteractions(f.store.db);
  f.store.db.prepare("UPDATE runs SET phase='rpc_wait' WHERE id=?").run(run.id);
  interactions.open({runId:run.id,threadId:run.threadId!,turnId:run.turnId!,requestId:'synthetic-approval',source:'native',kind:'authorization',details:{},authority:{...f.authority,nativeApprovals:true},runEpoch:run.epoch,taskVersion:run.version},()=>true);
  const overview=readTaskOverview(f.store.db),item=overview.tasks[0]!.workers[0]!;
  assert.equal(item.pendingUser,0);assert.match(workerStatus(item).label,/等待 Homer 审批 1/);
 }finally{f.close();}
});

test('persisted pending and unsent decisions still block upgrades after an execution ended',()=>{
 const f=chatFixture();try{
  const task=f.create(),worker=f.tasks.workerOpen(f.actor,{operationId:'open',taskId:task.taskId,text:'Synthetic work'}),run=f.start(worker.workerId),interactions=new WorkerInteractions(f.store.db);
  f.tasks.endSegment(run.id,run.epoch,{status:'completed',text:''},true);
  const notice=f.inputs.claim([],'all')!,processes=new MainProcessHistory(f.store.db);
  f.store.transaction(()=>{processes.start({id:'synthetic-consumer',threadId:'thread:main',sourceKind:'worker',sourceMessageIds:[notice.messageId],messageId:'synthetic-consumer'},'native:consumer');f.tasks.receiveMainMessagesInTransaction([notice.messageId],'native:consumer');});
  processes.finish('synthetic-consumer','completed','turn:native:consumer:terminal:completed');
  assert.equal(f.tasks.safeToUpgrade(),true);
  const item=interactions.open({runId:run.id,threadId:run.threadId!,turnId:run.turnId!,requestId:'synthetic-approval',source:'native',kind:'authorization',details:{},authority:{...f.authority,nativeApprovals:true},runEpoch:run.epoch,taskVersion:run.version},()=>true);
  assert.equal(f.tasks.safeToUpgrade(),false);
  for(const state of ['approved','denied','answered']){
   f.store.db.prepare('UPDATE worker_interactions SET state=?,deliveredAt=NULL WHERE id=?').run(state,item.id);
   assert.equal(f.tasks.safeToUpgrade(),false);
  }
 }finally{f.close();}
});

for(const category of ['command','fileChange'] as const)test('closed native '+category+' effects block upgrades until their original outcome is known',()=>{
 const f=chatFixture();try{
  f.inputs.accept({requestId:'native-effect',text:'Synthetic effect only'});const input=f.inputs.claim()!,processes=new MainProcessHistory(f.store.db),turn='native:effect';
  f.inputs.started(input.messageId,input.revision,'generation:effect',turn);
  processes.start({id:'native-process',threadId:'thread:main',sourceKind:'user',sourceMessageIds:[input.messageId],messageId:'effect-reply'},turn);
  const event={threadId:'thread:main',turnId:turn,itemId:'native-item',category};
  processes.native('native-process',{...event,status:'running',completed:false});
  processes.finish('native-process','unknown','host:engine_closed:effect');f.inputs.uncertain(input.messageId,input.revision);
  assert.equal(f.store.db.prepare('SELECT state FROM agent_receipts WHERE messageId=?').get(input.messageId)!.state,'received');
  assert.equal(f.tasks.safeToUpgrade(),false);
  processes.native('native-process',{...event,status:'completed',completed:true});
  assert.equal(f.tasks.safeToUpgrade(),true,'a late exact native completion resolves only the effect, not the old processing result');
  assert.equal(processes.exact('native-process')!.status,'unknown');
 }finally{f.close();}
});

for(const [name,nodePatch,itemPatch,safe] of [
 ['same completed native turn',{},{},true],
 ['different native turn',{endEventId:'turn:other:terminal:completed'},{},false],
 ['host closure only',{endEventId:'host:engine_closed:effect'},{},false],
 ['missing terminal',{endEventId:undefined},{},false],
 ['missing tool turn',{},{turnId:undefined},false],
 ['empty tool turn',{endEventId:'turn::terminal:completed'},{turnId:''},false],
 ['active search',{state:'working'},{status:'running'},false],
 ['running tool in historical node',{},{status:'running'},false],
 ['blocked tool',{},{status:'blocked'},false],
 ['command',{},{category:'command'},false],
 ['file modification',{},{category:'fileChange'},false],
 ['external tool',{},{category:'externalTool'},false],
 ['image view',{},{category:'imageView'},false],
] as const)test('historical search uncertainty across upgrade, fork and recovery checks: '+name,()=>{
 const f=chatFixture();try{
  new WorkerInteractions(f.store.db);const bindings=new NativeThreadBindings(f.store),processes=new MainProcessHistory(f.store.db),input=f.source('search-effect');
  processes.start({id:'search-process',threadId:'thread:main',sourceKind:'user',sourceMessageIds:[input.messageId],messageId:'search-reply'},'native:search');
  processes.native('search-process',{threadId:'thread:main',turnId:'native:search',itemId:'search-item',category:'webSearch',status:'running',completed:false});
  processes.finish('search-process','completed','turn:native:search:terminal:completed');
  const key='publicMainNode:v1:search-process',node=JSON.parse(f.store.meta(key)!);
  Object.assign(node,nodePatch);Object.assign(node.items[0],itemPatch);const before=JSON.stringify(node);f.store.setMeta(key,before);
  assert.equal(f.tasks.safeToUpgrade(),safe);
  assert.equal((Homer.prototype as any).nativeForkAllowed.call({store:f.store,nativeThreads:bindings},'thread:main'),safe);
  assert.equal(freshMainReadiness(f.store.db).pending.nativeEffects,safe?0:1);
  f.store.setMeta('recursiveSchemaVersion','7');
  assert.equal(previewLegacyMainReceipts(f.store.db).blocked.includes('native_effect_unconfirmed'),!safe);
  assert.equal(f.store.meta(key),before,'readiness checks must not rewrite unknown history');
 }finally{f.close();}
});
