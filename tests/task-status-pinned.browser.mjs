import assert from 'node:assert/strict';
import {cloneTask,workerNamed,changeWorker,overviewTask} from './task-status-browser-data.mjs';

export async function pinnedPerformance(page){
 const trigger=page.locator('#task-status-trigger');
 await page.setViewportSize({width:390,height:844});await page.reload();
 await page.waitForFunction(()=>document.querySelector('#task-status-trigger')?.title.includes('工作中'));
 const original=await page.evaluate(async()=>await(await fetch('/api/tasks')).json());
 const tasks=[];
 for(let n=0;n<250;n++)for(const task of original.tasks)tasks.push(cloneTask(task,'-'+n));
 assert.equal(tasks.length,1000);
 await page.route('**/api/tasks',route=>route.fulfill({json:{...original,tasks}}));
 let progressReads=0;
 page.on('request',request=>{if(new URL(request.url()).pathname.endsWith('/progress'))progressReads++;});
 const samples=[];
 for(let n=0;n<3;n++){
  await page.reload();await page.waitForFunction(()=>document.querySelector('#task-status-trigger')?.title.includes('250 个任务工作中'));
  await page.evaluate(()=>{window.__statusOpenStart=performance.now();});
  await trigger.click();const panel=page.getByRole('dialog',{name:'工作状态卡片'});await panel.waitFor();
  const sample=await page.evaluate(async()=>{await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));return {openToFrameMs:performance.now()-window.__statusOpenStart,initialSections:document.querySelectorAll('[data-todo-id]').length,domNodes:document.querySelectorAll('*').length};});
  assert.equal(sample.initialSections,750);
  const more=panel.getByRole('button',{name:/显示更多事项/});await more.click();
  assert.equal(await panel.locator('[data-todo-id]').count(),770);
  assert.ok(await more.evaluate(element=>element===document.activeElement));
  samples.push({...sample,nextSections:770,focusKept:true});
  await page.keyboard.press('Escape');
 }
 assert.equal(progressReads,0,'collapsed tasks must not eagerly fetch progress');
 await page.unroute('**/api/tasks');
 return {checksPassed:11,tasks:tasks.length,samples,progressReadsWhileCollapsed:progressReads,localControlledObservation:true};
}

