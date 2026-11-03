import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture,main} from './recursive-fixture.js';
import {readTaskOverview,classifyTask,readTaskDetail} from '../src/task-overview.js';
test('real native schema: main root with no Run completes only after accepted result and recorded publication, then projection stays read-only',()=>{
 const f=fixture();
 try{
  const task=f.tasks.task(f.root.taskId);
  const delivery=f.tasks.publish(main,{operationId:'overview-publication',taskId:task.id,version:task.headVersion,expectedTaskRevision:task.revision,resultId:null,text:'合成根结果',publishedFileResultId:null,outcome:'succeeded',evidence:{facts:'checked'},children:[]});
  let row=readTaskOverview(f.store.db).tasks.find(t=>t.id===task.id)!;
  assert.equal(row.currentRunId,null);assert.equal(row.result?.state,'accepted');assert.equal(row.delivery?.state,'prepared');assert.notEqual(classifyTask(row).key,'complete');
  f.tasks.markDelivery(delivery.deliveryId,'recorded');
  f.store.db.exec('PRAGMA query_only=ON');
  const before=f.store.db.prepare('SELECT total_changes() AS count').get();
  row=readTaskOverview(f.store.db).tasks.find(t=>t.id===task.id)!;
  assert.equal(classifyTask(row).key,'complete');assert.equal(row.sourceRequestId,main.sourceRequestId);assert.equal(readTaskDetail(f.store.db,task.id).runs.length,0);
  assert.deepEqual(f.store.db.prepare('SELECT total_changes() AS count').get(),before);
 }finally{f.close();}
});
test('real WebBridge overview bypasses snapshot/history/files and batches indexed current fact reads',async()=>{
 const {homerWebBridge}=await import('../src/web-homer.js');
 const f=fixture();
 try{
  const statements:string[]=[];
  const db={prepare(sql:string){statements.push(sql);return f.store.db.prepare(sql);}} as typeof f.store.db;
  const denied=()=>{throw Error('legacy_projection_or_history_called');};
  const app={store:{db},registerChannelCapabilities(){},snapshot:denied,conversationState:denied,tasks:new Proxy({},{get:denied}),files:new Proxy({},{get:denied})} as unknown as import('../src/service.js').Homer;
  f.store.db.exec('PRAGMA query_only=ON');
  const bridge=homerWebBridge(app);
  const overview=await bridge.taskOverview!.list();assert.equal(overview.tasks.length,1);
  assert.equal(statements.length,6);assert.ok(statements.every(sql=>/^SELECT\b/.test(sql)));assert.equal(statements.filter(sql=>sql.includes("o.kind='update'")).length,1);
  const resultsPlan=f.store.db.prepare('EXPLAIN QUERY PLAN '+statements[1]).all().map(row=>row.detail).join('\n');
  assert.equal((resultsPlan.match(/SEARCH r USING INDEX results_run/g)??[]).length,2);
  const deliveryPlan=f.store.db.prepare('EXPLAIN QUERY PLAN '+statements[2]).all().map(row=>row.detail).join('\n');
  assert.match(deliveryPlan,/SEARCH d USING INDEX .*rootTaskId=\? AND version=\?/);
  statements.length=0;assert.equal((await bridge.taskOverview!.detail(f.root.taskId)).runs.length,0);assert.equal(statements.length,9);assert.ok(statements.slice(1).every(sql=>sql.includes('LIMIT 81')));
 }finally{f.close();}
});

test('ordering overview batches a thousand roots and current updates in six read-only SELECTs',()=>{
 const f=fixture();try{
  const columns=f.store.db.prepare('PRAGMA table_info(tasks)').all().map(r=>String(r.name));
  const numbers="WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM numbers WHERE n<1000) ";
  f.store.db.exec(numbers+"INSERT INTO matters(id,title,status,createdAt,rootTaskId,revision) SELECT 'batch-matter-'||n,title,status,createdAt,'batch-'||n,revision FROM numbers CROSS JOIN matters WHERE id='"+f.tasks.task(f.root.taskId).matterId+"'");
  const select=columns.map(name=>['id','rootTaskId'].includes(name)?"'batch-'||n":name==='matterId'?"'batch-matter-'||n":'t.'+name).join(',');
  f.store.db.exec(numbers+"INSERT INTO tasks("+columns.join(',')+") SELECT "+select+" FROM numbers CROSS JOIN tasks t WHERE t.id='"+f.root.taskId+"'");
  const statements:string[]=[];const db={prepare(sql:string){statements.push(sql);return f.store.db.prepare(sql);}} as typeof f.store.db;
  f.store.db.exec('PRAGMA query_only=ON');const before=f.store.db.prepare('SELECT total_changes() n').get(),start=performance.now();
  const overview=readTaskOverview(db),elapsedMs=performance.now()-start;
  assert.equal(overview.tasks.length,1001);assert.equal(statements.length,6);assert.ok(statements.every(sql=>/^SELECT/.test(sql)));assert.deepEqual(f.store.db.prepare('SELECT total_changes() n').get(),before);
  console.log(JSON.stringify({orderingProjectionRows:overview.tasks.length,selects:statements.length,elapsedMs,synthetic:true}));
 }finally{f.close();}
});
