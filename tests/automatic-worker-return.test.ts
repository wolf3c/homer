// Real Task/Worker returns and SQLite; no model, account or channel.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,openWorker,running,main,mutation,processReplies} from './recursive-fixture.js';
import {readFileSync} from 'node:fs';
import {RECURSIVE_TOOLS} from '../src/recursive-tools.js';

test('natural final output returns exactly once without creating a Result or a business verdict',()=>{
 const f=fixture();try{
  const worker=openWorker(f),actor=running(f,worker.runId),output={status:'completed',text:'日期仍待确认，已核对材料。'};
  const returned=f.tasks.endSegment(actor.runId!,actor.epoch!,output,true)!;
  assert.equal(RECURSIVE_TOOLS.some(tool=>tool.name==='task_complete'),false);
  assert.equal(f.tasks.task(f.task.taskId).outcome,null);assert.equal(f.store.db.prepare("SELECT 1 FROM sqlite_master WHERE name='results'").get(),undefined);
  const original=f.tasks.workerRead(main,{workerId:worker.workerId,messageId:returned.messageId}).messages[0]!;
  assert.equal(original.text,output.text);assert.equal(original.taskVersion,1);assert.equal(original.senderRunId,actor.runId);
  assert.equal(f.tasks.endSegment(actor.runId!,actor.epoch!,output,true)!.messageId,returned.messageId);
  assert.equal(f.tasks.inbox(main).filter(message=>message.kind==='worker_reply').length,1);
  f.tasks.settleTask(main,{...mutation(f,'settle'),outcome:'partial',notes:'日期无法确认'});
  assert.equal(f.tasks.task(f.task.taskId).outcome,'partial');
 }finally{f.close();}
});

test('failed execution preserves existing exact file bytes and raw text without adopting or settling',()=>{
 const f=fixture();try{
  const worker=openWorker(f),actor=running(f,worker.runId),file=f.tasks.writeFile(actor,{operationId:'write',filename:'report.md',bytes:Buffer.from('# Checked synthetic facts')});
  const returned=f.tasks.endSegment(actor.runId!,actor.epoch!,{status:'failed',text:'已生成报告，后续检查失败。',errorCode:'synthetic_error'},true)!;
  const reply=f.tasks.workerRead(main,{workerId:worker.workerId,messageId:returned.messageId}).messages[0]!;
  assert.equal(reply.text,'已生成报告，后续检查失败。');assert.equal(reply.payload.execution.errorCode,'synthetic_error');
  assert.equal(f.tasks.task(f.task.taskId).outcome,null);
  assert.equal(readFileSync(file.path,'utf8'),'# Checked synthetic facts');
  assert.equal(f.tasks.task(f.task.taskId).outcome,null);
 }finally{f.close();}
});

for(const terminalReceived of [false,true])test('restart preserves exact public items once; native terminal received='+terminalReceived,()=>{
 const f=fixture();try{
  const worker=openWorker(f),actor=running(f,worker.runId);
  f.tasks.recordWorkerOutput(actor.runId!,actor.epoch!,{...actor,itemId:'report',phase:'final_answer',text:'已核对，日期缺失。'});
  if(terminalReceived)f.tasks.recordWorkerTerminal(actor.runId!,actor.epoch!,{status:'completed',text:'已核对，日期缺失。'});
  f.tasks.confirmWorkerExit(actor.runId!,undefined);f.tasks.reconcile();
  const reply=f.tasks.workerRead(main,{workerId:worker.workerId}).messages.find(message=>message.kind==='worker_reply')!;
  assert.equal(reply.text,'已核对，日期缺失。');assert.deepEqual(reply.nativeMessages,[{itemId:'report',phase:'final_answer',characters:reply.text.length}]);
  assert.equal(reply.payload.execution.status,terminalReceived?'completed':'unconfirmed');assert.equal(f.tasks.run(actor.runId!).status,terminalReceived?'succeeded':'interrupted');
  assert.equal(f.tasks.task(f.task.taskId).outcome,null);
  f.tasks.reconcile();assert.equal(f.tasks.inbox(main).filter(message=>message.kind==='worker_reply').length,1);
 }finally{f.close();}
});

