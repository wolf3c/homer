// Requirements-derived synthetic contracts. No model, credentials or channels.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,delegate,running,main} from './recursive-fixture.js';
import {RECURSIVE_TOOLS} from '../src/recursive-tools.js';

test('natural final output is offered once without a completion tool or a business verdict',()=>{
 const f=fixture();try{
  const child=delegate(f),actor=running(f,child.taskId);
  const output={status:'completed',text:'日期仍待确认，已核对材料。'};
  const returned=f.tasks.endSegment(actor.runId!,actor.epoch!,output,true)!;
  assert.equal(RECURSIVE_TOOLS.some(t=>t.name==='task_complete'),false);
  assert.equal(f.tasks.task(child.taskId).outcome,null);
  const inspected=f.tasks.inspect(main,{resultId:returned.resultId});
  assert.equal(inspected.actualResult!.payload.text,output.text);
  assert.equal(inspected.results.find(r=>r.id===returned.resultId)!.state,'offered');
  assert.equal(f.tasks.endSegment(actor.runId!,actor.epoch!,output,true)!.resultId,returned.resultId);
  assert.equal(f.tasks.inbox(main).filter(m=>m.kind==='result_ready').length,1);
  const t=f.tasks.task(child.taskId);
  assert.throws(()=>f.tasks.review(main,{operationId:'missing-evidence',taskId:t.id,version:1,expectedTaskRevision:t.revision,resultId:returned.resultId,accepted:true,outcome:'succeeded',reason:'checked',evidence:{},children:[]}),/task_criterion_missing/);
  f.tasks.review(main,{operationId:'review',taskId:t.id,version:1,expectedTaskRevision:t.revision,resultId:returned.resultId,accepted:true,outcome:'partial',reason:'日期无法确认',evidence:{gaps:'日期缺失'},children:[]});
  assert.equal(f.tasks.task(t.id).outcome,'partial');
 }finally{f.close();}
});

test('failed execution returns existing files and text without settling the business goal',()=>{
 const f=fixture();try{
  const child=delegate(f,'files',f.root.taskId,main,'markdown'),actor=running(f,child.taskId);
  f.tasks.markMaterialRead(actor);
  const file=f.tasks.writeMarkdown(actor,{operationId:'write',filename:'report.md',content:'# Checked synthetic facts'});
  const result=f.tasks.endSegment(actor.runId!,actor.epoch!,{status:'failed',text:'已生成报告，后续检查失败。',errorCode:'synthetic_error'},true)!;
  const facts=f.tasks.inspect(main,{resultId:result.resultId});
  assert.equal(facts.task.outcome,null);
  assert.equal(facts.results.find(r=>r.id===file.resultId)!.state,'offered');
  assert.ok(facts.completionResultIds.includes(file.resultId));
  assert.equal(f.tasks.inbox(main).filter(m=>m.kind==='terminal').length,1);
 }finally{f.close();}
});

test('main aggregate settles atomically with publication instead of completing separately',()=>{
 const f=fixture();try{
  const root=f.tasks.task(f.root.taskId),args={taskId:root.id,version:1,expectedTaskRevision:root.revision,resultId:null,text:'已核对合成材料。',publishedFileResultId:null,outcome:'succeeded' as const,evidence:{facts:'Synthetic input checked'},children:[]};
  assert.throws(()=>f.tasks.publish(main,{...args,operationId:'bad',publishedFileResultId:'missing'}));
  assert.equal(f.tasks.task(root.id).outcome,null);
  assert.equal(f.tasks.inspect(main,{taskId:root.id}).results.length,0);
  const delivery=f.tasks.publish(main,{...args,operationId:'publish'});
  assert.equal(f.tasks.task(root.id).outcome,'succeeded');
  assert.equal(f.tasks.delivery(delivery.deliveryId).outcome,'succeeded');
 }finally{f.close();}
});

