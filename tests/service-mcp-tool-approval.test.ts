// Isolated service fixtures: synthetic RPCs and synthetic user receipts, no native execution.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdirSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {processIdentity} from '../src/processes.js';
import {Homer} from '../src/service.js';
import {homerWebBridge} from '../src/web-homer.js';
import {nativeInteraction,nativeResponse} from '../src/worker-interaction-protocol.js';
import type {EngineOptions,ToolCall} from '../src/engine.js';
const until=async(check:()=>boolean,label='synthetic MCP wait')=>{const end=Date.now()+6000;while(!check()){assert.ok(Date.now()<end,label);await new Promise(r=>setTimeout(r,5));}};
for(const serverName of ['arbitrary-alpha','任意服务乙'])test('main and Worker ordinary MCP route once through user cards: '+serverName,{skip:!processIdentity(process.pid)?'environment: process_identity_unavailable':false},async()=>{
 mkdirSync('.codex/scratch',{recursive:true});const dir=mkdtempSync(resolve('.codex/scratch/mcp-user-')),home=join(dir,'home'),workspace=join(dir,'workspace');mkdirSync(join(workspace,'materials'),{recursive:true});writeFileSync(join(workspace,'materials/input.md'),'Synthetic');
 const config={workspace,runtime:join(dir,'runtime'),codexHome:home,nativeCodexHome:home,codexBin:'/usr/bin/false',model:'synthetic',requiresOpenaiAuth:false,timeoutMs:10000,mainTimeoutMs:10000,stopGraceMs:100};
 mkdirSync(config.runtime,{recursive:true});mkdirSync(home,{recursive:true});
 const actions=['允许本次操作','拒绝本次操作','取消本次请求'],wire:any[]=[],outcomes:string[]=[];let serial=0,turns=0;
 class Peer extends EventEmitter{
  threadId:string;turnId='';resumable=true;
  constructor(readonly options:EngineOptions,readonly handler:(call:ToolCall)=>Promise<unknown>){super();this.threadId=options.threadId??'thread-'+ ++serial;}
  async start(){return this.threadId;}async close(){return true;}async interrupt(){return true;}
  async call(tool:string,args:unknown){const callId='call-'+ ++serial,result=await this.handler({threadId:this.threadId,turnId:this.turnId,callId,tool,arguments:args});this.emit('toolResponse',callId);return result;}
  async turn(text:string,o?:{onStarted?:(id:string)=>void}){
   this.turnId='turn-'+ ++serial;o?.onStarted?.(this.turnId);
   const context=app['mainContext'],id=context?.interactionId??context?.queuedInput?.input.interactionId;
   if(this.options.nativeTools==='main'&&id){
    await this.call('inspect_interaction',{interactionId:id});
    if(context?.event)await this.call('escalate_interaction',{interactionId:id,question:'Confirm the synthetic operation',reason:'Requires user confirmation'});
    else await this.call('respond_interaction',{interactionId:id,action:context?.queuedInput?.input.text==='允许本次操作'?'approve':'deny',reason:'Use the actual decision'});
    return {status:'completed',text:'Synthetic decision recorded'};
   }
   if(text==='check MCP'||this.options.nativeTools==='worker'){
    turns++;
    for(const id of [1,'1',3]){
     const p={threadId:this.threadId,turnId:this.turnId,mode:'form',serverName,message:'Review this exact operation',requestedSchema:{type:'object',properties:{}},_meta:{codex_approval_kind:'mcp_tool_call',tool_params:{recipient:'alice',token:'SENSITIVE_SENTINEL'}}};
     const request={...nativeInteraction('mcpServer/elicitation/request',p)!,requestId:id,isCurrent:()=>true};
     const result=await this.options.onInteraction!(request);outcomes.push(result.status);wire.push({role:this.options.nativeTools,id,result:nativeResponse(request,result.decision!)});this.emit('interactionDelivered',id);
    }
    if(this.options.nativeTools==='main')await this.call('worker_open',{message:'Actual Worker title\nValidate the synthetic MCP interactions.'});
   }
   return{status:'completed',text:'Synthetic result'};
  }
 }
 const app=new Homer(config,async()=>{},(o,h)=>new Peer(o,h));
 try{
  await app.start();app.submitMessage({requestId:'source',text:'check MCP'});const bridge=homerWebBridge(app);
  for(let n=0;n<6;n++){
   await until(()=>app.interactions.list().some(i=>i.state==='pending_user'),'pending MCP card '+n);
   const item=app.interactions.inspect(app.interactions.list().find(i=>i.state==='pending_user')!.id);
   for(const projected of [(await bridge.state()).interactions,(await bridge.history!.state()).interactions,(await bridge.history!.interactions(0)).items]){
    const card=projected.find(i=>i.id===item.id)!;assert.equal(card.canCancel,true);assert.equal(card.workTitle,n<3?'主对话':'Actual Worker title');assert.doesNotMatch(JSON.stringify(card),/SENSITIVE_SENTINEL|tool_params/);assert.match(card.question,/alice/);
   }
   assert.throws(()=>app.interactions.respond(item.id,{action:'approve',reason:'forged'},{userMessageId:'forged'}),/interaction_user_decision_required|main_native_user_decision_required/);
   await bridge.respond(item.id,{requestId:'user-'+n,text:actions[n%3]!});await until(()=>outcomes.length>n);
  }
  await app.idle();assert.equal(turns,2);assert.deepEqual(outcomes,['approved','denied','cancelled','approved','denied','cancelled']);
  assert.deepEqual(wire.map(w=>[w.role,w.id,w.result]),['main','worker'].flatMap(role=>[{role,id:1,action:'accept'},{role,id:'1',action:'decline'},{role,id:3,action:'cancel'}].map(v=>[v.role,v.id,{action:v.action,content:null,_meta:null}])));
  const cancelled=(await bridge.state()).inactiveInteractions!.filter(i=>i.code==='interaction_user_cancelled');assert.equal(cancelled.length,2);
  assert.doesNotMatch(JSON.stringify(app.store.db.prepare('SELECT * FROM events').all()),/SENSITIVE_SENTINEL|Review this exact operation/);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
