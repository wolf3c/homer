// Synthetic task/bytes only; never starts a model or a user channel.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {fixture,delegate,running,main} from './recursive-fixture.js';
import {RecursiveTasks} from '../src/recursive-tasks.js';
import {Store} from '../src/store.js';
import {Homer} from '../src/service.js';
import {homerWebBridge} from '../src/web-homer.js';

function setup(kind:'markdown'|'file'|'structured'='markdown'){
 const f=fixture(),child=delegate(f,'multi',undefined,undefined,kind),actor=running(f,child.taskId);
 f.tasks.markMaterialRead(actor);
 const host=Object.create(Homer.prototype) as any;Object.assign(host,{stateObservers:new Set(),tasks:f.tasks,files:f.files,store:f.store,memory:{validateRun(){}},workerActor:()=>actor,closing:false,registerChannelCapabilities(){}});
 return {...f,child,actor,bridge:homerWebBridge(host),host};
}
type Fixture=ReturnType<typeof setup>;
function write(f:Fixture,name:string,content='# '+name,operationId=name){return f.tasks.writeMarkdown(f.actor,{operationId,filename:name,content});}
function seal(f:Fixture,_ids:string[],_outcome:'succeeded'|'partial'|'failed'='succeeded'){
 return f.tasks.endSegment(f.actor.runId!,f.actor.epoch!,{status:'completed',text:'Synthetic files checked; dates remain unknown.'},true)!;
}
function review(f:Fixture,id:string,accepted=true,outcome:'succeeded'|'partial'|'failed'='succeeded'){
 const t=f.tasks.task(f.child.taskId);return f.tasks.review(main,{operationId:'review-'+id,taskId:t.id,version:1,expectedTaskRevision:t.revision,resultId:id,...(accepted?{accepted:true,outcome}:{decision:'terminal_failure' as const,outcome:'failed' as const}),reason:'Actual synthetic bytes checked',evidence:{facts:true,gaps:'Synthetic optional part missing'},children:[]});
}
function root(f:Fixture,id:string,outcome:'succeeded'|'partial'='succeeded'){
 const t=f.tasks.task(f.root.taskId);return {taskId:t.id,version:1,expectedTaskRevision:t.revision,outcome,evidence:{facts:true,gaps:'Synthetic optional part missing'},children:[{childTaskId:f.child.taskId,childVersion:1,disposition:'included' as const,resultId:id,reason:'Reviewed whole returned set'}]};
}
function publish(f:Fixture,settlement:ReturnType<typeof root>,ids:string[]){return f.tasks.publish(main,{...settlement,operationId:'publish',resultId:null,text:'Synthetic multiple-file delivery',publishedFileResultId:null,publishedFileResultIds:ids});}

test('multiple Markdown: automatic return, actual-byte group review, selected publication and restart are one settlement',async()=>{
 const f=setup();try{
  const a=write(f,'facts.md','# Facts\nunknown'),b=write(f,'notes.md','# Notes\n未确定'),privateFile=write(f,'internal.md');
  assert.notEqual(a.resultId,b.resultId);assert.deepEqual(write(f,'facts.md','# Facts\nunknown'),a);
  const done=seal(f,[a.resultId,b.resultId]);
  assert.equal(f.tasks.inspect(main,{runId:f.actor.runId}).results.length,3);
  f.tasks.inspect(main,{resultId:a.resultId});assert.throws(()=>review(f,done.resultId),/result_inspection_required/);
  f.tasks.inspect(main,{resultId:b.resultId});f.tasks.inspect(main,{resultId:privateFile.resultId});review(f,done.resultId);
  assert.equal(f.tasks.task(f.child.taskId).state,'settled');
  assert.equal(f.tasks.inspect(main,{resultId:privateFile.resultId}).results.find(x=>x.id===privateFile.resultId)?.state,'accepted');
  for(const id of[a.resultId,b.resultId,privateFile.resultId])await assert.rejects(()=>f.bridge.artifact(id),/artifact_not_authorized/);
  const final=root(f,done.resultId),delivery=publish(f,final,[a.resultId,b.resultId]);
  assert.equal(publish(f,final,[a.resultId,b.resultId]).deliveryId,delivery.deliveryId);
  for(const item of[a,b]){const file=await f.bridge.artifact(item.resultId);assert.equal(file.filename,item===a?'facts.md':'notes.md');assert.equal(Buffer.from(file.data!,'base64').toString(),item===a?'# Facts\nunknown':'# Notes\n未确定');}
  assert.equal((await f.bridge.artifact(f.actor.runId!)).filename,'facts.md');
  await assert.rejects(()=>f.bridge.artifact(privateFile.resultId),/artifact_not_authorized/);
  f.tasks.markDelivery(delivery.deliveryId,'submitting');f.tasks.markDelivery(delivery.deliveryId,'recorded');
  const store=new Store(join(f.dir,'homer.sqlite'));try{const tasks=new RecursiveTasks(store,f.files);tasks.migrate();tasks.reconcile();assert.equal(tasks.deliveries().length,1);assert.equal(tasks.pendingDeliveries().length,0);assert.equal(tasks.publishedArtifacts(f.actor.runId!).length,2);assert.equal(tasks.delivery(delivery.deliveryId).publishedFileResultIds.length,2);}finally{store.close();}
  f.tasks.markDelivery(delivery.deliveryId,'revoked');await assert.rejects(()=>f.bridge.artifact(a.resultId),/artifact_not_authorized/);await assert.rejects(()=>f.bridge.artifact(b.resultId),/artifact_not_authorized/);
 }finally{f.close();}
});

