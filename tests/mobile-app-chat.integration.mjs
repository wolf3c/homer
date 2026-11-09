// Real browser bundled UI + Homer owners + actual Yezi2 signaling. Synthetic data only.
import {test} from 'node:test';import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';import {resolve} from 'node:path';
import {mkdirSync,writeFileSync} from 'node:fs';
import {build} from 'vite';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {chromium} from 'playwright-core';
import {buildMobileUi} from '../scripts/build-mobile-ui.mjs';
import {homerWebBridge} from '../src/web-homer.ts';
import {mobileBrowserFixture} from './fixtures/mobile-browser.ts';
const root=process.env.HOMER_YEZI2_ROOT;if(!root)throw Error('HOMER_YEZI2_ROOT_required');
const {startHomerRtcLab}=await import(pathToFileURL(resolve(root,'scripts/homer-rtc-lab.mjs')));
test('bundled chat pairs, approves, sends, reconnects with one credential and revokes over RTC',{timeout:60000},async()=>{
 const base='.codex/scratch/mobile-webrtc/app-chat';mkdirSync(base,{recursive:true});
 const {html}=await buildMobileUi(base+'/ui');
 const lab=await startHomerRtcLab(),signalOrigin=new URL(lab.url).origin.replace(/^ws/,'http');
 let host,browser,page,pageServer;const errors=[];
 try{
  host=await mobileBrowserFixture({signalOrigin,uiDirectory:base+'/ui',base});await host.ready;
  const local=async(path,input)=>{const response=await fetch(host.url+'/api/mobile/'+path,input===undefined?undefined:{method:'POST',headers:{Origin:host.url,'Content-Type':'application/json'},body:JSON.stringify(input)});assert.equal(response.status,200);return response.json();};
  const invitation=await local('invite',{}),url=new URL(invitation.url);
  assert.match(url.pathname,/^\/homer\/mobile\/[a-f0-9]{64}$/);
  const binding={signalOrigin,routeId:url.pathname.split('/').at(-1),invitation:url.hash.slice(1)};
  browser=await chromium.launch({channel:'chrome',headless:true});page=await browser.newPage({viewport:{width:393,height:852}});
  page.setDefaultTimeout(12000);
  page.on('pageerror',error=>errors.push(error.message));
  pageServer=createServer((request,response)=>{response.writeHead(request.url==='/'?200:404,{'Content-Type':'text/html'});response.end(request.url==='/'?html:'');});pageServer.listen(0,'127.0.0.1');await once(pageServer,'listening');
  await page.addInitScript(()=>{window.__homerMobileNonce='synthetic';window.__qaMessages=[];window.ReactNativeWebView={postMessage:value=>window.__qaMessages.push(JSON.parse(value))};});
  await page.goto('http://127.0.0.1:'+pageServer.address().port+'/');await page.getByRole('textbox').first().waitFor();
  await page.evaluate(binding=>window.dispatchEvent(new CustomEvent('homer-mobile-connect',{detail:binding})),binding);
  await page.waitForFunction(()=>window.__qaMessages.some(value=>value.type==='credential'));
  const credential=await page.evaluate(()=>window.__qaMessages.find(value=>value.type==='credential').credential);
  const state=await local('state');assert.ok(state.pending);await local('approve',{id:state.pending.id,name:'合成测试手机'});
  await page.waitForFunction(()=>window.__qaMessages.some(value=>value.type==='connection-status'&&value.code==='active'));
  const composer=page.getByRole('textbox').first();await composer.fill('合成移动端消息');
  const send=page.getByRole('button',{name:'发送消息',exact:true});await send.click();
  await page.waitForFunction(()=>document.body.textContent.includes('合成移动端消息'));
  const acceptedUntil=Date.now()+3000;while(!host.history.list('synthetic-mobile-main').some(value=>value.text==='合成移动端消息')&&Date.now()<acceptedUntil)await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(host.history.list('synthetic-mobile-main').filter(value=>value.text==='合成移动端消息').length,1);
  await page.getByText('合成主端回复',{exact:true}).first().waitFor();assert.equal(host.turns.length,1);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:base+'/approved-chat.png'});
  const file=page.getByLabel('选择附件',{exact:true});
  await file.setInputFiles({name:'synthetic.txt',mimeType:'text/plain',buffer:Buffer.from('合成附件正文')});
  await page.getByRole('button',{name:'发送消息',exact:true}).click();
  const uploadUntil=Date.now()+5000;while(host.turns.length<2&&Date.now()<uploadUntil)await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(host.turns.length,2);
  const user=host.history.list('synthetic-mobile-main').filter(value=>value.role==='user').at(-1),ref=user.attachments?.[0];
  assert.ok(ref);assert.ok(host.turns[1].includes(ref.assetId));assert.doesNotMatch(host.turns[1],/合成附件正文/);
  assert.equal(Buffer.from(host.app.readAttachment({messageId:user.id,assetId:ref.assetId,revision:ref.revision}).data,'base64').toString(),'合成附件正文');
  const snapshot=await homerWebBridge(host.app,{}).history.state();
  assert.equal(snapshot.messages.find(message=>message.source?.attachments?.length)?.source?.media?.length,1,'original request must expose its prepared attachment metadata');
  await page.getByText('合成主端回复',{exact:true}).nth(1).waitFor();
  await page.locator('details').filter({hasText:'synthetic.txt'}).locator('summary').first().click();
  await page.getByRole('link',{name:'下载 synthetic.txt',exact:true}).click();
  await page.waitForFunction(()=>window.__qaMessages.some(value=>value.type==='share-file'));
  assert.equal(await page.evaluate(()=>atob(window.__qaMessages.find(value=>value.type==='share-file').base64)),Buffer.from('合成附件正文').toString('latin1'));
  await page.reload();await page.getByRole('textbox').first().waitFor();
  await page.evaluate(binding=>window.dispatchEvent(new CustomEvent('homer-mobile-connect',{detail:binding})),{signalOrigin,routeId:binding.routeId,credential});
  await page.waitForFunction(()=>window.__qaMessages.some(value=>value.type==='connection-status'&&value.code==='active'));
  assert.equal((await local('state')).devices.length,1);
  // Main now restores image thumbnails through the same scoped draft owner.
  await page.getByLabel('选择附件',{exact:true}).setInputFiles({name:'synthetic-image.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGOI6tkCRwzEcQCU8hmhmgeEcAAAAABJRU5ErkJggg==','base64')});
  await page.waitForFunction(()=>document.querySelector('.aui-attachment-tile-image')?.naturalWidth>0&&document.querySelector('.context-attachment-copy')?.textContent.includes('已准备'));
  await page.reload();await page.getByRole('textbox').first().waitFor();
  await page.evaluate(binding=>window.dispatchEvent(new CustomEvent('homer-mobile-connect',{detail:binding})),{signalOrigin,routeId:binding.routeId,credential});
  await page.waitForFunction(()=>window.__qaMessages.some(value=>value.type==='connection-status'&&value.code==='active'));
  await page.waitForFunction(()=>document.querySelector('.aui-attachment-tile-image')?.naturalWidth>0);
  assert.equal(await page.locator('.aui-attachment-root').count(),1);
  await page.locator('.aui-attachment-tile-remove').click();await page.locator('.aui-attachment-root').waitFor({state:'detached'});

  await local('update',{id:state.pending.id,enabled:false});
  await page.waitForFunction(()=>window.__qaMessages.some(value=>value.type==='connection-status'&&value.code==='unavailable'));
  assert.deepEqual(errors,[]);
 }catch(error){if(page)console.log(JSON.stringify({phase:'failure',messages:await page.evaluate(()=>window.__qaMessages.map(value=>value.type==='credential'?{type:value.type}:{type:value.type,code:value.code})),errors}));throw error;}finally{await browser?.close();pageServer?.closeAllConnections();if(pageServer)await new Promise(resolve=>pageServer.close(resolve));await host?.close();await lab.close();}
});

