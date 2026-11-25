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
  let releaseSummary,releaseBrowser,releaseEarlier,releaseOriginal;
  try{
   f.store.setMeta('mainAgentId','main:synthetic');
   const create=(name,requestId)=>f.tasks.createTask({agentId:'main:synthetic',threadId:thread,sourceRequestId:requestId},
    {operationId:'task-'+requestId,goal:name,title:name,notes:'合成工作笔记',workingDirectory:process.cwd()}).taskId;
   const a=create('合成事项 A','request-0'),b=create('合成事项 B','request-1');
   const readPage=f.bridge.history.page;
   const taskCursors=[],sparseCursors=[];
   let holdEarlier=false,failEarlier=false,sparse=width===1440;
   f.bridge.history.page=async input=>{
    const {taskId,before}=input.request;
    if(before&&taskId===a)taskCursors.push(before);
    if(before&&taskId===b)sparseCursors.push(before);
    if(before&&taskId&&holdEarlier){
     holdEarlier=false;
     await new Promise(resolve=>{releaseEarlier=resolve;});
    }
    if(before&&taskId===b&&failEarlier){failEarlier=false;throw Error('history_read_busy');}
    return readPage(sparse&&taskId===b?{...input,request:{...input.request,limit:1}}:input);
   };
   const actor={agentId:'main:synthetic',threadId:thread,sourceRequestId:'request-0'};
   const firstTitle='汇总访谈资料并核对所有补货项目的原始记录和不同版本之间的变化';
   const worker=f.tasks.workerOpen(actor,{operationId:'synthetic-assignment',taskId:a,text:'检查合成访谈资料',workTitle:firstTitle,workingDirectory:process.cwd()});
   const run=f.tasks.claim(worker.runId);
   f.tasks.bind(run.id,run.epoch,'thread:assignment','turn:assignment');
   f.tasks.endSegment(run.id,run.epoch,{status:'completed',text:'整理完毕'},true);
   f.tasks.workerMessage(actor,{operationId:'next-assignment',workerId:worker.workerId,text:'复核纪要',workTitle:'复核补货访谈纪要'});
   f.tasks.workerOpen(actor,{operationId:'second-worker',taskId:a,text:'核对库存',workTitle:'核对库存差异'});
   f.tasks.workerOpen(actor,{operationId:'untitled-worker',taskId:a,text:'协助归档'});
   for(const index of [9,60,121,154]){
    const quote=index===154?{messageId:'unavailable-source',text:'合成原文摘录'}:undefined;
    db.prepare('UPDATE conversation_messages SET quote=? WHERE id=?').run(JSON.stringify({taskReference:{taskId:a,version:1,title:'合成事项 A'},quote}),'user-'+index);
    updateSyntheticPublicText(f,'node-'+index,'合成事项答复 '+index);
    db.prepare("UPDATE conversation_messages SET audience='internal' WHERE id=?").run('node-'+index);
   }
   db.prepare('UPDATE conversation_messages SET text=? WHERE id=?').run(Array.from({length:45},(_,i)=>'历史原文第 '+(i+1)+' 段').join('\n\n'),'user-9');
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
   const secondTitleTaskName='合成多标题第二事项';
   const secondTitleTask=create(secondTitleTaskName,'request-3');
   db.prepare("UPDATE tasks SET historyState='archived',state='paused' WHERE id=?").run(c);
   const publish=(body,taskId)=>f.attach(body,[],{taskId,taskVersion:1}).messageId;
   const title=id=>'#message-'+id+' .message-task-open';
   const messageA=publish('合成事项入口 A',a), continuation=publish('连续事项入口 A',a);
   const messageC=publish('历史归档事项入口',c);
   const addTitles=messages=>messages.map(message=>message.id===messageC?{...message,taskSources:[
    {title:archivedTitle,target:{taskId:c,version:1},previewVerified:true},
    {title:archivedTitle,target:{taskId:secondTitleTask,version:1},previewVerified:true},
    {title:'证据不足的历史事项标题'.repeat(6),target:{taskId:'legacy',version:1}},
   ]}:message);
   const stateWithTasks=f.bridge.history.state;
   f.bridge.history.state=async()=>{const state=await stateWithTasks();return {...state,messages:addTitles(state.messages)};};
   let denyOriginal=false,originalReads=0;
   const historyPage=f.bridge.history.page;
   f.bridge.history.page=async input=>{
    if(!input.request.taskId&&input.request.around==='user-9'){
     originalReads++;
     if(denyOriginal){
      await new Promise(resolve=>{releaseOriginal=resolve;});
      throw Error('history_message_not_found');
     }
    }
    const result=await historyPage(input);
    return {...result,messages:addTitles(result.messages)};
   };
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
   const secondTitle='#message-'+messageC+' .message-task-open:nth-child(2)';
   const checkTitles=async (selector,buttonCount)=>{
    check(await page.evaluate(`(()=>{
     const row=document.querySelector(${JSON.stringify(selector)}),group=row.querySelector('.message-task-title');
     const bubble=row.querySelector('.assistant-message-bubble').getBoundingClientRect();
     const titles=Array.from(group.children);
     return titles.length===3&&group.querySelectorAll('button').length===${buttonCount}&&
      titles.every((title,i)=>{
       const box=title.getBoundingClientRect(),label=title.querySelector('span')??title;
       return Math.abs(box.left-bubble.left)<1&&box.right<=bubble.right+1&&
        (i===0||titles[i-1].getBoundingClientRect().bottom<=box.top)&&
        getComputedStyle(label).textOverflow==='ellipsis'&&label.scrollWidth>label.clientWidth&&
        label.textContent===title.title;
      });
    })()`),'three independently truncated titles share the actual bubble width');
   };
   await checkTitles('#message-'+messageC,2);
   await page.screenshot('message-task-titles-'+width+'.png');
   if(width===390)await page.command('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
   await focus(title(messageC));
   await key('Tab',9);
   await focused(secondTitle);
   if(width===390){
    const point=await page.evaluate(`(()=>{const button=document.querySelector(${JSON.stringify(secondTitle)}),r=button.getBoundingClientRect();
     return {x:r.left+r.width/2,y:r.top+5,height:r.height};})()`);
    check(point.height===44,'each touch title has its own 44px row');
    await page.command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:point.x,y:point.y}]});
    await page.command('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   }else await key('Enter',13);
   await exists(taskReader(secondTitleTask));
   await click('.canvas-collapse');
   await closed();
   await focused(secondTitle);
   await key('Enter',13);
   await exists(taskReader(secondTitleTask));
   if(width===390)await page.command('Emulation.setTouchEmulationEnabled',{enabled:false});
   await click('.canvas-tab-close[aria-label="关闭'+secondTitleTaskName+'"]');
   await click('.canvas-collapse');
   await closed();
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
   const original=taskReader(c)+' #task-message-'+messageC+' .message-actions button[aria-label="在主对话查看"]';
   const bubble='#message-'+messageC+' .assistant-message-bubble';
   await exists(original);
   await checkTitles(taskReader(c)+' #task-message-'+messageC,0);
   await page.screenshot('message-task-titles-preview-'+width+'.png');
   check(await page.evaluate(`Array.from(document.querySelector(${JSON.stringify(original)}).parentElement.querySelectorAll('button'),button=>button.getAttribute('aria-label')).join(',')==='引用,复制,在主对话查看'`),'the original action sits beside quote and copy');
   await focus(original);
   check(await page.evaluate(`document.activeElement.matches(':focus-visible')`),'the original action has visible keyboard focus');
   await page.screenshot('task-origin-action-'+width+'.png');
   await key('Enter',13);
   if(width<700)await closed();
   await focused('#message-'+messageC);
   const highlighted=`document.querySelector(${JSON.stringify(bubble)})?.getAnimations().find(animation=>animation.id==='task-original')?.playState==='running'`;
   await page.until(highlighted,7000);
   check(true,'the original bubble is highlighted');
   await page.screenshot('task-origin-highlight-'+width+'.png');
   if(width===1440){
    await page.evaluate(`window.firstOriginHighlight=document.querySelector(${JSON.stringify(bubble)}).getAnimations().find(animation=>animation.id==='task-original')`);
    await click(original);
    await page.until(`window.firstOriginHighlight.playState==='idle' && document.querySelector(${JSON.stringify(bubble)})?.getAnimations().some(animation=>animation.id==='task-original')`,7000);
   }
   if(width<700)await click('.conversation-header button[aria-label="预览"]');
   await exists(panel);
   await click('.canvas-tab-close[aria-label="关闭'+archivedTitle+'"]');
   await click('.canvas-tab-close[aria-label="关闭合成事项 A"]');
   await closed();
   const taskButton=id=>`[data-todo-id="${id}"] [data-slot="task-status-row"]`;
   if(!await page.evaluate(()=>document.querySelector('#task-status-trigger')?.getAttribute('aria-expanded')==='true'))await click('#task-status-trigger');
   await click('.status-archive-toggle');
   await focus(taskButton(c));
   await page.screenshot('task-status-row-'+width+'.png');
   await key(' ',32);
   await exists(taskReader(c));
   await click('.canvas-tab-close[aria-label="关闭'+archivedTitle+'"]');
   await closed();
   await focused(width<700?'#task-status-trigger':taskButton(c));
   if(width===1440)await click('.status-archive-toggle');
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
   const taskRow=`[data-todo-id="${a}"]`;
   await exists(taskButton(a));
   check(await page.evaluate(`document.querySelector(${JSON.stringify(taskButton(a))}).matches('button[type=button]')`),'the entire current matter card is a native button');
   check(await page.evaluate(`document.querySelector(${JSON.stringify(taskRow+' .status-task-workers')})?.getAttribute('aria-label')==='3 个 Worker'`),'task list shows Worker count');
   const listEntry=await text(taskRow);
   check(!listEntry.includes(firstTitle)&&!listEntry.includes('复核补货访谈纪要'),'task list omits current and previous assignments');
   await click(taskButton(a)+' .status-task-workers');
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
   await focus('.task-conversation-toolbar button');
   await key('Enter',13);
   check((await text('.task-conversation-info')).includes('合成工作笔记'),'current details');
   const assignments=await page.evaluate(()=>Array.from(document.querySelectorAll('.task-worker-timeline'),list=>Array.from(list.children,item=>[
    item.textContent.trim(),item.getAttribute('aria-current')==='true',Number(getComputedStyle(item.querySelector('strong')??item).fontWeight),
   ])));
   assert.deepEqual(assignments,[
    [['复核补货访谈纪要',true,700],[firstTitle,false,400]],
    [['核对库存差异',true,700]],
   ]);
   check((await text('.task-detail-workers')).includes('暂无工作标题'),'untitled Worker stays visible');
   check(await page.evaluate(()=>[...document.querySelectorAll('.task-worker-timeline')].every(list=>
    list.getAttribute('role')==='list'&&list.getAttribute('aria-label')?.includes('最新在前')&&list.scrollWidth<=list.clientWidth
    &&[...list.children].every(item=>item.getBoundingClientRect().height>0))),'visible accessible lists without horizontal overflow');
   await page.screenshot('task-details-'+width+'.png');
   if(width===1440){
    const separator=()=>page.evaluate(()=>document.querySelector('.preview-separator').getBoundingClientRect().toJSON());
    const original=await separator();
    await focus('.preview-separator');
    await key('End',35);
    await page.until(()=>document.querySelector('#canvas-panel').clientWidth<=420,7000);
    check(await page.evaluate(()=>{
     const worker=document.querySelector('.task-detail-workers>li');
     const [label,timeline]=worker.children;
     return timeline.getBoundingClientRect().top>=label.getBoundingClientRect().bottom&&timeline.scrollWidth<=timeline.clientWidth;
    }),'narrow Preview stacks the timeline inside a wide window');
    await page.screenshot('task-details-narrow-preview.png');
    const narrow=await separator();
    const pointer={button:'left',clickCount:1,y:narrow.y+narrow.height/2};
    await page.command('Input.dispatchMouseEvent',{...pointer,type:'mousePressed',x:narrow.x});
    await page.command('Input.dispatchMouseEvent',{...pointer,type:'mouseMoved',buttons:1,x:original.x});
    await page.command('Input.dispatchMouseEvent',{...pointer,type:'mouseReleased',x:original.x});
    await page.until(`Math.abs(document.querySelector('.preview-separator').getBoundingClientRect().x-${original.x})<3`,7000);
   }
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
   const attachmentActions=`#task-message-${file.messageId} .message-actions button`;
   check(await page.evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(attachmentActions)}),button=>button.getAttribute('aria-label')).join(',')==='在主对话查看'`),'an attachment-only message keeps its original action');
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
   const viewport='.task-conversation .thread-viewport';
   const anchor=()=>page.evaluate(`(()=>{
    const view=document.querySelector(${JSON.stringify(viewport)}),top=view.getBoundingClientRect().top;
    const row=Array.from(view.querySelectorAll('[data-conversation-message]')).find(row=>row.getBoundingClientRect().bottom>top);
    return {id:row.id,offset:row.getBoundingClientRect().top-top};
   })()`);
   const wheelUp=async()=>{
    const box=await page.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(viewport)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
    await page.command('Input.dispatchMouseEvent',{type:'mouseWheel',...box,deltaX:0,deltaY:-100000});
   };
   await focus(viewport);
   holdEarlier=true;
   if(width===320){
    const {x,y,distance}=await page.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(viewport)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/8,distance:r.height*3/4};})()`);
    await page.command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
    await page.command('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y+distance}]});
    await page.command('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   }else await wheelUp();
   await page.until(`document.querySelector(${JSON.stringify(viewport)}).scrollTop===0&&document.querySelector('.task-history-notice')?.textContent.includes('正在读取')`,7000);
   for(let attempt=0;!releaseEarlier&&attempt<70;attempt++)await new Promise(resolve=>setTimeout(resolve,30));
   assert.ok(releaseEarlier);
   const saved=await anchor();
   releaseEarlier();releaseEarlier=undefined;
   await exists('#task-message-node-121');
   const offset=await page.evaluate(`document.getElementById(${JSON.stringify(saved.id)}).getBoundingClientRect().top-document.querySelector(${JSON.stringify(viewport)}).getBoundingClientRect().top`);
   check(Math.abs(offset-saved.offset)<=2,'automatic prepend preserves the reader anchor');
   await focused(viewport);
   let cancelledCursor;
   if(width===1440){
    holdEarlier=true;
    await wheelUp();
    for(let attempt=0;!releaseEarlier&&attempt<70;attempt++)await new Promise(resolve=>setTimeout(resolve,30));
    assert.ok(releaseEarlier);
    cancelledCursor=taskCursors.at(-1);
    await page.evaluate(()=>document.querySelector('#task-message-user-154 a[href="#message-unavailable-source"]').click());
    await page.until(()=>document.querySelector('.task-history-notice')?.textContent.includes('原消息已不可读'),7000);
    releaseEarlier();releaseEarlier=undefined;
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   }
   for(const id of [60,9]){
    if(width===390)await key('Home',36);
    else await wheelUp();
    await exists('#task-message-node-'+id);
   }
   if(cancelledCursor)check(taskCursors.filter(cursor=>cursor===cancelledCursor).length===2,'source lookup abandons the pending page and upward navigation can retry its cursor');
   check(await page.evaluate(()=>!!document.querySelector('#task-message-node-9')),'older task history crosses scoped scans');
   const actualIds=await page.evaluate(()=>Array.from(document.querySelectorAll('.task-conversation [data-conversation-message]')).map(row=>row.dataset.conversationMessage));
   check(actualIds.length===new Set(actualIds).size,'older rows render once');
   const historicalOriginal='#task-message-user-9 .message-actions button[aria-label="在主对话查看"]';
   denyOriginal=true;
   await focus(historicalOriginal);
   await key('Enter',13);
   await page.until(`document.querySelector(${JSON.stringify(historicalOriginal)})?.getAttribute('aria-busy')==='true'`,7000);
   check(await text('.task-origin-status')==='正在查找原消息…','slow history read announces progress');
   await key('Enter',13);
   for(let attempt=0;!releaseOriginal&&attempt<70;attempt++)await new Promise(resolve=>setTimeout(resolve,30));
   assert.ok(releaseOriginal);
   releaseOriginal();
   await page.until(()=>document.querySelector('.task-origin-status')?.textContent==='暂时无法在主对话查看这条消息。',7000);
   await focused(historicalOriginal);
   check(await text(draft)==='事项 A 草稿','unavailable original keeps Preview, focus and draft');
   await page.screenshot('task-origin-unavailable-'+width+'.png');
   denyOriginal=false;
   await page.command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
   if(width===1440)await key('Enter',13);
   else{
    await page.command('Emulation.setTouchEmulationEnabled',{enabled:true});
    const position=await page.evaluate(`(()=>{const button=document.querySelector(${JSON.stringify(historicalOriginal)});button.scrollIntoView({block:'nearest'});const box=button.getBoundingClientRect();return {x:box.x+box.width/2,y:box.y+box.height/2,width:box.width,height:box.height};})()`);
    check(position.width>=44&&position.height>=44,'touch target is at least 44 CSS pixels');
    await page.command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:position.x,y:position.y}]});
    await page.command('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await closed();
   }
   await focused('#message-user-9');
   check(originalReads===2,'pending repeat is coalesced and retry reads main history once');
   await page.until(()=>{
    const row=document.querySelector('#message-user-9')?.getBoundingClientRect();
    const view=document.querySelector('.preview-main-panel .thread-viewport').getBoundingClientRect();
    const animations=document.querySelector('#message-user-9 .user-message-bubble')?.getAnimations();
    return row&&row.height>view.height&&row.top>=view.top&&row.top<view.top+70
      &&animations?.some(animation=>animation.id==='task-original'&&animation.effect.getKeyframes().length===2);
   },7000);
   check(true,'the start of a long original stays visible with the reduced-motion highlight');
   await page.screenshot('task-origin-history-'+width+'.png');
   if(width<700){
    await page.command('Emulation.setTouchEmulationEnabled',{enabled:false});
    await click('.conversation-header button[aria-label="预览"]');
    await exists(draft);
   }
   check(await text(draft)==='事项 A 草稿','return to Preview keeps its draft');
   await page.command('Emulation.setEmulatedMedia',{features:[]});
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
   await click(taskButton(b));
   await exists(draft);
   check(await text(draft)==='','other task starts independent');
   if(sparse){
    const buttonWithText=value=>`Array.from(document.querySelectorAll('.task-conversation button')).find(button=>button.textContent===${JSON.stringify(value)})`;
    const continueSearch=buttonWithText('继续查找');
    const activate=async button=>{await page.evaluate(`${button}.focus()`);await key('Enter',13);};
    await page.until(`!!${continueSearch}`,7000);
    check(sparseCursors.length===3&&new Set(sparseCursors).size===3,'an empty first screen scans three distinct cursors then pauses');
    await wheelUp();
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    check(sparseCursors.length===3,'the capped search awaits an explicit continuation');
    holdEarlier=true;
    await activate(continueSearch);
    for(let attempt=0;!releaseEarlier&&attempt<70;attempt++)await new Promise(resolve=>setTimeout(resolve,30));
    assert.ok(releaseEarlier);
    const continuedFrom=sparseCursors.at(-1);
    await click('.task-conversation-toolbar button');
    await exists('.task-conversation-info');
    releaseEarlier();releaseEarlier=undefined;
    await click('.task-conversation-toolbar button');
    await page.until(`!!${continueSearch}`,7000);
    check(sparseCursors.length===4,'leaving the reader stops the pending continuation');
    sparse=false;failEarlier=true;
    await activate(continueSearch);
    const retry=buttonWithText('重试');
    await page.until(`document.activeElement===${retry}`,7000);
    check(sparseCursors.at(-1)===continuedFrom,'a cancelled response leaves the original cursor available');
    await activate(retry);
    await exists('#task-message-user-1');
    await focused(viewport);
    check(sparseCursors[5]===continuedFrom,'retry of the failed continuation uses the same cursor');
    check(!await page.evaluate(`!!${continueSearch}`),'a completed sparse search clears the continuation control');
   }
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
   console.error("Browser assertion",error.stack??error);
   const focus=await page.evaluate(`(()=>{const target=document.querySelector(${JSON.stringify(expectedFocus??':focus')});return {active:document.activeElement.outerHTML.slice(0,400),target:target?.outerHTML.slice(0,120),inert:!!target?.closest('[inert]'),visibility:target&&getComputedStyle(target).visibility};})()`);
   console.log(JSON.stringify({width,focus,expectedFocus,errors:page.errors,lastRequests:page.requests.slice(-12)}));
   await page.screenshot('failure-'+width+'.png');
   throw error;
  }finally{releaseSummary?.();releaseBrowser?.();releaseEarlier?.();releaseOriginal?.();await page.close();await f.close();}
 }
 console.log(JSON.stringify({checks,widths:[1440,390,320]}));
}finally{const result=await chrome.close();console.log(JSON.stringify({chrome:result}));assert.equal(result.code,0);assert.equal(result.watchdog,false);}
