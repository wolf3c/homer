import {test} from 'node:test';import assert from 'node:assert/strict';
import {WorkerProgressStore,type WorkerScope} from '../src/worker-progress.js';
import {nativeToolContent} from '../src/tool-content.js';
const scope:WorkerScope={taskId:'task',version:1,runId:'run',epoch:1,threadId:'thread',turnId:'turn'};
const selector={rootTaskId:'root',taskId:'task',runId:'run'};
const event=(id:string,completed=false)=>({threadId:'thread',turnId:'turn',itemId:id,category:'command' as const,status:completed?'completed' as const:'running' as const,completed,observedAtMs:completed?200:100,content:{input:{state:'recorded' as const,value:{command:'rg token=SECRET private customer',cwd:'/private/customer'}},output:completed?{state:'recorded' as const,value:{output:'private customer record',exitCode:0}}:{state:'pending' as const}}});
test('calls retain distinct identities, merge terminal once, and never publish raw content',()=>{
 const s=new WorkerProgressStore();s.recordCall(scope,event('a'));s.recordCall(scope,event('b'));s.recordCall(scope,event('a',true));
 const p=s.execution(selector,1);assert.equal(p.active.length,1);assert.equal(p.items.length,1);assert.equal(p.items[0]?.exitCode,0);
 const revision=p.revision;s.recordCall(scope,event('a',true));assert.equal(s.execution(selector,1).revision,revision);
 s.recordCall(scope,event('a'));assert.equal(s.execution(selector,1).active.length,1);
 assert.doesNotMatch(JSON.stringify(p),/SECRET|private|customer/);
 const d=s.call(selector,1,p.items[0]!.callKey);assert.doesNotMatch(JSON.stringify(d),/SECRET|private|customer/);assert.equal(d.summary.scope.turnId,'turn');
 assert.equal(s.execution({...selector,taskId:'other'},1).availability,'unavailable');
});
test('terminal first stays terminal; conflicting terminal is unknown; old scope cannot complete another call',()=>{
 const s=new WorkerProgressStore();s.recordCall(scope,event('a',true));s.recordCall(scope,event('a'));let p=s.execution(selector,1);assert.equal(p.active.length,0);
 s.recordCall(scope,{...event('a',true),status:'failed'});p=s.execution(selector,1);assert.equal(p.items[0]?.status,'unknown');
 assert.equal(s.recordCall({...scope,epoch:2},event('a',true),true),false);
});
test('bounded pages keep early active calls, validate scope and generation, and cannot claim full history',()=>{
 const s=new WorkerProgressStore();s.recordCall(scope,event('early'));
 for(let i=0;i<25;i++)s.recordCall(scope,event('done'+i,true));
 const first=s.execution(selector,1);assert.equal(first.active.length,1);assert.equal(first.items.length,20);assert.equal(first.hasMore,true);
 const second=s.execution(selector,1,first.before);assert.equal(second.items.length,5);assert.equal(second.hasMore,false);assert.equal(second.coverage,'partial');
 assert.throws(()=>s.execution({...selector,runId:'other'},1,first.before),/cursor/);
 assert.throws(()=>new WorkerProgressStore().execution(selector,1,first.before),/cursor_expired/);
 for(let i=25;i<150;i++)s.recordCall(scope,event('done'+i,true));
 const retained=s.execution(selector,1);assert.equal(retained.omitted,true);assert.equal(retained.active[0]?.scope.turnId,'turn');
});
test('missing source values, safe metadata, and standalone exitCode stay distinct',()=>{
 assert.deepEqual(nativeToolContent({type:'commandExecution',exitCode:9},true)?.output,{state:'recorded',value:{exitCode:9}});
 const s=new WorkerProgressStore();s.recordCall(scope,{...event('a',true),content:undefined,durationMs:0});const p=s.execution(selector,1);
 assert.equal(p.items[0]?.durationMs,0);assert.equal(s.call(selector,1,p.items[0]!.callKey).content?.output.state,'not-recorded');
});
test('command-derived read/search facts preserve standalone exit code',()=>{
 const s=new WorkerProgressStore();s.recordCall(scope,{...event('read',true),category:'readFiles',content:nativeToolContent({type:'commandExecution',command:'cat private.txt',exitCode:9},true)});
 const p=s.execution(selector,1);assert.equal(p.items[0]?.exitCode,9);assert.match(p.items[0]?.inputSummary??'',/cat/);assert.doesNotMatch(JSON.stringify(p),/private.txt/);
});
test('sparse terminal replays preserve retained output and its semantic revision',()=>{
 const s=new WorkerProgressStore();s.recordCall(scope,event('a',true));const first=s.execution(selector,1);
 assert.equal(s.recordCall(scope,{...event('a',true),content:undefined}),false);
 const next=s.execution(selector,1);assert.equal(next.revision,first.revision);assert.equal(next.items[0]?.outputSummary,first.items[0]?.outputSummary);
 assert.deepEqual(s.call(selector,1,next.items[0]!.callKey).content?.output,{state:'recorded',value:{exitCode:0}});
});
