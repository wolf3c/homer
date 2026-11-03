// Real Homer scheduler/contracts/tools, synthetic engines, real local commands.
// No account, external provider, production project, or shared dependency writes.
import test from 'node:test';import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';import {execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync} from 'node:fs';import {join,resolve} from 'node:path';
import {Homer} from '../src/service.js';import {profileOverrides,type EngineOptions,type ToolCall} from '../src/engine.js';
test('main and peer Workers select independent accessible directories with unchanged permissions',async()=>{
 const root=resolve('.codex/scratch/flexible-execution-review');mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'runner-directories-'));
 const [a,b,c]=['A','B','C'].map(name=>join(dir,name)) as [string,string,string];for(const p of[a,b,c]){mkdirSync(p);writeFileSync(join(p,'AGENTS.md'),'Synthetic rules for '+p.split('/').at(-1));writeFileSync(join(p,'project.test.mjs'),"import test from 'node:test';import assert from 'node:assert/strict';test('synthetic project',()=>assert.equal(2+2,4));");}
 const config={appData:dir,workspace:a,runtime:join(dir,'runtime'),codexHome:join(dir,'codex'),codexBin:'/usr/bin/false',model:'synthetic',requiresOpenaiAuth:false,timeoutMs:10000,mainTimeoutMs:10000,stopGraceMs:100};mkdirSync(config.runtime);mkdirSync(config.codexHome);
 const seen:{goal:string;cwd:string}[]=[],profiles:unknown[]=[];let app:Homer,seq=0,childId='',rootRun='',parentTurns=0;
 const contract=(goal:string)=>({goal,inputs:[],resultKind:'structured',acceptance:{criteria:[{id:'tested',required:true,description:'Local project test passes'}]}});
 class Peer extends EventEmitter{
  threadId:string;turnId='';resumable=true;
  constructor(readonly options:EngineOptions,readonly handler:(call:ToolCall)=>Promise<unknown>){super();this.threadId=options.threadId??'synthetic-'+ ++seq;profiles.push(profileOverrides(config,options));}
  async start(){return this.threadId;}async close(){return true;}async interrupt(){return true;}
  call(tool:string,args:unknown){return this.handler({threadId:this.threadId,turnId:this.turnId,callId:'call-'+ ++seq,tool,arguments:args});}
  async turn(text:string,hooks?:{cwd?:string;onStarted?:(id:string)=>void}){
   this.turnId='turn-'+ ++seq;hooks?.onStarted?.(this.turnId);
   if(this.options.nativeTools==='main'){
    if(text==='Synthetic directory work'){
     const root=await this.call('task_delegate',{operationId:'root',parentTaskId:null,parentVersion:null,expectedTaskRevision:null,title:'Synthetic projects',executorKind:'main',contract:{...contract('projects'),resultKind:'aggregate'},dependencies:[]}) as {taskId:string};
     for(const [goal,cwd]of [['parent',a],['child',b],['independent',c]] as const){const t=app.tasks.task(root.taskId);const worker=await this.call('task_delegate',{operationId:'worker-'+goal,parentTaskId:root.taskId,parentVersion:1,expectedTaskRevision:t.revision,title:goal,executorKind:'worker',contract:{...contract(goal!),workingDirectory:cwd},dependencies:[]}) as {taskId:string};if(goal==='child')childId=worker.taskId;}
    }
    return {status:'completed',text:'Synthetic main returned'};
   }
   const payload=JSON.parse(text),run=app.tasks.run(payload.runId),task=app.tasks.task(run.taskId),cwd=hooks?.cwd!;seen.push({goal:payload.goal,cwd});
   assert.equal(readFileSync(join(cwd,'AGENTS.md'),'utf8'),'Synthetic rules for '+cwd.split('/').at(-1));
   profiles.push(profileOverrides(config,{...this.options,cwd}));
   const local=(path:string,name:string)=>{execFileSync(process.execPath,['-e',"require('node:fs').writeFileSync(process.argv[1],'synthetic')",name],{cwd:path,stdio:'ignore'});execFileSync(process.execPath,['--test','project.test.mjs'],{cwd:path,stdio:'ignore'});};
   if(payload.goal==='parent'&&parentTurns++===0){
    rootRun=run.id;local(cwd,'worker-edit.txt');
    await assert.rejects(()=>this.call('file_checkpoint',{action:'capture',id:null,paths:[process.execPath]}),/checkpoint_protected_path/);
    await assert.rejects(()=>this.call('work_directory',{path:config.runtime,taskId:null}),/workspace_invalid/);
    await this.call('work_directory',{path:b,taskId:null});assert.equal(app.store.meta('mainWorkingDirectory'),undefined);
    const deadline=Date.now()+4000;while(!childId){assert.ok(Date.now()<deadline,'main creates the peer');await new Promise(r=>setTimeout(r,5));}
    await this.call('task_wait',{operationId:'wait',taskId:task.id,version:1,expectedTaskRevision:app.tasks.task(task.id).revision,condition:{type:'result_or_terminal',taskId:childId,version:1,messageId:null,replyTo:null}});
   }else{
    if(payload.goal==='child'){assert.equal(cwd,b);await this.call('work_directory',{path:c,taskId:null});local(c,'peer-edit.txt');assert.equal(app.tasks.workingDirectory(rootRun),b);}
    else local(cwd,'finished-edit.txt');

   }
   return {status:'completed',text:'Synthetic Worker returned'};
  }
 }
 app=new Homer(config,async()=>{},(options,handler)=>new Peer(options,handler));try{
  await app.start();await app.message('Synthetic directory work');await app.idle();
  assert.deepEqual(seen.filter(x=>x.goal==='parent').map(x=>x.cwd),[a,b]);assert.equal(seen.find(x=>x.goal==='independent')?.cwd,c);
  assert.equal(readFileSync(join(a,'worker-edit.txt'),'utf8'),'synthetic');assert.equal(readFileSync(join(c,'peer-edit.txt'),'utf8'),'synthetic');
  assert.ok(profiles.length>=5);for(const profile of profiles)assert.deepEqual(profile,profiles[0]);
  assert.equal((profiles[0] as any).filesystem[config.runtime],'deny');assert.equal((profiles[0] as any).filesystem[config.codexHome],'deny');
  assert.equal(app.interactions.list().length,0);assert.equal(app.tasks.run(rootRun).phase,'ended');assert.equal(app.store.meta('mainWorkingDirectory'),undefined);
 }finally{await app.close();}
});
