import {readTestConversation} from './fixtures/read-test-conversation.js';
// Synthetic engines and private temporary runtimes only; no live model or channel.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {Homer} from '../src/service.js';
import {loadConfig} from '../src/config.js';
import {loadPrompts} from '../src/prompts.js';
import {fixture,openWorker,running,main} from './recursive-fixture.js';
import {syntheticHost} from '../scripts/recursive-synthetic-host.js';

import {host} from './native-execution-recovery-fixture.js';
import {homerWebBridge} from '../src/web-homer.js';

const wait=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
const until=async(check:()=>boolean)=>{for(let n=0;n<200;n++){if(check())return;await wait(5);}throw Error('synthetic_wait_timeout');};

for(const [code,notice,absent] of [
 ['engine_quota_insufficient',/额度不足/,/限流/],
 ['engine_rate_limited',/限流.*手动重试/,/额度不足/],
] as const)test('main failure explains '+code+' and preserves the original conversation without replay',async()=>{
 const f=host();try{
  await f.app.start();const original=f.app.store.meta('mainThread');
  f.peers[0]!.behavior=async()=>({status:'failed',text:'',errorCode:code});
  const reply=await f.app.message('synthetic failed request','synthetic-failure');await f.app.idle();
  assert.match(reply,notice);assert.doesNotMatch(reply,absent);
  assert.match(reply,/不会自动重试/);
  assert.deepEqual(f.peers.flatMap(p=>p.seen),['synthetic failed request']);
  assert.equal(f.app.store.meta('mainThread'),original);
  const failed=readTestConversation(f.app).messages.at(-1)!;
  assert.equal(failed.status,'failed');
  assert.match(failed.text,notice);assert.doesNotMatch(failed.text,absent);
  assert.equal(failed.process,undefined,'the existing host outcome remains visible outside native answer projection');
  assert.deepEqual(f.app.conversationControlState().modelFailure,{messageId:failed.id.slice('input-outcome:'.length),code,source:undefined});
  assert.deepEqual((await homerWebBridge(f.app,{}).history!.state()).modelFailure,f.app.conversationControlState().modelFailure);
  f.peers[0]!.behavior=async()=>({status:'completed',text:'new user request accepted'});
  assert.equal(await f.app.message('new explicit request','synthetic-next'),'new user request accepted');
  assert.equal(f.app.conversationControlState().modelFailure,undefined);
  assert.equal(f.app.store.meta('mainThread'),original);
 }finally{await f.close();}
});

test('native execution: a slow host tool and long main turn complete without a host deadline',async()=>{
  const f=host();try{await f.app.start();f.peers[0]!.behavior=async()=>{await wait(130);await f.peers[0]!.call('list_work',{});return{status:'completed',text:'slow tool completed'};};
    assert.equal(await f.app.message('slow','slow-request'),'slow tool completed');assert.equal(f.peers[0]!.closed,0);
    assert.equal(f.events.filter(e=>e.type==='main_terminal')[0]?.status,'completed');
  }finally{await f.close();}
});

for(const status of ['failed','empty','rejected'] as const)test('main recovery: '+status+' preserves failure and receives the next message without replay',async()=>{
  const f=host();try{await f.app.start();const old=f.peers[0]!;
    old.behavior=async text=>{if(text!=='first')return{status:'completed',text:'next accepted'};if(status==='rejected')throw Error('engine_disconnected');return{status:status==='failed'?'failed':'completed',text:'',errorCode:'engine_rate_limited'};};
    const failure=await f.app.message('first','first');assert.match(failure,/主 Agent 未完成/);
    assert.equal(f.app.inputs.list()[0]?.state,status==='rejected'?'uncertain':'failed');
    const node=f.app.processes.list(old.threadId)[0]!;
    assert.equal(node.state,'worked');assert.equal(node.status,status==='rejected'?'unknown':'failed');
    assert.equal(await f.app.message('next accepted','second'),'next accepted');
    assert.equal(f.app.submitMessage({requestId:'first',text:'first'}).fresh,false);
    await f.app.idle();assert.equal(f.peers.flatMap(p=>p.seen).filter(t=>t==='first').length,1);
    assert.equal(f.app.store.meta('mainThread'),'synthetic-original-thread');
    assert.equal(f.peers.length,status==='rejected'?2:1);
    if(status==='rejected')assert.equal(f.peers[1]!.options.threadId,'synthetic-original-thread');
    assert.equal(f.app.inputs.list().find(i=>i.input.requestId==='first')?.state,status==='rejected'?'uncertain':'failed');
  }finally{await f.close();}
});

