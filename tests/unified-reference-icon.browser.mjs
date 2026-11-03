// Requirement-derived synthetic review only. No installed app, account or model.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {fixture} from './web-history-followup-fixture.mjs';
import {isolatedChrome} from './web-history-browser-cdp.mjs';
import {actualClick} from './helpers/html-preview-browser.mjs';
const root=resolve(process.env.HOMER_REVIEW_EVIDENCE_ROOT??'.codex/scratch/unified-reference-icon-regression');
const baseline=process.env.HOMER_ICON_BASELINE==='1',destination=join(root,baseline?'baseline':'after');mkdirSync(destination,{recursive:true});
function png(){
 const crc=b=>{let n=0xffffffff;for(const v of b){n^=v;for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0);}return (n^0xffffffff)>>>0;};
 const chunk=(name,b)=>{const data=Buffer.concat([Buffer.from(name),b]),size=Buffer.alloc(4),sum=Buffer.alloc(4);size.writeUInt32BE(b.length);sum.writeUInt32BE(crc(data));return Buffer.concat([size,data,sum]);};
 const head=Buffer.alloc(13);head.writeUInt32BE(240);head.writeUInt32BE(120,4);head[8]=8;head[9]=2;const raw=Buffer.alloc(721*120);for(let y=0;y<120;y++)for(let x=0;x<240;x++){const i=y*721+1+x*3;raw[i]=55+x%160;raw[i+1]=120;raw[i+2]=180;}
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',head),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
const files=[
 {id:'result-icon-text',title:'图标核对.txt',mime:'text/plain',bytes:Buffer.from('第一处合成选文。第二处合成选文。\n'+('阅读内容。\n'.repeat(30)))},
 {id:'result-icon-html',title:'图标核对.html',mime:'text/html',bytes:Buffer.from('<!doctype html><meta charset="utf-8"><style>body{font:18px system-ui;padding:20px}</style><h1>合成网页</h1><p>批注模式核对</p>')},
 {id:'result-icon-image',title:'图标核对.png',mime:'image/png',bytes:png()},
];
const f=await fixture(4,'after'),checks=[],metrics=[];let chrome;
f.bridge.artifact=async id=>{const file=files.find(x=>x.id===id);assert.ok(file);return {filename:file.title,mime:file.mime,data:file.bytes.toString('base64'),sha256:createHash('sha256').update(file.bytes).digest('hex')};};
for(const owner of [f.bridge,f.bridge.history]){const state=owner.state.bind(owner);owner.state=async()=>{const value=await state();return {...value,artifacts:[...(value.artifacts??[]),...files.map(({id,title})=>({id,title,messageId:'node-3',workTitle:'Synthetic icon review'}))]};};}
f.history.accept('synthetic-history',{requestId:'historical-icon-review',text:'历史引用的合成说明',quotes:[{messageId:'node-3',text:'合成答复 3',annotation:''}]});
try{
 chrome=await isolatedChrome(destination);
 for(const width of [1440,390,320]){
  const p=await chrome.page(f.server.url,width),ev=x=>p.evaluate(x),until=x=>p.until(x,10000);
  const record=label=>{checks.push({width,label});console.log(width,label);};
  const click=async selector=>{await ev(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest'})`);await actualClick(p,await ev(`document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().toJSON()`));};
  const icon=async(selector,size)=>{
   const m=await ev(`(()=>{const b=document.querySelector(${JSON.stringify(selector)}),s=b?.matches('svg')?b:b?.querySelector('svg');if(!s)return null;const r=s.getBoundingClientRect(),c=getComputedStyle(s);return {class:s.getAttribute('class'),width:r.width,height:r.height,display:c.display,visibility:c.visibility,shrink:c.flexShrink}})()`);
   metrics.push({width,selector,...m});
   if(!baseline){assert.ok(m,selector+' icon exists');assert.ok(m.class.includes('lucide-message-circle-plus'),selector+' unified icon');assert.equal(m.width,size,selector+' width');assert.equal(m.height,size,selector+' height');assert.notEqual(m.display,'none');assert.notEqual(m.visibility,'hidden');}
  };
  const open=async index=>{await ev(`document.querySelector('.file-list-open[aria-label='+CSS.escape(${JSON.stringify('预览 '+files[index].title)})+']').click()`);await until(()=>!!document.querySelector('#canvas-panel'));};
  const close=async()=>{await click(width<=800?'.canvas-collapse,#canvas-close':'.conversation-header [aria-controls=canvas-panel]');await until(()=>!document.querySelector('#canvas-panel'));};
  const select=async(selector,text,message=false)=>{
   await ev(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);
   await ev(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
   const rect=await ev(`(()=>{const el=document.querySelector(${JSON.stringify(selector)}),n=el.firstChild,start=n.textContent.indexOf(${JSON.stringify(text)}),r=document.createRange();if(start<0)throw Error('synthetic_selection_missing');r.setStart(n,start);r.setEnd(n,start+${text.length});if(${message})return r.getBoundingClientRect().toJSON();getSelection().removeAllRanges();getSelection().addRange(r);document.dispatchEvent(new Event('selectionchange'));})()`);
   if(message){
    const x=rect.left+1,y=rect.top+rect.height/2,x2=rect.right-1;
    await p.command('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',buttons:1,clickCount:1});
    await p.command('Input.dispatchMouseEvent',{type:'mouseMoved',x:x2,y,button:'left',buttons:1});
    await p.command('Input.dispatchMouseEvent',{type:'mouseReleased',x:x2,y,button:'left',buttons:0,clickCount:1});
   }
   await until(()=>!!document.querySelector('[data-slot=selection-toolbar-quote]'));
  };
  const draft=()=>ev(()=>JSON.parse(sessionStorage.getItem('homer-draft:synthetic-history')));
  try{
   await p.navigate();await until(()=>!!document.querySelector('[contenteditable=true]'));
   await icon('[data-slot=quote-block-icon]',12);
   assert.equal(await ev(()=>getComputedStyle(document.querySelector('[data-slot=quote-block-text]')).webkitLineClamp),'2');
   await ev(()=>document.querySelector('[contenteditable=true]').focus());await p.command('Input.insertText',{text:'保留原草稿。'});
   await icon('#message-node-3 [aria-label="引用"]',14);
   await ev(()=>document.querySelector('#message-node-3 [aria-label="引用"]').click());await until(()=>!!document.querySelector('[data-slot=composer-quote]'));
   await icon('[data-slot=composer-quote-icon]',14);
   assert.equal(await ev(()=>document.activeElement===document.querySelector('[contenteditable=true]')),true);
   assert.equal((await draft()).text,'保留原草稿。');await p.screenshot('composer-'+width+'.png');
   await click('[data-slot=composer-quote-dismiss]');await until(()=>!document.querySelector('[data-slot=composer-quote]'));
   await select('#message-node-3 [data-aui-quote-selectable] p','合成答复 3',true);
   await icon('[data-slot=selection-toolbar-quote]',14);await p.screenshot('message-selection-'+width+'.png');
   await click('[data-slot=selection-toolbar-quote]');await until(()=>!!document.querySelector('[data-slot=composer-quote]'));
   assert.equal((await draft()).quotes[0].messageId,'node-3');assert.equal((await draft()).quotes[0].text,'合成答复 3');
   assert.equal(await ev(()=>getSelection().toString()),'');assert.equal(await ev(()=>document.activeElement===document.querySelector('[contenteditable=true]')),true);
   record('history and composer icons keep geometry; message action and official selection retain exact source, draft, clear-selection and composer focus');
   await click('[data-slot=composer-quote-dismiss]');await open(0);await until(()=>!!document.querySelector('[data-preview-text]'));
   await select('[data-preview-text]','第一处合成选文。');await icon('[data-slot=selection-toolbar-quote]',14);await p.screenshot('file-selection-'+width+'.png');
   await click('[data-slot=selection-toolbar-quote]');await until(()=>!!document.querySelector('.annotation-comment-form textarea'));
   await p.command('Input.insertText',{text:'合成批注。'});await click('.annotation-comment-form button[type=submit]');await until(()=>!!document.querySelector('.annotation-chip'));
   await close();await select('#message-node-3 [data-aui-quote-selectable] p','合成答复 3',true);await click('[data-slot=selection-toolbar-quote]');
   await until(()=>document.querySelector('.composer-area')?.textContent.includes('请先移除输入草稿中的成果批注'));
   assert.equal(await ev(()=>!!document.querySelector('[data-slot=composer-quote]')),false);assert.equal((await draft()).resourceReferences.length,1);
   await ev(()=>getSelection().removeAllRanges());await ev(()=>document.querySelector('#message-node-3 [aria-label="引用"]').click());assert.equal(await ev(()=>!!document.querySelector('[data-slot=composer-quote]')),false);
   record('file selection opens original form; save enters original annotation draft; both quote paths preserve existing annotation context');
   await open(1);await until(()=>!!document.querySelector('.html-annotation-toggle'));await icon('.html-annotation-toggle',14);
   assert.equal(await ev(()=>document.querySelector('.html-annotation-toggle').getAttribute('aria-pressed')),'false');await p.screenshot('html-idle-'+width+'.png');
   await click('.html-annotation-toggle');
   await until(()=>document.querySelector('.html-annotation-toggle')?.getAttribute('aria-pressed')==='true');await icon('.html-annotation-toggle',14);
   assert.equal(await ev(()=>document.querySelector('.html-annotation-toggle').getAttribute('aria-busy')),'false');await p.screenshot('html-active-'+width+'.png');
   assert.equal(await ev(()=>document.querySelector('.html-annotation-toggle').getAttribute('aria-label')),'退出批注，返回静态预览');
   await click('.html-annotation-toggle');await until(()=>document.querySelector('.html-annotation-toggle')?.getAttribute('aria-pressed')==='false');
   await close();await open(2);await until(()=>!!document.querySelector('.image-annotation-toggle'));await icon('.image-annotation-toggle',14);await p.screenshot('image-idle-'+width+'.png');
   await click('.image-annotation-toggle');await until(()=>document.querySelector('.image-annotation-toggle')?.getAttribute('aria-pressed')==='true');await icon('.image-annotation-toggle',14);await p.screenshot('image-active-'+width+'.png');
   await click('.image-annotation-toggle');await until(()=>document.querySelector('.image-annotation-toggle')?.getAttribute('aria-pressed')==='false');await icon('.image-annotation-toggle',14);
   assert.equal(await ev(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(f.submitted.length,0);assert.equal(f.fakeEngine.invocations,0);assert.deepEqual(p.errors,[]);assert.deepEqual(p.blocked,[]);
   record('HTML and image toggles retain active/inactive, tooltip and HTML busy semantics; native owners run, icons stay visible, no overflow or auto-send');
  }catch(error){await p.screenshot('failure-'+width+'.png').catch(()=>{});writeFileSync(join(destination,'failure.json'),JSON.stringify({width,error:String(error),errors:p.errors},null,2));throw error;}finally{await p.close();}
 }
 writeFileSync(join(destination,'result.json'),JSON.stringify({baseline,checks,metrics,submitted:f.submitted.length,modelInvocations:f.fakeEngine.invocations},null,2));
}finally{await chrome?.close();await f.close();}
