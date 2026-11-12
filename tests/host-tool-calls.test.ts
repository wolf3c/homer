import assert from 'node:assert/strict';
import {setImmediate as yieldTurn} from 'node:timers/promises';
import {test} from 'node:test';
import type {EngineLike} from '../src/engine.js';
import {HostToolCalls} from '../src/host-tool-calls.js';

function engine():EngineLike {
  return {threadId:'thread',turnId:'turn',turnActive:true,available:true,on(){return this;},
    async start(){return 'thread';},async turn(){return {status:'completed',text:''};},
    async interrupt(){return true;},async close(){return true;}};
}
const args={text:'Synthetic reminder',trigger:{at:'2026-11-13T09:00:00+08:00'}};
const meta=(callId='call',turnId='turn')=>({callId,'x-codex-turn-metadata':{turn_id:turnId}});
const start=(tool='schedule_create',arguments_:unknown=args,itemId='call')=>({threadId:'thread',turnId:'turn',itemId,tool,arguments:arguments_});
const denied=/^Error: schedule_call_scope_denied$/;

test('scheduled calls require exact native evidence and normalize object key order',async()=>{
  const calls=new HostToolCalls(),peer=engine();
  for(const tool of ['schedule_create','schedule_list','schedule_update','schedule_cancel']){
    calls.observe(peer,start(tool,args,tool));
    const reordered={trigger:{at:'2026-11-13T09:00:00+08:00'},text:'Synthetic reminder'};
    assert.deepEqual(await calls.authenticate(peer,tool,reordered,meta(tool),()=>true),{threadId:'thread',turnId:'turn',callId:tool});
    assert.deepEqual(await calls.authenticate(peer,tool,args,meta(tool),()=>true),{threadId:'thread',turnId:'turn',callId:tool},'live transport retries reuse identity for the host receipt transaction');
  }
});

test('native starts may follow concurrent MCP retries within the bounded reorder window',async()=>{
  const calls=new HostToolCalls(),peer=engine();
  const requests=[calls.authenticate(peer,'schedule_create',args,meta(),()=>true),calls.authenticate(peer,'schedule_create',args,meta(),()=>true)];
  calls.observe(peer,start());
  assert.deepEqual(await Promise.all(requests),Array(2).fill({threadId:'thread',turnId:'turn',callId:'call'}));
});

test('metadata is required and model arguments cannot supply trusted identity',async()=>{
  const calls=new HostToolCalls(),peer=engine();calls.observe(peer,start());
  for(const value of [undefined,{}, {callId:'call'}, {'x-codex-turn-metadata':{turn_id:'turn'}},meta('', 'turn'),meta('call',''),meta('x'.repeat(201)),meta('call','other-turn')])
    await assert.rejects(calls.authenticate(peer,'schedule_create',args,value,()=>true),denied);
  const claimedIdentity={...args,...meta('argument-call')};
  calls.observe(peer,start('schedule_create',claimedIdentity,'argument-call'));
  await assert.rejects(calls.authenticate(peer,'schedule_create',claimedIdentity,undefined,()=>true),denied);
  await assert.rejects(calls.authenticate(peer,'set_notification_destination',args,meta(),()=>true),denied);
});

test('tool, argument and conflicting native-call identities cannot authenticate',async()=>{
  const calls=new HostToolCalls(),peer=engine();calls.observe(peer,start());
  await assert.rejects(calls.authenticate(peer,'schedule_cancel',args,meta(),()=>true),denied);
  await assert.rejects(calls.authenticate(peer,'schedule_create',{...args,text:'Different instruction'},meta(),()=>true),denied);
  calls.observe(peer,start('schedule_create',{...args,text:'Conflicting observation'}));
  calls.observe(peer,start());
  await assert.rejects(calls.authenticate(peer,'schedule_create',args,meta(),()=>true),denied);
});

test('missing and wrong-engine observations expire without authorizing a call',async()=>{
  const calls=new HostToolCalls(),peer=engine(),other=engine();calls.observe(peer,start());
  calls.observe(other,{...start(),threadId:'other-thread'});
  await Promise.all([
    assert.rejects(calls.authenticate(other,'schedule_create',args,meta(),()=>true),denied),
    assert.rejects(calls.authenticate(peer,'schedule_create',args,meta('missing'),()=>true),denied),
  ]);
});

test('stopped, unavailable, revoked and changed-turn calls are rejected before and after waiting',async()=>{
  for(const invalidate of [
    (peer:EngineLike)=>{Object.assign(peer,{turnActive:false});},
    (peer:EngineLike)=>{Object.assign(peer,{available:false});},
    (peer:EngineLike)=>{peer.turnId='next-turn';},
    (peer:EngineLike)=>{peer.threadId='next-thread';},
  ]){
    const calls=new HostToolCalls(),peer=engine();
    const request=calls.authenticate(peer,'schedule_create',args,meta(),()=>true);
    calls.observe(peer,start());invalidate(peer);
    await assert.rejects(request,denied);
    await assert.rejects(calls.authenticate(peer,'schedule_create',args,meta(),()=>true),denied);
  }
  const calls=new HostToolCalls(),peer=engine();let authorized=true;
  const request=calls.authenticate(peer,'schedule_create',args,meta(),()=>authorized);
  authorized=false;calls.observe(peer,start());await assert.rejects(request,denied);
  await assert.rejects(calls.authenticate(peer,'schedule_create',args,meta(),()=>authorized),denied);
});

test('clearing an engine revokes waiting and retained evidence',async()=>{
  const calls=new HostToolCalls(),peer=engine();
  const request=calls.authenticate(peer,'schedule_create',args,meta(),()=>true);
  calls.clear(peer);calls.observe(peer,start());
  await assert.rejects(request,denied);
  calls.clear(peer);
  await assert.rejects(calls.authenticate(peer,'schedule_create',args,meta(),()=>true),denied);
});

test('native evidence retention and concurrent reorder waits stay bounded',async()=>{
  const calls=new HostToolCalls(),peer=engine();
  for(let index=0;index<257;index++)calls.observe(peer,start('schedule_create',args,'call-'+index));
  assert.deepEqual(await calls.authenticate(peer,'schedule_create',args,meta('call-255'),()=>true),{threadId:'thread',turnId:'turn',callId:'call-255'});
  const beyondRetention=assert.rejects(calls.authenticate(peer,'schedule_create',args,meta('call-256'),()=>true),denied);
  calls.clear(peer);await beyondRetention;
  const waiting=Array.from({length:32},(_,index)=>calls.authenticate(peer,'schedule_create',args,meta('waiting-'+index),()=>true));
  const rejected=Promise.all(waiting.map(request=>assert.rejects(request,denied)));
  let overflowDenied=false;
  const overflow=assert.rejects(calls.authenticate(peer,'schedule_create',args,meta('overflow'),()=>true),denied).then(()=>{overflowDenied=true;});
  try{await yieldTurn();assert.equal(overflowDenied,true,'overflow is refused immediately, without adding a timer');}
  finally{calls.clear(peer);await Promise.all([rejected,overflow]);}
});
