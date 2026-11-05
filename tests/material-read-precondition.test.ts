// Real local files, media records and protocol dispatchers only; no engine or account.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync,readFileSync,unlinkSync,symlinkSync,linkSync} from 'node:fs';
import {join} from 'node:path';
import {Homer} from '../src/service.js';
import {WorkerProgressStore} from '../src/worker-progress.js';
import {MediaStore} from '../src/media-store.js';
import {chatFixture} from './task-chat-fixture.js';
function setup(kinds:('material'|'result'|'attachment')[]=[]){
 const f=chatFixture(),media=new MediaStore(f.store.db,join(f.dir,'media'));
 const ref=media.intent('source:test','synthetic-binding','file','source.txt');media.ready(ref,media.claim(ref)!,Buffer.from('Synthetic attachment'),'text/plain');
 writeFileSync(join(f.files.materials,'sample.md'),'# Synthetic material');let resultId:string|undefined;
 if(kinds.includes('result')){
  const producer=f.create('Read source','producer'),worker=f.tasks.workerOpen(f.actor,{operationId:'producer-worker',taskId:producer.taskId,text:'Read'}),run=f.start(worker.workerId),reply=f.tasks.endSegment(run.id,run.epoch,{status:'completed',text:'Synthetic accepted original'},true)!;
  resultId=f.tasks.adoptResult(f.actor,{operationId:'accept',taskId:producer.taskId,version:1,messageId:reply.messageId}).resultId;
 }
 const authority={...f.authority,materials:kinds.includes('material')?['sample.md']:[],resultIds:resultId?[resultId]:[],attachments:kinds.includes('attachment')?[ref.assetId+'@'+ref.revision]:[]};
 const task=f.tasks.createTask(f.actor,{operationId:'read-task',goal:'Inspect only the selected sources',authority}),worker=f.tasks.workerOpen(f.actor,{operationId:'open',taskId:task.taskId,text:'Inspect the selected sources',resultIds:authority.resultIds}),run=f.start(worker.workerId);
 const actor={agentId:'worker:'+worker.workerId,runId:run.id,epoch:run.epoch,threadId:run.threadId!,turnId:run.turnId!},host:any=Object.create(Homer.prototype);
 Object.assign(host,{tasks:f.tasks,files:f.files,store:f.store,media,workerProgress:new WorkerProgressStore(),closing:false,accountClocks(){},workerActor:()=>actor,invalidateState(){}});
 const slot={id:run.id,epoch:run.epoch},call=(tool:string,args:unknown={},callId=tool)=>host.workerTool(slot,{tool,arguments:args,callId,threadId:actor.threadId,turnId:actor.turnId});
 const read=()=>call('read_material'),write=(operationId='write')=>f.tasks.writeMarkdown(actor,{operationId,filename:'report.md',content:'# Synthetic report'}),events=()=>Number(f.store.db.prepare("SELECT count(*) n FROM events WHERE runId=? AND type='material_read'").get(run.id)!.n);
 return {f,media,ref,resultId,task,worker,run,actor,host,slot,call,read,write,events};
}

test('authorized files need no fabricated read checkpoint and never create a formal Result',()=>{
 const s=setup();try{
  const written=s.write();assert.equal(written.state,'written');assert.equal(readFileSync(written.path,'utf8'),'# Synthetic report');assert.deepEqual(s.write(),written);assert.equal(s.events(),0);
  assert.equal(JSON.parse(s.f.tasks.run(s.run.id).checkpointJson??'{}').materialRead,undefined);assert.equal(s.f.tasks.readTask(s.f.actor,s.task.taskId).results.length,0);
  assert.throws(()=>s.f.tasks.writeMarkdown(s.actor,{operationId:'write',filename:'report.md',content:'Changed'}),/payload_conflict/);
 }finally{s.f.close();}
});

test('empty read_material reports empty actual inputs without a synthetic read gate',async()=>{
 const s=setup();try{assert.deepEqual(await s.read(),{materials:[],results:[],attachments:[]});assert.equal(s.events(),1);assert.equal(s.write().state,'written');}finally{s.f.close();}
});

for(const kind of ['material','result','attachment'] as const)test(kind+' reads the precise authorized source and does not gate unrelated authorized writing',async()=>{
 const s=setup([kind]);try{
  assert.equal(s.write().state,'written');const read=await s.read();
  if(kind==='material')assert.deepEqual(read.materials,[{path:'sample.md',content:'# Synthetic material'}]);
  if(kind==='result'){assert.equal(read.results.length,1);assert.equal(read.results[0].id,s.resultId);assert.equal(read.results[0].payload.text,'Synthetic accepted original');}
  if(kind==='attachment'){assert.equal(read.attachments[0].assetId,s.ref.assetId);assert.deepEqual(read.attachments[0].reference,{type:'attachment',id:s.ref.assetId+'@1'});}
  assert.equal(s.events(),1);assert.equal(s.f.tasks.readTask(s.f.actor,s.task.taskId).results.length,0);
 }finally{s.f.close();}
});

test('partial read failure records no successful read and can retry after repairing the actual file',async()=>{
 const s=setup(['material','result','attachment']);try{
  unlinkSync(join(s.f.dir,'media',s.ref.assetId));await assert.rejects(s.read,/ENOENT/);assert.equal(s.events(),0);assert.equal(s.write().state,'written');
  writeFileSync(join(s.f.dir,'media',s.ref.assetId),'Synthetic attachment');assert.equal((await s.read()).attachments.length,1);assert.equal(s.events(),1);
 }finally{s.f.close();}
});

