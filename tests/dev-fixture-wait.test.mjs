import {test} from 'node:test';
import assert from 'node:assert/strict';
import {waitForDevCondition} from './fixtures/dev-condition.mjs';

test('a valid build keeps its owning test deadline when wall time advances beyond a polling deadline',async t=>{
 t.mock.timers.enable({apis:['Date'],now:0});
 const pending=waitForDevCondition(()=>Date.now()>=46000,{signal:t.signal,events:[],exited:()=>false});
 t.mock.timers.tick(46000);
 await pending;
});

test('a rejected build fails immediately with its code instead of a readiness timeout',async t=>{
 await assert.rejects(waitForDevCondition(()=>false,{signal:t.signal,events:[{type:'progress',text:'候选未生效：dev_candidate_check_failed；旧版继续运行。'}],exited:()=>false}),/dev_fixture_build_rejected:dev_candidate_check_failed/);
});

test('owner exit and the unchanged owning test deadline stop pending fixture waits',async t=>{
 await assert.rejects(waitForDevCondition(()=>false,{signal:t.signal,events:[],exited:()=>true}),/dev_fixture_owner_exited/);
 const controller=new AbortController();
 const pending=waitForDevCondition(()=>false,{signal:controller.signal,events:[],exited:()=>false});
 controller.abort();
 await assert.rejects(pending,{name:'AbortError'});
});
