// Synthetic local SQLite/media only; never starts Homer or an engine.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {fixture,contract,main,running} from './recursive-fixture.js';
import {RecursiveTasks} from '../src/recursive-tasks.js';
import {MediaStore} from '../src/media-store.js';
import {Homer} from '../src/service.js';
import {TaskCreationRejected} from '../src/recursive-tasks.js';
import {ConversationHistory} from '../src/web-history.js';
import {MainInputs} from '../src/recursive-main-inputs.js';
mkdirSync('.codex/scratch/recursive-agent-implementation',{recursive:true});
function setup(){
 const f=fixture(),media=new MediaStore(f.store.db,join(f.dir,'media'));
 const ref=media.intent(main.sourceRequestId!,'synthetic','file');
 media.ready(ref,media.claim(ref)!,Buffer.from('Synthetic text'),'text/plain');
 // Exercise the actual host lifecycle callback without starting the service.
 const host=Object.create(Homer.prototype) as any;host.media=media;
 const tasks=new RecursiveTasks(f.store,f.files,{validateActor(){},validateAttachments:(source:string,refs:readonly import('../src/media-store.js').AttachmentRef[])=>host.validateTaskAttachments(source,refs)} as any);
 const id=ref.assetId+'@1',authority={sourceRequestId:main.sourceRequestId!,description:'synthetic',materials:['sample.md'],resultIds:[],attachments:[id],collaborateTaskIds:[]};
 const c=(ids=[id])=>({...contract(),inputs:ids.map(id=>({type:'attachment' as const,id}))});
 const input=(operationId:string,ids=[id])=>({operationId,title:'Synthetic attachment task',contract:c(ids),authority,executorKind:'worker' as const});
 const counts=()=>Object.fromEntries(['tasks','runs','task_versions','operations'].map(t=>[t,f.store.db.prepare('SELECT count(*) n FROM '+t).get()!.n]));
 return {...f,tasks,media,host,ref,id,authority,c,input,counts};
}
test('root rejects missing/noncanonical revision, unavailable and unauthorized refs atomically',()=>{
 const f=setup();try{
  const before=f.counts();
  for(const id of [f.ref.assetId,f.ref.assetId+'@01',f.ref.assetId+'@1e0',f.ref.assetId+'@1@2']){
   assert.throws(()=>f.tasks.createRoot(main,{...f.input('invalid-'+id,[id]),authority:{...f.authority,attachments:[id]}}),/task_attachment_reference_invalid/);
   assert.deepEqual(f.counts(),before);
  }
  assert.throws(()=>f.tasks.createRoot(main,f.input('version',[f.ref.assetId+'@2'])),/task_authority_input_denied/);
  const other=f.media.intent('other-source','synthetic','file'),otherId=other.assetId+'@1';
  assert.throws(()=>f.tasks.createRoot(main,{...f.input('other',[otherId]),authority:{...f.authority,attachments:[otherId]}}),/task_authority_input_denied/);
  f.media.revoke(main.sourceRequestId!);
  assert.throws(()=>f.tasks.createRoot(main,f.input('revoked')),/task_authority_input_denied/);
  assert.deepEqual(f.counts(),before);
 }finally{f.close();}
});
test('same operation recovers original receipt after revocation; payload conflict and uncertain stay distinct',()=>{
 const f=setup();try{
  const input=f.input('lost-reply'),receipt=f.tasks.createRoot(main,input),before=f.counts();
  const hash=f.store.db.prepare('SELECT payloadHash FROM operations WHERE id=?').get(receipt.operationKey)!.payloadHash;
  f.media.revoke(main.sourceRequestId!);
  assert.deepEqual(f.tasks.createRoot(main,input),receipt);
  assert.deepEqual(f.counts(),before);
  assert.equal(f.store.db.prepare('SELECT payloadHash FROM operations WHERE id=?').get(receipt.operationKey)!.payloadHash,hash);
  assert.throws(()=>f.tasks.createRoot(main,{...input,title:'changed'}),/operation_payload_conflict/);
  f.store.db.prepare('UPDATE operations SET responseJson=NULL WHERE id=?').run(receipt.operationKey);
  assert.throws(()=>f.tasks.createRoot(main,input),/operation_uncertain/);
 }finally{f.close();}
});
test('parent scope, child live checks, update CAS and rebase rollback remain enforced',()=>{
 const f=setup();try{
  const other=f.media.intent(main.sourceRequestId!,'synthetic','file');
  const root=f.tasks.createRoot(main,{...f.input('root-attachment'),authority:{...f.authority,attachments:[f.id,other.assetId+'@1']},executorKind:'main'});
  const child=(operationId:string,ids=[f.id])=>({operationId,taskId:root.taskId,version:1,expectedTaskRevision:f.tasks.task(root.taskId).revision,contract:f.c(ids),dependencies:[]});
  assert.throws(()=>f.tasks.delegate(main,child('scope',[other.assetId+'@1'])),/task_authority_input_denied/);
  const childInput=child('child'),created=f.tasks.delegate(main,childInput);
  const actor=running(f,created.taskId),t=f.tasks.task(created.taskId);
  const update={operationId:'queue',taskId:t.id,version:t.headVersion,expectedTaskRevision:t.revision,mode:'queue' as const,contract:f.c(),children:[],queuedDisposition:[]};
  const queued=f.tasks.update(main,update);
  const live=f.tasks.task(t.id),before=f.counts();
  assert.throws(()=>f.tasks.update(main,{...update,operationId:'stale'}),/task_revision_conflict/);
  // Main contract itself is valid; a malformed queued rebase rolls back earlier writes.
  assert.throws(()=>f.tasks.update(main,{...update,operationId:'rebase',version:live.headVersion,expectedTaskRevision:live.revision,mode:'steer',queuedDisposition:[{version:queued.version,action:'rebase',contract:f.c([f.ref.assetId])}]}),/task_attachment_reference_invalid/);
  assert.deepEqual(f.counts(),before);
  f.media.revoke(main.sourceRequestId!);
  assert.throws(()=>f.tasks.update(main,{...update,operationId:'rebase-revoked',contract:f.c([]),version:live.headVersion,expectedTaskRevision:live.revision,mode:'steer',queuedDisposition:[{version:queued.version,action:'rebase',contract:f.c()}]}),/task_authority_input_denied/);
  assert.deepEqual(f.counts(),before);
  assert.deepEqual(f.tasks.delegate(main,childInput),created); // receipt lookup before new authority
  assert.throws(()=>f.tasks.delegate(actor,{operationId:'grandchild',taskId:t.id,version:t.headVersion,expectedTaskRevision:f.tasks.task(t.id).revision,contract:f.c(),dependencies:[]}),/task_main_required/);
  assert.throws(()=>f.tasks.update(main,{...update,operationId:'after-revoke',expectedTaskRevision:live.revision}),/task_authority_input_denied/);
 }finally{f.close();}
});

