import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv } from 'node:crypto';
import { WechatApi } from '../src/channels/wechat-api.js';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY9sAAAAASUVORK5CYII=','base64');
test('ILINK-MEDIA-001: actual CDN decryption accepts both official keys, rejects padding and MIME spoofing',async()=>{
 const key=Buffer.alloc(16,7),c=createCipheriv('aes-128-ecb',key,null),bytes=Buffer.concat([c.update(png),c.final()]);
 const api=new WechatApi(async()=>new Response(bytes));
 for(const aes_key of [key.toString('base64'),Buffer.from(key.toString('hex')).toString('base64')]){
  const result=await api.download({type:2,image_item:{media:{encrypt_query_param:'synthetic',aes_key,encrypt_type:1}}});
  assert.deepEqual(result.bytes,png);assert.equal(result.mime,'image/png');
 }
 await assert.rejects(()=>api.download({type:2,image_item:{media:{encrypt_query_param:'x',aes_key:Buffer.alloc(16,3).toString('base64')}}}),/wechat_media_decrypt_failed/);
 await assert.rejects(()=>new WechatApi(async()=>new Response('<html>wrong</html>')).download({type:2,image_item:{media:{full_url:'https://novac2c.cdn.weixin.qq.com/x'}}}),/wechat_media_type_mismatch/);
});
test('ILINK-MEDIA-002: download refuses untrusted and credential URLs before network',async()=>{
 let calls=0;const api=new WechatApi(async()=>{calls++;return new Response(png);});
 for(const full_url of ['http://127.0.0.1/x','https://evil.example/a','https://user:pass@novac2c.cdn.weixin.qq.com/x'])
  await assert.rejects(()=>api.download({type:2,image_item:{media:{full_url}}}),/wechat_url_denied/);
 assert.equal(calls,0);
});
