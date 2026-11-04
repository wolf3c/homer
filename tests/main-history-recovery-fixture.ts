// Isolated host and protocol engine; never opens the installed Homer runtime.
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {Homer,type Message} from '../src/service.js';
import type {EngineLike,EngineOptions,ToolCall,TurnResult} from '../src/engine.js';
import {MAIN_TOOLS} from '../src/tools.js';
import {historyFixture} from './web-history-loading-fixture.js';

export async function recoveryFixture(count=1){
 const scratch=resolve('.codex/scratch/history-recovery-tests');mkdirSync(scratch,{recursive:true});
 const dir=mkdtempSync(join(scratch,'case-')),runtime=join(dir,'runtime'),workspace=join(dir,'workspace');
 mkdirSync(runtime);mkdirSync(workspace);
 const config={runtime,workspace,codexHome:join(dir,'codex'),codexBin:'/usr/bin/false',model:'synthetic',requiresOpenaiAuth:false,stopGraceMs:100};
 const f=historyFixture(0,160,false,join(runtime,'homer.sqlite')),agentId=f.store.meta('mainAgentId')!;
 f.store.setMeta('mainToolsHash',createHash('sha256').update(JSON.stringify(MAIN_TOOLS)).digest('hex'));
 const originals:{id:string;seq:number;taskId:string;resultId:string}[]=[];
 for(let n=0;n<count;n++){
  const requestId='source-'+n;f.inputs.accept({requestId,text:'Synthetic original authority'});
  const source=f.inputs.claim()!;f.inputs.finish(source.messageId,source.revision,'completed');
  const root=f.tasks.createRoot({agentId,sourceRequestId:requestId},{operationId:'root-'+n,title:'Synthetic completed work',executorKind:'worker',contract:{goal:'Synthetic work',inputs:[],resultKind:'structured',acceptance:{criteria:[]}},authority:{sourceRequestId:requestId,description:'Synthetic only',materials:[],resultIds:[],collaborateTaskIds:[],maxActiveMs:10000}});
  const run=f.tasks.claim(root.runId!)!;f.tasks.bind(run.id,run.epoch,'worker-thread-'+n,'worker-turn-'+n);
  const result=f.tasks.endSegment(run.id,run.epoch,{status:'completed',text:'Synthetic original result'},true)!;
  const claimed=f.inputs.claim([],'all')!;assert.equal(claimed.origin,'worker');
  f.processes.start({id:'old-process-'+n,threadId:'synthetic-history',sourceKind:'worker',sourceMessageIds:[claimed.messageId],messageId:'old-process-'+n},'old-turn-'+n);
  f.inputs.uncertain(claimed.messageId,claimed.revision);
  f.processes.finish('old-process-'+n,'unknown','host:restart:engine_closed');
  const task=f.tasks.task(root.taskId),stopped=f.tasks.stop({agentId},{operationId:'stop-'+n,taskId:task.id,version:task.headVersion,expectedTaskRevision:task.revision,scope:'self',reason:'Synthetic work superseded'});
  f.tasks.confirmStop(stopped.operationKey,true);
  const terminal=f.inputs.claim([],'all')!;assert.equal(terminal.origin,'worker');
  f.tasks.ack({agentId},{operationId:'seed-terminal-'+n,messageId:terminal.messageId,disposition:'processed',reason:'Synthetic setup consumed stop notice'});
  originals.push({id:claimed.messageId,seq:claimed.seq,taskId:task.id,resultId:result.resultId});
 }
 f.close();
 let app:Homer,sequence=0;
 const turns:{text:string;requestId?:string;turnId:string}[]=[],messages:Message[]=[],calls:{tool:string;args:any}[]=[];
 let behavior:'ack'|'processed'|'empty'|'ignore'|'error'|'stop'|'fail-user'|'ack-then-error'|'unconfirmed-close'='ack';
 let beforeRecovery:(()=>Promise<void>)|undefined;
 class Peer extends EventEmitter implements EngineLike{
  threadId:string;turnId='';
  constructor(options:EngineOptions,readonly handler:(call:ToolCall)=>Promise<unknown>){super();this.threadId=options.threadId??'synthetic-history';assert.equal(options.tools.some(tool=>tool.name==='read_material'),false,'recovery must never launch a Worker');}
  async start(){return this.threadId;}async close(){return behavior!=='unconfirmed-close';}async interrupt(){return true;}
  async call(tool:string,args:unknown){calls.push({tool,args});return this.handler({threadId:this.threadId,turnId:this.turnId,callId:'call-'+ ++sequence,tool,arguments:args});}
  final(text:string):TurnResult{
   if(text)this.emit('agentMessage',{threadId:this.threadId,turnId:this.turnId,itemId:'answer-'+this.turnId,phase:'final_answer',text,completed:true});
   return{status:'completed',text};
  }
  async turn(text:string,options?:{onStarted?:(id:string)=>void}):Promise<TurnResult>{
   this.turnId='turn-'+ ++sequence;options?.onStarted?.(this.turnId);
   turns.push({text,requestId:app['mainContext']?.requestId,turnId:this.turnId});
   const original=originals.find(item=>text.includes(item.id));
   if(!original){if(behavior==='fail-user')return{status:'failed',text:'',errorCode:'synthetic_user_failed'};return this.final('Synthetic user requirement handled');}
   if(beforeRecovery)await beforeRecovery();
   if(behavior==='error'||behavior==='unconfirmed-close')throw Error('synthetic_recovery_failed');
   if(behavior==='stop'){await app.stopMain(app['mainContext']!.messageId!);return{status:'completed',text:'Stopped'};}
   if(behavior==='ignore')return this.final('Claims everything is finished without ACK');
   const inbox=await this.call('inbox_read',{after:original.seq-1}) as {id:string}[];
   assert.ok(inbox.some(item=>item.id===original.id),'the actual recovery read must expose the selected original');
   const inspected=await this.call('work_inspect',{taskId:original.taskId,runId:null,resultId:null}) as any;
   assert.equal(inspected.task.outcome,'cancelled');
   await this.call('work_inspect',{taskId:null,runId:null,resultId:original.resultId});
   await this.call('inbox_ack',{operationId:'recover-'+original.id,messageId:original.id,disposition:behavior==='processed'?'processed':'rejected',reason:'Original evidence inspected; work was superseded',resultId:null});
   if(behavior==='ack-then-error')throw Error('synthetic_recovery_failed');
   return this.final(behavior==='empty'?'':'Synthetic original receipt reconciled');
  }
 }
 const paused={...config,pauseOldDesktopWork:true,desktopResources:{bundleRoot:dir,manifestSha256:'a'.repeat(64)}};
 const open=async()=>{app=new Homer(paused,async message=>{messages.push(message);},(options,handler)=>new Peer(options,handler));await app.start();};
 try{await open();}catch(error){rmSync(dir,{recursive:true,force:true});throw error;}
 return{
  get app(){return app;},originals,turns,messages,calls,
  set behavior(value:typeof behavior){behavior=value;},set beforeRecovery(value:typeof beforeRecovery){beforeRecovery=value;},
  async submit(requestId='new-user',source?:'first_launch'){app.submitMessage({requestId,text:'Handle my current request, then reconcile old work'},source?{source,persist(){}}:undefined);await app.idle();},
  async reopen(){await app.close();await open();},
  async close(){await app.close();rmSync(dir,{recursive:true,force:true});},
 };
}