test('pending source projects a copiable reference without changing persisted source or hash',()=>{
 const f=setup();try{
  const sourceRequestId='pending-source',ref=f.media.intent(sourceRequestId,'synthetic','file'),id=ref.assetId+'@1';
  f.store.setMeta('mainThread','thread');const actor={...main,sourceRequestId,threadId:'thread'};
  const history=new ConversationHistory(f.store.db),inputs=new MainInputs(f.tasks,history);
  inputs.accept({requestId:sourceRequestId,text:'synthetic attachment',attachments:[ref]});
  const q=inputs.claim()!;inputs.started(q.messageId,q.revision,'generation','turn');inputs.finish(q.messageId,q.revision,'completed');
  const raw=()=>f.store.db.prepare('SELECT refsJson FROM conversation_attachments WHERE requestId=?').get(sourceRequestId)!.refsJson;
  const before=raw(),source=f.tasks.pending.source(actor,sourceRequestId);
  assert.deepEqual(source.attachments[0],{...ref,reference:{type:'attachment',id}});assert.equal(raw(),before);
  const pending=f.tasks.pending.add(actor,{operationId:'remember',content:'synthetic'});
  const selection={items:[{id:pending.id,expectedRevision:1}],sourceRequestIds:[sourceRequestId],primarySourceRequestId:sourceRequestId};
  const input={operationId:'pending-create',title:'synthetic',contract:f.c([id]),executorKind:'worker' as const},authority={...f.authority,sourceRequestId,attachments:[id]};
  const receipt=f.tasks.createPendingRoot(actor,input,selection,()=>authority);
  f.media.revoke(sourceRequestId);
  assert.deepEqual(f.tasks.createPendingRoot(actor,input,selection,()=>{throw Error('must not reauthorize');}),receipt);
  const counts=f.counts();
  assert.throws(()=>f.tasks.createPendingRoot(actor,{...input,operationId:'revoked-pending'},{...selection,items:[{id:pending.id,expectedRevision:2}]},()=>{f.host.validateTaskAttachments(sourceRequestId,[ref]);return authority;}),error=>error instanceof TaskCreationRejected&&error.message==='task_authority_input_denied');
  assert.deepEqual(f.counts(),counts);
 }finally{f.close();}
});
test('rollback failure never produces a definite no-creation marker',()=>{
 const f=setup();try{
  const original=f.store.db.exec.bind(f.store.db);
  f.store.db.exec=(sql:string)=>{if(sql==='ROLLBACK')throw Error('synthetic_rollback_failure');return original(sql);};
  assert.throws(()=>f.tasks.createRoot(main,f.input('rollback',[f.ref.assetId])),(error:unknown)=>error instanceof Error&&!(error instanceof TaskCreationRejected)&&error.message==='synthetic_rollback_failure');
  f.store.db.exec=original;original('ROLLBACK');
 }finally{f.close();}
});

