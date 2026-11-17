import {test} from 'node:test';import assert from 'node:assert/strict';
import {WorkerInteractions} from '../src/worker-interactions.js';
import {chatFixture} from './task-chat-fixture.js';
import {Homer} from '../src/service.js';import {readTaskDetail} from '../src/task-overview.js';
import {createWebServer,fetch} from './web-connected-fixture.js';
import {homerWebBridge} from '../src/web-homer.js';
import {createWebChat} from '../src/web-chat.js';
import {CodexEngine} from '../src/engine.js';
function fixture(){const f=chatFixture();new WorkerInteractions(f.store.db);const task=f.create(),worker=f.tasks.workerOpen(f.actor,{operationId:'open',taskId:task.taskId,text:'Inspect'}),run=f.start(worker.workerId);return {...f,task,worker,run};}
test('execution scope guards still reject a foreign Task, thread or actor',()=>{
 const f=fixture();try{const selector={taskId:f.task.taskId,runId:f.run.id};
  assert.throws(()=>f.tasks.executionReadScope(f.actor,{...selector,taskId:'other'},f.store.meta('mainThread')!),/execution_scope_denied/);
  assert.throws(()=>f.tasks.executionReadScope(f.actor,selector,'other-thread'),/execution_scope_denied/);
  assert.throws(()=>f.tasks.executionReadScope({...f.actor,agentId:'foreign'},selector,f.store.meta('mainThread')!),/task_main_required/);
  assert.equal(f.tasks.executionReadScope(f.actor,selector,f.store.meta('mainThread')!).version,1);
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
  const actor={agentId:'worker:'+f.worker.workerId,runId:f.run.id,epoch:f.run.epoch,threadId:f.run.threadId!,turnId:f.run.turnId!};let work=0;
  const app=Object.assign(Object.create(Homer.prototype),{tasks:f.tasks,workerActor:()=>actor,invalidateState:()=>{},workerToolWork:async()=>{work++;return {status:'completed',content:'PRIVATE BODY'};}}),slot={id:f.run.id},call={threadId:actor.threadId,turnId:actor.turnId,callId:'real-call',tool:'work_inspect',arguments:{text:'PRIVATE INPUT'}};
  assert.deepEqual(await app.workerTool(slot,call),{status:'completed',content:'PRIVATE BODY'});assert.equal(work,1);assert.equal('workerProgress' in app,false);
  const error=Error('synthetic_failure');app.workerToolWork=async()=>{throw error;};await assert.rejects(app.workerTool(slot,{...call,callId:'error-call'}),e=>e===error);await assert.rejects(app.workerTool(slot,{...call,threadId:'other'}),/scope_denied/);
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

test('retired display APIs are unavailable on HTTP and mobile chat while task facts stay readable',async()=>{
 const f=fixture();const bridge=homerWebBridge({...f,registerWebSurface(){},onStateChange(){return ()=>{};}} as any),chat=createWebChat(bridge),web=await createWebServer({port:0,bridge});
 try{
  const base='/api/tasks/'+f.task.taskId;
  for(const [path,error] of [[base+'/execution/'+f.run.id,'task_execution_unavailable'],[base+'/execution/'+f.run.id+'/calls/'+'a'.repeat(64),'task_execution_unavailable'],[base+'/progress','task_overview_unavailable']]){
   const response=await fetch(web.url+path);assert.equal(response.ok,false);assert.equal((await response.json() as any).error,error);
  }
  await assert.rejects(chat('tasks.execution',{taskId:f.task.taskId,runId:f.run.id}),/task_execution_unavailable/);
  await assert.rejects(chat('tasks.call',{taskId:f.task.taskId,runId:f.run.id,callKey:'a'.repeat(64)}),/task_execution_unavailable/);
  await assert.rejects(chat('tasks.progress',{id:f.task.taskId}),/task_overview_unavailable/);
  assert.ok((await chat('tasks.list') as any).tasks.some((task:any)=>task.id===f.task.taskId));
  assert.equal((await chat('tasks.detail',{id:f.task.taskId}) as any).taskId,f.task.taskId);
 }finally{await web.close();f.close();}
});
