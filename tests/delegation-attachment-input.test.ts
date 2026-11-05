// Isolated SQLite/media and real host attachment checks; no engine or account.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {chatFixture} from './task-chat-fixture.js';
import {RecursiveTasks, type Authority} from '../src/recursive-tasks.js';
import {MediaStore} from '../src/media-store.js';
import {Homer} from '../src/service.js';
import {RecursiveTools} from '../src/recursive-tools.js';

function setup(){
 const f=chatFixture(),media=new MediaStore(f.store.db,join(f.dir,'media'));
 const ref=media.intent(f.actor.sourceRequestId!,'synthetic','file');
 media.ready(ref,media.claim(ref)!,Buffer.from('Synthetic text'),'text/plain');
 const host=Object.create(Homer.prototype) as any;host.media=media;
 const tasks=new RecursiveTasks(f.store,f.files,{validateActor(){},validateAttachments:(source,refs)=>host.validateTaskAttachments(source,refs)});
 const id=ref.assetId+'@1',authority:Authority={...f.authority,attachments:[id]};
 const input=(operationId:string,ids=[id])=>({operationId,goal:'Inspect the assigned synthetic attachment',authority:{...authority,attachments:ids}});
 const counts=()=>Object.fromEntries(['tasks','runs','task_versions','operations'].map(t=>[t,f.store.db.prepare('SELECT count(*) n FROM '+t).get()!.n]));
 return {...f,tasks,media,host,ref,id,authority,input,counts};
}

test('task creation rejects noncanonical, unavailable and foreign attachment authority atomically',()=>{
 const f=setup();try{
  const before=f.counts();
  for(const id of [f.ref.assetId,f.ref.assetId+'@01',f.ref.assetId+'@1e0',f.ref.assetId+'@1@2']){
   assert.throws(()=>f.tasks.createTask(f.actor,f.input('invalid-'+id,[id])),/task_attachment_reference_invalid/);
   assert.deepEqual(f.counts(),before);
  }
  assert.throws(()=>f.tasks.createTask(f.actor,f.input('version',[f.ref.assetId+'@2'])),/task_authority_input_denied/);
  const other=f.media.intent('other-source','synthetic','file');
  assert.throws(()=>f.tasks.createTask(f.actor,f.input('other',[other.assetId+'@1'])),/task_authority_input_denied/);
  f.media.revoke(f.actor.sourceRequestId!);
  assert.throws(()=>f.tasks.createTask(f.actor,f.input('revoked')),/task_authority_input_denied/);
  assert.deepEqual(f.counts(),before);
 }finally{f.close();}
});

test('same operation recovers its original receipt after revocation; changed payload and uncertainty stay distinct',()=>{
 const f=setup();try{
  const input=f.input('lost-reply'),receipt=f.tasks.createTask(f.actor,input),before=f.counts();
  const hash=f.store.db.prepare('SELECT payloadHash FROM operations WHERE id=?').get(receipt.operationKey)!.payloadHash;
  f.media.revoke(f.actor.sourceRequestId!);
  assert.deepEqual(f.tasks.createTask(f.actor,input),receipt);assert.deepEqual(f.counts(),before);
  assert.equal(f.store.db.prepare('SELECT payloadHash FROM operations WHERE id=?').get(receipt.operationKey)!.payloadHash,hash);
  assert.throws(()=>f.tasks.createTask(f.actor,{...input,goal:'Changed'}),/operation_payload_conflict/);
  assert.throws(()=>f.tasks.workerOpen(f.actor,{operationId:'new-open',taskId:receipt.taskId,text:'Use revoked attachment'}),/task_authority_input_denied/);
  assert.deepEqual(f.counts(),before);
  f.store.db.prepare('UPDATE operations SET responseJson=NULL WHERE id=?').run(receipt.operationKey);
  assert.throws(()=>f.tasks.createTask(f.actor,input),/operation_uncertain/);
 }finally{f.close();}
});

