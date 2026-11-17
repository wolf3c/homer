import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as wait} from 'node:timers/promises';
import test from 'node:test';
import {DesktopChannels} from '../src/desktop-channels.js';
import {acquireLock} from '../src/processes.js';
import {secureWindowsDirectory} from '../scripts/windows-security.mjs';

test('Telegram pairing requires explicit confirmation and applies only under the runtime lock',async()=>{
  const runtime=mkdtempSync(join(tmpdir(),'homer-desktop-channels-'));
  if(process.platform==='win32')secureWindowsDirectory(runtime);
  const token='101:synthetic-bot-token-A';
  let command='';
  const http:typeof fetch=async(url)=>{
    const method=String(url).split('/').at(-1);
    const update=(id:number,type:string,text:string)=>({update_id:id,message:{message_id:id,date:Math.ceil(Date.now()/1000),text,chat:{type,id:42},from:{id:42,is_bot:false,username:'tester'}}});
    const result=method==='getMe'?{id:101,is_bot:true,username:'example_bot'}:method==='getWebhookInfo'?{url:''}:
      [update(1,'group',command),update(2,'private','/start wrong'),update(3,'private',command)];
    return Response.json({ok:true,result});
  };
  const channels=new DesktopChannels(runtime,async(_channel,save)=>{save();},http);
  try{
    channels.start('telegram',undefined,token);
    for(let i=0;i<100;i++){
      const flow=channels.snapshot().flow;
      if(flow?.command)command=flow.command;
      if(flow?.phase==='confirm')break;
      await wait(20);
    }
    const view=channels.snapshot();
    assert.equal(view.flow?.phase,'confirm');
    assert.equal(view.flow?.peer,'@tester');
    assert.equal(view.busy,false);
    assert.equal(JSON.stringify(view).includes(token),false);
    const release=acquireLock(runtime);
    try{
      channels.confirm(view.flow!.id);
      assert.equal(channels.confirm(view.flow!.id),view.flow!.id);
      assert.equal(channels.snapshot().busy,true);
      for(let i=0;i<100&&channels.snapshot().busy;i++)await wait(5);
      assert.equal(channels.snapshot().result?.applied,true);
      assert.equal(existsSync(join(runtime,'telegram.json')),true);
      assert.throws(()=>acquireLock(runtime),/runtime_already_open/);
    }finally{release();}
  }finally{channels.cancel();rmSync(runtime,{recursive:true,force:true});}
});


test('a saved change retries adapter application without writing the configuration twice',async()=>{
 const runtime=mkdtempSync(join(tmpdir(),'homer-desktop-channels-'));
 const {bindWechat,readWechatAccounts}=await import('../src/wechat-channel.js');
 let attempts=0;
 const channels=new DesktopChannels(runtime,async(_channel,save)=>{save();if(++attempts===1)throw Error('synthetic_reload_failure');});
 try{
  const credential={botId:'bot-a',ownerId:'owner-a',botToken:'token-a',baseUrl:'https://ilinkai.weixin.qq.com'};
  const key=bindWechat(runtime,credential);
  channels.remove('wechat',key,key);
  for(let i=0;i<100&&channels.snapshot().busy;i++)await wait(5);
  assert.equal(channels.snapshot().result?.saved,true);
  assert.equal(channels.snapshot().result?.applied,false);
  const failed=channels.snapshot().result;
  assert.throws(()=>channels.start('wechat'),/channel_flow_busy/);
  assert.equal(channels.snapshot().result,failed);
  const savedFlow=channels.snapshot().flow?.id;
  channels.manage('cancel',{});
  assert.equal(channels.snapshot().flow?.id,savedFlow);
  const other=bindWechat(runtime,{...credential,botId:'bot-b',ownerId:'owner-b'});
  assert.equal(channels.state([]).bindings[0]?.state,'offline');
  channels.apply();
  for(let i=0;i<100&&channels.snapshot().busy;i++)await wait(5);
  assert.equal(channels.snapshot().result?.applied,true);
  assert.deepEqual(readWechatAccounts(runtime).map(account=>account.accountKey),[other]);
 }finally{await channels.close();rmSync(runtime,{recursive:true,force:true});}
});

