// Actual UI and isolated Chrome; attachment metadata, media bytes and receipts are fixtures.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {composerFixture} from './fixtures/composer-browser-server.mjs';
import {isolatedChrome} from './web-history-browser-cdp.mjs';

const destination=resolve(process.env.HOMER_IMAGE_EVIDENCE??'.codex/scratch/image-preview-dedupe-20261023/browser');
const webDir=resolve(process.env.HOMER_IMAGE_BUILD??'.codex/scratch/image-preview-dedupe-20261023/after-web');
mkdirSync(destination,{recursive:true});
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGOI6tkCRwzEcQCU8hmhmgeEcAAAAABJRU5ErkJggg==','base64');
const media=(assetId,state='ready',kind='image')=>({assetId,revision:1,state,kind,filename:assetId+(kind==='image'?'.png':'.txt'),mime:kind==='image'?'image/png':'text/plain',size:94720,error:null});
const assets=[media('normal'),media('document','ready','file'),media('pending','downloading'),media('failed','failed'),media('expired','expired'),media('fetch-error'),media('decode-error')];
const message=items=>({id:'attachment-fixture',threadId:'composer-review',requestId:'attachment-fixture-request',role:'user',text:'合成图片附件验收',status:'completed',createdAt:1700000000000,media:items});
const fixture=await composerFixture({webDir,beforeDir:webDir,branding:resolve('assets/branding/homer-river-stone-256.de41791ce5c1.png'),resource(req,res,url){
 const [,id,revision]=url.pathname.match(/^\/api\/media\/attachment-fixture\/([^/]+)\/(\d+)$/)??[];
 if(!id){res.writeHead(404);res.end();return;}
 if(id==='fetch-error'||revision!=='1'){res.writeHead(503);res.end('synthetic unavailable');return;}
 res.writeHead(200,{'Content-Type':id==='document'?'text/plain':'image/png'});
 res.end(id==='decode-error'?Buffer.from('synthetic invalid image bytes'):id==='document'?Buffer.from('synthetic file'):png);
}});
const chrome=await isolatedChrome(destination),checks=[];
let passed=false;
try{
 for(const width of [1440,390,320]){
  fixture.reset({features:{draftUpload:true,taskOverview:false},messages:[message(assets)]});
  const page=await chrome.page(fixture.url,width);
  const check=async(label,fn)=>{assert.ok(await page.evaluate(fn),label);checks.push({width,label});};
  try{
   await page.navigate();await page.until(()=>document.querySelectorAll('.message-attachment').length===7,10000);
   await page.evaluate(()=>document.querySelector('.message-attachment').scrollIntoView());
   await page.until(()=>document.querySelector('.message-attachment img')?.naturalWidth===4,10000);
   await page.screenshot('image-loaded-'+width+'.png');
   await check('decoded image has one preview without a file card, caption or placeholder',()=>{const f=document.querySelector('.message-attachment');return f.querySelectorAll('[data-slot="image-preview"]').length===1&&!f.querySelector('figcaption,[data-slot="file-root"],.media-preview-placeholder');});
   await page.evaluate(()=>document.querySelector('.message-attachment [aria-label="放大图片"]').click());
   await page.until(()=>document.querySelector('[data-slot="image-zoom-content"]')?.naturalWidth===4,10000);
   await check('image zoom remains available',()=>!!document.querySelector('[role="dialog"][aria-label="放大的图片"]'));
   await page.command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
   await page.until(()=>!document.querySelector('[data-slot="image-zoom-overlay"]'),10000);
   await check('ordinary file retains its name, size and download action',()=>{const f=document.querySelectorAll('.message-attachment')[1];return f.textContent.includes('document.txt')&&f.querySelector('[data-slot="file-size"]')&&f.querySelector('[data-slot="file-download"]');});
   await check('preparing, failed and expired images remain identifiable',()=>{const f=document.querySelectorAll('.message-attachment');return f[2].textContent.includes('pending.png')&&f[2].textContent.includes('准备中')&&f[3].textContent.includes('failed.png')&&f[3].textContent.includes('准备失败')&&f[4].textContent.includes('expired.png')&&f[4].textContent.includes('已过期');});
   await page.evaluate(()=>document.querySelectorAll('.message-attachment')[6].scrollIntoView());
   await page.until(()=>!!document.querySelector('[data-slot="image-preview-error"]'),10000);
   await check('image decode error retains vendor error presentation and downloadable file card',()=>{const f=document.querySelectorAll('.message-attachment')[6];return f.querySelector('[data-slot="image-preview-error"]')&&f.textContent.includes('decode-error.png')&&f.querySelector('[data-slot="file-download"]');});
   await check('preview HTTP error retains identifiable download fallback',()=>{const f=document.querySelectorAll('.message-attachment')[5];return f.textContent.includes('fetch-error.png')&&f.querySelector('[data-slot="file-download"]');});
   await page.evaluate(()=>document.querySelectorAll('.message-attachment')[5].querySelector('[data-slot="file-download"]').click());
   await page.until(()=>document.querySelectorAll('.message-attachment')[5].textContent.includes('下载未完成'),10000);
   checks.push({width,label:'failed fallback download reports failure instead of silently dropping the attachment'});
   // Move the successful preview out of LazyMedia's observed area, then return.
   await page.evaluate(()=>{const f=document.querySelectorAll('.message-attachment')[6];f.style.marginTop='1800px';f.scrollIntoView();});
   await page.until(()=>!document.querySelector('.message-attachment img'),10000);
   await check('unmounted lazy image restores the file fallback',()=>!!document.querySelector('.message-attachment [data-slot="file-root"]'));
   await page.evaluate(()=>document.querySelector('.message-attachment').scrollIntoView());
   await page.until(()=>document.querySelector('.message-attachment img')?.naturalWidth===4&&!document.querySelector('.message-attachment figcaption'),10000);
   checks.push({width,label:'returning to a lazily unloaded image removes the fallback after decoding again'});
   fixture.update({messages:[message([{...assets[0],revision:2}])]});
   await page.until(()=>document.querySelectorAll('.message-attachment').length===1&&!!document.querySelector('.message-attachment [data-slot="file-download"]'),10000);
   await check('new unavailable revision cannot reuse old image success',()=>document.querySelector('.message-attachment').textContent.includes('normal.png'));
   fixture.update({messages:[message([{...assets[0],state:'revoked'}])]});
   await page.until(()=>document.querySelector('.message-attachment').textContent.includes('已撤回'),10000);
   await check('revoked image has a name and status without an active download',()=>document.querySelector('.message-attachment').textContent.includes('normal.png')&&!document.querySelector('.message-attachment [data-slot="file-download"]'));
   assert.deepEqual(page.errors,[]);assert.deepEqual(page.blocked,[]);assert.deepEqual(fixture.received.denied,[]);
   await page.screenshot('fallback-'+width+'.png');
  }catch(error){await page.screenshot('failure-'+width+'.png');writeFileSync(join(destination,'failure-'+width+'.json'),JSON.stringify({error:String(error),errors:page.errors,dom:await page.evaluate(()=>document.querySelector('.message-attachments')?.outerHTML)},null,2));throw error;}
  finally{await page.close();}
 }
 passed=true;
}finally{await fixture.close();await chrome.close();writeFileSync(join(destination,'message-image-preview.json'),JSON.stringify({passed,syntheticOnly:true,browser:chrome.version,checks},null,2));}
console.log(JSON.stringify({passed,syntheticOnly:true,widths:[1440,390,320],checks:checks.length}));
