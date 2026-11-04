// Full copy/download and ordinary streaming remain on their original owners.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fixture} from './web-history-followup-fixture.mjs';
import {syntheticFile} from './recursive-publication-fixture.js';
import {isolatedChrome} from './web-history-browser-cdp.mjs';
const destination=resolve(process.env.HOMER_REVIEW_EVIDENCE_ROOT??process.env.HOMER_BROWSER_EVIDENCE??'.codex/scratch/web-history-loading-implementation/kerning-approved');mkdirSync(destination,{recursive:true});
const sha=value=>createHash('sha256').update(value).digest('hex'),delay=ms=>new Promise(done=>setTimeout(done,ms));
const rich='# 中英文 AV To\n\n系统字体与完整 Markdown。**Bold** and *italic* remain. AV To WA.\n\n- 完整列表\n- Ordinary streaming\n\n| 中文 | English |\n| --- | --- |\n| 原答复 | AV To |\n\n```javascript\nconst source = "完整正文 AV To";\n```\n\n公式 $E=mc^2$。\n';
// Markdown result owner already caps authored files at 128KiB; do not change it.
const fileText=rich+'d'.repeat(65536-Buffer.byteLength(rich));
const f=await fixture(40,'after'),node=f.processes.exact('node-39');
f.store.startRequest('request-0','synthetic-kerning-download');
const made=syntheticFile(f,'request-0','complete-kerning-markdown.md',fileText),delivery=made.publish('完整授权文件');
f.history.record(delivery.historyMessageId,'synthetic-history',delivery.text);f.tasks.markDelivery(delivery.id,'recorded');
node.state='working';node.status='running';delete node.endEventId;node.final={id:'streaming-final',text:rich};node.items=[{id:'working-commentary',kind:'commentary',seq:1,revision:1,phase:'commentary',text:'Working 显式展开，AV To 中文过程。'}];
node.items.push({id:'streaming-final',kind:'commentary',phase:'final_answer',seq:2,revision:1,text:rich});
f.store.db.prepare('UPDATE conversation_messages SET text=? WHERE id=?').run(rich,'node-39');
f.store.setMeta('publicMainNode:v1:node-39',JSON.stringify(node));
const chrome=await isolatedChrome(destination),rows=[];
try{for(const width of [1440,390,320]){
 const page=await chrome.page(f.server.url,width);
 try{
  await page.command('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'dark'}]});
  await page.command('Page.addScriptToEvaluateOnNewDocument',{source:`window.__copied=[];Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>window.__copied.push(text)},configurable:true});`});
  await page.navigate();await page.until(()=>!!document.querySelector('#message-node-39 [data-slot=collapsible-trigger]'));await page.evaluate(()=>document.querySelector('#message-node-39 [data-slot=collapsible-trigger]').click());await page.until(()=>!!document.querySelector('#message-node-39 .katex')&&!!document.querySelector('#message-node-39 [data-slot=collapsible-content] .markdown'));
  await page.evaluate(()=>{const box=document.querySelector('[contenteditable=true]');box.focus();window.__composer=box;});await page.command('Input.insertText',{text:'草稿 AV To 不丢失'});
  const initialDraft=await page.evaluate(()=>document.querySelector('[contenteditable=true]').textContent);
  const observed=[];
  for(let n=0;n<3;n++){
   const text=rich+'\n流式新增 '+n+' AV To';node.final={id:'streaming-final',text};node.revision++;node.items=node.items.map(item=>item.id==='streaming-final'?{...item,revision:item.revision+1,text}:item);await page.evaluate('window.__expectedChunk='+n);
   f.store.db.prepare('UPDATE conversation_messages SET text=? WHERE id=?').run(text,'node-39');f.store.setMeta('publicMainNode:v1:node-39',JSON.stringify(node));f.server.publish();
   await page.until(()=>document.querySelector('#message-node-39 [data-aui-quote-selectable]')?.textContent.includes('流式新增 '+window.__expectedChunk));
   // The cursor value is compared below; no remount or draft replacement is allowed.
   observed.push(await page.evaluate(()=>({same:window.__composer===document.querySelector('[contenteditable=true]'),focused:document.activeElement===window.__composer,draft:window.__composer.textContent,selection:window.getSelection()?.anchorOffset})));
  }
  assert.ok(observed.every(value=>value.same&&value.focused&&value.draft===initialDraft));assert.ok(observed.every(value=>value.selection===observed[0].selection));
  const expected=node.final.text;
  await page.evaluate(()=>document.querySelector('#message-node-39 [aria-label="复制"]').click());await page.until(()=>window.__copied.length===1);const copied=await page.evaluate(()=>window.__copied[0]);assert.equal(copied,expected);
  const styles=await page.evaluate(()=>({conversation:getComputedStyle(document.querySelector('#message-node-39 [data-aui-quote-selectable] .markdown')).fontKerning,process:getComputedStyle(document.querySelector('#message-node-39 [data-slot=collapsible-content] .markdown')).fontKerning,composer:getComputedStyle(window.__composer).fontKerning,working:document.querySelector('#message-node-39 [data-slot=collapsible-trigger]').getAttribute('aria-expanded'),math:document.querySelectorAll('#message-node-39 .katex').length,table:document.querySelectorAll('#message-node-39 table').length,code:document.querySelectorAll('#message-node-39 pre code').length,overflow:document.documentElement.scrollWidth>innerWidth,darkPreference:matchMedia('(prefers-color-scheme:dark)').matches}));
  assert.equal(styles.conversation,'none');assert.equal(styles.process,'none');assert.equal(styles.composer,'auto');assert.equal(styles.working,'true');assert.equal(styles.overflow,false);assert.ok(styles.math&&styles.table&&styles.code);
  await page.evaluate(()=>{const view=document.querySelector('.thread-viewport');view.scrollTop=view.scrollHeight;});await delay(100);await page.screenshot('approved-markdown-dark-preference-'+width+'.png');
  let download=null;
  if(width===1440){
   await page.evaluate(()=>document.querySelector('.file-list-open[aria-label="预览 complete-kerning-markdown.md"]').click());await page.until(()=>!!document.querySelector('#canvas-panel .canvas-markdown'));
   const canvasKerning=await page.evaluate(()=>getComputedStyle(document.querySelector('#canvas-panel .canvas-markdown')).fontKerning);assert.equal(canvasKerning,'auto');
   assert.equal(await page.evaluate(()=>document.querySelectorAll('#canvas-panel a[download]').length),0);
   const response=await fetch(f.server.url+'/api/files/'+made.resultId);assert.equal(response.status,200);const bytes=Buffer.from(await response.arrayBuffer());assert.equal(bytes.toString('utf8'),fileText);
   download={method:'authorized file HTTP bytes; published-file download UI retired',bytes:bytes.length,sha256:sha(bytes),expectedSha256:sha(fileText),canvasKerning};
  }
  rows.push({width,styles,streaming:observed,copy:{bytes:Buffer.byteLength(copied),sha256:sha(copied),method:'UI click, captured clipboard.writeText; OS clipboard untouched'},download,errors:page.errors,submits:f.submitted.length});assert.deepEqual(page.errors,[]);assert.equal(f.submitted.length,0);
 }finally{await page.close();}
}}finally{await chrome.close();await f.close();writeFileSync(join(destination,'approved-markdown-copy-download-streaming.json'),JSON.stringify({browser:chrome.version,rows},null,2));}
