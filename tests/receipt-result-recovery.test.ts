// Synthetic contract verification and operation recovery regression coverage.
// All data is synthetic. No Homer constructor/start, model, native process,
// account, channel, production DB/config, network or real delivery sink.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {Store} from '../src/store.js';
import {Files} from '../src/files.js';
import {WorkerInteractions} from '../src/worker-interactions.js';
import {RecursiveTasks,type Actor,type Contract} from '../src/recursive-tasks.js';
import {RecursiveTools,RECURSIVE_TOOLS} from '../src/recursive-tools.js';
import {ConversationHistory} from '../src/web-history.js';
import {MainInputs} from '../src/recursive-main-inputs.js';
import {Homer} from '../src/service.js';

const main:Actor={agentId:'main:receipt-synthetic',sourceRequestId:'receipt-synthetic-source'};
const event:Actor={agentId:main.agentId};
const contract=(kind:Contract['resultKind']='structured'):Contract=>({goal:'Synthetic receipt recovery',inputs:[],resultKind:kind,acceptance:{criteria:[{id:'facts',required:true,description:'Synthetic facts only'}]}});
function fixture(workerRoot=false,validateActor?:(actor:Actor)=>void){
 mkdirSync('.codex/scratch/receipt-result-recovery/test-data',{recursive:true});
 const dir=mkdtempSync(resolve('.codex/scratch/receipt-result-recovery/test-data/case-'));
 const store=new Store(':memory:'),files=new Files(join(dir,'workspace'));
 const interactions=new WorkerInteractions(store.db),history=new ConversationHistory(store.db);
 const tasks=new RecursiveTasks(store,files,{validateActor:validateActor??(()=>{}),reviewExitConfirmed:()=>true});tasks.migrate();
 store.setMeta('mainAgentId',main.agentId);store.setMeta('mainThread','synthetic-main-thread');
 store.startRequest(main.sourceRequestId!,'synthetic-request-hash');
 const authority={sourceRequestId:main.sourceRequestId!,description:'Synthetic authorization',materials:[],resultIds:[],collaborateTaskIds:[]};
 let throwWake=false,wakes=0;
 const effects={authority:0,wake:0,stop:0,update:0};
 const tools=new RecursiveTools(tasks,{rootAuthority:()=>{effects.authority++;return authority;},wake:()=>{wakes++;effects.wake++;if(throwWake)throw Error('synthetic_outer_response_failure');},stop:async r=>{effects.stop++;return r;},update:async r=>{effects.update++;return r;}});
 const root=tasks.createRoot(main,{operationId:'setup-root',title:'Synthetic root',contract:contract(workerRoot?'markdown':'aggregate'),executorKind:workerRoot?'worker':'main',authority});
 const host=Object.create(Homer.prototype) as any;
 Object.assign(host,{store,files,tasks,interactions,history,workers:new Map()});
 return {store,files,tasks,tools,root,host,history,authority,effects,failWake(value:boolean){throwWake=value;},get wakes(){return wakes;},close(){store.close();rmSync(dir,{recursive:true,force:true});}};
}
type F=ReturnType<typeof fixture>;
function current(f:F,taskId=f.root.taskId,operationId='synthetic-operation'){
 const t=f.tasks.task(taskId);return {operationId,taskId,version:t.headVersion,expectedTaskRevision:t.revision};
}
function delegateArgs(f:F,operationId='delegate'){
 return {operationId,parentTaskId:f.root.taskId,parentVersion:1,expectedTaskRevision:f.tasks.task(f.root.taskId).revision,title:null,executorKind:'worker',contract:contract(),dependencies:[]};
}
function running(f:F,taskId:string):Actor{
 const t=f.tasks.task(taskId),r=f.tasks.claim(t.currentRunId!)!;
 const actor={agentId:t.executorAgentId,runId:r.id,epoch:r.epoch,threadId:'thread-'+r.id,turnId:'turn-'+r.id};
 f.tasks.bind(r.id,r.epoch,actor.threadId,actor.turnId);return actor;
}
async function inspect(f:F,actor:Actor,taskId:string){return f.tools.call(actor,'work_inspect',{taskId,runId:null,resultId:null}) as Promise<any>;}
function readResult(f:F,resultId:string){return f.tasks.inspect(event,{resultId}).results.find(r=>r.id===resultId)!;}
async function offered(f:F,operationId='delegate'){
 const child=await f.tools.call(main,'task_delegate',delegateArgs(f,operationId)) as any;
 const worker=running(f,child.taskId);
 const result=await Promise.resolve(f.tasks.endSegment(worker.runId!,worker.epoch!,{status:'completed',text:'Synthetic checked result'},true)!) as any;
 f.tasks.endSegment(worker.runId!,worker.epoch!,{status:'completed',text:'Synthetic final result'},true);
 return {child,worker,result};
}
async function acceptedRootFile(f:F){
 const worker=running(f,f.root.taskId);
 const file=f.tasks.writeMarkdown(worker,{operationId:'write-file',filename:'synthetic.md',content:'# Synthetic bytes\n'});
 await Promise.resolve(f.tasks.endSegment(worker.runId!,worker.epoch!,{status:'completed',text:'Synthetic checked result'},true)!);f.tasks.endSegment(worker.runId!,worker.epoch!,{status:'completed',text:'Synthetic final result'},true);
 f.tasks.inspect(event,{resultId:file.resultId});
 await f.tools.call(event,'task_review',{...current(f,f.root.taskId,'review'),resultId:file.resultId,accepted:true,outcome:'succeeded',reason:'Synthetic bytes inspected',evidence:{facts:true},children:[]});
 const publish={...current(f,f.root.taskId,'publish'),resultId:file.resultId,text:'Synthetic formal delivery',publishedFileResultId:file.resultId};
 return {worker,file,publish};
}
const count=(f:F,table:string)=>Number(f.store.db.prepare('SELECT count(*) AS n FROM '+table).get()!.n);
const observations=(t:any,value:unknown)=>t.diagnostic(JSON.stringify(value));

