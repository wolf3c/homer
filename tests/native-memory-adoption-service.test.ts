import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {Homer} from '../src/service.js';
import type {EngineOptions} from '../src/engine.js';
test('native change leaves a live Worker running and permits its authorized result',async()=>{
 const root=resolve('.codex/scratch/native-memory-service-tests');mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'worker-'));
 const home=join(dir,'codex'),runtime=join(dir,'runtime'),workspace=join(dir,'workspace');mkdirSync(runtime);mkdirSync(join(workspace,'materials'),{recursive:true});
 const {writeFileSync}=await import('node:fs');writeFileSync(join(workspace,'materials/sample.md'),'Synthetic');
 const base={appData:dir,codexHome:home,nativeCodexHome:home,codexBin:'/usr/bin/false',runtime,workspace,model:'synthetic',requiresOpenaiAuth:false,timeoutMs:5000,mainTimeoutMs:1000,stopGraceMs:100};
 const peers:Peer[]=[];
 class Peer extends EventEmitter{
  threadId:string;turnId='';resumable=true;release?:(r:any)=>void;
  constructor(readonly options:EngineOptions,readonly handler:(c:any)=>Promise<unknown>){super();this.threadId=options.threadId??'synthetic-'+peers.length;peers.push(this);}
  async start(){return this.threadId;}
  async call(tool:string,args:unknown){return this.handler({threadId:this.threadId,turnId:this.turnId,callId:'synthetic-call',tool,arguments:args});}
  async turn(text:string,o?:{onStarted?:(id:string)=>void}){this.turnId='synthetic-turn-'+Date.now();o?.onStarted?.(this.turnId);if(this.options.tools.some(t=>t.name==='read_material'))return new Promise<any>(r=>this.release=r);if(text==='dispatch')await this.call('dispatch_work',{title:'Synthetic',goal:'Synthetic',material:'sample.md'});if(text.startsWith('[执行结果待审阅]')){const id=text.match(/runId=([\w-]+)/)![1]!;await this.call('inspect_run',{runId:id});await this.call('review_artifact',{runId:id,accepted:true,summary:'Synthetic checked',reason:'Synthetic test passed'});}return {status:'completed',text:'Synthetic'};}
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
  await worker.call('write_markdown',{filename:'answer.md',content:'# Synthetic result'});
  worker.release?.({status:'completed',text:'Synthetic finished'});
  await app.idle();assert.equal(app.store.runs().length,1);assert.equal(app.store.run(run.id)!.status,'succeeded');
 }finally{await app.close();}
});
