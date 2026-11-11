import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolve,join} from 'node:path';

test('main and Worker start/resume preserve native Skill defaults and user configuration',async()=>{
 const {CodexEngine}=await import('../src/engine.js');
 const {mkdtempSync,mkdirSync,writeFileSync}=await import('node:fs');
 const scratch=resolve('.codex/scratch/native-system-skills-implementation/contract-cases');mkdirSync(scratch,{recursive:true});
 for(const role of ['main','worker'] as const)for(const resume of [false,true])for(const configured of [false,true]){
  const dir=mkdtempSync(join(scratch,'case-')),home=join(dir,'codex'),cwd=join(dir,'work');mkdirSync(home);mkdirSync(cwd);
  const userConfig=[
   {path:join(home,'skills/.system/user-disabled/SKILL.md'),enabled:false},
   {path:join(home,'skills/.system/user-enabled/SKILL.md'),enabled:true},
   {path:join(home,'skills/ordinary/SKILL.md'),enabled:false},
   {path:join(home,'plugins/native/skills/example/SKILL.md'),enabled:false},
   {path:join(home,'skills/another/SKILL.md'),enabled:true},
  ];
  if(configured)writeFileSync(join(home,'synthetic-skills.json'),JSON.stringify(userConfig));
  const engine=new CodexEngine({workspace:cwd,runtime:join(dir,'runtime'),codexHome:home,nativeCodexHome:home,codexBin:resolve('tests/fixtures/native-feature-app-server.mjs'),model:'synthetic',requiresOpenaiAuth:false,stopGraceMs:500},{cwd,readRoots:[],instructions:'synthetic',tools:[],nativeTools:role,...(resume?{threadId:'existing-synthetic-thread'}:{})},async()=>({}));
  try{
   await engine.start();const probe=await engine.request('synthetic/inspect',{});
   for(const key of ['model_providers.homer.stream_idle_timeout_ms','model_providers.homer.stream_max_retries','model_providers.homer.request_max_retries'])assert.ok(!probe.argv.some((a:string)=>a.startsWith(key+'=')),key);
   for(const key of ['web_search','features.plugins','features.apps','features.browser_use','features.image_generation','features.computer_use','features.skill_search','features.shell_tool','features.hooks','features.code_mode'])assert.ok(!probe.argv.some((a:string)=>a.startsWith(key+'=')),key);
   for(const key of ['features.multi_agent','features.multi_agent_v2','agents.enabled'])assert.ok(probe.argv.includes(key+'='+(role==='worker')));
   assert.ok(probe.argv.includes('features.memories=true'));
   assert.equal(probe.threadMethod,resume?'thread/resume':'thread/start');
   assert.equal(probe.threadParams.permissions,undefined);assert.equal(probe.threadParams.approvalPolicy,undefined);
   if(resume)assert.equal(probe.threadParams.threadId,'existing-synthetic-thread');
   assert.equal(probe.threadParams.config['apps._default.enabled'],undefined);
   assert.equal(probe.threadParams.config.mcp_servers['Office.Native'],undefined,'thread overrides preserve native project/user precedence');
   assert.equal(probe.argv.some((a:string)=>a.startsWith('skills.config=')),false);
   assert.deepEqual(probe.threadParams.config['skills.config'],configured?userConfig:[],`${role} ${resume?'resume':'start'} must add neither blanket disables nor forced enables`);
  }finally{await engine.close();}
 }
});

test('an engine without role-specific tools still requires the dedicated Codex home',async()=>{
 const {CodexEngine}=await import('../src/engine.js');
 const dir=resolve('.codex/scratch/native-system-skills-implementation');
 const engine=new CodexEngine({workspace:dir,runtime:join(dir,'runtime'),codexHome:join(dir,'legacy'),nativeCodexHome:join(dir,'codex'),codexBin:'/synthetic/must-not-spawn',model:'synthetic',requiresOpenaiAuth:false,stopGraceMs:100},{cwd:dir,readRoots:[],instructions:'Synthetic',tools:[]},async()=>({}));
 try{await assert.rejects(engine.start(),/engine_native_tools_home_required/);}
 finally{await engine.close();}
});
