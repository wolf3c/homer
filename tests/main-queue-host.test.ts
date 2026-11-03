// Requirements-derived real service test, fake engines and isolated runtime only.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {Homer,type Message} from '../src/service.js';
import {homerWebBridge} from '../src/web-homer.js';
import {createWebServer} from '../src/web-server.js';
import {HomerWechat} from '../src/channels/wechat-homer.js';
import {WechatApi,type WechatCredential} from '../src/channels/wechat-api.js';
import {TelegramHomerBridge} from '../src/channels/telegram-homer-bridge.js';
import type {EngineLike,EngineOptions,ToolCall,TurnResult} from '../src/engine.js';

const until=async(check:()=>boolean)=>{const end=Date.now()+6000;while(!check()){if(Date.now()>end)throw Error('synthetic_main_queue_timeout');await new Promise(done=>setTimeout(done,10));}};
test('desktop resume refuses an old prepared delivery without changing its receipt',async()=>{
 const scratch=resolve('.codex/scratch/desktop-daily-queue-test');mkdirSync(scratch,{recursive:true});const dir=mkdtempSync(join(scratch,'delivery-'));mkdirSync(join(dir,'runtime'));
 const config={workspace:join(dir,'workspace'),runtime:join(dir,'runtime'),codexHome:join(dir,'codex'),codexBin:'/usr/bin/false',model:'synthetic',requiresOpenaiAuth:false,stopGraceMs:100};
 let app=new Homer(config,async()=>{});await app.close();
 const path=join(config.runtime,'homer.sqlite'),db=new DatabaseSync(path);
 try{db.exec("PRAGMA foreign_keys=OFF; INSERT INTO deliveries(id,rootTaskId,version,outcome,text,state,operationKey) VALUES('synthetic-delivery','synthetic-task',1,'succeeded','synthetic','prepared','synthetic-operation')");}finally{db.close();}
 try{
  assert.throws(()=>new Homer({...config,pauseOldDesktopWork:true,desktopResources:{bundleRoot:dir,manifestSha256:'a'.repeat(64)}},async()=>{}),/desktop_delivery_review_required/);
  const check=new DatabaseSync(path,{readOnly:true});try{assert.equal(check.prepare("SELECT state FROM deliveries WHERE id='synthetic-delivery'").get()!.state,'prepared');}finally{check.close();}
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('desktop resume leaves old work queued and allows new work without replay',async()=>{
 const scratch=resolve('.codex/scratch/desktop-daily-queue-test');mkdirSync(scratch,{recursive:true});const dir=mkdtempSync(join(scratch,'case-'));mkdirSync(join(dir,'runtime'));
 const turns:string[]=[];
 class Peer extends EventEmitter implements EngineLike{
  threadId:string;turnId?:string;constructor(options:EngineOptions){super();this.threadId=options.threadId??'synthetic-main';}
  async start(){return this.threadId;}async close(){return true;}async interrupt(){return true;}
  async turn(text:string,options?:{onStarted?:(id:string)=>void}):Promise<TurnResult>{this.turnId='synthetic-turn';options?.onStarted?.(this.turnId);turns.push(text);return {status:'completed',text:'synthetic answer'};}
 }
 const config={workspace:join(dir,'workspace'),runtime:join(dir,'runtime'),codexHome:join(dir,'codex'),codexBin:'/usr/bin/false',model:'synthetic',requiresOpenaiAuth:false,stopGraceMs:100};
 let app=new Homer(config,async()=>{},options=>new Peer(options));
 try{
  await app.start();app.inputs.accept({requestId:'old',text:'old pending'});app.inputs.accept({requestId:'old-active',text:'old active'});const old=app.inputs.list().find(x=>x.input.requestId==='old-active')!;
  app.store.db.prepare("UPDATE agent_receipts SET state='offered' WHERE messageId=?").run(old.messageId);
  const node={id:'old-node',threadId:'synthetic-main',seq:1,revision:1,state:'working',status:'unknown',sourceKind:'user',sourceMessageIds:[old.messageId],messageId:'old-reply',turnIds:['old-turn'],items:[],completedItemIds:[],itemPhases:{}};
  app.store.setMeta('publicMainNode:v1:old-node',JSON.stringify(node));app.store.setMeta('publicMainNodeSeq:v1','1');await app.close();
  app=new Homer({...config,pauseOldDesktopWork:true,desktopResources:{bundleRoot:dir,manifestSha256:'a'.repeat(64)}},async()=>{},options=>new Peer(options));
  await app.start();await new Promise(done=>setTimeout(done,50));assert.deepEqual(turns,[]);
  const capabilities=await app.capabilities();assert.equal(capabilities.surfaces.wechat.receive,'unavailable');assert.equal(capabilities.surfaces.telegram.receive,'unavailable');
  assert.equal(app.store.meta('publicMainNode:v1:old-node'),JSON.stringify(node));
  assert.equal(app.store.db.prepare('SELECT state FROM agent_receipts WHERE messageId=?').get(old.messageId)!.state,'offered');
  app.submitMessage({requestId:'new',text:'new input'});await until(()=>turns.length===1);await app.idle();
  assert.deepEqual(turns,['new input']);assert.equal(app.inputs.list().find(x=>x.input.requestId==='old')!.state,'queued');
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
for(const scenario of ['result','empty-report','model-failure','ack-unknown','forged-question'] as const)test('main service mixed durable order and public output: '+scenario,async()=>{
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
   if(this.options.tools.some(tool=>tool.name==='read_material')){
    const result=await new Promise<TurnResult>(done=>{releaseWorker=this.release=done;});
    if(scenario==='forged-question'){
     const task=app.tasks.task(JSON.parse(text).taskId);
     await this.call('agent_send',{operationId:'forged-question',taskId:task.id,version:task.headVersion,expectedTaskRevision:task.revision,recipientAgentId:app.store.meta('mainAgentId'),kind:'interaction_required',payload:{interactionId:'not-a-host-interaction'},replyTo:null,targetRunId:null});
    }
    // Generate the same result notice with the installed Worker tool contract.
    if(this.options.tools.some(tool=>tool.name==='task_complete')){
     const task=app.tasks.task(JSON.parse(text).taskId);
     await this.call('task_complete',{operationId:'synthetic-complete',taskId:task.id,version:task.headVersion,expectedTaskRevision:task.revision,outcome:'succeeded',payload:{summary:result.text},evidence:{synthetic:'Isolated fake engine'},children:[],resultId:null});
    }
    return result;
   }
   if(text==='seed'){
    await this.call('task_delegate',{operationId:'root',parentTaskId:null,parentVersion:null,expectedTaskRevision:null,title:'Synthetic Worker',executorKind:'worker',contract:{goal:'Synthetic work',inputs:[],resultKind:'structured',acceptance:{criteria:[]}},dependencies:[]});
    return new Promise(done=>{releaseSeed=this.release=done;});
   }
   if(text.startsWith('[内部协作事件')){
    const inbox=await this.call('inbox_read',{after:0}) as {id:string}[];assert.equal(inbox.length,1);
    turns.push('W1');await this.call('inbox_ack',{operationId:'ack-'+inbox[0]!.id,messageId:inbox[0]!.id,disposition:'processed',reason:'Synthetic coordination',resultId:null});
    if(scenario==='empty-report')return {status:'completed',text:''};
    if(scenario==='model-failure')return {status:'failed',text:'',errorCode:'synthetic_model_failed'};
    if(scenario==='ack-unknown')throw Error('synthetic_ack_unknown');
    return {status:'completed',text:'Worker 已返回结果，证据尚待核对；这不是正式交付。'};
   }
   turns.push(text.split('\n')[0]!);return {status:'completed',text:'Synthetic user reply'};
  }
  async close(){this.release?.({status:'interrupted',text:''});return true;}
  async interrupt(){return true;}
 }
 const app=new Homer({workspace:join(dir,'workspace'),runtime:join(dir,'runtime'),codexHome:join(dir,'empty-home'),codexBin:'/usr/bin/false',model:'synthetic',requiresOpenaiAuth:false,stopGraceMs:100},async message=>{messages.push(message);},(options,handler)=>new Peer(options,handler));
 let server:Awaited<ReturnType<typeof createWebServer>>|undefined;
 let wechat:HomerWechat|undefined,telegram:TelegramHomerBridge|undefined;
 try{
  await app.start();app.submitMessage({requestId:'seed',text:'seed'});await until(()=>!!releaseSeed&&!!releaseWorker);
  await homerWebBridge(app).submit({requestId:'web',text:'U1'});
  class SyntheticWechatApi extends WechatApi{
   constructor(){super(async()=>Response.json({ret:0}));}
   override async beginQr(){return {qrcode:'synthetic',qrcode_img_content:'https://ilinkai.weixin.qq.com/qr/synthetic'};}
   override async pollQr(){return {status:'confirmed',bot_token:'synthetic',ilink_bot_id:'bot',ilink_user_id:'owner',baseurl:'https://ilinkai.weixin.qq.com'};}
  }
  const credentials=new Map<string,WechatCredential>();
  wechat=new HomerWechat(app,new SyntheticWechatApi(),{async get(id){return credentials.get(id)!;},async set(id,value){credentials.set(id,value);},async delete(id){credentials.delete(id);}});
  const login=await wechat.channel.beginLogin();await wechat.channel.pollLogin(login.id);wechat.channel.disable();
  const binding=wechat.channel.store.transition('connected',true);
  wechat.channel.store.accept(binding.generation,{msgs:[{message_id:'101',from_user_id:'owner',to_user_id:'bot',message_type:1,context_token:'synthetic',item_list:[{type:1,text_item:{text:'U2'}}]}]},credentials.get(binding.secretRef!)!.dataKey);
  const wechatId=String(app.store.db.prepare("SELECT requestId FROM wechat_inbox WHERE messageId='101'").get()!.requestId);
  await wechat.submit({requestId:wechatId,text:'U2',origin:{channel:'wechat',bindingGeneration:binding.bindingId!,botId:'bot',peerId:'owner',messageId:'101'}});
  releaseWorker({status:'completed',text:'Synthetic Worker result'});
  await until(()=>app.inputs.dispatchPage(undefined,app.webReadEpoch,'all').items.filter(item=>item.origin==='worker').length===(scenario==='forged-question'?2:1));
  telegram=new TelegramHomerBridge(app);
  const tg=telegram.channel.store;tg.configure('123456',app.store.meta('mainThread')!);tg.enabled('123456',true);
  const code=tg.pairing('123456');tg.proposePair('123456',code,'789123','789123');tg.approvePair('123456',code,'789123','789123');
  tg.ingest('123456',[{update_id:10,message:{message_id:30,date:Date.now()/1000,chat:{id:789123,type:'private'},from:{id:789123},text:'U3'}}]);
  await telegram.submit({requestId:'tg:123456:10',text:'U3',origin:tg.route('tg:123456:10')!});
  const page=app.inputs.dispatchPage(undefined,app.webReadEpoch,'all'),waiting=page.items.filter(item=>item.state==='queued');
  assert.deepEqual(waiting.map(item=>item.origin==='user'?item.input.text:'W1'),scenario==='forged-question'?['U1','U2','W1','W1','U3']:['U1','U2','W1','U3']);
  const worker=waiting.find(item=>item.origin==='worker')!;
  server=await createWebServer({bridge:homerWebBridge(app),port:0});
  const post=async(path:string,value:unknown)=>{const response=await fetch(server!.url+path,{method:'POST',headers:{Origin:server!.url,'Content-Type':'application/json'},body:JSON.stringify(value)});assert.equal(response.status,200);return response.json();};
  const visible=await post('/api/history/queue',{view:'dispatch-v1',sources:'all',readEpoch:app.webReadEpoch});
  assert.deepEqual(visible.items.map((item:{messageId:string})=>item.messageId),waiting.map(item=>item.messageId),'Web excludes the already acknowledged current user turn');
  const moved=await post('/api/messages/move',{messageId:worker.messageId,operationId:'move-worker',expectedRevision:worker.revision,expectedOrderVersion:page.orderVersion,threadId:app.store.meta('mainThread')!,readEpoch:app.webReadEpoch,beforeMessageId:waiting[0]!.messageId});
  const receipt=await post('/api/history/receipts',{requestIds:[],operations:[{messageId:worker.messageId,operationId:'move-worker'}]});
  assert.equal(receipt.operations[0].committed,true);assert.deepEqual(receipt.operations[0].result,moved);
  assert.deepEqual(turns,[],'new events never preempt the active seed turn');
  releaseSeed({status:'completed',text:'Synthetic delegation recorded'});
  await until(()=>turns.length===(scenario==='forged-question'?5:4)&&messages.some(message=>message.type==='coordination'));
  assert.deepEqual(turns,scenario==='forged-question'?['W1','U1','U2','W1','U3']:['W1','U1','U2','U3']);
  const output=messages.find(message=>message.type==='coordination')!;
  assert.ok(output.messageId);assert.equal(app.processes.coordination(output.messageId!)?.text,output.text);
  assert.equal(app.history.message(output.messageId!)?.text,output.text);
  assert.equal(app.processes.coordinationIds(app.store.meta('mainThread')!).filter(id=>id===output.messageId).length,1);
  if(scenario!=='result'&&scenario!=='forged-question')assert.match(output.text,/协调未完成/,'failure or missing required report cannot silently succeed');
  const view=await homerWebBridge(app).history!.state();assert.ok(view.messages.some(message=>message.id===output.messageId&&message.text===output.text));
  assert.equal(app.history.list(app.store.meta('mainThread')!).filter(message=>message.role==='user').length,4,'no synthetic Worker user bubble');
 }finally{await server?.close();await wechat?.channel.close();await telegram?.close();await app.close();rmSync(dir,{recursive:true,force:true});}
});
test('a live durable owner blocks claim without continuously scheduling empty jobs',async()=>{
 const scratch=resolve('.codex/scratch/worker-return-main-queue-20261023');mkdirSync(scratch,{recursive:true});
 const dir=mkdtempSync(join(scratch,'blocked-owner-'));mkdirSync(join(dir,'runtime'));let turns=0;
 class Peer extends EventEmitter implements EngineLike{
  threadId='synthetic-main';async start(){return this.threadId;}async close(){return true;}async interrupt(){return true;}
  async turn(){turns++;return {status:'completed' as const,text:'Synthetic reply'};}
 }
 const app=new Homer({workspace:join(dir,'workspace'),runtime:join(dir,'runtime'),codexHome:join(dir,'empty-home'),codexBin:'/usr/bin/false',model:'synthetic',requiresOpenaiAuth:false,stopGraceMs:100},async()=>{},()=>new Peer());
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
 const app=new Homer({workspace:join(dir,'workspace'),runtime:join(dir,'runtime'),codexHome:join(dir,'empty-home'),codexBin:'/usr/bin/false',model:'synthetic',requiresOpenaiAuth:false,stopGraceMs:100},async()=>{},()=>new Peer());
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
 const config={workspace:join(dir,'workspace'),runtime:join(dir,'runtime'),codexHome:join(dir,'empty-home'),codexBin:'/usr/bin/false',model:'synthetic',requiresOpenaiAuth:false,stopGraceMs:100};
 let app: Homer;let sequence=0;let oldTaskId:string;const turns:string[]=[];
 class Peer extends EventEmitter implements EngineLike{
  threadId:string;turnId?:string;
  constructor(options:EngineOptions,readonly handler:(call:ToolCall)=>Promise<unknown>){super();this.threadId=options.threadId??'synthetic-resume';}
  async start(){return this.threadId;}async close(){return true;}async interrupt(){return true;}
  async call(tool:string,args:unknown){return this.handler({threadId:this.threadId,turnId:this.turnId!,callId:'call-'+ ++sequence,tool,arguments:args});}
  async turn(text:string,options?:{onStarted?:(id:string)=>void}):Promise<TurnResult>{
   this.turnId='turn-'+ ++sequence;options?.onStarted?.(this.turnId);
   if(text.startsWith('[内部协作事件')){
    const inbox=await this.call('inbox_read',{after:0}) as {id:string;taskId:string}[];assert.equal(inbox.length,1);turns.push(inbox[0]!.id);
    const task=app.tasks.task(inbox[0]!.taskId);
    if(task.id!==oldTaskId){
     const old=app.tasks.task(oldTaskId);
     await assert.rejects(this.call('task_stop',{operationId:'automatic-old-stop',taskId:old.id,version:old.headVersion,expectedTaskRevision:old.revision,scope:'self',reason:'No successful user turn'}),/desktop_old_task_paused/);
    }
    await this.call('task_stop',{operationId:'stop-'+inbox[0]!.id,taskId:task.id,version:task.headVersion,expectedTaskRevision:task.revision,scope:'self',reason:'Synthetic user requested no further execution'});
    await this.call('inbox_ack',{operationId:'ack-'+inbox[0]!.id,messageId:inbox[0]!.id,disposition:'processed',reason:'Synthetic reviewed',resultId:null});
    return {status:'completed',text:''};
   }
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
  const root=app.tasks.createRoot({agentId,sourceRequestId:'seed'},{operationId:'root',title:'Synthetic old task',executorKind:'worker',contract:{goal:'Synthetic',inputs:[],resultKind:'structured',acceptance:{criteria:[]}},authority:{sourceRequestId:'seed',description:'Synthetic only',materials:[],resultIds:[],collaborateTaskIds:[],maxActiveMs:10000}});
  oldTaskId=root.taskId;
  const run=app.tasks.claim(root.runId!)!;app.tasks.bind(run.id,run.epoch,'worker','turn');
  const actor={agentId:app.tasks.task(root.taskId).executorAgentId,runId:run.id,epoch:run.epoch,threadId:'worker',turnId:'turn'};
  const send=(id:string)=>{const task=app.tasks.task(root.taskId);return app.tasks.send(actor,{operationId:id,taskId:task.id,version:task.headVersion,expectedTaskRevision:task.revision,recipientAgentId:agentId,kind:'progress',payload:{text:'Synthetic report'}}).messageId;};
  const unknown=send('unknown'),pending=[send('pending-1'),send('pending-2')];
  app.store.db.prepare("UPDATE agent_receipts SET state='uncertain',revision=3,offeredTurnId='old-turn' WHERE messageId=?").run(unknown);
  // A settled historical fixture has no live engine or queued Run to resume.
  app.store.db.prepare("UPDATE runs SET status='cancelled' WHERE id=?").run(run.id);app.store.db.prepare("UPDATE tasks SET state='settled',outcome='cancelled' WHERE id=?").run(root.taskId);
  await app.close();turns.length=0;
  const paused={...config,pauseOldDesktopWork:true,desktopResources:{bundleRoot:dir,manifestSha256:'a'.repeat(64)}};
  app=new Homer(paused,async()=>{},factory);await app.start();await app.idle();assert.deepEqual(turns,[]);assert.equal(app.inputs.dispatchSummary().awaitingUser,true);
  await app.message('fresh requirements','fresh');await app.idle();
  assert.deepEqual(turns,outcome==='completed'?['fresh requirements',...pending]:['fresh requirements']);
  assert.equal(app.store.db.prepare('SELECT state FROM agent_receipts WHERE messageId=?').get(unknown)!.state,'uncertain');
  assert.equal(app.inputs.dispatchSummary().awaitingUser,outcome==='completed'?undefined:true);
  if(outcome==='completed'){
   await app.message('another message','another');await app.idle();assert.deepEqual(turns,['fresh requirements',...pending,'another message']);
  }else{
   const freshRoot=app.tasks.createRoot({agentId,sourceRequestId:'fresh'},{operationId:'fresh-root',title:'Synthetic later Worker',executorKind:'worker',contract:{goal:'Synthetic',inputs:[],resultKind:'structured',acceptance:{criteria:[]}},authority:{sourceRequestId:'fresh',description:'Synthetic only',materials:[],resultIds:[],collaborateTaskIds:[],maxActiveMs:10000}});
   const freshRun=app.tasks.claim(freshRoot.runId!)!;app.tasks.bind(freshRun.id,freshRun.epoch,'later-worker','later-turn');
   const task=app.tasks.task(freshRoot.taskId);
   const notice=app.tasks.send({agentId:task.executorAgentId,runId:freshRun.id,epoch:freshRun.epoch,threadId:'later-worker',turnId:'later-turn'},{operationId:'later-notice',taskId:task.id,version:task.headVersion,expectedTaskRevision:task.revision,recipientAgentId:agentId,kind:'progress',payload:{text:'Synthetic later report'}});
   // Direct task fixture writes need the same wake supplied by the Worker tool adapter.
   (app as any).scheduleInputs();await until(()=>app.store.db.prepare('SELECT state FROM agent_receipts WHERE messageId=?').get(notice.messageId)?.state==='processed');await app.idle();
   assert.ok(turns.splice(1).includes(notice.messageId));assert.equal(app.inputs.dispatchSummary().awaitingUser,true);
   app.store.db.prepare("UPDATE runs SET status='cancelled' WHERE id=?").run(freshRun.id);app.store.db.prepare("UPDATE tasks SET state='settled',outcome='cancelled' WHERE id=?").run(task.id);
   await app.close();app=new Homer(paused,async()=>{},factory);await app.start();await app.idle();assert.deepEqual(turns,['fresh requirements']);
   await app.message('recover now','recover');await app.idle();assert.deepEqual(turns,['fresh requirements','recover now',...pending]);
  }
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
