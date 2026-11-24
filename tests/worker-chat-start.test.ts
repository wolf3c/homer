import {openTaskWorker} from './fixtures/open-task-worker.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {fixture,until} from './fixtures/worker-chat-host.js';
import {WorkerInteractionMcp} from '../src/worker-interaction-mcp.js';

test('a text-only Worker completes without creating a run output directory',async()=>{
  const f=fixture();let taskId='',runId='';
  try{
    f.setScript(async(main,text)=>{
      if(text==='start')({taskId,runId}=await openTaskWorker(main,'Write a plain text reply.'));
      return {status:'completed',text:''};
    });
    await f.app.start();await f.app.message('start','text-only-source');
    await until(()=>f.engines.some(engine=>engine.options.role==='worker'&&engine.finish));
    f.engines.find(engine=>engine.options.role==='worker')!.finish!({status:'completed',text:'Plain text reply.'});
    await f.app.idle();
    assert.equal(f.app.tasks.run(runId).status,'succeeded');
    assert.equal(existsSync(join(f.app.files.outputs,taskId,runId)),false);
  }finally{await f.close();}
});

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
        runId=(await openTaskWorker(main,'Synthetic cancelled startup')).runId;
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
        runId=(await openTaskWorker(main,'Synthetic cancelled startup')).runId;
      }
      return {status:'completed',text:'Synthetic response'};
    });
    await f.app.message('start','binding-boundary-source');await waiting;
    await f.app.stop(runId);release();await f.app.idle();
    assert.equal(f.app.tasks.run(runId).threadId,null);
    assert.equal(f.app.tasks.run(runId).status,'cancelled');
  }finally{release?.();await f.close();}
});

test('a goal change during endpoint startup preserves the original assignment and permits startup',async t=>{
  const f=fixture();let release!:()=>void,entered!:()=>void,taskId='',runId='';
  const gate=new Promise<void>(resolve=>{release=resolve;}),waiting=new Promise<void>(resolve=>{entered=resolve;});
  try{
    await f.app.start();const start=WorkerInteractionMcp.prototype.start;
    t.mock.method(WorkerInteractionMcp.prototype,'start',async function(this:WorkerInteractionMcp){entered();await gate;return start.call(this);});
    f.setScript(async(main,text)=>{
      if(text==='start'){
        const opened=await openTaskWorker(main,'Original synthetic scope');
        ({taskId,runId}=opened);
      }else if(text==='change')assert.equal((await main.call('task_update',{taskId,goal:'Revised synthetic scope'})).state,'updated');
      return {status:'completed',text:'Recorded'};
    });
    await f.app.message('start','starting-original-source');await waiting;
    await f.app.message('change','starting-revision-source');release();
    await until(()=>f.engines.some(engine=>engine.options.role==='worker'&&engine.finish));
    const worker=f.engines.find(engine=>engine.options.role==='worker')!;assert.match(worker.input!,/Original synthetic scope/);
    worker.finish!({status:'completed',text:'Prior findings'});await f.app.idle();
    assert.equal(f.app.tasks.run(runId).status,'succeeded');assert.equal(f.app.tasks.run(runId).version,1);
    assert.equal(f.app.tasks.task(taskId).headVersion,2);
    assert.equal(f.app.tasks.version(taskId,2).sourceRequestId,'starting-revision-source');
  }finally{release?.();await f.close();}
});

test('archive closes a claimed Worker before the native start is sent',async t=>{
 const f=fixture();
 let taskId='',runId='',release!:()=>void,entered!:()=>void;
 const preparing=new Promise<void>(resolve=>{entered=resolve;});
 const gate=new Promise<void>(resolve=>{release=resolve;});
 try{
  await f.app.start();
  const start=WorkerInteractionMcp.prototype.start;
  t.mock.method(WorkerInteractionMcp.prototype,'start',async function(this:WorkerInteractionMcp){
   entered();
   await gate;
   return start.call(this);
  });
  f.setScript(async(main,body)=>{
   if(body==='Open claimed Worker')({taskId,runId}=await openTaskWorker(main,'Synthetic work before native startup'));
   else if(body==='Archive claimed Worker')assert.equal((await main.call('archive_work',{taskId})).state,'archived');
   return {status:'completed',text:'Recorded'};
  });
  await f.app.message('Open claimed Worker','claimed-before-archive');
  await preparing;
  assert.equal(f.app.tasks.run(runId).phase,'starting');
  await f.app.message('Archive claimed Worker','archive-before-start');
  release();
  await f.app.idle();
  const run=f.app.tasks.run(runId);
  assert.equal(run.turnId,null);
  assert.equal(run.phase,'ended');
  assert.equal(run.errorCode,'worker_start_not_sent');
  assert.equal(f.app.store.meta('lease:'+runId),undefined);
  assert.equal(f.engines.filter(engine=>engine.options.role==='worker').length,0);
 }finally{release();await f.close();}
});

