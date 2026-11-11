import {readTestConversation} from './fixtures/read-test-conversation.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdirSync,mkdtempSync,readdirSync,readFileSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {Homer} from '../src/service.js';
import type {Config} from '../src/config.js';
import type {EngineLike,TurnResult} from '../src/engine.js';
const automatic='首次启动自动发起：请使用 $homer-initialize 完成首次初始化，按需调用工具管理 Skill。';
const legacyId='first-launch-legacy';
const until=async(f:()=>boolean)=>{for(let n=0;n<300;n++){if(f())return;await new Promise(r=>setTimeout(r,5));}throw Error('first_launch_wait_timeout');};
function setup(){
 const root=resolve('.codex/scratch/first-launch-tests');mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'isolated-')),home=join(dir,'codex');
 const config:Config={appData:dir,workspace:join(dir,'workspace'),runtime:join(dir,'runtime'),nativeCodexHome:home,codexHome:home,codexBin:'/usr/bin/false',model:'synthetic',requiresOpenaiAuth:true,stopGraceMs:100};
 for(const p of [config.workspace,config.runtime,home])mkdirSync(p,{recursive:true});
 let connected=true,turns:string[]=[],app:Homer,behavior:((text:string)=>Promise<TurnResult>)|undefined;
 class Peer extends EventEmitter implements EngineLike{
  threadId='synthetic-first-launch';turnId?:string;resumable=true;
  async start(){return this.threadId;} async close(){return true;} async refreshCapabilities(){return {pending:false};} async interrupt(){app['mainApprovals'].end(app['mainContext']!.generation!.generationId);return true;}
  async request(method:string){
   if(method==='account/read'){return {account:connected?{type:'chatgpt'}:null};}
   if(method==='skills/list')return {data:[{skills:readdirSync(join(home,'skills')).filter(name=>existsSync(join(home,'skills',name,'SKILL.md'))).map(name=>({name,path:join(home,'skills',name,'SKILL.md'),enabled:true}))}]};
   return {};
  }
  async turn(text:string,options?:{onStarted?:(id:string)=>void}):Promise<TurnResult>{
   this.turnId='synthetic-turn-'+(turns.length+1);options?.onStarted?.(this.turnId);turns.push(text);
   return behavior?behavior(text):{status:'completed',text:'Synthetic check: desktop permission missing; no install attempted.'};
  }
 }
 const acceptLegacy=(phase:'queued'|'processing'|'uncertain'|'completed'='queued')=>{
  const skill=join(home,'skills/homer-initialize');
  mkdirSync(skill,{recursive:true});writeFileSync(join(skill,'SKILL.md'),'Legacy method.');
  app.store.setMeta('firstLaunchRequestId',legacyId);
  const receipt=app.inputs.accept({requestId:legacyId,text:automatic});
  if(phase!=='queued'){
   const claimed=app.inputs.claim()!;
   assert.equal(claimed.messageId,receipt.queueMessageId);
   if(phase==='uncertain')assert.equal(app.inputs.uncertain(claimed.messageId,claimed.revision),true);
   if(phase==='completed')app.inputs.finish(claimed.messageId,claimed.revision,'completed');
  }
  app.store.db.prepare("UPDATE agent_messages SET payloadJson=json_set(payloadJson,'$.source','first_launch') WHERE id=?").run(receipt.queueMessageId!);
  return receipt;
 };
 const open=async()=>{app=new Homer(config,async()=>{},()=>new Peer());await app.start();return app;};
 return {dir,home,config,open,acceptLegacy,get app(){return app;},get turns(){return turns;},set connected(v:boolean){connected=v;},set behavior(v:typeof behavior){behavior=v;},cleanup:async()=>{await app?.close();rmSync(dir,{recursive:true,force:true});}};
}
for(const connected of [false,true])test('fresh profile has no model turn at startup, connection or restart: '+connected,async()=>{
 const s=setup();s.connected=connected;
 try{
  await s.open();await s.app.idle();
  assert.deepEqual(s.turns,[]);
  assert.deepEqual(readTestConversation(s.app).messages,[]);
  assert.equal(s.app.store.meta('firstLaunchRequestId'),undefined);
  s.connected=true;
  (s.app['main'] as unknown as EventEmitter).emit('accountLoginCompleted',{success:true});
  await s.app.idle();
  await s.app.close();await s.open();await s.app.idle();
  assert.deepEqual(s.turns,[]);
  assert.deepEqual(readdirSync(join(s.home,'skills')).sort(),['homer-archive-review','homer-feedback','homer-tool-management']);
  await s.app.message('完成我的实际任务','real-task');
  assert.deepEqual(s.turns,['完成我的实际任务']);
 }finally{await s.cleanup();}
});