export default async function pinnedStatus(page,{destination}={}){
 const checks=[],metrics=[],errors=[],ok=(value,name)=>{assert.ok(value,name);checks.push(name);};
 page.on('pageerror',error=>errors.push(error.message));
 const trigger=page.locator('#task-status-trigger'),panel=page.locator('#task-status-panel');
 const ready=()=>page.waitForFunction(()=>document.querySelector('#task-status-trigger')?.title.includes('工作中'));
 const shot=async name=>{if(destination)await page.screenshot({path:destination+'/'+name+'.png',animations:'disabled'});};
 await trigger.waitFor();await page.getByRole('complementary',{name:'工作状态卡片'}).waitFor();await ready();
 ok(await trigger.getAttribute('aria-expanded')==='true','1440px 初次常驻');
 ok(await trigger.getAttribute('aria-label')==='工作状态，1 个任务工作中'&&await trigger.getAttribute('aria-controls')==='task-status-panel','图标入口名称及面板关系准确');
 ok(await trigger.innerText()==='1'&&await page.locator('.header-name').innerText()==='荷马','左侧仅保留品牌，入口图标与事项计数');
 ok(await page.locator('.header-actions> :last-child').getAttribute('aria-label')==='预览','预览入口保持应用最右');
 const purchase=()=>panel.getByRole('button',{name:/采购选型方案/});
 await purchase().click();await panel.getByRole('button',{name:/资料整理 Worker/}).click();
 await panel.getByText('核对服务条款',{exact:true}).waitFor();
 ok((await panel.locator('[data-count="working"]').innerText())==='1'&&(await panel.locator('[data-count="done"]').innerText())==='1'&&(await panel.locator('[data-count="needs-user"]').innerText())==='1','原工作/完成/有效待答计数及层级准确');
 await page.keyboard.press('Escape');ok(await panel.isVisible(),'宽屏摘要为非模态，Escape 不关闭常驻');
 await shot('desktop-1440-pinned');
 const originalNode=await panel.locator('[data-todo-id]').first().getAttribute('data-todo-id');
 await trigger.click();await panel.waitFor({state:'hidden'});await shot('desktop-1440-closed');
 await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
 await page.setViewportSize({width:1024,height:900});await page.setViewportSize({width:1440,height:1000});
 ok(await trigger.getAttribute('aria-expanded')==='false','明确关闭后通知与跨断点不重开');
 await trigger.click();await panel.getByText('核对服务条款',{exact:true}).waitFor();
 ok(await panel.locator('[data-todo-id]').first().getAttribute('data-todo-id')===originalNode,'图标关闭重开保留同一来源及展开身份');
 for(const width of [320,390,1024]){
  await page.setViewportSize({width,height:844});await panel.waitFor({state:'hidden'});
  ok(await page.getByRole('dialog',{name:'工作状态卡片'}).count()===0,width+'px 缩小时不自动弹层');
  await trigger.click();await page.getByRole('dialog',{name:'工作状态卡片'}).waitFor();
  await panel.getByText('核对服务条款',{exact:true}).waitFor();
  ok(await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth),width+'px 无横向溢出');
  await shot('popover-'+width);
  await page.keyboard.press('Escape');await panel.waitFor({state:'hidden'});
  ok(await trigger.evaluate(el=>document.activeElement===el),width+'px Esc 回到入口');
 }
 await page.setViewportSize({width:1120,height:1000});await panel.waitFor();
 ok(await page.locator('.conversation').evaluate(el=>el.clientWidth===800)&&await panel.evaluate(el=>el.getBoundingClientRect().width===320),'1120px 边界保留800px聊天与320px摘要');
 await page.setViewportSize({width:1119,height:1000});await panel.waitFor({state:'hidden'});
 ok(await page.getByRole('dialog',{name:'工作状态卡片'}).count()===0,'1119px 退为关闭的弹层入口');
 await page.setViewportSize({width:1440,height:1000});await panel.waitFor();
 await page.getByRole('button',{name:'预览',exact:true}).click();await page.locator('#canvas-panel').waitFor();
 await panel.waitFor({state:'hidden'});
 ok(await page.locator('#canvas-panel').isVisible(),'1440px 打开预览后不足宽度则状态退回入口');
 await trigger.click();await page.getByRole('dialog',{name:'工作状态卡片'}).waitFor();await shot('preview-1440-popover');
 await page.keyboard.press('Escape');await page.setViewportSize({width:2560,height:1100});
 await page.getByRole('complementary',{name:'工作状态卡片'}).waitFor();
 ok(await page.locator('#canvas-panel').isVisible()&&await page.locator('.conversation').evaluate(el=>el.clientWidth>=800),'2560px 预览与状态并列且聊天至少800px');
 await shot('preview-2560-pinned');
 const divider=await page.locator('.preview-separator').boundingBox();
 await page.mouse.move(divider.x+divider.width/2,divider.y+100);await page.mouse.down();await page.mouse.move(divider.x-220,divider.y+100,{steps:5});await page.mouse.up();await panel.waitFor({state:'hidden'});
 ok(await page.locator('#canvas-panel').isVisible()&&await trigger.getAttribute('aria-expanded')==='false','更宽屏拖窄实际聊天栏也退回弹层入口，不关闭预览');
 await page.getByRole('button',{name:'预览',exact:true}).click();
 await page.setViewportSize({width:1440,height:1000});
 await page.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});await shot('desktop-1440-dark');
 await page.emulateMedia({colorScheme:'light'});
 await page.clock.install();let overview=0,progress=0;
 const count=request=>{const path=new URL(request.url()).pathname;if(path==='/api/tasks')overview++;if(path.endsWith('/progress'))progress++;};page.on('request',count);
 await page.clock.runFor(3000);const settled={overview,progress};await page.clock.runFor(10000);
 ok(overview===settled.overview&&progress===settled.progress,'单内容 owner 静止无轮询');
 const idle={overview:overview-settled.overview,progress:progress-settled.progress};
 const held=[];await page.route('**/api/tasks',route=>{held.push(route);});
 await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await page.clock.runFor(10);
 ok(held.length===1,'页面恢复只有一份总览请求');
 metrics.push({idleMs:10000,idleOverview:idle.overview,idleProgress:idle.progress,visibilityReads:held.length});
 for(const route of held)await route.continue();await page.unroute('**/api/tasks');await page.clock.resume();page.off('request',count);
 // The original list remains the only owner while layouts change.
 const view=page.locator('.thread-viewport');
 await view.evaluate(el=>{el.dispatchEvent(new WheelEvent('wheel',{bubbles:true,deltaY:-1}));el.scrollTop=Math.max(0,(el.scrollHeight-el.clientHeight)/2);});
 const reading=await view.evaluate(el=>{const top=el.getBoundingClientRect().top;const first=[...el.querySelectorAll('[data-conversation-message]')].find(row=>row.getBoundingClientRect().bottom>top);return {id:first.id,top:first.getBoundingClientRect().top};});
 await page.locator('.composer').evaluate(el=>el.dataset.preserved='yes');
 await trigger.click();await panel.waitFor({state:'hidden'});await trigger.click();await panel.waitFor();
 await page.waitForFunction(saved=>Math.abs(document.getElementById(saved.id).getBoundingClientRect().top-saved.top)<2,reading);
 ok(await page.locator('.composer[data-preserved="yes"]').count()===1,'面板切换保留历史阅读锚点和原输入框实例');
 await page.setViewportSize({width:390,height:844});await panel.waitFor({state:'hidden'});
 await trigger.click();await panel.waitFor();await page.locator('.composer [contenteditable="true"]').click();await panel.waitFor({state:'hidden'});
 ok(await page.locator('.composer').evaluate(el=>el.contains(document.activeElement)),'窄屏外点关闭，保留实际点击输入框的焦点');
 await page.reload();await ready();ok(await trigger.getAttribute('aria-expanded')==='false'&&await panel.count()===0,'窄屏新会话初次不弹层');
 await trigger.click();await panel.waitFor();
 await page.getByRole('button',{name:'收起工作状态',exact:true}).click();await panel.waitFor({state:'hidden'});
 await page.waitForFunction(()=>document.activeElement?.id==='task-status-trigger');ok(true,'窄屏关闭按钮返回入口');
 await page.getByRole('button',{name:'预览',exact:true}).click();
 await page.getByRole('dialog',{name:'预览',exact:true}).waitFor();
 ok(await trigger.evaluate(el=>!!el.closest('[inert]')||!!el.closest('[aria-hidden="true"]')),'手机预览模态保持背景工作状态入口不可达');
 await page.locator('.canvas-collapse, .conversation-header [aria-controls=canvas-panel][aria-expanded=true]:not([aria-hidden=true] *)').click();
 ok(errors.length===0,'所有路径无页面异常');
 return {checksPassed:checks.length,checks,metrics,errors};
}

