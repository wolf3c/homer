import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {Homer,type Message} from '../src/service.js';
import type {EngineOptions,ToolCall} from '../src/engine.js';

// Requirement-derived synthetic host test. No real engine, secrets or external fetch.
test('actual main tool failure persists a progress pair without preventing its original reply',async()=>{
 const parent=resolve('.codex/scratch/local-progress-host');mkdirSync(parent,{recursive:true});const root=mkdtempSync(join(parent,'fixture-'));
 const messages:Message[]=[];let app:Homer|undefined;
 class Engine extends EventEmitter{
  threadId='synthetic-progress-main';turnId?:string;resumable=true;
  constructor(readonly handler:(call:ToolCall)=>Promise<unknown>){super();}
  async start(){return this.threadId;}
  async turn(_text:string,options?:{onStarted?:(id:string)=>void}){
   this.turnId='synthetic-progress-turn';options?.onStarted?.(this.turnId);
   await assert.rejects(this.handler({threadId:this.threadId,turnId:this.turnId,callId:'synthetic-check',tool:'work_inspect',arguments:{taskId:'task-missing'}}),/task_not_found/);
   return {status:'completed',text:'合成已知失败后正常答复'};
  }
  async close(){return true;}async interrupt(){return true;}
 }
 try{
  mkdirSync(join(root,'runtime'));
  app=new Homer({runtime:join(root,'runtime'),workspace:join(root,'workspace'),codexHome:join(root,'runtime','codex-home'),nativeCodexHome:join(root,'runtime','codex-home'),codexBin:'/usr/bin/false',model:'synthetic-only',requiresOpenaiAuth:false,stopGraceMs:100},async message=>{messages.push(message);},(_options:EngineOptions,handler)=>new Engine(handler));
  app.registerRuntimeBuild('a'.repeat(64));await app.start();
  const reply=await app.message('合成工具失败后继续答复','synthetic-progress-input');
  assert.equal(reply,'合成已知失败后正常答复');
  const phases=messages.filter(message=>message.type==='tool_progress');
  assert.equal(phases.length,2);assert.equal(phases[0]?.progress.phase,'start');const ended=phases[1]?.progress;assert.ok(ended?.phase==='end');assert.equal(ended.status,'failed');
  const capabilities=await app.capabilities();assert.equal(capabilities.runtime.version,'aaaaaaaaaaaa');assert.equal(capabilities.runtime.buildHash,'a'.repeat(64));assert.equal(capabilities.currentInput.nativeImagesSubmitted,0);
  assert.equal(app.store.meta('mainThread'),'synthetic-progress-main');assert.equal(app.inputs.list()[0]?.state,'completed');
 }finally{await app?.close();rmSync(root,{recursive:true,force:true});}
});
