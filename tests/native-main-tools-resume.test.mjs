import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fixture,metadata,peer,tools} from './fixtures/native-main-resume.mjs';

const toolsHash=createHash('sha256').update(JSON.stringify(tools)).digest('hex');
test('fixed native engine resumes the exact tool definitions without calling a model',{timeout:45000},async t=>{
 const f=fixture(t),{bin,cwd,calls}=f;
 let first=peer(f,process.env.HOMER_TEST_CODEX_BASELINE_BIN??bin),second;
 try{
  await first.init();
  const created=await first.request('thread/start',{model:'gpt-6.1-sol',modelProvider:'synthetic_boundary',cwd,approvalPolicy:'on-request',sandbox:'read-only',environments:[],config:{mcp_servers:{}},dynamicTools:tools});
  const thread=created.thread.id;await first.request('thread/memoryMode/set',{threadId:thread,mode:'disabled'});
  await first.request('thread/inject_items',{threadId:thread,items:[{type:'message',role:'user',content:[{type:'input_text',text:'Synthetic tool resume marker. No model execution.'}]}]});
  const before=await first.request('thread/read',{threadId:thread,includeTurns:true});
  const beforeTools=metadata(f,before.thread.path).dynamic_tools;
  assert.deepEqual(beforeTools,tools);
  assert.equal(createHash('sha256').update(JSON.stringify(beforeTools)).digest('hex'),toolsHash);
  await first.close();first=undefined;second=peer(f,bin);await second.init();
  const resumed=await second.request('thread/resume',{threadId:thread,excludeTurns:true,cwd,approvalPolicy:'on-request'});assert.equal(resumed.thread.id,thread);
  const after=await second.request('thread/read',{threadId:thread,includeTurns:true});
  const afterTools=metadata(f,after.thread.path).dynamic_tools;
  assert.deepEqual(afterTools,tools);
  assert.equal(createHash('sha256').update(JSON.stringify(afterTools)).digest('hex'),toolsHash);
  assert.equal(calls.filter(x=>x==='thread/start').length,1);assert.equal(calls.includes('turn/start'),false);
 }finally{await first?.close();await second?.close();}
});
