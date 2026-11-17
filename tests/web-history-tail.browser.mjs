// Production UI/HTTP/SSE, synthetic owners, isolated Chrome only.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fixture} from './web-history-followup-fixture.mjs';
import {updateSyntheticPublicText} from './web-history-loading-fixture.js';
import {isolatedChrome} from './web-history-browser-cdp.mjs';
const destination=resolve(process.env.HOMER_BROWSER_EVIDENCE);
mkdirSync(destination,{recursive:true});
const chrome=await isolatedChrome(destination,{mockKeychain:true}),results=[];
const settle=page=>page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
const anchor=page=>page.evaluate(()=>{const view=document.querySelector('.thread-viewport'),box=view.getBoundingClientRect(),row=[...view.querySelectorAll('[data-conversation-message]')].find(e=>e.getBoundingClientRect().bottom>box.top);return {id:row.dataset.conversationMessage,offset:row.getBoundingClientRect().top-box.top,gap:view.scrollHeight-view.clientHeight-view.scrollTop};});
async function anchorError(page,saved){return page.evaluate(`Math.abs(document.getElementById('message-'+${JSON.stringify(saved.id)}).getBoundingClientRect().top-document.querySelector('.thread-viewport').getBoundingClientRect().top-(${saved.offset}))`);}
try{
 for(const width of [1440,390,320]){
  const f=await fixture(400,'after'),reads=[];let page;
  try{
   for(let n=0;n<400;n++)updateSyntheticPublicText(f,'node-'+n,'合成历史答复 '+n+'。'+ '这是用于核对连续消息的隔离内容。'.repeat(4));
   f.store.db.prepare('UPDATE conversation_messages SET quote=? WHERE id=?').run(JSON.stringify({messageId:'node-100',text:'合成历史答复 100',annotation:'定位较早消息'}),'user-399');
   const original=f.bridge.history.page;f.bridge.history.page=async input=>{const value=await original(input);reads.push({request:input.request,units:value.units.length});return value;};
   page=await chrome.page(f.server.url,width);await page.navigate();
   await page.until(()=>!!document.querySelector('#message-user-399 .message-quote-source'));
   await page.evaluate(()=>document.querySelector('#message-user-399 .message-quote-source').click());
   await page.until(()=>!!document.getElementById('message-node-100')&&!!document.getElementById('message-node-399')&&!document.body.textContent.includes('正在补齐后续消息'));
   await settle(page);const saved=await anchor(page);assert.ok(saved.gap>500,'history navigation must not force the reader to bottom');
   const continuous=await page.evaluate(()=>{const ids=[...document.querySelectorAll('[data-conversation-message]')].map(e=>e.dataset.conversationMessage);return {count:ids.length,unique:new Set(ids).size,missing:Array.from({length:299},(_,i)=>i+101).filter(n=>!ids.includes('node-'+n)||!ids.includes('user-'+n))};});
   assert.deepEqual(continuous.missing,[]);assert.equal(continuous.unique,continuous.count);assert.ok(reads.filter(r=>r.request.after).length>=4);assert.ok(reads.every(r=>r.units<=80));
   await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='加载更早消息').click());
   await page.until(()=>!!document.getElementById('message-node-60'));await settle(page);
   const prependAnchorError=await anchorError(page,saved);assert.ok(prependAnchorError<=2,'prepend keeps the same reading anchor');
   const live=f.attach('这是自动接入的实时新消息。');
   await page.until(`!!document.getElementById('message-'+${JSON.stringify(live.messageId)})&&document.querySelector('.scroll-latest').textContent.includes('有新内容')`);await settle(page);
   const liveAnchorError=await anchorError(page,saved);assert.ok(liveAnchorError<=2,'live append keeps the reading anchor');
   await page.screenshot('tail-reading-'+width+'.png');
   const reconnects=page.requests.filter(r=>r.path==='/api/history/events').length;
   f.server.disconnectClients();const missed=[];
   for(let n=0;n<171;n++)missed.push(f.attach('断线期间的合成新消息 '+n).messageId);
   f.server.publish();
   await page.until(`(()=>{const ids=${JSON.stringify(missed)};return ids.every(id=>document.getElementById('message-'+id))&&!document.body.textContent.includes('正在补齐后续消息');})()`);
   await settle(page);const reconnectAnchorError=await anchorError(page,saved);assert.ok(reconnectAnchorError<=2,'multi-page reconnect keeps the reading anchor');
   assert.ok(page.requests.filter(r=>r.path==='/api/history/events').length>reconnects);
   await page.screenshot('tail-reconnected-'+width+'.png');
   await page.command('Input.dispatchMouseEvent',{type:'mouseWheel',x:width/2,y:300,deltaX:0,deltaY:1000000});
   await page.until(()=>document.querySelector('.scroll-latest').disabled);
   const bottom=await anchor(page);assert.ok(bottom.gap<=1);
   assert.equal(await page.evaluate(()=>[...document.querySelectorAll('button')].filter(b=>b.textContent.includes('加载后续消息')||b.textContent.includes('回到最新')).length),0);
   assert.equal(await page.evaluate(()=>document.querySelectorAll('.scroll-latest').length),1);
   assert.equal(await page.evaluate(()=>{const ids=[...document.querySelectorAll('[data-conversation-message]')].map(e=>e.dataset.conversationMessage);return ids.length-new Set(ids).size;}),0);
   assert.equal(f.submitted.length,0);assert.equal(f.stopped.length,0);assert.equal(f.fakeEngine.invocations,0);assert.deepEqual(page.errors,[]);assert.deepEqual(page.blocked,[]);
   await page.screenshot('tail-latest-'+width+'.png');
   results.push({width,continuous,prependAnchorError,liveAnchorError,reconnectAnchorError,recovered:missed.length,reads,bottomGap:bottom.gap,errors:page.errors});
  }finally{await page?.close();await f.close();}
 }
 for(const width of [1440,390,320]){
  const f=await fixture(400,'after');let page,calls=0,release;
  try{
   for(let n=0;n<400;n++)updateSyntheticPublicText(f,'node-'+n,'合成历史答复 '+n+'。'+ '隔离重试验收。'.repeat(4));
   f.store.db.prepare('UPDATE conversation_messages SET quote=? WHERE id=?').run(JSON.stringify({messageId:'node-100',text:'历史定位',annotation:'重试验收'}),'user-399');
   const original=f.bridge.history.page;f.bridge.history.page=async input=>{
    if(input.request.after){calls++;if(calls===1)throw Error('synthetic_transient_failure');if(calls===2)await new Promise(done=>{release=done;});}
    return original(input);
   };
   page=await chrome.page(f.server.url,width);await page.navigate();await page.until(()=>!!document.querySelector('#message-user-399 .message-quote-source'));
   await page.evaluate(()=>document.querySelector('#message-user-399 .message-quote-source').click());
   await page.until(()=>document.body.textContent.includes('后续消息暂未读全'));await settle(page);
   const saved=await anchor(page);assert.equal(calls,1);
   await page.evaluate(()=>document.querySelector('.scroll-latest').click());await page.until(()=>document.body.textContent.includes('正在补齐后续消息'));
   assert.equal(calls,2);await page.evaluate(()=>{document.querySelector('.scroll-latest').click();document.querySelector('.scroll-latest').click();});await settle(page);
   assert.equal(calls,2);assert.ok(await anchorError(page,saved)<=2);release();
   await page.until(()=>!!document.getElementById('message-node-399')&&document.querySelector('.scroll-latest').disabled,10000);await settle(page);
   const bottom=await anchor(page);assert.ok(bottom.gap<=1);assert.equal(await page.evaluate(()=>{const ids=[...document.querySelectorAll('[data-conversation-message]')].map(e=>e.dataset.conversationMessage);return ids.length-new Set(ids).size;}),0);
   assert.deepEqual(page.errors,[]);assert.deepEqual(page.blocked,[]);assert.equal(f.fakeEngine.invocations,0);assert.equal(f.submitted.length,0);
   await page.screenshot('tail-retry-'+width+'.png');results.push({width,retry:true,calls,bottomGap:bottom.gap});
  }catch(error){await page?.screenshot('retry-failure-'+width+'.png');writeFileSync(join(destination,'retry-failure-'+width+'.json'),JSON.stringify({error:String(error),calls,anchor:await anchor(page),body:await page.evaluate(()=>document.body.innerText),requests:page.requests},null,2));throw error;}finally{release?.();await page?.close();await f.close();}
 }
}finally{const exit=await chrome.close();assert.equal(exit.code,0);assert.equal(exit.forced,false);assert.equal(exit.watchdog,false);writeFileSync(join(destination,'tail-results.json'),JSON.stringify({syntheticOnly:true,results},null,2));}
assert.equal(results.length,6);