for(const kind of [undefined,'attachment'] as const)test('binary file creation uses actual bytes and an explicit later adoption: '+(kind??'base64'),async()=>{
 const s=setup(kind?[kind]:[]);try{
  const bytes=Buffer.from('%PDF-1.4\nSynthetic'),args=kind?{filename:'report.pdf',assetId:s.ref.assetId,revision:1}:{filename:'report.pdf',dataBase64:bytes.toString('base64')};
  const written=await s.call('stage_file_result',args,'stage');assert.deepEqual(readFileSync(written.path),kind?Buffer.from('Synthetic attachment'):bytes);assert.deepEqual(await s.call('stage_file_result',args,'stage'),written);
  assert.equal(s.f.tasks.readTask(s.f.actor,s.task.taskId).results.length,0);assert.equal(s.events(),0);
  const result=s.f.tasks.adoptResult(s.f.actor,{operationId:'accept-file',taskId:s.task.taskId,version:1,runId:s.run.id,filePath:written.path});assert.equal(s.f.tasks.readResult(s.f.actor,result.resultId).file!.path.includes('adopted-'),true);
 }finally{s.f.close();}
});

for(const failure of ['missing-material','wrong-source','wrong-revision','missing-result'] as const)test('read failure preserves authorization and execution records: '+failure,async()=>{
 const s=setup(failure==='missing-material'?['material']:failure==='missing-result'?['result']:['attachment']);try{
  if(failure==='missing-material')unlinkSync(join(s.f.files.materials,'sample.md'));
  else if(failure==='wrong-source')s.f.store.db.prepare('UPDATE media_assets SET requestId=? WHERE id=?').run('other-source',s.ref.assetId);
  else if(failure==='wrong-revision')s.f.store.db.prepare('UPDATE media_assets SET revision=2 WHERE id=?').run(s.ref.assetId);
  else s.f.store.db.prepare('DELETE FROM results WHERE id=?').run(s.resultId!);
  const before=s.f.tasks.task(s.task.taskId);await assert.rejects(s.read,failure==='wrong-source'?/media_scope_denied/:failure==='wrong-revision'?/media_asset_not_found/:failure==='missing-result'?/result_not_found/:/material_missing/);
  assert.equal(s.events(),0);assert.deepEqual(s.f.tasks.task(s.task.taskId),before);assert.equal(s.f.tasks.run(s.run.id).status,'running');
 }finally{s.f.close();}
});

test('file adoption cannot follow outside paths, symlinks or hard links',()=>{
 const s=setup();try{
  const outside=join(s.f.dir,'outside.pdf');writeFileSync(outside,'%PDF-1.4');const adopt=(path:string)=>s.f.tasks.adoptResult(s.f.actor,{operationId:'adopt-'+path,taskId:s.task.taskId,version:1,runId:s.run.id,filePath:path});
  assert.throws(()=>adopt(outside),/path_denied/);const linked=join(s.f.files.workspace,'linked.pdf');symlinkSync(outside,linked);assert.throws(()=>adopt(linked),/path_denied/);
  const hard=join(s.f.files.workspace,'hard.pdf');linkSync(outside,hard);assert.throws(()=>adopt(hard),/file_type_or_size_denied/);assert.equal(readFileSync(outside,'utf8'),'%PDF-1.4');assert.equal(s.f.tasks.readTask(s.f.actor,s.task.taskId).results.length,0);
 }finally{s.f.close();}
});

test('changed goal or epoch cannot write using a previous version or a fabricated read receipt',()=>{
 const s=setup(['material']);try{
  assert.throws(()=>s.f.tasks.writeMarkdown({...s.actor,epoch:s.actor.epoch+1},{operationId:'stale',filename:'stale.md',content:'Unauthorized'}),/epoch_stale/);
  const change=s.f.tasks.updateTask(s.f.actor,{operationId:'change',taskId:s.task.taskId,expectedRevision:1,patch:{goal:'Stop earlier work'},authority:s.f.authority});assert.equal(change.state,'requested');assert.equal(s.f.tasks.run(s.run.id).version,1);
  assert.throws(()=>s.write('old-version'),/epoch_stale|stop_requested/);assert.equal(s.f.tasks.task(s.task.taskId).headVersion,2);
 }finally{s.f.close();}
});

test('malformed attachment references and revoked media cannot be read under retained task receipts',async()=>{
 const s=setup(['attachment']);try{
  const before=s.f.tasks.task(s.task.taskId);s.media.revoke('source:test');await assert.rejects(s.read,/media_scope_denied/);assert.deepEqual(s.f.tasks.task(s.task.taskId),before);assert.equal(s.events(),0);
  const authority={...s.f.tasks.authority(s.task.taskId,1),attachments:[s.ref.assetId+'@1e0']};s.f.store.db.prepare('UPDATE task_versions SET authorityJson=? WHERE taskId=?').run(JSON.stringify(authority),s.task.taskId);
  await assert.rejects(s.read,/task_attachment_reference_invalid/);assert.equal(s.events(),0);assert.equal(s.f.tasks.run(s.run.id).status,'running');
 }finally{s.f.close();}
});
