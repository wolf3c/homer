import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync,readFileSync,symlinkSync,linkSync} from 'node:fs';
import {join} from 'node:path';
import type {Homer} from '../src/service.js';
import {syntheticFile} from './recursive-publication-fixture.js';
import {fixture,main,openWorker,running,complete} from './recursive-fixture.js';

test('an existing workspace file stays ordinary until Main explicitly adopts and publishes its exact bytes',()=>{
 const f=fixture();try{
  const worker=openWorker(f),actor=running(f,worker.runId),filePath=join(f.files.workspace,'report.md'),bytes=Buffer.from('# Synthetic report\nUnknown date.\n');writeFileSync(filePath,bytes);complete(f,actor,'Report written.');
  assert.equal(f.tasks.readTask(main,f.task.taskId).results.length,0);assert.equal(f.tasks.publishedArtifact(worker.runId),undefined);
  const args={operationId:'adopt',taskId:f.task.taskId,version:1,runId:worker.runId,filePath},adopted=f.tasks.adoptResult(main,args),read=f.tasks.readResult(main,adopted.resultId);
  assert.deepEqual(f.tasks.adoptResult(main,args),adopted);assert.notEqual(read.file!.path,filePath);assert.deepEqual(readFileSync(read.file!.path),bytes);
  assert.deepEqual(read.payload.workspaceSource,{path:filePath,sha256:read.file!.sha256});assert.equal(f.tasks.publishedArtifact(worker.runId),undefined);
  const delivery=f.tasks.publish(main,{operationId:'publish',taskId:f.task.taskId,version:1,resultIds:[adopted.resultId],text:'Synthetic report'}),published=f.tasks.publishedArtifact(worker.runId)!;
  assert.equal(published.deliveryId,delivery.deliveryId);assert.deepEqual(readFileSync(published.path),bytes);assert.equal(f.tasks.publishedArtifact(worker.runId,{sourceRequestId:'unrelated'}),undefined);
  writeFileSync(filePath,'# Source changed later');assert.deepEqual(readFileSync(f.tasks.publishedArtifact(worker.runId)!.path),bytes);
  f.tasks.markDelivery(delivery.deliveryId,'revoked');assert.equal(f.tasks.publishedArtifact(worker.runId),undefined);
 }finally{f.close();}
});

test('large binary files are adopted exactly and changed sealed bytes revoke read/download eligibility',()=>{
 const f=fixture();try{
  const worker=openWorker(f),actor=running(f,worker.runId),bytes=Buffer.concat([Buffer.from('%PDF-1.4\n'),Buffer.alloc(180000,32)]),filePath=join(f.files.workspace,'report.pdf');writeFileSync(filePath,bytes);complete(f,actor);
  const result=f.tasks.adoptResult(main,{operationId:'adopt',taskId:f.task.taskId,version:1,runId:worker.runId,filePath});
  f.tasks.publish(main,{operationId:'publish',taskId:f.task.taskId,version:1,resultIds:[result.resultId],text:'Synthetic PDF'});
  const published=f.tasks.publishedResult(result.resultId)!;assert.deepEqual(readFileSync(published.path),bytes);assert.equal(published.bytes,bytes.length);
  writeFileSync(published.path,'Changed sealed bytes');assert.throws(()=>f.tasks.readResult(main,result.resultId),/result_hash_mismatch/);assert.throws(()=>f.tasks.publishedArtifact(worker.runId),/result_hash_mismatch/);
 }finally{f.close();}
});

test('file adoption refuses missing, outside, relative, linked and empty paths without inserting a Result',()=>{
 const f=fixture();try{
  const worker=openWorker(f),actor=running(f,worker.runId);complete(f,actor);
  const outside=join(f.dir,'outside.md'),own=join(f.files.workspace,'own.md'),link=join(f.files.workspace,'linked.md'),hard=join(f.files.workspace,'hard.md'),empty=join(f.files.workspace,'empty.md');
  writeFileSync(outside,'Outside');writeFileSync(own,'Local');symlinkSync(own,link);linkSync(own,hard);writeFileSync(empty,'');
  for(const filePath of [join(f.files.workspace,'missing.md'),outside,'own.md',link,hard,empty]){
   assert.throws(()=>f.tasks.adoptResult(main,{operationId:'deny:'+filePath,taskId:f.task.taskId,version:1,runId:worker.runId,filePath}),/ENOENT|artifact_path_denied|file_type_or_size_denied/);
   assert.equal(f.tasks.readTask(main,f.task.taskId).results.length,0);
  }
 }finally{f.close();}
});

test('file adoption cannot cross the exact task/run/version and replay cannot switch source files',()=>{
 const f=fixture();try{
  const a=openWorker(f,'a'),actor=running(f,a.runId),filePath=join(f.files.workspace,'a.md');writeFileSync(filePath,'Synthetic');complete(f,actor);
  const input={operationId:'adopt',taskId:f.task.taskId,version:1,runId:a.runId,filePath},r=f.tasks.adoptResult(main,input);
  assert.throws(()=>f.tasks.adoptResult(main,{...input,filePath:join(f.files.workspace,'b.md')}),/operation_payload_conflict/);
  assert.throws(()=>f.tasks.adoptResult(main,{...input,operationId:'wrong-version',version:2}),/version_not_found|source_denied/);
  assert.equal(f.tasks.readTask(main,f.task.taskId).results.length,1);assert.equal(f.tasks.readResult(main,r.resultId).file!.content,'Synthetic');
 }finally{f.close();}
});


test('shared publication fixture adopts multiple exact files through current APIs and publishes only on request',()=>{
 const f=fixture();try{
  const app={store:f.store,tasks:f.tasks,files:f.files} as Homer;
  const files=syntheticFile(app,'user-synthetic','plan.md','# Plan',[{filename:'draft.md',content:'# Draft'}]);
  assert.equal(files.resultIds.length,2);assert.equal(f.tasks.deliveries().length,0);assert.equal(f.tasks.task(files.run.taskId).state,'open');
  const delivery=files.publish('Synthetic plan and draft');assert.equal(delivery.state,'submitting');
  assert.deepEqual(new Set(f.tasks.publishedArtifacts(files.run.id).map(file=>file.content)),new Set(['# Plan','# Draft']));
  const bytes=Buffer.from('%PDF-1.4\nSynthetic binary');
  const binary=syntheticFile(app,'user-synthetic','binary.pdf',bytes,[],true);binary.publish();
  const published=f.tasks.publishedResult(binary.resultId)!;assert.deepEqual(readFileSync(published.path),bytes);
 }finally{f.close();}
});
