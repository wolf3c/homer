import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {Homer} from '../src/service.js';
import {MAIN_TOOLS} from '../src/tools.js';
import type {Config} from '../src/config.js';
import type {EngineOptions} from '../src/engine.js';
import {MemoryDemoEngine} from './fixtures/memory-demo-engine.js';
function fixture(hold=false){
 mkdirSync('.codex/scratch/memory-system/tests',{recursive:true});const root=mkdtempSync(resolve('.codex/scratch/memory-system/tests/service-'));
 mkdirSync(join(root,'workspace/materials'),{recursive:true});mkdirSync(join(root,'runtime'));
 writeFileSync(join(root,'workspace/materials/sample.md'),'# 合成材料\n本项目文档使用 Markdown。');
 const config:Config={workspace:join(root,'workspace'),runtime:join(root,'runtime'),codexHome:join(root,'home'),codexBin:'/usr/bin/false',model:'offline-demo',effort:'medium',requiresOpenaiAuth:false,timeoutMs:3000,mainTimeoutMs:3000,stopGraceMs:100};
 const options:EngineOptions[]=[],turns:string[]=[];
 const create=()=>new Homer(config,async()=>{},(o,h)=>{options.push(o);const e=new MemoryDemoEngine(o,h,hold);const turn=e.turn.bind(e);e.turn=async(t,p)=>{turns.push(t);return turn(t,p);};return e;});
 return {create,config,options,turns};
}
test('HMR-MEMORY-FLOW: natural-language writes, same-thread restart, correction and forget are real service actions',async()=>{
 const f=fixture();let app=f.create();try{
  await app.start();const thread=app.store.meta('mainThread'),hash=app.store.meta('mainToolsHash');
  assert.match(await app.message('请记住：以后报告都用中文。'),/已记住/);
  await app.close();app=f.create();await app.start();assert.equal(app.store.meta('mainThread'),thread);assert.equal(app.store.meta('mainToolsHash'),hash);
  assert.match(await app.message('你记得我什么'),/中文/);assert.ok(f.turns.at(-1)!.includes('宿主记忆数据'));
  await app.message('请把这条记忆纠正为：以后报告都用英文。');assert.equal(app.memory.search('报告')[0]?.content,'以后报告都用英文。');
  await app.message('忘掉这条记忆');assert.equal(app.memory.list().entries.length,0);
  await app.close();app=f.create();await app.start();assert.equal(app.memory.list().entries.length,0);
  assert.equal(app.store.meta('mainThread'),thread);assert.deepEqual(f.options[0]!.tools,MAIN_TOOLS);
  assert.deepEqual(f.options[0]!.readRoots,[f.options[0]!.cwd]);assert.ok(!f.options[0]!.readRoots.includes(f.config.runtime));
 }finally{await app.close();}
});
test('HMR-MEMORY-FLOW: automatic receipt, always-on policy and correction CAS share one authoritative store',async()=>{
 const f=fixture();const app=f.create();try{
  await app.start();assert.match(await app.message('我以后报告都用中文。'),/已记住/);
  await app.message('暂停记忆');assert.equal(app.memory.settings().autoSave,true);assert.equal(app.memory.settings().enabled,true);
  await app.message('我一直喜欢简短回答。');assert.equal(app.memory.list().entries.length,2);
  const e=app.memory.search('报告')[0]!;
  await app.manageMemory({action:'correct',operationId:'ui-correct',id:e.id,expectedRevision:e.revision,content:'以后报告都用英文。'});
  assert.equal(app.memory.read(e.id).revision,2);
  await assert.rejects(()=>app.manageMemory({action:'correct',operationId:'ui-old',id:e.id,expectedRevision:1,content:'以后报告都用中文。'}),/revision_conflict/);
  await app.message('关闭记忆');assert.ok(app.memory.snapshot('报告').entries.length);assert.match(await app.message('你记得什么'),/英文/);
  await app.message('开启记忆');assert.equal(app.memory.settings().enabled,true);assert.equal(app.memory.settings().autoSave,true);
 }finally{await app.close();}
});
test('HMR-MEMORY-WORKER: forget stops active snapshot; old callbacks cannot write or return as accepted',async()=>{
 const f=fixture(true),app=f.create();try{
  await app.start();await app.message('请记住：以后报告都用中文。');
  await app.message('派发合成事项');
  const end=Date.now()+3000;while(!f.options.some(o=>o.tools.some(t=>t.name==='read_material'))){assert.ok(Date.now()<end,'synthetic worker did not start');await new Promise(r=>setTimeout(r,5));}
  const run=app.store.runs()[0]!;const worker=f.options.find(o=>o.tools.some(t=>t.name==='read_material'))!;
  assert.ok(!worker.tools.some(t=>t.name.startsWith('memory_')));assert.deepEqual(worker.readRoots,[worker.cwd]);
  const e=app.memory.list().entries[0]!;await app.manageMemory({action:'forget',operationId:'ui-forget',id:e.id,expectedRevision:1});
  await app.idle();assert.notEqual(app.store.run(run.id)!.status,'succeeded');assert.equal(app.store.run(run.id)!.stopReason,'memory_stale');
  assert.throws(()=>app.memory.validateRun(run.id),/epoch_stale/);assert.equal(app.memory.list().entries.length,0);
 }finally{await app.close();}
});
test('HMR-MEMORY-WORKER: reviewed candidate promotes only matter fact and visible receipt',async()=>{
 const f=fixture(),app=f.create();try{
  await app.start();await app.message('派发合成事项');await app.idle();const run=app.store.runs()[0]!;
  assert.equal(run.status,'succeeded');assert.equal(app.memory.list().entries.length,1);
  assert.equal(app.memory.snapshot('文档').entries.length,0);assert.equal(app.memory.snapshot('文档',{matterId:run.matterId}).entries.length,1);
  assert.ok(app.history.list(app.store.meta('mainThread')!).some(m=>m.text.includes('已记住')));
 }finally{await app.close();}
});
test('HMR-MEMORY-WORKER: failed snapshot binding cannot leave an unfenced queued run',async()=>{
 const f=fixture(),app=f.create();try{
  await app.start();app.store.db.exec("CREATE TRIGGER reject_snapshot BEFORE INSERT ON memory_snapshots BEGIN SELECT RAISE(ABORT,'synthetic_snapshot_failure'); END;");
  await app.message('派发合成事项');assert.equal(app.store.runs().length,0);assert.equal(app.store.matters().length,0);
 }finally{await app.close();}
});
