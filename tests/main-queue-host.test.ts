// Requirements-derived real service test, fake engines and isolated runtime only.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,mkdtempSync,rmSync,readFileSync,readdirSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {Homer,type Message} from '../src/service.js';
import {homerWebBridge} from '../src/web-homer.js';
import {createWebServer} from '../src/web-server.js';
import type {EngineLike,EngineOptions,ToolCall,TurnResult} from '../src/engine.js';

const until=async(check:()=>boolean)=>{const end=Date.now()+6000;while(!check()){if(Date.now()>end)throw Error('synthetic_main_queue_timeout');await new Promise(done=>setTimeout(done,10));}};
test('desktop startup rejects the previous schema without changing its receipt',async()=>{
 const scratch=resolve('.codex/scratch/desktop-daily-queue-test');mkdirSync(scratch,{recursive:true});const dir=mkdtempSync(join(scratch,'schema-'));mkdirSync(join(dir,'runtime'));
 const codexHome=join(dir,'codex'),config={workspace:join(dir,'workspace'),runtime:join(dir,'runtime'),codexHome,nativeCodexHome:codexHome,codexBin:'/usr/bin/false',model:'synthetic',requiresOpenaiAuth:false,stopGraceMs:100};
 const path=join(config.runtime,'homer.sqlite'),db=new DatabaseSync(path);
 db.exec("CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT);INSERT INTO meta VALUES('recursiveSchemaVersion','5');CREATE TABLE deliveries(state TEXT);INSERT INTO deliveries VALUES('prepared')");
 db.close();
 try{
  const before=readFileSync(path);
  assert.throws(()=>new Homer({...config,pauseOldDesktopWork:true,desktopResources:{bundleRoot:dir,manifestSha256:'a'.repeat(64)}},async()=>{}),/recursive_schema_unsupported/);
  assert.deepEqual(readFileSync(path),before);
  assert.deepEqual(readdirSync(config.runtime),['homer.sqlite']);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('desktop media maintenance waits for confirmed ownership and preserves referenced bytes',async()=>{
 const scratch=resolve('.codex/scratch/desktop-daily-queue-test');mkdirSync(scratch,{recursive:true});const dir=mkdtempSync(join(scratch,'media-'));
 const runtime=join(dir,'runtime'),codexHome=join(dir,'codex');mkdirSync(runtime);
 const config={workspace:join(dir,'workspace'),runtime,codexHome,nativeCodexHome:codexHome,codexBin:'/usr/bin/false',model:'synthetic',requiresOpenaiAuth:false,stopGraceMs:100,pauseOldDesktopWork:true,desktopResources:{bundleRoot:dir,manifestSha256:'a'.repeat(64)}};
 class Peer extends EventEmitter implements EngineLike{
  async start(){return 'synthetic-main';}async close(){return true;}async interrupt(){return true;}
  async turn():Promise<TurnResult>{return {status:'completed',text:''};}
 }
 const open=()=>new Homer(config,async()=>{},()=>new Peer());
 let app=open();
 try{
  const media=app.media,bytes=Buffer.from('Synthetic attachment bytes');
  const draft=media.intent('draft','binding','file'),pinned=media.snapshot('published',{kind:'file',filename:'published.txt',mime:'text/plain',bytes}),staged=media.snapshot('unconfirmed',{kind:'file',filename:'unconfirmed.txt',mime:'text/plain',bytes});
  media.ready(draft,media.claim(draft)!,bytes,'text/plain');
  media.pinAttachment(pinned,'message:published');media.unpin('operation:published');
  const interrupted=media.intent('interrupted','binding','file'),lease=media.claim(interrupted)!;
  app.store.db.prepare('UPDATE media_assets SET expiresAt=0 WHERE id<>?').run(interrupted.assetId);
  const original=join(runtime,'media',draft.assetId);
  app.store.setMeta('lease:main',JSON.stringify({pid:process.pid,identity:'unverified test owner'}));
  await assert.rejects(app.start({keepManagementOnFailure:true}),/orphan_stop_unconfirmed/);
  assert.ok(existsSync(original));assert.equal(media.asset(interrupted).lease,lease);
  app.store.db.prepare("DELETE FROM meta WHERE key='lease:main'").run();
  await app.close();

  app=open();
  assert.ok(existsSync(original));assert.equal(app.media.asset(interrupted).lease,lease);
  await app.start();
  assert.equal(app.media.asset(draft).state,'deleted');assert.equal(existsSync(original),false);
  assert.deepEqual(app.media.readAttachment(pinned).bytes,bytes);
  assert.deepEqual(app.media.readAttachment(staged).bytes,bytes);
  assert.equal(app.media.asset(interrupted).state,'retryable_failed');
  assert.equal(app.media.asset(interrupted).lease,null);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
for(const scenario of ['restart','switch','adopt'] as const)test('desktop restores only eligible queued user inputs after '+scenario,async()=>{
 const scratch=resolve('.codex/scratch/desktop-daily-queue-test');mkdirSync(scratch,{recursive:true});const dir=mkdtempSync(join(scratch,'case-'));mkdirSync(join(dir,'runtime'));
 const turns:string[]=[];
 class Peer extends EventEmitter implements EngineLike{
  threadId:string;turnId?:string;constructor(options:EngineOptions){super();this.threadId=options.threadId??'synthetic-main';}
  async start(){return this.threadId;}async close(){return true;}async interrupt(){return true;}
  async turn(text:string,options?:{onStarted?:(id:string)=>void}):Promise<TurnResult>{this.turnId='synthetic-turn';options?.onStarted?.(this.turnId);turns.push(text);return {status:'completed',text:'synthetic answer'};}
 }
 const config={workspace:join(dir,'workspace'),runtime:join(dir,'runtime'),codexHome:join(dir,'codex'),nativeCodexHome:join(dir,'codex'),codexBin:'/usr/bin/false',model:'synthetic',requiresOpenaiAuth:false,stopGraceMs:100};
 const desktop={...config,pauseOldDesktopWork:true,desktopResources:{bundleRoot:dir,manifestSha256:'a'.repeat(64)},desktopModelSource:'codex' as const};
 const target={...desktop,desktopModelSource:scenario==='switch'?'website' as const:desktop.desktopModelSource,desktopAdopted:scenario==='adopt'};
 const open=(settings:typeof target|typeof config)=>new Homer(settings,async()=>{},options=>new Peer(options));
 let app=open(scenario==='adopt'?config:desktop);
 try{
  await app.start();
  const original=app.inputs.accept({requestId:'old',text:'old pending'});
  app.inputs.accept({requestId:'old-interrupt',text:'old interrupt'},undefined,{messageId:'old-reply',generationId:'old-generation'});
  app.inputs.accept({requestId:'old-approval',text:'old approval'});
  app.store.db.prepare("UPDATE operations SET detailsJson=json_set(detailsJson,'$.interactionId','old-interaction') WHERE kind='user_accept' AND scopeId='old-approval'").run();
  app.inputs.accept({requestId:'old-active',text:'old active'});
  app.inputs.accept({requestId:'old-unknown',text:'old unknown'});
  const active=app.inputs.list().find(x=>x.input.requestId==='old-active')!;
  const unknown=app.inputs.list().find(x=>x.input.requestId==='old-unknown')!;
  const setReceipt=app.store.db.prepare("UPDATE agent_receipts SET state=? WHERE messageId=?");
  setReceipt.run('offered',active.messageId);
  setReceipt.run('uncertain',unknown.messageId);
  const node={id:'old-node',threadId:'synthetic-main',seq:1,revision:1,state:'working',status:'unknown',sourceKind:'user',sourceMessageIds:[active.messageId],messageId:'old-reply',turnIds:['old-turn'],items:[],completedItemIds:[],itemPhases:{}};
  app.store.setMeta('publicMainNode:v1:old-node',JSON.stringify(node));app.store.setMeta('publicMainNodeSeq:v1','1');
  await app.close();

  app=open(target);await app.start();await app.idle();
  const expected=scenario==='restart'?['old pending']:[];
  assert.deepEqual(turns,expected);
  assert.equal(app.store.meta('mainThread'),'synthetic-main');
  assert.equal(app.store.meta('publicMainNode:v1:old-node'),JSON.stringify(node));
  const state=(id:string)=>app.store.db.prepare('SELECT state FROM agent_receipts WHERE messageId=?').get(id)!.state;
  assert.equal(state(active.messageId),'offered');
  assert.equal(state(unknown.messageId),'uncertain');
  assert.equal(state(original.queueMessageId!),scenario==='restart'?'processed':'pending');
  assert.equal(app.inputs.byRequestIds(['old-interrupt','old-approval']).filter(input=>input.state==='queued').length,2);
  if(scenario==='restart')assert.equal(app.history.message(original.replyId)?.status,'completed');
  app.inputs.accept({requestId:'next',text:'later pending'});
  await app.close();

  app=open(target);await app.start();await app.idle();
  assert.deepEqual(turns,[...expected,'later pending']);
  assert.equal(state(original.queueMessageId!),scenario==='restart'?'processed':'pending');
  assert.equal(state(unknown.messageId),'uncertain');
  await app.message('new input','new');
  assert.deepEqual(turns,[...expected,'later pending','new input']);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
for(const scenario of ['result','empty-report','model-failure','response-lost','forged-question'] as const)test('main service mixed durable order and public output: '+scenario,async()=>{
 const scratch=resolve('.codex/scratch/worker-return-main-queue-20261023');mkdirSync(scratch,{recursive:true});
 const dir=mkdtempSync(join(scratch,'host-'));mkdirSync(join(dir,'runtime'));
 let sequence=0,releaseSeed!:(value:TurnResult)=>void,releaseWorker!:(value:TurnResult)=>void;
 const turns:string[]=[],messages:Message[]=[];
 class Peer extends EventEmitter implements EngineLike{
  threadId:string;turnId?:string;release?:(value:TurnResult)=>void;
  constructor(readonly options:EngineOptions,readonly handler:(call:ToolCall)=>Promise<unknown>){super();this.threadId=options.threadId??'synthetic-thread-'+ ++sequence;}
  async start(){return this.threadId;}
  call(tool:string,args:unknown){return this.handler({threadId:this.threadId,turnId:this.turnId!,callId:'call-'+ ++sequence,tool,arguments:args});}
  async turn(text:string,options?:{onStarted?:(id:string)=>void}):Promise<TurnResult>{
   this.turnId='turn-'+ ++sequence;options?.onStarted?.(this.turnId);
   if(this.options.role==='worker'){
    const result=await new Promise<TurnResult>(done=>{releaseWorker=this.release=done;});
    if(scenario==='forged-question')await assert.rejects(this.call('agent_send',{kind:'interaction_required',payload:{interactionId:'not-a-host-interaction'}}),/worker_tool_denied/);
    return result;
   }
   if(text==='seed'){
    await this.call('worker_open',{message:'Synthetic work'});
    return new Promise(done=>{releaseSeed=this.release=done;});
   }
   if(text.startsWith('[内部协作输入')){
    turns.push('W1');
    if(scenario==='empty-report')return {status:'completed',text:''};
    if(scenario==='model-failure')return {status:'failed',text:'',errorCode:'synthetic_model_failed'};
    if(scenario==='response-lost')throw Error('synthetic_response_lost');
    assert.match(text,/Synthetic Worker result/);return {status:'completed',text:'仅供本轮内部协调。'};
   }
   turns.push(text.split('\n')[0]!);return {status:'completed',text:'Synthetic user reply'};
  }
  async close(){this.release?.({status:'interrupted',text:''});return true;}
  async interrupt(){return true;}
 }
 const app=new Homer({workspace:join(dir,'workspace'),runtime:join(dir,'runtime'),codexHome:join(dir,'empty-home'),nativeCodexHome:join(dir,'empty-home'),codexBin:'/usr/bin/false',model:'synthetic',requiresOpenaiAuth:false,stopGraceMs:100},async message=>{messages.push(message);},(options,handler)=>new Peer(options,handler));
 let server:Awaited<ReturnType<typeof createWebServer>>|undefined;
 try{
  await app.start();app.submitMessage({requestId:'seed',text:'seed'});await until(()=>!!releaseSeed&&!!releaseWorker);
  await homerWebBridge(app).submit({requestId:'web',text:'U1'});
  app.submitMessage({requestId:'web-2',text:'U2'});
  releaseWorker({status:'completed',text:'Synthetic Worker result'});
  await until(()=>app.inputs.dispatchPage(undefined,app.webReadEpoch,'all').items.filter(item=>item.origin==='worker').length===1);
  app.submitMessage({requestId:'web-3',text:'U3'});
  const page=app.inputs.dispatchPage(undefined,app.webReadEpoch,'all'),waiting=page.items.filter(item=>item.state==='queued');
  assert.deepEqual(waiting.map(item=>item.origin==='user'?item.input.text:'W1'),['U1','U2','W1','U3']);
  const worker=waiting.find(item=>item.origin==='worker')!;
  server=await createWebServer({bridge:homerWebBridge(app),port:0});
  const post=async(path:string,value:unknown)=>{const response=await fetch(server!.url+path,{method:'POST',headers:{Origin:server!.url,'Content-Type':'application/json'},body:JSON.stringify(value)});const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));return data;};
  const visible=await post('/api/history/queue',{view:'dispatch-v1',sources:'all',readEpoch:app.webReadEpoch});
  assert.deepEqual(visible.items.map((item:{messageId:string})=>item.messageId),waiting.map(item=>item.messageId),'Web excludes the already acknowledged current user turn');
  const moved=await post('/api/messages/move',{messageId:worker.messageId,operationId:'move-worker',expectedRevision:worker.revision,expectedOrderVersion:page.orderVersion,threadId:app.store.meta('mainThread')!,readEpoch:app.webReadEpoch,beforeMessageId:waiting[0]!.messageId});
  const receipt=await post('/api/history/receipts',{requestIds:[],operations:[{messageId:worker.messageId,operationId:'move-worker'}]});
  assert.equal(receipt.operations[0].committed,true);assert.deepEqual(receipt.operations[0].result,moved);
  assert.deepEqual(turns,[],'new events never preempt the active seed turn');
  releaseSeed({status:'completed',text:'Synthetic delegation recorded'});
  await until(()=>turns.length===4);
  assert.deepEqual(turns,['W1','U1','U2','U3']);
  await app.idle();
  if(!['model-failure','response-lost'].includes(scenario)){assert.equal(messages.filter(message=>message.type==='coordination').length,0);assert.equal(app.store.db.prepare('SELECT state FROM agent_receipts WHERE messageId=?').get(worker.messageId)!.state,'processed');assert.equal(app.history.list(app.store.meta('mainThread')!).filter(message=>message.role==='user').length,4);return;}
  const output=messages.find(message=>message.type==='coordination')!;
  assert.ok(output.messageId);assert.equal(app.processes.coordination(output.messageId!)?.text,output.text);
  assert.equal(app.history.message(output.messageId!)?.text,output.text);
  assert.equal(app.processes.coordinationIds(app.store.meta('mainThread')!).filter(id=>id===output.messageId).length,1);
  if(scenario==='model-failure'||scenario==='response-lost')assert.match(output.text,/协调未完成/,'a failed or unknown turn preserves its public failure fact');
  const view=await homerWebBridge(app).history!.state();assert.ok(view.messages.some(message=>message.id===output.messageId&&message.text===output.text));
  assert.equal(app.history.list(app.store.meta('mainThread')!).filter(message=>message.role==='user').length,4,'no synthetic Worker user bubble');
 }finally{await server?.close();await app.close();rmSync(dir,{recursive:true,force:true});}
});
test('a live durable owner blocks claim without continuously scheduling empty jobs',async()=>{
 const scratch=resolve('.codex/scratch/worker-return-main-queue-20261023');mkdirSync(scratch,{recursive:true});
 const dir=mkdtempSync(join(scratch,'blocked-owner-'));mkdirSync(join(dir,'runtime'));let turns=0;
 class Peer extends EventEmitter implements EngineLike{
  threadId='synthetic-main';async start(){return this.threadId;}async close(){return true;}async interrupt(){return true;}
  async turn(){turns++;return {status:'completed' as const,text:'Synthetic reply'};}
 }
 const app=new Homer({workspace:join(dir,'workspace'),runtime:join(dir,'runtime'),codexHome:join(dir,'empty-home'),nativeCodexHome:join(dir,'empty-home'),codexBin:'/usr/bin/false',model:'synthetic',requiresOpenaiAuth:false,stopGraceMs:100},async()=>{},()=>new Peer());
 try{
  await app.start();
  app.processes.start({id:'existing-owner',threadId:app.store.meta('mainThread')!,sourceKind:'worker',sourceMessageIds:['original-notice'],messageId:'existing-owner'},'original-turn');
  let jobs=0;const enqueue=app['enqueue'].bind(app);
  // Bound a regression's retry loop so the test itself cannot starve timers.
  app['enqueue']=async fn=>{if(++jobs>1)return undefined as never;return enqueue(fn);};
  app.submitMessage({requestId:'waiting',text:'Synthetic queued input'});
  await app.idle();
  assert.equal(jobs,1,'a blocked claim waits for a real wake instead of rescheduling itself');
  assert.equal(turns,0);assert.equal(app.inputs.byRequestIds(['waiting'])[0]!.state,'queued');
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
test('a rejected head releases the next input after a durable claim failure',async()=>{
 const scratch=resolve('.codex/scratch/worker-return-main-queue-20261023');mkdirSync(scratch,{recursive:true});
 const dir=mkdtempSync(join(scratch,'rejected-head-'));mkdirSync(join(dir,'runtime'));let turns=0;
 class Peer extends EventEmitter implements EngineLike{
  threadId='synthetic-main';async start(){return this.threadId;}async close(){return true;}async interrupt(){return true;}
  async turn(){turns++;return {status:'completed' as const,text:'Synthetic reply'};}
 }
 const app=new Homer({workspace:join(dir,'workspace'),runtime:join(dir,'runtime'),codexHome:join(dir,'empty-home'),nativeCodexHome:join(dir,'empty-home'),codexBin:'/usr/bin/false',model:'synthetic',requiresOpenaiAuth:false,stopGraceMs:100},async()=>{},()=>new Peer());
 try{
  await app.start();app.submitMessage({requestId:'invalid-head',text:'Original synthetic source'});
  app.store.db.prepare("UPDATE conversation_messages SET text='Changed synthetic source' WHERE requestId='invalid-head' AND role='user'").run();
  app.submitMessage({requestId:'next',text:'Synthetic next input'});await app.idle();
  assert.equal(app.inputs.byRequestIds(['invalid-head'])[0]!.state,'failed');
  assert.equal(app.inputs.byRequestIds(['next'])[0]!.state,'completed');assert.equal(turns,1);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});

for(const outcome of ['completed','failed','interrupted'] as const)test('desktop backlog resumes only after successful new user turn: '+outcome,async()=>{
 const scratch=resolve('.codex/scratch/desktop-daily-queue-test');mkdirSync(scratch,{recursive:true});const dir=mkdtempSync(join(scratch,'resume-'));mkdirSync(join(dir,'runtime'));
 const config={workspace:join(dir,'workspace'),runtime:join(dir,'runtime'),codexHome:join(dir,'empty-home'),nativeCodexHome:join(dir,'empty-home'),codexBin:'/usr/bin/false',model:'synthetic',requiresOpenaiAuth:false,stopGraceMs:100};
 let app: Homer;let sequence=0;const turns:string[]=[];
 class Peer extends EventEmitter implements EngineLike{
  threadId:string;turnId?:string;
  constructor(options:EngineOptions,readonly handler:(call:ToolCall)=>Promise<unknown>){super();this.threadId=options.threadId??'synthetic-resume';}
  async start(){return this.threadId;}async close(){return true;}async interrupt(){return true;}
  async call(tool:string,args:unknown){return this.handler({threadId:this.threadId,turnId:this.turnId!,callId:'call-'+ ++sequence,tool,arguments:args});}
  async turn(text:string,options?:{onStarted?:(id:string)=>void}):Promise<TurnResult>{
   this.turnId='turn-'+ ++sequence;options?.onStarted?.(this.turnId);
   if(text.startsWith('[内部协作输入')){turns.push(app['mainContext']!.workerInput!.messageId);return {status:'completed',text:''};}
   turns.push(text.split('\n')[0]!);
   if(text.startsWith('fresh')){assert.equal(app.inputs.dispatchSummary().awaitingUser,true);return {status:outcome,text:'Synthetic new requirements'};}
   return {status:'completed',text:'Synthetic reply'};
  }
 }
 const factory=(options:EngineOptions,handler:(call:ToolCall)=>Promise<unknown>)=>new Peer(options,handler);
 app=new Homer(config,async()=>{},factory);
 try{
  await app.start();app.inputs.accept({requestId:'seed',text:'Synthetic source'});const source=app.inputs.claim()!;app.inputs.finish(source.messageId,source.revision,'completed');
  const agentId=app.store.meta('mainAgentId')!;
  const actor={agentId,threadId:app.store.meta('mainThread')!,sourceRequestId:'seed'};
  const task=app.tasks.createTask(actor,{operationId:'root',title:'Synthetic old task',goal:'Synthetic',authority:{sourceRequestId:'seed',description:'Synthetic only'}});
  const send=(id:string)=>{const opened=app.tasks.workerOpen(actor,{operationId:id,taskId:task.taskId,text:'Synthetic report'}),run=app.tasks.claim(opened.runId)!;app.tasks.bind(run.id,run.epoch,'worker-'+id,'turn-'+id);return app.tasks.endSegment(run.id,run.epoch,{status:'completed',text:'Synthetic report'},true)!.messageId;};
  const unknown=send('unknown'),pending=[send('pending-1'),send('pending-2')];
  app.store.db.prepare("UPDATE agent_receipts SET state='uncertain',revision=3,offeredTurnId='old-turn' WHERE messageId=?").run(unknown);
  app.tasks.controlTask(actor,{operationId:'cancel',taskId:task.taskId,expectedRevision:app.tasks.task(task.taskId).revision,action:'cancel'});
  await app.close();turns.length=0;
  const paused={...config,pauseOldDesktopWork:true,desktopResources:{bundleRoot:dir,manifestSha256:'a'.repeat(64)}};
  app=new Homer(paused,async()=>{},factory);await app.start();await app.idle();assert.deepEqual([...turns],[]);assert.equal(app.inputs.dispatchSummary().awaitingUser,true);
  await app.message('fresh requirements','fresh');await app.idle();
  assert.deepEqual(turns,outcome==='completed'?['fresh requirements',...pending]:['fresh requirements']);
  assert.equal(app.store.db.prepare('SELECT state FROM agent_receipts WHERE messageId=?').get(unknown)!.state,'uncertain');
  assert.equal(app.inputs.dispatchSummary().awaitingUser,outcome==='completed'?undefined:true);
  if(outcome==='completed'){
   await app.message('another message','another');await app.idle();assert.deepEqual(turns,['fresh requirements',...pending,'another message']);
  }else{
   const actor={agentId,threadId:app.store.meta('mainThread')!,sourceRequestId:'fresh'};
   const task=app.tasks.createTask(actor,{operationId:'fresh-task',goal:'Synthetic later report',authority:{sourceRequestId:'fresh',description:'Synthetic only'}});
   const worker=app.tasks.workerOpen(actor,{operationId:'fresh-open',taskId:task.taskId,text:'Synthetic later report'}),freshRun=app.tasks.claim(worker.runId)!;app.tasks.bind(freshRun.id,freshRun.epoch,'later-worker','later-turn');
   const notice=app.tasks.endSegment(freshRun.id,freshRun.epoch,{status:'completed',text:'Synthetic later report'},true)!;
   // Direct task fixture writes need the same wake supplied by the Worker tool adapter.
   (app as any).scheduleInputs();await until(()=>app.store.db.prepare('SELECT state FROM agent_receipts WHERE messageId=?').get(notice.messageId)?.state==='processed');await app.idle();
   assert.ok(turns.splice(1).includes(notice.messageId));assert.equal(app.inputs.dispatchSummary().awaitingUser,true);
   app.tasks.controlTask(actor,{operationId:'fresh-cancel',taskId:task.taskId,expectedRevision:app.tasks.task(task.taskId).revision,action:'cancel'});
   await app.close();app=new Homer(paused,async()=>{},factory);await app.start();await app.idle();assert.deepEqual(turns,['fresh requirements']);
   await app.message('recover now','recover');await app.idle();assert.deepEqual(turns,['fresh requirements','recover now',...pending]);
  }
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
