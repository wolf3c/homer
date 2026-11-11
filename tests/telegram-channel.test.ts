import assert from 'node:assert/strict';
import {chmodSync,existsSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {createConnection} from 'node:net';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {setTimeout as wait} from 'node:timers/promises';
import test from 'node:test';
import {ChannelPlugin,type ChannelAdapter} from '../src/channel-plugin.js';
import {telegramChannel,TelegramChannel} from '../src/telegram-channel.js';
import {fixture,until} from './fixtures/worker-chat-host.js';
import {secureWindowsDirectory} from '../scripts/windows-security.mjs';

const A={token:'101:synthetic-bot-token-A',chatId:4_260_000_001,userId:4_260_000_001};
const B={token:'102:synthetic-bot-token-B',chatId:4_260_000_002,userId:4_260_000_002};
const ok=(result:unknown)=>Response.json({ok:true,result});

test('an authorized Telegram group uses the main Agent and replies to the original message and topic',async()=>{
  const group={id:-100001,type:'supergroup'},unknown={id:-100002,type:'group'};
  const member={id:300,is_bot:false},owner={id:A.userId,is_bot:false};
  const bot={id:101,is_bot:true};
  let date:number,botUsername:string|undefined='homer_bot';
  const mention={type:'mention',offset:3,length:10};
  const change=(update_id:number,chat:typeof group,from:typeof member,status:string)=>({update_id,my_chat_member:{
    chat,from,date,old_chat_member:{user:bot,status:status==='member'?'left':'member'},new_chat_member:{user:bot,status},
  }});
  const message=(update_id:number,chat:typeof group,from:typeof member,text:string,entities:unknown[]=[])=>({update_id,message:{
    chat,from,date,message_id:update_id,text,entities,
  }});
  const batches:unknown[][]=[],sent:any[]=[];
  const http:typeof fetch=async(url,init)=>{
    const body=JSON.parse(String(init?.body));
    if(String(url).endsWith('/getMe'))return ok({...bot,username:botUsername,can_read_all_group_messages:true});
    if(String(url).endsWith('/getUpdates')){
      if(!batches.length)await wait(8,undefined,{signal:init?.signal??undefined});
      return ok(batches.shift()??[]);
    }
    assert.ok(String(url).endsWith('/sendMessage'));
    sent.push(body);
    return ok({message_id:101,chat:group,from:bot});
  };
  const adapter=new TelegramChannel([A],http);
  const f=fixture([adapter]);
  const inputs:string[]=[];
  f.setScript(async(engine,text)=>{
    assert.equal(engine.options.nativeTools,'main');
    const input=text.replace(/^::message-source\{source=telegram\}\n\n/,'');
    if(input.startsWith('[内部协作输入'))return {status:'completed',text:''};
    if(input.startsWith('😀'))await engine.call('worker_open',{message:'Prepare a team report'});
    inputs.push(input);
    return {status:'completed',text:'Only the group question'};
  });
  try{
    adapter.applyBindings(f.app.channels!);
    await f.app.start();
    date=Math.ceil(Date.now()/1000);
    const question=message(6,group,member,'😀 @homer_bot question',[mention]);
    const followUp=message(7,group,member,'Can you expand?');
    const unrelatedReply=message(8,group,member,'ignore this reply');
    batches.push([change(1,unknown,member,'member'),message(2,unknown,member,'😀 @homer_bot question',[mention]),
      change(3,group,owner,'member'),message(4,group,member,'ordinary group chatter'),
      message(5,group,member,'😀 @homer_bot copied text'),question,question]);
    await until(()=>sent.length===1);
    botUsername=undefined;
    await f.restart(app=>adapter.applyBindings(app.channels!));
    batches.push([question,{...followUp,message:{...followUp.message,is_topic_message:true,message_thread_id:42,
      reply_to_message:{message_id:5,from:bot,text:'Only the group question'}}},
      {...unrelatedReply,message:{...unrelatedReply.message,reply_to_message:{from:{id:102,is_bot:true},text:'Other Bot'}}}]);
    await until(()=>sent.length===2);
    const afterRemoval=message(11,group,member,'Question after removal');
    batches.push([change(9,group,member,'left'),change(10,group,member,'member'),
      {...afterRemoval,message:{...afterRemoval.message,reply_to_message:{message_id:5,from:bot,text:'Only the group question'}}}]);
    await until(()=>batches.length===0);
    await wait(25);
    assert.equal(inputs[0],'😀  question');
    assert.match(inputs[1]!,/Telegram 群聊背景.*\n.*Only the group question.*\n\n\[群成员本次请求\]\nCan you expand\?$/);
    assert.deepEqual(f.app.store.db.prepare("SELECT text FROM conversation_messages WHERE role='user'").all().map(row=>row.text),
      ['😀  question','Can you expand?']);
    assert.equal(sent[0].chat_id,String(group.id));
    assert.equal(sent[0].reply_parameters.message_id,6);
    assert.equal(sent[0].text,'Only the group question');
    assert.equal(sent[1].reply_parameters.message_id,7);
    assert.equal(sent[1].message_thread_id,42);
    assert.equal(f.app.store.db.prepare("SELECT COUNT(*) AS count FROM agent_messages WHERE kind='user_input'").get()?.count,2);
    assert.equal(f.app.store.db.prepare('SELECT COUNT(*) AS count FROM tasks').get()?.count,1);
  }finally{await f.close();}
});

test('Telegram membership is checked before dispatching queued group work',async t=>{
  for(const mode of ['live removal','restored removal','offline on restart'])await t.test(mode,async()=>{
    const group={id:-100001,type:'supergroup'},owner={id:A.userId,is_bot:false},bot={id:101,is_bot:true};
    const batches:unknown[][]=[];
    let holdPoll=false,failPoll=false,connections=0,release=()=>{};
    const firstPollTimeout=new Map<number,number>();
    const held=new Promise<void>(resolve=>{release=resolve;});
    const http:typeof fetch=async(url,init)=>{
      if(String(url).endsWith('/getMe')){
        connections++;
        return ok({...bot,username:'homer_bot'});
      }
      assert.ok(String(url).endsWith('/getUpdates'));
      if(!firstPollTimeout.has(connections))firstPollTimeout.set(connections,JSON.parse(String(init?.body)).timeout);
      do{if(!batches.length&&!failPoll)await wait(8,undefined,{signal:init?.signal??undefined});}
      while(holdPoll&&!batches.length&&!failPoll);
      if(failPoll)return Response.json({ok:false,error_code:503},{status:503});
      return ok(batches.shift()??[]);
    };
    const adapter=new TelegramChannel([A],http);
    const f=fixture([adapter]);
    f.setScript(async(_engine,text)=>{
      if(text==='Hold the main Agent')await held;
      return {status:'completed',text:'Synthetic reply'};
    });
    try{
      adapter.applyBindings(f.app.channels!);
      await f.app.start();
      const date=Math.ceil(Date.now()/1000);
      const membership=(update_id:number,oldStatus:string,status:string)=>({update_id,my_chat_member:{
        chat:group,from:owner,date,old_chat_member:{user:bot,status:oldStatus},new_chat_member:{user:bot,status},
      }});
      const local=f.app.message('Hold the main Agent').catch(()=>{});
      await until(()=>f.inputs.length===1);
      const groupText='Queued group request';
      batches.push([membership(1,'left','member'),{update_id:2,message:{chat:group,from:owner,date,message_id:2,
        text:'@homer_bot '+groupText,entities:[{type:'mention',offset:0,length:10}]}}]);
      const queued=()=>f.app.inputs.list().find(row=>row.input.text===groupText);
      await until(()=>queued()?.state==='queued');
      if(mode!=='live removal'){
        holdPoll=true;
        const resumed=f.restart(app=>adapter.applyBindings(app.channels!));
        release();
        await resumed;
        await until(()=>firstPollTimeout.has(2));
        await f.app.idle();
        assert.equal(queued()?.state,'queued');
        assert.equal(firstPollTimeout.get(2),0);
      }
      if(mode==='offline on restart')failPoll=true;
      else{
        batches.push([membership(3,'member','left')]);
        const channels=new DatabaseSync(join(f.app.config.runtime,'channels.sqlite'),{readOnly:true});
        try{await until(()=>channels.prepare('SELECT active FROM telegram_groups WHERE chatId=?').get(group.id)?.active===0);}
        finally{channels.close();}
      }
      release();
      await local;
      await until(()=>queued()?.state!=='queued'&&queued()?.state!=='processing');
      assert.equal(queued()?.state,'failed');
      assert.deepEqual(f.inputs,['Hold the main Agent']);
      assert.equal(await f.app.message('Local input still runs'),'Synthetic reply');
    }finally{release();await f.close();}
  });
});

test('an unfinished catch-up cannot extend the life of a Telegram group grant',async t=>{
  const start=1_800_000_000_000,day=86_400_000;
  t.mock.timers.enable({apis:['Date'],now:start});
  const adapter=new TelegramChannel([A],async()=>{throw Error('unexpected_live_request');});
  const f=fixture();
  const plugin=new ChannelPlugin(f.app,[adapter]);
  try{
    adapter.applyBindings(plugin);
    const channels=new DatabaseSync(join(f.app.config.runtime,'channels.sqlite'),{readOnly:true});
    let binding:string;
    try{binding=String(channels.prepare('SELECT id FROM channel_bindings').get()!.id);}
    finally{channels.close();}
    const groups=plugin.telegramGroups();
    const oldChat=-101,freshChat=-102;
    groups.polled(binding);
    groups.membership(binding,oldChat,true,start/1000,1);
    groups.caughtUp(binding);
    t.mock.timers.tick(day-30_000);
    groups.polled(binding,true);
    groups.membership(binding,freshChat,true,Date.now()/1000,2);
    // The process did not reach the end of the remaining updates before the retention window passed.
    t.mock.timers.tick(60_000);
    groups.polled(binding);
    assert.equal(groups.changeId(binding,oldChat,Date.now()/1000,3),undefined);
    assert.equal(groups.changeId(binding,freshChat,Date.now()/1000,3),2);
  }finally{await plugin.close();await f.close();}
});

test('Telegram group background reaches the main Agent without becoming a stored user message',async()=>{
  const group={id:-100001,type:'supergroup'},other={id:-100002,type:'supergroup'};
  const owner={id:A.userId,is_bot:false},bot={id:101,is_bot:true};
  const batches:unknown[][]=[],reads:number[]=[],sent:any[]=[];
  const http:typeof fetch=async(url,init)=>{
    if(String(url).endsWith('/getMe'))return ok({...bot,username:'homer_bot',can_read_all_group_messages:true});
    if(String(url).endsWith('/getUpdates')){
      if(!batches.length)await wait(8,undefined,{signal:init?.signal??undefined});
      return ok(batches.shift()??[]);
    }
    assert.ok(String(url).endsWith('/sendMessage'));
    sent.push(JSON.parse(String(init?.body)));
    return ok({message_id:101,chat:group,from:bot});
  };
  const adapter=new TelegramChannel([A],http,()=>({close:async()=>{},read:async(chatId,id)=>{
    assert.equal(chatId,group.id);
    reads.push(id);
    return id===2?{id:2,replyTo:1,text:'older parent'}:id===1?{id:1,text:'older root'}:undefined;
  }}));
  const f=fixture([adapter]);
  try{
    adapter.applyBindings(f.app.channels!);
    await f.app.start();
    const date=Math.ceil(Date.now()/1000);
    const message=(id:number,text:string,extra:object={})=>({update_id:id,message:{
      chat:group,from:owner,date,message_id:id,text,...extra,
    }});
    const mentions=[{type:'mention',offset:0,length:10}];
    batches.push([{update_id:1,my_chat_member:{chat:group,from:owner,date,
      old_chat_member:{user:bot,status:'left'},new_chat_member:{user:bot,status:'member'}}},
      ...Array.from({length:10},(_,index)=>message(index+3,`window ${index+3}`)),
      message(13,'overlap',{reply_to_message:{message_id:2,text:'older parent',from:owner}}),
      message(14,'other topic',{is_topic_message:true,message_thread_id:42}),
      message(15,'@homer_bot not authorized',{chat:other,entities:mentions,reply_to_message:{message_id:2}}),
      message(16,'@homer_bot actual request',{entities:mentions,reply_to_message:{message_id:13,text:'overlap',from:owner}})]);
    await until(()=>sent.length===1);
    assert.deepEqual(reads,[2,1]);
    assert.equal(f.inputs.length,1);
    const modelInput=f.inputs[0]!;
    assert.match(modelInput,/^::message-source\{source=telegram\}/);
    assert.equal(modelInput.match(/overlap/g)?.length,1);
    assert.match(modelInput,/older root.*older parent.*window 4.*overlap/s);
    assert.doesNotMatch(modelInput,/window 3\b|other topic|not authorized/);
    assert.equal(sent[0].reply_parameters.message_id,16);
    assert.deepEqual(f.app.store.db.prepare("SELECT text FROM conversation_messages WHERE role='user'").all().map(row=>row.text),['actual request']);

    batches.push([message(102,'direct follow-up',{reply_to_message:{message_id:101,text:'Synthetic reply',from:bot}})]);
    await until(()=>sent.length===2);
    assert.deepEqual(reads,[2,1,101]);
    assert.match(f.inputs[1]!,/Synthetic reply.*\[群成员本次请求\]\ndirect follow-up/s);
    assert.equal(sent[1].reply_parameters.message_id,102);
  }finally{await f.close();}
});

test('configured Telegram bots route replies and subscriptions through the Homer host',async()=>{
  const adapters:ChannelAdapter[]=[];
  const f=fixture(adapters);
  const runtime=f.app.config.runtime;
  const file=join(f.app.config.workspace,'report.md');
  writeFileSync(file,'# Telegram fixture');
  const sent:{bot:number;chatId:string;method:string;text?:string;filename?:string}[]=[];
  const polled=new Set<number>();
  let usernameA: string | undefined='homer_work_bot';
  let usernameB: string | undefined='homer_personal_bot';
  const batches=new Map<number,{update_id:number;message:object}[]>([[101,[]],[102,[]]]);
  const inbound=(bot:number,id:number,text:string,from?:number,date=Math.ceil(Date.now()/1000)+1)=>{
    const chat=bot===101?A:B;
    batches.get(bot)!.push({update_id:id,message:{message_id:id,date,text,
      from:{id:from??chat.userId,is_bot:false},chat:{id:chat.chatId,type:'private'}}});
  };
  const http:typeof fetch=async(url,init)=>{
    const match=String(url).match(/^https:\/\/api\.telegram\.org\/bot(101|102):synthetic-bot-token-[AB]\/([A-Za-z]+)$/);
    assert.ok(match);
    const bot=Number(match[1]),method=match[2]!;
    const chat=bot===101?A:B;
    assert.equal(init?.redirect,'error');
    if(method==='getMe')return ok({id:bot,is_bot:true,username:bot===101?usernameA:usernameB});
    if(method==='getUpdates'){
      polled.add(bot);
      const {offset}=JSON.parse(String(init?.body));
      const batch=batches.get(bot)!;
      while(batch[0]&&batch[0].update_id<(offset??0))batch.shift();
      if(!batch.length)await wait(8,undefined,{signal:init?.signal??undefined});
      return ok(batch);
    }
    if(method==='sendDocument'){
      assert.ok(init?.body instanceof FormData);
      const document=init.body.get('document');
      assert.ok(document instanceof File);
      sent.push({bot,chatId:String(init.body.get('chat_id')),method,text:await document.text(),filename:document.name});
    }else{
      assert.equal(method,'sendMessage');
      const data=JSON.parse(String(init?.body));
      sent.push({bot,chatId:data.chat_id,method,text:data.text});
    }
    return ok({message_id:sent.length,chat:{id:chat.chatId},from:{id:bot}});
  };
  const configure=async(bots:unknown)=>{
    polled.clear();
    const path=join(runtime,'telegram.json');
    if(bots===undefined)rmSync(path);
    else writeFileSync(path,JSON.stringify(bots),{mode:0o600});
    const adapter=telegramChannel(runtime,http);
    assert.ok(adapter);
    adapters.splice(0,adapters.length,adapter);
    await f.restart(app=>adapter.applyBindings(app.channels!));
  };
  let taskId='',workerId='',subscribed=false,background=0;
  try{
    f.app.webHistoryPages();
    const schema=()=>f.app.store.db.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY name').all();
    const before=schema();
    if(process.platform==='win32')secureWindowsDirectory(runtime);
    assert.equal(telegramChannel(runtime,http),undefined);
    f.setScript(async(main,input)=>{
      const text=input.replace(/^::message-source\{source=telegram\}\n\n/,'');
      if(text==='delegate')({taskId,workerId}=await main.call('worker_open',{message:'Prepare a test report'}));
      else if(text==='subscribe'){
        const name='set_notification_destination',itemId='telegram-subscribe',args={taskId};
        main.emit('hostMcpToolStarted',{threadId:main.threadId,turnId:main.turnId,itemId,tool:name,arguments:args});
        const receipt=await new Promise<string>((resolve,reject)=>{
          const argv=main.options.interactionMcp!.args;
          const socket=createConnection(argv[argv.indexOf('main')-1]!);
          let data='';
          socket.setTimeout(2000,()=>socket.destroy(Error('test_mcp_timeout')));
          socket.on('error',reject).on('data',chunk=>data+=chunk).on('end',()=>resolve(data));
          socket.on('connect',()=>socket.write(JSON.stringify({tool:name,arguments:args,
            meta:{callId:itemId,'x-codex-turn-metadata':{turn_id:main.turnId}}})+'\n'));
        });
        subscribed=JSON.parse(receipt).result?.state==='active';
      }else if(text==='continue')await main.call('worker_send',{workerId,message:'Report back'});
      else if(text.startsWith('[内部协作输入')){
        if(++background>1)await main.call('send_user_message',{text:'Background report',attachments:[{path:file}]});
        return {status:'completed',text:''};
      }
      return {status:'completed',text:'Reply to '+text};
    });
    const finishWorker=async()=>{
      await until(()=>f.engines.some(engine=>engine.finish));
      const worker=f.engines.findLast(engine=>engine.finish)!;
      const finish=worker.finish!;worker.finish=undefined;
      finish({status:'completed',text:'Worker test output'});
      await f.app.idle();
    };
    await configure([A]);
    inbound(101,1,'old',undefined,1);
    inbound(101,2,'forged',B.userId);
    inbound(101,3,'delegate');
    await finishWorker();
    inbound(101,4,'subscribe');
    await until(()=>subscribed);
    inbound(101,5,'continue');
    await finishWorker();
    await until(()=>sent.some(item=>item.method==='sendDocument'));
    assert.deepEqual([...polled],[101]);
    assert.deepEqual(sent.find(item=>item.method==='sendDocument'),
      {bot:101,chatId:String(A.chatId),method:'sendDocument',text:'# Telegram fixture',filename:'report.md'});

    await configure([A,B]);
    inbound(101,6,'hello A');
    inbound(102,6,'hello B');
    await until(()=>sent.filter(item=>item.text?.startsWith('Reply to hello')).length===2);
    const history=()=>f.app.webHistoryPages().read(f.app.store.meta('mainThread')!).messages;
    const helloA=history().find(message=>message.role==='user'&&message.text==='hello A')!;
    const helloB=history().find(message=>message.role==='user'&&message.text==='hello B')!;
    assert.deepEqual(helloA.channelSource,{source:'telegram',entryLabel:'homer_work_bot'});
    assert.deepEqual(helloB.channelSource,{source:'telegram',entryLabel:'homer_personal_bot'});
    assert.ok(f.inputs.includes(`::message-source{source=telegram}\n\nhello A`));
    assert.ok(f.inputs.includes(`::message-source{source=telegram}\n\nhello B`));
    const lock=new DatabaseSync(join(runtime,'channels.sqlite'));
    try{
      lock.exec('BEGIN EXCLUSIVE');
      const message=history().find(message=>message.id===helloA.id);
      assert.equal(message?.text,'hello A');
      assert.equal(message?.channelSource,undefined);
    }finally{lock.close();}
    assert.deepEqual(history().find(message=>message.id===helloA.id)?.channelSource,helloA.channelSource);
    const spoof=`::message-source{source=telegram}\n\nPage user text`;
    await f.app.message(spoof,'page-source-fixture');
    const pageMessage=history().find(message=>message.role==='user'&&message.requestId==='page-source-fixture')!;
    assert.equal(pageMessage.text,spoof);
    assert.equal(pageMessage.channelSource,undefined);
    assert.equal(f.inputs.at(-1),spoof);
    assert.deepEqual(sent.filter(item=>item.text?.startsWith('Reply to hello')).map(item=>[item.bot,item.chatId,item.text]).sort(),
      [[101,String(A.chatId),'Reply to hello A'],[102,String(B.chatId),'Reply to hello B']]);
    await configure([B]);
    inbound(101,7,'unbound');
    inbound(102,7,'after restart');
    await until(()=>sent.some(item=>item.text==='Reply to after restart'));
    assert.deepEqual([...polled],[102]);
    assert.deepEqual(history().find(message=>message.id===helloA.id)?.channelSource,{source:'telegram',entryLabel:'101'});
    assert.equal(f.app.channels!.readMessageSources([helloA.requestId!],true).has(helloA.requestId!),false);
    assert.ok(!f.inputs.some(text=>['old','forged','unbound'].some(rejected=>text===rejected||text.endsWith('\n\n'+rejected))));
    const db=new DatabaseSync(join(runtime,'channels.sqlite'),{readOnly:true});
    try{
      assert.deepEqual(db.prepare('SELECT accountKey,revokedAt IS NULL AS active FROM channel_bindings ORDER BY rowid').all()
        .map(row=>[row.accountKey,row.active]),[['101',0],['102',1]]);
    }finally{db.close();}
    await configure(undefined);
    assert.deepEqual([...polled],[]);
    await configure([B]);
    await until(()=>polled.has(102));
    const rebound=new DatabaseSync(join(runtime,'channels.sqlite'),{readOnly:true});
    try{
      assert.deepEqual(rebound.prepare('SELECT accountKey,revokedAt IS NULL AS active FROM channel_bindings ORDER BY rowid').all()
        .map(row=>[row.accountKey,row.active]),[['101',0],['102',0],['102',1]]);
    }finally{rebound.close();}
    assert.deepEqual(schema(),before);
    usernameA=usernameB='duplicate_bot';
    await configure([A,B]);
    await until(()=>polled.size===2);
    assert.deepEqual([helloA,helloB].map(original=>history().find(message=>message.id===original.id)?.channelSource),
      [{source:'telegram',entryLabel:'101'},{source:'telegram',entryLabel:'102'}]);
    usernameB=undefined;
    await configure([B]);
    await until(()=>polled.has(102));
    assert.deepEqual(history().find(message=>message.id===helloB.id)?.channelSource,{source:'telegram',entryLabel:'102'});
  }finally{await f.close();}
});

test('an invalid optional Telegram history config preserves Bot API messaging',async t=>{
  const f=fixture();
  const warning=t.mock.method(console,'warn',()=>{});
  try{
    const runtime=f.app.config.runtime;
    if(process.platform==='win32')secureWindowsDirectory(runtime);
    writeFileSync(join(runtime,'telegram.json'),JSON.stringify([A]),{mode:0o600});
    writeFileSync(join(runtime,'telegram-mtproto.json'),JSON.stringify({api_id:1,api_hash:'invalid synthetic value'}),{mode:0o600});
    const adapter=telegramChannel(runtime,async()=>ok({message_id:1,chat:{id:A.chatId},from:{id:101}}));
    const packet={address:{adapterId:'telegram',accountKey:'101',senderKey:String(A.userId),conversationKey:String(A.chatId)},
      messageId:'test',attemptId:'test',part:{kind:'text' as const,text:'fixture'}};
    assert.deepEqual(await adapter!.send(packet,new AbortController().signal),{state:'sent',receipt:'1'});
    assert.deepEqual(warning.mock.calls.map(call=>call.arguments),[['telegram_mtproto_config_unavailable']]);
  }finally{await f.close();}
});

test('Telegram config protects secrets and delivery distinguishes rejection from unknown',async()=>{
  const f=fixture();
  try{
    const path=join(f.app.config.runtime,'telegram.json');
    assert.equal(existsSync(path),false);
    if(process.platform==='win32')secureWindowsDirectory(f.app.config.runtime);
    writeFileSync(path,JSON.stringify([A]),{mode:0o600});
    if(process.platform!=='win32'){
      chmodSync(path,0o644);
      assert.throws(()=>telegramChannel(f.app.config.runtime),/telegram_config_permissions/);
      rmSync(path);
      const target=join(f.app.config.runtime,'secret-fixture.json');
      writeFileSync(target,JSON.stringify([A]),{mode:0o600});
      symlinkSync(target,path);
      assert.throws(()=>telegramChannel(f.app.config.runtime),/telegram_config_(permissions|unreadable)/);
    }
    let attempt=0;
    const adapter=new TelegramChannel([A],async url=>{
      if(++attempt===1)return Response.json({ok:false,error_code:403},{status:403});
      throw Error(String(url));
    });
    const packet={address:{adapterId:'telegram',accountKey:'101',senderKey:String(A.userId),conversationKey:String(A.chatId)},
      messageId:'test',attemptId:'test',part:{kind:'text' as const,text:'fixture'}};
    const signal=new AbortController().signal;
    assert.deepEqual(await adapter.send(packet,signal),{state:'failed'});
    assert.deepEqual(await adapter.send(packet,signal),{state:'unknown'});
    assert.deepEqual(await adapter.send({...packet,address:{...packet.address,conversationKey:'999'}},signal),{state:'failed'});
    assert.equal(attempt,2);
    const methods:string[]=[];
    const wrongBot=new TelegramChannel([A],async url=>{
      methods.push(new URL(String(url)).pathname.split('/').at(-1)!);
      return ok({id:102,is_bot:true});
    });
    await assert.rejects(wrongBot.connect(packet.address,()=>{throw Error('unexpected_input');},signal,0),/telegram_bot_identity_invalid/);
    assert.deepEqual(methods,['getMe']);
  }finally{await f.close();}
});
