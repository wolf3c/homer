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
 const workerContexts=[];
 for(const width of [1440,390,320]){
  const work=await fixture(4,'after'),p=await browser.page(work.server.url,width);
  try{
   const threadId=work.store.meta('mainThread'),sourceRequestId='worker-context-source';
   work.inputs.accept({requestId:sourceRequestId,text:'合成：在关于荷马显示版本号'});
   const source=work.inputs.claim();assert.equal(source.origin,'user');
   work.inputs.started(source.messageId,source.revision,'context-source-generation','context-source-turn');work.inputs.finish(source.messageId,source.revision,'completed');
   const actor={agentId:work.store.meta('mainAgentId'),threadId,turnId:'context-source-turn',sourceRequestId,inputMessageId:source.messageId};
   const task=work.tasks.createTask(actor,{operationId:'context-task',title:'关于荷马显示版本号',goal:'Synthetic UI context only',authority:{sourceRequestId,description:'Synthetic only'}});
   const opened=work.tasks.workerOpen(actor,{operationId:'context-open',taskId:task.taskId,text:'Synthetic work'}),run=work.tasks.claim(opened.runId);
   work.tasks.bind(run.id,run.epoch,'context-worker-thread','context-worker-turn');
   const returned=work.tasks.endSegment(run.id,run.epoch,{status:'completed',text:'PRIVATE_WORKER_CONTEXT_BODY'},true);
   const input=work.inputs.claim([],'all');assert.equal(input.messageId,returned.messageId);
   const processId='worker-context-'+width;
   work.bridge.queue.cancel=async change=>work.inputs.cancel(change);
   await p.navigate();await p.until(()=>!!document.querySelector('.queue-toggle'));
   await p.evaluate(()=>document.querySelector('.queue-toggle').click());
   await p.until(()=>document.querySelectorAll('[data-queue-message]').length===1);
   assert.equal(await p.evaluate(()=>document.querySelector('.message-task-title')?.textContent),undefined,'offered without ACK has no task header');
   assert.equal(await p.evaluate(()=>document.body.textContent.includes('PRIVATE_WORKER_CONTEXT_BODY')),false);
   await p.evaluate(()=>{window.__composer=document.querySelector('[contenteditable=true]');window.__composer.focus();});
   await p.command('Input.insertText',{text:'保留这份合成草稿'});
   await p.evaluate(()=>document.querySelector('.queue-toggle').focus());
   work.inputs.started(input.messageId,input.revision,'context-generation','context-main-turn');
   work.processes.start({id:processId,threadId,sourceKind:'worker',sourceMessageIds:[input.messageId],messageId:processId},'context-main-turn',undefined,'合成：已收到协作消息，核对公开结果。');
   work.history.record(processId,threadId,'','running');
   await p.evaluate('window.__processId='+JSON.stringify('message-'+processId));
   await p.until(()=>document.getElementById(window.__processId)?.querySelector('.message-task-title')?.textContent==='关于荷马显示版本号'&&!document.querySelector('.homer-message-queue'));
   assert.equal(await p.evaluate(()=>document.activeElement===window.__composer),true,'removing the focused queue returns focus to the composer');
   assert.equal(await p.evaluate(()=>document.getElementById(window.__processId).querySelector('.assistant-message-bubble')),null,'no invented empty answer');
   await p.evaluate(()=>{window.__process=document.getElementById(window.__processId);window.__run=window.__process.querySelector('[data-slot=collapsible-trigger]');});
   assert.match(await p.evaluate(()=>window.__run.textContent),/^处理过程 ·/);
   await p.screenshot('worker-context-processing-'+width+'.png');
   work.inputs.accept({requestId:'context-pending-user',text:'截图完成后再发改动摘要'});
   await p.until(()=>document.querySelectorAll('[data-queue-message]').length===1);
   assert.equal(await p.evaluate(()=>document.querySelector('.aui-queue-text').textContent),'截图完成后再发改动摘要');
   await p.evaluate(()=>window.__run.click());await p.until(()=>window.__run.getAttribute('aria-expanded')==='true');
   await p.evaluate(()=>{const viewport=document.querySelector('.thread-viewport');viewport.scrollTop=0;window.__readerTop=viewport.scrollTop;});
   await p.until(()=>!document.querySelector('.scroll-latest').disabled);
   work.history.finish(processId,'合成公开进展','running');
   await p.until(()=>document.getElementById(window.__processId)?.textContent.includes('合成公开进展'));
   assert.equal(await p.evaluate(()=>document.querySelector('.thread-viewport').scrollTop),await p.evaluate(()=>window.__readerTop),'an update below does not pull a history reader to the bottom');
   assert.deepEqual(await p.evaluate(()=>({sameMessage:window.__process===document.getElementById(window.__processId),sameComposer:window.__composer===document.querySelector('[contenteditable=true]'),draft:window.__composer.textContent,expanded:window.__run.getAttribute('aria-expanded'),titles:window.__process.querySelectorAll('.message-task-title').length})),{sameMessage:true,sameComposer:true,draft:'保留这份合成草稿',expanded:'true',titles:1});
   await p.evaluate(()=>document.querySelector('.scroll-latest').click());
   await p.command('Emulation.setDeviceMetricsOverride',{width:width===1440?390:1440,height:900,deviceScaleFactor:1,mobile:false});
   await p.command('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
   assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   assert.equal(await p.evaluate(()=>window.__run.getAttribute('aria-expanded')),'true');
   await p.screenshot('worker-context-mixed-'+width+'.png');
   await p.evaluate(()=>window.__run.click());
   work.processes.finish(processId,'completed','context-main-terminal','合成最终答复');work.history.finish(processId,'合成最终答复','completed');
   await p.until(()=>document.getElementById(window.__processId)?.textContent.includes('合成最终答复')&&!document.getElementById(window.__processId).querySelector('.process-node'));
   assert.equal(await p.evaluate(()=>document.querySelectorAll('[data-queue-message]').length),1,'the stale processing receipt stays out of the queue after completion');
   assert.equal(await p.evaluate(()=>document.getElementById(window.__processId).querySelectorAll('.message-task-title').length),1);
   work.store.transaction(()=>work.tasks.completeMainMessagesInTransaction([input.messageId],'context-generation'));
   await p.command('Page.reload');await p.until(()=>document.querySelector('[data-conversation-message^="worker-context-"]')?.textContent.includes('合成最终答复'));
   await p.until(()=>document.querySelectorAll('[data-queue-message]').length===1);
   await p.screenshot('worker-context-completed-'+width+'.png');
   await p.evaluate(()=>{const toggle=document.querySelector('.queue-toggle');if(toggle.getAttribute('aria-expanded')!=='true')toggle.click();});
   await p.evaluate(()=>document.querySelector('.aui-queue-remove').click());await p.until(()=>!document.querySelector('.homer-message-queue'));
   assert.equal(work.inputs.byRequestIds(['context-pending-user'])[0].state,'cancelled');
   assert.equal(await p.evaluate(()=>document.querySelector('[contenteditable=true]').textContent),'保留这份合成草稿');
   assert.equal(work.submitted.length,0);assert.equal(work.fakeEngine.invocations,0);assert.deepEqual(p.errors,[]);assert.deepEqual(p.blocked,[]);
   workerContexts.push({width,passed:true,offeredRetained:true,titleBeforeAnswer:true,ownedFocusRestored:true,userQueuePreserved:true,sameMessage:true,draftPreserved:true,historyPositionPreserved:true,resize:true,refresh:true,emptyQueueRemoved:true});
  }catch(error){await p.screenshot('worker-context-failure-'+width+'.png');throw error;}
  finally{await p.close();await work.close();}
 }
 writeFileSync(join(destination,'worker-context-browser.json'),JSON.stringify(workerContexts,null,2));
}finally{await f.close();await browser.close();}
