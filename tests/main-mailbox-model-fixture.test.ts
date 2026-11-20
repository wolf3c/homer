import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {Homer} from '../src/service.js';
import type {ToolCall} from '../src/engine.js';
import {chatFixture} from './task-chat-fixture.js';
import {MainProcessHistory} from '../src/main-process.js';
import {WorkerInteractions} from '../src/worker-interactions.js';
import {assertMailboxMain,mailboxModelCase,mailboxExpectedStatus,mailboxModelTrace,type MailboxModelScenario} from './fixtures/mailbox-model-case.js';

test('real-model guard accepts the production default Main role and rejects Worker tools',()=>{
 assert.doesNotThrow(()=>assertMailboxMain({nativeTools:'main'}));
 assert.throws(()=>assertMailboxMain({nativeTools:'worker',role:'worker'}));
 assert.throws(()=>assertMailboxMain({nativeTools:'worker',role:'main'}));
});

test('unknown original effects keep the worked coordination unknown without replay or upgrade clearance',async()=>{
 const parent=resolve('.codex/scratch/mailbox-model-acceptance');mkdirSync(parent,{recursive:true});const root=mkdtempSync(join(parent,'replay-'));
 const workspace=join(root,'workspace'),runtime=join(root,'runtime'),home=join(root,'codex');for(const path of [workspace,runtime,home])mkdirSync(path);
 let fixture:ReturnType<typeof mailboxModelCase>|undefined;
 class Replay extends EventEmitter{
  threadId='synthetic-replay-main';turnId?:string;resumable=false;
  constructor(readonly handler:(call:ToolCall)=>Promise<unknown>){super();}
  async start(){return this.threadId;}
  async turn(prompt:string,hooks?:{onStarted?:(id:string)=>void}){
   this.turnId='synthetic-replay-turn';this.resumable=true;hooks?.onStarted?.(this.turnId);
   const [receipt]=JSON.parse(prompt.split('\n')[1]!).operations;
   assert.equal(receipt.id,fixture!.worker.operationKey);assert.equal(receipt.state,'uncertain');
   await this.handler({threadId:this.threadId,turnId:this.turnId,callId:'inspect',tool:'work_inspect',arguments:{operationKey:receipt.id}});
   await this.handler({threadId:this.threadId,turnId:this.turnId,callId:'notes',tool:'task_update',arguments:{taskId:fixture!.task.taskId,notes:'原操作结果未知，已核对回执；等待核实，不重新执行。'}});
   const text='原操作结果尚未确认，未重新执行。';
   return {status:'completed' as const,text,messages:[{itemId:'report',phase:'final_answer',text}]};
  }
  async interrupt(){return false;}async close(){return true;}
 }
 const app=new Homer({workspace,runtime,codexHome:home,nativeCodexHome:home,codexBin:'/usr/bin/false',model:'mock',requiresOpenaiAuth:false,stopGraceMs:100},async()=>{},(options,handler)=>{assertMailboxMain(options);return new Replay(handler);},[],async()=>({home:workspace,folders:[]}));
 try{
  await app.start();fixture=mailboxModelCase(app,'unknown-operation',workspace);
  const trace=mailboxModelTrace(app,fixture.task.taskId,fixture.worker.operationKey),activity=app['mainActivity'].bind(app);
  app['mainActivity']=(tool,work,args)=>trace.observe(tool,()=>activity(tool,work,args),args);
  app['scheduleInputs']();await app.idle();
  const node=app.processes.list(fixture.threadId)[0]!;assert.equal(node.state,'worked');
  assert.equal(node.status,mailboxExpectedStatus('unknown-operation'));
  assert.match(node.final?.text??'',/操作结果尚未确认/);
  assert.deepEqual(app.tasks.operation(fixture.worker.operationKey),fixture.originalOperation);assert.equal(app.tasks.runs(fixture.task.taskId).length,1);
  assert.equal(fixture.notices()[0]!.state,'received');assert.equal(app.upgradeStatus().safe,false);
  trace.assertSafe();assert.equal(trace.originalReceiptRead,true);
  assert.deepEqual(JSON.parse(JSON.stringify(trace)).taskUpdates,[{purpose:'notes',targetMatches:true,allowed:true,outcome:'completed',notesEffectValid:true}]);
 }finally{fixture?.end();await app.close();rmSync(root,{recursive:true,force:true});}
});

