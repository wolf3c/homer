import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createConnection} from 'node:net';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {Homer,type Message} from '../src/service.js';
import type {EngineLike,EngineOptions,ToolCall,TurnResult} from '../src/engine.js';

const flush=()=>new Promise<void>(r=>setImmediate(r));
async function until(check:()=>boolean){for(let n=0;!check();n++){assert.ok(n<1000,'synthetic operation did not settle');await flush();}}
function gate(){let release!:()=>void;const promise=new Promise<void>(r=>release=r);return {promise,release};}
async function fixture(settings:Partial<{supports:boolean;source:'codex'|'website';workerModel:string}>={}){
 const parent=resolve('.codex/scratch/main-transport-recovery');mkdirSync(parent,{recursive:true});
 const root=mkdtempSync(join(parent,'case-'));for(const name of ['runtime','workspace'])mkdirSync(join(root,name));
 const holds:ReturnType<typeof gate>[]=[],mains:Peer[]=[],workers:Peer[]=[],messages:Message[]=[],turns:{thread:string;request?:string}[]=[],calls:string[]=[];
 const state={supports:settings.supports??(settings.source!=='website'),initialTransport:'http' as 'http'|'websocket'|undefined,replacementTransport:undefined as 'http'|'websocket'|undefined,stopConfirmed:true,startFails:false,startGate:undefined as ReturnType<typeof gate>|undefined,closeGate:undefined as ReturnType<typeof gate>|undefined,turnGate:undefined as ReturnType<typeof gate>|undefined,deliveryGate:undefined as ReturnType<typeof gate>|undefined,deliveryWaiting:false,duringMain:undefined as (()=>Promise<void>)|undefined};
 const hold=()=>{const value=gate();holds.push(value);return value;};let sequence=0,app:Homer;
 class Peer extends EventEmitter implements EngineLike{
  threadId:string;turnId='';modelTransport?:'http'|'websocket';supportsWebSocket=state.supports;canRestart=true;available=true;resumable=true;nativeBusy=false;nativeInteractionPending=false;closes=0;workerGate?:ReturnType<typeof gate>;
  constructor(readonly options:EngineOptions,readonly tool:(call:ToolCall)=>Promise<unknown>){super();this.threadId=options.threadId??(options.role==='worker'?'worker-'+ ++sequence:'original-main');(options.role==='worker'?workers:mains).push(this);}
  setTransport(transport:'http'|'websocket'|undefined){this.modelTransport=transport;this.emit('modelTransport',transport);}
  async start(){if(this.options.role!=='worker'){if(this.options.threadId){await state.startGate?.promise;if(state.startFails)throw Error('synthetic_resume_failed');}this.setTransport(this.options.threadId?state.replacementTransport:state.initialTransport);}return this.threadId;}
  async interrupt(){return true;}
  async close(){this.closes++;if(this.options.role==='worker'){this.workerGate?.release();return true;}await state.closeGate?.promise;this.available=false;return state.stopConfirmed;}
  async turn(_text:string,options?:{onStarted?:(id:string)=>void}):Promise<TurnResult>{
   this.canRestart=false;this.turnId='turn-'+ ++sequence;options?.onStarted?.(this.turnId);
   try{
    if(this.options.role==='worker'){this.workerGate=hold();await this.workerGate.promise;return {status:'completed',text:'Synthetic Worker result'};}
    turns.push({thread:this.threadId,request:app['mainContext']?.requestId});this.setTransport('http');
    if(app['mainContext']?.userText==='delegate'){
     calls.push('worker_open');await this.tool({threadId:this.threadId,turnId:this.turnId,callId:'call-'+ ++sequence,tool:'worker_open',arguments:{message:'Synthetic work',title:'Synthetic work'}});
    }
    await state.duringMain?.();await state.turnGate?.promise;return {status:'completed',text:'Synthetic reply'};
   }finally{this.canRestart=true;this.emit('idle');}
  }
 }
 const config={workspace:join(root,'workspace'),runtime:join(root,'runtime'),codexHome:join(root,'codex'),nativeCodexHome:join(root,'codex'),codexBin:'/usr/bin/false',model:'synthetic',requiresOpenaiAuth:false,stopGraceMs:20,desktopModelSource:settings.source??'codex',pauseOldDesktopWork:true,desktopResources:{bundleRoot:root,manifestSha256:'a'.repeat(64)}};
 if(settings.source==='website')Object.assign(config,{dailyDeepSeek:true,desktopConnection:{main:{baseUrl:'https://gateway.example.invalid/v1',model:'synthetic',effort:'high',fast:false,supportsWebSocket:state.supports,context:{contextWindow:128000,autoCompactTokenLimit:100000,autoCompactTokenLimitScope:'total'}},worker:{baseUrl:'https://gateway.example.invalid/v1',model:settings.workerModel??'synthetic',effort:'high',fast:false,supportsWebSocket:state.supports,context:{contextWindow:128000,autoCompactTokenLimit:100000,autoCompactTokenLimitScope:'total'}}}});
 app=new Homer(config,async message=>{messages.push(message);if(message.type==='reply'&&state.deliveryGate){state.deliveryWaiting=true;await state.deliveryGate.promise;}},(options,tool)=>new Peer(options,tool));
 await app.start();
 const settle=async()=>{for(let n=0;n<10;n++){await flush();const queue=app['mainQueue'];await queue;if(queue===app['mainQueue']&&!app['inputScheduled'])return;}throw Error('main queue did not settle');};
 return {app,state,mains,workers,messages,turns,calls,hold,settle,
  async delegate(){const count=workers.length;await app.message('delegate','user-'+ ++sequence);await until(()=>workers.length>count&&!!workers.at(-1)?.workerGate);return workers.at(-1)!;},
  async close(){state.stopConfirmed=true;state.startFails=false;for(const value of holds)value.release();await app.close();rmSync(root,{recursive:true,force:true});}};
}

