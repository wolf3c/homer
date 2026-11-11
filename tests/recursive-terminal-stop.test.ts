import {callHostMcp} from './fixtures/host-mcp-call.js';
// Requirements-derived synthetic stop races. Actual Homer and SQLite only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {Homer} from '../src/service.js';
import type {EngineLike,EngineOptions,ToolCall,TurnResult} from '../src/engine.js';
import {DatabaseSync} from 'node:sqlite';
import {WorkerInteractions} from '../src/worker-interactions.js';
const until=async(check:()=>boolean)=>{const end=Date.now()+2000;while(!check()){assert.ok(Date.now()<end,'synthetic stop did not settle');await new Promise(r=>setTimeout(r,5));}};
function fixture(confirm=true){
  const base=resolve('.codex/scratch/chat-architecture-implementation-20261105/e-stop');mkdirSync(base,{recursive:true});
  const root=mkdtempSync(join(base,'test-'));
  mkdirSync(join(root,'runtime'));mkdirSync(join(root,'workspace'));
  const peers:Peer[]=[];let sequence=0;
  class Peer extends EventEmitter implements EngineLike{
    readonly worker:boolean;threadId:string;turnId='';resumable=true;
    constructor(readonly options:EngineOptions,readonly handler:(call:ToolCall)=>Promise<unknown>){super();this.worker=options.role==='worker';this.threadId=options.threadId??'synthetic-stop-thread-'+ ++sequence;}
    async start(){return this.threadId;}
    async call(tool:string,args:unknown):Promise<any>{return this.handler({threadId:this.threadId,turnId:this.turnId,callId:'synthetic-stop-call-'+ ++sequence,tool,arguments:args});}
    interrupts=0;closes=0;resolutions=0;status?:string;confirm=confirm;held=false;
    releaseTurn?:(result:TurnResult)=>void;
    async turn(text:string,hooks?:{onStarted?:(id:string)=>void}):Promise<TurnResult>{
      if(this.worker){
        this.turnId='synthetic-terminal-turn-'+ ++sequence;hooks?.onStarted?.(this.turnId);
        const resolution=await this.call('ask_main',{question:'Synthetic format requires the user.'});
        this.resolutions++;this.status=resolution.status;this.held=true;
        return new Promise(resolve=>{this.releaseTurn=resolve;});
      }
      if(text.startsWith('synthetic:dispatch')){
        this.turnId='synthetic-dispatch-turn-'+ ++sequence;hooks?.onStarted?.(this.turnId);
        const worker=await this.call('worker_open',{message:'Ask for the missing format'});return {status:'completed',text:worker.runId};
      }
      if(text.startsWith('[内部协作输入')&&text.includes('interactionId=')){
        this.turnId='synthetic-question-turn-'+ ++sequence;hooks?.onStarted?.(this.turnId);
        const interactionId=text.match(/interactionId=([\w-]+)/)![1]!;
        await callHostMcp(this.options, 'inspect_interaction',{interactionId});
        await callHostMcp(this.options, 'escalate_interaction',{interactionId,question:'Synthetic format?',reason:'Synthetic ambiguity'});
        return {status:'completed',text:'Synthetic question'};
      }
      this.turnId='synthetic-main-turn-'+ ++sequence;hooks?.onStarted?.(this.turnId);return {status:'completed',text:'Synthetic reply'};
    }
    async interrupt(){if(!this.worker)return true;this.interrupts++;return true;}
    async close(){if(!this.worker)return true;this.closes++;if(this.confirm){
      // Allow the cancelled tool response to reach the fake worker before its
      // process shutdown settles the still-running turn.
      await Promise.resolve();await Promise.resolve();await Promise.resolve();
      this.releaseTurn?.({status:'interrupted',text:''});return true;
    }return false;}
  }
  const app=new Homer({runtime:join(root,'runtime'),workspace:join(root,'workspace'),codexHome:join(root,'empty-home'),nativeCodexHome:join(root,'empty-home'),codexBin:'/usr/bin/false',model:'synthetic-only',effort:'medium',requiresOpenaiAuth:false,stopGraceMs:50},async()=>{},(o,h)=>{const peer=new Peer(o,h);peers.push(peer);return peer;});
  const start=async()=>{await app.start();await app.message('synthetic:dispatch','synthetic-dispatch');await until(()=>app.interactions.list()[0]?.state==='pending_user');return {worker:peers.find(p=>p.worker)!,item:app.interactions.list()[0]!};};
  return {app,start,async close(){
    // RED must not depend on the very terminal-run cleanup being tested.
    for(const run of app.store.runs())app.interactions.cancelRun(run.id,'synthetic_fixture_cleanup');
    for(const p of peers.filter(p=>p.worker)){p.confirm=true;await until(()=>p.held);p.releaseTurn?.({status:'interrupted',text:''});}
    await app.close();rmSync(root,{recursive:true,force:true});
  }};
}

