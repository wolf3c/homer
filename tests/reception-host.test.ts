import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdirSync,mkdtempSync,rmSync } from 'node:fs';
import { resolve,join } from 'node:path';
import { TurnExecution } from '../src/execution-limits.js';
import { Homer } from '../src/service.js';
import { homerWebBridge } from '../src/web-homer.js';
import { CodexEngine,type EngineLike,type EngineOptions,type ToolCall,type TurnResult } from '../src/engine.js';
const until=async(check:()=>boolean)=>{const end=Date.now()+5000;while(!check()){if(Date.now()>end)throw Error('synthetic_reception_timeout');await new Promise(r=>setTimeout(r,5));}};

test('reception host: continuous user reception with a real background task; committed Worker projections, frozen events, pure states and timings',async t=>{
 const parent=resolve('.codex/scratch/main-agent-reception-optimization');mkdirSync(parent,{recursive:true});const base=mkdtempSync(join(parent,'continuous-host-'));mkdirSync(join(base,'runtime'));
 let sequence=0,taskId='',releaseWorker:((value:TurnResult)=>void)|undefined,releaseInternal:(()=>void)|undefined;const turns:string[]=[];
 class Engine extends EventEmitter implements EngineLike {
  threadId:string;turnId?:string;
  constructor(readonly options:EngineOptions,readonly handler:(call:ToolCall)=>Promise<unknown>){super();this.threadId=options.threadId??'synthetic-reception-'+ ++sequence;}
  async start(){return this.threadId;}
  call(tool:string,args:unknown):Promise<any>{return this.handler({threadId:this.threadId,turnId:this.turnId!,callId:'synthetic-call-'+ ++sequence,tool,arguments:args});}
  async turn(text:string,options?:{onStarted?:(id:string)=>void}):Promise<TurnResult>{
   this.turnId='synthetic-turn-'+ ++sequence;options?.onStarted?.(this.turnId);
   if(this.options.tools.some(t=>t.name==='read_material'))return new Promise(r=>releaseWorker=r);
   if(text==='synthetic:delegate'){
    const task=await this.call('task_create',{title:'Synthetic background',goal:'Synthetic background'});taskId=task.taskId;
    await this.call('worker_open',{taskId,message:'Inspect synthetic background'});
   }else if(text.startsWith('[内部协作输入')){
    await new Promise<void>(r=>releaseInternal=r);
   }else turns.push(text);
   this.emit('nativeCompleted',{turnId:this.turnId,status:'completed'});
   return {status:'completed',text:'Synthetic confirmed reply'};
  }
  async close(){releaseWorker?.({status:'failed',text:'',errorCode:'synthetic_closed'});releaseInternal?.();return true;}
  async interrupt(){return this.close();}
 }
 const app=new Homer({workspace:join(base,'workspace'),runtime:join(base,'runtime'),codexHome:join(base,'empty-home'),codexBin:'/usr/bin/false',model:'synthetic',requiresOpenaiAuth:false,stopGraceMs:100},async()=>{},(options,handler)=>new Engine(options,handler));
 const seen:{internal:boolean;messageId:string|null}[]=[];app.onStateChange(()=>seen.push({internal:!!app['mainContext']?.event,messageId:app['mainContext']?.messageId??null}));
 try{
  await app.start();await app.message('synthetic:delegate','synthetic-delegate');await until(()=>!!releaseWorker);
  for(let i=0;i<6;i++)app.submitMessage({requestId:'synthetic-user-'+i,text:'synthetic-question-'+i});
  await until(()=>app.inputs.list().filter(item=>item.state==='completed').length===7);
  assert.deepEqual(turns,Array.from({length:6},(_,i)=>'synthetic-question-'+i));assert.equal(app.tasks.task(taskId).state,'open');
  const bridge=homerWebBridge(app),before=app.store.db.prepare('SELECT total_changes() n').get()!.n;
  const observedAt=Date.now(),clock=t.mock.method(Date,'now',()=>observedAt);
  const a=await bridge.state(),b=await bridge.state();assert.deepEqual(a,b);clock.mock.restore();assert.equal(app.store.db.prepare('SELECT total_changes() n').get()!.n,before);
  const node=a.messages.map(message=>message.process).find(node=>node?.items.some(item=>item.kind==='workerEvent'&&item.event?.taskId===taskId))!;assert.ok(node);
  const delegated=node.items.find(item=>item.kind==='workerEvent')!;assert.equal(delegated.kind,'workerEvent');if(delegated.kind!=='workerEvent')throw Error('delegation_missing');
  assert.equal(delegated.event?.eventKind,'delegated');const original=app.processes.exact(node.id);
  releaseWorker!({status:'failed',text:'',errorCode:'synthetic_failure'});await until(()=>!!releaseInternal);
  const busyAt=Date.now(),busyClock=t.mock.method(Date,'now',()=>busyAt);const busy=await bridge.state();assert.equal(busy.isRunning,false);assert.equal(busy.activeMessageId,null);assert.equal(busy.generation,null);
  assert.ok(app['mainContext']?.event,'internal context remains live');
  assert.ok(seen.some(state=>state.internal&&state.messageId===null),'internal round start invalidates state without inventing a stop target');
  const internalChanges=app.store.db.prepare('SELECT total_changes() n').get()!.n;
  assert.deepEqual(await bridge.state(),busy);busyClock.mock.restore();assert.equal(app.store.db.prepare('SELECT total_changes() n').get()!.n,internalChanges);
  await assert.rejects(app.stopMain('invented-internal-message'),/main_reply_not_active/);
  assert.deepEqual(app.processes.exact(node.id),original,'historical delegation stays frozen when the live Run fails');
  const run=app.tasks.runs(taskId)[0]!;assert.equal(run.errorCode,'synthetic_failure');assert.equal(run.status,'failed');assert.equal(app.tasks.task(taskId).outcome,null,'execution failure is not a reviewed business outcome');
  const beforeInternalEnd=seen.length;
  releaseInternal!();await app.idle();assert.equal((await bridge.state()).isRunning,false);
  assert.equal(app['mainContext'],undefined);assert.ok(seen.slice(beforeInternalEnd).some(state=>!state.internal&&state.messageId===null),'internal round end invalidates state');
  assert.ok(seen.some(state=>!state.internal&&state.messageId!==null),'user round retains its real reply target');
  const records=app.receptionTimings.read().records;
  for(const phase of ['accepted','head','claimed','main_prepare','native_start','native_completed','engine_settled','round_end'])assert.ok(records.some(row=>row.phase===phase&&row.requestId==='synthetic-user-0'),phase);
  assert.ok(records.some(row=>row.kind==='internal'&&!row.messageId&&row.phase==='native_start'));assert.ok(seen.length>6);
 }finally{releaseInternal?.();releaseWorker?.({status:'failed',text:'',errorCode:'synthetic_closed'});await app.close();rmSync(base,{recursive:true,force:true});}
});