test('main recovery: idle process exit rebuilds on original thread and latest selected CWD',async()=>{
  const f=host();try{await f.app.start();await f.app.message('first','first');const cwd=join(f.dir,'selected');mkdirSync(cwd);f.app.store.setMeta('mainWorkingDirectory',cwd);
    f.peers[0]!.available=false;f.peers[0]!.emit('exit');
    assert.equal(await f.app.message('after exit','second'),'after exit');
    assert.equal(f.peers.length,2);assert.equal(f.peers[0]!.closed,1);assert.equal(f.peers[1]!.options.threadId,'synthetic-original-thread');assert.equal(f.peers[1]!.options.cwd,cwd);
    assert.ok(f.peers[0]!.options.instructions.startsWith(loadPrompts().main));
    assert.ok(f.peers[1]!.options.instructions.startsWith(loadPrompts().main));
    assert.ok(f.peers[1]!.options.instructions.includes(cwd));
  }finally{await f.close();}
});

for(const reason of ['stop-unconfirmed','background-unresolved'] as const)test('main recovery: '+reason+' refuses a replacement writer',async()=>{
  const f=host();try{await f.app.start();const p=f.peers[0]!;p.stopConfirmed=reason!=='stop-unconfirmed';p.nativeBusy=reason==='background-unresolved';p.behavior=async()=>{throw Error('engine_disconnected');};
    assert.match(await f.app.message('first','first'),/主 Agent 未完成/);
    const node=f.app.processes.list(p.threadId)[0]!;
    assert.equal(node.status,'unknown');assert.equal(node.state,'working');assert.equal(node.endEventId,undefined);
    await assert.rejects(()=>f.app.message('do not overlap','second'),/main_engine_unavailable/);
    assert.equal(f.peers.length,1);assert.equal(f.app.inputs.list().length,1);assert.equal(f.app.upgradeStatus().safe,false);
    p.stopConfirmed=true;
  }finally{await f.close();}
});

for(const reason of ['resume-failed','thread-mismatch'] as const)test('main recovery: '+reason+' preserves thread identity and does not replay failed work',async()=>{
  const f=host();try{await f.app.start();f.peers[0]!.behavior=async()=>{throw Error('engine_disconnected');};await f.app.message('first','first');
    f.next(p=>{if(reason==='resume-failed')p.startError='engine_thread_history_unavailable';else p.mismatch=true;});
    assert.match(await f.app.message('second','second'),reason==='resume-failed'?/engine_thread_history_unavailable/:/main_resume_thread_mismatch/);
    assert.equal(f.app.store.meta('mainThread'),'synthetic-original-thread');assert.equal(f.peers[1]!.seen.length,0);
    assert.equal(await f.app.message('third','third'),'third');assert.deepEqual(f.peers.flatMap(p=>p.seen),['first','third']);
  }finally{await f.close();}
});

test('native execution: explicit main stop still ends a long turn on the same engine',async()=>{
  const f=host();try{await f.app.start();f.peers[0]!.behavior=async()=>{await new Promise<void>(resolve=>f.peers[0]!.release=resolve);return{status:'interrupted',text:''};};
    const reply=f.app.message('long','long');await until(()=>!!f.peers[0]!.release);await wait(80);
    await f.app.stopMain(f.app.conversationControlState().activeMessageId!);assert.match(await reply,/已停止/);assert.equal(f.peers.length,1);assert.equal(f.peers[0]!.closed,0);
  }finally{await f.close();}
});

