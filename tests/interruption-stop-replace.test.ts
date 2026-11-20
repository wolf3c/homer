import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,running,goalChange,snapshot,main} from './interruption-fixture.js';
import {Homer} from '../src/service.js';

test('S14 uncertain physical exit refuses a repeated followup without launching a successor',async t=>{
 const f=fixture(t),a=running(f);f.tasks.failRun(a.runId!,a.epoch!,'synthetic_close_unconfirmed',true);
 let first:unknown;
 for(let i=0;i<2;i++){
  const receipt=await f.tools.call(main,'worker_message',{workerId:f.worker.workerId,message:'Continue'},'same-followup') as {runId:string;state:string};
  if(i===0)first=receipt;else assert.deepEqual(receipt,first);
  assert.equal(receipt.runId,a.runId);assert.equal(receipt.state,'blocked');assert.equal(f.tasks.claim(),undefined);assert.equal(f.store.runs().length,1);
 }
 assert.ok(f.effects.every(effect=>effect==='wake'));
 assert.equal(f.tasks.workerRead(main,{workerId:f.worker.workerId}).messages.filter(message=>message.kind==='worker_input').length,1);
});
for(const code of ['restart_unconfirmed','engine_stop_unconfirmed'])test('ended phase without its exact exit checkpoint stays fenced: '+code,t=>{
 const f=fixture(t),a=running(f);f.tasks.failRun(a.runId!,a.epoch!,code,true);
 f.store.db.prepare("UPDATE runs SET phase='ended' WHERE id=?").run(a.runId!);
 const before=f.tasks.runs();
 assert.equal(f.tasks.workerMessage(main,{operationId:'followup',workerId:f.worker.workerId,text:'Continue'}).reason,'run_stop_unconfirmed');
 assert.deepEqual(f.tasks.runs(),before);
});
for(const state of ['open','paused','archived'])for(const status of ['interrupted','failed','cancelled','succeeded'] as const)test('S14 uncertainty cannot launch a successor for task='+state+', run='+status,t=>{
 const f=fixture(t),a=running(f);f.tasks.failRun(a.runId!,a.epoch!,'synthetic_close_unconfirmed',true);
 if(state==='archived')f.store.db.prepare("UPDATE tasks SET historyState='archived' WHERE id=?").run(f.task.taskId);
 else f.store.db.prepare('UPDATE tasks SET state=? WHERE id=?').run(state,f.task.taskId);
 f.store.db.prepare("UPDATE runs SET status=?,phase='uncertain' WHERE id=?").run(status,a.runId!);
 const before=snapshot(f),send=()=>f.tasks.workerMessage(main,{operationId:'followup',workerId:f.worker.workerId,text:'Continue'});
 if(state==='open'){assert.equal(send().state,'blocked');assert.equal(f.tasks.claim(),undefined);assert.equal(f.store.runs().length,1);}
 else{assert.throws(send,state==='archived'?/task_history_not_visible/:/task_not_open/);assert.equal(snapshot(f),before);}
});
test('S14 an accepted goal-change receipt replays before applicability and retains payload conflicts',t=>{
 const f=fixture(t),a=running(f),input=goalChange(f),accepted=f.tasks.updateTask(main,input);
 assert.equal(accepted.state,'updated');f.store.db.prepare("UPDATE runs SET phase='uncertain' WHERE id=?").run(a.runId!);
 const before=snapshot(f);assert.deepEqual(f.tasks.updateTask(main,input),accepted);assert.equal(snapshot(f),before);
 assert.throws(()=>f.tasks.updateTask(main,{...input,patch:{goal:'Different requirement'}}),/operation_payload_conflict/);assert.equal(snapshot(f),before);
 assert.equal(f.tasks.run(a.runId!).phase,'uncertain');
});
test('S14 goal change creates no successor until physical exit and explicit followup',t=>{
 const f=fixture(t),a=running(f),requested=f.tasks.updateTask(main,goalChange(f));
 assert.equal(requested.state,'updated');assert.equal(f.store.runs().length,1);
 const stop=f.tasks.workerStop(main,{operationId:'explicit-stop',workerId:f.worker.workerId});
 f.tasks.confirmStop(stop.operationKey,false);assert.equal(f.tasks.run(a.runId!).phase,'uncertain');
 assert.equal(f.tasks.workerMessage(main,{operationId:'too-early',workerId:f.worker.workerId,text:'Continue'}).state,'blocked');
 assert.throws(()=>f.tasks.confirmStop(stop.operationKey,true),/run_stop_unconfirmed/);
 f.tasks.confirmWorkerExit(a.runId!,undefined);f.tasks.confirmStop(stop.operationKey,true);assert.equal(f.store.runs().length,1);
 const next=f.tasks.workerMessage(main,{operationId:'followup',workerId:f.worker.workerId,text:'Continue with new goal'});
 assert.ok(next.runId);assert.equal(f.tasks.run(next.runId!).version,2);assert.equal(f.tasks.run(next.runId!).threadId,a.threadId);assert.equal(f.tasks.run(next.runId!).workerId,f.worker.workerId);
});
test('S14 confirmed explicit stop permits a new goal and same-session followup',t=>{
 const f=fixture(t),a=running(f),stop=f.tasks.workerStop(main,{operationId:'stop',workerId:f.worker.workerId,reason:'Synthetic explicit stop'});
 f.tasks.confirmWorkerExit(a.runId!,undefined);f.tasks.confirmStop(stop.operationKey,true);assert.equal(f.tasks.run(a.runId!).phase,'ended');
 assert.equal(f.tasks.updateTask(main,goalChange(f)).state,'updated');
 const next=f.tasks.workerMessage(main,{operationId:'followup',workerId:f.worker.workerId,text:'Continue'});assert.equal(f.tasks.run(next.runId!).threadId,a.threadId);
});
test('S14 only the exact original lease can confirm an uncertain exit',t=>{
 const f=fixture(t),a=running(f);f.tasks.failRun(a.runId!,a.epoch!,'synthetic_close_unconfirmed',true);const lease='synthetic-original-owner';f.store.setMeta('lease:'+a.runId,lease);
 assert.equal(f.tasks.confirmWorkerExit(a.runId!,'different-owner'),false);assert.equal(f.store.meta('lease:'+a.runId),lease);
 assert.equal(f.tasks.workerMessage(main,{operationId:'too-early',workerId:f.worker.workerId,text:'Continue'}).state,'blocked');assert.equal(f.tasks.claim(),undefined);
 assert.equal(f.tasks.confirmWorkerExit(a.runId!,lease),true);f.tasks.updateTask(main,goalChange(f));
 const next=f.tasks.workerMessage(main,{operationId:'followup',workerId:f.worker.workerId,text:'Continue'});assert.equal(f.tasks.run(next.runId!).replacesRunId,a.runId);
});
for(const closed of [false,true])test('S14 actual terminal stop owner: close='+closed+' retains or clears the exact lease',async t=>{
 const f=fixture(t),a=running(f);f.tasks.failRun(a.runId!,a.epoch!,'synthetic_close_unconfirmed',true);
 const calls:string[]=[],slot={id:a.runId,lease:'synthetic-owned-lease',engine:{interrupt:async()=>{calls.push('interrupt');},close:async()=>{calls.push('close');return closed;}}};f.store.setMeta('lease:'+a.runId,slot.lease);
 const app=Object.assign(Object.create(Homer.prototype),{store:f.store,tasks:f.tasks,interactions:f.interactions,workers:new Map([[a.runId,slot]]),scheduleCalls:new HostToolCalls(),mainApprovals:{end(){}},pauseClock(){},accountClocks(){}}) as Homer;
 await app.stop(a.runId!);assert.deepEqual(calls,['interrupt','close']);assert.equal(f.tasks.run(a.runId!).phase,closed?'ended':'uncertain');assert.equal(f.store.meta('lease:'+a.runId),closed?undefined:slot.lease);
 if(closed)assert.ok(f.tasks.workerMessage(main,{operationId:'followup',workerId:f.worker.workerId,text:'Continue'}).runId);
 else{assert.equal(f.tasks.workerMessage(main,{operationId:'followup',workerId:f.worker.workerId,text:'Continue'}).state,'blocked');assert.equal(f.tasks.claim(),undefined);assert.equal(f.store.runs().length,1);}
});
import {HostToolCalls} from '../src/host-tool-calls.js';