const purposes:[string,Record<string,unknown>,string,boolean][]=[
 ['notes',{notes:'synthetic private note'},'notes',true],['clear notes',{notes:''},'notes',true],
 ['goal with notes',{goal:'different goal',notes:'note'},'goal',false],['goal',{goal:'different goal'},'goal',false],
 ['pause',{action:'pause'},'pause',false],['resume',{action:'resume'},'resume',false],['cancel',{action:'cancel'},'invalid',false],
 ['settle',{action:'settle',outcome:'failed',notes:'note'},'invalid',false],
 ['notes and reason',{notes:'note',reason:'reason'},'invalid',false],['notes and outcome',{notes:'note',outcome:'succeeded'},'invalid',false],
 ['notes and unknown field',{notes:'note',authority:'forged'},'invalid',false],['unknown action',{action:'unrecognized private text'},'invalid',false],
 ['null action',{notes:'note',action:null},'invalid',false],['nonstring notes',{notes:42},'invalid',false],
 ['array action',{action:['pause']},'invalid',false],['object action',{action:{toString:()=> 'pause',private:'SYNTHETIC_PRIVATE_ACTION'}},'invalid',false],
 ['oversized notes',{notes:'x'.repeat(24001)},'invalid',false],['missing notes',{},'invalid',false],
];
for(const [name,fields,purpose,allowed] of purposes)test('mailbox tool purpose distinguishes '+name,async()=>{
 const f=chatFixture(),task=f.create(),trace=mailboxModelTrace(f,task.taskId,task.operationKey);
 try{
  const args={taskId:task.taskId,...fields};
  await trace.observe('task_update',async()=>allowed?f.tasks.updateTask(f.actor,{operationId:'notes',taskId:task.taskId,expectedRevision:f.tasks.task(task.taskId).revision,patch:{notes:String(fields.notes)}}):f.tasks.task(task.taskId),args);
  assert.deepEqual(trace.forbidden,allowed?[]:['task_update']);
  if(allowed)trace.assertSafe();else assert.throws(()=>trace.assertSafe(),/mailbox_forbidden_action/);
  assert.deepEqual(JSON.parse(JSON.stringify(trace)).taskUpdates,[{purpose,targetMatches:true,allowed,outcome:'completed',notesEffectValid:allowed?true:null}]);
 }finally{f.close();}
});

for(const [name,args] of [
 ['wrong task',{taskId:'other-task',notes:'note'}],['missing task',{notes:'note'}],['null',null],['array',[]],
 ['inherited fields',Object.create({taskId:'other-task',notes:'note'})],
] as [string,unknown][])test('mailbox notes exemption rejects '+name,async()=>{
 const f=chatFixture(),task=f.create(),trace=mailboxModelTrace(f,task.taskId,task.operationKey);
 try{
  await trace.observe('task_update',async()=>f.tasks.task(task.taskId),args);
  assert.deepEqual(trace.forbidden,['task_update']);
  const entry=JSON.parse(JSON.stringify(trace)).taskUpdates[0];assert.equal(entry.allowed,false);assert.equal(entry.targetMatches,false);
 }finally{f.close();}
});

test('inherited goal and symbol fields cannot disguise a notes-only call',async()=>{
 const f=chatFixture(),task=f.create(),trace=mailboxModelTrace(f,task.taskId,task.operationKey);
 try{
  const inherited=Object.assign(Object.create({goal:'untrusted goal'}),{taskId:task.taskId,notes:'note'});
  const symbol={taskId:task.taskId,notes:'note',[Symbol('private-field')]:'SYNTHETIC_PRIVATE_SYMBOL'};
  for(const args of [inherited,symbol])await trace.observe('task_update',async()=>f.tasks.task(task.taskId),args);
  assert.deepEqual(trace.forbidden,['task_update','task_update']);
  assert.ok(JSON.parse(JSON.stringify(trace)).taskUpdates.every((item:{purpose:string;allowed:boolean})=>item.purpose==='invalid'&&!item.allowed));
 }finally{f.close();}
});

