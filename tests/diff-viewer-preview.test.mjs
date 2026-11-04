import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {act} from 'react';
import {React,withDom} from './helpers/process-dom.mjs';

const require=createRequire(import.meta.url),h=React.createElement;
const patch='diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new\n';
const source=readFileSync(new URL('../ui/canvas-panel.tsx',import.meta.url),'utf8');
async function reader(mode='real'){
 const result=await build({stdin:{contents:source+'\nexport {CanvasReader};\nexport {createAnnotationDraft} from "./annotation-draft";\n',loader:'tsx',resolveDir:fileURLToPath(new URL('../ui/',import.meta.url))},bundle:true,write:false,format:'cjs',platform:'node',jsx:'automatic',external:['react','react/jsx-runtime','react-dom','react-dom/client'],loader:{'.css':'empty'},plugins:[{name:'test-browser-boundaries',setup(b){
  b.onResolve({filter:/runtime\.js\?raw$/},()=>({path:'runtime',namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export default ""'}));
  b.onResolve({filter:/^parse-diff$/},()=>({path:'parse-diff',namespace:'parser'}));
  b.onLoad({filter:/.*/,namespace:'parser'},()=>({contents:'export default patch=>globalThis.__patchParser(patch);'}));
  if(mode==='download')b.onLoad({filter:/\/file-download\.ts$/},()=>({contents:'export const saveBlob=(...args)=>globalThis.__patchDownload(...args);'}));
  if(mode==='lazy-error')b.onLoad({filter:/\/diff-viewer\.tsx$/},()=>({contents:'throw Error("synthetic_chunk_failure"); export const DiffViewer=()=>null;'}));
 }}]});
 const mod={exports:{}};Function('require','module','exports',result.outputFiles[0].text)(require,mod,mod.exports);return mod.exports;
}
const component=await reader();
async function fixture(run,{module=component,fetcher}={}){
 const old={};for(const key of ['fetch','location','addEventListener','removeEventListener','__patchParser'])old[key]=globalThis[key];
 const create=URL.createObjectURL,revoke=URL.revokeObjectURL,urls=new Map(),revoked=[],requests=[],parses=[];
 URL.createObjectURL=blob=>{const url='blob:synthetic-'+urls.size;urls.set(url,blob);return url;};URL.revokeObjectURL=url=>revoked.push(url);
 globalThis.location=new URL('http://127.0.0.1:48731/');globalThis.addEventListener=()=>{};globalThis.removeEventListener=()=>{};
 globalThis.__patchParser=value=>{parses.push(value);return require('parse-diff')(value);};
 let current={bytes:patch,mime:'application/octet-stream',name:'review.PATCH',status:200};
 globalThis.fetch=async(input,init)=>{requests.push({input,init});if(fetcher)return fetcher(input,init);return new Response(current.bytes,{status:current.status,headers:{'Content-Type':current.mime,'Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(current.name),'X-Homer-Artifact-Hash':'synthetic-hash'}});};
 try{await withDom(async d=>{
  const draft=module.createAnnotationDraft(),control=React.createRef(),create=d.doc.createElement;
  d.doc.createElement=name=>{const n=create(name);if(name==='template')n.content={querySelectorAll:()=>[]};return n;};
  const render=async(value={},extra={})=>{current={bytes:patch,mime:'application/octet-stream',name:'review.PATCH',status:200,...value};await d.render(h(module.CanvasReader,{key:extra.key??current.name,artifact:{id:current.name,title:current.name},annotationDraft:draft,actions:null,imageControl:control,onReference:()=>{throw Error('patch_must_not_annotate');},onClose:()=>{},...extra}));await act(async()=>{});};
  await run({...d,render,urls,revoked,requests,parses,draft});
 });}finally{URL.createObjectURL=create;URL.revokeObjectURL=revoke;for(const key of Object.keys(old)){if(old[key]===undefined)delete globalThis[key];else globalThis[key]=old[key];}}
}
const slot=d=>d.find(n=>n.getAttribute?.('data-slot')==='diff-viewer');

test('generic MIME patch is decoded and rendered by the real unified viewer, retaining raw bytes',async()=>fixture(async d=>{
 await d.render();assert.ok(slot(d),'generic MIME .PATCH must reach the official viewer');
 assert.equal(slot(d).getAttribute('data-view-mode'),'unified');
 assert.ok(slot(d).textContent.includes('old'));assert.ok(slot(d).textContent.includes('new'));
 const download=d.find(n=>n.tagName==='A'&&n.getAttribute('download')==='review.PATCH');assert.ok(download);
 assert.equal(await d.urls.get(download.getAttribute('href')).text(),patch);
 assert.equal(d.find(n=>n.tagName==='PRE').textContent,patch);assert.equal(d.requests.length,1);assert.equal(d.requests[0].init.credentials,'omit');
 assert.equal(d.parses.length,1);await d.render({}, {key:'review.PATCH'});assert.equal(d.parses.length,1);
}));


test('the official renderer consumes multiple files, additions, deletions, rename metadata and no-newline markers',async()=>fixture(async d=>{
 const multi=patch+String.raw`diff --git a/new.txt b/new.txt
new file mode 100644
--- /dev/null
+++ b/new.txt
@@ -0,0 +1,2 @@
+first
+second
\ No newline at end of file
diff --git a/removed.txt b/removed.txt
deleted file mode 100644
--- a/removed.txt
+++ /dev/null
@@ -1 +0,0 @@
-removed
diff --git a/before.txt b/after.txt
similarity index 60%
rename from before.txt
rename to after.txt
--- a/before.txt
+++ b/after.txt
@@ -1 +1 @@
-before
+after
`;
 await d.render({bytes:multi});assert.ok(slot(d));
 const text=slot(d).textContent;for(const value of ['a.txt','new.txt','removed.txt','after.txt','first','second','removed','No newline'])assert.ok(text.includes(value),value);
 assert.equal(d.parses.length,1);assert.equal(d.parses[0],multi);
 // The raw view preserves metadata even when the official line projection omits it.
 assert.equal(d.find(n=>n.tagName==='PRE').textContent,multi);
 const rows=d.all().filter(n=>n.getAttribute?.('data-slot')==='diff-viewer-line');
 assert.deepEqual(rows.map(n=>[n.getAttribute('data-type'),n.childNodes.find(c=>c.getAttribute?.('data-slot')==='diff-viewer-line-number').textContent]),[['del','1'],['add','1'],['add','1'],['add','2'],['marker',''],['del','1'],['del','1'],['add','1']]);
}));

test('empty, non-diff, metadata-only, binary, combined and non-UTF8 inputs preserve raw download without parsing',async()=>fixture(async d=>{
 for(const [name,bytes] of [
  ['empty.patch',''],['space.patch',' \n'],['text.diff','ordinary text'],['metadata.patch','diff --git a/a b/b\nrename from a\nrename to b\n'],
  ['binary.diff',patch+'GIT binary patch\nliteral 1\nA\n'],['binary-marker.diff',patch+'Binary files a/x and b/x differ\n'],
  ['combined.patch','diff --cc a\n@@@ -1,1 -1,1 +1,1 @@@\n++value\n'],['mixed-combined.patch',patch+'diff --combined a\n@@@ -1,1 -1,1 +1,1 @@@\n'],
  ['nul.patch',Buffer.concat([Buffer.from(patch),Buffer.from([0])])],['encoding.diff',Buffer.concat([Buffer.from(patch),Buffer.from([255])])],
 ]){
  const calls=d.parses.length;await d.render({name,bytes});assert.equal(slot(d),undefined,name);assert.equal(d.parses.length,calls,name);
  const a=d.find(n=>n.tagName==='A'&&n.getAttribute('download')===name);assert.ok(a,name);
  assert.deepEqual(Buffer.from(await d.urls.get(a.getAttribute('href')).arrayBuffer()),Buffer.from(bytes),name);
  assert.ok(d.find(n=>n.getAttribute('role')==='status'),name);
 }
}));

test('malformed and truncated candidates always retain exact raw text and download',async()=>fixture(async d=>{
 for(const [name,bytes] of [['malformed.patch','@@ -1 +1 @@\ninvalid hunk'],['truncated.diff',patch+'--- a/missing\n+++ b/missing\n@@ -3,8 +2,5 @@\n+partial\n']]){
  await d.render({name,bytes});assert.ok(d.find(n=>n.tagName==='PRE').textContent===bytes);
  assert.ok(d.find(n=>n.tagName==='A'&&n.getAttribute('download')===name));
 }
}));

test('size and line gates skip the parser, bound decoded prefixes, and retain complete downloads',async()=>fixture(async d=>{
 const maxBytes=256*1024,maxLines=2000;
 const values=[
  ['byte-boundary.patch',patch+'x'.repeat(maxBytes-Buffer.byteLength(patch)),true],
  ['byte-over.patch',patch+'x'.repeat(maxBytes+1-Buffer.byteLength(patch)),false],
  ['huge.patch',patch+'界'.repeat(400000),false],
  ['line-boundary.diff',patch+'\n'.repeat(maxLines-(patch.match(/\n/g).length+1)),true],
  ['line-over.diff',patch+'\n'.repeat(maxLines-(patch.match(/\n/g).length+1)+1),false],
 ];
 for(const [name,bytes,rendered] of values){
  const before=d.parses.length;await d.render({name,bytes});assert.equal(!!slot(d),rendered,name);assert.equal(d.parses.length-before,rendered?1:0,name);
  const a=d.find(n=>n.tagName==='A'&&n.getAttribute('download')===name),blob=d.urls.get(a.getAttribute('href'));
  assert.deepEqual(Buffer.from(await blob.arrayBuffer()),Buffer.from(bytes));
  const raw=d.find(n=>n.tagName==='PRE').textContent;
  if(Buffer.byteLength(bytes)>maxBytes){assert.ok(Buffer.byteLength(raw)<=128*1024+3);assert.ok(d.container.textContent.includes('仅显示开头'));}else assert.equal(raw,bytes);
 }
}));

test('explicit format MIME wins over a patch suffix; diff MIME and generic suffixes alone select patch',async()=>fixture(async d=>{
 for(const [name,mime,expected] of [
  ['a.patch','text/html','IFRAME'],['b.patch','text/markdown','DIV'],['c.patch','application/json','PRE'],['d.patch','image/png','IMG'],['e.patch','application/pdf','IFRAME'],
  ['notes.txt','text/plain','PRE'],['file.bin','application/octet-stream',null],
 ]){
  const before=d.parses.length;await d.render({name,mime,bytes:mime==='application/json'?'{}':patch});assert.equal(slot(d),undefined,name);assert.equal(d.parses.length,before,name);
  if(expected)assert.ok(d.find(n=>n.tagName===expected),name);
  if(name==='notes.txt'||name==='c.patch')assert.ok(d.find(n=>n.getAttribute('data-preview-text')!==null));
 }
 for(const [name,mime] of [['type.bin','text/x-diff'],['type2.bin','application/x-patch'],['type3.bin','application/x-diff'],['type4.bin','text/x-patch'],['upper.DIFF','text/plain'],['empty.patch','']]){
  await d.render({name,mime},{referencesEnabled:true});assert.ok(slot(d),name);assert.equal(d.find(n=>n.getAttribute('data-preview-text')!==null),undefined);
 }
}));

test('HTTP denial is a read error and retrying clears it before a patch loads',async()=>fixture(async d=>{
 await d.render({status:403});assert.equal(slot(d),undefined);assert.ok(d.find(n=>n.getAttribute('role')==='alert').textContent.includes('403'));
 await d.render({status:200});assert.equal(d.requests.length,1);await d.click(d.find(n=>n.tagName==='BUTTON'&&n.textContent==='重试读取'));await act(async()=>{});assert.ok(slot(d));assert.equal(d.requests.length,2);assert.equal(d.find(n=>n.getAttribute('role')==='alert'),undefined);
}));

test('a late response and late Blob text after navigation cannot replace the new reader; live URLs are revoked',async()=>{
 for(const delayedText of [false,true]){
  let release,seen=0;
  await fixture(async d=>{
   await d.render({name:'delayed.patch'});assert.ok(release);const first=d.requests[0];
   await d.render({name:'current.diff'});assert.ok(slot(d));assert.equal(first.init.signal.aborted,true);
   const live=[...d.urls.keys()];assert.equal(live.length,1);
   await act(async()=>{release();});assert.equal(d.urls.size,1);assert.ok(slot(d));
   assert.equal(d.find(n=>n.tagName==='A').getAttribute('download'),'current.diff');
   await d.remount();assert.deepEqual(d.revoked,live);
  },{fetcher:async()=>{
   if(++seen===1){
    if(!delayedText){await new Promise(resolve=>{release=resolve;});return new Response(patch,{headers:{'Content-Type':'application/octet-stream'}});}
    const blob=new Blob([patch]);const slice=blob.slice.bind(blob);blob.slice=(...args)=>{const part=slice(...args);part.text=()=>new Promise(resolve=>{release=()=>resolve(patch);});return part;};
    return {ok:true,headers:new Headers({'Content-Type':'application/octet-stream'}),blob:async()=>blob};
   }
   return new Response(patch,{headers:{'Content-Type':'application/octet-stream'}});
  }});
 }
});

test('parser errors and lazy rejection retain raw/download; a new file resets the boundary',async()=>{
 for(const mode of ['parse-error','lazy-error']){
  const errors=[],original=console.error;console.error=(...args)=>errors.push(args.map(String).join(' '));
  try{await fixture(async d=>{
   const bytes=mode==='parse-error'?'--- a/bad\n+++ b/bad\n@@ -1 +1 @@\n\\ No newline at end of file\n':patch;
   await d.render({bytes});assert.equal(slot(d),undefined);assert.ok(d.container.textContent.includes('差异预览失败'));
   assert.equal(d.find(n=>n.tagName==='PRE').textContent,bytes);assert.ok(d.find(n=>n.tagName==='A'));
   await d.render({name:'other.txt',bytes:'ordinary',mime:'text/plain'});assert.equal(d.container.textContent,'ordinary');
   assert.ok(errors.some(e=>e.includes(mode==='parse-error'?'TypeError':'synthetic_chunk_failure')));
   await d.render({name:'next.patch',bytes:patch});
   if(mode==='parse-error')assert.ok(slot(d));else assert.ok(d.container.textContent.includes('差异预览失败'));
  },{module:mode==='lazy-error'?await reader('lazy-error'):component});}finally{console.error=original;}
 }
 // A rejected lazy import needs a page reload; navigation still retains raw/download.
 await fixture(async d=>{await d.render();assert.ok(slot(d));});
});


test('patch payload markup stays escaped text and cannot create executable elements or derived requests',async()=>fixture(async d=>{
 const payload='--- a/x\n+++ b/x\n@@ -0,0 +1 @@\n+<script src="https://example.invalid/a">alert(1)</script><img src=x onerror=alert(1)>\n';
 await d.render({bytes:payload},{referencesEnabled:true});assert.ok(slot(d));assert.ok(slot(d).textContent.includes('<script'));
 assert.equal(d.find(n=>n.tagName==='SCRIPT'||n.tagName==='IMG'||n.tagName==='IFRAME'),undefined);assert.equal(d.requests.length,1);
 assert.equal(d.draft.read().resourceReferences,undefined);
}));

test('large diffs initially render 200 rows and expand without reparsing or losing raw bytes',async()=>fixture(async d=>{
 const bytes='--- a/many\n+++ b/many\n@@ -0,0 +1,1980 @@\n'+'+line\n'.repeat(1980);
 const rows=()=>d.all().filter(n=>n.getAttribute?.('data-slot')==='diff-viewer-line').length;
 await d.render({bytes});assert.equal(rows(),200);
 assert.equal(d.find(n=>n.tagName==='PRE').textContent,bytes);
 const download=d.find(n=>n.tagName==='A'&&n.getAttribute('download'));assert.equal(await d.urls.get(download.getAttribute('href')).text(),bytes);
 await d.click(d.find(n=>n.tagName==='BUTTON'&&n.getAttribute('aria-expanded')==='false'));assert.equal(rows(),1980);
 await d.click(d.find(n=>n.tagName==='BUTTON'&&n.getAttribute('aria-expanded')==='true'));assert.equal(rows(),200);
 assert.equal(d.parses.length,1);await d.render({bytes});assert.equal(d.parses.length,1);
}));


test('official per-file copy reconstructs a diff while original download retains metadata and bytes',async()=>{
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'navigator'),copied=[];
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard:{writeText:async text=>{copied.push(text);}}}});
 try{await fixture(async d=>{
  const bytes=patch.replace('--- a/a.txt','index 1111111..2222222 100644\n--- a/a.txt');await d.render({bytes});
  await d.click(d.find(n=>n.tagName==='BUTTON'&&n.getAttribute('aria-label')==='Copy diff of a.txt'));
  assert.equal(copied.length,1);assert.ok(copied[0].includes('-old\n+new'));assert.ok(!copied[0].includes('index 1111111'));
  const a=d.find(n=>n.tagName==='A'&&n.getAttribute('download')==='review.PATCH');assert.equal(await d.urls.get(a.getAttribute('href')).text(),bytes);
  const large='--- a/many\n+++ b/many\n@@ -0,0 +1,1980 @@\n'+'+line\n'.repeat(1980);
  await d.render({name:'large.patch',bytes:large});await d.click(d.find(n=>n.tagName==='BUTTON'&&n.getAttribute('aria-label')==='Copy diff of many'));
  assert.equal(copied.at(-1).split('\n').filter(line=>line==='+line').length,1980);
 });}finally{if(descriptor)Object.defineProperty(globalThis,'navigator',descriptor);else delete globalThis.navigator;}
});


test('patch downloads use the shared platform adapter, report failure and clear it after retry',async()=>{
 const old=globalThis.__patchDownload,calls=[];let fail=true;
 globalThis.__patchDownload=async(blob,name)=>{calls.push({blob,name});if(fail)throw Error('synthetic_share_failure');};
 try{await fixture(async d=>{
  await d.render();const download=()=>d.find(n=>n.tagName==='A'&&n.getAttribute('download')==='review.PATCH');
  await d.click(download());assert.equal(calls.length,1);assert.equal(await calls[0].blob.text(),patch);assert.equal(calls[0].name,'review.PATCH');
  assert.ok(d.container.textContent.includes('下载未完成'));assert.ok(slot(d));
  fail=false;await d.click(download());assert.equal(calls.length,2);assert.ok(!d.container.textContent.includes('下载未完成'));
 },{module:await reader('download')});}finally{if(old===undefined)delete globalThis.__patchDownload;else globalThis.__patchDownload=old;}
});