for(const status of ['failed','cancelled'] as const)for(const confirmed of [true,false]) test('HMR-RECURSIVE-007: terminal DB '+status+' still settles live RPC and '+(confirmed?'confirms process close':'persists unconfirmed close'),async()=>{
  const f=fixture(confirmed);try{
    const {worker,item}=await f.start(),run=f.app.tasks.run(item.runId);
    if(status==='failed')f.app.tasks.failRun(run.id,run.epoch,'synthetic_parent_cancelled');
    else{
      f.app.tasks.workerStop({agentId:f.app.store.meta('mainAgentId')!},{operationId:'synthetic-db-stop',workerId:run.workerId,reason:'synthetic_db_first'});
      // Fault at the persistence boundary: terminal business status must not skip physical close.
      f.app.store.db.prepare("UPDATE runs SET status='cancelled' WHERE id=?").run(run.id);
    }
    assert.equal(f.app.interactions.inspect(item.id).state,'cancelled');assert.equal(worker.resolutions,0);
    assert.equal(f.app.store.run(run.id)!.status,status);
    await f.app.stop(run.id);
    assert.equal(worker.interrupts,1,'DB terminal status must not bypass interrupt');
    assert.equal(worker.closes,1,'DB terminal status must not bypass actual close');
    await until(()=>worker.resolutions===1);
    assert.equal(worker.status,'cancelled');assert.equal(f.app.store.run(run.id)!.status,status,'resource cleanup preserves the settled business outcome');
    assert.equal(f.app.tasks.run(run.id).phase,confirmed?'ended':'uncertain');
    if(!confirmed)assert.equal(f.app.upgradeStatus().safe,false);
    await assert.rejects(()=>worker.call('stage_file_result',{filename:'late.md',assetId:'synthetic-media',revision:1}),/stale|not_live|stop/);
    assert.throws(()=>f.app.interactions.respond(item.id,{action:'answer',answer:'Synthetic late answer',reason:'Synthetic race'}),/not_live|resolved/);
    await f.app.stop(run.id);assert.equal(worker.resolutions,1);assert.equal(worker.closes,1);
  }finally{await f.close();}
});

test('HMR-RECURSIVE-007: stop wins against an unanswered user callback and duplicate stops release it exactly once',async()=>{
  const f=fixture();try{
    const {worker,item}=await f.start();
    const first=f.app.stop(item.runId),second=f.app.stop(item.runId);
    assert.throws(()=>f.app.interactions.respond(item.id,{action:'answer',answer:'Synthetic racing answer',reason:'Synthetic race'},{userMessageId:'synthetic-new-message',userText:'Synthetic racing answer'}),/not_live|resolved/);
    await Promise.all([first,second]);await until(()=>worker.resolutions===1);
    assert.equal(worker.interrupts,1);assert.equal(worker.closes,1);assert.equal(worker.status,'cancelled');
    assert.equal(f.app.tasks.run(item.runId).status,'cancelled');
  }finally{await f.close();}
});

test('HMR-RECURSIVE-007: a throwing terminal process close keeps its uncertain fence and ownership',async()=>{
  const f=fixture();try{
    const {worker,item}=await f.start(),run=f.app.tasks.run(item.runId);
    f.app.tasks.failRun(run.id,run.epoch,'synthetic_parent_cancelled');
    const close=worker.close.bind(worker);worker.close=async()=>{worker.closes++;throw Error('synthetic_terminal_close_failure');};
    try{
      await f.app.stop(run.id);await until(()=>worker.resolutions===1);
      assert.equal(worker.interrupts,1);assert.equal(worker.closes,1);
      assert.equal(f.app.tasks.run(run.id).phase,'uncertain');assert.equal(f.app.upgradeStatus().safe,false);
      assert.ok(f.app.store.events(run.id).some(e=>e.type==='engine_stop_unconfirmed'&&e.code==='synthetic_terminal_close_failure'));
      await assert.rejects(()=>worker.call('stage_file_result',{filename:'late.md',assetId:'synthetic-media',revision:1}),/stale|not_live|stop/);
    }finally{worker.close=close;}
  }finally{await f.close();}
});

for(const persisted of ['cancelled','expired'] as const)test('HMR-RECURSIVE-007: DB-first '+persisted+' settles the original callback once and rejects a late answer',async()=>{
  const db=new DatabaseSync(':memory:');try{
    const interactions=new WorkerInteractions(db),request=interactions.open({runId:'synthetic-run',threadId:'synthetic-thread',turnId:'synthetic-turn',requestId:'synthetic-request',source:'ask_main',kind:'question',details:{question:'Synthetic question'},authority:{description:'Synthetic local only',sourceRequestId:'synthetic-user',nativeApprovals:false}},()=>true);
    let resolutions=0;void request.response.then(()=>resolutions++);
    db.prepare("UPDATE worker_interactions SET state=?,code='synthetic_db_first' WHERE id=?").run(persisted,request.id);
    interactions.cancelRun('synthetic-run');
    assert.equal((await request.response).status,persisted);assert.equal(resolutions,1);
    interactions.cancelRun('synthetic-run');interactions.expire(request.id);await Promise.resolve();assert.equal(resolutions,1);
    assert.throws(()=>interactions.respond(request.id,{action:'answer',answer:'Synthetic late answer',reason:'Synthetic race'}),/not_live|resolved/);
  }finally{db.close();}
});

test('HMR-RECURSIVE-007: an answer delivered just before stop remains one callback result but grants no late output',async()=>{
  const f=fixture();try{
    const {worker,item}=await f.start();
    f.app.interactions.respond(item.id,{action:'answer',answer:'Synthetic format',reason:'Synthetic new user answer'},{userMessageId:'synthetic-answer',userText:'Synthetic format'});
    await until(()=>worker.resolutions===1);
    await f.app.stop(item.runId);
    assert.equal(worker.status,'answered');assert.equal(worker.resolutions,1);
    assert.equal(worker.interrupts,1);assert.equal(worker.closes,1);
    await assert.rejects(()=>worker.call('stage_file_result',{filename:'answered-late.md',assetId:'synthetic-media',revision:1}),/stale|not_live|stop/);
  }finally{await f.close();}
});