test('forbidden business calls remain failures when the real handler rejects them',async()=>{
 const f=chatFixture(),task=f.create(),trace=mailboxModelTrace(f,task.taskId,task.operationKey);
 try{
  await assert.rejects(trace.observe('worker_open',async()=>f.tasks.workerOpen(f.actor,{operationId:'forbidden',taskId:'missing-task',text:'synthetic'}),{taskId:'missing-task'}),/task_not_found/);
  assert.deepEqual(trace.forbidden,['worker_open']);assert.deepEqual(trace.toolErrors,['worker_open']);
  assert.equal(f.tasks.runs().length,0);assert.equal(f.tasks.tasks().length,1);
 }finally{f.close();}
});

for(const mutation of ['task-state','authority','worker','original-operation'])test('notes-shaped call fails acceptance if it changes '+mutation,async()=>{
 const f=chatFixture(),interactions=new WorkerInteractions(f.store.db),processes=new MainProcessHistory(f.store.db);
 const c=mailboxModelCase({...f,interactions,processes},'unknown-operation',f.dir),trace=mailboxModelTrace(f,c.task.taskId,c.worker.operationKey);
 try{
  await trace.observe('task_update',async()=>{
   const result=f.tasks.updateTask(f.actor,{operationId:'notes',taskId:c.task.taskId,expectedRevision:f.tasks.task(c.task.taskId).revision,patch:{notes:'synthetic note'}});
   if(mutation==='task-state')f.store.db.prepare("UPDATE tasks SET state='paused' WHERE id=?").run(c.task.taskId);
   else if(mutation==='authority')f.store.db.prepare("UPDATE task_versions SET authorityJson='{}' WHERE taskId=?").run(c.task.taskId);
   else if(mutation==='worker')f.store.db.prepare('UPDATE runs SET epoch=epoch+1 WHERE id=?').run(c.worker.runId);
   else f.store.db.prepare("UPDATE operations SET state='confirmed' WHERE id=?").run(c.worker.operationKey);
   return result;
  },{taskId:c.task.taskId,notes:'synthetic note'});
  assert.deepEqual(trace.forbidden,['task_update_effect']);assert.equal(JSON.parse(JSON.stringify(trace)).taskUpdates[0].notesEffectValid,false);
  assert.throws(()=>trace.assertSafe(),/mailbox_forbidden_action/);
 }finally{c.end();f.close();}
});

test('a pending notes call cannot pass acceptance before its effect is confirmed',async()=>{
 const f=chatFixture(),task=f.create(),trace=mailboxModelTrace(f,task.taskId,task.operationKey);
 let release!:()=>void;const barrier=new Promise<void>(resolve=>{release=resolve;});
 const pending=trace.observe('task_update',async()=>{await barrier;return f.tasks.updateTask(f.actor,{operationId:'notes',taskId:task.taskId,expectedRevision:f.tasks.task(task.taskId).revision,patch:{notes:'note'}});},{taskId:task.taskId,notes:'note'});
 try{assert.throws(()=>trace.assertSafe(),/mailbox_task_update_unconfirmed/);}
 finally{release();await pending;f.close();}
 trace.assertSafe();
});

