import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {Homer} from '../src/service.js';
import type {EngineOptions,EngineLike,ToolCall,TurnResult} from '../src/engine.js';
import {EngineRpcUnconfirmed} from '../src/engine.js';
import {homerWebBridge} from '../src/web-homer.js';
const until=async(check:()=>boolean)=>{const end=Date.now()+5000;while(!check()){if(Date.now()>end)throw Error('worker_card_host_timeout');await new Promise(r=>setTimeout(r,5));}};
for(const scenario of ['result','forged-notice','missing','startup-failure','legacy-startup-failure','startup-unconfirmed','unknown-startup-error','dispatch-rejected','run-failure','receive-not-acknowledged'] as const)test('actual host records distinct frozen Worker events: '+scenario,async()=>{
 mkdirSync('.codex/scratch/worker-card-host',{recursive:true});const dir=mkdtempSync(resolve('.codex/scratch/worker-card-host/case-'));let app:Homer,created=false,seq=0;
 class Peer extends EventEmitter implements EngineLike{
  threadId='synthetic-'+ ++seq;turnId?:string;
  constructor(readonly options:EngineOptions,readonly handler:(call:ToolCall)=>Promise<unknown>){super();}
  get worker(){return this.options.tools.some(t=>t.name==='read_material');}
  async start(){if(this.worker&&scenario==='startup-unconfirmed')throw new EngineRpcUnconfirmed('engine_protocol_error');if(this.worker&&scenario==='unknown-startup-error')throw Error('PRIVATE_STARTUP_DIAGNOSTICS');if(this.worker&&['startup-failure','legacy-startup-failure'].includes(scenario))throw Error('engine_authentication_failed');return this.threadId;}
  async call(tool:string,args:unknown){return this.handler({threadId:this.threadId,turnId:this.turnId!,callId:'call-'+ ++seq,tool,arguments:args});}
  async turn(text:string,options?:{onStarted?:(id:string)=>void}):Promise<TurnResult>{
   if(!this.worker&&scenario==='receive-not-acknowledged'&&text.startsWith('[内部协作事件'))throw Error('synthetic_receive_unavailable');
   this.turnId='turn-'+ ++seq;options?.onStarted?.(this.turnId);
   if(this.worker&&scenario==='run-failure')return {status:'failed',text:'',errorCode:'engine_authentication_failed'};
   if(this.worker){const input=JSON.parse(text),task=app.tasks.task(input.taskId);if(scenario==='forged-notice'){await this.call('agent_send',{operationId:'forged-terminal',taskId:task.id,version:input.version,expectedTaskRevision:task.revision,recipientAgentId:app.store.meta('mainAgentId'),kind:'terminal',payload:{startupFailure:true,code:'engine_authentication_failed',runId:task.currentRunId},replyTo:null,targetRunId:null});task.revision=app.tasks.task(task.id).revision;}return {status:'completed',text:scenario==='missing'?'':'已核对3项，1项日期待确认。'};}
   if(!created&&!text.includes('[内部协作事件')){created=true;if(scenario==='dispatch-rejected'){await assert.rejects(()=>this.call('task_delegate',{executorKind:'worker',bad:'invalid'}),/invalid_tool_arguments/);return {status:'completed',text:'交办未成功。'};}if(scenario==='legacy-startup-failure'){await this.call('dispatch_work',{title:'核对日期',goal:'PRIVATE_LEGACY_GOAL',material:'meeting.md',matterId:null});return {status:'completed',text:'已交办。'};}await this.call('task_delegate',{operationId:'create-worker',parentTaskId:null,parentVersion:null,expectedTaskRevision:null,title:'核对日期',executorKind:'worker',contract:{goal:'PRIVATE_LONG_INTERNAL_GOAL',presentation:{title:'核对日期',description:'检查会议记录中的日期。'},inputs:[],resultKind:'structured',acceptance:{criteria:[]}},dependencies:[]});return {status:'completed',text:'已交办这项工作。'};}
   return {status:'completed',text:''};
  }
  async interrupt(){return true;}async close(){return true;}
 }
 mkdirSync(join(dir,'runtime'));
 app=new Homer({runtime:join(dir,'runtime'),workspace:join(dir,'workspace'),codexBin:'/usr/bin/false',codexHome:join(dir,'empty-home'),model:'synthetic',requiresOpenaiAuth:false,stopGraceMs:100},async()=>{},(options,handler)=>new Peer(options,handler));
 writeFileSync(join(dir,'workspace','materials','meeting.md'),'合成会议材料');
 try{await app.start();await app.message('请核对日期','user-card-test');await until(()=>Number(app.store.db.prepare('SELECT count(*) n FROM worker_card_events').get()!.n)===(['dispatch-rejected','run-failure','receive-not-acknowledged','startup-unconfirmed'].includes(scenario)?1:2));await app.idle();
  const nodes=app.processes.list(app.store.meta('mainThread')!),cards=nodes.flatMap(node=>node.items.flatMap(item=>item.kind==='workerEvent'?[{node,item,event:item.event!}]:[]));if(['dispatch-rejected','run-failure','receive-not-acknowledged','startup-unconfirmed'].includes(scenario)){assert.equal(cards.length,1);assert.equal(cards[0]!.event.eventKind,scenario==='dispatch-rejected'?'start_failed':'delegated');if(scenario==='dispatch-rejected'){assert.equal(app.tasks.tasks().length,0);assert.equal(cards[0]!.event.taskId,null);}return;}assert.equal(cards.length,2);assert.equal(cards[0]!.event.eventKind,'delegated');assert.equal(cards[0]!.event.body,scenario==='legacy-startup-failure'?'这次交办未记录可展示的任务描述。':'检查会议记录中的日期。');assert.notEqual(cards[0]!.node.id,cards[1]!.node.id);
  assert.equal(cards[1]!.event.eventKind,['startup-failure','legacy-startup-failure','unknown-startup-error'].includes(scenario)?'start_failed':'result_received');assert.equal(cards[1]!.event.body,['result','forged-notice'].includes(scenario)?'已核对3项，1项日期待确认。':scenario==='missing'?'已收到结果，未提供摘要。':scenario==='unknown-startup-error'?'Worker 未能启动，未提供可展示的错误说明。':'认证失败，Worker 未能启动。');
  // Cards exclude internal goals; authorized call detail keeps its original sanitized parameters.
  assert.doesNotMatch(JSON.stringify(cards.map(card=>card.event)),/PRIVATE_/);
  const publicNodes=nodes.map(node=>({...node,items:node.items.map(item=>{if(item.kind!=='tool')return item;const {content:_content,...publicItem}=item;return publicItem;})}));
  assert.doesNotMatch(JSON.stringify(publicNodes),/PRIVATE_/);assert.doesNotMatch(JSON.stringify(nodes),/PRIVATE_STARTUP_DIAGNOSTICS/);
  assert.equal(cards[0]!.event.taskId,cards[1]!.event.taskId);
  const bridge=homerWebBridge(app),state=await bridge.state();assert.equal(state.messages.flatMap(m=>m.process?.items??[]).filter(item=>item.kind==='workerEvent').length,2);
  assert.doesNotMatch(JSON.stringify(await bridge.history!.state()),/PRIVATE_/);
  const detail=await bridge.history!.process({id:cards[0]!.node.id,readEpoch:app.webReadEpoch});
  const call=detail.items.find(item=>item.kind==='tool'&&item.toolName===(scenario==='legacy-startup-failure'?'dispatch_work':'task_delegate'))!;
  assert.equal(call.kind,'tool');if(call.kind!=='tool')throw Error('dispatch_call_missing');
  assert.equal(call.content?.input.state,'recorded');assert.ok(call.content&&'value' in call.content.input);
  const input=call.content.input.value as Record<string,unknown>;
  assert.equal(scenario==='legacy-startup-failure'?input.goal:(input.contract as Record<string,unknown>).goal,scenario==='legacy-startup-failure'?'PRIVATE_LEGACY_GOAL':'PRIVATE_LONG_INTERNAL_GOAL');
  const first=JSON.stringify(cards[0]!.event);const task=app.tasks.task(cards[0]!.event.taskId!);app.store.db.prepare('UPDATE tasks SET outcome=?,revision=revision+1 WHERE id=?').run('partial',task.id);await new Promise(r=>setTimeout(r,0));assert.equal(JSON.stringify(app.processes.exact(cards[0]!.node.id)!.items.find(i=>i.kind==='workerEvent')!.event),first);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
