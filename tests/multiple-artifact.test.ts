// Synthetic Task/Worker records and exact bytes; no model or user channel.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {fixture,openWorker,running,complete,main,mutation,authority} from './recursive-fixture.js';
import {RecursiveTasks} from '../src/recursive-tasks.js';
import {Store} from '../src/store.js';
import {Homer} from '../src/service.js';
import {homerWebBridge} from '../src/web-homer.js';

function setup(){
 const f=fixture(),opened=openWorker(f,'multi'),actor=running(f,opened.runId);
 const host={store:f.store,files:f.files,tasks:f.tasks,registerChannelCapabilities(){},onStateChange:(listener:()=>void)=>f.store.db.onChange(()=>listener())} as unknown as Homer;
 host.previewArtifact=Homer.prototype.previewArtifact.bind(host);
 return {...f,actor,opened,bridge:homerWebBridge(host)};
}
type Fixture=ReturnType<typeof setup>;
function write(f:Fixture,name:string,content='# '+name,operationId=name){return f.tasks.writeMarkdown(f.actor,{operationId,filename:name,content});}
function adopt(f:Fixture,written:{path:string},operationId=written.path){
 const accepted=f.tasks.adoptResult(main,{operationId:'adopt-'+operationId,taskId:f.task.taskId,version:1,runId:f.actor.runId,filePath:written.path});
 return {...f.tasks.readResult(main,accepted.resultId).file!,resultId:accepted.resultId};
}
function publish(f:Fixture,ids:string[]){return f.tasks.publish(main,{operationId:'publish',taskId:f.task.taskId,version:1,resultIds:ids,text:'Synthetic multiple-file delivery'});}

test('multiple Markdown files require explicit adoption and selected publication, survive restart and revoke together',async()=>{
 const f=setup();try{
  const written=[write(f,'facts.md','# Facts\nunknown'),write(f,'notes.md','# Notes\n未确定'),write(f,'internal.md')];
  assert.deepEqual(write(f,'facts.md','# Facts\nunknown'),written[0]);
  complete(f,f.actor,'Synthetic files checked; dates remain unknown.');
  assert.deepEqual(f.tasks.readTask(main,f.task.taskId).results,[]);
  const [a,b,privateFile]=written.map(file=>adopt(f,file));
  assert.notEqual(a!.resultId,b!.resultId);
  assert.equal(f.tasks.task(f.task.taskId).state,'open','adoption does not settle the task');
  for(const file of[a!,b!,privateFile!])await assert.rejects(()=>f.bridge.artifact(file.resultId),/artifact_not_authorized/);
  const delivery=publish(f,[a!.resultId,b!.resultId]);
  assert.equal(publish(f,[a!.resultId,b!.resultId]).deliveryId,delivery.deliveryId);
  for(const [file,filename,content] of [[a!,'facts.md','# Facts\nunknown'],[b!,'notes.md','# Notes\n未确定']] as const){const actual=await f.bridge.artifact(file.resultId);assert.equal(actual.filename,filename);assert.equal(Buffer.from(actual.data!,'base64').toString(),content);}
  assert.equal((await f.bridge.artifact(f.actor.runId!)).filename,'facts.md');
  await assert.rejects(()=>f.bridge.artifact(privateFile!.resultId),/artifact_not_authorized/);
  f.tasks.markDelivery(delivery.deliveryId,'submitting');f.tasks.markDelivery(delivery.deliveryId,'recorded');
  const store=new Store(join(f.dir,'homer.sqlite'));try{const tasks=new RecursiveTasks(store,f.files);tasks.migrate();tasks.reconcile();assert.equal(tasks.deliveries().length,1);assert.equal(tasks.pendingDeliveries().length,0);assert.equal(tasks.publishedArtifacts(f.actor.runId!).length,2);assert.equal(tasks.delivery(delivery.deliveryId).publishedFileResultIds.length,2);}finally{store.close();}
  f.tasks.markDelivery(delivery.deliveryId,'revoked');for(const file of[a!,b!])await assert.rejects(()=>f.bridge.artifact(file.resultId),/artifact_not_authorized/);
 }finally{f.close();}
});

