import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdirSync,mkdtempSync,readdirSync,readFileSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {Homer} from '../src/service.js';
import type {Config} from '../src/config.js';
import type {EngineLike,TurnResult} from '../src/engine.js';
const automatic='首次启动自动发起：请使用 $homer-initialize 完成首次初始化，按需调用工具管理 Skill。';
const until=async(f:()=>boolean)=>{for(let n=0;n<300;n++){if(f())return;await new Promise(r=>setTimeout(r,5));}throw Error('first_launch_wait_timeout');};
function setup(){
 const root=resolve('.codex/scratch/first-launch-tests');mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'isolated-')),home=join(dir,'codex');
 const config:Config={appData:dir,workspace:join(dir,'workspace'),runtime:join(dir,'runtime'),nativeCodexHome:home,codexHome:home,codexBin:'/usr/bin/false',model:'synthetic',requiresOpenaiAuth:true,timeoutMs:3000,mainTimeoutMs:3000,stopGraceMs:100};
 for(const p of [config.workspace,config.runtime,home])mkdirSync(p,{recursive:true});
 let connected=true,accountReads=0,turns:string[]=[],app:Homer,behavior:((text:string)=>Promise<TurnResult>)|undefined;
 class Peer extends EventEmitter implements EngineLike{
  threadId='synthetic-first-launch';turnId?:string;resumable=true;
  async start(){return this.threadId;} async close(){return true;} async refreshCapabilities(){return {pending:false};} async interrupt(){app['mainApprovals'].end(app['mainContext']!.generation!.generationId);return true;}
  async request(method:string){
   if(method==='account/read'){accountReads++;return {account:connected?{type:'chatgpt'}:null};}
   if(method==='skills/list')return {data:[{skills:readdirSync(join(home,'skills')).filter(name=>existsSync(join(home,'skills',name,'SKILL.md'))).map(name=>({name,path:join(home,'skills',name,'SKILL.md'),enabled:true}))}]};
   return {};
  }
  async turn(text:string,options?:{onStarted?:(id:string)=>void;skills?:{name:string;path:string}[]}):Promise<TurnResult>{
   this.turnId='synthetic-turn-'+(turns.length+1);options?.onStarted?.(this.turnId);turns.push(text);
   if(text.startsWith(automatic))assert.ok(options?.skills?.some(s=>s.name==='homer-initialize'&&s.path===join(home,'skills/homer-initialize/SKILL.md')));
   return behavior?behavior(text):{status:'completed',text:'Synthetic check: desktop permission missing; no install attempted.'};
  }
 }
 const open=async()=>{app=new Homer(config,async()=>{},()=>new Peer());await app.start();return app;};
 return {dir,home,config,open,get app(){return app;},get turns(){return turns;},get reads(){return accountReads;},set connected(v:boolean){connected=v;},set behavior(v:typeof behavior){behavior=v;},cleanup:async()=>{await app?.close();rmSync(dir,{recursive:true,force:true});}};
}
test('fresh connected instance submits one ordinary user request with explicit Skill and restart does not resend',async()=>{
 const s=setup();try{const app=await s.open();await until(()=>s.turns.length===1);await app.idle();const users=app.conversationState().messages.filter(m=>m.role==='user');assert.equal(users.length,1);assert.equal(users[0]!.text,automatic);assert.equal(app.inputs.list()[0]!.source,'first_launch');assert.equal(app.inputs.list()[0]!.state,'completed');assert.equal(app.store.meta('initialized'),undefined);await app.close();await s.open();await s.app.idle();assert.equal(s.turns.length,1);assert.equal(s.app.conversationState().messages.filter(m=>m.role==='user').length,1);}finally{await s.cleanup();}
});
test('unauthenticated stays quiet through reads and restart, connection event wakes exactly once',async()=>{
 const s=setup();s.connected=false;try{await s.open();await s.app.idle();await new Promise(r=>setTimeout(r,40));assert.equal(s.turns.length,0);const reads=s.reads;await new Promise(r=>setTimeout(r,40));assert.equal(s.reads,reads);await s.app.close();await s.open();await s.app.idle();assert.equal(s.turns.length,0);s.connected=true;(s.app['main'] as unknown as EventEmitter).emit('accountLoginCompleted',{success:true});await until(()=>s.turns.length===1);await s.app.idle();(s.app['main'] as unknown as EventEmitter).emit('accountLoginCompleted',{success:true});await s.app.idle();assert.equal(s.turns.length,1);}finally{await s.cleanup();}
});
test('already queued real request runs before unstarted automatic request',async()=>{
 const s=setup();try{await s.open();s.app.submitMessage({requestId:'real-task',text:'先处理我的实际任务'});await until(()=>s.turns.length===2);await s.app.idle();assert.match(s.turns[0]!,/^先处理我的实际任务/);assert.match(s.turns[1]!,/^首次启动自动发起/);}finally{await s.cleanup();}
});
test('uncertain automatic turn is not retried; explicit continue is an ordinary new request',async()=>{
 const s=setup();s.behavior=async()=>{throw Error('synthetic_failure');};try{await s.open();await until(()=>s.turns.length===1);await s.app.idle();assert.equal(s.app.inputs.list()[0]!.state,'uncertain');await s.app.close();s.behavior=undefined;await s.open();await s.app.idle();assert.equal(s.turns.length,1);await s.app.message('继续初始化','manual-continue');assert.equal(s.turns.length,2);assert.equal(s.app.inputs.list().find(i=>i.input.requestId==='manual-continue')!.source,'local');assert.equal(s.app.store.meta('initialized'),undefined);}finally{await s.cleanup();}
});
test('existing instance upgrade does not acquire automatic initialization or overwrite user Skill',async()=>{
 const s=setup();s.connected=false;try{await s.open();await s.app.idle();s.app.store.db.prepare("DELETE FROM meta WHERE key='firstLaunchRequestId'").run();const path=join(s.home,'skills/homer-initialize/SKILL.md');writeFileSync(path,'User maintained Skill.');const before=readFileSync(path,'utf8');rmSync(join(s.home,'skills/homer-tool-management'),{recursive:true});await s.app.close();s.connected=true;await s.open();await s.app.idle();assert.equal(s.turns.length,0);assert.equal(readFileSync(path,'utf8'),before);assert.equal(s.app.store.meta('firstLaunchRequestId'),undefined);assert.equal(existsSync(join(s.home,'skills/homer-tool-management')),false);}finally{await s.cleanup();}
});