// Exercise real desktop controls as well as the original mobile chat transport.
test('desktop device controls isolate two RTC bindings through rename, disable, enable and delete',{timeout:60000},async()=>{
 const base='.codex/scratch/mobile-webrtc/desktop-device-qa';mkdirSync(base,{recursive:true});
 const {html}=await buildMobileUi(base+'/mobile-ui');
 await build({root:resolve('ui'),configFile:resolve('ui/vite.config.ts'),configLoader:'runner',logLevel:'silent',build:{outDir:resolve(base+'/desktop-ui'),emptyOutDir:true}});
 const lab=await startHomerRtcLab(),signalOrigin=new URL(lab.url).origin.replace(/^ws/,'http');
 let host,browser,pageServer;const clients=[];const errors=[];
 try{
  host=await mobileBrowserFixture({signalOrigin,uiDirectory:base+'/desktop-ui',base});await host.ready;
  browser=await chromium.launch({channel:'chrome',headless:true});
  const desktop=await browser.newPage({viewport:{width:1280,height:900}});desktop.on('pageerror',e=>errors.push(e.message));desktop.setDefaultTimeout(15000);
  await desktop.goto(host.url);await desktop.getByRole('button',{name:'设置',exact:true}).click();await desktop.getByRole('tab',{name:'移动设备',exact:true}).click();
  await desktop.getByText('还没有绑定设备',{exact:true}).waitFor();
  pageServer=createServer((req,res)=>{res.writeHead(req.url==='/'?200:404,{'Content-Type':'text/html'});res.end(req.url==='/'?html:'');});pageServer.listen(0,'127.0.0.1');await once(pageServer,'listening');
  const add=async(name)=>{
   const response=desktop.waitForResponse(r=>r.url().endsWith('/api/mobile/invite')&&r.request().method()==='POST');
   await desktop.getByRole('button',{name:/^(添加移动设备|添加设备|重新生成二维码)$/}).click();const invite=await(await response).json();const u=new URL(invite.url);
   const qr=desktop.getByRole('img',{name:'用 Homer App 扫描此二维码连接主端',exact:true});await qr.waitFor();assert.equal(await qr.evaluate(img=>img.complete&&img.naturalWidth>0),true);
   const phone=await browser.newPage({viewport:{width:393,height:852}});phone.on('pageerror',e=>errors.push(e.message));
   await phone.addInitScript(()=>{window.__homerMobileNonce='synthetic';window.__qa=[];window.ReactNativeWebView={postMessage:value=>window.__qa.push(JSON.parse(value))};});
   await phone.goto('http://127.0.0.1:'+pageServer.address().port+'/');await phone.getByRole('textbox').first().waitFor();
   await phone.evaluate(binding=>window.dispatchEvent(new CustomEvent('homer-mobile-connect',{detail:binding})),{signalOrigin,routeId:u.pathname.split('/').at(-1),invitation:u.hash.slice(1),deviceName:name});
   await desktop.getByRole('region',{name:'待确认设备',exact:true}).getByText(name,{exact:true}).waitFor();await desktop.getByRole('button',{name:'确认绑定',exact:true}).click();
   await phone.waitForFunction(()=>window.__qa.some(v=>v.type==='connection-status'&&v.code==='active'));
   const binding=await phone.evaluate(signalOrigin=>({signalOrigin,routeId:window.__qa.find(v=>v.type==='credential').routeId,credential:window.__qa.find(v=>v.type==='credential').credential}),signalOrigin);
   clients.push({page:phone,binding});return clients.at(-1);
  };
  const first=await add('合成手机一'),second=await add('合成手机二');
  let row=desktop.getByRole('region',{name:'合成手机一',exact:true});await row.getByRole('button',{name:'重命名合成手机一',exact:true}).click();await row.getByRole('textbox',{name:'设备名称',exact:true}).fill('合成手机改名');await row.getByRole('button',{name:'保存',exact:true}).click();
  row=desktop.getByRole('region',{name:'合成手机改名',exact:true});await row.getByRole('button',{name:'停用合成手机改名',exact:true}).click();await row.getByText('已停用',{exact:true}).waitFor();
  await first.page.waitForFunction(()=>window.__qa.some(v=>v.code==='unavailable'));
  await second.page.getByRole('textbox').first().fill('合成设备二仍可发送');await second.page.getByRole('button',{name:'发送消息',exact:true}).click();await second.page.getByText('合成主端回复',{exact:true}).first().waitFor();assert.equal(host.history.list('synthetic-mobile-main').filter(v=>v.text==='合成设备二仍可发送').length,1);
  await row.getByRole('button',{name:'启用合成手机改名',exact:true}).click();await row.getByText('已启用',{exact:true}).waitFor();
  await first.page.reload();await first.page.getByRole('textbox').first().waitFor();await first.page.evaluate(binding=>window.dispatchEvent(new CustomEvent('homer-mobile-connect',{detail:binding})),first.binding);
  await first.page.waitForFunction(()=>window.__qa.some(v=>v.code==='active'));
  await row.getByRole('button',{name:'删除合成手机改名',exact:true}).click();await desktop.getByRole('alertdialog').getByRole('button',{name:'删除绑定',exact:true}).click();await row.waitFor({state:'detached'});
  await first.page.waitForFunction(()=>window.__qa.some(v=>v.code==='unavailable'));
  const state=await(await fetch(host.url+'/api/mobile/state')).json();assert.equal(state.devices.length,1);assert.equal(state.devices[0].name,'合成手机二');
  await second.page.getByRole('textbox').first().fill('删除其他设备后仍可发送');await second.page.getByRole('button',{name:'发送消息',exact:true}).click();await second.page.getByText('合成主端回复',{exact:true}).nth(1).waitFor();assert.equal(host.history.list('synthetic-mobile-main').filter(v=>v.text==='删除其他设备后仍可发送').length,1);assert.deepEqual(errors,[]);
  await desktop.screenshot({path:base+'/devices.png'});
  const result={desktopSettings:true,qrRendered:true,approvedTwoDevices:true,rename:true,disableIsolated:true,enableRestoresSameBinding:true,deleteIsolated:true,remainingDeviceCanSend:true,pageErrors:errors.length,syntheticOnly:true,nativeQr:false};writeFileSync(base+'/result.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
 }finally{await browser?.close();pageServer?.closeAllConnections();if(pageServer)await new Promise(resolve=>pageServer.close(resolve));await host?.close();await lab.close();}
});
