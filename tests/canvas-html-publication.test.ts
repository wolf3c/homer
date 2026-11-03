// Regression for the real published-file MIME path; no model or user data access.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync,appendFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createWebServer} from '../src/web-server.js';
import {publishedHtmlFixture} from './canvas-html-publication-fixture.js';

test('published UTF-8 HTML reaches the file API as HTML while attachment, exact bytes and publication fences remain',async()=>{
  const f=publishedHtmlFixture();
  const web=await createWebServer({bridge:f.bridge,port:0});
  try{
    assert.equal(f.classifiedMime,'application/octet-stream','shared file/media classification stays unchanged');
    assert.equal('connectionFile' in web,false,'local file API needs no pairing file');
    const get=(id=f.staged.resultId)=>fetch(web.url+'/api/files/'+id);
    assert.equal((await get()).status,409,'accepted but not published');
    f.publish();
    assert.equal((await fetch(web.url+'/api/files/'+f.staged.resultId,{headers:{Origin:'https://untrusted.example'}})).status,403,'foreign origin cannot download a published file');
    const response=await get();assert.equal(response.status,200);
    const actual=Buffer.from(await response.arrayBuffer());assert.deepEqual(actual,f.bytes);
    assert.equal(createHash('sha256').update(actual).digest('hex'),f.staged.sha256);
    assert.match(response.headers.get('content-disposition')??'',/^attachment; filename\*=UTF-8''/);
    assert.equal(response.headers.get('x-content-type-options'),'nosniff');
    assert.match(response.headers.get('content-security-policy')??'',/script-src 'self'/);
    assert.equal(response.headers.get('content-type'),'text/html; charset=utf-8','Canvas can read the exact published HTML as source');
    assert.equal((await get(f.hidden.resultId)).status,409,'unpublished sibling is denied');
    writeFileSync(f.staged.path,'tampered');assert.equal((await get()).status,409,'changed published bytes denied');
    writeFileSync(f.staged.path,f.bytes);f.revoke();assert.equal((await get()).status,409,'revoked publication denied');
  }finally{await web.close();f.close();}
});

test('media bytes require a selected accepted result and current publication, origin and hash',async()=>{
  // Signature fixtures exercise MIME/authorization only, never claim decoding.
  for(const [filename,bytes,mime] of [
    ['audio.md',Buffer.concat([Buffer.from('RIFF0000WAVEfmt '),Buffer.from([255])]),'audio/wav'],
    ['video.md',Buffer.from([0,0,0,24,...Buffer.from('ftypisom'),255]),'video/mp4'],
  ] as const){
    const f=publishedHtmlFixture(filename,bytes),web=await createWebServer({bridge:f.bridge,port:0});
    const get=(id=f.staged.resultId,headers?:HeadersInit)=>fetch(web.url+'/api/files/'+id,{headers});
    try{
      assert.equal((await get()).status,409,'accepted alone is not published');
      const delivery=f.publish();
      for(const state of ['prepared','submitting','recorded'] as const){
        if(state!=='prepared')f.tasks.markDelivery(delivery.deliveryId,state);
        const response=await get();assert.equal(response.status,200,state);
        assert.equal(response.headers.get('content-type'),mime);
        assert.equal(response.headers.get('x-content-type-options'),'nosniff');
        assert.match(response.headers.get('content-security-policy')??'',/media-src 'self' blob:/);
        assert.equal(response.headers.get('x-homer-artifact-hash'),f.staged.sha256);
        assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
      }
      assert.equal((await get(f.hidden.resultId)).status,409,'accepted but unselected sibling');
      assert.equal((await get(undefined,{Origin:'https://untrusted.example'})).status,403);
      assert.equal((await get(undefined,{'Sec-Fetch-Site':'cross-site'})).status,403);
      writeFileSync(f.staged.path,Buffer.concat([bytes,Buffer.from('tamper')]));
      const tampered=await get();assert.equal(tampered.status,409);assert.equal((await tampered.json()).error,'result_hash_mismatch');
      writeFileSync(f.staged.path,bytes);f.revoke();assert.equal((await get()).status,409);
    }finally{await web.close();f.close();}
  }
  const f=publishedHtmlFixture('uncertain.wav',Buffer.from('RIFF0000WAVE'));
  try{const d=f.publish();f.tasks.markDelivery(d.deliveryId,'submitting');f.tasks.markDelivery(d.deliveryId,'uncertain');assert.equal((await f.bridge.artifact(f.staged.resultId)).mime,'audio/wav','uncertain delivery remains readable under the existing rule, without implying receipt');}finally{f.close();}
});

test('file API reads real 50 MiB media bytes and denies an actual extra byte without a download bypass',async()=>{
  const bytes=Buffer.alloc(50*1024*1024);bytes.write('RIFF',0);bytes.write('WAVE',8);
  const f=publishedHtmlFixture('boundary.wav',bytes),web=await createWebServer({bridge:f.bridge,port:0});
  try{
    f.publish();const get=()=>fetch(web.url+'/api/files/'+f.staged.resultId);
    const response=await get();assert.equal(response.status,200);
    const actual=Buffer.from(await response.arrayBuffer());assert.equal(actual.length,50*1024*1024);
    assert.equal(createHash('sha256').update(actual).digest('hex'),f.staged.sha256);
    appendFileSync(f.staged.path,Buffer.from([0]));
    const denied=await get();assert.equal(denied.status,409);assert.equal((await denied.json()).error,'file_type_or_size_denied');
  }finally{await web.close();f.close();}
});

test('HTML export MIME is limited to UTF-8 html/htm with unknown MIME; known media and other text/binary formats keep their types',async()=>{
  for(const [filename,bytes,mime] of [
    ['大写.HTML',Buffer.from('<h1>UTF-8</h1>'),'text/html; charset=utf-8'],
    ['legacy.HtM',Buffer.from('<h1>HTML</h1>'),'text/html; charset=utf-8'],
    ['invalid.html',Buffer.from([128,0,60]),'application/octet-stream'],
    ['pdf.html',Buffer.from('%PDF-1.4\n'),'application/pdf'],
    ['png-signature.html',Buffer.from([137,80,78,71,13,10,26,10]),'image/png'],
    ['other.bin',Buffer.from('<h1>HTML-shaped but not named HTML</h1>'),'application/octet-stream'],
    ['notes.txt',Buffer.from('plain text'),'text/plain'],
    ['notes.md',Buffer.from('# Markdown'),'text/markdown'],
  ] as const){const f=publishedHtmlFixture(filename,bytes);try{f.publish();const file=await f.bridge.artifact(f.staged.resultId);assert.equal(file.mime,mime,filename);assert.deepEqual(Buffer.from(file.data!,'base64'),bytes);assert.equal(file.filename,filename);}finally{f.close();}}
});