test('unknown external delivery retains its original receipt across retries and restart without another sendable item',()=>{
 const f=setup();try{
  const written=[write(f,'one.md'),write(f,'two.md')];complete(f,f.actor);const files=written.map(file=>adopt(f,file)),ids=files.map(file=>file.resultId);
  const delivery=publish(f,ids);f.tasks.markDelivery(delivery.deliveryId,'submitting');f.tasks.markDelivery(delivery.deliveryId,'uncertain');
  assert.equal(publish(f,ids).deliveryId,delivery.deliveryId);assert.equal(f.tasks.delivery(delivery.deliveryId).state,'uncertain');
  assert.throws(()=>f.tasks.publish(main,{operationId:'retry-as-new',taskId:f.task.taskId,version:1,resultIds:ids,text:'Do not send twice'}),/delivery_already_prepared/);
  const store=new Store(join(f.dir,'homer.sqlite'));try{const tasks=new RecursiveTasks(store,f.files);tasks.migrate();tasks.reconcile();assert.equal(tasks.delivery(delivery.deliveryId).state,'uncertain');assert.deepEqual(tasks.pendingDeliveries(),[]);assert.equal(tasks.deliveries().length,1);assert.equal(tasks.publishedArtifacts(f.actor.runId!).length,2);}finally{store.close();}
 }finally{f.close();}
});

test('different operations cannot claim the same staged filename, identical bytes included; retry stays idempotent',()=>{
 const f=setup();try{const a=write(f,'same.md','first','original');
  for(const content of['first','changed'])assert.throws(()=>write(f,'same.md',content,'another-'+content),/artifact_filename_conflict/);
  assert.equal(f.files.verify(f.files.prepareRun(f.task.taskId,f.actor.runId!),a.path).content,'first');
  assert.throws(()=>write(f,'same.md','changed','original'),/operation_payload_conflict/);
  assert.deepEqual(f.tasks.readTask(main,f.task.taskId).results,[]);
 }finally{f.close();}
});

test('mixed workspace, binary and Markdown adoption keeps exact bytes and unselected accepted files remain private',async()=>{
 const f=setup();try{
  const dir=f.files.prepareRun(f.task.taskId,f.actor.runId!),bytes=Buffer.from([0,255,3,4,8]),source=join(dir,'generated.bin');
  writeFileSync(source,bytes);
  const binary=f.tasks.writeFile(f.actor,{operationId:'binary',filename:'second.bin',bytes:Buffer.from([255,0,22])}),notes=write(f,'notes.md');
  complete(f,f.actor);
  const a=adopt(f,{path:source}),b=adopt(f,binary),c=adopt(f,notes);publish(f,[a.resultId,c.resultId]);
  assert.deepEqual(Buffer.from((await f.bridge.artifact(a.resultId)).data!,'base64'),bytes);await assert.rejects(()=>f.bridge.artifact(b.resultId),/artifact_not_authorized/);
  writeFileSync(a.path,'tampered');await assert.rejects(()=>f.bridge.artifact(a.resultId),/result_hash_mismatch/);
 }finally{f.close();}
});

test('exact task, version, paths and hashes fence adoption and obsolete writers',()=>{
 const f=setup();try{
  const a=write(f,'a.md'),b=write(f,'b.md');
  const other=f.tasks.createTask(main,{operationId:'other',goal:'Other authorized task',authority:authority()}),opened=openWorker(f,'other-worker',other.taskId),actor=running(f,opened.runId);
  const foreign=f.tasks.writeMarkdown(actor,{operationId:'foreign',filename:'foreign.md',content:'other task'});
  for(const filename of['../bad.md','/bad.md'])assert.throws(()=>write(f,filename),/artifact_path_denied/);
  const dir=f.files.prepareRun(f.task.taskId,f.actor.runId!);symlinkSync('/etc/hosts',join(dir,'link.md'));assert.throws(()=>write(f,'link.md'),/symlink_denied/);
  complete(f,f.actor);
  assert.throws(()=>f.tasks.adoptResult(main,{operationId:'foreign-adopt',taskId:f.task.taskId,version:1,runId:actor.runId,filePath:foreign.path}),/result_source_denied/);
  const acceptedA=adopt(f,a),acceptedB=adopt(f,b);assert.notEqual(acceptedA.resultId,acceptedB.resultId);
  writeFileSync(acceptedB.path,'tampered');assert.throws(()=>f.tasks.readResult(main,acceptedB.resultId),/result_hash_mismatch/);
  assert.throws(()=>write(f,'late.md'),/run_not_live/);
 }finally{f.close();}
});

