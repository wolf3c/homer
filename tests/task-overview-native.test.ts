import {test} from 'node:test';import assert from 'node:assert/strict';
import {overviewFixture} from './task-overview-fixture.js';
import {readTaskOverview,classifyTask,readTaskDetail} from '../src/task-overview.js';import {homerWebBridge} from '../src/web-homer.js';
test('native schema supports Main text settlement without Result or Delivery and stays read-only',()=>{
 const f=overviewFixture();try{
  f.tasks.settleTask(f.actor,{operationId:'settle',taskId:f.taskId,expectedRevision:1,outcome:'succeeded'});f.store.db.exec('PRAGMA query_only=ON');const before=f.store.db.prepare('SELECT total_changes() n').get();
  const row=readTaskOverview(f.store.db).tasks[0]!;assert.equal(row.workers.length,0);assert.deepEqual(row.results,[]);assert.deepEqual(row.deliveries,[]);assert.equal(classifyTask(row).key,'complete');assert.equal(row.sourceRequestId,f.actor.sourceRequestId);assert.equal(readTaskDetail(f.store.db,f.taskId).runs.length,0);assert.deepEqual(f.store.db.prepare('SELECT total_changes() n').get(),before);
 }finally{f.close();}
});
test('real WebBridge overview bypasses snapshot/history/files and uses six readonly SELECTs',async()=>{
 const f=overviewFixture();try{
  const statements:string[]=[],db={prepare(sql:string){statements.push(sql);return f.store.db.prepare(sql);}} as typeof f.store.db;
  const denied=()=>{throw Error('unexpected_history_or_file_access');};
  const app={store:{db},workerProgress:{revision:0},registerChannelCapabilities(){},snapshot:denied,conversationState:denied,tasks:new Proxy({},{get:denied}),files:new Proxy({},{get:denied})} as unknown as import('../src/service.js').Homer;
  f.store.db.exec('PRAGMA query_only=ON');const bridge=homerWebBridge(app),overview=await bridge.taskOverview!.list();assert.equal(overview.tasks.length,1);assert.equal(statements.length,6);assert.ok(statements.every(sql=>/^SELECT\b/.test(sql)));assert.ok(statements.every(sql=>!/(?:payloadJson|checkpointJson|prompt(?!,1,80))/.test(sql)));
  statements.length=0;assert.equal((await bridge.taskOverview!.detail(f.taskId)).runs.length,0);assert.equal(statements.length,9);
 }finally{f.close();}
});
test('one thousand Tasks still use six read-only SELECTs without fabricated child records',()=>{
 const f=overviewFixture();try{
  for(let n=0;n<1000;n++){
   f.tasks.createTask(f.actor,{operationId:'batch-'+n,goal:'batch '+n,authority:f.authority});
  }
  const statements:string[]=[],db={prepare(sql:string){statements.push(sql);return f.store.db.prepare(sql);}} as typeof f.store.db;
  f.store.db.exec('PRAGMA query_only=ON');const before=f.store.db.prepare('SELECT total_changes() n').get(),overview=readTaskOverview(db);
  assert.equal(overview.tasks.length,1001);assert.equal(statements.length,6);assert.ok(overview.tasks.every(t=>t.workers.length===0));assert.deepEqual(f.store.db.prepare('SELECT total_changes() n').get(),before);
 }finally{f.close();}
});
