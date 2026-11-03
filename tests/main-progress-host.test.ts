import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {Homer} from '../src/service.js';
import {HomerWechat} from '../src/channels/wechat-homer.js';
import {WechatApi,type WechatItem,type WechatUpdates,type WechatCredential} from '../src/channels/wechat-api.js';
import type {EngineOptions,ToolCall} from '../src/engine.js';

// Requirement-derived synthetic host test. No real engine, secrets or external fetch.
test('ILINK-NOTIFY-004 actual main tool failure persists a progress pair without preventing its original reply',async()=>{
 const parent=resolve('.codex/scratch/ilink-progress-host');mkdirSync(parent,{recursive:true});const root=mkdtempSync(join(parent,'fixture-'));
 const credentials=new Map<string,WechatCredential>();let adapter:HomerWechat|undefined,app:Homer|undefined;
 class Api extends WechatApi{
  constructor(){super(async()=>Response.json({ret:0}));}
  received=false;sent:WechatItem[]=[];
  override async beginQr(){return {qrcode:'synthetic',qrcode_img_content:'https://ilinkai.weixin.qq.com/qr'};}
  override async pollQr(){return {status:'confirmed',bot_token:'synthetic',ilink_bot_id:'bot',ilink_user_id:'owner',baseurl:'https://ilinkai.weixin.qq.com'};}
  override async updates(_c:WechatCredential,_cursor:string,signal?:AbortSignal):Promise<WechatUpdates>{
   await delay(5,undefined,{signal});if(this.received)return {msgs:[]};this.received=true;
   return {msgs:[{message_id:'9701',from_user_id:'owner',to_user_id:'bot',message_type:1,message_state:2,context_token:'synthetic-context',item_list:[{type:1,text_item:{text:'合成工具失败后继续答复'}}]}]};
  }
  override async send(_c:WechatCredential,_peer:string,_context:string,_id:string,item:WechatItem){this.sent.push(item);}
 }
 class Engine extends EventEmitter{
  threadId='synthetic-progress-main';turnId?:string;resumable=true;
  constructor(readonly handler:(call:ToolCall)=>Promise<unknown>){super();}
  async start(){return this.threadId;}
  async turn(_text:string,options?:{onStarted?:(id:string)=>void}){
   this.turnId='synthetic-progress-turn';options?.onStarted?.(this.turnId);
   await assert.rejects(this.handler({threadId:this.threadId,turnId:this.turnId,callId:'synthetic-check',tool:'inspect_run',arguments:{runId:'run-missing'}}),/run_not_found/);
   return {status:'completed',text:'合成已知失败后正常答复'};
  }
  async close(){return true;}async interrupt(){return true;}
 }
 try{
  mkdirSync(join(root,'runtime'));
  app=new Homer({runtime:join(root,'runtime'),workspace:join(root,'workspace'),codexHome:join(root,'home'),codexBin:'/usr/bin/false',model:'synthetic-only',requiresOpenaiAuth:false,timeoutMs:2000,mainTimeoutMs:2000,stopGraceMs:100},async message=>{await adapter?.onMessage(message);},(_options:EngineOptions,handler)=>new Engine(handler));
  app.registerRuntimeBuild('a'.repeat(64));await app.start();const api=new Api();
  adapter=new HomerWechat(app,api,{async get(id){return credentials.get(id)!;},async set(id,c){credentials.set(id,c);},async delete(id){credentials.delete(id);}});
  const login=await adapter.channel.beginLogin();await adapter.channel.pollLogin(login.id);
  for(let n=0;n<400&&api.sent.length<3;n++)await delay(5);
  assert.deepEqual(api.sent.map(item=>item.type),[11,12,1]);assert.equal(api.sent[1]!.tool_call_result_item?.status,'failed');assert.equal(api.sent[2]!.text_item?.text,'合成已知失败后正常答复');
  const capabilities=await app.capabilities();assert.equal(capabilities.runtime.version,'aaaaaaaaaaaa');assert.equal(capabilities.runtime.buildHash,'a'.repeat(64));assert.equal(capabilities.currentInput.nativeImagesSubmitted,0);
  assert.equal(app.store.meta('mainThread'),'synthetic-progress-main');assert.equal(app.inputs.list()[0]?.state,'completed');
 }finally{await adapter?.channel.close();await app?.close();rmSync(root,{recursive:true,force:true});}
});
