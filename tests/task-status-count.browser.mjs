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
const ordinary=task('ordinary',{title:'整理采购要求'});
const mixed=task('mixed',{title:'核对供应商报价'}),active=mixed.workers[0];
const uncertain={...active,id:'uncertain',run:{...active.run,workerId:'uncertain',id:'uncertain',phase:'uncertain'}};
mixed.workers.push(uncertain);
const approval=task('approval',{title:'申请报价资料'});approval.workers[0].pendingUser=1;approval.workers[0].pendingUsers=[{id:'q',after:0,kind:'authorization'}];
const archived=task('archived',{title:'去年报价',state:'paused',historyState:'archived'});archived.workers[0].run.status='succeeded';archived.workers[0].run.phase='ended';
let snapshot={tasks:[ordinary,mixed,approval],nextCursor:50},fail=false;
const paths=[];
try{
 const {chromium}=await import(process.env.HOMER_PLAYWRIGHT_MODULE??'playwright-core');
 const entry=`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {MessageCircle,Settings,PanelRight} from 'lucide-react';import {TaskStatusPopover} from './ui/task-status';import './ui/homer-styles.css';
 function Fixture(){const [connection,setConnection]=useState(true),[state,setState]=useState({threadId:'synthetic',interactions:[]}),[aside,setAside]=useState(null);window.statusFixture={update:(connected=true)=>{setConnection(connected);setState(s=>({...s}));}};return <div className="conversation-workspace"><div className="conversation conversation-panel"><header className="conversation-header"><span>荷马</span><div className="header-actions"><button aria-label="聊天"><MessageCircle/></button><button aria-label="设置"><Settings/></button><TaskStatusPopover state={state} connected={connection} openFile={f=>window.selectedFile=f.id} locateMessage={id=>window.selectedMessage=id} onInteraction={()=>{}} asideContainer={aside} onBeforeLayoutChange={()=>{}}/><button aria-label="侧栏"><PanelRight/></button></div></header><main style={{padding:24,color:'#67645f'}}>合成任务验证 · 实际产品组件与读取逻辑</main></div><div className="status-aside-slot" ref={setAside}/></div>};createRoot(document.getElementById('root')).render(<Fixture/>);`;
 await build({stdin:{contents:entry,resolveDir:process.cwd(),sourcefile:'task-count-fixture.tsx',loader:'tsx'},bundle:true,outfile:join(scratch,'app.js'),platform:'browser',format:'esm',jsx:'automatic',logLevel:'silent'});
 const assets=new Map([['/',Buffer.from('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script>')],['/app.js',await readFile(join(scratch,'app.js'))],['/app.css',await readFile(join(scratch,'app.css'))]]);
 server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/'?'text/html; charset=utf-8':req.url==='/app.css'?'text/css':'text/javascript');if(assets.has(req.url))res.end(assets.get(req.url));else{res.statusCode=404;res.end();}});
 await new Promise(done=>server.listen(0,'127.0.0.1',done));const origin='http://127.0.0.1:'+server.address().port;
 // Exactly one launch attempt. An environment failure is recorded and never retried.
 browser=await chromium.launch({channel:'chrome',headless:true});
 const context=await browser.newContext({viewport:{width:800,height:600},deviceScaleFactor:2});page=await context.newPage();page.setDefaultTimeout(10000);
 page.on('pageerror',error=>errors.push(error.message));
 await context.route('**/*',route=>{
  const url=new URL(route.request().url()),path=url.pathname;
  if(url.origin!==origin||route.request().method()!=='GET'){errors.push('unexpected_request');return route.abort();}
  if(!path.startsWith('/api/'))return route.continue();paths.push(path);
  if(path==='/api/tasks'){
   return fail?route.fulfill({status:503,body:'synthetic_failure'}):route.fulfill({json:snapshot});
  }
  if(path==='/api/tasks/list/visible/before/50')return route.fulfill({json:roots(1)});
  if(path==='/api/tasks/list/needsUser')return route.fulfill({json:{tasks:[approval]}});
  if(path==='/api/tasks/list/archived')return route.fulfill({json:{tasks:[archived]}});
  if(path==='/api/tasks/archived')return route.fulfill({json:{taskId:'archived',runs:[],requirements:[],publicMessages:[{id:'answer',role:'assistant',excerpt:'已交付报价。'}],artifacts:[{id:'archived-file',title:'报价.md'}]}});
  if(path==='/api/tasks/archived/workers/worker-archived')return route.fulfill({json:{taskId:'archived',runs:[],conversation:{taskId:'archived',workerId:'worker-archived',messages:[{id:'reply',kind:'worker_reply',seq:1,version:1,text:'已核对报价',receipt:'received',nextOffset:null}],nextCursor:null}}});
  errors.push('unexpected_read '+path);return route.abort();
 });
 await page.goto(origin);
 const trigger=page.locator('#task-status-trigger'),panel=page.locator('#task-status-panel'),ok=(value,name)=>{assert.ok(value,name);checks.push(name);};
 const refresh=()=>page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
 for(const width of [1440,390,320]){
  await page.setViewportSize({width,height:850});await trigger.waitFor();
  await page.waitForFunction(w=>document.querySelector('#task-status-trigger')?.hasAttribute('aria-haspopup')===(w<1120),width);
  if(await trigger.getAttribute('aria-expanded')!=='true'){await trigger.focus();await page.keyboard.press('Enter');}
  await panel.getByRole('button',{name:'当前事项',exact:true}).click();
  const normal=panel.locator('[data-todo-id="ordinary"] .status-row-trigger');await normal.waitFor();
  ok(await normal.innerText()==='整理采购要求','ordinary matter title only '+width);
  ok(await panel.locator('[data-count]').count()===0&&await trigger.locator('[data-count]').count()===0,'no stage badges or counts '+width);
  ok(await panel.getByText('执行状态待核实',{exact:true}).isVisible(),'unknown worker remains visible beside active worker '+width);
  ok(await panel.getByText('需你审批',{exact:true}).isVisible(),'a real approval is visible '+width);
  await panel.getByRole('button',{name:'待我处理',exact:true}).click();await panel.locator('[data-todo-id="ordinary"]').waitFor({state:'hidden'});await panel.locator('[data-todo-id="approval"]').waitFor();
  ok(await panel.locator('[data-todo-id]').count()===1,'attention view reads matching page '+width);
  await panel.getByRole('button',{name:'当前事项',exact:true}).click();await panel.getByRole('button',{name:'下一页'}).click();await panel.locator('[data-todo-id="root-0"]').waitFor();
  await panel.getByRole('button',{name:'上一页'}).click();await normal.waitFor();
  await panel.getByRole('button',{name:'历史事项',exact:true}).click();const history=panel.locator('[data-todo-id="archived"]');await history.waitFor();
  ok(await history.locator('.status-row-trigger').innerText()==='去年报价','archive title has no execution badge '+width);
  await history.locator('.status-row-trigger').click();await history.getByText('Worker 本轮：已回复').waitFor();
  await history.getByRole('button',{name:'执行记录'}).click();await history.getByText('会话原文',{exact:true}).click();await history.getByText('已核对报价',{exact:true}).waitFor();ok(await history.getByText(/版本 1 · 已接收/).isVisible(),'archived Worker source and receipt visible '+width);
  await history.getByText('交办与答复原文',{exact:true}).click();await history.getByRole('button',{name:/已交付报价/}).click();
  ok(await page.evaluate(()=>window.selectedMessage)==='answer','exact original answer opens '+width);
  if(width<1120)await trigger.click();
  await history.getByText('报价.md',{exact:true}).click();ok(await page.evaluate(()=>window.selectedFile)==='archived-file','exact archived file opens '+width);
  if(width<1120)await trigger.click();
  await panel.getByRole('button',{name:'当前事项',exact:true}).click();await normal.waitFor();
  ok(await page.evaluate(()=>document.documentElement.scrollWidth)===width,'no horizontal overflow '+width);
  await page.screenshot({path:join(destination,'current-'+width+'.png')});
  if(width<1120){await page.keyboard.press('Escape');await panel.waitFor({state:'hidden'});await page.waitForFunction(()=>document.activeElement?.id==='task-status-trigger');ok(await trigger.evaluate(el=>el===document.activeElement),'Escape restores focus '+width);}
 }
 await trigger.click();fail=true;await refresh();await panel.getByRole('button',{name:'重试'}).waitFor();fail=false;await panel.getByRole('button',{name:'重试'}).click();await panel.getByRole('button',{name:'重试'}).waitFor({state:'hidden'});
 const longTitle='已有事项完整标题'.repeat(15);snapshot={tasks:[task('long',{title:longTitle})]};await refresh();const row=panel.locator('[data-todo-id="long"] .status-row-trigger');await row.waitFor();const clipped=await row.locator('span.truncate').first().evaluate(el=>el.scrollWidth>el.clientWidth&&getComputedStyle(el).textOverflow==='ellipsis');ok(clipped&&(await row.getAttribute('title'))===longTitle,'narrow long title remains readable');
 await page.evaluate(()=>window.statusFixture.update(false));await panel.getByText(/显示上次记录/).waitFor();ok(await row.isVisible(),'offline snapshot remains readable');
 ok(paths.includes('/api/tasks/list/visible/before/50')&&paths.includes('/api/tasks/archived/workers/worker-archived'),'paged and scoped requests');
 ok(errors.length===0,'no page errors or business writes');
}catch(error){errors.push(String(error.stack??error));process.exitCode=1;}
finally{await writeFile(join(destination,'browser-results.json'),JSON.stringify({synthetic:true,checks,errors,realBrowserVerified:checks.length>0&&errors.length===0},null,2));await browser?.close();await new Promise(done=>server?server.close(done):done());await rm(scratch,{recursive:true,force:true});}
console.log(JSON.stringify({checks:checks.length,errors:errors.length,destination}));
