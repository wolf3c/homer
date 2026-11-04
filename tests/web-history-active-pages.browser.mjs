// Later-page forms and current queue DOM under real SSE; synthetic owners only.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {updateSyntheticPublicText} from './web-history-loading-fixture.js';
import {fixture} from './web-history-followup-fixture.mjs';
import {isolatedChrome} from './web-history-browser-cdp.mjs';
const destination=resolve(process.env.HOMER_BROWSER_EVIDENCE??'.codex/scratch/web-history-active-pages');
mkdirSync(destination,{recursive:true});
const browser=await isolatedChrome(destination),f=await fixture(100,'after');
try{
 for(let n=0;n<200;n++)f.inputs.accept({requestId:'tail-'+n,text:'合成排队 '+n});
 const pendingIds=[];
 for(let n=0;n<85;n++){
  const opened=f.interactions.open({runId:'main-native:pending-'+n,threadId:'synthetic-history',turnId:'turn-'+n,requestId:n,source:'native',kind:'question',details:{method:'item/tool/requestUserInput',params:{questions:[{id:'scope',question:'材料范围 '+n},{id:'notes',question:'补充说明 '+n}]}},authority:{sourceRequestId:'request-0',description:'Synthetic question',nativeApprovals:false}},()=>true);
  f.interactions.escalate(opened.id,'合成待答 '+n,'Synthetic user input');pendingIds.push(opened.id);
 }
 const page=await browser.page(f.server.url,390);
 try{
  await page.navigate();await page.until(()=>document.querySelectorAll('.interaction-question').length===80);
  await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='还有待答事项，查看下一页').click());
  await page.evaluate('window.__target='+JSON.stringify('task-interaction-'+pendingIds[80]));
  await page.until(()=>!!document.getElementById(window.__target)?.querySelector('textarea'));
  await page.evaluate(()=>{window.__editor=document.getElementById(window.__target).querySelector('textarea');window.__editor.focus();});
  await page.command('Input.insertText',{text:'后续待答草稿保留'});
  await page.evaluate(()=>document.getElementById(window.__target).querySelectorAll('textarea')[1].focus());await page.command('Input.insertText',{text:'完整说明'});
  await page.until(()=>![...document.getElementById(window.__target).querySelectorAll('button')].find(b=>b.textContent==='提交答复').disabled);
  await page.evaluate(()=>window.__editor.focus());
  await page.evaluate(()=>window.__editor.setSelectionRange(1,3));
  const stream=async n=>{updateSyntheticPublicText(f,'node-99','合成连续更新 '+n);await new Promise(done=>setTimeout(done,200));};
  for(let n=0;n<5;n++)await stream(n);
  const stable=await page.evaluate(()=>({same:document.getElementById(window.__target).querySelector('textarea')===window.__editor,focus:document.activeElement===window.__editor,draft:window.__editor.value,selection:[window.__editor.selectionStart,window.__editor.selectionEnd]}));
  assert.deepEqual(stable,{same:true,focus:true,draft:'后续待答草稿保留',selection:[1,3]});
  const owner=f.bridge.history.interactions;let release,calls=0,inFlight=0,max=0;
  const gate=new Promise(done=>{release=done;});
  f.bridge.history.interactions=async(...args)=>{calls++;inFlight++;max=Math.max(max,inFlight);try{const result=await owner(...args);if(calls===1)await gate;return result;}finally{inFlight--;}};
  await stream('delayed');
  for(let n=0;n<300&&!calls;n++)await new Promise(done=>setTimeout(done,10));assert.ok(calls>0);
  f.interactions.expire(pendingIds[81]);await new Promise(done=>setTimeout(done,200));
  assert.equal(await page.evaluate(()=>[...document.getElementById(window.__target).querySelectorAll('button')].find(b=>b.textContent==='提交答复').disabled),true);
  assert.equal(await page.evaluate(()=>document.activeElement===window.__editor&&!window.__editor.matches(':disabled')),true);
  assert.equal(f.submitted.length,0);release();await page.until(()=>document.querySelectorAll('.interaction-question').length===4);
  assert.equal(max,1);assert.ok(calls>=2);
  assert.equal(await page.evaluate(()=>document.getElementById(window.__target).querySelector('textarea')===window.__editor),true);
  // Inline queue editing was removed. The ordinary composer owns the draft;
  // queue paging, exact identity and cancellation remain current contracts.
  await page.evaluate(()=>document.querySelector('.queue-toggle').click());
  await page.until(()=>document.querySelectorAll('[data-queue-message]').length===80);
  await page.evaluate(()=>document.querySelector('.queue-pages button').click());
  await page.until(()=>[...document.querySelectorAll('.aui-queue-text')].some(e=>e.textContent==='合成排队 80'));
  await page.evaluate(()=>{window.__queueRow=[...document.querySelectorAll('[data-queue-message]')].find(e=>e.querySelector('.aui-queue-text').textContent==='合成排队 80');window.__composer=document.querySelector('[contenteditable=true]');window.__composer.focus();});
  await page.command('Input.insertText',{text:'普通输入草稿保留'});
  for(let n=0;n<5;n++)await stream('queue-'+n);
  const queue=await page.evaluate(()=>({sameRow:window.__queueRow.isConnected,sameComposer:window.__composer===document.querySelector('[contenteditable=true]'),focus:document.activeElement===window.__composer,draft:window.__composer.textContent,count:document.querySelectorAll('[data-queue-message]').length}));
  assert.deepEqual(queue,{sameRow:true,sameComposer:true,focus:true,draft:'普通输入草稿保留',count:80});
  const cancelled=f.inputs.byRequestIds(['tail-81'])[0];f.inputs.cancel({requestId:'tail-81',operationId:'synthetic-owner-cancel',expectedRevision:cancelled.revision});
  await page.until(()=>![...document.querySelectorAll('.aui-queue-text')].some(e=>e.textContent==='合成排队 81'));
  await page.evaluate(()=>document.querySelector('.queue-pages button').click());
  await page.until(()=>[...document.querySelectorAll('.aui-queue-text')].some(e=>e.textContent==='合成排队 80'));
  assert.equal(await page.evaluate(()=>[...document.querySelectorAll('.aui-queue-text')].some(e=>e.textContent==='合成排队 81')),false);
  assert.equal(await page.evaluate(()=>window.__composer===document.querySelector('[contenteditable=true]')&&window.__composer.textContent==='普通输入草稿保留'),true);
  await page.screenshot('active-pages-390.png');assert.equal(f.submitted.length,0);assert.equal(f.fakeEngine.invocations,0);assert.deepEqual(page.errors,[]);assert.deepEqual(page.blocked,[]);
  writeFileSync(join(destination,'active-pages-browser.json'),JSON.stringify({stable,queue,slowResponse:{calls,max},expiredId:pendingIds[81],cancelledRequest:'tail-81',submits:0},null,2));
 }finally{await page.close();}
}finally{await f.close();await browser.close();}
