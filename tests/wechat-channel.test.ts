import assert from 'node:assert/strict';
import {createDecipheriv} from 'node:crypto';
import {mkdtempSync,rmSync,writeFileSync,statSync} from 'node:fs';
import {createConnection} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {setTimeout as wait} from 'node:timers/promises';
import test from 'node:test';
import {WechatChannel, authorizeWechat, bindWechat, unbindWechat, readWechatAccounts, wechatStatus} from '../src/wechat-channel.js';
import {secureWindowsDirectory} from '../scripts/windows-security.mjs';
import {fixture,until} from './fixtures/worker-chat-host.js';
import type {ChannelAdapter} from '../src/channel-plugin.js';

const A={botId:'bot-a',ownerId:'owner-a',botToken:'token-a',baseUrl:'https://ilinkai.weixin.qq.com'};
const B={botId:'bot-b',ownerId:'owner-b',botToken:'token-b',baseUrl:A.baseUrl};
const ok=(body:object)=>Response.json({ret:0,...body});
const event=(from:typeof A,id:string,text:string,fields:object={})=>({
  message_id:id,from_user_id:from.ownerId,to_user_id:from.botId,message_type:1,
  create_time_ms:Date.now()+100,context_token:'ctx-'+id,item_list:[{type:1,text_item:{text}}],...fields
});

test('WeChat only saves confirmed local bindings and makes unbind and rebind a new identity',async()=>{
  const runtime=mkdtempSync(join(tmpdir(),'homer-wechat-config-'));
  try{
    if(process.platform==='win32')secureWindowsDirectory(runtime);
    let step=0,shown=false;
    const http:typeof fetch=async(url,init)=>{
      assert.equal(new URL(String(url)).origin,A.baseUrl);
      assert.equal(new Headers(init?.headers).has('authorization'),false);
      if(++step===1)return ok({qrcode:'synthetic',qrcode_img_content:A.baseUrl+'/synthetic'});
      return ok({status:'confirmed',ilink_bot_id:A.botId,ilink_user_id:A.ownerId,bot_token:A.botToken,baseurl:A.baseUrl});
    };
    const credential=await authorizeWechat({showQr(){shown=true;},verifyCode(){throw Error('unexpected');}},http);
    assert.equal(shown,true);
    assert.deepEqual(credential,A);
    const abort=new AbortController();abort.abort();
    await assert.rejects(authorizeWechat({showQr(){throw Error('unexpected');},verifyCode(){throw Error('unexpected');}},http,abort.signal),/Abort/);
    await assert.rejects(authorizeWechat({showQr(){},verifyCode(){throw Error('unexpected');}},async(url)=>String(url).includes('get_bot_qrcode')
      ?ok({qrcode:'synthetic',qrcode_img_content:A.baseUrl+'/synthetic'}):ok({status:'expired'})),/wechat_qr_expired/);
    await assert.rejects(authorizeWechat({showQr(){},verifyCode(){throw Error('unexpected');}},
      async()=>new Response('{"bot_token":"synthetic-secret", invalid}')), {message:'wechat_response_invalid'});
    assert.deepEqual(readWechatAccounts(runtime),[]);
    const first=bindWechat(runtime,credential);
    assert.equal(bindWechat(runtime,{...credential,botToken:'renewed'}),first);
    const second=bindWechat(runtime,B);
    assert.notEqual(first,second);
    assert.deepEqual(wechatStatus(runtime),[{accountKey:first,failed:0,unknown:0},{accountKey:second,failed:0,unknown:0}]);
    if(process.platform!=='win32')assert.equal(statSync(join(runtime,'wechat.json')).mode&0o777,0o600);
    unbindWechat(runtime,first);
    assert.notEqual(bindWechat(runtime,credential),first);
    assert.throws(()=>bindWechat(runtime,{...B,baseUrl:'https://untrusted.invalid'}),/wechat_url_denied/);
  }finally{rmSync(runtime,{recursive:true,force:true});}
});

