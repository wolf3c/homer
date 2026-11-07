import {test} from 'node:test';import assert from 'node:assert/strict';
import {taskCardPresentation,workerStatus} from '../src/task-status.js';import {readTaskOverview} from '../src/task-overview.js';import {overviewFixture} from './task-overview-fixture.js';
test('session success, failure and interruption remain separate from the Main decision',()=>{
 const f=overviewFixture();try{
  const w=f.open('inspect'),run=f.tasks.claim(w.runId)!;f.tasks.bind(run.id,run.epoch,'thread:a','turn:a');
  const read=()=>readTaskOverview(f.store.db).tasks[0]!;
  assert.equal(taskCardPresentation(read()).state,'working');
  f.tasks.endSegment(run.id,run.epoch,{status:'completed',text:'Found facts'},true);const returned=read();
  assert.equal(taskCardPresentation(returned,returned.workers[0]!).label,'已回复');assert.equal(taskCardPresentation(returned).owner,'main');assert.notEqual(taskCardPresentation(returned).state,'done');
  for(const result of [{status:'failed',label:'执行失败'},{status:'interrupted',label:'执行已中断'}]){const worker={...returned.workers[0]!,run:{...returned.workers[0]!.run,status:result.status}};assert.equal(workerStatus(worker).label,result.label);assert.equal(taskCardPresentation({...returned,workers:[worker]}).state,'waiting');}
  f.tasks.settleTask(f.actor,{operationId:'settle',taskId:f.taskId,expectedRevision:1,outcome:'partial'});assert.equal(taskCardPresentation(read()).icon,'CircleDashed');assert.equal(read().outcome,'partial');
 }finally{f.close();}
});
test('goal change projects a pending stop while retaining the actual earlier Run version',()=>{
 const f=overviewFixture();try{
  const w=f.open('original'),run=f.tasks.claim(w.runId)!;f.tasks.bind(run.id,run.epoch,'thread:a','turn:a');
  const args={operationId:'update',taskId:f.taskId,expectedRevision:1,patch:{goal:'Changed requirement'},authority:f.authority},receipt=f.tasks.updateTask(f.actor,args);
  assert.equal(f.tasks.captureActivity(f.actor,'task_update',args,receipt)?.outcome,'update_accepted');
  const row=readTaskOverview(f.store.db).tasks[0]!;assert.equal(row.headVersion,2);assert.equal(row.workers[0]!.run.version,1);assert.equal(taskCardPresentation(row).label,'停止待确认');assert.equal(taskCardPresentation(row).attention,'none');
 }finally{f.close();}
});
test('queued and stopped sessions never imply whole-Task execution or settlement',()=>{
 const f=overviewFixture();try{
  const w=f.open('queued'),read=()=>readTaskOverview(f.store.db).tasks[0]!;
  assert.equal(taskCardPresentation(read()).label,'排队中');assert.equal(workerStatus(read().workers[0]!).state,'waiting');
  const receipt=f.tasks.workerStop(f.actor,{operationId:'stop',workerId:w.workerId});assert.ok(receipt);
  assert.notEqual(taskCardPresentation(read()).state,'done');assert.equal(read().state,'open');
 }finally{f.close();}
});
