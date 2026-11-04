// Synthetic persistence and approval contract; no model/account/production data.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {Homer} from '../src/service.js';
import {homerWebBridge} from '../src/web-homer.js';
import {createWebServer} from '../src/web-server.js';
import type {Config} from '../src/config.js';
import type {EngineOptions,TurnResult} from '../src/engine.js';
const until=async(check:()=>boolean)=>{for(let i=0;i<400;i++){if(check())return;await new Promise(r=>setTimeout(r,5));}throw Error('synthetic_local_web_timeout');};
test('unpaired HTTP preserves explicit native decisions and durable thread/input identity across normal restart',async()=>{
 const parent=resolve('.codex/scratch/local-development-web-access-implementation');mkdirSync(parent,{recursive:true});
 const dir=mkdtempSync(join(parent,'s-'));
 const config:Config={workspace:join(dir,'workspace'),runtime:join(dir,'runtime'),codexHome:join(dir,'home'),nativeCodexHome:join(dir,'home'),codexBin:'/usr/bin/false',requiresOpenaiAuth:false,model:'synthetic',effort:'medium',timeoutMs:1000,mainTimeoutMs:5000,stopGraceMs:100};
 for(const p of [config.workspace,config.runtime,config.codexHome])mkdirSync(p,{recursive:true});
 let decision:string|undefined;
 const factory=(options:EngineOptions)=>new class extends EventEmitter{
  threadId=options.threadId??'synthetic-persistent-web-main';turnId?:string;resumable=true;
  async start(){return this.threadId;}
  async turn(text:string,opts?:{onStarted?:(id:string)=>void}):Promise<TurnResult>{
   this.turnId='synthetic-turn';opts?.onStarted?.(this.turnId);
   if(text==='synthetic needs approval'){
    assert.equal(options.permissionRequests,true);
    const result=await options.onInteraction!({method:'item/commandExecution/requestApproval',threadId:this.threadId,turnId:this.turnId,itemId:'synthetic-command',requestId:123,kind:'authorization',details:{command:'synthetic operation',availableDecisions:['accept','decline']}});
    decision=result.status;
   }
   return {status:'completed',text:'Synthetic result'};
  }
  async close(){return true;}async interrupt(){return false;}
 }();
 let app=new Homer(config,async()=>{},factory);await app.start();let web=await createWebServer({bridge:homerWebBridge(app),port:0});
 const post=(path:string,body:unknown)=>fetch(web.url+path,{method:'POST',headers:{Connection:'close',Origin:web.url,'Content-Type':'application/json'},body:JSON.stringify(body)});
 const state=async()=>await(await fetch(web.url+'/api/state',{headers:{Connection:'close'}})).json() as any;
 try{
  const input={requestId:'synthetic-persistent-input',text:'synthetic needs approval'};
  assert.equal((await post('/api/messages',input)).status,202);
  await until(()=>app.interactions.list().some(i=>i.state==='pending_user'));
  const pending=(await state()).interactions[0];assert.equal(pending.kind,'authorization');
  assert.equal(decision,undefined,'access alone must not decide the pending approval');
  assert.equal((await post('/api/interactions/'+pending.id,{requestId:'synthetic-explicit-deny',text:'拒绝本次操作'})).status,202);
  await app.idle();assert.equal(app.interactions.inspect(pending.id).decision?.action,'deny');
  assert.ok(decision);assert.equal((await state()).interactions.length,0);
  const duplicate=await(await post('/api/messages',input)).json() as any;assert.equal(duplicate.fresh,false);
  assert.equal((await post('/api/messages',{...input,text:'synthetic conflicting text'})).status,409);
  const before=await state(),thread=app.store.meta('mainThread'),agent=app.store.meta('mainAgentId');
  const rows=app.store.db.prepare('SELECT id,threadId,requestId,text,status FROM conversation_messages ORDER BY id').all();
  const inputs=app.store.db.prepare('SELECT * FROM conversation_inputs ORDER BY rowid').all();
  const port=Number(new URL(web.url).port);await web.close();await app.close();
  app=new Homer(config,async()=>{},factory);await app.start();web=await createWebServer({bridge:homerWebBridge(app),port});
  const after=await state();assert.equal(after.threadId,before.threadId);assert.equal(app.store.meta('mainThread'),thread);assert.equal(app.store.meta('mainAgentId'),agent);
  for(const row of rows)assert.deepEqual(app.store.db.prepare('SELECT id,threadId,requestId,text,status FROM conversation_messages WHERE id=?').get((row as any).id),row);
  assert.deepEqual(app.store.db.prepare('SELECT * FROM conversation_inputs ORDER BY rowid').all(),inputs);
  assert.equal((await(await post('/api/messages',input)).json() as any).fresh,false);
  assert.equal(after.messages.filter((m:any)=>m.requestId===input.requestId&&m.role==='user').length,1);
 }finally{await web.close();await app.close();rmSync(dir,{recursive:true,force:true});}
});
