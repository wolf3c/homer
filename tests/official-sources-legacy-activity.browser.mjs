// Requirement-derived synthetic history; actual built UI and in-memory HTTP/SSE.
// No production configuration, history, credentials, engine or model imports.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {composerFixture} from './fixtures/composer-browser-server.mjs';
import {isolatedChrome} from './web-history-browser-cdp.mjs';
const root=resolve('.codex/scratch/official-sources-legacy-activity-20261023');
const destination=resolve(process.env.HOMER_BROWSER_EVIDENCE??join(root,'browser'));
const webDir=resolve(process.env.HOMER_COMPONENT_BUILD??join(root,'candidate-web'));
mkdirSync(destination,{recursive:true});
const message=(id,text,extra={})=>({id,threadId:'composer-review',requestId:null,role:'assistant',text,status:'completed',createdAt:1792670400000,...extra});
const sources=[
 {id:'source-z',title:'长中文标题：核对这份公开资料中的日期、范围与限制，保留准确的文字和链接'.repeat(3),url:'https://www.example.com/reference'},
 {id:'source-a',title:'同一网址的另一个已记录身份',url:'https://www.example.com/reference'},
 {id:'source-m',title:'<img src=x onerror=alert(1)> 安全文本',url:'http://example.org/docs'},
 ...['javascript:alert(1)','data:text/html,x','https://private:secret@example.com/','/api/files/private','file:///private/internal','invalid'].map((url,i)=>({id:'bad-'+i,title:'不安全来源不显示',url})),
];
const tools=['completed','completed','failed','blocked','running','unknown'].map((status,i)=>({id:'legacy-call-'+i,label:i===5?'':'同名检查',status}));
const processNode={id:'new-process',threadId:'composer-review',seq:2,revision:1,messageId:'new-process',sourceKind:'user',sourceMessageIds:[],turnIds:['synthetic-turn'],state:'worked',status:'completed',items:[
 {id:'new-tool-1',kind:'tool',seq:1,revision:1,label:'新过程调用',category:'host',status:'completed'},
 {id:'event-1',kind:'workerEvent',seq:2,revision:1,eventKey:'synthetic-result',event:{eventKind:'result_received',title:'合成 Worker',body:'当时收到的公开结果。'}},
 {id:'old-worker',kind:'worker',seq:3,revision:1,label:'旧后台记录'},
]};
const initial=[message('empty','没有引用或工具的合成回复。'),message('legacy','# 合成历史回复\n\n**保留正文**与 `x = 1`。\n\n- 原列表\n\n```text\n原代码\n```',{sources,toolActivities:tools}),message('new-process','新过程正式答复。',{process:processNode,toolActivities:[]})];
const fixture=await composerFixture({webDir,beforeDir:webDir,branding:resolve('assets/branding/homer-river-stone-256.de41791ce5c1.png')});
if(process.argv.includes('--preview')){
 fixture.reset({messages:structuredClone(initial),features:{draftUpload:false,taskOverview:false}});
 console.log('Sources 与历史 RunActivity 隔离合成候选：'+fixture.url+'\nCtrl+C 关闭；不连接真实业务或模型。');
 await new Promise(done=>{process.once('SIGINT',done);process.once('SIGTERM',done);});
 await fixture.close();
}else{
let chrome;const results=[];
async function key(p,key){const n=key==='Enter'?13:key==='Tab'?9:32;await p.command('Input.dispatchKeyEvent',{type:'keyDown',key,code:key===' '?'Space':key,windowsVirtualKeyCode:n,...(key===' '?{text:' '}:key==='Enter'?{text:'\r'}:{})});await p.command('Input.dispatchKeyEvent',{type:'keyUp',key,windowsVirtualKeyCode:n});}
try{
 chrome=await isolatedChrome(destination);
 for(const width of [320,390,1440]){
  fixture.reset({messages:structuredClone(initial),features:{draftUpload:false,taskOverview:false}});
  const p=await chrome.page(fixture.url,width),checks=[];
  const wait=fn=>p.until('Boolean(('+String(fn)+')())',12000);
  const check=async(label,fn)=>{assert.ok(await p.evaluate(fn),label);checks.push(label);};
  const focus=selector=>p.evaluate('document.querySelector('+JSON.stringify(selector)+').focus()');
  const shot=async name=>{await p.evaluate(()=>document.querySelector('#message-legacy').scrollIntoView({block:'start'}));await p.screenshot(name+'-'+width+'.png');};
  try{
   await p.navigate();await wait(()=>document.querySelector('#message-legacy [data-slot=sources]'));
   await check('empty sources/tools absent; exactly one disclosure for each old/new activity',()=>!document.querySelector('#message-empty [data-slot=sources],#message-empty [data-slot=run-activity]')&&document.querySelectorAll('#message-legacy [data-slot=run-activity]').length===1&&document.querySelectorAll('#message-new-process [data-slot=run-activity]').length===1);
   await check('both old disclosures initially closed; no invented clock or success',()=>[...document.querySelectorAll('#message-legacy [data-slot=collapsible-trigger]')].every(b=>b.getAttribute('aria-expanded')==='false')&&document.querySelector('#message-legacy [data-slot=run-activity]').dataset.status==='incomplete'&&!/Worked|成功|\d+s/.test(document.querySelector('#message-legacy [data-slot=run-activity]').textContent));
   await shot('closed');
   await focus('#message-legacy [data-slot=sources] [data-slot=collapsible-trigger]');await key(p,'Enter');
   await wait(()=>document.querySelectorAll('#message-legacy [data-slot=source-card]').length===3);
   await check('Sources list preserves exact IDs, URL, order and duplicates',()=>JSON.stringify([...document.querySelectorAll('#message-legacy [data-slot=source-card]')].map(a=>[a.dataset.sourceId,a.getAttribute('href')]))===JSON.stringify([['source-z','https://www.example.com/reference'],['source-a','https://www.example.com/reference'],['source-m','http://example.org/docs']]));
   await check('safe text, complete title, disclaimer, no favicon/image',()=>document.querySelector('[data-source-id=source-z]').textContent.includes('长中文标题')&&document.querySelector('[data-source-id=source-m]').textContent.includes('<img src=x onerror=alert(1)>')&&!document.querySelector('#message-legacy [data-slot=sources] img')&&document.querySelector('#message-legacy .message-source-note').textContent.includes('未经独立核验')&&!document.querySelector('#message-legacy [data-slot=sources]').textContent.includes('不安全来源'));
   await key(p,'Tab');
   await check('keyboard reaches source link with native new-tab security and compact rows',()=>document.activeElement?.dataset.sourceId==='source-z'&&[...document.querySelectorAll('#message-legacy [data-slot=source-card]')].every(a=>a.target==='_blank'&&a.rel==='noopener noreferrer'&&a.getBoundingClientRect().height>0&&a.getBoundingClientRect().height<44));
   const focusStyle=await p.evaluate(()=>({style:getComputedStyle(document.activeElement).outlineStyle,width:getComputedStyle(document.activeElement).outlineWidth}));assert.equal(focusStyle.style,'solid');assert.equal(focusStyle.width,'2px');
   // Observe native keyboard link activation and prevent its navigation.
   // No external page or favicon is fetched by this test.
   await p.evaluate(()=>{document.querySelector('[data-source-id=source-z]').addEventListener('click',e=>{window.__sourceActivation={href:e.currentTarget.href,target:e.currentTarget.target,rel:e.currentTarget.rel,trusted:e.isTrusted};e.preventDefault();},{once:true});});await key(p,'Enter');
   await check('Enter activates exact source under user gesture',()=>window.__sourceActivation?.trusted&&window.__sourceActivation.href==='https://www.example.com/reference'&&window.__sourceActivation.target==='_blank');
   await focus('#message-legacy .message-legacy-activity [data-slot=collapsible-trigger]');await key(p,' ');
   await wait(()=>document.querySelectorAll('#message-legacy [data-tool-id]').length===6);
   assert.deepEqual(await p.evaluate(()=>[...document.querySelectorAll('#message-legacy [data-tool-id]')].map(e=>e.dataset.toolId)),tools.map(t=>t.id));
   await check('same-name distinct calls; failure/blocked/unknown/missing labels stay accurate',()=>{const t=document.querySelector('#message-legacy .message-legacy-activity').textContent;return ['调用已返回','调用失败','已中断，待核对','调用中','结束状态待核实','工具名称未保留'].every(s=>t.includes(s));});
   await check('no restored activity reader or old sidebar',()=>!document.querySelector('.activity-reader,.task-overview-panel')&&![...document.querySelectorAll('#message-legacy button')].some(b=>/查看活动|查看关联任务|查看任务与版本/.test(b.textContent)));
   await wait(()=>!document.querySelector('#message-legacy [data-slot=sources] [data-slot=collapsible-content]').getAnimations().length&&!document.querySelector('#message-legacy .message-legacy-activity [data-slot=collapsible-content]').getAnimations().length);
   const metrics=await p.evaluate(()=>{const s=document.querySelector('#message-legacy [data-slot=sources]'),r=document.querySelector('#message-legacy [data-slot=run-activity]');return {sourceMax:getComputedStyle(s).maxWidth,sourceFont:getComputedStyle(s.querySelector('[data-slot=collapsible-trigger]')).fontSize,activityFont:getComputedStyle(r.querySelector('[data-slot=collapsible-trigger]')).fontSize,activityGap:getComputedStyle(r.querySelector('ol')).gap};});assert.deepEqual(metrics,{sourceMax:'384px',sourceFont:'12px',activityFont:'14px',activityGap:'12px'});
   await check('rich content, date/time, original composer still rendered',()=>document.querySelector('#message-legacy .markdown strong')?.textContent==='保留正文'&&!!document.querySelector('#message-legacy .markdown ul li')&&!!document.querySelector('#message-legacy .markdown pre')&&!!document.querySelector('time')&&!!document.querySelector('[contenteditable=true]'));
   await check('no page overflow at this width',()=>document.documentElement.scrollWidth<=innerWidth);
   await shot('expanded');
   await focus('#message-new-process [data-slot=collapsible-trigger]');await key(p,'Enter');await wait(()=>document.querySelector('#message-new-process [data-tool-id=new-tool-1]'));
   await check('new activity keeps Worker card once and missing-content note',()=>document.querySelectorAll('#message-new-process .worker-event-card').length===1&&document.querySelector('#message-new-process').textContent.includes('当时的事件内容未保留')&&document.querySelector('#message-new-process [data-slot=run-activity]').dataset.status==='complete');
   fixture.update({messages:[initial[0],{...initial[1],status:'interrupted',toolActivities:tools.map(t=>t.id==='legacy-call-4'?{...t,status:'blocked'}:t)},initial[2]]});
   await wait(()=>document.querySelector('[data-tool-id=legacy-call-4]')?.textContent.includes('已中断，待核对'));
   await check('message/receipt update preserves user-opened disclosures',()=>[...document.querySelectorAll('#message-legacy [data-slot=collapsible-trigger]')].every(b=>b.getAttribute('aria-expanded')==='true'));
   await focus('#message-legacy .message-legacy-activity [data-slot=collapsible-trigger]');await key(p,' ');await wait(()=>!document.querySelector('#message-legacy .message-legacy-activity [data-slot=collapsible-content]'));
   await check('folding retains keyboard focus',()=>document.activeElement===document.querySelector('#message-legacy .message-legacy-activity [data-slot=collapsible-trigger]'));
   await key(p,' ');await wait(()=>document.querySelectorAll('#message-legacy [data-tool-id]').length===6);
   await p.command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
   await check('official reduced motion respected',()=>[...document.querySelectorAll('#message-legacy [data-slot=collapsible-content]')].every(e=>getComputedStyle(e).transitionDuration==='0s'));
   fixture.update({messages:[initial[0],{...initial[1],sources:sources.filter(s=>s.id.startsWith('bad-'))},initial[2]]});await wait(()=>!document.querySelector('#message-legacy [data-slot=sources]'));
   checks.push('all unsafe source rows produce no empty entity');
   assert.deepEqual(p.errors,[]);assert.deepEqual(p.blocked,[]);assert.equal(p.requests.some(r=>/favicon|duckduckgo|reference/.test(r.path)),false);
   assert.equal(fixture.received.messages.length,0);assert.equal(fixture.received.uploads.length,0);assert.equal(fixture.received.stops.length,0);
   results.push({width,checks,metrics,focusStyle,passed:true});
  }finally{await p.close();}
 }
 writeFileSync(join(destination,'results.json'),JSON.stringify({syntheticOnly:true,version:chrome.version,results},null,2)+'\n');
 console.log(JSON.stringify({passed:true,widths:results.map(r=>r.width),checks:results.reduce((n,r)=>n+r.checks.length,0)}));
}finally{await chrome?.close();await fixture.close();}
}