test('closing a WeChat verification challenge discards its credentials and leaves the binding file absent',async()=>{
  const runtime=mkdtempSync(join(tmpdir(),'homer-desktop-channels-'));
  const http:typeof fetch=async url=>String(url).includes('get_bot_qrcode')?
    Response.json({ret:0,qrcode:'fixture',qrcode_img_content:'https://ilinkai.weixin.qq.com/fixture'}):
    Response.json({ret:0,status:'need_verifycode'});
  const channels=new DesktopChannels(runtime,async(_channel,save)=>{save();},http);
  try{
    const id=channels.start('wechat');
    for(let i=0;i<100&&channels.snapshot().flow?.phase!=='code';i++)await wait(20);
    assert.equal(channels.snapshot().flow?.phase,'code');
    assert.match(channels.snapshot().flow?.qr??'',/^data:image\/png;base64,/);
    channels.cancel(id);
    assert.throws(()=>channels.code(id,'123456'),/channel_code_invalid/);
    assert.equal(channels.snapshot().flow,undefined);assert.equal(channels.snapshot().busy,false);
    assert.equal(existsSync(join(runtime,'wechat.json')),false);
  }finally{channels.cancel();rmSync(runtime,{recursive:true,force:true});}
});

test('WeChat renewal keeps the original binding and latest cursor without overwriting another account',async()=>{
  const runtime=mkdtempSync(join(tmpdir(),'homer-desktop-channels-'));
  if(process.platform==='win32')secureWindowsDirectory(runtime);
  const {bindWechat,readWechatAccounts,writeWechatAccounts}=await import('../src/wechat-channel.js');
  const account={botId:'bot-a',ownerId:'owner-a',botToken:'token-a',baseUrl:'https://ilinkai.weixin.qq.com'};
  const http:typeof fetch=async url=>String(url).includes('get_bot_qrcode')?
    Response.json({ret:0,qrcode:'fixture',qrcode_img_content:account.baseUrl+'/fixture'}):
    Response.json({ret:0,status:'confirmed',ilink_bot_id:account.botId,ilink_user_id:account.ownerId,
      bot_token:'new-token',baseurl:account.baseUrl});
  let releaseSave!:()=>void;const saving=new Promise<void>(resolve=>{releaseSave=resolve;});
  const channels=new DesktopChannels(runtime,async(_channel,save)=>{await saving;save();},http);
  try{
    const key=bindWechat(runtime,account);
    const otherKey=bindWechat(runtime,{...account,botId:'bot-b',ownerId:'owner-b',botToken:'token-b'});
    channels.start('wechat',key);
    for(let i=0;i<100&&!channels.snapshot().busy;i++)await wait(5);
    assert.equal(channels.snapshot().flow?.phase,'applying');
    const accounts=readWechatAccounts(runtime);
    writeWechatAccounts(runtime,accounts.map(row=>({...row,cursor:'latest-'+row.accountKey,
      contextToken:'context-'+row.accountKey,contextTime:100})));
    releaseSave();
    for(let i=0;i<100&&channels.snapshot().busy;i++)await wait(5);
    assert.equal(channels.snapshot().result?.applied,true);
    const [renewed,other]=readWechatAccounts(runtime);
    assert.equal(renewed?.accountKey,key);
    assert.equal(renewed?.botToken,'new-token');
    assert.equal(renewed?.cursor,'latest-'+key);
    assert.equal(other?.accountKey,otherKey);
    assert.equal(other?.contextToken,'context-'+otherKey);
    assert.equal(other?.cursor,'latest-'+otherKey);
  }finally{channels.cancel();rmSync(runtime,{recursive:true,force:true});}
});

