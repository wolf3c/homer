import {test} from 'node:test';
import assert from 'node:assert/strict';
import {join,resolve} from 'node:path';
import {NativeCapabilities} from '../src/native-capabilities.js';
import {capabilityOperationReview} from '../src/capability-operations.js';
function manager(server:any={}){const home=resolve('.codex/scratch/native-mcp-config-implementation/review-fixture');return new NativeCapabilities(home,async(method:string)=>method==='config/read'?{layers:[{name:{type:'user',file:join(home,'config.toml')},version:'fixture-version',config:{mcp_servers:{sample:server}}}]}:{data:[]},()=>true,undefined,async()=>{});}
const input=(server:any,patch=false)=>({action:'mcp_save',name:'sample',server,expectedVersion:'fixture-version',...(patch?{preserveExisting:true}:{})});
for(const hidden of [{args:['--token','SENSITIVE_ARG']},{env:{TOKEN:'SENSITIVE_ENV'}},{http_headers:{Authorization:'SENSITIVE_HEADER'}},{bearer_token_env_var:'PRIVATE_KEY'},{future_native_field:'SENSITIVE_FUTURE'}])test('ordinary approval cannot authorize an undisclosed MCP configuration '+Object.keys(hidden)[0],async()=>{
 await assert.rejects(()=>capabilityOperationReview(manager(),input({command:'synthetic-program',...hidden}),()=>{}),{message:'capability_mcp_trusted_configuration_required'});
});
test('preserveExisting cannot hide effective command arguments or environment from exact operation review',async()=>{
 for(const hidden of [{args:['SENSITIVE_INHERITED']},{env:{TOKEN:'SENSITIVE_INHERITED'}}])await assert.rejects(()=>capabilityOperationReview(manager({command:'old-program',...hidden}),input({command:'new-program'},true),()=>{}),{message:'capability_mcp_trusted_configuration_required'});
});
test('the complete reviewable effective configuration is shown, not just a hidden hash or patch',async()=>{
 const review=await capabilityOperationReview(manager({command:'synthetic-program',args:[],cwd:'/synthetic/work',tool_timeout_sec:900}),input({enabled_tools:['read']},true),()=>{});
 assert.deepEqual(review.operation.server,{command:'synthetic-program',args:[],cwd:'/synthetic/work',tool_timeout_sec:900,enabled_tools:['read']});
 assert.deepEqual(review.details.server,review.operation.server);assert.match(review.question,/synthetic-program/);assert.match(review.question,/\/synthetic\/work/);assert.match(review.question,/900/);assert.match(review.question,/enabled_tools/);assert.match(review.question,/完整配置/);
});
