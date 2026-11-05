import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { WechatChannel, type WechatBridge, type WechatOrigin } from "../src/channels/wechat-channel.js";
import { WechatApi, WechatError, type WechatCredential, type WechatQrStatus, type WechatUpdates, type WechatItem } from "../src/channels/wechat-api.js";
import type { WechatSecrets } from "../src/channels/wechat-secrets.js";
function deferred<T>() { let resolve!: (value:T)=>void; const promise = new Promise<T>(r=>{resolve=r;}); return {promise,resolve}; }
class Secrets implements WechatSecrets {
  values = new Map<string,WechatCredential>();
  async get(id:string) { const c=this.values.get(id); if(!c) throw new WechatError("wechat_keychain_unavailable"); return c; }
  async set(id:string,c:WechatCredential) { this.values.set(id,c); }
  async delete(id:string) { this.values.delete(id); }
}
class Api extends WechatApi {
  constructor(){super(async()=>Response.json({ret:0}));}
  qr: WechatQrStatus = {status:"confirmed",bot_token:"synthetic-token",ilink_bot_id:"bot",ilink_user_id:"owner",baseurl:"https://ilinkai.weixin.qq.com"};
  qrCalls = 0; updatesQueue: WechatUpdates[] = []; sent: {peer:string;context:string;id:string;item:WechatItem}[] = [];
  sendError?: WechatError;
  override async beginQr() { return {qrcode:"synthetic-qr",qrcode_img_content:"https://ilinkai.weixin.qq.com/qr/synthetic"}; }
  override async pollQr() { this.qrCalls++; return this.qr; }
  override async updates(_c:WechatCredential,_cursor:string,signal?:AbortSignal) {
    if(this.updatesQueue.length) return this.updatesQueue.shift()!;
    await delay(20000,undefined,{signal}); return {msgs:[]};
  }
  override async send(_c:WechatCredential,peer:string,context:string,id:string,item:WechatItem) {
    this.sent.push({peer,context,id,item}); const error = this.sendError; this.sendError=undefined; if(error) throw error;
  }
}
const update=(id:string,from="owner")=>({message_id:id,from_user_id:from,to_user_id:"bot",message_type:1,message_state:2,context_token:"context-"+id,item_list:[{type:1,text_item:{text:"合成消息-"+id}}]});
async function until(fn:()=>boolean) { for(let i=0;i<100;i++){if(fn()) return;await delay(10);} assert.ok(fn(),"condition not reached"); }
function setup(bridge?:WechatBridge) {
  const db=new DatabaseSync(":memory:"), api=new Api(), secrets=new Secrets(), received:{requestId:string;text:string;origin:WechatOrigin}[]=[];
  const channel=new WechatChannel(db,bridge??{async submit(input){received.push(input);},async artifact(){return {filename:"合成成果.md",bytes:Buffer.from("# 合成测试")};}},api,secrets);
  return {db,api,secrets,channel,received,async close(){await channel.close();db.close();}};
}
async function connect(s:ReturnType<typeof setup>) {const login=await s.channel.beginLogin();await s.channel.pollLogin(login.id);}
test('ILINK-EXTRA-002 authorized publication sends one ordered combo and never replays an unknown outcome',async()=>{
 for(const unknown of [false,true]){
  let uploads=0,combos:WechatItem[][]=[];
  const s=setup();try{
   s.api.uploadMarkdown=async()=>{uploads++;return {type:4,file_item:{file_name:'合成成果.md',len:'16',media:{encrypt_query_param:'synthetic-only',aes_key:'synthetic-only',encrypt_type:1}}};};
   s.api.sendItems=async(_c,_peer,_context,_id,items)=>{combos.push(items);if(unknown)throw new WechatError('wechat_send_uncertain',true);return {message_id:'9851'};};
   s.api.updatesQueue=[{msgs:[update('9850')]}];await connect(s);await until(()=>s.received.length===1);const requestId=s.received[0]!.requestId;
   await s.channel.prepareCombinedDelivery(requestId);
   const event={requestId,eventId:'synthetic-combo-delivery',type:'delivery' as const,text:'合成正式交付说明',artifactResultId:'result-synthetic'};
   await s.channel.publish(event);await until(()=>combos.length===1);await until(()=>s.channel.store.outbox().find(row=>row.eventKey===event.eventId)?.state===(unknown?'uncertain':'sent'));
   assert.deepEqual(combos[0]!.map(item=>item.type),[1,4]);assert.equal(combos[0]![0]!.text_item?.text,event.text);
   const original={...s.channel.store.outbox().find(row=>row.eventKey===event.eventId)!};
   await s.channel.publish(event);await delay(25);assert.equal(combos.length,1);assert.equal(uploads,1);
   assert.deepEqual({...s.channel.store.outbox().find(row=>row.eventKey===event.eventId)},original);
  }finally{await s.close();}
 }
});
test('ILINK-EXTRA-002 upload does not authorize combo send after publication is revoked',async()=>{
 let reads=0,sends=0,uploads=0;
 const s=setup({async submit(){},async artifact(){if(++reads>1)throw new WechatError('artifact_not_authorized');return {filename:'synthetic.md',bytes:Buffer.from('synthetic publication')};}});
 try{
  s.api.uploadMarkdown=async()=>{uploads++;return {type:4,file_item:{file_name:'synthetic.md',len:'21',media:{encrypt_query_param:'synthetic-only',aes_key:'synthetic-only',encrypt_type:1}}};};
  s.api.sendItems=async()=>{sends++;return {message_id:'9861'};};
  s.api.updatesQueue=[{msgs:[update('9860')]}];await connect(s);await until(()=>s.channel.store.outbox().length===0&&!!s.channel.store.db.prepare('SELECT 1 FROM wechat_inbox').get());
  const requestId=String(s.db.prepare('SELECT requestId FROM wechat_inbox').get()!.requestId);await s.channel.prepareCombinedDelivery(requestId);
  await s.channel.publish({requestId,eventId:'revoked-combo',type:'delivery',text:'synthetic description',artifactResultId:'result-synthetic'});
  await until(()=>s.channel.store.outbox().find(row=>row.eventKey==='revoked-combo')?.state==='failed');assert.equal(uploads,1);assert.equal(sends,0);
 }finally{await s.close();}
});
test('ILINK-NOTIFY-002 tool progress is paired, scope checked, durable and never retried after an unknown start',async()=>{
 const s=setup();try{
  s.api.updatesQueue=[{msgs:[update('905')]}];await connect(s);await until(()=>s.received.length===1);const requestId=s.received[0]!.requestId;
  const item={id:'activity-00000000-0000-0000-0000-000000000001',label:'检查资料' as const};
  assert.equal(await s.channel.progressFor(requestId,{...item,phase:'end',status:'completed'}),false);
  s.api.sendError=new WechatError('wechat_send_uncertain',true);
  await s.channel.progressFor(requestId,{...item,phase:'start'});await until(()=>s.channel.status().uncertain===1);
  await s.channel.progressFor(requestId,{...item,phase:'end',status:'completed'});await delay(20);assert.equal(s.api.sent.length,1);
  assert.equal(s.api.sent[0]!.item.type,11);assert.equal(s.api.sent[0]!.item.tool_call_start_item?.tool_name,'检查资料');
  assert.equal(await s.channel.progressFor('unrelated',{...item,phase:'start'}),false);
  assert.equal(s.channel.store.outbox().filter(row=>row.eventKey.includes(item.id)).length,2);
  await s.channel.progressFor(requestId,{...item,phase:'start'});assert.equal(s.api.sent.length,1);
 }finally{await s.close();}
});
test('ILINK-NOTIFY-003 one request emits at most three fixed-label progress pairs with acknowledged starts first',async()=>{
 const s=setup();try{
  s.api.updatesQueue=[{msgs:[update('906')]}];await connect(s);await until(()=>s.received.length===1);const requestId=s.received[0]!.requestId;
  for(let n=1;n<=4;n++){
   const progress={id:'activity-00000000-0000-0000-0000-'+String(n).padStart(12,'0'),label:'核对成果' as const};
   const queued=await s.channel.progressFor(requestId,{...progress,phase:'start'});assert.equal(queued,n<=3);
   assert.equal(await s.channel.progressFor(requestId,{...progress,phase:'end',status:'completed'}),n<=3);
  }
  await until(()=>s.api.sent.length===6);assert.deepEqual(s.api.sent.map(s=>s.item.type),[11,12,11,12,11,12]);
  for(let n=0;n<6;n+=2)assert.equal(s.api.sent[n]!.item.tool_call_start_item?.tool_call_id,s.api.sent[n+1]!.item.tool_call_result_item?.tool_call_id);
 }finally{await s.close();}
});
test('ILINK-NOTIFY-001 stale terminal cannot cancel another request typing and late config cannot restart cancelled typing',async()=>{
 const s=setup(),ticket=deferred<Record<string,unknown>>(),entered=deferred<void>(),states:number[]=[];
 s.api.getConfig=async()=>{entered.resolve();return ticket.promise;};s.api.sendTyping=async(_c,_ticket,status)=>{states.push(status);return {ret:0};};
 try{
  s.api.updatesQueue=[{msgs:[update('901'),update('902')]}];await connect(s);await until(()=>s.received.length===2);
  const first=s.received[0]!.requestId,other=s.received[1]!.requestId,typing=s.channel.typingFor(first,true);await entered.promise;
  await s.channel.typingFor(other,false);ticket.resolve({typing_ticket:'synthetic-ticket'});await typing;assert.deepEqual(states,[1]);
  await s.channel.typingFor(first,false);assert.deepEqual(states,[1,2]);
  const late=deferred<Record<string,unknown>>();s.api.getConfig=async()=>late.promise;
  const starting=s.channel.typingFor(other,true);await delay(0);await s.channel.typingFor(other,false);late.resolve({typing_ticket:'late'});await starting;assert.deepEqual(states,[1,2]);
 }finally{ticket.resolve({typing_ticket:'cleanup'});await s.close();}
});
test("QR expiry is terminal and reconnect uses a fresh QR",async()=>{
  const s=setup();try {
    s.api.qr={status:"expired"};const login=await s.channel.beginLogin();assert.equal((await s.channel.pollLogin(login.id)).status,"expired");
    s.api.qr={status:"confirmed",bot_token:"synthetic-token",ilink_bot_id:"bot",ilink_user_id:"owner",baseurl:"https://ilinkai.weixin.qq.com"};
    assert.equal((await s.channel.pollLogin(login.id)).status,"expired"); assert.equal(s.channel.status().bound,false);
    await connect(s);assert.equal(s.channel.status().status,"connected");
  }finally{await s.close();}
});
test("confirmed QR is idempotent and never replaces its own binding twice",async()=>{
  const s=setup();try{
    const login=await s.channel.beginLogin();await s.channel.pollLogin(login.id);const binding=s.channel.store.connection().bindingId;
    await s.channel.pollLogin(login.id);assert.equal(s.channel.store.connection().bindingId,binding);assert.equal(s.api.qrCalls,1);
  }finally{await s.close();}
});
test("late QR result cannot revive a disabled connection",async()=>{
  const s=setup(),pending=deferred<{qrcode:string;qrcode_img_content:string}>();s.api.beginQr=()=>pending.promise;
  try{
    const login=s.channel.beginLogin();s.channel.disable();pending.resolve({qrcode:"late",qrcode_img_content:"https://ilinkai.weixin.qq.com/qr/late"});
    await assert.rejects(login,/superseded/);assert.equal(s.channel.status().status,"disabled");assert.equal(s.secrets.values.size,0);
  }finally{await s.close();}
});
test("disable during credential save cleans only the abandoned reference and never binds",async()=>{
  const s=setup(),saving=deferred<void>(),entered=deferred<void>();
  s.secrets.set=async(id,c)=>{s.secrets.values.set(id,c);entered.resolve();await saving.promise;};
  try{
    const login=await s.channel.beginLogin(),poll=s.channel.pollLogin(login.id);await entered.promise;s.channel.disable();saving.resolve();
    await assert.rejects(poll,/superseded/);assert.equal(s.channel.status().status,"disabled");assert.equal(s.channel.status().bound,false);assert.equal(s.secrets.values.size,0);
  }finally{saving.resolve();await s.close();}
});
test("only owner input reaches one bridge; delayed delivery retains its original context",async()=>{
  const s=setup();try{
    s.api.updatesQueue=[{msgs:[update("1"),update("2","stranger"),update("3")],get_updates_buf:"cursor"}];await connect(s);
    await until(()=>s.received.length===2);const first=s.received[0]!,second=s.received[1]!;
    await s.channel.publish({eventId:"delivery-one",requestId:first.requestId,type:"delivery",text:"合成延迟交付"});
    await until(()=>s.api.sent.length===1);assert.equal(s.api.sent[0]!.context,"context-1");
    await s.channel.publish({eventId:"question-three",requestId:second.requestId,type:"question",text:"主 Agent 的问题",interactionId:"interaction-synthetic"});
    await until(()=>s.api.sent.length===2);assert.equal(s.api.sent[1]!.context,"context-3");assert.match(s.api.sent[1]!.item.text_item!.text!,/interaction-synthetic/);
    assert.equal(s.channel.store.connection().cursor,"cursor");assert.equal(s.channel.status().bound,true);
  }finally{await s.close();}
});
test("uncertain long reply stops its remaining parts while an independent event still delivers",async()=>{
  const s=setup();try{
    s.api.updatesQueue=[{msgs:[update("1")]}];await connect(s);await until(()=>s.received.length===1);
    const requestId=s.received[0]!.requestId;s.api.sendError=new WechatError("wechat_send_uncertain",true);
    await s.channel.publish({eventId:"long",requestId,type:"reply",text:"长回复".repeat(2000)});await until(()=>s.channel.status().uncertain===1);
    await s.channel.publish({eventId:"independent",requestId,type:"question",text:"独立待答"});
    await until(()=>s.api.sent.length===2);assert.equal(s.api.sent[1]!.item.text_item!.text,"独立待答");
    await delay(150);assert.equal(s.api.sent.length,2);
  }finally{await s.close();}
});
test("credential invalidation stops polling and old callbacks cannot restore enabled intent",async()=>{
  const s=setup();s.api.updates=async()=>{throw new WechatError("wechat_credentials_invalid");};
  try{await connect(s);await until(()=>s.channel.status().status==="invalid");assert.equal(s.channel.status().enabled,false);}
  finally{await s.close();}
});
test("disabled intent persists across a new channel instance; reconnect restores one binding",async()=>{
  const s=setup();let restarted:WechatChannel|undefined;
  try{
    await connect(s);const binding=s.channel.store.connection().bindingId;s.channel.disable();await s.channel.close();
    restarted=new WechatChannel(s.db,{async submit(){},async artifact(){return {filename:"sample.md",bytes:Buffer.from("synthetic")};}},s.api,s.secrets);
    assert.equal((await restarted.restore()).status,"disabled");assert.equal(restarted.status().enabled,false);
    await restarted.reconnect();assert.equal(restarted.status().enabled,true);assert.equal(restarted.store.connection().bindingId,binding);
  }finally{await restarted?.close();await s.close();}
});
test("network disconnection retains cursor and pending input, then resumes without duplicates",async()=>{
  const s=setup();let calls=0;const original=s.api.updates.bind(s.api);
  s.api.updates=async(c,cursor,signal)=>{
    calls++;if(calls===1)throw new WechatError("wechat_network_unavailable");
    if(calls===2){assert.equal(cursor,"");return {msgs:[update("8"),update("8")],get_updates_buf:"resume-cursor"};}
    return original(c,cursor,signal);
  };
  try{
    await connect(s);await until(()=>s.channel.status().status==="reconnecting");
    // The protocol retry includes a bounded backoff; no synthetic busy loop.
    for(let i=0;i<150 && s.received.length===0;i++)await delay(10);
    assert.equal(s.received.length,1);assert.equal(s.channel.store.connection().cursor,"resume-cursor");assert.equal(s.channel.status().status,"connected");
  }finally{await s.close();}
});
test("multiple outstanding interaction replies retain their IDs as natural input for the same main Agent",async()=>{
  const s=setup();try{
    s.api.updatesQueue=[{msgs:[update("10")]}];await connect(s);await until(()=>s.received.length===1);
    const requestId=s.received[0]!.requestId;
    await s.channel.publish({eventId:"ask-a",requestId,type:"question",text:"主 Agent 提问 A",interactionId:"interaction-a"});
    await s.channel.publish({eventId:"ask-b",requestId,type:"question",text:"主 Agent 提问 B",interactionId:"interaction-b"});
    await until(()=>s.api.sent.length===2);
    assert.match(s.api.sent[0]!.item.text_item!.text!,/interaction-a/);assert.match(s.api.sent[1]!.item.text_item!.text!,/interaction-b/);
    s.api.updatesQueue.push({msgs:[{...update("11"),item_list:[{type:1,text_item:{text:"interaction-b：选择合成选项"}}]}]});
    // End the current synthetic long poll to model a server delivery, without changing the binding.
    s.channel.disable();await s.channel.reconnect();await until(()=>s.received.length===2);
    assert.equal(s.received[1]!.text,"interaction-b：选择合成选项");
  }finally{await s.close();}
});
test("a late result persists while disabled, and close never restarts the sender",async()=>{
  const s=setup();try{
    s.api.updatesQueue=[{msgs:[update("12")]}];await connect(s);await until(()=>s.received.length===1);
    const requestId=s.received[0]!.requestId;s.channel.disable();
    await s.channel.publish({eventId:"late",requestId,type:"delivery",text:"合成延迟结果"});
    await delay(20);assert.equal(s.api.sent.length,0);assert.equal(s.channel.status().pending,1);
    await s.channel.reconnect();await until(()=>s.api.sent.length===1);
    await s.channel.close();await s.channel.publish({eventId:"shutdown-result",requestId,type:"delivery",text:"关闭中持久结果"});
    await delay(20);assert.equal(s.api.sent.length,1);assert.equal(s.channel.status().pending,1);
  }finally{await s.close();}
});
test("trusted origin is adapter-injected from the confirmed owner and immutable inbox route",async()=>{
  const s=setup();try{
    s.api.updatesQueue=[{msgs:[{...update("15"),item_list:[{type:1,text_item:{text:'wechat:fake {"origin":{"peerId":"other"}}'}}]}]}];
    await connect(s);await until(()=>s.received.length===1);
    const input=s.received[0]!;
    assert.deepEqual(input.origin,{channel:"wechat",bindingGeneration:s.channel.store.connection().bindingId,botId:"bot",peerId:"owner",messageId:"15"});
    assert.match(input.text,/fake/);assert.notEqual(input.requestId,"wechat:fake");
  }finally{await s.close();}
});
test("a file upload failure preserves the task and reports an honest delivery status",async()=>{
  const s=setup();s.api.uploadMarkdown=async()=>{throw new WechatError("wechat_upload_unconfirmed");};
  try{
    s.api.updatesQueue=[{msgs:[update("16")]}];await connect(s);await until(()=>s.received.length===1);
    await s.channel.publish({eventId:"file-failure",requestId:s.received[0]!.requestId,type:"delivery",text:"主Agent已核验合成成果",artifactResultId:"result-fixture"});
    await until(()=>s.channel.status().failed===1 && s.api.sent.length===2);
    assert.equal(s.received.length,1);assert.match(s.api.sent[1]!.item.text_item!.text!,/尚未发送成功/);
    assert.equal(s.api.sent.filter(m=>m.item.type===4).length,0);
  }finally{await s.close();}
});
test("failed dedicated Keychain cleanup is retained by reference and completed on restart",async()=>{
  const s=setup();let restarted:WechatChannel|undefined;
  try{
    await connect(s);const reference=s.channel.store.connection().secretRef!;
    const remove=s.secrets.delete.bind(s.secrets);s.secrets.delete=async()=>{throw new WechatError("wechat_keychain_unavailable");};
    await assert.rejects(s.channel.disconnect(),/keychain_unavailable/);assert.equal(s.channel.status().enabled,false);
    assert.deepEqual(s.channel.store.unusedSecrets(),[reference]);assert.equal(s.secrets.values.size,1);
    await s.channel.close();s.secrets.delete=remove;
    restarted=new WechatChannel(s.db,{async submit(){},async artifact(){return {filename:"sample.md",bytes:Buffer.from("synthetic")};}},s.api,s.secrets);
    await restarted.restore();assert.equal(s.secrets.values.size,0);assert.deepEqual(restarted.store.unusedSecrets(),[]);assert.equal(restarted.status().enabled,false);
  }finally{await restarted?.close();await s.close();}
});
test("disabling during event acceptance still durably queues the original binding result",async()=>{
  const s=setup();try{
    s.api.updatesQueue=[{msgs:[update("18")]}];await connect(s);await until(()=>s.received.length===1);
    const queued=s.channel.publish({eventId:"disable-race",requestId:s.received[0]!.requestId,type:"delivery",text:"停用竞态合成成果"});
    s.channel.disable();assert.equal(await queued,true);assert.equal(s.channel.status().pending,1);assert.equal(s.api.sent.length,0);
    await s.channel.reconnect();await until(()=>s.api.sent.length===1);assert.equal(s.api.sent[0]!.context,"context-18");
  }finally{await s.close();}
});