test('idle HTTP Main recovers at 15 minutes without adding a model turn or changing its thread',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:0});const f=await fixture();
 try{
  t.mock.timers.tick(899999);await f.settle();assert.equal(f.mains.length,1);
  t.mock.timers.tick(1);await f.settle();assert.equal(f.mains.length,2);assert.equal(f.mains[1]!.options.threadId,'original-main');assert.equal(f.mains[0]!.closes,1);assert.equal(f.turns.length,0);
  t.mock.timers.tick(3600000);await f.settle();assert.equal(f.mains.length,2,'unknown transport after restart must not churn idle engines');
 }finally{await f.close();}
});

test('Worker success and periodic triggers share two attempts per rolling ten minutes',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:0});const f=await fixture();
 try{
  const first=await f.delegate();for(let n=0;n<8;n++)first.emit('webSocketSucceeded');await f.settle();assert.equal(f.mains.length,2);
  const second=await f.delegate();second.emit('webSocketSucceeded');await f.settle();assert.equal(f.mains.length,3);
  const third=await f.delegate();third.emit('webSocketSucceeded');await f.settle();assert.equal(f.mains.length,3);
  t.mock.timers.tick(599999);await f.settle();assert.equal(f.mains.length,3);
  t.mock.timers.tick(1);await f.settle();assert.equal(f.mains.length,4);
  assert.equal(f.calls.length,3,'recovery cannot replay the delegation tool');assert.equal(f.workers.length,3);
  assert.ok(f.mains.every(engine=>engine.threadId==='original-main'));assert.ok(f.workers.every(engine=>engine.closes===0),'running Workers are not a Main restart barrier or restart target');
 }finally{await f.close();}
});

