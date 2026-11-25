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
   await exists(selector);
   const box=await page.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return; e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
   assert.ok(box,selector);
   await page.command('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...box});
   await page.command('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...box});
  };
  const exists=selector=>page.until(`!!document.querySelector(${JSON.stringify(selector)})`,7000);
  let expectedFocus;
  const text=(selector)=>page.evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent`);
  const insert=async (selector,value)=>{
   await page.evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
   await page.command('Input.insertText',{text:value});
  };
  let releaseSummary,releaseBrowser;
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
   const archivedTitle='归档事项'+ '合成标题用于检查窄屏换行'.repeat(4);
   const c=create(archivedTitle,'request-2');
   db.prepare("UPDATE tasks SET historyState='archived',state='paused' WHERE id=?").run(c);
   const publish=(body,taskId)=>f.attach(body,[],{taskId,taskVersion:1}).messageId;
   const title=id=>'#message-'+id+' .message-task-open';
   const messageA=publish('合成事项入口 A',a), continuation=publish('连续事项入口 A',a);
   const messageC=publish('历史归档事项入口',c);
   const originalSummary=f.bridge.taskOverview.summary;
   let summaryMode='mismatch';
   f.bridge.taskOverview.summary=async id=>{
    if(id===c&&summaryMode!=='normal'){
     const mode=summaryMode;summaryMode='normal';
     if(mode==='mismatch')return originalSummary(b);
     await new Promise(resolve=>{releaseSummary=resolve;});
    }
    return originalSummary(id);
   };
   const previewLink=width===1440?f.attach('[合成网页](https://example.com/synthetic)',[]).messageId:undefined;
   if(previewLink){
    f.bridge.openPreview=async input=>{
     assert.equal(input.show,false);
     const {source}=input;
     const id='browser:'+source.messageId,opened={id,threadId:thread,owner:'main:'+thread,url:source.url,title:source.title,document:1,control:'user',source};
     await page.evaluate(`window.syntheticNativePage(${JSON.stringify(opened)})`);
     await new Promise(resolve=>{releaseBrowser=resolve;});
     return opened;
    };
    await page.command('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{
     let pages=[],notify=()=>{};
     window.syntheticNativePage=page=>{pages=[page];notify();};
     window.homerBrowserPreview={
      list:async()=>pages,onChanged:fn=>{notify=fn;return ()=>{};},onShow:()=>()=>{},onAnnotation:()=>()=>{},
      annotations:async()=>{},present:async()=>{},control:async({action})=>{if(action==='close'){pages=[];notify();}},
     };
    })()`});
   }
   await page.command('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{
    const original=Response.prototype.json;
    Response.prototype.json=async function(){
     const value=await original.call(this);
     if(new URL(this.url,location.href).pathname===${JSON.stringify('/api/tasks/'+c+'/summary')})
      requestAnimationFrame(()=>{window.archivedSummaries=(window.archivedSummaries??0)+1;});
     return value;
    };
   })()`});
   await page.navigate();
   const primary='.preview-main-panel [contenteditable=true]',draft='.task-conversation [contenteditable=true]';
   await exists(primary);
   const panel='#canvas-panel';
   const taskReader=id=>`.task-conversation[data-task-conversation="${id}"]`;
   const key=async (key,virtualKey)=>{
    const event={key,code:key===' '?'Space':key,windowsVirtualKeyCode:virtualKey};
    await page.command('Input.dispatchKeyEvent',{...event,type:'keyDown',...(key==='Enter'?{text:'\r'}:{})});
    await page.command('Input.dispatchKeyEvent',{...event,type:'keyUp'});
   };
   const focus=async selector=>{await exists(selector);await page.evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);};
   const focused=selector=>{expectedFocus=selector;return page.until(`document.activeElement.matches(${JSON.stringify(selector)})`,7000);};
   const closed=()=>page.until(()=>!document.querySelector('#canvas-panel'),7000);
   if(previewLink){
    await click('#message-'+previewLink+' .markdown a');
    for(let attempt=0;!releaseBrowser&&attempt<70;attempt++)await new Promise(resolve=>setTimeout(resolve,30));
    assert.ok(releaseBrowser);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    check(!await page.evaluate(()=>document.querySelector('#canvas-panel')),'native list delivery does not open a pending tab');
    releaseBrowser();
    await page.until(()=>document.querySelector('#canvas-panel [role=tab][aria-selected=true]')?.textContent==='合成网页',7000);
    await click('.canvas-tab-close[aria-label="关闭合成网页"]');
    await closed();
   }
   await exists(title(messageA));
   await exists(title(continuation));
   check(await page.evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(title(continuation))})).visibility==='hidden'`),'folded title skips keyboard and pointer');
   await focus(title(messageA));
   await key('Tab',9);
   check(await page.evaluate(`!document.activeElement.matches(${JSON.stringify(title(continuation))})`),'Tab skips the folded title');
   await focus(title(messageA));
   check(await page.evaluate(`document.activeElement.matches(':focus-visible')`),'keyboard focus is visible');
   await key('Enter',13);
   await exists(taskReader(a));
   if(width<700)await focused('#canvas-panel [role=tab][aria-selected=true]');
   await click('.canvas-collapse');
   await closed();
   await focused(title(messageA));
   await click(title(messageC)+' svg');
   await page.until(()=>document.querySelector('.history-navigation')?.textContent.includes('暂时无法打开事项'),7000);
   check(!(await page.evaluate(()=>document.querySelector('#canvas-panel'))),'wrong summary identity cannot open a task');
   if(width===1440){
    summaryMode='delay';
    await click(title(messageC));
    for(let attempt=0;!releaseSummary&&attempt<70;attempt++)await new Promise(resolve=>setTimeout(resolve,30));
    assert.ok(releaseSummary);
    await click(title(messageA)+' svg');
    await exists(taskReader(a));
    releaseSummary();
    await page.until(()=>window.archivedSummaries===2,7000);
    check(await page.evaluate(`!!document.querySelector(${JSON.stringify(taskReader(a))})&&document.querySelectorAll('#canvas-panel [role=tab]').length===1`),'late summary cannot replace the latest task intent');
    await click('.canvas-collapse');
    await closed();
   }
   await focus(title(messageC));
   if(width<700)await page.screenshot('message-task-title-'+width+'.png');
   await key(' ',32);
   await exists(taskReader(c));
   check(await page.evaluate(()=>document.querySelectorAll('#canvas-panel [role=tab]').length===2),'an archived message opens its own task tab');
   check(await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth),'long archived title fits the viewport');
   await page.screenshot('message-task-preview-'+width+'.png');
   if(width===1440){
    for(const next of [700,699,700]){
     await page.command('Emulation.setDeviceMetricsOverride',{width:next,height:900,deviceScaleFactor:1,mobile:false});
     const role=next<700?'dialog':'complementary';
     await exists(panel+'[role="'+role+'"]');
     if(next<700)await focused('#canvas-panel [role=tab][aria-selected=true],#canvas-panel .canvas-collapse');
     check(await page.evaluate(`(()=>{const aside=document.querySelector('.status-aside');return ${next}<700?!aside:aside?.getBoundingClientRect().width===300;})()`),'700px breakpoint preserves the docked 300px status rail');
    }
    await page.command('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
   }
   await exists(taskReader(c)+' .task-message-origin button');
   await click(taskReader(c)+' .task-message-origin button');
   if(width<700)await closed();
   await focused('#message-'+messageC);
   if(width<700)await click('.conversation-header button[aria-label="预览"]');
   await exists(panel);
   await click('.canvas-tab-close[aria-label="关闭'+archivedTitle+'"]');
   await click('.canvas-tab-close[aria-label="关闭合成事项 A"]');
   await closed();
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
   check(await page.evaluate(`(()=>{const p=document.querySelector('#canvas-panel').getBoundingClientRect();return ${width}<700?p.width===innerWidth:p.left>0&&p.width>380;})()`),'width appropriate Preview');
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
   const focus=await page.evaluate(`(()=>{const target=document.querySelector(${JSON.stringify(expectedFocus??':focus')});return {active:document.activeElement.outerHTML.slice(0,400),target:target?.outerHTML.slice(0,120),inert:!!target?.closest('[inert]'),visibility:target&&getComputedStyle(target).visibility};})()`);
   console.log(JSON.stringify({width,focus,expectedFocus,errors:page.errors,lastRequests:page.requests.slice(-12)}));
   await page.screenshot('failure-'+width+'.png');
   throw error;
  }finally{releaseSummary?.();releaseBrowser?.();await page.close();await f.close();}
 }
 console.log(JSON.stringify({checks,widths:[1440,390,320]}));
}finally{const result=await chrome.close();console.log(JSON.stringify({chrome:result}));assert.equal(result.code,0);assert.equal(result.watchdog,false);}
