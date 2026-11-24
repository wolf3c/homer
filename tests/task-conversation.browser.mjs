import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {fixture} from './web-history-followup-fixture.mjs';
import {isolatedChrome} from './web-history-browser-cdp.mjs';
import {updateSyntheticPublicText} from './web-history-loading-fixture.js';
import {MainInputs} from '../src/recursive-main-inputs.js';
import {readTaskReference} from '../src/task-overview.js';

const chrome=await isolatedChrome(resolve(process.env.HOMER_BROWSER_EVIDENCE),{mockKeychain:true});
let checks=0;
const check=(value,label)=>{assert.ok(value,label);checks++;};
try{
 for(const width of [1440,390,320]){
  const f=await fixture(160,'after'),thread='synthetic-history',db=f.store.db;
  const page=await chrome.page(f.server.url,width);
  const click=async selector=>{
   const box=await page.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return; e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
   assert.ok(box,selector);
   await page.command('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...box});
   await page.command('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...box});
  };
  const exists=selector=>page.until(`!!document.querySelector(${JSON.stringify(selector)})`,7000);
  const text=(selector)=>page.evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent`);
  const insert=async (selector,value)=>{
   await page.evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
   await page.command('Input.insertText',{text:value});
  };
  try{
   f.store.setMeta('mainAgentId','main:synthetic');
   const create=(name,requestId)=>f.tasks.createTask({agentId:'main:synthetic',threadId:thread,sourceRequestId:requestId},
    {operationId:'task-'+requestId,goal:name,title:name,notes:'合成工作笔记',workingDirectory:process.cwd()}).taskId;
   const a=create('合成事项 A','request-0'),b=create('合成事项 B','request-1');
   f.tasks.workerOpen({agentId:'main:synthetic',threadId:thread,sourceRequestId:'request-0'},
    {operationId:'synthetic-assignment',taskId:a,text:'检查合成访谈资料',workTitle:'复核补货访谈纪要',workingDirectory:process.cwd()});
   for(const index of [9,60,121,154]){
    db.prepare('UPDATE conversation_messages SET quote=? WHERE id=?').run(JSON.stringify({taskReference:{taskId:a,version:1,title:'合成事项 A'}}),'user-'+index);
    updateSyntheticPublicText(f,'node-'+index,'合成事项答复 '+index);
    db.prepare("UPDATE conversation_messages SET audience='internal' WHERE id=?").run('node-'+index);
   }
   const file=f.attach('',[{filename:'合成纪要.md',content:'# 合成文件正文'}],{taskId:a,taskVersion:1});
   let disposition='stale',releaseUpload,releaseDiscard;
   const discarded=[];
   const uploaded=[],submitted=[];
   const previousState=f.bridge.history.state;
   f.bridge.history.state=async()=>{const state=await previousState();return {...state,features:{...state.features,draftUpload:true}};};
   f.bridge.media.upload=async input=>{
    uploaded.push(input);
    await new Promise(resolve=>{releaseUpload=resolve;});
    const asset=f.mediaOwner.snapshot('upload:'+input.uploadId,{filename:input.filename,kind:'file',mime:'text/plain',bytes:Buffer.from(input.data,'base64')});
    return f.mediaOwner.view(asset);
   };
   f.bridge.media.discard=async input=>{
    discarded.push(input);
    await new Promise(resolve=>{releaseDiscard=resolve;});
    return {ok:true};
   };
   const inputs=new MainInputs(f.tasks,f.history,input=>{
    if(input.taskReference?.title!==readTaskReference(db,a)?.title)throw Error('task_reference_stale');
   });
   f.bridge.submit=async (input,scope)=>{
    assert.deepEqual(scope,{threadId:thread,readEpoch:'synthetic-browser-epoch'});
    submitted.push(input);
    if(disposition==='unknown')return {state:'stored'};
    if(disposition==='stale'){disposition='accept';db.prepare('UPDATE tasks SET title=? WHERE id=?').run('合成事项 A 修订',a);throw Error('task_reference_stale');}
    return inputs.accept(input);
   };
   await page.navigate();
   const primary='.preview-main-panel [contenteditable=true]',draft='.task-conversation [contenteditable=true]';
   await exists(primary);
   await insert(primary,'主对话合成草稿');
   const readAnchor=()=>page.evaluate(()=>{
    const view=document.querySelector('.preview-main-panel .thread-viewport'),top=view.getBoundingClientRect().top;
    const row=Array.from(view.querySelectorAll('[data-conversation-message]')).find(el=>{const box=el.getBoundingClientRect();return box.bottom>top&&box.height>0;});
    return row&&{id:row.dataset.conversationMessage,top:row.getBoundingClientRect().top-top};
   });
   await page.command('Input.dispatchMouseEvent',{type:'mouseWheel',x:220,y:300,deltaX:0,deltaY:-270});
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const mainAnchor=await readAnchor();
   assert.ok(mainAnchor);
   if(!await page.evaluate(()=>document.querySelector('#task-status-trigger')?.getAttribute('aria-expanded')==='true'))await click('#task-status-trigger');
   await exists(`[data-todo-id="${a}"] .status-task-open`);
   await click(`[data-todo-id="${a}"] .status-task-open`);
   await exists('.task-conversation #task-message-node-154');
   check((await text('.task-conversation #task-message-node-154')).includes('合成事项答复 154'),'public projected final');
   check(!(await page.evaluate(()=>document.querySelector('.task-conversation #task-message-node-159'))),'unrelated history excluded');
   check(await page.evaluate(`(()=>{const p=document.querySelector('#canvas-panel').getBoundingClientRect();return ${width}<=800?p.width===innerWidth:p.left>0&&p.width>380;})()`),'width appropriate Preview');
   check(await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth),'no horizontal overflow');
   check(await text(primary)==='主对话合成草稿','main draft retained');
   await page.until(`(()=>{const view=document.querySelector('.preview-main-panel .thread-viewport');
    const row=view.querySelector('[data-conversation-message="'+${JSON.stringify(mainAnchor.id)}+'"]');
    return row&&Math.abs(row.getBoundingClientRect().top-view.getBoundingClientRect().top-(${mainAnchor.top}))<4;})()`,7000);
   check(true,'main reading anchor is retained across Preview open');
   await insert(draft,'事项 A 草稿');
   await page.until(()=>!document.querySelector('.task-conversation .send-button')?.disabled,7000);
   await page.screenshot('task-conversation-'+width+'.png');
   await click('.task-conversation-toolbar button');
   check((await text('.task-conversation-info')).includes('合成工作笔记'),'current details');
   check((await text('.task-conversation-info')).includes('复核补货访谈纪要'),'confirmed Worker title');
   await page.screenshot('task-details-'+width+'.png');
   await click('.task-conversation-toolbar button');
   await exists(draft);
   check(await text(draft)==='事项 A 草稿','detail return retains draft');
   await page.evaluate(()=>{
    const input=document.querySelector('.task-conversation input[type=file]'),transfer=new DataTransfer();
    transfer.items.add(new File(['合成附件'],'事项上传.txt',{type:'text/plain'}));
    input.files=transfer.files;
    input.dispatchEvent(new Event('change',{bubbles:true}));
   });
   for(let attempt=0;!releaseUpload&&attempt<70;attempt++)await new Promise(resolve=>setTimeout(resolve,30));
   check(!!releaseUpload&&uploaded.length===1,'the upload has one original identity');
   const fileButton=`.task-conversation [data-conversation-message="${file.messageId}"] [data-slot="file-list-item"]`;
   const found=await page.evaluate(`!!document.querySelector(${JSON.stringify(fileButton)})`);
   if(found)await click(fileButton);
   else{
    await page.evaluate(`(()=>{const row=document.querySelector('[data-conversation-message="${file.messageId}"]');const trigger=[...row.querySelectorAll('button')].find(b=>b.textContent.includes('合成纪要.md'));if(!trigger)throw Error(row.innerHTML);trigger.click();})()`);
   }
   await page.until(()=>Array.from(document.querySelectorAll('#canvas-panel [role=tab]')).some(tab=>tab.textContent.includes('合成纪要.md')&&tab.getAttribute('aria-selected')==='true'),7000);
   releaseUpload();
   await page.evaluate(()=>Array.from(document.querySelectorAll('.canvas-tab-close')).find(button=>button.getAttribute('aria-label').includes('合成纪要.md')).click());
   await exists(draft);
   await page.until(()=>document.querySelector('.task-conversation .composer-context')?.textContent.includes('事项上传.txt'),7000);
   check(uploaded.length===1,'late upload restores to original task without replay');
   check(!(await page.evaluate(()=>document.querySelector('.preview-main-panel .composer-context')?.textContent.includes('事项上传.txt'))),'late task upload never enters main draft');
   check(await text(draft)==='事项 A 草稿','file close returns to source draft');
   for(let attempt=0;attempt<3;attempt++){
    await click('.task-conversation-history button');
    await page.until(()=>!document.querySelector('.task-conversation-history button:disabled'),7000);
    if(await page.evaluate(()=>!!document.querySelector('#task-message-node-9')))break;
   }
   check(await page.evaluate(()=>!!document.querySelector('#task-message-node-9')),'older task history crosses scoped scans');
   const actualIds=await page.evaluate(()=>Array.from(document.querySelectorAll('.task-conversation [data-conversation-message]')).map(row=>row.dataset.conversationMessage));
   check(actualIds.length===new Set(actualIds).size,'older rows render once');
   f.history.revokeMessage(thread,'node-60');
   await page.until(()=>!document.querySelector('#task-message-node-60'),7000);
   check(await text(draft)==='事项 A 草稿','withdrawal refresh leaves draft untouched');
   await click('.task-conversation .send-button');
   await page.until(()=>document.querySelector('.task-conversation .draft-notice')?.textContent.includes('事项引用已变化'),7000);
   check(await text(draft)==='事项 A 草稿','explicit stale rejection retains draft');
   await page.until(()=>!document.querySelector('.task-conversation .send-button')?.disabled,7000);
   await click('.task-conversation .send-button');
   await page.until(()=>document.querySelector('.task-conversation [contenteditable=true]')?.textContent==='',7000);
   check(submitted.length===2&&submitted[0].requestId===submitted[1].requestId&&submitted[1].taskReference.title==='合成事项 A 修订','explicit retry reuses request and refreshes reference');
   check(inputs.list().filter(item=>item.input.requestId===submitted[1].requestId).length===1,'single primary queue item');
   check(!!submitted[1].attachments?.[0]?.assetId&&submitted[0].attachments?.[0]?.assetId===submitted[1].attachments[0].assetId&&submitted[1].requestId===uploaded[0].requestId,'stale retry keeps upload and request binding');
   check(await text(primary)==='主对话合成草稿','task send never changes main draft');
   await click('.canvas-collapse');
   if(!await page.evaluate(()=>document.querySelector('#task-status-trigger')?.getAttribute('aria-expanded')==='true'))await click('#task-status-trigger');
   await exists(`[data-todo-id="${b}"] .status-task-open`);
   await click(`[data-todo-id="${b}"] .status-task-open`);
   await exists(draft);
   check(await text(draft)==='','other task starts independent');
   await insert(draft,'事项 B 草稿');
   check(await text(draft)==='事项 B 草稿','narrow task editor accepts input');
   disposition='unknown';
   await click('.task-conversation .send-button');
   await page.until(()=>Array.from(document.querySelectorAll('.task-conversation .draft-notice button')).some(b=>b.textContent==='另写一条'),7000);
   const uncertain=submitted.at(-1).requestId;
   await page.evaluate(()=>Array.from(document.querySelectorAll('.task-conversation .draft-notice button')).find(b=>b.textContent==='核对接收').click());
   await page.until(()=>document.querySelector('.task-conversation .draft-notice')?.textContent.includes('待核对'),7000);
   check(submitted.length===3,'checking an unknown receipt performs no second submission');
   await page.evaluate(()=>Array.from(document.querySelectorAll('.task-conversation .draft-notice button')).find(b=>b.textContent==='另写一条').click());
   await page.until(()=>document.querySelector('.task-conversation [contenteditable=true]')?.textContent==='',7000);
   check(await page.evaluate(`JSON.parse(sessionStorage.getItem('homer-unconfirmed:synthetic-history')).some(item=>item.input.requestId===${JSON.stringify(uncertain)}&&item.input.text==='事项 B 草稿')`),'an unknown submission remains available for reconciliation');
   if(width===1440){
    releaseUpload=undefined;
    await page.evaluate(()=>{
     const input=document.querySelector('.task-conversation input[type=file]'),transfer=new DataTransfer();
     transfer.items.add(new File(['合成删除附件'],'删除测试.txt',{type:'text/plain'}));
     input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
    });
    for(let attempt=0;!releaseUpload&&attempt<70;attempt++)await new Promise(resolve=>setTimeout(resolve,30));
    assert.ok(releaseUpload);releaseUpload();
    const remove='.task-conversation [aria-label="移除附件 删除测试.txt"]';
    await exists(remove);
    await page.until(()=>!document.querySelector('.task-conversation [aria-label="移除附件 删除测试.txt"]')?.disabled,7000);
    await click(remove);
    for(let attempt=0;!releaseDiscard&&attempt<70;attempt++)await new Promise(resolve=>setTimeout(resolve,30));
    assert.ok(releaseDiscard);
    const selectTab=title=>page.evaluate(`Array.from(document.querySelectorAll('#canvas-panel [role=tab]')).find(tab=>tab.textContent===${JSON.stringify(title)}).click()`);
    await selectTab('合成事项 A 修订');
    releaseDiscard();
    await selectTab('合成事项 B');
    await page.until(()=>!document.querySelector('.task-conversation [aria-label="移除附件 删除测试.txt"]'),7000);
    check(discarded.length===1,'late discard settles in original scope without a second discard');
   }
   assert.deepEqual(page.errors,[]);
   assert.deepEqual(page.blocked,[]);
  }catch(error){
   console.log(JSON.stringify({width,errors:page.errors,lastRequests:page.requests.slice(-12)}));
   await page.screenshot('failure-'+width+'.png');
   throw error;
  }finally{await page.close();await f.close();}
 }
 console.log(JSON.stringify({checks,widths:[1440,390,320]}));
}finally{const result=await chrome.close();console.log(JSON.stringify({chrome:result}));assert.equal(result.code,0);assert.equal(result.watchdog,false);}
