// Synthetic, in-memory/local transports only; no model or provider requests.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {Homer} from '../src/service.js';
import type {Config} from '../src/config.js';
import type {TurnResult} from '../src/engine.js';
import {fixture,delegate,running,complete} from './recursive-fixture.js';
const scratch='.codex/scratch/deepseek-adaptation-20261028';
const codes=['engine_cost_limit_reached','engine_compaction_loop'] as const;
for(const code of [...codes,undefined])for(const mutation of [false,true])test(`main completed ${code??'normal'} ${mutation?'with':'without'} capability mutation`,async()=>{
 mkdirSync(scratch,{recursive:true});const dir=mkdtempSync(join(resolve(scratch),'consumer-main-'));
 const config:Config={workspace:join(dir,'workspace'),runtime:join(dir,'runtime'),codexHome:join(dir,'codex'),codexBin:'/usr/bin/false',model:'synthetic',requiresOpenaiAuth:false,mainTimeoutMs:3000,stopGraceMs:100};
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
for(const code of [...codes,undefined])for(const ready of [false,true])for(const consumer of ['task','service'] as const)test(`${consumer} completed ${code??'normal'} retains ${ready?'ready':'armed'} wait boundary`,async()=>{
 const f=fixture(scratch);try{
  const a=delegate(f,'a'),b=delegate(f,'b'),aa=running(f,a.taskId),bb=running(f,b.taskId);
  if(ready)complete(f,bb,b.taskId);
  const t=f.tasks.task(a.taskId);f.tasks.wait(aa,{operationId:'wait',taskId:t.id,version:1,expectedTaskRevision:t.revision,condition:{type:'result_or_terminal',taskId:b.taskId,version:1}});
  const terminal:TurnResult={status:'completed',text:'Synthetic partial evidence.',messages:[{itemId:'partial',phase:'final_answer',text:'Synthetic partial evidence.'}],...(code?{errorCode:code}:{})};
  let closed=0;
  if(consumer==='task'){f.tasks.recordWorkerTerminal(aa.runId!,aa.epoch!,terminal);f.tasks.endSegment(aa.runId!,aa.epoch!,terminal,true);}
  else{
   const app=Object.create(Homer.prototype) as Homer;
   const slot={id:aa.runId!,epoch:aa.epoch!,engine:{threadId:aa.threadId,turnId:aa.turnId,turn:async()=>terminal,close:async()=>{closed++;return true;}}};
   Object.assign(app,{config:{runtime:join(f.dir,'runtime'),codexHome:join(f.dir,'codex'),nativeCodexHome:join(f.dir,'other')},files:f.files,tasks:f.tasks,store:f.store,workers:new Map([[aa.runId!,slot]]),mainApprovals:{end(){}},mainActor(){return {agentId:'main:synthetic',sourceRequestId:'user-synthetic'};},scheduleInternal(){},scheduleDelivery(){}});
   await app['execute'](f.tasks.run(aa.runId!));assert.equal(closed,code?1:0);
  }
  const run=f.tasks.run(aa.runId!);
  assert.equal(run.phase,code?'ended':ready?'ready':'parked');
  assert.equal(run.errorCode,code??null);
  if(code){
   assert.equal(f.tasks.claim(run.id),undefined);
   const results=f.store.db.prepare('SELECT * FROM results WHERE runId=?').all(run.id);
   assert.equal(results.length,1);const payload=JSON.parse(String(results[0]!.payloadJson));
   assert.equal(payload.execution.status,'completed');assert.equal(payload.execution.errorCode,code);assert.equal(payload.execution.exitConfirmed,true);
   assert.equal(payload.text,'Synthetic partial evidence.');assert.deepEqual(payload.messages,terminal.messages);
   assert.equal(f.store.db.prepare("SELECT count(*) n FROM run_waits WHERE runId=? AND state IN ('armed','ready')").get(run.id)!.n,0);
   f.tasks.endSegment(run.id,run.epoch,terminal,true);
   assert.equal(f.store.db.prepare('SELECT count(*) n FROM results WHERE runId=?').get(run.id)!.n,1);
  }
 }finally{f.close();}
});
