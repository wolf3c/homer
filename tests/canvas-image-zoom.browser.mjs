// Preview zoom, panning and single-region annotations.
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
const checks=[],requests=[],uploads=[];
let rejectUpload;
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
async function verifyToolbar(page,width){
 const controls=page.locator('.canvas-image-controls');
 const annotate=page.locator('#canvas-panel').getByRole('button',{name:'批注',exact:true});
 const checkLayout=()=>controls.evaluate(group=>{
  const bar=group.closest('.preview-toolbar'),row=bar.getBoundingClientRect();
  const annotation=bar.querySelector('.image-annotation-toggle').getBoundingClientRect();
  const actions=[...bar.querySelectorAll('.image-annotation-toggle,[data-slot=file-download],[aria-label="更多"]')];
  return {width:row.width,order:group.getBoundingClientRect().right<=annotation.left,
   inside:actions.every(e=>{const b=e.getBoundingClientRect();return b.left>=row.left&&b.right<=row.right+1&&b.top>=row.top&&b.bottom<=row.bottom;}),
   target:annotation.height,groupOverflow:group.scrollWidth>group.clientWidth};
 });
 const initial=await view(page);
 if(width===1440){
  const separator=await page.locator('.preview-separator').boundingBox();
  await page.mouse.move(separator.x+separator.width/2,separator.y+100);
  await page.mouse.down();
  await page.mouse.move(width-185,separator.y+100,{steps:12});
  await page.mouse.up();
 }else await page.setViewportSize({width:width+40,height:780});
 await settle(page);
 assert.notEqual((await view(page)).width,initial.width);
 const row=await checkLayout();
 assert(row.order&&row.inside,JSON.stringify(row));
 if(width===1440)assert(row.width<220&&row.groupOverflow);
 else assert(row.target>=44);
 const fit=page.getByRole('button',{name:'适应窗口',exact:true});
 await fit.focus();
 const focus=await fit.evaluate(e=>{
  const button=e.getBoundingClientRect(),group=e.parentElement.getBoundingClientRect();
  return {focused:document.activeElement===e,active:document.activeElement?.outerHTML?.slice(0,120),visible:button.left>=group.left-1&&button.right<=group.right+1,button:button.toJSON(),group:group.toJSON()};
 });
 assert(focus.focused&&focus.visible,JSON.stringify(focus));
 if(width!==1440){
  await page.keyboard.press('Tab');
  assert(await page.getByRole('button',{name:'100%',exact:true}).evaluate(e=>document.activeElement===e));
 }
 await page.screenshot({path:join(destination,'toolbar-'+width+'.png')});
 if(width===1440){
  const separator=await page.locator('.preview-separator').boundingBox();
  await page.mouse.move(separator.x+separator.width/2,separator.y+100);
  await page.mouse.down();
  await page.mouse.move(width-initial.panelWidth,separator.y+100,{steps:12});
  await page.mouse.up();
 }else await page.setViewportSize({width,height:900});
 await settle(page);
 assert(await annotate.isVisible());
 checks.push({width,toolbar:row,focusVisible:true});
}
async function verifyAnnotation(page,width){
 await page.getByRole('tab',{name:specs[2].title,exact:true}).click();
 const image=page.locator('.image-annotation img'),body=page.locator('.canvas-image-body');
 await page.waitForFunction(()=>document.querySelector('.image-annotation img')?.naturalWidth===1920);
 await image.evaluate(e=>{window.__previewImage=e;});
 const annotate=page.locator('#canvas-panel').getByRole('button',{name:'批注',exact:true});
 const original=page.getByRole('button',{name:'100%',exact:true});
 const editor=page.locator('.annotation-comment-form');
 const fit=page.getByRole('button',{name:'适应窗口',exact:true});
 await fit.click();
 assert(await image.evaluate(e=>{
  const img=e.getBoundingClientRect(),viewport=e.closest('.canvas-image-body').getBoundingClientRect();
  return img.top>=viewport.top&&img.bottom<=viewport.bottom&&img.right<=viewport.right;
 }));
 await original.click();
 assert.equal((await view(page)).width,1920);
 await body.evaluate(e=>e.scrollTo(100,60));
 const viewport=await body.boundingBox(),point={x:viewport.x+viewport.width*.40,y:viewport.y+viewport.height*.35};
 await page.mouse.move(point.x,point.y);
 const scroll=(await view(page)).scroll;
 await page.mouse.wheel(0,70);
 await page.waitForFunction(y=>document.querySelector('.canvas-image-body').scrollTop>y,scroll[1]);
 const beforeWheel=await view(page);
 await page.keyboard.down('Control');
 await page.mouse.wheel(0,-24);
 await page.keyboard.up('Control');
 await settle(page);
 const zoomed=await view(page);
 assert(zoomed.width>beforeWheel.width);
 for(const [axis,offset,dimension] of [['x','left','width'],['y','top','height']])
  assert(Math.abs((point[axis]-beforeWheel[offset])/beforeWheel[dimension]-(point[axis]-zoomed[offset])/zoomed[dimension])<.002);
 await page.mouse.move(point.x,point.y);await page.mouse.down();
 await page.mouse.move(point.x-44,point.y-45,{steps:5});await page.mouse.up();
 const normal=await view(page);
 assert(normal.scroll[0]>zoomed.scroll[0]&&normal.scroll[1]>zoomed.scroll[1]);
 const stable=async()=>{
  const current=await view(page);
  assert.deepEqual(current.scroll,normal.scroll);
  for(const key of ['width','height','left','top','src'])assert.equal(current[key],normal[key],key);
  assert(await image.evaluate(e=>e===window.__previewImage));
 };
 const draw=async()=>{
  await annotate.click();await stable();assert(await original.isDisabled());
  await page.mouse.move(point.x,point.y);await page.mouse.down();
  await page.mouse.move(point.x+64,point.y+56,{steps:8});await page.mouse.up();
  await editor.waitFor();
 };
 const restored=async()=>{
  await editor.waitFor({state:'detached'});
  assert.equal(await annotate.getAttribute('aria-pressed'),'false');
  assert(await annotate.evaluate(e=>document.activeElement===e));
  assert(await original.isEnabled());await stable();
 };
 await draw();
 await editor.getByRole('button',{name:'取消',exact:true}).click();
 await restored();assert.equal(await page.locator('.image-region-number').count(),0);
 await draw();
 await page.keyboard.press('Escape');
 await restored();
 await draw();
 const textarea=editor.locator('textarea');
 await textarea.fill('放大后的原图坐标');
 await page.screenshot({path:join(destination,'zoomed-annotation-'+width+'.png')});
 const save=editor.getByRole('button',{name:'保存',exact:true});
 if(width===1440){
  const reached=new Promise(resolve=>{rejectUpload=resolve;});
  await save.click();
  const release=await reached;
  try{
   await page.keyboard.press('Escape');
   assert.equal(await editor.getAttribute('aria-busy'),'true');
   assert.equal(await annotate.getAttribute('aria-pressed'),'true');
   assert(await page.locator('#canvas-panel').isVisible());
  }finally{release();}
  await editor.getByRole('alert').waitFor();
  assert.equal(await textarea.inputValue(),'放大后的原图坐标');
  await stable();
 }
 await save.click();
 await restored();assert.equal(await page.locator('.image-region-number').count(),1);
 const region=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('homer-draft:composer-review')).resourceReferences.find(r=>r.kind==='image').annotations[0].region);
 const scale=normal.width/1920;
 for(const [key,expected] of Object.entries({x:(point.x-normal.left)/scale,y:(point.y-normal.top)/scale,width:64/scale,height:56/scale}))
  assert(Math.abs(region[key]-expected)<2,key+' '+JSON.stringify(region));
 await annotate.press('Enter');
 await page.keyboard.press('Enter');await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
 await editor.waitFor();
 await textarea.fill('键盘框选');
 await textarea.press('Enter');
 await restored();assert.equal(await page.locator('.image-region-number').count(),2);
 if(width===390)await verifyTouch(page,point);
 await openFile(page,specs[2].title);await page.waitForFunction(()=>document.querySelector('.image-annotation img')?.naturalWidth===1920);await settle(page);
 assert((await view(page)).width<1920);assert.equal(await page.locator('.image-region-number').count(),2);
 checks.push({width,anchoredWheel:true,mousePan:true,exactRegion:region,stableAfterSaveCancelAndEscape:true,keyboardRectangle:true});
}
async function verifyTouch(page,{x,y}){
 const session=await page.context().newCDPSession(page);
 const send=(type,touchPoints)=>session.send('Input.dispatchTouchEvent',{type,touchPoints});
 const touch=(id,x,y)=>({id,x,y});
 await session.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2});
 try{
  const before=await view(page);
  await send('touchStart',[touch(1,x,y)]);
  await send('touchMove',[touch(1,x-35,y-42)]);
  await send('touchEnd',[]);
  const panned=await view(page);
  assert.deepEqual(panned.scroll,before.scroll.map((value,index)=>value+[35,42][index]));
  await send('touchStart',[touch(1,x-30,y),touch(2,x+30,y)]);
  await send('touchMove',[touch(1,x-45,y),touch(2,x+45,y)]);
  await send('touchEnd',[]);
  await settle(page);
  const zoomed=await view(page);
  assert(Math.abs(zoomed.width/panned.width-1.5)<.01);
  assert(Math.abs((x-panned.left)/panned.width-(x-zoomed.left)/zoomed.width)<.002);
  assert(Math.abs((y-panned.top)/panned.height-(y-zoomed.top)/zoomed.height)<.002);
  checks.push({width:390,syntheticSingleTouchPan:true,syntheticPinch:true});
 }finally{
  await session.send('Emulation.setTouchEmulationEnabled',{enabled:false});
  await session.detach();
 }
}
async function verifyTouchAnnotation(page,fixture,files){
 const width=390;
 fixture.reset({
  messages:[{threadId:'composer-review',status:'completed',createdAt:1700000000000,id:'result-reply',requestId:'result-request',role:'assistant',text:'触屏批注夹具'}],
  artifacts:[files[2].attachment],features:{draftUpload:true,taskOverview:false,previewReferenceCollections:2},
 });
 const session=await page.context().newCDPSession(page);
 await session.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2});
 await page.goto(fixture.url);
 await openFile(page,specs[2].title);
 const annotate=page.getByRole('button',{name:'批注',exact:true});
 const editor=page.locator('.annotation-comment-form');
 const touch=(type,x,y)=>session.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x,y,id:1}]});
 async function drag(x,y,dx,dy,hold=false){
  await touch('touchStart',x,y);
  for(let i=1;i<=6;i++)await touch('touchMove',x+dx*i/6,y+dy*i/6);
  // Native selection treats a release within 250ms as a click.
  if(hold)await page.waitForTimeout(280);
  await touch('touchEnd');
 }
 const shapes=()=>page.locator('.a9s-touch-handle .a9s-handle-buffer').evaluateAll(nodes=>nodes.map(el=>[Number(el.getAttribute('cx')),Number(el.getAttribute('cy'))]));
 const draft=()=>page.evaluate(()=>JSON.parse(sessionStorage.getItem('homer-draft:composer-review')).resourceReferences?.find(r=>r.kind==='image'));
 const startUploads=uploads.length;
 await page.getByRole('button',{name:'100%',exact:true}).click();
 await page.locator('.canvas-image-body').evaluate(e=>e.scrollTo(100,60));
 const viewport=await page.locator('.canvas-image-body').boundingBox(),x=viewport.x+95,y=viewport.y+210;
 const normal=await view(page);
 assert.equal(normal.width,1920);
 await annotate.click();
 await drag(x,y,135,115);
 await editor.locator('textarea').fill('触摸原始批注');
 await editor.getByRole('button',{name:'保存',exact:true}).click();
 await editor.waitFor({state:'detached'});
 const original=await draft();
 assert.equal(original.annotations.length,1);
 assert.equal(uploads.length-startUploads,1);
 const openRegion=async()=>{
  await annotate.click();
  await touch('touchStart',x+65,y+60);
  await touch('touchEnd');
  await editor.waitFor();
  await page.waitForFunction(()=>document.querySelectorAll('.a9s-touch-handle .a9s-handle-buffer').length===5);
 };
 await openRegion();
 const before=await shapes();
 async function dragHandle(index,dx,dy){
  const handle=page.locator('.a9s-touch-handle .a9s-handle-buffer').nth(index);
  const {x,y,width,height}=await handle.boundingBox();
  assert(await handle.evaluate(el=>{
   const r=el.getBoundingClientRect();
   return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===el;
  }));
  await drag(x+width/2,y+height/2,dx,dy,true);
 }
 // Annotorious renders the rotation handle before the four corner handles.
 await dragHandle(3,25,20);
 const resized=await shapes();
 assert.equal(resized.length,before.length,'touch corner drag must keep the selection active');
 assert.notDeepEqual(resized,before,'touch corner drag must resize the selected rectangle');
 await dragHandle(0,43,12);
 const rotated=await shapes();
 assert.equal(rotated.length,before.length,'touch rotation must keep the selection active');
 assert.notDeepEqual(rotated,resized,'touch rotation handle must change the selected rectangle');
 await page.screenshot({path:join(destination,'touch-adjusted.png')});
 await editor.getByRole('button',{name:'取消',exact:true}).click();
 await editor.waitFor({state:'detached'});
 assert.deepEqual(await draft(),original);
 assert.deepEqual((await view(page)).scroll,normal.scroll);
 assert.equal((await view(page)).width,normal.width);
 await openRegion();
 assert.deepEqual(await shapes(),before);
 await editor.locator('textarea').fill('触摸修改后保存');
 await editor.getByRole('button',{name:'保存',exact:true}).click();
 await editor.waitFor({state:'detached'});
 const edited=await draft();
 assert.deepEqual(edited.annotations,[{...original.annotations[0],comment:'触摸修改后保存'}]);
 assert.deepEqual(edited.image,original.image);
 await openRegion();
 await editor.getByRole('button',{name:'删除此批注'}).click();
 await editor.waitFor({state:'detached'});
 assert.equal(await draft(),undefined);
 assert.equal(await page.locator('.image-region-number').count(),0);
 assert.equal(await page.locator('.composer-area .aui-attachment-root').count(),1);
 assert.equal(uploads.length-startUploads,1);
 checks.push({width,touchEnabledBeforeLoad:true,touchDraw:true,touchResize:true,touchRotate:true,cancelRestoredGeometry:true,editAndDeleteSavedNote:true,originalUploadReused:true});
}
async function verifyPlain(page,fixture,files,width){
 await openFile(page,'合成矢量图.svg');await page.waitForFunction(()=>document.querySelector('.canvas-image-root img')?.naturalWidth===600);
 assert.equal(await page.locator('.image-annotation-toggle').count(),0);
 await page.getByRole('button',{name:'100%',exact:true}).click();
 assert.equal(await page.locator('.canvas-image-root img').evaluate(e=>e.getBoundingClientRect().width),600);
 await page.getByRole('button',{name:'适应窗口',exact:true}).click();
 assert(await page.locator('.canvas-image-root img').evaluate(e=>e.getBoundingClientRect().width<=innerWidth));
 fixture.update({features:{draftUpload:true,taskOverview:false,previewReferenceCollections:0}});await openFile(page,specs[0].title);
 await page.waitForFunction(()=>document.querySelector('.canvas-image-root img')?.naturalWidth===1200);assert.equal(await page.locator('.image-annotation-toggle').count(),0);assert(await page.locator('#canvas-panel').getByRole('button',{name:'放大图片',exact:true}).isEnabled());
 checks.push({width,plainSvgAndNoAnnotationCapability:true});
}
async function verifyReplacement(page,fixture,files,width){
 await openFile(page,specs[0].title);await page.waitForFunction(()=>document.querySelector('.image-annotation img')?.naturalWidth===2400);
 const old=(await view(page)).src,replacement=files.find(file=>file.attachment.revision===2),others=files.filter(file=>file.attachment.revision===1&&file.id!=='wide');
 fixture.update({artifacts:[replacement,...others].map(file=>file.attachment)});await openFile(page,specs[0].title);
 await page.waitForFunction(()=>document.querySelector('.image-annotation img')?.naturalWidth===1200);await settle(page);
 assert.notEqual((await view(page)).src,old);assert.equal(requests.filter(path=>path===replacement.path).length,1);
 await openFile(page,'合成损坏图片.png');await page.getByRole('alert').filter({hasText:'此图片无法在当前预览中显示'}).waitFor();assert.equal(await page.locator('.image-annotation-toggle').count(),0);assert.equal(await page.locator('.canvas-image-controls').count(),0);
 checks.push({width,revisionReplaced:true,decodeErrorVisible:true});
}
const settle=page=>page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
const view=page=>page.locator('.image-annotation img').evaluate(image=>{
 const r=image.getBoundingClientRect(),body=image.closest('[data-slot=canvas-split-body]'),bar=document.querySelector('.preview-toolbar').getBoundingClientRect();
 return{width:r.width,height:r.height,left:r.x,top:r.y,naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight,bodyWidth:body.clientWidth,panelWidth:body.closest('.canvas-panel').clientWidth,scroll:[body.scrollLeft,body.scrollTop],barHeight:bar.height,overflow:document.documentElement.scrollWidth>innerWidth,src:image.src};
});

