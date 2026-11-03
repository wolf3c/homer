import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolve,join} from 'node:path';
import {mkdirSync,mkdtempSync,rmSync,copyFileSync,writeFileSync,readFileSync,constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {CodexEngine} from '../src/engine.js';
import type {Config} from '../src/config.js';

test('native memory tools are available to main and Worker without extraction overrides',async()=>{
 const root=resolve('.codex/scratch/native-memory-engine-tests');mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'contract-'));const home=join(dir,'codex');mkdirSync(home);
 const config:Config={workspace:join(dir,'workspace'),runtime:join(dir,'runtime'),codexHome:home,nativeCodexHome:home,codexBin:resolve('tests/fixtures/native-feature-app-server.mjs'),model:'synthetic-memory',requiresOpenaiAuth:false,timeoutMs:1500,mainTimeoutMs:1500,stopGraceMs:100};
 mkdirSync(config.workspace);mkdirSync(config.runtime);
 for(const role of ['main','worker'] as const){const engine=new CodexEngine(config,{cwd:config.workspace,readRoots:[],instructions:'Synthetic product method.',tools:[],nativeCapabilities:true,nativeTools:role},async()=>({}));try{
  await engine.start();const r=await engine.request('synthetic/inspect',{});
  assert.equal(r.threadParams.config['features.memories'],true);assert.equal(r.threadParams.config['memories.dedicated_tools'],true);
  for(const key of ['memories.generate_memories','memories.use_memories','memories.extract_model','memories.version'])assert.equal(r.argv.some((x:string)=>x.startsWith(key+'=')),false);
 }finally{await engine.close();}}
 rmSync(dir,{recursive:true,force:true});
});
test('daily DeepSeek keeps native memory tools while disabling background memory generation',async()=>{
 const root=resolve('.codex/scratch/native-memory-engine-tests');mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'daily-'));const home=join(dir,'codex');mkdirSync(home);
 // Daily model selection now validates the trusted desktop boundary in Engine.
 // Use a complete synthetic resource identity rather than an invalid daily flag.
 const bundleRoot=join(dir,'Synthetic.app'),mac=join(bundleRoot,'Contents/MacOS'),resources=join(bundleRoot,'Contents/Resources'),originalExecPath=process.execPath;
 mkdirSync(mac,{recursive:true});mkdirSync(resources,{recursive:true});
 copyFileSync(originalExecPath,join(mac,'node'),constants.COPYFILE_FICLONE);
 writeFileSync(join(mac,'homer-image-decoder'),'synthetic decoder; never executed');
 const digest=(file:string)=>createHash('sha256').update(readFileSync(file)).digest('hex');
 const manifest=JSON.stringify({format:2,node:'22.22.0',codex:'0.163.0',codeFiles:['Contents/MacOS/homer-image-decoder','Contents/MacOS/node'].map(path=>({path,sha256:digest(join(bundleRoot,path))}))});
 writeFileSync(join(resources,'desktop-manifest.json'),manifest);
 const config:Config={appData:dir,workspace:join(dir,'workspace'),runtime:join(dir,'runtime'),codexHome:home,nativeCodexHome:home,codexBin:resolve('tests/fixtures/native-feature-app-server.mjs'),model:'deepseek-flash',requiresOpenaiAuth:false,stopGraceMs:100,dailyDeepSeek:true,pauseOldDesktopWork:true,desktopResources:{bundleRoot,manifestSha256:createHash('sha256').update(manifest).digest('hex')}};
 mkdirSync(config.workspace);mkdirSync(config.runtime);
 process.execPath=join(mac,'node');
 try{
 for(const role of ['main','worker'] as const){const engine=new CodexEngine(config,{cwd:config.workspace,readRoots:[],instructions:'Synthetic.',tools:[],nativeCapabilities:true,nativeTools:role},async()=>({}));try{
  await engine.start();const r=await engine.request('synthetic/inspect',{});
  assert.equal(r.threadParams.config['features.memories'],true);
  assert.equal(r.threadParams.config['memories.dedicated_tools'],true);
  assert.ok(r.argv.includes('memories.generate_memories=false'));
  assert.equal(r.threadParams.config['memories.generate_memories'],false);
  const permissions=r.argv.find((arg:string)=>arg.startsWith('permissions.homer='));
  for(const name of ['runtime-config.json','.runtime-config.json.pending','deepseek.json','.deepseek.json.pending'])assert.ok(permissions.includes(JSON.stringify(join(dir,name))+'="deny"'));
 }finally{await engine.close();}}
 }finally{process.execPath=originalExecPath;rmSync(dir,{recursive:true,force:true});}
});
