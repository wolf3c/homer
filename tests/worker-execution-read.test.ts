import {test} from 'node:test';import assert from 'node:assert/strict';
import {WorkerInteractions} from '../src/worker-interactions.js';
import {chatFixture} from './task-chat-fixture.js';
import {WorkerProgressStore} from '../src/worker-progress.js';import {Homer} from '../src/service.js';import {readTaskDetail} from '../src/task-overview.js';
import {createWebServer,fetch} from './web-connected-fixture.js';
import {CodexEngine} from '../src/engine.js';
function fixture(){const f=chatFixture();new WorkerInteractions(f.store.db);const task=f.create(),worker=f.tasks.workerOpen(f.actor,{operationId:'open',taskId:task.taskId,text:'Inspect'}),run=f.start(worker.workerId);return {...f,task,worker,run};}
test('execution reader uses trusted current session and exact Task/Run authority without writes',()=>{
 const f=fixture();try{
  const r=f.run,scope={taskId:f.task.taskId,version:1,runId:r.id,epoch:r.epoch,threadId:r.threadId!,turnId:r.turnId!},progress=new WorkerProgressStore();progress.recordCall(scope,{threadId:scope.threadId,turnId:scope.turnId,itemId:'native',category:'command',status:'completed',completed:true});
  const app=Object.assign(Object.create(Homer.prototype),{tasks:f.tasks,store:f.store,workerProgress:progress,mainActor:()=>f.actor}),selector={taskId:f.task.taskId,runId:r.id};
  f.store.db.exec('PRAGMA query_only=ON');const before=f.store.db.prepare('SELECT total_changes() n').get(),page=app.readWorkerExecution(selector);assert.equal(page.items.length,1);assert.equal(app.readWorkerCall(selector,page.items[0].callKey).summary.status,'completed');assert.deepEqual(f.store.db.prepare('SELECT total_changes() n').get(),before);
  assert.throws(()=>app.readWorkerExecution({...selector,taskId:'other'}),/execution_scope_denied/);assert.throws(()=>f.tasks.executionReadScope(f.actor,selector,'other-thread'),/execution_scope_denied/);
  f.store.db.exec('PRAGMA query_only=OFF');f.store.setMeta('mainThread','');assert.throws(()=>app.readWorkerExecution(selector),/identity_denied/);
 }finally{f.close();}
});
test('historical Run errors remain accessible independently of current progress',()=>{
 const f=fixture();try{f.tasks.endSegment(f.run.id,f.run.epoch,{status:'failed',text:'',errorCode:'restart_unconfirmed'},true);f.tasks.workerSend(f.actor,{operationId:'followup',workerId:f.worker.workerId,text:'Continue'});assert.equal(readTaskDetail(f.store.db,f.task.taskId).runs.find(r=>r.id===f.run.id)?.errorCode,'restart_unconfirmed');}finally{f.close();}
});
test('gateway exposes scoped no-store reads, path cursors and rejects query selectors',async()=>{
 const calls:unknown[]=[],web=await createWebServer({port:0,bridge:{taskOverview:{execution:async(selector:unknown,before:unknown)=>{calls.push({selector,before});return {synthetic:true};},call:async(selector:unknown,key:unknown)=>{calls.push({selector,key});return {synthetic:true};}}} as any});
 try{const base=web.url+'/api/tasks/task/execution/run';for(const suffix of ['','/before/cursor','/calls/'+'a'.repeat(64)]){const response=await fetch(base+suffix);assert.equal(response.status,200);assert.match(response.headers.get('cache-control')??'',/no-store/);}assert.deepEqual(calls[1],{selector:{taskId:'task',runId:'run'},before:'cursor'});assert.equal((await fetch(base+'?runId=other')).status,400);assert.equal(calls.length,3);}finally{await web.close();}
});
test('host call wrapper observes one real call and retains return/error and scope denial',async()=>{
 const f=fixture();try{
  const actor={agentId:'worker:'+f.worker.workerId,runId:f.run.id,epoch:f.run.epoch,threadId:f.run.threadId!,turnId:f.run.turnId!},progress=new WorkerProgressStore();let work=0;
  const app=Object.assign(Object.create(Homer.prototype),{tasks:f.tasks,workerProgress:progress,workerActor:()=>actor,invalidateState:()=>{},workerToolWork:async()=>{work++;return {status:'completed',content:'PRIVATE BODY'};}}),slot={id:f.run.id},call={threadId:actor.threadId,turnId:actor.turnId,callId:'real-call',tool:'work_inspect',arguments:{text:'PRIVATE INPUT'}};
  assert.deepEqual(await app.workerTool(slot,call),{status:'completed',content:'PRIVATE BODY'});assert.equal(work,1);const selector={taskId:f.task.taskId,runId:f.run.id};let page=progress.execution(selector,1);assert.equal(page.items.length,1);assert.equal(page.items[0]?.source,'host');assert.doesNotMatch(JSON.stringify(progress.call(selector,1,page.items[0]!.callKey)),/PRIVATE/);
  const error=Error('synthetic_failure');app.workerToolWork=async()=>{throw error;};await assert.rejects(app.workerTool(slot,{...call,callId:'error-call'}),e=>e===error);page=progress.execution(selector,1);assert.equal(page.items.at(-1)?.status,'failed');await assert.rejects(app.workerTool(slot,{...call,threadId:'other'}),/scope_denied/);assert.equal(progress.execution(selector,1).items.length,2);
 }finally{f.close();}
});
test('worker native MCP facts use protocol item ID and main host de-dup remains intact',async()=>{
 for(const role of ['worker','main'] as const){
  const engine:any=new CodexEngine({runtime:'/synthetic',workspace:process.cwd(),codexHome:'/synthetic'} as any,{cwd:process.cwd(),readRoots:[],instructions:'',tools:[],nativeTools:role},async()=>({}));
  engine.threadId='thread';engine.turnId='turn';engine.active={text:'',messages:[],earlyEvents:[],resolve:()=>{}};engine.refreshBackground=async()=>{};
  const observed:any[]=[];engine.on('nativeProcess',(event:unknown)=>observed.push(event));
  for(const method of ['item/started','item/completed'])await engine.receive(JSON.stringify({method,params:{threadId:'thread',turnId:'turn',item:{id:'protocol-item',type:'mcpToolCall',server:'homer_interactions',tool:'work_inspect',arguments:{},result:{status:'completed'},status:method==='item/started'?'inProgress':'completed'}}}));
  assert.equal(observed.length,role==='worker'?2:0);if(role==='worker')assert.equal(observed[0].itemId,'protocol-item');
 }
});
test('late worker terminal can complete only a retained original turn call',async()=>{
 const engine:any=new CodexEngine({runtime:'/synthetic',workspace:process.cwd(),codexHome:'/synthetic'} as any,{cwd:process.cwd(),readRoots:[],instructions:'',tools:[],nativeTools:'worker'},async()=>({}));
 engine.threadId='thread';engine.turnId='turn';engine.active={text:'',messages:[],earlyEvents:[],resolve:()=>{}};engine.refreshBackground=async()=>{};
 const progress=new WorkerProgressStore(),scope={taskId:'task',version:1,runId:'run',epoch:1,threadId:'thread',turnId:'turn'},selector={taskId:'task',runId:'run'};
 engine.on('nativeProcess',(event:any)=>{if(event.turnId==='turn'&&engine.active)progress.recordCall(scope,event);else progress.completeCall('run',1,event);});
 const receive=(method:string,id:string)=>engine.receive(JSON.stringify({method,params:{threadId:'thread',turnId:'turn',item:{id,type:'commandExecution',command:'cat synthetic',commandActions:[{type:'read'}],exitCode:9,status:'completed'}}}));
 await receive('item/started','known');engine.active=undefined;engine.turnId='next';
 await receive('item/completed','known');await receive('item/completed','unseen');
 const p=progress.execution(selector,1);assert.equal(p.active.length,0);assert.equal(p.items.length,1);assert.equal(p.items[0]?.exitCode,9);assert.equal(p.items[0]?.scope.turnId,'turn');
});