test('submission transaction rolls back on injected failure then restart submits once',async()=>{
 const s=setup();s.connected=false;try{await s.open();await s.app.idle();const id=s.app.store.meta('firstLaunchRequestId');assert.ok(id);s.app.store.db.exec("CREATE TEMP TRIGGER reject_first_launch BEFORE INSERT ON agent_receipts BEGIN SELECT RAISE(ABORT,'synthetic_accept_failure');END;");s.connected=true;(s.app['main'] as unknown as EventEmitter).emit('accountLoginCompleted',{success:true});await s.app.idle();assert.equal(s.app.conversationState().messages.length,0);assert.equal(s.app.inputs.list().length,0);await s.app.close();await s.open();await until(()=>s.turns.length===1);await s.app.idle();assert.equal(s.app.inputs.list()[0]!.input.requestId,id);}finally{await s.cleanup();}
});
for(const phase of ['queued','processing'] as const)test('crash after atomic submission in '+phase+' preserves the single receipt',async()=>{
 const s=setup();s.connected=false;try{await s.open();await s.app.idle();const id=s.app.store.meta('firstLaunchRequestId')!;s.app.inputs.accept({requestId:id,text:automatic},{source:'first_launch',persist:()=>{}});if(phase==='processing')assert.ok(s.app.inputs.claim());await s.app.close();s.connected=true;await s.open();await s.app.idle();assert.equal(s.app.inputs.list().length,1);assert.equal(s.app.history.inputs(s.app.store.meta('mainThread')!,[id]).size,1);assert.equal(s.app.inputs.list()[0]!.state,phase==='processing'?'uncertain':'completed');assert.equal(s.turns.length,phase==='processing'?0:1);}finally{await s.cleanup();}
});
for(const decision of ['approve','deny','stop'] as const)test('automatic request uses ordinary exact approval, '+decision+' and new-message path',async()=>{
 const s=setup();let calls=0;try{
  s.behavior=async text=>{
   if(!text.startsWith(automatic))return {status:'completed',text:'Real task handled.'};
   const state=await s.app.manageCapabilities({action:'state'},'agent'),target={pluginName:'sample',marketplacePath:s.home+'/market/.agents/plugins/marketplace.json'},detail=await s.app.manageCapabilities({action:'plugin_read',target},'agent');
   const result=await s.app.manageCapabilities({action:'plugin_install',operationId:'exact-first-launch',target,reviewHash:detail.reviewHash,expectedVersion:state.version},'agent');
   return {status:'completed',text:'Synthetic approval '+result.status};
  };
  // Main model execution remains fake; the real Homer approval/receipt path runs.
  const open=s.open; // Override control RPC before the startup boundary runs.
  await open();
  s.app['nativeRpc']=async(method:string)=>{
   if(method==='config/read')return {layers:[{name:{type:'user',file:s.home+'/config.toml'},version:'synthetic-v1',config:{}}]};
   if(method==='skills/list')return {data:[]};
   if(method==='plugin/read')return {plugin:{summary:{id:'sample@synthetic',name:'sample',version:'1.0',installed:false,source:{type:'local',path:s.home+'/market/sample'}},skills:[{name:'sample'}],hooks:[],apps:[],mcpServers:[]}};
   if(method==='plugin/install'){calls++;return {authPolicy:'ON_USE',appsNeedingAuth:[]};}return {};
  };
  await until(()=>s.app.interactions.list().some(i=>i.state==='pending_user'));
  const pending=s.app.interactions.list().find(i=>i.state==='pending_user')!;
  assert.equal(calls,0);assert.ok(s.app.conversationState().generation?.sourceRequestId===s.app.store.meta('firstLaunchRequestId'));
  assert.throws(()=>s.app.interactions.respond(pending.id,{action:'approve',reason:'model auto-approves'},{userMessageId:'forged'}),/main_native_user_decision_required/);
  s.app.submitMessage({requestId:'later-real-task',text:'新的实际任务'});
  if(decision==='stop')await s.app.stopMain(s.app.conversationState().activeMessageId!);
  else s.app.submitMessage({requestId:'human-exact-decision',text:decision==='approve'?'允许本次操作':'拒绝本次操作',interactionId:pending.id});
  await s.app.idle();assert.equal(calls,decision==='approve'?1:0);assert.ok(s.turns.some(text=>text.startsWith('新的实际任务')));if(decision==='approve')assert.ok(s.turns.some(text=>text.startsWith('[宿主续接')));assert.equal(s.app.store.meta('mainThread'),'synthetic-first-launch');assert.equal(s.app.inputs.list().filter(i=>i.source==='first_launch').length,1);
 }finally{await s.cleanup();}
});

