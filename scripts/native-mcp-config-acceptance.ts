// Fixed-version, isolated native parser/persistence acceptance. No accounts,
// external MCP connections, model turns, package installs or real config writes.
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {CodexEngine} from '../src/engine.js';
import {NativeCapabilities} from '../src/native-capabilities.js';
import {validateNativeMcpConfig} from '../src/native-mcp-config.js';
const root=resolve('.codex/scratch/native-mcp-config-implementation');mkdirSync(root,{recursive:true});
const dir=mkdtempSync(join(root,'native-acceptance-')),home=join(dir,'codex'),workspace=join(dir,'workspace');mkdirSync(home);mkdirSync(workspace);writeFileSync(join(home,'config.toml'),'');
const binary=process.argv[2];if(!binary)throw Error('fixed_codex_binary_required');
const config={appData:dir,codexHome:home,nativeCodexHome:home,codexBin:resolve(binary),workspace,runtime:join(dir,'runtime'),model:'synthetic-no-model',requiresOpenaiAuth:false,timeoutMs:1000,mainTimeoutMs:1000,stopGraceMs:1000};
const engine=new CodexEngine(config,{cwd:workspace,readRoots:[],instructions:'Config protocol only.',tools:[],nativeCapabilities:true,controlOnly:true},async()=>{throw Error('no_model_tools');});
const file=join(home,'config.toml'),marker=join(dir,'must-not-run');
const rawServers=async()=>{const r=await engine.request('config/read',{cwd:workspace,includeLayers:true});return r.layers.find((l:any)=>l.name.type==='user').config.mcp_servers??{};};
const receipt:any={fixedVersion:'0.163.0',isolatedHome:true,noAccounts:true,noModelOrThread:true,noExternalMcp:true,checks:[]};
try{
 await engine.start();assert.equal(engine.version,'0.163.0');assert.equal(engine.threadId,undefined);
 const validate=(n:string,s:any)=>validateNativeMcpConfig(config,n,s);
 const manager=new NativeCapabilities(home,(m,p)=>engine.request(m,p),()=>true,undefined,validate);
 const local={command:process.execPath,args:['-e',`require('node:fs').writeFileSync(${JSON.stringify(marker)},'unexpected')`],env:{SYNTHETIC_SECRET:'SYNTHETIC_ONLY_VALUE'},env_vars:['SYNTHETIC_EXPLICIT_NAME'],cwd:workspace,startup_timeout_sec:600.5,tool_timeout_sec:900,default_tools_approval_mode:'prompt',disabled_tools:['remove'],enabled_tools:['read','write'],tools:{read:{approval_mode:'writes',output_token_limit:200}},required:false};
 let state=await manager.state();await manager.manage({action:'mcp_save',name:'local',server:local,expectedVersion:state.version,approve:true},'user');assert.deepEqual((await rawServers()).local,local);receipt.checks.push('env/cwd/env_vars/argv/approval/per-tool fields and both >120s native timeouts preserve exact raw input');
 assert.equal(existsSync(marker),false);receipt.checks.push('strict native loader with enabled MCP executes no program without a thread');
 const remote={url:'http://127.0.0.1:1/mcp',enabled:false,http_headers:{'X-Secret':'SYNTHETIC_ONLY_VALUE'},env_http_headers:{Authorization:'SYNTHETIC_TOKEN'},bearer_token_env_var:'SYNTHETIC_TOKEN',http_headers_helper:'synthetic-header-helper-do-not-run',scopes:['read'],oauth:{client_id:'synthetic',client_secret:'SYNTHETIC_ONLY_VALUE',callback_port:12345},oauth_resource:'https://example.invalid/resource',default_tools_approval_mode:'auto'};
 state=await manager.state();await manager.manage({action:'mcp_save',name:'remote',server:remote,expectedVersion:state.version,approve:true},'user');assert.deepEqual((await rawServers()).remote,remote);state=await manager.state();assert.ok(state.servers.every((s:any)=>s.managed));assert.doesNotMatch(JSON.stringify(state),/SYNTHETIC_ONLY_VALUE|SYNTHETIC_TOKEN|SYNTHETIC_EXPLICIT_NAME/);receipt.checks.push('HTTP headers/env references/OAuth settings preserve exact raw input; state is redacted');
 for(const server of [{...local,env:{BAD:123}},{...local,startup_timeout_sec:-1},{...local,tool_timeout_sec:-1},{...local,enabled:'yes'},{...local,unknown_native_option:true},{...local,tools:{read:{unknown_native_option:true}}},{...remote,env:{BAD:'transport'}},{...remote,bearer_token:'unsupported'}]){
  state=await manager.state();const before=readFileSync(file,'utf8');await assert.rejects(()=>manager.manage({action:'mcp_save',name:'invalid',server,expectedVersion:state.version,approve:true},'user'),/capability_mcp_native_invalid/);assert.equal(readFileSync(file,'utf8'),before);
 }receipt.checks.push('native strict rejection of invalid types/ranges/transport/unknown and nested unknown fields leaves byte-identical config');
 state=await manager.state();const zero={command:'synthetic-do-not-run',enabled:false,startup_timeout_sec:0,tool_timeout_sec:0};await manager.manage({action:'mcp_save',name:'zero',server:zero,expectedVersion:state.version,approve:true},'user');assert.deepEqual((await rawServers()).zero,zero);receipt.checks.push('native zero timeout semantics preserved without a Homer minimum');
 state=await manager.state();await manager.manage({action:'mcp_save',name:'local',server:{enabled_tools:['read']},preserveExisting:true,expectedVersion:state.version},'agent');assert.deepEqual((await rawServers()).local,{...local,enabled_tools:['read']});receipt.checks.push('agent narrows tools while preserving every hidden native field');
 state=await manager.state();const stale=state.version;await manager.manage({action:'mcp_toggle',name:'local',enabled:false,expectedVersion:stale},'user');const before=readFileSync(file,'utf8');await assert.rejects(()=>manager.manage({action:'mcp_remove',name:'remote',expectedVersion:stale},'user'),/capability_config_conflict/);assert.equal(readFileSync(file,'utf8'),before);receipt.checks.push('stale requests preserve configuration');
 // Native CAS is rechecked after async validation, not merely at entry.
 state=await manager.state();const race=new NativeCapabilities(home,(m,p)=>engine.request(m,p),()=>true,undefined,async(n,s)=>{await validate(n,s);await engine.request('config/batchWrite',{filePath:file,expectedVersion:state.version,reloadUserConfig:false,edits:[{keyPath:'mcp_servers.concurrent',value:{command:'synthetic-external',enabled:false},mergeStrategy:'replace'}]});});
 await assert.rejects(()=>race.manage({action:'mcp_save',name:'remote',server:{...remote,tool_timeout_sec:500},expectedVersion:state.version,approve:true},'user'),/capability_config_conflict/);assert.deepEqual((await rawServers()).remote,remote);assert.equal((await rawServers()).concurrent.command,'synthetic-external');receipt.checks.push('actual native version conflict after validation does not overwrite concurrent external change');
 state=await manager.state();const simultaneous=await Promise.allSettled([manager.manage({action:'mcp_toggle',name:'local',enabled:true,expectedVersion:state.version},'user'),manager.manage({action:'mcp_remove',name:'local',expectedVersion:state.version},'user')]);
 assert.equal(simultaneous[0]!.status,'fulfilled');assert.equal(simultaneous[1]!.status,'rejected');assert.match(String((simultaneous[1] as PromiseRejectedResult).reason),/capability_config_conflict/);receipt.checks.push('manager serializes simultaneous mutations; second stale mutation fails without overwriting');
 assert.equal(existsSync(marker),false);assert.equal(engine.threadId,undefined);receipt.passed=true;
}finally{assert.equal(await engine.close(),true);}
writeFileSync(join(root,'native-mcp-config-acceptance-receipt.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt,null,2));
