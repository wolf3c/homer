import {readTestConversation} from './fixtures/read-test-conversation.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {basename,join,resolve} from 'node:path';
import {Homer} from '../src/service.js';
import {homerWebBridge} from '../src/web-homer.js';
import {createWebServer,fetch} from './web-connected-fixture.js';
import {WEB_UPLOAD_BYTES} from '../src/web-upload.js';
import type {EngineImage} from '../src/engine.js';

// Requirement-derived fixture: scratch DB, injected Engine, localhost HTTP only.
// No account, Keychain, actual model or external channel is constructed.
test('Web binary upload -> scoped history -> original thread, safe retry/remove/origin/size guards',async()=>{
 const rootParent=resolve('.codex/scratch/web-upload-host');mkdirSync(rootParent,{recursive:true});const root=mkdtempSync(join(rootParent,'fixture-'));
 const turns:{text:string;images?:EngineImage[]}[]=[];
 let failed=false;
 let inspect:()=>Promise<void>,inspection:Promise<void>|undefined;
 class Engine extends EventEmitter{
  threadId='synthetic-upload-main';async start(){return this.threadId;}
  async turn(text:string,options?:{images?:EngineImage[];onStarted?:(id:string)=>void}){
   options?.onStarted?.('synthetic-upload-turn');turns.push({text,images:options?.images});
   inspection=inspect();await inspection;
   return failed?{status:'failed',text:'',errorCode:'engine_image_rejected',errorMessage:'Synthetic customer would like a blue notebook'}:{status:'completed',text:'合成文件已处理'};
  }
  async close(){return true;}async interrupt(){return true;}
 }
 mkdirSync(join(root,'runtime'),{recursive:true});
 const app=new Homer({runtime:join(root,'runtime'),workspace:join(root,'workspace'),codexHome:join(root,'empty-home'),nativeCodexHome:join(root,'empty-home'),codexBin:'/usr/bin/false',requiresOpenaiAuth:false,model:'synthetic-only',stopGraceMs:100},async()=>{},()=>new Engine());
 let web:Awaited<ReturnType<typeof createWebServer>>|undefined;
 try{
  await app.start();web=await createWebServer({port:0,bridge:homerWebBridge(app)});
  const metadata={'X-Homer-Thread':'synthetic-upload-main','X-Homer-Request':'synthetic-upload-request','X-Homer-Upload':'synthetic-upload-operation','X-Homer-Filename':encodeURIComponent('合成文本.txt')};
  const fileText='仅存在于文件正文的合成来源：青铜风车七十六';
  const upload=(headers:Record<string,string>={})=>fetch(web!.url+'/api/uploads',{method:'POST',headers:{Origin:web!.url,'Content-Type':'application/octet-stream',...metadata,...headers},body:fileText});
  assert.equal((await upload({Origin:'https://foreign.invalid'})).status,403);
  assert.equal((await upload({'Content-Type':'text/plain'})).status,409);
  assert.equal((await upload({'X-Homer-Thread':'foreign-main'})).status,409);
  const emptyResponse=await fetch(web.url+'/api/uploads',{method:'POST',headers:{Origin:web.url,'Content-Type':'application/octet-stream',...metadata,'X-Homer-Request':'empty-request','X-Homer-Upload':'empty-upload','X-Homer-Filename':encodeURIComponent('空'.repeat(100)+'.txt')},body:''});
  assert.equal(emptyResponse.status,201);const empty=await emptyResponse.json() as {assetId:string;revision:number;filename:string};
  assert.equal(empty.filename,'空'.repeat(100)+'.txt');assert.equal(app.media.read('empty-request',empty).bytes.length,0);
  const response=await upload();assert.equal(response.status,201);const ref=await response.json() as {assetId:string;revision:number};
  assert.equal((await upload()).status,201);assert.deepEqual(await (await upload()).json(),app.media.view(ref));
  assert.equal(turns.length,0);
  const input={requestId:metadata['X-Homer-Request'],text:'',attachments:[{assetId:ref.assetId,revision:ref.revision}]};
  const unrelated=await upload({'X-Homer-Request':'other-request','X-Homer-Upload':'other-upload'});
  assert.equal(unrelated.status,201);
  const other=await unrelated.json() as {assetId:string;revision:number};
  assert.notEqual(other.assetId,ref.assetId);
  inspect=async()=>{
   const read=await app['mediaTool']('inspect_attachment',input.attachments[0]);
   assert.ok('extraction' in read);
   assert.partialDeepStrictEqual(read.extraction,{state:'ready',text:fileText});
   await assert.rejects(app['mediaTool']('inspect_attachment',{assetId:other.assetId,revision:other.revision}),/^Error: media_scope_denied$/);
  };
  const sent=await fetch(web.url+'/api/messages',{method:'POST',headers:{Origin:web.url,'Content-Type':'application/json'},body:JSON.stringify(input)});assert.equal(sent.status,202);
  await app.idle();assert.ok(inspection);await inspection;
  assert.equal(turns.length,1);
  assert.match(turns[0]!.text,/inspect_attachment/);
  assert.ok(turns[0]!.text.includes(ref.assetId));
  assert.doesNotMatch(turns[0]!.text,/青铜风车七十六/);
  assert.equal(app.store.meta('mainThread'),'synthetic-upload-main');
  assert.equal((await upload({'X-Homer-Upload':'late-upload'})).status,409);
  assert.throws(()=>app.discardAttachment({threadId:'synthetic-upload-main',requestId:input.requestId,...ref}),/web_upload_request_closed/);
  const message=readTestConversation(app).messages.find(m=>m.role==='user'&&m.requestId===input.requestId)!;
  assert.equal(Buffer.from(app.readAttachment({messageId:message.id,...ref}).data,'base64').toString('utf8'),fileText);
  assert.throws(()=>app.submitMessage({requestId:'different-request',text:'forged',attachments:input.attachments}),/media_scope_denied/);
  assert.equal((await fetch(web.url+'/api/uploads',{method:'POST',headers:{Origin:web.url,'Content-Type':'application/octet-stream',...metadata,'X-Homer-Request':'size-request','X-Homer-Upload':'size-upload'},body:Buffer.alloc(WEB_UPLOAD_BYTES+1)})).status,409);
  // Prepared synthetic derivatives exercise selection, without a decoder or real model.
  const mixedRequest='mixed-images',png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGOI6tkCRwzEcQCU8hmhmgeEcAAAAABJRU5ErkJggg==','base64'),refs=[];
  for(let i=0;i<33;i++){
   const image=app.media.intent(mixedRequest,'web:synthetic-upload-main','image','image-'+i+'.png');app.media.ready(image,app.media.claim(image)!,png,'image/png');
   refs.push(image);
  }
  const video=app.media.intent(mixedRequest,'web:synthetic-upload-main','video','synthetic.mp4');app.media.ready(video,app.media.claim(video)!,Buffer.from('synthetic prepared video'),'video/mp4');
  const frames=[0,12000,24000,36000,48000,59900].map(ms=>'video-frame-'+ms+'ms-v1');
  for(const transform of frames)app.media.derivative(mixedRequest,video,{bytes:png,mime:'image/png',transform,width:4,height:4});
  refs.unshift(video);
  const note=app.media.intent(mixedRequest,'web:synthetic-upload-main','file','empty.txt');app.media.ready(note,app.media.claim(note)!,Buffer.alloc(0),'text/plain');
  const noFrames=app.media.intent(mixedRequest,'web:synthetic-upload-main','video','unavailable.mp4');app.media.ready(noFrames,app.media.claim(noFrames)!,Buffer.from('synthetic unavailable video'),'video/mp4');
  const originals=refs.slice(1);refs.push(note,noFrames);
  inspect=async()=>{};app.submitMessage({requestId:mixedRequest,text:'Synthetic mixed image input',attachments:refs});await app.idle();
  const images=turns.at(-1)!.images??[];
  assert.deepEqual(images.map(image=>'path' in image&&basename(image.path)),[
   ...frames.map(frame=>video.assetId+'.'+frame),...originals.map(ref=>ref.assetId)
  ]);
  assert.ok(turns.at(-1)!.text.includes('第 6 张图：'+video.assetId+'@1，视频抽帧 video-frame-59900ms-v1'));
  assert.ok(turns.at(-1)!.text.includes(noFrames.assetId+'@1：没有可提交的视频帧'));
  assert.match(turns.at(-1)!.text,new RegExp('第 7 张图[^\\n]*'+refs[1]!.assetId));
  assert.deepEqual(readTestConversation(app).messages.find(m=>m.role==='user'&&m.requestId===mixedRequest)?.attachments?.map(({assetId,revision})=>({assetId,revision})),refs);
  failed=true;inspect=async()=>{};
  const failure=await app.message('Synthetic native failure','native-failure');
  assert.match(failure,/Codex 拒绝了图片输入/);assert.doesNotMatch(failure,/blue notebook/);assert.match(failure,/不会自动重试/);
 }finally{await web?.close();await app.close();rmSync(root,{recursive:true,force:true});}
});
