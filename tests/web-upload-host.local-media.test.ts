import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {Homer} from '../src/service.js';
import {ffmpegPath,mediaProcess} from '../src/media-decode.js';
import {imageDimensions} from '../src/media-policy.js';
import type {EngineImage,ToolCall} from '../src/engine.js';
import type {AttachmentRef} from '../src/media-store.js';

// Requirement-derived fixture: scratch DB, injected Engine, localhost HTTP only.
// No account, Keychain, actual model or external channel is constructed.
test('Web image input and message attachment inspection retain source dimensions and accurate capabilities',async()=>{
 assert.ok(ffmpegPath);
 const bytes=await mediaProcess(ffmpegPath,['-v','error','-filter_threads','1','-f','lavfi','-i','color=c=blue:s=4096x256','-frames:v','1','-f','image2pipe','-vcodec','png','-threads','1','pipe:1'],Buffer.alloc(0),1024*1024);
 const parent=resolve('.codex/scratch/web-upload-host');mkdirSync(parent,{recursive:true});const root=mkdtempSync(join(parent,'image-resolution-'));
 const requestId='synthetic-resolution-request',path=join(root,'workspace','prepared.png');
 let turnSequence=0;let fixtureError:unknown;let seenText='',seenImage:Buffer|undefined,inspectedImage:Buffer|undefined,upload:AttachmentRef;
 class Engine extends EventEmitter{
  constructor(readonly tool:(call:ToolCall)=>Promise<unknown>){super();}
  threadId='synthetic-resolution-main';turnId?:string;async start(){return this.threadId;}async imageCapability(){return true;}
  async turn(text:string,options?:{images?:EngineImage[];onStarted?:(id:string)=>void}){
   this.turnId='synthetic-resolution-turn-'+ ++turnSequence;options?.onStarted?.(this.turnId);
   if(!options?.images?.length)return {status:'completed',text:''};
   try{seenText=text;seenImage=Buffer.from(options!.images![0]!.url.split(',')[1]!,'base64');
   writeFileSync(path,bytes);
   const sent=await this.tool({threadId:this.threadId,turnId:this.turnId,callId:'send-prepared-image',
    tool:'send_user_message',arguments:{text:'合成图片已附上',attachments:[{path}]}});
   const message=app.history.message((sent as {messageId:string}).messageId)!;
   assert.ok(message.attachments?.length);
   const owner=app as unknown as {mediaTool(name:string,args:AttachmentRef):Promise<{mediaContent:{type:string;data?:string}[]}>};
   for(const ref of [upload,message.attachments[0]!]){
    const result=await owner.mediaTool('inspect_attachment',ref);
    const image=result.mediaContent.find(item=>item.type==='image');assert.ok(image?.data);
    inspectedImage=Buffer.from(image.data,'base64');
    assert.deepEqual(imageDimensions(inspectedImage,'image/png'),{width:4096,height:256});
   }
   return {status:'completed',text:'合成图片已检查'};}catch(error){fixtureError=error;throw error;}
  }
  async close(){return true;}async interrupt(){return true;}
 }
 mkdirSync(join(root,'runtime'),{recursive:true});
 const app=new Homer({runtime:join(root,'runtime'),workspace:join(root,'workspace'),codexHome:join(root,'empty-home'),nativeCodexHome:join(root,'empty-home'),codexBin:'/usr/bin/false',requiresOpenaiAuth:false,model:'synthetic-only',stopGraceMs:100},async()=>{},(_options,tool)=>new Engine(tool));
 try{
  await app.start();const capabilities=JSON.parse(JSON.stringify(await app.capabilities()));
  assert.equal(capabilities.limits.nativeImagesPerTurn,null);assert.equal(capabilities.limits.attachmentsPerMessage,10);
  upload=await app.uploadAttachment({threadId:'synthetic-resolution-main',requestId,uploadId:'synthetic-resolution-upload',filename:'synthetic.png',data:bytes.toString('base64')});
  assert.deepEqual(app.media.read(requestId,upload).bytes,bytes);
  app.submitMessage({requestId,text:'检查合成图片',attachments:[upload]});await app.idle();
  assert.ifError(fixtureError);assert.ok(seenImage);assert.ok(inspectedImage);
  assert.deepEqual(imageDimensions(seenImage,'image/png'),{width:4096,height:256});assert.deepEqual(imageDimensions(inspectedImage,'image/png'),{width:4096,height:256});
  assert.doesNotMatch(seenText,/2048/);assert.match(seenText,/保留源图尺寸/);assert.equal(app.store.meta('mainThread'),'synthetic-resolution-main');
 }finally{await app.close();rmSync(root,{recursive:true,force:true});}
});
