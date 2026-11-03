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
  assert.equal(readFileSync(out+'/chat.mjs','utf8').startsWith('export default '),true);
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
   const page=await browser.newPage({viewport:{width:393,height:852}}),errors=[];
   page.on('pageerror',error=>errors.push(error.message));
   await page.addInitScript(()=>{window.__homerMobileNonce='synthetic-test';window.__messages=[];window.ReactNativeWebView={postMessage:value=>window.__messages.push(JSON.parse(value))};});
   await page.goto(pathToFileURL(resolve(out,'index.html')).href);
   await page.getByRole('textbox').first().waitFor();
   const scan=page.getByRole('button',{name:'重新扫码'}),brand=page.locator('.header-name img'),preview=page.getByRole('button',{name:'预览'});
   const [scanBox,brandBox,previewBox]=await Promise.all([scan.boundingBox(),brand.boundingBox(),preview.boundingBox()]);
   assert.ok(scanBox&&brandBox&&previewBox&&brandBox.x<scanBox.x&&scanBox.x<previewBox.x);
   assert.equal(scanBox.width,44);assert.equal(scanBox.height,44);
   await scan.click();
   assert.deepEqual(await page.evaluate(()=>window.__messages.filter(message=>message.type==='open-scanner')),[{type:'open-scanner',nonce:'synthetic-test'}]);
   await page.setViewportSize({width:320,height:720});
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