test('native completion timing precedes real engine background-terminal settlement',async()=>{
 const engine:any=new CodexEngine({workspace:process.cwd(),runtime:process.cwd(),codexHome:'/synthetic/home',model:'synthetic'} as any,{cwd:process.cwd(),readRoots:[],instructions:'',tools:[],nativeTools:'main'},async()=>({}));
 const observed:string[]=[];let release!:()=>void;
 engine.threadId='synthetic-thread';engine.turnId='synthetic-turn';engine.active={execution:new TurnExecution({}),messages:[],earlyEvents:[],resolve:()=>observed.push('engine_settled')};engine.refreshBackground=()=>new Promise<void>(r=>release=r);
 engine.on('nativeCompleted',()=>observed.push('native_completed'));
 engine.on('nativeBackgroundRefreshed',()=>observed.push('background_refreshed'));
 const work=engine.receive(JSON.stringify({method:'turn/completed',params:{threadId:'synthetic-thread',turn:{id:'synthetic-turn',status:'completed'}}}));
 await until(()=>!!release);assert.deepEqual(observed,['native_completed']);release();await work;assert.deepEqual(observed,['native_completed','background_refreshed','engine_settled']);
});

test('reception host: preparing first_launch interrupt stays idle until one readiness event drains the FIFO head',async()=>{
 const parent=resolve('.codex/scratch/main-agent-reception-optimization');mkdirSync(parent,{recursive:true});const base=mkdtempSync(join(parent,'head-order-host-'));mkdirSync(join(base,'runtime'));
 const turns:string[]=[];let ready=false,claims=0;
 class Engine extends EventEmitter implements EngineLike{
  threadId='synthetic-head-order-thread';turnId?:string;
  async start(){return this.threadId;}
  async turn(text:string,options?:{onStarted?:(id:string)=>void}):Promise<TurnResult>{this.turnId='synthetic-head-turn-'+turns.length;options?.onStarted?.(this.turnId);turns.push(text);return {status:'completed',text:'Synthetic ordered reply'};}
  async close(){return true;}
  async interrupt(){return this.close();}
 }
 const app=new Homer({workspace:join(base,'workspace'),runtime:join(base,'runtime'),codexHome:join(base,'empty-home'),codexBin:'/usr/bin/false',model:'synthetic',requiresOpenaiAuth:false,stopGraceMs:100},async()=>{},()=>new Engine());
 try{
  await app.start();await app.idle();
  app.inputs.preparation=input=>input.requestId==='synthetic-head-first'&&!ready?'preparing':'ready';
  const claim=app.inputs.claim.bind(app.inputs);
  // Bound a regressed scheduler's microtask spin so this behavior test fails
  // instead of hanging its runner. The production scheduler has no such guard.
  function guardedClaim(...args:Parameters<typeof claim>):ReturnType<typeof claim>;
  function guardedClaim(suspended:Parameters<typeof claim>[0],sources:'all'):ReturnType<typeof claim>|import('../src/recursive-main-inputs.js').WorkerInput|undefined;
  function guardedClaim(suspended:Parameters<typeof claim>[0]=[],sources?:'all'){
    claims++;if(claims>4)ready=true;return sources==='all'?claim(suspended,'all'):claim(suspended);
  }
  app.inputs.claim=guardedClaim;
  const target={generationId:'synthetic-ended-generation',messageId:'synthetic-ended-reply'};
  app.submitMessage({requestId:'synthetic-head-first',text:'Synthetic first interrupt'},{source:'first_launch',persist(){}},target);
  app.submitMessage({requestId:'synthetic-head-second',text:'Synthetic second interrupt'},undefined,target);
  await app.idle();assert.equal(claims,0);assert.deepEqual(turns,[]);
  assert.deepEqual(app.inputs.list().map(row=>row.state),['queued','queued']);
  // Existing readiness owner notification: no timer or repeated wake needed.
  ready=true;app.mediaChanged();await app.idle();
  assert.deepEqual(turns,['Synthetic first interrupt','Synthetic second interrupt']);
  assert.deepEqual(app.inputs.list().map(row=>row.state),['completed','completed']);
  assert.deepEqual(app.inputs.list().map(row=>row.interruptState),['failed','failed']);
 }finally{ready=true;await app.close();rmSync(base,{recursive:true,force:true});}
});
