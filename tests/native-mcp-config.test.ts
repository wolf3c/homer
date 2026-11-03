import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {NativeCapabilities} from '../src/native-capabilities.js';
import {capabilityOperationReview} from '../src/capability-operations.js';
const root=resolve('.codex/scratch/native-mcp-config-implementation/unit');mkdirSync(root,{recursive:true});
function fixture(initial:Record<string,any>={},afterValidation?:()=>void|Promise<void>){
 const home=mkdtempSync(join(root,'case-'));let servers=structuredClone(initial),version=0,fail=false;const calls:any[]=[];let validations=0;
 const rpc=async(method:string,p:any)=>{calls.push({method,p});if(method==='config/read')return{layers:[{name:{type:'user',file:join(home,'config.toml')},version:String(version),config:{mcp_servers:structuredClone(servers)}}]};if(method==='skills/list')return{data:[]};if(method==='config/batchWrite'){if(p.expectedVersion!==String(version))throw Error('capability_config_conflict');if(fail)throw Error('native invalid SENSITIVE_VALUE');for(const e of p.edits){const key=e.keyPath.slice('mcp_servers.'.length);if(e.value===null)delete servers[key];else servers[key]=structuredClone(e.value);}return{version:String(++version)};}if(method==='mcpServerStatus/list')return{data:[{name:'remote',toolsError:'failed SENSITIVE_VALUE',tools:{read:{name:'read'}},authStatus:'notLoggedIn'}]};return{};};
 const validate=async(_name:string,server:any)=>{validations++;if(server.unsupported!==undefined)throw Error('capability_mcp_native_invalid');await afterValidation?.();};
 const manager=new NativeCapabilities(home,rpc,()=>true,async()=>{},validate);
 return{manager,calls,get servers(){return servers;},get validations(){return validations;},external(){servers.external={command:'external'};version++;},fail(){fail=true;}};
}
const stdio={command:'native-program',args:['--token','SENSITIVE_VALUE'],env:{SECRET:'SENSITIVE_VALUE'},env_vars:['EXPLICIT_VAR'],cwd:'/synthetic/work',startup_timeout_sec:600.5,tool_timeout_sec:900,enabled_tools:['read','write'],disabled_tools:['remove'],default_tools_approval_mode:'prompt',tools:{read:{approval_mode:'writes'}}};
test('approved native fields and approval modes survive save, state and toggle without exposing secrets',async()=>{
 const f=fixture();await f.manager.manage({action:'mcp_save',name:'local',server:stdio,expectedVersion:'0',approve:true},'user');assert.deepEqual(f.servers.local,stdio);assert.equal(f.validations,1);
 const state=await f.manager.state();assert.equal(state.servers[0]!.managed,true);assert.doesNotMatch(JSON.stringify(state),/SENSITIVE_VALUE|SECRET|EXPLICIT_VAR/);
 await f.manager.manage({action:'mcp_toggle',name:'local',enabled:false,expectedVersion:'1'},'user');assert.deepEqual(f.servers.local,{...stdio,enabled:false});
});
test('all non-scope changes require real approval, including arbitrary future fields; only narrowing passes',async()=>{
 const f=fixture({local:stdio});for(const patch of[{env:{SECRET:'changed'}},{cwd:'/new'},{env_vars:['OTHER']},{startup_timeout_sec:901},{http_headers:{Authorization:'changed'}},{default_tools_approval_mode:'approve'},{tools:{}},{future_field:true},{enabled_tools:['read','write','new']},{enabled_tools:undefined}])await assert.rejects(()=>f.manager.manage({action:'mcp_save',name:'local',server:{...stdio,...patch},expectedVersion:'0',approve:true},'agent'),/capability_user_approval_required/);
 await f.manager.manage({action:'mcp_save',name:'local',server:{enabled_tools:['read']},preserveExisting:true,expectedVersion:'0'},'agent');assert.deepEqual(f.servers.local,{...stdio,enabled_tools:['read']});
});
test('UI patch preserves hidden native fields and supports removing a tool restriction with approval',async()=>{
 const f=fixture({local:stdio});await f.manager.manage({action:'mcp_save',name:'local',server:{command:'updated',enabled_tools:null},preserveExisting:true,expectedVersion:'0',approve:true},'user');const expected:any={...stdio,command:'updated'};delete expected.enabled_tools;assert.deepEqual(f.servers.local,expected);
});
test('native failure, stale version, validation race and reserved server leave config intact',async()=>{
 const f=fixture({local:stdio,homer_interactions:{command:'builtin'}});for(const action of['mcp_save','mcp_toggle','mcp_remove','oauth','oauth_logout'])await assert.rejects(()=>f.manager.manage({action,name:'homer_interactions',server:{command:'other'},enabled:false,expectedVersion:'0',approve:true},'user'),/capability_name_invalid/);
 await assert.rejects(()=>f.manager.manage({action:'mcp_save',name:'local',server:{command:'other',unsupported:true},expectedVersion:'0',approve:true},'user'),/capability_mcp_native_invalid/);assert.deepEqual(f.servers.local,stdio);
 f.fail();await assert.rejects(()=>f.manager.manage({action:'mcp_save',name:'local',server:{command:'other'},expectedVersion:'0',approve:true},'user'),/^Error: capability_mcp_save_failed$/);assert.deepEqual(f.servers.local,stdio);
 f.external();await assert.rejects(()=>f.manager.manage({action:'mcp_remove',name:'local',expectedVersion:'0'},'user'),/capability_config_conflict/);assert.equal(f.servers.external.command,'external');
});
test('HTTP native headers work with OAuth and safe catalog; approval review contains no secret values',async()=>{
 const remote={url:'https://example.com/mcp',http_headers:{Authorization:'SENSITIVE_VALUE'},env_http_headers:{'X-Api-Key':'TOKEN_NAME'},bearer_token_env_var:'TOKEN_NAME',scopes:['read'],oauth:{client_id:'client',client_secret:'SENSITIVE_VALUE'}};const f=fixture({remote});const state=await f.manager.state();assert.equal(state.servers[0]!.managed,true);assert.doesNotMatch(JSON.stringify(state),/SENSITIVE_VALUE|TOKEN_NAME/);
 for(const action of['oauth','oauth_logout'])await f.manager.manage({action,name:'remote',expectedVersion:'0',approve:true},'user');
 assert.doesNotMatch(JSON.stringify(await f.manager.manage({action:'catalog',name:'remote'},'agent')),/SENSITIVE_VALUE/);
 await assert.rejects(()=>capabilityOperationReview(f.manager,{action:'mcp_save',name:'remote',server:remote,expectedVersion:'0'},()=>{}),/capability_mcp_trusted_configuration_required/);
});

test('approved transport patches remove obsolete base fields before endpoint policy checks',async()=>{
 const f=fixture({simple:{command:'native-program',args:['run']}});await f.manager.manage({action:'mcp_save',name:'simple',server:{url:'https://example.com/mcp',command:null,args:null},preserveExisting:true,expectedVersion:'0',approve:true},'user');assert.deepEqual(f.servers.simple,{url:'https://example.com/mcp'});await f.manager.manage({action:'mcp_save',name:'simple',server:{command:'native-program',url:null},preserveExisting:true,expectedVersion:'1',approve:true},'user');assert.deepEqual(f.servers.simple,{command:'native-program'});
});

test('a guard invalidated during native validation cannot persist a proposed config',async()=>{
 let active=true;const f=fixture({local:stdio},()=>{active=false;});await assert.rejects(()=>f.manager.manage({action:'mcp_save',name:'local',server:{...stdio,enabled_tools:['read']},expectedVersion:'0'},'agent',()=>{if(!active)throw Error('tool_scope_denied');}),/tool_scope_denied/);assert.deepEqual(f.servers.local,stdio);assert.equal(f.calls.filter(c=>c.method==='config/batchWrite').length,0);
});
