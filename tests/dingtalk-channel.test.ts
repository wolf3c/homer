import assert from 'node:assert/strict';
import {once} from 'node:events';
import {chmodSync,existsSync,linkSync,mkdtempSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test,type TestContext} from 'node:test';
import {setTimeout as wait} from 'node:timers/promises';
import WebSocket,{WebSocketServer} from 'ws';
import {DesktopChannels} from '../src/desktop-channels.js';
import type {ChannelAddress,ChannelPacket,ChannelPlugin} from '../src/channel-plugin.js';
import {DingtalkChannel,pairDingtalkBot,readDingtalkAccounts,writeDingtalkAccounts} from '../src/dingtalk-channel.js';
import {secureWindowsDirectory} from '../scripts/windows-security.mjs';

const credentials={appKey:'dingExampleFixture',appSecret:'synthetic-dingtalk-secret'};
const account={...credentials,accountKey:'dt-AAAAAAAAAAAAAAAAAAAAAA',corpId:'org',userId:'staff',conversationId:'cid'};
const address={adapterId:'dingtalk',accountKey:account.accountKey,senderKey:'staff',conversationKey:'cid'};
const topic='/v1.0/im/bot/messages/get';
const gateway=()=>Response.json({endpoint:'wss://wss-open-connection.dingtalk.com/connect',ticket:'fixture-ticket'});
const token=()=>Response.json({accessToken:'fixture-token',expireIn:7200});
const inbound=(text:string,overrides:object={})=>JSON.stringify({type:'CALLBACK',headers:{topic,messageId:'wire'},data:JSON.stringify({
  robotCode:credentials.appKey,conversationType:'1',senderCorpId:'org',chatbotCorpId:'org',senderStaffId:'staff',
  conversationId:'cid',msgtype:'text',msgId:'message',createAt:Date.now(),text:{content:text},...overrides,
})});

async function fixture(t:TestContext){
  const runtime=mkdtempSync(join(tmpdir(),'homer-dingtalk-'));
  if(process.platform==='win32')secureWindowsDirectory(runtime);
  const server=new WebSocketServer({host:'127.0.0.1',port:0});
  await once(server,'listening');
  t.after(async()=>{
    for(const client of server.clients)client.terminate();
    await new Promise<void>(resolve=>server.close(()=>resolve()));
    rmSync(runtime,{force:true,recursive:true});
  });
  const socket=(_url:URL)=>{
    const endpoint=server.address();
    assert(endpoint&&typeof endpoint==='object');
    return new WebSocket('ws://127.0.0.1:'+endpoint.port);
  };
  return {runtime,server,socket};
}
async function until(predicate:()=>boolean){
  for(let i=0;i<200&&!predicate();i++)await wait(10);
  assert(predicate());
}
async function frame(client:WebSocket,message:string){
  const ack=once(client,'message');
  client.send(message);
  assert.equal(JSON.parse(String((await ack)[0])).code,200);
}

test('desktop pairs only the current same-organization DM, stages it, and rotates credentials without another Stream', {timeout:10000},async t=>{
  const {runtime,server,socket}=await fixture(t);
  const channels=new DesktopChannels(runtime,async url=>String(url).endsWith('/accessToken')?token():gateway(),socket);
  t.after(()=>channels.cancel());
  const connection=once(server,'connection');
  const id=channels.start('dingtalk',undefined,undefined,credentials);
  const [client]=await connection as [WebSocket];
  await until(()=>channels.snapshot().flow?.phase==='pair');
  const command=channels.snapshot().flow!.command!;
  await frame(client,inbound(command,{conversationType:'2'}));
  await frame(client,inbound(command,{senderCorpId:'other'}));
  await frame(client,inbound(command,{robotCode:'different-app'}));
  assert.equal(channels.snapshot().flow?.phase,'pair');
  const closed=once(client,'close');
  await frame(client,inbound(command,{senderStaffId:'1234'}));
  await closed;
  await until(()=>channels.snapshot().flow?.phase==='confirm');
  const view=JSON.stringify(channels.snapshot());
  assert(!view.includes(credentials.appSecret)&&!view.includes(credentials.appKey)&&!view.includes('"cid"'));
  assert.equal(channels.snapshot().flow?.peer,'••••');
  assert.equal(existsSync(join(runtime,'dingtalk.json')),false);
  channels.confirm(id);
  assert.equal(existsSync(join(runtime,'dingtalk.json')),false);
  assert.equal(channels.apply().failed.length,0);
  const [saved]=readDingtalkAccounts(runtime);
  assert.match(saved!.accountKey,/^dt-/);
  assert.equal(saved!.userId,'1234');
  assert.equal(saved!.conversationId,'cid');
  const newSecret='synthetic-rotated-secret';
  const renewed=channels.start('dingtalk',saved!.accountKey,undefined,{...credentials,appSecret:newSecret});
  await until(()=>channels.snapshot().flow?.phase==='confirm');
  assert.equal(server.clients.size,0);
  channels.confirm(renewed);
  channels.apply();
  assert.deepEqual(readDingtalkAccounts(runtime),[{...saved,appSecret:newSecret}]);
});

