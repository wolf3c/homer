// Requirements-derived synthetic engine through Homer, its real main/MCP/input
// and internal result paths. No Codex process, account or external sink.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createConnection } from 'node:net';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { MediaStore } from '../src/media-store.js';
import { Homer, type Message } from '../src/service.js';
import type { EngineLike, EngineOptions, ToolCall, TurnResult } from '../src/engine.js';
import type { Config } from '../src/config.js';
const until=async(check:()=>boolean)=>{const end=Date.now()+5000;while(!check()){if(Date.now()>end)throw Error('pending_host_timeout');await new Promise(r=>setTimeout(r,5));}};
const c=(goal:string)=>({goal,inputs:[],resultKind:'structured',acceptance:{criteria:[]}});
const rootArgs=(operationId:string,goal:string,kind='main')=>({operationId,parentTaskId:null,parentVersion:null,expectedTaskRevision:null,title:goal,executorKind:kind,contract:c(goal),dependencies:[]});
function fixture(choice:'repair'|'defer'|'close', emptyEventReply = false, emptyUserReply = false, failedEventReply = false){
 const scratch=resolve('.codex/scratch/main-pending-implementation');mkdirSync(scratch,{recursive:true});const base=mkdtempSync(join(scratch,'host-'));
 const config:Config={workspace:join(base,'workspace'),runtime:join(base,'runtime'),codexHome:join(base,'engine'),codexBin:'/usr/bin/false',model:'synthetic-only',requiresOpenaiAuth:false,timeoutMs:60000,mainTimeoutMs:10000,stopGraceMs:100};
 for(const path of [config.runtime,config.workspace,config.codexHome])mkdirSync(path,{recursive:true});
 const events:Message[]=[],seen:string[]=[],errors:string[]=[];let seq=0,itemId='',initialTaskId='',failedChildId='',handled=false,release:()=>void=()=>{};
 class Fake extends EventEmitter implements EngineLike{
  threadId:string;turnId?:string;worker:boolean;finish?:()=>void;
  constructor(readonly options:EngineOptions,readonly handle:(call:ToolCall)=>Promise<unknown>){super();this.threadId=options.threadId??'pending-main';this.worker=options.tools.some(t=>t.name==='read_material');if(this.worker)this.threadId='pending-worker-'+ ++seq;}
  async start(){return this.threadId;}
  async call(tool:string,args:unknown):Promise<any>{return this.handle({threadId:this.threadId,turnId:this.turnId!,callId:'call-'+ ++seq,tool,arguments:args});}
  async mcp(tool:string,args:unknown):Promise<any>{
   const path=this.options.interactionMcp!.args.at(-1)!;
   return new Promise((done,reject)=>{const socket=createConnection(path);let buffer='';socket.on('connect',()=>socket.write(JSON.stringify({tool,arguments:args})+'\n'));socket.on('data',data=>buffer+=data);socket.on('error',reject);socket.on('end',()=>{const r=JSON.parse(buffer);r.error?reject(Error(r.error)):done(r.result);});});
  }
  async turn(text:string,options?:{onStarted?:(id:string)=>void}):Promise<TurnResult>{
   this.turnId='turn-'+ ++seq;options?.onStarted?.(this.turnId);
   try{
    if(this.worker){await new Promise<void>(r=>{this.finish=r;release=r;});return {status:'failed',text:'',errorCode:'synthetic_same_failure'};}
    seen.push(text);
    if(text.startsWith('开始原工作')){
     const root=await this.call('task_delegate',rootArgs('original','original'));initialTaskId=root.taskId;
     const task=app.tasks.task(initialTaskId);
     const child=await this.call('task_delegate',{...rootArgs('child','same failure','worker'),parentTaskId:task.id,parentVersion:1,expectedTaskRevision:task.revision});failedChildId=child.taskId;
    }else if(text.startsWith('先记下')){
     const row=await this.mcp('pending_add',{operationId:'remember',content:'稍后支持导出',relatedTaskId:failedChildId});itemId=row.id;
    }else if(text.startsWith('允许后续')){
     const row=await this.call('pending_list',{id:itemId});
     await this.call('pending_update',{operationId:'authorize',id:itemId,expectedRevision:row.items[0].revision,patch:{handlingNote:'用户明确允许后续处理'}});
    }else if(text.startsWith('[内部协作事件')){
     const inbox=await this.call('inbox_read',{after:0});
     for(const message of inbox){
      if(message.taskId===failedChildId&&!handled){
       const facts=await this.call('work_inspect',{taskId:failedChildId,runId:null,resultId:null});assert.equal(facts.task.outcome,'failed');
       assert.ok(text.includes(itemId),'relevant item must be discoverable without retained conversation');
       const latest=(await this.call('pending_list',{id:itemId})).items[0];
       if(choice==='repair'){
        // No current user Actor exists here. Legacy call still rejects.
        await assert.rejects(()=>this.call('task_delegate',rootArgs('illegal','illegal')),/dispatch_requires_user_message/);
        const pending={items:[{id:itemId,expectedRevision:latest.revision}],sourceRequestIds:['allow-followup'],primarySourceRequestId:'allow-followup'};
        const args={...rootArgs('repair','repair'),pending};
        const task=await this.call('task_delegate',args);assert.deepEqual(await this.call('task_delegate',args),task);
        assert.equal(app.tasks.authority(task.taskId,1).sourceRequestId,'allow-followup');
        const receipt=await this.mcp('pending_list',{operationId:'repair',operationScope:'pending_dispatch'});assert.equal(receipt.operation.response.taskId,task.taskId);
       }else await this.call('pending_update',{operationId:'decision',id:itemId,expectedRevision:latest.revision,patch:{handlingNote:choice==='defer'?'等待用户再决定':'结束关注',...(choice==='close'?{state:'closed'}:{})}});
       handled=true;
      }
      await this.call('inbox_ack',{operationId:'ack-'+message.id,messageId:message.id,disposition:'processed',reason:'synthetic examined',resultId:null});
     }
    }else if(text.startsWith('边界验证')){
     const latest=(await this.call('pending_list',{id:itemId})).items[0];
     const updated=await this.call('pending_update',{operationId:'add-source',id:itemId,expectedRevision:latest.revision,patch:{handlingNote:'explicit sources'},sourceRequestIds:['start']});
     const pending={items:[{id:itemId,expectedRevision:updated.revision}],sourceRequestIds:['allow-followup','remember','start'],primarySourceRequestId:'allow-followup'};
     const args={...rootArgs('scope-test','scope-test'),pending};
     await assert.rejects(()=>this.call('task_delegate',{...args,deliveryTarget:'new-target'}),/invalid_tool_arguments/);
     await assert.rejects(()=>this.call('task_delegate',{...args,pending:{...pending,sourceRequestIds:['unknown']}}),/source_denied/);
     for(const requestId of ['remember','start']){
      const row=app.store.db.prepare('SELECT refsJson FROM conversation_attachments WHERE requestId=?').get(requestId)!;
      const ref=JSON.parse(String(row.refsJson))[0];
      await assert.rejects(()=>this.call('task_delegate',{...args,contract:{...c('scope-test'),inputs:[{type:'attachment',id:ref.assetId+'@'+ref.revision}]}}),/task_authority_input_denied/);
     }
     const ref=JSON.parse(String(app.store.db.prepare("SELECT refsJson FROM conversation_attachments WHERE requestId='allow-followup'").get()!.refsJson))[0];
     const chosen=await this.call('task_delegate',{...args,contract:{...c('scope-test'),inputs:[{type:'attachment',id:ref.assetId+'@'+ref.revision}]}});
     const task=app.tasks.task(chosen.taskId),actor={agentId:app.store.meta('mainAgentId')!,threadId:this.threadId};
     const result=app.tasks.complete(actor,{operationId:'settle',taskId:task.id,version:1,expectedTaskRevision:task.revision,outcome:'failed',payload:{reason:'synthetic'},evidence:{},children:[]});
     const publish=await this.call('publish_delivery',{operationId:'publish',taskId:task.id,version:1,expectedTaskRevision:app.tasks.task(task.id).revision,resultId:result.resultId,text:'synthetic delivery',publishedFileResultId:null});
     assert.equal(app.tasks.delivery(publish.deliveryId).routeSourceRequestId,'allow-followup');
    }else if(text.startsWith('恢复后查询')){
     assert.ok(text.includes(itemId));const latest=await this.mcp('pending_list',{id:itemId});assert.equal(latest.items[0].id,itemId);
    }
    if(failedEventReply && text.startsWith('[内部协作事件'))return {status:'failed',text:'',errorCode:'synthetic_main_engine_failed'};
    return {status:'completed',text:(emptyEventReply && text.startsWith('[内部协作事件') || emptyUserReply && !text.startsWith('[内部协作事件')) ? '' : 'Synthetic reply'};
   }catch(error){errors.push(String(error));throw error;}
  }
  async interrupt(){this.finish?.();return true;}
  async close(){this.finish?.();return true;}
 }
 let app=new Homer(config,async m=>{events.push(m);},(o,h)=>new Fake(o,h));
 return {get app(){return app;},seen,events,errors,get itemId(){return itemId;},get childId(){return failedChildId;},get handled(){return handled;},release(){release();},async restart(){await app.close();app=new Homer(config,async m=>{events.push(m);},(o,h)=>new Fake(o,h));await app.start();},async close(){await app.close();rmSync(base,{recursive:true,force:true});}};
}
for(const choice of ['repair','defer','close'] as const)test('AC01/02/03/04/05/08 actual main path: same Worker failure, Agent selects '+choice,async()=>{
 const f=fixture(choice);try{
  await f.app.start();await f.app.message('开始原工作','start');await until(()=>f.app.snapshot().activeWorkers===1);
  const before=f.app.tasks.tasks().length;
  assert.equal(await f.app.message('先记下导出，不执行且不打断 Worker','remember'),'Synthetic reply');
  assert.ok(f.itemId);assert.equal(f.app.tasks.tasks().length,before);assert.equal(f.app.tasks.task(f.childId).headVersion,1);assert.equal(f.app.snapshot().activeWorkers,1);
  await f.app.message('允许后续根据实际结果自主处理导出需求','allow-followup');
  f.release();await until(()=>f.handled||f.errors.length>0);assert.deepEqual(f.errors,[]);await f.app.idle();
  const actor={agentId:f.app.store.meta('mainAgentId')!,threadId:f.app.store.meta('mainThread')!};
  const item=f.app.tasks.pending.list(actor,{id:f.itemId}).items[0]!;
  assert.equal(item.state,choice==='close'?'closed':'open');assert.equal(f.app.tasks.task(f.childId).outcome,'failed');
  assert.equal(f.app.tasks.tasks().length,before+(choice==='repair'?1:0));assert.equal(f.events.filter(m=>m.type==='delivery').length,0);
  const turns=f.seen.length;await new Promise(r=>setTimeout(r,60));assert.equal(f.seen.length,turns,'open alone must not wake main');
  if(choice==='defer'){
   await f.restart();await f.app.idle();const before=f.seen.length;assert.equal(before,turns,'restart does not wake for open items');
   await f.app.message('恢复后查询','after-restart');assert.deepEqual(f.errors,[]);assert.equal(f.seen.length,before+1);
  }
 }finally{await f.close();}
});

