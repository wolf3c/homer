// Real PNGs with different intrinsic dimensions, delayed bytes, real browser layout.
import assert from 'node:assert/strict';import {deflateSync} from 'node:zlib';import {writeFileSync} from 'node:fs';import {resolve,join} from 'node:path';
import {fixture} from './web-history-followup-fixture.mjs';import {isolatedChrome,probeScript} from './web-history-browser-cdp.mjs';
const destination=resolve(process.env.HISTORY_MEDIA_EVIDENCE??process.env.HOMER_BROWSER_EVIDENCE??'.codex/scratch/web-history-loading-implementation/followup');
function png(width,height){const crc=bytes=>{let n=0xffffffff;for(const byte of bytes){n^=byte;for(let k=0;k<8;k++)n=(n>>>1)^((n&1)?0xedb88320:0);}return(n^0xffffffff)>>>0;};const chunk=(name,body)=>{const head=Buffer.from(name),size=Buffer.alloc(4),sum=Buffer.alloc(4);size.writeUInt32BE(body.length);sum.writeUInt32BE(crc(Buffer.concat([head,body])));return Buffer.concat([size,head,body,sum]);};const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;const raw=Buffer.alloc((width*3+1)*height);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=y*(width*3+1)+1+x*3;raw[i]=70+Math.floor(x/width*100);raw[i+1]=100+Math.floor(y/height*80);raw[i+2]=140;}return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);}
const dimensions=[[640,80],[80,600],[360,360]],images=dimensions.map(([w,h])=>png(w,h));
const chrome=await isolatedChrome(destination),rows=[];
try{for(const width of [1440,390,320]){
 const f=await fixture(100,'after');
 for(let n=20;n<100;n++)f.addUserMedia(n,images[n%3]);
 const read=f.bridge.media.read;
 f.bridge.media.read=async input=>{await new Promise(done=>setTimeout(done,650));return read(input);};
 const page=await chrome.page(f.server.url,width);
 try{
  await page.command('Page.addScriptToEvaluateOnNewDocument',{source:probeScript});await page.command('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'dark'}]});
  await page.navigate();await page.until(()=>document.querySelectorAll('[data-conversation-message]').length===80);
  // A real reader gesture cancels pending initial positioning before pagination.
  await page.command('Input.dispatchMouseEvent',{type:'mouseWheel',x:width/2,y:300,deltaX:0,deltaY:-1000000});
  await page.until(()=>document.querySelector('.thread-viewport').scrollTop===0);
  await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
  const anchor=await page.evaluate(()=>{const view=document.querySelector('.thread-viewport'),first=[...document.querySelectorAll('[data-conversation-message]')].find(e=>e.getBoundingClientRect().bottom>view.getBoundingClientRect().top);window.__anchor=first;return {id:first.id,offset:first.getBoundingClientRect().top-view.getBoundingClientRect().top};});
  const placeholder=await page.evaluate(()=>document.querySelector('.lazy-media')?.getBoundingClientRect().height);
  await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='加载更早消息').click());await page.until(()=>document.querySelectorAll('[data-conversation-message]').length>80);
  await page.until(()=>[...document.querySelectorAll('.lazy-media img')].some(img=>img.naturalWidth>1));await new Promise(done=>setTimeout(done,1600));
  const result=await page.evaluate(()=>({offset:window.__anchor.getBoundingClientRect().top-document.querySelector('.thread-viewport').getBoundingClientRect().top,images:[...document.querySelectorAll('.lazy-media img')].map(img=>({width:img.naturalWidth,height:img.naturalHeight,slot:img.closest('.lazy-media').getBoundingClientRect().height})),probe:window.__mediaProbe,dark:matchMedia('(prefers-color-scheme:dark)').matches,background:getComputedStyle(document.documentElement).getPropertyValue('--canvas'),overflow:document.documentElement.scrollWidth>innerWidth}));
  result.anchorError=Math.abs(result.offset-anchor.offset);result.placeholder=placeholder;assert.ok(result.anchorError<=4);assert.ok(result.images.every(img=>img.width>1&&img.height>1));assert.ok(new Set(result.images.map(img=>img.width+'/'+img.height)).size>=2);assert.equal(result.overflow,false);assert.ok(result.probe.max<=2);
  await page.screenshot('delayed-varied-images-dark-'+width+'.png');
  // Attempt browser-native zoom shortcuts. Record the actual effective scale;
  // pinch/pageScale emulation and CSS zoom are deliberately not substitutes.
  const zoomBefore=await page.evaluate(()=>({ratio:devicePixelRatio,width:innerWidth,scale:visualViewport.scale}));
  if(!process.argv.includes('--skip-unverified-zoom'))for(let n=0;n<4;n++)await page.command('Input.dispatchKeyEvent',{type:'keyDown',key:'+',code:'Equal',modifiers:4,windowsVirtualKeyCode:187});
  const zoomAfter=await page.evaluate(()=>({ratio:devicePixelRatio,width:innerWidth,scale:visualViewport.scale}));
  rows.push({width,anchor,...result,zoomAttempt:{method:process.argv.includes('--skip-unverified-zoom')?'not retried; prior attempt unverified':'Chrome Meta+plus via CDP Input',before:zoomBefore,after:zoomAfter,verified200Percent:zoomAfter.ratio/zoomBefore.ratio===2},errors:page.errors,submits:f.submitted.length});assert.deepEqual(page.errors,[]);assert.equal(f.submitted.length,0);
 }finally{await page.close();await f.close();}
}}finally{await chrome.close();writeFileSync(join(destination,'delayed-image-anchor-dark-browser.json'),JSON.stringify(rows,null,2));}
