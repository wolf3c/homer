import test from 'node:test';
import assert from 'node:assert/strict';
import {toolImage,modelImage,mediaProcess,ffmpegPath} from '../src/media-decode.js';
import {interactionFixture} from './interaction-lifecycle-fixture.js';
import {Homer} from '../src/service.js';
import {htmlAttachmentFixture} from './canvas-html-publication-fixture.js';

// Exercise the service tool boundary without opening user storage or a native engine.
const workerMediaTool=(Homer.prototype as unknown as {workerMediaTool:(slot:unknown,name:string,value:unknown)=>Promise<any>}).workerMediaTool;

test('large tool images fit the actual MCP envelope while original pixels remain available',async()=>{
 assert.ok(ffmpegPath);
 const width=1024,height=768,raw=Buffer.alloc(width*height*3);let seed=7;
 for(let i=0;i<raw.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;raw[i]=seed>>>24;}
 const source=await mediaProcess(ffmpegPath,['-v','error','-f','rawvideo','-pixel_format','rgb24','-video_size',`${width}x${height}`,'-i','pipe:0','-frames:v','1','-f','image2pipe','-vcodec','png','-threads','1','pipe:1'],raw,4*1024*1024);
 const original=Buffer.from(source),full=await modelImage(source,'image/png');
 assert.ok(full.bytes.length*4/3>2*1024*1024,'must reproduce the previously oversized response');
 const image=await toolImage(full);
 assert.equal(image.modelView.resized,true);
 assert.deepEqual(image.modelView.source,{width,height});
 assert.ok(image.modelView.width<=320&&image.modelView.height<=320);
 const f=htmlAttachmentFixture('tool-image.png',original);
 try{
  const {messageId,assetId,revision}=f.send(),ref={assetId,revision};
  const endpoint=await interactionFixture((name,args)=>f.app.mediaTool(name,args));
  try{
   const response=await endpoint.call('inspect_attachment',ref);
   assert.equal(response.isError,false);
   assert.ok(Buffer.byteLength(JSON.stringify({result:response}))<2*1024*1024);
   assert.deepEqual(f.media.readAttachment(ref).bytes,original);
   assert.deepEqual({width:full.width,height:full.height},{width,height});
  }finally{await endpoint.close();}

  let epoch=1;
  const slot={id:'run'},workerHost=Object.assign(Object.create(Homer.prototype),{
   workerActor:()=>({epoch:1}),workers:new Map([[slot.id,slot]]),media:f.media,
   tasks:{
    run:()=>({id:slot.id,taskId:'task',version:1}),
    guard:(actor:{epoch:number})=>{if(actor.epoch!==epoch)throw Error('run_epoch_stale');},
    workerAttachments:()=>{try{f.app.attachmentMessage({messageId,...ref});return [ref];}catch{return [];}},
   },
  });
  const inspect=()=>workerMediaTool.call(workerHost,slot,'inspect_attachment',ref);
  const workerView=await inspect();
  assert.equal(JSON.parse(workerView.mediaContent[0].text).modelView.resized,true);

  // Decoding yields to the host, which can revoke the source or invalidate the Run.
  const readImage=f.media.imageAttachment.bind(f.media);
  let invalidate=()=>{epoch++;};
  f.media.imageAttachment=value=>{queueMicrotask(invalidate);return readImage(value);};
  await assert.rejects(inspect(),/run_epoch_stale/);
  epoch=1;invalidate=()=>{f.history.revokeMessage(f.threadId,messageId);};
  await assert.rejects(inspect(),/media_scope_denied/);
 }finally{f.close();}
});

test('small tool images reuse the existing bytes and retain cancellation guards',async()=>{
 assert.ok(ffmpegPath);
 const bytes=await mediaProcess(ffmpegPath,['-v','error','-f','lavfi','-i','color=c=blue:s=64x32','-frames:v','1','-f','image2pipe','-vcodec','png','-threads','1','pipe:1'],Buffer.alloc(0),1024*1024);
 const image=await toolImage({bytes,mime:'image/png'});
 assert.equal(image.bytes,bytes);assert.equal(image.modelView.resized,false);
 await assert.rejects(toolImage({bytes,mime:'image/png'},AbortSignal.abort()),/media_decode_cancelled/);
});

for(const format of ['gif','webp'])test('local '+format+' attachments normalize for inspection without changing the original',async()=>{
 assert.ok(ffmpegPath);
 // A lossless 64 × 32 WebP fixture avoids depending on an FFmpeg encoder.
 const bytes=format==='webp'?Buffer.from('UklGRiIAAABXRUJQVlA4TBUAAAAvP8AHAAcQ0f/+B4CE8P+8GtH/1AcA','base64')
  :await mediaProcess(ffmpegPath,['-v','error','-f','lavfi','-i','color=c=blue:s=64x32','-frames:v','1','-f','gif','-threads','1','pipe:1'],Buffer.alloc(0),1024*1024);
 const f=htmlAttachmentFixture('preview.'+format,Buffer.from(bytes));
 try{
  const {assetId,revision}=f.send(),result=await f.app.mediaTool('inspect_attachment',{assetId,revision});
  assert.equal(result.mediaContent[1].mimeType,'image/png');
  assert.deepEqual(JSON.parse(result.mediaContent[0].text).modelView.source,{width:64,height:32});
  assert.deepEqual(f.media.readAttachment({assetId,revision}).bytes,bytes);
 }finally{f.close();}
});
