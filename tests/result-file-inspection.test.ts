import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Homer} from '../src/service.js';

// Exercise the current host entry with synthetic UTF-8 bytes, no media runtime or engine.
function fixture(changed=false){
 const host=Object.create(Homer.prototype) as any;
 const data=Buffer.from('实际合成文档内容'),sha256=createHash('sha256').update(data).digest('hex');
 const context={event:false,requestId:'synthetic-request',inspected:new Set<string>()};let reads=0;
 Object.assign(host,{mainContext:context,closing:false,store:{meta:()=> 'synthetic-main'},tasks:{
  inspect:()=>({actualResult:{file:{path:'answer.txt'}},results:[{id:'synthetic-result',runId:'synthetic-run'}]}),
  run:()=>({matterId:'synthetic-matter'}),
 },files:{prepareRun:()=> 'synthetic-directory',resultBytes:()=>({data,mime:'text/plain',sha256:changed&&reads++?'changed-hash':sha256})}});
 return {host,context,sha256,inspect:()=>host.mediaTool('inspect_result_file',{resultId:'synthetic-result'})};
}

test('result inspection returns actual text and source hash before marking the run inspected',async()=>{
 const f=fixture(),result=await f.inspect();
 assert.equal(result.extracted.text,'实际合成文档内容');assert.equal(result.extracted.sourceHash,f.sha256);
 assert.deepEqual([...f.context.inspected],['synthetic-run']);
});

test('result inspection rejects changed bytes without marking the run inspected',async()=>{
 const f=fixture(true);await assert.rejects(f.inspect(),/artifact_changed/);assert.equal(f.context.inspected.size,0);
});

test('result inspection cannot complete into a replaced main context',async()=>{
 const f=fixture(),pending=f.inspect();f.host.mainContext={event:false,inspected:new Set()};
 await assert.rejects(pending,/tool_scope_denied/);
 assert.equal(f.context.inspected.size,0);assert.equal(f.host.mainContext.inspected.size,0);
});