for(const terminalReceived of [false,true])test('restart preserves public output once with terminal received='+terminalReceived,()=>{
 const f=fixture();try{
  const child=delegate(f),actor=running(f,child.taskId);
  f.tasks.recordWorkerOutput(actor.runId!,actor.epoch!,{...actor,itemId:'report',phase:'final_answer',text:'已核对，日期缺失。'});
  if(terminalReceived)f.tasks.recordWorkerTerminal(actor.runId!,actor.epoch!,{status:'completed',text:'已核对，日期缺失。'});
  f.tasks.reconcile();
  const first=f.tasks.inspect(main,{taskId:child.taskId});
  assert.equal(first.task.state,terminalReceived?'reviewing':'recovery');assert.equal(first.task.outcome,null);
  const result=first.results.find(r=>r.runId===actor.runId)!;
  assert.equal(JSON.parse(result.payloadJson).text,'已核对，日期缺失。');
  assert.equal(result.state,'offered');
  const notices=f.tasks.inbox(main).length;
  f.tasks.reconcile();assert.equal(f.tasks.inbox(main).length,notices);
  assert.equal(f.tasks.inspect(main,{taskId:child.taskId}).results.length,1);
 }finally{f.close();}
});

test('restart after a wait terminal requires recovery instead of parking an exited Worker',()=>{
 const f=fixture();try{
  const child=delegate(f),other=delegate(f,'wait-target'),actor=running(f,child.taskId),task=f.tasks.task(child.taskId);
  f.tasks.wait(actor,{operationId:'wait',taskId:task.id,version:1,expectedTaskRevision:task.revision,condition:{type:'result_or_terminal',taskId:other.taskId,version:1}});
  f.tasks.recordWorkerOutput(actor.runId!,actor.epoch!,{...actor,itemId:'waiting',phase:'final_answer',text:'等待核对日期。'});
  f.tasks.recordWorkerTerminal(actor.runId!,actor.epoch!,{status:'completed',text:'等待核对日期。'});
  f.tasks.reconcile();
  const facts=f.tasks.inspect(main,{taskId:task.id});
  assert.equal(facts.task.state,'recovery');assert.equal(facts.task.outcome,null);
  assert.equal(facts.run!.status,'interrupted');assert.equal(facts.run!.phase,'ended');
  assert.equal(JSON.parse(facts.results[0]!.payloadJson).text,'等待核对日期。');
  assert.equal(f.store.db.prepare("SELECT count(*) n FROM run_waits WHERE runId=? AND state IN ('armed','ready')").get(actor.runId!)!.n,0);
 }finally{f.close();}
});

test('a duplicate wait terminal cannot turn a parked segment into a completed task',()=>{
 const f=fixture();try{
  const child=delegate(f),other=delegate(f,'wait-target'),actor=running(f,child.taskId),task=f.tasks.task(child.taskId);
  f.tasks.wait(actor,{operationId:'wait',taskId:task.id,version:1,expectedTaskRevision:task.revision,condition:{type:'result_or_terminal',taskId:other.taskId,version:1}});
  const terminal={status:'completed',text:'等待核对日期。'};
  f.tasks.endSegment(actor.runId!,actor.epoch!,terminal,false);
  assert.equal(f.tasks.run(actor.runId!).phase,'parked');
  f.tasks.endSegment(actor.runId!,actor.epoch!,terminal,false);
  assert.equal(f.tasks.run(actor.runId!).phase,'parked');
  assert.equal(f.tasks.inspect(main,{taskId:task.id}).results.length,0);
 }finally{f.close();}
});

test('candidate and original inbox notice commit together and a failed commit can retry',()=>{
 const f=fixture();try{
  const child=delegate(f),actor=running(f,child.taskId),revision=f.tasks.task(child.taskId).revision;
  f.store.db.exec("CREATE TEMP TRIGGER fail_return_notice BEFORE INSERT ON agent_messages WHEN NEW.kind='result_ready' BEGIN SELECT RAISE(ABORT,'synthetic_notice_failure'); END");
  const terminal={status:'completed',text:'Synthetic checked result'};
  assert.throws(()=>f.tasks.endSegment(actor.runId!,actor.epoch!,terminal,true),/synthetic_notice_failure/);
  assert.equal(f.tasks.inspect(main,{taskId:child.taskId}).results.length,0);
  assert.equal(f.tasks.task(child.taskId).revision,revision);
  f.store.db.exec('DROP TRIGGER fail_return_notice');
  const returned=f.tasks.endSegment(actor.runId!,actor.epoch!,terminal,true)!;
  assert.equal(f.tasks.inbox(main).filter(m=>m.kind==='result_ready').length,1);
  assert.equal(f.tasks.endSegment(actor.runId!,actor.epoch!,terminal,true)!.resultId,returned.resultId);
 }finally{f.close();}
});