test('AC05/07 actual tool owner: chosen primary controls attachment scope and formal route; no new external target',async()=>{
 const f=fixture('defer');try{
  await f.app.start();await f.app.message('开始原工作','start');await until(()=>f.app.snapshot().activeWorkers===1);
  await f.app.message('先记下导出，不执行','remember');await f.app.message('允许后续处理','allow-followup');
  f.release();await until(()=>f.handled);await f.app.idle();
  const media=new MediaStore(f.app.store.db);
  for(const requestId of ['start','remember','allow-followup']){
   const ref=media.intent(requestId,'web:'+f.app.store.meta('mainThread'),'file','synthetic.txt');
   f.app.store.db.prepare('INSERT INTO conversation_attachments VALUES(?,?)').run(requestId,JSON.stringify([ref]));
  }
  await f.app.message('边界验证','boundary');assert.deepEqual(f.errors,[]);await f.app.idle();
  assert.equal(f.app.tasks.deliveries().length,1);assert.equal(f.app.tasks.deliveries()[0]!.routeSourceRequestId,'allow-followup');
 }finally{await f.close();}
});


test('AC08 empty internal narrative preserves completed actions and following normal input',async()=>{
 const f=fixture('defer',true);try{
  await f.app.start();await f.app.message('开始原工作','start');await until(()=>f.app.snapshot().activeWorkers===1);
  await f.app.message('先记下导出，不执行','remember');await f.app.message('允许后续处理','allow-followup');
  f.release();await until(()=>f.handled);await f.app.idle();
  assert.deepEqual(f.errors,[]);
  assert.equal(await f.app.message('恢复后查询','after-empty-internal'),'Synthetic reply');
  assert.deepEqual(f.errors,[]);
  assert.equal(f.app.snapshot().activeWorkers,0);
 }finally{await f.close();}
});


test('AC08 an empty normal user reply still fails clearly and fences later execution',async()=>{
 const f=fixture('defer',false,true);try{
  await f.app.start();
  assert.match(await f.app.message('普通空回复','empty-user'),/main_empty_reply/);
  await assert.rejects(()=>f.app.message('后续普通输入','after-empty-user'),/main_engine_unavailable/);
  assert.equal(f.app.tasks.tasks().length,0);
 }finally{await f.close();}
});


test('AC08 a failed internal engine result still fences later execution',async()=>{
 const f=fixture('defer',true,false,true);try{
  await f.app.start();await f.app.message('开始原工作','start');await until(()=>f.app.snapshot().activeWorkers===1);
  await f.app.message('先记下导出，不执行','remember');await f.app.message('允许后续处理','allow-followup');
  f.release();await until(()=>f.handled);await f.app.idle();
  assert.equal(f.app.tasks.task(f.childId).outcome,'failed');
  assert.ok(f.app.store.db.prepare("SELECT 1 FROM events WHERE type='main_turn_failed' AND code='synthetic_main_engine_failed'").get());
  await assert.rejects(()=>f.app.message('恢复后查询','after-failed-internal'),/main_engine_unavailable/);
 }finally{await f.close();}
});
