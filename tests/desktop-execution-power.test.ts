import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {Homer} from '../src/service.js';
import type {Config} from '../src/config.js';
import {CodexEngine,type EngineLike,type EngineOptions,type ToolCall,type TurnResult} from '../src/engine.js';
import type {NativeRequest} from '../src/worker-native-requests.js';

const stopped={executing:false,displayRequired:false};
function gate<T=void>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}
async function until(check:()=>boolean){const end=Date.now()+4000;while(!check()){if(Date.now()>end)throw Error('synthetic_wait_timeout');await new Promise(done=>setTimeout(done,5));}}
function fixture(){
 const scratch=resolve('.codex/scratch/desktop-execution-power');mkdirSync(scratch,{recursive:true});
 const dir=mkdtempSync(join(scratch,'test-')),workspace=join(dir,'workspace'),runtime=join(dir,'runtime');mkdirSync(workspace);mkdirSync(runtime);
 const config:Config={workspace,runtime,codexBin:'/usr/bin/false',codexHome:join(dir,'engine'),nativeCodexHome:join(dir,'engine'),model:'synthetic',requiresOpenaiAuth:false,stopGraceMs:50};
 let sequence=0;
 const engines:Fake[]=[];
 const scripts:{main:(engine:Fake,text:string)=>Promise<TurnResult>;worker:(engine:Fake,text:string)=>Promise<TurnResult>}={main:async()=>({status:'completed',text:'Synthetic complete'}),worker:async()=>({status:'completed',text:'Synthetic Worker complete'})};
 class Fake extends EventEmitter implements EngineLike{
  threadId:string;turnId?:string;turnActive=false;nativeInteractionPending=false;nativeBusy=false;closeConfirmed=true;starts=0;turns=0;responses=0;
  private release?:()=>void;
  constructor(readonly options:EngineOptions,readonly handle:(call:ToolCall)=>Promise<unknown>){super();this.threadId=options.threadId??'thread:'+ ++sequence;engines.push(this);}
  async start(){this.starts++;return this.threadId;}
  async turn(text:string,options?:{onStarted?:(id:string)=>void}){
   this.turns++;this.turnActive=true;this.turnId='turn:'+ ++sequence;options?.onStarted?.(this.turnId);
   const cancelled=new Promise<TurnResult>(done=>{this.release=()=>done({status:'interrupted',text:''});});
   try{return await Promise.race([text.startsWith('[内部协作输入')?Promise.resolve({status:'completed',text:''}):scripts[this.options.role==='worker'?'worker':'main'](this,text),cancelled]);}
   finally{this.turnActive=false;this.emit('powerActivity');}
  }
  call(tool:string,args:unknown){return this.handle({threadId:this.threadId,turnId:this.turnId!,callId:'call:'+ ++sequence,tool,arguments:args});}
  async question(){
   this.nativeInteractionPending=true;this.emit('interactionWaiting');
   const request:NativeRequest={method:'item/tool/requestUserInput',requestId:'question:'+ ++sequence,kind:'question',threadId:this.threadId,turnId:this.turnId!,itemId:'question-item',details:{questions:[{id:'format',question:'Synthetic output format',isOther:false,options:[{label:'表格'},{label:'文字'}]}]},isCurrent:()=>this.turnActive};
   const result=await this.options.onInteraction!(request);this.responses++;this.nativeInteractionPending=false;this.emit('interactionWaiting');return result;
  }
  async interrupt(){return false;}
  async close(){if(this.closeConfirmed){this.release?.();this.nativeBusy=false;this.emit('exit');}return this.closeConfirmed;}
 }
 const app=new Homer(config,async()=>{},(options,handle)=>new Fake(options,handle));
 return {app,engines,scripts,worker:()=>engines.find(engine=>engine.options.role==='worker')!,slot:()=>[...(app as any).workers.values()][0],
  async close(){for(const engine of engines)engine.closeConfirmed=true;await app.close().catch(()=>{});rmSync(dir,{recursive:true,force:true});}};
}

