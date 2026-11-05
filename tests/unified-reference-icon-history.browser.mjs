// Requirement-derived render checks against the real HomerApp and synthetic HTTP.
import assert from 'node:assert/strict';
import {resolve,join} from 'node:path';
import {mkdirSync,writeFileSync} from 'node:fs';
import {composerFixture} from './fixtures/composer-browser-server.mjs';
import {isolatedChrome} from './web-history-browser-cdp.mjs';
const root=resolve(process.env.HOMER_REVIEW_EVIDENCE_ROOT??'.codex/scratch/unified-reference-icon-regression'),destination=join(root,'history'),webDir=resolve(process.env.HISTORY_FOLLOWUP_BUILD??join(root,'candidate-web'));mkdirSync(destination,{recursive:true});
const fixture=await composerFixture({webDir,beforeDir:webDir,branding:resolve('assets/branding/odysseus-20261030/homer-odysseus-256.png')});
const long='这是合成历史引用的完整正文。'.repeat(100),source={kind:'artifact',id:'result-history-text',title:'历史成果.txt',sha256:'a'.repeat(64)};
const msg=(id,extra)=>({id,threadId:'composer-review',requestId:id,role:'user',text:'合成说明',status:'completed',createdAt:1700000000000,...extra});
const messages=[
 msg('single',{quotes:[{messageId:'source',text:long,annotation:''}]}),
 msg('annotated',{quotes:[{messageId:'source',text:long,annotation:'保留原批注'}]}),
 msg('multiple',{quotes:[{messageId:'source',text:long,annotation:''},{messageId:'other',text:'第二条合成引用',annotation:'保留第二条批注'}]}),
 msg('file',{resourceReference:{kind:'text',source,annotations:[{id:'note-one',text:long,comment:'合成文件批注'},{id:'note-two',text:'第二处摘录',comment:'第二处批注'}]}}),
];
fixture.reset({messages,features:{draftUpload:true,taskOverview:false}});let chrome;const checks=[];
try{
 chrome=await isolatedChrome(destination);
 for(const width of [1440,390,320]){
  const p=await chrome.page(fixture.url,width);try{
   await p.navigate();await p.until(()=>document.querySelectorAll('[data-slot=quote-block-icon]').length===5,10000);
   const result=await p.evaluate(()=>({icons:[...document.querySelectorAll('[data-slot=quote-block-icon]')].map(e=>({name:e.getAttribute('class'),width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height})),clamps:['single','annotated','multiple'].map(id=>getComputedStyle(document.querySelector('#message-'+id+' [data-slot=quote-block-text]')).webkitLineClamp),full:document.querySelector('#message-annotated [data-slot=quote-block-text]').textContent.length,file:document.querySelector('#message-file [data-slot=quote-block-text]').textContent,fileClamp:getComputedStyle(document.querySelector('#message-file [data-slot=quote-block-text]')).webkitLineClamp,overflow:document.documentElement.scrollWidth>innerWidth}));
   assert.ok(result.icons.every(icon=>icon.name.includes('lucide-message-circle-plus')&&icon.width===12&&icon.height===12));assert.deepEqual(result.clamps,['2','none','none']);assert.equal(result.full,long.length);assert.ok(result.file.includes('第二处批注')&&result.file.includes('合成文件批注'));assert.equal(result.fileClamp,'none');assert.equal(result.overflow,false);assert.equal(fixture.received.messages.length,0);assert.deepEqual(p.errors,[]);
   await p.screenshot('historical-references-'+width+'.png');checks.push({width,...result});console.log(width,'single quote stays two lines; annotated, multiple and resource references retain full content and unified 12px icons');
  }finally{await p.close();}
 }
 writeFileSync(join(destination,'result.json'),JSON.stringify({checks},null,2));
}finally{await chrome?.close();await fixture.close();}
