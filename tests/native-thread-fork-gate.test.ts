import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Homer} from '../src/service.js';
import {NativeThreadBindings} from '../src/native-thread-bindings.js';
import {fixture,openWorker,running,complete} from './recursive-fixture.js';
import {syntheticHost} from '../scripts/recursive-synthetic-host.js';
import {EngineRpcUnconfirmed,type TurnResult} from '../src/engine.js';

function setup(){
 const f=fixture(),bindings=new NativeThreadBindings(f.store),opened=openWorker(f),actor=running(f,opened.runId);
 const allowed=()=> (Homer.prototype as any).nativeForkAllowed.call({store:f.store,nativeThreads:bindings},actor.threadId);
 bindings.bindTurn(actor.threadId!,actor.threadId!,actor.turnId!,()=>true);
 return {...f,bindings,actor,allowed};
}

test('confirmed Worker exit cannot erase an unconfirmed native return',()=>{
 const f=setup();try{
  f.tasks.endSegment(f.actor.runId!,f.actor.epoch!,{status:'unconfirmed',text:'',errorCode:'engine_disconnected'},true);
  assert.equal(JSON.parse(f.tasks.run(f.actor.runId!).checkpointJson!).workerExitConfirmed,1);
  const before=f.store.db.prepare("SELECT payloadJson FROM agent_messages WHERE kind='worker_reply'").get();
  assert.equal(f.allowed(),false);
  assert.deepEqual(f.store.db.prepare("SELECT payloadJson FROM agent_messages WHERE kind='worker_reply'").get(),before);
 }finally{f.close();}
});

test('a native command start remains unresolved after exit until its exact terminal arrives',()=>{
 const f=setup();try{
  const {threadId,turnId}=f.actor;
  f.bindings.recordWorkerEffect(threadId!,threadId!,turnId!,'native-command','running',false,()=>true);
  complete(f,f.actor);
  assert.equal(JSON.parse(f.tasks.run(f.actor.runId!).checkpointJson!).workerExitConfirmed,1);
  assert.equal(f.allowed(),false);
  f.bindings.recordWorkerEffect(threadId!,threadId!,turnId!,'different-command','completed',true,()=>true,false);
  assert.equal(f.allowed(),false,'a different item is not evidence for the original command');
  f.bindings.recordWorkerEffect(threadId!,threadId!,turnId!,'native-command','completed',true,()=>true,false);
  assert.equal(f.allowed(),true);
 }finally{f.close();}
});

test('a matching failed native terminal is confirmed evidence without treating the task as successful',()=>{
 const f=setup();try{
  f.bindings.recordWorkerEffect(f.actor.threadId!,f.actor.threadId!,f.actor.turnId!,'native-file','running',false,()=>true);
  f.bindings.recordWorkerEffect(f.actor.threadId!,f.actor.threadId!,f.actor.turnId!,'native-file','failed',true,()=>true);
  f.tasks.endSegment(f.actor.runId!,f.actor.epoch!,{status:'failed',text:'',errorCode:'synthetic_native_failure'},true);
  assert.equal(f.allowed(),true);assert.equal(f.tasks.run(f.actor.runId!).status,'failed');
 }finally{f.close();}
});

for(const drain of [false,true])test(drain?'orderly Worker shutdown records exact terminal effects without creating new starts':'an effect starting while another Worker callback waits remains pending after confirmed exit',async()=>{
 const f=syntheticHost();let worker:typeof f.engines[number]|undefined;
 const until=async(check:()=>boolean)=>{for(let i=0;i<1000;i++){if(check())return;await new Promise(done=>setTimeout(done,5));}throw Error('synthetic_worker_effect_timeout');};
 try{
  const factory=f.app['factory']!;
  f.app['factory']=(options,handler)=>{
   const engine=factory(options,handler);
   if(options.role==='worker'){
    worker=engine as typeof worker;Object.assign(engine,{nativeThreadId:engine.threadId});
    engine.turn=async(_text,hooks)=>{
     engine.turnId='synthetic-pending-effect-turn';hooks?.onStarted?.(engine.turnId);
     return new Promise<TurnResult>(done=>{worker!.pending=done;});
    };
   }
   return engine;
  };
  await f.app.start();const main=f.engines[0]!;
  main.turn=async(text,hooks)=>{
   main.turnId='synthetic-effect-main-turn';hooks?.onStarted?.(main.turnId);
   if(text==='synthetic:pending-effect')await main.call('worker_open',{message:'Synthetic pending effect'});
   return {status:'completed',text:''};
  };
  await f.app.message('synthetic:pending-effect','synthetic-effect-source');await until(()=>!!worker?.pending);
  const run=f.app.store.runs()[0]!;f.app.tasks.rpc(run.id,run.epoch,true);
  const effect={nativeId:worker!.threadId,turnId:worker!.turnId!,itemId:'parallel-command',status:'inProgress',completed:false,ownerNativeId:worker!.threadId,ownerTurnId:worker!.turnId!};
  worker!.emit('nativeWorkerEffect',effect);
  assert.equal(f.app['nativeThreads'].hasUnconfirmedWorkerEffects(worker!.threadId),true);
  if(drain){
   const close=worker!.close.bind(worker);let confirmed=false;
   worker!.close=async()=>{
    assert.equal(f.app['closing'],true);
    worker!.emit('nativeWorkerEffect',{...effect,itemId:'shutdown-start'});
    worker!.emit('nativeWorkerEffect',{...effect,status:'completed',completed:true});
    confirmed=!f.app['nativeThreads'].hasUnconfirmedWorkerEffects(worker!.threadId);
    const rows=f.app.store.db.prepare("SELECT value FROM meta WHERE key GLOB 'nativeWorkerEffect:v1:*'").all();
    assert.equal(rows.length,1);return close();
   };
   await f.app.close();assert.equal(confirmed,true);return;
  }
  f.app.tasks.rpc(run.id,run.epoch,false);worker!.pending!({status:'completed',text:''});
  await until(()=>JSON.parse(f.app.tasks.run(run.id).checkpointJson??'{}').workerExitConfirmed===1);
  assert.equal(f.app['nativeForkAllowed'](worker!.threadId),false);
 }finally{await f.close();}
});