test('different operations cannot claim the same staged filename, identical bytes included; retry stays idempotent',()=>{
 const f=setup();try{const a=write(f,'same.md','first','original');
  for(const content of['first','changed'])assert.throws(()=>write(f,'same.md',content,'another-'+content),/artifact_filename_conflict/);
  assert.equal(f.files.verify(f.files.prepareRun(f.tasks.run(f.actor.runId!).matterId,f.actor.runId!),a.path).content,'first');
  assert.throws(()=>write(f,'same.md','changed','original'),/operation_payload_conflict/);
  assert.equal(f.tasks.inspect(main,{runId:f.actor.runId}).results.length,1);
 }finally{f.close();}
});

test('mixed workspace/binary/Markdown files keep exact bytes and unselected accepted files remain private',async()=>{
 const f=setup('file');try{
  const run=f.tasks.run(f.actor.runId!),dir=f.files.prepareRun(run.matterId,run.id),bytes=Buffer.from([0,255,3,4,8]);
  writeFileSync(join(dir,'generated.bin'),bytes);
  const a=await f.host.workerMediaTool({id:run.id,epoch:run.epoch},'stage_workspace_file',{operationId:'workspace',path:'generated.bin',filename:'generated.bin'});
  const b=f.tasks.writeFile(f.actor,{operationId:'binary',filename:'second.bin',bytes:Buffer.from([255,0,22])}),c=write(f,'notes.md');
  const done=seal(f,[a.resultId,b.resultId,c.resultId]);for(const id of[a.resultId,b.resultId,c.resultId])f.tasks.inspect(main,{resultId:id});review(f,done.resultId);
  const final=root(f,done.resultId);publish(f,final,[a.resultId,c.resultId]);
  assert.deepEqual(Buffer.from((await f.bridge.artifact(a.resultId)).data!,'base64'),bytes);await assert.rejects(()=>f.bridge.artifact(b.resultId),/artifact_not_authorized/);
  writeFileSync(a.path,'tampered');await assert.rejects(()=>f.bridge.artifact(a.resultId),/result_hash_mismatch/);
 }finally{f.close();}
});

test('scope, exact completion and inspection fences reject unrelated/stale members and unsafe paths',async()=>{
 const f=setup();try{
  const a=write(f,'a.md'),b=write(f,'b.md');
  const other=delegate(f,'other',undefined,undefined,'markdown'),actor=running(f,other.taskId);f.tasks.markMaterialRead(actor);const foreign=f.tasks.writeMarkdown(actor,{operationId:'foreign',filename:'foreign.md',content:'other task'});
  for(const filename of['../bad.md','/bad.md'])assert.throws(()=>write(f,filename),/artifact_input_denied/);
  const dir=f.files.prepareRun(f.tasks.run(f.actor.runId!).matterId,f.actor.runId!);symlinkSync('/etc/hosts',join(dir,'link.md'));assert.throws(()=>write(f,'link.md'),/symlink_denied/);
  const done=seal(f,[a.resultId,b.resultId]);assert.equal(done.resultIds.includes(foreign.resultId),false);f.tasks.inspect(main,{resultId:a.resultId});f.tasks.inspect({...main,turnId:'other-turn'},{resultId:b.resultId});assert.throws(()=>review(f,done.resultId),/result_inspection_required/);
  writeFileSync(b.path,'tampered');assert.throws(()=>f.tasks.inspect(main,{resultId:b.resultId}),/result_hash_mismatch/);
  assert.throws(()=>write(f,'late.md'),/run_not_live/);
 }finally{f.close();}
});