test('Main native terminal cannot bypass pending reply delivery or consume the next input early',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:0});const f=await fixture();
 try{
  f.state.deliveryGate=f.hold();const reply=f.app.message('Synthetic requirement','delivery');await until(()=>f.state.deliveryWaiting);
  t.mock.timers.tick(900000);await flush();assert.equal(f.mains.length,1);
  f.app.submitMessage({requestId:'next',text:'Next requirement'});assert.equal(f.app.inputs.byRequestIds(['next'])[0]!.state,'queued');
  f.state.deliveryGate.release();f.state.deliveryGate=undefined;await reply;await f.settle();
  assert.equal(f.mains.length,2);assert.deepEqual(f.turns.map(turn=>turn.request),['delivery','next']);assert.ok(f.turns.every(turn=>turn.thread==='original-main'));
 }finally{await f.close();}
});

test('inputs arriving during Main resume remain queued and execute once after the same thread returns',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:0});const f=await fixture();
 try{
  f.state.startGate=f.hold();t.mock.timers.tick(900000);await until(()=>f.mains.length===2);
  f.app.submitMessage({requestId:'during-resume',text:'New original requirement'});await flush();
  assert.equal(f.app.inputs.byRequestIds(['during-resume'])[0]!.state,'queued');assert.equal(f.turns.length,0);
  f.state.startGate.release();await f.settle();assert.equal(f.app.inputs.byRequestIds(['during-resume'])[0]!.state,'completed');assert.deepEqual(f.turns.map(turn=>turn.request),['during-resume']);assert.equal(f.turns[0]!.thread,'original-main');
 }finally{await f.close();}
});

for(const blocker of ['canRestart','nativeBusy','nativeInteractionPending'] as const)test('an idle-looking Main waits for '+blocker+' to clear',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:0});const f=await fixture();
 try{
  f.mains[0]![blocker]=blocker==='canRestart'?false:true;t.mock.timers.tick(900000);await f.settle();assert.equal(f.mains.length,1);
  f.mains[0]![blocker]=blocker==='canRestart'?true:false;f.mains[0]!.emit('idle');await f.settle();assert.equal(f.mains.length,2);
 }finally{await f.close();}
});

for(const disconnected of [false,true])test('late Main MCP work waits through the endpoint response boundary; disconnected='+disconnected,async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:0});const f=await fixture();let client:ReturnType<typeof createConnection>|undefined;
 try{
  const held=f.hold();let entered=false,received='',closedAfterReceipt=false;const endpoint=f.app['interactionMcp']!;
  t.mock.method(f.app as any,'mainActivity',async()=>{entered=true;await held.promise;return {value:'synthetic-result'};});
  const close=f.mains[0]!.close.bind(f.mains[0]);t.mock.method(f.mains[0]!,'close',async()=>{closedAfterReceipt=received.includes('synthetic-result');return close();});
  f.state.duringMain=async()=>{f.state.duringMain=undefined;client=createConnection(endpoint.path);client.setEncoding('utf8');client.on('error',()=>{});client.on('data',chunk=>{received+=chunk;client!.end();});client.write(JSON.stringify({tool:'inspect_interaction',arguments:{}})+'\n');await until(()=>entered);};
  await f.app.message('Synthetic host call','host');if(disconnected){client!.destroy();await flush();}
  t.mock.timers.tick(900000);await f.settle();assert.equal(f.mains.length,1);
  held.release();await until(()=>f.mains.length===2);await f.settle();assert.equal(f.turns.length,1);if(!disconnected)assert.equal(closedAfterReceipt,true,'the client must receive its result before Main closes');
 }finally{client?.destroy();await f.close();}
});

test('unsupported providers never attempt Main recovery despite timer and Worker success',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:0});const f=await fixture();
 try{const worker=await f.delegate();f.mains[0]!.supportsWebSocket=false;worker.emit('webSocketSucceeded');t.mock.timers.tick(7200000);await f.settle();assert.equal(f.mains.length,1);assert.equal(f.mains[0]!.closes,0);}finally{await f.close();}
});

test('unconfirmed Main exit never starts a replacement or claims queued work',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:0});const f=await fixture();
 try{f.state.stopConfirmed=false;t.mock.timers.tick(900000);await f.settle();assert.equal(f.mains[0]!.closes,1);assert.equal(f.mains.length,1);assert.equal(f.app['mainBroken'],true);assert.equal(f.turns.length,0);}finally{await f.close();}
});

