import {test} from "node:test";
import assert from "node:assert/strict";
import {createDecipheriv,createHash} from "node:crypto";
import {WechatApi,type WechatCredential} from "../src/channels/wechat-api.js";
const credential:WechatCredential={botToken:"synthetic-token",botId:"bot",ownerId:"owner",baseUrl:"https://ilinkai.weixin.qq.com",dataKey:"ab".repeat(32)};
test("Markdown delivery encrypts bytes and builds a file the official client can decode",async()=>{
  const content="# 合成成果\n\n手机验收样本 😀", filename="手机成果.md";
  let key:Buffer|undefined, encrypted:Buffer|undefined, calls=0;
  const api=new WechatApi(async(url,init)=>{
    calls++;
    if(String(url).includes("getuploadurl")){
      const data=JSON.parse(String(init?.body));
      assert.equal(data.media_type,3);assert.equal(data.to_user_id,"owner");assert.equal(data.rawsize,Buffer.byteLength(content));
      assert.equal(data.rawfilemd5,createHash("md5").update(content).digest("hex"));assert.equal(data.no_need_thumb,true);
      key=Buffer.from(data.aeskey,"hex");assert.equal(key.length,16);
      return Response.json({upload_full_url:"https://novac2c.cdn.weixin.qq.com/c2c/upload?fixture=synthetic"});
    }
    assert.equal(new Headers(init?.headers).has("Authorization"),false);assert.equal(init?.method,"POST");
    encrypted=Buffer.from(init?.body as Uint8Array);assert.notEqual(encrypted.toString("utf8"),content);
    return new Response("",{status:200,headers:{"x-encrypted-param":"synthetic-download-param"}});
  });
  const item=await api.uploadMarkdown(credential,filename,content);
  assert.equal(calls,2);assert.equal(item.type,4);assert.equal(item.file_item!.file_name,filename);assert.equal(item.file_item!.len,String(Buffer.byteLength(content)));
  const media=item.file_item!.media;assert.equal(media.encrypt_query_param,"synthetic-download-param");assert.equal(media.encrypt_type,1);
  const decoded=Buffer.from(Buffer.from(media.aes_key,"base64").toString("utf8"),"hex");assert.deepEqual(decoded,key);
  const decipher=createDecipheriv("aes-128-ecb",decoded,null);
  assert.equal(Buffer.concat([decipher.update(encrypted!),decipher.final()]).toString("utf8"),content);
});
test("upload fallback uses encoded CDN parameters without an auth header",async()=>{
  let calls=0;
  const api=new WechatApi(async(url,init)=>{
    if(++calls===1)return Response.json({upload_param:"a+/=& synthetic"});
    const parsed=new URL(String(url));assert.equal(parsed.searchParams.get("encrypted_query_param"),"a+/=& synthetic");
    assert.equal(parsed.origin,"https://novac2c.cdn.weixin.qq.com");assert.equal(new Headers(init?.headers).has("Authorization"),false);
    return new Response("",{status:200,headers:{"x-encrypted-param":"synthetic"}});
  });
  await api.uploadMarkdown(credential,"成果.md","合成内容");
});
test("existing Files boundary remains Markdown-only and 128 KiB; upload needs confirmed encrypted param",async()=>{
  let calls=0;
  const api=new WechatApi(async()=>{calls++;return Response.json({upload_param:"synthetic"});});
  for(const [name,content] of [["../secret.md","text"],["arbitrary.pdf","text"],["large.md","x".repeat(128*1024+1)],["empty.md",""]])
    await assert.rejects(api.uploadMarkdown(credential,name!,content!),/artifact_denied/);
  assert.equal(calls,0);
  await assert.rejects(api.uploadMarkdown(credential,"合成.md","合成成果"),/upload_unconfirmed/);
});
