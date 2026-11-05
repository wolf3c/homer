// Real assistant-ui runtime, read-only public API observation, synthetic HTTP only.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {composerFixture} from './fixtures/composer-browser-server.mjs';
import {isolatedChrome} from './web-history-browser-cdp.mjs';
const destination=resolve(process.env.HOMER_BROWSER_EVIDENCE??'.codex/scratch/ui-component-simplification/browser-upload-batch');mkdirSync(destination,{recursive:true});
const webDir=resolve(process.env.HOMER_COMPONENT_BUILD??'.codex/scratch/ui-component-simplification/batch-observer-web');
const files=Array.from({length:11},(_,n)=>{const path=join(destination,n===0?'batch-01.png':'batch-'+String(n+1).padStart(2,'0')+'.txt');writeFileSync(path,n===0?Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGOI6tkCRwzEcQCU8hmhmgeEcAAAAABJRU5ErkJggg==','base64'):'synthetic batch '+n);return path;});
const fixture=await composerFixture({webDir,beforeDir:webDir,branding:resolve('assets/branding/odysseus-20261030/homer-odysseus-256.png')}),chrome=await isolatedChrome(destination),checks=[],snapshots=[];
const page=await chrome.page(fixture.url,390);let phase='startup',passed=false;
const record=async label=>{const snapshot={label,renderedNames:await page.evaluate(()=>[...document.querySelectorAll('.aui-attachment-root .aui-attachment-tile')].map(e=>e.getAttribute('aria-label').match(/^(?:预览 |(?:图片|文件|文档)附件 )(.+?)，/)[1])),collection:await page.evaluate(()=>window.__homerTestGetComposer().attachments.map(a=>({id:a.id,name:a.name,status:a.status,homer:a.homer}))),api:structuredClone(fixture.received)};snapshots.push(snapshot);return snapshot;};
const wait=async predicate=>page.until('Boolean(('+String(predicate)+')())',10000);
const key=async key=>{await page.command('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,windowsVirtualKeyCode:key==='Enter'?13:9,...(key==='Enter'?{text:'\r'}:{})});await page.command('Input.dispatchKeyEvent',{type:'keyUp',key,code:key});};
async function click(selector){await page.evaluate('document.querySelector('+JSON.stringify(selector)+').focus()');await key('Enter');}
async function select(paths){await page.command('Page.setInterceptFileChooserDialog',{enabled:true});await click('.attach-button');const {root}=await page.command('DOM.getDocument');const {nodeId}=await page.command('DOM.querySelector',{nodeId:root.nodeId,selector:'input[type=file]'});await page.command('DOM.setFileInputFiles',{nodeId,files:paths});}
async function reset(){fixture.reset();await page.evaluate(()=>sessionStorage.clear());await page.command('Page.reload');await wait(()=>!!window.__homerTestGetComposer&&!!document.querySelector('[contenteditable=true]')&&!!document.querySelector('.attach-button:not(:disabled)'));}
async function retry(){await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='重试上传').click());}
function check(label,fn){fn();checks.push({label,passed:true});}
try{
 await page.command('Page.addScriptToEvaluateOnNewDocument',{source:`window.__created=[];window.__revoked=[];const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);URL.createObjectURL=file=>{const url=create(file);window.__created.push(url);return url;};URL.revokeObjectURL=url=>{window.__revoked.push(url);revoke(url);};`});
 await page.navigate();await wait(()=>!!window.__homerTestGetComposer&&!!document.querySelector('[contenteditable=true]')&&!!document.querySelector('.attach-button:not(:disabled)'));
 phase='first-unknown';fixture.configure({uploadFailAt:1});await select(files.slice(0,3));
 await wait(()=>window.__homerTestGetComposer().attachments.length===3&&!document.querySelector('.composer-upload-status'));
 const first=await record(phase);
 check('one selection of three: first unknown stops later POSTs; all three stay in the only collection',()=>{assert.equal(first.api.uploads.length,1);assert.deepEqual(first.collection.map(a=>a.name),files.slice(0,3).map(p=>p.split('/').at(-1)));assert.deepEqual(first.renderedNames,first.collection.map(a=>a.name));assert.equal(new Set(first.collection.map(a=>a.id)).size,3);assert.ok(first.collection.every(a=>a.status.type==='incomplete'));assert.equal(first.collection[0].status.reason,'error');assert.ok(first.collection.slice(1).every(a=>a.status.reason==='upload-paused'));});
 const identities=first.collection.map(a=>a.homer),ids=first.collection.map(a=>a.id);assert.deepEqual(first.api.uploads[0],{threadId:identities[0].threadId,requestId:identities[0].requestId,uploadId:identities[0].uploadId,filename:first.collection[0].name});
 await wait(()=>document.querySelector('.aui-attachment-tile-image')?.naturalWidth===4);
 phase='second-unknown';fixture.configure({uploadFailAt:3});await retry();
 await wait(()=>window.__homerTestGetComposer().attachments.length===3&&!document.querySelector('.composer-upload-status')&&window.__homerTestGetComposer().attachments[0].status.type==='requires-action');
 const second=await record(phase);
 check('explicit retry succeeds first then pauses at second unknown; third still never POSTs',()=>{assert.equal(second.api.uploads.length,3);assert.deepEqual(second.collection.map(a=>a.id),ids);assert.deepEqual(second.api.uploads[1],first.api.uploads[0]);assert.equal(second.api.uploads[2].uploadId,ids[1]);assert.equal(second.collection[1].status.reason,'error');assert.equal(second.collection[2].status.reason,'upload-paused');});
 phase='remaining-retry';fixture.configure({uploadFailAt:0});await retry();
 await wait(()=>window.__homerTestGetComposer().attachments.length===3&&window.__homerTestGetComposer().attachments.every(a=>a.status.type==='requires-action')&&!document.querySelector('.composer-upload-status'));
 const ready=await record(phase);
 check('remaining explicit retry preserves all original thread/request/upload identities without duplicate entries or POSTs',()=>{assert.deepEqual(ready.collection.map(a=>a.id),ids);assert.equal(ready.api.uploads.length,5);assert.deepEqual(ready.api.uploads.map(a=>a.uploadId),[ids[0],ids[0],ids[1],ids[1],ids[2]]);for(const call of ready.api.uploads){const identity=identities.find(a=>a.uploadId===call.uploadId);assert.equal(call.threadId,identity.threadId);assert.equal(call.requestId,identity.requestId);}assert.deepEqual(ready.api.uploads[3],ready.api.uploads[2]);assert.deepEqual(ready.api.uploads[4],{threadId:identities[2].threadId,requestId:identities[2].requestId,uploadId:ids[2],filename:first.collection[2].name});for(let n=0;n<3;n++)assert.deepEqual({threadId:ready.collection[n].homer.threadId,requestId:ready.collection[n].homer.requestId,uploadId:ready.collection[n].homer.uploadId},{threadId:identities[n].threadId,requestId:identities[n].requestId,uploadId:ids[n]});});
 check('image retry retains exactly one decoded active preview',()=>{assert.equal(ready.api.discards.length,0);});
 assert.ok(await page.evaluate(()=>document.querySelector('.aui-attachment-tile-image')?.naturalWidth===4&&window.__created.length-window.__revoked.length===1));
 await page.screenshot('three-file-original-identities-390.png');
 phase='handoff';await page.evaluate(()=>document.querySelector('[contenteditable=true]').focus());await page.command('Input.insertText',{text:'synthetic three-file handoff'});await click('.send-button');
 await wait(()=>window.__homerTestGetComposer().attachments.length===0&&!document.querySelector('.composer-upload-status'));
 for(let n=0;fixture.received.messages.length<1&&n<100;n++)await new Promise(resolve=>setTimeout(resolve,20));
 const sent=await record(phase);
 check('send cleanup never discards handed-off batch assets and releases preview URLs',()=>{assert.equal(sent.api.uploads.length,5);assert.equal(sent.api.discards.length,0);assert.equal(sent.api.messages.length,1);assert.equal(sent.api.messages[0].requestId,identities[0].requestId);assert.deepEqual(sent.api.messages[0].attachments,ids.map(assetId=>({assetId,revision:1})));});
 assert.ok(await page.evaluate(()=>window.__created.length===window.__revoked.length));
 phase='success-batch';await reset();await select(files.slice(0,3));await wait(()=>window.__homerTestGetComposer().attachments.length===3&&window.__homerTestGetComposer().attachments.every(a=>a.status.type==='requires-action')&&!document.querySelector('.composer-upload-status'));
 const success=await record(phase);check('successful three-file batch sends exactly one POST per unique collection entry',()=>{assert.equal(success.api.uploads.length,3);assert.deepEqual(success.api.uploads.map(a=>a.uploadId),success.collection.map(a=>a.id));assert.equal(new Set(success.collection.map(a=>a.id)).size,3);});
 phase='invalid-batch';await reset();const invalid=join(destination,'empty.txt');writeFileSync(invalid,'');await select([files[1],invalid,files[2]]);await wait(()=>document.querySelector('.draft-notice')?.textContent.includes('1字节至8MiB'));
 const invalidBatch=await record(phase);check('one invalid member rejects the entire batch before any upload',()=>{assert.equal(invalidBatch.api.uploads.length,0);assert.equal(invalidBatch.collection.length,0);});
 phase='eleven-limit';await reset();await select(files);await wait(()=>document.querySelector('.draft-notice')?.textContent.includes('最多10个附件'));
 const eleven=await record(phase);check('eleven-file selection rejects the entire batch with zero POSTs and no entries',()=>{assert.equal(eleven.api.uploads.length,0);assert.equal(eleven.collection.length,0);});
 phase='ten-limit';await select(files.slice(0,10));await wait(()=>window.__homerTestGetComposer().attachments.length===10&&window.__homerTestGetComposer().attachments.every(a=>a.status.type==='requires-action')&&!document.querySelector('.composer-upload-status'));
 const ten=await record(phase);check('ten-file boundary uploads each entry exactly once',()=>{assert.equal(ten.api.uploads.length,10);assert.equal(new Set(ten.collection.map(a=>a.id)).size,10);assert.deepEqual(ten.renderedNames,ten.collection.map(a=>a.name));assert.deepEqual(ten.api.uploads.map(a=>a.uploadId),ten.collection.map(a=>a.id));});
 phase='existing-limit';await select([files[10],files[1]]);await wait(()=>document.querySelector('.draft-notice')?.textContent.includes('最多10个附件'));
 const over=await record(phase);check('full existing draft rejects a new multi-file batch without partial uploads',()=>{assert.equal(over.api.uploads.length,10);assert.deepEqual(over.collection,ten.collection);});
 phase='ten-unknown-retry';await reset();fixture.configure({uploadFailAt:1});await select(files.slice(0,10));await wait(()=>window.__homerTestGetComposer().attachments.length===10&&!document.querySelector('.composer-upload-status'));
 const tenUnknown=await record(phase);assert.equal(tenUnknown.api.uploads.length,1);fixture.configure({uploadFailAt:0});await retry();await wait(()=>window.__homerTestGetComposer().attachments.length===10&&window.__homerTestGetComposer().attachments.every(a=>a.status.type==='requires-action')&&!document.querySelector('.composer-upload-status'));
 const tenRetry=await record('ten-unknown-retry-ready');check('retry at the ten-entry limit counts existing identities once',()=>{assert.equal(tenRetry.api.uploads.length,11);assert.deepEqual(tenRetry.collection.map(a=>a.id),tenUnknown.collection.map(a=>a.id));assert.deepEqual(tenRetry.api.uploads[1],tenRetry.api.uploads[0]);});
 assert.deepEqual(page.errors,[]);assert.deepEqual(fixture.received.denied,[]);passed=true;
}catch(error){await record('failure-'+phase);await page.screenshot('failure-'+phase+'-390.png');throw error;}
finally{await page.close();await fixture.close();await chrome.close();writeFileSync(join(destination,'upload-batch-browser.json'),JSON.stringify({passed,phase,width:390,browser:chrome.version,syntheticOnly:true,observer:'read-only getter of real useAui composer public state; no replacement runtime',buildIndexSha256:createHash('sha256').update(readFileSync(join(webDir,'index.html'))).digest('hex'),checks,snapshots},null,2)+'\n');}
console.log(JSON.stringify({passed,checks:checks.length,width:390,syntheticOnly:true}));
