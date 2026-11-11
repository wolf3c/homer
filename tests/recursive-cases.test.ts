import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fixture,main,openWorker,running,complete,mutation,processReplies} from './recursive-fixture.js';

test('two conversations return raw text, follow up on the same thread, pause/resume and preserve the ordinary file at its address',()=>{
 const f=fixture();try{
  const a=openWorker(f,'a'),b=openWorker(f,'b'),aa=running(f,a.runId),bb=running(f,b.runId);
  const first=complete(f,aa,'A found an unknown date.\n\nKeep the original paragraph.');
  const follow=f.tasks.workerSend(main,{operationId:'ask-again',workerId:a.workerId,text:'Group by owner'}),next=running(f,follow.runId!);
  assert.equal(next.threadId,aa.threadId);assert.equal(f.tasks.run(next.runId!).goal,f.tasks.run(aa.runId!).goal);
  const file=join(f.files.workspace,'report.md'),bytes=Buffer.from('# Synthetic owner report\nDate unknown.\n');writeFileSync(file,bytes);
  const completed=complete(f,next,'Report saved: '+file);
  const pause=f.tasks.controlTask(main,{...mutation(f,'pause'),action:'pause'});assert.deepEqual(pause.targets,[bb.runId]);
  assert.throws(()=>f.tasks.controlTask(main,{...mutation(f,'early-resume'),action:'resume'}),/resume_unconfirmed/);
  f.tasks.confirmWorkerExit(bb.runId!,undefined);f.tasks.confirmStop(pause.operationKey,true);
  f.tasks.controlTask(main,{...mutation(f,'resume'),action:'resume'});
  const raw=f.tasks.workerRead(main,{workerId:a.workerId,messageId:first.messageId}).messages[0]!.text;
  assert.equal(raw,'A found an unknown date.\n\nKeep the original paragraph.');assert.equal(f.tasks.workerRead(main,{workerId:a.workerId,messageId:completed.messageId}).messages[0]!.text,'Report saved: '+file);
  assert.deepEqual(readFileSync(file),bytes);
  assert.equal(f.tasks.task(f.task.taskId).outcome,null);processReplies(f);
  f.tasks.settleTask(main,{...mutation(f,'settle'),outcome:'partial',notes:'B stopped; available evidence reported'});
  assert.equal(f.tasks.task(f.task.taskId).outcome,'partial');assert.equal(f.tasks.runs().length,3);assert.equal(f.tasks.tasks().length,1);
 }finally{f.close();}
});

test('ordinary text can be settled and archived without manufacturing a Result or Delivery',()=>{
 const f=fixture();try{
  const worker=openWorker(f),actor=running(f,worker.runId),reply=complete(f,actor,'Investigation complete; no edits needed.');processReplies(f);
  f.tasks.settleTask(main,{...mutation(f,'settle'),outcome:'succeeded'});
  const archive=f.tasks.archiveHistory(main,mutation(f,'archive'),true);assert.equal(archive.state,'archived');
  assert.equal(f.store.db.prepare("SELECT 1 FROM sqlite_schema WHERE name IN ('results','deliveries')").get(),undefined);
  assert.equal(f.tasks.workerRead(main,{workerId:worker.workerId,messageId:reply.messageId}).messages[0]!.text,'Investigation complete; no edits needed.');
 }finally{f.close();}
});