test('idle and queued inputs do not protect; preparation awaits the desktop acknowledgment',async()=>{
 const f=fixture();try{
  await f.app.start();assert.deepEqual(f.app.desktopPowerFacts(),stopped);
  const ack=gate(),work=gate<TurnResult>(),facts:{executing:boolean;displayRequired:boolean}[]=[];
  const unbind=f.app.bindDesktopPowerProtection(async value=>{facts.push(value);await ack.promise;});
  f.scripts.main=async()=>work.promise;
  const job=f.app.message('Synthetic work','power-main');
  assert.deepEqual(f.app.desktopPowerFacts(),stopped);
  await until(()=>facts.length>0);
  assert.deepEqual(facts[0],{executing:true,displayRequired:false});assert.equal(f.engines[0]!.turns,0);
  ack.resolve();await until(()=>f.engines[0]!.turns===1);assert.deepEqual(f.app.desktopPowerFacts(),{executing:true,displayRequired:false});
  work.resolve({status:'completed',text:'Done'});await job;assert.deepEqual(f.app.desktopPowerFacts(),stopped);unbind();
 }finally{await f.close();}
});

test('main user wait releases and answering awaits protection before the native response',async()=>{
 const f=fixture();try{
  await f.app.start();f.app.bindDesktopPowerProtection(async()=>{});
  f.scripts.main=async engine=>{await engine.question();return {status:'completed',text:'Answered'};};
  const job=f.app.message('Synthetic question','power-question');
  await until(()=>f.app.interactions.list().some(item=>item.state==='pending_user'));
  assert.deepEqual(f.app.desktopPowerFacts(),stopped);
  const ack=gate();let requested=false;f.app.bindDesktopPowerProtection(async()=>{requested=true;await ack.promise;});
  const item=f.app.interactions.list().find(item=>item.state==='pending_user')!;
  f.app.submitMessage({requestId:'power-answer',text:'表格',interactionId:item.id});await until(()=>requested);
  assert.equal(f.engines[0]!.responses,0);assert.equal(f.app.desktopPowerFacts().executing,true);
  ack.resolve();await job;assert.equal(f.engines[0]!.responses,1);assert.deepEqual(f.app.desktopPowerFacts(),stopped);
 }finally{await f.close();}
});

test('a concurrent Worker and its native background activity survive a main user wait',async()=>{
 const f=fixture();try{
  await f.app.start();f.app.bindDesktopPowerProtection(async()=>{});
  const running=gate();f.scripts.worker=async engine=>{await running.promise;await engine.question();return {status:'completed',text:'Done'};};
  f.scripts.main=async engine=>{await engine.call('worker_open',{message:'Synthetic parallel work'});await engine.question();return {status:'completed',text:'Done'};};
  const job=f.app.message('Synthetic parallel question','power-concurrent');
  await until(()=>!!f.worker()?.turns&&f.app.interactions.list().some(item=>item.state==='pending_user'));
  assert.equal(f.app.desktopPowerFacts().executing,true);running.resolve();
  await until(()=>f.app.interactions.list().filter(item=>['pending_main','pending_user'].includes(item.state)).length===2);
  assert.deepEqual(f.app.desktopPowerFacts(),stopped);
  f.worker().nativeBusy=true;f.worker().emit('powerActivity');assert.equal(f.app.desktopPowerFacts().executing,true);
  f.worker().nativeBusy=false;f.worker().emit('powerActivity');assert.deepEqual(f.app.desktopPowerFacts(),stopped);
  const main=f.app.interactions.list().find(item=>item.state==='pending_user')!;
  f.app.submitMessage({requestId:'power-main-answer',text:'文字',interactionId:main.id});await job;
 }finally{await f.close();}
});

test('Worker preparation obtains protection before starting its synthetic engine',async()=>{
 const f=fixture();try{
  await f.app.start();const ack=gate(),work=gate<TurnResult>();let requested=false;
  f.app.bindDesktopPowerProtection(async()=>{if(f.app.store.runs().some(run=>run.phase==='starting')){requested=true;await ack.promise;}});
  f.scripts.worker=async()=>work.promise;
  f.scripts.main=async engine=>{await engine.call('worker_open',{message:'Synthetic Worker gate'});return {status:'completed',text:'Delegated'};};
  const job=f.app.message('Synthetic Worker gate','power-worker-gate');await until(()=>requested);
  assert.equal(f.worker(),undefined);assert.equal(f.app.desktopPowerFacts().executing,true);
  ack.resolve();await job;await until(()=>!!f.worker()?.turns);assert.equal(f.worker().starts,1);
  work.resolve({status:'completed',text:'Done'});await f.app.idle();assert.deepEqual(f.app.desktopPowerFacts(),stopped);
 }finally{await f.close();}
});

