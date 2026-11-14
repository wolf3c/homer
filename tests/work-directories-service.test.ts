import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,realpathSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {Homer} from '../src/service.js';
import {hostMcpTools,WorkerInteractionMcp} from '../src/worker-interaction-mcp.js';
import {callHostMcp,mcpCall} from './fixtures/host-mcp-call.js';
import type {EngineOptions,TurnResult} from '../src/engine.js';
import {INTERACTION_LIMITS} from '../src/interaction-limits.js';

test('new and resumed Main query locations without selecting cwd; Worker endpoint rejects the same call',async()=>{
 const parent=resolve('.codex/scratch/work-directories-service');mkdirSync(parent,{recursive:true});const root=realpathSync(mkdtempSync(join(parent,'case-'))),home=join(root,'user'),workspace=join(root,'workspace'),runtime=join(root,'runtime'),codex=join(root,'codex');
 for(const p of [home,workspace,runtime,codex,join(home,'Projects/atlas')])mkdirSync(p,{recursive:true});writeFileSync(join(home,'Projects/atlas/AGENTS.md'),'do not read body');
 const config={workspace,runtime,codexHome:codex,nativeCodexHome:codex,codexBin:'/usr/bin/false',model:'synthetic',requiresOpenaiAuth:false,stopGraceMs:100};
 let options!:EngineOptions;const resumes:(string|undefined)[]=[],results:any[]=[];
 class Peer extends EventEmitter{threadId='directory-main';turnId?:string;async start(){return this.threadId;}async close(){return true;}async interrupt(){return true;}async request(){return {};}
  async turn(_text:string,o?:{onStarted?:(id:string)=>void}):Promise<TurnResult>{this.turnId='directory-turn';o?.onStarted?.(this.turnId);results.push(await callHostMcp(options,'list_work_directories',{}));await assert.rejects(callHostMcp(options,'list_work_directories',{path:home}),/invalid_tool_arguments/);return {status:'completed',text:'Read-only query complete.'};}}
 const create=()=>new Homer(config,async()=>{},o=>{options=o;resumes.push(o.threadId);return new Peer();},[],async()=>({home,folders:[]}));
 let app=create();const worker=new WorkerInteractionMcp(runtime,async()=>{assert.fail('Worker must not dispatch this tool');},hostMcpTools('worker'));
 try{
  await worker.start();assert.equal((await mcpCall(worker.path,'list_work_directories',{})).error,'interaction_tool_denied');
  for(let i=0;i<2;i++){
   await app.start();assert.equal(options.tools.some(t=>t.name==='list_work_directories'),false);
   app.submitMessage({requestId:'directory-query-'+i,text:'Locate the atlas work directory.'});await app.idle();
   assert.equal(results.length,i+1);assert.equal(results[i].complete,true);assert.match(results[i].directoryReference,/atlas/);
   assert.equal(app.store.meta('mainWorkingDirectory'),undefined);assert.equal(options.cwd,workspace);
   await assert.rejects(callHostMcp(options,'list_work_directories',{}),/tool_scope_denied/);
   await app.close();if(i===0)app=create();
  }
  assert.deepEqual(resumes,[undefined,'directory-main']);
 }finally{await app.close();await worker.close();rmSync(root,{recursive:true,force:true});}
});

test('an interrupted Main query stops before traversal and cannot deliver a stale reference',async()=>{
 const parent=resolve('.codex/scratch/work-directories-service');mkdirSync(parent,{recursive:true});const root=realpathSync(mkdtempSync(join(parent,'expired-')));
 for(const name of ['workspace','runtime','codex','user'])mkdirSync(join(root,name));
 const config={workspace:join(root,'workspace'),runtime:join(root,'runtime'),codexHome:join(root,'codex'),nativeCodexHome:join(root,'codex'),codexBin:'/usr/bin/false',model:'synthetic',requiresOpenaiAuth:false,stopGraceMs:100};
 let options!:EngineOptions,release!:(facts:{home:string;folders:string[]})=>void,entered!:()=>void;
 const queried=new Promise<void>(r=>entered=r),facts=new Promise<{home:string;folders:string[]}>(r=>release=r);let error:string|undefined;
 class Peer extends EventEmitter{threadId='expired-directory';turnId?:string;async start(){return this.threadId;}async close(){return true;}async interrupt(){return true;}
  async turn(_text:string,o?:{onStarted?:(id:string)=>void}):Promise<TurnResult>{this.turnId='expired-turn';o?.onStarted?.(this.turnId);try{await callHostMcp(options,'list_work_directories',{});assert.fail('stale result delivered');}catch(e){error=(e as Error).message;}return {status:'completed',text:'Stopped query.'};}}
 const app=new Homer(config,async()=>{},o=>{options=o;return new Peer();},[],()=>{entered();return facts;});
 try{
  await app.start();app.submitMessage({requestId:'expire-query',text:'Locate a project.'});await queried;
  await app.stopMain(app.conversationControlState().activeMessageId!);release({home:join(root,'user'),folders:[]});await app.idle();
  assert.equal(error,'work_directories_incomplete');assert.equal(app.store.meta('mainWorkingDirectory'),undefined);
 }finally{release({home:join(root,'user'),folders:[]});await app.close();rmSync(root,{recursive:true,force:true});}
});

test('directory results retain the existing MCP transport guard and fail rather than truncate',async()=>{
 const parent=resolve('.codex/scratch/work-directories-service');mkdirSync(parent,{recursive:true});const root=realpathSync(mkdtempSync(join(parent,'transport-')));
 const endpoint=new WorkerInteractionMcp(root,async()=>({directoryReference:'x'.repeat(INTERACTION_LIMITS.responseBytes+1),complete:true}),hostMcpTools('main'));
 try{await endpoint.start();assert.deepEqual(await mcpCall(endpoint.path,'list_work_directories',{}),{error:'interaction_response_too_large'});}
 finally{await endpoint.close();rmSync(root,{recursive:true,force:true});}
});
