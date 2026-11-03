// Real built UI + existing synthetic HTTP owners; no user storage or model.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {deflateSync} from 'node:zlib';
import {fixture} from './web-history-followup-fixture.mjs';
import {syntheticFile} from './recursive-publication-fixture.js';
import {isolatedChrome} from './web-history-browser-cdp.mjs';

const destination=resolve(process.env.HOMER_REVIEW_EVIDENCE_ROOT??'.codex/scratch/official-canvas-reuse-20261023/product');
mkdirSync(destination,{recursive:true});
// Deterministic, visible PNG stripes, not a downloaded/private image.
function png(){
 const crc=bytes=>{let n=0xffffffff;for(const b of bytes){n^=b;for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0);}return (n^0xffffffff)>>>0;};
 const chunk=(kind,data)=>{const b=Buffer.concat([Buffer.from(kind),data]),n=Buffer.alloc(4),c=Buffer.alloc(4);n.writeUInt32BE(data.length);c.writeUInt32BE(crc(b));return Buffer.concat([n,b,c]);};
 const header=Buffer.alloc(13);header.writeUInt32BE(240);header.writeUInt32BE(120,4);header[8]=8;header[9]=2;
 const pixels=Buffer.alloc((240*3+1)*120);for(let y=0;y<120;y++)for(let x=0;x<240;x++){const i=y*721+1+x*3;pixels[i]=x<80?55:180;pixels[i+1]=x<160?120:65;pixels[i+2]=195;}
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
}
function pdf(){
 const content='BT /F1 20 Tf 35 180 Td (Synthetic PDF: readable preview) Tj ET';
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 460 240] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${content.length} >>\nstream\n${content}\nendstream`];
 let text='%PDF-1.4\n';const offsets=[0];for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(text));text+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}
 const start=Buffer.byteLength(text);text+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
 return Buffer.from(text);
}
const html='<!doctype html><h1>Isolated synthetic HTML</h1><button onclick="this.textContent=\'Local click passed\'">Local action</button><script>document.body.dataset.executed="yes";addEventListener("securitypolicyviolation",event=>{if(event.effectiveDirective==="connect-src")document.body.dataset.networkBlocked="yes"});fetch("https://canvas-test.invalid/blocked").catch(()=>{});try{parent.document.body.dataset.escaped="yes"}catch{}</script>';
const f=await fixture(50,'after'),checks=[];let chrome;
function check(value,label){assert.ok(value,label);checks.push(label);}
try{
 f.store.startRequest('request-0','official-canvas-synthetic');
 const result=syntheticFile(f,'request-0','synthetic-preview.html',html,[],true),delivery=result.publish('Synthetic official Canvas reply');
 f.history.record(delivery.historyMessageId,'synthetic-history',delivery.text);f.tasks.markDelivery(delivery.id,'recorded');
 const markdown='# Synthetic Markdown\n\n| Name | Result |\n| --- | --- |\n| Readable | Yes |\n\n$$x^2 + y^2 = z^2$$\n\n```js\nconst readable = true;\n```\n\n'+Array.from({length:60},(_,i)=>'Readable paragraph '+i+'.').join('\n\n');
 const formats=[{id:'result-synthetic-markdown',title:'合成阅读说明.md',mime:'text/markdown',bytes:Buffer.from(markdown)},{id:'result-synthetic-png',title:'合成条纹.png',mime:'image/png',bytes:png()},{id:'result-synthetic-pdf',title:'合成阅读.pdf',mime:'application/pdf',bytes:pdf()},{id:'result-synthetic-retry',title:'合成重试.txt',mime:'text/plain',bytes:Buffer.from('Synthetic retry succeeded')},{id:'result-synthetic-opaque',title:'合成不支持.bin',mime:'application/octet-stream',bytes:Buffer.from([0,1])}];
 let failNext='';const reads=[],revealCalls=[];
 f.bridge.revealArtifact=async id=>{revealCalls.push(id);throw Error('unexpected_reveal');};
 const read=f.bridge.artifact.bind(f.bridge);
 f.bridge.artifact=async id=>{reads.push(id);if(failNext===id){failNext='';throw Error('synthetic_read_failure');}const item=formats.find(item=>item.id===id);return item?{filename:item.title,mime:item.mime,data:item.bytes.toString('base64')}:read(id);};
 for(const owner of [f.bridge,f.bridge.history]){const state=owner.state.bind(owner);owner.state=async()=>{const value=await state();return {...value,artifacts:[...(value.artifacts??[]),...formats.map(({id,title})=>({id,title,messageId:'node-49',workTitle:'Synthetic formats'}))]};};}
 chrome=await isolatedChrome(destination);
 for(const width of [1440,390,320]){
  const p=await chrome.page(f.server.url,width),evaluate=code=>p.evaluate(code);
  const click=async selector=>{const r=await evaluate(`document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().toJSON()`);const x=r.left+r.width/2,y=r.top+r.height/2;await p.command('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});await p.command('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1});};
  const select=async id=>{
   if(width<=800&&await evaluate(()=>!!document.querySelector('#canvas-panel'))){await click('.canvas-collapse, .conversation-header [aria-controls=canvas-panel][aria-expanded=true]:not([aria-hidden=true] *)');await p.until(()=>!document.querySelector('#canvas-panel'));}
   const title=formats.find(file=>file.id===id)?.title??'synthetic-preview.html';
   await evaluate(`(()=>{const b=[...document.querySelectorAll('.file-list-open')].find(b=>b.getAttribute('aria-label')===${JSON.stringify('预览 '+title)});if(!b)throw Error('missing chat file');b.scrollIntoView({block:'center'});b.focus();b.click();})()`);
   await p.until(()=>!!document.querySelector('#canvas-panel'));
  };
  const removedActionsAbsent=async()=>{
   check(await evaluate(()=>!document.querySelector('#canvas-file,#canvas-locate,#canvas-reveal,.canvas-file-tools,.canvas-reveal')&&!Array.from(document.querySelectorAll('#canvas-panel a')).some(a=>a.textContent==='在新标签页打开')),'removed custom file actions are absent '+width);
   check(await evaluate(()=>Array.from(document.querySelectorAll('#canvas-panel .canvas-tools')).every(el=>el.querySelector('button,a'))),'no empty toolbar '+width);
  };
  // Sandboxed content is an OOPIF: inspect its own CDP session, never relax isolation.
  const frameEval=async expression=>{
   const {targetInfos}=await chrome.command('Target.getTargets');
   for(const target of targetInfos.filter(t=>t.type==='iframe'&&t.browserContextId===p.browserContextId)){
    const {sessionId}=await chrome.command('Target.attachToTarget',{targetId:target.targetId,flatten:true});
    try{
     const {frameTree}=await chrome.command('Page.getFrameTree',{},sessionId),frames=[];
     const visit=node=>{if(node.frame.url==='about:srcdoc')frames.push(node.frame);for(const child of node.childFrames??[])visit(child);};visit(frameTree);
     if(!frames.length)continue;
     const {executionContextId}=await chrome.command('Page.createIsolatedWorld',{frameId:frames.at(-1).id,worldName:'synthetic-canvas-inspection'},sessionId);
     const value=await chrome.command('Runtime.evaluate',{contextId:executionContextId,expression,returnByValue:true},sessionId);
     if(value.exceptionDetails)throw Error(value.exceptionDetails.text);return value.result.value;
    }finally{await chrome.command('Target.detachFromTarget',{sessionId});}
   }
  };
  try{
   await p.navigate();await p.until(()=>!!document.querySelector('.conversation-header [aria-controls="canvas-panel"]'));
   await p.until(()=>!!document.querySelector('[contenteditable=true]')&&!document.querySelector('.homer-composer-input[aria-disabled=true]'));
   await click('.conversation-header [aria-controls="canvas-panel"]');await p.until(()=>!!document.querySelector('#canvas-panel'));
   check(await evaluate(()=>!document.querySelector('#canvas-panel [data-slot="canvas-split-header"]')&&!!document.querySelector('.canvas-tab-bar')),'preview has a single navigation bar without a duplicate file header '+width);
   check(await evaluate(()=>!document.querySelector('.canvas-header')&&!/saved|editing|vundefined/.test(document.querySelector('.canvas-tab-bar').textContent)),'navigation has no invented version/save state '+width);
   await p.until(()=>document.activeElement===document.querySelector('.canvas-collapse'),3000);
   check(await evaluate(()=>document.activeElement===document.querySelector('.canvas-collapse')),'empty preview focuses collapse control '+width);
   const dimensions=await evaluate(()=>{const panel=document.querySelector('#canvas-panel'),button=document.querySelector('.canvas-collapse');return {overflow:document.documentElement.scrollWidth>innerWidth,width:panel.getBoundingClientRect().width,modal:panel.getAttribute('aria-modal')==='true',target:button.getBoundingClientRect().height};});
   check(!dimensions.overflow&&dimensions.target===(width<=800?44:28)&&dimensions.modal===(width<=800),'preview collapse uses 28px desktop / 44px mobile targets and Base UI modal modes '+width);
   check(await evaluate(()=>!document.querySelector('#canvas-address,.canvas-url')),'no manual URL entry '+width);
   await removedActionsAbsent();
   check(await evaluate(()=>document.querySelector('#canvas-panel').textContent.includes('从对话中选择')),'empty preview directs selection from chat '+width);
   await select('result-synthetic-markdown');await p.until(()=>!!document.querySelector('.canvas-markdown .katex'));
   check(await evaluate(()=>!!document.querySelector('.canvas-markdown table')&&!!document.querySelector('.canvas-markdown .code-block')),'Markdown table, math and code readable '+width);
   await removedActionsAbsent();
   const before=await evaluate(()=>document.querySelector('.canvas-collapse, .conversation-header [aria-controls=canvas-panel][aria-expanded=true]:not([aria-hidden=true] *)').getBoundingClientRect().y);
   await evaluate(()=>document.querySelector('[data-slot="canvas-split-body"]').scrollTop=600);
   check(Math.abs(before-await evaluate(()=>document.querySelector('.canvas-collapse, .conversation-header [aria-controls=canvas-panel][aria-expanded=true]:not([aria-hidden=true] *)').getBoundingClientRect().y))<1,'official header remains reachable while document scrolls '+width);
   await evaluate(()=>document.querySelector('[data-slot="canvas-split-body"]').scrollTop=0);await p.screenshot('canvas-markdown-'+width+'.png');
   await select('result-synthetic-png');await p.until(()=>{const img=document.querySelector('#canvas-panel [data-slot="image-preview"] img');return !!img&&img.complete&&img.naturalWidth===240;});
   await removedActionsAbsent();
   await p.screenshot('canvas-image-'+width+'.png');checks.push('authorized image decoded at original dimensions '+width);
   await select('result-synthetic-pdf');await p.until(()=>!!document.querySelector('iframe[title="PDF 成果"]'));
   await removedActionsAbsent();
   check(await evaluate(()=>document.querySelector('iframe[title="PDF 成果"]').src.startsWith('blob:')),'PDF uses authorized object URL '+width);
   await evaluate(()=>new Promise(done=>setTimeout(done,500)));await p.screenshot('canvas-pdf-'+width+'.png');
   await select('result-synthetic-opaque');await p.until(()=>document.querySelector('#canvas-panel')?.textContent.includes('此格式暂不支持在线预览'));
   await removedActionsAbsent();checks.push('unsupported format remains accurately visible '+width);
   failNext='result-synthetic-retry';await select(failNext);await p.until(()=>!!document.querySelector('#canvas-panel [role="alert"]'));
   check(await evaluate(()=>!document.querySelector('#canvas-panel [data-preview-text]')),'read failure does not retain a previous preview '+width);
   await evaluate(()=>Array.from(document.querySelectorAll('#canvas-panel button')).find(b=>b.textContent==='重试读取').click());
   await p.until(()=>document.querySelector('#canvas-panel pre')?.textContent==='Synthetic retry succeeded');await removedActionsAbsent();
   check(reads.slice(-2).every(id=>id==='result-synthetic-retry'),'retry requests the exact same file '+width);
   await p.screenshot('canvas-retry-'+width+'.png');
   await click('.canvas-collapse, .conversation-header [aria-controls=canvas-panel][aria-expanded=true]:not([aria-hidden=true] *)');await p.until(()=>!document.querySelector('#canvas-panel'));
   await p.until(()=>document.activeElement?.getAttribute('aria-label')==='预览 合成重试.txt');
   await p.command('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'});
   await p.command('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
   await p.until(()=>document.querySelector('#canvas-panel pre')?.textContent==='Synthetic retry succeeded');
   await p.until(()=>document.activeElement===document.querySelector('[role=tab][aria-selected=true]'));
   await p.command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
   await p.command('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
   await p.until(()=>!document.querySelector('#canvas-panel'));await p.until(()=>document.activeElement?.getAttribute('aria-label')==='预览 合成重试.txt');
   checks.push('keyboard Enter opens chat file and Escape restores that file entry '+width);
   await select(result.resultId);await p.until(()=>!!document.querySelector('iframe[title="隔离 HTML 成果"]'));
   check(await evaluate(()=>document.querySelector('#canvas-panel iframe').getAttribute('sandbox')===''),'HTML defaults to static rendered webpage '+width);
   let staticReady=false;for(let i=0;i<100;i++){staticReady=await frameEval('document.body?.textContent.includes("Isolated synthetic HTML")&&document.body.dataset.executed===undefined');if(staticReady)break;await new Promise(done=>setTimeout(done,20));}
   check(staticReady,'static HTML never executes script '+width);
   await evaluate(()=>document.querySelector('.html-annotation-toggle').click());
   let ran=false;for(let i=0;i<150;i++){ran=await frameEval('document.body?.dataset.executed==="yes"');if(ran)break;await new Promise(done=>setTimeout(done,20));}
   check(ran,'HTML executes only after explicit interaction action '+width);
   let networkBlocked=false;for(let i=0;i<100;i++){networkBlocked=await frameEval('document.body?.dataset.networkBlocked==="yes"');if(networkBlocked)break;await new Promise(done=>setTimeout(done,20));}
   check(networkBlocked,'interactive network is blocked by effective connect-src CSP '+width);
   check(await frameEval('(()=>{try{return !!parent.document}catch{return false}})()')===false,'interactive frame cannot access parent DOM '+width);
   await p.until(()=>document.querySelector('.html-annotation-toggle')?.getAttribute('aria-pressed')==='true');
   check(await frameEval('!!document.querySelector("agentation-toolbar")'),'explicit annotation loads native selection toolbar '+width);
   check(await evaluate(()=>document.body.dataset.escaped===undefined),'HTML cannot alter host '+width);
   await p.screenshot('canvas-interactive-'+width+'.png');
   await click('.canvas-collapse, .conversation-header [aria-controls=canvas-panel][aria-expanded=true]:not([aria-hidden=true] *)');await p.until(()=>!document.querySelector('#canvas-panel'));
   await p.until(()=>document.activeElement?.getAttribute('aria-label')==='预览 synthetic-preview.html');
   check(await evaluate(()=>document.activeElement?.getAttribute('aria-label')==='预览 synthetic-preview.html'),'closing restores chat file focus '+width);
   assert.deepEqual(p.errors,[]);assert.deepEqual(p.blocked,[]);
  }catch(error){console.error(JSON.stringify({errors:p.errors,blocked:p.blocked,active:await evaluate(()=>document.activeElement?.outerHTML.slice(0,500)),close:await evaluate(()=>({disabled:document.querySelector('.canvas-collapse, .conversation-header [aria-controls=canvas-panel][aria-expanded=true]:not([aria-hidden=true] *)')?.disabled,inert:!!document.querySelector('.canvas-collapse, .conversation-header [aria-controls=canvas-panel][aria-expanded=true]:not([aria-hidden=true] *)')?.closest('[inert]')}))}));await p.screenshot('failure-'+width+'.png');throw error;}finally{await p.close();}
 }
 assert.deepEqual(revealCalls,[]);assert.deepEqual(f.submitted,[]);writeFileSync(join(destination,'browser-results.json'),JSON.stringify({passed:true,checks,browser:chrome.version},null,2));
 console.log(JSON.stringify({passed:true,checks:checks.length}));
}finally{try{await chrome?.close();}finally{await f.close();}}
