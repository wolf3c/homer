import {test} from 'node:test';import assert from 'node:assert/strict';
import {fixture,delegate,running,main,accept} from './recursive-fixture.js';
import {writeFileSync} from 'node:fs';
test('ILINK-SEND-001 binary candidate preserves exact bytes, cannot bypass publication and rechecks hash',()=>{
 const f=fixture();try{
  const child=delegate(f,'binary',undefined,undefined,'file'),actor=running(f,child.taskId);f.tasks.markMaterialRead(actor);
  const bytes=Buffer.from('%PDF-1.4\nsynthetic-data'),staged=f.tasks.writeFile(actor,{operationId:'binary-write',filename:'report.pdf',bytes});
  const stagedFile=f.files.resultBytes(f.files.prepareRun(f.tasks.run(actor.runId!).matterId,actor.runId!),staged.path);assert.deepEqual(stagedFile.data,bytes);
  assert.equal(f.tasks.publishedArtifact(actor.runId!),undefined);
  const t=f.tasks.task(child.taskId);const result=f.tasks.endSegment(actor.runId!,actor.epoch!,{status:'completed',text:'Synthetic final result'},true)!;
  f.tasks.endSegment(actor.runId!,actor.epoch!,{status:'completed',text:'Synthetic final result'},true);accept(f,child.taskId,result.resultId!);assert.equal(f.tasks.publishedArtifact(actor.runId!),undefined);
  const root=f.tasks.task(f.root.taskId),final=({operationId:'root-seal',taskId:root.id,version:1,expectedTaskRevision:root.revision,outcome:'succeeded',evidence:{facts:true},children:[{childTaskId:t.id,childVersion:1,disposition:'included',resultId:result.resultId,reason:'included'}],resultId:null,text:JSON.stringify({summary:'synthetic'}),publishedFileResultId:null} satisfies Parameters<typeof f.tasks.publish>[1]);
  f.tasks.publish(main,{...final,operationId:'publication',taskId:root.id,version:1,expectedTaskRevision:f.tasks.task(root.id).revision,resultId:final.resultId,publishedFileResultId:result.resultId,text:'合成正式成果'});
  assert.equal(f.tasks.publishedArtifact(actor.runId!)!.sha256,stagedFile.sha256);
  assert.throws(()=>f.tasks.writeFile(actor,{operationId:'late',filename:'changed.pdf',bytes}),/run_not_live/);
  writeFileSync(staged.path,Buffer.from('%PDF-1.4\nchanged'));assert.throws(()=>f.tasks.publishedArtifact(actor.runId!),/result_hash_mismatch/);
 }finally{f.close();}
});
