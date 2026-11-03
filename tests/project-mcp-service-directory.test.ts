import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync,mkdirSync,rmSync,realpathSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const {Homer}: {Homer:typeof import('../src/service.js').Homer}=await import(process.env.HOMER_MCP_SERVICE_MODULE?pathToFileURL(resolve(process.env.HOMER_MCP_SERVICE_MODULE)).href:'../src/service.js');
import type {EngineOptions,ToolCall,TurnResult} from '../src/engine.js';
import type {Config} from '../src/config.js';

test('normal Homer starts and first turns at one CWD; work_directory changes only after a native turn exists',async()=>{
 const root=resolve('.codex/scratch/native-mcp-config-implementation');mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'normal-directory-')),home=join(dir,'home'),workspace=join(dir,'work'),target=join(dir,'other');for(const p of [home,workspace,target,join(dir,'runtime')])mkdirSync(p);
 const config:Config={workspace,runtime:join(dir,'runtime'),codexHome:home,nativeCodexHome:home,codexBin:'/usr/bin/false',model:'synthetic',requiresOpenaiAuth:false,timeoutMs:1000,mainTimeoutMs:10000,stopGraceMs:100};
 const calls:{cwd?:string;resumableBefore:boolean}[]=[];let handle!:(c:ToolCall)=>Promise<unknown>,options!:EngineOptions,selected:any;
 class Peer extends EventEmitter{threadId='normal-directory-thread';turnId?:string;resumable=false;async start(){return this.threadId;}async close(){return true;}async interrupt(){return true;}async turn(_text:string,o?:{cwd?:string;onStarted?:(id:string)=>void}):Promise<TurnResult>{calls.push({cwd:o?.cwd,resumableBefore:this.resumable});this.turnId='normal-directory-turn-'+calls.length;this.resumable=true;o?.onStarted?.(this.turnId);if(calls.length===1)selected=await handle({threadId:this.threadId,turnId:this.turnId,callId:'choose-directory',tool:'work_directory',arguments:{path:realpathSync(target)}});return {status:'completed',text:'Directory selection recorded.'};}}
 const app=new Homer(config,async()=>{},(o,h)=>{options=o;handle=h;return new Peer();});
 try{await app.start();assert.equal(options.cwd,realpathSync(workspace));app.submitMessage({requestId:'first-directory-task',text:'Use the other project next.'});await app.idle();assert.equal(selected.effective,'next_native_turn');assert.equal(app.store.meta('mainWorkingDirectory'),realpathSync(target));app.submitMessage({requestId:'second-directory-task',text:'Continue at the chosen project.'});await app.idle();assert.deepEqual(calls,[{cwd:realpathSync(workspace),resumableBefore:false},{cwd:realpathSync(target),resumableBefore:true}]);}finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
