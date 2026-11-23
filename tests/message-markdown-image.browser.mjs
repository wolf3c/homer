// Production renderer, HTTP route and file authorization, with a synthetic conversation.
import assert from 'node:assert/strict';
import {mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {fixture} from './web-service-fixture.ts';
import {homerWebBridge} from '../src/web-homer.ts';
import {createWebServer} from '../src/web-server.ts';
import {openBrowser} from './helpers/image-zoom-browser.mjs';

const evidence=resolve(process.env.HOMER_BROWSER_EVIDENCE,'message-markdown-image');
mkdirSync(evidence,{recursive:true});
const f=fixture(),threadId='synthetic-main';
const path=join(f.base,'workspace','settings.png'),url=pathToFileURL(path).href;
const outside=join(f.base,'outside.png'),denied=pathToFileURL(outside).href;
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGOI6tkCRwzEcQCU8hmhmgeEcAAAAABJRU5ErkJggg==','base64');
const text=`![设置页][image]\n\n[image]: ${url}\n\n![越界图](${denied})\n\n[普通链接](${denied})\n\n![公网图](https://image.example/public.png)`;
let chrome,web,exit,turn,finish,page;
const errors=[];
try{
 writeFileSync(path,png);writeFileSync(outside,png);
 await f.app.start();
 const engine=f.engines.find(candidate=>!candidate.worker);
 const pending=new Promise(resolve=>{finish=resolve;});
 engine.turn=async(_input,options)=>{
  const final={itemId:'inline-final',phase:'final_answer',text};
  engine.turnId='inline-browser-turn';options?.onStarted?.(engine.turnId);
  engine.emit('agentMessage',{threadId,turnId:engine.turnId,...final,completed:false});
  await pending;
  engine.emit('agentMessage',{threadId,turnId:engine.turnId,...final,completed:true});
  return {status:'completed',text,messages:[final]};
 };
 turn=f.app.message('显示合成图片','inline-browser');
 const token='a'.repeat(64);
 web=await createWebServer({bridge:homerWebBridge(f.app),port:0,uiDirectory:resolve(process.env.HISTORY_FOLLOWUP_BUILD),desktopAccessToken:token});
 chrome=await openBrowser(evidence,{mockKeychain:true});
 page=await chrome.browser.newPage({viewport:{width:1024,height:860}});const requests=[];
 page.setDefaultTimeout(8000);
 page.on('pageerror',error=>errors.push(String(error)));
 await page.addInitScript(()=>{window.homerBrowserPreview={list:async()=>[],onChanged:()=>()=>{},onShow:()=>()=>{}};});
 await page.route(web.url+'/api/**',route=>{
  const request=route.request();
  if(request.url().endsWith('/api/preview/message-file'))requests.push(request.postDataJSON());
  return route.continue({headers:{...request.headers(),'x-homer-desktop-access':token}});
 });
 await page.route('https://image.example/public.png',route=>route.fulfill({contentType:'image/png',body:png}));
 await page.goto(web.url);
 await page.getByText('设置页',{exact:true}).waitFor();
 assert.equal(requests.length,0);
 finish();await turn;await page.reload();
 const image=page.locator('img[alt="设置页"]');
 await image.scrollIntoViewIfNeeded();
 await page.waitForFunction(()=>document.querySelector('img[alt="设置页"]')?.naturalWidth===4);
 const unavailable=page.getByText('越界图 · 图片不可用',{exact:true});
 await unavailable.waitFor();
 assert.ok(await unavailable.evaluate(node=>node.parentElement.getBoundingClientRect().height<40));
 assert.equal(requests.filter(input=>input.inlineImage).length,2);
 await page.locator('img[alt="公网图"]').scrollIntoViewIfNeeded();
 await page.waitForFunction(()=>document.querySelector('img[alt="公网图"]')?.naturalWidth===4);
 await page.getByRole('link',{name:'普通链接',exact:true}).click();
 await page.waitForFunction(()=>Array.from(document.querySelectorAll('#canvas-panel img')).some(img=>img.naturalWidth===4));
 assert.ok(requests.some(input=>input.destination===denied&&!input.inlineImage));
 await page.screenshot({path:join(evidence,'desktop.png')});
 const updated=await page.evaluate(()=>{
  const canvas=document.createElement('canvas');canvas.width=9;canvas.height=7;
  return canvas.toDataURL('image/png').split(',')[1];
 });
 writeFileSync(path,Buffer.from(updated,'base64'));await page.reload();await image.scrollIntoViewIfNeeded();
 await page.waitForFunction(()=>document.querySelector('img[alt="设置页"]')?.naturalWidth===9);
 rmSync(path);await page.reload();
 await page.getByText('设置页 · 图片不可用',{exact:true}).waitFor();
 assert.deepEqual(errors,[]);
}catch(error){
 console.error({errors,text:await page?.locator('body').innerText().catch(()=>''),rows:(await homerWebBridge(f.app).history.state()).messages.map(row=>[row.role,row.status,row.text.slice(0,40)])});
 throw error;
}finally{
 finish?.();await turn;
 exit=await chrome?.finish();await web?.close();await f.app.close();
}
assert.ok(exit?.confirmed);assert.equal(exit.code,0);assert.equal(exit.watchdog,false);assert.equal(exit.forced,false);
console.log('Desktop inline image, streaming, permission, replacement, deletion, URL and normal link verified.');