test('unconfirmed return retains raw output but cannot start a queued followup until exact exit',()=>{
 const f=fixture();try{
  const worker=openWorker(f),actor=running(f,worker.runId),terminal={status:'completed',text:'等待核对日期。'};
  const returned=f.tasks.endSegment(actor.runId!,actor.epoch!,terminal,false)!;
  assert.equal(f.tasks.endSegment(actor.runId!,actor.epoch!,terminal,false)!.messageId,returned.messageId);
  assert.equal(f.tasks.run(actor.runId!).phase,'uncertain');assert.equal(f.tasks.task(f.task.taskId).outcome,null);
  const queued=f.tasks.workerSend(main,{operationId:'followup',workerId:worker.workerId,text:'Continue checking'});assert.equal(queued.runId,null);assert.equal(f.tasks.claim(),undefined);
  assert.equal(f.tasks.inbox(main).filter(message=>message.kind==='worker_reply').length,1);
  f.tasks.confirmWorkerExit(actor.runId!,undefined);const next=f.tasks.claim()!;assert.ok(next);assert.equal(next.workerId,worker.workerId);assert.equal(next.threadId,actor.threadId);
 }finally{f.close();}
});

test('raw reply and its pending receipt commit together and failed commit retries once',()=>{
 const f=fixture();try{
  const worker=openWorker(f),actor=running(f,worker.runId),before=f.tasks.task(f.task.taskId);
  f.store.db.exec("CREATE TEMP TRIGGER fail_return_notice BEFORE INSERT ON agent_messages WHEN NEW.kind='worker_reply' BEGIN SELECT RAISE(ABORT,'synthetic_notice_failure'); END");
  const terminal={status:'completed',text:'Synthetic checked result'};
  assert.throws(()=>f.tasks.endSegment(actor.runId!,actor.epoch!,terminal,true),/synthetic_notice_failure/);
  assert.equal(f.tasks.inbox(main).length,0);assert.deepEqual(f.tasks.task(f.task.taskId),before);assert.equal(f.tasks.run(actor.runId!).status,'running');
  f.store.db.exec('DROP TRIGGER fail_return_notice');const returned=f.tasks.endSegment(actor.runId!,actor.epoch!,terminal,true)!;
  assert.equal(f.tasks.endSegment(actor.runId!,actor.epoch!,terminal,true)!.messageId,returned.messageId);
  assert.equal(f.tasks.inbox(main).filter(message=>message.kind==='worker_reply').length,1);
  assert.equal(f.store.db.prepare('SELECT state FROM agent_receipts WHERE messageId=?').get(returned.messageId)!.state,'pending');
 }finally{f.close();}
});

test('commentary-only output remains exact raw evidence without automatic adoption or business acceptance',()=>{
 const f=fixture();try{
  const worker=openWorker(f),actor=running(f,worker.runId),returned=f.tasks.endSegment(actor.runId!,actor.epoch!,{status:'completed',text:'正在检查',messages:[{itemId:'comment',phase:'commentary',text:'正在检查'}]},true)!;
  const reply=f.tasks.workerRead(main,{workerId:worker.workerId,messageId:returned.messageId}).messages[0]!;
  assert.equal(reply.text,'正在检查');assert.deepEqual(reply.nativeMessages,[{itemId:'comment',phase:'commentary',characters:4}]);
  assert.equal(f.tasks.task(f.task.taskId).outcome,null);
  processReplies(f);assert.equal(f.tasks.inbox(main).length,0);assert.equal(f.tasks.task(f.task.taskId).outcome,null);
 }finally{f.close();}
});

for(const terminalReceived of [false,true])test('explicit stop retains exact received output once; native terminal received='+terminalReceived,()=>{
 const f=fixture();try{
  const worker=openWorker(f),actor=running(f,worker.runId);
  f.tasks.recordWorkerOutput(actor.runId!,actor.epoch!,{...actor,itemId:'report',phase:terminalReceived?'commentary':'final_answer',text:'停止前已核对两项。'});
  if(terminalReceived)f.tasks.recordWorkerTerminal(actor.runId!,actor.epoch!,{status:'completed',text:'停止前已核对两项。',messages:[{itemId:'terminal-only',phase:'final_answer',text:'停止前已核对两项。'}]});
  const stop=f.tasks.workerStop(main,{operationId:'stop',workerId:worker.workerId,reason:'Synthetic user stop'});
  f.tasks.confirmWorkerExit(actor.runId!,undefined);f.tasks.confirmStop(stop.operationKey,true);
  const notices=f.tasks.inbox(main).filter(message=>message.kind==='worker_reply');
  assert.equal(notices.length,1);assert.equal(notices[0]!.payload.text,'停止前已核对两项。');
  const original=notices[0]!.id;assert.equal(f.tasks.endSegment(actor.runId!,actor.epoch!,{status:'completed',text:'late'},true),undefined);
  assert.equal(f.tasks.inbox(main)[0]!.id,original);assert.equal(f.tasks.task(f.task.taskId).outcome,null);assert.equal(f.tasks.run(actor.runId!).status,'cancelled');
 }finally{f.close();}
});
