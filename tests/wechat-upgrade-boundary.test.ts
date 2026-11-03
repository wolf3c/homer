import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {WechatChannel} from '../src/channels/wechat-channel.js';
import {WechatManagement} from '../src/channels/wechat-management.js';
import {WechatApi,WechatError,type WechatCredential} from '../src/channels/wechat-api.js';
const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r);return {promise,resolve};};
const until=async(check:()=>boolean)=>{for(let i=0;i<200;i++){if(check())return;await delay(5);}assert.ok(check(),'synthetic boundary timeout');};
const digest=(db:DatabaseSync)=>createHash('sha256').update(JSON.stringify(db.prepare("SELECT * FROM wechat_outbox WHERE state='uncertain' ORDER BY id").all())).digest('hex');
function fixture(){
 const root=resolve('.codex/scratch/seamless-migration');mkdirSync(root,{recursive:true});
 const directory=mkdtempSync(join(root,'wechat-boundary-')),path=join(directory,'homer.sqlite');
 let db=new DatabaseSync(path);const values=new Map<string,WechatCredential>();
 const secrets={async get(id:string){const c=values.get(id);if(!c)throw Error('synthetic_secret_missing');return c;},async set(id:string,c:WechatCredential){values.set(id,c);},async delete(id:string){values.delete(id);}};
 const gate=deferred(),entered=deferred();let sends=0;
 class Api extends WechatApi{
  constructor(){super(async()=>Response.json({ret:0}));}
  override async beginQr(){return {qrcode:'synthetic-qr',qrcode_img_content:'https://ilinkai.weixin.qq.com/synthetic'};}
  override async pollQr(){return {status:'confirmed',bot_token:'synthetic-token',ilink_bot_id:'bot',ilink_user_id:'owner',baseurl:'https://ilinkai.weixin.qq.com'};}
  override async updates(_c:WechatCredential,_cursor:string,signal?:AbortSignal){await delay(20000,undefined,{signal});return {msgs:[]};}
  override async send(){sends++;entered.resolve();await gate.promise;throw new WechatError('wechat_send_uncertain',true);}
 }
 const api=new Api(),bridge={async submit(){},async artifact(){return {filename:'synthetic.md',bytes:Buffer.from('Synthetic')};}};
 let channel=new WechatChannel(db,bridge,api,secrets),management=new WechatManagement(channel);
 return {get db(){return db;},get channel(){return channel;},get management(){return management;},get sends(){return sends;},values,gate,entered,
  async connect(){const login=await management.beginLogin();await management.pollLogin(login.id);await until(()=>management.canUpgrade());},
  seed(){const c=channel.store.connection(),credential=[...values.values()][0];assert.ok(credential);const key=credential.dataKey;channel.store.accept(c.generation,{msgs:[{message_id:'1',from_user_id:'owner',to_user_id:'bot',message_type:1,message_state:2,context_token:'synthetic-context',item_list:[{type:1,text_item:{text:'Synthetic input'}}]}]},key);const row=channel.store.pending()[0];assert.ok(row);channel.store.submitted(row.requestId);return {requestId:row.requestId,key};},
  async reopen(){await channel.close();db.close();db=new DatabaseSync(path);channel=new WechatChannel(db,bridge,api,secrets);management=new WechatManagement(channel);await channel.restore();await until(()=>management.canUpgrade());},
  async close(){gate.resolve();await channel.close();db.close();}};
}
test('Wechat upgrade blocks a live sender but retains a settled uncertain receipt as unknown',async()=>{
 const f=fixture();try{
  await f.connect();const input=f.seed();
  await f.channel.publish({eventId:'synthetic-live-send',requestId:input.requestId,type:'reply',text:'Synthetic outgoing'});
  await f.entered.promise;
  assert.equal(f.management.canUpgrade(),false);
  f.gate.resolve();await until(()=>f.channel.status().uncertain===1&&f.management.canUpgrade());
  assert.equal(f.sends,1);assert.equal(f.channel.status().uncertain,1);
 }finally{await f.close();}
});
test('six durable uncertain rows survive database reopen byte-for-byte and are never automatically retried',async()=>{
 const f=fixture();try{
  await f.connect();const input=f.seed();
  for(let i=0;i<6;i++){
   f.channel.store.queueText(input.requestId,'synthetic-unknown-'+i,'Synthetic protected outgoing',input.key);
   const row=f.channel.store.outbox().find(x=>x.eventKey==='synthetic-unknown-'+i)!;
   assert.equal(f.channel.store.claim(row.id),true);f.channel.store.failed(row.id,true,'wechat_send_uncertain');
  }
  const before=digest(f.db);assert.equal(f.management.canUpgrade(),true);
  await f.reopen();await delay(120);
  assert.equal(f.channel.status().uncertain,6);assert.equal(digest(f.db),before);assert.equal(f.sends,0);
  // Later chunks of the same unknown event remain blocked as well.
  f.db.prepare("INSERT INTO wechat_outbox SELECT id||'-later',requestId,bindingId,eventKey,1,payload,'pending',NULL FROM wechat_outbox WHERE eventKey='synthetic-unknown-0'").run();
  const later=f.channel.store.outbox().find(x=>x.id.endsWith('-later'))!;assert.equal(f.channel.store.claim(later.id),false);
 }finally{await f.close();}
});
