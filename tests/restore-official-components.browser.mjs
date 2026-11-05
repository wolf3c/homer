// Approved component restoration: real built React UI, synthetic services only.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {composerFixture} from './fixtures/composer-browser-server.mjs';
import {queueBrowserFixture} from './fixtures/message-queue-browser-server.ts';
import {isolatedChrome} from './web-history-browser-cdp.mjs';
const root=resolve(process.env.HOMER_BROWSER_EVIDENCE??'.codex/scratch/restore-official-components-20261024/browser');
mkdirSync(root,{recursive:true});
const base=resolve(process.env.HOMER_BROWSER_BASE??'.codex/scratch/restore-official-components-20261024'),checks=[],measurements=[];
const webFor=phase=>phase==='after'&&process.env.HOMER_COMPONENT_BUILD?resolve(process.env.HOMER_COMPONENT_BUILD):join(base,phase+'-web');
const runtimeBase=resolve(process.env.HOMER_SYNTHETIC_ROOT??base);
const browser=await isolatedChrome(root);
const message=(id,text,extra={})=>({id,threadId:'composer-review',role:'assistant',requestId:null,status:'completed',text,createdAt:1700000000000,...extra});
const longName='中英文完整文件名_'+('long-name-without-spaces_'.repeat(10))+'.txt';
const sources=[{id:'source-a',title:'合成官方来源标题'.repeat(8),url:'https://example.invalid/a'},{id:'source-b',title:'另一来源',url:'https://example.invalid/b'},{id:'bad',title:'禁止',url:'https://name:secret@example.invalid'}];
async function key(p,key){await p.command('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,...(key==='Enter'?{text:'\r',windowsVirtualKeyCode:13}:{})});await p.command('Input.dispatchKeyEvent',{type:'keyUp',key,code:key});}
async function fill(p,text){await p.evaluate(()=>{const e=document.querySelector('[contenteditable=true]');e.focus();const r=document.createRange();r.selectNodeContents(e);getSelection().removeAllRanges();getSelection().addRange(r);});await p.command('Input.insertText',{text});}
const wait=(p,fn)=>p.until('Boolean(('+String(fn)+')())',12000);
const check=(label,value)=>{assert.ok(value,label);checks.push(label);};
const expandQueue=async p=>{await wait(p,()=>document.querySelector('[data-slot=message-queue] li'));await p.evaluate(()=>{const b=document.querySelector('.queue-toggle');if(b?.getAttribute('aria-expanded')==='false')b.click();});};
try{
 for(const phase of process.env.HOMER_COMPONENT_BUILD?['after']:['before','after'])for(const width of [320,390,1440]){
  const webDir=webFor(phase);
  const f=await composerFixture({webDir,branding:resolve('assets/branding/odysseus-20261030/homer-odysseus-64.png'),resource(_req,res,url){res.writeHead(200,{'Content-Type':'text/plain','X-Homer-Artifact-Hash':'a'.repeat(64)});res.end('Synthetic exact file content');}});
  const p=await browser.page(f.url,width);
  const scene=async data=>{f.reset({messages:[],features:{draftUpload:true},...data});await p.command('Page.navigate',{url:f.url});await wait(p,()=>document.querySelector('[contenteditable=true]')&&!document.body.textContent.includes('正在恢复主对话'));};
  const shot=async(category,selector)=>{await p.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);await p.evaluate(`Promise.allSettled(document.querySelector(${JSON.stringify(selector)}).getAnimations({subtree:true}).filter(a=>a.effect?.getComputedTiming().endTime!==Infinity).map(a=>a.finished))`);await p.screenshot(`${phase}-${category}-${width}.png`);};
  try{
   await scene({messages:[message('visual','```ts\nconst x = "<literal>";\n```')]});
   await wait(p,()=>document.querySelector('.aui-code-header-copy'));
   measurements.push({phase,width,category:'code',...await p.evaluate(()=>{const h=document.querySelector('.aui-code-header-root'),b=h.querySelector('button'),s=getComputedStyle(h);return {header:h.getBoundingClientRect().height,button:b.getBoundingClientRect().height,border:s.borderColor,background:s.backgroundColor};})});
   await shot('code','.aui-code-header-root');
   if(phase==='after')check('24px code '+width,await p.evaluate(()=>document.querySelector('.aui-code-header-copy').getBoundingClientRect().height===24));
   const media={assetId:'synthetic-asset',revision:1,filename:longName,kind:'file',state:'ready',mime:'text/plain',size:100,error:null};
   await scene({messages:[message('visual','合成文件列表。'),message('user-file','合成历史附件',{role:'user',media:[media]})],artifacts:[{id:'synthetic-result',title:longName,workTitle:'合成文件',historyMessageId:'visual',messageId:'visual'}]});
   await wait(p,()=>document.querySelectorAll('[data-slot=file-name]').length===2);
   measurements.push({phase,width,category:'file',...await p.evaluate(()=>({names:[...document.querySelectorAll('[data-slot=file-name]')].map(e=>({height:e.getBoundingClientRect().height,whiteSpace:getComputedStyle(e).whiteSpace,overflow:e.scrollWidth>e.clientWidth,title:e.title}))}))});
   await shot('file','[data-slot=file-list]');
   if(phase==='after'){
    check('both FileName consumers truncate and preserve titles '+width,await p.evaluate(()=>[...document.querySelectorAll('[data-slot=file-name]')].every(e=>getComputedStyle(e).whiteSpace==='nowrap'&&getComputedStyle(e).textOverflow==='ellipsis'&&e.title===e.textContent)));
    await p.evaluate(()=>document.querySelector('.file-list-open').click());await wait(p,()=>document.querySelector('#canvas-panel')?.textContent.includes('Synthetic exact file content'));
    check('accurate Canvas file owner '+width,p.requests.filter(r=>r.path==='/api/files/synthetic-result').length===1);
    const g=await p.evaluate(()=>({close:document.querySelector('.canvas-tab-close').getBoundingClientRect().height,title:getComputedStyle(document.querySelector('[role=tab][aria-selected=true]>span')).whiteSpace,duplicate:!!document.querySelector('[data-slot=canvas-split-header]')}));
    check('28px desktop / 44px mobile file close, single-line tab title and no duplicate header '+width,g.close===(width<=800?44:28)&&g.title==='nowrap'&&!g.duplicate);
    await shot('canvas','.canvas-tab-bar');await p.evaluate(()=>document.querySelector('.canvas-collapse, .conversation-header [aria-controls=canvas-panel][aria-expanded=true]:not([aria-hidden=true] *)').click());
   }
   await scene({messages:[message('visual','合成来源',{sources})]});
   await p.evaluate(()=>document.querySelector('[data-slot=sources] [data-slot=collapsible-trigger]').click());await wait(p,()=>document.querySelectorAll('[data-slot=source-card]').length===2);
   await shot('sources','[data-slot=sources]');
   if(phase==='after'){
    check('one safe official list without preview buttons '+width,await p.evaluate(()=>!document.querySelector('.source-preview-actions')&&[...document.querySelectorAll('[data-slot=source-card]')].map(a=>a.dataset.sourceId).join(',')==='source-a,source-b'&&document.body.textContent.includes('未经独立核验')));
    await p.evaluate(()=>{const a=document.querySelector('[data-slot=source-card]');a.focus();a.addEventListener('click',e=>{window.__link={href:a.href,target:a.target,rel:a.rel,trusted:e.isTrusted};e.preventDefault();},{once:true});});await key(p,'Enter');
    check('source keeps original external-link activation '+width,await p.evaluate(()=>window.__link.href==='https://example.invalid/a'&&window.__link.target==='_blank'&&window.__link.rel==='noopener noreferrer'&&window.__link.trusted));
   }
   const mixed={id:'mixed',runId:'main-native:mixed',kind:'question',question:'核对合成资料',reason:'合成问答',questions:[{id:'format',question:'格式？',options:[{label:'Markdown'}],allowOther:false},{id:'notes',question:'说明',options:[],allowOther:true}]};
   await scene({interactions:[mixed],features:{nativeQuestionAnswers:1}});await wait(p,()=>document.querySelector('[data-slot=elicitation-form]'));
   const geometry=await p.evaluate(()=>{const b=[...document.querySelectorAll('[data-slot=elicitation-form] button')].find(e=>e.textContent==='提交答复');return {button:b.getBoundingClientRect().height,parent:b.parentElement.getBoundingClientRect().height,disabled:b.disabled};});measurements.push({phase,width,category:'buttons',...geometry});
   await shot('buttons','[data-slot=elicitation-form]');
   if(phase==='after')check('32px Elicitation action fits parent and remains disabled '+width,geometry.button===32&&geometry.parent===32&&geometry.disabled);
   check('no page overflow '+phase+' '+width,await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   check('no browser/external errors '+phase+' '+width,p.errors.length===0&&p.blocked.length===0);
  }finally{await p.close();await f.close();}
 }
 // Actual queue business owner: synthetic SQLite/runtime/home and held engine.
 for(const phase of process.env.HOMER_COMPONENT_BUILD?['after']:['before','after']){
  const f=await queueBrowserFixture(webFor(phase),3,join(runtimeBase,'q')),app=f.app;
  const actor={agentId:app.store.meta('mainAgentId'),sourceRequestId:'A',threadId:app.store.meta('mainThread')};
  const task=app.tasks.createTask(actor,{operationId:'restore-task',title:'合成调查',goal:'合成材料',authority:{sourceRequestId:'A',description:'合成授权',materials:[],resultIds:[]}});
  const opened=app.tasks.workerOpen(actor,{operationId:'restore-worker',taskId:task.taskId,text:'合成材料'}),run=app.tasks.claim(opened.runId);
  app.tasks.bind(run.id,run.epoch,'worker-thread','worker-turn');
  const worker=app.tasks.endSegment(run.id,run.epoch,{status:'completed',text:'合成Worker结果，原顺序保留。'},true);
  try{for(const width of [320,390,1440]){
   const p=await browser.page(f.server.url,width);
   try{
    await p.navigate();await expandQueue(p);
    await wait(p,()=>[...document.querySelectorAll('.aui-queue-remove')].some(b=>!b.disabled));
    await p.screenshot(`${phase}-queue-${width}.png`);
    if(phase==='after'){
     const expected=app.inputs.dispatchPage(undefined,app.webReadEpoch,'all').items.map(i=>i.messageId);
     assert.deepEqual(await p.evaluate(()=>[...document.querySelectorAll('[data-queue-message]')].map(e=>e.dataset.queueMessage)),expected);checks.push('exact mixed order '+width);
     check('no retired queue editor DOM '+width,await p.evaluate(()=>!document.querySelector('.queue-summary,.queue-handle,.queue-row-actions,.queue-disclosure,.queue-full-text,.queue-editor-bar')));
     check('Worker cannot cancel '+width,await p.evaluate(`!document.querySelector('[data-queue-message="${worker.messageId}"] .aui-queue-remove')`));
     check('24px cancellation and single-line summaries '+width,await p.evaluate(()=>[...document.querySelectorAll('.aui-queue-remove')].every(b=>b.getBoundingClientRect().height===24)&&[...document.querySelectorAll('.aui-queue-text')].every(e=>getComputedStyle(e).whiteSpace==='nowrap')));
     check('queue/composer remain on screen '+width,await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.querySelector('.send-button').getBoundingClientRect().bottom<=innerHeight));
    }
   }finally{await p.close();}
  }
  if(phase==='after'){
   const p=await browser.page(f.server.url,390);
   try{
    const input=app.inputs.byRequestIds(['B'])[0].input,ordinary={text:'原普通草稿',requestId:'ordinary-request',quotes:[{messageId:'source-ordinary',text:'原普通引用',annotation:''}],attachments:[app.media.view(f.refs[0])]};
    const item={...app.inputs.dispatchPage(undefined,app.webReadEpoch,'all').items.find(i=>i.origin==='user'&&i.input.requestId==='B'),user:{media:f.refs.map(ref=>app.media.view(ref))}};
    const session={item,text:'尚未提交的旧队列修改',quotes:[{messageId:'old-one',text:'旧引用一',annotation:'旧批注'},{messageId:'old-two',text:'旧引用二',annotation:''}],attachments:input.attachments,original:ordinary,operationId:'unknown-original-edit'};
    const operation={action:'edit',payload:{requestId:'B',operationId:session.operationId,expectedRevision:item.revision,threadId:app.store.meta('mainThread'),readEpoch:app.webReadEpoch,input:{...input,text:'原未知操作正文'}}};
    const legacy={requestId:'legacy-archived-request',text:'旧单条编辑正文',quote:{messageId:'legacy-source',text:'旧单条准确引用'},attachments:input.attachments};
    const previewLegacy={requestId:'legacy-preview-request',text:'旧预览编辑正文',resourceReference:{kind:'text',source:{kind:'artifact',id:'result-legacy',title:'旧来源.txt',sha256:'a'.repeat(64)},text:'旧预览来源摘录'}};
    const legacyKey='homer-queue-edit:'+legacy.requestId;
    await p.command('Page.addScriptToEvaluateOnNewDocument',{source:`if(!sessionStorage.getItem('restore-seeded')){sessionStorage.setItem('restore-seeded','1');sessionStorage.setItem('homer-draft:${app.store.meta('mainThread')}',${JSON.stringify(JSON.stringify(ordinary))});sessionStorage.setItem('homer-queue-editor:${app.store.meta('mainThread')}',${JSON.stringify(JSON.stringify(session))});sessionStorage.setItem('homer-queue-operation:${app.store.meta('mainThread')}',${JSON.stringify(JSON.stringify(operation))});sessionStorage.setItem(${JSON.stringify(legacyKey)},${JSON.stringify(JSON.stringify(legacy))});sessionStorage.setItem('homer-queue-edit:legacy-preview-request',${JSON.stringify(JSON.stringify(previewLegacy))});}`});
    await p.navigate();await wait(p,()=>document.querySelector('[contenteditable=true]'));await expandQueue(p);
    await wait(p,()=>document.querySelector('[contenteditable=true]')?.textContent==='原普通草稿');
    check('old editor preserves ordinary draft, quote and runtime attachment',await p.evaluate(()=>document.querySelector('[data-slot=composer-quote-text]')?.textContent==='原普通引用'&&document.querySelectorAll('.aui-attachment-root').length===1));
    check('retired editor panel and its empty shell are absent',await p.evaluate(()=>!document.querySelector('.composer-area .queue-draft-recovery')));
    assert.equal(await p.evaluate(`sessionStorage.getItem('homer-queue-editor:${app.store.meta('mainThread')}')`),JSON.stringify(session));checks.push('old session byte-preserved');
    await p.evaluate(()=>[...document.querySelectorAll('.queue-draft-recovery summary')].filter(element=>element.textContent==='未提交的排队编辑草稿').forEach(element=>element.click()));
    check('legacy single quote remains readable',await p.evaluate(()=>[...document.querySelectorAll('.queue-draft-recovery')].some(element=>['旧单条编辑正文','旧单条准确引用','10 个原附件引用'].every(text=>element.textContent.includes(text)))));
    check('legacy preview source remains readable',await p.evaluate(()=>[...document.querySelectorAll('.queue-draft-recovery')].some(element=>['旧预览编辑正文','旧预览来源摘录','旧来源.txt'].every(text=>element.textContent.includes(text)))));
    assert.equal(await p.evaluate(`sessionStorage.getItem(${JSON.stringify(legacyKey)})`),JSON.stringify(legacy));checks.push('legacy request and storage byte-preserved without submission');
    assert.equal(await p.evaluate("sessionStorage.getItem('homer-queue-edit:legacy-preview-request')"),JSON.stringify(previewLegacy));checks.push('legacy preview storage byte-preserved');
    await wait(p,()=>[...document.querySelectorAll('.aui-queue-remove')].every(b=>b.disabled));
    check('unknown write stays locked without replay',await p.evaluate(()=>[...document.querySelectorAll('.aui-queue-remove')].every(b=>b.disabled))&&f.changes.length===0);
    await p.screenshot('after-queue-old-draft-390.png');
    await p.command('Page.reload');await wait(p,()=>document.querySelector('[contenteditable=true]'));await expandQueue(p);check('old storage survives reload without mutation',f.changes.length===0);
    // Simulate the delayed original request reaching this isolated service. No UI retry exists.
    const delayed=await fetch(f.server.url+'/api/messages/edit',{method:'POST',headers:{Origin:f.server.url,'Content-Type':'application/json'},body:JSON.stringify(operation.payload)});assert.equal(delayed.status,200);
    await p.command('Page.reload');await expandQueue(p);await wait(p,()=>!sessionStorage.getItem('homer-queue-operation:synthetic-queue-browser'));
    check('automatic receipt retains original operation and ordinary draft',f.changes.length===1&&f.changes[0].input.operationId===operation.payload.operationId&&await p.evaluate(()=>document.querySelector('[contenteditable=true]').textContent==='原普通草稿'));
    await wait(p,()=>[...document.querySelectorAll('.aui-queue-remove')].some(b=>!b.disabled));
    const cancelId=app.inputs.byRequestIds(['C'])[0].messageId;
    await p.evaluate(`document.querySelector('[data-queue-message="${cancelId}"] .aui-queue-remove').focus()`);await key(p,'Enter');
    await wait(p,()=>!sessionStorage.getItem('homer-queue-operation:synthetic-queue-browser'));
    check('legal keyboard cancel reaches original CAS owner',f.changes.at(-1).action==='cancel'&&f.changes.at(-1).input.requestId==='C'&&app.inputs.byRequestIds(['C'])[0].state==='cancelled');
    await wait(p,()=>[...document.querySelectorAll('.aui-queue-remove')].some(b=>!b.disabled));await new Promise(done=>setTimeout(done,300));const countBefore=p.requests.filter(r=>r.path==='/api/history/queue').length;await new Promise(done=>setTimeout(done,600));check('idle queue adds no polling',p.requests.filter(r=>r.path==='/api/history/queue').length===countBefore);
    f.mode.loseNextCancel=true;f.mode.hideOperations=true;
    const unknownId=app.inputs.byRequestIds(['D'])[0].messageId;
    await p.evaluate(`document.querySelector('[data-queue-message="${unknownId}"] .aui-queue-remove').click()`);
    await wait(p,()=>!!sessionStorage.getItem('homer-queue-operation:synthetic-queue-browser'));
    check('lost cancellation response retains exact lock',await p.evaluate(()=>[...document.querySelectorAll('.aui-queue-remove')].every(b=>b.disabled)));
    const changes=f.changes.length;await p.command('Page.reload');await wait(p,()=>document.querySelector('[contenteditable=true]'));await expandQueue(p);
    check('unknown cancellation does not replay after refresh',f.changes.length===changes);
    f.mode.hideOperations=false;await p.command('Page.reload');await expandQueue(p);
    await wait(p,()=>!sessionStorage.getItem('homer-queue-operation:synthetic-queue-browser'));
    check('exact cancellation receipt unlocks without duplicate writes',f.changes.length===changes&&app.inputs.byRequestIds(['D'])[0].state==='cancelled');
    check('queue has no browser/external errors',p.errors.length===0&&p.blocked.length===0);
   }catch(error){writeFileSync(join(root,'queue-debug.json'),JSON.stringify({body:await p.evaluate(()=>document.body.innerText),errors:p.errors,requests:p.requests},null,2));await p.screenshot('queue-failure.png');throw error;}finally{await p.close();}
  }
  }finally{await f.close();}
 }
 // More than one dispatch page: total is authoritative, every pending item remains reachable.
 const paged=await queueBrowserFixture(webFor('after'),84,join(runtimeBase,'p'));
 try{const p=await browser.page(paged.server.url,320);try{
  await p.navigate();await expandQueue(p);await wait(p,()=>document.querySelector('.queue-pages button')&&[...document.querySelectorAll('.aui-queue-remove')].some(b=>!b.disabled));
  const first=await p.evaluate(()=>[...document.querySelectorAll('[data-queue-message]')].map(e=>e.dataset.queueMessage));
  check('loaded page is bounded and count header remains removed',first.length<84&&await p.evaluate(()=>!document.querySelector('.aui-queue-count')));
  await p.evaluate(()=>[...document.querySelectorAll('.queue-pages button')].find(b=>b.textContent==='查看下一页').click());
  await wait(p,()=>[...document.querySelectorAll('.queue-pages button')].some(b=>b.textContent==='返回待发送首页')&&[...document.querySelectorAll('.aui-queue-remove')].some(b=>!b.disabled));
  const second=await p.evaluate(()=>[...document.querySelectorAll('[data-queue-message]')].map(e=>e.dataset.queueMessage));
  check('all 84 pending messages and the read-only active row remain reachable across pages',new Set([...first,...second]).size===85);
  await p.screenshot('after-queue-page-2-320.png');
  await p.evaluate(()=>[...document.querySelectorAll('.queue-pages button')].find(b=>b.textContent==='返回待发送首页').click());
  await wait(p,()=>[...document.querySelectorAll('.aui-queue-remove')].some(b=>!b.disabled)&&![...document.querySelectorAll('.queue-pages button')].some(b=>b.textContent==='返回待发送首页'));
  assert.deepEqual(await p.evaluate(()=>[...document.querySelectorAll('[data-queue-message]')].map(e=>e.dataset.queueMessage)),first);checks.push('home page restores exact server order');
 }finally{await p.close();}}finally{await paged.close();}
 writeFileSync(join(root,'results.json'),JSON.stringify({checks,measurements,version:browser.version},null,2));
 console.log(JSON.stringify({passed:checks.length,measurements:measurements.length,evidence:root}));
}catch(error){writeFileSync(join(root,'failure.json'),JSON.stringify({error:String(error.stack),checks,measurements},null,2));throw error;}
finally{await browser.close();}
