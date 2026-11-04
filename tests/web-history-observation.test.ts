// Existing host clock/activity evidence through the bounded transport; no constructor or engine.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Homer} from '../src/service.js';
import {fixture} from './web-history-followup-fixture.mjs';
test('bounded state retains the same host observation clock and activity guard without full history',async()=>{
 const f=await fixture(2,'after');try{
  const host=Object.assign(Object.create(Homer.prototype),{store:f.store,mainContext:{processId:'node-1',messageId:'node-1',generation:{turnId:'turn-1'},nativeActivity:{turnId:'turn-1',compactions:new Map()}},main:{available:true}});
  const control=()=>Homer.prototype.conversationControlState.call(host);
  const before=Date.now(),initial=control();assert.ok(initial.observedAtMs>=before&&initial.observedAtMs<=Date.now());assert.equal(initial.mainActivity?.stage,'native');
  const read=f.bridge.history.state;f.bridge.history.state=async()=>({...await read(),...control()});
  const state=await f.bridge.history.state();assert.ok(state.history);assert.equal(state.history.protocol,3);assert.equal(state.mainActivity?.processId,'node-1');assert.ok(Number.isFinite(state.observedAtMs));
  host.main.available=false;assert.equal(control().mainActivity?.stage,'unknown');host.main.available=true;host.mainContext.nativeActivity.ended=true;assert.equal(control().mainActivity?.stage,'finishing');
  host.mainContext=undefined;assert.equal(control().mainActivity,null);assert.equal(control().isRunning,false);
 }finally{await f.close();}
});