test('main recovery: queued new inputs share one replacement and retired callbacks cannot change new ownership',async()=>{
  const f=host();try{await f.app.start();const old=f.peers[0]!;old.behavior=async()=>{await new Promise<void>(r=>old.release=r);throw Error('engine_disconnected');};
    const first=f.app.message('first','first');await until(()=>!!old.release);
    const second=f.app.message('second','second'),third=f.app.message('third','third');old.release!();
    assert.match(await first,/engine_disconnected/);assert.equal(await second,'second');assert.equal(await third,'third');assert.equal(f.peers.length,2);
    let invalidations=0;const invalidated=f.app['mainApprovals'].invalidated.bind(f.app['mainApprovals']);f.app['mainApprovals'].invalidated=(...args)=>{invalidations++;return invalidated(...args);};
    const usage=f.app.store.meta('mainUsage');old.emit('usage',{stale:true});old.emit('interactionInvalidated','same-numeric-request-id','stale');
    assert.equal(f.app.store.meta('mainUsage'),usage);assert.equal(invalidations,0);
    Object.assign(old,{pid:process.pid});old.emit('spawn');assert.equal(f.app.store.meta('lease:main'),undefined);
    await assert.rejects(async()=>old.call('list_work',{}),/tool_scope_denied/);
    assert.deepEqual(f.peers.flatMap(p=>p.seen),['first','second','third']);
  }finally{await f.close();}
});

test('main recovery: a normal service restart cannot admit a writer while resumed native background activity is unresolved',async()=>{
  const f=host();let resumed:Homer|undefined;
  try{await f.app.start();await f.app.message('original','original');await f.app.close();
    f.next(peer=>{peer.nativeBusy=true;});resumed=new Homer(f.config,async()=>{},f.app['factory']);await resumed.start();
    await assert.rejects(()=>resumed!.message('must not overlap','new'),/main_engine_unavailable/);
    assert.equal(f.peers[1]!.seen.length,0);assert.equal(resumed.store.meta('mainThread'),'synthetic-original-thread');assert.equal(resumed.upgradeStatus().safe,false);
    assert.ok(resumed.store.db.prepare("SELECT 1 FROM events WHERE type='main_recovery_blocked' AND code='main_background_unresolved'").get());
  }finally{await resumed?.close();await f.close();}
});

test('execution time remains accounting and does not block an authorized peer or same-session followup',()=>{
  const f=fixture();try{const worker=openWorker(f),actor=running(f,worker.runId);f.tasks.charge(actor.runId!,actor.epoch!,120001);
    const authorityBefore=f.tasks.version(f.task.taskId,1).authorityJson;
    const peer=openWorker(f,'after-accounting');assert.ok(f.tasks.claim(peer.runId));
    f.tasks.endSegment(actor.runId!,actor.epoch!,{status:'interrupted',text:'Partial checked facts'},true);
    const resumed=f.tasks.workerSend(main,{operationId:'followup',workerId:worker.workerId,text:'Continue checked work'});assert.ok(f.tasks.claim(resumed.runId!));
    assert.equal(f.tasks.run(resumed.runId!).threadId,actor.threadId);assert.equal(f.tasks.run(actor.runId!).activeMs,120001);
    assert.equal(f.tasks.version(f.task.taskId,1).authorityJson,authorityBefore);assert.equal(Object.hasOwn(JSON.parse(authorityBefore!),'maxActiveMs'),false);
  }finally{f.close();}
});

