// Isolated host and scripted engine; never opens the installed Homer runtime.
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {Homer,type Message} from '../src/service.js';
import type {EngineLike,EngineOptions,ToolCall,TurnResult} from '../src/engine.js';
import {MAIN_TOOLS} from '../src/tools.js';
import {RECURSIVE_TOOLS} from '../src/recursive-tools.js';
import {historyFixture} from './web-history-loading-fixture.js';

export async function recoveryFixture(count=1){
 const scratch=resolve('.codex/scratch/history-recovery-tests');mkdirSync(scratch,{recursive:true});
 const dir=mkdtempSync(join(scratch,'case-')),runtime=join(dir,'runtime'),workspace=join(dir,'workspace');mkdirSync(runtime);mkdirSync(workspace);
 const config={runtime,workspace,codexHome:join(dir,'codex'),nativeCodexHome:join(dir,'codex'),codexBin:'/usr/bin/false',model:'synthetic',requiresOpenaiAuth:false,stopGraceMs:100};
 const f=historyFixture(0,160,false,join(runtime,'homer.sqlite')),agentId=f.store.meta('mainAgentId')!,threadId='synthetic-history';
 f.store.setMeta('mainToolsHash',createHash('sha256').update(JSON.stringify([...MAIN_TOOLS,...RECURSIVE_TOOLS])).digest('hex'));
 const originals:{id:string;seq:number;taskId:string;workerId:string;runId:string}[]=[];
 for(let n=0;n<count;n++){
  const requestId='source-'+n;f.inputs.accept({requestId,text:'Synthetic original authority'});const source=f.inputs.claim()!;f.inputs.finish(source.messageId,source.revision,'completed');
  const actor={agentId,threadId,sourceRequestId:requestId},task=f.tasks.createTask(actor,{operationId:'task-'+n,goal:'Synthetic old work',authority:{sourceRequestId:requestId,description:'Synthetic only'}});
  const worker=f.tasks.workerOpen(actor,{operationId:'open-'+n,taskId:task.taskId,text:'Synthetic original input'}),run=f.tasks.claim(worker.runId)!;f.tasks.bind(run.id,run.epoch,'worker-thread-'+n,'worker-turn-'+n);
  f.tasks.endSegment(run.id,run.epoch,{status:'completed',text:'Synthetic original result '+n},true);
  const claimed=f.inputs.claim([],'all')!;assert.equal(claimed.origin,'worker');
  f.processes.start({id:'old-process-'+n,threadId,sourceKind:'worker',sourceMessageIds:[claimed.messageId],messageId:'old-process-'+n},'old-turn-'+n);
  f.inputs.uncertain(claimed.messageId,claimed.revision);f.processes.finish('old-process-'+n,'unknown','host:restart:engine_closed');
  f.tasks.controlTask(actor,{operationId:'cancel-'+n,taskId:task.taskId,expectedRevision:f.tasks.task(task.taskId).revision,action:'cancel'});
  originals.push({id:claimed.messageId,seq:claimed.seq,taskId:task.taskId,workerId:worker.workerId,runId:run.id});
 }
 f.close();let app:Homer,sequence=0;
 const turns:{text:string;requestId?:string;turnId:string}[]=[],messages:Message[]=[],calls:{tool:string;args:any}[]=[];
 let behavior:'inspect'|'ignore'|'error'|'fail-user'|'unconfirmed-close'='inspect',beforeRecovery:(()=>Promise<void>)|undefined;
 class Peer extends EventEmitter implements EngineLike{
  threadId:string;turnId='';
  constructor(options:EngineOptions,readonly handler:(call:ToolCall)=>Promise<unknown>){super();this.threadId=options.threadId??threadId;assert.equal(options.role==='worker',false,'historical inspection must not launch a Worker');}
  async start(){return this.threadId;}async close(){return behavior!=='unconfirmed-close';}async interrupt(){return true;}
  async call(tool:string,args:unknown){calls.push({tool,args});return this.handler({threadId:this.threadId,turnId:this.turnId,callId:'call-'+ ++sequence,tool,arguments:args});}
  async turn(text:string,options?:{onStarted?:(id:string)=>void}):Promise<TurnResult>{
   this.turnId='turn-'+ ++sequence;options?.onStarted?.(this.turnId);turns.push({text,requestId:app['mainContext']?.requestId,turnId:this.turnId});
   if(behavior==='error'||behavior==='unconfirmed-close')throw Error('synthetic_user_failed');
   if(behavior==='fail-user')return {status:'failed',text:'',errorCode:'synthetic_user_failed'};
   const userText=app['mainContext']?.userText??'',original=originals.find(item=>userText==='inspect '+item.id);
   if(original&&behavior==='inspect'){
    await beforeRecovery?.();await this.call('work_inspect',{taskId:original.taskId});
    const read=await this.call('worker_read',{workerId:original.workerId,messageId:original.id}) as any;
    assert.equal(read.messages[0].id,original.id);assert.equal(read.messages[0].text,'Synthetic original result '+originals.indexOf(original));
   }
   const reply='Synthetic user requirement handled';this.emit('agentMessage',{threadId:this.threadId,turnId:this.turnId,itemId:'answer-'+this.turnId,phase:'final_answer',text:reply,completed:true});return {status:'completed',text:reply};
  }
 }
 const paused={...config,pauseOldDesktopWork:true,desktopResources:{bundleRoot:dir,manifestSha256:'a'.repeat(64)}};
 const open=async()=>{app=new Homer(paused,async message=>{messages.push(message);},(options,handler)=>new Peer(options,handler));await app.start();};
 try{await open();}catch(error){rmSync(dir,{recursive:true,force:true});throw error;}
 return {get app(){return app;},originals,turns,messages,calls,set behavior(value:typeof behavior){behavior=value;},set beforeRecovery(value:typeof beforeRecovery){beforeRecovery=value;},
  async submit(requestId='new-user',source?:'first_launch'){app.submitMessage({requestId,text:'Handle my current request'},source?{source,persist(){}}:undefined);await app.idle();},
  async reopen(){await app.close();await open();},async close(){behavior='inspect';await app.close();rmSync(dir,{recursive:true,force:true});}};
}
