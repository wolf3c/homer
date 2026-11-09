import assert from 'node:assert/strict';
import {chmodSync,existsSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {createConnection} from 'node:net';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {setTimeout as wait} from 'node:timers/promises';
import test from 'node:test';
import type {ChannelAdapter} from '../src/channel-plugin.js';
import {telegramChannel,TelegramChannel} from '../src/telegram-channel.js';
import {fixture,until} from './fixtures/worker-chat-host.js';
import {secureWindowsDirectory} from '../scripts/windows-security.mjs';

const A={token:'101:synthetic-bot-token-A',chatId:4_260_000_001,userId:4_260_000_001};
const B={token:'102:synthetic-bot-token-B',chatId:4_260_000_002,userId:4_260_000_002};
const ok=(result:unknown)=>Response.json({ok:true,result});

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
