import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdirSync,mkdtempSync,rmSync } from 'node:fs';
import { resolve,join } from 'node:path';
import { Homer } from '../src/service.js';
function gate(){let release!:()=>void;const promise=new Promise<void>(r=>release=r);return {promise,release};}
async function until(check:()=>boolean){const end=Date.now()+5000;while(!check()){if(Date.now()>end)throw Error('synthetic_tail_timeout');await new Promise(r=>setTimeout(r,5));}}

test('reception tail: six accepted inputs distinguish engine settlement, public finalization, queued output and reply sink fencing',async()=>{
 const parent=resolve('.codex/scratch/main-agent-reception-optimization');mkdirSync(parent,{recursive:true});const base=mkdtempSync(join(parent,'tail-host-'));mkdirSync(join(base,'runtime'));
 const engineTail=gate(),deltaAck=gate(),replyAck=gate();let starts=0,deltaBlocked=false,replyBlocked=false;
 class Engine extends EventEmitter {
  threadId='synthetic-tail-thread';turnId?:string;
  async start(){return this.threadId;}
  async turn(_text:string,options?:{onStarted?:(id:string)=>void}){
   const first=++starts===1;this.turnId='synthetic-tail-turn-'+starts;options?.onStarted?.(this.turnId);
   if(first)this.emit('textDelta',{threadId:this.threadId,turnId:this.turnId,delta:'Synthetic delta'});
   this.emit('agentMessage',{threadId:this.threadId,turnId:this.turnId,itemId:'final',phase:'final_answer',text:'Synthetic final',completed:true});
   this.emit('nativeCompleted',{turnId:this.turnId,status:'completed'});
   if(first)await engineTail.promise;
   return {status:'completed',text:'Synthetic final'};
  }
  async close(){engineTail.release();deltaAck.release();replyAck.release();return true;}
  async interrupt(){return this.close();}
 }
 const app=new Homer({runtime:join(base,'runtime'),workspace:join(base,'workspace'),codexHome:join(base,'empty-home'),nativeCodexHome:join(base,'empty-home'),codexBin:'/usr/bin/false',model:'synthetic-only',requiresOpenaiAuth:false,stopGraceMs:100},async message=>{
  if(message.requestId==='synthetic-tail-0'&&message.type==='delta'){deltaBlocked=true;await deltaAck.promise;}
  if(message.requestId==='synthetic-tail-0'&&message.type==='reply'){replyBlocked=true;await replyAck.promise;}
 },()=>new Engine());
 const records=()=>app.receptionTimings.read().records.filter(row=>row.requestId==='synthetic-tail-0');
 try{
  await app.start();for(let i=0;i<6;i++)app.submitMessage({requestId:'synthetic-tail-'+i,text:'Synthetic tail input '+i});
  await until(()=>deltaBlocked&&records().some(row=>row.phase==='native_completed'));
  assert.equal(app.snapshot().activeWorkers,0);assert.equal(starts,1);
  assert.deepEqual(app.inputs.list().map(item=>item.state),['processing','queued','queued','queued','queued','queued']);
  assert.ok(!records().some(row=>row.phase==='engine_settled'));
  engineTail.release();await until(()=>app.inputs.list()[0]?.state==='completed');
  assert.equal(app.processes.list(app.store.meta('mainThread')!)[0]!.state,'worked');
  assert.equal(starts,1);assert.ok(records().some(row=>row.phase==='host_finalize_end'));
  assert.ok(records().some(row=>row.phase==='output_wait_start'));assert.ok(!records().some(row=>row.phase==='output_wait_end'));
  // GET remains pure even while an old output is unacknowledged.
  const changes=app.store.db.prepare('SELECT total_changes() n').get()!.n;
  const revision=app.processes.list(app.store.meta('mainThread')!)[0]!.revision;
  for(let i=0;i<8;i++)assert.equal(app.processes.list(app.store.meta('mainThread')!)[0]!.revision,revision);
  assert.equal(app.store.db.prepare('SELECT total_changes() n').get()!.n,changes);
  deltaAck.release();await until(()=>replyBlocked);assert.equal(starts,1);
  assert.ok(records().some(row=>row.phase==='output_wait_end'));assert.ok(records().some(row=>row.phase==='reply_delivery_start'));
  assert.ok(!records().some(row=>row.phase==='reply_delivery_end'));
  replyAck.release();await app.idle();assert.equal(starts,6);
  const phases=records().map(row=>row.phase);
  for(const phase of ['engine_settled','host_finalize_start','host_finalize_end','output_wait_start','output_wait_end','reply_delivery_start','reply_delivery_end','round_end'])assert.ok(phases.includes(phase as any),phase);
  const firstEnd=records().find(row=>row.phase==='round_end')!,next=app.receptionTimings.read().records.find(row=>row.requestId==='synthetic-tail-1'&&row.phase==='native_start')!;
  assert.ok(next.monotonicMs>=firstEnd.monotonicMs);assert.ok(app.inputs.list().every(item=>item.state==='completed'));
 }finally{engineTail.release();deltaAck.release();replyAck.release();await app.close();rmSync(base,{recursive:true,force:true});}
});
