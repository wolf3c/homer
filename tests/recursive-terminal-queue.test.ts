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
  for(const attempt of [()=>openWorker(f,'new'),()=>f.tasks.workerSend(main,{operationId:'next',workerId:worker.workerId,text:'New execution'}),()=>f.tasks.updateTask(main,{...mutation(f,'rewrite'),patch:{goal:'New execution'},authority:authority()})])assert.throws(attempt,/task_not_open|task_terminal/);
  assert.deepEqual(snapshot(f),before);assert.deepEqual(f.tasks.workerOpen(main,input),worker);assert.deepEqual(snapshot(f),before);
 }finally{f.close();}
});

for(const state of ['paused','stopping'] as const)test(state+' blocks queue insertion and claiming without discarding already accepted ordinary text',()=>{
 const f=fixture();try{
  const worker=openWorker(f),actor=running(f,worker.runId),queued=f.tasks.workerSend(main,{operationId:'accepted',workerId:worker.workerId,text:'Accepted before pause'});
  const pause=f.tasks.controlTask(main,{...mutation(f,'pause'),action:'pause'});
  if(state==='paused'){f.tasks.confirmWorkerExit(actor.runId!,undefined);f.tasks.confirmStop(pause.operationKey,true);}
  const before=snapshot(f);assert.throws(()=>f.tasks.workerSend(main,{operationId:'late',workerId:worker.workerId,text:'Late write'}),/task_stop_requested|task_not_open/);
  assert.deepEqual(snapshot(f),before);assert.equal(f.tasks.claim(),undefined);
  assert.equal(f.store.db.prepare('SELECT payloadJson FROM agent_messages WHERE id=?').get(queued.messageId)!.payloadJson,JSON.stringify({workerId:worker.workerId,text:'Accepted before pause'}));
  if(state==='paused'){
   assert.equal(f.store.db.prepare('SELECT state FROM agent_receipts WHERE messageId=?').get(queued.messageId)!.state,'rejected');
   f.tasks.controlTask(main,{...mutation(f,'resume'),action:'resume'});
   assert.equal(f.tasks.claim(),undefined);
   const fresh=f.tasks.workerSend(main,{operationId:'fresh',workerId:worker.workerId,text:'Explicit followup after resume'});
   assert.equal(f.tasks.claim(fresh.runId!)?.prompt,'Explicit followup after resume');assert.equal(f.tasks.claim(),undefined);
  }
 }finally{f.close();}
});

test('cancellation rejects all pending input and denies a resume without new user authority',()=>{
 const f=fixture();try{
  const worker=openWorker(f),actor=running(f,worker.runId),queued=f.tasks.workerSend(main,{operationId:'accepted',workerId:worker.workerId,text:'Pending write'});
  const stop=f.tasks.controlTask(main,{...mutation(f,'cancel'),action:'cancel'});f.tasks.confirmWorkerExit(actor.runId!,undefined);f.tasks.confirmStop(stop.operationKey,true);
  assert.equal(f.store.db.prepare('SELECT state FROM agent_receipts WHERE messageId=?').get(queued.messageId)!.state,'rejected');
  const before=snapshot(f);assert.throws(()=>f.tasks.controlTask(main,{...mutation(f,'resume'),action:'resume'}),/task_authority_source_denied/);
  assert.deepEqual(snapshot(f),before);assert.equal(f.tasks.claim(),undefined);assert.equal(f.tasks.task(f.task.taskId).outcome,'cancelled');
 }finally{f.close();}
});
