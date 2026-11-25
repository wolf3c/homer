// Production HomerApp/CanvasPanel/Annotorious; isolated HTTP, synthetic bytes,
// visible Electron Chromium window. No product profile, account or model.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createRequire} from 'node:module';
import {_electron} from 'playwright-core';
import {buildSync} from 'esbuild';
import {readFile} from 'node:fs/promises';
import {composerFixture} from './fixtures/composer-browser-server.mjs';
const require=createRequire(import.meta.url),webDir=resolve(process.env.HISTORY_FOLLOWUP_BUILD),out=resolve(process.env.HOMER_BROWSER_EVIDENCE);
await mkdir(out,{recursive:true});
const scratch=await mkdtemp('/private/tmp/homer-preview-entry-window-'),files=[],checks=[],errors=[],blocked=[],uploads=[];
const harness=buildSync({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import ScreenshotDialog from './ui/screenshot-dialog';import './ui/capture-panel.css';const root=createRoot(document.getElementById('root'));window.capture={sent:0,cancelled:0};const bytes=Uint8Array.from(atob(window.png),c=>c.charCodeAt(0)),file=new File([bytes],'合成截图.png',{type:'image/png'});window.showScreenshot=floating=>root.render(<ScreenshotDialog file={file} floating={floating} focusInput={()=>{}} onDone={async()=>{window.capture.sent++;root.render(null)}} onCancel={async()=>{window.capture.cancelled++;root.render(null)}}/>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,outdir:scratch,format:'iife',jsx:'automatic',logLevel:'silent'}).outputFiles;
const captureScripts=Object.fromEntries(harness.map(f=>[f.path.endsWith('.css')?'css':'js',f.text]));
const index=await readFile(join(webDir,'index.html'),'utf8'),styles=index.match(/<link[^>]*rel="stylesheet"[^>]*>/g)?.join('')??'';
const fixture=await composerFixture({webDir,branding:resolve('assets/branding/odysseus-20261030/homer-odysseus-256.png'),resource:(_req,res,url)=>{
 if(url.pathname==='/api/media/synthetic-capture'){res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+styles+'<link rel="stylesheet" href="/api/media/capture.css"><style>:root{--capture-x:12px;--capture-y:60px;--capture-width:calc(100vw - 24px);--capture-height:calc(100vh - 100px);--capture-image-width:calc(100vw - 24px)}</style><div id="root"></div><script>window.png='+JSON.stringify(files[0].bytes.toString('base64'))+'</script><script src="/api/media/capture.js"></script>');return;}
 if(url.pathname.startsWith('/api/media/capture.')){const kind=url.pathname.endsWith('.css')?'css':'js';res.writeHead(200,{'Content-Type':kind==='css'?'text/css':'text/javascript'});res.end(captureScripts[kind]);return;}
 const file=files.find(f=>f.path===url.pathname);if(!file){res.writeHead(404);res.end();return;}
 res.writeHead(200,{'Content-Type':file.mime,'X-Homer-Artifact-Hash':file.attachment.sha256});res.end(file.bytes);
}});
const add=(title,mime,bytes)=>{const assetId='asset-00000000-0000-4000-8000-'+String(files.length+1).padStart(12,'0');const attachment={id:JSON.stringify(['result-reply',assetId,1]),title,messageId:'result-reply',assetId,revision:1,sha256:createHash('sha256').update(bytes).digest('hex')};files.push({title,mime,bytes,attachment,path:'/api/media/result-reply/'+assetId+'/1'});};
let app,exit,failed;const message={id:'result-reply',threadId:'composer-review',requestId:'fixture-result',role:'assistant',text:'用于核对 Preview 顶栏及图片批注的合成材料。',status:'completed',createdAt:1700000000000};
try{
 await writeFile(join(scratch,'main.cjs'),`const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(join(scratch,'profile'))});app.whenReady().then(()=>new BrowserWindow({width:1440,height:930,webPreferences:{contextIsolation:true,sandbox:true}}).loadURL(${JSON.stringify(fixture.url)}));app.on('window-all-closed',()=>app.quit());`);
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 app=await _electron.launch({executablePath:require('electron'),args:[join(scratch,'main.cjs')],env,timeout:30000});app.process().once('exit',(code,signal)=>exit={code,signal});
 const page=await app.firstWindow();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(String(e)));
 await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin===fixture.url&&url.pathname==='/api/uploads'){const h=route.request().headers();uploads.push(h['x-homer-upload']);return route.fulfill({json:{assetId:'asset-ffffffff-ffff-4fff-8fff-fffffffffff1',revision:1,filename:decodeURIComponent(h['x-homer-filename']),kind:'image',state:'ready',mime:'image/png',size:route.request().postDataBuffer().length,error:null}})}if(url.origin===fixture.url||['data:','blob:','about:'].includes(url.protocol))return route.continue();blocked.push(url.href);return route.abort()});
 const png=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1200;c.height=780;const x=c.getContext('2d');x.fillStyle='#f6f5f1';x.fillRect(0,0,1200,780);x.fillStyle='#292825';x.font='28px system-ui';x.fillText('工作台 · 合成截图',42,65);for(let i=0;i<4;i++){x.fillStyle='#fff';x.fillRect(36,110+i*155,1128,130);x.fillStyle='#655f54';x.font='22px system-ui';x.fillText(['明确目标','分配工作','核对细节','继续下一步'][i],65,158+i*155);x.font='17px system-ui';x.fillText('让目标具体，让结果可以核对。',65,203+i*155)}return c.toDataURL('image/png').split(',')[1]}),'base64');
 add('工作台截图.png','image/png',png);add('项目说明.txt','text/plain',Buffer.from('合成说明\n\n重要操作与标签共用顶栏。\n此材料仅供隔离验证。'));
 add('工作台改版方案与项目状态对照图（团队讨论修订版）.png','image/png',png);
 add('说明.md','text/markdown',Buffer.from('# 合成项目说明\n\n保留正文标题与内容。'));add('预览.html','text/html',Buffer.from('<!doctype html><meta charset="utf-8"><h1>合成网页</h1><p>仅用于核对 Preview 顶栏。</p>'));
 add('音频.wav','audio/wav',Buffer.from('synthetic audio'));add('视频.mp4','video/mp4',Buffer.from('synthetic video'));add('未知.bin','application/octet-stream',Buffer.from('synthetic unknown'));
 const settle=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const shot=name=>page.screenshot({path:join(out,name+'.png')});
 async function header(){await settle();const g=await page.locator('.canvas-tab-bar').evaluate(row=>{const r=row.getBoundingClientRect(),rail=row.querySelector('.canvas-tab-rail,.canvas-preview-label').getBoundingClientRect(),tab=row.querySelector('[aria-selected=true]')?.closest('.canvas-tab-item').getBoundingClientRect();return{row:{x:r.x,right:r.right},rail:{x:rail.x,right:rail.right},tab:tab&&{x:tab.x,right:tab.right}}});if(g.tab)assert(g.tab.x>=g.rail.x-1&&g.tab.right<=g.rail.right+1,JSON.stringify(g));if(await page.locator('.canvas-file-fallback').isVisible())await page.locator('.canvas-file-actions button').first().waitFor();else{await page.locator('.preview-toolbar').waitFor();assert(await page.locator('.preview-toolbar').evaluate(e=>{const r=e.getBoundingClientRect();return [...e.querySelectorAll('button')].filter(b=>!b.closest('.canvas-image-controls')).every(b=>{const t=b.getBoundingClientRect();return t.x>=r.x&&t.right<=r.right+1;});}));}assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));return g;}
 async function open(title){if(await page.locator('.canvas-collapse').isVisible())await page.locator('.canvas-collapse').click();await page.getByRole('button',{name:'预览 '+title,exact:true}).click();await page.waitForSelector('#canvas-panel');await page.waitForFunction(()=>!document.querySelector('#canvas-panel [role=status]')?.textContent.includes('正在读取'));await settle();}
 for(const width of (process.env.HOMER_TEST_WIDTHS?.split(',').map(Number)??[1440,390,320])){
  await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setContentSize(width,900),width);
  await page.evaluate(()=>sessionStorage.clear());fixture.reset({messages:[message],artifacts:files.map(f=>f.attachment),features:{draftUpload:true,taskOverview:false,previewReferenceCollections:2}});await page.goto(fixture.url);
  try{
   for(const f of files){await open(f.title);await header();if(f.mime==='text/html')await page.waitForSelector('iframe[title="隔离 HTML 成果"]');if(f.mime==='text/plain')await shot('text-'+width);}
   await open(files[2].title);await page.waitForSelector('.image-annotation img');await header();await shot('long-title-'+width);
   await page.locator('.image-annotation-toggle').click();await page.waitForSelector('.image-annotation.is-annotating img');
   await page.waitForSelector('.image-annotation-hint');await shot('entry-'+width);
   assert.equal(await page.locator('.a9s-annotationlayer').evaluate(e=>getComputedStyle(e).cursor),'crosshair');
   assert.equal(await page.locator('.image-annotation').evaluate(e=>getComputedStyle(e).animationDuration),'0.2s');
   await page.waitForSelector('.image-annotation-hint',{state:'detached'});assert.equal(await page.locator('.image-annotation-toggle span:not(.sr-only)').innerText(),'批注');assert.equal(await page.locator('.image-annotation-toggle').getAttribute('aria-pressed'),'true');await header();await shot('active-'+width);
   await page.locator('.image-annotation-toggle').click();assert.equal(await page.locator('.image-annotation.is-annotating').count(),0);assert.equal(await page.locator('.image-annotation-status').count(),0);
   await page.locator('.image-annotation-toggle').click();await page.waitForSelector('.image-annotation-hint');
   const r=await page.locator('.image-annotation img').boundingBox();await page.mouse.move(r.x+r.width*.2,r.y+r.height*.25);await page.mouse.down();await page.mouse.move(r.x+r.width*.65,r.y+r.height*.52,{steps:8});assert.equal(await page.locator('.image-annotation-hint').count(),0);await shot('drag-'+width);await page.mouse.up();
   await page.locator('.annotation-comment-form textarea').fill('请核对这处区域。');await page.locator('.annotation-comment-form button[type=submit]').click();await page.waitForSelector('.annotation-comment-form',{state:'detached'});assert.equal(await page.locator('.image-region-number').count(),1);const geometry=await page.locator('.image-region-number').evaluate(el=>{const r=el.getBoundingClientRect(),img=el.closest('.image-annotation').querySelector('img').getBoundingClientRect();return{left:r.x-img.x,top:r.y-img.y,width:r.width,height:r.height,color:getComputedStyle(el).backgroundColor};});assert.equal(geometry.width,28);assert.equal(geometry.color,'rgb(0, 108, 255)');assert(Math.abs(geometry.left+14-r.width*.2)<4);assert(Math.abs(geometry.top+14-r.height*.25)<4);await shot('saved-markers-'+width);
   assert.equal(await page.locator('.image-annotation-toggle').getAttribute('aria-pressed'),'false');assert(await page.locator('.image-annotation-toggle').evaluate(e=>e===document.activeElement));await shot('exit-'+width);
   await page.locator('.image-annotation-toggle').click();await page.waitForSelector('.image-annotation-hint');await page.keyboard.press('Escape');await page.waitForTimeout(1750);assert.equal(await page.locator('.image-annotation-hint,.image-annotation-status').count(),0);
   // Tab-key navigation and long active title stay inside the rail as actions grow.
   const tab=page.getByRole('tab',{name:files[1].title,exact:true});await tab.focus();await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');await header();
   await page.emulateMedia({reducedMotion:'reduce'});await page.locator('.image-annotation-toggle').click();await page.waitForSelector('.image-annotation-hint');assert.equal(await page.locator('.image-annotation').evaluate(e=>getComputedStyle(e).animationName),'none');await page.keyboard.press('Escape');await page.emulateMedia({reducedMotion:'no-preference'});
   await page.goto(fixture.url+'/api/media/synthetic-capture');await page.waitForFunction(()=>typeof window.showScreenshot==='function');
   for(const floating of [false,true]){
    await page.evaluate(floating=>window.showScreenshot(floating),floating);await page.waitForSelector('.image-annotation-hint');await page.waitForSelector('.image-annotation img');await shot((floating?'floating':'screenshot')+'-entry-'+width);
    await page.waitForSelector('.image-annotation-hint',{state:'detached'});if(floating)assert.equal(await page.locator('.image-annotation-status').innerText(),'批注中');else assert.equal(await page.locator('.image-annotation-toggle').getAttribute('aria-pressed'),'true');
    if(floating){assert.equal(await page.locator('.image-annotation-toggle').count(),0);await page.locator('.a9s-annotationlayer').click();await page.keyboard.press('Escape');await page.waitForFunction(()=>window.capture.cancelled===1)}
    else{await page.locator('.image-annotation-toggle').click();assert.equal(await page.locator('.image-annotation.is-annotating').count(),0);await page.getByRole('button',{name:'完成',exact:true}).click();await page.waitForFunction(()=>window.capture.sent===1)}
    await page.waitForSelector('.image-annotation',{state:'detached'});
   }
   checks.push({width,syntheticScreenshotDialog:true,syntheticFloatingScreenshot:true,types:files.map(f=>f.mime),singleTitleRow:true,longTitle:true,entry:true,drag:true,save:true,exit:true,escapeFocus:true,noStaleTimer:true,keyboard:true,reducedMotion:true});
  }catch(e){await shot('failure-'+width);throw e}
 }
 assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);assert.deepEqual(fixture.received.messages,[]);assert.deepEqual(fixture.received.uploads,[]);assert.equal(uploads.length,checks.length);
}catch(e){failed=String(e.stack??e)}finally{
 await fixture.close();if(app)await app.close();await rm(scratch,{recursive:true,force:true});
 const result={passed:!failed&&exit?.code===0,checks,errors,blocked,exit,failure:failed,scope:'Actual production UI in isolated Electron; synthetic HTTP and image only; no product profile, model, install or real capture.'};
 await writeFile(join(out,'verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));if(!result.passed)process.exitCode=1;
}