test('goal updates preserve CAS and roll back invalid or revoked attachment authority',()=>{
 const f=setup();try{
  const root=f.tasks.createTask(f.actor,f.input('create')),task=f.tasks.task(root.taskId);
  f.tasks.updateTask(f.actor,{operationId:'notes',taskId:task.id,expectedRevision:task.revision,patch:{notes:'Read the actual source'}});
  assert.throws(()=>f.tasks.updateTask(f.actor,{operationId:'stale',taskId:task.id,expectedRevision:task.revision,patch:{notes:'stale'}}),/task_revision_conflict/);
  const before=f.counts(),revision=f.tasks.task(task.id).revision;
  const update={taskId:task.id,expectedRevision:revision,patch:{goal:'Recheck assigned source'},authority:f.authority};
  assert.throws(()=>f.tasks.updateTask(f.actor,{...update,operationId:'invalid',authority:{...f.authority,attachments:[f.ref.assetId]}}),/task_attachment_reference_invalid/);
  assert.deepEqual(f.counts(),before);assert.equal(f.tasks.task(task.id).headVersion,1);
  f.media.revoke(f.actor.sourceRequestId!);
  assert.throws(()=>f.tasks.updateTask(f.actor,{...update,operationId:'revoked'}),/task_authority_input_denied/);
  assert.deepEqual(f.counts(),before);assert.equal(f.tasks.task(task.id).revision,revision);
 }finally{f.close();}
});

test('Worker reads the exact authorized attachment and cannot read a foreign source or revision',async()=>{
 const f=setup();try{
  const task=f.tasks.createTask(f.actor,f.input('create')),opened=f.tasks.workerOpen(f.actor,{operationId:'open',taskId:task.taskId,text:'Inspect source'}),run=f.start(opened.workerId);
  const actor={agentId:'worker:'+opened.workerId,runId:run.id,epoch:run.epoch,threadId:run.threadId!,turnId:run.turnId!};
  Object.assign(f.host,{tasks:f.tasks,store:f.store,files:f.files,workerActor:()=>actor,closing:false,accountClocks(){}});
  const read=()=>f.host.workerToolWork({id:run.id,epoch:run.epoch},{tool:'read_material',arguments:{},threadId:actor.threadId,turnId:actor.turnId,callId:'read'});
  const result=await read();assert.deepEqual(result.attachments[0].reference,{type:'attachment',id:f.id});
  f.store.db.prepare('UPDATE media_assets SET requestId=? WHERE id=?').run('foreign-source',f.ref.assetId);
  await assert.rejects(read,/media_scope_denied/);
  f.store.db.prepare('UPDATE media_assets SET requestId=?,revision=2 WHERE id=?').run(f.actor.sourceRequestId!,f.ref.assetId);
  await assert.rejects(read,/media_asset_not_found/);
 }finally{f.close();}
});

test('a note source exposes a copiable reference without changing persisted source or enabling dispatch',()=>{
 const f=setup();try{
  const sourceRequestId='source:attachment-note',ref=f.media.intent(sourceRequestId,'synthetic','file'),id=ref.assetId+'@1';
  f.media.ready(ref,f.media.claim(ref)!,Buffer.from('Synthetic note attachment'),'text/plain');
  f.inputs.accept({requestId:sourceRequestId,text:'Synthetic attachment',attachments:[ref]});
  const q=f.inputs.claim()!;f.inputs.started(q.messageId,q.revision,'generation:note','turn:note');f.inputs.finish(q.messageId,q.revision,'completed');
  const actor={...f.actor,sourceRequestId,inputMessageId:q.messageId};
  const raw=()=>f.store.db.prepare('SELECT refsJson FROM conversation_attachments WHERE requestId=?').get(sourceRequestId)!.refsJson;
  const before=raw(),source=f.tasks.pending.source(actor,sourceRequestId);
  assert.deepEqual(source.attachments[0],{...ref,reference:{type:'attachment',id}});assert.equal(raw(),before);
  const note=f.tasks.pending.add(actor,{operationId:'remember',content:'Synthetic note'});assert.equal(f.tasks.tasks().length,0);assert.equal(f.tasks.runs().length,0);
  const input={...f.input('from-source',[id]),authority:{...f.authority,sourceRequestId,attachments:[id]}};
  const receipt=f.tasks.createTask(actor,input);assert.equal(f.tasks.pending.list(actor,{id:note.id}).items[0]!.linkedTaskId,null);
  f.media.revoke(sourceRequestId);assert.deepEqual(f.tasks.createTask(actor,input),receipt);
  const counts=f.counts();assert.throws(()=>f.tasks.createTask(actor,{...input,operationId:'revoked-source'}),/task_authority_input_denied/);assert.deepEqual(f.counts(),counts);
 }finally{f.close();}
});

