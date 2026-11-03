import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {buildSync} from 'esbuild';
import {act} from 'react';
import {withDom,React,descendants} from './helpers/process-dom.mjs';

// Keep the real MediaAttachment, LazyMedia, vendor previews and React DOM.
// Only browser intersection, network and image decode events are synthetic;
// this does not verify browser layout or actual image decoding.
const source=readFileSync(new URL('../ui/homer-app.tsx',import.meta.url),'utf8');
const result=buildSync({stdin:{contents:[
 'import {useState,useCallback,useEffect} from "react";',
 'import {LazyMedia} from "./lazy-media";',
 'import {ImageRoot,ImageZoom,ImagePreview} from "./vendor/assistant-ui/image";',
 'import {FileRoot,FileIconDisplay,FileName,FileSize,FileDownload} from "./vendor/assistant-ui/file";',
 'import {connectionFetch as fetch} from "./web-connection-client";',
 source.slice(source.indexOf('function ResourceDownload('),source.indexOf('function MediaAttachments(')),
 'export {MediaAttachment};',
].join('\n'),loader:'tsx',resolveDir:fileURLToPath(new URL('../ui/',import.meta.url))},bundle:true,write:false,format:'cjs',platform:'node',jsx:'automatic',external:['react','react/jsx-runtime','react-dom'],loader:{'.css':'empty'}});
const module={exports:{}};Function('require','module','exports',result.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
const {MediaAttachment}=module.exports;
const image={assetId:'synthetic-image',revision:1,state:'ready',kind:'image',filename:'image.png',mime:'image/png',size:94720,error:null};
const slot=(dom,name)=>dom.find(n=>n.getAttribute?.('data-slot')===name);
const evidence=[];
function snapshot(dom,phase){
 const serialize=node=>({tag:node.tagName??'#text',attrs:node.attrs,text:node._text,children:node.childNodes.map(serialize)});
 evidence.push({phase,syntheticOnly:true,dom:serialize(dom.container)});
 if(process.env.HOMER_IMAGE_DOM_EVIDENCE)writeFileSync(process.env.HOMER_IMAGE_DOM_EVIDENCE,JSON.stringify(evidence,null,2));
}
async function fixture(run,{failFetch=false}={}){
 const old={fetch:globalThis.fetch,location:globalThis.location,observer:globalThis.IntersectionObserver};
 const observers=[];let requests=0;
 globalThis.location=new URL('http://127.0.0.1:4780/');
 globalThis.fetch=async()=>{requests++;return failFetch?new Response('',{status:503}):new Response(new Blob(['synthetic image bytes'],{type:'image/png'}));};
 globalThis.IntersectionObserver=class{constructor(callback){this.callback=callback;observers.push(this);}observe(node){this.node=node;}disconnect(){this.node=null;}};
 try{await withDom(async dom=>{
  const create=dom.doc.createElement;dom.doc.createElement=name=>{const node=create(name);node.closest=()=>null;return node;};dom.doc.body=dom.doc.createElement('body');
  const render=asset=>dom.render(React.createElement(MediaAttachment,{asset,messageId:'synthetic-message',index:0}));
  const near=async value=>act(async()=>{for(const o of observers)if(o.node)o.callback([{isIntersecting:value}]);});
  const event=async(type,node=dom.find(n=>n.tagName==='IMG'))=>act(async()=>{assert.ok(node,'expected image node');if(type==='load')node.naturalWidth=4;for(const listener of node.listeners[type]??[])listener.handler({type,target:node,bubbles:false,preventDefault(){},stopPropagation(){}});});
  await run({...dom,render,near,event,requests:()=>requests});
 });}finally{globalThis.fetch=old.fetch;globalThis.location=old.location;globalThis.IntersectionObserver=old.observer;}
}

test('decoded image removes its duplicate card and restores fallback across lazy reloads and revision changes',async()=>{
 await fixture(async dom=>{
  await dom.render(image);assert.ok(slot(dom,'file-root'),'pending lazy preview keeps identifiable fallback');
  await dom.near(true);assert.ok(slot(dom,'image-preview'));assert.ok(slot(dom,'file-root'),'Blob fetch alone must not hide the file');
  await dom.event('load');assert.ok(!slot(dom,'file-root'),'decoded image must not retain the duplicate file card');assert.ok(!dom.find(n=>n.tagName==='FIGCAPTION'));assert.ok(!dom.find(n=>n.getAttribute?.('class')==='media-preview-placeholder'));
  snapshot(dom,'decoded-image');
  await dom.click(dom.find(n=>n.getAttribute?.('aria-label')==='放大图片'));
  assert.ok(descendants(dom.doc.body).find(n=>n.getAttribute?.('data-slot')==='image-zoom-content'));
  await act(async()=>{const target=descendants(dom.doc.body).find(n=>n.getAttribute?.('data-slot')==='image-zoom-close');for(const listener of dom.doc.body.listeners.click??[])if(!listener.capture)listener.handler({type:'click',target,button:0,bubbles:true,preventDefault(){},stopPropagation(){}});});
  assert.ok(!descendants(dom.doc.body).find(n=>n.getAttribute?.('data-slot')==='image-zoom-content'));
  await dom.near(false);assert.ok(slot(dom,'file-root'),'lazy cleanup must restore fallback before another request');
  await dom.near(true);assert.ok(slot(dom,'file-root'));await dom.event('load');assert.equal(slot(dom,'file-root'),undefined);
  await dom.render({...image,revision:2});assert.ok(slot(dom,'file-root'),'old decode success must not hide the new revision');
  await dom.near(true);
  await dom.event('error');assert.ok(slot(dom,'file-root'));assert.ok(slot(dom,'image-preview-error'));assert.ok(slot(dom,'file-download'));
  snapshot(dom,'decode-error');
 });
});

test('HTTP preview failure retains the named download card and reports a failed download',async()=>{
 await fixture(async dom=>{
  await dom.render(image);await dom.near(true);assert.equal(dom.requests(),1);assert.ok(dom.container.textContent.includes('image.png'));assert.ok(slot(dom,'file-size'));assert.ok(slot(dom,'file-download'));
  await dom.click(slot(dom,'file-download'));assert.ok(dom.container.textContent.includes('下载未完成'));assert.equal(dom.requests(),2);
  snapshot(dom,'http-and-download-error');
 },{failFetch:true});
});

test('ordinary files and unavailable images retain names, sizes and state feedback',async()=>{
 await fixture(async dom=>{
  await dom.render({...image,kind:'file',mime:'text/plain',filename:'notes.txt'});assert.ok(dom.container.textContent.includes('notes.txt'));assert.ok(slot(dom,'file-size'));assert.ok(slot(dom,'file-download'));assert.equal(slot(dom,'image-root'),undefined);
  snapshot(dom,'ordinary-file');
  for(const [state,label] of [['received','等待下载'],['downloading','准备中'],['retryable_failed','等待重试'],['failed','准备失败'],['expired','已过期'],['deleted','已清理'],['revoked','已撤回']]){
   await dom.render({...image,state});assert.ok(dom.container.textContent.includes('image.png'));assert.ok(dom.container.textContent.includes(label));assert.equal(slot(dom,'file-download'),undefined);assert.equal(slot(dom,'image-root'),undefined);
   snapshot(dom,state);
  }
 });
});
