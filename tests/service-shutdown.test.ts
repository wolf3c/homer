import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {Homer} from '../src/service.js';
import type {EngineOptions,ToolCall,TurnResult} from '../src/engine.js';

async function fixture(confirmed=true,closeError='engine_closed'){
 const parent=resolve('.codex/scratch/account-mvp/shutdown-review');mkdirSync(parent,{recursive:true});
 const root=mkdtempSync(join(parent,'synthetic-')),runtime=join(root,'runtime'),workspace=join(root,'workspace');
 mkdirSync(runtime);mkdirSync(workspace);
 let main!:Peer;
 class Peer extends EventEmitter{
  threadId:string;turnId?:string;resumable=true;pending?:(error:Error)=>void;sequence=0;
  constructor(readonly options:EngineOptions,readonly handle:(call:ToolCall)=>Promise<unknown>){super();this.threadId=options.threadId??(this.worker?'shutdown-worker':'shutdown-main');if(!this.worker)main=this;}
  get worker(){return this.options.role==='worker';}
  async start(){return this.threadId;}
  call(tool:string,args:unknown){return this.handle({threadId:this.threadId,turnId:this.turnId!,callId:'shutdown-call-'+ ++this.sequence,tool,arguments:args});}
  async turn(text:string,hooks?:{onStarted?:(id:string)=>void}):Promise<TurnResult>{
   this.turnId='shutdown-turn-'+ ++this.sequence;hooks?.onStarted?.(this.turnId);
   if(this.worker){writeFileSync(join(this.options.cwd,'saved.md'),'Synthetic preserved file');return {status:'completed',text:'Synthetic file written'};}
   if(text==='dispatch'){await this.call('worker_open',{message:'Preserve the file'});return {status:'completed',text:'Dispatched'};}
   return new Promise((_resolve,reject)=>{this.pending=reject;});
  }
  async interrupt(){return false;}
  async close(){this.pending?.(Error(closeError));this.pending=undefined;return this.worker||confirmed;}
 }
 const app=new Homer({runtime,workspace,codexHome:join(root,'home'),nativeCodexHome:join(root,'home'),codexBin:'/usr/bin/false',model:'synthetic',requiresOpenaiAuth:false,stopGraceMs:50,timeoutMs:2000},async()=>{},(options,handle)=>new Peer(options,handle));
 await app.start();
 const until=async(check:()=>boolean)=>{const end=Date.now()+3000;while(!check()){if(Date.now()>end)throw Error('shutdown_test_timeout');await new Promise(r=>setTimeout(r,5));}};
 return {app,root,runtime,main:()=>main,until,cleanup:async()=>{await app.close().catch(()=>{});rmSync(root,{recursive:true,force:true});}};
}

for(const confirmed of [true,false])test(`shutdown cancellation keeps the Worker notice and file; stop confirmed=${confirmed}`,async()=>{
 const f=await fixture(confirmed);
 try{
  await f.app.message('dispatch','synthetic-shutdown-request');await f.until(()=>!!f.main().pending);
  const thread=f.app.store.meta('mainThread');
  const source=f.app.store.db.prepare("SELECT messageId FROM agent_receipts WHERE state='received'").get()!;
  if(confirmed)await f.app.close({requireAllOwnersConfirmed:true});
  else await assert.rejects(f.app.close({requireAllOwnersConfirmed:true}),/main_stop_unconfirmed/);
  const db=new DatabaseSync(join(f.runtime,'homer.sqlite'),{readOnly:true});
  try{
   assert.equal(db.prepare("SELECT value FROM meta WHERE key='mainThread'").get()!.value,thread);
   assert.equal(readFileSync(join(f.root,'workspace','saved.md'),'utf8'),'Synthetic preserved file');
   assert.equal(db.prepare('SELECT state FROM agent_receipts WHERE messageId=?').get(String(source.messageId))!.state,'uncertain');
   const nodes=db.prepare("SELECT value FROM meta WHERE key GLOB 'publicMainNode:v1:*'").all().map(row=>JSON.parse(String(row.value)));
   const internal=nodes.filter(node=>node.sourceKind==='worker');assert.equal(internal.length,1);
   assert.equal(internal[0].status,'unknown');assert.equal(internal[0].state,confirmed?'worked':'working');if(confirmed)assert.match(internal[0].endEventId,/^host:engine_closed:/);else assert.equal(internal[0].endEventId,undefined);
   assert.equal(db.prepare("SELECT count(*) n FROM events WHERE type IN ('main_turn_failed','internal_processing_failed')").get()!.n,0);
  }finally{db.close();}
 }finally{await f.cleanup();}
});

for(const [closing,code] of [[true,'engine_disconnected'],[false,'engine_disconnected'],[false,'engine_closed']] as const)test(`unexpected ${code} stays failed during closing=${closing}`,async()=>{
 const f=await fixture(true,code);
 try{
  await f.app.message('dispatch','synthetic-disconnect-request');await f.until(()=>!!f.main().pending);
  if(!closing){f.main().pending!(Error(code));await f.app.idle();}
  await f.app.close();
  const db=new DatabaseSync(join(f.runtime,'homer.sqlite'),{readOnly:true});
  try{assert.equal(db.prepare("SELECT count(*) n FROM events WHERE type IN ('main_turn_failed','internal_processing_failed') AND code=?").get(code)!.n,2);}
  finally{db.close();}
 }finally{await f.cleanup();}
});

test('shutdown cancels a user turn without inventing a native terminal or replayable input',async()=>{
 const f=await fixture();
 try{
  const reply=f.app.message('hold-user-reply','synthetic-user-request');
  const cancelled=assert.rejects(reply,/application_closing/);
  await f.until(()=>!!f.main().pending);await f.app.close();await cancelled;
  const db=new DatabaseSync(join(f.runtime,'homer.sqlite'),{readOnly:true});
  try{
   assert.equal(db.prepare("SELECT count(*) n FROM events WHERE type='main_turn_failed'").get()!.n,0);
   assert.equal(db.prepare("SELECT r.state FROM agent_receipts r JOIN agent_messages m ON m.id=r.messageId WHERE json_extract(m.payloadJson,'$.requestId')='synthetic-user-request'").get()!.state,'uncertain');
   const node=JSON.parse(String(db.prepare("SELECT value FROM meta WHERE key GLOB 'publicMainNode:v1:*'").get()!.value));
   assert.equal(node.status,'unknown');assert.equal(node.state,'worked');assert.match(node.endEventId,/^host:engine_closed:/);
   const reply=db.prepare("SELECT text FROM conversation_messages WHERE requestId='synthetic-user-request' AND role='assistant'").get()!;
   assert.match(String(reply.text),/已停止当前回复/);assert.doesNotMatch(String(reply.text),/工作继续运行/);
  }finally{db.close();}
 }finally{await f.cleanup();}
});
