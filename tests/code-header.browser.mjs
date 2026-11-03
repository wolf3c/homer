// Requirement-derived code/math/diagram samples; in-memory transport only.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {composerFixture} from './fixtures/composer-browser-server.mjs';
import {isolatedChrome} from './web-history-browser-cdp.mjs';

const destination=resolve(process.env.HOMER_BROWSER_EVIDENCE??'.codex/scratch/code-header-20261023/browser');
const webDir=resolve(process.env.HOMER_COMPONENT_BUILD??'.codex/scratch/code-header-20261023/candidate-web');
mkdirSync(destination,{recursive:true});
const fixture=await composerFixture({webDir,beforeDir:webDir,branding:resolve('assets/branding/homer-river-stone-256.de41791ce5c1.png')});
const tsCode='const value = "<safe>";\nconsole.log(value);\n';
const plainCode='plain <safe> & text\nsecond line\n';
const diagram='graph TD\n  A[开始] --> B[完成]\n';
const markdown='正文含 `inline()`，公式 $a^2 + b^2$。\n\n```ts\n'+tsCode+'```\n\n```\n'+plainCode+'```\n\n```homer-unknown\nunknown syntax\n```\n\n```mermaid\n'+diagram+'```';
const message=(text,status='completed')=>({id:'code-message',role:'assistant',threadId:'composer-review',requestId:'code-request',text,status,createdAt:1700000000000});
let chrome;const checks=[];
async function key(page,key){await page.command('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,...(key==='Enter'?{text:'\r',windowsVirtualKeyCode:13}:{})});await page.command('Input.dispatchKeyEvent',{type:'keyUp',key,code:key});}
async function press(page,selector){await page.evaluate('document.querySelector('+JSON.stringify(selector)+').focus()');await key(page,'Enter');}
const copyButton='#message-code-message .aui-code-header-root [aria-label="复制代码"]';
try{
 chrome=await isolatedChrome(destination);
 for(const width of [1440,390,320]){
  fixture.reset({messages:[message(markdown)],features:{taskOverview:false,draftUpload:true}});
  const page=await chrome.page(fixture.url,width);
  const wait=predicate=>page.until('Boolean(('+String(predicate)+')())',10000);
  const check=async(label,predicate)=>{assert.ok(await page.evaluate(predicate),label);checks.push({width,label});};
  try{
   await page.command('Page.addScriptToEvaluateOnNewDocument',{source:`window.__copies=[];window.__copyMode='hold';Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText(text){window.__copies.push({text,active:navigator.userActivation.isActive});if(window.__copyMode==='hold')return new Promise((resolve,reject)=>window.__clipboard={resolve,reject});if(window.__copyMode==='fail')return Promise.reject(Error('synthetic_clipboard_denied'));return Promise.resolve();}}});`});
   await page.navigate();await wait(()=>!!document.querySelector('#message-code-message .markdown')&&!!document.querySelector('[contenteditable=true]'));
   await check('each block receives one CodeHeader; inline code receives none',()=>document.querySelectorAll('#message-code-message .aui-code-header-root').length===4&&document.querySelector('#message-code-message p code').textContent==='inline()');
   await check('language labels cover declared, plain and unknown languages',()=>[...document.querySelectorAll('.aui-code-header-language')].map(e=>e.textContent).join('|')==='ts|纯文本|homer-unknown|mermaid');
   await check('code copy has pinned 24px geometry and visible keyboard focus',()=>{const b=document.querySelector('.aui-code-header-root button');b.focus();const r=b.getBoundingClientRect();return r.width===24&&r.height===24&&getComputedStyle(b).outlineStyle!=='none';});
   await press(page,copyButton);
   await check('copy starts in user gesture and locks reentry',()=>window.__copies.length===1&&window.__copies[0].active&&document.querySelector('.aui-code-header-root button').disabled);
   assert.equal(await page.evaluate(()=>window.__copies[0].text),tsCode);
   await page.evaluate(()=>{document.querySelector('.aui-code-header-root button').click();window.__clipboard.reject(Error('synthetic_clipboard_denied'));});
   await wait(()=>document.querySelector('.aui-code-header-notice')?.textContent.includes('复制失败'));
   await check('clipboard rejection remains retryable without duplicate writes',()=>window.__copies.length===1&&!document.querySelector('.aui-code-header-root button').disabled);
   await page.evaluate(()=>window.__copyMode='success');await press(page,copyButton);
   await wait(()=>document.querySelector('.aui-code-header-root [role=status]')?.textContent==='已复制');
   await check('successful copy swaps to Check and leaves other block feedback unchanged',()=>!!document.querySelector('.aui-code-header-root .lucide-check')&&document.querySelectorAll('.aui-code-header-root .lucide-check').length===1);
   await page.evaluate(()=>document.querySelectorAll('.aui-code-header-root button')[1].focus());await key(page,'Enter');
   assert.equal(await page.evaluate(()=>window.__copies.at(-1).text),plainCode);checks.push({width,label:'plain code copies literal angle brackets, ampersands and newlines'});
   await wait(()=>!!document.querySelector('.mermaid-output svg'));
   await check('existing Highlight and KaTeX renderers remain active',()=>!!document.querySelector('.hljs-keyword')&&!!document.querySelector('.katex'));
   await page.evaluate(()=>document.querySelectorAll('.aui-code-header-root button')[3].focus());await key(page,'Enter');
   assert.equal(await page.evaluate(()=>window.__copies.at(-1).text),diagram);checks.push({width,label:'Mermaid copies source rather than SVG labels'});
   await page.command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
   await check('reduced motion disables code-header icon animation',()=>getComputedStyle(document.querySelector('.aui-code-header-root svg')).animationName==='none');
   await check('narrow code headers do not overflow the page',()=>document.documentElement.scrollWidth<=innerWidth&&[...document.querySelectorAll('.aui-code-header-root')].every(e=>e.getBoundingClientRect().right<=innerWidth));
   await page.evaluate(()=>document.querySelector('#message-code-message').scrollIntoView({block:'start'}));await page.screenshot('code-header-'+width+'.png');
   await press(page,'#message-code-message [data-slot="message-actions"] [aria-label="复制"]');
   assert.equal(await page.evaluate(()=>window.__copies.at(-1).text),markdown);checks.push({width,label:'message-level copy still copies the complete original Markdown'});
   await check('message actions expose only copy without creating a composer quote',()=>document.querySelectorAll('#message-code-message [data-slot="message-actions"] button').length===1&&!document.querySelector('[data-slot="composer-quote"]'));
   fixture.update({messages:[message('```ts\nconst changing = 1;','running')],isRunning:true,activeMessageId:'code-message'});
   await wait(()=>document.querySelector('.code-block')?.textContent.trimEnd()==='const changing = 1;');
   await page.evaluate(()=>window.__copyMode='hold');await press(page,copyButton);
   fixture.update({messages:[message('```ts\nconst changing = 2;','running')]});
   await wait(()=>document.querySelector('.code-block')?.textContent.trimEnd()==='const changing = 2;');
   await page.evaluate(()=>window.__clipboard.resolve());
   await check('stream update discards stale copied feedback and unlocks new source',()=>!document.querySelector('.aui-code-header-root .lucide-check')&&!document.querySelector('.aui-code-header-root button').disabled);
   await page.evaluate(()=>window.__copyMode='success');await press(page,copyButton);
   assert.equal(await page.evaluate(()=>window.__copies.at(-1).text),'const changing = 2;\n');checks.push({width,label:'streaming block copies the latest incomplete source'});
   fixture.update({messages:[message('```mermaid\nthis is not a diagram\n```')]});
   await wait(()=>!!document.querySelector('.mermaid-status'));
   await check('invalid Mermaid keeps source fallback and CodeHeader',()=>!!document.querySelector('.mermaid-diagram pre')&&document.querySelectorAll('.aui-code-header-root').length===1);
   fixture.update({messages:[message('```\n```')]});
   await wait(()=>document.querySelector('.code-block')?.textContent==='');
   await check('empty block has no active copy action',()=>document.querySelector('.aui-code-header-root button').disabled);
   assert.deepEqual(page.errors,[]);assert.deepEqual(page.blocked,[]);
  }finally{await page.close();}
 }
 writeFileSync(join(destination,'results.json'),JSON.stringify({checks,version:chrome.version},null,2));console.log(JSON.stringify({passed:checks.length,widths:[1440,390,320],evidence:destination}));
}finally{await chrome?.close();await fixture.close();}
