// Exact bytes and MIME over the real local message attachment route.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync,appendFileSync,unlinkSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createWebServer} from '../src/web-server.js';
import {htmlAttachmentFixture} from './canvas-html-publication-fixture.js';

const digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const mediaPath=({messageId,assetId,revision}:{messageId:string;assetId:string;revision:number})=>'/api/media/'+messageId+'/'+assetId+'/'+revision;

test('committed HTML downloads by exact message and attachment, independent of the source file',async()=>{
 const f=htmlAttachmentFixture(),web=await createWebServer({bridge:f.bridge,port:0});
 try{
  assert.equal(f.classifiedMime,'application/octet-stream','shared signature classification stays unchanged');
  assert.equal('connectionFile' in web,false);
  const hiddenPath=mediaPath({messageId:f.replyId,...f.hidden});
  assert.equal((await fetch(web.url+hiddenPath)).status,409,'a staged asset is not a message grant');
  const sent=f.send(),path=mediaPath(sent);
  assert.equal(sent.messageId,f.replyId);
  assert.equal((await fetch(web.url+path,{headers:{Origin:'https://untrusted.example'}})).status,403);
  assert.equal((await fetch(web.url+path,{headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
  unlinkSync(f.original);
  const response=await fetch(web.url+path);
  assert.equal(response.status,200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),f.bytes);
  assert.equal(response.headers.get('x-homer-artifact-hash'),digest(f.bytes));
  assert.match(response.headers.get('content-disposition')??'',/^attachment; filename\*=UTF-8''/);
  assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  assert.match(response.headers.get('content-security-policy')??'',/script-src 'self'/);
  assert.equal(response.headers.get('content-type'),'text/html; charset=utf-8');
  const origin=await (await fetch(web.url+path+'/origin')).json();
  assert.equal(origin.message.id,sent.messageId);
  assert.equal(origin.files[0].assetId,sent.assetId);
  assert.equal((await fetch(web.url+hiddenPath)).status,409,'the unselected sibling stays inaccessible');
  assert.equal((await fetch(web.url+mediaPath({...sent,revision:2}))).status,409);
  assert.equal((await fetch(web.url+'/api/files/result-obsolete')).status,404);
  const second=f.send([{assetId:sent.assetId,revision:sent.revision}],'share-again');
  assert.notEqual(second.messageId,sent.messageId);
  assert.equal(second.path,sent.path);
  f.history.revokeMessage(f.threadId,second.messageId);
  assert.equal((await fetch(web.url+mediaPath(second))).status,409);
  assert.equal((await fetch(web.url+path)).status,200,'revoking a transfer does not revoke its original');
  const dependent=f.send([{assetId:sent.assetId,revision:sent.revision}],'share-dependent');
  writeFileSync(sent.path,Buffer.alloc(f.bytes.length));
  const tampered=await fetch(web.url+mediaPath(dependent));
  assert.equal(tampered.status,409);
  assert.equal((await tampered.json()).error,'media_integrity_failed');
  assert.throws(()=>f.send([{assetId:sent.assetId,revision:sent.revision}],'share-tampered'),/media_integrity_failed/);
  writeFileSync(sent.path,f.bytes);
  f.history.revokeMessage(f.threadId,sent.messageId);
  assert.equal((await fetch(web.url+path+'/origin')).status,409);
  assert.equal((await fetch(web.url+mediaPath(dependent))).status,409,'transfer still depends on a valid original grant');
 }finally{await web.close();f.close();}
});

test('real 50 MiB media is served intact and a snapshot with an extra byte is denied',async()=>{
 const bytes=Buffer.alloc(50*1024*1024);bytes.write('RIFF',0);bytes.write('WAVE',8);
 const f=htmlAttachmentFixture('boundary.wav',bytes),web=await createWebServer({bridge:f.bridge,port:0});
 try{
  const sent=f.send(),get=()=>fetch(web.url+mediaPath(sent));
  const response=await get();assert.equal(response.status,200);
  const actual=Buffer.from(await response.arrayBuffer());
  assert.equal(actual.length,bytes.length);
  assert.equal(digest(actual),sent.sha256);
  appendFileSync(sent.path,Buffer.from([0]));
  const denied=await get();assert.equal(denied.status,409);
  assert.equal((await denied.json()).error,'media_integrity_failed');
 }finally{await web.close();f.close();}
});

test('HTML preview MIME uses a checked extension and UTF-8 without overriding known signatures',()=>{
 for(const [filename,bytes,mime] of [
  ['大写.HTML',Buffer.from('<h1>UTF-8</h1>'),'text/html; charset=utf-8'],
  ['legacy.HtM',Buffer.from('<h1>HTML</h1>'),'text/html; charset=utf-8'],
  ['invalid.html',Buffer.from([128,0,60]),'application/octet-stream'],
  ['pdf.html',Buffer.from('%PDF-1.4\n'),'application/pdf'],
  ['png-signature.html',Buffer.from([137,80,78,71,13,10,26,10]),'image/png'],
  ['audio.md',Buffer.from('RIFF0000WAVEfmt '),'audio/wav'],
  ['video.md',Buffer.from([0,0,0,24,...Buffer.from('ftypisom'),255]),'video/mp4'],
  ['other.bin',Buffer.from('<h1>HTML-shaped but not named HTML</h1>'),'application/octet-stream'],
  ['notes.txt',Buffer.from('plain text'),'text/plain'],
  ['notes.md',Buffer.from('# Markdown'),'text/markdown'],
 ] as const){
  const f=htmlAttachmentFixture(filename,bytes);
  try{
   const sent=f.send(),file=f.app.readAttachment(sent);
   assert.equal(file.mime,mime,filename);
   assert.deepEqual(Buffer.from(file.data,'base64'),bytes);
   assert.equal(file.filename,filename);
  }finally{f.close();}
 }
});
