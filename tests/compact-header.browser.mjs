// Requirement-derived regression: actual HomerApp and HTTP router, synthetic
// owners, random port, fresh Chrome. No installed application or account.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fixture} from './web-history-followup-fixture.mjs';
import {isolatedChrome} from './web-history-browser-cdp.mjs';
import {actualClick,inspectHtmlFrame} from './helpers/html-preview-browser.mjs';

const destination=resolve(process.env.HOMER_REVIEW_EVIDENCE_ROOT??'.codex/scratch/compact-header-implementation-20261025/browser');
mkdirSync(destination,{recursive:true});
const baseline=!!process.env.HOMER_COMPACT_BASELINE,checks=[],metrics=[];
const files=Array.from({length:10},(_,n)=>({id:'result-compact-'+n,title:(n%2?'continuous-ascii-name-':'长中文文件名阅读与批注').repeat(4)+n+(n===1?'.html':'.txt'),mime:n===1?'text/html':'text/plain',text:n===1?'<!doctype html><style>body{font:18px system-ui;padding:20px}</style><h1>合成网页标题</h1><script>document.body.dataset.executions=String(Number(document.body.dataset.executions||0)+1)</script>':'第一处中文。第二处中文。\n'+('阅读正文\n'.repeat(150))}));
const f=await fixture(100,'after');let chrome;
f.attach('Synthetic compact header',files.map(({title,mime,text})=>({filename:title,mime,content:text})));
{const owner=f.bridge.history;const state=owner.state.bind(owner);owner.state=async()=>{const v=await state();return {...v,features:{...v.features,taskOverview:true}};};}
const delay=ms=>new Promise(done=>setTimeout(done,ms));
try{
 chrome=await isolatedChrome(destination);
 for(const width of baseline?[1440,800]:[1440,390,320]){
  const p=await chrome.page(f.server.url,width),ev=x=>p.evaluate(x),until=x=>p.until(x,10000);let frame;
  const record=label=>{checks.push({width,label});console.log(width,label);};
  const click=async selector=>actualClick(p,await ev(`document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().toJSON()`));
  const key=async(key,code,n,modifiers=0)=>{for(const type of ['keyDown','keyUp'])await p.command('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode:n,modifiers});};
  const resize=async(w,extra={})=>{await p.command('Emulation.setDeviceMetricsOverride',{width:w,height:900,deviceScaleFactor:1,mobile:false,...extra});await delay(120);};
  const geometry=()=>ev(()=>{const r=s=>document.querySelector(s)?.getBoundingClientRect().toJSON();return {viewport:innerWidth,header:r('.conversation-header'),panel:r('#canvas-panel'),bar:r('.canvas-tab-bar'),body:r('[data-slot=canvas-split-body]'),workspace:r('.conversation-workspace'),aside:r('.status-aside-slot'),composer:r('.composer-area'),oldHeader:r('[data-slot=canvas-split-header]'),overflow:document.documentElement.scrollWidth-innerWidth,outerRange:document.documentElement.scrollHeight-innerHeight,scroll:document.querySelector('.thread-viewport').scrollTop};});
  const measure=async label=>{const m=await geometry();metrics.push({width,label,...m});return m;};
  const open=async index=>{await ev(`document.querySelector('.file-list-open[aria-label='+CSS.escape(${JSON.stringify('预览 '+files[index].title)})+']').click()`);await until(()=>!!document.querySelector('#canvas-panel'));await until(index===1?()=>!!document.querySelector('.html-annotation-toggle'):()=>!!document.querySelector('[data-preview-text]'));};
  const collapse=async()=>{await click(width<=800?'.canvas-collapse':'.conversation-header [aria-controls="canvas-panel"]');await until(()=>!document.querySelector('#canvas-panel'));};
  const assertLayout=m=>{const h=m.viewport<=800?52:44;assert.equal(m.header.height,h);assert.equal(m.overflow,0);assert.equal(m.outerRange,0);if(m.panel){assert.equal(m.bar.height,h);assert.equal(m.panel.top,m.viewport<=800?0:m.header.top);assert.equal(m.body.top-m.panel.top,h);assert.equal(m.oldHeader,undefined);}};
  try{
   await p.navigate();await until(()=>!!document.querySelector('[contenteditable=true]')&&!!document.querySelector('#task-status-trigger'));
   await until(()=>document.querySelector('.status-aside-slot').childElementCount>0||innerWidth<1120);
   const initial=await measure('no-preview');
   if(!baseline)assertLayout(initial);
   if(!baseline&&width===1440){
    assert.equal(initial.aside.width,320);await p.screenshot('no-preview-1440.png');
    await click('#task-status-trigger');await until(()=>document.querySelector('.status-aside-slot').childElementCount===0);
    f.server.publish();await resize(1024);await resize(1440);
    assert.equal(await ev(()=>document.querySelector('.status-aside-slot').childElementCount),0);
    await click('#task-status-trigger');await until(()=>document.querySelector('.status-aside-slot').childElementCount===1);
    assertLayout(await measure('status-only-1440'));await p.screenshot('status-only-1440.png');
    await delay(2200);const reads=p.requests.filter(r=>r.path==='/api/tasks').length;await delay(1200);assert.equal(p.requests.filter(r=>r.path==='/api/tasks').length,reads);
    record('1440 pinned summary honors explicit close across SSE/resize; reopening retains one owner and settled reads do not poll');
   }
   await open(0);const preview=await measure('one-text-preview');
   if(baseline){await p.screenshot('before-'+width+'.png');continue;}
   assertLayout(preview);assert.equal(await ev(()=>document.querySelectorAll('.canvas-collapse').length),width<=800?1:0);
   assert.equal(await ev(()=>[...document.querySelectorAll('.header-actions button')].filter(b=>b.getBoundingClientRect().height>0).every(b=>b.getBoundingClientRect().width===44&&b.getBoundingClientRect().height===44)),true);
   record('actual headers are 44/52px, desktop shares top boundary, one toolbar, no page overflow');
   await p.screenshot('preview-'+width+'.png');
   if(width===1440){
    await until(()=>document.querySelector('.status-aside-slot').childElementCount===0);
    await click('#task-status-trigger');await until(()=>!!document.querySelector('#task-status-panel'));
    assert.equal(await ev(()=>document.querySelector('#task-status-panel').closest('[role=dialog]')!==null),true);
    await key('Escape','Escape',27);await until(()=>!document.querySelector('#task-status-panel'));
    assert.equal(await ev(()=>document.activeElement.id==='task-status-trigger'&&!!document.querySelector('#canvas-panel')),true);
    await resize(2560);await until(()=>document.querySelector('.status-aside-slot').childElementCount===1);
    const wide=await measure('2560-status-preview');assertLayout(wide);assert.equal(wide.aside.width,320);assert.ok(wide.workspace.width>=1120);
    assert.equal(await ev(()=>document.querySelectorAll('#task-status-panel').length),1);await p.screenshot('preview-2560.png');
    await resize(1440);await until(()=>document.querySelector('.status-aside-slot').childElementCount===0);
    record('original workspace threshold yields 1440 popover and 2560 pinned status with one content owner');
   }
   const viewport=await ev(()=>document.querySelector('.thread-viewport').getBoundingClientRect().toJSON());
   // A real user gesture is required to leave the existing follow-latest mode.
   await p.command('Input.dispatchMouseEvent',{type:'mouseWheel',x:viewport.x+viewport.width/2,y:viewport.y+150,deltaX:0,deltaY:-300});await delay(250);
   const before=await measure('before-collapse');await collapse();await until(()=>!document.querySelector('.conversation-header').closest('[aria-hidden=true],[inert]'));
   await click('.conversation-header [aria-controls="canvas-panel"]');await until(()=>!!document.querySelector('[data-preview-text]'));
   await delay(200);const reopened=await measure('after-reopen');assert.ok(Math.abs(reopened.composer.bottom-before.composer.bottom)<=1);assert.ok(Math.abs(reopened.scroll-before.scroll)<=2,JSON.stringify({before:before.scroll,after:reopened.scroll}));
   assert.equal(await ev(()=>document.querySelectorAll('[role=tab]').length),1);
   record('global/mobile collapse keeps tabs, reading position and composer bottom');
   await open(1);await click('.html-annotation-toggle');await until(()=>document.querySelector('.html-annotation-toggle')?.getAttribute('aria-pressed')==='true');
   frame=await inspectHtmlFrame(chrome,p,'!!document.querySelector("agentation-toolbar")?.shadowRoot');
   assert.equal(await frame.evaluate('Number(document.body.dataset.executions)'),1);
   await ev(()=>{window.__compactFrame=document.querySelector('iframe[title="隔离 HTML 成果"]');window.__compactActions=document.querySelector('.canvas-tab-actions');window.__compactTab=document.querySelector('[role=tab][aria-selected=true]');});
   for(const w of [801,800,799,390,320,1440]){await resize(w);assertLayout(await measure('resize-'+w));assert.equal(await ev(()=>__compactFrame===document.querySelector('iframe[title="隔离 HTML 成果"]')&&__compactActions===document.querySelector('.canvas-tab-actions')&&__compactTab===document.querySelector('[role=tab][aria-selected=true]')),true);assert.equal(await frame.evaluate('Number(document.body.dataset.executions)'),1);}
   await resize(width);
   assert.deepEqual(await ev(()=>{const b=document.querySelector('.html-annotation-toggle'),r=b.getBoundingClientRect(),i=b.querySelector('svg').getBoundingClientRect();return [r.height,i.width,i.height,!!b.closest('[role=tablist]')];}),[width<=800?44:28,14,14,false]);
   record('active HTML frame, execution count, actions and tab retain identity across 801/800/799 and three screens');
   if(width<=800){
    assert.equal(await ev(()=>!!document.querySelector('.conversation-header').closest('[aria-hidden=true],[inert]')),true);
    await ev(()=>document.querySelector('.canvas-collapse').focus());for(let n=0;n<12;n++){await key('Tab','Tab',9);await until(()=>!!document.activeElement.closest('#canvas-panel'));}
    await p.screenshot('html-'+width+'.png');record('mobile 44px actions, trapped keyboard focus and isolated background');
   }else{
    await resize(1000);const r=await ev(()=>document.querySelector('.preview-separator').getBoundingClientRect().toJSON());
    await p.command('Input.dispatchMouseEvent',{type:'mousePressed',x:r.x,y:450,button:'left',clickCount:1});for(let n=1;n<=8;n++)await p.command('Input.dispatchMouseEvent',{type:'mouseMoved',x:r.x+(750-r.x)*n/8,y:450,buttons:1,button:'left'});await p.command('Input.dispatchMouseEvent',{type:'mouseReleased',x:750,y:450,button:'left',clickCount:1});await delay(120);
    const small=await measure('250-panel');assertLayout(small);assert.ok(small.panel.width<=251);assert.equal(await ev(()=>{const b=document.querySelector('.html-annotation-toggle'),s=b.querySelector('svg');return b.getBoundingClientRect().height===28&&s.getBoundingClientRect().width===14&&__compactFrame===document.querySelector('iframe[title="隔离 HTML 成果"]');}),true);await p.screenshot('panel-250.png');
    await resize(801);const sep=await ev(()=>document.querySelector('.preview-separator').getBoundingClientRect().toJSON());await p.command('Input.dispatchMouseEvent',{type:'mousePressed',x:sep.x,y:450,button:'left',clickCount:1});await p.command('Input.dispatchMouseEvent',{type:'mouseMoved',x:201,y:450,buttons:1,button:'left'});await p.command('Input.dispatchMouseEvent',{type:'mouseReleased',x:201,y:450,button:'left',clickCount:1});await delay(150);
    const left=await measure('200-left-panel');assertLayout(left);assert.ok(left.header.width<240);assert.equal(await ev(()=>getComputedStyle(document.querySelector('.header-brand-label')).display),'none');assert.equal(await ev(()=>[...document.querySelectorAll('.header-actions button')].filter(b=>b.getBoundingClientRect().width===44&&b.getBoundingClientRect().left>=0&&b.getBoundingClientRect().right<=document.querySelector('.conversation-header').getBoundingClientRect().right).length),3);await p.screenshot('left-200.png');
    await resize(1440);record('real divider supports 250px preview and 200px left header without losing controls or shrinking SVG');
   }
   await frame.close();frame=undefined;await resize(width);
   await click('.html-annotation-toggle');await until(()=>document.querySelector('.html-annotation-toggle')?.getAttribute('aria-pressed')==='false');
   for(let n=2;n<files.length;n++)await open(n);
   assertLayout(await measure('many-long-tabs'));assert.equal(await ev(()=>{const rail=document.querySelector('.canvas-tab-rail'),a=document.querySelector('[role=tab][aria-selected=true]').parentElement,r=rail.getBoundingClientRect(),t=a.getBoundingClientRect();return rail.scrollWidth>rail.clientWidth&&t.right<=r.right+1&&t.left>=r.left-1;}),true);
   await p.screenshot('long-tabs-'+width+'.png');
   await ev(()=>{const active=document.querySelector('[role=tab][aria-selected=true]');active.parentElement.querySelector('.canvas-tab-close').focus();active.parentElement.querySelector('.canvas-tab-close').click();});await until(()=>document.activeElement===document.querySelector('[role=tab][aria-selected=true]'));
   assert.equal(await ev(()=>document.querySelectorAll('[role=tab]').length),9);record('many Chinese/ASCII labels scroll only the rail; closing active file restores adjacent tab focus');
   if(width===1440){await p.command('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});assert.equal(await ev(()=>matchMedia('(pointer:coarse)').matches),true);await delay(80);const touch=await measure('coarse-pointer');assert.equal(touch.header.height,52);assert.equal(touch.bar.height,52);assert.equal(await ev(()=>document.querySelector('.canvas-tab-close').getBoundingClientRect().height),44);await p.screenshot('touch-1440.png');await p.command('Emulation.setTouchEmulationEnabled',{enabled:false});await resize(720,{deviceScaleFactor:2});assertLayout(await measure('200-percent-equivalent'));await p.screenshot('zoom-200-equivalent.png');record('coarse pointer 52px toolbar and 44px controls; 720 CSSpx/DPR2 equivalent reflow, not native zoom');}
   assert.deepEqual(p.errors,[]);assert.deepEqual(p.blocked,[]);assert.equal(p.requests.filter(r=>r.path==='/api/messages').length,0);assert.equal(f.fakeEngine.invocations,0);
  }catch(error){await p.screenshot('failure-'+width+'.png');writeFileSync(join(destination,'failure-'+width+'.json'),JSON.stringify({error:String(error.stack),checks,metrics,errors:p.errors},null,2));throw error;}
  finally{await frame?.close();await p.close();}
 }
 writeFileSync(join(destination,baseline?'baseline.json':'results.json'),JSON.stringify({passed:true,baseline,checks,metrics,browser:chrome.version,modelCalls:f.fakeEngine.invocations},null,2));console.log(JSON.stringify({passed:true,baseline,checks:checks.length}));
}finally{await chrome?.close();await f.close();}
