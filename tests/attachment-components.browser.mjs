// Actual UI + isolated Chrome; all files and upload/discard receipts are synthetic.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {composerFixture} from './fixtures/composer-browser-server.mjs';
import {isolatedChrome} from './web-history-browser-cdp.mjs';
const destination=resolve(process.env.HOMER_BROWSER_EVIDENCE??'.codex/scratch/attachment-components-20261023/browser');
const webDir=resolve(process.env.HOMER_COMPONENT_BUILD??'.codex/scratch/attachment-components-20261023/candidate-web');
mkdirSync(destination,{recursive:true});
const image=join(destination,'synthetic-image.png'),name='合成完整文件名-'+ '资料'.repeat(22)+'.txt',file=join(destination,name);
writeFileSync(image,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGOI6tkCRwzEcQCU8hmhmgeEcAAAAABJRU5ErkJggg==','base64'));
writeFileSync(file,'synthetic attachment only');
const tenFiles=Array.from({length:10},(_,i)=>{const path=join(destination,'synthetic-many-'+i+'.txt');writeFileSync(path,'synthetic '+i);return path;});
const fixture=await composerFixture({webDir,beforeDir:webDir,branding:resolve('assets/branding/odysseus-20261030/homer-odysseus-256.png')});
const chrome=await isolatedChrome(destination),checks=[];
async function key(page,key){await page.command('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,...(key==='Enter'?{text:'\r',windowsVirtualKeyCode:13}:{})});await page.command('Input.dispatchKeyEvent',{type:'keyUp',key,code:key});}
async function press(page,selector){await page.evaluate('document.querySelector('+JSON.stringify(selector)+').focus()');await key(page,'Enter');}
async function select(page,paths){await page.command('Page.setInterceptFileChooserDialog',{enabled:true});await press(page,'.attach-button');const {root}=await page.command('DOM.getDocument'),{nodeId}=await page.command('DOM.querySelector',{nodeId:root.nodeId,selector:'input[type=file]'});await page.command('DOM.setFileInputFiles',{nodeId,files:paths});}
let passed=false;
try{
 for(const width of [1440,390,320]){
  fixture.reset({features:{draftUpload:true,taskOverview:false}});
  const page=await chrome.page(fixture.url,width),wait=predicate=>page.until('Boolean(('+String(predicate)+')())',10000);
  const check=async(label,predicate)=>{assert.ok(await page.evaluate(predicate),label);checks.push({width,label});};
  try{
   await page.command('Page.addScriptToEvaluateOnNewDocument',{source:'window.__urls={created:0,revoked:0};const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);URL.createObjectURL=file=>{window.__urls.created++;return create(file);};URL.revokeObjectURL=url=>{window.__urls.revoked++;revoke(url);};'});
   await page.navigate();await wait(()=>!!document.querySelector('.attach-button:not(:disabled)'));
   await select(page,[image,file]);await wait(()=>document.querySelectorAll('.aui-attachment-root').length===2&&!document.querySelector('.composer-upload-status'));
   await wait(()=>document.querySelector('.aui-attachment-tile-image')?.naturalWidth===4);
   await wait(()=>document.querySelector('.aui-attachment-tile')?.getBoundingClientRect().width===56);
   await check('official 56px tiles, avatar image and file fallback replace custom cards',()=>{const e=document.querySelector('.aui-attachment-tile'),r=e.getBoundingClientRect();return r.width===56&&r.height===56&&!!document.querySelector('.aui-attachment-tile-fallback-icon')&&!document.querySelector('.composer-file-preview,.composer-file-info,.composer-thumbnail');});
   await check('remove retains upstream 20px icon surface and its official 32px hit region',()=>{const b=document.querySelector('.aui-attachment-tile-remove'),r=b.getBoundingClientRect(),s=getComputedStyle(b,'::after');return r.width===20&&r.height===20&&r.width-parseFloat(s.left)-parseFloat(s.right)===32;});
   await page.command('Emulation.setTouchEmulationEnabled',{enabled:true});
   const touch=await page.evaluate(()=>document.querySelectorAll('.aui-attachment-tile')[1].getBoundingClientRect().toJSON());
   await page.command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:touch.left+8,y:touch.bottom-8}]});
   await page.command('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   await wait(()=>!!document.querySelector('[data-slot="tooltip-content"]'));
   assert.ok((await page.evaluate(()=>document.querySelector('[data-slot="tooltip-content"]').textContent)).includes(name));checks.push({width,label:'native touch opens the official file-name tooltip'});
   const outside=await page.evaluate(()=>document.querySelector('[contenteditable=true]').getBoundingClientRect().toJSON());
   await page.command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:outside.left+8,y:outside.top+8}]});
   await page.command('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   await wait(()=>!document.querySelector('[data-slot="tooltip-content"]'));
   checks.push({width,label:'touching the composer dismisses the official tooltip'});
   await page.command('Emulation.setTouchEmulationEnabled',{enabled:false});
   await key(page,'Tab');
   await page.evaluate(()=>document.querySelectorAll('.aui-attachment-tile')[1].focus());
   await wait(()=>!!document.querySelector('[data-slot="tooltip-content"]'));
   await page.evaluate(()=>Promise.all(document.querySelector('[data-slot="tooltip-content"]').getAnimations({subtree:true}).map(a=>a.finished.catch(()=>{}))));
   assert.ok((await page.evaluate(()=>document.querySelector('[data-slot="tooltip-content"]').textContent)).includes(name));checks.push({width,label:'full long name, size and prepared state available through official focus tooltip'});
   await check('tooltip and composer stay within viewport',()=>{const r=document.querySelector('[data-slot="tooltip-content"]').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&document.documentElement.scrollWidth<=innerWidth;});
   await press(page,'.aui-attachment-tile[role=button]');await wait(()=>!!document.querySelector('.aui-attachment-preview-dialog-content'));
   await wait(()=>document.querySelector('.aui-attachment-preview img')?.naturalWidth===4);
   await wait(()=>document.querySelector('.aui-attachment-preview-dialog-content [data-slot="dialog-close"]')?.getBoundingClientRect().width===28);
   await check('official image dialog has Chinese title and 28px close control',()=>{const d=document.querySelector('[role=dialog]'),b=d.querySelector('[data-slot="dialog-close"]').getBoundingClientRect(),r=d.getBoundingClientRect();return d.textContent.includes('预览 synthetic-image.png')&&b.width===28&&b.height===28&&r.left>=0&&r.right<=innerWidth&&b.top>=r.top&&b.bottom<=r.bottom;});
   await page.screenshot('official-attachment-preview-'+width+'.png');
   await key(page,'Escape');await wait(()=>!document.querySelector('[role=dialog]'));
   await check('Escape restores focus to the source tile',()=>document.activeElement===document.querySelector('.aui-attachment-tile[role=button]'));
   await page.evaluate(()=>document.querySelector('[contenteditable=true]').focus());await page.command('Input.insertText',{text:'保留的合成草稿'});
   await page.screenshot('official-attachments-'+width+'.png');
   const original=structuredClone(fixture.received.uploads[0]);fixture.configure({discardFail:true});
   await press(page,'.aui-attachment-tile-remove');await wait(()=>document.querySelector('.draft-notice')?.textContent.includes('移除未确认'));
   await check('discard failure retains both files and unrelated draft without an unhandled rejection',()=>document.querySelectorAll('.aui-attachment-root').length===2&&document.querySelector('[contenteditable=true]').innerText==='保留的合成草稿');
   assert.equal(fixture.received.discards[0].assetId,original.uploadId);
   fixture.configure({discardFail:false});await press(page,'.aui-attachment-tile-remove');await wait(()=>document.querySelectorAll('.aui-attachment-root').length===1);
   assert.deepEqual(fixture.received.discards[1],fixture.received.discards[0]);checks.push({width,label:'explicit remove retry addresses the same original asset/revision'});
   await check('removed image releases its object URL and restores composer focus',()=>window.__urls.created===window.__urls.revoked&&document.activeElement===document.querySelector('[contenteditable=true]'));
   await page.command('Page.reload');await wait(()=>document.querySelectorAll('.aui-attachment-root').length===1);
   assert.equal(fixture.received.uploads.length,2);checks.push({width,label:'refresh restores confirmed file without uploading again'});
   const sentBefore=fixture.received.messages.length,acceptedId=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('homer-draft:composer-review')??'null')?.requestId);assert.equal(typeof acceptedId,'string');
   await press(page,'.send-button');await wait(()=>!document.querySelector('.aui-attachment-root'));
   assert.equal(fixture.received.discards.length,2);checks.push({width,label:'send cleanup never discards the handed-off asset'});
   await page.until(`!JSON.parse(sessionStorage.getItem('homer-unconfirmed:composer-review')??'[]').some(item=>item.input.requestId===${JSON.stringify(acceptedId)})`,10000);
   assert.equal(fixture.received.messages.length,sentBefore+1);assert.equal(fixture.received.messages[sentBefore].requestId,acceptedId);
   fixture.configure({uploadFailAt:3});await select(page,[image]);await wait(()=>!!document.querySelector('.aui-attachment-tile-error')&&!document.querySelector('.composer-upload-status'));
   await check('official upload error overlay and accessible state are present',()=>document.querySelector('.aui-attachment-tile').getAttribute('aria-label').includes('准备未确认，上传失败')&&!document.querySelector('.send-button:not(:disabled)'));
   fixture.configure({uploadFailAt:0});await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='重试上传').click());await wait(()=>!document.querySelector('.aui-attachment-tile-error')&&!document.querySelector('.composer-upload-status'));
   assert.deepEqual(fixture.received.uploads[2],fixture.received.uploads[3]);checks.push({width,label:'upload retry retains the original thread/request/upload identity'});
   await press(page,'.aui-attachment-tile-remove');await wait(()=>!document.querySelector('.aui-attachment-root'));
   await page.command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
   await select(page,tenFiles);await wait(()=>document.querySelectorAll('.aui-attachment-root').length===10&&!document.querySelector('.composer-upload-status'));
   await check('ten official tiles scroll inside the composer without page overflow',()=>{const e=document.querySelector('.aui-composer-attachments');e.scrollLeft=e.scrollWidth;return document.documentElement.scrollWidth<=innerWidth&&(e.scrollWidth<=e.clientWidth||e.scrollLeft>0)&&getComputedStyle(document.querySelector('.aui-attachment-root')).animationName==='none';});
   for(let remaining=9;remaining>=0;remaining--){await press(page,'.aui-attachment-tile-remove');await page.until('document.querySelectorAll(".aui-attachment-root").length==='+remaining,10000);}
   fixture.configure({uploadHold:true});await select(page,[image]);await wait(()=>!!document.querySelector('.aui-attachment-tile-uploading'));
   await check('official progress overlay disables remove and send while upload is pending',()=>document.querySelector('.aui-attachment-tile-remove').disabled&&document.querySelector('.send-button').disabled&&document.querySelector('.aui-attachment-tile').getAttribute('aria-label').includes('正在上传'));
   assert.deepEqual(page.errors,[]);assert.deepEqual(page.blocked,[]);assert.deepEqual(fixture.received.denied,[]);
  }catch(error){await page.screenshot('failure-'+width+'.png');writeFileSync(join(destination,'failure-'+width+'.json'),JSON.stringify({error:String(error),errors:page.errors,denied:fixture.received.denied,layout:await page.evaluate(()=>{const e=document.querySelector('[data-slot="tooltip-content"]');return {viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,tooltip:e?.getBoundingClientRect().toJSON(),maxWidth:e&&getComputedStyle(e).maxWidth};}),html:await page.evaluate(()=>document.querySelector('.composer-area')?.outerHTML)},null,2));throw error;}
  finally{await page.close();}
 }
 passed=true;
}finally{await fixture.close();await chrome.close();writeFileSync(join(destination,'attachment-browser.json'),JSON.stringify({passed,syntheticOnly:true,browser:chrome.version,checks},null,2));}
console.log(JSON.stringify({passed,checks:checks.length,widths:[1440,390,320],syntheticOnly:true}));
