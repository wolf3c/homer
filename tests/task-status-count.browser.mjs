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
const checks=[],errors=[];let browser,server,page,performanceEvidence;
const roots=n=>({tasks:Array.from({length:n},(_,i)=>task('root-'+i,{creationOrder:49-i}))});
const ordinary=task('ordinary',{title:'整理采购要求',creationOrder:52,goal:'不应显示的目标',notes:'不应显示的工作笔记',workers:[]});
const mixed=task('mixed',{title:'核对供应商报价',creationOrder:51,hasExecutingWorker:true}),active=mixed.workers[0];
const uncertain={...active,id:'uncertain',run:{...active.run,workerId:'uncertain',id:'uncertain',phase:'uncertain'}};
mixed.workers.push(uncertain);
const stopping=task('stopping',{title:'修订合同条款',creationOrder:50});stopping.workers[0].run.stopRequestedAt=1;
const archived=task('archived',{title:'去年报价',creationOrder:70,state:'paused',historyState:'archived',hasExecutingWorker:true});archived.workers[0].run.status='succeeded';archived.workers[0].run.phase='ended';
const olderTitle='需要完整阅读的已归档事项标题'.repeat(4);
let snapshot={tasks:[ordinary,mixed,stopping],nextCursor:50},fail=false;
const paths=[],archivePath='/api/tasks/list/archived';
let historyMode='normal',releaseArchive,liveTasks,failedPath,beforeLiveRead;