test('a legacy marker without an accepted input does not dispatch after restart',async()=>{
 const s=setup();s.connected=false;
 try{
  await s.open();await s.app.idle();
  s.app.store.setMeta('firstLaunchRequestId',legacyId);
  // A real old profile may still have the obsolete Skill on disk.
  const legacySkill=join(s.home,'skills/homer-initialize');
  mkdirSync(legacySkill,{recursive:true});writeFileSync(join(legacySkill,'SKILL.md'),'Legacy method.');
  await s.app.close();s.connected=true;await s.open();await s.app.idle();
  assert.deepEqual(s.turns,[]);
  assert.deepEqual(s.app.inputs.list(),[]);
  assert.equal(readFileSync(join(legacySkill,'SKILL.md'),'utf8'),'Legacy method.');
 }finally{await s.cleanup();}
});

test('restarting an existing profile preserves user Skill edits and removals',async()=>{
 const s=setup();try{
  await s.open();await s.app.idle();
  const path=join(s.home,'skills/homer-feedback/SKILL.md');
  writeFileSync(path,'User maintained Skill.');
  rmSync(join(s.home,'skills/homer-tool-management'),{recursive:true});
  await s.app.close();await s.open();await s.app.idle();
  assert.equal(readFileSync(path,'utf8'),'User maintained Skill.');
  assert.equal(existsSync(join(s.home,'skills/homer-tool-management')),false);
  await s.app.message('执行普通任务','real-task');
  assert.deepEqual(s.turns,['执行普通任务']);
 }finally{await s.cleanup();}
});

for(const phase of ['queued','processing','uncertain','completed'] as const)test('legacy '+phase+' receipt retains its source and recovers once across restarts',async()=>{
 const s=setup();try{
  await s.open();await s.app.idle();const receipt=s.acceptLegacy(phase);
  const real={requestId:'real-after-legacy',text:'请完成实际任务'};
  s.app.inputs.accept(real);
  await s.app.close();await s.open();await s.app.idle();
  assert.deepEqual(s.turns,[real.text]);
  const history=s.app.history.inputs(s.app.store.meta('mainThread')!,[legacyId,real.requestId]);
  assert.equal(history.size,2);
  const legacy=s.app.inputs.list().filter(i=>i.input.requestId===legacyId);
  assert.equal(legacy.length,1);
  assert.equal(legacy[0]!.source,'first_launch');
  assert.equal(legacy[0]!.state,phase==='queued'?'cancelled':phase==='processing'?'uncertain':phase);
  assert.equal(legacy[0]!.messageId,receipt.queueMessageId);
  assert.equal(legacy[0]!.replyId,receipt.replyId);
  assert.equal(history.get(legacyId)?.text,automatic);
  if(phase==='queued')assert.equal(history.get(legacyId)?.status,'cancelled');
  const turns=[...s.turns];
  await s.app.close();await s.open();await s.app.idle();
  assert.deepEqual(s.turns,turns);
  assert.deepEqual(s.app.inputs.list().filter(i=>i.input.requestId===legacyId),legacy);
 }finally{await s.cleanup();}
});

test('a legacy pending receipt with earlier claim evidence cannot dispatch or interrupt',async()=>{
 const s=setup();try{
  await s.open();await s.app.idle();const receipt=s.acceptLegacy('processing');
  const db=s.app.store.db;
  // Keep the original request written by claim, even if the queue looks pending.
  db.prepare("UPDATE agent_receipts SET state='pending' WHERE messageId=?").run(receipt.queueMessageId!);
  db.prepare("UPDATE conversation_messages SET status='queued' WHERE requestId=?").run(legacyId);
  db.prepare("UPDATE agent_messages SET payloadJson=json_set(payloadJson,'$.interruptState','requested') WHERE id=?").run(receipt.queueMessageId!);
  const [before]=s.app.inputs.byRequestIds([legacyId]);
  await s.app.close();await s.open();await s.app.idle();
  assert.deepEqual(s.app.inputs.byRequestIds([legacyId]),[before]);
  assert.deepEqual(s.app.inputs.pendingInterrupts(),[]);
  await s.app.message('确认真实消息可以办理','real-task');
  assert.deepEqual(s.turns,['确认真实消息可以办理']);
 }finally{await s.cleanup();}
});

