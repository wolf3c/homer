import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {Homer} from '../src/service.js';

for(const [code,copy] of [
 ['engine_quota_insufficient','当前额度不足以继续本次请求'],
 ['engine_authentication_failed','当前模型服务未通过认证'],
 ['engine_account_status_unconfirmed','未能核实账号状态'],
] as const)test('Homer persists and displays the same model failure without replay: '+code,async()=>{
 const scratch=resolve('.codex/scratch/quota-failure-service');mkdirSync(scratch,{recursive:true});
 const root=mkdtempSync(join(scratch,'case-'));let turns=0;
 mkdirSync(join(root,'runtime'));mkdirSync(join(root,'workspace'));
 class Engine extends EventEmitter{
  threadId='synthetic-main';turnId='';
  async start(){return this.threadId;}
  async turn(_text:string,options?:{onStarted?:(id:string)=>void}){this.turnId='turn-'+ ++turns;options?.onStarted?.(this.turnId);return turns===1?{status:'failed',text:'',errorCode:code}:{status:'completed',text:'Synthetic next reply'};}
  async close(){return true;}
  async interrupt(){return true;}
 }
 const app=new Homer({workspace:join(root,'workspace'),runtime:join(root,'runtime'),codexHome:join(root,'codex'),nativeCodexHome:join(root,'codex'),codexBin:'/usr/bin/false',model:'synthetic',requiresOpenaiAuth:false,stopGraceMs:100,desktopModelSource:'website'},async()=>{},()=>new Engine());
 try{
  await app.start();app.submitMessage({requestId:'failure',text:'Synthetic request'});await app.idle();
  assert.equal(turns,1);assert.equal(app.conversationState().modelFailure?.code,code);
  const before=app.store.db.prepare("SELECT text FROM conversation_messages WHERE requestId='failure' AND role='assistant'").all() as {text:string}[];
  assert.match(before.map(r=>r.text).join('\n'),new RegExp(copy));
  assert.equal(app.store.db.prepare("SELECT code FROM events WHERE type='main_turn_failed' ORDER BY seq DESC LIMIT 1").get()!.code,code);
  app.submitMessage({requestId:'next',text:'Synthetic next request'});await app.idle();assert.equal(turns,2);assert.equal(app.conversationState().modelFailure,undefined);
  assert.deepEqual(app.store.db.prepare("SELECT text FROM conversation_messages WHERE requestId='failure' AND role='assistant'").all(),before);
 }finally{await app.close();rmSync(root,{recursive:true,force:true});}
});
