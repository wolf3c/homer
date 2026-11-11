// Real built UI + local HTTP + synthetic immutable events. No production/model/profile.
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fixture} from './web-history-followup-fixture.mjs';
import {isolatedChrome} from './web-history-browser-cdp.mjs';
const destination=resolve(process.env.HOMER_REVIEW_EVIDENCE_ROOT??'.codex/scratch/worker-event-cards-browser');mkdirSync(destination,{recursive:true});
const f=await fixture(0,'after'),chrome=await isolatedChrome(destination),reports=[];
const base={title:'保持历史消息阅读位置，并检查历史图片延迟加载时的阅读位置',taskId:'synthetic-task-1',version:1,runId:'synthetic-run-1',sourceMessageId:null,operationKey:null,observedAtMs:1};
const bodies=['保持用户正在阅读的历史消息位置。\n新消息到达、历史图片延迟加载、窗口变窄时保留原阅读位置，不自动拉回底部。'.repeat(3),'已核对 3 项，1 项仍需确认。\n<img src=x onerror=never()> **保留原文**','认证失败，Worker 未能启动。'];
try{
 f.store.db.prepare('INSERT INTO conversation_messages(id,threadId,requestId,role,text,status,quote,createdAt) VALUES(?,?,?,?,?,?,?,?)').run('synthetic-user','synthetic-history',null,'user','请核对会议记录中的日期。','completed',null,1);
 for(const [n,eventKind] of ['delegated','reply_received','start_failed'].entries()){
  const id='event-node-'+n;f.processes.start({id,threadId:'synthetic-history',sourceKind:n?'worker':'user',sourceMessageIds:[],messageId:id},'turn-'+n);
  f.history.record(id,'synthetic-history','','completed');
  f.processes.workerEvent(id,{...base,eventKey:'synthetic:'+n,eventKind,body:bodies[n],bodySource:n===0?'description':n===1?'reply':'error',...(n===1?{sourceMessageId:'synthetic-reply-notice'}:{}),...(n===2?{taskId:'synthetic-task-2',runId:'synthetic-run-2',title:'核对附件日期',failureStage:'startup',errorCode:'engine_authentication_failed'}:{})});f.processes.finish(id,'completed','terminal-'+n);
 }
 for(const width of [1440,704,390,320]){
  const page=await chrome.page(f.server.url,width);
  try{
   await page.command('Emulation.setDeviceMetricsOverride',{width,height:width<600?1100:1000,deviceScaleFactor:1,mobile:false});
   if(f.server.connectionFile){
    const target=new URL(readFileSync(f.server.connectionFile,'utf8').match(/href="([^"]+)"/)[1]);assert.equal(target.origin,f.server.url);assert.equal(target.pathname,'/connect');
    await page.command('Page.navigate',{url:target.href});await page.until(()=>location.pathname==='/'&&!!sessionStorage.getItem('homer-user-connection'));
   }else await page.navigate();
   await page.until(()=>document.querySelectorAll('[data-worker-event]').length===2);
   assert.equal(await page.evaluate(()=>document.querySelectorAll('#message-event-node-1 [data-worker-event]').length),0,'a reply stays inside its closed process');
   await page.evaluate(()=>document.querySelector('#message-event-node-1 [data-slot=collapsible-trigger]').click());
   await page.until(()=>document.querySelectorAll('[data-worker-event]').length===3);
   const facts=await page.evaluate(()=>({cards:[...document.querySelectorAll('[data-worker-event]')].map(el=>({title:el.title,header:el.querySelector('button').textContent,state:el.dataset.state,expanded:el.querySelector('button').getAttribute('aria-expanded'),buttons:el.querySelectorAll('button').length,details:el.querySelectorAll('[data-slot="task-card-transcript"]').length,width:el.getBoundingClientRect().width,maxWidth:getComputedStyle(el).maxWidth,labelSize:getComputedStyle(el.querySelector('button > .min-w-0')).fontSize,buttonHeight:el.querySelector('button').getBoundingClientRect().height})),overflow:document.documentElement.scrollWidth>innerWidth,folded:[...document.querySelectorAll('[data-slot="collapsible-trigger"]')].filter(el=>!el.closest('#message-event-node-1')).every(el=>el.getAttribute('aria-expanded')==='false'),spinners:document.querySelectorAll('[data-worker-event] .animate-spin').length,extra:document.querySelectorAll('[data-worker-event] a,[data-slot="task-card-result"],[data-slot="task-card-actions"]').length}));
   assert.equal(facts.overflow,false);assert.equal(facts.folded,true);assert.equal(facts.cards.length,3);assert.equal(facts.spinners,0);assert.equal(facts.extra,0);
   assert.deepEqual(facts.cards.map(c=>c.state),['waiting','waiting','failed']);
   assert.ok(facts.cards.every(c=>c.expanded==='false'&&c.buttons===1&&c.details===0&&c.width<=384&&c.maxWidth==='384px'&&c.labelSize==='13.5px'&&c.buttonHeight>=44),JSON.stringify(facts));
   assert.ok(facts.cards[0].header.includes('已交办'));assert.ok(facts.cards[1].header.includes('收到回复'));assert.ok(facts.cards[2].header.includes('启动失败'));
   assert.equal(facts.cards[0].title,base.title+' · 当时：已交办');
   await page.evaluate(()=>document.querySelector('[data-conversation-message]').scrollIntoView({block:'start'}));
   await page.screenshot('worker-events-'+width+'.png');
   await page.command('Page.bringToFront');
   await page.evaluate(()=>document.querySelector('#message-event-node-0 [data-slot="collapsible-trigger"]').focus());
   await page.command('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await page.command('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
   assert.equal(await page.evaluate(()=>document.activeElement===document.querySelector('[data-worker-event="synthetic:0"] > button')),true);
   assert.equal(await page.evaluate(()=>getComputedStyle(document.activeElement).outlineWidth),'2px');
   const detailReadsBefore=page.requests.filter(request=>request.path==='/api/history/process').length;
   await page.command('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r',unmodifiedText:'\r'});await page.command('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
   await page.until(()=>document.querySelector('[data-worker-event="synthetic:0"] > button').getAttribute('aria-expanded')==='true');
   assert.equal(await page.evaluate(()=>document.querySelector('[data-worker-event="synthetic:0"] p').textContent),bodies[0]);
   await page.command('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',windowsVirtualKeyCode:32});await page.command('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});
   await page.until(()=>document.querySelector('[data-worker-event="synthetic:0"] > button').getAttribute('aria-expanded')==='false');
   assert.equal(await page.evaluate(()=>document.activeElement===document.querySelector('[data-worker-event="synthetic:0"] > button')),true);
   await page.evaluate(()=>{for(const button of document.querySelectorAll('[data-worker-event] > button'))button.click();});
   assert.deepEqual(await page.evaluate(()=>[...document.querySelectorAll('[data-worker-event] p')].map(p=>p.textContent)),bodies);
   assert.equal(await page.evaluate(()=>[...document.querySelectorAll('[data-worker-event] p')].some(p=>p.scrollWidth>p.clientWidth)||document.documentElement.scrollWidth>innerWidth),false);
   assert.equal(await page.evaluate(()=>document.querySelectorAll('[data-worker-event] img,[data-worker-event] dialog').length),0);
   assert.equal(page.requests.filter(request=>request.path==='/api/history/process').length,detailReadsBefore,'TaskCard toggles do not request process details');
   await page.screenshot('worker-events-expanded-'+width+'.png');
   // Delegation/failure cards retain their DOM; a reply belongs to its own process.
   await page.evaluate(()=>{window.__delegation=document.querySelector('[data-worker-event="synthetic:0"]');document.querySelector('#message-event-node-0 [data-slot="collapsible-trigger"]').click();});
   await page.until(()=>document.querySelector('#message-event-node-0 [data-slot="collapsible-trigger"]').getAttribute('aria-expanded')==='true');
   assert.equal(await page.evaluate(()=>window.__delegation===document.querySelector('[data-worker-event="synthetic:0"]')&&!document.querySelector('#message-event-node-0 [data-slot="run-activity"]').contains(window.__delegation)),true);
   assert.equal(await page.evaluate(()=>document.querySelectorAll('[data-worker-event]').length),3);
   assert.equal(await page.evaluate(()=>window.__delegation.querySelector('button').getAttribute('aria-expanded')),'true');
   await page.evaluate(()=>document.querySelector('#message-event-node-0 [data-slot="collapsible-trigger"]').click());
   assert.equal(await page.evaluate(()=>window.__delegation.querySelector('button').getAttribute('aria-expanded')),'true');
   await page.evaluate(()=>document.querySelector('#message-event-node-1 [data-slot="collapsible-trigger"]').click());
   await page.until(()=>!document.querySelector('[data-worker-event="synthetic:1"]'));
   await page.evaluate(()=>document.querySelector('#message-event-node-1 [data-slot="collapsible-trigger"]').click());
   await page.until(()=>!!document.querySelector('[data-worker-event="synthetic:1"]'));
   assert.equal(await page.evaluate(()=>document.querySelectorAll('[data-worker-event="synthetic:1"]').length),1);
   assert.equal(await page.evaluate(()=>document.querySelector('[data-worker-event="synthetic:1"] > button').getAttribute('aria-expanded')),'false');
   await page.command('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'dark'},{name:'prefers-reduced-motion',value:'reduce'}]});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('[data-worker-event="synthetic:0"] button > span[aria-hidden]')).animationName),'none');
   await page.screenshot('worker-events-dark-'+width+'.png');
   await page.navigate();await page.until(()=>document.querySelectorAll('[data-worker-event]').length===2);
   assert.equal(await page.evaluate(()=>document.querySelectorAll('[data-worker-event="synthetic:1"]').length),0);
   assert.equal(await page.evaluate(()=>[...document.querySelectorAll('[data-worker-event] > button')].every(button=>button.getAttribute('aria-expanded')==='false')),true);
   assert.deepEqual(page.errors,[]);assert.deepEqual(page.blocked,[]);assert.equal(f.fakeEngine.invocations,0);assert.deepEqual(f.submitted,[]);
   reports.push({width,...facts,tabNavigation:true,keyboardDisclosure:true,focusOutline:true,cardDetailReads:0,plainTextBodies:true,outerDisclosureNoDuplicate:true,remountStartsClosed:true,darkSystemPreferenceChecked:true,errors:page.errors,externalRequests:page.blocked});
  }finally{await page.close();}
 }
 writeFileSync(join(destination,'worker-event-browser-checks.json'),JSON.stringify({productionAdopted:false,data:'synthetic',browser:chrome.version,reports},null,2)+'\n');console.log(JSON.stringify({pass:true,widths:reports.map(r=>r.width),cards:3,engineCalls:0,submits:0}));
}finally{await chrome.close();await f.close();}