test('rollback failure remains unknown rather than claiming no creation',()=>{
 const f=setup();try{
  const original=f.store.db.exec.bind(f.store.db);
  f.store.db.exec=(sql:string)=>{if(sql==='ROLLBACK')throw Error('synthetic_rollback_failure');return original(sql);};
  try{assert.throws(()=>f.tasks.createTask(f.actor,f.input('rollback',[f.ref.assetId])),/synthetic_rollback_failure/);}
  finally{f.store.db.exec=original;original('ROLLBACK');}
 }finally{f.close();}
});

test('availability remains metadata-only and rejects missing, old revision, expired, deleted or revoked refs',()=>{
 const f=setup();try{
  unlinkSync(join(f.dir,'media',f.ref.assetId));assert.ok(f.tasks.createTask(f.actor,f.input('metadata-only')).taskId);
  for(const state of ['expired','deleted','revoked']){
   f.store.db.prepare('UPDATE media_assets SET state=? WHERE id=?').run(state,f.ref.assetId);
   assert.throws(()=>f.tasks.createTask(f.actor,f.input('state-'+state)),/task_authority_input_denied/);
  }
  f.store.db.prepare("UPDATE media_assets SET state='ready',revision=2 WHERE id=?").run(f.ref.assetId);
  assert.throws(()=>f.tasks.createTask(f.actor,f.input('old-version')),/task_authority_input_denied/);
  assert.throws(()=>f.tasks.createTask(f.actor,f.input('missing',['asset-00000000-0000-4000-8000-000000000009@1'])),/task_authority_input_denied/);
 }finally{f.close();}
});

test('a fully rolled back operation can be explicitly corrected and then replays only that exact payload',()=>{
 const f=setup();try{
  assert.throws(()=>f.tasks.createTask(f.actor,f.input('correction',[f.ref.assetId])),/task_attachment_reference_invalid/);
  const receipt=f.tasks.createTask(f.actor,f.input('correction'));assert.ok(receipt.taskId);
  assert.deepEqual(f.tasks.createTask(f.actor,f.input('correction')),receipt);
  assert.throws(()=>f.tasks.createTask(f.actor,f.input('correction',[f.ref.assetId])),/operation_payload_conflict/);
 }finally{f.close();}
});

test('existing Pending selection replays the native receipt before checking newly revoked attachments',async()=>{
 const f=setup();try{
  const sourceRequestId='source:selected-attachment',ref=f.media.intent(sourceRequestId,'synthetic','file');
  f.media.ready(ref,f.media.claim(ref)!,Buffer.from('Synthetic selected attachment'),'text/plain');
  f.inputs.accept({requestId:sourceRequestId,text:'Synthetic selected source',attachments:[ref]});
  const q=f.inputs.claim()!;f.inputs.started(q.messageId,q.revision,'generation:selected','turn:selected');f.inputs.finish(q.messageId,q.revision,'completed');
  const actor={...f.actor,sourceRequestId,inputMessageId:q.messageId};
  Object.assign(f.host,{tasks:f.tasks,files:f.files,mainContext:{event:false,requestId:sourceRequestId,queuedInput:{input:{attachments:[ref]}}}});
  const tools=new RecursiveTools(f.tasks,{rootAuthority:(actor,sources)=>f.host.selectedAuthority(actor,sources),wake(){},stop:async()=>({}),steer:async()=>({})});
  const pending=f.tasks.pending.add(actor,{operationId:'select-pending',content:'Inspect the assigned attachment'});
  const args={goal:'Inspect selected Pending',pendingIds:[pending.id]};
  const receipt=await tools.call(actor,'task_create',args,'selected-create'),before=f.counts();
  f.media.revoke(sourceRequestId);
  assert.deepEqual(await tools.call(actor,'task_create',args,'selected-create'),receipt);
  assert.deepEqual(f.counts(),before);
  await assert.rejects(tools.call(actor,'task_create',args,'new-create'),/task_authority_input_denied/);
 }finally{f.close();}
});
