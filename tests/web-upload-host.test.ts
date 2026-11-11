import {readTestConversation} from './fixtures/read-test-conversation.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
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
 let inspect:()=>Promise<void>,inspection:Promise<void>|undefined;
 class Engine extends EventEmitter{
  threadId='synthetic-upload-main';async start(){return this.threadId;}
  async turn(text:string,options?:{images?:EngineImage[];onStarted?:(id:string)=>void}){
   options?.onStarted?.('synthetic-upload-turn');turns.push({text,images:options?.images});
   inspection=inspect();await inspection;
   return {status:'completed',text:'合成文件已处理'};
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
 }finally{await web?.close();await app.close();rmSync(root,{recursive:true,force:true});}
});
