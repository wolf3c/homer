import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdirSync,mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Homer} from '../src/service.js';
import {ffmpegPath,mediaProcess} from '../src/media-decode.js';
import {imageDimensions} from '../src/media-policy.js';
import type {EngineImage,TurnResult} from '../src/engine.js';
import type {AttachmentRef} from '../src/media-store.js';

// Requirement-derived fixture: scratch DB, injected Engine, localhost HTTP only.
// No account, Keychain, actual model or external channel is constructed.
test('Web image input and message attachment inspection retain source dimensions and accurate capabilities',async()=>{
 assert.ok(ffmpegPath);
 const bytes=await mediaProcess(ffmpegPath,['-v','error','-filter_threads','1','-f','lavfi','-i','color=c=blue:s=4096x256','-frames:v','1','-f','image2pipe','-vcodec','png','-threads','1','pipe:1'],Buffer.alloc(0),1024*1024);
 const parent=resolve('.codex/scratch/web-upload-host');mkdirSync(parent,{recursive:true});const root=mkdtempSync(join(parent,'image-resolution-'));
 const requestId='synthetic-resolution-request',path=join(root,'workspace','prepared.png');
 let turnSequence=0;let fixtureError:unknown;let seenText='',seenImage:Buffer|undefined,upload:AttachmentRef,delivered:AttachmentRef;
 const inspectedImages:Buffer[]=[];
 class Engine extends EventEmitter{
  threadId='synthetic-resolution-main';turnId?:string;async start(){return this.threadId;}async imageCapability(){return false;}
  async turn(text:string,options?:{images?:EngineImage[];onStarted?:(id:string)=>void}):Promise<TurnResult>{
   this.turnId='synthetic-resolution-turn-'+ ++turnSequence;options?.onStarted?.(this.turnId);
   try{
    const owner=app as unknown as {mediaTool(name:string,args:AttachmentRef):Promise<{mediaContent:{type:string;data?:string}[]}>};
    const result=await owner.mediaTool('inspect_attachment',options?.images?.length?upload:delivered);
    const image=result.mediaContent.find(item=>item.type==='image');assert.ok(image?.data);
    inspectedImages.push(Buffer.from(image.data,'base64'));
    if(!options?.images?.length)return {status:'completed',text:'合成图片已检查'};
    seenText=text;const input=options.images[0]!;assert.ok('path' in input);seenImage=readFileSync(input.path);
    writeFileSync(path,bytes);
    const reply=`合成图片已附上。[查看原图](<${pathToFileURL(path).href}>)`;
    return {status:'completed',text:reply,messages:[{itemId:'answer',phase:'final_answer',text:reply}]};
   }catch(error){fixtureError=error;throw error;}
  }
  async close(){return true;}async interrupt(){return true;}
 }
 mkdirSync(join(root,'runtime'),{recursive:true});
 const app=new Homer({runtime:join(root,'runtime'),workspace:join(root,'workspace'),codexHome:join(root,'empty-home'),nativeCodexHome:join(root,'empty-home'),codexBin:'/usr/bin/false',requiresOpenaiAuth:false,model:'synthetic-only',stopGraceMs:100},async()=>{},()=>new Engine());
 try{
  await app.start();const capabilities=JSON.parse(JSON.stringify(await app.capabilities()));
  assert.equal(capabilities.limits.nativeImagesPerTurn,null);assert.equal(capabilities.limits.attachmentsPerMessage,null);
  assert.equal(capabilities.catalogImageInput,false);assert.equal(capabilities.imageInput,true);
  upload=await app.uploadAttachment({threadId:'synthetic-resolution-main',requestId,uploadId:'synthetic-resolution-upload',filename:'synthetic.png',data:bytes.toString('base64')});
  assert.deepEqual(app.media.read(requestId,upload).bytes,bytes);
  const {replyId}=app.submitMessage({requestId,text:'检查合成图片',attachments:[upload]});await app.idle();
  assert.ifError(fixtureError);
  const attachments=app.history.message(replyId)?.attachments??[];
  assert.equal(attachments.length,1);delivered=attachments[0]!;
  assert.deepEqual(Buffer.from(app.readAttachment({messageId:replyId,...delivered}).data,'base64'),bytes);
  await app.message('检查已交付图片','synthetic-inspect-delivery');
  assert.ifError(fixtureError);assert.ok(seenImage);assert.equal(inspectedImages.length,2);
  for(const image of [seenImage,...inspectedImages])assert.deepEqual(imageDimensions(image,'image/png'),{width:4096,height:256});
  assert.doesNotMatch(seenText,/2048/);assert.deepEqual(seenImage,bytes);assert.match(seenText,/引擎可能缩放、拒绝或省略/);assert.equal(app.store.meta('mainThread'),'synthetic-resolution-main');
  const brokenScope={threadId:'synthetic-resolution-main',requestId:'incomplete-preview'};
  const broken=await app.uploadAttachment({...brokenScope,uploadId:'broken-image',filename:'broken.png',data:bytes.subarray(0,8).toString('base64')});
  assert.equal(broken.state,'ready');assert.throws(()=>app.readDraftImage({...brokenScope,...broken}),/media_preview_unavailable/);
  app.media.reconcile();assert.equal(app.media.state(brokenScope.requestId,[broken]),'ready');
  assert.deepEqual(readFileSync(app.media.nativeImages(brokenScope.requestId,broken)[0]!.path),bytes.subarray(0,8));
 }finally{await app.close();rmSync(root,{recursive:true,force:true});}
});

