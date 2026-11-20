import test from 'node:test';
import assert from 'node:assert/strict';
import {overviewFixture} from './task-overview-fixture.js';
import {readTaskOverview,readTaskDetail,classifyTask} from '../src/task-overview.js';
import {workerStatus} from '../src/task-status.js';

test('projection reads two real sessions without inventing Tasks or requiring formal results',()=>{
 const f=overviewFixture();try{
  const a=f.open('page'),b=f.open('build');
  for(const worker of [a,b]){const run=f.tasks.claim(worker.runId)!;f.tasks.bind(run.id,run.epoch,'thread:'+worker.workerId,'turn:'+run.id);}
  f.store.db.exec('PRAGMA query_only=ON');const before=f.store.db.prepare('SELECT total_changes() n').get();
  let data=readTaskOverview(f.store.db);assert.equal(data.tasks.length,1);assert.equal(data.tasks[0]!.id,f.taskId);assert.deepEqual(data.tasks[0]!.workers.map(w=>w.id),[a.workerId,b.workerId]);
  assert.equal(classifyTask(data.tasks[0]!).key,'ordinary');
  assert.equal(readTaskDetail(f.store.db,f.taskId).runs.length,2);assert.deepEqual(f.store.db.prepare('SELECT total_changes() n').get(),before);
  f.store.db.exec('PRAGMA query_only=OFF');
  for(const worker of [a,b]){const run=f.tasks.run(worker.runId);f.tasks.endSegment(run.id,run.epoch,{status:'completed',text:'Answer '+worker.workerId},true);}
  data=readTaskOverview(f.store.db);assert.equal(data.tasks[0]!.state,'open');assert.notEqual(classifyTask(data.tasks[0]!).key,'complete');assert.equal(data.tasks[0]!.workers.reduce((n,w)=>n+w.pendingMain,0),2);
 }finally{f.close();}
});

test('same-session followup replaces its latest Run projection and preserves historical version and thread',()=>{
 const f=overviewFixture();try{
  const a=f.open('page'),run=f.tasks.claim(a.runId)!;f.tasks.bind(run.id,run.epoch,'thread:page','turn:first');const reply=f.tasks.endSegment(run.id,run.epoch,{status:'completed',text:'First reply'},true)!;
  f.tasks.workerMessage(f.actor,{operationId:'followup',workerId:a.workerId,text:'Check the missing point'});
  const next=f.tasks.claim()!;assert.notEqual(next.id,run.id);f.tasks.bind(next.id,next.epoch,'thread:page','turn:next');
  const task=readTaskOverview(f.store.db).tasks[0]!;assert.equal(task.workers.length,1);assert.equal(task.workers[0]!.id,a.workerId);assert.equal(task.workers[0]!.run.id,next.id);
  assert.equal(task.workers[0]!.pendingMain,0,'an earlier reply does not make the active follow-up wait for Main');assert.equal(workerStatus(task.workers[0]!).label,'运行中');
  assert.equal(f.store.db.prepare('SELECT state FROM agent_receipts WHERE messageId=?').get(reply.messageId)!.state,'pending','the earlier receipt is retained');
  const detail=readTaskDetail(f.store.db,f.taskId);assert.deepEqual(detail.runs.map(r=>r.workerId),[a.workerId,a.workerId]);assert.equal(detail.runs[1]!.threadId,'thread:page');assert.equal(detail.runs[1]!.version,1);
 }finally{f.close();}
});

test('pending questions retain exact Run epoch version thread and turn ownership',()=>{
 const f=overviewFixture();try{
  const a=f.open('page'),run=f.tasks.claim(a.runId)!;f.tasks.bind(run.id,run.epoch,'thread:page','turn:page');
  f.store.db.prepare(`INSERT INTO worker_interactions(id,identity,fingerprint,runId,threadId,turnId,requestId,source,kind,details,authority,state,createdAt,updatedAt,runEpoch,taskVersion) VALUES('question','identity','fingerprint',?,'thread:page','turn:page','request','ask_main','question','{}','{}','pending_user',100,100,?,?)`).run(run.id,run.epoch,run.version);
  let row=readTaskOverview(f.store.db).tasks[0]!;assert.equal(row.workers[0]!.pendingUser,1);assert.deepEqual(row.workers[0]!.pendingUsers,[{id:'question',after:0,kind:'question'}]);assert.equal(classifyTask(row).key,'user');
  f.store.db.prepare("UPDATE tasks SET state='paused' WHERE id=?").run(f.taskId);
  assert.equal(readTaskOverview(f.store.db,{view:'needsUser'}).tasks[0]?.id,f.taskId);
  f.store.db.prepare("UPDATE worker_interactions SET responseUserMessageId='already-replied'").run();
  assert.equal(readTaskOverview(f.store.db,{view:'needsUser'}).tasks.length,0);
  f.store.db.prepare("UPDATE worker_interactions SET responseUserMessageId=NULL").run();
  for(const [column,value] of [['runEpoch',99],['taskVersion',99],['threadId','unrelated'],['turnId','unrelated']] as const){
   const before=f.store.db.prepare(`SELECT ${column} AS value FROM worker_interactions`).get()!.value;
   f.store.db.prepare(`UPDATE worker_interactions SET ${column}=?`).run(value);row=readTaskOverview(f.store.db).tasks[0]!;assert.equal(row.workers[0]!.pendingUser,0,column);
   f.store.db.prepare(`UPDATE worker_interactions SET ${column}=?`).run(before??null);
  }
  f.store.db.prepare("UPDATE worker_interactions SET state='expired'").run();
  assert.deepEqual(readTaskDetail(f.store.db,f.taskId).recovery!.interactions.map(row=>({...row})),[{id:'question',runId:run.id,taskVersion:run.version,kind:'question',state:'expired'}]);
 }finally{f.close();}
});

