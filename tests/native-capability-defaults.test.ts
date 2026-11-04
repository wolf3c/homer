import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nativeToolChoices} from '../src/native-tool-settings.js';
import {validateMcpServer,NativeCapabilities} from '../src/native-capabilities.js';
import {resolve,join} from 'node:path';

test('native defaults remain authoritative: Homer adds no feature or search overrides',()=>{
 assert.deepEqual(nativeToolChoices({}),{shell:true,viewImage:true,shellSnapshot:true,skillSearch:true,search:'cached'});
 assert.equal(nativeToolChoices({web_search:'disabled',features:{skill_search:false}}).search,'disabled');
});
test('owner-approved MCP connection can expose its native discovered tools without a list',()=>{
 const server=validateMcpServer({url:'https://example.com/mcp'});
 assert.equal(Object.hasOwn(server,'enabled_tools'),false);
 assert.deepEqual(validateMcpServer({url:'https://example.com/mcp',enabled_tools:[]}).enabled_tools,[]);
 // Native type/semantic rejection is exercised by the fixed-version protocol test.
});
test('native MCP discovery never authorizes a model to add a connection or widen an explicit restriction',async()=>{
 const home=resolve('.codex/scratch/native-defaults-unit/codex');let current:any={bounded:{url:'https://example.com/mcp',enabled_tools:['read']}};let writes=0;
 const rpc=async(method:string,params:any)=>{
  if(method==='config/read')return {layers:[{name:{type:'user',file:join(home,'config.toml')},version:'v1',config:{mcp_servers:current}}]};
  if(method==='config/batchWrite'){current={...current,[params.edits[0].keyPath.slice('mcp_servers.'.length)]:params.edits[0].value};writes++;return {version:'v2'};}
  return {};
 };
 const manager=new NativeCapabilities(home,rpc,()=>true,undefined,async()=>{});
 await assert.rejects(()=>manager.manage({action:'mcp_save',name:'bounded',server:{url:'https://example.com/mcp'},expectedVersion:'v1'},'agent'),/capability_user_approval_required/);
 await assert.rejects(()=>manager.manage({action:'mcp_save',name:'new',server:{url:'https://example.com/new'},expectedVersion:'v1'},'agent'),/capability_user_approval_required/);
 assert.equal(writes,0);
 await manager.manage({action:'mcp_save',name:'bounded',server:{url:'https://example.com/mcp'},expectedVersion:'v1',approve:true},'user');
 assert.equal(writes,1);
});

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
  const engine=new CodexEngine({workspace:cwd,runtime:join(dir,'runtime'),codexHome:home,nativeCodexHome:home,codexBin:resolve('tests/fixtures/native-feature-app-server.mjs'),model:'synthetic',requiresOpenaiAuth:false,timeoutMs:1000,mainTimeoutMs:1000,stopGraceMs:500},{cwd,readRoots:[],instructions:'synthetic',tools:[],nativeCapabilities:true,nativeTools:role,permissionRequests:true,...(resume?{threadId:'existing-synthetic-thread'}:{})},async()=>({}));
  try{
   await engine.start();const probe=await engine.request('synthetic/inspect',{});
   for(const key of ['model_providers.homer.stream_idle_timeout_ms','model_providers.homer.stream_max_retries','model_providers.homer.request_max_retries'])assert.ok(!probe.argv.some((a:string)=>a.startsWith(key+'=')),key);
   for(const key of ['web_search','features.plugins','features.apps','features.browser_use','features.image_generation','features.computer_use','features.skill_search','features.shell_tool','features.hooks','features.code_mode'])assert.ok(!probe.argv.some((a:string)=>a.startsWith(key+'=')),key);
   for(const key of ['features.multi_agent','features.multi_agent_v2','agents.enabled'])assert.ok(probe.argv.includes(key+'='+(role==='worker')));
   assert.ok(probe.argv.includes('features.memories=true'));
   assert.equal(probe.threadMethod,resume?'thread/resume':'thread/start');
   if(resume)assert.equal(probe.threadParams.threadId,'existing-synthetic-thread');
   assert.equal(probe.threadParams.config['apps._default.enabled'],undefined);
   assert.equal(probe.threadParams.config.mcp_servers['Office.Native'],undefined,'thread overrides preserve native project/user precedence');
   assert.equal(probe.argv.some((a:string)=>a.startsWith('skills.config=')),false);
   assert.deepEqual(probe.threadParams.config['skills.config'],configured?userConfig:[],`${role} ${resume?'resume':'start'} must add neither blanket disables nor forced enables`);
  }finally{await engine.close();}
 }
});

test('restricted isolated and legacy shared HOME branches retain their capability fences on start/resume',async()=>{
 const {CodexEngine}=await import('../src/engine.js');
 const {mkdtempSync,mkdirSync,writeFileSync}=await import('node:fs');
 const scratch=resolve('.codex/scratch/native-system-skills-implementation/contract-cases');mkdirSync(scratch,{recursive:true});
 for(const isolated of [true,false])for(const resume of [false,true]){
  const dir=mkdtempSync(join(scratch,'restricted-')),home=join(dir,'codex'),cwd=join(dir,'work');mkdirSync(home);mkdirSync(cwd);
  const userConfig=[{path:join(home,'skills/user-disabled/SKILL.md'),enabled:false}];
  writeFileSync(join(home,'synthetic-skills.json'),JSON.stringify(userConfig));
  const engine=new CodexEngine({workspace:cwd,runtime:join(dir,'runtime'),codexHome:home,nativeCodexHome:isolated?home:join(dir,'separate-native-home'),codexBin:resolve('tests/fixtures/native-feature-app-server.mjs'),model:'synthetic',requiresOpenaiAuth:false,timeoutMs:1000,mainTimeoutMs:1000,stopGraceMs:500},{cwd,readRoots:[],instructions:'synthetic',tools:[],nativeCapabilities:false,...(resume?{threadId:'restricted-thread'}:{})},async()=>({}));
  try{
   await engine.start();const probe=await engine.request('synthetic/inspect',{});
   assert.equal(probe.threadMethod,resume?'thread/resume':'thread/start');
   assert.ok(probe.argv.includes('features.skip_host_skill_discovery=true'));
   assert.ok(probe.argv.includes('features.plugins=false'));
   assert.equal(probe.threadParams.config['apps._default.enabled'],false);
   if(isolated)assert.deepEqual(probe.threadParams.config['skills.config'],[...userConfig,
    {path:join(home,'skills/.system/native/SKILL.md'),enabled:false},
    {path:join(home,'plugins/native/skills/example/SKILL.md'),enabled:false},
    {path:'/synthetic/outside/skills/untrusted/SKILL.md',enabled:false},
   ]);
   else assert.equal(Object.hasOwn(probe.threadParams.config,'skills.config'),false);
  }finally{await engine.close();}
 }
});
