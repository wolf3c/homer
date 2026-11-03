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
 assert.throws(()=>validateMcpServer({url:'https://example.com/mcp',enabled_tools:'all'}),/capability_/);
});
test('native MCP discovery never authorizes a model to add a connection or widen an explicit restriction',async()=>{
 const home=resolve('.codex/scratch/native-defaults-unit/codex');let current:any={bounded:{url:'https://example.com/mcp',enabled_tools:['read']}};let writes=0;
 const rpc=async(method:string,params:any)=>{
  if(method==='config/read')return {layers:[{name:{type:'user',file:join(home,'config.toml')},version:'v1',config:{mcp_servers:current}}]};
  if(method==='config/batchWrite'){current=params.edits[0].value;writes++;return {version:'v2'};}
  return {};
 };
 const manager=new NativeCapabilities(home,rpc,()=>true);
 await assert.rejects(()=>manager.manage({action:'mcp_save',name:'bounded',server:{url:'https://example.com/mcp'},expectedVersion:'v1'},'agent'),/capability_user_approval_required/);
 await assert.rejects(()=>manager.manage({action:'mcp_save',name:'new',server:{url:'https://example.com/new'},expectedVersion:'v1'},'agent'),/capability_user_approval_required/);
 assert.equal(writes,0);
 await manager.manage({action:'mcp_save',name:'bounded',server:{url:'https://example.com/mcp'},expectedVersion:'v1',approve:true},'user');
 assert.equal(writes,1);
});

test('main and Worker use native features without false process/thread overrides and keep origin isolation',async()=>{
 const {CodexEngine}=await import('../src/engine.js');
 const {mkdtempSync,mkdirSync}=await import('node:fs');
 const scratch=resolve('.codex/scratch/native-feature-contract');mkdirSync(scratch,{recursive:true});
 const dir=mkdtempSync(join(scratch,'case-')),home=join(dir,'codex');mkdirSync(home);
 for(const role of ['main','worker'] as const){
 mkdirSync(join(dir,'work-'+role));
 const engine=new CodexEngine({workspace:join(dir,'workspace'),runtime:join(dir,'runtime'),codexHome:home,nativeCodexHome:home,codexBin:resolve('tests/fixtures/native-feature-app-server.mjs'),model:'synthetic',requiresOpenaiAuth:false,timeoutMs:1000,mainTimeoutMs:1000,stopGraceMs:500},{cwd:join(dir,'work-'+role),readRoots:[],instructions:'synthetic',tools:[],nativeCapabilities:true,nativeTools:role,permissionRequests:true},async()=>({}));
 try{await engine.start();const probe=await engine.request('synthetic/inspect',{});
 for(const key of ['web_search','features.plugins','features.apps','features.browser_use','features.image_generation','features.computer_use','features.skill_search','features.shell_tool','features.hooks','features.code_mode'])assert.ok(!probe.argv.some((a:string)=>a.startsWith(key+'=')),key);
 for(const key of ['features.multi_agent','features.multi_agent_v2','agents.enabled'])assert.ok(probe.argv.includes(key+'='+(role==='worker'))); assert.ok(probe.argv.includes('features.memories=true'));
 assert.equal(probe.threadParams.config['apps._default.enabled'],undefined);
 assert.equal(probe.threadParams.config.mcp_servers['Office.Native']?.env.SYNTHETIC_SETTING,'local-fixture','native authorized configuration must not be silently filtered');
 const disabled=probe.threadParams.config['skills.config'].filter((s:any)=>s.enabled===false).map((s:any)=>s.path);
 assert.deepEqual(disabled,[join(home,'skills/.system/native/SKILL.md')]);
 }finally{await engine.close();}
 }
});
