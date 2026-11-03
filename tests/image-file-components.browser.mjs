// Real UI, private-byte adapters and isolated Chrome; all data and HTTP are synthetic.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {deflateSync} from 'node:zlib';
import {composerFixture} from './fixtures/composer-browser-server.mjs';
import {isolatedChrome} from './web-history-browser-cdp.mjs';
const destination=resolve(process.env.HOMER_BROWSER_EVIDENCE??'.codex/scratch/image-file-components-20261023/browser');
const webDir=resolve(process.env.HOMER_COMPONENT_BUILD??'.codex/scratch/image-file-components-20261023/candidate-web');
mkdirSync(destination,{recursive:true});
function png(width,height){
 const crc=bytes=>{let n=0xffffffff;for(const byte of bytes){n^=byte;for(let k=0;k<8;k++)n=(n>>>1)^((n&1)?0xedb88320:0);}return(n^0xffffffff)>>>0;};
 const chunk=(name,body)=>{const head=Buffer.from(name),size=Buffer.alloc(4),sum=Buffer.alloc(4);size.writeUInt32BE(body.length);sum.writeUInt32BE(crc(Buffer.concat([head,body])));return Buffer.concat([size,head,body,sum]);};
 const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
 const raw=Buffer.alloc((width*3+1)*height);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=y*(width*3+1)+1+x*3;raw[i]=70+Math.floor(x/width*100);raw[i+1]=100+Math.floor(y/height*80);raw[i+2]=140;}
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
const wide=png(640,80),portrait=png(80,600),longName='合成文件名-'+ '完整名称'.repeat(20)+'.txt';
const media=(id,kind='image',extra={})=>({assetId:id,revision:1,filename:id+'.png',size:1234,mime:'image/png',kind,state:'ready',error:null,...extra});
const assets=[media('wide'),media('portrait'),media('document','file',{filename:longName,mime:null}),media('broken'),media('expired','image',{state:'expired'}),media('silk','voice',{filename:'合成旧语音.silk',mime:'audio/silk'})];
const message=(id,role,text,media)=>({id,threadId:'composer-review',requestId:'request-'+id,role,text,media,status:'completed',createdAt:1700000000000});
const makeMessages=()=>[message('offscreen','user','较早的合成图片',[media('old')]),...Array.from({length:12},(_,n)=>message('filler-'+n,n%2?'assistant':'user','隔离测试中的填充文本。'.repeat(12))),message('image-user','user','用户附件',structuredClone(assets)),message('result-reply','assistant','合成成果。\n\n![外部图片](https://example.invalid/private.png)')];
const checks=[],requests=[];let active=0,peak=0,downloadFail=true;
const fixture=await composerFixture({webDir,beforeDir:webDir,branding:resolve('assets/branding/homer-river-stone-256.de41791ce5c1.png'),resource:async(_req,res,url)=>{
 const path=url.pathname;requests.push(path);active++;peak=Math.max(peak,active);
 try{
  await new Promise(done=>setTimeout(done,70));
  if(path==='/api/files/result-image'){res.writeHead(200,{'Content-Type':'image/png'});res.end(portrait);return;}
  if(path==='/api/files/result-text'){res.writeHead(200,{'Content-Type':'text/plain'});res.end('Synthetic exact result bytes');return;}
  const match=/^\/api\/media\/(image-user|offscreen)\/(wide|portrait|document|broken|old)\/([12])$/.exec(path);
  if(!match){res.writeHead(403);res.end('synthetic_denied');return;}
  if(match[2]==='document'){res.writeHead(downloadFail?503:200,{'Content-Type':'application/octet-stream'});res.end('synthetic document bytes');return;}
  res.writeHead(200,{'Content-Type':'image/png'});res.end(match[2]==='broken'?Buffer.from('invalid synthetic image'):match[2]==='portrait'||match[3]==='2'?portrait:wide);
 }finally{active--;}
}});
const chrome=await isolatedChrome(destination);
const waitFor=(page,predicate)=>page.until('Boolean(('+String(predicate)+')())',10000);
async function key(page,key){await page.command('Input.dispatchKeyEvent',{type:'keyDown',key,code:key===' '?'Space':key,...(key==='Enter'?{text:'\r',windowsVirtualKeyCode:13}:{})});await page.command('Input.dispatchKeyEvent',{type:'keyUp',key,code:key===' '?'Space':key});}
async function press(page,selector){await page.evaluate('document.querySelector('+JSON.stringify(selector)+').focus()');await key(page,'Enter');}
let passed=false;
try{
 for(const width of [1440,390,320]){
  requests.length=0;peak=0;downloadFail=true;
  const messages=makeMessages();fixture.reset({messages,features:{draftUpload:true,taskOverview:false},artifacts:[{id:'result-image',title:'合成图片成果.png',workTitle:'正式交付',historyMessageId:'result-reply',messageId:'result-reply'},{id:'result-text',title:longName,workTitle:'正式交付',historyMessageId:'result-reply',messageId:'result-reply'}]});
  const page=await chrome.page(fixture.url,width),wait=predicate=>waitFor(page,predicate);
  const check=async(label,predicate)=>{assert.ok(await page.evaluate(predicate),label);checks.push({width,label});};
  try{
   await page.command('Browser.setDownloadBehavior',{behavior:'deny',browserContextId:page.browserContextId});
   await page.command('Page.addScriptToEvaluateOnNewDocument',{source:'window.__urls={live:[],revoked:[]};const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);URL.createObjectURL=b=>{const u=create(b);window.__urls.live.push(u);return u;};URL.revokeObjectURL=u=>{window.__urls.revoked.push(u);window.__urls.live=window.__urls.live.filter(x=>x!==u);revoke(u);};'});
   await page.navigate();await wait(()=>!!document.querySelector('#message-image-user .lazy-media')&&!!document.querySelector('[data-slot="file-list"]'));
   const viewport=await page.evaluate(()=>document.querySelector('.thread-viewport').getBoundingClientRect().toJSON());
   await page.command('Input.dispatchMouseEvent',{type:'mouseWheel',x:viewport.left+viewport.width/2,y:viewport.top+viewport.height/2,deltaX:0,deltaY:-1});
   await page.evaluate(()=>document.querySelector('#message-image-user .message-attachment').scrollIntoView({block:'center'}));
   await wait(()=>document.querySelector('#message-image-user [data-slot="image-preview"] img')?.naturalWidth===640);
   await page.evaluate(()=>document.querySelectorAll('#message-image-user .message-attachment')[3].scrollIntoView({block:'center'}));
   await wait(()=>!!document.querySelector('[data-slot="image-preview-error"]'));
   assert.ok(!requests.some(p=>p.startsWith('/api/files/')||p.includes('/document/')||p.includes('/old/')));assert.ok(peak<=2);checks.push({width,label:'only nearby images load; result/document bodies stay lazy and shared request budget stays at two'});
   await check('image/file official structures replace the custom file drawings',()=>!document.querySelector('#message-image-user .message-attachment:first-child [data-slot="file-root"]')&&!!document.querySelector('#message-image-user .message-attachment:nth-child(3) [data-slot="file-root"]')&&!!document.querySelector('#message-image-user [data-slot="image-preview-error"]')&&document.querySelectorAll('[data-slot="file-list"] [data-slot="file-root"]').length===2&&!document.querySelector('.file-list-icon,.file-list-name'));
   await check('expired and unsupported silk attachments remain factual and have no fake player',()=>document.querySelector('#message-image-user').textContent.includes('已过期')&&!document.querySelector('#message-image-user audio')&&document.querySelectorAll('#message-image-user .lazy-media').length===3);
   await check('full accessible names, ellipsis, official size and authorized download survive narrow width',()=>{const rows=[...document.querySelectorAll('[data-slot="file-name"]')];return rows.some(e=>e.textContent.length>70&&e.title===e.textContent&&getComputedStyle(e).whiteSpace==='nowrap'&&getComputedStyle(e).textOverflow==='ellipsis')&&!!document.querySelector('[data-slot="file-size"]')&&document.documentElement.scrollWidth<=innerWidth;});
   await page.evaluate(()=>document.querySelector('#message-image-user .message-attachment').scrollIntoView({block:'center'}));
   await wait(()=>document.querySelector('#message-image-user [data-slot="image-preview"] img')?.naturalWidth===640);
   await press(page,'#message-image-user .aui-image-zoom-trigger');await wait(()=>!!document.querySelector('[data-slot="image-zoom-overlay"]'));
   await wait(()=>document.activeElement===document.querySelector('[data-slot="image-zoom-close"]'));
   await check('official zoom uses only an authorized blob, focuses close and retains official icon/padding geometry',()=>{const e=document.querySelector('[data-slot="image-zoom-overlay"]'),b=e.querySelector('button'),r=b.getBoundingClientRect();return e.querySelector('img').src.startsWith('blob:')&&document.activeElement===b&&r.width===36&&r.height===36&&document.body.style.overflow==='hidden';});
   await key(page,'Tab');await check('zoom keeps keyboard focus inside its dialog',()=>document.querySelector('[data-slot="image-zoom-overlay"]').contains(document.activeElement));
   await page.evaluate(()=>Promise.all(document.querySelector('[data-slot="image-zoom-overlay"]').getAnimations({subtree:true}).map(a=>a.finished.catch(()=>{}))));
   await wait(()=>document.querySelector('[data-slot="image-zoom-content"]')?.naturalWidth===640);
   await check('settled zoom image is visible and contained in the viewport',()=>{const overlay=document.querySelector('[data-slot="image-zoom-overlay"]'),image=overlay.querySelector('img'),r=image.getBoundingClientRect();return getComputedStyle(overlay).opacity==='1'&&getComputedStyle(image).opacity==='1'&&r.width>0&&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;});
   await page.screenshot('official-image-zoom-'+width+'.png');
   await key(page,'Escape');await wait(()=>!document.querySelector('[data-slot="image-zoom-overlay"]'));
   await check('Escape restores the original image trigger and body scroll',()=>document.activeElement.matches('.aui-image-zoom-trigger')&&document.body.style.overflow!=='hidden');
   const scroll=await page.evaluate(()=>document.querySelector('.thread-viewport').scrollTop);await key(page,' ');await wait(()=>!!document.querySelector('[data-slot="image-zoom-overlay"]'));
   assert.equal(await page.evaluate(()=>document.querySelector('.thread-viewport').scrollTop),scroll);checks.push({width,label:'Space opens image zoom without scrolling the conversation'});
   const old=await page.evaluate(()=>document.querySelector('[data-slot="image-zoom-content"]').src);
   messages.find(m=>m.id==='image-user').media[0].revision=2;fixture.update({messages:structuredClone(messages)});
   await wait(()=>!document.querySelector('[data-slot="image-zoom-overlay"]')&&document.querySelector('#message-image-user .message-attachment')?.querySelector('[data-slot="image-preview"] img')?.naturalWidth===80);
   assert.ok(requests.includes('/api/media/image-user/wide/2'));assert.ok(await page.evaluate('window.__urls.revoked.includes('+JSON.stringify(old)+')'));checks.push({width,label:'revision change tears down old zoom/blob and reads the exact new revision'});
   await press(page,'#message-image-user [aria-label^="下载 合成文件名"]');await wait(()=>document.querySelector('#message-image-user [role="status"]')?.textContent.includes('下载未完成'));
   downloadFail=false;await press(page,'#message-image-user [aria-label^="下载 合成文件名"]');await wait(()=>!document.querySelector('#message-image-user [role="status"]')?.textContent.includes('下载未完成'));
   assert.equal(requests.filter(p=>p==='/api/media/image-user/document/1').length,2);checks.push({width,label:'download failure is visible and retry addresses the same message/asset/revision through the existing fetch owner'});
   downloadFail=true;await press(page,'#message-image-user [aria-label^="下载 合成文件名"]');await wait(()=>document.querySelector('#message-image-user [role="status"]')?.textContent.includes('下载未完成'));
   messages.find(m=>m.id==='image-user').media[2].revision=2;fixture.update({messages:structuredClone(messages)});
   await wait(()=>document.querySelector('#message-image-user [aria-label^="下载 合成文件名"]')?.href.endsWith('/document/2'));
   await check('download errors belong to their exact revision and never follow a newer file',()=>![...document.querySelectorAll('#message-image-user [role="status"]')].some(e=>e.textContent.includes('下载未完成')));
   downloadFail=false;await press(page,'#message-image-user [aria-label^="下载 合成文件名"]');
   for(let attempt=0;attempt<200&&!requests.includes('/api/media/image-user/document/2');attempt++)await new Promise(resolve=>setTimeout(resolve,10));
   assert.equal(requests.filter(p=>p==='/api/media/image-user/document/2').length,1);checks.push({width,label:'download after revision change uses the new exact revision'});
   await press(page,'[data-slot="file-list"] [aria-label="预览 合成图片成果.png"]');await wait(()=>document.querySelector('#canvas-panel [data-slot="image-preview"] img')?.naturalHeight===600);
   assert.equal(requests.filter(p=>p==='/api/files/result-image').length,1);await check('Canvas image uses official preview without a second zoom/download flow',()=>!!document.querySelector('#canvas-panel [data-slot="image-root"]')&&!document.querySelector('#canvas-panel .aui-image-zoom-trigger,#canvas-panel [data-slot="file-download"]'));
   await press(page,'.canvas-collapse, .conversation-header [aria-controls=canvas-panel][aria-expanded=true]:not([aria-hidden=true] *)');await wait(()=>!document.querySelector('#canvas-panel'));
   await check('closing Canvas restores the exact official file-row trigger',()=>document.activeElement.getAttribute('aria-label')==='预览 合成图片成果.png');
   await press(page,'[data-slot="file-list"] [aria-label^="预览 合成文件名"]');await wait(()=>document.querySelector('#canvas-panel pre')?.textContent==='Synthetic exact result bytes');
   await press(page,'.canvas-collapse, .conversation-header [aria-controls=canvas-panel][aria-expanded=true]:not([aria-hidden=true] *)');await wait(()=>!document.querySelector('#canvas-panel'));
   messages.find(m=>m.id==='image-user').media[0].state='revoked';fixture.update({messages:structuredClone(messages)});
   await wait(()=>document.querySelector('#message-image-user .message-attachment')?.textContent.includes('已撤回'));
   await check('revoked attachment loses preview/download rather than becoming a generic available file',()=>!document.querySelector('#message-image-user .message-attachment:first-child .lazy-media,#message-image-user .message-attachment:first-child [data-slot="file-download"]'));
   await page.screenshot('official-image-file-'+width+'.png');
   assert.deepEqual(page.errors,[]);assert.deepEqual(page.blocked,[]);assert.deepEqual(fixture.received.denied,[]);assert.equal(fixture.received.messages.length,0);
  }catch(error){await page.screenshot('failure-'+width+'.png');writeFileSync(join(destination,'failure-'+width+'.json'),JSON.stringify({error:String(error),requests,errors:page.errors,html:await page.evaluate(()=>document.querySelector('#message-image-user')?.outerHTML)},null,2));throw error;}
  finally{await page.close();}
 }
 passed=true;
}finally{await fixture.close();await chrome.close();writeFileSync(join(destination,'image-file-browser.json'),JSON.stringify({passed,checks,syntheticOnly:true},null,2));}
console.log(JSON.stringify({passed,checks:checks.length,widths:[1440,390,320],syntheticOnly:true}));