test('shutdown during a recovery stop cannot spawn a replacement Main',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:0});const f=await fixture();
 try{f.state.closeGate=f.hold();t.mock.timers.tick(900000);await until(()=>f.mains[0]!.closes>0);const closing=f.app.close();f.state.closeGate.release();await closing;assert.equal(f.mains.length,1);t.mock.timers.tick(7200000);await flush();assert.equal(f.mains.length,1);}finally{await f.close();}
});


test('a fresh Main already adopts native reconnect settings without a second cold resume',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:0});const f=await fixture();
 try{
  f.app['nativeReconnect']=true;t.mock.timers.tick(900000);await f.settle();assert.equal(f.mains.length,2);assert.equal(f.app['nativeReconnect'],false);
  f.mains[1]!.setTransport('http');t.mock.timers.tick(899999);await f.settle();assert.equal(f.mains.length,2);t.mock.timers.tick(1);await f.settle();assert.equal(f.mains.length,3,'periodic retry stays anchored to the last actual attempt');
 }finally{await f.close();}
});

test('native settings changed during recovery remain pending for the next safe native refresh',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:0});const f=await fixture();
 try{f.state.startGate=f.hold();t.mock.timers.tick(900000);await until(()=>f.mains.length===2);f.app['nativeRevision']++;f.app['nativeReconnect']=true;f.state.startGate.release();await f.settle();assert.equal(f.app['nativeReconnect'],true);}finally{await f.close();}
});

test('Main WS success cancels a deferred recovery and its timer',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:0});const f=await fixture();
 try{f.mains[0]!.canRestart=false;t.mock.timers.tick(900000);await f.settle();f.mains[0]!.setTransport('websocket');f.mains[0]!.canRestart=true;f.mains[0]!.emit('idle');t.mock.timers.tick(7200000);await f.settle();assert.equal(f.mains.length,1);assert.equal(f.mains[0]!.closes,0);}finally{await f.close();}
});

for(const settings of [{supports:false},{source:'website' as const}])test('initial unsupported provider/source cannot schedule a recovery '+JSON.stringify(settings),async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:0});const f=await fixture(settings);
 try{const worker=await f.delegate();worker.emit('webSocketSucceeded');t.mock.timers.tick(7200000);await f.settle();assert.equal(f.mains.length,1);}finally{await f.close();}
});

test('unsupported or retired Worker callbacks cannot trigger Main recovery',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:0});const f=await fixture();
 try{
  const worker=await f.delegate();worker.supportsWebSocket=false;worker.emit('webSocketSucceeded');await f.settle();assert.equal(f.mains.length,1);
  worker.supportsWebSocket=true;const slot=[...f.app['workers'].values()].find(slot=>slot.engine===worker)!;slot.stopping=Promise.resolve();worker.emit('webSocketSucceeded');await f.settle();assert.equal(f.mains.length,1);slot.stopping=undefined;
 }finally{await f.close();}
});

test('failed cold resume preserves the input and reports failure without dispatching tools',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:0});const f=await fixture();
 try{
  f.state.startGate=f.hold();f.state.startFails=true;t.mock.timers.tick(900000);await until(()=>f.mains.length===2);
  const input=f.app.message('Retain this input','resume-failure');f.state.startGate.release();const reply=await input;await f.settle();
  assert.match(reply,/synthetic_resume_failed/);assert.equal(f.turns.length,0);assert.equal(f.calls.length,0);assert.equal(f.app.inputs.byRequestIds(['resume-failure'])[0]!.state,'failed');assert.equal(f.app.store.meta('mainThread'),'original-main');
  const count=f.mains.length;t.mock.timers.tick(7200000);await f.settle();assert.equal(f.mains.length,count,'failed startup cannot enter a background retry loop');
 }finally{await f.close();}
});


