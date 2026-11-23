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
const checks=[],errors=[];let browser,server,page;
const roots=n=>({tasks:Array.from({length:n},(_,i)=>task('root-'+i))});
const ordinary=task('ordinary',{title:'整理采购要求',goal:'不应显示的目标',notes:'不应显示的工作笔记',workers:[]});
const mixed=task('mixed',{title:'核对供应商报价',hasExecutingWorker:true}),active=mixed.workers[0];
const uncertain={...active,id:'uncertain',run:{...active.run,workerId:'uncertain',id:'uncertain',phase:'uncertain'}};
mixed.workers.push(uncertain);
const stopping=task('stopping',{title:'修订合同条款'});stopping.workers[0].run.stopRequestedAt=1;
const archived=task('archived',{title:'去年报价',state:'paused',historyState:'archived',hasExecutingWorker:true});archived.workers[0].run.status='succeeded';archived.workers[0].run.phase='ended';
let snapshot={tasks:[ordinary,mixed,stopping],nextCursor:50},fail=false;
const paths=[],archivePath='/api/tasks/list/archived';
let historyMode='normal',releaseArchive;

try{
 const {chromium}=await import(process.env.HOMER_PLAYWRIGHT_MODULE??'playwright-core');
 const entry=`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {MessageCircle,Settings,PanelRight} from 'lucide-react';import {TaskStatusPopover} from './ui/task-status';import './ui/homer-styles.css';
 function Fixture(){const [connection,setConnection]=useState(true),[state,setState]=useState({threadId:'synthetic',interactions:[]}),[aside,setAside]=useState(null);window.statusFixture={update:(connected=true)=>{setConnection(connected);setState(s=>({...s}));}};return <div className="conversation-workspace"><div className="conversation conversation-panel"><header className="conversation-header"><span>荷马</span><div className="header-actions"><button aria-label="聊天"><MessageCircle/></button><button aria-label="设置"><Settings/></button><TaskStatusPopover state={state} connected={connection} asideContainer={aside} onBeforeLayoutChange={()=>{}}/><button aria-label="侧栏"><PanelRight/></button></div></header><main style={{padding:24,color:'#67645f'}}>合成任务验证 · 实际产品组件与读取逻辑</main></div><div className="status-aside-slot" ref={setAside}/></div>};createRoot(document.getElementById('root')).render(<Fixture/>);`;
 await build({stdin:{contents:entry,resolveDir:process.cwd(),sourcefile:'task-count-fixture.tsx',loader:'tsx'},bundle:true,outfile:join(scratch,'app.js'),platform:'browser',format:'esm',jsx:'automatic',logLevel:'silent'});
 const assets=new Map([['/',Buffer.from('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script>')],['/app.js',await readFile(join(scratch,'app.js'))],['/app.css',await readFile(join(scratch,'app.css'))]]);
 server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/'?'text/html; charset=utf-8':req.url==='/app.css'?'text/css':'text/javascript');if(assets.has(req.url))res.end(assets.get(req.url));else{res.statusCode=404;res.end();}});
 await new Promise(done=>server.listen(0,'127.0.0.1',done));const origin='http://127.0.0.1:'+server.address().port;
 // Exactly one launch attempt. An environment failure is recorded and never retried.
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-mock-keychain']});
 const context=await browser.newContext({viewport:{width:800,height:600},deviceScaleFactor:2});page=await context.newPage();page.setDefaultTimeout(10000);
 page.on('pageerror',error=>errors.push(error.message));
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url()),path=url.pathname;
  if(url.origin!==origin||route.request().method()!=='GET'){errors.push('unexpected_request');return route.abort();}
  if(!path.startsWith('/api/'))return route.continue();paths.push(path);
  if(path==='/api/tasks'){
   return fail?route.fulfill({status:503,body:'synthetic_failure'}):route.fulfill({json:snapshot});
  }
  if(path==='/api/tasks/list/visible/before/50')return route.fulfill({json:roots(20)});
  if(path===archivePath){
   if(historyMode==='hold')await new Promise(resolve=>{releaseArchive=resolve;});
   if(historyMode==='error')return route.fulfill({status:503});
   return route.fulfill({json:historyMode==='empty'?{tasks:[]}:{tasks:[archived],nextCursor:70}});
  }
  if(path===archivePath+'/before/70')return route.fulfill({json:{tasks:[task('older',{historyState:'archived'})]}});
  errors.push('unexpected_read '+path);return route.abort();
 });
 await page.goto(origin);
 const trigger=page.locator('#task-status-trigger'),panel=page.locator('#task-status-panel'),ok=(value,name)=>{assert.ok(value,name);checks.push(name);};
 const refresh=()=>page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
 for(const width of [1440,390,320]){
  await page.setViewportSize({width,height:850});await trigger.waitFor();
  await page.waitForFunction(w=>document.querySelector('#task-status-trigger')?.hasAttribute('aria-haspopup')===(w<1120),width);
  if(await trigger.getAttribute('aria-expanded')!=='true'){await trigger.focus();await page.keyboard.press('Enter');}
  const current=panel.getByRole('region',{name:'当前事项',exact:true}),archive=panel.getByRole('region',{name:'已归档事项',exact:true});
  const toggle=panel.getByRole('button',{name:'已归档',exact:true}),normal=current.locator('[data-todo-id="ordinary"] [data-slot="task-status-row"]');
  await normal.waitFor();ok(await normal.innerText()==='整理采购要求','ordinary matter title only '+width);
  await normal.click();
  ok(await normal.locator('button, [aria-expanded], svg').count()===0&&await current.getByText(/不应显示的|执行记录/).count()===0,'ordinary row has no disclosure or detail '+width);
  ok(await toggle.getAttribute('aria-expanded')==='false'&&await archive.count()===0,'archive starts collapsed '+width);
  const layout=await toggle.evaluate(button=>{
   const row=button.closest('.status-list').querySelector('[data-slot="task-status-row"]');
   const title=document.createRange(),label=document.createRange();
   title.selectNodeContents(row);
   label.selectNode([...button.childNodes].find(node=>node.textContent==='已归档'));
   const icon=button.querySelector('svg'),box=button.getBoundingClientRect();
   return {
    alignment:label.getBoundingClientRect().left-title.getBoundingClientRect().left,
    gap:icon.getBoundingClientRect().left-label.getBoundingClientRect().right,
    rowWidth:row.getBoundingClientRect().width,width:box.width,height:box.height,
    rotation:getComputedStyle(icon).rotate,
   };
  });
  ok(Math.abs(layout.alignment)<1&&Math.abs(layout.gap-4)<1,'archive label aligns with task titles and the arrow follows 4px after it '+width);
  ok(Math.abs(layout.width-layout.rowWidth)<1&&layout.height>=44&&layout.rotation==='none','collapsed archive spans the row with a right arrow '+width);
  if(width===1440)ok(paths.every(path=>path==='/api/tasks'),'default loads only current matters');
  for(const task of [mixed,stopping]){
   const row=current.locator('[data-todo-id="'+task.id+'"] [data-slot="task-status-row"]');
   const count=row.getByRole('img',{name:task.workers.length+' 个 Worker',exact:true});
   ok(await row.getByText(task.title,{exact:true}).isVisible()&&await count.locator('svg.lucide-bot').count()===1,'Worker count uses queue icon '+width);
   ok(await row.getByRole('img',{name:'运行中',exact:true}).count()===(task===mixed?1:0),'only confirmed worker execution shows loading '+width);
  }
  const loading=current.getByRole('img',{name:'运行中',exact:true});
  ok(await loading.locator('svg').evaluate(el=>getComputedStyle(el).animationName!=='none'),'loading rotates '+width);
  await page.emulateMedia({reducedMotion:'reduce'});
  ok(await loading.locator('svg').evaluate(el=>getComputedStyle(el).animationName==='none'),'reduced motion keeps a static icon '+width);
  await page.emulateMedia({reducedMotion:'no-preference'});
  assert.deepEqual(await current.locator('[data-todo-id]').evaluateAll(rows=>rows.map(row=>row.dataset.todoId)),['ordinary','mixed','stopping']);
  await current.getByRole('button',{name:'下一页'}).click();
  const paged=current.locator('[data-todo-id="root-9"]');await paged.waitFor();
  await toggle.scrollIntoViewIfNeeded();await toggle.focus();
  const list=panel.getByRole('region',{name:'事项列表'}),scroll=()=>list.evaluate(el=>el.scrollTop),position=await scroll();
  await toggle.press('Enter');const history=archive.locator('[data-todo-id="archived"]');await history.waitFor();
  ok(await toggle.getAttribute('aria-expanded')==='true'&&await toggle.locator('svg').evaluate(icon=>icon.getAttribute('aria-hidden')==='true'&&getComputedStyle(icon).rotate==='90deg'),'keyboard exposes expanded state with a downward decorative arrow '+width);
  await archive.getByRole('button',{name:'下一页'}).click();await archive.locator('[data-todo-id="older"]').waitFor();
  await archive.getByRole('button',{name:'上一页'}).click();await history.waitFor();
  await toggle.press('Space');await archive.waitFor({state:'hidden'});
  ok(await paged.isVisible()&&Math.abs(await scroll()-position)<=1,'current page and scroll retained '+width);
  await toggle.click({position:{x:layout.width-8,y:layout.height/2}});await history.waitFor();
  ok(await archive.getByRole('button',{name:'上一页'}).count()===0,'clicking empty space at row end reopens archive on first page '+width);
  const historicalRow=history.locator('[data-slot="task-status-row"]');await historicalRow.click();
  ok(await historicalRow.getByText('去年报价',{exact:true}).isVisible()&&await historicalRow.getByRole('img',{name:'1 个 Worker'}).isVisible()&&await historicalRow.locator('button, [aria-expanded], .status-task-running').count()===0,'archived row shows count without execution or disclosure '+width);
  await page.screenshot({path:join(destination,'archived-'+width+'.png')});
  await toggle.click();await current.getByRole('button',{name:'上一页'}).click();
  await normal.waitFor();
  ok(await page.evaluate(()=>document.documentElement.scrollWidth)===width,'no horizontal overflow '+width);
  await page.screenshot({path:join(destination,'current-'+width+'.png')});
  if(width<1120){await page.keyboard.press('Escape');await panel.waitFor({state:'hidden'});await page.waitForFunction(()=>document.activeElement?.id==='task-status-trigger');ok(await trigger.evaluate(el=>el===document.activeElement),'Escape restores focus '+width);}
 }
 await trigger.click();fail=true;await refresh();await panel.getByRole('button',{name:'重试'}).waitFor();fail=false;await panel.getByRole('button',{name:'重试'}).click();await panel.getByRole('button',{name:'重试'}).waitFor({state:'hidden'});
 const toggle=panel.getByRole('button',{name:'已归档',exact:true}),archive=panel.getByRole('region',{name:'已归档事项',exact:true});
 historyMode='hold';const started=page.waitForRequest(r=>new URL(r.url()).pathname===archivePath);
 await toggle.click();await started;await toggle.click();releaseArchive();await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==='/api/tasks'),refresh()]);
 const reads=paths.filter(path=>path===archivePath).length;
 ok(await toggle.getAttribute('aria-expanded')==='false'&&await archive.count()===0,'late archive response cannot reopen history');
 await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==='/api/tasks'),refresh()]);ok(paths.filter(path=>path===archivePath).length===reads,'collapsed history stops reading');
 historyMode='error';await toggle.click();const retry=archive.getByRole('button',{name:'重试'});await retry.waitFor();
 ok(await panel.getByText('整理采购要求',{exact:true}).isVisible(),'archive failure isolated from current matters');
 historyMode='empty';await retry.click();await archive.getByText('暂无已归档事项。',{exact:true}).waitFor();await toggle.click();
 snapshot={tasks:[]};await refresh();await panel.getByText('暂无当前事项。',{exact:true}).waitFor();
 historyMode='normal';await toggle.click();await archive.getByText('去年报价',{exact:true}).waitFor();await toggle.click();
 ok(true,'empty current list still opens archive');
 const longTitle='已有事项完整标题'.repeat(15);
 snapshot={tasks:[task('long',{title:longTitle,hasExecutingWorker:true})]};
 await refresh();
 const row=panel.locator('[data-todo-id="long"] [data-slot=task-status-row]');
 const loading=row.getByRole('img',{name:'运行中',exact:true});
 await loading.waitFor();
 ok(await row.evaluate(el=>{
  const title=el.querySelector('.status-task-heading > span').getBoundingClientRect();
  const icon=el.querySelector('.status-task-running').getBoundingClientRect();
  const count=el.querySelector('.status-task-workers').getBoundingClientRect();
  return title.height>30&&title.right<=icon.left&&icon.top<title.top+10&&title.bottom<count.top&&el.scrollWidth<=el.clientWidth;
 })&&(await row.getAttribute('title'))===longTitle,'long title wraps beside icon and above count');
 snapshot.tasks[0].hasExecutingWorker=false;
 await page.evaluate(()=>window.statusFixture.update());
 await loading.waitFor({state:'hidden'});
 snapshot.tasks[0].hasExecutingWorker=true;
 await page.evaluate(()=>window.statusFixture.update());
 await loading.waitFor();
 ok(true,'background state refresh removes and restores the badge');
 await page.evaluate(()=>window.statusFixture.update(false));await panel.getByText(/显示上次记录/).waitFor();ok(await row.isVisible()&&await loading.count()===0,'offline snapshot retains the row and hides the running icon');
 const offlineReads=paths.length;await toggle.click();await archive.getByRole('status').waitFor();
 ok((await archive.getByRole('status').innerText()).includes('等待连接')&&paths.length===offlineReads,'opening history offline waits for connection without reading');
 await page.evaluate(()=>window.statusFixture.update(true));await archive.getByText('去年报价',{exact:true}).waitFor();
 ok(paths.slice(offlineReads).includes(archivePath),'history loads when connection returns');
 ok(paths.includes('/api/tasks/list/visible/before/50')&&paths.includes(archivePath+'/before/70')&&paths.every(path=>path==='/api/tasks'||path.startsWith('/api/tasks/list/')),'pages read only the list endpoints');
 ok(errors.length===0,'no page errors or business writes');
}catch(error){errors.push(String(error.stack??error));process.exitCode=1;}
finally{await writeFile(join(destination,'browser-results.json'),JSON.stringify({synthetic:true,checks,errors,realBrowserVerified:checks.length>0&&errors.length===0},null,2));await browser?.close();await new Promise(done=>server?server.close(done):done());await rm(scratch,{recursive:true,force:true});}
console.log(JSON.stringify({checks:checks.length,errors:errors.length,destination}));
