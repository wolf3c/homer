// Independent host process and scripted Worker; no model, login or network.
import {EventEmitter} from 'node:events';
import {appendFileSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Homer} from '../../src/service.js';
import type {EngineOptions,ToolCall,TurnResult} from '../../src/engine.js';

export function restartHost(root:string,scenario:string,seed=false,desktop=false){
 const runtime=join(root,'runtime');mkdirSync(runtime,{recursive:true});let sequence=0,started!:()=>void,submitted!:()=>void;
 const active=new Promise<void>(resolve=>{started=resolve;}),sent=new Promise<void>(resolve=>{submitted=resolve;});
 const attempts:PromiseSettledResult<any>[]=[],engines:Peer[]=[];
 class Peer extends EventEmitter{
  threadId:string;turnId?:string;pid?:number;release?:()=>void;
  constructor(readonly options:EngineOptions,readonly handle:(call:ToolCall)=>Promise<unknown>){super();this.threadId=options.threadId??'synthetic-'+(options.role??'main')+'-'+ ++sequence;if(seed&&options.role==='worker'&&scenario!=='missing-owner')this.pid=process.pid;engines.push(this);}
  async start(){if(this.options.role==='worker')appendFileSync(join(root,'starts'),this.threadId+'\n');return this.threadId;}
  async call(tool:string,args:unknown):Promise<any>{return this.handle({tool,arguments:args,threadId:this.threadId,turnId:this.turnId!,callId:(seed?'seed-call-':'reopened-call-')+ ++sequence});}
  async turn(text:string,hooks?:{onStarted?:(id:string)=>void}):Promise<TurnResult>{
   this.turnId=(seed?'seed-turn-':'reopened-turn-')+ ++sequence;hooks?.onStarted?.(this.turnId);
   if(this.options.role==='worker'){
    if(seed&&['running','uncertain-owner','missing-owner'].includes(scenario)){
     if(scenario==='uncertain-owner'){const run=app.store.runs()[0]!;app.tasks.failRun(run.id,run.epoch,'restart_unconfirmed',true);}
     started();await new Promise<void>(resolve=>{this.release=resolve;});return {status:'interrupted',text:''};
    }
    await this.call('write_markdown',{filename:'report.md',content:'# Synthetic preserved bytes'});
    const result:TurnResult={status:'completed',text:'Synthetic report; date unknown.'};
    if(seed&&['written-before-terminal','checkpoint','goal-change'].includes(scenario)){
     this.emit('agentMessage',{threadId:this.threadId,turnId:this.turnId,itemId:'original-output',phase:'final_answer',text:result.text,completed:true});
     if(scenario==='checkpoint')this.emit('nativeCompleted',{threadId:this.threadId,turnId:this.turnId,result});
     started();await new Promise<void>(resolve=>{this.release=resolve;});return result;
    }
    started();return result;
   }
   if(text==='open'){
    const task=await this.call('task_create',{goal:'Investigate synthetic input'});await this.call('worker_open',{taskId:task.taskId,message:'Investigate synthetic input'});
   }else if(text==='change-goal'){
    await this.call('task_update',{taskId:app.tasks.tasks()[0]!.id,goal:'Investigate the changed synthetic requirement'});
   }else if(text==='followup'){
    const run=app.store.runs()[0]!;attempts.push(...await Promise.allSettled([this.call('worker_send',{workerId:run.workerId,message:'Check the remaining date'})]));
   }else if(text==='read'||text==='adopt'||text==='publish'||text==='retry-publication'){
    const task=app.tasks.tasks()[0]!,runs=app.tasks.runs(task.id),run=runs.at(-1)!;
    await this.call('work_inspect',{taskId:task.id});
    if(text==='read')attempts.push(...await Promise.allSettled([this.call('worker_read',{workerId:run.workerId})]));
    if(text==='adopt'||text==='publish'){
     const result=await this.call('accept_result',{runId:run.id,filePath:join(app.files.prepareRun(task.id,run.id),'report.md')});attempts.push({status:'fulfilled',value:result});
     if(text==='adopt')await this.call('task_update',{taskId:task.id,action:'settle',outcome:'succeeded'});
     else {const args={taskId:task.id,resultIds:[result.resultId],text:'Synthetic report'},receipt=await this.call('publish_delivery',args);writeFileSync(join(root,'publication-receipt.json'),JSON.stringify({args,receipt}));}
    }
    if(text==='retry-publication'){
     const original=JSON.parse(readFileSync(join(root,'publication-receipt.json'),'utf8'));
     attempts.push(...await Promise.allSettled([this.call('work_inspect',{operationKey:original.receipt.operationKey}),this.call('publish_delivery',original.args)]));
    }
   }
   return {status:'completed',text:text.startsWith('[内部协作输入')?'':'Synthetic reply'};
  }
  async interrupt(){this.release?.();this.release=undefined;return true;}
  async close(){await this.interrupt();return true;}
 }
 const app=new Homer({runtime,workspace:join(root,'workspace'),codexHome:join(root,'empty-home'),codexBin:'/unused-synthetic',model:'synthetic',requiresOpenaiAuth:false,stopGraceMs:100,...(desktop?{pauseOldDesktopWork:true,desktopResources:{bundleRoot:root,manifestSha256:'a'.repeat(64)}}:{})},async message=>{
  if(message.type!=='delivery')return;appendFileSync(join(root,'sends'),message.deliveryId+'\n');submitted();if(scenario==='sending'&&seed)await new Promise<void>(()=>{});throw Error('synthetic_channel_receipt_lost');
 },(options,handle)=>new Peer(options,handle));
 if(seed&&scenario==='closed-before-return')app.tasks.endSegment=()=>{process.exit(74);};
 if(seed&&scenario==='queued-before-start'){const claim=app.tasks.claim.bind(app.tasks);app.tasks.claim=(id?:string)=>{if(app.store.runs().length)process.exit(74);return claim(id);};}
 return {app,active,sent,attempts,engines};
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
 const [root,scenario]=process.argv.slice(2) as [string,string],{app,active,sent}=restartHost(root,scenario,true);
 await app.start();await app.message('open','source');await active;
 if(scenario==='goal-change'){await app.message('change-goal','changed-source');await app.idle();}
 if(['reply','sending','unknown-send'].includes(scenario))await app.idle();
 if(['sending','unknown-send'].includes(scenario)){void app.message('publish','publish-request');await sent;if(scenario==='unknown-send')await app.idle();}
 process.once('message',async()=>{await app.close();process.disconnect();});process.send!('ready');
}
