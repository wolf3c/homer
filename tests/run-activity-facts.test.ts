// Isolated business-owner contracts. No runtime, model, account or production DB.
import test from 'node:test';
import assert from 'node:assert/strict';
import {historyFixture} from './web-history-loading-fixture.js';
import {Homer} from '../src/service.js';
import {syntheticFile} from './recursive-publication-fixture.js';
function fixture(){
 const f=historyFixture(2);f.store.setMeta('mainAgentId','main:activity');
 f.store.startRequest('request-1','synthetic');
 const actor={agentId:'main:activity',sourceRequestId:'request-1'};
 const make=(id:string,title='同名事项',executorKind:'main'|'worker'='main')=>f.tasks.createRoot(actor,{operationId:id,title,executorKind,contract:{presentation:{title},goal:'PRIVATE_GOAL',inputs:[],resultKind:executorKind==='main'?'aggregate':'structured',acceptance:{criteria:[]}},authority:{sourceRequestId:'request-1',description:'PRIVATE_AUTHORITY',materials:[],resultIds:[],collaborateTaskIds:[]}});
 return {...f,actor,make};
}
test('owner records exact public action/object and receipt, not private payload or transport success',()=>{
 const f=fixture();try{
  const a=f.make('a'),b=f.make('b');
  for(const root of [a,b]){
   const result=f.tasks.inspect(f.actor,{taskId:root.taskId});
   const fact=f.tasks.captureActivity(f.actor,'work_inspect',{taskId:root.taskId},result)!;
   assert.equal(fact.action,'inspect_task');assert.equal(fact.objectName,'同名事项');assert.equal(fact.outcome,'record_read');assert.equal(fact.target?.taskId,root.taskId);assert.equal(fact.target?.version,1);
   assert.doesNotMatch(JSON.stringify(fact),/PRIVATE_|goal|authority|payload/);
  }
  assert.equal(f.tasks.captureActivity(f.actor,'publish_delivery',{taskId:a.taskId,version:1},{state:'completed'}),undefined);
  assert.equal(f.tasks.captureActivity(f.actor,'work_inspect',{taskId:a.taskId},{task:{id:b.taskId}}),undefined);
 }finally{f.close();}
});
test('activity associations check thread, exact version, Run and result relations without inspecting bytes',()=>{
 const f=fixture();try{
  const a=f.make('a'),b=f.make('b'),target={taskId:a.taskId,version:1};
  assert.equal(f.tasks.activityLink(target,'synthetic-history')?.task.taskId,a.taskId);
  for(const wrong of [{...target,version:2},{...target,runId:'missing'},{...target,resultId:'missing'},{...target,deliveryId:'missing'}])assert.equal(f.tasks.activityLink(wrong,'synthetic-history'),undefined);
  assert.equal(f.tasks.activityLink(target,'other-thread'),undefined);
  assert.equal(f.tasks.activityLink({taskId:b.taskId,version:1},'other-thread'),undefined);
 }finally{f.close();}
});
test('same call updates original ID/revision; optional public facts do not enter MainProgress channel events',async()=>{
 const f=fixture();try{
  const root=f.make('a');f.processes.start({id:'live',threadId:'synthetic-history',sourceKind:'user',sourceMessageIds:[],messageId:'live'},'turn');f.history.record('live','synthetic-history','','running');
  const output:any[]=[],app:any=Object.create(Homer.prototype);
  const context:any={processId:'live',generation:{threadId:'synthetic-history',messageId:'live',turnId:'turn'}};
  Object.assign(app,{tasks:f.tasks,processes:f.processes,history:f.history,mainContext:context,store:f.store,sink:async(e:any)=>output.push(e),mainActor:()=>f.actor});
  const result=await app.mainActivity('work_inspect',async()=>f.tasks.inspect(f.actor,{taskId:root.taskId}),{taskId:root.taskId});await context.output;
  const items=f.processes.exact('live')!.items.filter(i=>i.kind==='tool');assert.equal(items.length,1);assert.equal(items[0]!.revision,2);assert.equal(items[0]!.activity?.target?.taskId,root.taskId);assert.equal(result.task.id,root.taskId);
  assert.equal(output.length,2);assert.ok(output.every(e=>!JSON.stringify(e).includes('同名事项')&&!JSON.stringify(e).includes('record_read')));
  // Fact collector failure cannot turn a successful business operation into failure.
  app.tasks={captureActivity(){throw Error('synthetic_fact_failure');}};
  assert.deepEqual(await app.mainActivity('work_inspect',async()=>({returned:true}),{}),{returned:true});
 }finally{f.close();}
});