try{
 const {chromium}=await import(process.env.HOMER_PLAYWRIGHT_MODULE??'playwright-core');
 const entry=`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {MessageCircle,Settings,PanelRight} from 'lucide-react';import {TaskStatusPopover} from './ui/task-status';import './ui/homer-styles.css';
 function Fixture(){const [connection,setConnection]=useState(true),[state,setState]=useState({threadId:'synthetic',interactions:[]}),[aside,setAside]=useState(null),[pinned,setPinned]=useState(true);window.statusFixture={update:(connected=true)=>{setConnection(connected);setState(s=>({...s}));}};return <div className="conversation-workspace" style={{height:"100dvh"}}><div className="conversation conversation-panel"><header className="conversation-header"><span>荷马</span><div className="header-actions"><button aria-label="聊天"><MessageCircle/></button><button aria-label="设置"><Settings/></button><TaskStatusPopover wide={innerWidth>=700} pinned={pinned} onPinnedChange={setPinned} previewModal={false} state={state} refreshKey={state} connected={connection} asideContainer={aside} onBeforeLayoutChange={()=>{}}/><button aria-label="侧栏"><PanelRight/></button></div></header><main style={{padding:24,color:'#67645f'}}>合成任务验证 · 实际产品组件与读取逻辑</main></div><div className="status-aside-slot" ref={setAside}/></div>};createRoot(document.getElementById('root')).render(<Fixture/>);`;
 await build({stdin:{contents:entry,resolveDir:process.cwd(),sourcefile:'task-count-fixture.tsx',loader:'tsx'},bundle:true,outfile:join(scratch,'app.js'),platform:'browser',format:'esm',jsx:'automatic',logLevel:'silent'});
 const assets=new Map([['/',Buffer.from('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script>')],['/app.js',await readFile(join(scratch,'app.js'))],['/app.css',await readFile(join(scratch,'app.css'))]]);
 server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/'?'text/html; charset=utf-8':req.url==='/app.css'?'text/css':'text/javascript');if(assets.has(req.url))res.end(assets.get(req.url));else{res.statusCode=404;res.end();}});
 await new Promise(done=>server.listen(0,'127.0.0.1',done));const origin='http://127.0.0.1:'+server.address().port;
 // Exactly one launch attempt. An environment failure is recorded and never retried.
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-mock-keychain']});
 const routeFixture=async route=>{
  const url=new URL(route.request().url()),path=url.pathname;
  if(url.origin!==origin||route.request().method()!=='GET'){errors.push('unexpected_request');return route.abort();}
  if(!path.startsWith('/api/'))return route.continue();paths.push(path);
  if(liveTasks){
   const match=path.match(/^\/api\/tasks(?:\/list\/(visible|archived)(?:\/before\/(\d+))?)?$/);
   if(!match){errors.push('unexpected_read '+path);return route.abort();}
   const view=match[1]??'visible',before=Number(match[2]??Number.MAX_SAFE_INTEGER);
   const matching=liveTasks.filter(task=>task.historyState===view&&task.creationOrder<before);
   await beforeLiveRead?.(path);
   if(path===failedPath)return route.fulfill({status:503});
   return route.fulfill({json:{tasks:matching.slice(0,20),nextCursor:matching.length>20?matching[19].creationOrder:undefined}});
  }
  if(path==='/api/tasks'){
   return fail?route.fulfill({status:503,body:'synthetic_failure'}):route.fulfill({json:snapshot});
  }
  if(path==='/api/tasks/list/visible/before/50')return route.fulfill({json:roots(20)});
  if(path===archivePath){
   if(historyMode==='hold')await new Promise(resolve=>{releaseArchive=resolve;});
   if(historyMode==='error')return route.fulfill({status:503});
   return route.fulfill({json:historyMode==='empty'?{tasks:[]}:{tasks:[archived],nextCursor:70}});
  }
  if(path===archivePath+'/before/70')return route.fulfill({json:{tasks:[task('older',{title:olderTitle,creationOrder:69,historyState:'archived'})]}});
  errors.push('unexpected_read '+path);return route.abort();
 };
 const createPage=async hasTouch=>{
  const context=await browser.newContext({viewport:{width:800,height:600},deviceScaleFactor:2,hasTouch});
  await context.route('**/*',routeFixture);
  const next=await context.newPage();next.setDefaultTimeout(10000);
  next.on('pageerror',error=>errors.push(error.message));
  await next.goto(origin);
  return next;
 };
 page=await createPage(false);
 let trigger=page.locator('#task-status-trigger'),panel=page.locator('#task-status-panel');
 const ok=(value,name)=>{assert.ok(value,name);checks.push(name);};
 const refresh=()=>page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
 for(const width of [1440,390,320]){
  if(width===390){
   await page.context().close();page=await createPage(true);
   trigger=page.locator('#task-status-trigger');panel=page.locator('#task-status-panel');
  }
  await page.setViewportSize({width,height:850});await trigger.waitFor();
  await page.waitForFunction(w=>document.querySelector('#task-status-trigger')?.hasAttribute('aria-haspopup')===(w<1120),width);
  if(await trigger.getAttribute('aria-expanded')!=='true'){await trigger.focus();await page.keyboard.press('Enter');}
  const current=panel.getByRole('region',{name:'当前事项',exact:true}),archive=panel.getByRole('region',{name:'已归档事项',exact:true});
  const toggle=panel.getByRole('button',{name:'已归档',exact:true}),normal=current.locator('[data-todo-id="ordinary"] [data-slot="task-status-row"]');
  await normal.waitFor();ok(await normal.innerText()==='整理采购要求','ordinary matter title only '+width);
  ok(await normal.evaluate(el=>{
   const row=el.getBoundingClientRect(),title=el.firstElementChild.getBoundingClientRect();
   return el.offsetHeight>=44&&Math.abs(row.top+row.bottom-title.top-title.bottom)<1;
  })&&await normal.locator('svg').count()===0,'zero Worker title is centered without metadata '+width);
  const rowHeight=()=>normal.evaluate(el=>el.closest('[data-todo-id]').offsetHeight);
  const height=await rowHeight();
  if(width===1440)await normal.click();else await normal.tap();
  ok(await rowHeight()===height&&await current.getByText(/完整标题|不应显示的|执行记录/).count()===0,'pressing the row reveals no content '+width);
  ok(await normal.evaluate(el=>el.tagName==='DIV'&&el.tabIndex===-1&&!el.hasAttribute('aria-pressed')),'current row has no disclosure control '+width);
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
  if(width===1440)ok(paths.every(path=>!path.startsWith(archivePath)),'default loads only current matters');
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
  const list=panel.getByRole('region',{name:'事项列表'});
  const scroll=()=>list.evaluate(el=>el.scrollTop);
  await current.locator('[data-todo-id="root-9"]').waitFor();
  ok(await current.locator('[data-todo-id]').count()===23&&await normal.isVisible(),'underfilled first batch appends and keeps existing rows '+width);
  ok(await panel.getByRole('button',{name:/上一页|下一页/}).count()===0,'no pagination controls '+width);
  await toggle.scrollIntoViewIfNeeded();await toggle.focus();
  const position=await scroll(),start=paths.length;
  await toggle.press('Enter');const history=archive.locator('[data-todo-id="archived"]');await history.waitFor();
  ok(await toggle.getAttribute('aria-expanded')==='true'&&await toggle.locator('svg').evaluate(icon=>getComputedStyle(icon).rotate==='90deg'),'keyboard exposes expanded state '+width);
  await list.evaluate(el=>el.scrollTop=el.scrollHeight);
  const older=archive.getByText(olderTitle,{exact:true});
  await older.waitFor();
  ok(await older.evaluate(el=>getComputedStyle(el).whiteSpace==='normal'&&el.offsetHeight>21&&el.scrollHeight===el.offsetHeight),'archived long title remains readable '+width);
  ok(paths.slice(start).filter(path=>path.startsWith(archivePath)).join(',')===[archivePath,archivePath+'/before/70'].join(','),'archives read each batch once '+width);
  await toggle.press('Space');await archive.waitFor({state:'hidden'});
  ok(await current.locator('[data-todo-id]').count()===23&&Math.abs(await scroll()-position)<=1,'current rows and scroll retained '+width);
  const reopened=paths.length;
  await toggle.click({position:{x:layout.width-8,y:layout.height/2}});await history.waitFor();
  ok(paths[reopened]===archivePath,'reopens archive at its first batch '+width);
  const historicalRow=history.locator('[data-slot="task-status-row"]');await historicalRow.click();
  ok(await historicalRow.getByText('去年报价',{exact:true}).isVisible()&&await historicalRow.getByRole('img',{name:'1 个 Worker'}).isVisible()&&await historicalRow.locator('button, [aria-expanded], .status-task-running').count()===0,'archived row shows count without execution or disclosure '+width);
  await page.screenshot({path:join(destination,'archived-'+width+'.png')});
  await toggle.click();await normal.scrollIntoViewIfNeeded();
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
  const text=el.querySelector('.status-task-title'),title=text.getBoundingClientRect();
  const icon=el.querySelector('.status-task-running').getBoundingClientRect();
  const count=el.querySelector('.status-task-workers').getBoundingClientRect();
  return title.height===21&&text.scrollWidth>text.clientWidth&&getComputedStyle(text).textOverflow==='ellipsis'&&title.right<=icon.left&&icon.top===title.top&&title.bottom<count.top&&el.scrollWidth<=el.clientWidth;
 })&&(await row.getAttribute('title'))===longTitle,'long title truncates beside icon and above count');
 await row.tap();
 ok(await panel.getByText(longTitle,{exact:true}).count()===1&&await panel.locator('.status-full-title').count()===0,'touch keeps a single truncated title');
 snapshot.tasks[0].headVersion++;
 snapshot.tasks[0].hasExecutingWorker=false;
 await page.evaluate(()=>window.statusFixture.update());
 await loading.waitFor({state:'hidden'});
 ok(await row.getByText(longTitle,{exact:true}).isVisible(),'matter revision preserves the title');
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
 await page.context().close();
 liveTasks=Array.from({length:200},(_,i)=>task('live-'+i,{creationOrder:200-i,workers:[]}));
 page=await createPage(false);
 await page.setViewportSize({width:1440,height:850});
 panel=page.locator('#task-status-panel');
 const current=panel.getByRole('region',{name:'当前事项',exact:true});
 const rows=current.locator('[data-todo-id]'),scrollList=panel.getByRole('region',{name:'事项列表'});
 const notify=()=>page.evaluate(()=>window.statusFixture.update());
 const requestPaths=()=>paths.filter(path=>!path.startsWith(archivePath));
 const bottom=()=>scrollList.evaluate(el=>el.scrollTop=el.scrollHeight);
 const offset=id=>current.getByRole('region',{name:'合成任务 '+id,exact:true}).evaluate(el=>el.getBoundingClientRect().top-el.closest('.status-list').getBoundingClientRect().top);
 await rows.nth(19).waitFor();
 ok(await rows.count()===20,'starts with one real-sized batch');
 const unfocusedToggle=panel.getByRole('button',{name:'已归档',exact:true});
 const pointerArchive=task('pointer-archive',{creationOrder:201,historyState:'archived',workers:[]});
 liveTasks.unshift(pointerArchive);
 const beforeOpen=requestPaths().length;
 await unfocusedToggle.evaluate(el=>el.click());
 await panel.getByText(pointerArchive.title,{exact:true}).waitFor();
 await bottom();
 await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
 ok(await rows.count()===20&&requestPaths().length===beforeOpen,'opening and reading archive without focus does not append current tasks');
 await unfocusedToggle.evaluate(el=>el.click());
 liveTasks.shift();
 failedPath='/api/tasks/list/visible/before/181';
 await scrollList.focus();
 await page.keyboard.press('End');
 const tailRetry=current.getByRole('button',{name:'重试'});
 await tailRetry.waitFor();
 ok(await rows.count()===20&&await current.getByText(/无法读取更多事项/).count()===1,'keyboard reaches tail and failed read preserves rows');
 const retryPath=requestPaths().at(-1),failedReads=requestPaths().filter(path=>path===retryPath).length;
 liveTasks[0].title='尾部失败后仍更新已读行';
 await notify();
 await current.getByText('尾部失败后仍更新已读行',{exact:true}).waitFor();
 ok(await tailRetry.count()===1&&requestPaths().filter(path=>path===retryPath).length===failedReads,'tail failure preserves retry while existing rows refresh');
 failedPath=undefined;
 const retried=page.waitForRequest(r=>new URL(r.url()).pathname.startsWith('/api/tasks'));
 await tailRetry.press('Enter');
 assert.equal(new URL((await retried).url()).pathname,retryPath);
 await rows.nth(39).waitFor();
 ok(retryPath==='/api/tasks/list/visible/before/181','retry reads the same cursor');
 await rows.nth(10).scrollIntoViewIfNeeded();
 await scrollList.evaluate(el=>el.scrollTop=el.querySelector('[data-todo-id="live-10"]').offsetTop);
 const beforeOffset=await offset('live-10');
 assert.equal(await rows.count(),40,'retry resumes one batch and waits for the next scroll');
 liveTasks.unshift(task('newer',{creationOrder:201,workers:[]}));
 liveTasks[3].historyState='archived';liveTasks[3].revision++;
 liveTasks.splice(liveTasks.findIndex(task=>task.creationOrder===161),1);
 const beforeRebase=paths.length;
 await notify();
 await current.locator('[data-todo-id="newer"]').waitFor();
 ok(await current.locator('[data-todo-id="live-2"],[data-todo-id="live-39"]').count()===0&&Math.abs(await offset('live-10')-beforeOffset)<=1,'rebase handles new, moved and deleted rows while preserving anchor');
 ok(paths[beforeRebase]==='/api/tasks','rebase starts from the first page');

 let releaseRefresh,enteredRefresh;
 const blocked=new Promise(resolve=>{releaseRefresh=resolve;});
 const refreshStarted=new Promise(resolve=>{enteredRefresh=resolve;});
 beforeLiveRead=path=>{
  if(path==='/api/tasks'){enteredRefresh();return blocked;}
 };
 assert.equal(await rows.count(),40,'refresh fixture starts with two loaded batches');
 await notify();await refreshStarted;
 const afterHold=paths.length;
 await bottom();await notify();await notify();
 assert.equal(await rows.count(),40,'append waits for the in-flight refresh');
 beforeLiveRead=undefined;releaseRefresh();
 await rows.nth(59).waitFor();
 assert.deepEqual(paths.slice(afterHold,afterHold+2),['/api/tasks/list/visible/before/181','/api/tasks/list/visible/before/160']);
 ok(await rows.count()>=60,'visible tail appends during repeated state notifications');
 for(let i=80;i<=199;i+=20){await bottom();await rows.nth(i-1).waitFor();}
 await bottom();await rows.nth(197).waitFor();
 const deepCount=await rows.count();
 ok(deepCount===199,'reads all available rows in the 200-item fixture');
 const readStart=paths.length,rebaseStart=performance.now();
 liveTasks[0].title='深读刷新后的新标题';
 await notify();
 await current.getByText('深读刷新后的新标题',{exact:true}).waitFor();
 performanceEvidence={loadedRows:deepCount,refreshReads:paths.length-readStart,elapsedMs:Math.round(performance.now()-rebaseStart)};
 ok(performanceEvidence.refreshReads===10,'one read per covered batch during deep refresh');
 const exhausted=paths.length;await bottom();
 await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
 ok(paths.length===exhausted,'exhausted list does not issue more requests');
 const archiveButton=panel.getByRole('button',{name:'已归档',exact:true});
 const liveArchive=panel.getByRole('region',{name:'已归档事项',exact:true});
 await archiveButton.scrollIntoViewIfNeeded();
 const savedPosition=await scrollList.evaluate(el=>{
  const top=el.getBoundingClientRect().top;
  const row=Array.from(el.querySelectorAll('[aria-label="当前事项"] [data-todo-id]')).find(row=>row.getBoundingClientRect().bottom>top);
  return row&&{id:row.dataset.todoId,offset:row.getBoundingClientRect().top-top};
 });
 await archiveButton.click();
 await liveArchive.locator('[data-todo-id="live-2"]').waitFor();
 const restored=liveTasks.find(task=>task.id==='live-2');
 restored.historyState='visible';restored.revision++;
 await notify();
 await current.locator('[data-todo-id="live-2"]').waitFor();
 await liveArchive.getByText('暂无已归档事项。').waitFor();
 ok(await panel.locator('[data-todo-id="live-2"]').count()===1,'restored task reappears once in the current list');
 await archiveButton.click();
 ok(savedPosition&&Math.abs(await offset(savedPosition.id)-savedPosition.offset)<=1,'collapse restores the same current row after an insertion above it');
 ok(errors.length===0,'no page errors or business writes');
}catch(error){errors.push(String(error.stack??error));process.exitCode=1;}
finally{await writeFile(join(destination,'browser-results.json'),JSON.stringify({synthetic:true,checks,errors,performance:performanceEvidence,realBrowserVerified:checks.length>0&&errors.length===0},null,2));await browser?.close();await new Promise(done=>server?server.close(done):done());await rm(scratch,{recursive:true,force:true});}
console.log(JSON.stringify({checks:checks.length,errors:errors.length,destination}));
