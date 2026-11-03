// Isolated UI, synthetic engine, temporary browser profile and local files only.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {queueBrowserFixture} from './fixtures/message-queue-browser-server.ts';
import {isolatedChrome} from './web-history-browser-cdp.mjs';
const dir=resolve('.codex/scratch/draft-preview-browser');mkdirSync(dir,{recursive:true});
const image=join(dir,'synthetic.png');writeFileSync(image,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGOI6tkCRwzEcQCU8hmhmgeEcAAAAABJRU5ErkJggg==','base64'));
const fixture=await queueBrowserFixture('dist/web',0,join(dir,'host'));
const chrome=await isolatedChrome(dir);const page=await chrome.page(fixture.server.url,764);
const wait=predicate=>page.until('Boolean(('+String(predicate)+')())',10000);
async function press(selector){await page.evaluate('document.querySelector('+JSON.stringify(selector)+').focus()');await page.command('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',windowsVirtualKeyCode:13});await page.command('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter'});}
try{
 await page.navigate();await wait(()=>!!document.querySelector('.attach-button:not(:disabled)'));
 await page.command('Page.setInterceptFileChooserDialog',{enabled:true});await press('.attach-button');
 const {root}=await page.command('DOM.getDocument');const {nodeId}=await page.command('DOM.querySelector',{nodeId:root.nodeId,selector:'input[type=file]'});
 await page.command('DOM.setFileInputFiles',{nodeId,files:[image]});
 await wait(()=>document.querySelector('.aui-attachment-tile-image')?.naturalWidth>0&&!document.querySelector('.composer-upload-status'));
 await page.command('Page.reload');
 await wait(()=>document.querySelector('.aui-attachment-tile-image')?.naturalWidth>0);
 assert.equal(await page.evaluate(()=>document.querySelectorAll('.aui-attachment-root').length),1);
 await press('.aui-attachment-tile[role=button]');await wait(()=>document.querySelector('.aui-attachment-preview img')?.naturalWidth>0);
 await page.screenshot('draft-image-restored.png');
 await page.command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await page.command('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'});
 await wait(()=>!document.querySelector('[role=dialog]'));
 await press('.aui-attachment-tile-remove');await wait(()=>!document.querySelector('.aui-attachment-root'));
 assert.deepEqual(page.errors,[]);console.log('PASS: synthetic image upload, reload, thumbnail, preview and remove');
}finally{await page.close();await chrome.close();await fixture.close();}
