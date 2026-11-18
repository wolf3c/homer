// Actual Homer UI, isolated Chrome/profile and synthetic HTTP only; no account or model.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {composerFixture} from './fixtures/composer-browser-server.mjs';
import {openBrowser} from './helpers/image-zoom-browser.mjs';
const destination=resolve(process.env.HOMER_IMAGE_EVIDENCE??process.env.HOMER_BROWSER_EVIDENCE);
const webDir=resolve(process.env.HOMER_IMAGE_BUILD??process.env.HOMER_COMPONENT_BUILD??process.env.HISTORY_FOLLOWUP_BUILD);
mkdirSync(destination,{recursive:true});
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGOI6tkCRwzEcQCU8hmhmgeEcAAAAABJRU5ErkJggg==','base64');
const media=(assetId,state='ready',kind='image')=>({assetId,revision:1,state,kind,filename:assetId+(kind==='image'?'.png':'.txt'),mime:kind==='image'?'image/png':'text/plain',size:94720,error:null});
const assets=[media('normal'),media('document','ready','file'),media('pending','downloading'),media('failed','failed'),media('expired','expired'),media('fetch-error'),media('decode-error')];
const message=(items,references=[])=>({id:'attachment-fixture',threadId:'composer-review',requestId:'attachment-fixture-request',role:'user',text:'合成图片附件验收',status:'completed',createdAt:1700000000000,media:items,resourceReferences:references});
const images=new Map();
const fixture=await composerFixture({webDir,beforeDir:webDir,branding:resolve('assets/branding/odysseus-20261030/homer-odysseus-256.png'),resource(req,res,url){
 const [,id,revision]=url.pathname.match(/^\/api\/media\/attachment-fixture\/([^/]+)\/(\d+)$/)??[];
 if(!id){res.writeHead(404);res.end();return;}
 if(id==='fetch-error'||revision!=='1'){res.writeHead(503);res.end('synthetic unavailable');return;}
 res.writeHead(200,{'Content-Type':id==='document'?'text/plain':'image/png'});
 res.end(id==='decode-error'?Buffer.from('synthetic invalid image bytes'):id==='document'?Buffer.from('synthetic file'):images.get(id)??png);
}});
// Keep this synthetic browser away from the user's credential store as well as their profile.
const chrome=await openBrowser(destination,{mockKeychain:true}),checks=[],browserVersion=chrome.browser.version();
let failure,exit;
try{
 const seed=await chrome.browser.newPage();
 const ids=[1,2,3,4,5,6].map(i=>'asset-00000000-0000-4000-8000-'+String(i).padStart(12,'0'));
 for(const [index,width,height] of [[0,960,540],[1,540,960],[5,1500,300]]){
  const bytes=await seed.evaluate(({width,height})=>{
   const c=document.createElement('canvas');c.width=width;c.height=height;
   const ctx=c.getContext('2d');ctx.fillStyle='#e7e8de';ctx.fillRect(0,0,width,height);ctx.fillStyle='#30382d';ctx.font='36px sans-serif';ctx.fillText('合成图片 '+width+' × '+height,30,70);
   ctx.strokeStyle='#818d70';ctx.strokeRect(width*.1,height*.2,width*.25,height*.25);
   return c.toDataURL('image/png').split(',')[1];
  },{width,height});images.set(ids[index],Buffer.from(bytes,'base64'));
 }
 await seed.close();
 for(const width of [1440,390,320]){
  const context=await chrome.browser.newContext({viewport:{width,height:1000}}),page=await context.newPage(),errors=[],blocked=[];
  page.on('pageerror',error=>errors.push(String(error)));
  await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!==fixture.url&&!['about:','blob:','data:'].includes(url.protocol)){blocked.push(url.origin);return route.abort();}return route.continue();});
  const check=async(label,fn)=>{assert.ok(await page.evaluate(fn),label);checks.push({width,label});};
  const first=()=>page.locator('.message-attachment').first();
  try{
   fixture.reset({features:{draftUpload:true,taskOverview:false},messages:[message(assets)]});
   await page.goto(fixture.url);await page.waitForFunction(()=>document.querySelectorAll('.message-attachment').length===7);
   await first().scrollIntoViewIfNeeded();await page.waitForFunction(()=>document.querySelector('.message-attachment img')?.naturalWidth===4);
   await check('ready image has one preview without duplicate file metadata',()=>{const f=document.querySelector('.message-attachment');return f.querySelectorAll('[data-slot="image-preview"]').length===1&&!f.querySelector('figcaption,[data-slot="file-root"],.media-preview-placeholder');});
   const trigger=first().getByRole('button',{name:'放大图片'});await trigger.focus();await page.keyboard.press('Enter');
   await page.waitForFunction(()=>document.querySelector('[data-slot="image-zoom-content"]')?.naturalWidth===4);
   await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('[data-slot="image-zoom-overlay"]'));
   assert.ok(await trigger.evaluate(e=>e===document.activeElement));checks.push({width,label:'keyboard zoom closes with Escape and restores focus'});
   await check('ordinary files keep downloads and unavailable images keep status',()=>{const f=document.querySelectorAll('.message-attachment');return f[1].textContent.includes('document.txt')&&f[1].querySelector('[data-slot="file-size"]')&&f[1].querySelector('[data-slot="file-download"]')&&f[2].textContent.includes('准备中')&&f[3].textContent.includes('准备失败')&&f[4].textContent.includes('已过期');});
   await page.locator('.message-attachment').nth(6).scrollIntoViewIfNeeded();await page.waitForSelector('[data-slot="image-preview-error"]');
   await check('decode failures keep the official error and named download fallback',()=>{const f=document.querySelectorAll('.message-attachment')[6];return f.querySelector('[data-slot="image-preview-error"]')&&f.textContent.includes('decode-error.png')&&f.querySelector('[data-slot="file-download"]');});
   const http=page.locator('.message-attachment').nth(5);await http.scrollIntoViewIfNeeded();
   await page.waitForFunction(()=>document.querySelectorAll('.message-attachment')[5].textContent.includes('附件预览暂不可用'));
   await http.locator('[data-slot="file-download"]').click();await page.waitForFunction(()=>document.querySelectorAll('.message-attachment')[5].textContent.includes('下载未完成'));
   checks.push({width,label:'HTTP failure stops loading and fallback download reports failure'});
   await page.screenshot({path:join(destination,'image-fallback-'+width+'.png')});
   await first().evaluate(e=>{e.style.transform='translateY(-4000px)';});
   await page.waitForFunction(()=>!document.querySelector('.message-attachment img'));
   await check('lazy unloading keeps the preview-only loading contract',()=>!document.querySelector('.message-attachment').querySelector('[data-slot="file-root"]'));
   await first().evaluate(e=>{e.style.transform='';});await first().scrollIntoViewIfNeeded();await page.waitForFunction(()=>document.querySelector('.message-attachment').querySelector('img')?.naturalWidth===4&&!document.querySelector('.message-attachment').querySelector('figcaption'));
   checks.push({width,label:'an unloaded image decodes successfully on return'});
   fixture.update({messages:[message([{...assets[0],revision:2}])]});
   await page.waitForFunction(()=>document.querySelectorAll('.message-attachment').length===1&&!!document.querySelector('.message-attachment [data-slot="file-download"]'));
   await check('new revisions cannot reuse old image success',()=>!document.querySelector('.message-attachment img')&&document.querySelector('.message-attachment').textContent.includes('normal.png'));
   fixture.update({messages:[message([{...assets[0],state:'revoked'}])]});await page.waitForFunction(()=>document.querySelector('.message-attachment').textContent.includes('已撤回'));
   await check('revoked images keep names without live downloads',()=>document.querySelector('.message-attachment').textContent.includes('normal.png')&&!document.querySelector('.message-attachment [data-slot="file-download"]'));
   const note='第一条完整批注\n保留原始换行。'+('长批注应完整展示且不撑破气泡。'.repeat(8));
   const ref=(index,w,h)=>({kind:'image',source:{kind:'draft-image'},width:w,height:h,image:{assetId:ids[index],revision:1},annotations:[{id:'one',region:{x:w*.1,y:h*.2,width:w*.25,height:h*.25},comment:note},{id:'two',region:{x:w*.5,y:h*.4,width:w*.2,height:h*.15},comment:'第二条批注保留原序'}]});
   const wide=ref(0,960,540),portrait={...ref(1,540,960),annotations:undefined,region:{x:54,y:192,width:135,height:240},comment:'旧单区域竖图批注'};
   const different={...ref(2,960,540),annotations:[{id:'different',region:wide.annotations[0].region,comment:'修订不符仍保留批注'}]},missing={...ref(4,960,540),annotations:[{id:'missing',region:wide.annotations[0].region,comment:'缺图仍保留批注'}]};
   const ax={...ref(3,4,4),annotations:[],ax:[{role:'AXStaticText',name:'原窗口文字摘录'}]};
   fixture.reset({features:{draftUpload:true,taskOverview:false},messages:[message(ids.slice(0,4).map((id,i)=>({...media(id),revision:i===2?2:1})),[wide,portrait,different,missing,ax])]});
   await page.reload();await page.waitForFunction(()=>document.querySelectorAll('.image-reference-image').length===2);
   await page.locator('.thread-viewport').hover();await page.mouse.wheel(0,-10000);
   await page.waitForFunction(()=>{const e=document.querySelector('.image-reference-image'),img=e?.querySelector('img'),r=e?.getBoundingClientRect();return r?.top>=0&&r.top<innerHeight/2&&img?.naturalWidth===960&&!img.classList.contains('invisible');});
   await check('exact identities pair once; missing or different revisions keep all notes',()=>document.querySelectorAll('.message-attachment').length===4&&document.body.textContent.includes('缺图仍保留批注')&&document.body.textContent.includes('修订不符仍保留批注')&&document.querySelector('.image-reference-comment').textContent.includes('保留原始换行'));
   const layout=await page.locator('.image-reference-layout').first().evaluate(e=>{const image=e.querySelector('.image-reference-image').getBoundingClientRect(),notes=e.querySelector('.image-reference-notes').getBoundingClientRect();return {right:image.right,bottom:image.bottom,left:notes.left,top:notes.top};});
   assert.ok(width===1440?layout.left>=layout.right:layout.top>=layout.bottom,'wide layout is side by side; narrow layout puts notes below');
   assert.equal(await page.locator('.image-reference-comment').first().textContent(),note);checks.push({width,label:'full ordered notes use side-by-side or stacked layout'});
   await check('paired images keep their natural ratio and numbered regions',()=>{const e=document.querySelector('.image-reference-image'),img=e.querySelector('img'),r=img.getBoundingClientRect();return Math.abs(r.width/r.height-960/540)<.01&&e.querySelectorAll('.image-reference-region').length===2&&getComputedStyle(e.querySelector('.image-reference-regions')).display!=='none';});
   await page.screenshot({path:join(destination,'image-annotations-'+width+'.png')});
   const summary=page.locator('.image-reference-details summary').first();await summary.focus();await page.keyboard.press('Enter');assert.ok(await summary.evaluate(e=>e.parentElement.open));checks.push({width,label:'coordinates stay in a keyboard-accessible disclosure'});
   const portraitFrame=page.locator('.image-reference-image').nth(1);await portraitFrame.scrollIntoViewIfNeeded();await page.waitForFunction(()=>document.querySelectorAll('.image-reference-image')[1]?.querySelector('img')?.naturalWidth===540);
   const portraitImage=portraitFrame.locator('img');
   assert.ok(await portraitImage.evaluate(e=>{const r=e.getBoundingClientRect();return Math.abs(r.width/r.height-540/960)<.01;}));
   await check('AX-only references keep text and an unpaired image',()=>document.querySelectorAll('.message-attachments .message-attachment').length===2&&document.body.textContent.includes('原窗口文字摘录'));
   await check('images and notes stay inside the viewport',()=>document.documentElement.scrollWidth<=innerWidth&&[...document.querySelectorAll('.image-reference-image,.image-reference-notes')].every(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;}));
   assert.deepEqual(fixture.received.denied,[]);
   fixture.reset({features:{draftUpload:true,taskOverview:false},messages:[message([media(ids[5])],[ref(5,1500,300)])]});
   await page.reload();
   const ultraImage=page.locator('.image-reference-image');
   await ultraImage.scrollIntoViewIfNeeded();
   await page.waitForFunction(()=>{const img=document.querySelector('.image-reference-image img');return img?.naturalWidth===1500&&!img.classList.contains('invisible');});
   await check('ultrawide region coordinates follow the visible image rather than its loading container',()=>{
    const e=document.querySelector('.image-reference-image'),img=e.querySelector('img').getBoundingClientRect(),region=e.querySelector('.image-reference-region').getBoundingClientRect();
    return Math.max(Math.abs(region.x-img.x-img.width*.1),Math.abs(region.y-img.y-img.height*.2),Math.abs(region.width-img.width*.25),Math.abs(region.height-img.height*.25))<1;
   });
   await check('annotation comments retain primary message typography',()=>[...document.querySelectorAll('.image-reference-comment')].every(e=>getComputedStyle(e).fontSize==='16px'));
   await page.screenshot({path:join(destination,'image-annotations-ultrawide-'+width+'.png')});
   const longId='asset-00000000-0000-4000-8000-000000000099';
   const longBytes=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=600;c.height=4000;const x=c.getContext('2d');x.fillStyle='#eee9db';x.fillRect(0,0,600,4000);x.fillStyle='#30382d';x.font='36px sans-serif';x.fillText('Synthetic long image',20,80);return c.toDataURL('image/png').split(',')[1];});
   images.set(longId,Buffer.from(longBytes,'base64'));
   const longComment='长批注全文与换行必须保留。\n'.repeat(40),longRef={...ref(0,600,4000),image:{assetId:longId,revision:1},annotations:[{id:'long',region:{x:60,y:800,width:150,height:1000},comment:longComment},{id:'short',region:{x:300,y:1600,width:120,height:600},comment:'短批注直接显示'}]};
   const another={...longRef,source:{kind:'browser',messageId:'synthetic-source',url:'https://synthetic.invalid/image',title:'同图另一组来源'},annotations:[{...longRef.annotations[1],id:'another',comment:'同图另一组批注不丢失'}]};
   fixture.reset({features:{draftUpload:true,taskOverview:false},messages:[message([media(longId)],[longRef,another])]});await page.reload();
   const longFrame=page.locator('.image-reference-image');await longFrame.scrollIntoViewIfNeeded();await page.waitForFunction(()=>{const i=document.querySelector('.image-reference-image img');return i?.naturalHeight===4000&&!i.classList.contains('invisible');});
   for(const zoom of [1,1.25]){
    await page.evaluate(z=>document.body.style.zoom=String(z),zoom);await longFrame.scrollIntoViewIfNeeded();
    const geometry=await longFrame.evaluate(e=>{const img=e.querySelector('img').getBoundingClientRect(),r=e.querySelector('.image-reference-region').getBoundingClientRect();return {height:img.height,error:Math.max(Math.abs(r.x-img.x-img.width*.1),Math.abs(r.y-img.y-img.height*.2),Math.abs(r.width-img.width*.25),Math.abs(r.height-img.height*.25))};});
    assert.ok(geometry.height<=360*zoom&&geometry.error<1,JSON.stringify(geometry));checks.push({width,label:'long image height and region geometry at zoom '+zoom,...geometry});
   }
   await page.evaluate(()=>document.body.style.zoom='1');
   const full=page.locator('.image-reference-long-comment'),longSummary=full.locator('summary');
   assert.equal(await full.evaluate(e=>e.open),false);assert.equal(await full.locator('.image-reference-comment').isVisible(),false);assert.equal(await full.locator('p').textContent(),longComment);
   assert.equal(await page.locator('.message-attachment').count(),1);assert.ok(await page.getByText('同图另一组批注不丢失',{exact:true}).isVisible());assert.ok(await page.getByText('短批注直接显示',{exact:true}).isVisible());checks.push({width,label:'long notes start collapsed without losing full text; shared-image groups keep text and one image'});
   await page.screenshot({path:join(destination,'image-long-collapsed-'+width+'.png')});
   await longSummary.focus();await page.keyboard.press('Enter');assert.equal(await full.evaluate(e=>e.open),true);assert.ok(await full.locator('p').isVisible());await page.screenshot({path:join(destination,'image-long-expanded-'+width+'.png')});await page.keyboard.press('Space');assert.equal(await full.evaluate(e=>e.open),false);checks.push({width,label:'native long-note disclosure supports Enter and Space'});
   const longTrigger=longFrame.getByRole('button',{name:'放大图片'});await longTrigger.scrollIntoViewIfNeeded();await longTrigger.focus();const source=await longFrame.locator('img').getAttribute('src');await page.keyboard.press('Enter');await page.waitForFunction(()=>document.querySelector('[data-slot="image-zoom-content"]')?.naturalHeight===4000);
   assert.equal(await page.locator('[data-slot="image-zoom-content"]').getAttribute('src'),source);assert.equal(await page.locator('[data-slot="image-zoom-overlay"] .image-reference-region').count(),0);await page.keyboard.press('Escape');assert.ok(await longTrigger.evaluate(e=>e===document.activeElement));checks.push({width,label:'zoom keeps original image without markers and restores keyboard focus'});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);assert.deepEqual(fixture.received.denied,[]);
  }catch(error){await page.screenshot({path:join(destination,'failure-'+width+'.png')});writeFileSync(join(destination,'failure-'+width+'.json'),JSON.stringify({error:error.stack,errors,dom:await page.locator('.user-message-bubble').evaluate(e=>e.outerHTML)},null,2));throw error;}
  finally{await context.close();}
 }
}catch(error){failure=error.stack??String(error);}
finally{
 await fixture.close();exit=await chrome.finish();
 writeFileSync(join(destination,'message-image-preview.json'),JSON.stringify({passed:!failure&&exit.confirmed&&exit.code===0&&!exit.forced&&!exit.watchdog,syntheticOnly:true,browser:browserVersion,checks,exit,failure},null,2));
}
assert.equal(failure,undefined,failure);assert.ok(exit.confirmed&&exit.code===0&&!exit.forced&&!exit.watchdog,JSON.stringify(exit));
console.log(JSON.stringify({passed:true,syntheticOnly:true,widths:[1440,390,320],checks:checks.length,cleanExit:true}));