test('explicitly rejected credentials do not open a pairing Stream',async t=>{
  const {runtime}=await fixture(t);
  let sockets=0;
  const channels=new DesktopChannels(runtime,async()=>Response.json({code:'invalidClientIdOrSecret'},{status:400}),
    ()=>{sockets++;throw Error('unexpected stream');});
  t.after(()=>channels.cancel());
  channels.start('dingtalk',undefined,undefined,credentials);
  await until(()=>channels.snapshot().flow?.phase==='error');
  assert.equal(channels.snapshot().flow?.error,'dingtalk_credentials_invalid');
  assert.equal(sockets,0);
  assert.deepEqual(channels.snapshot().pending,[]);
});

test('cancelled and expired pairing close the connection and leave no staged binding', {timeout:10000},async t=>{
  const {runtime,server,socket}=await fixture(t);
  const channels=new DesktopChannels(runtime,async url=>String(url).endsWith('/accessToken')?token():gateway(),socket);
  t.after(()=>channels.cancel());
  const connection=once(server,'connection');
  const id=channels.start('dingtalk',undefined,undefined,credentials);
  const [client]=await connection as [WebSocket];
  await until(()=>channels.snapshot().flow?.phase==='pair');
  const closed=once(client,'close');
  channels.cancel(id);
  await closed;
  assert.equal(channels.snapshot().flow,undefined);
  assert.equal(channels.snapshot().pending.length,0);
  assert.deepEqual(readDingtalkAccounts(runtime),[]);
  const connected=once(server,'connection');
  const pairing=pairDingtalkBot(credentials,'expires',AbortSignal.timeout(250),()=>{},async()=>gateway(),socket);
  const expired=assert.rejects(pairing,{name:'TimeoutError'});
  const [expiring]=await connected as [WebSocket];
  await Promise.all([once(expiring,'close'),expired]);
});

function applyBindings(adapter:DingtalkChannel){
  const configured:ChannelAddress[]=[];
  adapter.applyBindings({configureBindings(_id:string,addresses:readonly ChannelAddress[]){
    configured.push(...addresses);
  }} as ChannelPlugin);
  return configured;
}

test('credential config is private and refuses shared files',async t=>{
  const {runtime}=await fixture(t);
  const path=join(runtime,'dingtalk.json');
  writeDingtalkAccounts(runtime,[account]);
  assert.deepEqual(readDingtalkAccounts(runtime),[account]);
  if(process.platform!=='win32'){
    assert.equal(statSync(path).mode&0o777,0o600);
    chmodSync(path,0o640);
    assert.throws(()=>readDingtalkAccounts(runtime),/dingtalk_config_permissions/);
    chmodSync(path,0o600);
  }
  linkSync(path,join(runtime,'shared-config'));
  assert.throws(()=>readDingtalkAccounts(runtime),/dingtalk_config_permissions/);
});

test('configuration is read at apply time so an intervening unbind cannot restore an old address',async t=>{
  const {runtime}=await fixture(t);
  writeDingtalkAccounts(runtime,[account]);
  const adapter=new DingtalkChannel(runtime);
  writeDingtalkAccounts(runtime,[]);
  assert.deepEqual(applyBindings(adapter),[]);
});

