// Attachment grants travel with exact delivered messages and their Worker.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,main,authority,openWorker,running,complete,mutation} from './recursive-fixture.js';

const selected={assetId:'asset-00000000-0000-0000-0000-000000000001',revision:1};
const additional={assetId:'asset-00000000-0000-0000-0000-000000000002',revision:1};
const steered={assetId:'asset-00000000-0000-0000-0000-000000000003',revision:1};

test('an exact attachment follows its delivered Worker message and grants no producer authority',()=>{
 const f=fixture();try{
  const producer=openWorker(f);complete(f,running(f,producer.runId),'Original source');
  const other=f.source('consumer','Use the selected attachment');
  const input={operationId:'consumer',text:'Read selected file',authority:authority('consumer'),attachments:[selected]};
  const worker=f.tasks.workerOpen(other,input);
  assert.deepEqual(f.tasks.workerOpen(other,input),worker);
  assert.throws(()=>f.tasks.workerOpen(other,{...input,attachments:[additional]}),/operation_payload_conflict/);
  const actor=running(f,worker.runId);
  assert.deepEqual(f.tasks.workerAttachments(actor),[selected]);
  assert.throws(()=>f.tasks.workerAttachments({...actor,epoch:actor.epoch!+1}),/run_epoch_stale/);
  assert.throws(()=>f.tasks.readTask(actor,producer.taskId),/agent_scope_denied/);
  assert.throws(()=>f.tasks.workerRead(actor,{workerId:producer.workerId}),/agent_scope_denied/);
  assert.throws(()=>f.tasks.workerStop(actor,{operationId:'stop-producer',workerId:producer.workerId}),/main_required/);
  const peer=f.tasks.workerOpen(other,{operationId:'peer',taskId:worker.taskId,text:'No attachment grant'});
  assert.deepEqual(f.tasks.workerAttachments(running(f,peer.runId)),[]);
 }finally{f.close();}
});

test('queued attachments stay unavailable until offered; steer becomes visible only during exact dispatch',()=>{
 const f=fixture();try{
  const worker=f.tasks.workerOpen(main,{operationId:'open',taskId:f.task.taskId,text:'First',attachments:[selected]});
  const actor=running(f,worker.runId);
  f.tasks.workerSend(main,{operationId:'queue',workerId:worker.workerId,text:'Later',attachments:[additional]});
  const receipt=f.tasks.workerSend(main,{operationId:'steer',workerId:worker.workerId,text:'Now',immediate:true,attachments:[steered]});
  assert.deepEqual(f.tasks.workerAttachments(actor),[selected]);
  f.tasks.markSteer(receipt.operationKey,'dispatching');
  assert.deepEqual(f.tasks.workerAttachments(actor),[selected,steered]);
  assert.throws(()=>f.tasks.workerAttachments({...actor,turnId:'another-turn'}),/run_not_live/);
  f.tasks.markSteer(receipt.operationKey,'received');
  complete(f,actor);
  const next=f.tasks.claim()!;
  assert.deepEqual(f.tasks.offeredWorkerAttachments(next.id),[additional]);
  f.tasks.bind(next.id,next.epoch,actor.threadId!,'turn:followup');
  const nextActor={...actor,runId:next.id,epoch:next.epoch,turnId:'turn:followup'};
  assert.deepEqual(new Set(f.tasks.workerAttachments(nextActor).map(ref=>ref.assetId)),new Set([selected.assetId,additional.assetId,steered.assetId]));
  assert.equal(f.tasks.task(f.task.taskId).headVersion,1);
 }finally{f.close();}
});

test('a failed steering receipt and a revoked source cannot restore attachment access',()=>{
 const f=fixture();try{
  const worker=openWorker(f),actor=running(f,worker.runId);
  const receipt=f.tasks.workerSend(main,{operationId:'steer',workerId:worker.workerId,text:'Supplement',immediate:true,attachments:[selected]});
  f.tasks.markSteer(receipt.operationKey,'dispatching');f.tasks.markSteer(receipt.operationKey,'failed');
  f.tasks.updateTask(main,{...mutation(f,'notes'),patch:{notes:'Read the ungranted asset anyway'}});
  assert.deepEqual(f.tasks.workerAttachments(actor),[]);
  const source=f.source('withdrawal','Remove the old scope');
  const changed=f.tasks.updateTask(source,{...mutation(f,'change'),patch:{goal:'Use revised scope'},authority:authority('withdrawal')});
  assert.throws(()=>f.tasks.workerAttachments(actor),/epoch|stop|version|live/);
  f.tasks.confirmWorkerExit(actor.runId!,undefined);f.tasks.confirmStop(changed.operationKey,true);
  const continuation=f.tasks.workerSend(source,{operationId:'continue',workerId:worker.workerId,text:'Continue after confirmed exit'});
  assert.deepEqual(f.tasks.workerAttachments(running(f,continuation.runId!)),[]);
 }finally{f.close();}
});