for(const decision of ['approve','deny','stop'] as const)test('ordinary user request uses exact approval, '+decision+' and new-message path',async()=>{
 const s=setup(),requestId='install-sample',task='Install sample plugin';let calls=0;try{
  s.behavior=async text=>{
   if(!text.startsWith(task))return {status:'completed',text:'Real task handled.'};
   const context=s.app['mainContext']!.generation!;
   const result=await s.app['openMainNativeInteraction']({method:'mcpServer/elicitation/request',
    requestId:'exact-plugin-install',threadId:context.threadId,turnId:context.turnId,itemId:'synthetic-install',
    kind:'authorization',details:{serverName:'codex_apps',message:'Install sample',
      _meta:{codex_approval_kind:'tool_suggestion',tool_id:'sample@synthetic'}}});
   return {status:'completed',text:'Synthetic approval '+result.status};
  };
  // Main model execution remains fake; the real Homer approval/receipt path runs.
  await s.open();await s.app.idle();
  s.app['nativeRpc']=async(method:string)=>{
   if(method==='config/read')return {layers:[{name:{type:'user',file:s.home+'/config.toml'},version:'synthetic-v1',config:{}}]};
   if(method==='skills/list')return {data:[]};
   if(method==='plugin/list')return {marketplaces:[{name:'synthetic',path:s.home+'/market.json',plugins:[{name:'sample',id:'sample@synthetic'}]}]};
   if(method==='plugin/read')return {plugin:{summary:{id:'sample@synthetic',name:'sample',version:'1.0',installed:false,source:{type:'local',path:s.home+'/market/sample'}},skills:[{name:'sample'}],hooks:[],apps:[],mcpServers:[]}};
   if(method==='plugin/install'){calls++;return {authPolicy:'ON_USE',appsNeedingAuth:[]};}return {};
  };
  s.app.submitMessage({requestId,text:task});
  await until(()=>s.app.interactions.list().some(i=>i.state==='pending_user'));
  const pending=s.app.interactions.list().find(i=>i.state==='pending_user')!;
  assert.equal(calls,0);assert.equal(s.app.conversationControlState().generation?.sourceRequestId,requestId);
  assert.throws(()=>s.app.interactions.respond(pending.id,{action:'approve',reason:'model auto-approves'},{userMessageId:'forged'}),/main_native_user_decision_required/);
  s.app.submitMessage({requestId:'later-real-task',text:'新的实际任务'});
  if(decision==='stop')await s.app.stopMain(s.app.conversationControlState().activeMessageId!);
  else s.app.submitMessage({requestId:'human-exact-decision',text:decision==='approve'?'允许本次操作':'拒绝本次操作',interactionId:pending.id});
  await s.app.idle();assert.equal(calls,decision==='approve'?1:0);assert.ok(s.turns.some(text=>text.startsWith('新的实际任务')));assert.ok(!s.turns.some(text=>text.startsWith('[宿主续接')));assert.equal(s.app.store.meta('mainThread'),'synthetic-first-launch');
 }finally{await s.cleanup();}
});

test('custom runtime sharing native HOME does not preinstall Skills',async()=>{
 const s=setup();s.config.runtime=join(s.dir,'custom-runtime');mkdirSync(s.config.runtime);try{await s.open();await s.app.idle();assert.equal(s.turns.length,0);assert.equal(s.app.store.meta('firstLaunchRequestId'),undefined);assert.equal(existsSync(join(s.home,'skills')),false);}finally{await s.cleanup();}
});

test('completed legacy history cannot authorize new work',async()=>{
 const s=setup();try{
  await s.open();await s.app.idle();s.acceptLegacy('completed');
  await s.app.close();await s.open();await s.app.idle();
  assert.deepEqual(s.turns,[]);
  const actor=s.app['mainActor'](true);
  assert.throws(()=>s.app.tasks.source(actor,legacyId),/task_authority_source_denied/);
  assert.equal(s.app.store.runs().length,0);
 }finally{await s.cleanup();}
});