test('a Worker signal at the queue drain boundary is not lost',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:0});const f=await fixture();
 try{
  const worker=await f.delegate();await f.settle();
  const job=f.app['enqueue'](async()=>{});void job.then(()=>queueMicrotask(()=>worker.emit('webSocketSucceeded')));
  await job;await f.settle();assert.equal(f.mains.length,2);assert.equal(f.calls.length,1);
 }finally{await f.close();}
});


test('native account work defers recovery and wakes it when the operation settles',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:0});const f=await fixture();
 try{
  const held=f.hold();t.mock.method(f.app as any,'nativeAccount',()=>({state:async()=>{await held.promise;return {};}}));
  const operation=f.app.manageNativeAccount({action:'account_state'});t.mock.timers.tick(900000);await f.settle();assert.equal(f.mains.length,1);
  held.release();await operation;await f.settle();assert.equal(f.mains.length,2);assert.equal(f.turns.length,0);
 }finally{await f.close();}
});

test('a Worker reply queued during Main recovery stays intact and is handled once after resume',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:0});const f=await fixture();
 try{
  const worker=await f.delegate();f.state.startGate=f.hold();worker.emit('webSocketSucceeded');await until(()=>f.mains.length===2);
  worker.workerGate!.release();await until(()=>f.app.inputs.dispatchPage(undefined,'epoch','all').items.some(item=>item.origin==='worker'));
  const item=f.app.inputs.dispatchPage(undefined,'epoch','all').items.find(item=>item.origin==='worker')!;assert.equal(item.state,'queued');assert.equal(f.turns.length,1);
  f.state.startGate.release();await f.settle();assert.equal(f.turns.length,2);assert.equal(f.calls.length,1);assert.ok(f.turns.every(turn=>turn.thread==='original-main'));assert.equal(f.app.inputs.dispatchPage(undefined,'epoch','all').items.length,0);
 }finally{await f.close();}
});


for(const finish of ['completed','disconnected','timeout'] as const)test('an asynchronous native login '+finish+' wakes idle Main recovery without new input',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:0});const f=await fixture();
 try{
  const worker=await f.delegate();let connected=false;
  t.mock.method(f.app as any,'nativeRpc',async(method:string)=>method==='account/read'?{account:connected?{type:'chatgpt'}:null}:method==='account/login/start'?{type:'chatgpt',loginId:'synthetic-login',authUrl:'https://auth.openai.com/synthetic'}:{status:'canceled'});
  await f.app.manageNativeAccount({action:'account_login',approve:true});assert.equal(f.app['accountManager']!.pending,true);
  worker.emit('webSocketSucceeded');await f.settle();assert.equal(f.mains.length,1);
  if(finish==='completed'){connected=true;f.app['accountManager']!.completed({loginId:'synthetic-login',success:true});}
  else if(finish==='disconnected')f.app['accountManager']!.disconnected();
  else t.mock.timers.tick(600000);
  await until(()=>!f.app['accountManager']!.pending);await f.settle();assert.equal(f.mains.length,2);assert.equal(f.calls.length,1);
 }finally{await f.close();}
});


test('supported membership Main recovers on matching Worker WS success without replaying its tool',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:0});const f=await fixture({source:'website',supports:true});
 try{const worker=await f.delegate();worker.emit('webSocketSucceeded');await f.settle();assert.equal(f.mains.length,2);assert.equal(f.mains[1]!.threadId,'original-main');assert.equal(f.calls.length,1);assert.equal(f.workers[0]!.closes,0);}finally{await f.close();}
});

test('a different membership Worker model is no recovery hint; Main still uses its own periodic budget',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:0});const f=await fixture({source:'website',supports:true,workerModel:'other-model'});
 try{const worker=await f.delegate();worker.emit('webSocketSucceeded');await f.settle();assert.equal(f.mains.length,1);t.mock.timers.tick(900000);await f.settle();assert.equal(f.mains.length,2);assert.equal(f.calls.length,1);}finally{await f.close();}
});
