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
  const channels=new DesktopChannels(runtime,http);
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
    assert.equal(view.pending.length,0);
    assert.equal(JSON.stringify(view).includes(token),false);
    channels.confirm(view.flow!.id);
    assert.equal(channels.snapshot().pending.length,1);
    const path=join(runtime,'telegram.json');
    assert.equal(existsSync(path),false);
    const release=acquireLock(runtime);
    try{assert.throws(()=>channels.apply(),/runtime_already_open/);}finally{release();}
    assert.equal(existsSync(path),false);
    assert.deepEqual(channels.apply().saved,['Telegram@'+'example_bot']);
    assert.equal(channels.snapshot().pending.length,0);
    assert.equal(existsSync(path),true);
  }finally{channels.cancel();rmSync(runtime,{recursive:true,force:true});}
});

test('failed channel writes retain staged changes and never repeat an already committed write',async()=>{
  const runtime=mkdtempSync(join(tmpdir(),'homer-desktop-channels-'));
  if(process.platform==='win32')secureWindowsDirectory(runtime);
  const {writeTelegramAccounts,readTelegramAccounts}=await import('../src/telegram-channel.js');
  const {bindWechat,readWechatAccounts}=await import('../src/wechat-channel.js');
  const telegram={token:'101:synthetic-bot-token-A',userId:42,chatId:42};
  const credential={botId:'bot-a',ownerId:'owner-a',botToken:'token-a',baseUrl:'https://ilinkai.weixin.qq.com'};
  const channels=new DesktopChannels(runtime);
  try{
    const key=bindWechat(runtime,credential);
    writeTelegramAccounts(runtime,[telegram]);
    channels.remove('wechat',key,key);
    channels.remove('telegram','101','example_bot');
    writeTelegramAccounts(runtime,[{...telegram,token:'101:synthetic-bot-token-replaced'}]);
    const first=channels.apply();
    assert.deepEqual(first,{saved:['微信@'+key],failed:['telegram']});
    assert.deepEqual(readWechatAccounts(runtime),[]);
    assert.equal(channels.snapshot().pending.length,1);
    assert.equal(readTelegramAccounts(runtime).length,1);
    const rebound=bindWechat(runtime,credential);
    assert.notEqual(rebound,key);
    writeTelegramAccounts(runtime,[telegram]);
    assert.deepEqual(channels.apply(),{saved:['Telegram@example_bot'],failed:[]});
    assert.equal(readWechatAccounts(runtime)[0]?.accountKey,rebound);
    assert.deepEqual(readTelegramAccounts(runtime),[]);
  }finally{rmSync(runtime,{recursive:true,force:true});}
});

test('closing a WeChat verification challenge discards its credentials and leaves the binding file absent',async()=>{
  const runtime=mkdtempSync(join(tmpdir(),'homer-desktop-channels-'));
  const http:typeof fetch=async url=>String(url).includes('get_bot_qrcode')?
    Response.json({ret:0,qrcode:'fixture',qrcode_img_content:'https://ilinkai.weixin.qq.com/fixture'}):
    Response.json({ret:0,status:'need_verifycode'});
  const channels=new DesktopChannels(runtime,http);
  try{
    const id=channels.start('wechat');
    for(let i=0;i<100&&channels.snapshot().flow?.phase!=='code';i++)await wait(20);
    assert.equal(channels.snapshot().flow?.phase,'code');
    assert.match(channels.snapshot().flow?.qr??'',/^data:image\/png;base64,/);
    channels.cancel(id);
    assert.throws(()=>channels.code(id,'123456'),/channel_code_invalid/);
    assert.deepEqual(channels.snapshot(),{pending:[],flow:undefined});
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
  const channels=new DesktopChannels(runtime,http);
  try{
    const key=bindWechat(runtime,account);
    const otherKey=bindWechat(runtime,{...account,botId:'bot-b',ownerId:'owner-b',botToken:'token-b'});
    channels.start('wechat',key);
    for(let i=0;i<100&&!channels.snapshot().pending.length;i++)await wait(20);
    assert.deepEqual(channels.snapshot().pending,[{channel:'wechat',key,label:key,kind:'renew'}]);
    const accounts=readWechatAccounts(runtime);
    writeWechatAccounts(runtime,accounts.map(row=>({...row,cursor:'latest-'+row.accountKey,
      contextToken:'context-'+row.accountKey,contextTime:100})));
    assert.deepEqual(channels.apply(),{saved:['微信@'+key],failed:[]});
    const [renewed,other]=readWechatAccounts(runtime);
    assert.equal(renewed?.accountKey,key);
    assert.equal(renewed?.botToken,'new-token');
    assert.equal(renewed?.cursor,'latest-'+key);
    assert.equal(other?.accountKey,otherKey);
    assert.equal(other?.contextToken,'context-'+otherKey);
    assert.equal(other?.cursor,'latest-'+otherKey);
  }finally{channels.cancel();rmSync(runtime,{recursive:true,force:true});}
});