test('request-sourced screenshots lose Worker access on revocation and an expired queued screenshot leaves its note',async()=>{
 const {fixture,until}=await import('./fixtures/worker-chat-host.js');
 const f=fixture();
 let unblock:(()=>void)|undefined;
 try{
  await f.app.start();
  const threadId=f.app.store.meta('mainThread')!;
  const bytes=await mediaProcess(ffmpegPath!,['-v','error','-f','lavfi','-i','color=c=blue:s=64x32','-frames:v','1','-threads','1','-f','image2pipe','-vcodec','png','pipe:1'],Buffer.alloc(0),1024*1024);
  const upload=async(requestId:string)=>{
   const {assetId,revision}=await f.app.uploadAttachment({threadId,requestId,uploadId:requestId,filename:'viewport.png',data:bytes.toString('base64')});
   return {assetId,revision};
  };
  const source={kind:'browser' as const,requestId:'web-origin',url:'https://example.com/',title:'Example'};
  const input=(requestId:string,image:AttachmentRef,comment:string)=>({requestId,text:'Read annotation',attachments:[image],resourceReference:{kind:'web' as const,source,annotations:[{id:'note',element:'Heading',elementPath:'h1',comment,x:1,y:1,screenshot:{...image,width:64,height:32,region:{x:1,y:1,width:2,height:2}}}]}});
  await f.app.message('Open a source page','web-origin');
  const image=await upload('web-screenshot');
  f.setScript(async(main,text)=>{
   if(text.includes('Inspect authorized screenshot')){
    const {taskId}=await main.call('task_create',{title:'Inspect screenshot',goal:'Inspect screenshot'});
    await main.call('worker_open',{taskId,attachments:[image]});
   }
   if(text==='Hold queue')await new Promise<void>(resolve=>{unblock=resolve;});
   return {status:'completed',text:'Synthetic reply'};
  });
  f.app.submitMessage(input('web-screenshot',image,'Inspect authorized screenshot'));
  await until(()=>f.engines.some(engine=>engine.options.role==='worker'&&engine.finish));
  const worker=f.engines.find(engine=>engine.options.role==='worker')!;
  const {mcpCall}=await import('./fixtures/host-mcp-call.js');
  const args=worker.options.interactionMcp!.args;
  const inspect=async(id:string)=>{
   worker.emit('hostMcpToolStarted',{threadId:worker.threadId,turnId:worker.turnId,itemId:id,tool:'inspect_attachment',arguments:image});
   return mcpCall(args[args.indexOf('worker')-1]!,'inspect_attachment',image,{callId:id,'x-codex-turn-metadata':{turn_id:worker.turnId}});
  };
  const granted=await inspect('read-source-frame');
  assert.equal(granted.error,undefined);
  assert((granted.result.content??granted.result.mediaContent).some((item:{type:string})=>item.type==='image'));

  const queued=await upload('web-queued');
  const holding=f.app.message('Hold queue','web-queue-hold');
  await until(()=>!!unblock);
  f.app.submitMessage(input('web-queued',queued,'Keep queued screenshot note'));
  f.app.media.revoke('web-queued');
  unblock!();
  await holding;
  await until(()=>f.inputs.some(text=>text.includes('Keep queued screenshot note')&&text.includes('截图不可用')));
  assert(f.app.history.revokeMessage(threadId,f.app.history.inputs(threadId,['web-origin']).get('web-origin')!.id));
  assert.equal((await inspect('revoked-source-frame')).error,'media_scope_denied');
 }finally{unblock?.();await f.close();}
});
