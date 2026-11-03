// Real Chrome interactions against a synthetic, in-memory transport only.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {composerFixture} from './fixtures/composer-browser-server.mjs';
import {isolatedChrome} from './web-history-browser-cdp.mjs';

const destination=resolve(process.env.HOMER_BROWSER_EVIDENCE??'.codex/scratch/ui-component-simplification/browser-components');
mkdirSync(destination,{recursive:true});
const webDir=resolve(process.env.HOMER_COMPONENT_BUILD??'.codex/scratch/ui-component-simplification/candidate-web');
const taskOnly=process.env.HOMER_TASK_FOCUS_ONLY==='1',chrome=await isolatedChrome(destination),checks=[];
const fixture=await composerFixture({webDir,beforeDir:webDir,branding:resolve('assets/branding/homer-river-stone-256.de41791ce5c1.png')});
const file=join(destination,'synthetic-upload.txt');writeFileSync(file,'synthetic attachment');
async function key(page,key,modifiers=0){await page.command('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,modifiers,...(key==='Enter'?{text:'\r',unmodifiedText:'\r',windowsVirtualKeyCode:13}:key==='Tab'?{windowsVirtualKeyCode:9}:key==='Escape'?{windowsVirtualKeyCode:27}:{})});await page.command('Input.dispatchKeyEvent',{type:'keyUp',key,code:key,modifiers});}
async function press(page,selector){await page.evaluate('document.querySelector('+JSON.stringify(selector)+').focus()');await key(page,'Enter');}
async function input(page,text){await page.evaluate(()=>{const e=document.querySelector('[contenteditable=true]');e.focus();const s=getSelection(),r=document.createRange();r.selectNodeContents(e);s.removeAllRanges();s.addRange(r);});await page.command('Input.insertText',{text});}
try{
 for(const width of [1440,390,320]){
  fixture.reset();const page=await chrome.page(fixture.url,width);let phase='startup';
  async function wait(check){await page.until('Boolean(('+String(check)+')())',10000);}
  async function check(label,predicate){const value=await page.evaluate(predicate);assert.ok(value,label);checks.push({width,label,passed:true});}
  try{
   await page.command('Page.addScriptToEvaluateOnNewDocument',{source:`window.__createdUrls=[];window.__revokedUrls=[];const createUrl=URL.createObjectURL.bind(URL),revokeUrl=URL.revokeObjectURL.bind(URL);URL.createObjectURL=file=>{const url=createUrl(file);window.__createdUrls.push(url);return url;};URL.revokeObjectURL=url=>{window.__revokedUrls.push(url);revokeUrl(url);};window.__copies=[];window.__copyMode='success';Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText(text){window.__copies.push({text,active:navigator.userActivation.isActive});if(window.__copyMode==='hold')return new Promise((resolve,reject)=>window.__clipboard={resolve,reject});if(window.__copyMode==='fail')return Promise.reject(Error('synthetic_clipboard_denied'));return Promise.resolve();}}});`});
   await page.navigate();await wait(()=>!!document.querySelector('[contenteditable=true]')&&!!document.querySelector('.task-entry'));
   phase='task-modal';await press(page,'.task-entry');await wait(()=>!!document.querySelector('.task-row'));
   await check('task stays modal at every width',()=>document.querySelector('.task-dialog').matches(':modal'));
   // Inspect the actual rendered focusable controls; native keyboard events
   // exercise wrapping, rather than calling the app key handler directly.
   await page.evaluate(()=>{const controls=[...document.querySelector('.task-dialog').querySelectorAll('button:not(:disabled),input:not(:disabled),summary,a[href],[tabindex="0"]')].filter(e=>e.getClientRects().length);window.__first=controls[0];window.__last=controls.at(-1);window.__last.focus();});
   await key(page,'Tab');await check('Tab wraps to the first task control',()=>document.activeElement===window.__first);
   await key(page,'Tab',8);await check('Shift+Tab wraps to the last task control',()=>document.activeElement===window.__last);
   await press(page,'.task-row');await wait(()=>document.activeElement?.tagName==='H3');
   await key(page,'Escape');await wait(()=>document.activeElement?.id==='task-row-synthetic-task');
   await check('detail Escape returns to the same task row',()=>document.querySelector('.task-dialog').open);
   await key(page,'Escape');await wait(()=>!document.querySelector('.task-dialog').open);
   await check('closing task returns focus to its entry',()=>document.activeElement===document.querySelector('.task-entry'));
   if(taskOnly){await page.screenshot('task-native-focus-'+width+'.png');continue;}

   phase='copy-feedback';await page.evaluate(()=>window.__copyMode='hold');
   await press(page,'#message-fixture-17 [aria-label="复制"]');
   await wait(()=>window.__copies.length===1);
   await check('copy writer runs in a native user gesture',()=>window.__copies[0].active);
   await check('pending copy disables reentry',()=>document.querySelector('#message-fixture-17 [aria-label="复制"]').disabled);
   await page.evaluate(()=>{document.querySelector('#message-fixture-17 [aria-label="复制"]').click();window.__clipboard.reject(Error('synthetic_clipboard_denied'));});
   await wait(()=>document.querySelector('#message-fixture-17 .message-action-notice')?.textContent.includes('复制失败'));
   assert.equal(await page.evaluate(()=>window.__copies.length),1);
   await page.evaluate(()=>window.__copyMode='success');await press(page,'#message-fixture-17 [aria-label="复制"]');
   await wait(()=>document.querySelector('#message-fixture-17 .message-action-notice')?.textContent==='已复制');
   assert.equal(await page.evaluate(()=>window.__copies.length),2);
   assert.equal(await page.evaluate(()=>window.__copies[1].text),('已整理这份合成材料。先核对目标，再逐项检查细节。\n\n这是隔离浏览器检查使用的示例内容。').repeat(2));
   checks.push({width,label:'clipboard success, failure, pending guard and exact body',passed:true});

   phase='quote-draft';await page.evaluate(()=>sessionStorage.setItem('homer-draft:composer-review',JSON.stringify({text:'引用旁草稿',requestId:'quote-original',quotes:[{messageId:'fixture-17',text:'合成引用原文。'.repeat(40),annotation:''}]})));
   await page.command('Page.reload');await wait(()=>!!document.querySelector('[data-slot="composer-quote"]'));
   await check('restored quote uses the official two-line preview',()=>getComputedStyle(document.querySelector('[data-slot="composer-quote-text"]')).webkitLineClamp==='2');
   await press(page,'[aria-label="删除引用"]');await wait(()=>!document.querySelector('[data-slot="composer-quote"]'));
   await check('deleting restored quote preserves draft and input focus',()=>document.querySelector('[contenteditable=true]').innerText==='引用旁草稿'&&document.activeElement===document.querySelector('[contenteditable=true]'));
   phase='attachments';await input(page,'附件草稿');
   await page.command('Page.setInterceptFileChooserDialog',{enabled:true});
   await press(page,'.attach-button');
   const {root}=await page.command('DOM.getDocument');const {nodeId}=await page.command('DOM.querySelector',{nodeId:root.nodeId,selector:'input[type=file]'});
   await page.command('DOM.setFileInputFiles',{nodeId,files:[file]});
   await wait(()=>document.querySelector('.aui-attachment-tile')?.getAttribute('aria-label').includes('已准备'));
   assert.equal(fixture.received.uploads.length,1);const uploaded=structuredClone(fixture.received.uploads[0]);
   await page.command('Page.reload');await wait(()=>document.querySelector('.aui-attachment-tile')?.getAttribute('aria-label').includes('已准备'));
   assert.equal(fixture.received.uploads.length,1,'refresh must not upload');
   assert.equal(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('homer-draft:composer-review')).requestId),uploaded.requestId);
   fixture.configure({discardFail:true});await press(page,'.aui-attachment-root button');
   await wait(()=>document.querySelector('.draft-notice')?.textContent.includes('移除未确认'));
   await check('failed discard retains the only draft attachment',()=>document.querySelectorAll('.aui-attachment-root').length===1);
   assert.equal(fixture.received.discards.length,1);fixture.configure({discardFail:false});
   const discarded=fixture.received.discards.length;await press(page,'.send-button');
   await wait(()=>!document.querySelector('.aui-attachment-root'));
   assert.equal(fixture.received.messages.length,1);assert.equal(fixture.received.discards.length,discarded,'send cleanup must not discard');
   assert.deepEqual(fixture.received.messages[0].attachments,[{assetId:uploaded.uploadId,revision:1}]);
   checks.push({width,label:'file selection, refresh identity, failed discard retention and safe send cleanup',passed:true});

   phase='unknown-upload';fixture.configure({uploadFailAt:fixture.received.uploads.length+1});
   await page.evaluate(()=>{const el=document.querySelector('[contenteditable=true]'),data=new DataTransfer();data.items.add(new File([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGOI6tkCRwzEcQCU8hmhmgeEcAAAAABJRU5ErkJggg=='),c=>c.charCodeAt(0))],'合成截图.png',{type:'image/png'}));data.setData('text/plain','粘贴说明');el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));});
   await wait(()=>!!document.querySelector('.aui-attachment-tile-error'));
   const unknown=structuredClone(fixture.received.uploads.at(-1));
   await check('unconfirmed upload prevents sending',()=>document.querySelector('.send-button').disabled);
   fixture.configure({uploadFailAt:0});await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='重试上传').click());
   await wait(()=>!document.querySelector('.aui-attachment-tile-error')&&!!document.querySelector('.aui-attachment-root'));
   assert.deepEqual(fixture.received.uploads.at(-1),unknown);
   // Retry can replace the row after the old image has loaded. Observe the
   // settled current preview and its resource count together, after upload ends.
   await wait(()=>!document.querySelector('.composer-upload-status')&&document.querySelector('.aui-attachment-tile-image')?.naturalWidth===4&&window.__createdUrls.length-window.__revokedUrls.length===1);
   await check('image preview retains one active object URL across retry',()=>window.__createdUrls.length-window.__revokedUrls.length===1&&!!document.querySelector('.aui-attachment-tile-image'));
   await page.screenshot('attachment-preview-'+width+'.png');
   const dropPoint=await page.evaluate(()=>{const r=document.querySelector('[contenteditable=true]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};});
   for(const type of ['dragEnter','dragOver','drop'])await page.command('Input.dispatchDragEvent',{type,...dropPoint,data:{items:[],files:[file],dragOperationsMask:1}});
   await wait(()=>document.querySelectorAll('.aui-attachment-root').length===2&&!document.querySelector('.composer-upload-status'));
   assert.equal(fixture.received.uploads.length,4,'selection + one failed paste + retry + one drop');
   await press(page,'.aui-attachment-root button');await wait(()=>document.querySelectorAll('.aui-attachment-root').length===1);
   await check('removed image releases its preview URL',()=>window.__createdUrls.length>0&&window.__revokedUrls.length===window.__createdUrls.length&&window.__createdUrls.every(url=>window.__revokedUrls.includes(url)));
   checks.push({width,label:'paste/drop share one owner; unknown retry keeps upload identity; explicit removal',passed:true});

   phase='composition-queue';await input(page,'组合输入');
   const sentBefore=fixture.received.messages.length;
   await page.evaluate(()=>{const e=document.querySelector('[contenteditable=true]');e.dispatchEvent(new CompositionEvent('compositionstart',{data:'中文',bubbles:true}));e.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:229,isComposing:true,bubbles:true,cancelable:true}));e.dispatchEvent(new CompositionEvent('compositionend',{data:'中文',bubbles:true}));});
   assert.equal(fixture.received.messages.length,sentBefore,'composition Enter must not submit');
   await key(page,'Enter',8);await check('Shift+Enter preserves a multiline draft',()=>document.querySelector('[contenteditable=true]').innerText.includes('\n'));
   fixture.update({isRunning:true,activeMessageId:'main-original',work:[{id:'background',title:'后台仍执行',state:'working'}]});fixture.configure({sendUnknown:true});
   await wait(()=>document.querySelector('.send-button')?.getAttribute('aria-label')==='排队发送');
   await key(page,'Enter');await wait(()=>JSON.parse(sessionStorage.getItem('homer-unconfirmed:composer-review')??'[]').length===1);
   await input(page,'运行中第二条');await key(page,'Enter');await wait(()=>JSON.parse(sessionStorage.getItem('homer-unconfirmed:composer-review')??'[]').length===2);
   for(let attempt=0;fixture.received.messages.length<sentBefore+2&&attempt<100;attempt++)await new Promise(resolve=>setTimeout(resolve,30));
   assert.equal(fixture.received.messages.length,sentBefore+2);assert.notEqual(fixture.received.messages.at(-1).requestId,fixture.received.messages.at(-2).requestId);
   await input(page,'后写草稿');fixture.configure({offline:true});fixture.unavailable();await wait(()=>document.querySelector('[contenteditable=false]'));
   fixture.configure({offline:false});fixture.update({});await wait(()=>document.querySelector('[contenteditable=true]'));
   await page.command('Page.reload');await wait(()=>JSON.parse(sessionStorage.getItem('homer-unconfirmed:composer-review')??'[]').length===2);
   await check('disconnect/refresh preserves the newer draft',()=>document.querySelector('[contenteditable=true]').innerText==='后写草稿');
   assert.equal(fixture.received.messages.length,sentBefore+2,'unknown ACK must not auto replay');
   await press(page,'.stop-button');await wait(()=>document.querySelector('.error-banner')?.textContent.includes('停止未确认')||[...document.querySelectorAll('[role=alert]')].some(e=>e.textContent.includes('停止未确认')));
   assert.deepEqual(fixture.received.stops,[{messageId:'main-original'}]);
   checks.push({width,label:'synthetic composition/ShiftEnter; running sends; unknown ACK reconnect/reload; original stop target',passed:true});
   await check('no horizontal overflow',()=>document.documentElement.scrollWidth<=innerWidth);
   await page.screenshot('component-contracts-'+width+'.png');assert.deepEqual(page.errors,[]);
  }catch(error){await page.screenshot('failure-'+phase+'-'+width+'.png');writeFileSync(join(destination,'failure-context.json'),JSON.stringify({width,phase,error:String(error),body:await page.evaluate(()=>document.body.innerText.slice(-3000)),errors:page.errors},null,2));throw error;}
  finally{await page.close();}
 }
}finally{await fixture.close();await chrome.close();writeFileSync(join(destination,'component-browser-checks.json'),JSON.stringify({browser:chrome.version,syntheticOnly:true,taskOnly,checks},null,2)+'\n');}
console.log(JSON.stringify({passed:true,checks:checks.length,widths:[1440,390,320],syntheticOnly:true}));
