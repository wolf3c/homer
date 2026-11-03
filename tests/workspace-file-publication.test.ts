import{test}from'node:test';import assert from'node:assert/strict';import{writeFileSync,symlinkSync}from'node:fs';import{join}from'node:path';import{Homer}from'../src/service.js';import{homerWebBridge}from'../src/web-homer.js';import{fixture,contract,delegate,running,main,accept}from'./recursive-fixture.js';
function setup(emptyInputs=false,kind:'file'|'markdown'='file'){const f=fixture(),child=emptyInputs?f.tasks.delegate(main,{operationId:'workspace-empty',taskId:f.root.taskId,version:1,expectedTaskRevision:f.tasks.task(f.root.taskId).revision,contract:{...contract(kind),inputs:[]},dependencies:[]}):delegate(f,'workspace',undefined,undefined,kind),actor=running(f,child.taskId);const run=f.tasks.run(actor.runId!),dir=f.files.prepareRun(run.matterId,run.id);const host=Object.create(Homer.prototype) as any;Object.assign(host,{tasks:f.tasks,files:f.files,store:f.store,memory:{validateRun(){}},workerActor:()=>actor,closing:false,registerChannelCapabilities(){}});const stage=(path:string,filename='report.pdf')=>host.workerMediaTool({id:run.id,epoch:run.epoch},'stage_workspace_file',{operationId:'workspace-stage',path,filename});return{f,child,actor,run,dir,host,stage};}
test('an existing Markdown report requires staging before it can be accepted and published',async()=>{
 const missing=setup(false,'markdown');try{
  missing.f.tasks.markMaterialRead(missing.actor);writeFileSync(join(missing.dir,'report.md'),'# Synthetic report');
  const returned=missing.f.tasks.endSegment(missing.run.id,missing.actor.epoch!,{status:'completed',text:'Report written'},true)!;
  assert.throws(()=>accept(missing.f,missing.child.taskId,returned.resultId),/artifact_missing/);
  assert.equal(missing.f.tasks.task(missing.child.taskId).state,'reviewing');
  assert.equal(missing.f.tasks.publishedArtifact(missing.run.id),undefined);
 }finally{missing.f.close();}
 const staged=setup(false,'markdown');try{
  staged.f.tasks.markMaterialRead(staged.actor);const bytes=Buffer.from('# Synthetic report');writeFileSync(join(staged.dir,'report.md'),bytes);
  const file=await staged.stage('report.md','report.md');
  const returned=staged.f.tasks.endSegment(staged.run.id,staged.actor.epoch!,{status:'completed',text:'Report staged'},true)!;
  assert.equal(returned.resultId,file.resultId);accept(staged.f,staged.child.taskId,returned.resultId);
  const root=staged.f.tasks.task(staged.f.root.taskId);
  staged.f.tasks.publish(main,{operationId:'publish-markdown',taskId:root.id,version:1,expectedTaskRevision:root.revision,outcome:'succeeded',evidence:{facts:true},children:[{childTaskId:staged.child.taskId,childVersion:1,disposition:'included',resultId:file.resultId,reason:'Synthetic file inspected'}],resultId:null,text:'已验收合成报告。',publishedFileResultId:file.resultId});
  const download=await homerWebBridge(staged.host).artifact(staged.run.id);assert.deepEqual(Buffer.from(download.data!,'base64'),bytes);
 }finally{staged.f.close();}
});
test('workspace staging records the checked source beside its distinct publication copy and replays exactly',async()=>{
 const s=setup();try{
  s.f.tasks.markMaterialRead(s.actor);
  const original=join(s.dir,'original.pdf');writeFileSync(original,'%PDF-1.4\nSynthetic original');
  const staged=await s.stage('original.pdf','published.pdf');
  assert.notEqual(staged.path,original);
  const payload=JSON.parse(s.f.store.db.prepare('SELECT payloadJson FROM results WHERE id=?').get(staged.resultId)!.payloadJson as string);
  assert.deepEqual(payload.workspaceSource,{path:original,sha256:s.f.files.resultBytes(s.dir,original).sha256});
  assert.equal((await s.stage('original.pdf','published.pdf')).resultId,staged.resultId);
  writeFileSync(join(s.dir,'same-bytes.pdf'),s.f.files.resultBytes(s.dir,original).data);
  assert.equal((await s.stage('same-bytes.pdf','published.pdf')).resultId,staged.resultId);
  assert.deepEqual(JSON.parse(s.f.store.db.prepare('SELECT payloadJson FROM results WHERE id=?').get(staged.resultId)!.payloadJson as string),payload);
  assert.deepEqual(s.f.files.resultBytes(s.dir,staged.path).data,s.f.files.resultBytes(s.dir,original).data);
 }finally{s.f.close();}
});
test('a pre-provenance staging retry keeps its original receipt without fabricating a source',async()=>{
 const s=setup();try{
  s.f.tasks.markMaterialRead(s.actor);
  const bytes=Buffer.from('%PDF-1.4\nSynthetic legacy');writeFileSync(join(s.dir,'legacy-source.pdf'),bytes);
  const old=s.f.tasks.writeFile(s.actor,{operationId:'workspace-stage',filename:'report.pdf',bytes});
  assert.equal((await s.stage('legacy-source.pdf')).resultId,old.resultId);
  assert.deepEqual(JSON.parse(s.f.store.db.prepare('SELECT payloadJson FROM results WHERE id=?').get(old.resultId)!.payloadJson as string),{});
 }finally{s.f.close();}
});
test('large workspace files without input materials use exact-byte acceptance, publication and download',async()=>{const s=setup(true);try{const bytes=Buffer.concat([Buffer.from('%PDF-1.4\n'),Buffer.alloc(180000,32)]);writeFileSync(join(s.dir,'report.pdf'),bytes);const staged=await s.stage('report.pdf');assert.equal(s.f.tasks.publishedArtifact(s.run.id),undefined);const bridge=homerWebBridge(s.host);await assert.rejects(()=>bridge.artifact(s.run.id),/artifact_not_authorized/);const t=s.f.tasks.task(s.child.taskId);const result=s.f.tasks.endSegment(s.actor.runId!,s.actor.epoch!,{status:'completed',text:'Synthetic final result'},true)!;s.f.tasks.endSegment(s.run.id,s.actor.epoch!,{status:'completed',text:'Synthetic final result'},true);accept(s.f,s.child.taskId,result.resultId!);await assert.rejects(()=>bridge.artifact(s.run.id),/artifact_not_authorized/);const root=s.f.tasks.task(s.f.root.taskId);const final=({operationId:'root-seal',taskId:root.id,version:1,expectedTaskRevision:root.revision,outcome:'succeeded',evidence:{facts:true},children:[{childTaskId:t.id,childVersion:1,disposition:'included',resultId:result.resultId,reason:'inspected'}],resultId:null,text:JSON.stringify({summary:'synthetic'}),publishedFileResultId:null} satisfies Parameters<typeof s.f.tasks.publish>[1]);s.f.tasks.publish(main,{...final,operationId:'publish',taskId:root.id,version:1,expectedTaskRevision:s.f.tasks.task(root.id).revision,resultId:final.resultId,publishedFileResultId:result.resultId,text:'合成文件'});const download=await bridge.artifact(s.run.id);assert.deepEqual(Buffer.from(download.data!,'base64'),bytes);writeFileSync(staged.path,'changed');await assert.rejects(()=>bridge.artifact(s.run.id),/result_hash_mismatch/);}finally{s.f.close();}});
test('workspace staging with materials refuses unread inputs, outside paths, links and stale runs',async()=>{const s=setup();try{writeFileSync(join(s.dir,'own.pdf'),'%PDF-1.4\n');await assert.rejects(()=>s.stage('own.pdf'),/read_material_first/);s.f.tasks.markMaterialRead(s.actor);for(const path of['../outside.pdf','/etc/hosts'])await assert.rejects(()=>s.stage(path),/path_denied/);symlinkSync('/etc/hosts',join(s.dir,'linked.pdf'));await assert.rejects(()=>s.stage('linked.pdf'),/symlink_denied/);s.f.tasks.failRun(s.run.id,s.actor.epoch!,'synthetic_stop');await assert.rejects(()=>s.stage('own.pdf'),/run_epoch_stale/);}finally{s.f.close();}});
