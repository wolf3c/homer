// Product UI + real synthetic HTTP/queue. No production port, account or model.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fixture} from './web-history-followup-fixture.mjs';
import {isolatedChrome} from './web-history-browser-cdp.mjs';
import {actualClick,inspectHtmlFrame} from './helpers/html-preview-browser.mjs';
const destination=resolve(process.env.HOMER_REVIEW_EVIDENCE_ROOT??'.codex/scratch/html-preview-product-integration-20261024/browser');mkdirSync(destination,{recursive:true});
const f=await fixture(4,'after'),checks=[];let chrome;
const html='<!doctype html><html><head><style>body{margin:0;padding:28px;font:17px system-ui;background:#fafaf9;color:#252525}h1{font-size:30px}h2{font-size:22px}button{padding:12px}</style></head><body><h1>周末小计划</h1><p>上午散步，下午阅读。</p><h2>给自己留一点时间</h2><button id="counter">计数 0</button><script>document.body.dataset.executed="yes";document.querySelector("#counter").onclick=()=>document.querySelector("#counter").textContent="计数 1";fetch("https://network-disabled.invalid/private").catch(()=>{});</script></body></html>';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const filename='周末计划-'+'窄屏截断长标题'.repeat(7)+'-weekend-plan.html';

try{
 const sent=f.attach('合成 HTML 成果',[{filename,mime:'text/html',content:html}]);
 chrome=await isolatedChrome(destination);
 for(const width of [1440,390,320]){
  const p=await chrome.page(f.server.url,width),ev=x=>p.evaluate(x);let frame;
  const check=(label,value)=>{assert.ok(value,label);checks.push({width,label});console.log(width,label);};
  const click=async selector=>actualClick(p,await ev(`document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().toJSON()`));
  const open=async()=>{await p.until(`!![...document.querySelectorAll('.file-list-open')].find(b=>b.getAttribute('aria-label')===${JSON.stringify('预览 '+filename)})`);await ev(`[...document.querySelectorAll('.file-list-open')].find(b=>b.getAttribute('aria-label')===${JSON.stringify('预览 '+filename)}).click()`);await p.until(()=>!!document.querySelector('iframe[title="隔离 HTML 成果"]'));};
  const activate=async(keyboard=false)=>{if(keyboard){await ev(()=>document.querySelector('.html-annotation-toggle').focus());await p.command('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',windowsVirtualKeyCode:32});await p.command('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});}else await click('.html-annotation-toggle');await p.until(()=>document.querySelector('.html-annotation-toggle')?.getAttribute('aria-pressed')==='true',15000);frame=await inspectHtmlFrame(chrome,p,'!!document.querySelector("agentation-toolbar")?.shadowRoot');};
  const frameClick=async selector=>{const inner=await frame.evaluate(`__q(${JSON.stringify(selector)}).getBoundingClientRect().toJSON()`),outer=await ev(()=>document.querySelector('iframe[title="隔离 HTML 成果"]').getBoundingClientRect().toJSON());await actualClick(p,{...inner,x:outer.x+inner.x,y:outer.y+inner.y});};
  try{
   await p.navigate();await p.until(()=>!!document.querySelector('[contenteditable=true]'));
   check('ordinary chat does not load annotation chunks',!p.requests.some(r=>/\/assets\/(?:runtime|image-annotation)-.*\.js/.test(r.path)));
   await ev(()=>document.querySelector('[contenteditable=true]').focus());await p.command('Input.insertText',{text:'保留原草稿正文'});
   await open();frame=await inspectHtmlFrame(chrome,p,'!!document.querySelector("h1")');
   check('open renders actual h1 with no scripts or network',await frame.evaluate('document.querySelector("h1").textContent==="周末小计划"&&!document.body.dataset.executed&&document.scripts.length===0'));
   check('default opaque sandbox and no source block',await ev(()=>document.querySelector('iframe[title="隔离 HTML 成果"]').getAttribute('sandbox')===''&&!document.querySelector('[data-preview-text]')));
   check('static reading does not load annotation chunk',!p.requests.some(r=>/\/assets\/runtime-.*\.js/.test(r.path)));
   const geometry=await ev(()=>{const b=document.querySelector('.html-annotation-toggle'),s=getComputedStyle(b),r=b.getBoundingClientRect(),icon=b.querySelector('svg').getBoundingClientRect();return {height:r.height,padding:s.paddingLeft,gap:s.gap,radius:s.borderRadius,font:s.fontSize,icon:[icon.width,icon.height],fits:r.width>icon.width&&r.right<=innerWidth};});
   writeFileSync(join(destination,'header-geometry-'+width+'.json'),JSON.stringify(geometry,null,2));
   assert.deepEqual(geometry,{height:width<=800?44:28,padding:'8px',gap:'5px',radius:'7px',font:'12px',icon:[14,14],fits:true});
   check('HTML annotation retains the same compact image-button geometry',true);
   check('HTML has no source or return control',await ev(()=>!document.querySelector('[aria-label="查看 HTML 源码"],[aria-label="返回静态网页预览"]')&&document.querySelector('.html-preview-actions').querySelectorAll('button').length===1));
   check('long title truncates without compressing actions',await ev(()=>{const h=document.querySelector('.canvas-tab-bar'),t=h.querySelector('[role=tab][aria-selected=true]>span');return t.scrollWidth>t.clientWidth&&getComputedStyle(t).textOverflow==='ellipsis'&&h.scrollWidth<=h.clientWidth&&document.documentElement.scrollWidth<=innerWidth;}));
   await ev(()=>document.querySelector('.canvas-collapse, .conversation-header [aria-controls=canvas-panel][aria-expanded=true]:not([aria-hidden=true] *)').focus());
   for(const type of ['keyDown','keyUp'])await p.command('Input.dispatchKeyEvent',{type,key:'Tab',code:'Tab',windowsVirtualKeyCode:9,modifiers:8});
   await p.until(()=>{const b=document.querySelector('.html-annotation-toggle'),s=getComputedStyle(b);return document.activeElement===b&&s.outlineOffset==='2px';},3000);
   writeFileSync(join(destination,'keyboard-'+width+'.json'),JSON.stringify(await ev(()=>{const b=document.querySelector('.html-annotation-toggle'),s=getComputedStyle(b);return {active:document.activeElement?.outerHTML,focused:document.activeElement===b,visible:b.matches(':focus-visible'),outline:s.outline,offset:s.outlineOffset};}),null,2));
   check('keyboard Tab reaches annotation with a visible focus ring',await ev(()=>{const b=document.querySelector('.html-annotation-toggle'),s=getComputedStyle(b);return document.activeElement===b&&b.matches(':focus-visible')&&s.outlineWidth==='2px'&&s.outlineStyle==='solid'&&s.outlineOffset==='2px';}));
   await p.screenshot('default-'+width+'.png');await frame.close();frame=null;
   const toggle=await ev(()=>document.querySelector('.html-annotation-toggle').getBoundingClientRect().toJSON());await p.command('Input.dispatchMouseEvent',{type:'mouseMoved',x:toggle.x+toggle.width/2,y:toggle.y+toggle.height/2});await p.until(()=>document.querySelector('[data-slot=tooltip-content]')?.textContent.includes('将运行当前网页脚本'));
   check('tooltip and aria explain script execution inside current Dialog without overflowing viewport',await ev(()=>{const t=document.querySelector('[data-slot=tooltip-content]'),r=t.getBoundingClientRect();return document.querySelector('.html-annotation-toggle').getAttribute('aria-label').includes('将运行当前网页脚本')&&!!t.closest('#canvas-panel')&&t.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))&&r.left>=0&&r.right<=innerWidth;}));await p.screenshot('tooltip-'+width+'.png');
   if(width===1440){
    const separator=await ev(()=>document.querySelector('.preview-separator').getBoundingClientRect().toJSON());
    await ev(()=>{window.__staticFrame=document.querySelector('iframe[title="隔离 HTML 成果"]');});
    const drag=async(from,to)=>{await p.command('Input.dispatchMouseEvent',{type:'mouseMoved',x:from,y:450});await p.command('Input.dispatchMouseEvent',{type:'mousePressed',x:from,y:450,button:'left',clickCount:1});for(let n=1;n<=8;n++)await p.command('Input.dispatchMouseEvent',{type:'mouseMoved',x:from+(to-from)*n/8,y:450,buttons:1,button:'left'});await p.command('Input.dispatchMouseEvent',{type:'mouseReleased',x:to,y:450,button:'left',clickCount:1});await sleep(100);};
    await drag(separator.x+separator.width/2,1050);
    check('actual split drag preserves static frame and readable header actions',await ev(()=>{const h=document.querySelector('.canvas-tab-bar'),b=document.querySelector('.html-annotation-toggle'),s=b.querySelector('svg').getBoundingClientRect();return window.__staticFrame===document.querySelector('iframe[title="隔离 HTML 成果"]')&&h.getBoundingClientRect().width<420&&h.scrollWidth<=h.clientWidth&&b.getBoundingClientRect().height===28&&s.width===14&&s.height===14;}));
    await p.screenshot('dragged-header-'+width+'.png');
    const current=await ev(()=>document.querySelector('.preview-separator').getBoundingClientRect().x);
    await drag(current,separator.x+separator.width/2);
   }
   check('rendered scripts never mount in main app',await ev(()=>!document.body.dataset.executed&&!document.querySelector('[data-preview-text]')));
   const before=f.submitted.length;await activate();
   check('one title click confirms active without a native Start click',await frame.evaluate('!!__q("[aria-label=Exit]")&&!__q("[aria-label^=Start]")&&document.querySelectorAll("agentation-toolbar").length===1&&document.body.dataset.executed==="yes"'));
   check('scripts stay opaque and CSP disables network',await frame.evaluate(`(()=>{let readable=false;try{readable=!!parent.document}catch{}return !readable&&document.querySelector('meta[http-equiv]').content.includes("connect-src 'none'")})()`));
   await frameClick('h1');await frame.until('!!__q("textarea[placeholder^=What]")');await sleep(300);await p.screenshot('one-click-popup-'+width+'.png');
   await frameClick('textarea[placeholder^=What]');await chrome.command('Input.insertText',{text:'把主标题加大'},frame.sessionId);
   // Original Add/Cancel and form owner; no native launcher invocation.
   await frame.evaluate('window.__add=__all("button").find(b=>b.textContent==="Add");__add.setAttribute("data-test-native-add","")');await frameClick('[data-test-native-add]');await frame.until('!__q("textarea[placeholder^=What]")');
   await frameClick('h2');await frame.until('!!__q("textarea[placeholder^=What]")');await sleep(300);await frameClick('textarea[placeholder^=What]');await chrome.command('Input.insertText',{text:'保留副标题，增加间距'},frame.sessionId);await frame.evaluate('__all("button").find(b=>b.textContent==="Add").setAttribute("data-test-native-add","")');await frameClick('[data-test-native-add]');await frame.until('!__q("textarea[placeholder^=What]")');
   check('saving notes does not send a message',f.submitted.length===before);
   await frameClick('[aria-label="Pause animations"]');check('native Pause does not leave active selection',await ev(()=>document.querySelector('.html-annotation-toggle').getAttribute('aria-pressed')==='true'));
   await frameClick('[aria-label=Exit]');await p.until(()=>document.querySelector('iframe[title="隔离 HTML 成果"]')?.getAttribute('sandbox')==='');await frame.close();frame=null;
   check('native Exit destroys runtime and keeps saved notes',await ev(()=>document.querySelector('.html-notes-status')?.textContent.includes('2 条')&&document.querySelector('.html-annotation-toggle').getAttribute('aria-pressed')==='false'));
   await click('.canvas-collapse, .conversation-header [aria-controls=canvas-panel][aria-expanded=true]:not([aria-hidden=true] *)');await p.until(()=>!document.querySelector('#canvas-panel'));await open();
   check('reopen stays static with saved notes',await ev(()=>document.querySelector('iframe[title="隔离 HTML 成果"]').getAttribute('sandbox')===''&&document.querySelector('.html-notes-status')?.textContent.includes('2 条')));
   await activate(true);check('Space activates the same current document with no native Start',await ev(()=>document.querySelector('.html-annotation-toggle').getAttribute('aria-pressed')==='true'));await frame.until('__all("[data-annotation-marker]").length===2||!!__q("[aria-label^=Send]:not(:disabled)")');
   await frameClick('[aria-label^=Send]');await p.until(()=>document.querySelector('.composer-area .preview-reference')?.textContent.includes('把主标题加大')&&document.querySelector('.composer-area .preview-reference')?.textContent.includes('增加间距'));
   if(width<=800)await p.until(()=>!document.querySelector('#canvas-panel'));
   check('native onSubmit imports both notes to original draft and keeps body',await ev(()=>document.querySelector('[contenteditable=true]').textContent.includes('保留原草稿正文'))&&f.submitted.length===before);
   await p.command('Input.insertText',{text:'，聚焦原输入框'});await p.until(()=>document.querySelector('[contenteditable=true]').textContent.includes('聚焦原输入框'));
   check('unified import focuses original Lexical without jump',await ev(()=>document.activeElement?.matches('[contenteditable=true]')&&document.documentElement.scrollHeight-document.documentElement.clientHeight===0&&document.querySelector('.composer-area').getBoundingClientRect().bottom<=innerHeight));
   await p.screenshot('composer-'+width+'.png');
   await click('.send-button');await p.until(()=>!document.querySelector('.composer-area .preview-reference'));for(let n=0;n<150&&f.submitted.length===before;n++)await sleep(40);
   assert.equal(f.submitted.length,before+1);const input=f.inputs.list().find(x=>x.input.requestId===f.submitted.at(-1)).input;
   check('real HTTP main queue retains artifact identity, hash, both comments and body',input.resourceReference.kind==='web'&&input.resourceReference.source.messageId===sent.messageId&&input.resourceReference.source.assetId===sent.attachments[0].assetId&&input.resourceReference.annotations.length===2&&input.text.includes('聚焦原输入框'));
   assert.equal(input.resourceReference.source.sha256,createHash('sha256').update(html).digest('hex'));assert.deepEqual(input.resourceReference.annotations.map(n=>n.comment),['把主标题加大','保留副标题，增加间距']);
   if(width>800){await frame.close();frame=null;await click('.html-annotation-toggle');await click('.canvas-collapse, .conversation-header [aria-controls=canvas-panel][aria-expanded=true]:not([aria-hidden=true] *)');await p.until(()=>!document.querySelector('#canvas-panel'));}
   check('header and page have no horizontal overflow',await ev(()=>document.documentElement.scrollWidth<=innerWidth));
   check('no application exceptions or escaped network requests',p.errors.length===0&&p.blocked.length===0);
  }catch(error){await p.screenshot('failure-'+width+'.png');writeFileSync(join(destination,'failure-'+width+'.json'),JSON.stringify({error:String(error.stack),checks,errors:p.errors,blocked:p.blocked,body:await ev(()=>document.body.innerText)},null,2));throw error;}
  finally{try{await frame?.close();}catch{}await p.close();}
 }
 writeFileSync(join(destination,'browser-results.json'),JSON.stringify({passed:true,syntheticOnly:true,checks,browser:chrome.version,nativeStartClicks:0},null,2));console.log(JSON.stringify({passed:true,checks:checks.length}));
}finally{await chrome?.close();await f.close();}
