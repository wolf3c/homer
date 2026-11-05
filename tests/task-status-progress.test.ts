import {test} from 'node:test';import assert from 'node:assert/strict';
import {overviewFixture} from './task-overview-fixture.js';
import {homerWebBridge} from '../src/web-homer.js';import {WorkerProgressStore} from '../src/worker-progress.js';import type {Homer} from '../src/service.js';
test('progress bridge reads each current session by exact Run/version/epoch/thread/turn with two SELECTs',async()=>{
 const f=overviewFixture();try{
  const progress=new WorkerProgressStore();
  for(const name of ['a','b']){const w=f.open(name),run=f.tasks.claim(w.runId)!;f.tasks.bind(run.id,run.epoch,'thread:'+name,'turn:'+name);progress.message({taskId:f.taskId,version:1,runId:run.id,epoch:run.epoch,threadId:'thread:'+name,turnId:'turn:'+name},{phase:'commentary',text:'public '+name,completed:true});}
  const bridge=homerWebBridge({...f,workerProgress:progress,registerChannelCapabilities(){}} as unknown as Homer);
  f.store.db.exec('PRAGMA query_only=ON');const before=f.store.db.prepare('SELECT total_changes() AS n').get(),prepare=f.store.db.prepare.bind(f.store.db),queries:string[]=[];
  f.store.db.prepare=((sql:string)=>{queries.push(sql);return prepare(sql);}) as typeof f.store.db.prepare;
  let data;try{data=await bridge.taskOverview!.progress!(f.taskId);}finally{f.store.db.prepare=prepare;}
  assert.equal(queries.length,2);assert.ok(queries.every(sql=>!/(?:results|deliveries|worker_interactions|agent_receipts)/.test(sql)));
  assert.deepEqual(data.workers.map(w=>w.output?.text),['public a','public b']);assert.equal((await bridge.taskOverview!.list()).progressRevision,2);assert.deepEqual(f.store.db.prepare('SELECT total_changes() AS n').get(),before);
  f.store.db.exec('PRAGMA query_only=OFF');f.store.db.prepare('UPDATE runs SET epoch=epoch+1 WHERE id=?').run(data.workers[0]!.runId);f.store.db.exec('PRAGMA query_only=ON');
  assert.deepEqual((await bridge.taskOverview!.progress!(f.taskId)).workers.map(w=>w.output?.text),['public b']);await assert.rejects(()=>bridge.taskOverview!.progress!('missing'),/task_not_found/);
 }finally{f.close();}
});
test('following up retains one session and never reuses prior Run progress',async()=>{
 const f=overviewFixture();try{
  const w=f.open('first'),run=f.tasks.claim(w.runId)!;f.tasks.bind(run.id,run.epoch,'thread:a','turn:a');const progress=new WorkerProgressStore();progress.message({taskId:f.taskId,version:1,runId:run.id,epoch:run.epoch,threadId:'thread:a',turnId:'turn:a'},{phase:'commentary',text:'old',completed:true});
  f.tasks.endSegment(run.id,run.epoch,{status:'completed',text:'answer'},true);f.tasks.workerSend(f.actor,{operationId:'next',workerId:w.workerId,text:'follow up'});const next=f.tasks.claim()!;f.tasks.bind(next.id,next.epoch,'thread:a','turn:b');
  const bridge=homerWebBridge({...f,workerProgress:progress,registerChannelCapabilities(){}} as unknown as Homer);
  assert.equal((await bridge.taskOverview!.list()).tasks[0]!.workers.length,1);assert.deepEqual((await bridge.taskOverview!.progress!(f.taskId)).workers,[]);
 }finally{f.close();}
});