test('automatic return includes every explicitly staged file for Markdown and structured contracts',()=>{
 for(const kind of['markdown','structured'] as const){const f=setup(kind);try{
  const a=write(f,'a.md'),b=write(f,'b.md'),t=f.tasks.task(f.child.taskId);
  assert.equal(f.tasks.task(t.id).outcome,null);
  const done=f.tasks.endSegment(f.actor.runId!,f.actor.epoch!,{status:'completed',text:JSON.stringify({summary:'synthetic'})},true)!;
  f.tasks.endSegment(f.actor.runId!,f.actor.epoch!,{status:'completed',text:'Synthetic final result'},true);for(const id of new Set([done.resultId,a.resultId,b.resultId]))f.tasks.inspect(main,{resultId:id});review(f,done.resultId);assert.equal(f.tasks.task(t.id).outcome,'succeeded');
 }finally{f.close();}}
});

test('partial and rejected groups settle once and retain their actual outcome',()=>{
 for(const accepted of[true,false]){const f=setup();try{const a=write(f,'a.md'),b=write(f,'b.md');const done=seal(f,[a.resultId,b.resultId],'partial');for(const id of[a.resultId,b.resultId])f.tasks.inspect(main,{resultId:id});review(f,done.resultId,accepted,'partial');assert.equal(f.tasks.task(f.child.taskId).outcome,accepted?'partial':'failed');const rows=f.tasks.inspect(main,{runId:f.actor.runId}).results;assert.ok(rows.every(x=>x.state===(accepted?'accepted':'rejected')));assert.throws(()=>review(f,b.resultId,accepted,'partial'),/task_revision_conflict|task_phase_denied|result_not_offered|task_not_executing/);}finally{f.close();}}
});

test('HTTP exposes only explicitly published IDs, checks publication/source and revokes all selected links',async()=>{
 const {createWebServer,fetch}=await import('./web-connected-fixture.js');const f=setup();let web:Awaited<ReturnType<typeof createWebServer>>|undefined;
 try{
  const a=write(f,'a.md'),b=write(f,'b.md'),hidden=write(f,'hidden.md');const done=seal(f,[a.resultId,b.resultId]);for(const id of[a.resultId,b.resultId,hidden.resultId])f.tasks.inspect(main,{resultId:id});review(f,done.resultId);const final=root(f,done.resultId);
  assert.equal(f.tasks.publishedResult(hidden.resultId),undefined,'accepted candidates are still private before explicit publication');
  assert.throws(()=>publish(f,final,[a.resultId,a.resultId]),/delivery_file_selection_invalid/);
  writeFileSync(b.path,'tampered before publication');assert.throws(()=>publish(f,final,[a.resultId,b.resultId]),/result_hash_mismatch/);assert.equal(f.tasks.deliveries().length,0);writeFileSync(b.path,'# b.md');
  const delivery=publish(f,final,[a.resultId,b.resultId]);
  assert.equal(f.tasks.publishedResult(a.resultId,{sourceRequestId:'another-user-source'}),undefined);
  web=await createWebServer({bridge:f.bridge,port:0});
  assert.equal((await globalThis.fetch(web.url+'/api/files/'+a.resultId)).status,200);
  for(const file of[a,b]){const response:Response=await fetch(web.url+'/api/files/'+file.resultId);assert.equal(response.status,200);assert.equal(await response.text(),file===a?'# a.md':'# b.md');}
  for(const suffix of[hidden.resultId,'result-unrelated'])assert.equal((await fetch(web.url+'/api/files/'+suffix)).status,409);
  for(const suffix of[a.resultId+'?path=/etc/hosts',a.resultId+'?resultId='+hidden.resultId])assert.equal((await fetch(web.url+'/api/files/'+suffix)).status,400);
  assert.equal((await fetch(web.url+'/api/files/'+a.resultId+'%2F..%2Fhidden.md')).status,404);
  f.tasks.markDelivery(delivery.deliveryId,'revoked');for(const file of[a,b])assert.equal((await fetch(web.url+'/api/files/'+file.resultId)).status,409);
 }finally{await web?.close();f.close();}
});