test('CONTRACT 1a: committed delegation survives outer throw and unchanged retry; changed payload conflicts',async t=>{
 const f=fixture();try{
  const args=delegateArgs(f);f.failWake(true);
  await assert.rejects(()=>f.tools.call(main,'task_delegate',args),/synthetic_outer_response_failure/);
  const persisted=f.tasks.children(f.root.taskId)[0]!;assert.ok(persisted);
  f.failWake(false);const replay=await f.tools.call(main,'task_delegate',args) as any;
  assert.equal(replay.taskId,persisted.id);assert.equal(count(f,'runs'),1);
  await assert.rejects(()=>f.tools.call(main,'task_delegate',{...args,contract:{...contract(),goal:'Changed'}}),/operation_payload_conflict/);
  observations(t,{taskId:replay.taskId,runId:replay.runId,runs:count(f,'runs'),state:replay.state});
 }finally{f.close();}
});
test('CONTRACT 1b: same-source root retry finds one committed root after lost response',async t=>{
 const f=fixture();try{
  const args={operationId:'lost-root',parentTaskId:null,parentVersion:null,expectedTaskRevision:null,title:'Lost synthetic root',executorKind:'main',contract:contract('aggregate'),dependencies:[]};
  f.failWake(true);await assert.rejects(()=>f.tools.call(main,'task_delegate',args),/synthetic_outer_response_failure/);
  f.failWake(false);const replay=await f.tools.call(main,'task_delegate',args) as any;
  assert.equal(f.tasks.tasks().filter(x=>!x.parentTaskId).length,2);
  observations(t,{operationKey:replay.operationKey,taskId:replay.taskId,rootCount:2});
 }finally{f.close();}
});
for(const legacy of [false,true])test('fixed coordinator host recovery: '+(legacy?'old':'new')+' replacement reuses completed child takeover',async()=>{
 const f=fixture();try{
  const child=await f.tools.call(main,'task_delegate',delegateArgs(f)) as any;
  Object.assign(f.host,{hostActors:new WeakSet(),pump(){},scheduleInternal(){}});
  const tools=new RecursiveTools(f.tasks,{rootAuthority:()=>f.authority,wake(){},stop:async r=>r,update:(r,m)=>f.host.applyUpdate(r,m)});
  const args={...current(f,f.root.taskId,'replace-transfer'),mode:'stop_replace',contract:contract('aggregate'),children:[{taskId:child.taskId,action:'transfer',...(legacy?{coordinatorAgentId:main.agentId}:{})}],queuedDisposition:[],independent:false};
  const receipt=await tools.call(main,'task_update',args) as any;
  assert.equal(f.tasks.task(child.taskId).controlState,'normal');
  const operationId='host-transfer:'+receipt.operationKey+':'+child.taskId;
  const lookup=f.tasks.inspect(event,{operationId,operationScopeId:child.taskId});
  assert.ok('operation' in lookup&&lookup.operation);
  const transfer=lookup.operation;
  assert.equal(transfer.kind,'takeover');assert.equal(transfer.state,'confirmed');
  const before=snapshot(f);
  assert.deepEqual(await tools.call(event,'task_update',args),receipt);
  assert.equal(snapshot(f),before);
  f.store.db.prepare("UPDATE operations SET state='uncertain',responseJson=NULL WHERE id=?").run(transfer.id);
  const uncertain=snapshot(f);
  await assert.rejects(()=>tools.call(event,'task_update',args),/operation_uncertain/);
  assert.equal(snapshot(f),uncertain);
 }finally{f.close();}
});
for(const timeout of [false,true])test('CONTRACT 1c '+(timeout?'uncertain':'received/adopted')+': supplementation retries read durable RPC disposition without another fake steer',async t=>{
 const f=fixture();try{
  const child=await f.tools.call(main,'task_delegate',delegateArgs(f)) as any,w=running(f,child.taskId);let calls=0;
  f.host.workers.set(w.runId,{engine:{steer:async()=>{calls++;if(timeout)throw Error('engine_rpc_timeout');return {turnId:w.turnId};}}});
  const tools=new RecursiveTools(f.tasks,{rootAuthority:()=>f.authority,wake:()=>{},stop:async r=>r,update:(r,m)=>f.host.applyUpdate(r,m)});
  const args={...current(f,child.taskId,'supplement'),mode:'steer',contract:{...contract(),goal:'Supplemented synthetic goal'},children:[],queuedDisposition:[],independent:false};
  await tools.call(main,'task_update',args); // caller discards the response
  const replay=await tools.call(event,'task_update',args) as any;
  assert.equal(calls,1);assert.equal(replay.state,timeout?'uncertain':'received');assert.equal(replay.adopted,false);
  const truth=await inspect(f,event,child.taskId);assert.equal(truth.task.headVersion,2);assert.equal(truth.run.targetVersion,2);
  assert.equal(truth.operations.find((x:any)=>x.id===replay.operationKey).state,timeout?'uncertain':'dispatching');
  if(!timeout){
   const c=f.tasks.inspect(w,{taskId:child.taskId});
   f.tasks.adopt(w,{...current(f,child.taskId,'adopt'),contractHash:c.contractHash});
   const adopted=await tools.call(event,'task_update',args) as any;assert.equal(adopted.state,'adopted');assert.equal(adopted.adopted,true);assert.equal(calls,1);
  }else assert.equal(f.tasks.run(w.runId!).phase,'uncertain');
  observations(t,{fakeSteerCalls:calls,receipt:replay.state,adopted:!timeout,currentVersion:2,nativeSideEffectVerified:false});
 }finally{f.close();}
});
test('CONTRACT 2a: automatic return is durable and duplicate terminal callbacks do not duplicate results or notifications',async t=>{
 const f=fixture();try{
  const {child,worker,result}=await offered(f),notifications=count(f,'agent_messages');
  const replay=f.tasks.endSegment(worker.runId!,worker.epoch!,{status:'completed',text:'Synthetic checked result'},true)!;
  assert.equal(replay.resultId,result.resultId);assert.equal(count(f,'results'),1);assert.equal(count(f,'agent_messages'),notifications);
  f.tasks.inspect(event,{resultId:result.resultId});
  await f.tools.call(event,'task_review',{...current(f,child.taskId,'review'),resultId:result.resultId,accepted:true,outcome:'succeeded',reason:'Synthetic inspection',evidence:{facts:true},children:[]});
  assert.equal(f.tasks.endSegment(worker.runId!,worker.epoch!,{status:'completed',text:'Synthetic checked result'},true)!.resultId,result.resultId);
  assert.equal(readResult(f,result.resultId).state,'accepted');assert.equal(count(f,'results'),1);
  observations(t,{resultCount:1,receivedAndAccepted:true});
 }finally{f.close();}
});
test('CONTRACT 2b: acceptance committed before outer error remains accepted without duplicate result or publication',async t=>{
 const f=fixture();try{
  const a=await offered(f);f.tasks.inspect(event,{resultId:a.result.resultId});
  const args={...current(f,a.child.taskId,'review'),resultId:a.result.resultId,accepted:true,outcome:'succeeded',reason:'Synthetic inspection',evidence:{facts:true},children:[]};
  f.failWake(true);await assert.rejects(()=>f.tools.call(event,'task_review',args),/synthetic_outer_response_failure/);
  assert.equal(readResult(f,a.result.resultId).state,'accepted');const n=count(f,'agent_messages');
  f.failWake(false);const replay=await f.tools.call(event,'task_review',args) as any;
  assert.equal(replay.state,'accepted');assert.equal(count(f,'agent_messages'),n);assert.equal(count(f,'deliveries'),0);
  await assert.rejects(()=>f.tools.call(event,'task_review',{...args,accepted:false}),/operation_payload_conflict/);
  observations(t,{receipt:replay.state,resultCount:count(f,'results'),deliveries:0,notifications:n});
 }finally{f.close();}
});
test('CONTRACT 2c: unconfirmed engine close still returns a readable candidate but blocks acceptance',async t=>{
 const f=fixture();try{
  const c=await f.tools.call(main,'task_delegate',delegateArgs(f)) as any,w=running(f,c.taskId);
  const r=f.tasks.endSegment(w.runId!,w.epoch!,{status:'completed',text:'Synthetic checked result'},false)!;
  assert.equal(readResult(f,r.resultId).state,'offered');assert.equal(f.tasks.run(w.runId!).phase,'uncertain');
  assert.throws(()=>f.tasks.review(event,{...current(f,c.taskId,'review'),resultId:r.resultId,accepted:true,outcome:'succeeded',reason:'Synthetic inspected',evidence:{facts:true},children:[]}),/run_stop_unconfirmed/);
  assert.equal(count(f,'deliveries'),0);observations(t,{result:'offered',run:'uncertain',deliveries:0});
 }finally{f.close();}
});
test('CONTRACT 3: duplicate and reversed wake handling rereads current facts; user input stays separate',async t=>{
 const f=fixture();try{
  const inputs=new MainInputs(f.tasks,f.history);const input={requestId:'queued-synthetic-user',text:'Synthetic queued user input'};
  const acceptance=inputs.accept(input),results=[await offered(f,'first'),await offered(f,'second')];
  for(const a of results){
   f.tasks.inspect(event,{resultId:a.result.resultId});
   await f.tools.call(event,'task_review',{...current(f,a.child.taskId,'review-'+a.child.taskId),resultId:a.result.resultId,accepted:true,outcome:'succeeded',reason:'Synthetic inspection',evidence:{facts:true},children:[]});
  }
  const batch=f.tasks.offerMainMessages();assert.equal(batch.length,2);
  assert.deepEqual(batch.map(m=>m.kind),['result_ready','result_ready'],'successful self-confirmations do not create another model input');
  f.tasks.receiveMainMessages(batch.map(m=>m.id),'synthetic-event-turn');f.tasks.receiveMainMessages(batch.map(m=>m.id),'synthetic-event-turn');
  for(const notice of [...batch].reverse().concat(batch)){
   const a=results.find(result=>result.child.taskId===notice.taskId)!;
   const truth=await inspect(f,event,notice.taskId!);assert.equal(truth.task.id,a.child.taskId);assert.equal(truth.run.id,a.worker.runId);assert.equal(truth.results[0].id,a.result.resultId);assert.equal(truth.results[0].state,'accepted');
   await f.tools.call(event,'inbox_ack',{operationId:'ack-'+notice.id,messageId:notice.id,disposition:'processed',reason:'Reread synthetic facts',resultId:a.result.resultId});
  }
  assert.equal(f.tasks.inbox(event).length,0);assert.equal(inputs.list().length,1);assert.equal(inputs.list()[0]!.state,'queued');
  const adopted=inputs.claim()!;assert.equal(adopted.input.requestId,input.requestId);assert.equal(adopted.messageId,acceptance.queueMessageId);
  observations(t,{notices:batch.map(m=>m.kind),result:'accepted',userRequestId:adopted.input.requestId,resultCount:count(f,'results')});
 }finally{f.close();}
});
test('CONTRACT 4a: acceptance is internal; explicit prepared publication binds exact source, file and hash',async t=>{
 const f=fixture(true);try{
  const a=await acceptedRootFile(f);assert.equal(count(f,'deliveries'),0);assert.equal(f.tasks.publishedArtifact(a.worker.runId!),undefined);
  const d=await f.tools.call(event,'publish_delivery',a.publish) as any;
  assert.equal(d.state,'prepared');const file=f.tasks.publishedArtifact(a.worker.runId!,{sourceRequestId:main.sourceRequestId})!;
  assert.equal(file.resultId,a.file.resultId);assert.equal(file.sha256,a.file.sha256);assert.equal(file.routeSourceRequestId,main.sourceRequestId);
  assert.equal(f.tasks.publishedArtifact(a.worker.runId!,{sourceRequestId:'other-source'}),undefined);
  observations(t,{state:d.state,source:file.routeSourceRequestId,resultId:file.resultId,sha256:file.sha256});
 }finally{f.close();}
});
for(const state of ['recorded','uncertain'] as const)test('CONTRACT 4b '+state+': lost publication response is recovered via list_work, without re-publication',async t=>{
 const f=fixture(true);try{
  const a=await acceptedRootFile(f);f.failWake(true);await assert.rejects(()=>f.tools.call(event,'publish_delivery',a.publish),/synthetic_outer_response_failure/);
  const d=f.tasks.deliveries()[0]!;f.tasks.markDelivery(d.id,'submitting');f.tasks.markDelivery(d.id,state);
  f.failWake(false);const replay=await f.tools.call(event,'publish_delivery',a.publish) as any;
  const actual=f.host.snapshot().deliveries.find((x:any)=>x.id===replay.deliveryId);
  assert.equal(replay.state,'prepared');assert.equal(actual.state,state);assert.equal(actual.operationKey,replay.operationKey);assert.equal(count(f,'deliveries'),1);assert.equal(f.tasks.pendingDeliveries().length,0);
  assert.throws(()=>f.tasks.markDelivery(d.id,'submitting'),/delivery_transition_denied/);
  observations(t,{originalReceipt:replay.state,listWorkState:actual.state,deliveries:1,externalSideEffectVerified:false});
 }finally{f.close();}
});
test('CONTRACT 4c: real delivery owner records only fake sink confirmation; uncertain is not automatically replayed',async t=>{
 for(const failure of [false,true]){
  const f=fixture(true);try{
   const a=await acceptedRootFile(f);const d=await f.tools.call(event,'publish_delivery',a.publish) as any;
   let emitted=0;const jobs:Promise<unknown>[]=[];
   Object.assign(f.host,{enqueue(fn:()=>Promise<unknown>){const p=Promise.resolve().then(fn);jobs.push(p);return p;},mainActor:()=>event,emit:async()=>{emitted++;if(failure)throw Error('synthetic_sink_unconfirmed');}});
   f.host.scheduleDelivery();await Promise.all(jobs);assert.equal(f.tasks.delivery(d.deliveryId).state,failure?'uncertain':'recorded');
   f.host.scheduleDelivery();await Promise.all(jobs);assert.equal(emitted,1);assert.equal(count(f,'deliveries'),1);
   observations(t,{sink:'fake',failure,emitted,state:f.host.snapshot().deliveries[0].state});
  }finally{f.close();}
 }
});
test('CONTRACT 4d: changed sealed bytes are rejected by reads and download; restart preserves uncertain delivery',async t=>{
 const f=fixture(true);try{
  const a=await acceptedRootFile(f),d=await f.tools.call(event,'publish_delivery',a.publish) as any;
  f.tasks.markDelivery(d.deliveryId,'submitting');f.tasks.reconcile();assert.equal(f.tasks.delivery(d.deliveryId).state,'uncertain');assert.equal(f.tasks.pendingDeliveries().length,0);
  writeFileSync(a.file.path,'# Changed synthetic bytes\n');
  assert.throws(()=>f.tasks.inspect(event,{resultId:a.file.resultId}),/result_hash_mismatch/);
  assert.throws(()=>f.tasks.publishedArtifact(a.worker.runId!),/result_hash_mismatch/);
  observations(t,{delivery:'uncertain',tamperedBytes:'rejected',acceptedResultRetained:readResultWithoutBytes(f,a.file.resultId)});
 }finally{f.close();}
});
function readResultWithoutBytes(f:F,id:string){return f.store.db.prepare('SELECT state FROM results WHERE id=?').get(id)!.state;}
test('CONTRACT 5: rework preserves rejected old version and receipt; old targeted input cannot enter replacement Run',async t=>{
 const f=fixture();try{
  const child=await f.tools.call(main,'task_delegate',delegateArgs(f)) as any,w=running(f,child.taskId);
  const sent=f.tasks.send(main,{...current(f,child.taskId,'old-target'),recipientAgentId:child.agentId,kind:'synthetic',payload:{synthetic:true},targetRunId:w.runId});
  const r=await Promise.resolve(f.tasks.endSegment(w.runId!,w.epoch!,{status:'completed',text:'Synthetic checked result'},true)!) as any;
  f.tasks.endSegment(w.runId!,w.epoch!,{status:'completed',text:'Synthetic final result'},true);f.tasks.inspect(event,{resultId:r.resultId});
  await f.tools.call(event,'task_review',{...current(f,child.taskId,'reject'),resultId:r.resultId,decision:'request_changes',outcome:'failed',reason:'Synthetic rework needed',revision:{contract:contract(),children:[],queuedDisposition:[]}});
  const replacement={runId:f.tasks.task(child.taskId).currentRunId};
  const next=running(f,child.taskId);assert.notEqual(next.runId,w.runId);assert.equal(f.tasks.run(next.runId!).contractVersion,2);
  assert.equal(f.tasks.inbox(next).some(m=>m.id===sent.messageId),false);
  assert.throws(()=>f.tasks.ack(next,{operationId:'new-ack',messageId:sent.messageId,disposition:'processed',reason:'Synthetic'}),/message_target_stale/);
  const old=await Promise.resolve(f.tasks.endSegment(w.runId!,w.epoch!,{status:'completed',text:'Synthetic checked result'},true)!) as any;assert.equal(old.resultId,r.resultId);
  const truth=await inspect(f,event,child.taskId);assert.equal(truth.task.headVersion,2);assert.equal(truth.run.id,replacement.runId);assert.equal(truth.results[0].state,'rejected');assert.equal(truth.results[0].version,1);
  assert.equal(f.tasks.task(child.taskId).headVersion,2);
  observations(t,{currentVersion:2,currentRun:truth.run.id,oldResultState:'rejected',historicalResult:old.resultId,targetRunPreserved:w.runId});
 }finally{f.close();}
});
test('CONTRACT 6: existing reads distinguish accepted operation, queued/active execution, offered result and publication',async t=>{
 const f=fixture();try{
  const args=delegateArgs(f),child=await f.tools.call(main,'task_delegate',args) as any;
  const queued=await inspect(f,event,child.taskId);assert.equal(queued.run.status,'queued');assert.equal(queued.results.length,0);
  const w=running(f,child.taskId);const active=await inspect(f,event,child.taskId);assert.equal(active.run.phase,'executing');
  const r=await Promise.resolve(f.tasks.endSegment(w.runId!,w.epoch!,{status:'completed',text:'Synthetic checked result'},true)!) as any;f.tasks.endSegment(w.runId!,w.epoch!,{status:'completed',text:'Synthetic final result'},true);
  const offered=await inspect(f,event,child.taskId);assert.equal(offered.results[0].state,'offered');assert.equal(f.host.snapshot().deliveries.length,0);
  const original=await f.tools.call(event,'task_delegate',args) as any;assert.equal(original.operationKey,child.operationKey);
  observations(t,{operationReceipt:original.state,queued:queued.run.status,active:active.run.phase,result:readResult(f,r.resultId).state,deliveries:0});
 }finally{f.close();}
});
test('GAP 1: original root operation should remain recoverable after source context changes without its lost taskId',async t=>{
 const f=fixture();try{
  const args={operationId:'lost-root',parentTaskId:null,parentVersion:null,expectedTaskRevision:null,title:'Lost synthetic root',executorKind:'main',contract:contract('aggregate'),dependencies:[]};
  f.failWake(true);await assert.rejects(()=>f.tools.call(main,'task_delegate',args),/synthetic_outer_response_failure/);f.failWake(false);
  const persisted=f.store.db.prepare('SELECT * FROM operations WHERE actorAgentId=? AND scopeId=? AND operationId=?').get(main.agentId,main.sourceRequestId!,'lost-root')!;
  const taskId=JSON.parse(String(persisted.responseJson)).taskId;
  const overview=f.host.snapshot();assert.ok(overview.tasks.some((x:any)=>x.id===taskId));
  observations(t,{persistedOperation: true,scope:main.sourceRequestId,currentSource:event.sourceRequestId??null,listWorkHasOperationIdentity:overview.tasks.some((x:any)=>x.operationId==='lost-root'),confirmedOperationVisible:(await inspect(f,event,taskId)).operations.some((x:any)=>x.id===persisted.id)});
  await assert.rejects(()=>f.tools.call(event,'task_delegate',args),/task_authority_source_denied/);
  assert.equal(count(f,'operations'),2); // setup + original committed creation
  // Original stage-one RED input, now resolved by the additive READ contract.
  // Mutation replay and the source gate for creating roots stay unchanged.
  const before=snapshot(f),effects=JSON.stringify(f.effects);
  const recovered=await f.tools.call(event,'work_inspect',{taskId:null,runId:null,resultId:null,operationId:args.operationId}) as any;
  assert.equal(recovered.operation.response.taskId,taskId);
  assert.equal(snapshot(f),before);assert.equal(JSON.stringify(f.effects),effects);
 }finally{f.close();}
});

