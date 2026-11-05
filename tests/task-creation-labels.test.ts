import {test} from 'node:test';import assert from 'node:assert/strict';
import {Homer} from '../src/service.js';import {RecursiveTools} from '../src/recursive-tools.js';import {MainProcessHistory} from '../src/main-process.js';import {ConversationHistory} from '../src/web-history.js';import {chatFixture} from './task-chat-fixture.js';
function setup(event:boolean){
 const f=chatFixture(),processes=new MainProcessHistory(f.store.db);f.history.record('reply','thread:main','','running');processes.start({id:'node',threadId:'thread:main',sourceKind:event?'worker':'user',sourceMessageIds:[],messageId:'reply'},'turn:main');
 const context:any={event,processId:'node',generation:{generationId:'generation',threadId:'thread:main',turnId:'turn:main',messageId:'reply',sourceRequestId:f.actor.sourceRequestId}},app:any=Object.create(Homer.prototype);
 Object.assign(app,{tasks:f.tasks,store:f.store,mainContext:context,history:f.history,processes,mainActor:()=>f.actor,validateMainContext(){},emit:async()=>{}});
 return {...f,app,processes,context,items:()=>event?processes.list('thread:main')[0]!.items:f.history.list('thread:main').find(m=>m.id==='reply')!.toolActivities!,work:(fn:()=>Promise<unknown>)=>app.mainActivity('task_create',fn)};
}
for(const event of [false,true])test('creation records its actual tool status and durable receipt without interpreting arbitrary errors, event='+event,async()=>{
 const f=setup(event);try{
  let release!:(v:unknown)=>void;const pending=f.work(()=>new Promise(resolve=>{release=resolve;}));assert.equal((f.items()[0] as any).label,'创建任务');const task=f.create();release(task);await pending;assert.equal((f.items()[0] as any).status,'completed');
  for(const code of ['task_authority_input_denied','operation_payload_conflict','operation_uncertain','synthetic_postcommit_context_failure']){await assert.rejects(()=>f.work(async()=>{throw Error(code);}));assert.equal((f.items().at(-1) as any).status,'failed');assert.doesNotMatch((f.items().at(-1) as any).label,/已创建|未创建/);}
  const tools=new RecursiveTools(f.tasks,{rootAuthority:()=>f.authority,wake:()=>{throw Error('synthetic_postcommit_wake_failure');}} as any);
  await assert.rejects(()=>f.work(()=>tools.call(f.actor,'task_create',{goal:'Synthetic wake'},'wake-call')),/synthetic_postcommit_wake_failure/);assert.equal((f.items().at(-1) as any).status,'failed');const op=f.store.db.prepare("SELECT responseJson FROM operations WHERE kind='task_create' ORDER BY rowid DESC LIMIT 1").get()!;assert.ok(JSON.parse(String(op.responseJson)).taskId);
  const refreshed=event?new MainProcessHistory(f.store.db).list('thread:main')[0]!.items:new ConversationHistory(f.store.db).list('thread:main').find(m=>m.id==='reply')!.toolActivities!;assert.equal((refreshed[0] as any).status,'completed');const first=refreshed[0] as any;
  if(event)f.processes.tool('node',{id:first.id,label:'创建任务',phase:'start'});else f.history.tool('reply',{id:first.id,label:'创建任务',phase:'start'});assert.equal((f.items()[0] as any).status,'completed');
 }finally{f.close();}
});
for(const event of [false,true])test('interrupted creation stays unknown after recovery and late return, event='+event,async()=>{
 const f=setup(event);try{
  let release!:(v:unknown)=>void;const pending=f.work(()=>new Promise(resolve=>{release=resolve;}));if(event)f.processes.reconcileUnknown('thread:main');else f.history.reconcile();assert.equal((f.items()[0] as any).label,'创建结果待核对');assert.equal((f.items()[0] as any).status,'blocked');release({taskId:'synthetic',operationKey:'synthetic'});await pending;assert.equal((f.items()[0] as any).label,'创建结果待核对');assert.equal((f.items()[0] as any).status,'blocked');
 }finally{f.close();}
});
