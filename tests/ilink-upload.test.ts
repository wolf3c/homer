import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDecipheriv,createHash} from 'node:crypto';
import {WechatApi,type WechatCredential} from '../src/channels/wechat-api.js';
const credential:WechatCredential={botToken:'synthetic',botId:'bot',ownerId:'owner',baseUrl:'https://ilinkai.weixin.qq.com',dataKey:Buffer.alloc(32).toString('base64')};
test('ILINK-OUT-01 native image upload uses distinct upload enum, encrypted bytes and actual receipt',async()=>{
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');let intent:any;
 const api=new WechatApi(async(url,init)=>{
  if(String(url).includes('getuploadurl')){intent=JSON.parse(String(init?.body));return Response.json({ret:0,upload_param:'synthetic-param'});}
  const key=Buffer.from(intent.aeskey,'hex'),d=createDecipheriv('aes-128-ecb',key,null),bytes=Buffer.concat([d.update(Buffer.from(init!.body as Uint8Array)),d.final()]);assert.deepEqual(bytes,png);assert.equal(intent.rawfilemd5,createHash('md5').update(png).digest('hex'));
  return new Response('',{headers:{'x-encrypted-param':'uploaded-param'}});
 });
 const result=await api.uploadMedia(credential,'sample.png',png,'image');assert.equal(intent.media_type,1);assert.equal(result.type,2);assert.equal(result.image_item?.mid_size,intent.filesize);assert.equal(result.image_item?.hd_size,undefined);assert.equal(result.image_item?.media?.encrypt_query_param,'uploaded-param');
});
test('ILINK-OUT-02 failed upload cannot manufacture send receipt or accept non-CDN redirect',async()=>{
 const api=new WechatApi(async()=>Response.json({upload_full_url:'https://127.0.0.1/private'}));
 await assert.rejects(api.uploadMedia(credential,'sample.pdf',Buffer.from('%PDF-1.4'),'file'),/wechat_url_denied/);
});

test('ILINK-OUT-03 unsupported native voice is rejected before any upload or network effect',async()=>{
 let calls=0;const api=new WechatApi(async()=>{calls++;return Response.json({ret:0,upload_param:'synthetic'});});
 const wav=Buffer.concat([Buffer.from('RIFF'),Buffer.alloc(4),Buffer.from('WAVE'),Buffer.alloc(64)]);
 await assert.rejects(api.uploadMedia(credential,'sample.wav',wav,'voice'),/wechat_voice_encoding_unsupported/);assert.equal(calls,0);
});
test('ILINK-OUT-05 combination keeps order, scoped quote and rejects unsupported directions before network',async()=>{
 let body:any,calls=0;const api=new WechatApi(async(_url,init)=>{calls++;body=JSON.parse(String(init?.body));return Response.json({message_id:'18446744073709551615'});});
 await api.sendItems(credential,'owner','context','stable',[{type:1,text_item:{text:'说明'},ref_msg:{svr_id:'9007199254740993'}},{type:2,image_item:{media:{encrypt_query_param:'uploaded',aes_key:Buffer.alloc(16).toString('base64')}}}]);
 assert.deepEqual(body.msg.item_list.map((i:any)=>i.type),[1,2]);assert.equal(body.msg.item_list[0].ref_msg.svr_id,'9007199254740993');
 for(const items of [[],[{type:99}],[{type:2,text_item:{text:'forged'}}]])await assert.rejects(api.sendItems(credential,'owner','context','bad',items),/wechat_outgoing_item_invalid/);
 assert.equal(calls,1);
});

test('ILINK-OUT-06 paired thumbnail uploads encrypt both payloads and use the returned thumbnail receipt',async()=>{
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
 let intent:any;const uploaded:string[]=[];
 const api=new WechatApi(async(url,init)=>{
  if(String(url).includes('getuploadurl')){
   intent=JSON.parse(String(init?.body));assert.equal(intent.no_need_thumb,false);
   assert.equal(intent.thumb_rawsize,png.length);assert.equal(intent.thumb_rawfilemd5,createHash('md5').update(png).digest('hex'));
   return Response.json({upload_param:'original',thumb_upload_param:'thumbnail'});
  }
  const param=new URL(String(url)).searchParams.get('encrypted_query_param')!;uploaded.push(param);
  const d=createDecipheriv('aes-128-ecb',Buffer.from(intent.aeskey,'hex'),null);
  assert.deepEqual(Buffer.concat([d.update(Buffer.from(init!.body as Uint8Array)),d.final()]),png);
  assert.equal(Buffer.from(init!.body as Uint8Array).length,param==='thumbnail'?intent.thumb_filesize:intent.filesize);
  return new Response('',{headers:{'x-encrypted-param':'download-'+param}});
 });
 const result=await api.uploadMedia(credential,'paired.png',png,'image',undefined,{bytes:png,width:1,height:1});
 assert.deepEqual(uploaded,['original','thumbnail']);assert.equal(result.image_item?.thumb_media?.encrypt_query_param,'download-thumbnail');assert.equal(result.image_item?.thumb_size,intent.thumb_filesize);assert.equal(result.image_item?.thumb_width,1);
});

test('ILINK-OUT-07 missing thumbnail permission fails before CDN upload, and thumb failures never become a send',async()=>{
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
 let calls=0;const api=new WechatApi(async()=>{calls++;return Response.json({upload_param:'original'});});
 await assert.rejects(api.uploadMedia(credential,'paired.png',png,'image',undefined,{bytes:png,width:1,height:1}),/wechat_thumbnail_upload_unavailable/);
 assert.equal(calls,1);
 await assert.rejects(api.uploadMedia(credential,'bad.png',png,'image',undefined,{bytes:png,width:2,height:1}),/wechat_thumbnail_invalid/);assert.equal(calls,1);
 const stages:string[]=[];const failing=new WechatApi(async(url)=>{
  if(String(url).includes('getuploadurl'))return Response.json({upload_param:'original',thumb_upload_param:'thumbnail'});
  const stage=new URL(String(url)).searchParams.get('encrypted_query_param')!;stages.push(stage);
  return stage==='thumbnail'?new Response('',{status:503}):new Response('',{headers:{'x-encrypted-param':'download-original'}});
 });
 await assert.rejects(failing.uploadMedia(credential,'paired.png',png,'image',undefined,{bytes:png,width:1,height:1}),/wechat_upload_unconfirmed/);assert.deepEqual(stages,['original','thumbnail']);
});
