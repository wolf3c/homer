// Requirements-derived synthetic service checks. No model, account or daily DB.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {Homer} from '../src/service.js';
import {MemoryDemoEngine} from './fixtures/memory-demo-engine.js';
import type {TurnResult} from '../src/engine.js';

const until = async (check:()=>boolean) => {
  const end=Date.now()+3000;
  while(!check()) { assert.ok(Date.now()<end,'synthetic worker did not start'); await new Promise(r=>setTimeout(r,5)); }
};
function fixture() {
  const base=resolve('.codex/scratch/recursive-agent-implementation');
  mkdirSync(base,{recursive:true});
  const root=mkdtempSync(join(base,'memory-invalidation-'));
  mkdirSync(join(root,'runtime'));
  mkdirSync(join(root,'workspace/materials'),{recursive:true});
  writeFileSync(join(root,'workspace/materials/sample.md'),'# Synthetic reference\nNo private information.');
  const peers:Peer[]=[];let turn=0;
  class Peer extends MemoryDemoEngine {
    closes=0;
    interrupts=0;
    mainHeld=false;
    private mainRelease?: (result:TurnResult)=>void;
    snapshot?:{epoch:number;entries:{id:string;revision:number;content:string}[]};
    async turn(text:string, options?:{onStarted?:(id:string)=>void}):Promise<TurnResult> {
      if(this.worker) this.snapshot=JSON.parse(text).memory;
      if(!this.worker&&text.startsWith('synthetic:hold-琥珀')) {
        this.turnId='synthetic-held-main-'+ ++turn;options?.onStarted?.(this.turnId);this.mainHeld=true;
        return new Promise(resolve=>{this.mainRelease=resolve;});
      }
      if(!this.worker&&text.startsWith('忘掉合成甲记忆并核对重试')) {
        this.turnId='synthetic-forget-retry-'+ ++turn;options?.onStarted?.(this.turnId);
        const found=await this.call('memory_search',{query:'琥珀'}),entry=found.entries[0];
        await this.call('memory_read',{id:entry.id});
        const args={operationId:'synthetic-forget-retry',id:entry.id,expectedRevision:entry.revision};
        const receipt=await this.call('memory_forget',args);
        assert.deepEqual(await this.call('memory_forget',args),receipt,'same operation retry must return its original receipt');
        return {status:'completed',text:'合成遗忘恰一次，重试返回原收据。'};
      }
      if(!this.worker&&text.startsWith('synthetic:dispatch-')) {
        this.turnId='synthetic-invalidation-turn-'+ ++turn;options?.onStarted?.(this.turnId);
        const goal=text.startsWith('synthetic:dispatch-A')?'琥珀':'翡翠';
        const run=await this.call('dispatch_work',{title:'Synthetic '+goal,goal,material:'sample.md'});
        return {status:'completed',text:run.id};
      }
      return super.turn(text,options);
    }
    async interrupt(){this.interrupts++;this.mainRelease?.({status:'interrupted',text:''});this.mainRelease=undefined;return super.interrupt();}
    async close(){this.closes++;return super.close();}
  }
  const app=new Homer({runtime:join(root,'runtime'),workspace:join(root,'workspace'),codexHome:join(root,'empty-home'),codexBin:'/usr/bin/false',model:'synthetic-only',effort:'medium',requiresOpenaiAuth:false,timeoutMs:30000,mainTimeoutMs:3000,stopGraceMs:100},async()=>{},(o,h)=>{const peer=new Peer(o,h,true);peers.push(peer);return peer;});
  const start=async()=>{
    await app.start();
    await app.message('请记住：合成甲参考代号为琥珀。');
    await app.message('请记住：合成乙参考代号为翡翠。');
    const a=app.memory.list().entries.find(e=>e.content.includes('琥珀'))!;
    const b=app.memory.list().entries.find(e=>e.content.includes('翡翠'))!;
    await app.message('synthetic:dispatch-A');await app.message('synthetic:dispatch-B');
    await until(()=>peers.filter(p=>p.worker&&p.snapshot).length===2);
    const runs=app.store.runs();
    const workerA=peers.find(p=>p.worker&&p.snapshot?.entries.some(e=>e.id===a.id))!;
    const workerB=peers.find(p=>p.worker&&p.snapshot?.entries.some(e=>e.id===b.id))!;
    assert.deepEqual(workerA.snapshot!.entries.map(e=>e.id),[a.id]);
    assert.deepEqual(workerB.snapshot!.entries.map(e=>e.id),[b.id]);
    return {a,b,runA:runs.find(r=>r.goal==='琥珀')!,runB:runs.find(r=>r.goal==='翡翠')!,workerA,workerB};
  };
  return {app,start,peers};
}
for(const action of ['correct','forget'] as const) test('HMR-MEMORY-SCOPE: '+action+' A stops its consumer, preserves unrelated B and fences old A results',async()=>{
  const {app,start}=fixture();try{
    const {a,runA,runB,workerA,workerB}=await start();
    const epoch=app.memory.settings().epoch,beforeB=app.memory.runSnapshot(runB.id),runEpoch=app.tasks.run(runB.id).epoch;
    await app.manageMemory({action,operationId:'synthetic-'+action,id:a.id,expectedRevision:a.revision,...(action==='correct'?{content:'合成甲参考代号改为玛瑙。'}:{})});
    assert.equal(workerB.closes,0,'unrelated B process must stay alive');
    assert.equal(app.store.run(runB.id)!.status,'running');
    assert.equal(app.tasks.run(runB.id).epoch,runEpoch);
    assert.deepEqual(app.memory.runSnapshot(runB.id),beforeB,'a live snapshot cannot silently change text');
    assert.equal(app.memory.settings().epoch,epoch,'local entry edits do not advance the global read fence');
    assert.equal(workerA.closes,1,'affected A must have an actual close confirmation');
    assert.equal(app.store.run(runA.id)!.stopReason,'memory_stale');
    assert.throws(()=>app.memory.runSnapshot(runA.id),/memory_epoch_stale/);
    await assert.rejects(()=>workerA.call('write_markdown',{filename:'stale.md',content:'# Stale synthetic result'}),/stale|not_live|stopped/);
    assert.ok(await workerB.call('read_material',{}));
  }finally{await app.close();}
});
test('HMR-MEMORY-SCOPE: rejected disable and pause never interrupt unrelated consumers or change snapshots',async()=>{
  const {app,start}=fixture();try{
    const {a,runA,runB,workerA,workerB}=await start();const before=app.memory.settings();
    for(const change of [{enabled:false},{autoSave:false}])await assert.rejects(()=>app.manageMemory({action:'settings',operationId:'synthetic-denied',expectedRevision:before.revision,...change}),/memory_always_on/);
    assert.deepEqual(app.memory.settings(),before);assert.equal(workerA.closes,0);assert.equal(workerB.closes,0);
    assert.ok(app.memory.read(a.id));for(const run of [runA,runB])assert.doesNotThrow(()=>app.memory.validateRun(run.id));
  }finally{await app.close();}
});
test('HMR-MEMORY-SCOPE: main turn tracks actual references instead of the global epoch',async()=>{
  const {app,start,peers}=fixture();try{
    const {a,b}=await start();const pending=app.message('synthetic:hold-琥珀');
    void pending.catch(()=>{}); // Cleanup must not leave a rejected waiter on RED.
    await until(()=>peers.some(p=>p.mainHeld));const main=peers.find(p=>p.mainHeld)!;
    await app.manageMemory({action:'forget',operationId:'synthetic-forget-B',id:b.id,expectedRevision:b.revision});
    assert.equal(main.interrupts,0,'unrelated B must not interrupt a main turn reading A');
    await app.manageMemory({action:'correct',operationId:'synthetic-correct-A',id:a.id,expectedRevision:a.revision,content:'合成甲参考代号改为玛瑙。'});
    assert.equal(main.interrupts,1,'main A must be interrupted when its referenced revision changes');
    assert.match(await pending,/停止|中断/);
  }finally{await app.close();}
});
test('HMR-MEMORY-SCOPE: forgetting via the main tool preserves same-operation retry receipts after deleting the entry',async()=>{
  const {app,start}=fixture();try{
    await start();assert.match(await app.message('忘掉合成甲记忆并核对重试'),/恰一次/);
  }finally{await app.close();}
});