test('unused timeout settings are ignored while stop grace remains validated',()=>{
  const f=host();try{const path=join(f.dir,'synthetic-config.json');const base={workspace:f.config.workspace,runtime:f.config.runtime,codexBin:'/usr/bin/false',codexHome:f.config.codexHome};
    for(const timeout of [undefined,120000,null,'unused']){
      writeFileSync(path,JSON.stringify({...base,mainTimeoutMs:timeout,timeoutMs:timeout,stopGraceMs:500}));
      const loaded=loadConfig(path);
      assert.equal(loaded.stopGraceMs,500);
      for(const key of ['mainTimeoutMs','timeoutMs'])assert.equal(Object.hasOwn(loaded,key),false,key);
    }
    writeFileSync(path,JSON.stringify({...base,stopGraceMs:1}));assert.throws(()=>loadConfig(path),/invalid_stopGraceMs/);
  }finally{f.app.store.close();rmSync(f.dir,{recursive:true,force:true});}
});

test('missing authorization cannot be hidden by execution accounting at open, send or claim',()=>{
  const f=fixture();try{const worker=openWorker(f),authority=f.tasks.authority(f.task.taskId,1);
    f.store.db.prepare('UPDATE task_versions SET authorityJson=?,sourceRequestId=? WHERE taskId=?').run(JSON.stringify({...authority,sourceRequestId:'missing-source'}),'missing-source',f.task.taskId);
    f.store.db.prepare('UPDATE runs SET sourceRequestId=? WHERE id=?').run('missing-source',worker.runId);
    const before=f.store.runs();
    assert.throws(()=>openWorker(f,'unauthorized-peer'),/task_authority_source_denied/);
    assert.throws(()=>f.tasks.workerSend(main,{operationId:'unauthorized-send',workerId:worker.workerId,text:'Continue'}),/task_authority_source_denied/);
    assert.throws(()=>f.tasks.claim(worker.runId),/task_authority_source_denied/);
    assert.deepEqual(f.store.runs(),before);assert.equal(f.tasks.run(worker.runId).status,'queued');
  }finally{f.close();}
});

test('native execution: peer Workers exceed the old shared budget and send once',async()=>{
  const f=syntheticHost();
  const original=f.app['factory']!;
  f.app['factory']=(options,handler)=>{const engine=original(options,handler),turn=engine.turn.bind(engine);
    engine.turn=async(text,hooks)=>{if(options.role==='worker')await wait(30);return turn(text,hooks);};return engine;};
  try{await f.app.start();await f.app.message('synthetic:tree','slow-tree');await until(()=>f.events.some(e=>e.type==='reply'&&e.messageId!==undefined));await f.app.idle();
    assert.equal(f.app.tasks.tasks()[0]?.outcome,'succeeded');
    assert.equal(f.events.filter(e=>e.type==='reply'&&e.messageId!==undefined).length,1);assert.equal(f.app.store.runs().length,4);
    assert.ok(f.app.store.runs().every(r=>r.status==='succeeded'));assert.ok(f.app.tasks.tasks().every(t=>!Object.hasOwn(JSON.parse(f.app.tasks.version(t.id,1).authorityJson!),'maxActiveMs')));
    assert.equal(new Set(f.app.store.runs().map(run=>run.workerId)).size,3);assert.equal(f.engines.filter(e=>e.worker).length,4);
  }finally{await f.close();}
});


test('live model failure is absent for legacy error text and safely classifies a new unknown failure',async()=>{
 const f=host();try{
  await f.app.start();const thread=f.app.store.meta('mainThread')!;
  f.app.history.record('legacy-error',thread,'engine_rate_limited: old ambiguous quota error','failed');
  assert.equal(f.app.conversationControlState().modelFailure,undefined);
  f.app.config.desktopModelSource='codex';
  f.peers[0]!.behavior=async()=>({status:'failed',text:'',errorCode:'engine_rpc_failed'});
  await f.app.message('new synthetic unknown failure','unknown');
  const notice=f.app.conversationControlState().modelFailure!;
  assert.equal(notice.code,'main_turn_failed');assert.equal(notice.source,'codex');
  assert.equal(notice.messageId,f.app.inputs.byRequestIds(['unknown'])[0]!.replyId);
  assert.equal(f.app.history.message('legacy-error')?.text,'engine_rate_limited: old ambiguous quota error');
 }finally{await f.close();}
});
