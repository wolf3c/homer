import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TurnExecution,validateExecutionLimits} from '../src/execution-limits.js';
const pricing={inputCnyPerMillion:2,cachedInputCnyPerMillion:0.2,outputCnyPerMillion:3};
const counters=(inputTokens:number,cachedInputTokens:number,outputTokens:number)=>({inputTokens,cachedInputTokens,outputTokens});
test('mixed cache cost uses cumulative deltas and never doubles reasoning',()=>{
 const x=new TurnExecution({pricing},counters(100,20,10));
 const frame={total:{...counters(1100,420,210),reasoningOutputTokens:100}};
 assert.equal(x.usage(frame).estimatedCostCny,0.00188);
 assert.equal(x.usage(frame).estimatedCostCny,0.00188);
});
test('resumed segment excludes history; reset and missing counters are unknown',()=>{
 const x=new TurnExecution({pricing});
 assert.equal(x.usage({total:counters(1100,420,210),last:counters(1000,400,200)}).estimatedCostCny,0.00188);
 assert.equal(x.usage({total:counters(10,0,2)}).costStatus,'unavailable');
 assert.equal(new TurnExecution({pricing},counters(0,0,0)).usage({total:{inputTokens:1}}).estimatedCostCny,null);
});
test('strict limit validation',()=>{
 for(const v of [{maxCostCny:1},{maxCostCny:NaN},{maxConsecutiveCompactions:1},{unknown:1},{pricing:{...pricing,bad:1}}])assert.throws(()=>validateExecutionLimits(v));
 assert.deepEqual(validateExecutionLimits({maxConsecutiveCompactions:0}),{maxConsecutiveCompactions:0});
});
test('loop only resets on novel successful evidence',()=>{
 const x=new TurnExecution({maxConsecutiveCompactions:3});
 x.evidence({type:'commandExecution',status:'completed',exitCode:0,aggregatedOutput:'a'});
 x.compact('1');x.evidence({type:'commandExecution',status:'completed',exitCode:0,aggregatedOutput:'a',durationMs:4});x.compact('2');
 x.evidence({type:'commandExecution',status:'failed',aggregatedOutput:'b'});assert.equal(x.compact('3').stopReason,'engine_compaction_loop');
 const y=new TurnExecution({maxConsecutiveCompactions:3});y.compact('1');y.evidence({type:'commandExecution',status:'completed',exitCode:0,aggregatedOutput:'new'});assert.equal(y.compact('2').consecutiveCompactions,1);
});
test('fresh zero is estimated only with complete counters and pricing',()=>{
 const zero=counters(0,0,0);
 assert.equal(new TurnExecution({pricing},zero).usage({total:zero}).estimatedCostCny,0);
 assert.equal(new TurnExecution({},zero).usage({total:zero}).costStatus,'unavailable');
 assert.equal(new TurnExecution({pricing}).usage({total:counters(100,20,10)}).costStatus,'unavailable');
 assert.equal(new TurnExecution({pricing}).usage({total:counters(100,20,10),last:counters(101,20,10)}).costStatus,'unavailable');
});
test('incomplete first resumed observation cannot later drop the first segment',()=>{
 const x=new TurnExecution({pricing});x.usage({total:{inputTokens:100}});
 assert.equal(x.usage({total:counters(1100,0,20),last:counters(100,0,10)}).costStatus,'unavailable');
});
test('MCP metadata and dynamic domain failure do not reset evidence',()=>{
 const x=new TurnExecution({maxConsecutiveCompactions:3});
 x.evidence({type:'mcpToolCall',status:'completed',result:{content:[{type:'text',text:'same'}],_meta:{timestamp:1}}});x.compact('a');
 x.evidence({type:'mcpToolCall',status:'completed',result:{content:[{type:'text',text:'same'}],_meta:{timestamp:2}}});
 x.evidence({type:'dynamicToolCall',success:true,contentItems:[{type:'inputText',text:JSON.stringify({status:'failed',error:'synthetic'})}]});
 x.evidence({type:'mcpToolCall',status:'completed',result:{isError:true,content:[{type:'text',text:'failure'}]}});
 assert.equal(x.compact('b').consecutiveCompactions,2);
});
test('impossible historical cache baseline poisons resumed estimate without cost guard',()=>{
 const x=new TurnExecution({pricing,maxCostCny:0.000001});
 const result=x.usage({total:counters(100,90,10),last:counters(90,0,5)});
 assert.equal(result.costStatus,'unavailable');assert.equal(result.estimatedCostCny,null);assert.equal(result.stopReason,undefined);
 assert.equal(x.usage({total:counters(200,90,20),last:counters(100,0,10)}).costStatus,'unavailable');
});
test('MCP empty content and unchanged generic content retain novel structured evidence',()=>{
 const x=new TurnExecution({maxConsecutiveCompactions:3});
 x.compact('1');x.compact('2');
 x.evidence({type:'mcpToolCall',status:'completed',result:{content:[],structuredContent:{rows:[{value:'new'}]}}});
 assert.equal(x.compact('3').consecutiveCompactions,1);
 const result=(value:string)=>({type:'mcpToolCall',status:'completed',result:{content:[{type:'text',text:'Success'}],structuredContent:{rows:[{value}]}}});
 x.evidence(result('first'));x.compact('4');x.evidence(result('second'));
 assert.equal(x.compact('5').consecutiveCompactions,1);
 x.evidence({...result('second'),result:{...result('second').result,_meta:{timestamp:2}}});assert.equal(x.compact('6').consecutiveCompactions,2);
});
