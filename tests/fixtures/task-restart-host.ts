// Independent host process and scripted Worker; no model, login or network.
import {EventEmitter} from 'node:events';
import {appendFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Homer} from '../../src/service.js';
import type {EngineOptions,ToolCall,TurnResult} from '../../src/engine.js';

export function restartHost(root:string,scenario:string,seed=false,desktop=false){
 const runtime=join(root,'runtime');mkdirSync(runtime,{recursive:true});let sequence=0,started!:()=>void;
 const active=new Promise<void>(resolve=>{started=resolve;});
 const attempts:PromiseSettledResult<any>[]=[],engines:Peer[]=[];
 class Peer extends EventEmitter{
  threadId:string;turnId?:string;pid?:number;release?:()=>void;
  constructor(readonly options:EngineOptions,readonly handle:(call:ToolCall)=>Promise<unknown>){super();this.threadId=options.threadId??'synthetic-'+(options.role??'main')+'-'+ ++sequence;if(seed&&options.role==='worker'&&scenario!=='missing-owner')this.pid=process.pid;engines.push(this);}
  async start(){if(this.options.role==='worker')appendFileSync(join(root,'starts'),this.threadId+'\n');return this.threadId;}
  async call(tool:string,args:unknown):Promise<any>{return this.handle({tool,arguments:args,threadId:this.threadId,turnId:this.turnId!,callId:(seed?'seed-call-':'reopened-call-')+ ++sequence});}
  async turn(text:string,hooks?:{onStarted?:(id:string)=>void}):Promise<TurnResult>{
   this.turnId=(seed?'seed-turn-':'reopened-turn-')+ ++sequence;hooks?.onStarted?.(this.turnId);
   if(this.options.role==='worker'){
    if(seed&&(['running','uncertain-owner','missing-owner'].includes(scenario)||scenario.startsWith('stop-intent:')||scenario.startsWith('steer-intent:'))){
     if(scenario==='uncertain-owner'){const run=app.store.runs()[0]!;app.tasks.failRun(run.id,run.epoch,'restart_unconfirmed',true);}
     started();await new Promise<void>(resolve=>{this.release=resolve;});return {status:'interrupted',text:''};
    }
    const run=app.store.runs().find(run=>run.threadId===this.threadId&&run.turnId===this.turnId)!;
    writeFileSync(join(app.files.prepareRun(run.taskId,run.id),'report.md'),'# Synthetic preserved bytes');
    const result:TurnResult={status:'completed',text:'Synthetic report; date unknown.'};
    if(seed&&['written-before-terminal','checkpoint','goal-change'].includes(scenario)){
     this.emit('agentMessage',{threadId:this.threadId,turnId:this.turnId,itemId:'original-output',phase:'final_answer',text:result.text,completed:true});
     if(scenario==='checkpoint')this.emit('nativeCompleted',{threadId:this.threadId,turnId:this.turnId,result});
     started();await new Promise<void>(resolve=>{this.release=resolve;});return result;
    }
    started();return result;
   }
   if(text==='open'){
    await this.call('worker_open',{message:'Investigate synthetic input'});
   }else if(text==='change-goal'){
    await this.call('task_update',{taskId:app.tasks.tasks()[0]!.id,goal:'Investigate the changed synthetic requirement'});
   }else if(text==='pause'||text==='cancel'){
    await this.call('task_update',{taskId:app.tasks.tasks()[0]!.id,action:text});
   }else if(text==='interrupt'){
    await this.call('worker_interrupt',{workerId:app.store.runs()[0]!.workerId});
   }else if(text==='steer'){
    await this.call('worker_send',{workerId:app.store.runs()[0]!.workerId,message:'Immediately supplement the old turn',immediate:true});
   }else if(text==='followup'){
    const run=app.store.runs()[0]!;attempts.push(...await Promise.allSettled([this.call('worker_send',{workerId:run.workerId,message:'Check the remaining date'})]));
   }else if(text==='settle'){
    const taskId=app.tasks.tasks()[0]!.id;
    await this.call('task_update',{taskId,action:'settle',outcome:'succeeded'});
   }else if(text==='read'||text==='send'){
    const task=app.tasks.tasks()[0]!,run=app.tasks.runs(task.id).at(-1)!;
    await this.call('work_inspect',{taskId:task.id});
    if(text==='read')attempts.push(...await Promise.allSettled([this.call('worker_read',{workerId:run.workerId})]));
    else{
     const report=join(app.files.prepareRun(task.id,run.id),'report.md');
     try{
      const sent=await this.call('send_user_message',{taskId:task.id,attachments:[{path:report}],text:'Synthetic report'});
      if(seed&&scenario==='message-after-commit')process.exit(74);
      await this.call('task_update',{taskId:task.id,action:'settle',outcome:'succeeded'});
      attempts.push({status:'fulfilled',value:sent});
     }catch(reason){attempts.push({status:'rejected',reason});throw reason;}
    }
   }
   return {status:'completed',text:text.startsWith('[内部协作输入')?'':'Synthetic reply'};
  }
  async steer(expectedTurnId:string){if(seed&&scenario==='steer-intent:dispatching')process.exit(74);return {turnId:expectedTurnId};}
  async interrupt(){this.release?.();this.release=undefined;return true;}
  async close(){await this.interrupt();return true;}
 }
 const home=join(root,'empty-home');
 const app=new Homer({runtime,workspace:join(root,'workspace'),codexHome:home,nativeCodexHome:home,codexBin:'/usr/bin/false',model:'synthetic',requiresOpenaiAuth:false,stopGraceMs:100,...(desktop?{pauseOldDesktopWork:true,desktopResources:{bundleRoot:root,manifestSha256:'a'.repeat(64)}}:{})},async()=>{},(options,handle)=>new Peer(options,handle));
 if(seed&&scenario==='message-before-commit'){
  const commit=app.history.commitAssistant.bind(app.history);
  app.history.commitAssistant=input=>{commit(input);process.exit(74);};
 }
 if(seed&&scenario==='closed-before-return')app.tasks.endSegment=()=>{process.exit(74);};
 if(seed&&scenario==='queued-before-start'){const claim=app.tasks.claim.bind(app.tasks);app.tasks.claim=(id?:string)=>{if(app.store.runs().length)process.exit(74);return claim(id);};}
 if(seed&&scenario.startsWith('stop-intent:'))app.tasks.confirmStop=()=>{process.exit(74);};
 if(seed&&scenario==='steer-intent:accepted')app['applySteer']=async()=>{process.exit(74);};
 return {app,active,attempts,engines};
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
 const [root,scenario]=process.argv.slice(2) as [string,string],{app,active}=restartHost(root,scenario,true);
 await app.start();await app.message('open','source');await active;
 if(scenario==='goal-change'){await app.message('change-goal','changed-source');await app.idle();}
 if(scenario.startsWith('stop-intent:'))await app.message(scenario.slice('stop-intent:'.length),'stop-request');
 if(scenario.startsWith('steer-intent:'))await app.message('steer','steer-request');
 if(scenario==='reply'||scenario.startsWith('message-'))await app.idle();
 if(scenario.startsWith('message-'))await app.message('send','send-request');
 process.once('message',async()=>{await app.close();process.disconnect();});process.send!('ready');
}
