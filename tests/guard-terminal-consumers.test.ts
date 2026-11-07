// Synthetic, in-memory/local transports only; no model or provider requests.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {Homer} from '../src/service.js';
import type {Config} from '../src/config.js';
import type {TurnResult} from '../src/engine.js';
import {chatFixture} from './task-chat-fixture.js';
const scratch='.codex/scratch/deepseek-adaptation-20261028';
const codes=['engine_cost_limit_reached','engine_compaction_loop'] as const;
for(const code of [...codes,undefined])for(const mutation of [false,true])test(`main completed ${code??'normal'} ${mutation?'with':'without'} capability mutation`,async()=>{
 mkdirSync(scratch,{recursive:true});const dir=mkdtempSync(join(resolve(scratch),'consumer-main-'));
 const config:Config={workspace:join(dir,'workspace'),runtime:join(dir,'runtime'),codexHome:join(dir,'codex'),nativeCodexHome:join(dir,'codex'),codexBin:'/usr/bin/false',model:'synthetic',requiresOpenaiAuth:false,mainTimeoutMs:3000,stopGraceMs:100};
 for(const path of [config.workspace,config.runtime,config.codexHome!])mkdirSync(path,{recursive:true});
 let app:Homer,turns=0,adoptions=0;
 class Fake extends EventEmitter{
  threadId='synthetic-main';turnId?:string;resumable=true;
  async start(){return this.threadId;}async close(){return true;}async interrupt(){return true;}
  async turn(_text:string,opts?:{onStarted?:(id:string)=>void}):Promise<TurnResult>{
   this.turnId='turn-'+(++turns);opts?.onStarted?.(this.turnId);
   if(turns===1){if(mutation)app['mainContext']!.capabilityRevision=1;
    this.emit('agentMessage',{threadId:this.threadId,turnId:this.turnId,itemId:'partial',phase:'final_answer',completed:true,text:'Synthetic partial evidence.'});
   }
   return {status:'completed',text:'Synthetic partial evidence.',...(code?{errorCode:code}:{})};
  }
 }
 app=new Homer(config,async()=>{},()=>new Fake());
 app['adoptMainCapabilities']=async()=>{adoptions++;return undefined;};
 try{
  await app.start();app.submitMessage({requestId:'synthetic-guard',text:'Synthetic request'});await app.idle();
  assert.equal(turns,!code&&mutation?2:1);assert.equal(adoptions,!code&&mutation?1:0);
  const failures=app.store.db.prepare("SELECT * FROM events WHERE type='main_turn_failed'").all();
  assert.equal(failures.length,code?1:0);if(code)assert.match(JSON.stringify(failures),new RegExp(code));
  const nodes=app.store.db.prepare("SELECT value FROM meta WHERE key LIKE 'publicMainNode:v1:%'").all().map(row=>JSON.parse(String(row.value)));
  assert.equal(nodes.length,1);assert.equal(nodes[0].state,'worked');assert.equal(nodes[0].status,code?'failed':'completed');assert.match(nodes[0].endEventId,/:terminal:completed$/);
  assert.match(JSON.stringify(nodes),/Synthetic partial evidence/);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
for(const code of [...codes,undefined])for(const consumer of ['task','service'] as const)test(`${consumer} completed ${code??'normal'} retains raw original and execution guard without settling the task`,async()=>{
 const f=chatFixture();try{
  const task=f.create(),worker=f.tasks.workerOpen(f.actor,{operationId:'open',taskId:task.taskId,text:'Inspect'}),run=consumer==='task'?f.start(worker.workerId):f.tasks.claim(worker.runId)!;
  const terminal:TurnResult={status:'completed',text:'Synthetic partial evidence.',messages:[{itemId:'partial',phase:'final_answer',text:'Synthetic partial evidence.'}],...(code?{errorCode:code}:{})};
  let closed=0;
  if(consumer==='task'){f.tasks.recordWorkerTerminal(run.id,run.epoch,terminal);f.tasks.endSegment(run.id,run.epoch,terminal,true);}
  else{
   const app:any=Object.create(Homer.prototype),slot={id:run.id,epoch:run.epoch,requests:new Map(),engine:{threadId:'thread:worker',turnId:'turn:worker',turn:async(_text:string,options:{onStarted:(turnId:string)=>void})=>{options.onStarted('turn:worker');return terminal;},close:async()=>{closed++;return true;}}};
   Object.assign(app,{config:{runtime:join(f.dir,'runtime'),codexHome:join(f.dir,'codex'),nativeCodexHome:join(f.dir,'codex')},files:f.files,tasks:f.tasks,store:f.store,workers:new Map([[run.id,slot]]),interactions:{cancelRun(){}},mainApprovals:{end(){}},invalidateState(){},scheduleInternal(){}});
   await app.execute(run);assert.equal(closed,1);
  }
  const ended=f.tasks.run(run.id);assert.equal(ended.phase,'ended');assert.equal(ended.errorCode,code??null);assert.equal(f.tasks.claim(run.id),undefined);
  assert.equal(f.tasks.task(task.taskId).state,'open');assert.equal(f.tasks.task(task.taskId).outcome,null);assert.equal(f.store.db.prepare("SELECT 1 FROM sqlite_schema WHERE name='results'").get(),undefined);
  const replies=f.tasks.inbox(f.actor).filter(message=>message.kind==='worker_reply');assert.equal(replies.length,1);
  const payload=replies[0]!.payload;assert.equal(payload.execution.status,'completed');assert.equal(payload.execution.errorCode,code??null);assert.equal(payload.execution.exitConfirmed,true);assert.equal(payload.text,'Synthetic partial evidence.');assert.deepEqual(payload.messages,terminal.messages);
  f.tasks.endSegment(run.id,run.epoch,terminal,true);assert.equal(f.tasks.inbox(f.actor).filter(message=>message.kind==='worker_reply').length,1);
 }finally{f.close();}
});
