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
test('daily DeepSeek permits extraction only for fresh main threads and preserves existing memory files',async(t)=>{
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
 const notes=join(home,'memories/extensions/ad_hoc/notes');mkdirSync(notes,{recursive:true});
 const memoryFiles=[
  [join(home,'config.toml'),'[memories]\nuse_memories = true\n'],
  [join(home,'memories/MEMORY.md'),'Synthetic existing memory.\n'],
  [join(notes,'2026-10-30T00-00-00-forget.md'),'Synthetic preference withdrawn. Do not use or reconstruct it.\n'],
 ];
 for(const [path,content] of memoryFiles)writeFileSync(path!,content!);
 process.execPath=join(mac,'node');
 try{
 for(const scenario of [
  {role:undefined,threadId:undefined,controlOnly:false,generate:true},
  {role:'main' as const,threadId:undefined,controlOnly:false,generate:true},
  {role:'main' as const,threadId:'existing-main-thread',controlOnly:false,generate:false},
  {role:'worker' as const,threadId:undefined,controlOnly:false,generate:false},
  {role:'worker' as const,threadId:'existing-worker-thread',controlOnly:false,generate:false},
  {role:undefined,threadId:undefined,controlOnly:true,generate:false},
 ]){const {role,threadId,controlOnly,generate}=scenario;await t.test(`${role??'implicit-main'} ${threadId?'resume':'fresh'}${controlOnly?' control':''}`,async()=>{const engine=new CodexEngine(config,{role,threadId,controlOnly,cwd:config.workspace,readRoots:[],instructions:'Synthetic.',tools:[],nativeCapabilities:true,nativeTools:role},async()=>({}));try{
  await engine.start();const r=await engine.request('synthetic/inspect',{});
  assert.ok(r.argv.includes('memories.generate_memories='+generate));
  for(const key of ['extract_model','consolidation_model']){
   assert.ok(r.argv.includes('memories.'+key+'="deepseek-flash"'));
   if(!controlOnly)assert.equal(r.threadParams.config['memories.'+key],'deepseek-flash');
  }
  if(controlOnly)assert.equal(r.threadParams,undefined);
  else{
   assert.equal(r.threadParams.config['features.memories'],true);
   assert.equal(r.threadParams.config['memories.dedicated_tools'],true);
   assert.equal(r.threadParams.config['memories.generate_memories'],generate);
   assert.equal(r.threadMethod,threadId?'thread/resume':'thread/start');
  }
  assert.deepEqual(r.memoryModeSets,[],'startup must not rewrite an existing thread memory mode');
  for(const [path,content] of memoryFiles)assert.equal(readFileSync(path!,'utf8'),content);
  const permissions=r.argv.find((arg:string)=>arg.startsWith('permissions.homer='));
  for(const name of ['runtime-config.json','.runtime-config.json.pending','deepseek.json','.deepseek.json.pending'])assert.ok(permissions.includes(JSON.stringify(join(dir,name))+'="deny"'));
 }finally{await engine.close();}});}
 // The packaged desktop acceptance fixture must also report the effective
 // settings, so later package checks cannot silently rely on the old defaults.
 writeFileSync(join(dir,'.homer-desktop-test-profile'),'{"format":1}');
 const desktopFixture=join(dir,'desktop-fixture.mjs');writeFileSync(desktopFixture,readFileSync(resolve('tests/fixtures/desktop-app-server.mjs')),{mode:0o700});
 for(const role of ['main','worker'] as const)await t.test(`desktop acceptance fixture ${role}`,async()=>{
  const engine=new CodexEngine({...config,codexBin:desktopFixture},{role,cwd:config.workspace,readRoots:[],instructions:'Synthetic.',tools:[],nativeCapabilities:true,nativeTools:role,permissionRequests:true},async()=>({}));
  try{
   await engine.start();const actual=(await engine.request('config/read',{})).config.memories;
   assert.equal(actual.generate_memories,role==='main');
   assert.equal(actual.extract_model,'deepseek-flash');assert.equal(actual.consolidation_model,'deepseek-flash');
  }finally{await engine.close();}
 });
 for(const memories of [
  {extract_model:'gpt-5.6-luna'},
  {consolidation_model:'gpt-5.6-terra'},
  {extract_model:null},
  {consolidation_model:null},
  {generate_memories:false},
 ]){await t.test('reject effective '+JSON.stringify(memories),async()=>{
  writeFileSync(join(home,'synthetic-memories.json'),JSON.stringify(memories));
  const engine=new CodexEngine(config,{role:'main',cwd:config.workspace,readRoots:[],instructions:'Synthetic.',tools:[],nativeCapabilities:true},async()=>({}));
  try{
   await assert.rejects(engine.start(),/engine_memory_(model|generation)_mismatch/);
   assert.equal(engine.threadId,undefined,'invalid effective config must fail before thread creation');
   assert.equal(engine.available,false);
  }finally{await engine.close();}
 });}
 }finally{process.execPath=originalExecPath;rmSync(dir,{recursive:true,force:true});}
});