test('real review and publication receipts distinguish acceptance, prepared delivery, recorded delivery and revocation',async()=>{
 const f=fixture();try{
  const root=f.make('review','待核验的合成事项','worker');const task=f.tasks.task(root.taskId),run=f.tasks.claim(root.runId!)!;
  const worker={agentId:root.agentId,runId:run.id,epoch:run.epoch,threadId:'synthetic-worker',turnId:'synthetic-turn'};f.tasks.bind(run.id,run.epoch,worker.threadId,worker.turnId);
  const completed=f.tasks.endSegment(worker.runId!,worker.epoch!,{status:'completed',text:JSON.stringify({summary:'合成摘要',private:'PRIVATE_PAYLOAD'})},true)!;
  f.tasks.endSegment(run.id,run.epoch,{status:'completed',text:'Synthetic final result'},true);
  f.tasks.inspect(f.actor,{resultId:completed.resultId});
  const args={operationId:'review',taskId:task.id,version:1,expectedTaskRevision:f.tasks.task(task.id).revision,resultId:completed.resultId,accepted:true,outcome:'succeeded' as const,reason:'合成核验',evidence:{},children:[]};
  const receipt=f.tasks.review(f.actor,args),fact=f.tasks.captureActivity(f.actor,'task_review',args,receipt)!;
  assert.equal(fact.outcome,'accepted');assert.equal(fact.target?.resultId,completed.resultId);assert.doesNotMatch(JSON.stringify(fact),/PRIVATE_|summary|reason/);
  const publicationArgs={operationId:'publish',taskId:task.id,version:1,expectedTaskRevision:f.tasks.task(task.id).revision,resultId:completed.resultId,publishedFileResultId:null,text:'合成正式答复'};
  const publication=f.tasks.publish(f.actor,publicationArgs);
  const prepared=f.tasks.captureActivity(f.actor,'publish_delivery',publicationArgs,publication)!;
  assert.equal(prepared.outcome,'delivery_prepared');assert.equal(f.tasks.activityLink(prepared.target!,'synthetic-history')?.messageId,undefined);
  f.tasks.markDelivery(publication.deliveryId,'submitting');f.tasks.markDelivery(publication.deliveryId,'recorded');
  assert.equal(prepared.outcome,'delivery_prepared','historical receipt is immutable');
  assert.equal(f.tasks.activityLink(prepared.target!,'synthetic-history')?.messageId,undefined);
  f.history.record(publication.historyMessageId,'synthetic-history','合成正式答复');
  assert.equal(f.tasks.activityLink(prepared.target!,'synthetic-history')?.messageId,publication.historyMessageId);
  f.tasks.markDelivery(publication.deliveryId,'revoked');assert.equal(f.tasks.activityLink(prepared.target!,'synthetic-history'),undefined);
 }finally{f.close();}
});

test('Web detail rechecks epoch/thread and exact association; old generic rows gain no invented fact',async()=>{
 const f=fixture();try{
  const root=f.make('a'),item=f.tasks.captureActivity(f.actor,'work_inspect',{taskId:root.taskId},f.tasks.inspect(f.actor,{taskId:root.taskId}));
  f.processes.start({id:'activity-node',threadId:'synthetic-history',sourceKind:'user',sourceMessageIds:[],messageId:'activity-node'},'turn');
  f.processes.tool('activity-node',{id:'call',label:'检查资料',phase:'end',status:'completed',activity:item});
  f.processes.tool('activity-node',{id:'generic',label:'检查资料',phase:'end',status:'completed'});
  const app:any={...f,webReadEpoch:'epoch',registerChannelCapabilities(){},webHistoryPages:()=>({process(id:string,thread:string){const node=f.processes.exact(id);if(node?.threadId!==thread)throw Error('history_process_not_found');return node;}})};
  const {homerWebBridge}=await import('../src/web-homer.js'),bridge=homerWebBridge(app);
  let resolutions=0;const resolve=f.tasks.activityLink.bind(f.tasks);f.tasks.activityLink=(...args)=>{resolutions++;return resolve(...args);};
  const header=await bridge.history!.process({readEpoch:'epoch',id:'activity-node'});
  assert.deepEqual(header.activityLinks,{});assert.equal(resolutions,0,'expansion must not hydrate activity navigation or file bytes');
  const detail=await bridge.history!.process({readEpoch:'epoch',id:'activity-node',itemId:'call'});
  assert.equal(resolutions,1,'only the selected activity is resolved');
  await assert.rejects(bridge.history!.process({readEpoch:'epoch',id:'activity-node',itemId:'missing'}),/history_activity_not_found/);
  assert.equal(detail.activityLinks?.call?.task.taskId,root.taskId);assert.equal(detail.activityLinks?.generic,undefined);
  assert.equal((detail.items.find(i=>i.id==='generic') as any).activity,undefined);
  await assert.rejects(bridge.history!.process({readEpoch:'old',id:'activity-node'}),/epoch_changed/);
  f.store.setMeta('mainThread','other');await assert.rejects(bridge.history!.process({readEpoch:'epoch',id:'activity-node'}),/process_not_found/);
 }finally{f.close();}
});

