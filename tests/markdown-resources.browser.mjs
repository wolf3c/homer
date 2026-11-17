// Actual Preview + host resource reads; synthetic files/account-free HTTP only.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,unlinkSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {htmlAttachmentFixture} from './canvas-html-publication-fixture.ts';
import {createWebServer} from '../src/web-server.ts';
import {composerFixture} from './fixtures/composer-browser-server.mjs';
import {openBrowser} from './helpers/image-zoom-browser.mjs';

const dest=resolve(process.env.HOMER_BROWSER_EVIDENCE),webDir=resolve(process.env.HOMER_COMPONENT_BUILD??process.env.HISTORY_FOLLOWUP_BUILD);
mkdirSync(dest,{recursive:true});
const markdown='# 合成报告\n\n正文保留交付快照。\n\n![同目录](./chart.png)\n\n![子目录](images/chart.png)\n\n![上一级](../parent.png)\n\n![中文空格](图%20表.png?size=1#part)\n\n![缺失](missing.png)';
const f=htmlAttachmentFixture('合成报告.md',Buffer.from(markdown)),sent=f.send(),requests=[],checks=[];
let server,fixture,chrome,exit,failure;
try{
 server=await createWebServer({bridge:f.bridge,port:0});
 fixture=await composerFixture({webDir,beforeDir:webDir,branding:resolve('assets/branding/odysseus-20261030/homer-odysseus-256.png'),resource:async(_req,res,url)=>{
  requests.push(url.pathname);const result=await fetch(server.url+url.pathname+url.search);
  res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()));
 }});
 const asset=f.media.view(sent),artifact={id:JSON.stringify([sent.messageId,sent.assetId,sent.revision]),messageId:sent.messageId,assetId:sent.assetId,revision:sent.revision,title:asset.filename,sha256:sent.sha256};
 fixture.reset({messages:[{id:'bubble',threadId:'composer-review',role:'assistant',status:'completed',createdAt:1700000000000,text:'![气泡相对](bubble.png)'},{id:sent.messageId,threadId:'composer-review',role:'assistant',status:'completed',createdAt:1700000001000,text:'请预览合成报告。',media:[asset]}],artifacts:[artifact],features:{draftUpload:false,taskOverview:false}});
 chrome=await openBrowser(dest,{mockKeychain:true});
 const context=await chrome.browser.newContext({viewport:{width:1440,height:1000}});
 await context.route('**/*',route=>{
  const url=new URL(route.request().url());return url.origin===fixture.url||['blob:','data:','about:'].includes(url.protocol)?route.continue():route.abort();
 });
 const page=await context.newPage();
 const image=async width=>Buffer.from(await page.evaluate(width=>{
  const c=document.createElement('canvas');c.width=width;c.height=64;const g=c.getContext('2d');g.fillStyle='#62735a';g.fillRect(0,0,width,64);g.fillStyle='white';g.font='18px sans-serif';g.fillText('Synthetic image',8,38);return c.toDataURL('image/png').split(',')[1];
 },width),'base64');
 const bytes=await image(176),folder=dirname(f.original);mkdirSync(join(folder,'images'));
 for(const path of ['chart.png','images/chart.png','../parent.png','图 表.png'])writeFileSync(join(folder,path),bytes);
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});await page.goto(fixture.url);
  assert.equal(await page.locator('img[alt="气泡相对"]').getAttribute('src'),'bubble.png');
  await page.getByRole('button',{name:'预览 合成报告.md',exact:true}).click();
  for(const alt of ['同目录','子目录','上一级','中文空格']){
   const img=page.locator('.canvas-markdown img[alt="'+alt+'"]');await img.waitFor();await img.scrollIntoViewIfNeeded();
   await page.waitForFunction(alt=>document.querySelector('.canvas-markdown img[alt="'+alt+'"]')?.naturalWidth===176,alt);
  }
  await page.locator('.canvas-markdown .lazy-media').last().scrollIntoViewIfNeeded();
  await page.locator('.canvas-markdown').getByText('附件预览暂不可用',{exact:true}).waitFor();
  assert.ok((await page.locator('.canvas-markdown').innerText()).includes('正文保留交付快照'));
  await page.locator('.canvas-markdown h1').scrollIntoViewIfNeeded();await page.screenshot({path:join(dest,'preview-'+width+'.png')});
  checks.push({width,imagesDecoded:4,missingImageFallback:true,bubbleRelativeUnchanged:true});
  if(width===1440)unlinkSync(f.original);
 }
 // A reopened Preview reads live image bytes even after the original Markdown was deleted.
 writeFileSync(join(folder,'chart.png'),await image(224));await page.reload();await page.getByRole('button',{name:'预览 合成报告.md',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.canvas-markdown img[alt="同目录"]')?.naturalWidth===224);
 checks.push({sourceMarkdownDeleted:true,snapshotTextPreserved:true,reopenedImageUpdated:true});
 await context.close();
}catch(error){failure=error;}finally{
 if(chrome)exit=await chrome.finish();if(fixture)await fixture.close();if(server)await server.close();f.close();
 writeFileSync(join(dest,'browser-result.json'),JSON.stringify({syntheticOnly:true,checks,requests,exit,failure:failure?String(failure):null},null,2));
}
if(failure)throw failure;assert.equal(exit.code,0);assert.equal(exit.watchdog,false);assert.equal(exit.forced,false);console.log(JSON.stringify({checks,exit}));
