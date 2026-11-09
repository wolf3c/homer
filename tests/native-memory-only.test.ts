import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {Homer} from '../src/service.js';
import {HOST_MCP_TOOLS,WORKER_HOST_MCP_TOOLS} from '../src/worker-interaction-mcp.js';
import {MAIN_TOOLS} from '../src/tools.js';
import {RECURSIVE_TOOLS} from '../src/recursive-tools.js';
import {homerWebBridge} from '../src/web-homer.js';
import {createWebServer,fetch} from './web-connected-fixture.js';
import type {EngineOptions,ToolCall} from '../src/engine.js';

test('Homer tool catalogs expose no host memory backend',()=>{
  for(const catalog of [HOST_MCP_TOOLS,WORKER_HOST_MCP_TOOLS])
    assert.deepEqual(catalog.filter(tool=>tool.name.startsWith('memory_')||tool.name==='suggest_memory'),[]);
});

test('native service receives and resumes user work without host memory tables or injected snapshots',async()=>{
  const scratch=resolve('.codex/scratch/legacy-memory-retirement-20261022/runtime');
  mkdirSync(scratch,{recursive:true});const dir=mkdtempSync(join(scratch,'service-'));
  const config={appData:dir,codexHome:join(dir,'codex'),nativeCodexHome:join(dir,'codex'),codexBin:'/usr/bin/false',runtime:join(dir,'runtime'),workspace:join(dir,'workspace'),model:'synthetic',requiresOpenaiAuth:false,stopGraceMs:100};
  mkdirSync(config.runtime);mkdirSync(config.workspace);mkdirSync(config.codexHome);
  const starts:EngineOptions[]=[],inputs:string[]=[];
  class Peer extends EventEmitter{
    threadId='synthetic-native-only-main';turnId='';resumable=true;
    constructor(readonly handle:(call:ToolCall)=>Promise<unknown>){super();}
    async start(){return this.threadId;}
    async turn(text:string,options?:{onStarted?:(id:string)=>void}){
      this.turnId='synthetic-turn-'+inputs.length;options?.onStarted?.(this.turnId);inputs.push(text);
      await assert.rejects(()=>this.handle({threadId:this.threadId,turnId:this.turnId,callId:'retired-tool',tool:'memory_propose',arguments:{operationId:'retired',content:'Synthetic retired memory'}}));
      return {status:'completed',text:'Synthetic answer'};
    }
    async interrupt(){return true;}
    async close(){return true;}
  }
  const factory=(options:EngineOptions,handle:(call:ToolCall)=>Promise<unknown>)=>{starts.push(options);return new Peer(handle);};
  assert.throws(()=>new Homer({...config,nativeCodexHome:join(dir,'legacy-home')},async()=>{},factory),/engine_native_tools_home_required/);
  assert.equal(starts.length,0);
  let app=new Homer(config,async()=>{},factory);
  const assertNoHostMemory=()=>assert.deepEqual(app.store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name GLOB 'memory_*'").all(),[]);
  try{
    await app.start();assertNoHostMemory();
    assert.equal(await app.message('请记住：以后使用中文。','synthetic-native-only-first'),'Synthetic answer');
    assertNoHostMemory();const thread=app.store.meta('mainThread'),toolsHash=app.store.meta('mainToolsHash');
    await app.close();app=new Homer(config,async()=>{},factory);await app.start();
    assert.equal(app.store.meta('mainThread'),thread);assert.equal(app.store.meta('mainToolsHash'),toolsHash);
    assert.equal(starts.at(-1)?.threadId,thread);
    for(const options of starts)assert.deepEqual(options.tools,[...MAIN_TOOLS,...RECURSIVE_TOOLS]);
    assert.equal(await app.message('继续解释当前工作。','synthetic-native-only-next'),'Synthetic answer');
    assertNoHostMemory();assert.ok(inputs.every(text=>!text.includes('宿主记忆数据')&&!text.includes('memorySnapshot')));
    assert.equal(app.history.inputs(thread!,['synthetic-native-only-first']).get('synthetic-native-only-first')?.text,'请记住：以后使用中文。');
    const web=await createWebServer({port:0,bridge:homerWebBridge(app)});
    try{
      for(const path of ['/api/memory','/api/memory/page/0','/api/memory/export'])
        assert.equal((await fetch(web.url+path)).status,404);
      assert.equal((await fetch(web.url+'/api/memory',{method:'POST',headers:{Origin:web.url,'Content-Type':'application/json'},body:JSON.stringify({action:'correct'})})).status,404);
      assertNoHostMemory();assert.equal(inputs.length,2);
    }finally{await web.close();}
  }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