test('an accepted Worker turn with a failed local receipt stays unconfirmed after owner exit',async t=>{
 const f=syntheticHost();
 try{
  t.mock.method(f.app.tasks,'bind',()=>{throw Error('synthetic_receipt_write_failed');});
  const factory=f.app['factory']!;
  f.app['factory']=(options,handler)=>{
   const engine=factory(options,handler);
   if(options.role==='worker'){
    Object.assign(engine,{nativeThreadId:engine.threadId,turnActive:true});
    engine.turn=async(_text,hooks)=>{
     engine.turnId='synthetic-accepted-turn';hooks?.onStarted?.(engine.turnId);
     throw Error('synthetic_receipt_should_have_failed');
    };
   }
   return engine;
  };
  await f.app.start();const main=f.engines[0]!;
  main.turn=async(text,hooks)=>{
   main.turnId='synthetic-receipt-main-turn';hooks?.onStarted?.(main.turnId);
   if(text==='synthetic:receipt-failure')await main.call('worker_open',{message:'Synthetic accepted operation'});
   return {status:'completed',text:''};
  };
  await f.app.message('synthetic:receipt-failure','synthetic-receipt-source');await f.app.idle();
  const run=f.app.store.runs()[0]!,reply=f.app.store.db.prepare("SELECT payloadJson FROM agent_messages WHERE kind='worker_reply' AND senderRunId=?").get(run.id) as {payloadJson:string};
  assert.equal(JSON.parse(reply.payloadJson).execution.status,'unconfirmed');
  assert.equal(JSON.parse(run.checkpointJson!).workerExitConfirmed,1);
  assert.equal(f.app['nativeThreads'].turn(run.threadId!,'synthetic-accepted-turn'),undefined,'the failed receipt transaction must roll back');
  assert.equal(f.app['nativeForkAllowed'](run.threadId!),false);
 }finally{await f.close();}
});

test('stopping a Worker before its turn ACK preserves uncertainty without restoring the revoked epoch',async()=>{
 const f=syntheticHost();let worker:typeof f.engines[number]|undefined,rejectTurn:((error:Error)=>void)|undefined;
 try{
  const factory=f.app['factory']!;
  f.app['factory']=(options,handler)=>{
   const engine=factory(options,handler);
   if(options.role==='worker'){
    worker=engine as typeof worker;Object.assign(engine,{nativeThreadId:engine.threadId,turnActive:true});
    engine.turn=async()=>new Promise<TurnResult>((_done,reject)=>{rejectTurn=reject;});
    engine.interrupt=async()=>false;
    engine.close=async()=>{rejectTurn?.(new EngineRpcUnconfirmed('engine_closed'));return true;};
   }
   return engine;
  };
  await f.app.start();const main=f.engines[0]!;
  main.turn=async(text,hooks)=>{
   main.turnId='synthetic-cancel-main-turn';hooks?.onStarted?.(main.turnId);
   if(text==='synthetic:cancel-before-ack')await main.call('worker_open',{message:'Synthetic unacknowledged turn'});
   return {status:'completed',text:''};
  };
  await f.app.message('synthetic:cancel-before-ack','synthetic-cancel-source');
  for(let i=0;i<1000&&!rejectTurn;i++)await new Promise(done=>setTimeout(done,5));assert.ok(rejectTurn);
  const before=f.app.store.runs()[0]!;await f.app.stop(before.id);await f.app.idle();
  const after=f.app.tasks.run(before.id),reply=f.app.store.db.prepare("SELECT payloadJson FROM agent_messages WHERE kind='worker_reply' AND senderRunId=?").get(before.id) as {payloadJson:string};
  assert.ok(after.epoch>before.epoch);assert.equal(after.status,'cancelled');assert.equal(after.turnId,null);
  assert.equal(JSON.parse(after.checkpointJson!).workerExitConfirmed,1);
  assert.equal(JSON.parse(reply.payloadJson).execution.status,'unconfirmed');assert.equal(f.app['nativeForkAllowed'](worker!.threadId),false);
 }finally{await f.close();}
});