test('availability is metadata-only and rejects missing/current-version mismatch/expired/deleted',()=>{
 const f=setup();try{
  unlinkSync(join(f.dir,'media',f.ref.assetId));
  const receipt=f.tasks.createRoot(main,f.input('metadata-only'));assert.ok(receipt.taskId);
  for(const state of ['expired','deleted','revoked']){
   f.store.db.prepare('UPDATE media_assets SET state=? WHERE id=?').run(state,f.ref.assetId);
   assert.throws(()=>f.tasks.createRoot(main,f.input('state-'+state)),/task_authority_input_denied/);
  }
  f.store.db.prepare("UPDATE media_assets SET state='ready',revision=2 WHERE id=?").run(f.ref.assetId);
  assert.throws(()=>f.tasks.createRoot(main,f.input('old-version')),/task_authority_input_denied/);
  const missing='asset-00000000-0000-4000-8000-000000000009@1';
  assert.throws(()=>f.tasks.createRoot(main,{...f.input('missing',[missing]),authority:{...f.authority,attachments:[missing]}}),/task_authority_input_denied/);
 }finally{f.close();}
});

test('complete rollback leaves operationId available for an explicitly corrected contract',()=>{
 const f=setup();try{
  assert.throws(()=>f.tasks.createRoot(main,f.input('explicit-correction',[f.ref.assetId])),/task_attachment_reference_invalid/);
  const receipt=f.tasks.createRoot(main,f.input('explicit-correction'));assert.ok(receipt.taskId);
  assert.deepEqual(f.tasks.createRoot(main,f.input('explicit-correction')),receipt);
  assert.throws(()=>f.tasks.createRoot(main,f.input('explicit-correction',[f.ref.assetId])),/operation_payload_conflict/);
 }finally{f.close();}
});
