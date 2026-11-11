import test from 'node:test';
import assert from 'node:assert/strict';
import {ReceptionTimings} from '../src/reception-timings.js';
import {homerWebBridge} from '../src/web-homer.js';
import {Homer} from '../src/service.js';
import {Files} from '../src/files.js';
import {historyFixture} from './web-history-loading-fixture.js';

test('state read measurements preserve values and failures without retaining read content',()=>{
 const timings=new ReceptionTimings();
 try{
  const value={private:'SYNTHETIC_PRIVATE_READ'};
  assert.equal(timings.measure('state_history',()=>value),value);
  const failure=Error('SYNTHETIC_PRIVATE_ERROR');
  assert.throws(()=>timings.measure('state_history',()=>{throw failure;}),error=>error===failure);
  const records=timings.read().records;
  assert.deepEqual(records.map(row=>row.phase),['state_history','state_history']);
  assert.ok(records.every(row=>Number.isFinite(row.durationMs)&&row.durationMs!>=0));
  assert.equal(JSON.stringify(records).includes('SYNTHETIC_PRIVATE'),false);
 }finally{timings.close();}
});

test('paged state reads expose their duration without changing persisted facts',async()=>{
 const f=historyFixture(20),timings=new ReceptionTimings();
 const app=Object.assign(Object.create(Homer.prototype),f,{files:new Files('.codex/scratch/deepseek-adaptation-20261028/unused-state-workspace'),workers:new Map(),receptionTimings:timings,registerWebSurface(){}}) as Homer;
 try{
  const bridge=homerWebBridge(app);app.webHistoryPages();
  const before=f.store.db.prepare('SELECT total_changes() n').get()!.n;
  const history=await bridge.history!.state();
  assert.equal(history.threadId,'synthetic-history');assert.ok(history.messages.length>0);
  assert.ok(timings.read().records.some(row=>row.phase==='state_history'&&Number.isFinite(row.durationMs)));
  assert.equal(f.store.db.prepare('SELECT total_changes() n').get()!.n,before);
  assert.equal(JSON.stringify(timings.read()).includes('合成问题'),false);
 }finally{timings.close();f.close();}
});