test('custom runtime sharing native HOME does not automatically initialize',async()=>{
 const s=setup();s.config.runtime=join(s.dir,'custom-runtime');mkdirSync(s.config.runtime);try{await s.open();await s.app.idle();assert.equal(s.turns.length,0);assert.equal(s.app.store.meta('firstLaunchRequestId'),undefined);assert.equal(existsSync(join(s.home,'skills/homer-initialize')),false);}finally{await s.cleanup();}
});

test('queued automatic and ordinary inputs preserve accepted FIFO order before claim',async()=>{
 const s=setup();s.connected=false;try{await s.open();await s.app.idle();s.app.inputs.accept({requestId:s.app.store.meta('firstLaunchRequestId')!,text:automatic},{source:'first_launch',persist:()=>{}});s.app.submitMessage({requestId:'priority-real',text:'请先完成这个真实任务'});await until(()=>s.turns.length===2);await s.app.idle();assert.match(s.turns[0]!,/^首次启动自动发起/);assert.match(s.turns[1]!,/^请先完成/);}finally{await s.cleanup();}
});
test('missing required Skill is not treated as ready and does not trigger a model turn',async()=>{
 const s=setup();s.connected=false;try{await s.open();await s.app.idle();rmSync(join(s.home,'skills/homer-tool-management'),{recursive:true});s.connected=true;(s.app['main'] as unknown as EventEmitter).emit('accountLoginCompleted',{success:true});await s.app.idle();assert.equal(s.turns.length,0);assert.equal(s.app.inputs.list().length,0);}finally{await s.cleanup();}
});