// Stage-two requirements-derived behavior tests. Run against the retained
// maintenance preimage first, then the candidate, without changing test inputs.
async function lookup(f:F,actor:Actor,operationId:string,operationScopeId?:string):Promise<any>{
 const before=snapshot(f),effects=JSON.stringify(f.effects);
 try{return await f.tools.call(actor,'work_inspect',{taskId:null,runId:null,resultId:null,operationId,...(operationScopeId===undefined?{}:{operationScopeId})});}
 finally{assert.equal(snapshot(f),before);assert.equal(JSON.stringify(f.effects),effects);}
}
function snapshot(f:F){
 const tables=f.store.db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name").all() as {name:string;sql:string}[];
 return JSON.stringify(tables.map(t=>({schema:t,rows:f.store.db.prepare('SELECT * FROM "'+t.name+'" ORDER BY rowid').all()})));
}
function rootsWithSameOperation(f:F,n:number){
 const scopes=Array.from({length:n},(_,i)=>'synthetic-scope-'+String(i).padStart(2,'0'));
 const expected=new Map<string,string>();
 for(const source of [...scopes].reverse()){
  f.store.startRequest(source,'synthetic');
  const r=f.tasks.createRoot({...main,sourceRequestId:source},{operationId:'same-name',title:'Same-name synthetic root',contract:contract('aggregate'),authority:{...f.authority,sourceRequestId:source}});
  expected.set(source,r.taskId);
 }
 return {scopes,expected};
}
for(const source of [undefined,'new-synthetic-user-source'])test('RECOVERY lookup: event/new-source actor reads its own original root with and without scope '+String(source),async()=>{
 const f=fixture();try{
  const actor={agentId:main.agentId,...(source?{sourceRequestId:source}:{})};
  const before=snapshot(f),wakes=f.wakes;
  for(const scope of [undefined,main.sourceRequestId]){
   const r=await lookup(f,actor,'setup-root',scope);
   assert.equal(r.operation.response.taskId,f.root.taskId);assert.equal(r.operation.scopeId,main.sourceRequestId);assert.equal(r.operation.id,f.root.operationKey);
   assert.equal(r.operation.state,'confirmed');assert.deepEqual(r.operation.details,{});
   assert.deepEqual(Object.keys(r.operation).sort(),['id','operationId','scopeId','kind','state','revision','response','details'].sort());
   assert.equal(r.truncated,false);assert.deepEqual(r.candidates,[]);
  }
  assert.equal(snapshot(f),before);assert.equal(f.wakes,wakes);
  await assert.rejects(()=>f.tools.call(actor,'task_delegate',{operationId:'forbidden-new-root',parentTaskId:null,parentVersion:null,expectedTaskRevision:null,title:'Not authorized by a read',executorKind:'main',contract:contract('aggregate'),dependencies:[]}),/task_authority_source_denied/);
 }finally{f.close();}
});
for(const n of [2,20,21])test('RECOVERY ambiguity: '+n+' same-name scopes have bounded stable candidates and never choose a success',async()=>{
 const f=fixture();try{
  const {scopes,expected}=rootsWithSameOperation(f,n),before=snapshot(f),wakes=f.wakes;
  const first=await lookup(f,event,'same-name'),again=await lookup(f,event,'same-name');
  assert.deepEqual(first,again);assert.equal(first.operation,null);assert.equal(first.candidates.length,Math.min(n,20));assert.equal(first.truncated,n>20);
  assert.deepEqual(first.candidates.map((x:any)=>x.scopeId),scopes.slice(0,20));
  for(const c of first.candidates){assert.equal(c.references.taskId,expected.get(c.scopeId));assert.equal(c.kind,'create_root');assert.equal(c.state,'confirmed');assert.deepEqual(Object.keys(c).sort(),['id','scopeId','kind','state','revision','references'].sort());}
  const exact=await lookup(f,event,'same-name',scopes.at(-1));assert.equal(exact.operation.response.taskId,expected.get(scopes.at(-1)!));assert.equal(exact.truncated,false);
  assert.equal(snapshot(f),before);assert.equal(f.wakes,wakes);
 }finally{f.close();}
});
test('RECOVERY selectors: unknown operation/scope is not-found and cannot enumerate another actor',async()=>{
 const f=fixture();try{
  const c=await f.tools.call(main,'task_delegate',delegateArgs(f)) as any,w=running(f,c.taskId);
  const send=f.tasks.send(w,{...current(f,c.taskId,'worker-own'),recipientAgentId:main.agentId,kind:'synthetic',payload:{synthetic:true}});
  const before=snapshot(f),wakes=f.wakes;
  for(const [actor,op,scope] of [[event,'missing',undefined],[event,'setup-root','wrong-source'],[event,'worker-own',c.taskId],[w,'delegate',f.root.taskId]] as const)
   await assert.rejects(()=>lookup(f,actor,op,scope),/operation_not_found/);
  const own=await lookup(f,w,'worker-own',c.taskId);assert.equal(own.operation.id,send.operationKey);assert.equal(own.operation.response.messageId,send.messageId);
  assert.equal(snapshot(f),before);assert.equal(f.wakes,wakes);
 }finally{f.close();}
});
test('RECOVERY selectors: scope-only and every mixed entity selector are rejected in tool and owner',async()=>{
 const f=fixture();try{
  const before=snapshot(f),wakes=f.wakes;
  await assert.rejects(()=>f.tools.call(event,'work_inspect',{taskId:null,runId:null,resultId:null,operationScopeId:main.sourceRequestId}),/operation_selector_invalid/);
  assert.throws(()=>f.tasks.inspect(event,{operationScopeId:main.sourceRequestId}),/operation_selector_invalid/);
  for(const field of ['taskId','runId','resultId']){
   await assert.rejects(()=>f.tools.call(event,'work_inspect',{taskId:null,runId:null,resultId:null,[field]:f.root.taskId,operationId:'setup-root'}),/operation_selector_invalid/);
   assert.throws(()=>f.tasks.inspect(event,{[field]:f.root.taskId,operationId:'setup-root'}),/operation_selector_invalid/);
  }
  await assert.rejects(()=>f.tools.call(event,'work_inspect',{taskId:null,runId:null,resultId:null,operationId:'setup-root',actorAgentId:main.agentId}),/invalid_tool_arguments/);
  // Existing string() validates the tool boundary before the domain owner.
  await assert.rejects(()=>lookup(f,event,''),/invalid_tool_arguments/);
  assert.throws(()=>f.tasks.inspect(event,{operationId:''}),/task_invalid_input/);
  assert.equal(snapshot(f),before);assert.equal(f.wakes,wakes);
 }finally{f.close();}
});
test('RECOVERY identity: forged Worker agent/run/epoch/thread/turn cannot read operations or bypass lifecycle',async()=>{
 let denied=false;const f=fixture(false,()=>{if(denied)throw Error('synthetic_host_identity_denied');});try{
  const child=await f.tools.call(main,'task_delegate',delegateArgs(f)) as any,w=running(f,child.taskId);
  f.tasks.send(w,{...current(f,child.taskId,'worker-own'),recipientAgentId:main.agentId,kind:'synthetic',payload:{}});
  const before=snapshot(f),wakes=f.wakes;
  const invalid:Actor[]=[{agentId:w.agentId},{...w,agentId:'worker:forged'},{...w,agentId:main.agentId},{...w,epoch:w.epoch!+1},{...w,threadId:'wrong-thread'},{...w,turnId:'wrong-turn'}];
  for(const actor of invalid)await assert.rejects(()=>lookup(f,actor,'worker-own',child.taskId),/identity|epoch|live/);
  assert.equal((await lookup(f,w,'worker-own')).operation.kind,'send');
  denied=true;
  for(const actor of [w,event])await assert.rejects(()=>lookup(f,actor,actor===w?'worker-own':'setup-root'),/synthetic_host_identity_denied/);
  assert.equal(snapshot(f),before);assert.equal(f.wakes,wakes);
 }finally{f.close();}
});
test('RECOVERY Worker read scope: own historical scope still uses current matter/collaboration read gate',async()=>{
 const f=fixture();try{
  const child=await f.tools.call(main,'task_delegate',delegateArgs(f)) as any,w=running(f,child.taskId);
  const foreign=f.tasks.createRoot(main,{operationId:'foreign-root',title:'Foreign synthetic matter',contract:contract('aggregate'),authority:f.authority});
  // Synthetic historical own-actor receipt, scoped to a formerly readable
  // collaboration. It must not expose a scope the current read gate denies.
  f.store.db.prepare("INSERT INTO operations VALUES(?,?,?,?,?,?,?, ?,?,0)").run('op-synthetic-former-collaboration',w.agentId,foreign.taskId,'historical-collaboration','send','synthetic','confirmed','{}',JSON.stringify({taskId:foreign.taskId}));
  const before=snapshot(f);assert.throws(()=>f.tasks.inspect(w,{taskId:foreign.taskId}),/agent_scope_denied/);
  await assert.rejects(()=>lookup(f,w,'historical-collaboration'),/agent_scope_denied/);assert.equal(snapshot(f),before);
  const a=f.tasks.authority(child.taskId,1);a.collaborateTaskIds=[foreign.taskId];f.store.db.prepare('UPDATE task_versions SET authorityJson=? WHERE taskId=? AND version=1').run(JSON.stringify(a),child.taskId);
  const allowed=snapshot(f);assert.equal((await lookup(f,w,'historical-collaboration')).operation.response.taskId,foreign.taskId);assert.equal(snapshot(f),allowed);
 }finally{f.close();}
});
test('RECOVERY fencing: ended/old Worker cannot query; replacement reads own old receipt without restoring old target ACK',async()=>{
 const f=fixture();try{
  const child=await f.tools.call(main,'task_delegate',delegateArgs(f)) as any,worker=running(f,child.taskId);
  const message=f.tasks.send(main,{...current(f,child.taskId,'target-old'),recipientAgentId:worker.agentId,targetRunId:worker.runId,kind:'synthetic',payload:{}});
  const ackArgs={operationId:'ack-old-target',messageId:message.messageId,disposition:'processed' as const,reason:'Synthetic consumed'};f.tasks.ack(worker,ackArgs);
  const result=await Promise.resolve(f.tasks.endSegment(worker.runId!,worker.epoch!,{status:'completed',text:'Synthetic checked result'},true)!) as any;f.tasks.endSegment(worker.runId!,worker.epoch!,{status:'completed',text:'Synthetic final result'},true);
  const a={child,worker,result},oldBefore=snapshot(f);
  await assert.rejects(()=>lookup(f,a.worker,'ack-old-target',a.child.taskId),/run_not_live/);assert.equal(snapshot(f),oldBefore);
  f.tasks.inspect(event,{resultId:a.result.resultId});f.tasks.review(event,{...current(f,a.child.taskId,'accept'),resultId:a.result.resultId,accepted:true,outcome:'succeeded',reason:'Synthetic inspected',evidence:{facts:true},children:[]});
  const replacement=f.tasks.update(event,{...current(f,a.child.taskId,'replace'),mode:'stop_replace',contract:contract(),children:[],queuedDisposition:[]});
  const next=running(f,a.child.taskId),before=snapshot(f);
  await assert.rejects(()=>lookup(f,a.worker,'ack-old-target'),/run_not_live|run_epoch_stale/);
  const old=await lookup(f,next,'ack-old-target',message.messageId);assert.equal(old.operation.response.state,'processed');
  assert.equal((await lookup(f,next,'ack-old-target',message.messageId)).operation.response.state,'processed');
  assert.throws(()=>f.tasks.ack(next,ackArgs),/message_target_stale/);
  const latest=await inspect(f,next,a.child.taskId);assert.equal(latest.run.id,replacement.runId);assert.equal(latest.results.find((x:any)=>x.id===a.result.resultId).state,'accepted');assert.equal(snapshot(f),before);
 }finally{f.close();}
});
test('RECOVERY schema: operation fields remain optional and old three-field entity calls keep their contract',async()=>{
 const f=fixture();try{
  const schema=RECURSIVE_TOOLS.find(t=>t.name==='work_inspect')!.inputSchema as {required:string[];properties:Record<string,unknown>};
  assert.deepEqual(schema.required,['taskId','runId','resultId']);assert.ok(schema.properties.operationId);assert.ok(schema.properties.operationScopeId);
  const before=snapshot(f),effects=JSON.stringify(f.effects);
  const old=await f.tools.call(event,'work_inspect',{taskId:f.root.taskId,runId:null,resultId:null}) as any;
  assert.equal(old.task.id,f.root.taskId);assert.ok(Array.isArray(old.results));assert.equal(old.operation,undefined);
  await assert.rejects(()=>f.tools.call(event,'work_inspect',{operationId:'setup-root'}),/invalid_tool_arguments/);
  await assert.rejects(()=>f.tools.call(event,'work_inspect',{taskId:null,runId:null,resultId:null,operationId:null}),/invalid_tool_arguments/);
  assert.equal(snapshot(f),before);assert.equal(JSON.stringify(f.effects),effects);
 }finally{f.close();}
});
test('RECOVERY phases: operation state/details advance independently from the original response snapshot',async()=>{
 for(const uncertain of [false,true]){
  const f=fixture();try{
   const c=await f.tools.call(main,'task_delegate',delegateArgs(f)) as any,w=running(f,c.taskId);
   const r=f.tasks.update(event,{...current(f,c.taskId,'supplement'),mode:'steer',contract:{...contract(),goal:'Synthetic supplement'},children:[],queuedDisposition:[]});
   assert.equal((await lookup(f,event,'supplement',c.taskId)).operation.state,'accepted');
   f.tasks.markSteer(r.operationKey,'dispatching');assert.equal((await lookup(f,event,'supplement')).operation.details.rpcState,'dispatching');
   f.tasks.markSteer(r.operationKey,uncertain?'uncertain':'received');
   const rpc=await lookup(f,event,'supplement');assert.equal(rpc.operation.response.state,'accepted');assert.equal(rpc.operation.state,uncertain?'uncertain':'dispatching');assert.equal(rpc.operation.details.rpcState,uncertain?'uncertain':'received');
   if(!uncertain){const hash=f.tasks.inspect(w,{taskId:c.taskId}).contractHash;f.tasks.adopt(w,{...current(f,c.taskId,'adopt'),contractHash:hash});const adopted=await lookup(f,event,'supplement');assert.equal(adopted.operation.state,'confirmed');assert.equal(adopted.operation.details.adopted,true);assert.equal(adopted.operation.response.state,'accepted');}
  }finally{f.close();}
 }
});
test('RECOVERY restart fencing: a real synthetic epoch increment invalidates the old Worker read identity',async()=>{
 const f=fixture();try{
  const c=await f.tools.call(main,'task_delegate',delegateArgs(f)) as any,w=running(f,c.taskId);
  f.tasks.send(w,{...current(f,c.taskId,'worker-before-restart'),recipientAgentId:main.agentId,kind:'synthetic',payload:{}});
  f.tasks.reconcile();assert.equal(f.tasks.run(w.runId!).epoch,w.epoch!+1);
  await assert.rejects(()=>lookup(f,w,'worker-before-restart',c.taskId),/run_epoch_stale/);
 }finally{f.close();}
});
test('RECOVERY inspection: operation read does not grant result inspection; legacy work_inspect still enables review',async()=>{
 const f=fixture();try{
  const a=await offered(f),before=snapshot(f),wakes=f.wakes;
  assert.equal((await lookup(f,event,'delegate',f.root.taskId)).operation.response.taskId,a.child.taskId);
  assert.equal(snapshot(f),before);assert.equal(f.wakes,wakes);
  const args={...current(f,a.child.taskId,'review-after-read'),resultId:a.result.resultId,accepted:true,outcome:'succeeded',reason:'Synthetic check',evidence:{facts:true},children:[]};
  await assert.rejects(()=>f.tools.call(event,'task_review',args),/result_inspection_required/);assert.equal(snapshot(f),before);
  const actual=await f.tools.call(event,'work_inspect',{taskId:null,runId:null,resultId:a.result.resultId}) as any;
  assert.equal(actual.actualResult.id,a.result.resultId);assert.equal(actual.operation,undefined);
  assert.equal((await f.tools.call(event,'task_review',args) as any).state,'accepted');
 }finally{f.close();}
});
test('RECOVERY inspection: reading an operation never marks the adopted contract inspected',async()=>{
 const f=fixture();try{
  const c=await f.tools.call(main,'task_delegate',delegateArgs(f)) as any,w=running(f,c.taskId);
  f.tasks.send(w,{...current(f,c.taskId,'worker-send'),recipientAgentId:main.agentId,kind:'synthetic',payload:{}});
  f.tasks.update(event,{...current(f,c.taskId,'steer'),mode:'steer',contract:{...contract(),goal:'Synthetic changed contract'},children:[],queuedDisposition:[]});
  const hash=f.tasks.inspect(event,{taskId:c.taskId}).contractHash,before=snapshot(f);
  await lookup(f,w,'worker-send',c.taskId);
  const args={...current(f,c.taskId,'adopt'),contractHash:hash};assert.throws(()=>f.tasks.adopt(w,args),/task_adopt_inspection_required/);assert.equal(snapshot(f),before);
  f.tasks.inspect(w,{taskId:c.taskId});assert.equal(f.tasks.adopt(w,args).state,'adopted');
 }finally{f.close();}
});
for(const state of ['prepared','recorded','uncertain'] as const)test('RECOVERY delivery '+state+': historical publication response is separate from live list_work facts',async()=>{
 const f=fixture(true);try{
  const a=await acceptedRootFile(f),d=await f.tools.call(event,'publish_delivery',a.publish) as any;
  if(state!=='prepared'){f.tasks.markDelivery(d.deliveryId,'submitting');f.tasks.markDelivery(d.deliveryId,state);}
  const before=snapshot(f),wakes=f.wakes,r=await lookup(f,{...main,sourceRequestId:'other-user-source'},'publish',f.root.taskId);
  assert.equal(r.operation.response.state,'prepared');assert.equal(r.operation.state,'confirmed');assert.equal(r.operation.response.deliveryId,d.deliveryId);
  assert.equal(f.host.snapshot().deliveries.find((x:any)=>x.id===d.deliveryId).state,state);assert.equal(snapshot(f),before);assert.equal(f.wakes,wakes);
 }finally{f.close();}
});
