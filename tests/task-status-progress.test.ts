import {test} from 'node:test';import assert from 'node:assert/strict';
import {fixture,main,contract} from './recursive-fixture.js';
import {homerWebBridge} from '../src/web-homer.js';import {WorkerProgressStore} from '../src/worker-progress.js';import type {Homer} from '../src/service.js';
test('progress bridge returns only current task/version/run/epoch/segment public facts, read-only',async()=>{
 const f=fixture();try{
  const root=f.tasks.task(f.root.taskId),child=f.tasks.delegate(main,{operationId:'progress-child',taskId:root.id,version:root.headVersion,expectedTaskRevision:root.revision,contract:contract(),dependencies:[]}),run=f.tasks.claim(child.runId);assert.ok(run);f.tasks.bind(run.id,run.epoch,'public-thread','public-turn');
  const progress=new WorkerProgressStore(),scope={taskId:child.taskId,version:1,runId:run.id,epoch:run.epoch,threadId:'public-thread',turnId:'public-turn'};
  progress.message(scope,{phase:'commentary',text:'公开进展',completed:true});
  const bridge=homerWebBridge({...f,workerProgress:progress,registerChannelCapabilities(){}} as unknown as Homer);
  f.store.db.exec('PRAGMA query_only=ON');
  const before=f.store.db.prepare('SELECT total_changes() AS n').get();
  // Progress reads are bounded to the requested root, independent of the
  // global overview's result/delivery/interaction projections.
  const prepare=f.store.db.prepare.bind(f.store.db),queries:string[]=[];
  f.store.db.prepare=((sql:string)=>{queries.push(sql);return prepare(sql);}) as typeof f.store.db.prepare;
  let data;
  try{data=await bridge.taskOverview!.progress!(root.id);}finally{f.store.db.prepare=prepare;}
  assert.equal(queries.length,2);assert.ok(queries.every(sql=>!/(?:results|deliveries|worker_interactions|agent_receipts)/.test(sql)));
  assert.match(queries[1]!,/t.rootTaskId=\?/);
  assert.equal(data.workers.length,1);assert.equal(data.workers[0]?.output?.text,'公开进展');assert.equal((await bridge.taskOverview!.list()).progressRevision,1);assert.deepEqual(f.store.db.prepare('SELECT total_changes() AS n').get(),before);
  f.store.db.exec('PRAGMA query_only=OFF');f.store.db.prepare('UPDATE runs SET epoch=epoch+1 WHERE id=?').run(run.id);f.store.db.exec('PRAGMA query_only=ON');
  assert.equal((await bridge.taskOverview!.progress!(root.id)).workers.length,0);await assert.rejects(()=>bridge.taskOverview!.progress!('missing'),/task_not_found/);
 }finally{f.close();}
});

test('rework marker comes only from a same-task revision_requested predecessor',async()=>{
 const f=fixture();try{
  const root=f.tasks.task(f.root.taskId);const first=f.tasks.delegate(main,{operationId:'first-rework',taskId:root.id,version:root.headVersion,expectedTaskRevision:root.revision,contract:contract(),dependencies:[]});
  const updated=f.tasks.task(root.id);const second=f.tasks.delegate(main,{operationId:'second-rework',taskId:root.id,version:updated.headVersion,expectedTaskRevision:updated.revision,contract:contract(),dependencies:[]});
  f.store.db.prepare("UPDATE runs SET status='interrupted',phase='ended',errorCode='revision_requested' WHERE id=?").run(second.runId);f.store.db.prepare('UPDATE runs SET replacesRunId=? WHERE id=?').run(second.runId,first.runId);
  const bridge=homerWebBridge({...f,registerChannelCapabilities(){}} as unknown as Homer);
  assert.equal((await bridge.taskOverview!.list()).tasks.find(t=>t.id===first.taskId)?.rework,false);
  f.store.db.prepare('UPDATE runs SET taskId=? WHERE id=?').run(first.taskId,second.runId);
  assert.equal((await bridge.taskOverview!.list()).tasks.find(t=>t.id===first.taskId)?.rework,true);
 }finally{f.close();}
});
