import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {Homer} from '../src/service.js';
import {HomerWechat} from '../src/channels/wechat-homer.js';
import {WechatApi,type WechatCredential,type WechatItem,type WechatUpdates} from '../src/channels/wechat-api.js';
import type {WechatSecrets} from '../src/channels/wechat-secrets.js';
import type {EngineImage} from '../src/engine.js';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY9sAAAAASUVORK5CYII=','base64');
export async function until(check:()=>boolean){for(let i=0;i<400;i++){if(check())return;await delay(5);}assert.ok(check(),'fixture_timeout');}
export async function setup(imageBytes:Buffer=png){
 const parent=resolve('.codex/scratch/ilink-host');mkdirSync(parent,{recursive:true});const dir=mkdtempSync(join(parent,'fixture-'));
 const turns:{text:string;images?:EngineImage[]}[]=[],creds=new Map<string,WechatCredential>();let release!:()=>void,gate=new Promise<void>(r=>release=r);
 class Api extends WechatApi{
  constructor(){super(async()=>Response.json({ret:0}));}
  batches:WechatUpdates[]=[];
  override async beginQr(){return {qrcode:'synthetic',qrcode_img_content:'https://ilinkai.weixin.qq.com/qr'};}
  override async pollQr(){return {status:'confirmed',bot_token:'synthetic',ilink_bot_id:'bot',ilink_user_id:'owner',baseurl:'https://ilinkai.weixin.qq.com'};}
  override async updates(_c:WechatCredential,_cursor:string,signal?:AbortSignal){await delay(5,undefined,{signal});return this.batches.shift()??{msgs:[]};}
  override async download(item:WechatItem,signal?:AbortSignal){await Promise.race([gate,new Promise<void>(r=>signal?.addEventListener('abort',()=>r(),{once:true}))]);if(item.image_item?.aeskey==='fail')throw Error('synthetic_media_failure');return {bytes:imageBytes,mime:'image/png',kind:'image' as const};}
  override async send(){}
 }
 class Engine extends EventEmitter{threadId='synthetic-main';async start(){return this.threadId;}async turn(text:string,options?:{images?:EngineImage[];onStarted?:(id:string)=>void}){options?.onStarted?.('synthetic-ilink-turn-'+turns.length);turns.push({text,images:options?.images});return {status:'completed',text:'synthetic response'};}async interrupt(){return true;}async close(){return true;}}
 mkdirSync(join(dir,'runtime'),{recursive:true});
 const app=new Homer({runtime:join(dir,'runtime'),workspace:join(dir,'workspace'),codexHome:dir,codexBin:'/usr/bin/false',model:'synthetic',requiresOpenaiAuth:false,timeoutMs:2000,mainTimeoutMs:2000,stopGraceMs:100},async()=>{},()=>new Engine());await app.start();
 const api=new Api(),secrets:WechatSecrets={async get(id){return creds.get(id)!;},async set(id,c){creds.set(id,c);},async delete(id){creds.delete(id);}};
 const wechat=new HomerWechat(app,api,secrets),login=await wechat.channel.beginLogin();await wechat.channel.pollLogin(login.id);
 function receive(id:string,items:WechatItem[]){api.batches.push({msgs:[{message_id:id,from_user_id:'owner',to_user_id:'bot',message_type:1,message_state:2,context_token:'synthetic-context',item_list:items}],get_updates_buf:'cursor-'+id});}
 return {app,wechat,api,turns,receive,release,async close(){release();await wechat.channel.close();await app.close();rmSync(dir,{recursive:true,force:true});}};
}