test('a completed turn with commentary only stays unconfirmed by business acceptance',()=>{
 const f=fixture();try{
  const child=delegate(f),actor=running(f,child.taskId);
  const returned=f.tasks.endSegment(actor.runId!,actor.epoch!,{status:'completed',text:'正在检查',messages:[{itemId:'comment',phase:'commentary',text:'正在检查'}]},true)!;
  const inspected=f.tasks.inspect(main,{resultId:returned.resultId});
  assert.equal(inspected.actualResult!.payload.text,'');
  assert.equal(inspected.actualResult!.payload.messages[0].text,'正在检查');
  const t=inspected.task;
  for(const outcome of ['succeeded','partial'] as const)
   assert.throws(()=>f.tasks.review(main,{operationId:'false-'+outcome,taskId:t.id,version:1,expectedTaskRevision:t.revision,resultId:returned.resultId,accepted:true,outcome,reason:'No final output',evidence:{facts:true,gaps:'No usable output'},children:[]}),/result_empty/);
  assert.equal(f.tasks.task(t.id).outcome,null);
 }finally{f.close();}
});

for(const terminalReceived of [false,true])test('explicit stop retains received output with terminal received='+terminalReceived,()=>{
 const f=fixture();try{
  const child=delegate(f),actor=running(f,child.taskId);
  f.tasks.recordWorkerOutput(actor.runId!,actor.epoch!,{...actor,itemId:'report',phase:terminalReceived?'commentary':'final_answer',text:'停止前已核对两项。'});
  if(terminalReceived)f.tasks.recordWorkerTerminal(actor.runId!,actor.epoch!,{status:'completed',text:'停止前已核对两项。',messages:[{itemId:'terminal-only',phase:'final_answer',text:'停止前已核对两项。'}]});
  const t=f.tasks.task(child.taskId),stop=f.tasks.stop(main,{operationId:'stop',taskId:t.id,version:1,expectedTaskRevision:t.revision,scope:'self',reason:'Synthetic user stop'});
  f.tasks.confirmStop(stop.operationKey,true);
  const notices=f.tasks.inbox(main).filter(m=>m.kind==='terminal');
  assert.equal(notices.length,1);assert.equal((notices[0]!.payload as any).output.text,'停止前已核对两项。');
  assert.equal(f.tasks.endSegment(actor.runId!,actor.epoch!,{status:'completed',text:'late'},true),undefined);
  assert.equal(f.tasks.task(t.id).outcome,'cancelled');
 }finally{f.close();}
});

for(const state of ['offered','staged'])test('historical '+state+' candidates keep their verdict and receipt across recovery and review',()=>{
 const f=fixture();try{
  const child=delegate(f),actor=running(f,child.taskId);
  const returned=f.tasks.endSegment(actor.runId!,actor.epoch!,{status:'completed',text:'Historical synthetic report'},true)!;
  // A historical record, not a compatibility execution route for the removed tool.
  const row=f.tasks.inspect(main,{resultId:returned.resultId}).results[0]!;
  f.store.db.prepare("UPDATE results SET state=?,outcome='partial',payloadJson=?,evidenceJson=? WHERE id=?").run(state,JSON.stringify({summary:'Historical partial result'}),JSON.stringify({gaps:'Historical missing date'}),row.id);
  f.store.db.prepare("UPDATE operations SET kind='complete',operationId='historical-complete',responseJson=? WHERE id=?").run(JSON.stringify({resultId:row.id,state:'sealing',outcome:'partial'}),row.operationKey);
  if(state==='staged')f.store.db.prepare("UPDATE runs SET status='running',phase='sealing' WHERE id=?").run(actor.runId!);
  const receipt=f.tasks.operation(row.operationKey);
  f.tasks.reconcile();
  const inspected=f.tasks.inspect(main,{resultId:row.id}),t=inspected.task;
  assert.equal(inspected.results.length,1);assert.equal(inspected.results[0]!.state,'offered');
  assert.equal(inspected.actualResult!.payload.summary,'Historical partial result');
  f.tasks.review(main,{operationId:'review-old',taskId:t.id,version:1,expectedTaskRevision:t.revision,resultId:row.id,accepted:true,outcome:'partial',reason:'Historical actual result checked'});
  assert.equal(f.tasks.task(t.id).outcome,'partial');
  assert.deepEqual(f.tasks.operation(row.operationKey),receipt);
 }finally{f.close();}
});
