import {openTaskWorker} from './fixtures/open-task-worker.js';
import assert from 'node:assert/strict';
import {chmodSync,existsSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {createConnection} from 'node:net';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {setTimeout as wait} from 'node:timers/promises';
import test from 'node:test';
import {pathToFileURL} from 'node:url';
import {ChannelPlugin,type ChannelAdapter} from '../src/channel-plugin.js';
import {telegramChannel,TelegramChannel} from '../src/telegram-channel.js';
import {fixture,until} from './fixtures/worker-chat-host.js';
import {secureWindowsDirectory} from '../scripts/windows-security.mjs';

const A={token:'101:synthetic-bot-token-A',chatId:4_260_000_001,userId:4_260_000_001};
const B={token:'102:synthetic-bot-token-B',chatId:4_260_000_002,userId:4_260_000_002};
const ok=(result:unknown)=>Response.json({ok:true,result});
const addressA={adapterId:'telegram',accountKey:'101',senderKey:String(A.userId),conversationKey:String(A.chatId)};

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
    if(input.startsWith('😀'))await openTaskWorker(engine,'Prepare a team report');
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
  const report=`**[Background report](${pathToFileURL(file).href})**`;
  writeFileSync(file,'# Telegram fixture');
  const sent:{bot:number;chatId:string;method:string;text?:string;filename?:string;entities?:unknown}[]=[];
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
      sent.push({bot,chatId:data.chat_id,method,text:data.text,entities:data.entities});
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
      if(text==='delegate')({taskId,workerId}=await openTaskWorker(main,'Prepare a test report'));
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
      }else if(text==='continue')await main.call('worker_message',{workerId,message:'Report back'});
      else if(text.startsWith('[内部协作输入')){
        const final=++background>1?report:'Before subscription';
        return {status:'completed',text:final,messages:[{itemId:'final',phase:'final_answer',text:final}]};
      }
      return {status:'completed',text:'Reply to '+(text.startsWith('hello')?'*'+text+'*':text)};
    });
    const finishWorker=async()=>{
      await until(()=>f.engines.some(engine=>engine.finish));
      const worker=f.engines.findLast(engine=>engine.finish)!;
      const finish=worker.finish!;worker.finish=undefined;
      finish({status:'completed',text:report});
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
    const reportIndex=sent.findIndex(item=>item.method==='sendDocument');
    assert.deepEqual(sent[reportIndex-1],{bot:101,chatId:String(A.chatId),method:'sendMessage',text:'Background report',
      entities:[{type:'bold',offset:0,length:17}]});
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
    for(const item of sent.filter(item=>item.text?.startsWith('Reply to hello')))
      assert.deepEqual(item.entities,[{type:'italic',offset:9,length:7}]);
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

const markdownPacket={address:addressA,messageId:'test',attemptId:'test',
  part:{kind:'text' as const,text:'**fixture**'}};

test('Telegram sends rendered Markdown and UTF-16 entities in a single request',async()=>{
  const requests:{url:string;body:any}[]=[];
  const adapter=new TelegramChannel([A],async(url,init)=>{
    requests.push({url:String(url),body:JSON.parse(String(init?.body))});
    return ok({message_id:17,chat:{id:A.chatId},from:{id:101}});
  });
  const signal=new AbortController().signal;
  const send=async(text:string)=>{
    const before=requests.length;
    assert.deepEqual(await adapter.send({...markdownPacket,part:{kind:'text',text}},signal),{state:'sent',receipt:'17'});
    assert.equal(requests.length,before+1);
    const request=requests.at(-1)!;
    assert.match(request.url,/\/sendMessage$/);
    return request.body;
  };
  const body=await send([
    '# Heading',
    '😀 ***é 👩‍💻*** [**read** ][REF] **before `a<&` after** [read `code`](https://example.com/) <https://example.net/bare>',
    '```txt\n  code  \n  more  \n```',
    '[ref]: https://example.com/a?b=c&d=x\n[REF]: https://second.example/',
  ].join('\n\n'));
  assert.equal(body.text,'Heading\n\n😀 é 👩‍💻 read  before a<& after read code https://example.net/bare\n\n  code  \n  more  ');
  assert.deepEqual(body.entities,[
    {type:'bold',offset:0,length:7},
    {type:'bold',offset:12,length:8},
    {type:'italic',offset:12,length:8},
    {type:'bold',offset:21,length:4},
    {type:'text_link',offset:21,length:4,url:'https://example.com/a?b=c&d=x'},
    {type:'bold',offset:27,length:6},
    {type:'code',offset:34,length:3},
    {type:'bold',offset:37,length:6},
    {type:'code',offset:49,length:4},
    {type:'pre',offset:80,length:15},
  ]);
  assert.deepEqual(body.link_preview_options,{is_disabled:true});
  assert.ok(!('parse_mode' in body));

  const structures=await send([
    '> quoted **bold**  \n> next\n>\n> ```\n>   code\n> ```',
    '3. one\n   - **two**\n4. three',
    'A|B\n-| -\n$x^2$|![photo](https://image.example/secret)',
    '<i data-local="/tmp/hidden">inline</i>',
    '<div>hidden /home/me</div>',
    '**unclosed [markup',
  ].join('\n\n'));
  assert.equal(structures.text,'› quoted bold\n› next\n\n›   code\n\n3. one\n  • two\n4. three\n\nA ｜ B\nx^2 ｜ photo\n\ninline\n\nHTML 内容已省略\n\n**unclosed [markup');
  assert.deepEqual(structures.entities,[{type:'bold',offset:9,length:4},{type:'bold',offset:43,length:3}]);

  const paths=await send([
    '[label](file:///Users/A%20B/private) [relative](folder/private.txt) [folder/private.txt](folder/private.txt)',
    '[script](javascript:alert%281%29) [credential](https://alice:secret@example.com/private) [odd](https:///host)',
    'Read /Users/Jane Doe, then continue.',
    'Run cat /tmp/A(B)/name',
    'See ~/Private Folder',
    'Windows C:\\Users\\Test (Lab)\\file',
    'Share \\\\nas\\share\\Private Folder',
    '![Share \\\\nas\\share\\Private Folder](https://image.example/picture)',
    'Keep "/Users/Shared Folder" for later, and folder/private.txt.',
    '[Known](file:///Users/Jane) is a label. Read /Users/Jane Doe',
    '👩‍💻 **Check `/tmp/A(B)/name`**',
    '```sh\n  cat /tmp/Private Folder\n  echo ok\n```',
    'Math 1 / 2 and <https://example.com/api/path> stay.',
  ].join('\n\n'));
  assert.equal(paths.text,[
    'label relative 附件','script credential odd','Read 附件','Run cat 附件','See 附件','Windows 附件','Share 附件','Share 附件',
    'Keep "附件" for later, and 附件.','Known is a label. Read 附件','👩‍💻 Check 附件',
    '  cat 附件\n  echo ok','Math 1 / 2 and https://example.com/api/path stay.',
  ].join('\n\n'));
  assert.deepEqual(paths.entities,[
    {type:'bold',offset:paths.text.indexOf('Check'),length:5},
    {type:'code',offset:paths.text.indexOf('Check')+6,length:2},
    {type:'pre',offset:paths.text.indexOf('  cat'),length:'  cat 附件\n  echo ok'.length},
  ]);

  for(const input of [' \n\t','![ ](https://image.example/)','**/Users/**alice/**private**',
    'Read **/Users/Jane** Doe','Share **\\\\nas\\share** Private Folder']){
    const fallback=await send(input);
    assert.equal(fallback.text,'此回复没有可发送的正文。');
    assert.ok(!('entities' in fallback));
  }
});

test('Telegram selects the long text document before sending and uses the rendered safe text',async()=>{
  const requests:{url:string;body:RequestInit['body']}[]=[];
  const adapter=new TelegramChannel([A],async(url,init)=>{
    requests.push({url:String(url),body:init?.body});
    return ok({message_id:18,chat:{id:A.chatId},from:{id:101}});
  });
  const send=async(text:string)=>{
    const before=requests.length;
    assert.deepEqual(await adapter.send({...markdownPacket,part:{kind:'text',text}},new AbortController().signal),
      {state:'sent',receipt:'18'});
    assert.equal(requests.length,before+1);
    return requests.at(-1)!;
  };
  const edge='👩‍💻'+'字'.repeat(4091);
  const direct=await send(edge);
  assert.match(direct.url,/\/sendMessage$/);
  assert.equal(JSON.parse(String(direct.body)).text,edge);
  const document=async(input:string)=>{
    const request=await send(input);
    assert.match(request.url,/\/sendDocument$/);
    assert.ok(request.body instanceof FormData);
    assert.equal(request.body.get('chat_id'),String(A.chatId));
    const file=request.body.get('document');
    assert.ok(file instanceof File);
    assert.equal(file.name,'homer-reply.txt');
    assert.equal(file.type,'text/plain');
    return file.text();
  };
  assert.equal(await document(edge+'x'),edge+'x');
  const prefix='字'.repeat(3950);
  const formatted=prefix+[
    '**read** [guide](https://example.com/a) [https://example.com](https://example.com) /home/Private (Lab) Folder',
    '[unused]: https://example.com/'+('x'.repeat(200)),
  ].map(block=>'\n\n'+block).join('');
  assert.ok(formatted.length>4096);
  const safe=await document(formatted);
  assert.ok(safe.length<4096);
  assert.equal(safe,prefix+'\n\nread guide (https://example.com/a) https://example.com 附件');
  const numbered='1. q\n'.repeat(810).trimEnd();
  assert.ok(numbered.length<4096);
  const expanded=await document(numbered);
  assert.ok(expanded.length>4096);
  assert.equal(expanded,Array.from({length:810},(_,index)=>(index+1)+'. q').join('\n'));
});

test('Telegram advances attachments after the fallback receipt and pins an unknown formatted body across restart',async()=>{
  const messages:{method:string;text:string;entities?:unknown;filename?:string;mime?:string}[]=[];
  const telegram=new TelegramChannel([A],async(url,init)=>{
    const method=new URL(String(url)).pathname.split('/').at(-1)!;
    if(init?.body instanceof FormData){
      const file=init.body.get('document');
      assert.ok(file instanceof File);
      messages.push({method,text:await file.text(),filename:file.name,mime:file.type});
    }else{
      const {text,entities}=JSON.parse(String(init?.body));
      messages.push({method,text,entities});
      if(text.startsWith('Unknown'))return ok({message_id:3,chat:{id:B.chatId},from:{id:101}});
    }
    return ok({message_id:messages.length,chat:{id:A.chatId},from:{id:101}});
  });
  const f=fixture([{id:'telegram',send:telegram.send.bind(telegram)}]);
  try{
    const file=join(f.app.config.workspace,'report.txt');
    writeFileSync(file,'Original attachment 😀\n');
    f.setScript(async(_main,input)=>{
      const prefix=input.endsWith('unknown')?'**Unknown**':'**/Users/**alice/**private**';
      const text=prefix+'\n\n[Report]('+pathToFileURL(file).href+')';
      return {status:'completed',text,messages:[{itemId:'final',phase:'final_answer',text}]};
    });
    telegram.applyBindings(f.app.channels!);
    await f.app.start();
    const send=async(eventId:string)=>{
      f.app.channels!.receiveText({...addressA,eventId,text:eventId});
      await f.app.idle();
      await f.app.channels!.synchronize();
    };
    await send('fallback');
    await send('unknown');
    assert.deepEqual(messages,[
      {method:'sendMessage',text:'此回复没有可发送的正文。',entities:undefined},
      {method:'sendDocument',text:'Original attachment 😀\n',filename:'report.txt',mime:'text/plain'},
      {method:'sendMessage',text:'Unknown\n\nReport',entities:[{type:'bold',offset:0,length:7}]},
    ]);
    await f.restart(app=>telegram.applyBindings(app.channels!));
    await f.app.channels!.synchronize();
    assert.equal(messages.length,3);
    const db=new DatabaseSync(join(f.app.config.runtime,'channels.sqlite'),{readOnly:true});
    try{
      const row=db.prepare("SELECT nextPart,receipts FROM channel_outbox WHERE state='unknown'").get();
      assert.equal(row?.nextPart,0);
      assert.deepEqual(JSON.parse(String(row?.receipts)).map((receipt:{state:string})=>receipt.state),['unknown']);
    }finally{db.close();}
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
    const adapter=new TelegramChannel([A],async(url,init)=>{
      assert.match(String(url),/\/sendMessage$/);
      const body=JSON.parse(String(init?.body));
      assert.deepEqual(body.entities,[{type:'bold',offset:0,length:7}]);
      if(++attempt===1)return Response.json({ok:false,error_code:400},{status:400});
      if(attempt===2)return ok({message_id:1,chat:{id:B.chatId},from:{id:101}});
      await wait(1000,undefined,{signal:init?.signal??undefined});
      throw Error('expected_abort');
    });
    const packet=markdownPacket;
    const signal=new AbortController().signal;
    assert.deepEqual(await adapter.send(packet,signal),{state:'failed'});
    assert.deepEqual(await adapter.send(packet,signal),{state:'unknown'});
    assert.deepEqual(await adapter.send(packet,AbortSignal.timeout(10)),{state:'unknown'});
    assert.deepEqual(await adapter.send({...packet,address:{...packet.address,conversationKey:'999'}},signal),{state:'failed'});
    assert.equal(attempt,3);
    const methods:string[]=[];
    const wrongBot=new TelegramChannel([A],async url=>{
      methods.push(new URL(String(url)).pathname.split('/').at(-1)!);
      return ok({id:102,is_bot:true});
    });
    await assert.rejects(wrongBot.connect(packet.address,()=>{throw Error('unexpected_input');},signal,0),/telegram_bot_identity_invalid/);
    assert.deepEqual(methods,['getMe']);
  }finally{await f.close();}
});

test('private Telegram album preserves image bytes, captions, order and one turn across restart',async()=>{
  const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/e/0AAAAASUVORK5CYII=','base64');
  const batches:unknown[][]=[];
  const chat={id:A.chatId,type:'private'},from={id:A.userId,is_bot:false};
  const downloads:string[]=[],notices:string[]=[];
  let interruptSecond=true;
  const http:typeof fetch=async(url,init)=>{
    const path=String(url);
    if(path.endsWith('/getMe'))return ok({id:101,is_bot:true});
    if(path.endsWith('/getUpdates')){
      if(!batches.length)await wait(10,undefined,{signal:init?.signal??undefined});
      return ok(batches.shift()??[]);
    }
    if(path.endsWith('/getFile'))return ok({file_path:JSON.parse(String(init?.body)).file_id+'.png'});
    if(path.includes('/file/')){
      downloads.push(path.split('/').at(-1)!);
      if(path.endsWith('/second.png')&&interruptSecond)await wait(5000,undefined,{signal:init?.signal??undefined});
      return new Response(image);
    }
    assert.ok(path.endsWith('/sendMessage'));
    const text=JSON.parse(String(init?.body)).text;
    if(text.startsWith('相册可能不完整'))notices.push(text);
    return ok({message_id:999,chat,from:{id:101,is_bot:true}});
  };
  const adapter=new TelegramChannel([A],http,undefined,async()=>{});
  const f=fixture([adapter]);
  try{
    adapter.applyBindings(f.app.channels!);
    await f.app.start();
    const date=Math.ceil(Date.now()/1000);
    const message=(id:number,fields:object)=>({update_id:id,message:{chat,from,date,message_id:id,...fields}});
    const first=message(20,{media_group_id:'album',caption:'first',photo:[{file_id:'first',width:1,height:1}]});
    const second=message(22,{media_group_id:'album',document:{file_id:'second',file_name:'original.png',mime_type:'image/png'}});
    batches.push([first],[second,first,message(23,{text:'follow-up'})]);
    await until(()=>downloads.length===2);
    interruptSecond=false;
    await f.restart(app=>adapter.applyBindings(app.channels!));
    const users=()=>f.app.store.db.prepare("SELECT id,text FROM conversation_messages WHERE role='user' ORDER BY rowid").all();
    await until(()=>users().length===2);
    assert.deepEqual(users().map(row=>row.text),['first','follow-up']);
    const row=f.app.store.db.prepare('SELECT refsJson FROM conversation_attachments WHERE messageId=?').get(users()[0]!.id!);
    const refs=JSON.parse(String(row?.refsJson));
    assert.equal(refs.length,2);
    const original=f.app.readAttachment({messageId:String(users()[0]!.id),...refs[1]});
    assert.equal(original.filename,'original.png');
    assert.deepEqual(Buffer.from(original.data,'base64'),image);
    await f.restart(app=>adapter.applyBindings(app.channels!));
    batches.push([first,second,message(23,{text:'follow-up'})]);
    await until(()=>batches.length===0);
    await wait(30);
    assert.equal(users().length,2);
    assert.deepEqual(downloads,['first.png','second.png','second.png']);
    batches.push([message(24,{photo:[{file_id:'pure',width:1,height:1}]})]);
    await until(()=>users().length===3);
    assert.equal(users()[2]!.text,'');
    assert.equal(downloads.at(-1),'pure.png');
    const late=message(25,{media_group_id:'album',photo:[{file_id:'late',width:1,height:1}]});
    batches.push([late,late]);
    await until(()=>notices.length===1);
    await f.app.channels!.synchronize();
    assert.equal(notices.length,1);
    assert.equal(users().length,3);
    assert.ok(!downloads.includes('late.png'));
  }finally{await f.close();}
});

test('Telegram rejects a mixed album before downloading and keeps an uncertain notice across restart',async()=>{
  const batches:unknown[][]=[];
  const chat={id:A.chatId,type:'private'},from={id:A.userId,is_bot:false};
  const notices:string[]=[];
  let fileRequests=0;
  const http:typeof fetch=async(url,init)=>{
    const path=String(url);
    if(path.endsWith('/getMe'))return ok({id:101,is_bot:true});
    if(path.endsWith('/getUpdates')){
      if(!batches.length)await wait(10,undefined,{signal:init?.signal??undefined});
      return ok(batches.shift()??[]);
    }
    if(path.endsWith('/getFile')){
      fileRequests++;
      return ok({file_path:JSON.parse(String(init?.body)).file_id+'.png'});
    }
    if(path.endsWith('/good.png'))return new Response(Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/e/0AAAAASUVORK5CYII=','base64'));
    if(path.endsWith('/bad.png'))return new Response('invalid image');
    assert.ok(path.endsWith('/sendMessage'));
    const text=JSON.parse(String(init?.body)).text;
    if(text==='Synthetic reply')return ok({message_id:998,chat,from:{id:101,is_bot:true}});
    notices.push(text);
    throw Error('lost response');
  };
  const adapter=new TelegramChannel([A],http,undefined,async()=>{});
  const f=fixture([adapter]);
  try{
    adapter.applyBindings(f.app.channels!);
    await f.app.start();
    const date=Math.ceil(Date.now()/1000);
    const message=(id:number,fields:object)=>({update_id:id,message:{chat,from,date,message_id:id,...fields}});
    const album=[message(30,{media_group_id:'album',caption:'do not queue this',photo:[{file_id:'picture',width:1,height:1}]}),
      message(31,{media_group_id:'album',video:{file_id:'unsupported'}})];
    const stranger=message(29,{photo:[{file_id:'foreign',width:1,height:1}],from:{id:7,is_bot:false}});
    batches.push([stranger,...album,message(32,{text:'still works'})]);
    await until(()=>f.app.channels!.connectionStatus().some(binding=>binding.unknown===1));
    assert.equal(notices.length,1);
    assert.equal(fileRequests,0);
    assert.match(notices[0]!,/JPEG 或 PNG/);
    const users=()=>f.app.store.db.prepare("SELECT text FROM conversation_messages WHERE role='user'").all().map(row=>row.text);
    assert.deepEqual(users(),['still works']);
    await f.restart(app=>adapter.applyBindings(app.channels!));
    batches.push(album);
    await until(()=>batches.length===0);
    await f.app.channels!.synchronize();
    assert.equal(notices.length,1);
    assert.deepEqual(users(),['still works']);

    batches.push([message(33,{media_group_id:'corrupt-album',photo:[{file_id:'good',width:1,height:1}]}),
      message(34,{media_group_id:'corrupt-album',photo:[{file_id:'bad',width:1,height:1}]})]);
    await until(()=>f.app.channels!.connectionStatus().some(binding=>binding.unknown===2));
    assert.equal(fileRequests,2);
    assert.deepEqual(users(),['still works']);
    const asset=f.app.store.db.prepare('SELECT state FROM media_assets').all();
    assert.deepEqual(asset.map(row=>row.state),['deleted']);
  }finally{await f.close();}
});
