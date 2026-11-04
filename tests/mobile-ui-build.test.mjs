import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,rmSync} from 'node:fs';
import {chromium} from 'playwright-core';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {buildMobileUi} from '../scripts/build-mobile-ui.mjs';

test('App bundles the original chat as local HTML without external executable or style assets',async()=>{
 const out='.codex/scratch/mobile-webrtc/ui-test';mkdirSync(out,{recursive:true});
 try{
  const {html}=await buildMobileUi(out);
  assert.match(html,/name="homer-mobile" content="true"/);
  assert.match(html,/id="homer-root"/);
  assert.doesNotMatch(html,/<script[^>]+src=|<link[^>]+(?:stylesheet|modulepreload)/i);
  assert.doesNotMatch(html,/url\(["']?(?:\.\/|\/assets\/)/);
  assert.ok(html.length>10000);
  assert.doesNotMatch(html,/impeccable-live-start|localhost:8400\/live\.js/);
  const notices=html.match(/<script type="application\/json" id="homer-third-party-notices">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(notices,"third-party licenses must travel inside the embedded page");
  assert.equal(JSON.parse(notices),readFileSync(out+'/assets/task-status-NOTICES.txt','utf8'));
  assert.match(JSON.parse(notices),/PolyForm Shield License 1\.0\.0/);
  assert.equal(readFileSync(out+'/chat.mjs','utf8').startsWith('export default '),true);
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
   const page=await browser.newPage({viewport:{width:393,height:852}}),errors=[];
   page.on('pageerror',error=>errors.push(error.message));
   await page.addInitScript(()=>{window.__homerMobileNonce='synthetic-test';window.__homerMobileUpdate={version:'0.1.2',openError:false};window.__messages=[];window.ReactNativeWebView={postMessage:value=>window.__messages.push(JSON.parse(value))};});
   await page.goto(pathToFileURL(resolve(out,'index.html')).href);
   await page.getByRole('textbox').first().waitFor();
   const notice=page.getByRole('complementary',{name:'版本更新'});
   await notice.getByText('有新版本 0.1.2').waitFor();
   assert.equal(await notice.evaluate(element=>element.previousElementSibling.className),'conversation-header');
   assert.equal(await notice.evaluate(element=>element.nextElementSibling.className),'conversation-workspace');
   for(const name of ['前往更新','关闭更新提示']){const box=await notice.getByRole('button',{name}).boundingBox();assert.ok(box.width>=44&&box.height>=44);}
   await notice.getByRole('button',{name:'前往更新'}).click();
   assert.deepEqual(await page.evaluate(()=>window.__messages.filter(message=>message.type==='update-open')),[{type:'update-open',nonce:'synthetic-test'}]);
   assert.equal(await notice.count(),1,'opening is an intent, not a local dismissal');
   await page.evaluate(()=>{window.__homerMobileUpdate={version:'0.1.2',openError:true};window.dispatchEvent(new Event('homer-mobile-update'));});
   await notice.getByText('未能打开下载页，请重试。').waitFor();
   await notice.getByRole('button',{name:'前往更新'}).click();
   await page.setViewportSize({width:390,height:844});
   await page.screenshot({path:'.codex/scratch/mobile-update-implementation-20261103/update-390.png'});
   const settings=page.getByRole('button',{name:'设置'}),brand=page.locator('.header-name img'),preview=page.getByRole('button',{name:'预览'});
   const [settingsBox,brandBox,previewBox]=await Promise.all([settings.boundingBox(),brand.boundingBox(),preview.boundingBox()]);
   assert.ok(settingsBox&&brandBox&&previewBox&&brandBox.x<settingsBox.x&&settingsBox.x<previewBox.x);
   assert.equal(settingsBox.width,44);assert.equal(settingsBox.height,44);
   assert.equal(await settings.evaluate(element=>element.closest('.header-actions')!==null),true);
   await settings.click();
   const settingsPage=page.getByRole('dialog',{name:'设置'});await settingsPage.waitFor();
   for(const name of ['完成','重新扫码','隐私政策']){const box=await settingsPage.getByRole('button',{name}).boundingBox();assert.ok(box.width>=44&&box.height>=44);}
   await settingsPage.getByRole('button',{name:'重新扫码'}).click();
   assert.deepEqual(await page.evaluate(()=>window.__messages.filter(message=>message.type==='open-scanner')),[{type:'open-scanner',nonce:'synthetic-test'}]);
   assert.equal(await settingsPage.isVisible(),true);
   await settingsPage.getByRole('button',{name:'隐私政策'}).click();
   assert.deepEqual(await page.evaluate(()=>window.__messages.filter(message=>message.type==='open-privacy')),[{type:'open-privacy',nonce:'synthetic-test'}]);
   await settingsPage.getByRole('button',{name:'完成'}).click();await settingsPage.waitFor({state:'detached'});
   await page.setViewportSize({width:320,height:720});
   await page.addStyleTag({content:'.mobile-update-notice{font-size:28px}'});
   for(const name of ['前往更新','关闭更新提示']){const box=await notice.getByRole('button',{name}).boundingBox();assert.ok(box.x>=0&&box.x+box.width<=320&&box.height>=44);}
   await page.screenshot({path:'.codex/scratch/mobile-update-implementation-20261103/update-320-large.png'});
   await notice.getByRole('button',{name:'关闭更新提示'}).click();
   assert.deepEqual(await page.evaluate(()=>window.__messages.filter(message=>message.type==='update-dismiss')),[{type:'update-dismiss',nonce:'synthetic-test'}]);
   await page.evaluate(()=>{window.__homerMobileUpdate=null;window.dispatchEvent(new Event('homer-mobile-update'));});
   await notice.waitFor({state:'detached'});
   await page.reload();await notice.waitFor();
   await page.evaluate(()=>{delete window.__homerMobileUpdate;window.dispatchEvent(new Event('homer-mobile-update'));});
   await notice.waitFor({state:'detached'});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   assert.deepEqual(errors,[]);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   await page.screenshot({path:'.codex/scratch/mobile-webrtc/local-chat.png'});
  }finally{await browser.close();}
 }finally{rmSync(out,{recursive:true,force:true});}
});

test('bundled mobile HTML preview initializes its sandboxed srcdoc shell from the parent',async()=>{
 const {htmlPreviewShell}=await import('../src/html-preview.ts'),{createServer}=await import('node:http'),{once}=await import('node:events');
 const server=createServer((_,response)=>response.writeHead(200,{'Content-Type':'text/html'}).end('<!doctype html><iframe title="outer" sandbox="allow-scripts"></iframe>'));
 server.listen(0,'127.0.0.1');await once(server,'listening');let browser;
 try{
  browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.evaluate(shell=>new Promise(resolve=>{
   const frame=document.querySelector('iframe');window.__previewReady=false;
   addEventListener('message',event=>{if(event.source===frame.contentWindow&&event.data?.type==='homer-preview-ready')window.__previewReady=true;});
   frame.onload=()=>{frame.contentWindow.postMessage({type:'homer-html-preview',html:'<h1>合成预览</h1>',runtime:"parent.postMessage({type:'homer-preview-ready'},'*');"},'*');resolve();};frame.srcdoc=shell;
  }),htmlPreviewShell);
  await page.frameLocator('iframe[title="outer"]').frameLocator('iframe[title="隔离交互内容"]').getByRole('heading',{name:'合成预览'}).waitFor();
  await page.waitForFunction(()=>window.__previewReady===true);
 }finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
