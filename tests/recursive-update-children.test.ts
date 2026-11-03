import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,delegate,running,main,contract} from './recursive-fixture.js';
test('HMR-RECURSIVE replacement records distinct child stop, transfer and update responsibilities, never silently treats them as retain',()=>{
  const f=fixture();try{
    const a=delegate(f,'a'),b=delegate(f,'b'),c=delegate(f,'c');running(f,a.taskId);running(f,b.taskId);running(f,c.taskId);
    const root=f.tasks.task(f.root.taskId),receipt=f.tasks.update(main,{operationId:'replace-parent',taskId:root.id,version:1,expectedTaskRevision:root.revision,mode:'stop_replace',contract:contract('aggregate'),queuedDisposition:[],children:[{taskId:a.taskId,action:'stop'},{taskId:b.taskId,action:'transfer',coordinatorAgentId:main.agentId},{taskId:c.taskId,action:'update'}]});
    assert.equal(f.tasks.task(a.taskId).controlState,'stopping');
    const stop=(receipt.childStops as {taskId:string;operationKey:string}[]).find(s=>s.taskId===a.taskId)!;assert.ok(stop);f.tasks.confirmStop(stop.operationKey,true);assert.equal(f.tasks.task(a.taskId).outcome,'cancelled');
    assert.equal(f.tasks.task(b.taskId).controlState,'held');assert.equal(f.tasks.task(c.taskId).controlState,'held');
    assert.ok((receipt.childActions as {taskId:string;state:string}[]).some(v=>v.taskId===c.taskId&&v.state==='held_update_required'));
  }finally{f.close();}
});