test('an in-flight managed tool keeps protection when the main turn waits for the user',async()=>{
 const f=fixture();try{
  const tool=gate(),started=gate();let call!:Promise<unknown>;
  f.app.registerMainPluginTool({name:'synthetic_hold',type:'function',description:'Synthetic in-flight tool',inputSchema:{type:'object',properties:{},additionalProperties:false}},async()=>{started.resolve();await tool.promise;return {done:true};});
  await f.app.start();f.app.bindDesktopPowerProtection(async()=>{});
  f.scripts.main=async engine=>{
   engine.emit('hostMcpToolStarted',{tool:'synthetic_hold',arguments:{},threadId:engine.threadId,turnId:engine.turnId,itemId:'managed-power-call'});
   call=(f.app as any).mainPluginTool('synthetic_hold',{},{callId:'managed-power-call','x-codex-turn-metadata':{turn_id:engine.turnId}});
   await started.promise;await engine.question();return {status:'completed',text:'Done'};
  };
  const job=f.app.message('Synthetic managed tool','power-managed');await until(()=>f.app.interactions.list().some(item=>item.state==='pending_user'));
  assert.equal(f.app.desktopPowerFacts().executing,true);tool.resolve();await call;assert.deepEqual(f.app.desktopPowerFacts(),stopped);
  const item=f.app.interactions.list().find(item=>item.state==='pending_user')!;
  f.app.submitMessage({requestId:'power-managed-answer',text:'表格',interactionId:item.id});await job;assert.deepEqual(f.app.desktopPowerFacts(),stopped);
 }finally{await f.close();}
});

test('CUA display protection pauses for window approval and is acknowledged before invoking again',async()=>{
 const f=fixture();try{
  await f.app.start();f.app.bindDesktopPowerProtection(async()=>{});
  const worker=gate<TurnResult>();f.scripts.worker=async()=>worker.promise;
  f.scripts.main=async engine=>{await engine.call('worker_open',{message:'Synthetic desktop work'});return {status:'completed',text:'Delegated'};};
  await f.app.message('Synthetic desktop work','power-cua');await until(()=>!!f.worker()?.turns);
  let invoked=false,resumed=false;
  (f.app as any).cua={async invoke(_owner:string,_name:string,_args:unknown,_guard:()=>void,_write:unknown,review:(app:string,title:string)=>Promise<void>){invoked=true;assert.deepEqual(f.app.desktopPowerFacts(),{executing:true,displayRequired:true});await review('Synthetic','Window');resumed=true;assert.equal(f.app.desktopPowerFacts().displayRequired,true);return {state:'observed'};},async close(){return true;}};
  const ack=gate();let displays=0;
  f.app.bindDesktopPowerProtection(async value=>{if(value.displayRequired&&++displays===2)await ack.promise;});
  const operation=(f.app as any).workerCuaTool(f.slot(),'desktop_read',{app:'Synthetic'});
  await until(()=>f.app.interactions.list().some(item=>item.state==='pending_user'));
  assert.equal(invoked,true);assert.deepEqual(f.app.desktopPowerFacts(),stopped);
  const item=f.app.interactions.list().find(item=>item.state==='pending_user')!;
  f.app.submitMessage({requestId:'power-cua-answer',text:'允许本次操作',interactionId:item.id});
  await until(()=>displays===2);assert.equal(resumed,false);ack.resolve();await operation;
  assert.equal(resumed,true);assert.deepEqual(f.app.desktopPowerFacts(),{executing:true,displayRequired:false});
  worker.resolve({status:'completed',text:'Done'});await f.app.idle();assert.deepEqual(f.app.desktopPowerFacts(),stopped);
 }finally{await f.close();}
});

test('failed or timed out protection acknowledgments do not fail business work',async()=>{
 const f=fixture();try{
  await f.app.start();f.app.bindDesktopPowerProtection(async()=>{throw Error('synthetic_power_unavailable');});
  assert.equal(await f.app.message('Synthetic unavailable','power-unavailable'),'Synthetic complete');
  f.app.bindDesktopPowerProtection(()=>new Promise(()=>{}));const start=Date.now();
  assert.equal(await f.app.message('Synthetic timeout','power-timeout'),'Synthetic complete');assert.ok(Date.now()-start<3000);
  assert.deepEqual(f.app.desktopPowerFacts(),stopped);
 }finally{await f.close();}
});

