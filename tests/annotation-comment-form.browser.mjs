// Requirement-derived synthetic stress cases. Real Canvas owners, local HTTP,
// isolated Chrome; no product profile, model, channel, installed App or upload.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {deflateSync} from 'node:zlib';
import {fixture} from './web-history-followup-fixture.mjs';
import {isolatedChrome} from './web-history-browser-cdp.mjs';

const destination=resolve(process.env.HOMER_REVIEW_EVIDENCE_ROOT??'.codex/scratch/annotation-comment-form-unification-20261025/presentation');
mkdirSync(destination,{recursive:true});
function imageBytes(){
 const chunk=(type,bytes)=>{
  const data=Buffer.concat([Buffer.from(type),bytes]);let crc=0xffffffff;
  for(const byte of data){crc^=byte;for(let n=0;n<8;n++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  const size=Buffer.alloc(4),sum=Buffer.alloc(4);size.writeUInt32BE(bytes.length);sum.writeUInt32BE((crc^0xffffffff)>>>0);
  return Buffer.concat([size,data,sum]);
 };
 const head=Buffer.alloc(13);head.writeUInt32BE(240);head.writeUInt32BE(120,4);head[8]=8;head[9]=2;
 const raw=Buffer.alloc(721*120,120);for(let y=0;y<120;y++)raw[y*721]=0;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',head),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
const text=Array.from({length:150},(_,i)=>`第${i}行：${'完整引用内容，'.repeat(12)}`).join('\n'),png=imageBytes();
const files=[{id:'result-comment-text',title:'很长的文件标题'.repeat(12)+'.txt',mime:'text/plain',bytes:Buffer.from(text)},{id:'result-comment-image',title:'很长的图片标题'.repeat(12)+'.png',mime:'image/png',bytes:png}];
const f=await fixture(4,'after'),checks=[],metrics=[];
f.attach('Synthetic form',files.map(({title,mime,bytes})=>({filename:title,mime,content:bytes})));
try{
 for(const zoom of [1,2]){
  const chrome=await isolatedChrome(join(destination,'zoom-'+zoom));
  try{for(const width of (zoom===1?[1440,1000,390,320]:[1440,390,320])){
   const p=await chrome.page(f.server.url,width),ev=expression=>p.evaluate(expression),until=expression=>p.until(expression,10000);
   // Apply 200% scaling once via device metrics.
   if(zoom===2)await p.command('Emulation.setDeviceMetricsOverride',{width:Math.round(width/2),height:450,deviceScaleFactor:2,mobile:false});
   const record=label=>{checks.push({width,zoom,label});console.log(width,zoom,label);};
   const key=async(key,n)=>{await p.command('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,windowsVirtualKeyCode:n,...(key==='Enter'?{text:'\r'}:{})});await p.command('Input.dispatchKeyEvent',{type:'keyUp',key,code:key,windowsVirtualKeyCode:n});};
   const click=async selector=>{
    const r=await ev(`document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().toJSON()`),point={x:r.x+r.width/2,y:r.y+r.height/2};
    await p.command('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});await p.command('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
   };
   const open=async index=>{
    await ev(()=>document.querySelector('.canvas-collapse, .conversation-header [aria-controls=canvas-panel][aria-expanded=true]:not([aria-hidden=true] *)')?.click());await until(()=>!document.querySelector('#canvas-panel'));
    await ev(`(()=>{const b=document.querySelector('.file-list-open[aria-label='+CSS.escape(${JSON.stringify('预览 '+files[index].title)})+']');b.scrollIntoView({block:'center'});b.click();})()`);
    await until(index===0?()=>!!document.querySelector('[data-preview-text]'):()=>document.querySelector('#canvas-panel img')?.naturalWidth===240);
    if(width===1000&&zoom===1){
     const r=await ev(()=>document.querySelector('.preview-separator').getBoundingClientRect().toJSON());
     await p.command('Input.dispatchMouseEvent',{type:'mousePressed',x:r.x+r.width/2,y:450,button:'left',clickCount:1});
     for(let n=1;n<=5;n++)await p.command('Input.dispatchMouseEvent',{type:'mouseMoved',x:r.x+(750-r.x)*n/5,y:450,button:'left',buttons:1});
     await p.command('Input.dispatchMouseEvent',{type:'mouseReleased',x:750,y:450,button:'left',clickCount:1});
     assert.ok(await ev(()=>document.querySelector('#canvas-panel').getBoundingClientRect().width<=251),'actual preview panel narrowed to 25%');
    }
   };
   const fill=async value=>{await ev(()=>{const t=document.querySelector('.annotation-comment-form textarea');t.focus();t.select();});await p.command('Input.insertText',{text:value});};
   const cancel=async()=>{await click('.annotation-comment-actions button[type=button]:not([aria-label])');await until(()=>!document.querySelector('.annotation-comment-form'));};
   const measure=async label=>{
    await until(()=>!!document.querySelector('.annotation-comment-form textarea'));
    // Let native Floating UI/Base UI positioning settle after content resize.
    await ev(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
    const m=await ev(()=>{
     const form=document.querySelector('.annotation-comment-form'),t=form.querySelector('textarea'),label=form.querySelector('label'),s=getComputedStyle(form),ts=getComputedStyle(t);
     const buttons=[...form.querySelectorAll('button')].map(b=>{const r=b.getBoundingClientRect(),s=getComputedStyle(b);return {text:b.textContent,font:s.fontSize,lineHeight:s.lineHeight,rect:r.toJSON(),hit:b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};});
     return {rect:form.getBoundingClientRect().toJSON(),width:innerWidth,height:innerHeight,devicePixelRatio,font:ts.fontSize,rows:t.rows,radius:s.borderRadius,padding:s.padding,textareaRadius:ts.borderRadius,buttons,labelled:label.htmlFor===t.id&&!!t.id,described:(t.getAttribute('aria-describedby')??'').split(' ').filter(Boolean).every(id=>!!document.getElementById(id)),invalid:t.getAttribute('aria-invalid'),busy:form.getAttribute('aria-busy'),horizontalOverflow:Math.max(0,document.documentElement.scrollWidth-innerWidth)};
    });
    metrics.push({width,zoom,label,...m});
    assert.equal(m.horizontalOverflow,0);assert.equal(m.labelled,true);assert.equal(m.described,true);assert.equal(m.rows,2);assert.equal(m.radius,'16px');assert.equal(m.padding,'12px 16px');assert.equal(m.textareaRadius,'8px');assert.equal(m.font,m.width<=800?'16px':'13px');
    assert.ok(m.rect.left>=0&&m.rect.right<=m.width+1&&m.rect.top>=0&&m.rect.bottom<=m.height+1,JSON.stringify({label,...m}));
    assert.equal(m.width,Math.round(width/zoom));
    assert.equal(m.devicePixelRatio,zoom);
    for(const b of m.buttons){assert.equal(b.font,'12px');assert.equal(b.lineHeight,'18px');assert.ok(b.hit,'visible and hit-testable '+b.text+' '+label);assert.ok(b.rect.left>=m.rect.left&&b.rect.right<=m.rect.right+1&&b.rect.top>=m.rect.top&&b.rect.bottom<=m.rect.bottom+1,'whole button fits '+b.text+' '+label);}
    assert.deepEqual(m.buttons.slice(-2).map(b=>b.text),['取消','保存']);
   };
   const select=async(start,end)=>{
    await ev(`(()=>{const el=document.querySelector('[data-preview-text]'),node=el.firstChild,r=document.createRange();r.setStart(node,${start});r.setEnd(node,${end});getSelection().removeAllRanges();getSelection().addRange(r);el.parentElement.scrollTop=0;const scroller=document.querySelector('[data-slot=canvas-split-body]');const box=r.getBoundingClientRect(),container=scroller.getBoundingClientRect();scroller.scrollTop+=box.top-container.top-40;document.dispatchEvent(new Event('selectionchange'));})()`);
    await until(()=>!!document.querySelector('[data-slot=selection-toolbar-quote]'));await click('[data-slot=selection-toolbar-quote]');await until(()=>!!document.querySelector('.annotation-comment-form'));
   };
   try{
    await p.navigate();await until(()=>!!document.querySelector('[contenteditable=true]'));await open(0);
    await select(0,1500);await fill('长摘录完整保留。');await measure('text-long-excerpt');
    assert.equal(await ev(()=>document.querySelector('.annotation-comment-form blockquote').textContent.length),1500);
    assert.ok(await ev(()=>{const b=document.querySelector('.annotation-comment-form blockquote');return b.clientHeight<=80&&b.scrollHeight>b.clientHeight;}));
    assert.equal(await ev(()=>!!document.querySelector('.annotation-comment-actions [aria-label="删除此批注"]')),false);
    await p.screenshot(`text-${width}-zoom-${zoom}.png`);await key('Tab',9);assert.equal(await ev(()=>document.activeElement.textContent),'取消');assert.ok(await ev(()=>document.activeElement.matches(':focus-visible')));await key('Tab',9);assert.equal(await ev(()=>document.activeElement.textContent),'保存');await key('Enter',13);await until(()=>!document.querySelector('.annotation-comment-form'));
    assert.ok(await ev(()=>!!document.activeElement.closest('#canvas-panel')));assert.notEqual(await ev(()=>document.activeElement.getAttribute('contenteditable')),'true');
    await click('.text-annotation-marker');await measure('text-saved-edit');assert.ok(await ev(()=>!!document.querySelector('.annotation-comment-actions [aria-label="删除此批注"]')));await click('[aria-label="删除此批注"]');await until(()=>!document.querySelector('.annotation-comment-form'));assert.equal(await ev(()=>document.querySelectorAll('.text-annotation-marker,.annotation-chip').length),0);record('long title/excerpt, original text, keyboard focus, save and exact saved-note deletion');
    for(const [start,end] of [[0,10],[75,86],[text.length-100,text.length-90],[text.length-12,text.length-1]]){await select(start,end);await fill('边缘锚点备注');await measure('text-edge-'+start);await cancel();}
    await select(0,10);await fill('长'.repeat(16001));await measure('text-long-error');assert.equal(await ev(()=>document.querySelector('.annotation-comment-form textarea').value.length),16001);await cancel();record('text scroll/edge anchors and oversized-error buttons remain inside viewport');
    await open(1);await click('.image-annotation-toggle');await until(()=>!!document.querySelector('.a9s-annotationlayer'));
    // Four native rectangles at the image's corners, each canceled, leaving no note.
    for(const [x1,y1,x2,y2] of [[.01,.01,.12,.2],[.85,.01,.99,.2],[.01,.8,.12,.99],[.85,.8,.99,.99]]){
     const r=await ev(()=>document.querySelector('.image-annotation img').getBoundingClientRect().toJSON()),start={x:r.x+r.width*x1,y:r.y+r.height*y1},end={x:r.x+r.width*x2,y:r.y+r.height*y2};
     await p.command('Input.dispatchMouseEvent',{type:'mousePressed',...start,button:'left',clickCount:1});await p.command('Input.dispatchMouseEvent',{type:'mouseMoved',...end,button:'left',buttons:1});await p.command('Input.dispatchMouseEvent',{type:'mouseReleased',...end,button:'left',clickCount:1});
     await until(()=>!!document.querySelector('.annotation-comment-form'));await fill('图片边角备注');await measure('image-corner-'+x1+'-'+y1);
     if(x1===.85&&y1===.8){await fill('长'.repeat(16001));await measure('image-long-error');await p.screenshot(`image-${width}-zoom-${zoom}.png`);}
     await cancel();assert.equal(await ev(()=>document.querySelectorAll('.image-region-number').length),0);
    }
    record('image four corners, long error, native cancel and same form typography remain visible');
    await p.command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    assert.equal(f.submitted.length,0);assert.equal(f.fakeEngine.invocations,0);assert.deepEqual(p.errors,[]);assert.deepEqual(p.blocked,[]);record('no automatic send, model invocation, external request or browser exception');
   }catch(error){await p.screenshot(`failure-${width}-zoom-${zoom}.png`);writeFileSync(join(destination,'failure.json'),JSON.stringify({width,zoom,error:String(error),ui:await ev(()=>document.querySelector('#canvas-panel')?.outerHTML)},null,2));throw error;}
   finally{await p.close();}
  }}finally{await chrome.close();}
 }
 writeFileSync(join(destination,'results.json'),JSON.stringify({passed:true,checks,metrics},null,2));
}finally{await f.close();}
