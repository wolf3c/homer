import test from 'node:test';
import assert from 'node:assert/strict';
import {toolImage,modelImage,mediaProcess,ffmpegPath} from '../src/media-decode.js';
import {interactionFixture} from './interaction-lifecycle-fixture.js';
import {Homer} from '../src/service.js';

// Exercise the existing service tool boundaries without constructing a host,
// opening user storage, or creating any native engine.
const mediaTool=(Homer.prototype as unknown as {mediaTool:(name:string,value:unknown)=>Promise<any>}).mediaTool;
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
 const mainHost={mainContext:{},validateMainContext(){},mainActor(){return {};},tasks:{inspect(){return {actualResult:{file:{path:'synthetic.png'}},results:[{id:'result',runId:'run'}]};},run(){return {matterId:'matter'};}},files:{prepareRun(){return 'unused';},resultBytes(){return {data:source,mime:'image/png'};}}};
 let revoked=false;const assetId='asset-00000000-0000-0000-0000-000000000001';
 const workerHost={workerActor(){return {};},tasks:{run(){return {sourceRequestId:'source',taskId:'task',contractVersion:1};},guard(){},contract(_taskId:string,version:number){return {inputs:version===1?[{type:'attachment',id:assetId+'@1'}]:[]};}},media:{validate(){if(revoked)throw Error('media_scope_denied');},read(){return {asset:{kind:'image'}};},view(){return {};},extracted(){},image(){return full;}}};
 const args={assetId,revision:1};
 const workerView=await workerMediaTool.call(workerHost,{id:'run'},'inspect_attachment',args);
 assert.equal(JSON.parse(workerView.mediaContent[0].text).modelView.resized,true);
 const f=await interactionFixture(()=>mediaTool.call(mainHost,'inspect_result_file',{resultId:'result'}));
 try{
  const response=await f.call('inspect_result_file');assert.equal(response.isError,false);
  assert.ok(Buffer.byteLength(JSON.stringify({result:response}))<2*1024*1024);
  assert.deepEqual(source,original);assert.deepEqual({width:full.width,height:full.height},{width,height});
 }finally{await f.close();}
 workerHost.media.image=()=>{queueMicrotask(()=>{revoked=true;});return full;};
 await assert.rejects(workerMediaTool.call(workerHost,{id:'run'},'inspect_attachment',args),/media_scope_denied/);
 // Adoption can change contractVersion within the same Run/epoch/turn, so a
 // successful actor guard must not authorize the captured old attachment scope.
 revoked=false;let version=1;
 workerHost.tasks.run=()=>({sourceRequestId:'source',taskId:'task',contractVersion:version});
 workerHost.media.image=()=>{queueMicrotask(()=>{version=2;});return full;};
 await assert.rejects(workerMediaTool.call(workerHost,{id:'run'},'inspect_attachment',args),/media_scope_denied/);
});

test('small tool images reuse the existing bytes and retain cancellation guards',async()=>{
 assert.ok(ffmpegPath);
 const bytes=await mediaProcess(ffmpegPath,['-v','error','-f','lavfi','-i','color=c=blue:s=64x32','-frames:v','1','-f','image2pipe','-vcodec','png','-threads','1','pipe:1'],Buffer.alloc(0),1024*1024);
 const image=await toolImage({bytes,mime:'image/png'});
 assert.equal(image.bytes,bytes);assert.equal(image.modelView.resized,false);
 await assert.rejects(toolImage({bytes,mime:'image/png'},AbortSignal.abort()),/media_decode_cancelled/);
});
