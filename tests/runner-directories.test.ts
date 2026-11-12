import {callHostMcp} from './fixtures/host-mcp-call.js';
// Actual scheduler/tools/profiles and isolated local Node commands; no account or external provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {Homer} from '../src/service.js';
import {type EngineOptions,type ToolCall} from '../src/engine.js';
import {until} from './fixtures/worker-chat-host.js';

test('Main and peer Workers select independent accessible directories without expanding permissions',async()=>{
 const scratch=resolve('.codex/scratch/e-dirs');mkdirSync(scratch,{recursive:true});const dir=mkdtempSync(join(scratch,'case-'));
 const [a,b,c]=['A','B','C'].map(name=>join(dir,name)) as [string,string,string];
 for(const path of [a,b,c]){
  mkdirSync(path);writeFileSync(join(path,'AGENTS.md'),'Synthetic rules for '+path.split('/').at(-1));
  writeFileSync(join(path,'project.test.mjs'),"import test from 'node:test';import assert from 'node:assert/strict';test('synthetic project',()=>assert.equal(2+2,4));");
 }
 const config={appData:dir,workspace:a,runtime:join(dir,'runtime'),codexHome:join(dir,'codex'),nativeCodexHome:join(dir,'codex'),codexBin:'/usr/bin/false',model:'synthetic',requiresOpenaiAuth:false,stopGraceMs:100};
 mkdirSync(config.runtime);mkdirSync(config.codexHome);
 const seen:{assignment:string;cwd:string}[]=[];let app:Homer,seq=0,parentWorker='',parentRun='',parentSelected=false,followed=false;let legacyResult:unknown;
 class Peer extends EventEmitter{
  threadId:string;turnId='';resumable=true;
  constructor(readonly options:EngineOptions,readonly handler:(call:ToolCall)=>Promise<unknown>){super();this.threadId=options.threadId??'synthetic-'+ ++seq;}
  async start(){return this.threadId;}async close(){return true;}async interrupt(){return true;}
  async call(tool:string,args:unknown):Promise<any>{return this.handler({threadId:this.threadId,turnId:this.turnId,callId:'call-'+ ++seq,tool,arguments:args});}
  async turn(text:string,hooks?:{cwd?:string;onStarted?:(id:string)=>void}){
   this.turnId='turn-'+ ++seq;hooks?.onStarted?.(this.turnId);
   if(this.options.role!=='worker'){
    if(text==='Synthetic directory work'){
     await assert.rejects(()=>this.call('worker_open',{message:'Managed runtime',workingDirectory:config.runtime}),/workspace_invalid/);
     assert.equal(app.tasks.tasks().length,0);
     let taskId:string|undefined;
     for(const [assignment,cwd] of [['parent',a],['child',b],['independent',c]] as const){
      const worker=await this.call('worker_open',{...(taskId?{taskId}:{}),message:assignment,workingDirectory:cwd});
      taskId=worker.taskId;
      if(assignment==='parent')parentWorker=worker.workerId;
     }
     return {status:'completed',text:'Synthetic main returned'};
    }
    const notice=JSON.parse(text.split('\n')[1]!);
    if(notice.kind==='worker_reply'&&notice.workerId===parentWorker&&!followed){followed=true;await this.call('worker_send',{workerId:parentWorker,message:'parent-followup'});}
    return {status:'completed',text:''};
   }
   const payload=JSON.parse(text.split('\n')[1]!),marker='[主 Agent 本次消息原文]\n',assignment=text.slice(text.indexOf(marker)+marker.length),run=app.tasks.run(payload.runId),cwd=hooks?.cwd!;
   seen.push({assignment,cwd});assert.equal(readFileSync(join(cwd,'AGENTS.md'),'utf8'),'Synthetic rules for '+cwd.split('/').at(-1));
   const local=(path:string,name:string)=>{
    execFileSync(process.execPath,['-e',"require('node:fs').writeFileSync(process.argv[1],'synthetic')",name],{cwd:path,stdio:'ignore'});
    const env={...process.env};delete env.NODE_TEST_CONTEXT;
    const output=execFileSync(process.execPath,['--test','project.test.mjs'],{cwd:path,stdio:'pipe',env}).toString();
    assert.match(output,/# tests [1-9]\d*/);
   };
   if(assignment==='parent'){
    parentRun=run.id;local(cwd,'worker-edit.txt');
    legacyResult=await this.call('work_directory',{path:b,taskId:null}).catch(error=>error.message);
    await assert.rejects(()=>callHostMcp(this.options, 'work_directory',{path:config.runtime,taskId:null}),/workspace_invalid/);
    await callHostMcp(this.options, 'work_directory',{path:b,taskId:null});parentSelected=true;
    assert.equal(app.store.meta('mainWorkingDirectory'),undefined);
   }else if(assignment==='child'){
    assert.equal(cwd,b);await callHostMcp(this.options, 'work_directory',{path:c,taskId:null});local(c,'peer-edit.txt');
    await until(()=>parentSelected);assert.equal(app.tasks.workingDirectory(parentRun),b);
   }else local(cwd,'finished-edit.txt');
   return {status:'completed',text:'Synthetic '+assignment+' returned'};
  }
 }
 app=new Homer(config,async()=>{},(options,handler)=>new Peer(options,handler));
 try{
  await app.start();await app.message('Synthetic directory work');await app.idle();
  assert.equal(legacyResult,'worker_tool_denied');
  assert.deepEqual(seen.filter(row=>row.assignment.startsWith('parent')).map(row=>row.cwd),[a,b]);assert.equal(seen.find(row=>row.assignment==='independent')?.cwd,c);
  assert.equal(readFileSync(join(a,'worker-edit.txt'),'utf8'),'synthetic');assert.equal(readFileSync(join(c,'peer-edit.txt'),'utf8'),'synthetic');
  assert.equal(readFileSync(join(b,'finished-edit.txt'),'utf8'),'synthetic');
  assert.equal(app.interactions.list().length,0);assert.equal(app.tasks.run(parentRun).phase,'ended');assert.equal(app.store.meta('mainWorkingDirectory'),undefined);
  const runs=app.tasks.runs(undefined,parentWorker);assert.equal(runs.length,2);assert.equal(runs[0]!.threadId,runs[1]!.threadId);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
