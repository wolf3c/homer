// Component fixtures call production routing methods without starting a Homer service.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Homer} from '../src/service.js';
import {EngineRpcUnconfirmed} from '../src/engine.js';
import {nativeInteraction} from '../src/worker-interaction-protocol.js';
import {approvalDecision, MainNativeApprovals} from '../src/main-native-approvals.js';
import {WorkerInteractions} from '../src/worker-interactions.js';
import {ConversationHistory} from '../src/web-history.js';
import {homerWebBridge} from '../src/web-homer.js';
import {fixture,running} from './recursive-fixture.js';
const until=async(f:()=>boolean)=>{for(let n=0;n<100;n++){if(f())return;await new Promise(r=>setTimeout(r,1));}throw Error('fixture_wait');};
function setup(){
 const f=fixture('.codex/scratch/mcp-routing'),interactions=new WorkerInteractions(f.store.db),history=new ConversationHistory(f.store.db),approvals=new MainNativeApprovals(interactions,history),host:any=Object.create(Homer.prototype);
 const generation={threadId:'thread:synthetic-main',turnId:'turn',generationId:'generation',sourceRequestId:'user-synthetic'},context={generation,userText:'Synthetic authorization'},config={codexHome:f.dir,nativeCodexHome:f.dir};
 Object.assign(host,{config,store:f.store,tasks:f.tasks,files:f.files,interactions,history,mainApprovals:approvals,mainContext:context,main:{threadId:'thread:synthetic-main',turnId:'turn'},workers:new Map(),hostActors:new WeakSet(),nativeRevision:0,validateMainContext(){},protectedExecutionPaths:()=>[],registerWebSurface(){}});
 f.store.setMeta('mainThread','thread:synthetic-main');
 return {...f,interactions,history,approvals,host,context};
}
for(const serverName of ['arbitrary-alpha','任意服务乙'])test('main production routing and Web projections retain user-only MCP controls: '+serverName,async()=>{
 const f=setup();try{
  for(const [id,text,want] of [[1,'允许本次操作','approved'],['1','拒绝本次操作','denied'],[3,'取消本次请求','cancelled']] as const){
   const native={...nativeInteraction('mcpServer/elicitation/request',{threadId:'thread:synthetic-main',turnId:'turn',serverName,mode:'form',message:'Review target',requestedSchema:{type:'object',properties:{}},_meta:{codex_approval_kind:'mcp_tool_call',tool_params:{recipient:'alice',authorization:'SENSITIVE_SENTINEL'}}})!,requestId:id,isCurrent:()=>true};
   const response=f.host.openMainNativeInteraction(native),item=f.interactions.list().find(i=>i.state==='pending_user')!;
   const bridge=homerWebBridge(f.host),card=(await bridge.history!.interactions(0)).items.find(i=>i.id===item.id)!;assert.equal(card.canCancel,true);assert.equal(card.workTitle,'主对话');assert.match(card.question,/alice/);assert.doesNotMatch(JSON.stringify(card),/SENSITIVE_SENTINEL|tool_params/);
   f.approvals.respond(item.id,{requestId:'decision-'+typeof id+id,text});assert.equal((await response).status,want);
  }
 }finally{f.close();}
});
test('Worker native projection resolves its actual task title, never main',async()=>{
 const f=setup();try{
  const worker=f.tasks.workerOpen({agentId:f.store.meta('mainAgentId')!,threadId:'thread:synthetic-main',sourceRequestId:'user-synthetic'},{operationId:'open-native',taskId:f.task.taskId,text:'Inspect synthetic'}),actor=running(f,worker.runId);f.store.db.prepare('UPDATE tasks SET title=? WHERE id=?').run('Actual Worker title',f.tasks.run(actor.runId!).taskId);
  const native={...nativeInteraction('mcpServer/elicitation/request',{threadId:actor.threadId,turnId:actor.turnId,serverName:'any',mode:'form',message:'Review',requestedSchema:{type:'object',properties:{}},_meta:{codex_approval_kind:'mcp_tool_call'}})!,requestId:1};
  const opened=f.approvals.open(native,{threadId:native.threadId,turnId:native.turnId,generationId:'worker-native:'+actor.runId,sourceRequestId:'user-synthetic',userText:'Synthetic',isCurrent:()=>true,historyThreadId:'thread:synthetic-main'});
  const cards=(await homerWebBridge(f.host).history!.interactions(0)).items;assert.equal(cards[0]!.workTitle,'Actual Worker title');assert.equal(cards[0]!.canCancel,true);f.approvals.end('worker-native:'+actor.runId);await opened.response;
 }finally{f.close();}
});
for(const role of ['main','worker'])for(const outcome of ['approve','deny','expire','cancel','unknown','lost-installed','changed'])test('native plugin '+role+' '+outcome+' keeps the installer and real status',async()=>{
 const f=setup();let installs=0;try{
  let installed=false,reads=0;
  f.host.nativeRpc=async(method:string,params:any)=>{
   if(method==='plugin/list'){if(role==='worker')assert.deepEqual(params.cwds,[f.dir]);return{marketplaces:[{name:'synthetic',path:f.dir+'/market.json',plugins:[{id:'sample@synthetic',name:'sample'}]}]};}
   if(method==='config/read')return{layers:[{name:{type:'user',file:f.dir+'/config.toml'},version:'1',config:{}}]};
   if(method==='skills/list')return{data:[]};
   if(method==='plugin/read')return{plugin:{summary:{id:'sample@synthetic',name:'sample',version:outcome==='changed'&&++reads>1?'2':'1',installed,source:{type:'local',path:f.dir+'/sample'}},skills:[],hooks:[],apps:[],mcpServers:[]}};
   if(method==='plugin/install'){installs++;if(outcome==='unknown')throw new EngineRpcUnconfirmed('engine_disconnected');installed=true;if(outcome==='lost-installed')throw new EngineRpcUnconfirmed('engine_disconnected');return{authPolicy:'ON_USE',appsNeedingAuth:[]};}return{};
  };
  const run=role==='worker'?f.tasks.workerOpen({agentId:f.store.meta('mainAgentId')!,threadId:'thread:synthetic-main',sourceRequestId:'user-synthetic'},{operationId:'plugin-worker',taskId:f.task.taskId,text:'Inspect plugin'}):undefined;
  if(run)running(f,run.runId);
  const worker=run?{id:run.runId,requests:new Map(),engine:{threadId:'child',turnId:'child-turn'}}:undefined;
  if(worker){f.host.liveNativeInteraction=()=>true;f.host.liveInteraction=()=>true;f.host.pauseClock=()=>{};f.host.resumeClock=()=>{};}
  const params={threadId:worker?'child':'thread:synthetic-main',turnId:worker?'child-turn':'turn',serverName:'codex_apps',mode:'form',message:'Install reviewed plugin',requestedSchema:{type:'object',properties:{}},_meta:{codex_approval_kind:'tool_suggestion',tool_type:'plugin',suggest_type:'install',tool_id:'sample@synthetic'}};
  const native={...nativeInteraction('mcpServer/elicitation/request',params)!,requestId:1,isCurrent:()=>true};
  const response=worker?f.host.openNativePluginInteraction(native,worker,f.dir):f.host.openMainNativeInteraction(native);
  void response.catch(()=>{});
  await until(()=>f.interactions.list().length>0);
  const pending=f.interactions.list()[0]!;assert.equal(installs,0);
  if(worker){
   assert.equal(pending.state,'pending_main');
   const item=f.interactions.inspect(pending.id);
   f.interactions.escalate(pending.id,String(item.details.review),String(item.details.reviewReason));
  }
  const card=(await homerWebBridge(f.host).history!.interactions(0)).items.find(i=>i.id===pending.id)!;assert.equal(card.canCancel,undefined);
  if(outcome==='expire')f.interactions.expire(pending.id,'capability_approval_timeout');
  else if(outcome==='cancel')f.interactions.cancelRun(pending.runId,'worker_stopped');
  else {
   const input={requestId:'actual-user',text:outcome==='deny'?'拒绝本次操作':'允许本次操作'};
   if(worker){
    const decision=approvalDecision(f.interactions.inspect(pending.id),input);
    f.store.transaction(()=>f.interactions.recordUserDecision(pending.id,decision,input.requestId,input.text));
    assert.equal(installs,0);
    f.interactions.respond(pending.id,decision,{userMessageId:input.requestId,userText:input.text});
   }else f.approvals.respond(pending.id,input);
  }
  if(outcome==='unknown'||outcome==='changed'){
   await assert.rejects(response,outcome==='unknown'?/capability_plugin_install_unconfirmed/:/capability_plugin_review_conflict/);
   assert.equal(installs,outcome==='unknown'?1:0);return;
  }
  const didInstall=outcome==='approve'||outcome==='lost-installed';
  const result=await response;assert.equal(result.status,didInstall?'approved':outcome==='deny'?'denied':outcome==='expire'?'expired':'cancelled');assert.equal(installs,didInstall?1:0);if(['expire','cancel'].includes(outcome))assert.equal(result.decision,undefined);
 }finally{f.close();}
});

test('main plugin request cleared during asynchronous lookup cannot open installation approval',async()=>{
 const f=setup();let current=true;try{
  f.host.nativeRpc=async(method:string)=>{
   if(method==='plugin/list'){current=false;return {marketplaces:[{name:'synthetic',plugins:[{id:'sample@synthetic',name:'sample'}]}]};}
   return {plugin:{summary:{id:'sample@synthetic'}}};
  };
  const native={...nativeInteraction('mcpServer/elicitation/request',{threadId:'thread:synthetic-main',turnId:'turn',serverName:'codex_apps',mode:'form',message:'Install',requestedSchema:{type:'object',properties:{}},_meta:{codex_approval_kind:'tool_suggestion',tool_type:'plugin',suggest_type:'install',tool_id:'sample@synthetic'}})!,requestId:1,isCurrent:()=>current};
  await assert.rejects(()=>f.host.openMainNativeInteraction(native),/interaction_not_live/);assert.equal(f.interactions.list().length,0);
 }finally{f.close();}
});