test('host channel actions expose correlated state and apply removals without a second apply command',async()=>{
 const runtime=mkdtempSync(join(tmpdir(),'homer-live-controller-'));
 const {bindWechat,readWechatAccounts}=await import('../src/wechat-channel.js');
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
 const channels=new DesktopChannels(runtime,async(_channel:string,save:()=>void)=>{await gate;save();});
 try{
  const key=bindWechat(runtime,{botId:'bot',ownerId:'owner',botToken:'synthetic',baseUrl:'https://ilinkai.weixin.qq.com'});
  const id=channels.manage('remove',{channel:'wechat',key,id:'remove-fixture'},[]);
  assert.equal(id,'remove-fixture');assert.equal(channels.snapshot().busy,true);
  assert.equal(readWechatAccounts(runtime).length,1);
  assert.throws(()=>channels.manage('remove',{channel:'wechat',key},[]),/channel_flow_busy/);
  channels.manage('cancel',{});assert.equal(channels.snapshot().busy,true);
  release();await channels.close();
  assert.equal(readWechatAccounts(runtime).length,0);
  assert.equal(channels.snapshot().result?.id,id);
  assert.equal(channels.snapshot().result?.applied,true);
 }finally{release();await channels.close();rmSync(runtime,{recursive:true,force:true});}
});

test('desktop can prepare every empty adapter before the first channel is bound',async()=>{
 const runtime=mkdtempSync(join(tmpdir(),'homer-empty-channels-'));
 try{
  const {telegramChannel}=await import('../src/telegram-channel.js');
  const {wechatChannel}=await import('../src/wechat-channel.js');
  const {dingtalkChannel}=await import('../src/dingtalk-channel.js');
  assert.equal(telegramChannel(runtime,undefined,true)?.id,'telegram');
  assert.equal(wechatChannel(runtime,true)?.id,'wechat');
  assert.equal(dingtalkChannel(runtime,true)?.id,'dingtalk');
  assert.equal(existsSync(join(runtime,'telegram.json')),false);
 }finally{rmSync(runtime,{recursive:true,force:true});}
});

for(const cancelled of [false,true])test('closing the host controller waits for authorization after explicit cancel: '+cancelled,async()=>{
 const runtime=mkdtempSync(join(tmpdir(),'homer-channel-close-'));let entered=false,release!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve;});
 const http:typeof fetch=async(_url,init)=>{entered=true;await new Promise<void>(resolve=>init?.signal?.addEventListener('abort',()=>resolve(),{once:true}));await gate;throw Error('aborted');};
 const channels=new DesktopChannels(runtime,async(_channel,save)=>{save();},http);
 try{
  const id=channels.start('wechat');for(let i=0;i<100&&!entered;i++)await wait(5);
  if(cancelled)channels.cancel(id);
  let closed=false;const closing=channels.close().then(()=>{closed=true;});
  await wait(5);assert.equal(closed,false);release();await closing;assert.equal(closed,true);
  assert.equal(existsSync(join(runtime,'wechat.json')),false);
 }finally{release();await channels.close();rmSync(runtime,{recursive:true,force:true});}
});

test('closing waits for every cancelled authorization run, including late failures',async()=>{
 const runtime=mkdtempSync(join(tmpdir(),'homer-channel-cancel-'));let entered=0,settled=0;
 const releases:Array<()=>void>=[],gates=Array.from({length:3},()=>new Promise<void>(resolve=>releases.push(resolve)));
 const http:typeof fetch=async(_url,init)=>{const index=entered++;await new Promise<void>(resolve=>init?.signal?.addEventListener('abort',()=>resolve(),{once:true}));await gates[index];settled++;throw Error('synthetic_cancelled_auth');};
 const channels=new DesktopChannels(runtime,async(_channel,save)=>save(),http);
 try{
  for(let index=0;index<3;index++){
   const id=channels.start('wechat');for(let n=0;n<100&&entered<=index;n++)await wait(5);assert.equal(entered,index+1);channels.cancel(id);
  }
  let closed=false;const closing=channels.close().then(()=>{closed=true;});await wait(5);assert.equal(closed,false);
  releases[2]!();await wait(5);assert.equal(settled,1);assert.equal(closed,false);
  releases[1]!();await wait(5);assert.equal(settled,2);assert.equal(closed,false);
  releases[0]!();await closing;assert.equal(settled,3);assert.equal(closed,true);
  assert.throws(()=>channels.start('wechat'),/desktop_channels_unavailable/);assert.equal(existsSync(join(runtime,'wechat.json')),false);
 }finally{for(const release of releases)release();await channels.close();rmSync(runtime,{recursive:true,force:true});}
});