test('Stream ACK follows durable handoff, filters old and foreign messages, reconnects, and stops on abort', {timeout:10000},async t=>{
  const {runtime,server,socket}=await fixture(t);
  writeDingtalkAccounts(runtime,[account]);
  const adapter=new DingtalkChannel(runtime,async()=>gateway(),socket);
  assert.deepEqual(applyBindings(adapter),[address]);
  const ctl=new AbortController();
  t.after(()=>ctl.abort());
  const boundAt=Date.now();
  const connection=once(server,'connection');
  const received:unknown[]=[];
  const running=adapter.connect(address,event=>{if(event.text==='failed commit')throw Error('fixture storage failure');received.push(event);return 'request-id';},ctl.signal,boundAt);
  const [client]=await connection as [WebSocket];
  await frame(client,inbound('old',{createAt:boundAt-1}));
  await frame(client,inbound('wrong',{senderStaffId:'other'}));
  await frame(client,inbound('wrong',{senderCorpId:'other',chatbotCorpId:'other'}));
  await frame(client,inbound('wrong',{conversationId:'other'}));
  assert.deepEqual(received,[]);
  await frame(client,inbound('hello'));
  assert.deepEqual(received,[{eventId:'message',senderKey:'staff',conversationKey:'cid',text:'hello'}]);
  const reconnected=once(server,'connection');
  let falseAck=false;
  client.on('message',()=>{falseAck=true;});
  const lost=once(client,'close');
  client.send(inbound('failed commit'));
  await lost;
  assert.equal(falseAck,false);
  const [replacement]=await reconnected as [WebSocket];
  const closed=once(replacement,'close');
  ctl.abort();
  await running;
  await closed;
});

test('text and file route to one bound employee and separate refusal from an ambiguous send', {timeout:10000},async t=>{
  const {runtime}=await fixture(t);
  const second={...account,accountKey:'dt-BBBBBBBBBBBBBBBBBBBBBB',appKey:'dingSecondFixture',appSecret:'second-synthetic-secret',userId:'second',conversationId:'second-cid'};
  writeDingtalkAccounts(runtime,[account,second]);
  const calls:Record<string,unknown>[]=[];
  let outcome:'ok'|'refused'|'ambiguous'='ok';
  const adapter=new DingtalkChannel(runtime,async (url,init)=>{
    const path=new URL(String(url)).pathname;
    if(path==='/v1.0/oauth2/accessToken'){
      const app=JSON.parse(String(init?.body));
      return Response.json({accessToken:app.appKey+'-token',expireIn:7200});
    }
    if(path==='/gettoken')return Response.json({errcode:0,access_token:'legacy',expires_in:7200});
    if(path==='/media/upload'){
      const part=(init?.body as FormData).get('media') as File;
      assert.deepEqual(Buffer.from(await part.arrayBuffer()),Buffer.from([1,2,255]));
      return Response.json({errcode:0,media_id:'@fixture-file'});
    }
    assert.equal(path,'/v1.0/robot/oToMessages/batchSend');
    const payload=JSON.parse(String(init?.body));
    calls.push(payload);
    assert.equal(new Headers(init?.headers).get('x-acs-dingtalk-access-token'),payload.robotCode+'-token');
    if(outcome==='ambiguous')throw Error('connection lost');
    return Response.json(outcome==='refused'?{invalidStaffIdList:payload.userIds}:{processQueryKey:'receipt'});
  },()=>{throw Error('outbox must not open Stream');});
  assert.equal(applyBindings(adapter).length,2);
  const send=(part:ChannelPacket['part'],target:ChannelAddress=address)=>adapter.send({address:target,messageId:'m',attemptId:'a',part},new AbortController().signal);
  assert.deepEqual(await send({kind:'text',text:'hello'}),{state:'sent',receipt:'receipt'});
  const file={kind:'attachment',filename:'trial.txt',data:'AQL/',mime:'text/plain'} as ChannelPacket['part'];
  assert.equal((await send(file)).state,'sent');
  assert.deepEqual(JSON.parse(String(calls[1]!.msgParam)),{mediaId:'@fixture-file',fileName:'trial.txt',fileType:'txt'});
  assert.deepEqual(calls[1]!.userIds,['staff']);
  assert.equal((await send({kind:'text',text:'other'},{...address,accountKey:second.accountKey,senderKey:'second',conversationKey:'second-cid'})).state,'sent');
  assert.deepEqual(calls[2]!.userIds,['second']);
  assert.equal(calls[2]!.robotCode,second.appKey);
  assert.equal((await send({kind:'text',text:'wrong'},{...address,senderKey:'second'})).state,'failed');
  outcome='refused';
  assert.equal((await send({kind:'text',text:'refused'})).state,'failed');
  outcome='ambiguous';
  assert.equal((await send({kind:'text',text:'unknown'})).state,'unknown');
  assert.equal(calls.length,5);
});