export async function pinnedData(page,{destination,publish}={}){
 const checks=[],ok=(value,name)=>{assert.ok(value,name);checks.push(name);};
 const trigger=page.locator('#task-status-trigger'),panel=page.locator('#task-status-panel');
 await panel.waitFor();const original=await page.evaluate(async()=>await(await fetch('/api/tasks')).json());
 const {task:purchaseTask,worker:research}=workerNamed(original,'资料整理 Worker');
 const root=()=>panel.getByRole('button',{name:/采购选型方案/}),worker=()=>panel.getByRole('button',{name:/资料整理 Worker/});
 await root().click();await worker().click();await panel.locator('[data-slot="agent-plan"]').waitFor();
 await root().click();await root().click();ok(await worker().getAttribute('aria-expanded')==='false','原父层收起重开仍清理子层展开');
 await worker().click();await panel.locator('[data-slot="agent-plan"]').waitFor();
 await panel.getByRole('button',{name:/成本分析 Worker/}).click();publish('progress');
 await panel.getByText('成本表已按统一口径更新。',{exact:true}).waitFor();
 ok(await worker().getAttribute('aria-expanded')==='true'&&(await panel.locator('[data-count="working"]').innerText())==='1','真实合成 SSE 通知更新公开进展并保留层级与计数');
 await panel.getByRole('button',{name:/成本分析 Worker/}).click();
 const refreshed=await page.evaluate(async()=>await(await fetch('/api/tasks')).json());
 let snapshot={...refreshed,progressRevision:(refreshed.progressRevision??0)+1};
 await page.route('**/api/tasks',route=>route.fulfill({json:snapshot}));
 await page.route('**/api/tasks/*/progress',route=>route.fulfill({status:503,body:'synthetic_progress_failure'}));
 await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
 await panel.getByText('公开进展读取失败，可收起后重新展开重试。',{exact:true}).waitFor();
 ok(await panel.locator('[data-slot="agent-plan"]').count()===1,'宽屏进展刷新失败保留同一执行的已确认计划');
 await page.unroute('**/api/tasks/*/progress');await worker().click();await worker().click();await panel.locator('[data-slot="agent-plan"]').waitFor();
 ok(true,'详情失败仍按原收起重开路径恢复');
 // Hold an old execution response while the source identity changes.
 const oldProgress=await page.evaluate(async id=>await(await fetch('/api/tasks/'+id+'/progress')).json(),purchaseTask.id);
 const held=[];let started;const pending=new Promise(resolve=>started=resolve);
 await page.route('**/api/tasks/*/progress',route=>{held.push(route);started();});
 await worker().click();await worker().click();await pending;
 snapshot=changeWorker({...snapshot,tasks:original.tasks},'资料整理 Worker',w=>({...w,run:{...w.run,id:w.run.id+'-next',version:w.run.version+1,epoch:w.run.epoch+1,threadId:'synthetic-next-thread',turnId:'synthetic-next-turn'}}));
 await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
 await page.waitForFunction(()=>[...document.querySelectorAll('[data-worker-id] > [data-slot="task-status-row"] > button')].some(el=>el.textContent.includes('资料整理 Worker')&&el.getAttribute('aria-expanded')==='false'));
 for(const route of held)await route.fulfill({json:oldProgress}).catch(()=>{});await page.unroute('**/api/tasks/*/progress');
 await worker().click();await panel.getByText('尚无可确认的公开进展。',{exact:true}).waitFor();
 ok(await panel.locator('[data-slot="agent-plan"]').count()===0&&await root().getAttribute('aria-expanded')==='true','旧 Run 迟到结果不进入新身份，其他展开层级保留');
 await page.unroute('**/api/tasks');
 await page.route('**/api/tasks',route=>route.fulfill({status:503,body:'synthetic_overview_failure'}));
 await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await panel.getByRole('button',{name:'重试',exact:true}).waitFor();
 ok(await panel.locator('[data-item-row]').count()===4&&await panel.locator('.status-footer').count()===0,'宽屏总览错误保留已知事项且不恢复常驻刷新栏');
 await page.unroute('**/api/tasks');await panel.getByRole('button',{name:'重试',exact:true}).click();await panel.getByRole('button',{name:'重试',exact:true}).waitFor({state:'hidden'});
 ok(true,'原就地重试恢复总览');
 await page.reload();await panel.waitFor();await root().click();await panel.getByRole('button',{name:/收费数据 Worker/}).click();
 await panel.getByRole('button',{name:'前往原待答卡'}).click();await panel.waitFor({state:'hidden'});
 await page.waitForFunction(()=>document.activeElement?.id==='task-interaction-status-approval');
 ok(true,'宽屏原待答定位保持准确身份及焦点');
 // A large, synthetic snapshot verifies pagination and long names in both hosts.
 const tasks=[];
 for(let n=0;n<20;n++)for(const t of original.tasks)tasks.push(cloneTask(t,'-'+n,{title:((t.title??t.goal)+' 完整中文事项标题用于窄屏省略与展开阅读全文'.repeat(3)).slice(0,60)}));
 await page.route('**/api/tasks',route=>route.fulfill({json:{...original,tasks}}));
 await page.setViewportSize({width:320,height:844});await page.reload();
 await page.waitForFunction(()=>document.querySelector('#task-status-trigger')?.title.includes('20 个任务工作中'));
 ok(await trigger.getAttribute('aria-expanded')==='false','320px 大量任务仍默认关闭');
 await trigger.click();await panel.waitFor();
 ok(await panel.locator('[data-todo-id]').count()===60,'未结案事项全部可达，历史仍按批展示');
 await panel.getByRole('button',{name:/显示更多事项/}).click();
 ok(await panel.locator('[data-todo-id]').count()===80,'原分页继续加载剩余历史事项');
 const first=panel.locator('[data-item-row]>button').first();await first.click();
 ok((await first.getAttribute('title')).length>50&&await panel.locator('.status-row-heading').first().isVisible(),'长标题有完整 title 与展开全文');
 await trigger.click();await panel.waitFor({state:'hidden'});await trigger.click();await panel.waitFor();
 ok(await panel.locator('[data-todo-id]').count()===80&&await first.getAttribute('aria-expanded')==='true','弹层关闭重开保持分页与展开');
 await page.keyboard.press('Escape');await page.setViewportSize({width:1440,height:1000});await panel.waitFor();
 ok(await panel.locator('[data-todo-id]').count()===80,'切回常驻保留同一分页');
 const view=page.locator('.thread-viewport'),top=await view.evaluate(el=>el.scrollTop);
 await panel.locator('.status-list').evaluate(el=>el.scrollTop=200);
 ok(await panel.locator('.status-list').evaluate(el=>el.scrollHeight>el.clientHeight&&el.scrollTop===200)&&await view.evaluate(el=>el.scrollTop)===top,'常驻列表独立滚动，不移动聊天');
 await trigger.click();await panel.waitFor({state:'hidden'});await trigger.click();await panel.waitFor();
 ok(await panel.locator('.status-list').evaluate(el=>el.scrollTop===200),'关闭重开保留列表阅读位置');
 if(destination)await page.screenshot({path:destination+'/desktop-1440-long-titles.png',animations:'disabled'});
 await page.unroute('**/api/tasks');
 return {checksPassed:checks.length,checks};
}

