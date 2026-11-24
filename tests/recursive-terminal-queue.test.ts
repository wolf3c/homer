import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,main,openWorker,running,complete,mutation,processReplies} from './recursive-fixture.js';
function snapshot(f:ReturnType<typeof fixture>){return Object.fromEntries(['tasks','runs','task_versions','operations','agent_messages','agent_receipts'].map(table=>[table,f.store.db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()]));}

test('a confirmed first spawn failure allows a new attempt under the same Worker identity',()=>{
 const f=fixture();try{
  const worker=openWorker(f),run=f.tasks.claim(worker.runId)!;
  const failure={status:'failed',text:'',errorCode:'engine_spawn_failed'} as const;
  f.tasks.endSegment(run.id,run.epoch,failure,true);
  const input={operationId:'retry',workerId:worker.workerId,text:'Continue the original assignment'};
  const reply=f.tasks.workerMessage(main,input);
  assert.equal(reply.state,'queued');
  assert.deepEqual(f.tasks.workerMessage(main,input),reply);
  assert.equal(reply.workerId,worker.workerId);
  assert.notEqual(reply.runId,run.id);
  const retry=f.tasks.claim(reply.runId)!;
  assert.equal(retry.replacesRunId,run.id);
  assert.equal(retry.threadId,null);
  f.tasks.bind(retry.id,retry.epoch,'first-native-thread','first-native-turn');
  assert.equal(f.tasks.worker(worker.workerId).threadId,'first-native-thread');
  assert.equal(f.tasks.run(run.id).errorCode,'engine_spawn_failed');
 }finally{f.close();}
});

test('a spawn error with uncertain exit or evidence of a process cannot start a new native thread',()=>{
 for(const [exitConfirmed,pid,reason] of [[false,null,'run_stop_unconfirmed'],[true,12345,'worker_thread_unavailable']] as const){
  const f=fixture();try{
   const worker=openWorker(f),run=f.tasks.claim(worker.runId)!;
   if(pid!==null)f.store.engine(run.id,{pid});
   f.tasks.endSegment(run.id,run.epoch,{status:'failed',text:'',errorCode:'engine_spawn_failed'},exitConfirmed);
   const reply=f.tasks.workerMessage(main,{operationId:'retry',workerId:worker.workerId,text:'Continue the original assignment'});
   assert.equal(reply.reason,reason);
   assert.equal(f.tasks.runs().length,1);
  }finally{f.close();}
 }
});

test('a paused task rejects new work atomically but an original committed send remains recoverable',()=>{
 const f=fixture();try{
  const input={operationId:'original',taskId:f.task.taskId,text:'Initial work'},worker=f.tasks.workerOpen(main,input),actor=running(f,worker.runId);complete(f,actor);processReplies(f);
  f.tasks.controlTask(main,{...mutation(f,'pause'),action:'pause'});
  const before=snapshot(f);
  for(const attempt of [()=>openWorker(f,'new'),()=>f.tasks.workerMessage(main,{operationId:'next',workerId:worker.workerId,text:'New execution'})])assert.throws(attempt,/task_not_open|task_terminal/);
  assert.deepEqual(snapshot(f),before);assert.deepEqual(f.tasks.workerOpen(main,input),worker);assert.deepEqual(snapshot(f),before);
 }finally{f.close();}
});

test('pause names the blocking Workers until each individual interruption is confirmed',()=>{
 const f=fixture();try{
  const a=openWorker(f,'a'),b=openWorker(f,'b'),aa=running(f,a.runId),bb=running(f,b.runId);
  const control=(operationId:string)=>f.tasks.controlTask(main,{...mutation(f,operationId),action:'pause'});
  const before=f.tasks.runs(),blocked=control('both-live');
  assert.equal(blocked.state,'paused');
  assert.deepEqual(new Set(blocked.blockers!.map(blocker=>blocker.workerId)),new Set([a.workerId,b.workerId]));
  assert.deepEqual(f.tasks.runs(),before);assert.equal(f.tasks.task(f.task.taskId).state,'paused');
  for(const [worker,actor] of [[a,aa],[b,bb]] as const){
   const stop=f.tasks.workerStop(main,{operationId:'stop-'+worker.workerId,workerId:worker.workerId});
   const waiting=control('pending-'+worker.workerId).blockers!.find(item=>item.workerId===worker.workerId);
   assert.equal(waiting?.reason,'worker_stop_requested');
   f.tasks.confirmWorkerExit(actor.runId!,undefined);f.tasks.confirmStop(stop.operationKey,true);
   if(worker===a){
    assert.throws(()=>f.tasks.guard(bb),/task_not_open/);
    assert.equal(f.tasks.run(bb.runId!).status,'running');
    assert.deepEqual(control('one-live').blockers!.map(blocker=>blocker.workerId),[b.workerId]);
   }
  }
  const result=control('all-exited');assert.deepEqual(result.targets,[]);
  assert.equal(f.tasks.task(f.task.taskId).state,'paused');
  const permit={...main,sourceRequestId:undefined};
  f.tasks.controlTask(permit,{...mutation(f,'resume'),action:'resume'});
  assert.equal(f.tasks.runs().length,2);assert.equal(f.tasks.claim(),undefined);
  const fresh=f.tasks.workerMessage(permit,{operationId:'fresh',workerId:a.workerId,text:'Explicit followup after resume'});
  assert.equal(f.tasks.claim(fresh.runId!)?.threadId,aa.threadId);
 }finally{f.close();}
});


test('a pause fences queued starts by id and by queue order, including after restart',()=>{
 const f=fixture();try{
  const queued=openWorker(f),pause=f.tasks.controlTask(main,{...mutation(f,'pause-before-start'),action:'pause'});
  assert.equal(pause.state,'paused');assert.equal(pause.blockers?.[0]?.runId,queued.runId);
  assert.equal(f.tasks.claim(queued.runId),undefined);assert.equal(f.tasks.claim(),undefined);
  f.tasks.reconcile();assert.equal(f.tasks.run(queued.runId).status,'interrupted');
  assert.equal(f.tasks.task(f.task.taskId).state,'paused');assert.equal(f.tasks.claim(),undefined);
 }finally{f.close();}
});
