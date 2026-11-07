// Current FileList/Canvas contract; real message attachment owners, synthetic data only.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fixture} from './web-history-followup-fixture.mjs';
import {isolatedChrome} from './web-history-browser-cdp.mjs';
const destination=resolve(process.env.HOMER_BROWSER_EVIDENCE??'.codex/scratch/artifact-file-list');
mkdirSync(destination,{recursive:true});
const browser=await isolatedChrome(destination),results=[];
const longName='long-name-'.repeat(6)+'完整名称.OPAQUE';
const names=['synthetic-preview.html','implementation-report.md','minimal-ui-diff.md'];
const html='<!doctype html><h1>Isolated synthetic HTML</h1><script>document.body.dataset.executed="yes"</script>';
try{for(const width of [1440,704,390,320]){
 const f=await fixture(100,'after'),page=await browser.page(f.server.url,width);
 try{
  const {paths}=f.attach('Synthetic file-list reply',[
   {filename:names[0],content:html,mime:'text/html'},
   {filename:names[1],content:'# Main implementation',mime:'text/markdown'},
   {filename:names[2],content:'# UI changes',mime:'text/markdown'},
  ]);
  f.attach('Synthetic long-name reply',[{filename:longName,content:'opaque',mime:'application/octet-stream'}]);
  await page.navigate();await page.until(()=>document.querySelectorAll('.messages .file-list').length===2&&!!document.querySelector('[contenteditable=true]'));
  assert.equal(page.requests.some(r=>r.path.startsWith('/api/media/')),false,'list rendering must not read file bodies');
  const rows=await page.evaluate(()=>[...document.querySelectorAll('.messages .file-list-open')].map(b=>{const name=b.querySelector('[data-slot=file-name]'),r=b.getBoundingClientRect();return {name:name.textContent,width:r.width,height:r.height,clipped:name.scrollWidth>name.clientWidth,whiteSpace:getComputedStyle(name).whiteSpace,description:document.getElementById(b.getAttribute('aria-describedby'))?.textContent};}));
  assert.deepEqual(rows.map(r=>r.name),[...names,longName]);
  assert.ok(rows.every(r=>r.width>=44&&r.height>=44&&!r.clipped&&r.whiteSpace==='normal'));
  assert.equal(rows[0].description,'HTML 文件');await page.screenshot('file-list-rows-'+width+'.png');
  await page.evaluate(()=>document.querySelector('[contenteditable=true]').focus());await page.command('Input.insertText',{text:'Synthetic draft remains intact'});
  const open=async name=>{await page.evaluate(`(()=>{const b=[...document.querySelectorAll('.messages .file-list-open')].find(b=>b.getAttribute('aria-label')===${JSON.stringify('预览 '+name)});b.scrollIntoView({block:'center'});b.focus();b.click();})()`);};
  await open(names[0]);await page.until(()=>!!document.querySelector('iframe[title="隔离 HTML 成果"]'));
  assert.equal(await page.evaluate(()=>document.querySelector('iframe[title="隔离 HTML 成果"]').getAttribute('sandbox')),'');
  assert.equal(await page.evaluate(()=>!!document.querySelector('#canvas-panel [data-preview-text]')),false,'HTML defaults to a static sandbox, not the retired source view');
  assert.equal(await page.evaluate(()=>document.querySelectorAll('#canvas-panel a[download]').length),0);
  if(width<=800){await page.command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await page.command('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'});}
  else await page.evaluate(()=>document.querySelector('.conversation-header [aria-controls=canvas-panel]').click());
  await page.until(()=>!document.querySelector('#canvas-panel'));
  assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'预览 '+names[0]);
  await open(names[1]);await page.until(()=>document.querySelector('.canvas-markdown')?.textContent.includes('Main implementation'));
  // Only explicitly opened files become tabs. A sibling is not read in advance.
  assert.equal(await page.evaluate(()=>document.querySelectorAll('.canvas-tab').length),2);
  assert.equal(page.requests.some(r=>r.path===paths[2]),false,'unopened sibling bytes must not be read');
  await page.evaluate(()=>document.querySelector('.canvas-tab[aria-label="synthetic-preview.html"]').click());
  await page.until(()=>!!document.querySelector('iframe[title="隔离 HTML 成果"]'));
  assert.equal(await page.evaluate(()=>document.querySelector('.canvas-tab[aria-selected=true]').getAttribute('aria-label')),names[0]);
  // A failed read and a superseded response must stay tied to the exact file.
  const read=f.bridge.media.read.bind(f.bridge.media);let release,fail=true;
  f.bridge.media.read=async selector=>{const file=await read(selector);if(fail){fail=false;return {...file,sha256:'0'.repeat(64)};}return file;};
  if(width<=800)await page.evaluate(()=>document.querySelector('.canvas-collapse').click());
  await open(names[2]);await page.until(()=>document.querySelector('.canvas-read-error')?.textContent.includes('附件版本已变化'));
  assert.equal(await page.evaluate(()=>!!document.querySelector('.canvas-markdown')),false,'a mismatched digest cannot display stale attachment content');
  await page.evaluate(()=>document.querySelector('.canvas-read-error button').click());await page.until(()=>document.querySelector('.canvas-markdown')?.textContent.includes('UI changes'));
  await page.evaluate(()=>{const original=window.fetch;window.__supersededReadAborted=false;window.fetch=async(...args)=>{try{return await original(...args);}catch(error){if(error.name==='AbortError'&&String(args[0]).startsWith('/api/media/'))window.__supersededReadAborted=true;throw error;}};});
  let delayedId;
  f.bridge.media.read=async id=>{if(!delayedId){delayedId=id;await new Promise(done=>{release=done;});}return read(id);};
  await page.evaluate(()=>document.querySelector('.canvas-tab[aria-label="implementation-report.md"]').click());
  for(let n=0;n<200&&!release;n++)await new Promise(done=>setTimeout(done,10));assert.ok(release);
  await page.evaluate(()=>document.querySelector('.canvas-tab[aria-label="synthetic-preview.html"]').click());
  await page.until(()=>!!document.querySelector('iframe[title="隔离 HTML 成果"]'));
  await page.until(()=>window.__supersededReadAborted);
  release();f.bridge.media.read=read;
  await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
  assert.equal(await page.evaluate(()=>!!document.querySelector('.canvas-markdown')),false,'late Markdown must not replace selected HTML');
  assert.equal(await page.evaluate(()=>document.querySelector('[contenteditable=true]').textContent),'Synthetic draft remains intact');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot('file-list-'+width+'.png');
  assert.deepEqual(page.errors,[]);assert.deepEqual(page.blocked,[]);assert.equal(f.submitted.length,0);assert.equal(f.fakeEngine.invocations,0);
  results.push({width,rows,staticHtml:true,exactTabSelection:true,digestMismatchRejected:true,retry:true,supersededReadIgnored:true,draftPreserved:true});
 }finally{await page.close();await f.close();}
}}finally{await browser.close();writeFileSync(join(destination,'file-list-browser.json'),JSON.stringify({results},null,2));}
assert.equal(results.length,4);console.log(JSON.stringify({pass:true,widths:results.map(r=>r.width)}));
