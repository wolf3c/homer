import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,until} from './fixtures/worker-chat-host.js';
import type {ChannelAdapter} from '../src/channel-plugin.js';
import {TelegramChannel} from '../src/telegram-channel.js';

test('wake polling requires a started owner and reconnects qualified adapters through the original binding',async()=>{
 let connected=0,health:'ready'|'reauthorize'='ready';
 const adapter:ChannelAdapter={id:'replay',offlineReplayMs:24*60*60_000,connectionState:()=>health,send:async()=>({state:'sent'}),connect:async(_address,_receive,signal)=>{connected++;await new Promise<void>(resolve=>{if(signal.aborted)resolve();else signal.addEventListener('abort',()=>resolve(),{once:true});});}};
 const unproven:ChannelAdapter={id:'unproven',send:async()=>({state:'sent'})};
 const f=fixture([adapter,unproven]);let bindingId='';
 try{
  for(const id of ['replay','unproven']){const bound=f.app.channels!.bind({adapterId:id,accountKey:'account',senderKey:'sender',conversationKey:'chat'});if(id==='replay')bindingId=bound;}
  assert.deepEqual(f.app.channels!.wakePollingChannels(),[]);
  assert.equal(f.engines.length,0);
  await f.app.start();await until(()=>connected===1);
  assert.deepEqual(f.app.channels!.wakePollingChannels(),['replay']);
  await f.app.channels!.resumeAfterSleep(false);assert.equal(connected,1,'awake periodic checks preserve the healthy transport');
  await f.app.channels!.resumeAfterSleep();await until(()=>connected===2);
  assert.equal(f.app.store.db.prepare("SELECT COUNT(*) n FROM agent_messages WHERE kind='user_input'").get()!.n,0);
  health='reauthorize';assert.deepEqual(f.app.channels!.wakePollingChannels(),[]);
  health='ready';
  f.app.channels!.revokeBinding(bindingId);assert.deepEqual(f.app.channels!.wakePollingChannels(),[]);
 }finally{await f.close();}
});

test('a short replay window cannot qualify for the maximum offered interval',async()=>{
 const adapter:ChannelAdapter={id:'short',offlineReplayMs:30*60_000,send:async()=>({state:'sent'}),connect:async()=>{}};
 const f=fixture([adapter]);
 try{f.app.channels!.configureBindings('short',[{adapterId:'short',accountKey:'a',senderKey:'s',conversationKey:'c'}]);assert.deepEqual(f.app.channels!.wakePollingChannels(),[]);}
 finally{await f.close();}
});

test('wake recovery excludes accounts that require authorization even when another account uses the same adapter',async()=>{
 const connected=new Map<string,number>();
 const adapter:ChannelAdapter={id:'replay',offlineReplayMs:24*60*60_000,send:async()=>({state:'sent'}),connectionState:account=>account==='expired'?'reauthorize':'ready',connect:async(address,_receive,signal)=>{
  connected.set(address.accountKey,(connected.get(address.accountKey)??0)+1);
  await new Promise<void>(resolve=>{if(signal.aborted)resolve();else signal.addEventListener('abort',()=>resolve(),{once:true});});
 }};
 const f=fixture([adapter]);
 try{
  for(const accountKey of ['active','expired'])f.app.channels!.bind({adapterId:'replay',accountKey,senderKey:'sender',conversationKey:'chat'});
  await f.app.start();await until(()=>connected.size===2);
  assert.deepEqual(f.app.channels!.wakePollingChannels(),['replay']);
  await f.app.channels!.resumeAfterSleep();await until(()=>connected.get('active')===2);
  assert.equal(connected.get('expired'),1,'wake checks must not retry an account that requires authorization');
 }finally{await f.close();}
});

test('Telegram sleep-boundary reconnect persists new offline messages once and acknowledges only after acceptance',async()=>{
 const account={token:'101:synthetic-wake-token',chatId:4_260_000_001,userId:4_260_000_001};
 const backlog:any[]=[],polls:{offset?:number}[]=[];let hanging=false;
 const ok=(result:unknown)=>Response.json({ok:true,result});
 const http:typeof fetch=async(url,init)=>{
  const body=JSON.parse(String(init?.body));
  if(String(url).endsWith('/getMe'))return ok({id:101,is_bot:true,username:'homer_wake_bot'});
  if(String(url).endsWith('/sendMessage'))return ok({message_id:123,chat:{id:account.chatId},from:{id:101,is_bot:true}});
  assert.ok(String(url).endsWith('/getUpdates'));polls.push(body);
  if(body.offset!==undefined)while(backlog.length&&backlog[0].update_id<body.offset)backlog.shift();
  if(backlog.length)return ok([...backlog]);
  if(body.timeout===0)return ok([]);
  return new Response(new ReadableStream({start(controller){
   hanging=true;
   const abort=()=>controller.error(Error('synthetic_sleep_disconnect'));
   if(init?.signal?.aborted)abort();else init?.signal?.addEventListener('abort',abort,{once:true});
  }}),{headers:{'content-type':'application/json'}});
 };
 const adapter=new TelegramChannel([account],http),f=fixture([adapter]);
 try{
  adapter.applyBindings(f.app.channels!);await f.app.start();await until(()=>hanging);
  assert.deepEqual(f.app.channels!.wakePollingChannels(),['telegram']);
  const date=Math.ceil(Date.now()/1000);
  for(const [id,text]of [[1001,'first offline message'],[1002,'second offline message']] as const)backlog.push({update_id:id,message:{message_id:id,date,text,chat:{id:account.chatId,type:'private'},from:{id:account.userId,is_bot:false}}});
  await f.app.channels!.resumeAfterSleep();await until(()=>f.inputs.length===2&&backlog.length===0);
  await f.app.channels!.resumeAfterSleep();
  assert.equal(f.app.store.db.prepare("SELECT COUNT(*) n FROM agent_messages WHERE kind='user_input'").get()!.n,2);
  assert.ok(polls.some(poll=>poll.offset===1003));
  assert.equal(f.inputs.filter(text=>text.includes('first offline message')).length,1);
  assert.equal(f.inputs.filter(text=>text.includes('second offline message')).length,1);
 }finally{await f.close();}
});