test('request_changes remains the reviewed old result/version instead of the newly queued version',()=>{
 const f=fixture();try{
  Object.assign(f.tasks,{lifecycle:{validateActor:()=>{},reviewExitConfirmed:()=>true}}); // Synthetic executor has no live process.
  const root=f.make('changes','需要修改的合成事项','worker'),run=f.tasks.claim(root.runId!)!;
  const worker={agentId:root.agentId,runId:run.id,epoch:run.epoch,threadId:'changes-worker',turnId:'changes-turn'};f.tasks.bind(run.id,run.epoch,worker.threadId,worker.turnId);
  const completed=f.tasks.endSegment(worker.runId!,worker.epoch!,{status:'completed',text:JSON.stringify({})},true)!;f.tasks.endSegment(run.id,run.epoch,{status:'completed',text:'Synthetic final result'},true);f.tasks.inspect(f.actor,{resultId:completed.resultId});
  const args={operationId:'request-changes',taskId:root.taskId,version:1,expectedTaskRevision:f.tasks.task(root.taskId).revision,resultId:completed.resultId,outcome:'succeeded' as const,reason:'补齐明确缺项',decision:'request_changes' as const,revision:{contract:f.tasks.contract(root.taskId,1),children:[],queuedDisposition:[]}};
  const receipt=f.tasks.review(f.actor,args),fact=f.tasks.captureActivity(f.actor,'task_review',args,receipt)!;
  assert.equal(receipt.version,2);assert.equal(fact.outcome,'changes_requested');assert.equal(fact.target?.version,1);assert.equal(fact.target?.runId,run.id);assert.equal(fact.target?.resultId,completed.resultId);
  assert.equal(f.tasks.activityLink(fact.target!,'synthetic-history')?.task.version,1);
 }finally{f.close();}
});


test('prepared file publication has no nonexistent origin button; exact recorded message is required',()=>{
 const f=fixture();try{
  const file=syntheticFile({store:f.store,tasks:f.tasks} as any,'request-1','activity-public.md','# Synthetic file');
  const delivery=file.publish(),run=f.tasks.run(file.run.id),target={taskId:run.taskId,version:1,runId:run.id,resultId:file.resultId};
  assert.equal(f.tasks.activityLink(target,'synthetic-history')?.artifact?.id,file.resultId);
  assert.equal(f.tasks.activityLink(target,'synthetic-history')?.messageId,undefined);
  f.tasks.markDelivery(delivery.id,'recorded');
  assert.equal(f.tasks.activityLink(target,'synthetic-history')?.messageId,undefined);
  f.history.record(delivery.historyMessageId,'other-thread',delivery.text);
  assert.equal(f.tasks.activityLink(target,'synthetic-history')?.messageId,undefined);
  f.store.db.prepare('DELETE FROM conversation_messages WHERE id=?').run(delivery.historyMessageId);
  f.history.record(delivery.historyMessageId,'synthetic-history',delivery.text);
  assert.equal(f.tasks.activityLink(target,'synthetic-history')?.messageId,delivery.historyMessageId);
  f.tasks.markDelivery(delivery.id,'revoked');assert.equal(f.tasks.activityLink(target,'synthetic-history')?.artifact,undefined);
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
