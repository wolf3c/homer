import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {buildSync} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const source=readFileSync(new URL('../ui/homer-app.tsx',import.meta.url),'utf8');
const built=buildSync({stdin:{contents:[
 'import {useState,useCallback} from "react";',
 'import {ReferenceCard} from "./reference-card";',
 'import {LazyMedia} from "./lazy-media";',
 'import {ImageRoot,ImageZoom,ImagePreview} from "./vendor/assistant-ui/image";',
 'import {FileRoot,FileIconDisplay,FileName,FileSize,FileDownload} from "./vendor/assistant-ui/file";',
 'import {ResourceReferenceBlock} from "./preview-reference";',
 'import {referenceKey} from "../src/preview-reference";',
 source.slice(source.indexOf('function ResourceDownload('),source.indexOf('const ArtifactsContext=')),
 'export {MediaAttachments,ResourceReferenceBlock};',
].join('\n'),resolveDir:new URL('../ui/',import.meta.url).pathname,loader:'tsx'},bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',external:['react','react-dom','react/jsx-runtime'],loader:{'.css':'empty'}});
const mod={exports:{}};
Function('require','module','exports',built.outputFiles[0].text)(createRequire(import.meta.url),mod,mod.exports);
const {ResourceReferenceBlock,MediaAttachments}=mod.exports;
const image={assetId:'asset-00000000-0000-4000-8000-000000000001',revision:1};
const notes=[{id:'one',region:{x:10,y:20,width:30,height:40},comment:'第一条\n保留换行'},{id:'two',region:{x:60,y:80,width:90,height:100},comment:'第二条原文'}];
const reference={kind:'image',source:{kind:'draft-image'},width:960,height:540,image,annotations:notes,ax:[{role:'AXStaticText',name:'截图的窗口摘录'}]};
const html=element=>renderToStaticMarkup(element);

test('a paired image and its annotations share the reference card display',()=>{
 const output=html(React.createElement(MediaAttachments,{messageId:'synthetic-user',media:[media()],references:[reference]}));
 assert.equal((output.match(/data-slot="reference-card"/g)??[]).length,2);
});

test('image comments are full primary text and coordinates are disclosed on demand',()=>{
 const output=html(React.createElement(ResourceReferenceBlock,{reference},React.createElement('figure',null,'合成图片')));
 assert.match(output,/<ol[^>]*aria-label="图片区域批注"/);
 for(const note of notes)assert.ok(output.includes(note.comment));
 assert.ok(output.indexOf('第一条')<output.indexOf('<details'));
 assert.ok(output.includes('<summary>截图来源与区域</summary>'));
 assert.ok(output.indexOf('10, 20')>output.indexOf('<details'));
 assert.equal((output.match(/合成图片/g)??[]).length,1);
});
const media=extra=>({...image,filename:'合成截图.png',kind:'image',state:'ready',mime:'image/png',size:100,error:null,...extra});
test('the exact attachment identity is shown once beside its reference',()=>{
 const output=html(React.createElement(MediaAttachments,{messageId:'synthetic-user',media:[media()],references:[reference]}));
 assert.equal((output.match(/<figure\b[^>]*\bclass="[^"]*\bmessage-attachment\b[^"]*"/g)??[]).length,1);
 assert.match(output,/class="image-reference-image"/);
 for(const note of notes)assert.ok(output.includes(note.comment));
});
test('the conversation bubble shows screenshot regions and comments without screenshot details or window text',()=>{
 const before=structuredClone(reference);
 const output=html(React.createElement(MediaAttachments,{messageId:'synthetic-user',media:[media()],references:[reference],hideScreenshotDetails:true}));
 assert.match(output,/class="image-reference-image"/);
 assert.match(output,/class="image-reference-region"/);
 for(const note of notes)assert.ok(output.includes(note.comment));
 assert.doesNotMatch(output,/截图来源与区域|窗口文字|截图的窗口摘录|10, 20/);
 assert.deepEqual(reference,before);
 const otherSurface=html(React.createElement(MediaAttachments,{messageId:'synthetic-user',media:[media()],references:[reference]}));
 assert.match(otherSurface,/截图来源与区域/);
 assert.match(otherSurface,/窗口文字/);
});
test('long images keep their ratio within a bounded preview and long notes retain their full text in a native disclosure',()=>{
 const comment='完整长批注\n'.repeat(80),long={...reference,width:600,height:4000,annotations:[{...notes[0],comment}]};
 const output=html(React.createElement(ResourceReferenceBlock,{reference:long},React.createElement('figure',null,'长图')));
 assert.match(output,/max-width:54px/);
 assert.match(output,/<details class="image-reference-long-comment"><summary>/);
 assert.ok(output.includes(comment));
 assert.doesNotMatch(output,/<details class="image-reference-long-comment" open/);
 const short=html(React.createElement(ResourceReferenceBlock,{reference}));
 assert.doesNotMatch(short,/image-reference-long-comment/);
 for(const note of notes)assert.ok(short.includes(note.comment));
});
test('a different revision cannot be paired and missing media never removes comments',()=>{
 for(const assets of [[],[media({revision:2})],[media({state:'revoked'})]]){
  const output=html(React.createElement(MediaAttachments,{messageId:'synthetic-user',media:assets,references:[reference]}));
  assert.doesNotMatch(output,/class="image-reference-image"/);
  for(const note of notes)assert.ok(output.includes(note.comment));
  assert.equal((output.match(/<figure\b[^>]*\bclass="[^"]*\bmessage-attachment\b[^"]*"/g)??[]).length,assets.length);
 }
});
test('legacy single-region text and AX-only controls retain their contents',()=>{
 const legacy={...reference,annotations:undefined,region:notes[0].region,comment:notes[0].comment};
 const output=html(React.createElement(ResourceReferenceBlock,{reference:legacy}));
 assert.match(output,/<ol[^>]*aria-label="图片区域批注"/);assert.ok(output.includes(notes[0].comment));
 const ax={...reference,annotations:[],ax:[{role:'AXStaticText',name:'原窗口摘录'}]};
 const axOutput=html(React.createElement(ResourceReferenceBlock,{reference:ax}));
 assert.match(axOutput,/<summary\b[^>]*>窗口文字<\/summary>/);assert.ok(axOutput.includes('原窗口摘录'));
 assert.doesNotMatch(axOutput,/图片区域批注/);
});
test('several references never duplicate an attachment or swallow an AX-only image',()=>{
 const ax={...reference,annotations:[],ax:[{role:'AXStaticText',name:'原窗口摘录'}]};
 const duplicate={...reference,annotations:[{...notes[0],id:'three',comment:'另一份批注'}]};
 for(const references of [[ax],[reference,duplicate],[ax,reference]]){
  const output=html(React.createElement(MediaAttachments,{messageId:'synthetic-user',media:[media()],references}));
  assert.equal((output.match(/<figure\b[^>]*\bclass="[^"]*\bmessage-attachment\b[^"]*"/g)??[]).length,1);
  for(const item of references)for(const note of item.annotations)assert.ok(output.includes(note.comment));
  if(references.includes(ax))assert.ok(output.includes('原窗口摘录'));
 }
});