test('archive preserves a native Worker start sent before archive and acknowledged after it',async t=>{
 let taskId='',runId='',starts=0,acknowledge!:()=>void;
 const ack=new Promise<void>(resolve=>{acknowledge=resolve;});
 const f=fixture(undefined,async()=>{
  const worker=f.engines.find(engine=>engine.options.role==='worker');
  if(!worker)return;
  const turn=worker.turn.bind(worker);
  t.mock.method(worker,'turn',async(text:Parameters<typeof turn>[0],options:Parameters<typeof turn>[1])=>{
   options?.beforeStart?.();
   starts++;
   await ack;
   return turn(text,options);
  });
 });
 try{
  f.setScript(async(main,body)=>{
   if(body==='Open')({taskId,runId}=await openTaskWorker(main,'Synthetic work sent before archive'));
   if(body==='Archive')await main.call('archive_work',{taskId});
   return {status:'completed',text:'Recorded'};
  });
  await f.app.start();
  await f.app.message('Open','archive-awaiting-ack-open');
  await until(()=>starts>0);
  const receipt=()=>f.app.store.db.prepare('SELECT state,offeredTurnId FROM agent_receipts WHERE offeredRunId=?').get(runId);
  assert.deepEqual({...receipt()},{state:'offered',offeredTurnId:null});
  await f.app.message('Archive','archive-awaiting-ack-archive');
  assert.equal(f.app.tasks.task(taskId).historyState,'archived');
  assert.equal(f.app.tasks.run(runId).phase,'starting');
  assert.equal(f.app.tasks.run(runId).turnId,null);
  acknowledge();
  const worker=f.engines.find(engine=>engine.options.role==='worker')!;
  await until(()=>!!worker.finish);
  const running=f.app.tasks.run(runId);
  assert.equal(running.phase,'executing');
  assert.equal(running.threadId,worker.threadId);
  assert.equal(running.turnId,worker.turnId);
  assert.deepEqual({...receipt()},{state:'received',offeredTurnId:worker.turnId});
  await assert.rejects(worker.options.onInteraction!({requestId:1,method:'mcpServer/elicitation/request',kind:'authorization',threadId:worker.threadId,turnId:worker.turnId!,itemId:'late-plugin',details:{_meta:{codex_approval_kind:'tool_suggestion',tool_id:'synthetic-plugin'}}}),/task_history_not_visible/);
  worker.finish!({status:'completed',text:'Synthetic report after archive'});
  await f.app.idle();
  assert.equal(f.app.tasks.run(runId).status,'succeeded');
  assert.deepEqual({...receipt()},{state:'processed',offeredTurnId:worker.turnId});
  assert.equal(starts,1);
  assert.equal(f.engines.filter(engine=>engine.options.role==='worker').length,1);
 }finally{acknowledge();await f.close();}
});

test('restoring during startup cleanup still closes the original unsent Run',async t=>{
 let block=false,begin!:()=>void,allowStart!:()=>void,beginClose!:()=>void,allowClose!:()=>void;
 const starting=new Promise<void>(resolve=>{begin=resolve;});
 const startGate=new Promise<void>(resolve=>{allowStart=resolve;});
 const closing=new Promise<void>(resolve=>{beginClose=resolve;});
 const closeGate=new Promise<void>(resolve=>{allowClose=resolve;});
 const f=fixture(undefined,async()=>{if(block){begin();await startGate;}});
 let taskId='',runId='';
 try{
  await f.app.start();
  block=true;
  f.setScript(async(main,body)=>{
   if(body==='Open')({taskId,runId}=await openTaskWorker(main,'Inspect synthetic records'));
   if(body==='Archive')await main.call('archive_work',{taskId});
   if(body==='Restore'){await main.call('restore_work',{taskId});await main.call('task_update',{taskId,action:'resume'});}
   return {status:'completed',text:'Recorded'};
  });
  await f.app.message('Open','startup-race-open');
  await starting;
  const peer=f.engines.find(engine=>engine.options.role==='worker')!;
  const close=peer.close.bind(peer);
  t.mock.method(peer,'close',async()=>{beginClose();await closeGate;return close();});
  await f.app.message('Archive','startup-race-archive');
  allowStart();
  await closing;
  await f.app.message('Restore','startup-race-restore');
  assert.equal(f.app.tasks.task(taskId).state,'open');
  allowClose();
  await until(()=>f.app.tasks.run(runId).phase==='ended');
  assert.equal(f.app.tasks.run(runId).errorCode,'worker_start_not_sent');
  assert.equal(f.app.tasks.run(runId).turnId,null);
  assert.equal(f.app.store.meta('lease:'+runId),undefined);
  assert.equal(peer.input,undefined);
 }finally{allowStart();allowClose();await f.close();}
});