test('mailbox diagnostics omit notes, identifiers, returned bodies and errors while recording purpose failures',async()=>{
 const f=chatFixture(),task=f.create(),trace=mailboxModelTrace(f,task.taskId,task.operationKey),secret='SYNTHETIC_PRIVATE_CONTENT';
 try{
  await trace.observe('task_update',async()=>f.tasks.updateTask(f.actor,{operationId:'notes',taskId:task.taskId,expectedRevision:f.tasks.task(task.taskId).revision,patch:{notes:secret}}),{taskId:task.taskId,notes:secret});
  await assert.rejects(trace.observe('task_update',async()=>{throw Error(secret);},{taskId:task.taskId,notes:secret}),/SYNTHETIC_PRIVATE_CONTENT/);
  assert.throws(()=>trace.assertSafe(),/mailbox_tool_failed/);
  await trace.observe('task_update',async()=>({body:secret}),{taskId:secret,action:secret,reason:secret});
  const encoded=JSON.stringify(trace),entries=JSON.parse(encoded).taskUpdates;
  assert.equal(encoded.includes(secret),false);assert.equal(encoded.includes(task.taskId),false);assert.equal(encoded.includes(task.operationKey),false);
  assert.deepEqual(entries,[
   {purpose:'notes',targetMatches:true,allowed:true,outcome:'completed',notesEffectValid:true},
   {purpose:'notes',targetMatches:true,allowed:true,outcome:'error',notesEffectValid:null},
   {purpose:'invalid',targetMatches:false,allowed:false,outcome:'completed',notesEffectValid:null},
  ]);
  assert.deepEqual(trace.toolErrors,['task_update']);assert.deepEqual(trace.forbidden,['task_update']);
 }finally{f.close();}
});

for(const scenario of ['approval-recovery','expired','unknown-operation'] as MailboxModelScenario[])test('real-model fixture preflight: '+scenario,async()=>{
 const f=chatFixture(),interactions=new WorkerInteractions(f.store.db),processes=new MainProcessHistory(f.store.db);
 const c=mailboxModelCase({...f,interactions,processes},scenario,f.dir);
 try{
  assert.equal(f.tasks.tasks().length,1);assert.equal(f.store.runs().length,1);
  if(scenario==='approval-recovery'){
   assert.equal(c.originalNotices[0]!.state,'received');assert.equal(processes.exact('synthetic-failed-coordination')!.status,'failed');
   assert.equal(interactions.inspect(c.interactionId!).state,'pending_main');assert.equal(c.delivered(),0);
   assert.equal(f.inputs.runnableHead('all'),undefined,'the received failed notice is not reoffered');
   assert.ok(c.recovery&&!Object.hasOwn(c.recovery,'interactionId'),'recovery is an ordinary new user command');
   f.inputs.accept(c.recovery);const input=f.inputs.claim()!;assert.equal(input.origin,'user');
   assert.throws(()=>interactions.respond(c.interactionId!,{action:'approve',reason:'Never widen the request',permissions:{network:null,fileSystem:{read:[f.dir],write:[f.dir]}}}),/interaction_permission_scope/);
   assert.equal(interactions.inspect(c.interactionId!).state,'pending_main');assert.equal(c.delivered(),0);
   interactions.respond(c.interactionId!,{action:'approve',reason:'Synthetic preflight only',permissions:{network:null,fileSystem:{read:[f.dir],write:null}}});
   await Promise.resolve();assert.equal(c.delivered(),1);assert.ok(interactions.inspect(c.interactionId!).deliveredAt);
   assert.deepEqual(c.grant(),{scope:'turn',permissions:{fileSystem:{read:[f.dir],write:null}}});
   assert.throws(()=>interactions.respond(c.interactionId!,{action:'approve',reason:'No duplicate'}),/already_resolved/);
   assert.deepEqual(c.notices(),c.originalNotices);
  }else if(scenario==='expired'){
   assert.equal(interactions.inspect(c.interactionId!).state,'expired');assert.equal(c.delivered(),0);
   assert.throws(()=>interactions.respond(c.interactionId!,{action:'approve',reason:'Never revive'}),/not_live/);
   const head=f.inputs.runnableHead('all');assert.ok(head&&head.origin!=='user');assert.equal(head.kind,'interaction_required');
  }else{
   assert.equal(c.originalOperation.state,'uncertain');const head=f.inputs.runnableHead('all');assert.ok(head&&head.origin!=='user');assert.equal(head.kind,'worker_reply');
   assert.equal(f.tasks.operation(c.worker.operationKey).responseJson,c.originalOperation.responseJson);
  }
 }finally{c.end();f.close();}
});