test('WeChat resumes separate private routes, ignores replay and cannot send on a revoked binding',async()=>{
  const adapters:ChannelAdapter[]=[];
  const f=fixture(adapters);
  const runtime=f.app.config.runtime;
  const file=join(f.app.config.workspace,'wechat-report.txt');
  writeFileSync(file,'WeChat fixture report');
  const pushes=new Map([[A.botToken,[] as object[]],[B.botToken,[] as object[]]]);
  const sent:{token:string|null;to:string;context:string;text?:string;file?:string}[]=[];
  const cursors=new Map<string|null,string>();
  const http:typeof fetch=async(url,init)=>{
    if(new URL(String(url)).hostname==='novac2c.cdn.weixin.qq.com')
      return new Response(null,{headers:{'x-encrypted-param':'synthetic-download'}});
    const token=new Headers(init?.headers).get('authorization')?.slice(7)??null;
    const body=JSON.parse(String(init?.body));
    const queue=pushes.get(token!);assert.ok(queue);
    if(String(url).endsWith('/getupdates')){
      cursors.set(token,body.get_updates_buf);
      await wait(8,undefined,{signal:init?.signal??undefined});
      return ok({get_updates_buf:queue.length?'cursor-'+token:body.get_updates_buf,msgs:queue.splice(0)});
    }
    if(String(url).endsWith('/getuploadurl'))return ok({upload_param:'synthetic-upload'});
    const item=body.msg.item_list[0];
    sent.push({token,to:body.msg.to_user_id,context:body.msg.context_token,text:item.text_item?.text,file:item.file_item?.file_name});
    return ok({});
  };
  let adapter:WechatChannel;
  const restart=async()=>{
    adapter=new WechatChannel(runtime,http);
    adapters.splice(0,adapters.length,adapter);
    await f.restart(app=>adapter.applyBindings(app.channels!));
  };
  let taskId='',subscribed=false,deliver=false;
  f.setScript(async(main,input)=>{
    if(input.startsWith('[内部协作输入')){
      if(deliver)await main.call('send_user_message',{text:'Delayed report',attachments:[{path:file}]});
      return {status:'completed',text:''};
    }
    const text=input.replace(/^::message-source\{source=wechat\}\n\n/,'');
    if(text==='only A')({taskId}=await main.call('worker_open',{message:'Prepare the WeChat fixture'}));
    if(text==='only B'){
      const name='set_notification_destination',itemId='wechat-test-subscribe',args={taskId};
      main.emit('hostMcpToolStarted',{threadId:main.threadId,turnId:main.turnId,itemId,tool:name,arguments:args});
      const receipt=await new Promise<string>((resolve,reject)=>{
        const argv=main.options.interactionMcp!.args,socket=createConnection(argv[argv.indexOf('main')-1]!);
        let data='';
        socket.setTimeout(2000,()=>socket.destroy(Error('test_mcp_timeout')));
        socket.on('error',reject).on('data',chunk=>data+=chunk).on('end',()=>resolve(data));
        socket.on('connect',()=>socket.write(JSON.stringify({tool:name,arguments:args,
          meta:{callId:itemId,'x-codex-turn-metadata':{turn_id:main.turnId}}})+'\n'));
      });
      subscribed=JSON.parse(receipt).result?.state==='active';
    }
    if(text==='deliver')await main.call('worker_open',{taskId,message:'Publish the delayed report'});
    return {status:'completed',text:'Reply to '+text};
  });
  const finishWorker=async()=>{
    await until(()=>f.engines.some(engine=>engine.finish));
    const worker=f.engines.findLast(engine=>engine.finish)!;
    const finish=worker.finish!;worker.finish=undefined;
    finish({status:'completed',text:'Synthetic worker output'});
    await f.app.idle();
  };
  try{
    f.app.webHistoryPages();
    const schema=()=>f.app.store.db.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY name').all();
    const before=schema();
    if(process.platform==='win32')secureWindowsDirectory(runtime);
    const a=bindWechat(runtime,A),b=bindWechat(runtime,B);
    await restart();
    const one=event(A,'18446744073709551615','only A');
    pushes.get(A.botToken)!.push({...one,from_user_id:'stranger'},event(A,'2','old',{create_time_ms:1}),one,one);
    await until(()=>sent.length===1);
    await finishWorker();
    pushes.get(B.botToken)!.push(event(B,'3','only B'));
    await until(()=>sent.length===2);
    assert.equal(subscribed,true);
    assert.deepEqual(sent.map(({token,to,context})=>[token,to,context]).sort(),
      [[A.botToken,A.ownerId,'ctx-18446744073709551615'],[B.botToken,B.ownerId,'ctx-3']]);
    assert.equal(f.inputs.filter(text=>text.endsWith('\n\nonly A')).length,1);
    assert.ok(!f.inputs.some(text=>text.endsWith('\n\nold')));
    const channelSchema=()=>{
      const db=new DatabaseSync(join(runtime,'channels.sqlite'),{readOnly:true});
      try{return db.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY name').all();}
      finally{db.close();}
    };
    const beforeChannel=channelSchema();
    const history=f.app.webHistoryPages().read(f.app.store.meta('mainThread')!);
    assert.deepEqual(history.messages.filter(m=>m.role==='user'&&m.channelSource).map(m=>m.channelSource?.entryLabel).sort(),[a,b].sort());
    const contextBefore=readWechatAccounts(runtime).map(account=>account.contextToken);
    await f.app.close();
    unbindWechat(runtime,a);
    cursors.clear();
    await restart();
    await until(()=>cursors.has(B.botToken));
    assert.equal(cursors.has(A.botToken),false);
    assert.equal(cursors.get(B.botToken),'cursor-'+B.botToken);
    assert.equal(readWechatAccounts(runtime)[0]?.contextToken,contextBefore[1]);
    deliver=true;
    await f.app.message('deliver','wechat-fixture-deliver');
    await finishWorker();
    await until(()=>sent.length===4);
    assert.deepEqual(sent.slice(2).map(({token,to,context,text,file})=>[token,to,context,text??file]),[
      [B.botToken,B.ownerId,'ctx-3','Delayed report'],[B.botToken,B.ownerId,'ctx-3','wechat-report.txt']
    ]);
    pushes.get(B.botToken)!.push(event(B,'4','after restart'));
    await until(()=>sent.length===5);
    assert.equal(sent[4]?.context,'ctx-4');
    f.app.webHistoryPages();
    assert.deepEqual(schema(),before);
    assert.deepEqual(channelSchema(),beforeChannel);
  }finally{await f.close();}
});

test('WeChat backs off when a nonempty polling response does not advance its cursor',async()=>{
  const runtime=mkdtempSync(join(tmpdir(),'homer-wechat-poll-'));
  const abort=new AbortController();
  let connection:Promise<void>|undefined;
  try{
    if(process.platform==='win32')secureWindowsDirectory(runtime);
    const accountKey=bindWechat(runtime,A);
    let polls=0,received=0;
    const channel=new WechatChannel(runtime,async()=>{
      polls++;
      if(polls===2)abort.abort();
      return ok({msgs:[event(A,'1','repeat')]});
    });
    channel.applyBindings({configureBindings(){}} as never);
    connection=channel.connect({adapterId:'wechat',accountKey,senderKey:A.ownerId,conversationKey:A.ownerId},
      ()=>{received++;return 'request';},abort.signal,Date.now());
    await until(()=>received===1);
    await wait(50);
    assert.equal(polls,1);
  }finally{abort.abort();await connection;rmSync(runtime,{recursive:true,force:true});}
});

test('WeChat sends exact file bytes without credentials at the CDN and never retries an unknown send',async()=>{
  const runtime=mkdtempSync(join(tmpdir(),'homer-wechat-file-'));
  try{
    if(process.platform==='win32')secureWindowsDirectory(runtime);
    const accountKey=bindWechat(runtime,A);
    writeFileSync(join(runtime,'wechat.json'),JSON.stringify(readWechatAccounts(runtime).map(account=>({...account,contextToken:'private-context'}))));
    const bytes=Buffer.from('fixture\n');let aesKey:Buffer|undefined,calls=0,state='ok';
    const http:typeof fetch=async(url,init)=>{
      const u=new URL(String(url)),headers=new Headers(init?.headers);
      if(u.hostname==='novac2c.cdn.weixin.qq.com'){
        assert.equal(headers.has('authorization'),false);
        const decipher=createDecipheriv('aes-128-ecb',aesKey!,null);
        assert.deepEqual(Buffer.concat([decipher.update(init?.body as Buffer),decipher.final()]),bytes);
        return new Response(null,{headers:{'x-encrypted-param':'download'}});
      }
      const body=JSON.parse(String(init?.body));
      assert.equal(headers.get('authorization'),'Bearer '+A.botToken);
      if(u.pathname.endsWith('/getuploadurl')){
        aesKey=Buffer.from(body.aeskey,'hex');
        assert.equal(body.to_user_id,A.ownerId);return ok({upload_param:'upload'});
      }
      calls++;
      assert.equal(body.msg.to_user_id,A.ownerId);
      assert.equal(body.msg.context_token,'private-context');
      assert.equal(body.msg.item_list[0].file_item.file_name,'fixture.txt');
      if(state==='reject')return Response.json({ret:-2});
      if(state==='unknown')return new Response('{"ret":- 0}');
      return new Response('{"message_id":18446744073709551615}');
    };
    const channel=new WechatChannel(runtime,http);
    channel.applyBindings({configureBindings(){}} as never);
    const packet={address:{adapterId:'wechat',accountKey,senderKey:A.ownerId,conversationKey:A.ownerId},
      messageId:'msg',attemptId:'attempt',part:{kind:'attachment' as const,filename:'fixture.txt',mime:'text/plain',data:bytes.toString('base64'),sha256:'unused'}};
    const signal=new AbortController().signal;
    assert.deepEqual(await channel.send(packet,signal),{state:'sent',receipt:'18446744073709551615'});
    state='reject';assert.equal((await channel.send(packet,signal)).state,'failed');
    state='unknown';assert.equal((await channel.send(packet,signal)).state,'unknown');
    assert.equal(calls,3);
  }finally{rmSync(runtime,{recursive:true,force:true});}
});

test('an in-flight poll failure cannot clear a confirmed WeChat session expiry',async()=>{
  const runtime=mkdtempSync(join(tmpdir(),'homer-wechat-expiry-'));
  const abort=new AbortController();
  let connection:Promise<void>|undefined;
  try{
    if(process.platform==='win32')secureWindowsDirectory(runtime);
    const accountKey=bindWechat(runtime,A);
    writeFileSync(join(runtime,'wechat.json'),JSON.stringify(readWechatAccounts(runtime)
      .map(account=>({...account,contextToken:'fixture-context'}))));
    let failPoll!:()=>void;
    const pendingPoll=new Promise<Response>((_,reject)=>{failPoll=()=>reject(Error('network_failure'));});
    const address={adapterId:'wechat',accountKey,senderKey:A.ownerId,conversationKey:A.ownerId};
    let sends=0;
    const channel=new WechatChannel(runtime,async url=>{
      if(String(url).endsWith('/getupdates'))return pendingPoll;
      sends++;
      return Response.json({ret:-14});
    });
    channel.applyBindings({configureBindings(){}} as never);
    connection=channel.connect(address,()=>{throw Error('unexpected_message');},abort.signal,Date.now());
    const packet={address,messageId:'reply',attemptId:'attempt',part:{kind:'text' as const,text:'fixture'}};
    assert.deepEqual(await channel.send(packet,abort.signal),{state:'failed'});
    assert.equal(channel.connectionState(accountKey),'reauthorize');
    failPoll();
    await wait(0);
    assert.equal(channel.connectionState(accountKey),'reauthorize');
    assert.deepEqual(await channel.send(packet,abort.signal),{state:'failed'});
    assert.equal(sends,1);
  }finally{abort.abort();await connection;rmSync(runtime,{recursive:true,force:true});}
});
