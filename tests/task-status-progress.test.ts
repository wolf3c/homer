import {test} from 'node:test';import assert from 'node:assert/strict';
import {overviewFixture} from './task-overview-fixture.js';
import {homerWebBridge} from '../src/web-homer.js';import {Homer} from '../src/service.js';
test('task overview stays read-only and follows current Runs without a progress cache',async()=>{
 const f=overviewFixture();try{
  const w=f.open('first'),run=f.tasks.claim(w.runId)!;f.tasks.bind(run.id,run.epoch,'thread:a','turn:a');
  const bridge=homerWebBridge({...f,registerWebSurface(){}} as unknown as Homer);
  assert.equal(bridge.taskOverview!.progress,undefined);assert.equal(bridge.taskOverview!.execution,undefined);assert.equal(bridge.taskOverview!.call,undefined);
  f.store.db.exec('PRAGMA query_only=ON');const before=f.store.db.prepare('SELECT total_changes() n').get();
  const first=await bridge.taskOverview!.list();assert.equal(first.tasks[0]!.workers[0]!.run.id,run.id);assert.equal(first.progressRevision,undefined);assert.deepEqual(f.store.db.prepare('SELECT total_changes() n').get(),before);
  f.store.db.exec('PRAGMA query_only=OFF');f.tasks.endSegment(run.id,run.epoch,{status:'completed',text:'answer'},true);f.tasks.workerMessage(f.actor,{operationId:'next',workerId:w.workerId,text:'follow up'});const next=f.tasks.claim()!;f.tasks.bind(next.id,next.epoch,'thread:a','turn:b');
  const current=await bridge.taskOverview!.list();assert.equal(current.tasks[0]!.workers.length,1);assert.equal(current.tasks[0]!.workers[0]!.run.id,next.id);
 }finally{f.close();}
});

test('only a matching, currently executing Worker sets the matter badge',async()=>{
 const f=overviewFixture();
 try{
  const workers=new Map();
  const app={...f,workers,registerWebSurface(){},isWorkerExecuting:Homer.prototype.isWorkerExecuting,runningTaskIds:Homer.prototype.runningTaskIds} as unknown as Homer;
  const list=homerWebBridge(app).taskOverview!.list;
  const targetPage=()=>list({view:'visible',before:2});
  const running=async()=>(await targetPage()).tasks[0]!.hasExecutingWorker===true;
  const start=(runId:string)=>{
   const run=f.tasks.claim(runId)!;
   const threadId='thread:'+run.workerId,turnId='turn:'+run.id;
   const slot={id:run.id,epoch:run.epoch,activeSince:1 as number|undefined,engine:{threadId,turnId,turnActive:true,available:true}};
   workers.set(run.id,slot);
   return {run,slot,bind:()=>f.tasks.bind(run.id,run.epoch,threadId,turnId)};
  };
  const a=f.open('Research'),b=f.open('Review');
  assert.equal(await running(),false);
  const first=start(a.runId);
  assert.equal(await running(),false,'starting has not received an engine turn');
  first.bind();
  assert.equal(await running(),true);
  f.tasks.rpc(first.run.id,first.run.epoch,true);
  assert.equal(await running(),false,'the native turn can remain open during approval');
  f.tasks.rpc(first.run.id,first.run.epoch,false);
  first.slot.activeSince=undefined;
  assert.equal(await running(),false,'host-side approvals can pause execution without changing its phase');
  first.slot.activeSince=1;
  const second=start(b.runId);second.bind();
  assert.deepEqual(app.runningTaskIds(),[f.taskId],'two active Workers count one matter');
  for(let i=0;i<20;i++)f.tasks.createTask(f.actor,{operationId:'newer-'+i,goal:'Synthetic newer matter',authority:f.authority});
  assert.ok(!(await list()).tasks.some(task=>task.id===f.taskId));
  assert.deepEqual(app.runningTaskIds(),[f.taskId],'global badge includes an executing matter outside the first page');
  f.tasks.workerStop(f.actor,{operationId:'stop-research',workerId:a.workerId});
  assert.equal(f.tasks.run(a.runId).phase,'executing','a stop request does not prove the engine has exited');
  assert.equal(await running(),true,'another Worker is still executing');
  second.slot.engine.available=false;
  assert.equal(await running(),false,'unavailable engines and stop requests prove no current execution');
  assert.deepEqual(app.runningTaskIds(),[]);
  second.slot.engine.available=true;
  const turnId=second.slot.engine.turnId;
  second.slot.engine.turnId='other-turn';
  assert.equal(await running(),false,'the engine turn must match the current Run');
  second.slot.engine.turnId=turnId;
  workers.delete(b.runId);
  assert.equal(await running(),false,'a restarted host cannot use the database phase alone');
  workers.set(b.runId,second.slot);
  second.slot.engine.turnActive=false;
  assert.equal(await running(),false,'terminal settlement is no longer execution');
  f.tasks.endSegment(second.run.id,second.run.epoch,{status:'completed',text:'answer'},true);
  f.tasks.workerMessage(f.actor,{operationId:'review-followup',workerId:b.workerId,text:'Follow up'});
  const task=(await targetPage()).tasks[0]!;
  assert.equal(task.workers.length,2);
  assert.equal(task.workers[1]!.id,b.workerId);
  assert.notEqual(task.workers[1]!.run.id,b.runId);
  assert.equal(await running(),false,'the follow-up is only queued');
 }finally{f.close();}
});