test('replacement fences old writers and only its own staged files enter the next return',()=>{
 const f=setup();try{
  const a=write(f,'old.md'),b=write(f,'old-two.md'),t=f.tasks.task(f.child.taskId);
  const update=f.tasks.update(main,{operationId:'replace',taskId:t.id,version:1,expectedTaskRevision:t.revision,mode:'stop_replace',contract:f.tasks.contract(t.id,1),children:[],queuedDisposition:[]});
  f.tasks.confirmStop(update.operationKey,true);
  const replacement=running(f,t.id);f.tasks.markMaterialRead(replacement);
  const current=f.tasks.writeMarkdown(replacement,{operationId:'current',filename:'current.md',content:'new attempt'});
  const done=f.tasks.endSegment(replacement.runId!,replacement.epoch!,{status:'completed',text:'Replacement checked'},true)!;
  assert.deepEqual(done.resultIds,[current.resultId]);
  for(const file of[a,b])assert.equal(f.tasks.publishedResult(file.resultId),undefined);
  assert.throws(()=>f.tasks.writeMarkdown(f.actor,{operationId:'late',filename:'late.md',content:'late'}),/run_epoch_stale|run_stop_requested/);
 }finally{f.close();}
});

test('publication rejects an accepted completion from another tree and a member cannot replace the primary settlement',()=>{
 const f=setup();try{
  const a=write(f,'a.md'),b=write(f,'b.md'),done=seal(f,[a.resultId,b.resultId]);for(const id of[a.resultId,b.resultId])f.tasks.inspect(main,{resultId:id});review(f,done.resultId);
  const t=f.tasks.task(f.root.taskId);assert.throws(()=>f.tasks.publish(main,{operationId:'member-root',taskId:t.id,version:1,expectedTaskRevision:t.revision,outcome:'succeeded',evidence:{facts:true},children:[{childTaskId:f.child.taskId,childVersion:1,disposition:'included',resultId:b.resultId,reason:'member is not a settlement'}],resultId:null,text:JSON.stringify({summary:'bad'}),publishedFileResultId:null}),/child_result_not_accepted/);
  const other=f.tasks.createRoot(main,{operationId:'other-root',title:'Other tree',contract:{goal:'text',inputs:[],resultKind:'structured',acceptance:{criteria:[]}},authority:f.tasks.authority(t.id,1)}),otherTask=f.tasks.task(other.taskId);
  const text=({operationId:'other-complete',taskId:otherTask.id,version:1,expectedTaskRevision:otherTask.revision,outcome:'succeeded',evidence:{},children:[],resultId:null,text:JSON.stringify({text:'pure text'}),publishedFileResultId:null} satisfies Parameters<typeof f.tasks.publish>[1]);
  assert.throws(()=>f.tasks.publish(main,{...text,operationId:'other-publish',taskId:otherTask.id,version:1,expectedTaskRevision:f.tasks.task(otherTask.id).revision,resultId:text.resultId,publishedFileResultId:null,publishedFileResultIds:[a.resultId,b.resultId],text:'wrong tree'}),/delivery_file_not_accepted/);
  const delivery=f.tasks.publish(main,{...text,operationId:'text-publish',taskId:otherTask.id,version:1,expectedTaskRevision:f.tasks.task(otherTask.id).revision,resultId:text.resultId,publishedFileResultId:null,text:'text only'});assert.deepEqual(f.tasks.delivery(delivery.deliveryId).publishedFileResultIds,[]);
 }finally{f.close();}
});


test('download bytes cannot change between verification and the byte read without failing',()=>{
 const f=setup();try{const a=write(f,'race.md','original');const verify=f.files.verify.bind(f.files);
  f.files.verify=(dir,path)=>{const result=verify(dir,path);writeFileSync(path,'replacement bytes');return result;};
  assert.throws(()=>f.files.resultBytes(f.files.prepareRun(f.tasks.run(f.actor.runId!).matterId,f.actor.runId!),a.path),/artifact_changed/);
 }finally{f.close();}
});