test('ordinary text and structured-looking replies preserve staged files without implicit Result or task settlement',()=>{
 for(const text of ['Synthetic files checked',JSON.stringify({summary:'synthetic'})]){const f=setup();try{
  const a=write(f,'a.md'),b=write(f,'b.md');complete(f,f.actor,text);
  const read=f.tasks.workerRead(main,{workerId:f.opened.workerId});assert.equal(read.messages.at(-1)?.text,text);
  assert.deepEqual(f.tasks.readTask(main,f.task.taskId).results,[]);assert.equal(f.tasks.task(f.task.taskId).outcome,null);
  for(const [file,content] of [[a,'# a.md'],[b,'# b.md']] as const)assert.equal(f.files.verify(f.files.prepareRun(f.task.taskId,f.actor.runId!),file.path).content,content);
 }finally{f.close();}}
});

test('Main explicitly settles partial and failed tasks while retained adopted files keep their accepted state',()=>{
 for(const outcome of['partial','failed'] as const){const f=setup();try{
  const written=[write(f,'a.md'),write(f,'b.md')];complete(f,f.actor);const files=written.map(file=>adopt(f,file));
  const input={...mutation(f,'settle'),outcome,notes:'Synthetic optional part missing'},settled=f.tasks.settleTask(main,input);
  assert.equal(f.tasks.task(f.task.taskId).outcome,outcome);assert.equal(f.tasks.task(f.task.taskId).state,'settled');
  const retained=f.tasks.readTask(main,f.task.taskId).results;assert.deepEqual(retained.map(result=>result.id),files.map(file=>file.resultId));assert.deepEqual(retained.map(result=>result.state),['accepted','accepted']);
  assert.deepEqual(f.tasks.settleTask(main,input),settled);
 }finally{f.close();}}
});

test('HTTP exposes only explicitly published IDs, checks publication/source and revokes all selected links',async()=>{
 const {createWebServer,fetch}=await import('./web-connected-fixture.js');const f=setup();let web:Awaited<ReturnType<typeof createWebServer>>|undefined;
 try{
  const written=[write(f,'a.md'),write(f,'b.md'),write(f,'hidden.md')];complete(f,f.actor);const [a,b,hidden]=written.map(file=>adopt(f,file));
  assert.equal(f.tasks.publishedResult(hidden!.resultId),undefined,'accepted files remain private before explicit publication');
  assert.throws(()=>publish(f,[a!.resultId,a!.resultId]),/delivery_result_required/);
  writeFileSync(b!.path,'tampered before publication');assert.throws(()=>publish(f,[a!.resultId,b!.resultId]),/result_hash_mismatch/);assert.equal(f.tasks.deliveries().length,0);writeFileSync(b!.path,'# b.md');
  const delivery=publish(f,[a!.resultId,b!.resultId]);
  assert.equal(f.tasks.publishedResult(a!.resultId,{sourceRequestId:'another-user-source'}),undefined);
  web=await createWebServer({bridge:f.bridge,port:0});
  assert.equal((await globalThis.fetch(web.url+'/api/files/'+a!.resultId)).status,200);
  for(const file of[a!,b!]){const response:Response=await fetch(web.url+'/api/files/'+file.resultId);assert.equal(response.status,200);assert.equal(await response.text(),file===a?'# a.md':'# b.md');}
  for(const suffix of[hidden!.resultId,'result-unrelated'])assert.equal((await fetch(web.url+'/api/files/'+suffix)).status,409);
  for(const suffix of[a!.resultId+'?path=/etc/hosts',a!.resultId+'?resultId='+hidden!.resultId])assert.equal((await fetch(web.url+'/api/files/'+suffix)).status,400);
  assert.equal((await fetch(web.url+'/api/files/'+a!.resultId+'%2F..%2Fhidden.md')).status,404);
  f.tasks.markDelivery(delivery.deliveryId,'revoked');for(const file of[a!,b!])assert.equal((await fetch(web.url+'/api/files/'+file.resultId)).status,409);
 }finally{await web?.close();f.close();}
});

