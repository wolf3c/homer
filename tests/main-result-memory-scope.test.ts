import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Homer} from '../src/service.js';

// Exercise the async coordinator boundary without constructing a host, DB,
// engine, channel or decoder. Only the source extractor is deferred.
function fixture(){
 const context={memoryReceipts:[] as unknown[]},accepted:string[]=[];
 const host=Object.create(Homer.prototype) as any;
 Object.assign(host,{mainContext:context,closing:false,accountClocks(){},
  store:{meta:()=> 'main',run:()=>({id:'run',artifact:'result.txt'})},
  tasks:{task:()=>({currentRunId:'run'}),guard(){throw Error('run_required');}},
  recursiveTools:{async call(){return {accepted:true};}},
  resultTextSource:async()=>({content:'actual source',hash:'file-hash'}),
  memory:{acceptCandidates(id:string){accepted.push(id);return [{state:'accepted'}];}},
 });
 return {host,context,accepted,call:()=>host.recursiveTool({agentId:'main'},'task_review',{taskId:'task',accepted:true})};
}
test('main result acceptance uses the captured main scope, not a Worker run guard',async()=>{
 const s=fixture();await s.call();assert.deepEqual(s.accepted,['run']);assert.equal(s.context.memoryReceipts.length,1);
});
test('main result extraction cannot adopt Memory into a replacement conversation',async()=>{
 const s=fixture();let release!:()=>void;
 s.host.resultTextSource=async()=>{await new Promise<void>(resolve=>release=resolve);return {content:'actual source',hash:'file-hash'};};
 const pending=s.call();await Promise.resolve();s.host.mainContext={memoryReceipts:[]};release();
 await assert.rejects(pending,/tool_scope_denied/);assert.deepEqual(s.accepted,[]);assert.deepEqual(s.host.mainContext.memoryReceipts,[]);
});
test('main result acceptance rejects a context replaced during the recursive review',async()=>{
 const s=fixture();s.host.recursiveTools.call=async()=>{s.host.mainContext={};return {accepted:true};};
 await assert.rejects(s.call(),/tool_scope_denied/);assert.deepEqual(s.accepted,[]);
});