export async function pinnedConnection(page){
 const checks=[],ok=(value,name)=>{assert.ok(value,name);checks.push(name);};
 await page.addInitScript(()=>{
  const original=window.fetch;
  window.fetch=async(...args)=>{
   const response=await original(...args);
   if(String(args[0]).endsWith('/api/history/events')&&response.body){
    let buffer='',latest;const decoder=new TextDecoder(),encoder=new TextEncoder();
    const transform=new TransformStream({transform(chunk,controller){
     buffer+=decoder.decode(chunk,{stream:true});const events=buffer.split('\n\n');buffer=events.pop()??'';
     for(const event of events){const line=event.split('\n').find(line=>line.startsWith('data: '));if(line)try{latest=JSON.parse(line.slice(6));}catch{}}
     window.__breakStatusStream=()=>controller.error(Error('synthetic_stream_disconnected'));
     window.__nextStatusEpoch=()=>controller.enqueue(encoder.encode('event: state\ndata: '+JSON.stringify({...latest,history:{...latest.history,readEpoch:latest.history.readEpoch+'-next'}})+'\n\n'));
     controller.enqueue(chunk);
    }});
    return new Response(response.body.pipeThrough(transform),{status:response.status,headers:response.headers});
   }
   return response;
  };
 });
 await page.reload();const trigger=page.locator('#task-status-trigger'),panel=page.locator('#task-status-panel');
 await panel.waitFor();await panel.getByRole('button',{name:/采购选型方案/}).click();
 const worker=()=>panel.getByRole('button',{name:/资料整理 Worker/});
 let attempts=0;const held=[];
 await page.route('**/api/tasks/*/progress',route=>{attempts++;if(attempts===1)held.push(route);else return route.continue();});
 await worker().click();await panel.getByText('正在读取公开进展…',{exact:true}).waitFor();
 await page.evaluate(()=>window.__breakStatusStream());await page.waitForFunction(()=>document.querySelector('#task-status-trigger').title.includes('上次'));
 ok(await panel.isVisible()&&await panel.getByRole('button',{name:'重试',exact:true}).count()===0,'断线常驻保留且准确标记上次记录，不伪造读取错误');
 for(const route of held)await route.abort().catch(()=>{});
 await panel.locator('[data-slot="agent-plan"]').waitFor({timeout:20000});
 ok(attempts>=2&&await worker().getAttribute('aria-expanded')==='true','重连后自动恢复公开进展并保留展开');
 await page.unroute('**/api/tasks/*/progress');
 let started;const pending=new Promise(resolve=>started=resolve),late=[];
 await page.route('**/api/tasks/*/progress',route=>{late.push(route);started();});
 await worker().click();await worker().click();await pending;
 await page.evaluate(()=>window.__nextStatusEpoch());
 await page.waitForFunction(()=>[...document.querySelectorAll('[data-item-row]>button')].length===4&&[...document.querySelectorAll('[data-item-row]>button')].every(el=>el.getAttribute('aria-expanded')==='false'));
 for(const route of late)await route.fulfill({json:{taskId:'old',workers:[]}}).catch(()=>{});await page.unroute('**/api/tasks/*/progress');
 ok(await panel.isVisible()&&await panel.locator('[data-slot="agent-plan"]').count()===0,'读取代际变化时常驻保持可见但重置旧展开与在途结果');
 await trigger.click();await panel.waitFor({state:'hidden'});await page.evaluate(()=>window.__nextStatusEpoch());
 ok(await trigger.getAttribute('aria-expanded')==='false','关闭选择在读取代际变化后保持');
 return {checksPassed:checks.length,checks};
}

