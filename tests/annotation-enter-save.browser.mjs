// Requirement-derived synthetic keyboard regression. Real shared form, Canvas
// consumers and pinned Annotorious; local HTTP, isolated Chrome, no real account.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {deflateSync} from 'node:zlib';
import {buildSync} from 'esbuild';
import {fixture} from './web-history-followup-fixture.mjs';
import {isolatedChrome} from './web-history-browser-cdp.mjs';
import {actualClick} from './helpers/html-preview-browser.mjs';

const destination=resolve(process.env.HOMER_REVIEW_EVIDENCE_ROOT??'.codex/scratch/annotation-enter-save-20261025/browser');
mkdirSync(destination,{recursive:true});
const checks=[],mode=process.env.HOMER_ENTER_TEST_MODE;
const record=(surface,width,label)=>{checks.push({surface,width,label});console.log(surface,width,label);};
function syntheticPng(){
 const chunk=(type,bytes)=>{const data=Buffer.concat([Buffer.from(type),bytes]);let crc=0xffffffff;for(const byte of data){crc^=byte;for(let n=0;n<8;n++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}const size=Buffer.alloc(4),sum=Buffer.alloc(4);size.writeUInt32BE(bytes.length);sum.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([size,data,sum]);};
 const head=Buffer.alloc(13);head.writeUInt32BE(240);head.writeUInt32BE(120,4);head[8]=8;head[9]=2;
 const raw=Buffer.alloc(721*120,120);for(let y=0;y<120;y++)raw[y*721]=0;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',head),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
function controls(p){
 const ev=x=>p.evaluate(x),until=x=>p.until(x,10000);
 const fill=async text=>{await ev(()=>{const t=document.querySelector('.annotation-comment-form textarea');t.focus();t.select();});await p.command('Input.insertText',{text});};
 const key=async(key='Enter',modifiers=0)=>{const code=key==='Enter'?13:27;await p.command('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,windowsVirtualKeyCode:code,modifiers,...(key==='Enter'?{text:'\r'}:{})});await p.command('Input.dispatchKeyEvent',{type:'keyUp',key,code:key,windowsVirtualKeyCode:code,modifiers});};
 const click=async selector=>{await ev(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest'})`);await until(`(()=>{const b=document.querySelector(${JSON.stringify(selector)});if(!b)return false;const r=b.getBoundingClientRect();return b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})()`);await actualClick(p,await ev(`document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().toJSON()`));};
 return {ev,until,fill,key,click};
}

// A real browser is required: the node DOM helper has neither textarea default
// editing nor requestSubmit. Hold the form mounted so a double submission is visible.
async function sharedForm(chrome){
 const bundle=buildSync({stdin:{contents:`import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{AnnotationCommentForm}from'./ui/annotation-comment-form.tsx';
 window.saves=[];window.escapes=0;window.addEventListener('keydown',e=>{if(e.key==='Escape')window.escapes++});
 function Harness(){const[value,setValue]=useState('单次备注'),[busy,setBusy]=useState(false);window.busy=setBusy;
 return <AnnotationCommentForm title="合成表单" value={value} busy={busy} onChange={setValue} onSave={()=>window.saves.push(value)} onCancel={()=>{}}/>;}createRoot(document.getElementById('root')).render(<Harness/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'empty'}}).outputFiles[0].text;
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/form.js'?'text/javascript':'text/html');res.end(req.url==='/form.js'?bundle:'<!doctype html><meta charset="utf-8"><div id="root"></div><script src="/form.js"></script>');});
 await new Promise(done=>server.listen(0,'127.0.0.1',done));
 const p=await chrome.page('http://127.0.0.1:'+server.address().port,390),{ev,until,fill,key,click}=controls(p);
 try{
  await p.navigate();await until(()=>!!document.querySelector('textarea'));await fill('单次备注');await key();
  assert.deepEqual(await ev(()=>window.saves),['单次备注'],'Enter must save exactly once');
  assert.equal(await ev(()=>document.querySelector('textarea').value),'单次备注','Enter must not insert a newline');
  await key('Enter',8);assert.equal(await ev(()=>document.querySelector('textarea').value),'单次备注\n');assert.equal(await ev(()=>window.saves.length),1);
  for(const modifier of [1,2,4]){await fill('修饰键'+modifier);await key('Enter',modifier);}
  assert.equal(await ev(()=>window.saves.length),4,'Alt/Ctrl/Meta+Enter match the pinned native form');
  record('shared',390,'single submit, no Enter newline, Shift+Enter newline, native modifier semantics');
  await fill('候选确认');
  await ev(()=>{const t=document.querySelector('textarea');t.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:'候选'}));for(const key of ['Enter','Escape'])t.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true}));t.form.requestSubmit();});
  assert.equal(await ev(()=>window.saves.length),4);assert.equal(await ev(()=>window.escapes),0);
  await ev(()=>{const t=document.querySelector('textarea');t.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'候选'}));for(const key of ['Enter','Escape'])t.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,keyCode:229}));});
  assert.equal(await ev(()=>window.saves.length),4);assert.equal(await ev(()=>window.escapes),0);
  await ev(()=>{const t=document.querySelector('textarea');for(const key of ['Enter','Escape'])t.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,isComposing:true}));});
  assert.equal(await ev(()=>window.saves.length),4);await key();assert.equal(await ev(()=>window.saves.length),5);
  assert.equal(await ev(()=>window.saves.at(-1)),'候选确认');
  record('shared',390,'composition ref, native isComposing, compositionend+229 same tick, later explicit Enter');
  for(const value of [' \n ','长'.repeat(16001)]){await fill(value);await key();await ev(()=>document.querySelector('textarea').form.requestSubmit());assert.equal(await ev(()=>window.saves.length),5);assert.equal(await ev(()=>document.querySelector('textarea').value),value);}
  await fill('忙碌保留');await ev(()=>window.busy(true));await until(()=>document.querySelector('textarea').disabled);
  await ev(()=>{const t=document.querySelector('textarea');t.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));t.form.requestSubmit();});assert.equal(await ev(()=>window.saves.length),5);
  await ev(()=>window.busy(false));await until(()=>!document.querySelector('textarea').disabled);await click('button[type=submit]');assert.equal(await ev(()=>window.saves.length),6);
  assert.deepEqual(p.errors,[]);assert.deepEqual(p.blocked,[]);
  record('shared',390,'blank/16001/busy cannot submit or lose input; clicking Save still works');
 }finally{await p.close();await new Promise(done=>server.close(done));}
}

async function consumers(chrome){
 const text='第一处中文。第二处中文。第三处中文。';
 const png=syntheticPng();
 const files=[{id:'result-enter-text',title:'Enter.txt',mime:'text/plain',bytes:Buffer.from(text)},{id:'result-enter-image',title:'Enter.png',mime:'image/png',bytes:png}];
 const f=await fixture(4,'after');let uploads=0;
 f.bridge.artifact=async id=>{const file=files.find(x=>x.id===id);if(!file)throw Error('synthetic_file_missing');return {filename:file.title,mime:file.mime,data:file.bytes.toString('base64'),sha256:createHash('sha256').update(file.bytes).digest('hex')};};
 f.bridge.media.upload=async input=>{uploads++;return {assetId:'asset-'+input.uploadId,revision:1,filename:input.filename,kind:'image',state:'ready',mime:'image/png',size:png.length,error:null};};
 for(const owner of [f.bridge,f.bridge.history]){const state=owner.state.bind(owner);owner.state=async()=>{const value=await state();return {...value,features:{...value.features,draftUpload:true},artifacts:[...(value.artifacts??[]),...files.map(({id,title})=>({id,title,messageId:'node-3',workTitle:'Synthetic Enter'}))]};};}
 try{for(const width of process.env.HOMER_TEST_WIDTHS?.split(',').map(Number)??[1440,390,320]){
  const p=await chrome.page(f.server.url,width),{ev,until,fill,key,click}=controls(p);
  const draft=()=>ev(()=>JSON.parse(sessionStorage.getItem('homer-draft:synthetic-history')));
  const count=()=>ev(()=>document.querySelectorAll('.annotation-chip').length);
  const open=async index=>{await ev(()=>document.querySelector('.canvas-collapse, .conversation-header [aria-controls=canvas-panel][aria-expanded=true]:not([aria-hidden=true] *)')?.click());await until(()=>!document.querySelector('#canvas-panel'));await ev(`document.querySelector('.file-list-open[aria-label="预览 ${files[index].title}"]').click()`);await until(index===0?()=>!!document.querySelector('[data-preview-text]'):()=>!!document.querySelector('#canvas-panel img')?.naturalWidth);};
  const select=async(start,end)=>{await ev(`(()=>{const n=document.querySelector('[data-preview-text]').firstChild,r=document.createRange();r.setStart(n,${start});r.setEnd(n,${end});getSelection().removeAllRanges();getSelection().addRange(r);document.dispatchEvent(new Event('selectionchange'));})()`);await until(()=>!!document.querySelector('[data-slot=selection-toolbar-quote]'));await click('[data-slot=selection-toolbar-quote]');await until(()=>!!document.querySelector('.annotation-comment-form'));};
  const saved=async expected=>{await until(()=>!document.querySelector('.annotation-comment-form'));assert.equal(await count(),expected);assert.ok(await ev(()=>!!document.querySelector('#canvas-panel')));assert.equal(await ev(()=>document.activeElement?.getAttribute('contenteditable'))==='true',false);};
  const ime=async()=>{const before=await count();await fill('候选内容');await ev(()=>{const t=document.querySelector('.annotation-comment-form textarea');t.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:'候选'}));for(const key of ['Enter','Escape'])t.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,isComposing:true}));t.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'候选'}));for(const key of ['Enter','Escape'])t.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,keyCode:229}));});assert.ok(await ev(()=>!!document.querySelector('.annotation-comment-form')));assert.equal(await count(),before);};
  const invalid=async expected=>{for(const value of [' \n ','长'.repeat(16001)]){await fill(value);await key();assert.equal(await count(),expected);assert.equal(await ev(()=>document.querySelector('.annotation-comment-form textarea').value),value);}};
  try{
   await p.navigate();await until(()=>!!document.querySelector('[contenteditable=true]'));
   if(process.env.HOMER_ENTER_TEST_SURFACE!=='image'){
   await open(0);await select(0,6);await fill('文本第一注');await key();
   // Assert the observable outcome without waiting for a timeout on the old behavior.
   assert.equal(await count(),1,'text consumer Enter must save a chip');await saved(1);
   await click('.text-annotation-marker');await until(()=>!!document.querySelector('textarea'));const first=(await draft()).resourceReferences[0].annotations[0].id;
   await fill('文本两行');await key('Enter',8);assert.equal(await ev(()=>document.querySelector('.annotation-comment-form textarea').value),'文本两行\n');assert.equal(await count(),1);
   await ime();await invalid(1);await fill('文本已修改');await key();await saved(1);assert.equal((await draft()).resourceReferences[0].annotations[0].id,first);assert.equal((await draft()).resourceReferences[0].annotations[0].comment,'文本已修改');
   await select(6,12);await fill('文本第二注');await key();await saved(2);await select(12,18);await fill('鼠标保存');await click('.annotation-comment-form button[type=submit]');await saved(3);
   await click('.text-annotation-marker');await fill('放弃编辑');await key('Escape');await until(()=>!document.querySelector('.annotation-comment-form'));assert.equal((await draft()).resourceReferences[0].annotations[0].comment,'文本已修改');
   record('text',width,'Enter saves, edit keeps ID, Shift+Enter/IME/invalid preserve input, consecutive new notes, click and Escape');
   // Reject through the existing cumulative intent budget, then correct in place.
   await click('.text-annotation-marker');await fill('注'.repeat(15000));await key();await saved(3);await click('.text-annotation-marker:nth-child(2)');await fill('拒'.repeat(10000));await key();await until(()=>!!document.querySelector('.annotation-comment-form [role=alert]'));
   assert.equal(await ev(()=>document.querySelector('.annotation-comment-form textarea').value.length),10000);assert.equal(await count(),3);await fill('修正后第二注');await key();await saved(3);
   await click('.text-annotation-marker');await fill('文本第一注归位');await key();await saved(3);
   record('text',width,'cumulative budget rejection retains input and saved draft; corrected Enter succeeds');
   await click('.text-annotation-marker');await p.screenshot('text-'+width+'.png');await key('Escape');await until(()=>!document.querySelector('.annotation-comment-form'));
   }
   const beforeImage=await count();
   await open(1);await click('.image-annotation-toggle');await until(()=>!!document.querySelector('.a9s-annotationlayer'));
   const draw=async(a,b)=>{const r=await ev(()=>document.querySelector('.image-annotation img').getBoundingClientRect().toJSON()),start={x:r.x+r.width*a,y:r.y+r.height*.15},end={x:r.x+r.width*b,y:r.y+r.height*.6};await p.command('Input.dispatchMouseEvent',{type:'mousePressed',...start,button:'left',clickCount:1});for(let i=1;i<=5;i++)await p.command('Input.dispatchMouseEvent',{type:'mouseMoved',x:start.x+(end.x-start.x)*i/5,y:start.y+(end.y-start.y)*i/5,button:'left',buttons:1});await p.command('Input.dispatchMouseEvent',{type:'mouseReleased',...end,button:'left',clickCount:1});await until(()=>!!document.querySelector('.annotation-comment-form'));};
   await draw(.1,.35);await fill('图片第一注');await key();assert.equal(await ev(()=>document.querySelector('.annotation-comment-form textarea')?.value.includes('\n')??false),false,'image consumer Enter must save without inserting a newline');await saved(beforeImage+1);
   let notes=(await draft()).resourceReferences.find(r=>r.kind==='image').annotations;const original=structuredClone(notes[0]);
   const edit=async()=>{await click('.a9s-annotation[data-id="'+original.id+'"] .a9s-inner');await until(()=>!!document.querySelector('.annotation-comment-form'));};
   await edit();await fill('图片两行');await key('Enter',8);assert.equal(await ev(()=>document.querySelector('.annotation-comment-form textarea').value),'图片两行\n');await ime();await invalid(beforeImage+1);await fill('图片已修改');await key();await saved(beforeImage+1);
   notes=(await draft()).resourceReferences.find(r=>r.kind==='image').annotations;assert.equal(notes[0].id,original.id);assert.deepEqual(notes[0].region,original.region);assert.equal(notes[0].comment,'图片已修改');
   await draw(.6,.9);await fill('图片第二注');await key();await saved(beforeImage+2);await edit();await fill('鼠标更新图片');await click('.annotation-comment-form button[type=submit]');await saved(beforeImage+2);
   await edit();await fill('图片取消');await p.screenshot('image-'+width+'.png');await click('.annotation-comment-form .quiet:not([aria-label])');await until(()=>!document.querySelector('.annotation-comment-form'));
   notes=(await draft()).resourceReferences.find(r=>r.kind==='image').annotations;assert.equal(notes[0].comment,'鼠标更新图片');assert.deepEqual(notes[0].region,original.region);
   record('image',width,'native drawing, Enter/edit/new notes, Shift+Enter/IME/invalid, mouse Save and cancel retain geometry');
   assert.equal(f.submitted.length,0);assert.equal(f.fakeEngine.invocations,0);assert.equal(p.requests.filter(x=>x.path==='/api/messages').length,0);assert.deepEqual(p.errors,[]);assert.deepEqual(p.blocked,[]);assert.equal(await ev(()=>document.documentElement.scrollWidth>innerWidth),false);
   record('owners',width,'reading remains open, no Lexical focus, no message/model/external request or horizontal overflow');
  }catch(error){await p.screenshot('failure-'+width+'.png');writeFileSync(join(destination,'failure.json'),JSON.stringify({width,error:String(error)},null,2));throw error;}
  finally{await p.close();}
 }}finally{await f.close();}
 assert.equal(uploads,(process.env.HOMER_TEST_WIDTHS?.split(',')??[1440,390,320]).length,'one original-image upload per page');
}

const chrome=await isolatedChrome(destination);
try{
 if(mode!=='owners')await sharedForm(chrome);
 if(mode!=='shared')await consumers(chrome);
 writeFileSync(join(destination,'results.json'),JSON.stringify({passed:true,checks},null,2));
}finally{await chrome.close();}