test('retrying an unconfirmed Worker stop checks the owner again and releases the original pause blocker',async t=>{
 const f=fixture(t),actor=running(f),runId=actor.runId!,workerId=f.worker.workerId;
 let closes=0;
 const slot={id:runId,lease:'test-lease',engine:{interrupt:async()=>{},close:async()=>++closes===2}};
 f.store.setMeta('lease:'+runId,slot.lease);
 const app=Object.assign(Object.create(Homer.prototype),{
  store:f.store,tasks:f.tasks,interactions:f.interactions,workers:new Map([[runId,slot]]),scheduleCalls:new HostToolCalls(),
  mainApprovals:{end(){}},pauseClock(){},pump(){},scheduleInternal(){}
 }) as Homer;
 const stop=(operationId:string)=>app['applyStop'](f.tasks.workerStop(main,{operationId,workerId}));
 const pause=(operationId:string)=>f.tasks.controlTask(main,{action:'pause',taskId:f.task.taskId,expectedRevision:f.tasks.task(f.task.taskId).revision,operationId});
 const first=await stop('first-stop');
 assert.equal(first.state,'uncertain');
 assert.deepEqual(await stop('first-stop'),first);
 assert.equal(closes,1);
 const paused=pause('while-stopping');assert.equal(paused.state,'paused');assert.ok(paused.blockers?.some(b=>b.runId===runId));
 const retry=await stop('retry-stop');
 assert.equal(retry.state,'confirmed');assert.notEqual(retry.operationKey,first.operationKey);
 assert.deepEqual(await stop('first-stop'),{...first,state:'confirmed'});
 assert.deepEqual(await stop('retry-stop'),retry);assert.equal(closes,2);
 assert.deepEqual(pause('after-exit').blockers,[]);
});
