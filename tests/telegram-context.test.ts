import assert from 'node:assert/strict';
import test from 'node:test';
import {Api,errors,helpers,TelegramClient} from 'teleproto';
import {telegramReplyContext} from '../src/telegram-context.js';
import {connectTelegramUpstream} from '../src/telegram-mtproto.js';

test('the last ten and the complete available upstream chain are merged once in message order',async()=>{
  const root={id:1,text:'root outside the window'};
  const parent={id:2,replyTo:1,text:'parent outside the window'};
  const recent=Array.from({length:11},(_,index)=>({id:index+3,text:`recent ${index+3}`}));
  const overlap={...recent[5]!,replyTo:2};
  const direct={...recent[10]!,replyTo:8};
  recent[5]=overlap;
  recent[10]=direct;
  const reads:number[]=[];
  const context=await telegramReplyContext(recent,{id:14,replyTo:13},direct,async id=>{
    reads.push(id);
    return id===2?parent:id===1?root:undefined;
  });
  assert.deepEqual(reads,[2,1]);
  assert.deepEqual(context.map(message=>message.id),[1,2,4,5,6,7,8,9,10,11,12,13]);
  assert.deepEqual(context.slice(0,2),[root,parent]);
  assert.equal(context.filter(message=>message.id===13).length,1);
  assert.equal(context.filter(message=>message.id===8).length,1);
});

test('the direct Telegram quote refreshes cached text while keeping its upstream pointer',async()=>{
  const context=await telegramReplyContext([{id:2,text:'Previous edit',replyTo:1}],{id:3,replyTo:2},
    {id:2,text:'Current edit'},async id=>id===1?{id:1,text:'Older reference'}:undefined);
  assert.deepEqual(context,[{id:1,text:'Older reference'},{id:2,text:'Current edit',replyTo:1}]);
});

test('unavailable upstream leaves the immediate quote and preceding context usable',async()=>{
  const quote={id:1,text:'inline quote'};
  const recent={id:3,text:'prior message'};
  assert.deepEqual(await telegramReplyContext([recent,{id:6,text:'future message'}],{id:4,replyTo:1},quote,async()=>{
    throw Error('telegram_unavailable');
  }),[quote,recent]);
});

test('MTProto looks up a supergroup by its protocol ID and checks returned peers',async t=>{
  const channelId=helpers.returnBigInt(99),chatId=-1_000_000_000_099;
  const channel=new Api.PeerChannel({channelId});
  t.mock.method(TelegramClient.prototype,'start',async function(this:TelegramClient){
    this.session.processEntities({chats:[new Api.Channel({id:channelId,accessHash:helpers.returnBigInt(123),
      title:'Synthetic group',photo:new Api.ChatPhotoEmpty(),date:1})]});
  });
  t.mock.method(TelegramClient.prototype,'getMe',async()=>new Api.User({id:helpers.returnBigInt(101),bot:true}));
  t.mock.method(TelegramClient.prototype,'destroy',async()=>{});
  t.mock.method(TelegramClient.prototype,'invoke',async(request:unknown)=>{
    assert.ok(request instanceof Api.channels.GetMessages&&request.channel instanceof Api.InputChannel);
    assert.equal(request.channel.channelId.toString(),'99');
    assert.equal(request.channel.accessHash.toString(),'123');
    const item=request.id[0];
    assert.ok(item instanceof Api.InputMessageID);
    return {messages:[new Api.Message({id:item.id,peerId:item.id===10?channel:new Api.PeerChat({chatId:channelId}),
      date:1,message:'Upstream',replyTo:new Api.MessageReplyHeader({replyToMsgId:9})})],users:[]};
  });
  const abort=new AbortController();
  const history=connectTelegramUpstream({api_id:1,api_hash:'a'.repeat(32)},'101:synthetic',abort.signal);
  try{
    const message=await history.read(chatId,10,AbortSignal.timeout(1000));
    assert.equal(message?.text,'Upstream');
    assert.equal(message?.replyTo,9);
    assert.equal(await history.read(chatId,11,AbortSignal.timeout(1000)),undefined);
  }finally{await history.close();}
});


test('a partial Telegram reply chain survives a rate limit',async()=>{
  const older={id:5,replyTo:3,text:'Available reference'},recent={id:8,replyTo:5,text:'Recent message'};
  const attempts:number[]=[];
  const context=await telegramReplyContext([recent],{id:9,replyTo:8},undefined,async id=>{
    attempts.push(id);
    if(id===5)return older;
    throw new errors.FloodWaitError({request:undefined,capture:30});
  });
  assert.deepEqual(attempts,[5,3]);
  assert.deepEqual(context,[older,recent]);
});

test('MTProto backs off until Telegram permits another demand',async t=>{
  t.mock.timers.enable({apis:['Date'],now:1_800_000_000_000});
  let starts=0,reads=0;
  t.mock.method(TelegramClient.prototype,'start',async()=>{
    if(++starts===1)throw new errors.FloodWaitError({request:undefined,capture:30});
  });
  t.mock.method(TelegramClient.prototype,'getMe',async()=>new Api.User({id:helpers.returnBigInt(101),bot:true}));
  t.mock.method(TelegramClient.prototype,'destroy',async()=>{});
  t.mock.method(TelegramClient.prototype,'invoke',async(request:unknown)=>{
    assert.ok(request instanceof Api.messages.GetMessages);
    const item=request.id[0];
    assert.ok(item instanceof Api.InputMessageID);
    reads++;
    if(item.id===2)throw new errors.FloodWaitError({request,capture:30});
    return {messages:[new Api.Message({id:item.id,peerId:new Api.PeerChat({chatId:helpers.returnBigInt(101)}),date:1,message:'Available'})],users:[]};
  });
  const history=connectTelegramUpstream({api_id:1,api_hash:'a'.repeat(32)},'101:synthetic',new AbortController().signal);
  const read=(id:number)=>history.read(-101,id,AbortSignal.timeout(1000));
  try{
    await new Promise<void>(resolve=>setImmediate(resolve));
    assert.equal(await read(1),undefined);
    assert.equal(starts,1);
    t.mock.timers.tick(30_000);
    assert.equal((await read(1))?.text,'Available');
    assert.equal(starts,2);
    assert.equal(await read(2),undefined);
    assert.equal(await read(3),undefined);
    assert.equal(reads,2);
    t.mock.timers.tick(30_000);
    assert.equal((await read(3))?.text,'Available');
    assert.equal(starts,2);
  }finally{await history.close();}
});
