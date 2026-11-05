// Real business and projection owners with isolated synthetic history.
import test from 'node:test';import assert from 'node:assert/strict';
import {chatFixture} from './task-chat-fixture.js';import {MainProcessHistory} from '../src/main-process.js';import {Homer} from '../src/service.js';import {syntheticFile} from './recursive-publication-fixture.js';
function fixture(){const f=chatFixture(),processes=new MainProcessHistory(f.store.db),make=(id:string,title='同名事项')=>f.tasks.createTask(f.actor,{operationId:id,title,goal:'PRIVATE_GOAL',authority:f.authority});return {...f,processes,make};}
test('owner records exact public action and receipt, never raw payload or arbitrary transport success',()=>{
 const f=fixture();try{
  const a=f.make('a'),b=f.make('b');for(const task of [a,b]){const result=f.tasks.readTask(f.actor,task.taskId),fact=f.tasks.captureActivity(f.actor,'work_inspect',{taskId:task.taskId},result)!;assert.equal(fact.action,'inspect_task');assert.equal(fact.objectName,'同名事项');assert.equal(fact.target?.taskId,task.taskId);assert.equal(fact.target?.version,1);assert.doesNotMatch(JSON.stringify(fact),/PRIVATE_|goal|authority|payload/);}
  assert.equal(f.tasks.captureActivity(f.actor,'publish_delivery',{taskId:a.taskId,version:1},{state:'completed'}),undefined);
  assert.equal(f.tasks.captureActivity(f.actor,'work_inspect',{taskId:a.taskId},{task:{id:b.taskId}}),undefined);
 }finally{f.close();}
});
test('activity links enforce thread, exact version, Run and result relations',()=>{
 const f=fixture();try{const a=f.make('a'),b=f.make('b'),target={taskId:a.taskId,version:1};assert.equal(f.tasks.activityLink(target,'thread:main')?.task.taskId,a.taskId);for(const wrong of [{...target,version:2},{...target,runId:'missing'},{...target,resultId:'missing'},{...target,deliveryId:'missing'}])assert.equal(f.tasks.activityLink(wrong,'thread:main'),undefined);assert.equal(f.tasks.activityLink(target,'other-thread'),undefined);assert.equal(f.tasks.activityLink({taskId:b.taskId,version:1},'other-thread'),undefined);}finally{f.close();}
});
test('same call updates original ID/revision while optional facts stay out of progress channel events',async()=>{
 const f=fixture();try{
  const task=f.make('a');f.processes.start({id:'live',threadId:'thread:main',sourceKind:'user',sourceMessageIds:[],messageId:'live'},'turn');f.history.record('live','thread:main','','running');
  const output:any[]=[],context:any={processId:'live',generation:{threadId:'thread:main',messageId:'live',turnId:'turn'}},app:any=Object.assign(Object.create(Homer.prototype),{tasks:f.tasks,processes:f.processes,history:f.history,mainContext:context,store:f.store,emit:async(e:any)=>output.push(e),mainActor:()=>f.actor,validateMainContext(){}});
  const result=await app.mainActivity('work_inspect',async()=>f.tasks.readTask(f.actor,task.taskId),{taskId:task.taskId});await context.output;const items=f.processes.exact('live')!.items.filter(i=>i.kind==='tool');assert.equal(items.length,1);assert.equal(items[0]!.revision,2);assert.equal(items[0]!.activity?.target?.taskId,task.taskId);assert.equal(result.task.id,task.taskId);assert.equal(output.length,2);assert.ok(output.every(e=>!JSON.stringify(e).includes('同名事项')&&!JSON.stringify(e).includes('record_read')));
  app.tasks={captureActivity(){throw Error('synthetic_fact_failure');}};assert.deepEqual(await app.mainActivity('work_inspect',async()=>({returned:true}),{}),{returned:true});
 }finally{f.close();}
});
test('explicit adoption and publication retain immutable receipts and require exact recorded history for navigation',()=>{
 const f=fixture();try{
  const task=f.make('review'),worker=f.tasks.workerOpen(f.actor,{operationId:'open',taskId:task.taskId,text:'Inspect'}),run=f.start(worker.workerId),reply=f.tasks.endSegment(run.id,run.epoch,{status:'completed',text:'PRIVATE_PAYLOAD'},true)!;
  const args={operationId:'adopt',taskId:task.taskId,version:1,messageId:reply.messageId},receipt=f.tasks.adoptResult(f.actor,args),fact=f.tasks.captureActivity(f.actor,'accept_result',args,receipt)!;assert.equal(fact.outcome,'accepted');assert.equal(fact.target?.resultId,receipt.resultId);assert.doesNotMatch(JSON.stringify(fact),/PRIVATE_|reason/);
  const publishArgs={operationId:'publish',taskId:task.taskId,version:1,resultIds:[receipt.resultId],text:'Formal answer'},published=f.tasks.publish(f.actor,publishArgs),prepared=f.tasks.captureActivity(f.actor,'publish_delivery',publishArgs,published)!;assert.equal(prepared.outcome,'delivery_prepared');assert.equal(f.tasks.activityLink(prepared.target!,'thread:main')?.messageId,undefined);
  f.tasks.markDelivery(published.deliveryId,'submitting');f.tasks.markDelivery(published.deliveryId,'recorded');assert.equal(prepared.outcome,'delivery_prepared');assert.equal(f.tasks.activityLink(prepared.target!,'thread:main')?.messageId,undefined);f.history.record(published.historyMessageId,'thread:main','Formal answer');assert.equal(f.tasks.activityLink(prepared.target!,'thread:main')?.messageId,published.historyMessageId);f.tasks.markDelivery(published.deliveryId,'revoked');assert.equal(f.tasks.activityLink(prepared.target!,'thread:main'),undefined);
 }finally{f.close();}
});
test('Web process detail rechecks epoch/thread and resolves only the selected activity',async()=>{
 const f=fixture();try{
  const task=f.make('a'),activity=f.tasks.captureActivity(f.actor,'work_inspect',{taskId:task.taskId},f.tasks.readTask(f.actor,task.taskId));f.processes.start({id:'activity-node',threadId:'thread:main',sourceKind:'user',sourceMessageIds:[],messageId:'activity-node'},'turn');f.processes.tool('activity-node',{id:'call',label:'检查资料',phase:'end',status:'completed',activity});f.processes.tool('activity-node',{id:'generic',label:'检查资料',phase:'end',status:'completed'});
  const app:any={...f,webReadEpoch:'epoch',registerChannelCapabilities(){},webHistoryPages:()=>({process(id:string,thread:string){const node=f.processes.exact(id);if(node?.threadId!==thread)throw Error('history_process_not_found');return node;}})},bridge=(await import('../src/web-homer.js')).homerWebBridge(app);let resolutions=0;const resolve=f.tasks.activityLink.bind(f.tasks);f.tasks.activityLink=(...args)=>{resolutions++;return resolve(...args);};
  assert.deepEqual((await bridge.history!.process({readEpoch:'epoch',id:'activity-node'})).activityLinks,{});assert.equal(resolutions,0);const detail=await bridge.history!.process({readEpoch:'epoch',id:'activity-node',itemId:'call'});assert.equal(resolutions,1);assert.equal(detail.activityLinks?.call?.task.taskId,task.taskId);assert.equal(detail.activityLinks?.generic,undefined);await assert.rejects(bridge.history!.process({readEpoch:'epoch',id:'activity-node',itemId:'missing'}),/history_activity_not_found/);await assert.rejects(bridge.history!.process({readEpoch:'old',id:'activity-node'}),/epoch_changed/);f.store.setMeta('mainThread','other');await assert.rejects(bridge.history!.process({readEpoch:'epoch',id:'activity-node'}),/process_not_found/);
 }finally{f.close();}
});
test('later goal and followup do not rewrite a historical adoption version',()=>{
 const f=fixture();try{
  const task=f.make('changes'),w=f.tasks.workerOpen(f.actor,{operationId:'open',taskId:task.taskId,text:'Inspect'}),run=f.start(w.workerId),reply=f.tasks.endSegment(run.id,run.epoch,{status:'completed',text:'First reply'},true)!,args={operationId:'adopt',taskId:task.taskId,version:1,messageId:reply.messageId},accepted=f.tasks.adoptResult(f.actor,args),fact=f.tasks.captureActivity(f.actor,'accept_result',args,accepted)!;f.tasks.updateTask(f.actor,{operationId:'change',taskId:task.taskId,expectedRevision:1,patch:{goal:'Changed scope'},authority:f.authority});f.tasks.workerSend(f.actor,{operationId:'followup',workerId:w.workerId,text:'Continue'});assert.equal(fact.target?.version,1);assert.equal(fact.target?.resultId,accepted.resultId);assert.equal(f.tasks.activityLink(fact.target!,'thread:main')?.task.version,1);
 }finally{f.close();}
});
test('file publication navigation requires its exact recorded message; revocation removes the grant',()=>{
 const f=fixture();try{
  const file=syntheticFile(f as any,f.actor.sourceRequestId!,'activity-public.md','# Synthetic file'),delivery=file.publish(),target={taskId:delivery.taskId,version:1,runId:file.run.id,resultId:file.resultId};assert.equal(f.tasks.activityLink(target,'thread:main')?.artifact?.id,file.resultId);assert.equal(f.tasks.activityLink(target,'thread:main')?.messageId,undefined);f.tasks.markDelivery(delivery.id,'recorded');assert.equal(f.tasks.activityLink(target,'thread:main')?.messageId,undefined);f.history.record(delivery.historyMessageId,'other-thread',delivery.text);assert.equal(f.tasks.activityLink(target,'thread:main')?.messageId,undefined);f.store.db.prepare('DELETE FROM conversation_messages WHERE id=?').run(delivery.historyMessageId);f.history.record(delivery.historyMessageId,'thread:main',delivery.text);assert.equal(f.tasks.activityLink(target,'thread:main')?.messageId,delivery.historyMessageId);f.tasks.markDelivery(delivery.id,'revoked');assert.equal(f.tasks.activityLink(target,'thread:main')?.artifact,undefined);
 }finally{f.close();}
});

test('HTTP validates the selected item identity and forwards only the existing process read',async()=>{
 const {createWebServer}=await import('../src/web-server.js');const seen:unknown[]=[];
 const bridge:any={history:{process:async(input:unknown)=>{seen.push(input);return {items:[]};}}};
 const server=await createWebServer({bridge,port:0});
 try{
  for(const itemId of ['',null,42,'x'.repeat(301),'private/file']){
   const response=await fetch(server.url+'/api/history/process',{method:'POST',headers:{Origin:server.url,'Content-Type':'application/json'},body:JSON.stringify({readEpoch:'epoch',id:'node',itemId})});assert.equal(response.status,409);assert.equal((await response.json()).error,'history_request_invalid');
  }
  assert.equal(seen.length,0);
  const response=await fetch(server.url+'/api/history/process',{method:'POST',headers:{Origin:server.url,'Content-Type':'application/json'},body:JSON.stringify({readEpoch:'epoch',id:'node',itemId:'activity-call-0'})});assert.equal(response.status,200);assert.deepEqual(seen,[{readEpoch:'epoch',id:'node',itemId:'activity-call-0'}]);
 }finally{await server.close();}
});
