// Stable Result adoption, publication and Task settlement are independent choices.
import test from 'node:test';
import assert from 'node:assert/strict';
import {RecursiveTools} from '../src/recursive-tools.js';
import {fixture,main,authority,openWorker,running,complete,mutation,processReplies} from './recursive-fixture.js';

test('explicit text adoption preserves exact source and is idempotent, without publication or task settlement',()=>{
 const f=fixture();try{
  const worker=openWorker(f),actor=running(f,worker.runId),reply=complete(f,actor,'Unknown date.\n\nExact second paragraph.');
  assert.equal(f.tasks.readTask(main,f.task.taskId).results.length,0);
  const input={operationId:'adopt',taskId:f.task.taskId,version:1,messageId:reply.messageId},adopted=f.tasks.adoptResult(main,input);
  assert.deepEqual(f.tasks.adoptResult(main,input),adopted);assert.equal(f.tasks.readResult(main,adopted.resultId).payload.text,'Unknown date.\n\nExact second paragraph.');
  assert.equal(f.tasks.deliveries().length,0);assert.equal(f.tasks.task(f.task.taskId).outcome,null);
  assert.throws(()=>f.tasks.adoptResult(main,{...input,messageId:worker.messageId}),/payload_conflict/);
  assert.throws(()=>f.tasks.adoptResult(main,{operationId:'source-required',taskId:f.task.taskId,version:1}),/result_source_required/);
 }finally{f.close();}
});

test('formal publishing selects accepted exact-version results and never settles the task',()=>{
 const f=fixture();try{
  const worker=openWorker(f),actor=running(f,worker.runId),reply=complete(f,actor),result=f.tasks.adoptResult(main,{operationId:'adopt',taskId:f.task.taskId,version:1,messageId:reply.messageId});
  const input={operationId:'publish',taskId:f.task.taskId,version:1,resultIds:[result.resultId],text:'Synthetic formal result'},receipt=f.tasks.publish(main,input);
  assert.equal(receipt.state,'prepared');assert.deepEqual(f.tasks.publish(main,input),receipt);assert.equal(f.tasks.task(f.task.taskId).outcome,null);assert.equal(f.tasks.pendingDeliveries().length,1);
  assert.throws(()=>f.tasks.publish(main,{...input,operationId:'wrong-source',sourceRequestId:'foreign'}),/source_unresolved/);
  f.tasks.markDelivery(receipt.deliveryId,'submitting');f.tasks.markDelivery(receipt.deliveryId,'recorded');processReplies(f);
  f.tasks.settleTask(main,{...mutation(f,'settle'),outcome:'succeeded'});assert.equal(f.tasks.delivery(receipt.deliveryId).state,'recorded');
 }finally{f.close();}
});

test('publication rejects another Task result, unknown IDs and empty selections with no Delivery',()=>{
 const f=fixture();try{
  const worker=openWorker(f),actor=running(f,worker.runId),reply=complete(f,actor),result=f.tasks.adoptResult(main,{operationId:'adopt',taskId:f.task.taskId,version:1,messageId:reply.messageId});
  const other=f.tasks.createTask(main,{operationId:'other',goal:'Other task',authority:authority()});
  assert.throws(()=>f.tasks.adoptResult(main,{operationId:'cross-task-adopt',taskId:other.taskId,version:1,messageId:reply.messageId}),/result_source_denied/);
  for(const [taskId,resultIds] of [[other.taskId,[result.resultId]],[f.task.taskId,['result-missing']],[f.task.taskId,[]]] as [string,string[]][])assert.throws(()=>f.tasks.publish(main,{operationId:'deny:'+taskId+resultIds.join(','),taskId,version:1,resultIds,text:'Wrong selection'}),/result_not_accepted|result_not_found|result_required/);
  assert.equal(f.tasks.deliveries().length,0);
 }finally{f.close();}
});

test('public tool validation exposes schema paths without echoing private property names or values',async()=>{
 const f=fixture();try{
  const api=new RecursiveTools(f.tasks,{rootAuthority:()=>authority(),wake(){},stop:async r=>r,steer:async r=>r});
  await assert.rejects(()=>api.call(main,'publish_delivery',{private_argument_name:'PRIVATE_VALUE'},'invalid'),error=>{
   assert.equal((error as Error).message,'invalid_tool_arguments');assert.doesNotMatch(JSON.stringify(error),/private_argument_name|PRIVATE_VALUE/);return true;
  });
  assert.equal(f.tasks.deliveries().length,0);assert.equal(f.tasks.runs().length,0);
 }finally{f.close();}
});

test('new requirements revoke only a prepared old-version publication and preserve adopted evidence',()=>{
 const f=fixture();try{
  const worker=openWorker(f),actor=running(f,worker.runId),reply=complete(f,actor),result=f.tasks.adoptResult(main,{operationId:'adopt',taskId:f.task.taskId,version:1,messageId:reply.messageId});
  const input={operationId:'publish',taskId:f.task.taskId,version:1,resultIds:[result.resultId],text:'Old prepared delivery'},delivery=f.tasks.publish(main,input),source=f.source('changed','Change the requirements');
  f.tasks.updateTask(source,{...mutation(f,'change'),patch:{goal:'New requirements'},authority:authority(source.sourceRequestId)});
  assert.equal(f.tasks.delivery(delivery.deliveryId).state,'revoked');assert.equal(f.tasks.readResult(main,result.resultId).version,1);
  assert.throws(()=>f.tasks.publish(main,{...input,operationId:'late-old-version'}),/delivery_version_conflict/);assert.equal(f.tasks.pendingDeliveries().length,0);
 }finally{f.close();}
});
