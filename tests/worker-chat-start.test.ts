import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixtures/worker-chat-host.js';
import {WorkerInteractionMcp} from '../src/worker-interaction-mcp.js';

test('cancelling while the Worker endpoint starts cannot subsequently start its engine',async t=>{
  const f=fixture();let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  let entered!:()=>void;const waiting=new Promise<void>(resolve=>{entered=resolve;});
  try{
    await f.app.start();
    const start=WorkerInteractionMcp.prototype.start;
    t.mock.method(WorkerInteractionMcp.prototype,'start',async function(this:WorkerInteractionMcp){entered();await gate;return start.call(this);});
    let runId='';
    f.setScript(async(main,text)=>{
      if(text==='start'){
        runId=(await main.call('worker_open',{message:'Synthetic cancelled startup'})).runId;
      }
      return {status:'completed',text:'Synthetic response'};
    });
    await f.app.message('start','start-boundary-source');await waiting;
    await f.app.stop(runId);release();await f.app.idle();
    assert.equal(f.engines.filter(engine=>engine.options.role==='worker').length,0);
    assert.equal(f.app.tasks.run(runId).status,'cancelled');
  }finally{release?.();await f.close();}
});

test('a cancelled start cannot publish a late thread binding',async()=>{
  const f=fixture();let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  let entered!:()=>void;const waiting=new Promise<void>(resolve=>{entered=resolve;});
  try{
    await f.app.start();const factory=f.app['factory']!;
    f.app['factory']=(options,handler)=>{
      const engine=factory(options,handler);
      if(options.role==='worker')engine.start=async()=>{entered();await gate;return engine.threadId!;};
      return engine;
    };
    let runId='';
    f.setScript(async(main,text)=>{
      if(text==='start'){
        runId=(await main.call('worker_open',{message:'Synthetic cancelled startup'})).runId;
      }
      return {status:'completed',text:'Synthetic response'};
    });
    await f.app.message('start','binding-boundary-source');await waiting;
    await f.app.stop(runId);release();await f.app.idle();
    assert.equal(f.app.tasks.run(runId).threadId,null);
    assert.equal(f.app.tasks.run(runId).status,'cancelled');
  }finally{release?.();await f.close();}
});

test('a goal change during endpoint startup fences the old version before any engine starts',async t=>{
  const f=fixture();let release!:()=>void,entered!:()=>void,taskId='',runId='';
  const gate=new Promise<void>(resolve=>{release=resolve;}),waiting=new Promise<void>(resolve=>{entered=resolve;});
  try{
    await f.app.start();const start=WorkerInteractionMcp.prototype.start;
    t.mock.method(WorkerInteractionMcp.prototype,'start',async function(this:WorkerInteractionMcp){entered();await gate;return start.call(this);});
    f.setScript(async(main,text)=>{
      if(text==='start'){
        const opened=await main.call('worker_open',{message:'Original synthetic scope'});
        ({taskId,runId}=opened);
      }else if(text==='change')assert.equal((await main.call('task_update',{taskId,goal:'Revised synthetic scope'})).state,'confirmed');
      return {status:'completed',text:'Recorded'};
    });
    await f.app.message('start','starting-original-source');await waiting;
    await f.app.message('change','starting-revision-source');release();await f.app.idle();
    assert.equal(f.engines.filter(engine=>engine.options.role==='worker').length,0);
    assert.equal(f.app.tasks.run(runId).status,'cancelled');assert.equal(f.app.tasks.run(runId).version,1);
    assert.equal(f.app.tasks.task(taskId).headVersion,2);
    assert.equal(f.app.tasks.authority(taskId,2).sourceRequestId,'starting-revision-source');
  }finally{release?.();await f.close();}
});
