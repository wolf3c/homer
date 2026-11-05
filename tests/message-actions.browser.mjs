// Requirement-derived synthetic messages, isolated Chrome and in-memory transport.
// No Homer service, account, model or persistent business data is used.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {composerFixture} from './fixtures/composer-browser-server.mjs';
import {isolatedChrome} from './web-history-browser-cdp.mjs';

const destination=resolve(process.env.HOMER_BROWSER_EVIDENCE??'.codex/scratch/message-actions-20261023/browser');
const webDir=resolve(process.env.HOMER_COMPONENT_BUILD??'.codex/scratch/message-actions-20261023/candidate-web');
mkdirSync(destination,{recursive:true});
const fixture=await composerFixture({webDir,beforeDir:webDir,branding:resolve('assets/branding/odysseus-20261030/homer-odysseus-256.png')});
let chrome;const checks=[];
const markdown='# 合成回复\n\n**核对** [资料](https://example.com/hidden-target) 与 `x = 1`。\n\n| 项目 | 状态 |\n| --- | --- |\n| 核对 | 完成 |';
const message=(id,role,text,status='completed')=>({id,role,text,status,threadId:'composer-review',requestId:'request-'+id,createdAt:1700000000000});
const messages=[message('quote-user','user','合成用户原文'),message('quote-assistant','assistant',markdown),message('attachment-only','assistant','')];
async function key(page,key){await page.command('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,...(key==='Enter'?{text:'\r',windowsVirtualKeyCode:13}:key==='Tab'?{windowsVirtualKeyCode:9}:{})});await page.command('Input.dispatchKeyEvent',{type:'keyUp',key,code:key});}
async function press(page,selector){await page.evaluate('document.querySelector('+JSON.stringify(selector)+').focus()');await key(page,'Enter');}
async function input(page,text){await page.evaluate(()=>{const e=document.querySelector('[contenteditable=true]');e.focus();const r=document.createRange();r.selectNodeContents(e);getSelection().removeAllRanges();getSelection().addRange(r);});await page.command('Input.insertText',{text});}
try{
 chrome=await isolatedChrome(destination);
 for(const width of [1440,390,320]){
  fixture.reset({messages:structuredClone(messages),features:{draftUpload:true,taskOverview:false}});
  const page=await chrome.page(fixture.url,width);
  const wait=predicate=>page.until('Boolean(('+String(predicate)+')())',10000);
  const check=async(label,predicate)=>{assert.ok(await page.evaluate(predicate),label);checks.push({width,label});};
  try{
   await page.command('Page.addScriptToEvaluateOnNewDocument',{source:`window.__console=[];for(const level of ["warn","error"]){const original=console[level].bind(console);console[level]=(...args)=>{window.__console.push(level);original(...args);};}window.__copies=[];window.__copyMode='hold';Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText(text){window.__copies.push({text,active:navigator.userActivation.isActive});if(window.__copyMode==='hold')return new Promise((resolve,reject)=>window.__clipboard={resolve,reject});if(window.__copyMode==='fail')return Promise.reject(Error('synthetic_clipboard_denied'));return Promise.resolve();}}});`});
   await page.navigate();await wait(()=>!!document.querySelector('#message-quote-assistant [data-slot="message-actions"]')&&!!document.querySelector('[contenteditable=true]'));
   await check('each text message has Copy and Quote in official MessageActions',()=>['quote-user','quote-assistant'].every(id=>JSON.stringify([...document.querySelectorAll('#message-'+id+' [data-slot="message-actions"] button')].map(b=>b.getAttribute('aria-label')))==='["复制","引用"]'));
   await check('no empty message action bar',()=>!document.querySelector('#message-attachment-only [data-slot="message-actions"]'));
   await check('both controls retain pinned size-7 geometry',()=>[...document.querySelectorAll('[data-slot="message-actions"] button')].every(b=>{const r=b.getBoundingClientRect();return r.width===28&&r.height===28;}));
   await press(page,'#message-quote-assistant [aria-label="复制"]');
   await check('copy starts under native user activation and locks reentry',()=>window.__copies.length===1&&window.__copies[0].active&&document.querySelector('#message-quote-assistant [aria-label="复制"]').disabled);
   await page.evaluate(()=>{document.querySelector('#message-quote-assistant [aria-label="复制"]').click();window.__clipboard.reject(Error('synthetic_clipboard_denied'));});
   await wait(()=>document.querySelector('#message-quote-assistant .message-action-notice')?.textContent.includes('复制失败'));
   await check('copy failure remains visible and retryable',()=>{const notice=document.querySelector('#message-quote-assistant .message-action-notice');return !notice.classList.contains('sr-only')&&notice.getBoundingClientRect().height>1&&!document.querySelector('#message-quote-assistant [aria-label="复制"]').disabled;});
   await check('pending reentry did not duplicate clipboard writes',()=>window.__copies.length===1);
   await page.evaluate(()=>window.__copyMode='success');await press(page,'#message-quote-assistant [aria-label="复制"]');
   await wait(()=>!!document.querySelector('#message-quote-assistant .aui-message-copy.is-copied'));
   await check('copy keeps exact Markdown text and announces success',()=>window.__copies.at(-1).text.includes('https://example.com/hidden-target')&&document.querySelector('#message-quote-assistant .message-action-notice')?.textContent==='已复制');
   await check('copy success uses the official check icon and only a screen-reader announcement',()=>{const notice=document.querySelector('#message-quote-assistant .message-action-notice');return notice?.getAttribute('role')==='status'&&notice.classList.contains('sr-only')&&notice.getBoundingClientRect().height<=1&&!!document.querySelector('#message-quote-assistant .aui-message-copy.is-copied');});
   await input(page,'保留已写说明');
   await press(page,'#message-quote-assistant [aria-label="引用"]');
   await wait(()=>!!document.querySelector('[aria-label="编辑引用 1"]'));
   await check('quote appends visible text and preserves draft and real editor focus',()=>{const q=JSON.parse(sessionStorage.getItem('homer-draft:composer-review')).quotes[0],e=document.querySelector('[contenteditable=true]');return q.messageId==='quote-assistant'&&q.text.includes('核对 资料 与 x = 1')&&q.text.includes('项目\t状态')&&!q.text.includes('https:')&&e.innerText==='保留已写说明'&&document.activeElement===e;});
   await press(page,'#message-quote-user [aria-label="引用"]');
   await check('second quote appends without replacing the original or sending',()=>JSON.parse(sessionStorage.getItem('homer-draft:composer-review')).quotes.length===2&&document.querySelector('[contenteditable=true]').innerText==='保留已写说明');
   await press(page,'[aria-label="删除引用 2"]');
   await page.command('Page.reload');await wait(()=>document.querySelector('[contenteditable=true]')?.innerText==='保留已写说明'&&!!document.querySelector('[aria-label="编辑引用 1"]'));
   await check('refresh keeps the original quote and draft',()=>JSON.parse(sessionStorage.getItem('homer-draft:composer-review')).quotes[0].messageId==='quote-assistant');
   await page.command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
   await check('reduced motion disables copied icon transition',()=>parseFloat(getComputedStyle(document.querySelector('.aui-message-action-icon')).transitionDuration)===0);
   await check('narrow layout has no horizontal page overflow',()=>document.documentElement.scrollWidth<=innerWidth);
   await page.evaluate(()=>document.querySelector('#message-quote-assistant').scrollIntoView({block:'center'}));
   await page.screenshot('message-actions-'+width+'.png');
   await press(page,'[aria-label="发送消息"]');
   await wait(()=>document.querySelector('[contenteditable=true]')?.innerText.trim()==='');
   // The composer clears optimistically, before the local server receives POST.
   const receiptDeadline=Date.now()+10000;
   while(!fixture.received.messages.length&&Date.now()<receiptDeadline)await new Promise(resolve=>setTimeout(resolve,20));
   assert.equal(fixture.received.messages.length,1);const sent=fixture.received.messages[0];
   assert.equal(sent.text,'保留已写说明');assert.equal(sent.quotes[0].messageId,'quote-assistant');assert.ok(sent.quotes[0].text.includes('项目\t状态'));assert.ok(!sent.quotes[0].text.includes('https:'));
   checks.push({width,label:'send preserves the exact quote identity and draft'});
   fixture.update({messages:[message('stream-copy','assistant','流式合成正文','running')],isRunning:true,activeMessageId:'stream-copy'});
   await wait(()=>!document.querySelector('.scroll-latest').disabled);await press(page,'.scroll-latest');
   await wait(()=>!!document.querySelector('#message-stream-copy [aria-label="复制"]'));
   await page.evaluate(()=>window.__copyMode='success');await press(page,'#message-stream-copy [aria-label="复制"]');
   await wait(()=>window.__copies.at(-1)?.text==='流式合成正文');checks.push({width,label:'streaming copy remains available'});
   fixture.update({messages:[message('stream-copy','assistant','x'.repeat(16001),'running')]});
   await wait(()=>document.querySelector('#message-stream-copy .markdown')?.textContent.length===16001);
   await press(page,'#message-stream-copy [aria-label="引用"]');
   await check('long quote retains the existing 16000 character limit and visible notice',()=>JSON.parse(sessionStorage.getItem('homer-draft:composer-review')).quotes[0].text.length===16000&&!!document.querySelector('#message-stream-copy .message-action-notice'));
   await check('no application console warnings or errors',()=>window.__console.length===0);
   assert.deepEqual(page.errors,[]);assert.deepEqual(page.blocked,[]);
  }catch(error){writeFileSync(join(destination,'failure-'+width+'.json'),JSON.stringify({error:String(error),state:await page.evaluate(()=>({text:document.querySelector('[contenteditable=true]')?.innerText,composer:document.querySelector('.composer-area')?.innerText,send:document.querySelector('[aria-label="发送消息"]')?.outerHTML})),received:fixture.received,errors:page.errors},null,2));await page.screenshot('failure-'+width+'.png');throw error;}finally{await page.close();}
 }
 writeFileSync(join(destination,'results.json'),JSON.stringify({checks,version:chrome.version},null,2));
 console.log(JSON.stringify({passed:checks.length,widths:[1440,390,320],evidence:destination}));
}finally{await chrome?.close();await fixture.close();}
