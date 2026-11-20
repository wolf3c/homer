import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,main,authority,openWorker,running,complete,mutation,processReplies} from './recursive-fixture.js';
function snapshot(f:ReturnType<typeof fixture>){return Object.fromEntries(['tasks','runs','task_versions','operations','agent_messages','agent_receipts'].map(table=>[table,f.store.db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()]));}

for(const outcome of ['succeeded','partial','failed','cancelled'] as const)test('settled '+outcome+' rejects new work atomically but an original committed send remains recoverable',()=>{
 const f=fixture();try{
  const input={operationId:'original',taskId:f.task.taskId,text:'Initial work'},worker=f.tasks.workerOpen(main,input),actor=running(f,worker.runId);complete(f,actor);processReplies(f);
  if(outcome==='cancelled')f.tasks.controlTask(main,{...mutation(f,'cancel'),action:'cancel'});
  else f.tasks.settleTask(main,{...mutation(f,'settle'),outcome});
  const before=snapshot(f);
  for(const attempt of [()=>openWorker(f,'new'),()=>f.tasks.workerMessage(main,{operationId:'next',workerId:worker.workerId,text:'New execution'}),()=>f.tasks.updateTask(main,{...mutation(f,'rewrite'),patch:{goal:'New execution'},authority:authority()})])assert.throws(attempt,/task_not_open|task_terminal/);
  assert.deepEqual(snapshot(f),before);assert.deepEqual(f.tasks.workerOpen(main,input),worker);assert.deepEqual(snapshot(f),before);
 }finally{f.close();}
});

for(const action of ['pause','cancel'] as const)test(action+' names the blocking Workers until each individual interruption is confirmed',()=>{
 const f=fixture();try{
  const a=openWorker(f,'a'),b=openWorker(f,'b'),aa=running(f,a.runId),bb=running(f,b.runId);
  const control=(operationId:string)=>f.tasks.controlTask(main,{...mutation(f,operationId),action});
  const before=f.tasks.runs(),blocked=control('both-live');
  assert.equal(blocked.state,'blocked');
  assert.deepEqual(new Set(blocked.blockers!.map(blocker=>blocker.workerId)),new Set([a.workerId,b.workerId]));
  assert.deepEqual(f.tasks.runs(),before);assert.equal(f.tasks.task(f.task.taskId).state,'open');
  for(const [worker,actor] of [[a,aa],[b,bb]] as const){
   const stop=f.tasks.workerStop(main,{operationId:'stop-'+worker.workerId,workerId:worker.workerId});
   const waiting=control('pending-'+worker.workerId).blockers!.find(item=>item.workerId===worker.workerId);
   assert.equal(waiting?.reason,'worker_stop_requested');
   f.tasks.confirmWorkerExit(actor.runId!,undefined);f.tasks.confirmStop(stop.operationKey,true);
   if(worker===a){
    assert.equal(f.tasks.guard(bb).id,f.task.taskId);
    assert.deepEqual(control('one-live').blockers!.map(blocker=>blocker.workerId),[b.workerId]);
   }
  }
  const result=control('all-exited');assert.deepEqual(result.targets,[]);
  assert.equal(f.tasks.task(f.task.taskId).state,action==='pause'?'paused':'settled');
  if(action==='pause'){
   f.tasks.controlTask(main,{...mutation(f,'resume'),action:'resume'});assert.equal(f.tasks.runs().length,2);assert.equal(f.tasks.claim(),undefined);
   const fresh=f.tasks.workerMessage(main,{operationId:'fresh',workerId:a.workerId,text:'Explicit followup after resume'});
   assert.equal(f.tasks.claim(fresh.runId!)?.threadId,aa.threadId);
  }else{
   const before=snapshot(f);assert.throws(()=>f.tasks.controlTask(main,{...mutation(f,'resume'),action:'resume'}),/task_authority_source_denied/);
   assert.deepEqual(snapshot(f),before);assert.equal(f.tasks.task(f.task.taskId).outcome,'cancelled');
  }
 }finally{f.close();}
});
