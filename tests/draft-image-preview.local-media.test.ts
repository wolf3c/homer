import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {Homer} from '../src/service.js';
import {homerWebBridge} from '../src/web-homer.js';
import {createWebServer} from './web-connected-fixture.js';
import {ffmpegPath,mediaProcess} from '../src/media-decode.js';

test('draft image preview is available only to its original unsubmitted upload and origin',async()=>{
 const parent=resolve('.codex/scratch/draft-preview-tests');mkdirSync(parent,{recursive:true});const root=mkdtempSync(join(parent,'fixture-'));
 mkdirSync(join(root,'runtime'),{recursive:true});
 class Engine extends EventEmitter {threadId='preview-test-main';async start(){return this.threadId;}async turn(){return {status:'completed' as const,text:'synthetic'};}async close(){return true;}async interrupt(){return true;}}
 const app=new Homer({runtime:join(root,'runtime'),workspace:join(root,'workspace'),codexHome:join(root,'empty-home'),codexBin:'/usr/bin/false',requiresOpenaiAuth:false,model:'synthetic-only',timeoutMs:2000,mainTimeoutMs:2000,stopGraceMs:100},async()=>{},()=>new Engine());
 let web:Awaited<ReturnType<typeof createWebServer>>|undefined;
 try{
  assert.ok(ffmpegPath);await app.start();web=await createWebServer({port:0,bridge:homerWebBridge(app)});
  const bytes=await mediaProcess(ffmpegPath,['-v','error','-f','lavfi','-i','color=c=blue:s=32x32','-frames:v','1','-f','image2pipe','-vcodec','png','-threads','1','pipe:1'],Buffer.alloc(0),1024*1024);
  const scope={threadId:'preview-test-main',requestId:'preview-test-request'};
  const ref=await app.uploadAttachment({...scope,uploadId:'preview-test-upload',filename:'image.png',data:bytes.toString('base64')});
  const preview=(input:unknown,origin=web!.url)=>fetch(web!.url+'/api/uploads/preview',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(input)});
  const good=await preview({...scope,assetId:ref.assetId,revision:ref.revision});assert.equal(good.status,200);assert.match(good.headers.get('content-type')??'',/^image\/(png|jpeg|webp)/);assert.equal(good.headers.get('cache-control'),'no-store');assert.ok((await good.arrayBuffer()).byteLength>0);
  for(const bad of [{...scope,requestId:'other',...ref},{...scope,threadId:'other',...ref},{...scope,...ref,revision:2},{...scope,...ref,assetId:'asset-00000000-0000-0000-0000-000000000000'}])assert.notEqual((await preview(bad)).status,200);
  assert.equal((await preview({...scope,...ref},'https://foreign.invalid')).status,403);
  const other=await app.uploadAttachment({...scope,uploadId:'preview-test-file',filename:'note.txt',data:Buffer.from('fixture').toString('base64')});
  assert.notEqual((await preview({...scope,...other})).status,200);
  app.discardAttachment({...scope,...ref});assert.notEqual((await preview({...scope,...ref})).status,200);
  const sentScope={...scope,requestId:'preview-submitted-request'};
  const sentImage=await app.uploadAttachment({...sentScope,uploadId:'preview-submitted-upload',filename:'image.png',data:bytes.toString('base64')});
  app.submitMessage({requestId:sentScope.requestId,text:'synthetic',attachments:[sentImage]});
  assert.notEqual((await preview({...sentScope,...sentImage})).status,200);await app.idle();
 }finally{await web?.close();await app.close();rmSync(root,{recursive:true,force:true});}
});