test('overview stays batched and excludes message bodies and historical execution payloads',()=>{
 const f=overviewFixture();try{
  const a=f.open('page'),run=f.tasks.claim(a.runId)!;f.tasks.bind(run.id,run.epoch,'thread:page','turn:page');f.tasks.endSegment(run.id,run.epoch,{status:'completed',text:'large reply'.repeat(10000)},true);
  const statements:string[]=[],db={prepare(sql:string){statements.push(sql);return f.store.db.prepare(sql);}} as typeof f.store.db;
  f.store.db.exec('PRAGMA query_only=ON');const before=f.store.db.prepare('SELECT total_changes() n').get();const data=readTaskOverview(db);
  assert.equal(statements.length,4);assert.ok(statements.every(sql=>/^SELECT/.test(sql)));assert.ok(statements.every(sql=>!/(payloadJson|checkpointJson|filePath)/.test(sql)));assert.equal(data.tasks[0]!.workers.length,1);assert.deepEqual(f.store.db.prepare('SELECT total_changes() n').get(),before);
  assert.throws(()=>readTaskDetail(f.store.db,'unknown'),/task_not_found/);assert.throws(()=>readTaskDetail(f.store.db,'../outside'),/task_not_found/);
 }finally{f.close();}
});

test('overview counts a pending reply from the latest Worker run under its original goal version',()=>{
 const f=overviewFixture();try{
  const w=f.open('page'),run=f.tasks.claim(w.runId)!;
  f.tasks.bind(run.id,run.epoch,'thread:page','turn:original');
  f.tasks.updateTask(f.actor,{operationId:'revise',taskId:f.taskId,expectedRevision:f.tasks.task(f.taskId).revision,patch:{goal:'Revise future work'},authority:f.authority});
  const reply=f.tasks.endSegment(run.id,run.epoch,{status:'completed',text:'Original observation'},true)!;
  const task=readTaskOverview(f.store.db).tasks[0]!;
  assert.equal(task.headVersion,2);assert.equal(task.workers[0]!.run.version,1);
  assert.equal(task.workers[0]!.pendingMain,1);assert.equal(classifyTask(task).key,'ordinary');
  f.store.db.prepare('UPDATE agent_messages SET taskVersion=? WHERE id=?').run(task.headVersion,reply.messageId);
  assert.equal(readTaskOverview(f.store.db).tasks[0]!.workers[0]!.pendingMain,0,'a message must still match the emitting run');
 }finally{f.close();}
});

test('archive pages and detail preserve Worker history without restoring the matter',()=>{
 const f=overviewFixture();try{
  const w=f.open('archive example'),run=f.tasks.claim(w.runId)!;
  f.tasks.bind(run.id,run.epoch,'archive-thread','archive-turn');
  f.tasks.endSegment(run.id,run.epoch,{status:'completed',text:'Original reply'},true);
  f.store.db.prepare("UPDATE tasks SET historyState='archived' WHERE id=?").run(f.taskId);
  f.store.db.exec('PRAGMA query_only=ON');
  assert.deepEqual(readTaskOverview(f.store.db).tasks,[]);
  assert.equal(readTaskOverview(f.store.db,{view:'archived'}).tasks[0]?.workers[0]?.id,w.workerId);
  assert.equal(readTaskDetail(f.store.db,f.taskId,{workerId:w.workerId}).conversation!.messages.at(-1)?.text,'Original reply');
 }finally{f.close();}
});

test('uncertain actions or receipts remain visible after the Worker replies',()=>{
 const f=overviewFixture();try{
  const w=f.open('check'),run=f.tasks.claim(w.runId)!;f.tasks.bind(run.id,run.epoch,'thread:check','turn:check');
  const reply=f.tasks.endSegment(run.id,run.epoch,{status:'completed',text:'Synthetic answer'},true)!;
  f.store.db.prepare("UPDATE operations SET state='uncertain' WHERE operationId=?").run('open:check');
  f.store.db.prepare("UPDATE agent_receipts SET state='uncertain' WHERE messageId=?").run(reply.messageId);
  assert.equal(classifyTask(readTaskOverview(f.store.db).tasks[0]!).label,'操作结果待核实 · 接收回执待核实');
 }finally{f.close();}
});
