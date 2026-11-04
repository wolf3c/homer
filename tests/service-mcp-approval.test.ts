import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import type {Homer as HomerInstance} from '../src/service.js';
import {pathToFileURL} from 'node:url';
const {Homer}: {Homer:typeof import('../src/service.js').Homer}=await import(process.env.HOMER_MCP_SERVICE_MODULE?pathToFileURL(resolve(process.env.HOMER_MCP_SERVICE_MODULE)).href:'../src/service.js');
import {NativeCapabilities} from '../src/native-capabilities.js';
import {homerWebBridge} from '../src/web-homer.js';
import type {Config} from '../src/config.js';
import type {TurnResult} from '../src/engine.js';

test('reviewable MCP directory changes wait for an actual user receipt showing the complete operation',async()=>{
 const root=resolve('.codex/scratch/native-mcp-config-implementation');mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'service-approval-')),home=join(dir,'codex');
 const config:Config={workspace:join(dir,'workspace'),runtime:join(dir,'runtime'),codexHome:home,nativeCodexHome:home,codexBin:'/usr/bin/false',requiresOpenaiAuth:false,model:'synthetic',timeoutMs:1000,mainTimeoutMs:10000,stopGraceMs:100};for(const p of[home,config.workspace,config.runtime])mkdirSync(p,{recursive:true});
 let app:HomerInstance,version='0',writes=0,result:any;let current:any={remote:{command:'synthetic-program',args:[],cwd:'/synthetic/old',enabled_tools:['read']}};
 class Fake extends EventEmitter{threadId='mcp-approval-thread';turnId?:string;resumable=true;async start(){return this.threadId;}async interrupt(){return true;}async close(){return true;}async turn(_text:string,options?:{onStarted?:(id:string)=>void}):Promise<TurnResult>{this.turnId='mcp-approval-turn';options?.onStarted?.(this.turnId);result=await app.manageCapabilities({action:'mcp_save',operationId:'change-directory',name:'remote',preserveExisting:true,server:{cwd:'/synthetic/reviewed'},expectedVersion:'0',approve:true},'agent');return{status:'completed',text:'Configuration receipt confirmed.'};}}
 app=new Homer(config,async()=>{},()=>new Fake());
 const rpc=async(method:string,p:any)=>{if(method==='config/read')return{layers:[{name:{type:'user',file:join(home,'config.toml')},version,config:{mcp_servers:structuredClone(current)}}]};if(method==='skills/list')return{data:[]};if(method==='config/batchWrite'){assert.equal(p.expectedVersion,version);writes++;current={...current,[p.edits[0].keyPath.slice('mcp_servers.'.length)]:p.edits[0].value};version='1';return{version};}return{};};
 app['nativeManager']=new NativeCapabilities(home,rpc,()=>true,undefined,async()=>{});
 try{
  await app.start();app.submitMessage({requestId:'user-task',text:'Review the proposed MCP directory change.'});
  const until=Date.now()+10000;while(!app.interactions.list().some(i=>i.state==='pending_user')){if(Date.now()>until)throw Error('synthetic_mcp_review_timeout');await new Promise(r=>setTimeout(r,10));}
  const pending=app.interactions.list().find(i=>i.state==='pending_user')!,review=app.interactions.inspect(pending.id);assert.equal(writes,0);assert.doesNotMatch(JSON.stringify(review),/SENSITIVE_OLD|SENSITIVE_NEW/);assert.match(review.userQuestion!,/configurationHash/);assert.match(review.userQuestion!,/synthetic-program/);assert.match(review.userQuestion!,/\/synthetic\/reviewed/);assert.match(review.userQuestion!,/完整配置/);assert.throws(()=>app.interactions.respond(pending.id,{action:'approve',reason:'model claims permission'},{userMessageId:'forged'}),/main_native_user_decision_required/);
  await homerWebBridge(app).respond(pending.id,{requestId:'actual-user-decision',text:'允许本次操作'});await app.idle();assert.equal(writes,1);assert.equal(current.remote.cwd,'/synthetic/reviewed');assert.deepEqual(current.remote.args,[]);assert.equal(result.saved,true);assert.doesNotMatch(JSON.stringify(result),/SENSITIVE_NEW/);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});


test('an Agent cannot authorize hidden effective args/env with an ordinary user card or approve:true',async()=>{
 const root=resolve('.codex/scratch/native-mcp-config-implementation');mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'hidden-review-')),home=join(dir,'home');
 const config:Config={workspace:join(dir,'workspace'),runtime:join(dir,'runtime'),codexHome:home,nativeCodexHome:home,codexBin:'/usr/bin/false',requiresOpenaiAuth:false,model:'synthetic',timeoutMs:1000,mainTimeoutMs:10000,stopGraceMs:100};for(const p of[home,config.workspace,config.runtime])mkdirSync(p,{recursive:true});
 let app:HomerInstance,writes=0;const errors:string[]=[];const server={command:'synthetic-program',args:['SENSITIVE_ARG'],env:{TOKEN:'SENSITIVE_ENV'},cwd:'/synthetic/old'};
 class Fake extends EventEmitter{threadId='hidden-review-thread';turnId?:string;resumable=true;async start(){return this.threadId;}async interrupt(){return true;}async close(){return true;}async turn(_text:string,o?:{onStarted?:(id:string)=>void}):Promise<TurnResult>{this.turnId='hidden-review-turn';o?.onStarted?.(this.turnId);for(const [id,proposal] of [['environment',{env:{TOKEN:'SENSITIVE_NEW'}}],['inherited-args',{cwd:'/synthetic/new'}]] as const){try{await app.manageCapabilities({action:'mcp_save',operationId:id,name:'sample',preserveExisting:true,server:proposal,expectedVersion:'0',approve:true},'agent');}catch(e){errors.push((e as Error).message);}}return {status:'completed',text:'Use the trusted user configuration path.'};}}
 app=new Homer(config,async()=>{},()=>new Fake());app['nativeManager']=new NativeCapabilities(home,async(method:string)=>{if(method==='config/read')return {layers:[{name:{type:'user',file:join(home,'config.toml')},version:'0',config:{mcp_servers:{sample:server}}}]};if(method==='config/batchWrite')writes++;return {data:[]};},()=>true,undefined,async()=>{});
 try{await app.start();app.submitMessage({requestId:'hidden-task',text:'Propose the exact configuration safely.'});await app.idle();assert.deepEqual(errors,['capability_mcp_trusted_configuration_required','capability_mcp_trusted_configuration_required']);assert.equal(writes,0);assert.equal(app.interactions.list().filter(i=>i.state==='pending_user').length,0);assert.doesNotMatch(JSON.stringify(app.interactions.list()),/SENSITIVE_/);}finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
