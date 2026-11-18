// Production UI/HTTP/SSE, synthetic owners, isolated Chrome only.
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fixture} from './web-history-followup-fixture.mjs';
import {updateSyntheticPublicText} from './web-history-loading-fixture.js';
import {isolatedChrome} from './web-history-browser-cdp.mjs';
const sourceSelection=buildSync({entryPoints:['ui/message-source-selection.ts'],bundle:true,write:false,format:'iife',globalName:'SourceQuote',platform:'browser',logLevel:'silent'}).outputFiles[0].text;
const silence=Buffer.alloc(44+16000);silence.write('RIFF');silence.writeUInt32LE(silence.length-8,4);silence.write('WAVEfmt ',8);silence.writeUInt32LE(16,16);silence.writeUInt16LE(1,20);silence.writeUInt16LE(1,22);silence.writeUInt32LE(8000,24);silence.writeUInt32LE(16000,28);silence.writeUInt16LE(2,32);silence.writeUInt16LE(16,34);silence.write('data',36);silence.writeUInt32LE(16000,40);
const destination=resolve(process.env.HOMER_BROWSER_EVIDENCE);
mkdirSync(destination,{recursive:true});
const chrome=await isolatedChrome(destination,{mockKeychain:true}),results=[];
const settle=page=>page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
const anchor=page=>page.evaluate(()=>{const view=document.querySelector('.thread-viewport'),box=view.getBoundingClientRect(),row=[...view.querySelectorAll('[data-conversation-message]')].find(e=>e.getBoundingClientRect().bottom>box.top);return {id:row.dataset.conversationMessage,offset:row.getBoundingClientRect().top-box.top,gap:view.scrollHeight-view.clientHeight-view.scrollTop};});
async function anchorError(page,saved){return page.evaluate(`Math.abs(document.getElementById('message-'+${JSON.stringify(saved.id)}).getBoundingClientRect().top-document.querySelector('.thread-viewport').getBoundingClientRect().top-(${saved.offset}))`);}
try{
 {
  const f=await fixture(80,'after');let page,timeout;
  try{
   updateSyntheticPublicText(f,'node-79','合成答复，[测试链接](https://example.invalid/history)');
   page=await chrome.page(f.server.url,1440);await page.navigate();
   const ready=page.until(()=>!!document.querySelector('#message-node-79 .markdown a')
    &&!!document.querySelector('#task-status-summary [data-count]')
    &&document.querySelector('.scroll-latest')?.disabled);
   await Promise.race([ready,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('Markdown link kept history initialization from settling')),10000);})]);
   await page.evaluate(()=>document.querySelector('#message-node-79 button[aria-label="引用"]').click());
   await page.until(()=>!!document.querySelector('.composer-reference-strip button[aria-label="编辑引用 1"]'));
   await page.command('Input.insertText',{text:'合成草稿'});
   await page.until(()=>document.querySelector('.composer-input [contenteditable="true"]')?.textContent.includes('合成草稿'));
   await page.evaluate(()=>document.querySelector('button[aria-label="设置"]').click());
   await page.until(()=>!!document.querySelector('.desktop-settings-popup'));
   assert.equal(f.submitted.length,0);
   assert.deepEqual(page.errors,[]);
  }finally{clearTimeout(timeout);await page?.close();await f.close();}
 }
 for(const width of [1440,390,320]){
  const f=await fixture(400,'after'),reads=[];let page,beforeRelease;
  try{
   for(let n=0;n<400;n++)updateSyntheticPublicText(f,'node-'+n,'合成历史答复 '+n+'。'+ '这是用于核对连续消息的隔离内容。'.repeat(4));
   f.addUserMedia(100,silence,'voice');
   f.store.db.prepare('UPDATE conversation_messages SET quote=? WHERE id=?').run(JSON.stringify({messageId:'node-100',text:'合成历史答复 100',annotation:'定位较早消息'}),'user-399');
   const original=f.bridge.history.page;f.bridge.history.page=async input=>{if(input.request.before)await new Promise(done=>{beforeRelease=done;});const value=await original(input);reads.push({request:input.request,units:value.units.length});return value;};
   page=await chrome.page(f.server.url,width);await page.navigate();
   await page.until(()=>!!document.querySelector('#message-user-399 .message-quote-source'));
   await page.evaluate(()=>document.querySelector('#message-user-399 .message-quote-source').click());
   await page.until(()=>!!document.getElementById('message-node-100')&&window.__historyWindow?.messages.some(m=>m.id==='node-399')&&!document.body.textContent.includes('正在补齐后续消息'));
   await settle(page);let saved=await anchor(page);assert.ok(saved.gap>500,'history navigation must not force the reader to bottom');
   const continuous=await page.evaluate(()=>{const ids=window.__historyWindow.messages.map(m=>m.id);return {count:ids.length,unique:new Set(ids).size,missing:Array.from({length:299},(_,i)=>i+101).filter(n=>!ids.includes('node-'+n)||!ids.includes('user-'+n))};});
   assert.deepEqual(continuous.missing,[]);assert.equal(continuous.unique,continuous.count);assert.ok(reads.filter(r=>r.request.after).length>=4);assert.ok(reads.every(r=>r.units<=80));
   // A cached offscreen quote remounts without another around request.
   const precise=await page.evaluate(`(async()=>{${sourceSelection};const body=document.querySelector('#message-user-100 [data-aui-quote-selectable]'),walker=document.createTreeWalker(body,NodeFilter.SHOW_TEXT);let text;while(text=walker.nextNode())if(text.textContent.includes('合成问题 100'))break;const range=document.createRange(),start=text.textContent.indexOf('合成问题 100');range.setStart(text,start);range.setEnd(text,start+'合成问题 100'.length);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);const snapshot=SourceQuote.captureSourceQuoteSelection(selection);if(!snapshot)throw Error('synthetic quote capture failed: '+body.outerHTML);return SourceQuote.completeSourceQuote(snapshot);})()`);
   f.store.transaction(()=>f.store.db.prepare('UPDATE conversation_messages SET quote=? WHERE id=?').run(JSON.stringify(precise),'user-399'));f.server.publish();
   const aroundReads=reads.filter(r=>r.request.around).length;
   await page.evaluate(()=>document.querySelector('.scroll-latest').click());await page.until(()=>document.querySelector('.scroll-latest').disabled);await settle(page);
   await page.evaluate(()=>document.querySelector('#message-user-399 .message-quote-source').click());
   await page.until(()=>{const row=document.getElementById('message-user-100')?.getBoundingClientRect(),view=document.querySelector('.thread-viewport').getBoundingClientRect();return row&&row.bottom>view.top&&row.top<view.bottom;});await settle(page);
   assert.equal(reads.filter(r=>r.request.around).length,aroundReads);
   assert.match(await page.evaluate(()=>window.getSelection()?.toString()??''),/合成问题 100/);
   const selectedText=await page.evaluate(()=>{const first=document.querySelector('#message-user-99 [data-aui-quote-selectable]'),last=document.querySelector('#message-user-101 [data-aui-quote-selectable]'),a=document.createTreeWalker(first,NodeFilter.SHOW_TEXT).nextNode(),b=document.createTreeWalker(last,NodeFilter.SHOW_TEXT).nextNode(),range=document.createRange();range.setStart(a,0);range.setEnd(b,b.textContent.length);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);return selection.toString();});
   await page.evaluate(()=>document.querySelector('.scroll-latest').click());await page.until(()=>document.querySelector('.scroll-latest').disabled);await settle(page);
   assert.equal(await page.evaluate(()=>window.getSelection().toString()),selectedText);
   assert.equal(await page.evaluate(()=>['user-99','node-99','user-100','node-100','user-101'].every(id=>document.getElementById('message-'+id))),true,'the interior of a native selection stays mounted');
   await page.evaluate(()=>{window.getSelection()?.removeAllRanges();document.querySelector('[contenteditable="true"]').focus();});
   await page.until(()=>!document.getElementById('message-user-100'));
   await page.evaluate(()=>document.querySelector('#message-user-399 .message-quote-source').click());await page.until(()=>!!document.getElementById('message-user-100'));await settle(page);
   await page.evaluate(()=>window.getSelection()?.removeAllRanges());
   await page.until(()=>!!document.querySelector('#message-user-100 audio'));
   const playing=await page.command('Runtime.evaluate',{expression:`(async()=>{const audio=document.querySelector('#message-user-100 audio');audio.loop=true;audio.muted=true;await audio.play();return !audio.paused;})()`,awaitPromise:true,userGesture:true,returnByValue:true});
   assert.equal(playing.result?.value,true,'the actual LazyMedia attachment starts playing');
   await page.evaluate(()=>{document.querySelector('[contenteditable="true"]').focus();document.querySelector('.scroll-latest').click();});await page.until(()=>document.querySelector('.scroll-latest').disabled);await settle(page);
   assert.equal(await page.evaluate(()=>{const audio=document.querySelector('#message-user-100 audio');return !!audio?.isConnected&&!audio.paused;}),true,'active media survives leaving its row');
   await page.evaluate(()=>{const audio=document.querySelector('#message-user-100 audio');audio.pause();});await page.until(()=>!document.getElementById('message-user-100'));
   await page.evaluate(()=>document.querySelector('#message-user-399 .message-quote-source').click());await page.until(()=>!!document.getElementById('message-user-100'));await settle(page);await page.evaluate(()=>window.getSelection()?.removeAllRanges());
   await page.evaluate(()=>document.querySelector('#message-user-100 button').focus({preventScroll:true}));
   await page.command('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,nativeVirtualKeyCode:9});await page.command('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,nativeVirtualKeyCode:9});await settle(page);
   assert.equal(await page.evaluate(()=>!!document.activeElement?.isConnected&&document.activeElement!==document.body),true,'native Tab navigation keeps a connected focus target');
   // Hold one before page so we can measure the actual top reading anchor.
   await page.command('Input.dispatchMouseEvent',{type:'mouseWheel',x:width/2,y:300,deltaX:0,deltaY:-1000000});
   for(let n=0;n<100&&!beforeRelease;n++)await new Promise(done=>setTimeout(done,20));assert.ok(beforeRelease,'scrolling up automatically requests before');
   await settle(page);saved=await anchor(page);beforeRelease();beforeRelease=undefined;
   await page.until(()=>window.__historyWindow.messages.some(m=>m.id==='node-21'));await settle(page);
   const prependAnchorError=await anchorError(page,saved);writeFileSync(join(destination,'prepend-'+width+'.json'),JSON.stringify({saved,actual:await anchor(page),prependAnchorError,reads},null,2));await page.screenshot('prepend-'+width+'.png');assert.ok(prependAnchorError<=2,'prepend keeps the same reading anchor');
   // A real image sizing above the visible row must not shift that row.
   const image=await page.evaluate(()=>{const view=document.querySelector('.thread-viewport'),top=view.getBoundingClientRect().top,rows=[...view.querySelectorAll('[data-conversation-message]')],above=rows.filter(row=>row.getBoundingClientRect().bottom<=top).at(-1);if(!above)return false;const img=document.createElement('img');img.id='synthetic-history-image';img.style.display='block';img.width=100;above.append(img);img.src='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="210"><rect width="100" height="210" fill="gray"/></svg>');return true;});
   assert.ok(image);await page.until(()=>document.getElementById('synthetic-history-image')?.complete);await settle(page);const imageAnchorError=await anchorError(page,saved);assert.ok(imageAnchorError<=2,'image measurement keeps the reading anchor');
   const longBody='这是自动接入的实时新消息。'+'持续新增长正文。'.repeat(2500),live=f.attach(longBody);
   await page.until(`window.__historyWindow.messages.some(m=>m.id===${JSON.stringify(live.messageId)})&&document.querySelector('.scroll-latest').textContent.includes('有新内容')`);await settle(page);
   const liveAnchorError=await anchorError(page,saved);assert.ok(liveAnchorError<=2,'live append keeps the reading anchor');
   await page.screenshot('tail-reading-'+width+'.png');
   const longStart=Date.now();await page.evaluate(()=>document.querySelector('.scroll-latest').click());await page.until(()=>document.querySelector('.scroll-latest').disabled);await settle(page);
   const longRendered=await page.evaluate(`(()=>{const row=document.getElementById('message-'+${JSON.stringify(live.messageId)});return row?.textContent.includes('持续新增长正文。');})()`);assert.equal(longRendered,true);const longJumpMs=Date.now()-longStart;
   await page.evaluate(`(()=>{const link=document.createElement('a');link.href='#message-'+${JSON.stringify(saved.id)};document.querySelector('.thread-viewport').append(link);link.click();link.remove();})()`);
   await page.until(`(()=>{const row=document.getElementById('message-'+${JSON.stringify(saved.id)})?.getBoundingClientRect(),view=document.querySelector('.thread-viewport').getBoundingClientRect();return row&&row.bottom>view.top&&row.top<view.bottom;})()`);await settle(page);saved=await anchor(page);
   const resizeErrors=[];for(const nextWidth of [width===1440?1320:width+40,width]){
    await page.command('Emulation.setDeviceMetricsOverride',{width:nextWidth,height:900,deviceScaleFactor:1,mobile:false});await settle(page);await settle(page);
    await page.until(`Math.abs(document.getElementById('message-'+${JSON.stringify(saved.id)}).getBoundingClientRect().top-document.querySelector('.thread-viewport').getBoundingClientRect().top-(${saved.offset}))<=2`);
    await settle(page);const error=await anchorError(page,saved);assert.ok(error<=2,'width remeasurement preserves the reading anchor');resizeErrors.push(error);
   }
   const reconnects=page.requests.filter(r=>r.path==='/api/history/events').length;
   f.server.disconnectClients();const missed=[];
   for(let n=0;n<171;n++)missed.push(f.attach('断线期间的合成新消息 '+n).messageId);
   f.server.publish();
   await page.until(`(()=>{const ids=${JSON.stringify(missed)};return ids.every(id=>window.__historyWindow.messages.some(m=>m.id===id))&&!document.body.textContent.includes('正在补齐后续消息');})()`);
   await settle(page);const reconnectAnchorError=await anchorError(page,saved);assert.ok(reconnectAnchorError<=2,'multi-page reconnect keeps the reading anchor');
   assert.ok(page.requests.filter(r=>r.path==='/api/history/events').length>reconnects);
   await page.screenshot('tail-reconnected-'+width+'.png');
   // A single huge wheel tick targets an estimated end. Finish the physical
   // wheel gesture after newly exposed dynamic rows have been measured.
   let wheelTicks=0,bottom;
   do{await page.command('Input.dispatchMouseEvent',{type:'mouseWheel',x:width/2,y:300,deltaX:0,deltaY:1000000});await settle(page);await settle(page);bottom=await anchor(page);wheelTicks++;}while(bottom.gap>1&&wheelTicks<3);
   writeFileSync(join(destination,'bottom-'+width+'.json'),JSON.stringify({...bottom,wheelTicks},null,2));assert.ok(bottom.gap<=1,'continued physical scrolling reaches the actual measured end');
   await page.until(()=>document.querySelector('.scroll-latest').disabled);
   assert.equal(await page.evaluate(()=>[...document.querySelectorAll('button')].filter(b=>b.textContent.includes('加载后续消息')||b.textContent.includes('回到最新')).length),0);
   assert.equal(await page.evaluate(()=>document.querySelectorAll('.scroll-latest').length),1);
   assert.equal(await page.evaluate(()=>{const ids=[...document.querySelectorAll('[data-conversation-message]')].map(e=>e.dataset.conversationMessage);return ids.length-new Set(ids).size;}),0);
   assert.equal(f.submitted.length,0);assert.equal(f.stopped.length,0);assert.equal(f.fakeEngine.invocations,0);assert.deepEqual(page.errors,[]);assert.deepEqual(page.blocked,[]);
   await page.screenshot('tail-latest-'+width+'.png');
   results.push({width,continuous,longBodyCharacters:longBody.length,longJumpMs,resizeErrors,cachedQuoteAroundRequests:reads.filter(r=>r.request.around).length-aroundReads,imageAnchorError,prependAnchorError,liveAnchorError,reconnectAnchorError,recovered:missed.length,wheelTicks,reads,bottomGap:bottom.gap,errors:page.errors});
  }finally{beforeRelease?.();await page?.close();await f.close();}
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
