import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,running,goalChange,snapshot,main} from './interruption-fixture.js';
import {Homer} from '../src/service.js';

test('S14 uncertain physical exit queues one idempotent followup without launching a successor',async t=>{
 const f=fixture(t),a=running(f);f.tasks.failRun(a.runId!,a.epoch!,'synthetic_close_unconfirmed',true);
 let first:unknown;
 for(let i=0;i<2;i++){
  const receipt=await f.tools.call(main,'worker_send',{workerId:f.worker.workerId,message:'Continue'},'same-followup') as {runId:string|null};
  if(i===0)first=receipt;else assert.deepEqual(receipt,first);
  assert.equal(receipt.runId,null);assert.equal(f.tasks.claim(),undefined);assert.equal(f.store.runs().length,1);
 }
 assert.deepEqual(f.effects,['wake','wake']);
 assert.equal(f.tasks.workerRead(main,{workerId:f.worker.workerId}).messages.filter(message=>message.kind==='worker_input').length,2);
});
for(const code of ['restart_unconfirmed','engine_stop_unconfirmed'])test('ended phase without its exact exit checkpoint stays fenced: '+code,t=>{
 const f=fixture(t),a=running(f);f.tasks.failRun(a.runId!,a.epoch!,code,true);
 f.store.db.prepare("UPDATE runs SET phase='ended' WHERE id=?").run(a.runId!);
 const before=snapshot(f);
 assert.throws(()=>f.tasks.workerSend(main,{operationId:'followup',workerId:f.worker.workerId,text:'Continue'}),/run_stop_unconfirmed/);
 assert.equal(snapshot(f),before);
});
for(const state of ['open','paused','settled'])for(const status of ['interrupted','failed','cancelled','succeeded'] as const)test('S14 uncertainty cannot launch a successor for task='+state+', run='+status,t=>{
 const f=fixture(t),a=running(f);f.tasks.failRun(a.runId!,a.epoch!,'synthetic_close_unconfirmed',true);
 f.store.db.prepare('UPDATE tasks SET state=? WHERE id=?').run(state,f.task.taskId);
 f.store.db.prepare("UPDATE runs SET status=?,phase='uncertain' WHERE id=?").run(status,a.runId!);
 const before=snapshot(f),send=()=>f.tasks.workerSend(main,{operationId:'followup',workerId:f.worker.workerId,text:'Continue'});
 if(state==='open'){assert.equal(send().runId,null);assert.equal(f.tasks.claim(),undefined);assert.equal(f.store.runs().length,1);}
 else{assert.throws(send,/task_not_open/);assert.equal(snapshot(f),before);}
});
test('S14 an accepted goal-change receipt replays before applicability and retains payload conflicts',t=>{
 const f=fixture(t),a=running(f),input=goalChange(f),accepted=f.tasks.updateTask(main,input);
 assert.equal(accepted.state,'requested');f.store.db.prepare("UPDATE runs SET phase='uncertain' WHERE id=?").run(a.runId!);
 const before=snapshot(f);assert.deepEqual(f.tasks.updateTask(main,input),accepted);assert.equal(snapshot(f),before);
 assert.throws(()=>f.tasks.updateTask(main,{...input,patch:{goal:'Different requirement'}}),/operation_payload_conflict/);assert.equal(snapshot(f),before);
 assert.equal(f.tasks.run(a.runId!).phase,'uncertain');
});
test('S14 goal change creates no successor until physical exit and explicit followup',t=>{
 const f=fixture(t),a=running(f),requested=f.tasks.updateTask(main,goalChange(f));
 assert.equal(requested.state,'requested');assert.equal(f.store.runs().length,1);
 f.tasks.confirmStop(requested.operationKey,false);assert.equal(f.tasks.run(a.runId!).phase,'uncertain');
 assert.throws(()=>f.tasks.workerSend(main,{operationId:'too-early',workerId:f.worker.workerId,text:'Continue'}),/task_stop_requested/);
 assert.throws(()=>f.tasks.confirmStop(requested.operationKey,true),/run_stop_unconfirmed/);
 f.tasks.confirmWorkerExit(a.runId!,undefined);f.tasks.confirmStop(requested.operationKey,true);assert.equal(f.store.runs().length,1);
 const next=f.tasks.workerSend(main,{operationId:'followup',workerId:f.worker.workerId,text:'Continue with new goal'});
 assert.ok(next.runId);assert.equal(f.tasks.run(next.runId!).version,2);assert.equal(f.tasks.run(next.runId!).threadId,a.threadId);assert.equal(f.tasks.run(next.runId!).workerId,f.worker.workerId);
});
test('S14 confirmed explicit stop permits a new goal and same-session followup',t=>{
 const f=fixture(t),a=running(f),stop=f.tasks.workerStop(main,{operationId:'stop',workerId:f.worker.workerId,reason:'Synthetic explicit stop'});
 f.tasks.confirmWorkerExit(a.runId!,undefined);f.tasks.confirmStop(stop.operationKey,true);assert.equal(f.tasks.run(a.runId!).phase,'ended');
 assert.equal(f.tasks.updateTask(main,goalChange(f)).state,'updated');
 const next=f.tasks.workerSend(main,{operationId:'followup',workerId:f.worker.workerId,text:'Continue'});assert.equal(f.tasks.run(next.runId!).threadId,a.threadId);
});
test('S14 only the exact original lease can confirm an uncertain exit',t=>{
 const f=fixture(t),a=running(f);f.tasks.failRun(a.runId!,a.epoch!,'synthetic_close_unconfirmed',true);const lease='synthetic-original-owner';f.store.setMeta('lease:'+a.runId,lease);
 assert.equal(f.tasks.confirmWorkerExit(a.runId!,'different-owner'),false);assert.equal(f.store.meta('lease:'+a.runId),lease);
 assert.equal(f.tasks.workerSend(main,{operationId:'too-early',workerId:f.worker.workerId,text:'Continue'}).runId,null);assert.equal(f.tasks.claim(),undefined);
 assert.equal(f.tasks.confirmWorkerExit(a.runId!,lease),true);f.tasks.updateTask(main,goalChange(f));
 const next=f.tasks.workerSend(main,{operationId:'followup',workerId:f.worker.workerId,text:'Continue'});assert.equal(f.tasks.run(next.runId!).replacesRunId,a.runId);
});
for(const closed of [false,true])test('S14 actual terminal stop owner: close='+closed+' retains or clears the exact lease',async t=>{
 const f=fixture(t),a=running(f);f.tasks.failRun(a.runId!,a.epoch!,'synthetic_close_unconfirmed',true);
 const calls:string[]=[],slot={id:a.runId,lease:'synthetic-owned-lease',engine:{interrupt:async()=>{calls.push('interrupt');},close:async()=>{calls.push('close');return closed;}}};f.store.setMeta('lease:'+a.runId,slot.lease);
 const app=Object.assign(Object.create(Homer.prototype),{store:f.store,tasks:f.tasks,interactions:f.interactions,workers:new Map([[a.runId,slot]]),mainApprovals:{end(){}},pauseClock(){},accountClocks(){}}) as Homer;
 await app.stop(a.runId!);assert.deepEqual(calls,['interrupt','close']);assert.equal(f.tasks.run(a.runId!).phase,closed?'ended':'uncertain');assert.equal(f.store.meta('lease:'+a.runId),closed?undefined:slot.lease);
 if(closed)assert.ok(f.tasks.workerSend(main,{operationId:'followup',workerId:f.worker.workerId,text:'Continue'}).runId);
 else{assert.equal(f.tasks.workerSend(main,{operationId:'followup',workerId:f.worker.workerId,text:'Continue'}).runId,null);assert.equal(f.tasks.claim(),undefined);assert.equal(f.store.runs().length,1);}
});
