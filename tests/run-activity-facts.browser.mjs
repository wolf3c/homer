// Real product UI and read-only HTTP owners, using the existing synthetic fixture.
// No Homer service/config/account, production endpoint or real model is loaded.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {activityFixture} from './run-activity-facts-browser-fixture.mjs';
const {chromium}=await import(process.env.HOMER_PLAYWRIGHT_MODULE??'playwright');
const destination=resolve(process.env.HOMER_BROWSER_EVIDENCE??'.codex/scratch/remove-activity-reader-20261023/browser');
await mkdir(destination,{recursive:true});
let context,browserVersion;
const results=[];
try{for(const width of [1440,390,320]){
 context=await chromium.launchPersistentContext(resolve(destination,'chrome-profile-'+width),{channel:'chrome',headless:true});
 browserVersion=context.browser()?.version();
 const f=await activityFixture(),page=await context.newPage(),checks=[],limitations=[],errors=[],blocked=[],writes=[],requests=[];
 let connecting=false;
 const origin=f.server.url;assert.notEqual(new URL(origin).port,'4780');
 const ok=(value,name)=>{assert.ok(value,name);checks.push(name);};
 page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>{
  const request=route.request(),address=new URL(request.url()),method=request.method();
  if(address.origin!==origin){blocked.push(address.origin);return route.abort();}
  const read=method==='POST'&&['page','interactions','queue','process','resolve','receipts'].some(name=>address.pathname==='/api/history/'+name);
  const connection=connecting&&method==='POST'&&address.pathname==='/api/connect';
  if(method!=='GET'&&!read&&!connection){writes.push({path:address.pathname,method});return route.abort();}
  requests.push({path:address.pathname,method,...(address.pathname==='/api/history/process'?{body:request.postDataJSON()}:{} )});return route.continue();
 });
 const noReader=async()=>{
  assert.equal(await page.locator('.activity-reader,.task-dialog,.task-panel,.task-entry').count(),0);
  assert.equal(await page.getByRole('button',{name:/查看活动|查看关联任务|查看任务与版本|返回总览/}).count(),0);
  assert.equal(f.activityReads.filter(id=>id!==null).length,0,'no per-item activity detail reads');
 };
 const toggle=page.locator('#message-node-89 [data-slot="collapsible-trigger"]');
 const ids=()=>page.locator('#message-node-89 [data-tool-id]').evaluateAll(nodes=>nodes.map(n=>n.dataset.toolId));
 const shot=async name=>{
  await page.locator('#message-node-89').scrollIntoViewIfNeeded();
  await page.screenshot({path:resolve(destination,name+'-'+width+'.png'),animations:'disabled'});
 };
 try{
  // One Task owns three independent conversations and one pending question.
  const actor=f.actor;
  const authority={sourceRequestId:actor.sourceRequestId,description:'Synthetic removal regression'};
  const root=f.tasks.createTask(actor,{operationId:'status-root',title:'独立当前事项',goal:'保留顶部状态与待答',authority});
  const open=(id,text)=>f.tasks.workerOpen(actor,{operationId:id,taskId:root.taskId,text});
  const first=open('first-worker','资料 Worker'),second=open('second-worker','核对 Worker'),peer=open('peer-worker','并行 Worker');
  for(const [i,w]of [first,second,peer].entries()){const r=f.tasks.claim(w.runId);f.tasks.bind(r.id,r.epoch,'synthetic-worker-'+i,'synthetic-turn-'+i);}
  const r=f.tasks.run(second.runId);
  f.store.db.prepare(`INSERT INTO worker_interactions(id,identity,fingerprint,runId,threadId,turnId,requestId,source,kind,details,authority,state,createdAt,updatedAt,runEpoch,taskVersion,userQuestion,escalationReason) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('reader-removal-question','reader-removal-identity','synthetic-fingerprint',r.id,r.threadId,r.turnId,'"synthetic-native"','ask_main','question','{}',JSON.stringify({...authority,nativeApprovals:false}),'pending_user',1,1,r.epoch,r.version,'是否保留这份合成资料？','仅验证原待答定位，不提交。');
  f.server.publish();
  await page.setViewportSize({width,height:900});
  if(f.server.connectionFile){
   // Use only this fixture's generated connection page. Never log its key.
   const target=new URL(readFileSync(f.server.connectionFile,'utf8').match(/href="([^"]+)"/)[1]);
   assert.equal(target.origin,origin);assert.equal(target.pathname,'/connect');connecting=true;
   await page.goto(target.href);await page.waitForFunction(()=>location.pathname==='/'&&!!sessionStorage.getItem('homer-user-connection'));connecting=false;
  }else await page.goto(origin);
  await toggle.waitFor();assert.equal(await toggle.getAttribute('aria-expanded'),'false');await noReader();
  await toggle.focus();await page.keyboard.press('Space');await page.locator('[data-tool-id=activity-call-0]').waitFor();
  assert.deepEqual(await ids(),f.tools.map(t=>t.id));
  const texts=await page.locator('#message-node-89 [data-tool-id]').allTextContents();
  assert.match(texts[0],/查看任务记录：周报材料核对.*已读取/);assert.match(texts[1],/周报材料核对/);
  assert.match(texts[2],/读取附件材料：季度经营数据/);assert.match(texts[3],/读取附件材料：合成附件.*已读取/);assert.match(texts[4],/新要求已就绪，尚待执行/);
  await noReader();ok(true,'新公开事实保留动作、对象、结果与六次独立调用，只有原折叠按钮');
  assert.equal(await page.locator('#message-node-89 button').count(),1);
  const style=await page.locator('#message-node-89 [data-slot="run-activity"]').evaluate(r=>{const b=r.querySelector('[data-slot="collapsible-trigger"]'),o=r.querySelector('ol');return {rootGap:getComputedStyle(r).gap,font:getComputedStyle(b).fontSize,triggerGap:getComputedStyle(b).gap,listGap:getComputedStyle(o).gap,line:getComputedStyle(o).borderInlineStartWidth,padding:getComputedStyle(o).paddingInlineStart,icon:getComputedStyle(b.querySelector('svg')).width};});
  assert.deepEqual(style,{rootGap:'12px',font:'14px',triggerGap:'6px',listGap:'12px',line:'1px',padding:'14px',icon:'14px'});ok(true,'官方 RunActivity 布局、字号、图标及间距保持');
  await shot('public-facts');
  f.stream();await page.getByText(/合成新增公开进展/).waitFor();await noReader();assert.equal(await toggle.getAttribute('aria-expanded'),'true');ok(true,'流式刷新不重新打开阅读器，也不改变用户展开选择');
  f.setMode('risks');await page.locator('[data-tool-id=risk-4]').waitFor();
  assert.equal((await ids()).length,11);for(const text of ['调用失败','调用被拒绝','调用已中断','结束状态待核实','调用受阻'])assert.ok((await page.locator('#message-node-89').innerText()).includes(text));await noReader();ok(true,'失败、被拒绝、中断、未知和受阻说明仍可读');
  f.setMode('legacy');await page.getByText('旧后台工作记录（当时的事件内容未保留）').first().waitFor();await page.locator('[data-tool-id=legacy-generic]').waitFor();await noReader();ok(true,'旧 Worker 及旧事实没有关联任务替代入口');await shot('legacy-notes');
  f.setMode('running');
  f.processes.workerEvent('node-89',{eventKey:'synthetic:removal-delegated',eventKind:'delegated',title:'原交办记录',body:'不可变的合成 Worker 交办正文。',bodySource:'description',taskId:null,version:1,runId:null,resultId:null,sourceMessageId:null,operationKey:'synthetic-removal-event',observedAtMs:1});f.server.publish();
  const event=page.locator('#message-node-89 [data-worker-event]'),eventBody=page.getByText('不可变的合成 Worker 交办正文。',{exact:true});
  await event.waitFor();assert.equal(await eventBody.count(),0);await event.locator('>button').click();await eventBody.waitFor();assert.equal(await eventBody.count(),1);
  await toggle.click();await event.waitFor();assert.equal(await eventBody.count(),0);assert.equal(await event.locator('button').count(),1);await event.locator('>button').click();await eventBody.waitFor();assert.equal(await eventBody.count(),1);await toggle.click();await noReader();ok(true,'不可变 Worker 事件收起和展开各仅显示一次，仅官方正文展开按钮');
  // Independent FileList and Canvas preview remains functional.
  const file=page.getByRole('button',{name:'预览 季度经营数据核对与改进建议_待确认范围说明_2026年十月最终候选.md',exact:true});
  // Filename is returned by the owning message; no activity navigation involved.
  await file.click();await page.locator('#canvas-panel .canvas-markdown').getByText('隔离合成成果').waitFor();
  await page.screenshot({path:resolve(destination,'canvas-'+width+'.png'),animations:'disabled'});
  await page.getByRole('button',{name:'关闭 Canvas'}).click();
  await page.locator('#canvas-panel').waitFor({state:'detached'});await file.waitFor();
  await noReader();ok(await file.evaluate(e=>e===document.activeElement),'关闭 Canvas 回到拥有附件的原答复入口');
  const status=page.locator('#task-status-trigger');if(await status.getAttribute('aria-expanded')!=='true')await status.click();const popover=page.locator('#task-status-panel');await popover.waitFor();
  const matter=popover.locator('[data-todo-id="'+root.taskId+'"]'),rootToggle=matter.locator(':scope > [data-slot="task-status-row"] > button');
  assert.equal(await rootToggle.getAttribute('aria-expanded'),'false');assert.equal(await matter.locator('[data-worker-id]').count(),0);
  await rootToggle.focus();await page.keyboard.press('Space');
  const firstToggle=matter.locator('[data-worker-id="'+first.workerId+'"] > [data-slot="task-status-row"] > button'),peerToggle=matter.locator('[data-worker-id="'+peer.workerId+'"] > [data-slot="task-status-row"] > button');
  await firstToggle.waitFor();assert.equal(await firstToggle.getAttribute('aria-expanded'),'false');assert.equal(await peerToggle.getAttribute('aria-expanded'),'false');assert.equal(await matter.locator('[data-worker-id]').count(),3);
  await firstToggle.click();assert.equal(await peerToggle.getAttribute('aria-expanded'),'false');assert.equal(await matter.locator('[data-worker-id="'+first.workerId+'"] [data-worker-id]').count(),0);
  await peerToggle.click();await rootToggle.click();await rootToggle.click();assert.equal(await firstToggle.getAttribute('aria-expanded'),'false');assert.equal(await peerToggle.getAttribute('aria-expanded'),'false');ok(true,'同事项各会话平铺且独立默认收起，父层重开重置各会话');
  const bounds=await popover.evaluate(e=>({left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right,width:innerWidth,document:document.documentElement.scrollWidth,scroll:e.scrollWidth,client:e.clientWidth}));
  ok(bounds.left>=0&&bounds.right<=width&&bounds.document===width&&bounds.scroll<=bounds.client,'当前状态浮层及页面无横向溢出');
  await page.screenshot({path:resolve(destination,'task-status-'+width+'.png'),animations:'disabled'});
  await matter.locator('[data-worker-id="'+second.workerId+'"] > [data-slot="task-status-row"] > button').click();
  await matter.getByRole('button',{name:'前往原待答卡'}).click();
  await page.locator('#task-interaction-reader-removal-question').waitFor();
  await page.waitForFunction(()=>document.activeElement?.id==='task-interaction-reader-removal-question');await noReader();ok(true,'独立有效待答沿顶部状态定位原卡并还焦，未提交');
  await status.click();await popover.waitFor();if(width>=1120){await popover.getByRole('button',{name:'收起工作状态',exact:true}).focus();await page.keyboard.press('Enter');}else await page.keyboard.press('Escape');await popover.waitFor({state:'hidden'});ok(await status.evaluate(e=>e===document.activeElement),'键盘关闭状态浮层返回原入口，无失效关闭回调');
  // An ordinary lazy history request may arrive after the thread changes.
  f.delay(500);const oldToggle=page.locator('#message-node-88 [data-slot="collapsible-trigger"]');await oldToggle.click();
  await page.waitForFunction(()=>document.querySelector('#message-node-88 [data-slot="collapsible-trigger"]')?.getAttribute('aria-expanded')==='true');
  f.thread('synthetic-next-thread');await page.waitForTimeout(650);await noReader();ok(true,'线程变化与迟到普通过程响应均不能恢复旧导航或侧栏');
  assert.ok(requests.filter(r=>r.path==='/api/history/process').every(r=>!('itemId' in r.body)));
  assert.ok(!requests.some(r=>/^\/api\/tasks\/[^/]+(?:\/summary|\/origin\/.*)?$/.test(r.path)));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);assert.deepEqual(writes,[]);assert.equal(f.fakeEngine.invocations,0);assert.equal(f.submitted.length,0);assert.equal(f.stopped.length,0);
  results.push({width,checks,limitations,style,bounds,activityDetailReads:0,passed:true});console.log('PASS '+width+' '+checks.length);
 }catch(error){await page.screenshot({path:resolve(destination,'failure-'+width+'.png')}).catch(()=>{});throw error;}
 finally{await context.close();await f.close();}
}}finally{await context?.close();await writeFile(resolve(destination,'activity-browser.json'),JSON.stringify({browserVersion,syntheticOnly:true,results},null,2)+'\n');}
console.log(JSON.stringify({passed:results.length===3,widths:results.map(r=>r.width),checks:results.reduce((n,r)=>n+r.checks.length,0)}));
