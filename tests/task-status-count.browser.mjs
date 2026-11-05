// Real product component + data hook in an isolated page; all task data synthetic.
// No Homer service/runtime, account, models, business writes or application restart.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {build} from 'esbuild';
import {overviewTask as task} from './task-status-browser-data.mjs';
const destination=resolve(process.env.HOMER_BROWSER_EVIDENCE??'.codex/scratch/task-status-count');
await mkdir(destination,{recursive:true});
const scratch=await mkdtemp(join(destination,'fixture-'));
const checks=[],metrics=[],errors=[];let browser,server,page;
const roots=n=>({tasks:Array.from({length:n},(_,i)=>task('root-'+i))});
let snapshot=roots(0),fail=false,hold=false,held=[];
try{
 const {chromium}=await import(process.env.HOMER_PLAYWRIGHT_MODULE??'playwright-core');
 const entry=`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {MessageCircle,Settings,PanelRight} from 'lucide-react';import {TaskStatusPopover} from './ui/task-status';import './ui/homer-styles.css';
 function Fixture(){const [connection,setConnection]=useState(true),[state,setState]=useState({threadId:'synthetic',interactions:[]});window.statusFixture={update:(connected=true)=>{setConnection(connected);setState(s=>({...s}));}};return <div className="conversation-panel"><header className="conversation-header"><span>荷马</span><div className="header-actions"><button aria-label="聊天"><MessageCircle/></button><button aria-label="设置"><Settings/></button><TaskStatusPopover state={state} connected={connection} onInteraction={()=>{}} asideContainer={null} onBeforeLayoutChange={()=>{}}/><button aria-label="侧栏"><PanelRight/></button></div></header><main style={{padding:24,color:'#67645f'}}>合成任务验证 · 实际产品组件与读取逻辑</main></div>};createRoot(document.getElementById('root')).render(<Fixture/>);`;
 await build({stdin:{contents:entry,resolveDir:process.cwd(),sourcefile:'task-count-fixture.tsx',loader:'tsx'},bundle:true,outfile:join(scratch,'app.js'),platform:'browser',format:'esm',jsx:'automatic',logLevel:'silent'});
 const assets=new Map([['/',Buffer.from('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script>')],['/app.js',await readFile(join(scratch,'app.js'))],['/app.css',await readFile(join(scratch,'app.css'))]]);
 server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/'?'text/html; charset=utf-8':req.url==='/app.css'?'text/css':'text/javascript');if(assets.has(req.url))res.end(assets.get(req.url));else{res.statusCode=404;res.end();}});
 await new Promise(done=>server.listen(0,'127.0.0.1',done));const origin='http://127.0.0.1:'+server.address().port;
 // Exactly one launch attempt. An environment failure is recorded and never retried.
 browser=await chromium.launch({channel:'chrome',headless:true});
 const context=await browser.newContext({viewport:{width:800,height:600},deviceScaleFactor:2});page=await context.newPage();page.setDefaultTimeout(10000);
 page.on('pageerror',error=>errors.push(error.message));
 await context.route('**/*',route=>{const address=new URL(route.request().url());if(address.origin!==origin||route.request().method()!=='GET'){errors.push('unexpected_request');return route.abort();}if(address.pathname==='/api/tasks'){if(hold){held.push(route);return;}return fail?route.fulfill({status:503,body:'synthetic_failure'}):route.fulfill({json:snapshot});}return route.continue();});
 await page.goto(origin);const trigger=page.locator('#task-status-trigger'),panel=page.getByRole('dialog',{name:'工作状态卡片'});
 const ok=(condition,name)=>{assert.ok(condition,name);checks.push(name);};
 const refresh=async()=>{await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));};
 const waitName=name=>page.getByRole('button',{name,exact:true}).waitFor();
 const bounds=async()=>trigger.evaluate(el=>{const icon=el.querySelector('svg').getBoundingClientRect(),slot=el.querySelector('.status-count-slot').getBoundingClientRect(),next=el.closest('.homer-task-status').nextElementSibling.getBoundingClientRect(),r=el.getBoundingClientRect(),count=el.querySelector('.status-entry-count'),style=count&&getComputedStyle(count);return {width:r.width,height:r.height,iconWidth:icon.width,gap:slot.x-icon.right,slotWidth:slot.width,iconX:icon.x,nextX:next.x,overlap:r.right>next.x,countHeight:count?.getBoundingClientRect().height,font:style?.fontSize,weight:style?.fontWeight,background:style?.backgroundColor};});
 await waitName('工作状态，无工作中任务');const zero=await bounds();ok(await trigger.locator('[data-count]').count()===0,'zero hides number and background, retains slot');
 await page.screenshot({path:join(destination,'count-0.png')});
 for(const n of [1,12,100]){
  snapshot=roots(n);await refresh();await waitName('工作状态，'+n+' 个任务工作中');
  const b=await bounds();metrics.push({n,...b});ok(b.width===60&&b.height===44&&b.iconWidth===18&&b.gap===4&&b.slotWidth===22&&b.countHeight===18&&b.font==='11px'&&b.weight==='600'&&!b.overlap,'dimensions and no overlap '+n);
  ok(b.iconX===zero.iconX&&b.nextX===zero.nextX,'stable adjacent positions '+n);
  ok(await trigger.locator('[data-count="working"]').innerText()===(n>99?'99+':String(n)),'bounded display with full accessible count '+n);
  await page.screenshot({path:join(destination,'count-'+n+'.png')});
 }
 snapshot=roots(12);await refresh();await waitName('工作状态，12 个任务工作中');
 await trigger.focus();await page.keyboard.press('Enter');await panel.waitFor();
 ok(await trigger.getAttribute('aria-expanded')==='true'&&await trigger.getAttribute('aria-controls')==='task-status-panel','original button expands controlled panel by keyboard');
 ok(await panel.locator('[data-count="working"]').innerText()==='12','panel working count equals badge');
 await page.screenshot({path:join(destination,'count-12-expanded.png')});
 await page.keyboard.press('Escape');await panel.waitFor({state:'hidden'});ok(await trigger.evaluate(el=>el===document.activeElement),'Escape restores trigger focus');
 const root=task('mixed'),a=root.workers[0];
 const peer=id=>({...a,id,run:{...a.run,id:'run-'+id,workerId:id}});
 const b=peer('b'),q=peer('queue'),ask={...peer('ask'),pendingUser:1,pendingUsers:[{id:'question',after:0}]};q.run.status='queued';q.run.phase='ready';ask.run.phase='rpc_wait';
 root.workers=[a,b,q,ask];snapshot={tasks:[root]};await refresh();await waitName('工作状态，1 个任务工作中');await trigger.click();await panel.waitFor();
 ok(await panel.locator('[data-count="working"]').innerText()==='1'&&await panel.locator('[data-count="queued"]').innerText()==='1'&&await panel.locator('[data-count="needs-user"]').innerText()==='1','one Task deduplicates multiple sessions while queue and requests remain separate');
 b.run={...b.run,id:'retry',epoch:2};a.run.phase='ended';a.run.status='succeeded';await refresh();await waitName('工作状态，1 个任务工作中');
 root.headVersion=2;await refresh();await waitName('工作状态，1 个任务工作中');
 b.run.version=2;await refresh();await waitName('工作状态，1 个任务工作中');checks.push('goal and session versions remain separate, without duplicate counts');
 b.run.phase='uncertain';await refresh();await waitName('工作状态，数量待核实');
 b.run.phase='executing';await refresh();await waitName('工作状态，1 个任务工作中');
 fail=true;await refresh();await waitName('工作状态，读取失败');ok(await trigger.locator('[data-count]').count()===0,'failed refresh hides live badge instead of showing old count');
 fail=false;await refresh();await waitName('工作状态，1 个任务工作中');
 await page.evaluate(()=>window.statusFixture.update(false));await waitName('工作状态，连接未确认');ok(await trigger.locator('[data-count]').count()===0,'disconnect never becomes a known zero');
 hold=true;await page.reload();await waitName('工作状态，正在读取');ok(await trigger.locator('[data-count]').count()===0,'unloaded snapshot hides badge');hold=false;for(const route of held)await route.fulfill({json:roots(0)});held=[];await waitName('工作状态，无工作中任务');
 snapshot=roots(35);await refresh();await waitName('工作状态，35 个任务工作中');ok(true,'full snapshot count survives list prefix');
 await trigger.click();await panel.waitFor();ok(await panel.locator('[data-count="working"]').innerText()==='35','full panel summary matches badge');
 for(const width of [320,390,800]){await page.setViewportSize({width,height:600});ok(await page.evaluate(()=>document.documentElement.scrollWidth)===width,'no horizontal overflow '+width);
   const layout=await panel.evaluate(el=>{const filters=[...el.querySelectorAll('.status-count-filter')].map(e=>e.getBoundingClientRect()),close=el.querySelector('[aria-label="收起工作状态"]').getBoundingClientRect();return {count:filters.length,sameRow:filters.every(r=>Math.abs(r.top-filters[0].top)<1),closeAbove:close.bottom<=filters[0].top,overflow:[...el.querySelectorAll('.status-count-filter')].some(e=>e.scrollWidth>e.clientWidth)};});
   ok(layout.count===3&&layout.sameRow&&layout.closeAbove&&!layout.overflow,'three filters below the title and close button '+width);
   await page.screenshot({path:join(destination,'panel-'+width+'.png')});
  }
 snapshot=roots(1);snapshot.tasks[0].workers[0].run.phase='uncertain';await refresh();await waitName('工作状态，数量待核实');await page.setViewportSize({width:320,height:600});
 ok(await panel.locator('.status-count-filter').evaluateAll(filters=>filters.every(e=>e.scrollWidth<=e.clientWidth)),'unverified count fits narrow filters');
 ok(errors.length===0,'no page errors or business writes');
}catch(error){errors.push(String(error.stack??error));process.exitCode=1;}
finally{await writeFile(join(destination,'browser-results.json'),JSON.stringify({synthetic:true,checks,metrics,errors,realBrowserVerified:checks.length>0&&errors.length===0},null,2));await browser?.close();await new Promise(done=>server?server.close(done):done());await rm(scratch,{recursive:true,force:true});}
console.log(JSON.stringify({checks:checks.length,errors:errors.length,destination}));
