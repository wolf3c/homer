import test from 'node:test';
import assert from 'node:assert/strict';
import {overviewFixture} from './task-overview-fixture.js';
import {readTaskOverview,readTaskDetail,classifyTask,filterRoots} from '../src/task-overview.js';
import {workerStatus} from '../src/task-status.js';

test('projection reads two real sessions without inventing Tasks or requiring formal results',()=>{
 const f=overviewFixture();try{
  const a=f.open('page'),b=f.open('build');
  for(const worker of [a,b]){const run=f.tasks.claim(worker.runId)!;f.tasks.bind(run.id,run.epoch,'thread:'+worker.workerId,'turn:'+run.id);}
  f.store.db.exec('PRAGMA query_only=ON');const before=f.store.db.prepare('SELECT total_changes() n').get();
  let data=readTaskOverview(f.store.db);assert.equal(data.tasks.length,1);assert.equal(data.tasks[0]!.id,f.taskId);assert.deepEqual(data.tasks[0]!.workers.map(w=>w.id),[a.workerId,b.workerId]);
  assert.equal(classifyTask(data.tasks[0]!).key,'running');assert.deepEqual(data.tasks[0]!.results,[]);assert.deepEqual(data.tasks[0]!.deliveries,[]);
  assert.equal(readTaskDetail(f.store.db,f.taskId).runs.length,2);assert.deepEqual(f.store.db.prepare('SELECT total_changes() n').get(),before);
  f.store.db.exec('PRAGMA query_only=OFF');
  for(const worker of [a,b]){const run=f.tasks.run(worker.runId);f.tasks.endSegment(run.id,run.epoch,{status:'completed',text:'Answer '+worker.workerId},true);}
  data=readTaskOverview(f.store.db);assert.equal(data.tasks[0]!.state,'open');assert.notEqual(classifyTask(data.tasks[0]!).key,'complete');assert.equal(data.tasks[0]!.workers.reduce((n,w)=>n+w.pendingMain,0),2);
 }finally{f.close();}
});

test('same-session followup replaces its latest Run projection and preserves historical version and thread',()=>{
 const f=overviewFixture();try{
  const a=f.open('page'),run=f.tasks.claim(a.runId)!;f.tasks.bind(run.id,run.epoch,'thread:page','turn:first');const reply=f.tasks.endSegment(run.id,run.epoch,{status:'completed',text:'First reply'},true)!;
  f.tasks.workerSend(f.actor,{operationId:'followup',workerId:a.workerId,text:'Check the missing point'});
  const next=f.tasks.claim()!;assert.notEqual(next.id,run.id);f.tasks.bind(next.id,next.epoch,'thread:page','turn:next');
  const task=readTaskOverview(f.store.db).tasks[0]!;assert.equal(task.workers.length,1);assert.equal(task.workers[0]!.id,a.workerId);assert.equal(task.workers[0]!.run.id,next.id);
  assert.equal(task.workers[0]!.pendingMain,0,'an earlier reply does not make the active follow-up wait for Main');assert.equal(workerStatus(task.workers[0]!).label,'运行中');
  assert.equal(f.store.db.prepare('SELECT state FROM agent_receipts WHERE messageId=?').get(reply.messageId)!.state,'pending','the earlier receipt is retained');
  const detail=readTaskDetail(f.store.db,f.taskId);assert.deepEqual(detail.runs.map(r=>r.workerId),[a.workerId,a.workerId]);assert.equal(detail.runs[1]!.threadId,'thread:page');assert.equal(detail.runs[1]!.version,1);
 }finally{f.close();}
});

test('plain text Main settlement is visible with zero Result and Delivery records',()=>{
 const f=overviewFixture();try{
  f.tasks.settleTask(f.actor,{operationId:'settle',taskId:f.taskId,expectedRevision:f.tasks.task(f.taskId).revision,outcome:'succeeded',notes:'Investigation complete'});
  const task=readTaskOverview(f.store.db).tasks[0]!;assert.equal(classifyTask(task).key,'complete');assert.equal(task.notes,'Investigation complete');assert.deepEqual(task.results,[]);assert.deepEqual(task.deliveries,[]);
 }finally{f.close();}
});

test('pending questions retain exact Run epoch version thread and turn ownership',()=>{
 const f=overviewFixture();try{
  const a=f.open('page'),run=f.tasks.claim(a.runId)!;f.tasks.bind(run.id,run.epoch,'thread:page','turn:page');
  f.store.db.prepare(`INSERT INTO worker_interactions(id,identity,fingerprint,runId,threadId,turnId,requestId,source,kind,details,authority,state,createdAt,updatedAt,runEpoch,taskVersion) VALUES('question','identity','fingerprint',?,'thread:page','turn:page','request','ask_main','question','{}','{}','pending_user',100,100,?,?)`).run(run.id,run.epoch,run.version);
  let row=readTaskOverview(f.store.db).tasks[0]!;assert.equal(row.workers[0]!.pendingUser,1);assert.deepEqual(row.workers[0]!.pendingUsers,[{id:'question',after:0,kind:'question'}]);assert.deepEqual(filterRoots([row],'user','').map(t=>t.id),[f.taskId]);
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
  assert.equal(statements.length,6);assert.ok(statements.every(sql=>/^SELECT/.test(sql)));assert.ok(statements.every(sql=>!/(payloadJson|checkpointJson|filePath)/.test(sql)));assert.equal(data.tasks[0]!.workers.length,1);assert.deepEqual(f.store.db.prepare('SELECT total_changes() n').get(),before);
  assert.throws(()=>readTaskDetail(f.store.db,'unknown'),/task_not_found/);assert.throws(()=>readTaskDetail(f.store.db,'../outside'),/task_not_found/);
 }finally{f.close();}
});
