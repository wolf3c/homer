// Official Quote UI exercised against requirement-derived, in-memory data only.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {composerFixture} from './fixtures/composer-browser-server.mjs';
import {isolatedChrome} from './web-history-browser-cdp.mjs';
const destination=resolve(process.env.HOMER_BROWSER_EVIDENCE??'.codex/scratch/quote-components-20261023/browser');
const webDir=resolve(process.env.HOMER_COMPONENT_BUILD??'.codex/scratch/quote-components-20261023/candidate-web');
mkdirSync(destination,{recursive:true});
const fixture=await composerFixture({webDir,beforeDir:webDir,branding:resolve('assets/branding/odysseus-20261030/homer-odysseus-256.png')});
const long='这是一段保留原消息身份的合成引用，官方预览只显示两行。'.repeat(30);
const msg=(id,role,text,quotes)=>({id,role,text,quotes,status:'completed',threadId:'composer-review',requestId:'request-'+id,createdAt:1700000000000});
const messages=[msg('source-assistant','assistant','选取这句合成原文。\n\n'+long),msg('source-user','user','用户的另一条合成原文。'),msg('single-quote','user','新的说明',[{messageId:'source-assistant',text:long,annotation:''}]),msg('legacy-quote','user','历史说明',[{messageId:'legacy-a',text:long,annotation:'原批注完整保留'},{messageId:'legacy-b',text:'第二条旧引用',annotation:'第二条批注'}])];
const checks=[];let chrome;
async function key(page,key){await page.command('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,...(key==='Enter'?{text:'\r',windowsVirtualKeyCode:13}:{})});await page.command('Input.dispatchKeyEvent',{type:'keyUp',key,code:key});}
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
   await page.navigate();await wait(()=>!!document.querySelector('#message-single-quote [data-slot="quote-block"]')&&!!document.querySelector('[contenteditable=true]'));
   await check('ordinary historical quote uses official icon/text and two-line clamp',()=>{const e=document.querySelector('#message-single-quote [data-slot="quote-block-text"]');return !!document.querySelector('#message-single-quote [data-slot="quote-block-icon"]')&&getComputedStyle(e).webkitLineClamp==='2';});
   await check('legacy quotes retain full text and both annotations',()=>{const e=document.querySelector('#message-legacy-quote'),q=e.querySelector('[data-slot="quote-block-text"]');return e.querySelectorAll('[data-slot="quote-block"]').length===2&&q.textContent.length>700&&getComputedStyle(q).webkitLineClamp==='none'&&e.textContent.includes('原批注完整保留')&&e.textContent.includes('第二条批注');});
   await input(page,'保留现有说明');
   await press(page,'#message-source-assistant [data-slot="message-actions"] [aria-label="引用"]');
   await wait(()=>!!document.querySelector('[data-slot="composer-quote"]'));
   await check('official preview has icon/text/dismiss and default two lines',()=>{const e=document.querySelector('[data-slot="composer-quote-text"]');return !!document.querySelector('[data-slot="composer-quote-icon"]')&&!!document.querySelector('[data-slot="composer-quote-dismiss"]')&&getComputedStyle(e).webkitLineClamp==='2'&&e.getBoundingClientRect().height<=2*parseFloat(getComputedStyle(e).lineHeight)+1;});
   await check('custom preview and expansion controls are gone',()=>!document.querySelector('.composer-quote-card,.quote-card-actions,[aria-label="展开引用"],[aria-label="收起引用"]'));
   await check('dismiss keeps 44px target',()=>{const r=document.querySelector('[data-slot="composer-quote-dismiss"]').getBoundingClientRect();return r.width>=44&&r.height>=44;});
   await page.command('Page.reload');await wait(()=>!!document.querySelector('[data-slot="composer-quote"]'));
   await check('refresh restores the official quote and newer draft text',()=>document.querySelector('[data-slot="composer-quote-text"]').textContent.startsWith('选取这句合成原文。')&&document.querySelector('[contenteditable=true]').innerText==='保留现有说明');
   await press(page,'[data-slot="composer-quote-dismiss"]');await wait(()=>!document.querySelector('[data-slot="composer-quote"]'));
   await check('official dismissal retains text, restores input focus and persists removal',()=>{const e=document.querySelector('[contenteditable=true]');return e.innerText==='保留现有说明'&&document.activeElement===e&&JSON.parse(sessionStorage.getItem('homer-draft:composer-review')).quotes.length===0;});
   await page.command('Page.reload');await wait(()=>!!document.querySelector('[contenteditable=true]'));
   await check('removed quote does not revive on refresh',()=>!document.querySelector('[data-slot="composer-quote"]'));
   const viewport=await page.evaluate(()=>document.querySelector('.thread-viewport').getBoundingClientRect().toJSON());
   await page.command('Input.dispatchMouseEvent',{type:'mouseWheel',x:viewport.left+viewport.width/2,y:viewport.top+viewport.height/2,deltaX:0,deltaY:-10000});
   await wait(()=>!!document.querySelector('#message-source-assistant [data-aui-quote-selectable] p'));
   await wait(()=>{const e=document.querySelector('#message-source-assistant [data-aui-quote-selectable] p'),v=document.querySelector('.thread-viewport').getBoundingClientRect(),r=e.getBoundingClientRect();return r.top>=v.top&&r.bottom<=v.bottom;});
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const rect=await page.evaluate(()=>{const p=document.querySelector('#message-source-assistant [data-aui-quote-selectable] p'),r=document.createRange();r.selectNodeContents(p);return r.getBoundingClientRect().toJSON();});
   // Finish a real native drag after scrolling settles. The official toolbar
   // intentionally dismisses itself on scroll and checks again on mouseup.
   await page.command('Input.dispatchMouseEvent',{type:'mousePressed',x:rect.left+1,y:rect.top+rect.height/2,button:'left',buttons:1,clickCount:1});
   await page.command('Input.dispatchMouseEvent',{type:'mouseMoved',x:rect.right-1,y:rect.top+rect.height/2,button:'left',buttons:1});
   await page.command('Input.dispatchMouseEvent',{type:'mouseReleased',x:rect.right-1,y:rect.top+rect.height/2,button:'left',buttons:0,clickCount:1});
   await wait(()=>!!document.querySelector('[data-slot="selection-toolbar-quote"]'));
   await check('selected-text toolbar uses official surface and Chinese action',()=>document.querySelector('[data-slot="selection-toolbar"]').textContent.trim()==='引用');
   const reading=await page.evaluate(()=>({scroll:document.querySelector('.thread-viewport').scrollTop,top:document.querySelector('#message-source-assistant').getBoundingClientRect().top}));
   const style=await page.evaluate(()=>{const root=document.querySelector('[data-slot="selection-toolbar"]'),button=root.querySelector('button'),s=getComputedStyle(button),r=getComputedStyle(root);return {root:{height:root.getBoundingClientRect().height,border:r.borderWidth,borderColor:r.borderColor,radius:r.borderRadius,padding:r.padding,gap:r.gap,background:r.backgroundColor},button:{height:button.getBoundingClientRect().height,minHeight:s.minHeight,border:s.borderWidth,padding:s.padding,gap:s.gap,radius:s.borderRadius,background:s.backgroundColor,font:s.fontSize,lineHeight:s.lineHeight}};});
   writeFileSync(join(destination,'toolbar-style-'+width+'.json'),JSON.stringify(style,null,2));
   await page.screenshot('selection-toolbar-'+width+'.png');
   // Exercise both the native click and keyboard activation. Neither may need
   // a second click on the editor before the next keystroke.
   if(width===390){
    await page.evaluate(()=>document.querySelector('[data-slot="selection-toolbar-quote"]').focus());
    for(const modifiers of [8,0]){await page.command('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,modifiers});await page.command('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,modifiers});}
    await check('toolbar is reachable by Tab with a visible native focus ring',()=>{const b=document.querySelector('[data-slot="selection-toolbar-quote"]');return document.activeElement===b&&b.matches(':focus-visible')&&getComputedStyle(b).outlineStyle==='auto';});
    await page.screenshot('selection-toolbar-keyboard-'+width+'.png');await key(page,'Enter');
   }
   else {const r=await page.evaluate(()=>document.querySelector('[data-slot="selection-toolbar-quote"]').getBoundingClientRect().toJSON());for(const type of ['mousePressed','mouseReleased'])await page.command('Input.dispatchMouseEvent',{type,x:r.left+r.width/2,y:r.top+r.height/2,button:'left',buttons:type==='mousePressed'?1:0,clickCount:1});}
   await wait(()=>!!document.querySelector('[data-slot="composer-quote"]'));
   await check('selected text enters the same official preview without altering the draft',()=>document.querySelector('[data-slot="composer-quote-text"]').textContent==='选取这句合成原文。'&&document.querySelector('[contenteditable=true]').innerText==='保留现有说明');
   await check('selected quote retains the exact source message identity',()=>JSON.parse(sessionStorage.getItem('homer-draft:composer-review')).quotes[0].messageId==='source-assistant');
   await check('selected quote focuses the real editor immediately',()=>document.activeElement===document.querySelector('[contenteditable=true]'));
   assert.ok(Math.abs((await page.evaluate(()=>document.querySelector('.thread-viewport').scrollTop))-reading.scroll)<2,'quote focus keeps the reader at the same scroll position');
   assert.ok(Math.abs((await page.evaluate(()=>document.querySelector('#message-source-assistant').getBoundingClientRect().top))-reading.top)<2,'quote does not shift the visible source');
   assert.equal(style.button.height,28,'official py-1 + 20px line height');
   assert.equal(style.button.border,'0px','host button border cannot leak in');
   assert.equal(style.button.background,'rgba(0, 0, 0, 0)','default button surface is transparent');
   assert.equal(style.button.radius,'8px');assert.equal(style.button.padding,'4px 10px');assert.equal(style.button.gap,'6px');assert.equal(style.root.height,38);assert.equal(style.root.border,'1px');assert.equal(style.root.radius,'10px');assert.equal(style.root.borderColor,'rgb(222, 219, 213)');
   await page.command('Input.insertText',{text:'直接继续输入'});
   await wait(()=>document.querySelector('[contenteditable=true]').innerText==='保留现有说明直接继续输入');
   checks.push({width,label:'typing after quoting appends to the existing draft without a second click'});
   await page.screenshot('quote-focused-'+width+'.png');
   await input(page,'保留现有说明');
   await press(page,'#message-source-user [data-slot="message-actions"] [aria-label="引用"]');
   await wait(()=>document.querySelector('[data-slot="composer-quote-text"]')?.textContent==='用户的另一条合成原文。');
   await check('message quote replaces rather than appends',()=>document.querySelectorAll('[data-slot="composer-quote"]').length===1);
   await check('all Quote surfaces fit the viewport',()=>document.documentElement.scrollWidth<=innerWidth&&document.querySelector('[data-slot="composer-quote"]').getBoundingClientRect().right<=innerWidth);
   await page.evaluate(()=>document.querySelector('#message-single-quote').scrollIntoView({block:'center'}));await page.screenshot('official-quote-'+width+'.png');
   fixture.configure({sendUnknown:true});await press(page,'[aria-label="发送消息"]');
   await wait(()=>JSON.parse(sessionStorage.getItem('homer-unconfirmed:composer-review')??'[]').length===1);
   for(let n=0;n<200&&fixture.received.messages.length===0;n++)await new Promise(done=>setTimeout(done,10));assert.equal(fixture.received.messages.length,1);
   const original=structuredClone(fixture.received.messages[0]);assert.equal(original.quote.messageId,'source-user');assert.equal(original.quote.text,'用户的另一条合成原文。');assert.equal(original.text,'保留现有说明');
   await input(page,'未确认期间的新说明');await page.command('Page.reload');await wait(()=>document.querySelector('[contenteditable=true]')?.innerText==='未确认期间的新说明');
   assert.equal(fixture.received.messages.length,1);assert.deepEqual(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('homer-unconfirmed:composer-review'))[0].input),original);checks.push({width,label:'unknown send preserves exact original quote and ID without replay or manual entry'});
   await check('refresh never overwrites the later draft',()=>document.querySelector('[contenteditable=true]').innerText==='未确认期间的新说明');
   fixture.accept(original);await page.until(`!JSON.parse(sessionStorage.getItem('homer-unconfirmed:composer-review')??'[]').some(item=>item.input.requestId===${JSON.stringify(original.requestId)})`,10000);
   // Retired session is preserved; the ordinary draft owns all live quote actions.
   fixture.reset({messages:structuredClone(messages),features:{draftUpload:true,taskOverview:false}});
   const archived=await page.evaluate(()=>{
    const quote={messageId:'source-user',text:'用户的另一条合成原文。',annotation:''},original={text:'普通草稿保持',quotes:[quote]};
    const session={item:{input:{requestId:'queued-original',text:'排队编辑保持',quotes:[quote]},state:'queued',revision:1,inputRevision:1,editable:true},text:'排队编辑保持',quotes:[quote],attachments:[],original};
    sessionStorage.removeItem('homer-draft:composer-review');sessionStorage.setItem('homer-queue-editor:composer-review',JSON.stringify(session));return JSON.stringify(session);
   });
   await page.command('Page.reload');await wait(()=>document.querySelector('[contenteditable=true]')?.innerText==='普通草稿保持');
   await check('ordinary original quote restores without the retired panel',()=>!document.querySelector('.composer-area .queue-draft-recovery')&&document.querySelector('[data-slot=composer-quote-text]')?.textContent==='用户的另一条合成原文。');
   await press(page,'#message-source-assistant [data-slot="message-actions"] [aria-label="引用"]');
   await check('ordinary message quote replacement keeps text and never submits',()=>document.querySelector('[contenteditable=true]').innerText==='普通草稿保持'&&!!document.querySelector('[data-slot=composer-quote]'));
   await page.evaluate(()=>document.querySelector('#message-source-assistant [data-aui-quote-selectable] p').scrollIntoView({block:'center'}));
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   await page.evaluate(()=>{const p=document.querySelector('#message-source-assistant [data-aui-quote-selectable] p'),range=document.createRange();range.selectNodeContents(p);getSelection().removeAllRanges();getSelection().addRange(range);document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));});
   await wait(()=>!!document.querySelector('[data-slot="selection-toolbar-quote"]'));await press(page,'[data-slot="selection-toolbar-quote"]');
   await wait(()=>!document.querySelector('[data-slot="selection-toolbar-quote"]'));
   assert.equal(await page.evaluate(()=>sessionStorage.getItem('homer-queue-editor:composer-review')),archived);
   assert.equal(fixture.received.messages.length,0);checks.push({width,label:'ordinary selection leaves every retired quote and annotation byte-preserved without sending'});
   assert.deepEqual(page.errors,[]);assert.deepEqual(page.blocked,[]);
  }catch(error){
   const state=await page.evaluate(()=>({ids:[...document.querySelectorAll('[data-conversation-message]')].map(e=>e.dataset.conversationMessage),editor:document.querySelector('[contenteditable=true]')?.innerText,active:document.activeElement?.outerHTML,anchor:getSelection()?.anchorOffset,selection:getSelection()?.toString(),range:getSelection()?.rangeCount?getSelection().getRangeAt(0).getBoundingClientRect().toJSON():null,toolbar:document.querySelector('[data-slot="selection-toolbar"]')?.outerHTML,scroll:document.querySelector('.thread-viewport')?.scrollTop}));
   writeFileSync(join(destination,'synthetic-failure-'+width+'.json'),JSON.stringify({error:String(error),state,errors:page.errors},null,2));throw error;
  }finally{await page.close();}
 }
 writeFileSync(join(destination,'results.json'),JSON.stringify({checks,version:chrome.version},null,2));console.log(JSON.stringify({passed:checks.length,widths:[1440,390,320],evidence:destination}));
}finally{await chrome?.close();await fixture.close();}
