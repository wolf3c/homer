// Requirements-derived synthetic facts. No service, model, real history or database.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture,delegate,running} from './recursive-fixture.js';
import * as overview from '../src/task-overview.js';
import {taskName,taskProgress,readableStatus,validPendingUsers} from '../src/task-presentation.js';

test('root name comes from the existing matter, while the complete goal is preserved',()=>{
 const f=fixture();try{
  const goal='核对样例。'+ '完整要求和约束必须保留。'.repeat(50);
  f.store.db.prepare('UPDATE task_versions SET goal=? WHERE taskId=?').run(goal,f.root.taskId);
  const row=overview.readTaskOverview(f.store.db).tasks[0]!;
  assert.equal(row.title,'Synthetic goal');assert.equal(row.goal,goal);
  assert.equal(taskName(row).text,'Synthetic goal');
  assert.equal(taskName({...row,title:undefined,goal}).text,'核对样例');
  assert.equal(taskName({...row,title:undefined,goal:'这是一个没有短首句的很长要求'.repeat(20)},2).text,'子任务 2');
  assert.equal(taskName({...row,title:undefined,goal:null}).source,'名称未记录');
 }finally{f.close();}
});

test('valid pending identities survive root uncertainty but stale run/version/epoch interactions do not',()=>{
 const f=fixture();try{
  const child=delegate(f);const actor=running(f,child.taskId);const run=f.tasks.run(actor.runId!);
  f.store.db.prepare(`INSERT INTO worker_interactions(id,identity,fingerprint,runId,threadId,turnId,requestId,source,kind,details,authority,state,createdAt,updatedAt,runEpoch,contractVersion) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('interaction-current','identity','fingerprint',run.id,run.threadId,run.turnId,'request','worker','question','{}','{}','pending_user',1,1,run.epoch,run.contractVersion);
  f.store.db.prepare("UPDATE tasks SET state='recovery' WHERE id=?").run(f.root.taskId);
  let tasks=overview.readTaskOverview(f.store.db).tasks;
  assert.deepEqual(overview.filterRoots(tasks,'user','').map(t=>t.id),[f.root.taskId]);
  let row=tasks.find(t=>t.id===child.taskId)!;
  assert.deepEqual(validPendingUsers(row),[{id:'interaction-current',after:0,kind:'question'}]);
  assert.match(taskProgress(tasks.find(t=>t.id===f.root.taskId)!,tasks),/需你答复/);
  for(const column of ['runEpoch','contractVersion']){
   f.store.db.prepare(`UPDATE worker_interactions SET ${column}=${column}+1`).run();
   row=overview.readTaskOverview(f.store.db).tasks.find(t=>t.id===child.taskId)!;assert.equal(row.pendingUser,0);assert.equal(validPendingUsers(row).length,0);
   f.store.db.prepare(`UPDATE worker_interactions SET ${column}=${column}-1`).run();
  }
  for(const column of ['threadId','turnId']){
   const prior=f.store.db.prepare(`SELECT ${column} AS value FROM worker_interactions`).get()!.value;
   f.store.db.prepare(`UPDATE worker_interactions SET ${column}=?`).run('unrelated-identity');
   assert.equal(overview.readTaskOverview(f.store.db).tasks.find(t=>t.id===child.taskId)!.pendingUser,0);
   assert.ok(typeof prior==='string');f.store.db.prepare(`UPDATE worker_interactions SET ${column}=?`).run(prior);
  }
  assert.equal(validPendingUsers({...row,run:{...row.run!,contractVersion:99},pendingUser:1,pendingUsers:[{id:'bad',after:0,kind:'question'}]}).length,0);
 }finally{f.close();}
});

test('display keeps candidate, partial child acceptance and publication separate; summary is not progress',()=>{
 const f=fixture();try{
  const root=overview.readTaskOverview(f.store.db).tasks[0]!;
  const child={...root,id:'child',parentTaskId:root.id,result:{id:'result',state:'accepted',outcome:'partial'}};
  assert.match(readableStatus(child),/部分成果/);
  assert.match(readableStatus({...child,result:{...child.result,outcome:'succeeded'}}),/成果已验收/);
  assert.match(readableStatus({...child,result:{...child.result,state:'offered'}}),/待协调者验收/);
  assert.ok(!taskProgress({...root,run:null},[root]).includes('100%'));
  assert.ok(!taskProgress({...root,run:root.run?{...root.run,summary:'刚刚已经成功'}:null},[]).includes('刚刚已经成功'));
 }finally{f.close();}
});

test('summary reads current requirements and recorded publication locations without any historical Run query',()=>{
 const f=fixture();try{
  f.store.db.exec('PRAGMA query_only=ON');const statements:string[]=[];
  const db={prepare(sql:string){statements.push(sql);return f.store.db.prepare(sql);}} as typeof f.store.db;
  const before=f.store.db.prepare('SELECT total_changes() n').get();
  const detail=overview.readTaskSummary(db,f.root.taskId);
  assert.equal(detail.taskId,f.root.taskId);assert.equal(detail.requirements?.[0]?.goal,f.tasks.contract(f.root.taskId,1).goal);
  assert.deepEqual(detail.runs,[]);assert.deepEqual(detail.publications,[]);
  assert.ok(!statements.some(sql=>/FROM runs r JOIN tasks/.test(sql)));
  assert.ok(statements.length<=4);assert.deepEqual(f.store.db.prepare('SELECT total_changes() n').get(),before);
 }finally{f.close();}
});

test('technical collections are bounded and explicitly marked incomplete; no per-child SQL reads',()=>{
 const f=fixture();try{
  for(let n=0;n<85;n++)delegate(f,'bounded-child-'+n);
  const statements:string[]=[];
  const db={prepare(sql:string){statements.push(sql);return f.store.db.prepare(sql);}} as typeof f.store.db;
  const detail=overview.readTaskDetail(db,f.root.taskId);
  assert.equal(detail.runs.length,80);assert.equal(detail.moreHistory,true);
  assert.equal(statements.length,8,'one root lookup and seven bounded technical collections');assert.ok(statements.slice(1).every(sql=>sql.includes('LIMIT 81')));
  statements.length=0;
  assert.equal(overview.readTaskSummary(db,f.root.taskId).requirements?.length,86);
  assert.equal(statements.length,3,'summary query count does not grow with the tree');
 }finally{f.close();}
});
