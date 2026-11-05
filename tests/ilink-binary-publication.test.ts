import {test} from 'node:test';import assert from 'node:assert/strict';
import {fixture,openWorker,running,main,complete} from './recursive-fixture.js';
import {writeFileSync} from 'node:fs';
test('ILINK-SEND-001 binary adoption preserves exact bytes, cannot bypass publication and rechecks hash',()=>{
 const f=fixture();try{
  const opened=openWorker(f,'binary'),actor=running(f,opened.runId);
  const bytes=Buffer.from('%PDF-1.4\nsynthetic-data'),written=f.tasks.writeFile(actor,{operationId:'binary-write',filename:'report.pdf',bytes});
  const dir=f.files.prepareRun(f.task.taskId,actor.runId!);assert.deepEqual(f.files.resultBytes(dir,written.path).data,bytes);
  assert.equal(f.tasks.publishedArtifact(actor.runId!),undefined);
  complete(f,actor);assert.deepEqual(f.tasks.readTask(main,f.task.taskId).results,[],'ordinary return never adopts a file');
  const accepted=f.tasks.adoptResult(main,{operationId:'adopt-binary',taskId:f.task.taskId,version:1,runId:actor.runId,filePath:written.path});
  const file=f.tasks.readResult(main,accepted.resultId).file!;
  assert.deepEqual(f.files.resultBytes(dir,file.path).data,bytes);assert.equal(f.tasks.publishedArtifact(actor.runId!),undefined);
  f.tasks.publish(main,{operationId:'publication',taskId:f.task.taskId,version:1,resultIds:[accepted.resultId],text:'合成正式成果'});
  assert.equal(f.tasks.publishedArtifact(actor.runId!)!.sha256,file.sha256);
  assert.throws(()=>f.tasks.writeFile(actor,{operationId:'late',filename:'changed.pdf',bytes}),/run_not_live/);
  writeFileSync(file.path,Buffer.from('%PDF-1.4\nchanged'));assert.throws(()=>f.tasks.publishedArtifact(actor.runId!),/result_hash_mismatch/);
 }finally{f.close();}
});