test('unconfirmed Worker cleanup retains protection after its business slot ends',async()=>{
 const f=fixture();try{
  await f.app.start();f.app.bindDesktopPowerProtection(async()=>{});
  f.scripts.worker=async engine=>{engine.closeConfirmed=false;return {status:'completed',text:'Done'};};
  f.scripts.main=async engine=>{await engine.call('worker_open',{message:'Synthetic close uncertainty'});return {status:'completed',text:'Delegated'};};
  await f.app.message('Synthetic close uncertainty','power-unconfirmed');await f.app.idle();
  assert.equal(f.app.desktopPowerFacts().executing,true);
  f.worker().closeConfirmed=true;await f.worker().close();assert.deepEqual(f.app.desktopPowerFacts(),stopped);
 }finally{await f.close();}
});

test('stopping a Worker holds protection until cleanup is confirmed',async()=>{
 const f=fixture();try{
  await f.app.start();f.app.bindDesktopPowerProtection(async()=>{});f.scripts.worker=async()=>new Promise(()=>{});
  f.scripts.main=async engine=>{await engine.call('worker_open',{message:'Synthetic stop confirmation'});return {status:'completed',text:'Delegated'};};
  await f.app.message('Synthetic stop confirmation','power-stopping');await until(()=>!!f.worker()?.turns);
  const closed=gate(),engine=f.worker(),original=engine.close.bind(engine);let closing=false;
  engine.close=async()=>{closing=true;await closed.promise;return original();};
  const facts:boolean[]=[],unbind=f.app.onStateChange(()=>facts.push(f.app.desktopPowerFacts().executing));
  const stopping=f.app.stop(f.slot().id);await until(()=>closing);
  assert.equal(f.app.desktopPowerFacts().executing,true);assert.ok(facts.length>0);assert.ok(facts.every(Boolean));
  closed.resolve();await stopping;await f.app.idle();assert.deepEqual(f.app.desktopPowerFacts(),stopped);unbind();
 }finally{await f.close();}
});

test('unconfirmed CUA cleanup remains protected after confirmed engine exit',async()=>{
 const f=fixture();try{
  await f.app.start();f.app.bindDesktopPowerProtection(async()=>{});let cuaClosed=false,owner:any;
  (f.app as any).cua={async invoke(){return {state:'observed'};},async close(){return cuaClosed;}};
  f.scripts.worker=async()=>{owner=f.slot();await (f.app as any).workerCuaTool(owner,'desktop_read',{app:'Synthetic'});return {status:'completed',text:'Done'};};
  f.scripts.main=async engine=>{await engine.call('worker_open',{message:'Synthetic CUA cleanup'});return {status:'completed',text:'Delegated'};};
  await f.app.message('Synthetic CUA cleanup','power-cua-cleanup');await f.app.idle();
  assert.deepEqual(f.app.desktopPowerFacts(),{executing:true,displayRequired:false});
  cuaClosed=true;await (f.app as any).closeWorkerResources(owner);assert.deepEqual(f.app.desktopPowerFacts(),stopped);
 }finally{await f.close();}
});

test('confirmed main closure releases protection without changing its native background safety fact',async()=>{
 const f=fixture();try{
  await f.app.start();const main=f.engines[0]!;main.nativeBusy=true;main.close=async()=>true;
  assert.equal(f.app.desktopPowerFacts().executing,true);await f.app.close();
  assert.equal(main.nativeBusy,true);assert.deepEqual(f.app.desktopPowerFacts(),stopped);
 }finally{await f.close();}
});

test('native background refresh publishes power changes only when the activity fact changes',async()=>{
 const f=fixture(),engine=new CodexEngine(f.app.config,{cwd:f.app.config.workspace,readRoots:[],instructions:'Synthetic background observation',tools:[],nativeTools:'main'},async()=>({}));
 try{
  engine.threadId='synthetic-background-thread';let busy=true;const changes:boolean[]=[];
  engine.request=async()=>({data:busy?[{id:'synthetic-terminal'}]:[]});
  engine.on('powerActivity',()=>changes.push(engine.nativeBusy));
  await (engine as any).refreshBackground();await (engine as any).refreshBackground();busy=false;await (engine as any).refreshBackground();
  assert.deepEqual(changes,[true,false]);assert.equal(engine.nativeBusy,false);
 }finally{await engine.close();await f.close();}
});
