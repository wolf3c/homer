// Requirement-derived synthetic UI regression. Real HomerApp, random local HTTP
// port, fake engine and a fresh Chrome profile; no installed app or account.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {fixture} from './web-history-followup-fixture.mjs';
import {isolatedChrome} from './web-history-browser-cdp.mjs';
import {actualClick,inspectHtmlFrame} from './helpers/html-preview-browser.mjs';

const destination=resolve(process.env.HOMER_REVIEW_EVIDENCE_ROOT??'.codex/scratch/preview-header-row-removal-20261025/browser');
mkdirSync(destination,{recursive:true});
const baseline=!!process.env.HOMER_HEADER_BASELINE,checks=[],metrics=[];
const files=[
 {id:'result-header-text',title:'长中文文件名阅读与批注'.repeat(10)+'.txt',mime:'text/plain',text:'第一处中文。第二处中文。\n'+('阅读正文\n'.repeat(150))},
 {id:'result-header-html',title:'long-ascii-file-name-'.repeat(10)+'.html',mime:'text/html',text:'<!doctype html><style>body{font:18px system-ui;padding:20px}h1{padding:20px}</style><h1>合成网页标题</h1><script>document.body.dataset.executed="yes"</script>'},
 {id:'result-header-unsupported',title:'不支持格式.bin',mime:'application/octet-stream',text:'unsupported'},
];
const f=await fixture(4,'after');let chrome;
f.bridge.artifact=async id=>{const file=files.find(x=>x.id===id);assert.ok(file);return {filename:file.title,mime:file.mime,data:Buffer.from(file.text).toString('base64'),sha256:createHash('sha256').update(file.text).digest('hex')};};
for(const owner of [f.bridge,f.bridge.history]){const state=owner.state.bind(owner);owner.state=async()=>{const value=await state();return {...value,artifacts:[...(value.artifacts??[]),...files.map(({id,title})=>({id,title,messageId:'node-3',workTitle:'Synthetic header'}))]};};}
const delay=ms=>new Promise(done=>setTimeout(done,ms));
try{
 chrome=await isolatedChrome(destination);
 for(const width of [1440,390,320]){
  const p=await chrome.page(f.server.url,width),ev=x=>p.evaluate(x),until=x=>p.until(x,10000);let frame;
  const record=label=>{checks.push({width,label});console.log(width,label);};
  const click=async selector=>actualClick(p,await ev(`document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().toJSON()`));
  const tab=index=>`[...document.querySelectorAll('[role=tab]')].find(t=>t.title.endsWith(${JSON.stringify(' · '+files[index].id)}))`;
  const open=async index=>{await ev(`document.querySelector('.file-list-open[aria-label='+CSS.escape(${JSON.stringify('预览 '+files[index].title)})+']').click()`);await until(()=>!!document.querySelector('#canvas-panel'));await until(index===0?()=>!!document.querySelector('[data-preview-text]'):index===1?()=>!!document.querySelector('.html-annotation-toggle'):()=>document.querySelector('#canvas-panel')?.textContent.includes('此格式暂不支持'));};
  const toggle=()=>width<=800?'.canvas-collapse':'.conversation-header [aria-controls="canvas-panel"]';
  const collapse=async()=>{await click(toggle());await until(()=>!document.querySelector('#canvas-panel'));};
  const reopen=async()=>{await click('.conversation-header [aria-controls="canvas-panel"]');await until(()=>!!document.querySelector('#canvas-panel'));};
  const key=async(key,code,n,modifiers=0)=>{for(const type of ['keyDown','keyUp'])await p.command('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode:n,modifiers});};
  const geometry=()=>ev(()=>{const q=s=>document.querySelector(s)?.getBoundingClientRect().toJSON();return {panel:q('#canvas-panel'),rail:q('.canvas-tab-rail'),body:q('[data-slot=canvas-split-body]'),oldHeader:q('[data-slot=canvas-split-header]'),bar:q('.canvas-tab-bar'),overflow:document.documentElement.scrollWidth-innerWidth,scroll:document.querySelector('.thread-viewport').scrollTop,composer:q('.composer-area')};});
  try{
   await p.navigate();await until(()=>!!document.querySelector('[contenteditable=true]'));
   await open(0);const m=await geometry();metrics.push({width,kind:'text',...m});
   if(baseline){
    assert.ok(m.oldHeader);await p.screenshot('before-'+width+'.png');
    if(width<=800){assert.equal(await ev(()=>!!document.querySelector('.conversation-header').closest('[aria-hidden=true],[inert]')),true);record('original global preview toggle is inside the modal background');}
    continue;
   }
   assert.equal(await ev(()=>!!document.querySelector('[data-slot=canvas-split-header],#canvas-close')),false);
   assert.equal(m.body.top-m.panel.top,m.bar.height);
   // A normal future run needs no ignored baseline artifact. When explicitly
   // captured, also verify the measured before/after CSS-pixel gain.
   if(existsSync(join(destination,'baseline.json'))){const old=JSON.parse(readFileSync(join(destination,'baseline.json'),'utf8')).metrics.find(x=>x.width===width&&x.kind==='text');const gain=(old.body.top-old.panel.top)-(m.body.top-m.panel.top);assert.equal(gain,old.oldHeader.height);metrics.push({width,kind:'gain',cssPixels:gain});}
   assert.equal(m.overflow,0);assert.equal(await ev(`document.activeElement===(${tab(0)})`),true);
   assert.equal(await ev(()=>document.querySelectorAll('.canvas-collapse').length),width<=800?1:0);
   assert.equal(await ev(()=>document.querySelector('.canvas-tab-actions').childElementCount),0);
   record('duplicate header removed, exact body gain measured, text has no annotation mode row');
   if(width<=800){
    assert.equal(await ev(()=>!!document.querySelector('.conversation-header').closest('[aria-hidden=true],[inert]')),true);
    await ev(()=>document.querySelector('.canvas-collapse').focus());
    for(let n=0;n<12;n++){await key('Tab','Tab',9);await p.until(()=>!!document.activeElement.closest('#canvas-panel'),1000);}
    await ev(()=>document.querySelector('.canvas-collapse').focus());await key('Tab','Tab',9,8);await p.until(()=>!!document.activeElement.closest('#canvas-panel'),1000);
    record('mobile collapse is reachable inside a trapped modal while the background stays isolated');
   }
   await p.screenshot('preview-'+width+'.png');
   const beforeCollapse=await geometry();await collapse();await until(()=>!document.querySelector('.conversation-header').closest('[aria-hidden=true],[inert]'));
   assert.equal(await ev(()=>document.querySelectorAll('.canvas-backdrop,[inert]').length),0);
   await reopen();await until(()=>!!document.querySelector('[data-preview-text]'));assert.equal(await ev(()=>document.querySelectorAll('[role=tab]').length),1);
   const afterReopen=await geometry();assert.ok(Math.abs(afterReopen.scroll-beforeCollapse.scroll)<=1);assert.ok(Math.abs(afterReopen.composer.bottom-beforeCollapse.composer.bottom)<=1);
   record('collapse keeps tabs and active file; history anchor and composer bottom stay stable');
   await open(1);await until(()=>!!document.querySelector('.html-annotation-toggle'));
   assert.equal(await ev(()=>{const b=document.querySelector('.html-annotation-toggle'),r=b.getBoundingClientRect(),i=b.querySelector('svg').getBoundingClientRect();return b.closest('.canvas-tab-actions')&&!b.closest('[role=tablist]')&&!b.closest('[role=tab]')&&r.height===(innerWidth<=800?44:28)&&i.width===14&&i.height===14;}),true);
   await ev(()=>{window.__frame=document.querySelector('iframe[title="隔离 HTML 成果"]');window.__actions=document.querySelector('.canvas-tab-actions');});
   await p.command('Network.enable');await p.command('Network.emulateNetworkConditions',{offline:false,latency:1200,downloadThroughput:-1,uploadThroughput:-1});
   await click('.html-annotation-toggle');await until(()=>document.querySelector('.html-annotation-toggle')?.getAttribute('aria-busy')==='true');await click('.html-annotation-toggle');
   await until(()=>document.querySelector('.html-annotation-toggle')?.getAttribute('aria-busy')==='false');await p.command('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});await delay(1400);
   assert.equal(await ev(()=>__frame===document.querySelector('iframe[title="隔离 HTML 成果"]')&&document.querySelector('iframe[title="隔离 HTML 成果"]').getAttribute('sandbox')===''),true);record('busy annotation action cancels loading and a late import leaves the original static document untouched');
   await click('.html-annotation-toggle');await until(()=>document.querySelector('.html-annotation-toggle').getAttribute('aria-pressed')==='true');
   frame=await inspectHtmlFrame(chrome,p,'!!document.querySelector("agentation-toolbar")?.shadowRoot');assert.equal(await frame.evaluate('document.body.dataset.executed'),'yes');
   await ev(()=>{window.__frame=document.querySelector('iframe[title="隔离 HTML 成果"]');});
   for(const w of width===1440?[390,320,801,1440]:[801,width]){await p.command('Emulation.setDeviceMetricsOverride',{width:w,height:900,deviceScaleFactor:1,mobile:false});await delay(100);assert.equal(await ev(()=>__frame===document.querySelector('iframe[title="隔离 HTML 成果"]')&&__actions===document.querySelector('.canvas-tab-actions')),true);}
   if(width===1440){
    await p.command('Emulation.setDeviceMetricsOverride',{width:1000,height:900,deviceScaleFactor:1,mobile:false});await delay(80);
    const r=await ev(()=>document.querySelector('.preview-separator').getBoundingClientRect().toJSON());
    await p.command('Input.dispatchMouseEvent',{type:'mousePressed',x:r.x+r.width/2,y:450,button:'left',clickCount:1});for(let n=1;n<=8;n++)await p.command('Input.dispatchMouseEvent',{type:'mouseMoved',x:r.x+(750-r.x)*n/8,y:450,button:'left',buttons:1});await p.command('Input.dispatchMouseEvent',{type:'mouseReleased',x:750,y:450,button:'left',clickCount:1});await delay(100);
    const narrow=await ev(()=>{const b=document.querySelector('.html-annotation-toggle'),r=b.getBoundingClientRect(),i=b.querySelector('svg').getBoundingClientRect(),rail=document.querySelector('.canvas-tab-rail'),t=document.querySelector('[role=tab][aria-selected=true]').parentElement;return {panel:document.querySelector('#canvas-panel').getBoundingClientRect().width,button:r.toJSON(),icon:i.toJSON(),rail:rail.getBoundingClientRect().toJSON(),tab:t.getBoundingClientRect().toJSON(),overflow:document.documentElement.scrollWidth-innerWidth,same:__frame===document.querySelector('iframe[title="隔离 HTML 成果"]')};});metrics.push({width,kind:'250-panel',...narrow});assert.ok(narrow.panel<=251);assert.equal(narrow.button.height,28);assert.equal(narrow.icon.width,14);assert.ok(narrow.tab.right<=narrow.rail.right+1);assert.equal(narrow.overflow,0);assert.equal(narrow.same,true);await p.screenshot('panel-250.png');
    await p.command('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});await delay(80);
   }
   record('HTML action is outside Tab/List; one click activates native selection; resizing preserves iframe and actions identity');
   await p.screenshot('html-'+width+'.png');
   await frame.evaluate('__all("button").find(b=>b.getAttribute("aria-label")?.startsWith("Exit")).click()');
   await until(()=>document.querySelector('iframe[title="隔离 HTML 成果"]').getAttribute('sandbox')==='');await frame.close();frame=undefined;
   await ev(`(${tab(0)}).click()`);await until(()=>!!document.querySelector('[data-preview-text]'));assert.equal(await ev(()=>!!document.querySelector('.html-annotation-toggle')),false);
   await open(2);assert.equal(await ev(()=>document.querySelector('.canvas-tab-actions').childElementCount),0);
   record('native Exit returns static; switching removes actions; unsupported formats add no action row');
   for(const index of [1,2,0])await ev(`(${tab(index)}).parentElement.querySelector('.canvas-tab-close').click()`);
   await until(()=>!document.querySelector('#canvas-panel'));await until(`document.activeElement?.getAttribute('aria-label')===${JSON.stringify('预览 '+files[0].title)}`);
   await reopen();assert.equal(await ev(()=>document.querySelectorAll('[role=tab]').length),0);assert.equal(await ev(()=>!!document.querySelector('[data-slot=canvas-split-header]')),false);
   if(width<=800){await until(()=>document.activeElement===document.querySelector('.canvas-collapse'));await collapse();}else{
    // Fallback initial focus can open the original collapse button's tooltip.
    // Escape dismisses that focused layer before the surrounding Dialog.
    await delay(80);if(await ev(()=>!!document.querySelector('[data-slot=tooltip-content]:not([data-closed])'))){await key('Escape','Escape',27);await until(()=>!document.querySelector('[data-slot=tooltip-content]:not([data-closed])'));assert.equal(await ev(()=>!!document.querySelector('#canvas-panel')),true);}
    await key('Escape','Escape',27);await until(()=>!document.querySelector('#canvas-panel'));
   }
   assert.equal(await ev(()=>document.querySelectorAll('.canvas-backdrop,[inert]').length),0);record('last tab returns to exact source; empty preview has an accessible exit and no duplicate header');
   assert.deepEqual(p.errors,[]);assert.deepEqual(p.blocked,[]);assert.equal(p.requests.filter(r=>r.path==='/api/messages').length,0);assert.equal(f.fakeEngine.invocations,0);
  }catch(error){await p.screenshot('failure-'+width+'.png');writeFileSync(join(destination,'failure-'+width+'.json'),JSON.stringify({error:String(error.stack),checks,metrics,errors:p.errors,body:await ev(()=>document.body.innerText)},null,2));throw error;}
  finally{await frame?.close();await p.close();}
 }
 writeFileSync(join(destination,baseline?'baseline.json':'results.json'),JSON.stringify({passed:true,baseline,checks,metrics,browser:chrome.version,modelCalls:f.fakeEngine.invocations},null,2));console.log(JSON.stringify({passed:true,baseline,checks:checks.length}));
}finally{await chrome?.close();await f.close();}
