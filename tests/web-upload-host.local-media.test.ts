import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {Homer} from '../src/service.js';
import {ffmpegPath,mediaProcess} from '../src/media-decode.js';
import {imageDimensions} from '../src/media-policy.js';
import type {EngineImage} from '../src/engine.js';

// Requirement-derived fixture: scratch DB, injected Engine, localhost HTTP only.
// No account, Keychain, actual model or external channel is constructed.
test('Web image input and adopted result inspection retain source dimensions and accurate capabilities',async()=>{
 assert.ok(ffmpegPath);
 const bytes=await mediaProcess(ffmpegPath,['-v','error','-filter_threads','1','-f','lavfi','-i','color=c=blue:s=4096x256','-frames:v','1','-f','image2pipe','-vcodec','png','-threads','1','pipe:1'],Buffer.alloc(0),1024*1024);
 const parent=resolve('.codex/scratch/web-upload-host');mkdirSync(parent,{recursive:true});const root=mkdtempSync(join(parent,'image-resolution-'));
 let turnSequence=0;let fixtureError:unknown;let seenText='',seenImage:Buffer|undefined,inspectedImage:Buffer|undefined;
 class Engine extends EventEmitter{
  threadId='synthetic-resolution-main';turnId?:string;async start(){return this.threadId;}async imageCapability(){return true;}
  async turn(text:string,options?:{images?:EngineImage[];onStarted?:(id:string)=>void}){
   this.turnId='synthetic-resolution-turn-'+ ++turnSequence;options?.onStarted?.(this.turnId);
   if(!options?.images?.length)return {status:'completed',text:''};
   try{seenText=text;seenImage=Buffer.from(options!.images![0]!.url.split(',')[1]!,'base64');
   const actor={agentId:app.store.meta('mainAgentId')!,sourceRequestId:'synthetic-resolution-request'};
   const task=app.tasks.createTask(actor,{operationId:'image-task',goal:'Keep the source image dimensions',authority:{sourceRequestId:actor.sourceRequestId,description:'Synthetic image fixture only',materials:[],resultIds:[]}});
   const opened=app.tasks.workerOpen(actor,{operationId:'image-worker',taskId:task.taskId,text:'Prepare synthetic image'});
   const run=app.tasks.claim(opened.runId)!;app.tasks.bind(run.id,run.epoch,'synthetic-worker','synthetic-turn');
   const worker={agentId:'worker:'+run.workerId,runId:run.id,epoch:run.epoch,threadId:'synthetic-worker',turnId:'synthetic-turn'};
   const written=app.tasks.writeFile(worker,{operationId:'stage-image',filename:'synthetic.png',bytes});
   app.tasks.endSegment(run.id,run.epoch,{status:'completed',text:'Synthetic image prepared'},true);
   const staged=app.tasks.adoptResult(actor,{operationId:'adopt-image',taskId:task.taskId,version:1,runId:run.id,filePath:written.path});
   const result=await (app as any).mediaTool('inspect_result_file',{resultId:staged.resultId});
   const image=result.mediaContent.find((item:any)=>item.type==='image');inspectedImage=Buffer.from(image.data,'base64');
   return {status:'completed',text:'合成图片已检查'};}catch(error){fixtureError=error;throw error;}
  }
  async close(){return true;}async interrupt(){return true;}
 }
 mkdirSync(join(root,'runtime'),{recursive:true});
 const app=new Homer({runtime:join(root,'runtime'),workspace:join(root,'workspace'),codexHome:join(root,'empty-home'),codexBin:'/usr/bin/false',requiresOpenaiAuth:false,model:'synthetic-only',timeoutMs:2000,mainTimeoutMs:10000,stopGraceMs:100},async()=>{},()=>new Engine());
 try{
  await app.start();const capabilities=JSON.parse(JSON.stringify(await app.capabilities()));
  assert.equal(capabilities.limits.nativeImagesPerTurn,null);assert.equal(capabilities.limits.attachmentsPerMessage,10);
  const requestId='synthetic-resolution-request',ref=await app.uploadAttachment({threadId:'synthetic-resolution-main',requestId,uploadId:'synthetic-resolution-upload',filename:'synthetic.png',data:bytes.toString('base64')});
  assert.deepEqual(app.media.read(requestId,ref).bytes,bytes);
  app.submitMessage({requestId,text:'检查合成图片',attachments:[ref]});await app.idle();
  assert.ifError(fixtureError);assert.ok(seenImage);assert.ok(inspectedImage);
  assert.deepEqual(imageDimensions(seenImage,'image/png'),{width:4096,height:256});assert.deepEqual(imageDimensions(inspectedImage,'image/png'),{width:4096,height:256});
  assert.doesNotMatch(seenText,/2048/);assert.match(seenText,/保留源图尺寸/);assert.equal(app.store.meta('mainThread'),'synthetic-resolution-main');
 }finally{await app.close();rmSync(root,{recursive:true,force:true});}
});
