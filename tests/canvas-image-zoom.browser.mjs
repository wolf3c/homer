// Historical filename; now checks unified fit-width preview without zoom controls.
// Real HomerApp/CanvasPanel; synthetic bytes and HTTP only, no account or model.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {composerFixture} from './fixtures/composer-browser-server.mjs';
import {openBrowser} from './helpers/image-zoom-browser.mjs';
const destination=resolve(process.env.HOMER_BROWSER_EVIDENCE);
const webDir=resolve(process.env.HOMER_COMPONENT_BUILD??process.env.HISTORY_FOLLOWUP_BUILD);
const specs=[{id:'wide',title:'合成宽图.png',width:2400,height:1100},{id:'long',title:'合成长图.png',width:1000,height:3000},{id:'detail',title:'合成细字截图.png',width:1920,height:1080},{id:'small',title:'合成小图.png',width:160,height:100}];
const checks=[],requests=[];
function drawImage({id,width,height}){
 const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
 const c=canvas.getContext('2d');c.fillStyle='#f6f5f2';c.fillRect(0,0,width,height);
 const text=(s,x,y,size=24)=>{c.fillStyle='#292825';c.font=size+'px sans-serif';c.fillText(s,x,y);};
 text('合成图片 · '+width+' × '+height,48,75,32);
 if(id==='detail'){
  text('任务名称                         负责人                         状态                         备注',48,140,18);
  for(let i=0;i<32;i++){
   const y=170+i*27;c.fillStyle=i%2?'#eeece8':'#fff';c.fillRect(28,y,width-56,26);
   text('第 '+(i+1)+' 项交付记录                         设计与研发                         已核对                         保留原始记录，确认后交付',48,y+18,13);
  }
 }else for(let i=0;i<6;i++){
  const x=id==='wide'?48+i*390:48,y=id==='wide'?160:160+i*440;
  c.fillStyle=i%2?'#e8ede2':'#fff';c.fillRect(x,y,id==='wide'?345:width-96,id==='wide'?760:380);
  text('0'+(i+1)+'  '+['明确目标','分配工作','核对细节','确认结果','保留记录','继续下一步'][i],x+20,y+70,26);
  for(let j=0;j<4;j++)text('让目标具体，让结果可以核对。',x+20,y+135+j*48,20);
 }
 return canvas.toDataURL('image/png').split(',')[1];
}
async function verifyTabInputs(page,width){
 const focus=()=>page.evaluate(()=>{
  const e=document.activeElement,r=e.getBoundingClientRect(),item=e.closest('.canvas-tab-item').getBoundingClientRect(),rail=document.querySelector('.canvas-tab-rail').getBoundingClientRect();
  return {label:e.getAttribute('aria-label'),focusVisible:e.matches(':focus-visible'),visible:r.left>=rail.left-1&&r.right<=rail.right+1,itemVisible:item.left>=rail.left-1&&item.right<=rail.right+1};
 });
 const wide=page.getByRole('tab',{name:specs[0].title,exact:true}),detail=page.getByRole('tab',{name:specs[2].title,exact:true});
 await wide.click();await page.waitForFunction(()=>document.querySelector('.image-annotation img')?.naturalWidth===2400);
 await detail.focus();await settle(page);const program=await focus();assert.equal(program.visible,true);
 await wide.focus();await page.keyboard.press('ArrowRight');
 await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='合成长图.png');
 const keyboard=await focus();assert.ok(keyboard.visible&&keyboard.itemVisible&&keyboard.focusVisible);
 await page.keyboard.press('Enter');await page.waitForFunction(()=>document.querySelector('.image-annotation img')?.naturalWidth===1000);
 await page.getByRole('button',{name:'关闭文件：'+specs[1].title,exact:true}).focus();await page.keyboard.press('Enter');
 await page.waitForFunction(count=>document.querySelectorAll('.canvas-tab').length===count,specs.length-1);
 assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-selected')),'true');
 await openFile(page,specs[1].title);await page.waitForFunction(()=>document.querySelector('.image-annotation img')?.naturalWidth===1000);
 await detail.click();await page.waitForFunction(()=>document.querySelector('.image-annotation img')?.naturalWidth===1920);
 checks.push({width,pointerTabs:true,keyboardTabs:true,programFocus:program,focusAfterClose:true});
}
const click=(page,selector)=>page.locator(selector).click();
async function verifyWindow(page,width){
 const initial=await view(page);
 await page.setViewportSize({width:width===1440?1100:width+40,height:780});await settle(page);
 const resized=await view(page);assert.notEqual(resized.width,initial.width);
 await page.setViewportSize({width,height:900});await settle(page);
 assert.equal(await page.locator('.canvas-image-controls').count(),0);
 checks.push({width,automaticWidthFit:true});
}
async function verifyAnnotation(page,width){
 await page.getByRole('tab',{name:specs[2].title,exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.image-annotation img')?.naturalWidth===1920);
 const src=(await view(page)).src;
 await click(page,'#canvas-panel button[aria-label=批注]');
 await page.waitForSelector('.image-annotation.is-annotating .a9s-annotationlayer');
 assert.equal(await page.locator('.image-annotation img').getAttribute('src'),src);
 const r=await page.locator('.image-annotation img').boundingBox();
 await page.mouse.move(r.x+r.width*.15,r.y+30);await page.mouse.down();await page.mouse.move(r.x+r.width*.65,r.y+90,{steps:8});await page.mouse.up();
 await page.locator('.annotation-comment-form textarea').fill('统一状态验证');await page.locator('.annotation-comment-form button[type=submit]').click();await page.waitForSelector('.annotation-comment-form',{state:'detached'});
 assert.equal(await page.locator('.image-region-number').count(),1);
 await click(page,'#canvas-panel button[aria-label=批注]');
 assert.equal(await page.locator('#canvas-panel button[aria-label=批注]').getAttribute('aria-pressed'),'false');
 assert.equal(await page.locator('.image-region-number').count(),1);
 const normal=await view(page);await openFile(page,specs[2].title);await page.waitForFunction(()=>document.querySelector('.image-annotation img')?.naturalWidth===1920);await settle(page);const reopened=await view(page);
 assert(Math.abs(reopened.width-normal.width)<1);assert.equal(await page.locator('.image-region-number').count(),1);
 checks.push({width,saveAndReopen:true,blobUnchanged:true});
}
async function verifyPlain(page,fixture,files,width){
 await openFile(page,'合成矢量图.svg');await page.waitForFunction(()=>document.querySelector('.canvas-image-root img')?.naturalWidth===600);
 assert.equal(await page.locator('.image-annotation-toggle,.canvas-image-controls').count(),0);
 assert(await page.locator('.canvas-image-root img').evaluate(e=>e.getBoundingClientRect().width<=innerWidth));
 fixture.update({features:{draftUpload:true,taskOverview:false,previewReferenceCollections:0}});await openFile(page,specs[0].title);
 await page.waitForFunction(()=>document.querySelector('.canvas-image-root img')?.naturalWidth===1200);assert.equal(await page.locator('.image-annotation-toggle,.canvas-image-controls').count(),0);
 checks.push({width,plainSvgAndNoAnnotationCapability:true});
}
async function verifyReplacement(page,fixture,files,width){
 await openFile(page,specs[0].title);await page.waitForFunction(()=>document.querySelector('.image-annotation img')?.naturalWidth===2400);
 const old=(await view(page)).src,replacement=files.find(file=>file.attachment.revision===2),others=files.filter(file=>file.attachment.revision===1&&file.id!=='wide');
 fixture.update({artifacts:[replacement,...others].map(file=>file.attachment)});await openFile(page,specs[0].title);
 await page.waitForFunction(()=>document.querySelector('.image-annotation img')?.naturalWidth===1200);await settle(page);
 assert.notEqual((await view(page)).src,old);assert.equal(requests.filter(path=>path===replacement.path).length,1);
 await openFile(page,'合成损坏图片.png');await page.getByRole('alert').filter({hasText:'图片加载失败'}).waitFor();assert(await page.locator('.image-annotation-toggle').isDisabled());assert.equal(await page.locator('.canvas-image-controls').count(),0);
 checks.push({width,revisionReplaced:true,decodeErrorVisible:true});
}
const settle=page=>page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
const view=page=>page.locator('.image-annotation img').evaluate(image=>{
 const r=image.getBoundingClientRect(),body=image.closest('[data-slot=canvas-split-body]'),bar=document.querySelector('.preview-toolbar').getBoundingClientRect();
 return{width:r.width,height:r.height,left:r.x,top:r.y,naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight,bodyWidth:body.clientWidth,barHeight:bar.height,overflow:document.documentElement.scrollWidth>innerWidth,src:image.src};
});

async function verifyImage(page,spec,width){
 await page.getByRole('tab',{name:spec.title,exact:true}).click();await page.waitForFunction(w=>document.querySelector('.image-annotation img')?.naturalWidth===w,spec.width);await settle(page);
 const initial=await view(page),reads=requests.length;
 if(spec.id==='detail')await page.screenshot({path:join(destination,'initial-'+width+'.png')});
 assert.equal(await page.locator('.image-annotation-toggle').getAttribute('aria-pressed'),'false');
 assert.equal(await page.locator('.canvas-image-controls').count(),0);assert(!initial.overflow&&initial.width<=initial.bodyWidth);
 assert(Math.abs(initial.width/initial.height-spec.width/spec.height)<.001);
 for(const active of[true,false,true,false]){
  await page.locator('.image-annotation-toggle').click();await settle(page);assert.equal(await page.locator('.image-annotation-toggle').getAttribute('aria-pressed'),String(active));
  if(spec.id==='detail')await page.screenshot({path:join(destination,(active?'active':'exit')+'-'+width+'.png')});
  const current=await view(page);for(const k of['width','height','top','left','barHeight'])assert(Math.abs(current[k]-initial[k])<1,k+' changed on toggle');assert.equal(current.src,initial.src);
 }
 assert.equal(requests.length,reads,'mode changes reuse the authorized Blob');
 if(spec.id==='long')assert(initial.height>initial.width);if(width===1440&&spec.id==='wide')assert(initial.width>384);
 await page.screenshot({path:join(destination,'unified-'+spec.id+'-'+width+'.png')});checks.push({width,image:spec.id,initial,modeGeometryStable:true,noExtraRead:true});
}
async function openFile(page,title){
 if(await page.locator('#canvas-panel').count()){
  if(await page.locator('.canvas-collapse').count())await click(page,'.canvas-collapse');
  else await click(page,'.conversation-header button[aria-controls=canvas-panel]');
  await page.waitForFunction(()=>document.querySelector('#canvas-panel')===null);
 }
 await page.getByRole('button',{name:'预览 '+title,exact:true}).click();
}
async function verifyScreen(page,fixture,files,width){
 requests.length=0;
 const message={threadId:'composer-review',status:'completed',createdAt:1700000000000};
 fixture.reset({messages:[
  {...message,id:'image-user',requestId:'user-request',role:'user',text:'核对图片预览。',media:[{assetId:'thumb',revision:1,filename:'合成附件.png',size:files[0].bytes.length,mime:'image/png',kind:'image',state:'ready',error:null}]},
  {...message,id:'result-reply',requestId:'result-request',role:'assistant',text:'这是用于图片预览验证的合成成果。'},
 ],artifacts:files.filter(file=>file.attachment.revision===1).map(file=>file.attachment),features:{draftUpload:true,taskOverview:false,previewReferenceCollections:2}});
 await page.goto(fixture.url);
 const thumb=page.locator('#message-image-user .aui-image-zoom-trigger');await thumb.scrollIntoViewIfNeeded();
 await page.waitForFunction(()=>document.querySelector('#message-image-user img')?.naturalWidth===2400);
 const box=await page.locator('#message-image-user [data-slot=image-root]').boundingBox();assert.ok(box.width<=384&&box.x>=0&&box.x+box.width<=width);
 await thumb.click();await page.waitForSelector('[data-slot=image-zoom-overlay]');
 assert.equal(await page.locator('[data-slot=image-zoom-overlay] .canvas-image-controls').count(),0);
 await page.keyboard.press('Escape');await page.waitForSelector('[data-slot=image-zoom-overlay]',{state:'detached'});
 checks.push({width,messageThumbnailAndZoomUnchanged:true});
 for(const spec of specs){await openFile(page,spec.title);await page.waitForFunction(w=>document.querySelector('.image-annotation img')?.naturalWidth===w,spec.width);}
 for(const spec of specs)await verifyImage(page,spec,width);
 if(!process.argv.includes('--layout-only'))await verifyTabInputs(page,width);

 await verifyWindow(page,width);await verifyAnnotation(page,width);await verifyReplacement(page,fixture,files,width);await verifyPlain(page,fixture,files,width);
 assert.deepEqual(fixture.received.messages,[]);assert.deepEqual(fixture.received.denied,[]);
}
function traceTabs(){
 window.__canvasTabEvents=[];
 for(const type of ['pointerdown','pointerup','click','focusin','scroll'])document.addEventListener(type,event=>{
  const target=event.target;
  if((target instanceof Element)===false||target.closest('.canvas-tab-bar')===null)return;
  const item=target.closest('.canvas-tab-item'),rail=document.querySelector('.canvas-tab-rail');
  window.__canvasTabEvents.push({type,target:target.tagName,className:target.getAttribute('class'),label:target.getAttribute('aria-label'),x:event.clientX,y:event.clientY,scrollLeft:rail?.scrollLeft,item:item?.getBoundingClientRect().toJSON(),selected:document.querySelector('.canvas-tab[aria-selected=true]')?.getAttribute('aria-label')});
  window.__canvasTabEvents=window.__canvasTabEvents.slice(-80);
 },true);
}
function imageFile(spec,index,bytes,revision=1){
 const assetId='asset-00000000-0000-4000-8000-'+String(index+1).padStart(12,'0');
 return {...spec,bytes,mime:'image/png',path:'/api/media/result-reply/'+assetId+'/'+revision,
  attachment:{id:JSON.stringify(['result-reply',assetId,revision]),title:spec.title,messageId:'result-reply',assetId,revision,sha256:createHash('sha256').update(bytes).digest('hex')}};
}
mkdirSync(destination,{recursive:true});
const files=[],errors=[],blocked=[];
const fixture=await composerFixture({webDir,beforeDir:webDir,branding:resolve('assets/branding/odysseus-20261030/homer-odysseus-256.png'),resource:async(_req,res,url)=>{
 requests.push(url.pathname);
 const file=url.pathname==='/api/media/image-user/thumb/1'?files[0]:files.find(file=>file.path===url.pathname);
 if(file){res.writeHead(200,{'Content-Type':file.mime,'X-Homer-Artifact-Hash':file.attachment.sha256});res.end(file.bytes);}
 else{res.writeHead(404);res.end('synthetic_not_found');}
}});
let run,passed=false;
const mockKeychain=process.env.HOMER_IMAGE_ZOOM_MOCK_KEYCHAIN==='1';
const result={syntheticOnly:true,mockKeychain,checks,errors,blocked};
try{
 run=await openBrowser(destination,{mockKeychain});result.browser=run.browser.version();
 const context=await run.browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1,serviceWorkers:'block'});
 await context.addInitScript(traceTabs);
 await context.route('**/*',route=>{
  const url=new URL(route.request().url());
  if(url.origin===fixture.url&&url.pathname==='/api/uploads'){const h=route.request().headers();return route.fulfill({json:{assetId:'asset-ffffffff-ffff-4fff-8fff-fffffffffff1',revision:1,filename:decodeURIComponent(h['x-homer-filename']),kind:'image',state:'ready',mime:'image/png',size:route.request().postDataBuffer().length,error:null}});}
  if(url.origin===fixture.url||['about:','data:','blob:'].includes(url.protocol))return route.continue();
  blocked.push(url.href);return route.abort();
 });
 const generator=await context.newPage();
 for(const [i,spec] of specs.entries())files.push(imageFile(spec,i,Buffer.from(await generator.evaluate(drawImage,spec),'base64')));
 files.push(imageFile({id:'broken',title:'合成损坏图片.png'},4,Buffer.from('synthetic invalid PNG')));
 const svg=imageFile({id:'svg',title:'合成矢量图.svg'},5,Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300"><rect width="600" height="300" fill="#dedcd6"/></svg>'));svg.mime='image/svg+xml';files.push(svg);
 const revised={...specs[0],width:1200,height:550};
 files.push(imageFile(revised,0,Buffer.from(await generator.evaluate(drawImage,revised),'base64'),2));
 await generator.close();
 for(const width of [1440,390,320]){
  const page=await context.newPage();page.setDefaultTimeout(10000);await page.setViewportSize({width,height:900});
  page.on('pageerror',error=>errors.push({width,error:String(error)}));
  try{await verifyScreen(page,fixture,files,width);}
  catch(error){
   writeFileSync(join(destination,'tab-diagnostics-'+width+'.json'),JSON.stringify(await page.evaluate(()=>({events:window.__canvasTabEvents,tabs:[...document.querySelectorAll('.canvas-tab')].map(e=>({label:e.getAttribute('aria-label'),selected:e.getAttribute('aria-selected'),rect:e.getBoundingClientRect().toJSON()})),image:document.querySelector('.image-annotation img')?.naturalWidth})),null,2));
   await page.screenshot({path:join(destination,'failure-'+width+'.png'),timeout:10000});throw error;
  }
  finally{await page.close();}
 }
 assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);passed=true;
}catch(error){result.failure=String(error.stack??error);}
finally{
 try{await fixture.close();}finally{
  result.chrome=run?await run.finish():null;
  result.uiPassed=passed;
  result.passed=passed&&result.chrome?.code===0&&result.chrome.signal===null&&result.chrome.forced===false&&result.chrome.watchdog===false;
  writeFileSync(join(destination,'canvas-image-preview-results.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({passed:result.passed,checks:checks.length,chrome:result.chrome,failure:result.failure}));
  process.exitCode=result.passed?0:1;
  if(result.chrome?.confirmed===false)process.exit(1);
 }
}
