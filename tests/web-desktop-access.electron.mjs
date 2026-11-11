// Explicit real-Electron offline check; npm test does not launch native apps.
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync,copyFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {_electron} from 'playwright-core';

const parent=resolve('.codex/scratch/open-source-web-boundary-20261102/electron');mkdirSync(parent,{recursive:true});
const directory=mkdtempSync(join(parent,'synthetic-')),compiled=join(directory,'compiled');
execFileSync(process.execPath,['node_modules/typescript/bin/tsc','-p','tsconfig.json','--outDir',compiled],{stdio:'pipe'});
mkdirSync(join(directory,'scripts'));copyFileSync('scripts/windows-security.mjs',join(directory,'scripts/windows-security.mjs'));
const instance=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),args:[resolve('tests/fixtures/desktop-access-electron.mjs'),directory,compiled],env:{PATH:process.env.PATH,LANG:'en_US.UTF-8'},timeout:30000});
let foreignCredential=false,foreignRequests=0;
const foreign=createServer((request,response)=>{foreignRequests++;foreignCredential||=Object.keys(request.headers).some(k=>k==='x-homer-desktop-access');response.setHeader('Access-Control-Allow-Origin','*');response.end('{}');});
await new Promise(r=>foreign.listen(0,'127.0.0.1',r));
const checks=[];
const active=async()=>{for(let i=0;i<100;i++){const pages=instance.windows(),page=pages.find(p=>p.url().startsWith('http://127.0.0.1:'));if(page)return page;await new Promise(r=>setTimeout(r,50));}throw Error('synthetic_desktop_page_timeout');};
try{
 const page=await active();await page.getByRole('button',{name:'读取状态'}).click();await page.waitForFunction(()=>document.querySelector('output').textContent==='200');checks.push('main UI button reads authenticated state');
 const url=await instance.evaluate(()=>globalThis.desktopAccessFixture.url());
 const denied=await fetch(url+'/api/history/state');assert.equal(denied.status,401);await denied.arrayBuffer();checks.push('uncredentialed local process denied');
 const result=await page.evaluate(async()=>{
  const post=(path,input)=>fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
  const controller=new AbortController(),events=await fetch('/api/history/events',{signal:controller.signal});const first=await events.body.getReader().read();controller.abort();
  const image=await new Promise(resolve=>{const img=new Image();img.onload=()=>resolve(true);img.onerror=()=>resolve(false);img.src='/api/media/synthetic/asset-11111111-1111-4111-8111-111111111111/1';});
  const file=await fetch('/api/media/synthetic/asset-22222222-2222-4222-8222-222222222222/1');
  const upload=await fetch('/api/uploads',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Homer-Filename':'synthetic.txt','X-Homer-Thread':'synthetic-electron','X-Homer-Request':'synthetic-input','X-Homer-Upload':'synthetic-upload'},body:new Blob(['x'])});
  return {events:events.status,first:first.value.length>0,image,file:await file.text(),upload:upload.status,submit:(await post('/api/messages',{requestId:'synthetic-input',text:'synthetic'})).status,decision:(await post('/api/interactions/synthetic',{requestId:'synthetic-decision',text:'拒绝本次操作'})).status};
 });
 assert.deepEqual(result,{events:200,first:true,image:true,file:'synthetic artifact',upload:201,submit:202,decision:202});checks.push('SSE, image, file, upload, submit and decision work in real Chromium');
 const foreignUrl='http://127.0.0.1:'+foreign.address().port+'/';
 assert.equal(await page.evaluate(async address=>{try{await fetch(address,{mode:'no-cors'});return 'allowed';}catch{return 'blocked';}},foreignUrl),'blocked');
 await instance.evaluate(async({BrowserWindow},address)=>{const w=new BrowserWindow({show:false,webPreferences:{partition:'homer-desktop',sandbox:true}});await w.loadURL(address);w.destroy();},foreignUrl);
 assert.ok(foreignRequests);assert.equal(foreignCredential,false);checks.push('CSP blocks foreign UI fetch; other-origin window receives no credential');
 await page.evaluate(()=>{const frame=document.createElement('iframe');frame.src='/preview/interactive';document.body.append(frame);});
 await page.waitForFunction(()=>document.querySelector('iframe')?.contentWindow!==null);
 const preview=page.frames().find(frame=>frame.url().endsWith('/preview/interactive'))??await page.waitForEvent('framenavigated',{predicate:frame=>frame.url().endsWith('/preview/interactive'),timeout:5000}).catch(()=>null);
 if(!preview)throw Error('synthetic_preview_not_loaded');
 assert.equal(await preview.evaluate(async()=>{try{await fetch('/api/history/state');return 'allowed';}catch{return 'blocked';}}),'blocked');checks.push('sandboxed preview cannot fetch the management API');
 const other=await instance.evaluate(async({BrowserWindow})=>{const w=new BrowserWindow({show:false,webPreferences:{partition:'homer-desktop',sandbox:true}});await w.loadURL(globalThis.desktopAccessFixture.url()+'/');const status=await w.webContents.executeJavaScript("fetch('/api/history/state').then(r=>r.status)");w.destroy();return status;});assert.equal(other,401);checks.push('other window in the same session denied');
 await instance.evaluate(()=>globalThis.desktopAccessFixture.reopen());const reopened=await active();assert.equal(await reopened.evaluate(async()=>(await fetch('/api/history/state')).status),200);checks.push('recreated main window reconnects automatically');
 assert.equal(await instance.evaluate(()=>globalThis.desktopAccessFixture.restart()),401);const restarted=await active();assert.equal(await restarted.evaluate(async()=>(await fetch('/api/history/state')).status),200);checks.push('old key denied after gateway replacement; new UI authorized');
 const receipt={synthetic:true,models:0,installedAppTouched:false,electron:await instance.evaluate(()=>process.versions.electron),checks};writeFileSync(join(directory,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt,null,2));
}finally{await instance.evaluate(()=>globalThis.desktopAccessFixture?.close()).catch(()=>{});await instance.close();await new Promise(r=>foreign.close(r));}
