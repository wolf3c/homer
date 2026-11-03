import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WechatApi, WechatError, parseWechatJson, wechatUrl } from '../src/channels/wechat-api.js';
test('QR starts with fixed official POST and never transmits saved tokens', async () => {
  const api = new WechatApi(async (url, init) => {
    assert.equal(String(url), 'https://ilinkai.weixin.qq.com/ilink/bot/get_bot_qrcode?bot_type=3');
    assert.equal(init?.method, 'POST');
    assert.deepEqual(JSON.parse(String(init?.body)), {local_token_list:[]});
    assert.equal(new Headers(init?.headers).has('Authorization'), false);
    return Response.json({qrcode:'fixture',qrcode_img_content:'https://ilinkai.weixin.qq.com/qr/fixture'});
  });
  assert.equal((await api.beginQr()).qrcode, 'fixture');
});
test('uint64 IDs preserve exact value without rewriting text', () => {
  const parsed = parseWechatJson('{"message_id":18446744073709551615,"text":"message_id:123","nested":{"msg_id":42}}') as {message_id:string;text:string;nested:{msg_id:string}};
  assert.equal(parsed.message_id, '18446744073709551615');
  assert.equal(parsed.text, 'message_id:123');
  assert.equal(parsed.nested.msg_id, '42');
});
test('server URLs cannot redirect credentials to another origin family', () => {
  for (const url of ['http://ilinkai.weixin.qq.com','https://evil.test','https://weixin.qq.com.evil.test','https://a.weixin.qq.com:8443','https://user:pass@a.weixin.qq.com','https://127.0.0.1']) assert.throws(() => wechatUrl(url));
  assert.equal(wechatUrl('https://ilinkai.weixin.qq.com/').origin,'https://ilinkai.weixin.qq.com');
});

test('authenticated transport uses bot headers and preserves original context', async () => {
  const credential = {botToken:'synthetic-only-token',botId:'bot',ownerId:'owner',baseUrl:'https://ilinkai.weixin.qq.com',dataKey:'ab'.repeat(32)};
  const api = new WechatApi(async (_url, init) => {
    const headers = new Headers(init?.headers), body = JSON.parse(String(init?.body));
    assert.equal(headers.get('Authorization'),'Bearer synthetic-only-token');
    assert.equal(headers.get('AuthorizationType'),'ilink_bot_token');
    assert.equal(body.msg.context_token,'original-context');assert.equal(body.msg.to_user_id,'owner');
    assert.equal(body.base_info.bot_agent,'Homer/0.1.0');assert.equal(init?.redirect,'error');
    return Response.json({ret:0});
  });
  await api.send(credential,'owner','original-context','stable-client-id',{type:1,text_item:{text:'合成回复'}});
  await assert.rejects(api.send(credential,'stranger','context','id',{type:1}),/route_invalid/);
});
test('unconfirmed sends are uncertain and never retried by the transport', async () => {
  const credential = {botToken:'synthetic',botId:'bot',ownerId:'owner',baseUrl:'https://ilinkai.weixin.qq.com',dataKey:'ab'.repeat(32)};
  let calls=0;
  const api=new WechatApi(async()=>{calls++;throw new Error('fixture error containing synthetic secret');});
  await assert.rejects(api.send(credential,'owner','context','client',{type:1}),error=>{
    assert.ok(error instanceof Error);assert.equal(error.message,'wechat_send_uncertain');return true;
  });
  assert.equal(calls,1);
});
test('business invalidation and rejected sends use stable sanitized codes', async()=>{
  const credential = {botToken:'synthetic',botId:'bot',ownerId:'owner',baseUrl:'https://ilinkai.weixin.qq.com',dataKey:'ab'.repeat(32)};
  const invalid=new WechatApi(async()=>Response.json({ret:-14,errmsg:'synthetic private response'}));
  await assert.rejects(invalid.updates(credential,''),/wechat_credentials_invalid/);
  const rejected=new WechatApi(async()=>Response.json({ret:5,errmsg:'synthetic private response'}));
  await assert.rejects(rejected.send(credential,'owner','context','client',{type:1}),/wechat_api_rejected/);
});

