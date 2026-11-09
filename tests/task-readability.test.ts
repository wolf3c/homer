import {test} from 'node:test';import assert from 'node:assert/strict';
import {overviewFixture} from './task-overview-fixture.js';
import {readTaskOverview,readTaskDetail,readTaskSummary} from '../src/task-overview.js';
import {taskName,readableStatus} from '../src/task-presentation.js';
test('Task name remains short while full goal and working notes are preserved',()=>{
 const f=overviewFixture();try{
  const goal='核对样例。'+'完整要求和约束必须保留。'.repeat(50);f.store.db.prepare('UPDATE task_versions SET goal=? WHERE taskId=?').run(goal,f.taskId);
  f.tasks.updateTask(f.actor,{operationId:'notes',taskId:f.taskId,expectedRevision:1,patch:{notes:'刚刚已经成功'}});
  const row=readTaskOverview(f.store.db).tasks[0]!;assert.equal(row.title,'Inspect synthetic inputs');assert.equal(row.goal,goal);assert.equal(row.notes,'刚刚已经成功');
  assert.equal(taskName(row).text,'Inspect synthetic inputs');assert.equal(taskName({...row,title:undefined}).text,'核对样例');
  const long='这是一个已有的长标题'.repeat(12);assert.equal(taskName({title:long,goal:'其他要求'}).text,long);
  const longGoal='这是没有短首句的很长要求'.repeat(20);assert.equal(taskName({title:null,goal:longGoal},2).text,longGoal);assert.equal(taskName({title:' ',goal:'。可用目标。详情'}).text,'可用目标');assert.equal(taskName({title:null,goal:null}).source,'名称未记录');
  assert.notEqual(readableStatus(row),'已完成');
 }finally{f.close();}
});
test('summary reads current requirements without Run history or payloads',()=>{
 const f=overviewFixture();try{
  f.store.db.exec('PRAGMA query_only=ON');const statements:string[]=[],db={prepare(sql:string){statements.push(sql);return f.store.db.prepare(sql);}} as typeof f.store.db;
  const before=f.store.db.prepare('SELECT total_changes() n').get(),detail=readTaskSummary(db,f.taskId);
  assert.equal(detail.requirements?.[0]?.goal,f.tasks.version(f.taskId,1).goal);assert.deepEqual(detail.runs,[]);
  assert.ok(statements.length<=4);assert.ok(statements.every(sql=>!/(?:FROM runs|payloadJson|checkpointJson)/.test(sql)));assert.deepEqual(f.store.db.prepare('SELECT total_changes() n').get(),before);
 }finally{f.close();}
});
test('technical history is bounded and explicitly incomplete without per-session queries',()=>{
 const f=overviewFixture();try{
  for(let n=0;n<85;n++)f.open('history-'+n);
  const statements:string[]=[],db={prepare(sql:string){statements.push(sql);return f.store.db.prepare(sql);}} as typeof f.store.db;
  f.store.db.exec('PRAGMA query_only=ON');const detail=readTaskDetail(db,f.taskId);
  assert.equal(detail.runs.length,80);assert.equal(detail.moreHistory,true);assert.equal(statements.length,6);assert.ok(statements.slice(1).every(sql=>sql.includes('LIMIT 81')));assert.doesNotMatch(JSON.stringify(detail),/prompt|checkpointJson|payloadJson/);
 }finally{f.close();}
});
