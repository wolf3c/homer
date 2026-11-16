import './fixtures/synthetic-home.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {CodexEngine,type EngineOptions} from '../src/engine.js';

function fixture(t:{after:(fn:()=>void)=>void}){
 const parent=resolve('.codex/scratch/user-home-tests');mkdirSync(parent,{recursive:true});
 const root=mkdtempSync(join(parent,'case-')),codexHome=join(root,'codex'),cwd=join(root,'work');
 for(const dir of [codexHome,cwd,join(codexHome,'host-home')])mkdirSync(dir,{recursive:true});
 writeFileSync(join(codexHome,'host-home/retain.txt'),'SYNTHETIC_LEGACY_HOME');
 writeFileSync(join(cwd,'fixture-state.json'),JSON.stringify({config:{config:{mcp_servers:{}},layers:[]}}));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const config={workspace:cwd,runtime:join(root,'runtime'),codexHome,nativeCodexHome:codexHome,codexBin:resolve('tests/fixtures/project-mcp-app-server.mjs'),model:'synthetic',requiresOpenaiAuth:false,stopGraceMs:500};
 return {root,codexHome,cwd,engine(options:Partial<EngineOptions>={}){return new CodexEngine(config,{cwd,readRoots:[],instructions:'Synthetic environment contract.',tools:[],...options},async()=>{throw Error('no_tools');});}};
}

test('Main, Worker, control and resumed engines inherit the explicit HOME while retaining their Codex profile and cwd',async t=>{
 const f=fixture(t),expectedHome=process.env.HOME;
 assert.ok(expectedHome&&expectedHome!==f.codexHome);
 for(const options of [{nativeTools:'main'},{nativeTools:'worker',role:'worker'},{controlOnly:true},{nativeTools:'main',threadId:'synthetic-resume'}] as Partial<EngineOptions>[]){
  const e=f.engine(options);
  try{
   await e.start();const info=await e.request('fixture/inspect',{});
   assert.equal(info.home,expectedHome);assert.equal(info.codexHome,f.codexHome);assert.equal(info.processCwd,f.cwd);
   assert.equal(info.userProfile,process.platform==='win32'?expectedHome:undefined);
  }finally{assert.ok(await e.close());}
 }
 assert.equal(readFileSync(join(f.codexHome,'host-home/retain.txt'),'utf8'),'SYNTHETIC_LEGACY_HOME');
});

test('missing, empty, relative, nonexistent and non-directory HOME values fail before spawning or creating a home',async t=>{
 const f=fixture(t),previous=process.env.HOME,file=join(f.root,'file'),missing=join(f.root,'missing');writeFileSync(file,'SYNTHETIC_FILE');
 try{for(const value of [undefined,'','relative-home',missing,file]){
  if(value===undefined)delete process.env.HOME;else process.env.HOME=value;
  const e=f.engine();
  try{await assert.rejects(()=>e.start(),/^Error: engine_home_unavailable$/);assert.equal(e.pid,undefined);assert.equal(existsSync(missing),false);}
  finally{await e.close();}
 }}finally{if(previous===undefined)delete process.env.HOME;else process.env.HOME=previous;}
});
