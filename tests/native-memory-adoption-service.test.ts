import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {Homer} from '../src/service.js';
import type {EngineOptions} from '../src/engine.js';
import {MAIN_TOOLS} from '../src/tools.js';
test('native adoption preflight exposes tools on the original main without disabling legacy protections',async()=>{
 const root=resolve('.codex/scratch/native-memory-service-tests');mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'preflight-'));
 const config={appData:dir,codexHome:join(dir,'codex'),nativeCodexHome:join(dir,'codex'),codexBin:'/usr/bin/false',runtime:join(dir,'runtime'),workspace:join(dir,'workspace'),model:'synthetic',requiresOpenaiAuth:false,timeoutMs:1000,mainTimeoutMs:1000,stopGraceMs:100,nativeMemoryTools:true};
 mkdirSync(config.runtime);mkdirSync(config.workspace);const options:EngineOptions[]=[];
 class Peer extends EventEmitter{threadId='synthetic-original-memory-main';resumable=true;async start(){return this.threadId;}async turn(){return {status:'completed',text:'synthetic'};}async close(){return true;}async interrupt(){return true;}}
 const app=new Homer(config,async()=>{},o=>{options.push(o);return new Peer();});
 try{await app.start();assert.equal(options[0]?.nativeMemory,true);assert.equal(app.memory.settings().enabled,true);assert.equal(app.memory.settings().autoSave,true);assert.deepEqual(options[0]?.tools,MAIN_TOOLS);assert.doesNotMatch(options[0]!.instructions,/记忆验收|原生记忆边界/);}finally{await app.close();}
});
test('native backend replaces host facts, legacy writes and tools on the same main thread',async()=>{
 const root=resolve('.codex/scratch/native-memory-service-tests');mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'backend-'));
 const base={appData:dir,codexHome:join(dir,'codex'),nativeCodexHome:join(dir,'codex'),codexBin:'/usr/bin/false',runtime:join(dir,'runtime'),workspace:join(dir,'workspace'),model:'synthetic',requiresOpenaiAuth:false,timeoutMs:1000,mainTimeoutMs:1000,stopGraceMs:100};
 mkdirSync(base.runtime);mkdirSync(base.workspace);const options:EngineOptions[]=[];let received='';
 class Peer extends EventEmitter{threadId='synthetic-original-memory-main';resumable=true;async start(){return this.threadId;}async turn(text:string){received=text;return {status:'completed',text:'synthetic'};}async close(){return true;}async interrupt(){return true;}}
 const factory=(o:EngineOptions)=>{options.push(o);return new Peer();};
 const old=new Homer(base,async()=>{},factory);await old.start();
 old.store.db.prepare("INSERT INTO memory_entries VALUES('legacy',?,'owner',?,'preference','preference.language','PRIVATE-LEGACY-SYNTHETIC','active',1,1,1)").run(old.memory.ownerId,old.memory.ownerId);
 await old.close();options.length=0;
 const app=new Homer({...base,memoryBackend:'native',nativeMemoryBackground:'native'},async()=>{},factory);
 try{
  await app.start();assert.equal(app.store.meta('mainThread'),'synthetic-original-memory-main');assert.equal(options[0]?.threadId,'synthetic-original-memory-main');assert.equal(options[0]?.nativeMemory,true);
  assert.equal(options[0]!.interactionMcp!.catalog!.some(t=>t.name.startsWith('memory_')),false);
  assert.doesNotMatch(options[0]!.instructions,/唯一长期记忆来源|记忆边界/);assert.doesNotMatch(options[0]!.instructions,/memory_propose|宿主拥有唯一长期记忆/);
  await app.message('请记住：合成输入。');assert.doesNotMatch(received,/PRIVATE-LEGACY|宿主记忆数据/);
  assert.equal(app.store.db.prepare('SELECT count(*) n FROM memory_jobs').get()!.n,0);assert.equal(app.store.db.prepare('SELECT count(*) n FROM memory_entries').get()!.n,1);
  await assert.rejects(()=>app.manageMemory({action:'correct'}),/native_tools_required/);
  await assert.rejects(()=>(app as any).memoryTool('memory_propose',{}),/native_tools_required/);
  assert.equal(app.store.db.prepare('SELECT count(*) n FROM memory_operations').get()!.n,0);
 }finally{await app.close();}
 assert.equal(options.some(o=>o.instructions.includes('唯一长期记忆来源')),false);
});
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
 const old=new Homer(base,async()=>{},factory);await old.start();await old.close();
 const app=new Homer({...base,memoryBackend:'native',nativeMemoryBackground:'native'},async()=>{},factory);
 try{
  await app.start();await app.message('dispatch');const deadline=Date.now()+3000;
  while(!peers.some(p=>p.options.tools.some(t=>t.name==='read_material'))){assert.ok(Date.now()<deadline);await new Promise(r=>setTimeout(r,10));}
  const worker=peers.find(p=>p.options.tools.some(t=>t.name==='read_material'))!;assert.doesNotMatch(worker.options.instructions,/suggest_memory|宿主为当前事项选择的有限快照/);assert.equal(worker.options.nativeMemory,undefined);assert.equal(worker.options.tools.some(t=>t.name==='suggest_memory'),false);
  const notes=join(home,'memories/extensions/ad_hoc/notes');mkdirSync(notes,{recursive:true});writeFileSync(join(notes,'withdrawal.md'),'Synthetic withdrawal');
  const run=app.store.runs()[0]!;await new Promise(r=>setTimeout(r,40));
  assert.equal(app.store.run(run.id)!.stopReason,null);
  await worker.call('read_material',{});
  await worker.call('write_markdown',{filename:'answer.md',content:'# Synthetic result'});
  worker.release?.({status:'completed',text:'Synthetic finished'});
  await app.idle();assert.equal(app.store.runs().length,1);assert.equal(app.store.run(run.id)!.status,'succeeded');
 }finally{await app.close();}
});
