import {test} from 'node:test';import assert from 'node:assert/strict';
import {overviewFixture} from './task-overview-fixture.js';
import {homerWebBridge} from '../src/web-homer.js';import type {Homer} from '../src/service.js';
test('task overview stays read-only and follows current Runs without a progress cache',async()=>{
 const f=overviewFixture();try{
  const w=f.open('first'),run=f.tasks.claim(w.runId)!;f.tasks.bind(run.id,run.epoch,'thread:a','turn:a');
  const bridge=homerWebBridge({...f,registerWebSurface(){}} as unknown as Homer);
  assert.equal(bridge.taskOverview!.progress,undefined);assert.equal(bridge.taskOverview!.execution,undefined);assert.equal(bridge.taskOverview!.call,undefined);
  f.store.db.exec('PRAGMA query_only=ON');const before=f.store.db.prepare('SELECT total_changes() n').get();
  const first=await bridge.taskOverview!.list();assert.equal(first.tasks[0]!.workers[0]!.run.id,run.id);assert.equal(first.progressRevision,undefined);assert.deepEqual(f.store.db.prepare('SELECT total_changes() n').get(),before);
  f.store.db.exec('PRAGMA query_only=OFF');f.tasks.endSegment(run.id,run.epoch,{status:'completed',text:'answer'},true);f.tasks.workerSend(f.actor,{operationId:'next',workerId:w.workerId,text:'follow up'});const next=f.tasks.claim()!;f.tasks.bind(next.id,next.epoch,'thread:a','turn:b');
  const current=await bridge.taskOverview!.list();assert.equal(current.tasks[0]!.workers.length,1);assert.equal(current.tasks[0]!.workers[0]!.run.id,next.id);
 }finally{f.close();}
});
