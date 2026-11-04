import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,running,replacement,mutation,snapshot,main} from './interruption-fixture.js';
import {Homer} from '../src/service.js';

test('S14 real uncertain failure rejects replacement atomically and repeatedly through tool effects',async t=>{
 const f=fixture(t),a=running(f);f.tasks.failRun(a.runId!,a.epoch!,'synthetic_close_unconfirmed',true);
 const input=replacement(f),before=snapshot(f);
 for(let i=0;i<2;i++){
  await assert.rejects(f.tools.call(main,'task_update',{...input,independent:false}),/run_stop_unconfirmed/);
  assert.equal(snapshot(f),before);assert.deepEqual(f.effects,[]);
 }
});
for(const state of ['working','recovery','settled'])for(const status of ['interrupted','failed','cancelled','succeeded'] as const)test(`S14 phase uncertainty is independent of task=${state} and status=${status}`,t=>{
 const f=fixture(t),a=running(f);f.tasks.failRun(a.runId!,a.epoch!,'synthetic_close_unconfirmed',true);
 // Persisted synthetic combinations test the gate independently of business outcome.
 f.store.db.prepare('UPDATE tasks SET state=? WHERE id=?').run(state,f.root.taskId);
 f.store.db.prepare("UPDATE runs SET status=?,phase='uncertain' WHERE id=?").run(status,a.runId!);
 const before=snapshot(f);assert.throws(()=>f.tasks.update(main,replacement(f)),/run_stop_unconfirmed/);assert.equal(snapshot(f),before);
});
test('S14 historical accepted replacement receipt replays before fresh applicability and keeps payload conflict',t=>{
 const f=fixture(t),a=running(f),input=replacement(f);
 const accepted=f.tasks.update(main,input);assert.equal(accepted.state,'requested');
 // The same previously accepted operation is read-only even after a later unknown closure.
 f.tasks.failRun(a.runId!,f.tasks.run(a.runId!).epoch,'synthetic_close_unconfirmed',true);
 const before=snapshot(f);assert.deepEqual(f.tasks.update(main,input),accepted);assert.equal(snapshot(f),before);
 assert.throws(()=>f.tasks.update(main,{...input,contract:{...input.contract,goal:'changed'}}),/operation_payload_conflict/);assert.equal(snapshot(f),before);assert.equal(f.tasks.run(a.runId!).phase,'uncertain');
});
test('S14 live replacement still waits for confirmed stop; failure creates no replacement',t=>{
 const f=fixture(t),a=running(f);const requested=f.tasks.update(main,replacement(f));assert.equal(requested.state,'requested');assert.equal(f.store.runs().length,1);
 f.tasks.confirmStop(requested.operationKey,false);assert.equal(f.store.runs().length,1);assert.equal(f.tasks.run(a.runId!).phase,'uncertain');
 const confirmed=f.tasks.confirmStop(requested.operationKey,true);assert.equal(f.store.runs().length,2);assert.equal(f.tasks.run(confirmed.runId!).replacesRunId,a.runId);
});
test('S14 explicit stop confirmation to ended permits replacement of the same original run',t=>{
 const f=fixture(t),a=running(f);const stop=f.tasks.stop(main,{...mutation(f),scope:'self',reason:'Synthetic explicit stop'});
 f.tasks.confirmStop(stop.operationKey,true);assert.equal(f.tasks.run(a.runId!).phase,'ended');
 const next=f.tasks.update(main,replacement(f));assert.equal(next.state,'confirmed');assert.equal(f.tasks.run(next.runId!).replacesRunId,a.runId);
});
test('S14 uncertain failure with ended closure fact permits a fresh replacement',t=>{
 const f=fixture(t),a=running(f);f.tasks.failRun(a.runId!,a.epoch!,'synthetic_close_unconfirmed',true);
 // A host-confirmed ended fact is a separate input from business status.
 f.store.db.prepare("UPDATE runs SET phase='ended' WHERE id=?").run(a.runId!);
 const next=f.tasks.update(main,replacement(f));assert.equal(next.state,'confirmed');assert.equal(f.tasks.run(next.runId!).replacesRunId,a.runId);
});
for(const closed of [false,true])test(`S14 original host explicit stop: close=${closed} retains or clears owned lease accurately`,async t=>{
 const f=fixture(t),a=running(f);f.tasks.failRun(a.runId!,a.epoch!,'synthetic_close_unconfirmed',true);
 const calls:string[]=[],slot={id:a.runId,engine:{interrupt:async()=>{calls.push('interrupt');}}};
 f.store.setMeta('lease:'+a.runId,'synthetic-owned-lease');
 // No constructor or native engine. Only the existing terminal stop owner runs.
 const app=Object.assign(Object.create(Homer.prototype),{store:f.store,tasks:f.tasks,interactions:f.interactions,workers:new Map([[a.runId,slot]]),pauseClock(){},accountClocks(){},closeWorker:async()=>{calls.push('close');return closed;}}) as Homer;
 await app.stop(a.runId!);assert.deepEqual(calls,['interrupt','close']);
 assert.equal(f.tasks.run(a.runId!).phase,closed?'ended':'uncertain');
 assert.equal(f.store.meta('lease:'+a.runId),closed?undefined:'synthetic-owned-lease');
 if(closed){const next=f.tasks.update(main,replacement(f));assert.equal(f.tasks.run(next.runId!).replacesRunId,a.runId);}
 else {const before=snapshot(f);assert.throws(()=>f.tasks.update(main,replacement(f)),/run_stop_unconfirmed/);assert.equal(snapshot(f),before);}
});
