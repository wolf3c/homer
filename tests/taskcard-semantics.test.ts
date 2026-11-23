import {test} from 'node:test';import assert from 'node:assert/strict';
import {readTaskOverview} from '../src/task-overview.js';import {overviewFixture} from './task-overview-fixture.js';
for(const [terminal,status] of [['completed','succeeded'],['failed','failed'],['interrupted','interrupted']] as const)test('session '+status+' leaves the matter open',()=>{
 const f=overviewFixture();try{
  const w=f.open('inspect'),run=f.tasks.claim(w.runId)!;f.tasks.bind(run.id,run.epoch,'thread:a','turn:a');
  const read=()=>readTaskOverview(f.store.db).tasks[0]!;
  assert.equal(read().workers[0]!.run.phase,'executing');
  f.tasks.endSegment(run.id,run.epoch,{status:terminal,text:'Found facts'},true);
  const returned=read();
  assert.equal(returned.workers[0]!.run.status,status);
  assert.equal(returned.workers[0]!.run.phase,'ended');
  assert.equal(returned.state,'open');
 }finally{f.close();}
});
test('goal changes preserve the earlier Run version without a matter status',()=>{
 const f=overviewFixture();try{
  const w=f.open('original'),run=f.tasks.claim(w.runId)!;f.tasks.bind(run.id,run.epoch,'thread:a','turn:a');
  const args={operationId:'update',taskId:f.taskId,expectedRevision:1,patch:{goal:'Changed requirement'},authority:f.authority},receipt=f.tasks.updateTask(f.actor,args);
  assert.equal(f.tasks.captureActivity(f.actor,'task_update',args,receipt)?.outcome,'update_confirmed');
  const row=readTaskOverview(f.store.db).tasks[0]!;assert.equal(row.headVersion,2);assert.equal(row.workers[0]!.run.version,1);assert.equal(row.state,'open');
 }finally{f.close();}
});
test('queued and stopped sessions never imply whole-Task execution or settlement',()=>{
 const f=overviewFixture();try{
  const w=f.open('queued'),read=()=>readTaskOverview(f.store.db).tasks[0]!;
  assert.equal(read().workers[0]!.run.status,'queued');
  const receipt=f.tasks.workerStop(f.actor,{operationId:'stop',workerId:w.workerId});assert.ok(receipt);
  assert.ok(read().workers[0]!.run.stopRequestedAt);assert.equal(read().state,'open');
 }finally{f.close();}
});