async function verifyImage(page,spec,width){
 await page.getByRole('tab',{name:spec.title,exact:true}).click();await page.waitForFunction(w=>document.querySelector('.image-annotation img')?.naturalWidth===w,spec.width);await settle(page);
 const initial=await view(page),reads=requests.length;
 if(spec.id==='detail')await page.screenshot({path:join(destination,'initial-'+width+'.png')});
 assert.equal(await page.locator('.image-annotation-toggle').getAttribute('aria-pressed'),'false');
 assert.equal(await page.locator('.canvas-image-controls').count(),1);assert(!initial.overflow&&initial.width<=initial.bodyWidth);
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

 await verifyToolbar(page,width);await verifyAnnotation(page,width);await verifyReplacement(page,fixture,files,width);await verifyPlain(page,fixture,files,width);
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
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.origin===fixture.url&&url.pathname==='/api/uploads'){
   const h=route.request().headers();
   uploads.push(h['x-homer-upload']);
   if(rejectUpload){
    const accepted=rejectUpload;rejectUpload=undefined;
    await new Promise(resolve=>accepted(resolve));
    return route.fulfill({status:503,json:{error:'synthetic_upload_unconfirmed'}});
   }
   return route.fulfill({json:{assetId:'asset-ffffffff-ffff-4fff-8fff-fffffffffff1',revision:1,filename:decodeURIComponent(h['x-homer-filename']),kind:'image',state:'ready',mime:'image/png',size:route.request().postDataBuffer().length,error:null}});}
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
 const touchPage=await context.newPage();
 await touchPage.setViewportSize({width:390,height:900});
 touchPage.setDefaultTimeout(10000);
 touchPage.on('pageerror',error=>errors.push({width:390,error:String(error)}));
 try{await verifyTouchAnnotation(touchPage,fixture,files);}
 catch(error){await touchPage.screenshot({path:join(destination,'touch-failure.png'),timeout:10000});throw error;}
 finally{await touchPage.close();}
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
