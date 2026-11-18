import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {composerFixture} from './fixtures/composer-browser-server.mjs';
import {openBrowser} from './helpers/image-zoom-browser.mjs';

const destination=join(resolve(process.env.HOMER_BROWSER_EVIDENCE),'preview-toggle');
const webDir=resolve(process.env.HOMER_COMPONENT_BUILD??process.env.HISTORY_FOLLOWUP_BUILD);
mkdirSync(destination,{recursive:true});
const bytes=Buffer.from('# 合成成果\n\n用于核对预览切换与文件标签。');
const sha256=createHash('sha256').update(bytes).digest('hex');
const artifacts=Array.from({length:5},(_,i)=>({
 id:'preview-file-'+i,messageId:'synthetic-result',assetId:'asset-00000000-0000-4000-8000-00000000000'+i,
 revision:1,sha256,title:(i+1)+' 预览标签和工具栏的合成长文件名.md',
}));
const fixture=await composerFixture({webDir,beforeDir:webDir,branding:resolve('assets/branding/odysseus-20261030/homer-odysseus-256.png'),resource(req,res){
 res.writeHead(200,{'Content-Type':'text/markdown','X-Homer-Artifact-Hash':sha256});res.end(bytes);
}});
fixture.reset({messages:[{id:'synthetic-result',threadId:'composer-review',requestId:'synthetic-request',role:'assistant',text:'这五份合成文件用于核对 Preview 的打开、收起与标签切换。',status:'completed',createdAt:1700000000000}],artifacts,features:{taskOverview:false}});
let browser,exit,failure;
const checks=[];
try{
 browser=await openBrowser(destination,{mockKeychain:true});
 for(const width of [1440,801,800,390,320]){
  const context=await browser.browser.newContext({viewport:{width,height:800}});
  try{
   const page=await context.newPage(),errors=[];
   page.on('pageerror',error=>errors.push(String(error)));
   await page.goto(fixture.url);
   const open=page.getByRole('button',{name:'预览',exact:true});
   const close=page.getByRole('button',{name:'收起预览',exact:true});
   const panel=page.locator('#canvas-panel');
   const active=panel.locator('[role=tab][aria-selected=true]');
   const first=page.getByRole('button',{name:'预览 '+artifacts[0].title,exact:true});
   await open.waitFor();
   assert.equal(await open.getAttribute('aria-expanded'),'false');
   if(width===1440)await page.screenshot({path:join(destination,'closed-1440.png')});
   await open.focus();await page.keyboard.press('Enter');
   await page.waitForFunction(()=>document.activeElement?.classList.contains('canvas-collapse'));
   await page.keyboard.press('Space');await panel.waitFor({state:'hidden'});
   await page.waitForFunction(()=>document.activeElement?.matches('.conversation-header [aria-controls=canvas-panel]'));
   for(const artifact of artifacts){
    if(width<=800&&await panel.isVisible())await close.click();
    await page.getByRole('button',{name:'预览 '+artifact.title,exact:true}).click();
    await panel.getByRole('heading',{name:'合成成果',exact:true}).waitFor();
   }
   assert.equal(await open.count(),0,'the conversation opener is absent from the accessibility tree while preview is open');
   assert.equal(await close.count(),1);
   assert.equal(await close.getAttribute('aria-controls'),'canvas-panel');
   assert.equal(await close.getAttribute('aria-expanded'),'true');
   const layout=await close.evaluate(button=>{
    const panel=button.closest('#canvas-panel'),rail=panel.querySelector('.canvas-tab-rail');
    const rect=button.getBoundingClientRect(),section=panel.getBoundingClientRect();
    return {width:rect.width,height:rect.height,top:rect.top-section.top,right:section.right-rect.right,
     railRight:rail.getBoundingClientRect().right,buttonLeft:rect.left,scrolling:rail.scrollWidth>rail.clientWidth,
     modal:panel.getAttribute('aria-modal')==='true',overflow:document.documentElement.scrollWidth>innerWidth};
   });
   assert.equal(layout.modal,width<=800);assert.equal(layout.overflow,false);assert.equal(layout.height,width<=800?44:28);
   assert.ok(layout.top>=0&&layout.top<=10&&layout.right>=0&&layout.right<=7&&layout.buttonLeft>=layout.railRight);
   assert.equal(layout.scrolling,true);
   const rail=panel.getByRole('tablist');
   const beforeScroll=await close.boundingBox();
   const scroll=await rail.evaluate(node=>{
    const previous=node.scrollLeft;
    node.scrollLeft=previous>0?0:node.scrollWidth;
    return {previous,current:node.scrollLeft};
   });
   assert.notEqual(scroll.current,scroll.previous);
   assert.deepEqual(await close.boundingBox(),beforeScroll);
   await rail.evaluate((node,previous)=>{node.scrollLeft=previous;},scroll.previous);
   const last=artifacts.at(-1);
   const lastSource=page.getByRole('button',{name:'预览 '+last.title,exact:true});
   assert.equal(await active.getAttribute('aria-label'),last.title);
   await panel.locator('.preview-toolbar [data-slot=file-download]').waitFor();
   await page.mouse.move(5,150);
   await page.screenshot({path:join(destination,'open-'+width+'.png')});
   await close.click();await panel.waitFor({state:'hidden'});
   await page.waitForFunction(title=>document.activeElement?.getAttribute('aria-label')==='预览 '+title,last.title);
   assert.equal(await lastSource.evaluate(node=>node===document.activeElement),true);
   await open.focus();await page.keyboard.press('Enter');
   await page.waitForFunction(()=>document.activeElement?.matches('[role=tab][aria-selected=true]'));
   assert.equal(await active.getAttribute('aria-label'),last.title);
   assert.equal(await panel.getByRole('tab').count(),artifacts.length);
   await close.focus();await page.keyboard.press('Enter');await panel.waitFor({state:'hidden'});
   await page.waitForFunction(()=>document.activeElement?.matches('.conversation-header [aria-controls=canvas-panel]'));
   await page.keyboard.press('Enter');await active.waitFor();
   await page.keyboard.press('Escape');await panel.waitFor({state:'hidden'});
   await page.waitForFunction(()=>document.activeElement?.matches('.conversation-header [aria-controls=canvas-panel]'));
   assert.ok(await first.isVisible());assert.deepEqual(errors,[]);
   checks.push({viewport:width,layout,mouseAndKeyboard:true,focusRestored:true,tabsRetained:true});
  }finally{await context.close();}
 }
 assert.equal(fixture.received.messages.length,0);
}catch(error){failure=error;}finally{
 exit=await browser?.finish();await fixture.close();
 writeFileSync(join(destination,'results.json'),JSON.stringify({checks,exit,failure:failure?String(failure):null},null,2));
}
if(failure)throw failure;
assert.equal(exit.code,0);assert.equal(exit.watchdog,false);assert.equal(exit.forced,false);
console.log(JSON.stringify({viewports:checks.map(check=>check.viewport),exit}));
