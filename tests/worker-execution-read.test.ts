import {test} from 'node:test';import assert from 'node:assert/strict';
import {fixture,main,delegate,running} from './recursive-fixture.js';
import {ConversationHistory} from '../src/web-history.js';import {WorkerProgressStore} from '../src/worker-progress.js';import {Homer} from '../src/service.js';import {readTaskDetail} from '../src/task-overview.js';
import {createWebServer,fetch} from './web-connected-fixture.js';
import {CodexEngine} from '../src/engine.js';
test('execution reader uses trusted current session and exact task/run authority, without inspection writes',()=>{
 const f=fixture();try{
  new ConversationHistory(f.store.db);f.store.setMeta('mainThread','web-thread');f.store.db.prepare('INSERT INTO conversation_inputs VALUES(?,?,?,?)').run('user-synthetic','web-thread','hash','reply');
  const child=delegate(f),actor=running(f,child.taskId),r=f.tasks.run(child.runId);const scope={taskId:child.taskId,version:1,runId:r.id,epoch:r.epoch,threadId:actor.threadId!,turnId:actor.turnId!};
  const progress=new WorkerProgressStore();progress.recordCall(scope,{threadId:scope.threadId,turnId:scope.turnId,itemId:'native',category:'command',status:'completed',completed:true});
  const app=Object.assign(Object.create(Homer.prototype),{tasks:f.tasks,store:f.store,workerProgress:progress,mainActor:()=>main});const selector={rootTaskId:f.root.taskId,taskId:child.taskId,runId:child.runId};
  f.store.db.exec('PRAGMA query_only=ON');const before=f.store.db.prepare('SELECT total_changes() n').get();
  const page=app.readWorkerExecution(selector);assert.equal(page.items.length,1);assert.equal(app.readWorkerCall(selector,page.items[0].callKey).summary.status,'completed');
  assert.deepEqual(f.store.db.prepare('SELECT total_changes() n').get(),before);
  assert.throws(()=>app.readWorkerExecution({...selector,runId:f.root.runId}),/execution_scope_denied/);
  assert.throws(()=>f.tasks.executionReadScope(main,selector,'other-thread'),/execution_scope_denied/);
  f.store.db.exec('PRAGMA query_only=OFF');f.store.setMeta('mainThread','');assert.throws(()=>app.readWorkerExecution(selector),/execution_scope_denied/);
 }finally{f.close();}
});
test('historical run errors are available independently of current progress',()=>{
 const f=fixture();try{const child=delegate(f);f.store.db.prepare("UPDATE runs SET errorCode='restart_unconfirmed' WHERE id=?").run(child.runId);assert.equal(readTaskDetail(f.store.db,f.root.taskId).runs.find(r=>r.id===child.runId)?.errorCode,'restart_unconfirmed');}finally{f.close();}
});
test('gateway exposes scoped no-store reads, path cursors, and rejects query selectors',async()=>{
 const calls:unknown[]=[];
 const web=await createWebServer({port:0,bridge:{taskOverview:{execution:async(selector:unknown,before:unknown)=>{calls.push({selector,before});return {synthetic:true};},call:async(selector:unknown,key:unknown)=>{calls.push({selector,key});return {synthetic:true};}}} as any});
 try{
  const base=web.url+'/api/tasks/root/execution/task/run';
  for(const suffix of ['','/before/cursor','/calls/'+'a'.repeat(64)]){const response=await fetch(base+suffix);assert.equal(response.status,200);assert.match(response.headers.get('cache-control')??'',/no-store/);}
  assert.deepEqual(calls[1],{selector:{rootTaskId:'root',taskId:'task',runId:'run'},before:'cursor'});
  assert.equal((await fetch(base+'?runId=other')).status,400);assert.equal(calls.length,3);
 }finally{await web.close();}
});
test('worker host call wrapper observes the real call once without changing its return or error',async()=>{
 const f=fixture();try{
  const child=delegate(f),actor=running(f,child.taskId),progress=new WorkerProgressStore();let work=0;
  const app=Object.assign(Object.create(Homer.prototype),{tasks:f.tasks,workerProgress:progress,workerActor:()=>actor,invalidateState:()=>{},workerToolWork:async()=>{work++;return {status:'completed',content:'PRIVATE BODY'};}});
  const slot={id:child.runId},call={threadId:actor.threadId,turnId:actor.turnId,callId:'real-call',tool:'work_inspect',arguments:{text:'PRIVATE INPUT'}};
  assert.deepEqual(await app.workerTool(slot,call),{status:'completed',content:'PRIVATE BODY'});assert.equal(work,1);
  const selector={rootTaskId:f.root.taskId,taskId:child.taskId,runId:child.runId};let page=progress.execution(selector,1);assert.equal(page.items.length,1);assert.equal(page.items[0]?.source,'host');assert.doesNotMatch(JSON.stringify(progress.call(selector,1,page.items[0]!.callKey)),/PRIVATE/);
  const error=Error('synthetic_failure');app.workerToolWork=async()=>{throw error;};await assert.rejects(app.workerTool(slot,{...call,callId:'error-call'}),e=>e===error);
  page=progress.execution(selector,1);assert.equal(page.items.at(-1)?.status,'failed');
  await assert.rejects(app.workerTool(slot,{...call,threadId:'other'}),/scope_denied/);assert.equal(progress.execution(selector,1).items.length,2);
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
 const progress=new WorkerProgressStore(),scope={taskId:'task',version:1,runId:'run',epoch:1,threadId:'thread',turnId:'turn'},selector={rootTaskId:'root',taskId:'task',runId:'run'};
 engine.on('nativeProcess',(event:any)=>{if(event.turnId==='turn'&&engine.active)progress.recordCall(scope,event);else progress.completeCall('run',1,event);});
 const receive=(method:string,id:string)=>engine.receive(JSON.stringify({method,params:{threadId:'thread',turnId:'turn',item:{id,type:'commandExecution',command:'cat synthetic',commandActions:[{type:'read'}],exitCode:9,status:'completed'}}}));
 await receive('item/started','known');engine.active=undefined;engine.turnId='next';
 await receive('item/completed','known');await receive('item/completed','unseen');
 const p=progress.execution(selector,1);assert.equal(p.active.length,0);assert.equal(p.items.length,1);assert.equal(p.items[0]?.exitCode,9);assert.equal(p.items[0]?.scope.turnId,'turn');
});
