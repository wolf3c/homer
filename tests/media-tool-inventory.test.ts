import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MAIN_TOOLS} from '../src/tools.js';
import * as media from '../src/media-tools.js';
import {HOST_MCP_TOOLS,WORKER_HOST_MCP_TOOLS} from '../src/worker-interaction-mcp.js';
import {validateToolArguments} from '../src/recursive-tools.js';
test('MCP retains media reads and channel reply choices, while file writes require native dynamic calls',()=>{
 assert.deepEqual(media.MEDIA_TOOLS.map(t=>t.name),['runtime_capabilities','inspect_attachment','inspect_result_file','quote_current_message','prepare_combined_delivery']);
 for(const tool of media.MEDIA_TOOLS)assert.ok(HOST_MCP_TOOLS.some(t=>t.name===tool.name));
 assert.deepEqual(media.WORKER_MEDIA_TOOLS.map(t=>t.name),['inspect_attachment']);
 for(const name of ['runtime_capabilities','inspect_result_file','quote_current_message','prepare_combined_delivery','create_voice_result','stage_file_result','stage_workspace_file'])assert.equal(WORKER_HOST_MCP_TOOLS.some(t=>t.name===name),false,name);
 assert.equal(MAIN_TOOLS.some(t=>t.name==='stage_workspace_file'),false);
});

test('independent voice and binary creation need business inputs only and no legacy contract gates',()=>{
 const files=media.WORKER_FILE_TOOLS;
 assert.deepEqual(files.map(t=>t.name),['create_voice_result','stage_file_result']);
 for(const [name,args] of [
  ['create_voice_result',{filename:'answer.silk',text:'合成测试'}],
  ['stage_file_result',{filename:'answer.bin',dataBase64:'AQID'}],
  ['stage_file_result',{filename:'answer.bin',assetId:'synthetic-asset',revision:1}],
 ] as const){
  const tool=files.find(t=>t.name===name)!;
  validateToolArguments(args,tool.inputSchema);
  assert.throws(()=>validateToolArguments({...args,operationId:'forged'},tool.inputSchema),/invalid_tool_arguments/);
  assert.doesNotMatch(tool.description,/contract|合约|契约|自动回传|read_material/);
 }
});