const sendCredential = {botToken:'synthetic-only-token',botId:'bot',ownerId:'owner',baseUrl:'https://ilinkai.weixin.qq.com',dataKey:'ab'.repeat(32)};
test('send accepts explicit success or a lossless uint64 server receipt with omitted ret', async()=>{
  for (const raw of ['{"ret":0}', '{"message_id":"18446744073709551615"}', '{"message_id":18446744073709551615}', '{"message_id":"42","errcode":0}']) {
    let calls=0;
    const api=new WechatApi(async()=>{calls++;return new Response(raw);});
    await api.send(sendCredential,'owner','synthetic-context','stable-client',{type:1});
    assert.equal(calls,1);
  }
});
test('send keeps empty, malformed, lost and rejected receipts distinct without retry', async()=>{
  const cases: {raw?:string;status?:number;code:string;uncertain:boolean}[] = [
    ...['{}','null','[]','{','{"errcode":0}','{"message_id":""}','{"message_id":"opaque"}',
      '{"message_id":-1}','{"message_id":1.5}','{"message_id":1e20}',
      '{"message_id":"18446744073709551616"}','{"ret":"0","message_id":"42"}',
      '{"ret":null,"message_id":"42"}','{"ret":0,"errcode":"0"}',
      '{"ret":0,"message_id":{}}','{"ret":0,"message_id":-1}',
      '{"ret":0.5,"message_id":"42"}','{"ret":1e309,"message_id":"42"}',
      '{"ret":0,"errcode":1e309}'].map(raw=>({raw,code:'wechat_send_uncertain',uncertain:true})),
    {raw:'{"message_id":"42"}',status:500,code:'wechat_send_uncertain',uncertain:true},
    {code:'wechat_send_uncertain',uncertain:true},
    {raw:'{"ret":1,"message_id":"42","errmsg":"synthetic-private-body"}',code:'wechat_api_rejected',uncertain:false},
    {raw:'{"errcode":1,"message_id":"42"}',code:'wechat_api_rejected',uncertain:false},
    {raw:'{"ret":-14,"message_id":"42"}',code:'wechat_credentials_invalid',uncertain:false},
    {raw:'{"message_id":"42"}',status:403,code:'wechat_credentials_invalid',uncertain:false},
  ];
  for (const fixture of cases) {
    let calls=0;
    const api=new WechatApi(async()=>{
      calls++;
      if (fixture.raw===undefined) throw new Error('synthetic-only-token https://synthetic.invalid/?private=body');
      return new Response(fixture.raw,{status:fixture.status??200});
    });
    await assert.rejects(api.send(sendCredential,'owner','synthetic-context','stable-client',{type:1}),error=>{
      assert.ok(error instanceof WechatError);assert.equal(error.code,fixture.code);assert.equal(error.uncertain,fixture.uncertain);return true;
    });
    assert.equal(calls,1);
  }
});
test('send failure diagnostics expose only fixed stages and codes, and cannot change delivery outcome', async()=>{
  const cases = [
    {stage:'transport',code:'wechat_send_uncertain',uncertain:true,fetcher:async()=>{throw new Error('synthetic-private-transport https://synthetic.invalid/?token=secret');}},
    {stage:'http',code:'wechat_send_uncertain',uncertain:true,fetcher:async()=>new Response('synthetic-private-body',{status:500})},
    {stage:'response',code:'wechat_send_uncertain',uncertain:true,fetcher:async()=>new Response('synthetic-private-body')},
    {stage:'response',code:'wechat_send_uncertain',uncertain:true,fetcher:async()=>new Response(new ReadableStream({start(controller){controller.error(new Error('synthetic-private-stream'));}}))},
    {stage:'api',code:'wechat_api_rejected',uncertain:false,fetcher:async()=>Response.json({ret:1,errmsg:'synthetic-private-body'})},
    {stage:'receipt',code:'wechat_send_uncertain',uncertain:true,fetcher:async()=>Response.json({})},
  ];
  for (const fixture of cases) {
    const diagnostics:unknown[]=[];
    const api=new WechatApi(fixture.fetcher,diagnostic=>diagnostics.push(diagnostic));
    await assert.rejects(api.send(sendCredential,'owner','synthetic-private-context','synthetic-private-client',{type:1,text_item:{text:'synthetic-private-text'}}),error=>{
      assert.ok(error instanceof WechatError);assert.equal(error.code,fixture.code);assert.equal(error.uncertain,fixture.uncertain);
      assert.equal(error.stage,fixture.stage);return true;
    });
    assert.deepEqual(diagnostics,[{event:'wechat_send_failure',stage:fixture.stage,code:fixture.code,uncertain:fixture.uncertain}]);
  }
  const brokenSink=new WechatApi(async()=>Response.json({}),()=>{throw new Error('synthetic diagnostic sink failed');});
  await assert.rejects(brokenSink.send(sendCredential,'owner','context','client',{type:1}),/wechat_send_uncertain/);
  const diagnostics:unknown[]=[];
  const successful=new WechatApi(async()=>Response.json({message_id:'42'}),diagnostic=>diagnostics.push(diagnostic));
  await successful.send(sendCredential,'owner','context','client',{type:1});
  assert.deepEqual(diagnostics,[]);
});
