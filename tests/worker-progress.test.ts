import {test} from 'node:test';import assert from 'node:assert/strict';
import {WorkerProgressStore,type WorkerScope} from '../src/worker-progress.js';
const scope:WorkerScope={taskId:'task',version:1,runId:'run',epoch:0,threadId:'thread',turnId:'turn'};
test('public progress is bounded, ordered and scoped to exact current execution',()=>{
 const s=new WorkerProgressStore();assert.equal(s.message(scope,{phase:'analysis',text:'private',completed:true}),false);assert.equal(s.message(scope,{phase:'commentary',text:'partial',completed:false}),false);
 assert.equal(s.message(scope,{phase:'commentary',text:'公开进展',completed:true}),true);assert.equal(s.get(scope)?.output?.text,'公开进展');
 for(const [key,value] of Object.entries({version:2,epoch:1,runId:'other',turnId:'later',threadId:'other',taskId:'other'}))assert.equal(s.get({...scope,[key]:value}),undefined);
 assert.equal(s.plan(scope,[{step:'核对',status:'inProgress'}]),true);assert.equal(s.get(scope)?.revision,2);assert.equal(s.plan(scope,[{step:'private',status:'invented'}]),false);
 s.message({...scope,turnId:'new'},{phase:'commentary',text:'新段',completed:true});assert.equal(s.get(scope),undefined);assert.equal(s.get({...scope,turnId:'new'})?.plan,undefined);
});
test('tool progress keeps only safe category, not arguments or output',()=>{
 const s=new WorkerProgressStore();s.tool(scope,{threadId:'thread',turnId:'turn',itemId:'item',category:'command',status:'running',completed:false});
 assert.deepEqual(s.get(scope)?.output,{type:'tool',text:'运行命令'});
});
test('an explicit empty plan clears prior steps without erasing the latest public output',()=>{
 const s=new WorkerProgressStore();s.message(scope,{phase:'commentary',text:'正在核对',completed:true});
 s.plan(scope,[{step:'旧步骤',status:'inProgress'}]);
 assert.equal(s.plan(scope,[]),true);assert.deepEqual(s.get(scope)?.plan,[]);
 assert.equal(s.get(scope)?.output?.text,'正在核对');assert.equal(s.get(scope)?.revision,3);
});
