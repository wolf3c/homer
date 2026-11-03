// Real rendered UI, exact synthetic source identities, no product service/data.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {composerFixture} from './fixtures/composer-browser-server.mjs';
import {isolatedChrome} from './web-history-browser-cdp.mjs';
const destination=resolve(process.env.HOMER_BROWSER_EVIDENCE??'.codex/scratch/quote-navigation-20261028/navigation-browser');
const webDir=resolve(process.env.HOMER_COMPONENT_BUILD??'.codex/scratch/quote-navigation-20261028/candidate-web');mkdirSync(destination,{recursive:true});
const text='开头。重复原文。中间。重复原文。末尾。',exact='重复原文',start=text.lastIndexOf(exact),flow=text+'\n';
const position={format:'preview-text-v1',representation:'markdown',start,end:start+exact.length,exact,prefix:flow.slice(0,start),suffix:flow.slice(start+exact.length),sourceHash:createHash('sha256').update(flow).digest('hex')};
const msg=(id,role,text,extra={})=>({id,role,text,status:'completed',threadId:'composer-review',requestId:'request-'+id,createdAt:1700000000000,...extra});
const archived=msg('archived-source','assistant',text),q=id=>({messageId:id,text:exact,annotation:'保留批注',position});
const quotes=[q('current-source'),q('other-source'),q('archived-source'),{messageId:'missing-source',text:'保留缺失原文',annotation:'缺失来源批注'},{messageId:'current-source',text:'旧引用摘录',annotation:'无选区旧引用'}, {...q('current-source'),position:{...position,sourceHash:'0'.repeat(64)}}];
const messages=[msg('current-source','assistant',text),msg('other-source','assistant',text),...Array.from({length:10},(_,i)=>msg('filler-'+i,i%2?'assistant':'user','合成历史正文。'.repeat(15))),msg('quoted','user','继续核对这几段。',{quotes})];
let held,hold=false;const requests=[];
const fixture=await composerFixture({webDir,beforeDir:webDir,branding:resolve('assets/branding/homer-river-stone-256.de41791ce5c1.png'),historyPage({body,json}){
 requests.push(body);const id=body.request.around;
 const respond=()=>json({protocol:3,threadId:'composer-review',revision:100000,units:id==='missing-source'?[]:[id],messages:id==='archived-source'?[archived]:messages.filter(m=>m.id===id),before:null,after:null});
 if(hold&&id==='archived-source'){held=respond;return;}respond();
}});
let chrome;const checks=[];
async function key(page,key){for(const type of ['keyDown','keyUp'])await page.command('Input.dispatchKeyEvent',{type,key,code:key,...(key==='Enter'?{windowsVirtualKeyCode:13,...(type==='keyDown'?{text:'\r'}:{})}:{})});}
async function press(page,selector){await page.evaluate('document.querySelector('+JSON.stringify(selector)+').focus()');await key(page,'Enter');}
async function click(page,index){const selector='#message-quoted .message-quote-source',r=await page.evaluate(`(()=>{const a=document.querySelectorAll(${JSON.stringify(selector)})[${index}];a.closest('.thread-viewport').dispatchEvent(new WheelEvent('wheel',{bubbles:true,deltaY:-1}));a.scrollIntoView({block:'center'});return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(a.getBoundingClientRect().toJSON()))));})()`);for(const type of ['mousePressed','mouseReleased'])await page.command('Input.dispatchMouseEvent',{type,x:r.left+r.width/2,y:r.top+r.height/2,button:'left',buttons:type==='mousePressed'?1:0,clickCount:1});}
try{
 chrome=await isolatedChrome(destination);
 for(const width of [1440,390,320]){
  fixture.reset({messages:structuredClone(messages),features:{draftUpload:true,taskOverview:false,previewReferenceCollections:2}});hold=false;held=undefined;
  const page=await chrome.page(fixture.url,width),wait=predicate=>page.until('Boolean(('+String(predicate)+')())',10000);
  const check=async(label,predicate)=>{assert.ok(await page.evaluate(predicate),label);checks.push({width,label});};
  try{
   await page.navigate();await wait(()=>document.querySelectorAll('#message-quoted .message-quote-source').length===6&&!!document.querySelector('[contenteditable=true]'));
   await check('identity, meaningful UI and no framework error overlay',()=>location.hostname==='127.0.0.1'&&document.title.includes('Homer')&&!document.querySelector('vite-error-overlay')&&!!document.querySelector('.composer'));
   await check('grey excerpts hide message and native item identifiers',()=>!document.querySelector('#message-quoted .message-quotes').textContent.includes('source')&&!document.querySelector('#message-quoted [title*="source"]'));
   await page.evaluate(()=>{const e=document.querySelector('[contenteditable=true]');e.focus();});await page.command('Input.insertText',{text:'保留主草稿'});
   await page.screenshot('history-excerpts-'+width+'.png');
   await click(page,0);await wait(()=>getSelection()?.toString()==='重复原文'&&getSelection().anchorOffset===11);
   await check('exact second occurrence selected in the recorded source, not same-text neighbour',()=>getSelection().anchorNode.parentElement.closest('[data-conversation-message]').id==='message-current-source'&&document.activeElement.id==='message-current-source');
   await check('navigation keeps draft and sends nothing',()=>document.querySelector('[contenteditable=true]').innerText==='保留主草稿');assert.equal(fixture.received.messages.length,0);
   await page.screenshot('selected-source-'+width+'.png');
   // Selecting/copying inside the excerpt must not navigate on the release click.
   await page.evaluate(()=>{const a=document.querySelector('#message-quoted .message-quote-source'),r=document.createRange();r.selectNodeContents(a.querySelector('[data-slot="quote-block-text"]'));getSelection().removeAllRanges();getSelection().addRange(r);a.click();});
   await check('copy selection in the excerpt remains at the quote',()=>getSelection().anchorNode.parentElement.closest('[data-conversation-message]').id==='message-quoted');
   await page.evaluate(()=>getSelection().removeAllRanges());
   await press(page,'#message-quoted .message-quote:nth-child(5) .message-quote-source');
   await wait(()=>document.querySelector('.history-navigation')?.textContent.includes('暂无法准确定位'));
   await check('legacy source still navigates with a clear exact-range limitation',()=>document.activeElement.id==='message-current-source'&&document.querySelector('#message-quoted').textContent.includes('旧引用摘录'));
   await click(page,5);await wait(()=>document.querySelector('.history-navigation')?.textContent.includes('暂无法准确定位'));
   await click(page,3);await wait(()=>document.querySelector('.history-navigation')?.textContent.includes('原消息不存在'));
   await check('missing source preserves the quote, annotation and draft',()=>document.querySelector('#message-quoted').textContent.includes('缺失来源批注')&&document.querySelector('[contenteditable=true]').innerText==='保留主草稿');
   // Resolve two hash checks out of order; only the latest navigation may select.
   await page.evaluate(()=>{window.__digest=crypto.subtle.digest.bind(crypto.subtle);window.__hashes=[];crypto.subtle.digest=(...args)=>new Promise(resolve=>window.__hashes.push(()=>window.__digest(...args).then(resolve)));});
   await click(page,0);await wait(()=>window.__hashes.length===1);await click(page,1);await wait(()=>window.__hashes.length===2);
   await page.evaluate(()=>window.__hashes[1]());await wait(()=>getSelection()?.anchorNode?.parentElement.closest('[data-conversation-message]')?.id==='message-other-source');
   await page.evaluate(async()=>{window.__hashes[0]();crypto.subtle.digest=window.__digest;await new Promise(resolve=>setTimeout(resolve,100));});
   await check('a late previous hash cannot replace the newer selection or focus',()=>document.activeElement.id==='message-other-source'&&getSelection().anchorNode.parentElement.closest('[data-conversation-message]').id==='message-other-source');
   // Cancel an in-flight history navigation with a newer loaded source.
   hold=true;await click(page,2);for(let n=0;n<200&&!held;n++)await new Promise(r=>setTimeout(r,10));assert.ok(held);
   await click(page,0);await wait(()=>getSelection()?.anchorNode?.parentElement.closest('[data-conversation-message]')?.id==='message-current-source');held();held=undefined;hold=false;
   await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,100)));
   await check('late history response cannot override the newer source',()=>!document.querySelector('#message-archived-source')&&document.activeElement.id==='message-current-source');
   await click(page,2);await wait(()=>!!document.querySelector('#message-archived-source')&&getSelection()?.toString()==='重复原文');
   await check('off-page source uses existing around loading then restores the exact occurrence',()=>document.activeElement.id==='message-archived-source'&&getSelection().anchorOffset===11&&document.querySelector('[contenteditable=true]').innerText==='保留主草稿');
   assert.ok(requests.some(r=>r.request.around==='archived-source'&&r.readEpoch==='composer-synthetic-epoch'));checks.push({width,label:'history requests retain the current exact read epoch'});
   await check('no horizontal overflow',()=>document.documentElement.scrollWidth<=innerWidth);
   await page.screenshot('history-loaded-'+width+'.png');assert.deepEqual(page.errors,[]);assert.deepEqual(page.blocked,[]);
  }catch(error){writeFileSync(join(destination,'failure-'+width+'.json'),JSON.stringify({error:String(error),state:await page.evaluate(()=>({title:document.title,body:document.body.innerText,selection:getSelection()?.toString(),offset:getSelection()?.anchorOffset,active:document.activeElement?.id})),errors:page.errors,requests},null,2));await page.screenshot('failure-'+width+'.png');throw error;}finally{await page.close();}
 }
 writeFileSync(join(destination,'results.json'),JSON.stringify({checks,version:chrome.version},null,2));console.log(JSON.stringify({passed:checks.length,widths:[1440,390,320],evidence:destination}));
}finally{await chrome?.close();await fixture.close();}
