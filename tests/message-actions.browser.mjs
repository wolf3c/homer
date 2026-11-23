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
let earlier,releaseBefore;
const fixture=await composerFixture({
 webDir,beforeDir:webDir,branding:resolve('assets/branding/odysseus-20261030/homer-odysseus-256.png'),
 historyBefore:()=>earlier?'group-before':null,
 historyPage:({body,json,revision})=>{
  if(!earlier||body.request.before!=='group-before')return json({error:'fixture_route_not_allowed'},404);
  releaseBefore=()=>{
   const messages=earlier;
   earlier=undefined;
   json({protocol:3,threadId:'composer-review',revision,messages,units:messages.map(m=>m.id),before:null,after:null,artifacts:[]});
  };
 },
});
let chrome;const checks=[];
const markdown='# 合成回复\n\n**核对** [资料](https://example.com/hidden-target) 与 `x = 1`。\n\n| 项目 | 状态 |\n| --- | --- |\n| 核对 | 完成 |';
const message=(id,role,text,status='completed')=>({id,role,text,status,threadId:'composer-review',requestId:'request-'+id,createdAt:1700000000000});
const taskReply=(id,text,taskId)=>({...message(id,'assistant',text),taskSources:[{title:'合成事项',target:{taskId,version:1}}]});
const messages=[
 message('quote-user','user','合成用户原文'),
 taskReply('quote-assistant',markdown,'one'),
 taskReply('same-task','已阅。','one'),
 taskReply('other-task','这是另一事项。','two'),
 message('attachment-only','assistant',''),
];
async function key(page,key){await page.command('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,...(key==='Enter'?{text:'\r',windowsVirtualKeyCode:13}:key==='Tab'?{windowsVirtualKeyCode:9}:{})});await page.command('Input.dispatchKeyEvent',{type:'keyUp',key,code:key});}
async function press(page,selector){await page.evaluate('document.querySelector('+JSON.stringify(selector)+').focus()');await key(page,'Enter');}
async function input(page,text){await page.evaluate(()=>{const e=document.querySelector('[contenteditable=true]');e.focus();const r=document.createRange();r.selectNodeContents(e);getSelection().removeAllRanges();getSelection().addRange(r);});await page.command('Input.insertText',{text});}
try{
 chrome=await isolatedChrome(destination,{mockKeychain:true});
 for(const width of [1440,390,320]){
  const initialMessages=structuredClone(messages);
  if(width===320)initialMessages.find(m=>m.id==='same-task').text='i';
  fixture.reset({messages:initialMessages,features:{draftUpload:true,taskOverview:false}});
  const page=await chrome.page(fixture.url,width);
  if(width===390)await page.command('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
  const wait=predicate=>page.until('Boolean(('+String(predicate)+')())',10000);
  const check=async(label,predicate)=>{assert.ok(await page.evaluate(predicate),label);checks.push({width,label});};
  try{
   await page.command('Page.addScriptToEvaluateOnNewDocument',{source:`window.__console=[];for(const level of ["warn","error"]){const original=console[level].bind(console);console[level]=(...args)=>{window.__console.push(level);original(...args);};}window.__copies=[];window.__copyMode='hold';Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText(text){window.__copies.push({text,active:navigator.userActivation.isActive});if(window.__copyMode==='hold')return new Promise((resolve,reject)=>window.__clipboard={resolve,reject});if(window.__copyMode==='fail')return Promise.reject(Error('synthetic_clipboard_denied'));return Promise.resolve();}}});`});
   await page.navigate();await wait(()=>!!document.querySelector('#message-quote-assistant [data-slot="message-actions"]')&&!!document.querySelector('[contenteditable=true]'));
   await check('each text message has Copy and Quote in official MessageActions',()=>['quote-user','quote-assistant'].every(id=>JSON.stringify([...document.querySelectorAll('#message-'+id+' [data-slot="message-actions"] button')].map(b=>b.getAttribute('aria-label')))==='["复制","引用"]'));
   await check('no empty message action bar',()=>!document.querySelector('#message-attachment-only [data-slot="message-actions"]'));
   await check('actions keep their mirrored desktop rails and usable touch targets',()=>{
    const touch=matchMedia('(pointer:coarse)').matches;
    return ['quote-user','quote-assistant','same-task'].every(id=>{
     const row=document.querySelector('#message-'+id),bubble=row.querySelector('.user-message-bubble,.assistant-message-bubble').getBoundingClientRect();
     const [copy,quote]=[...row.querySelectorAll('[data-slot="message-actions"] button')].map(b=>b.getBoundingClientRect());
     return touch?copy.width===44&&copy.height===44&&copy.top>=bubble.bottom&&quote.top===copy.top:
      copy.width===24&&copy.height===24&&quote.top>=copy.bottom&&(id==='quote-user'?copy.right<=bubble.left:copy.left>=bubble.right);
    });
   });
   await check('adjacent same-task titles are visually hidden, and matching names on different tasks stay separate',()=>{
    const first=document.querySelector('#message-quote-assistant'),second=document.querySelector('#message-same-task'),other=document.querySelector('#message-other-task');
    const gap=(before,after)=>Math.round(after.querySelector('.assistant-message-bubble').getBoundingClientRect().top-before.querySelector('.assistant-message-bubble').getBoundingClientRect().bottom);
    return second.parentElement.hasAttribute('data-continues-task')&&getComputedStyle(second.querySelector('.message-task-title')).clipPath!=='none'&&
     !other.parentElement.hasAttribute('data-continues-task')&&getComputedStyle(other.querySelector('.message-task-title')).clipPath==='none'&&
     gap(first,second)===(matchMedia('(pointer:coarse)').matches?54:8)&&gap(second,other)>gap(first,second);
   });
   const timeBoxes=await page.evaluate(()=>[...document.querySelectorAll('.message-bubble-row')].map(row=>{
    const bubble=row.firstElementChild,time=bubble.querySelector('time');
    const b=bubble.getBoundingClientRect(),t=time.getBoundingClientRect();
    const text=document.createTreeWalker(bubble.querySelector('[data-aui-quote-selectable]'),NodeFilter.SHOW_TEXT);
    const range=document.createRange(),overlaps=[];
    for(let node=text.nextNode();node;node=text.nextNode()){
     range.selectNodeContents(node);
     if([...range.getClientRects()].some(r=>r.bottom>t.top&&r.top<t.bottom&&r.right>t.left&&r.left<t.right))overlaps.push(node.textContent);
    }
    const blocks=[...bubble.querySelectorAll('table,pre,img,video,figure')].map(node=>node.getBoundingClientRect());
    if(blocks.some(r=>r.bottom>t.top&&r.top<t.bottom&&r.right>t.left&&r.left<t.right))overlaps.push('rich content block');
    return {id:row.parentElement.id,time:time.textContent,keyboardLabel:time.getAttribute('aria-label'),tabIndex:time.tabIndex,inside:t.right<=b.right&&t.left>=b.left,bottom:b.bottom-t.bottom,overlaps};
   }));
   assert.ok(timeBoxes.every(t=>t.keyboardLabel&&t.tabIndex===0&&t.inside&&t.bottom===5&&!t.overlaps.length),JSON.stringify(timeBoxes));
   checks.push({width,label:'bubble time is keyboard-readable and clear of the text'});
   const dims=()=>[...document.querySelectorAll('.message-bubble-row')].map(row=>{
    const b=row.firstElementChild.getBoundingClientRect();return [b.width,b.height];
   });
   const beforeFocus=await page.evaluate(dims);
   await page.evaluate(()=>document.querySelector('#message-quote-user [aria-label="复制"]').focus());
   await wait(()=>getComputedStyle(document.querySelector('#message-quote-user time')).opacity==='1');
   await check('focus exposes the matching actions and time',()=>getComputedStyle(document.querySelector('#message-quote-user [data-slot="message-actions"]')).opacity==='1');
   assert.deepEqual(await page.evaluate(dims),beforeFocus);
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
   await page.evaluate(()=>{
    document.querySelector('#message-quote-assistant').scrollIntoView({block:'center'});
    document.querySelector('#message-quote-user [aria-label="复制"]').focus({preventScroll:true});
   });
   const hover=await page.evaluate(()=>{
    const r=document.querySelector('#message-quote-assistant .assistant-message-bubble').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};
   });
   if(width!==390)await page.command('Input.dispatchMouseEvent',{type:'mouseMoved',...hover});
   await wait(()=>getComputedStyle(document.querySelector('#message-quote-assistant time')).opacity==='1');
   await page.screenshot('message-actions-'+width+'.png');
   await press(page,'[aria-label="发送消息"]');
   await wait(()=>document.querySelector('[contenteditable=true]')?.innerText.trim()==='');
   // The composer clears optimistically, before the local server receives POST.
   const receiptDeadline=Date.now()+10000;
   while(!fixture.received.messages.length&&Date.now()<receiptDeadline)await new Promise(resolve=>setTimeout(resolve,20));
   assert.equal(fixture.received.messages.length,1);const sent=fixture.received.messages[0];
   assert.equal(sent.text,'保留已写说明');assert.equal(sent.quotes[0].messageId,'quote-assistant');assert.ok(sent.quotes[0].text.includes('项目\t状态'));assert.ok(!sent.quotes[0].text.includes('https:'));
   checks.push({width,label:'send preserves the exact quote identity and draft'});
   const accepted={...message('accepted-'+sent.requestId,'user',sent.text),requestId:sent.requestId,quotes:sent.quotes};
   const stream=message('stream-copy','assistant','流式合成正文','running');
   fixture.update({messages:[...initialMessages,accepted,stream],isRunning:true,activeMessageId:stream.id});
   await wait(()=>document.querySelector('#message-stream-copy [aria-label="复制"]')||!document.querySelector('.scroll-latest').disabled);
   if(await page.evaluate(()=>!document.querySelector('.scroll-latest').disabled))await press(page,'.scroll-latest');
   await wait(()=>!!document.querySelector('#message-stream-copy [aria-label="复制"]'));
   await page.evaluate(()=>window.__copyMode='success');await press(page,'#message-stream-copy [aria-label="复制"]');
   await wait(()=>window.__copies.at(-1)?.text==='流式合成正文');checks.push({width,label:'streaming copy remains available'});
   fixture.update({messages:[...initialMessages,accepted,{...stream,text:'x'.repeat(16001)}]});
   await wait(()=>document.querySelector('#message-stream-copy .markdown')?.textContent.length===16001);
   await press(page,'#message-stream-copy [aria-label="引用"]');
   await check('long quote preserves the complete visible text',()=>JSON.parse(sessionStorage.getItem('homer-draft:composer-review')).quotes[0].text.length===16001);
   await check('no application console warnings or errors',()=>window.__console.length===0);
   {
    const earlierReply=taskReply('stream-lead','已开始核对。','receipt-task');
    const activity={processId:'receipt-process',source:'internal',stage:'native',turnId:'receipt-turn'};
    const process={id:activity.processId,messageId:'receipt',threadId:'composer-review',sourceKind:'worker',sourceMessageIds:[],turnIds:[activity.turnId],state:'working',status:'running',revision:1,seq:1,items:[]};
    const receipt={...taskReply('receipt','','receipt-task'),createdAt:earlierReply.createdAt+60000,status:'running',audience:'internal',process};
    fixture.reset({messages:[earlierReply,receipt],mainActivity:activity});
    await page.command('Page.reload');
    await wait(()=>!!document.querySelector('#message-receipt .message-task-title'));
    await check('a Worker reply without a visible answer keeps its task title',()=>!document.querySelector('#message-receipt .assistant-message-bubble')&&getComputedStyle(document.querySelector('#message-receipt .message-task-title')).clipPath==='none');
    fixture.update({mainActivity:{...activity,finalText:'流式接续正文'}});
    await wait(()=>document.querySelector('#message-receipt .assistant-message-bubble')?.textContent.includes('流式接续正文'));
    await check('the projected Worker stream groups with its preceding task before persistence',()=>document.querySelector('#message-receipt').parentElement.hasAttribute('data-continues-task')&&getComputedStyle(document.querySelector('#message-receipt .message-task-title')).clipPath!=='none');
    await check('the internal stream has no timestamp',()=>!document.querySelector('#message-receipt .message-timestamp'));
    const published={...receipt,text:'已正式发布正文',status:'completed',audience:'user',process:{...process,state:'worked',status:'completed',final:{id:receipt.id,text:'已正式发布正文'}}};
    fixture.update({messages:[earlierReply,published],mainActivity:undefined});
    const selector='#message-receipt .assistant-message-bubble > time.message-timestamp';
    const expected=new Date(receipt.createdAt).toISOString();
    await page.until('document.querySelector('+JSON.stringify(selector)+')?.dateTime==='+JSON.stringify(expected),10000);
    await check('the published reply renders exactly one timestamp without an extra date separator',()=>{
     const row=document.querySelector('#message-receipt');
     return row.querySelectorAll('time.message-timestamp').length===1&&!row.parentElement.querySelector('.message-day-separator');
    });
    await page.command('Page.reload');
    await page.until('document.querySelector('+JSON.stringify(selector)+')?.dateTime==='+JSON.stringify(expected),10000);
    if(width===390){
     await check('the published reply timestamp stays visible after refresh on touch',()=>getComputedStyle(document.querySelector('#message-receipt time')).opacity==='1');
    }else{
     await page.evaluate(()=>document.querySelector('#message-receipt').scrollIntoView({block:'center',behavior:'instant'}));
     await page.command('Input.dispatchMouseEvent',{type:'mouseMoved',x:1,y:1});
     await wait(()=>getComputedStyle(document.querySelector('#message-receipt time')).opacity==='0');
     const corner=await page.evaluate(()=>{
      const rect=document.querySelector('#message-receipt .assistant-message-bubble').getBoundingClientRect();
      return {x:rect.right-8,y:rect.bottom-8};
     });
     await page.command('Input.dispatchMouseEvent',{type:'mouseMoved',...corner});
     await wait(()=>getComputedStyle(document.querySelector('#message-receipt time')).opacity==='1');
     checks.push({width,label:'hovering the published reply bottom-right reveals its time after refresh'});
     await page.command('Input.dispatchMouseEvent',{type:'mouseMoved',x:1,y:1});
     await wait(()=>getComputedStyle(document.querySelector('#message-receipt time')).opacity==='0');
     await page.evaluate(()=>document.querySelector('#message-receipt').focus({preventScroll:true}));
     await key(page,'Tab');
     await wait(()=>document.activeElement===document.querySelector('#message-receipt time')&&getComputedStyle(document.activeElement).opacity==='1');
     checks.push({width,label:'Tab reaches and reveals the published reply timestamp'});
    }
   }
   if(width===1440){
    const replies=Array.from({length:100},(_,i)=>taskReply('group-'+i,'连续同事项回复 '+i,'virtual-task'));
    earlier=replies.slice(0,25);
    fixture.reset({messages:replies.slice(25),features:{draftUpload:true,taskOverview:false}});
    await page.command('Page.reload');
    await wait(()=>!!document.querySelector('#message-group-99')&&document.querySelector('.scroll-latest')?.disabled);
    await check('virtualized rows keep the group even when their predecessor is not mounted',()=>{
     const first=document.querySelector('[data-continues-task] > .assistant-message');
     if(!first)return false;
     const ordinal=Number(first.id.split('-').at(-1));
     return ordinal>0&&!document.getElementById('message-group-'+(ordinal-1))&&getComputedStyle(first.querySelector('.message-task-title')).clipPath!=='none';
    });
    await page.command('Input.dispatchMouseEvent',{type:'mouseWheel',x:720,y:250,deltaX:0,deltaY:-100000});
    await wait(()=>!!document.querySelector('#message-group-25'));
    await check('the first loaded message shows its task before earlier history arrives',()=>getComputedStyle(document.querySelector('#message-group-25 .message-task-title')).clipPath==='none');
    const deadline=Date.now()+10000;
    while(!releaseBefore&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));
    assert.ok(releaseBefore);
    const atBoundary=()=>document.querySelector('#message-group-25').getBoundingClientRect().top-document.querySelector('.thread-viewport').getBoundingClientRect().top;
    const saved=await page.evaluate(atBoundary);
    releaseBefore();
    await wait(()=>document.querySelector('#message-group-25')?.parentElement.hasAttribute('data-continues-task'));
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert.ok(Math.abs(await page.evaluate(atBoundary)-saved)<=2,'prepending a same-task reply preserves the reading anchor');
    await page.command('Input.dispatchMouseEvent',{type:'mouseWheel',x:720,y:250,deltaX:0,deltaY:-100000});
    await wait(()=>!!document.querySelector('#message-group-0'));
    await check('group lead keeps its title when scrolled back into view',()=>getComputedStyle(document.querySelector('#message-group-0 .message-task-title')).clipPath==='none');
    checks.push({width,label:'prepending the same task updates its grouping across the page boundary and preserves the reading anchor'});
   }
   assert.deepEqual(page.errors,[]);assert.deepEqual(page.blocked,[]);
  }catch(error){writeFileSync(join(destination,'failure-'+width+'.json'),JSON.stringify({error:String(error),state:await page.evaluate(()=>({text:document.querySelector('[contenteditable=true]')?.innerText,composer:document.querySelector('.composer-area')?.innerText,send:document.querySelector('[aria-label="发送消息"]')?.outerHTML})),received:fixture.received,errors:page.errors},null,2));await page.screenshot('failure-'+width+'.png');throw error;}finally{await page.close();}
 }
 writeFileSync(join(destination,'results.json'),JSON.stringify({checks,version:chrome.version},null,2));
 console.log(JSON.stringify({passed:checks.length,widths:[1440,390,320],evidence:destination}));
}finally{
 const exit=await chrome?.close();
 await fixture.close();
 if(exit){assert.equal(exit.code,0);assert.equal(exit.forced,false);assert.equal(exit.watchdog,false);}
}
