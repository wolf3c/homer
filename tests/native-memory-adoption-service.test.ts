import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {Homer} from '../src/service.js';
import type {EngineOptions} from '../src/engine.js';
test('native change leaves a live Worker running and permits its authorized result',async()=>{
 const root=resolve('.codex/scratch/native-memory-service-tests');mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'worker-'));
 const home=join(dir,'codex'),runtime=join(dir,'runtime'),workspace=join(dir,'workspace');mkdirSync(runtime);mkdirSync(join(workspace,'materials'),{recursive:true});
 const {writeFileSync}=await import('node:fs');writeFileSync(join(workspace,'materials/sample.md'),'Synthetic');
 const base={appData:dir,codexHome:home,nativeCodexHome:home,codexBin:'/usr/bin/false',runtime,workspace,model:'synthetic',requiresOpenaiAuth:false,timeoutMs:5000,mainTimeoutMs:1000,stopGraceMs:100};
 const peers:Peer[]=[];let serial=0;
 class Peer extends EventEmitter{
  threadId:string;turnId='';resumable=true;release?:(r:any)=>void;
  constructor(readonly options:EngineOptions,readonly handler:(c:any)=>Promise<unknown>){super();this.threadId=options.threadId??'synthetic-'+peers.length;peers.push(this);}
  async start(){return this.threadId;}
  async call(tool:string,args:unknown){const callId='synthetic-call-'+ ++serial,result=await this.handler({threadId:this.threadId,turnId:this.turnId,callId,tool,arguments:args});this.emit('toolResponse',callId);return result;}
  async turn(text:string,o?:{onStarted?:(id:string)=>void}){
   this.turnId='synthetic-turn-'+ ++serial;o?.onStarted?.(this.turnId);
   if(this.options.tools.some(t=>t.name==='read_material'))return new Promise<any>(r=>this.release=r);
   if(text==='dispatch'){
    const task=await this.call('task_create',{title:'Synthetic',goal:'Synthetic authorized file'}) as {taskId:string};
    await this.call('worker_open',{taskId:task.taskId,message:'Read materials/sample.md and write the synthetic result.'});
   }
   if(text.startsWith('[内部协作输入')){
    const input=JSON.parse(text.split('\n')[1]!);
    if(input.kind==='worker_reply'){
     const reply=await this.call('worker_read',{workerId:input.workerId,messageId:input.messageId}) as {messages:{text:string}[]};
     const filePath=reply.messages[0]!.text.trim().split('\n').at(-1);
     const result=await this.call('accept_result',{runId:input.runId,messageId:input.messageId,filePath}) as {resultId:string};
     await this.call('work_inspect',{resultId:result.resultId});
    }
   }
   return {status:'completed',text:'Synthetic'};
  }
  async interrupt(){this.release?.({status:'interrupted',text:''});return true;}async close(){await this.interrupt();return true;}
 }
 const factory=(o:EngineOptions,h:(c:any)=>Promise<unknown>)=>new Peer(o,h);
 const app=new Homer(base,async()=>{},factory);
 try{
  await app.start();await app.message('dispatch');const deadline=Date.now()+3000;
  while(!peers.some(p=>p.options.tools.some(t=>t.name==='read_material'))){assert.ok(Date.now()<deadline);await new Promise(r=>setTimeout(r,10));}
  const worker=peers.find(p=>p.options.tools.some(t=>t.name==='read_material'))!;assert.doesNotMatch(worker.options.instructions,/suggest_memory|宿主为当前事项选择的有限快照/);assert.equal(worker.options.tools.some(t=>t.name==='suggest_memory'),false);
  const notes=join(home,'memories/extensions/ad_hoc/notes');mkdirSync(notes,{recursive:true});writeFileSync(join(notes,'withdrawal.md'),'Synthetic withdrawal');
  const run=app.store.runs()[0]!;await new Promise(r=>setTimeout(r,40));
  assert.equal(app.store.run(run.id)!.stopReason,null);
  await worker.call('read_material',{});
  const file=await worker.call('write_markdown',{filename:'answer.md',content:'# Synthetic result'}) as {path:string};
  worker.release?.({status:'completed',text:'Synthetic finished\n'+file.path});
  await app.idle();assert.equal(app.store.runs().length,1);assert.equal(app.store.run(run.id)!.status,'succeeded');
  const results=app.tasks.readTask({agentId:app.store.meta('mainAgentId')!},run.taskId).results;
  assert.equal(results.length,1);assert.equal(results[0]!.runId,run.id);assert.equal(results[0]!.version,run.version);assert.equal(results[0]!.state,'accepted');
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