test('requirements replacement fences old writers and new adoption refers to its exact Run and version',()=>{
 const f=setup();try{
  const a=write(f,'old.md'),b=write(f,'old-two.md');
  const update=f.tasks.updateTask(main,{...mutation(f,'replace'),patch:{goal:'Prepare replacement files'},authority:authority()});
  assert.equal(f.tasks.confirmWorkerExit(f.actor.runId!,undefined),true);
  f.tasks.confirmStop(update.operationKey,true);
  const next=f.tasks.workerSend(main,{operationId:'continue',workerId:f.opened.workerId,text:'Prepare replacement files'}),replacement=running(f,next.runId!);
  const current=f.tasks.writeMarkdown(replacement,{operationId:'current',filename:'current.md',content:'new attempt'});complete(f,replacement);
  const adopted=f.tasks.adoptResult(main,{operationId:'adopt-current',taskId:f.task.taskId,version:2,runId:replacement.runId,filePath:current.path});
  assert.equal(f.tasks.readResult(main,adopted.resultId).file!.content,'new attempt');
  for(const file of[a,b])assert.throws(()=>f.tasks.adoptResult(main,{operationId:'wrong-version-'+file.path,taskId:f.task.taskId,version:2,runId:f.actor.runId,filePath:file.path}),/result_source_denied/);
  assert.throws(()=>write(f,'late.md'),/run_epoch_stale|run_stop_requested/);
 }finally{f.close();}
});

test('publication rejects foreign task and stale version results; text-only formal adoption has no file links',()=>{
 const f=setup();try{
  const a=write(f,'a.md'),b=write(f,'b.md');complete(f,f.actor);const files=[adopt(f,a),adopt(f,b)];
  const other=f.tasks.createTask(main,{operationId:'other-task',goal:'Separate text reply',authority:authority()});
  assert.throws(()=>f.tasks.publish(main,{operationId:'wrong-task',taskId:other.taskId,version:1,resultIds:files.map(file=>file.resultId),text:'wrong task'}),/delivery_result_not_accepted/);
  f.tasks.updateTask(main,{...mutation(f,'version'),patch:{goal:'New requirement'},authority:authority()});
  assert.throws(()=>publish(f,files.map(file=>file.resultId)),/delivery_version_conflict/);
  assert.throws(()=>f.tasks.publish(main,{operationId:'stale-files',taskId:f.task.taskId,version:2,resultIds:files.map(file=>file.resultId),text:'old files'}),/delivery_result_not_accepted/);
  const opened=openWorker(f,'text-worker',other.taskId),actor=running(f,opened.runId);complete(f,actor,'Pure text');
  const message=f.tasks.workerRead(main,{workerId:opened.workerId}).messages.find(message=>message.kind==='worker_reply')!;
  const adopted=f.tasks.adoptResult(main,{operationId:'adopt-text',taskId:other.taskId,version:1,messageId:message.id});
  const delivery=f.tasks.publish(main,{operationId:'text-publish',taskId:other.taskId,version:1,resultIds:[adopted.resultId],text:'text only'});assert.deepEqual(f.tasks.delivery(delivery.deliveryId).publishedFileResultIds,[]);
 }finally{f.close();}
});

test('download bytes cannot change between verification and the byte read without failing',()=>{
 const f=setup();try{const a=write(f,'race.md','original');const verify=f.files.verify.bind(f.files);
  f.files.verify=(dir,path)=>{const result=verify(dir,path);writeFileSync(path,'replacement bytes');return result;};
  assert.throws(()=>f.files.resultBytes(f.files.prepareRun(f.task.taskId,f.actor.runId!),a.path),/artifact_changed/);
 }finally{f.close();}
});