// Real product UI, synthetic HTTP snapshot. Catches cached append order, clipped
// follow-ups, and lost reader/focus/expansion when a root moves into history.
export async function pinnedOrdering(page,{destination}={}){
 await page.waitForFunction(()=>document.querySelector('#task-status-trigger')?.title.includes('工作中'));
 const original=await page.evaluate(async()=>await(await fetch('/api/tasks')).json());
 const template=original.tasks.find(t=>t.workers.some(w=>w.run.phase==='executing'));
 assert.ok(template);
 const make=(id,at,ended=false)=>{const task=overviewTask(id,{title:id,creationOrder:at,settledAt:ended?at:null,state:ended?'settled':'open',outcome:ended?'succeeded':null});task.workers[0].run={...task.workers[0].run,status:ended?'succeeded':'running',phase:ended?'ended':'executing',startedAt:at,endedAt:ended?at:null};return task;};
 const active=Array.from({length:25},(_,i)=>make('ordering-active-'+i,i+1));
 const history=Array.from({length:30},(_,i)=>make('ordering-history-'+i,i+1,true));
 await page.evaluate(()=>{
  const fetch=window.fetch;window.__orderingReads={overview:0,progress:0};
  window.fetch=async(input,init)=>{
   const path=new URL(typeof input==='string'?input:input.url,location.href).pathname;
   if(path==='/api/tasks'&&window.__orderingSnapshot){window.__orderingReadRevision=window.__orderingSnapshot.progressRevision;window.__orderingReads.overview++;return new Response(JSON.stringify(window.__orderingSnapshot),{headers:{'Content-Type':'application/json'}});}
   if(path.startsWith('/api/tasks/')&&path.endsWith('/progress')){window.__orderingReads.progress++;return new Response(JSON.stringify({taskId:decodeURIComponent(path.split('/')[3]),workers:[]}),{headers:{'Content-Type':'application/json'}});}
   return fetch(input,init);
  };
 });
 const snapshot=async tasks=>{const revision=await page.evaluate(tasks=>{window.__orderingSnapshot={tasks,progressRevision:(window.__orderingSnapshot?.progressRevision??0)+1};document.dispatchEvent(new Event('visibilitychange'));return window.__orderingSnapshot.progressRevision;},tasks);await page.waitForFunction(revision=>window.__orderingReadRevision===revision,revision);await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));};
 const ids=()=>page.evaluate(()=>[...document.querySelectorAll('[data-todo-id]')].map(el=>el.dataset.todoId));
 const results=[];
 for(const width of [1440,390,320]){
  await page.setViewportSize({width,height:900});
  await page.evaluate(()=>{const trigger=document.querySelector('#task-status-trigger');if(trigger?.getAttribute('aria-expanded')!=='true')trigger.click();});
  await snapshot([...history,...active]);
  await page.waitForFunction(()=>document.querySelectorAll('[data-todo-id]').length===25);
  assert.deepEqual(await ids(),active.map(t=>t.id).reverse());
  assert.equal(await page.evaluate(()=>window.__orderingReads.progress),0,'collapsed snapshots do not request progress');
  await snapshot([...active,make('ordering-new',999),...history]);
  await page.waitForFunction(()=>document.querySelector('[data-todo-id]')?.dataset.todoId==='ordering-new');
  assert.equal((await ids()).length,26);
  const reader='ordering-active-5';
  await page.evaluate(id=>{const row=[...document.querySelectorAll('[data-todo-id]')].find(e=>e.dataset.todoId===id),button=row.querySelector('.status-row-trigger');button.focus({preventScroll:true});},reader);
  await page.keyboard.press('Space');
  await page.waitForFunction(id=>[...document.querySelectorAll('[data-todo-id]')].find(e=>e.dataset.todoId===id)?.querySelector('.status-row-trigger')?.getAttribute('aria-expanded')==='true',reader);
  const anchor=await page.evaluate(id=>{const list=document.querySelector('.status-list'),row=[...list.querySelectorAll('[data-todo-id]')].find(e=>e.dataset.todoId===id);list.scrollTop+=row.getBoundingClientRect().top-list.getBoundingClientRect().top;return {id,offset:row.getBoundingClientRect().top-list.getBoundingClientRect().top};},reader);
  await snapshot([...active.map(t=>t.id===reader?make(reader,0,true):t),make('ordering-new',999),...history]);
  await page.waitForFunction(()=>document.querySelectorAll('[data-todo-id]').length===56);
  const reading=await page.evaluate(anchor=>{const list=document.querySelector('.status-list'),row=[...list.querySelectorAll('[data-todo-id]')].find(e=>e.dataset.todoId===anchor.id);return {offset:row.getBoundingClientRect().top-list.getBoundingClientRect().top,focus:row.contains(document.activeElement),expanded:row.querySelector('.status-row-trigger').getAttribute('aria-expanded'),overflow:document.documentElement.scrollWidth>innerWidth};},anchor);
  assert.ok(Math.abs(reading.offset-anchor.offset)<2,JSON.stringify({width,anchor,reading}));assert.equal(reading.focus,true);assert.equal(reading.expanded,'true');assert.equal(reading.overflow,false);
  const order=await ids();await snapshot([...active.map(t=>t.id===reader?make(reader,0,true):{...t,revision:t.revision+10,notes:'ordinary update'}),make('ordering-new',999),...history]);
  await page.waitForFunction(()=>window.__orderingReads.overview>0);assert.deepEqual(await ids(),order);
  // A new scope of roots releases the former reader. More grows from the actual prefix.
  await page.evaluate(()=>document.querySelector('.status-list').focus());
  const small=[...active.slice(0,18).map(t=>(cloneTask(t,'-small'))),...history.map(t=>(cloneTask(t,'-small')))];
  await snapshot(small);await page.waitForFunction(()=>document.querySelectorAll('[data-todo-id]').length===20);
  await page.evaluate(()=>{const button=[...document.querySelectorAll('.status-list button')].find(e=>e.textContent.includes('显示更多事项'));button.focus();button.click();});
  await page.waitForFunction(()=>document.querySelectorAll('[data-todo-id]').length===40);
  assert.equal(await page.evaluate(()=>document.activeElement?.textContent.includes('显示更多事项')),true);
  if(destination)await page.screenshot({path:destination+'/ordering-'+width+'.png',animations:'disabled'});
  results.push({width,followUps:26,retainedPrefix:56,anchorOffsetDelta:reading.offset-anchor.offset,focus:true,expanded:true,morePrefix:40});
  // Reset the product's existing scope owner for the next width via a real reload.
  if(width!==320){await page.reload();await page.waitForFunction(()=>document.querySelector('#task-status-trigger')?.title.includes('工作中'));
   await page.evaluate(()=>{const fetch=window.fetch;window.__orderingReads={overview:0,progress:0};window.fetch=async(input,init)=>{const path=new URL(typeof input==='string'?input:input.url,location.href).pathname;if(path==='/api/tasks'&&window.__orderingSnapshot){window.__orderingReadRevision=window.__orderingSnapshot.progressRevision;window.__orderingReads.overview++;return new Response(JSON.stringify(window.__orderingSnapshot),{headers:{'Content-Type':'application/json'}});}if(path.startsWith('/api/tasks/')&&path.endsWith('/progress')){window.__orderingReads.progress++;return new Response(JSON.stringify({taskId:decodeURIComponent(path.split('/')[3]),workers:[]}),{headers:{'Content-Type':'application/json'}});}return fetch(input,init);};});}
 }
 return {checksPassed:results.length*10,results,syntheticOnly:true};
}
