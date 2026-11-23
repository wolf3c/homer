import assert from'node:assert/strict';
import test from'node:test';
import{writeFileSync,readFileSync,unlinkSync,rmSync}from'node:fs';
import{join,resolve}from'node:path';
import{createHash}from'node:crypto';
import{pathToFileURL}from'node:url';
import{execFileSync}from'node:child_process';
import{CodexEngine}from'../src/engine.js';
import{ffmpegPath}from'../src/media-decode.js';
import{createWebChat}from'../src/web-chat.js';
import{homerWebBridge}from'../src/web-homer.js';
import{fixture}from'./web-service-fixture.js';
import{until}from'./fixtures/worker-chat-host.js';

for(const mode of ['fixed','local-revoked','local-deleted','local-jpeg'] as const)test(`image source ${mode} preserves the right images and note in turn/start`,async()=>{
 const f=fixture(),threadId='synthetic-main',requestId='queued-annotation';
 const wire=new CodexEngine({...f.app.config,codexBin:resolve('tests/fixtures/mock-app-server.mjs'),model:'image-input-check'},
  {cwd:f.app.config.workspace,readRoots:[],instructions:'Synthetic Preview dispatch',tools:[]},async()=>({}));
 const jpeg=mode==='local-jpeg',filename=jpeg?'source.jpg':'source.png';
 // A 16×8 red/blue JPEG with EXIF orientation 6, stored in display order as 8×16.
 const data=jpeg?'/9j/4QAiRXhpZgAATU0AKgAAAAgAAQESAAMAAAABAAYAAAAAAAD//gAPTGF2YzYzLjEuMTAyAP/bAEMACAQEBAQEBQUFBQUFBgYGBgYGBgYGBgYGBgcHBwgICAcHBwYGBwcICAgICQkJCAgICAkJCgoKDAwLCw4ODhERFP/EAE4AAQEAAAAAAAAAAAAAAAAAAAAGAQEBAQEAAAAAAAAAAAAAAAAACAcGEAEAAAAAAAAAAAAAAAAAAAAAEQEAAAAAAAAAAAAAAAAAAAAA/8AAEQgACAAQAwESAAISAAMSAP/aAAwDAQACEQMRAD8AixyY38SAqsTWP//Z':
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY9sAAAAASUVORK5CYII=';
 try{
  await Promise.all([wire.start(),f.app.start()]);
  const bytes=Buffer.from(data,'base64'),path=join(f.base,'workspace',filename),destination=pathToFileURL(path).href;
  const source=mode==='fixed'?(await f.attach('preview-source',[{filename:'source.png',content:bytes}]))[0]!:
   {kind:'message-file' as const,messageId:'local-image',destination,title:filename,sha256:createHash('sha256').update(bytes).digest('hex')};
  if(mode!=='fixed'){
   writeFileSync(path,bytes);
   f.app.history.record(source.messageId,threadId,`[Local](${destination})`);
  }
  const upload=async(filename:string)=>{
   const {assetId,revision}=await f.app.uploadAttachment({threadId,requestId,uploadId:filename.replace('.', '-'),filename,data});
   return {assetId,revision};
  };
  const image=await upload(jpeg?'reference.jpg':'reference.png'),independent=await upload(jpeg?'independent.jpg':'independent.png');
  const engine=f.engines.find(candidate=>!candidate.worker)!;
  const hold=f.app.message('stream','hold-queue');
  void hold.catch(()=>{});
  await until(()=>!!engine.pending);
  const input={requestId,text:'Apply the note',attachments:[image,independent],resourceReference:{
   kind:'image' as const,source,image,width:jpeg?8:1,height:jpeg?16:1,
   annotations:[{id:'region',region:{x:0,y:0,width:1,height:1},comment:'Keep this user instruction'}],
  }};
  if(mode!=='fixed'){
   writeFileSync(path,Buffer.concat([bytes,Buffer.from([0])]));
   assert.throws(()=>f.app.submitMessage(input),/preview_source_mismatch/);
   unlinkSync(path);
   assert.throws(()=>f.app.submitMessage(input),/artifact_missing/);
   writeFileSync(path,bytes);
  }
  f.app.submitMessage(input);
  if(mode==='local-deleted')unlinkSync(path);
  else if(!jpeg)assert.equal(f.app.history.revokeMessage(threadId,source.messageId),true);
  engine.pending!({status:'completed',text:'Held request complete'});
  await hold;await f.app.idle();
  const sent=f.inputs.at(-1)!;
  const images=f.nativeImages.at(-1)!;
  assert.equal(images.length,mode==='local-deleted'||jpeg?2:1);
  const actual=JSON.parse((await wire.turn(sent,{images})).text);
  assert.equal(actual[0].type,'text');
  assert.match(actual[0].text,/Keep this user instruction/);
  if(mode==='local-deleted'||jpeg){
   assert.match(actual[0].text,/批注时所见/);
   assert.match(actual[0].text,new RegExp(`批注图片附件：${image.assetId}@${image.revision}`));
  }
  else{
   assert.match(actual[0].text,/来源不可用/);
   assert.doesNotMatch(actual[0].text,new RegExp(image.assetId+'|source\\.png'));
   assert.doesNotMatch(actual[0].text,/"region"/);
  }
  assert.match(actual[0].text,new RegExp(independent.assetId));
  assert.deepEqual(actual.slice(1),images.map(image=>{assert.ok('path' in image);return {type:'localImage',path:image.path};}));
  if(jpeg){
   const oriented=readFileSync(actual[1].path),original=readFileSync(actual[2].path);
   assert.equal(oriented.subarray(1,4).toString(),'PNG');
   assert.deepEqual([oriented.readUInt32BE(16),oriented.readUInt32BE(20)],[8,16]);
   assert.match(actual[0].text,/"region":\{"x":0,"y":0,"width":1,"height":1\}/);
   assert.ok(ffmpegPath);
   const rgb=execFileSync(ffmpegPath,['-v','error','-i','pipe:0','-f','rawvideo','-pix_fmt','rgb24','-threads','1','pipe:1'],{input:oriented});
   const top=0,bottom=8*15*3;
   assert.ok(rgb.readUInt8(top)>200&&rgb.readUInt8(top+2)<50);
   assert.ok(rgb.readUInt8(bottom)<50&&rgb.readUInt8(bottom+2)>200);
   assert.deepEqual(original,bytes);
  }
  const accepted=f.app.history.list(threadId).find(message=>message.role==='user'&&message.requestId===requestId);
  assert.deepEqual(accepted?.attachments,[image,independent]);
  if(mode==='local-deleted'){
   assert.ok(accepted);
   const deviceChat=createWebChat(homerWebBridge(f.app));
   const file=await deviceChat('media.read',{messageId:accepted.id,...image}) as {mime:string;data:string};
   assert.equal(file.mime,'image/png');
   assert.deepEqual(Buffer.from(file.data,'base64'),bytes);
   assert.deepEqual(accepted.resourceReference,input.resourceReference);
  }
 }finally{
  await Promise.all([f.app.close(),wire.close()]);
  rmSync(f.base,{recursive:true,force:true});
 }
});
