// The exact built HomerApp with synthetic HTTP files and a fresh browser context.
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,existsSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {actualClick} from './html-preview-browser.mjs';
const simple='diff --git a/a.txt b/a.txt\nindex 0000000..1111111 100644\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new\n';
const multi=simple+'diff --git a/new.txt b/new.txt\nnew file mode 100644\n--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1 @@\n+'+'long-line-'.repeat(1500)+'\n';
export const patchPreviewFiles=[
 {id:'result-patch-readable',title:'对话标题.patch',mime:'text/x-diff',text:'diff --git a/title.ts b/title.ts\n--- a/title.ts\n+++ b/title.ts\n@@ -1,3 +1,3 @@\n export function title() {\n-  return \"Untitled\";\n+  return \"新对话\";\n }\n'+simple},
 {id:'result-patch-small',title:'差异预览-'+ '长文件名'.repeat(12)+'.patch',mime:'application/octet-stream',text:multi},
 {id:'result-patch-big',title:'超限.diff',mime:'application/octet-stream',text:simple+'x'.repeat(256*1024)},
 {id:'result-patch-binary',title:'二进制.patch',mime:'text/x-patch',text:simple+'GIT binary patch\nliteral 1\nA\n'},
 {id:'result-patch-lines',title:'有界多行.patch',mime:'text/plain',text:'--- a/many.txt\n+++ b/many.txt\n@@ -0,0 +1,1980 @@\n'+'+line\n'.repeat(1980)},
];
const delay=ms=>new Promise(r=>setTimeout(r,ms));
export async function verifyPatchPreview({p,chrome,files,destination,width,record}){
 const ev=x=>p.evaluate(x),until=x=>p.until(x,10000),file=id=>files.find(f=>f.id===id);
 const click=async selector=>{await ev(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',inline:'nearest'})`);await actualClick(p,await ev(`document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().toJSON()`));};
 await p.command('Page.addScriptToEvaluateOnNewDocument',{source:`window.__patchPerf={longTasks:[],created:0,revoked:0};new PerformanceObserver(list=>{for(const x of list.getEntries())__patchPerf.longTasks.push(x.duration)}).observe({type:'longtask',buffered:true});const create=URL.createObjectURL,revoke=URL.revokeObjectURL;URL.createObjectURL=function(...a){__patchPerf.created++;return create.apply(this,a)};URL.revokeObjectURL=function(...a){__patchPerf.revoked++;return revoke.apply(this,a)};`});
 await p.navigate();await until(()=>!!document.querySelector('.file-list-open'));
 const open=async id=>{if(width<=800&&await ev(()=>!!document.querySelector('#canvas-panel')))await click('.canvas-collapse');const f=file(id);await ev(`(()=>{const b=[...document.querySelectorAll('.file-list-open')].find(b=>b.getAttribute('aria-label')===${JSON.stringify('预览 '+f.title)});if(!b)throw Error('synthetic_patch_entry_missing');b.focus()})()`);for(const type of ['keyDown','keyUp'])await p.command('Input.dispatchKeyEvent',{type,key:'Enter',code:'Enter',windowsVirtualKeyCode:13,...(type==='keyDown'?{text:'\r'}:{})});};
 await open('result-patch-big');await until(()=>document.querySelector('#canvas-panel')?.textContent.includes('仅显示开头'));
 assert.equal(await ev(()=>!!document.querySelector('[data-slot=diff-viewer]')),false);assert.equal(p.requests.some(r=>/diff-viewer-.*\.js$/.test(r.path)),false);await p.screenshot('patch-oversize-'+width+'.png');record('oversize patch shows a labeled prefix without loading the viewer chunk');
 await open('result-tabs-a');await until(()=>document.querySelector('[data-preview-text]')?.textContent.includes('第一处中文'));
 assert.equal(p.requests.some(r=>/diff-viewer-.*\.js$/.test(r.path)),false);record('plain text retains its original renderer and does not load the diff chunk');
 const start=Date.now();await open('result-patch-small');await until(()=>document.querySelector('[data-slot=diff-viewer]')?.getAttribute('data-view-mode')==='unified');
 const firstVisibleMs=Date.now()-start;
 assert.equal(await ev(()=>document.querySelectorAll('[data-slot=diff-viewer-file]').length),2);
 assert.ok(await ev(()=>document.querySelectorAll('[data-slot=diff-viewer-line-number]').length>=3));
 assert.equal(await ev(()=>!!document.querySelector('#canvas-panel [data-preview-text],#canvas-panel .preview-selection-positioner')),false);
 assert.equal(await ev(()=>document.documentElement.scrollWidth<=innerWidth),true);record('real unified viewer shows multiple files and line numbers, long lines stay within the viewport');
 await p.screenshot('patch-unified-'+width+'.png');
 await click('#canvas-panel summary');await until(()=>document.querySelector('#canvas-panel details')?.open);
 assert.equal(await ev(()=>document.querySelector('#canvas-panel details pre').textContent),file('result-patch-small').text);
 const downloads=join(destination,'downloads-'+width);mkdirSync(downloads,{recursive:true});
 await chrome.command('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads,browserContextId:p.browserContextId});
 assert.ok(await ev(()=>document.querySelector('[data-slot=diff-viewer]').getBoundingClientRect().height>100));await p.screenshot('patch-raw-'+width+'.png');await click('#canvas-panel a[download]');const path=join(downloads,file('result-patch-small').title);
 for(let i=0;i<200&&!existsSync(path);i++)await delay(20);assert.ok(existsSync(path));
 assert.deepEqual(readFileSync(path),file('result-patch-small').bytes);record('the native Blob download matches every original byte and filename');
 await chrome.command('Browser.grantPermissions',{permissions:['clipboardReadWrite','clipboardSanitizedWrite'],origin:new URL(await ev(()=>location.href)).origin,browserContextId:p.browserContextId});
 await ev(()=>document.querySelector('[data-slot=diff-viewer-header] button').focus());
 for(const type of ['keyDown','keyUp'])await p.command('Input.dispatchKeyEvent',{type,key:'Enter',code:'Enter',windowsVirtualKeyCode:13,...(type==='keyDown'?{text:'\r'}:{})});await until(async()=> (await navigator.clipboard.readText()).includes('+new'));record('the official copy action is keyboard reachable and copies the reconstructed file diff');
 await ev(()=>document.querySelector('#canvas-panel summary').focus());
 for(const type of ['keyDown','keyUp'])await p.command('Input.dispatchKeyEvent',{type,key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
 assert.equal(await ev(()=>document.activeElement?.getAttribute('download')),file('result-patch-small').title);record('Tab reaches the original-file download from the native disclosure');
 await open('result-patch-binary');await until(()=>document.querySelector('#canvas-panel')?.textContent.includes('二进制差异'));assert.equal(await ev(()=>!!document.querySelector('[data-slot=diff-viewer]')),false);
 await p.screenshot('patch-binary-'+width+'.png');
 await open('result-patch-lines');await until(()=>document.querySelectorAll('[data-slot=diff-viewer-line]').length===200);
 const collapsedNodes=await ev(()=>document.querySelector('#canvas-panel').querySelectorAll('*').length);
 await p.screenshot('patch-collapsed-'+width+'.png');
 await click('[data-slot=diff-viewer] button[aria-expanded=false]');await until(()=>document.querySelectorAll('[data-slot=diff-viewer-line]').length===1980);
 await click('[data-slot=diff-viewer] button[aria-expanded=true]');await until(()=>document.querySelectorAll('[data-slot=diff-viewer-line]').length===200);
 assert.ok(collapsedNodes<1000);record('large files start with 200 rows; expand and collapse retain every diff row');
 const perf=await ev(()=>({...__patchPerf,nodes:document.querySelector('#canvas-panel').querySelectorAll('*').length}));
 writeFileSync(join(destination,'patch-performance-'+width+'.json'),JSON.stringify({firstVisibleMs,perf,scope:'synthetic exact build; local environment only'},null,2));record('the conservative in-bound multi-line fixture renders; local long-task evidence is recorded');
 await ev(()=>[...document.querySelectorAll('[role=tab]')].find(b=>b.title.endsWith(' · result-patch-small')).click());await until(()=>!!document.querySelector('[data-slot=diff-viewer]'));
 await ev(()=>document.querySelector('[data-slot=canvas-split-body]').scrollTop=0);const before=await ev(()=>__patchPerf.revoked);await click(width<=800?'.canvas-collapse':'.conversation-header [aria-controls=canvas-panel]');await until(()=>!document.querySelector('#canvas-panel'));assert.ok(await ev(`__patchPerf.revoked>${before}`));
 await ev(()=>document.querySelector('.conversation-header [aria-controls=canvas-panel]').click());await until(()=>document.querySelector('[data-slot=diff-viewer]')?.getAttribute('data-view-mode')==='unified');
 assert.deepEqual(p.errors,[]);assert.deepEqual(p.blocked,[]);record('tab switches, close/reopen and URL cleanup preserve the real preview without browser errors');
 await open('result-patch-readable');await until(()=>document.querySelector('[data-slot=diff-viewer]')?.textContent.includes('新对话'));
 const fit=await ev(()=>({page:document.documentElement.scrollWidth<=innerWidth,controls:[...document.querySelectorAll('#canvas-panel summary,#canvas-panel [data-slot=diff-viewer-header] button')].map(e=>({tag:e.tagName,rect:e.getBoundingClientRect().toJSON()}))}));
 assert.ok(fit.page);for(const {rect} of fit.controls){assert.ok(rect.left>=0&&rect.right<=width&&rect.top>=0&&rect.bottom<=900);if(width<=800)assert.ok(rect.height>=44);}
 writeFileSync(join(destination,'patch-fit-'+width+'.json'),JSON.stringify(fit,null,2));await p.screenshot('patch-preview-'+width+'.png');record('raw disclosure and copy controls fit the initial view; narrow-screen targets are at least 44px high');
}
