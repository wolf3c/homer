import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {CodexEngine} from '../src/engine.js';
import type {Config} from '../src/config.js';

async function startContext(role:'main'|'worker',config:Record<string,unknown>={},resumed=false,chatgpt=true){
 const parent=resolve('.codex/scratch/main-context');mkdirSync(parent,{recursive:true});
 const root=mkdtempSync(join(parent,'case-')),cwd=join(root,'work'),home=join(root,'codex');for(const path of [cwd,home])mkdirSync(path);
 writeFileSync(join(cwd,'fixture-state.json'),JSON.stringify({config:{config:{mcp_servers:{},...config},layers:[{name:{type:'user',file:join(home,'config.toml')},version:'synthetic-context',disabledReason:null,config}]}}));
 const engine=new CodexEngine({workspace:cwd,runtime:join(root,'runtime'),codexHome:home,nativeCodexHome:home,codexBin:resolve('tests/fixtures/project-mcp-app-server.mjs'),model:'gpt-6.1-terra',requiresOpenaiAuth:true,fast:false,stopGraceMs:500,...(chatgpt?{desktopModelSource:'codex',pauseOldDesktopWork:true,desktopResources:{} as Config['desktopResources']}:{})},{cwd,role,nativeTools:role,...(resumed?{threadId:'saved-main'}:{}),readRoots:[],instructions:'Synthetic Main context contract.',tools:[]},async()=>{throw Error('no_model_tools');});
 try{await engine.start();const info=await engine.request('fixture/inspect',{});return {argv:info.argv,params:info.calls.find((call:any)=>call.method===(resumed?'thread/resume':'thread/start')).params};}
 finally{assert.ok(await engine.close());rmSync(root,{recursive:true,force:true});}
}

for(const resumed of [false,true])test('ChatGPT Main leaves automatic compaction and the model window to native defaults: '+(resumed?'resumed':'new'),async()=>{
 const {params,argv}=await startContext('main',{},resumed);
 assert.equal(Object.hasOwn(params.config,'model_auto_compact_token_limit'),false);
 assert.equal(Object.hasOwn(params.config,'model_auto_compact_token_limit_scope'),false);
 assert.equal(Object.hasOwn(params.config,'model_context_window'),false);
 assert.equal(argv.some((arg:string)=>arg.startsWith('model_context_window=')||arg.startsWith('model_catalog_json=')),false);
 if(resumed)assert.equal(params.threadId,'saved-main');
});

test('Main preserves an explicitly selected native compaction limit and scope',async()=>{
 const {params}=await startContext('main',{model_auto_compact_token_limit:150000,model_auto_compact_token_limit_scope:'body_after_prefix'},true);
 assert.equal(Object.hasOwn(params.config,'model_auto_compact_token_limit'),false);
 assert.equal(Object.hasOwn(params.config,'model_auto_compact_token_limit_scope'),false);
});

test('Main does not replace an explicit native scope with an unrelated default limit',async()=>{
 const {params}=await startContext('main',{model_auto_compact_token_limit_scope:'body_after_prefix'});
 assert.equal(Object.hasOwn(params.config,'model_auto_compact_token_limit'),false);
});

test('Worker and non-ChatGPT providers keep their existing context policy',async()=>{
 for(const [role,chatgpt] of [['worker',true],['main',false]] as const){
  const {params}=await startContext(role,{},false,chatgpt);
  assert.equal(Object.hasOwn(params.config,'model_auto_compact_token_limit'),false);
  assert.equal(Object.hasOwn(params.config,'model_auto_compact_token_limit_scope'),false);
 }
});
