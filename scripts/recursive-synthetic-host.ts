// Synthetic peers only. Actual Homer/SQLite, no Codex process or account.
import {EventEmitter} from 'node:events';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {Homer,type Message} from '../src/service.js';
import type {EngineLike,EngineOptions,ToolCall,TurnResult} from '../src/engine.js';

export function syntheticHost(failChild=false,retainRuntime=false){
 const base=resolve('.codex/scratch/chat-architecture-implementation-20261105/e-host');mkdirSync(base,{recursive:true});
 const root=mkdtempSync(join(base,'test-'));mkdirSync(join(root,'runtime'));mkdirSync(join(root,'workspace'),{recursive:true});
 const events:Message[]=[],engines:Peer[]=[],seen:string[]=[];let sequence=0,app:Homer,followed=false;
 class Peer extends EventEmitter implements EngineLike{
  threadId:string;turnId?:string;turns=0;pending?:(value:TurnResult)=>void;interrupts=0;resumable=true;
  constructor(readonly options:EngineOptions,readonly handler:(call:ToolCall)=>Promise<unknown>){super();this.threadId=options.threadId??'synthetic-thread-'+ ++sequence;engines.push(this);}
  get worker(){return this.options.role==='worker';}
  async start(){return this.threadId;}
  async call(tool:string,args:unknown):Promise<any>{return this.handler({threadId:this.threadId,turnId:this.turnId!,callId:'synthetic-call-'+ ++sequence,tool,arguments:args});}
  createTask(goal:string,notes?:string){return this.call('task_create',{goal,...(notes===undefined?{}:{notes})});}
  openWorker(taskId:string,message:string){return this.call('worker_open',{taskId,message});}
  send(workerId:string,message:string,immediate=false){return this.call('worker_send',{workerId,message,...(immediate?{immediate}: {})});}
  inspect(taskId:string){return this.call('work_inspect',{taskId});}
  async turn(text:string,hooks?:{onStarted?:(id:string)=>void}):Promise<TurnResult>{
   this.turnId='synthetic-turn-'+ ++sequence;this.turns++;hooks?.onStarted?.(this.turnId);
   if(this.worker){
    const marker='[主 Agent 本次消息原文]\n',at=text.indexOf(marker);if(at<0)throw Error('synthetic_worker_prompt_missing');
    const assignment=text.slice(at+marker.length);
    if(assignment==='C'&&failChild)return {status:'failed',text:'Synthetic input unavailable; date remains unknown.',errorCode:'synthetic_input_missing'};
    if(assignment==='A followup'){
     await this.call('write_markdown',{filename:'synthetic-report.md',content:'# Synthetic report\nDate unknown.\n'});
     return {status:'completed',text:'Synthetic report checked; date unknown.'};
    }
    return {status:'completed',text:'Synthetic '+assignment+' checked; date unknown.'};
   }
   if(text==='synthetic:tree'||text==='运行递归合成案例'){
    const task=await this.createTask('Check synthetic input; keep dates unknown');
    for(const label of ['A','B','C'])await this.openWorker(task.taskId,label);
    return {status:'completed',text:'Synthetic work accepted'};
   }
   if(text.startsWith('[内部协作输入')){
    const task=app.tasks.tasks()[0];if(!task)return {status:'completed',text:''};
    const workers=app.tasks.workers(task.id),a=workers.find(worker=>app.tasks.runs(task.id,worker.workerId)[0]?.prompt==='A');
    if(a&&a.run.status==='succeeded'&&!followed){followed=true;await this.send(a.workerId,'A followup');return {status:'completed',text:''};}
    if(a&&followed&&app.tasks.runs(task.id,a.workerId).length===2&&workers.length===3&&workers.every(worker=>['succeeded','failed'].includes(worker.run.status))&&!app.tasks.deliveries([task.id]).length){
     const filePath=join(app.files.prepareRun(task.id,a.run.id),'synthetic-report.md');
     const adopted=await this.call('accept_result',{runId:a.run.id,filePath});
     await this.call('publish_delivery',{taskId:task.id,resultIds:[adopted.resultId],text:failChild?'Synthetic partially completed; missing C':'Synthetic completed; date unknown'});
     await this.call('task_update',{taskId:task.id,action:'settle',outcome:failChild?'partial':'succeeded'});
    }
    return {status:'completed',text:''};
   }
   seen.push(text);
   if(text==='synthetic:stream'||text==='开始长回复合成验收')return new Promise(resolve=>{this.pending=resolve;this.emit('textDelta',{threadId:this.threadId,turnId:this.turnId,delta:'Synthetic streaming'});});
   const reply='Synthetic reply: '+text;this.emit('agentMessage',{threadId:this.threadId,turnId:this.turnId,itemId:'reply:'+this.turnId,phase:'final_answer',text:reply,completed:true});
   return {status:'completed',text:reply};
  }
  async interrupt(){this.interrupts++;this.pending?.({status:'interrupted',text:'Synthetic partial'});this.pending=undefined;return true;}
  async close(){this.pending?.({status:'interrupted',text:''});this.pending=undefined;return true;}
 }
 app=new Homer({runtime:join(root,'runtime'),workspace:join(root,'workspace'),codexBin:'/usr/bin/false',codexHome:join(root,'empty-home'),model:'synthetic-only',effort:'medium',requiresOpenaiAuth:false,timeoutMs:20000,mainTimeoutMs:5000,stopGraceMs:100},async message=>{events.push(message);},(options,handler)=>new Peer(options,handler));
 return {app,events,engines,seen,root,async close(){await app.close();if(!retainRuntime)rmSync(root,{recursive:true,force:true});}};
}
