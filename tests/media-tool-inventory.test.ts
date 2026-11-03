import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {MAIN_TOOLS} from '../src/tools.js';
import {MEDIA_TOOLS,WORKER_MEDIA_TOOLS} from '../src/media-tools.js';
import {HOST_MCP_TOOLS,WORKER_HOST_MCP_TOOLS} from '../src/worker-interaction-mcp.js';
test('Media capabilities and reply options stay in main-owned MCP; native five tools and Worker scope remain fixed',()=>{
 assert.equal(createHash('sha256').update(JSON.stringify(MAIN_TOOLS)).digest('hex'),'e6d674a05ae34945a5e234a2b1f55029f0d319e51371f448911845224062cf9a');
 assert.deepEqual(MEDIA_TOOLS.map(t=>t.name),['runtime_capabilities','inspect_attachment','inspect_result_file','quote_current_message','prepare_combined_delivery']);
 for(const tool of MEDIA_TOOLS)assert.ok(HOST_MCP_TOOLS.some(t=>t.name===tool.name));
 assert.deepEqual(WORKER_MEDIA_TOOLS.map(t=>t.name),['create_voice_result','inspect_attachment','stage_file_result','stage_workspace_file']);
 for(const name of ['runtime_capabilities','inspect_result_file','quote_current_message','prepare_combined_delivery'])assert.equal(WORKER_HOST_MCP_TOOLS.some(t=>t.name===name),false);
});
