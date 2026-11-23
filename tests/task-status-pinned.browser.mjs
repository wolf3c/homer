import assert from 'node:assert/strict';
import {cloneTask,overviewTask} from './task-status-browser-data.mjs';

export async function pinnedPerformance(page){
 const trigger=page.locator('#task-status-trigger'),panel=page.locator('#task-status-panel');
 const current=Array.from({length:20},(_,i)=>overviewTask('current-'+i));
 const archived=Array.from({length:1000},(_,i)=>overviewTask('archive-'+i,{historyState:'archived'}));
 const reads=[],archivePath=/\/api\/tasks\/list\/archived(?:\/before\/20)?$/;
 const capture=request=>{
  const path=new URL(request.url()).pathname;
  if(/^\/api\/tasks(?:\/|$)/.test(path))reads.push(path);
 };
 await page.route('**/api/tasks',route=>route.fulfill({json:{tasks:current}}));
 await page.route(archivePath,route=>{
  const next=new URL(route.request().url()).pathname.endsWith('/before/20');
  return route.fulfill({json:{tasks:archived.slice(next?20:0,next?40:20),nextCursor:next?40:20}});
 });
 await page.setViewportSize({width:390,height:844});
 await page.reload();
 await trigger.waitFor();
 page.on('request',capture);
 try{
  await page.evaluate(()=>{window.__statusOpenStart=performance.now();});
  await trigger.click();
  const rows=panel.locator('[data-todo-id]');
  await rows.nth(19).waitFor();
  const firstFrameMs=await page.evaluate(async()=>{
   await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));
   return performance.now()-window.__statusOpenStart;
  });
  assert.equal(await rows.count(),20);
  assert.ok(reads.length>0&&reads.every(path=>path==='/api/tasks'),'opening reads only the current list');
  const archive=panel.getByRole('region',{name:'已归档事项',exact:true});
  await panel.getByRole('button',{name:'已归档',exact:true}).click();
  await archive.getByText('合成任务 archive-0',{exact:true}).waitFor();
  assert.equal(await rows.count(),40);
  await archive.getByRole('button',{name:'下一页',exact:true}).click();
  await archive.getByText('合成任务 archive-20',{exact:true}).waitFor();
  assert.equal(await rows.count(),40,'new archive page replaces the previous page');
  assert.deepEqual([...new Set(reads)],['/api/tasks','/api/tasks/list/archived','/api/tasks/list/archived/before/20']);
  return {checksPassed:5,firstFrameMs,archivedTasks:archived.length,maxRenderedRows:40};
 }finally{
  page.off('request',capture);
  await page.unroute('**/api/tasks');
  await page.unroute(archivePath);
 }
}

async function statusScroll(page,{destination,ok}){
 const original=await page.evaluate(async()=>await(await fetch('/api/tasks')).json());
 const current=original.tasks.find(task=>task.historyState==='visible');
 const tasks=Array.from({length:60},(_,i)=>cloneTask(current,'-scroll-'+i,{title:'事项滚动检查 '+i}));
 await page.route('**/api/tasks',route=>route.fulfill({json:{tasks}}));
 const metrics=[],settle=()=>page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
 const measure=()=>page.evaluate(()=>{
  const doc=document.scrollingElement,panel=document.querySelector('.preview-main-panel'),list=document.querySelector('.status-list'),view=document.querySelector('.thread-viewport');
  return {documentTop:doc.scrollTop,documentRange:doc.scrollHeight-doc.clientHeight,panelTop:panel.scrollTop,panelRange:panel.scrollHeight-panel.clientHeight,headerY:document.querySelector('.conversation-header').getBoundingClientRect().y,composerBottom:document.querySelector('.composer-area').getBoundingClientRect().bottom,height:innerHeight,listTop:list?.scrollTop,listRange:list?list.scrollHeight-list.clientHeight:0,messageTop:view.scrollTop,messageRange:view.scrollHeight-view.clientHeight};
 });
 const contained=async label=>{
  const sample=await measure();metrics.push({label,...sample});
  console.log(JSON.stringify({label,...sample}));
  ok(sample.documentRange===0&&sample.documentTop===0&&sample.panelRange===0&&sample.panelTop===0&&sample.headerY===0&&Math.abs(sample.composerBottom-sample.height)<=1,label+'：整页无滚动范围，顶栏与输入框保持窗口边界');
  return sample;
 };
 const wheel=async(locator,deltaY)=>{const box=await locator.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.wheel(0,deltaY);await settle();};
 try{
  for(const viewport of [{width:1440,height:900},{width:1440,height:520},{width:390,height:780}]){
   const label=`${viewport.width}x${viewport.height}`,narrow=viewport.width<1120;
   await page.setViewportSize(viewport);await page.reload();
   const trigger=page.locator('#task-status-trigger'),panel=page.locator('#task-status-panel'),view=page.locator('.thread-viewport');
   await trigger.waitFor();if(narrow)await trigger.click();await panel.waitFor();
   await panel.getByText('事项滚动检查 0',{exact:true}).waitFor();
   const list=panel.locator('.status-list');
   ok(await list.evaluate(el=>el.scrollHeight>el.clientHeight),label+'：事项列表确实超出可见高度');
   await view.evaluate(el=>{el.scrollTop=el.scrollHeight;});
   if(!narrow)await wheel(view,240);
   if(destination)await page.screenshot({path:destination+'/status-scroll-'+label+'.png',animations:'disabled'});
   const before=await contained(label+' 消息到底继续滚轮');
   await wheel(list,200);const scrolled=await contained(label+' 列表滚轮');
   ok(scrolled.listTop>before.listTop&&Math.abs(scrolled.messageTop-before.messageTop)<1,label+'：侧栏滚动不移动消息区');
   await list.focus();await page.keyboard.press('End');await page.waitForFunction(()=>{const el=document.querySelector('.status-list');return Math.abs(el.scrollHeight-el.clientHeight-el.scrollTop)<1;});await contained(label+' 列表键盘 End');
   if(narrow){
    await page.keyboard.press('Escape');await panel.waitFor({state:'hidden'});
    ok(await trigger.evaluate(el=>document.activeElement===el),label+'：Escape 回焦入口');
   }
   const messageBefore=await view.evaluate(el=>el.scrollTop);
   await wheel(view,-160);const moved=await contained(label+' 消息向上滚动');
   ok(moved.messageTop<messageBefore,label+'：消息区仍能独立向上滚动');
  }
 }finally{await page.unroute('**/api/tasks');}
 await page.setViewportSize({width:1440,height:1000});await page.reload();await page.locator('#task-status-panel').waitFor();
 return metrics;
}

export default async function pinnedStatus(page,{destination}={}){
 const checks=[],metrics=[],errors=[],ok=(value,name)=>{assert.ok(value,name);checks.push(name);};
 page.on('pageerror',error=>errors.push(error.message));
 const trigger=page.locator('#task-status-trigger'),panel=page.locator('#task-status-panel');
 const ready=()=>trigger.waitFor();
 const shot=async name=>{if(destination)await page.screenshot({path:destination+'/'+name+'.png',animations:'disabled'});};
 await trigger.waitFor();await page.getByRole('complementary',{name:'工作状态卡片'}).waitFor();await ready();
 metrics.push(...await statusScroll(page,{destination,ok}));await ready();
 ok(await trigger.getAttribute('aria-expanded')==='true','1440px 初次常驻');
 ok(await panel.getByRole('heading',{name:'工作状态'}).count()===0&&await panel.getByRole('button',{name:'收起工作状态'}).count()===0,'状态摘要不显示标题与关闭按钮');
 await trigger.evaluate(el=>Promise.allSettled(el.getAnimations().map(animation=>animation.finished)));
 const icon=trigger.locator('.status-entry-icon');
 const openStyle=await icon.evaluate(el=>getComputedStyle(el).backgroundColor);
 ok(await trigger.getAttribute('aria-label')==='工作状态'&&await trigger.getAttribute('aria-controls')==='task-status-panel','图标入口名称及面板关系准确');
 ok(await trigger.innerText()===''&&await page.locator('.header-name').innerText()==='荷马','左侧仅保留品牌，保留入口图标');
 ok(await page.locator('.header-actions> :last-child').getAttribute('aria-label')==='预览','预览入口保持应用最右');
 const purchase=()=>panel.getByText('采购选型方案',{exact:true});
 await purchase().waitFor();
 await page.keyboard.press('Escape');ok(await panel.isVisible(),'宽屏摘要为非模态，Escape 不关闭常驻');
 await shot('desktop-1440-pinned');
 const originalNode=await panel.locator('[data-todo-id]').first().getAttribute('data-todo-id');
 await trigger.click();await panel.waitFor({state:'hidden'});await page.mouse.move(0,0);
 await page.waitForFunction(openStyle=>getComputedStyle(document.querySelector('#task-status-trigger .status-entry-icon')).backgroundColor!==openStyle,openStyle);
 ok(await trigger.getAttribute('aria-expanded')==='false'&&await trigger.innerText()===''&&await icon.evaluate(el=>getComputedStyle(el).backgroundColor)!==openStyle,'入口收起时状态样式改变');await shot('desktop-1440-closed');
 await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
 await page.setViewportSize({width:1024,height:900});await page.setViewportSize({width:1440,height:1000});
 ok(await trigger.getAttribute('aria-expanded')==='false','明确关闭后通知与跨断点不重开');
 await trigger.click();await purchase().waitFor();
 ok(await panel.locator('[data-todo-id]').first().getAttribute('data-todo-id')===originalNode,'图标关闭重开保留同一来源');
 for(const width of [320,390,1024]){
  await page.setViewportSize({width,height:844});await panel.waitFor({state:'hidden'});
  ok(await page.getByRole('dialog',{name:'工作状态卡片'}).count()===0,width+'px 缩小时不自动弹层');
  await trigger.click();await page.getByRole('dialog',{name:'工作状态卡片'}).waitFor();
  await purchase().waitFor();
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
 await page.getByRole('button',{name:'收起预览',exact:true}).click();
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
 await trigger.focus();await page.keyboard.press('Enter');await panel.waitFor({state:'hidden'});
 ok(await trigger.getAttribute('aria-expanded')==='false'&&await trigger.evaluate(el=>document.activeElement===el),'窄屏键盘通过入口收起并保留焦点');
 await page.getByRole('button',{name:'预览',exact:true}).click();
 await page.getByRole('dialog',{name:/^预览：/}).waitFor();
 ok(await trigger.evaluate(el=>!!el.closest('[inert]')||!!el.closest('[aria-hidden="true"]')),'手机预览模态保持背景工作状态入口不可达');
 await page.locator('.canvas-collapse, .conversation-header [aria-controls=canvas-panel][aria-expanded=true]:not([aria-hidden=true] *)').click();
 ok(errors.length===0,'所有路径无页面异常');
 return {checksPassed:checks.length,checks,metrics,errors};
}

export async function pinnedData(page,{destination}={}){
 const checks=[],ok=(value,name)=>{assert.ok(value,name);checks.push(name);};
 const trigger=page.locator('#task-status-trigger'),panel=page.locator('#task-status-panel');
 await panel.waitFor();const original=await page.evaluate(async()=>await(await fetch('/api/tasks')).json());
 await panel.getByText('采购选型方案',{exact:true}).waitFor();
 await page.route('**/api/tasks',route=>route.fulfill({status:503,body:'synthetic_overview_failure'}));
 await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await panel.getByRole('button',{name:'重试',exact:true}).waitFor();
 const retry=panel.getByRole('button',{name:'重试',exact:true});
 ok(await panel.locator('[data-item-row]').count()===original.tasks.length&&await panel.locator('.status-footer').count()===0,'宽屏总览错误保留已知事项且无常驻刷新栏');
 await page.unroute('**/api/tasks');await retry.click();await retry.waitFor({state:'hidden'});
 ok(true,'就地重试恢复总览');
 const tasks=Array.from({length:35},(_,i)=>cloneTask(original.tasks[0],'-'+i,{title:'完整中文事项标题用于窄屏截断检查'.repeat(4)+' '+i,creationOrder:100-i}));
 await page.route('**/api/tasks',route=>route.fulfill({json:{tasks:tasks.slice(0,20),nextCursor:20}}));
 await page.route('**/api/tasks/list/visible/before/20',route=>route.fulfill({json:{tasks:tasks.slice(20)}}));
 await page.setViewportSize({width:320,height:844});await page.reload();await trigger.waitFor();
 ok(await trigger.getAttribute('aria-expanded')==='false','320px 大量任务仍默认关闭');
 await trigger.click();
 const first=panel.locator('[data-item-row]').first(),next=panel.getByRole('button',{name:'下一页',exact:true});
 await next.waitFor();
 ok(await panel.locator('[data-todo-id]').count()===20,'第一页最多显示 20 项合成事项');
 ok((await first.getAttribute('title')).length>50,'长标题保留完整 title');
 await next.click();
 await panel.getByText(tasks[20].title,{exact:true}).waitFor();
 ok(await panel.locator('[data-todo-id]').count()===15,'下一页可访问剩余事项');
 await page.keyboard.press('Escape');
 await page.setViewportSize({width:1440,height:520});
 await next.waitFor();
 const view=page.locator('.thread-viewport'),top=await view.evaluate(el=>el.scrollTop);
 await panel.locator('.status-list').evaluate(el=>el.scrollTop=200);
 ok(await panel.locator('.status-list').evaluate(el=>el.scrollHeight>el.clientHeight&&el.scrollTop===200)&&await view.evaluate(el=>el.scrollTop)===top,'常驻列表独立滚动');
 if(destination)await page.screenshot({path:destination+'/desktop-1440-long-titles.png',animations:'disabled'});
 await page.unroute('**/api/tasks');await page.unroute('**/api/tasks/list/visible/before/20');
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
 const purchase=panel.getByText('采购选型方案',{exact:true});
 await purchase.waitFor();
 await page.evaluate(()=>window.__breakStatusStream());
 await panel.getByText(/显示上次记录/).waitFor();
 ok(await purchase.isVisible()&&await panel.getByRole('button',{name:'重试',exact:true}).count()===0,'断线保留上次事项且不显示错误重试');
 await panel.getByText(/显示上次记录/).waitFor({state:'hidden',timeout:20000});
 const previous=await purchase.elementHandle();
 await page.evaluate(()=>window.__nextStatusEpoch());
 await page.waitForFunction(row=>!row.isConnected,previous);
 await purchase.waitFor();
 ok(await panel.isVisible(),'读取代际变化时常驻侧栏仍可见');
 await trigger.click();await panel.waitFor({state:'hidden'});await page.evaluate(()=>window.__nextStatusEpoch());
 ok(await trigger.getAttribute('aria-expanded')==='false','关闭选择在读取代际变化后保持');
 return {checksPassed:checks.length,checks};
}

// The same matter identities and reading anchor survive a refreshed list.
export async function pinnedOrdering(page,{destination}={}){
 const trigger=page.locator('#task-status-trigger'),panel=page.locator('#task-status-panel'),rows=panel.locator('[data-todo-id]');
 const make=(id,createdAt)=>overviewTask(id,{title:id,createdAt,creationOrder:createdAt});
 const active=Array.from({length:40},(_,i)=>make('ordering-'+(39-i),40-i));
 let tasks=active;
 await page.route('**/api/tasks',route=>route.fulfill({json:{tasks}}));
 const results=[];
 for(const width of [1440,390,320]){
  tasks=active;
  await page.setViewportSize({width,height:900});await page.reload();await trigger.waitFor();
  if(width<1120)await trigger.click();
  await rows.first().waitFor();
  assert.deepEqual(await rows.evaluateAll(elements=>elements.map(el=>el.dataset.todoId)),active.map(t=>t.id));
  const reading=await panel.locator('.status-list').evaluate(list=>{
   list.scrollTop=205;
   const top=list.getBoundingClientRect().top;
   const row=[...list.querySelectorAll('[data-todo-id]')].find(el=>el.getBoundingClientRect().bottom>top);
   return {id:row.dataset.todoId,offset:row.getBoundingClientRect().top-top};
  });
  tasks=[make('ordering-new',999),...active];
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await panel.getByText('ordering-new',{exact:true}).waitFor();
  assert.equal(await rows.first().getAttribute('data-todo-id'),'ordering-new');
  const delta=await panel.locator('.status-list').evaluate((list,{id,offset})=>{
   const row=[...list.querySelectorAll('[data-todo-id]')].find(el=>el.dataset.todoId===id);
   return row.getBoundingClientRect().top-list.getBoundingClientRect().top-offset;
  },reading);
  assert.ok(Math.abs(delta)<2,JSON.stringify({width,reading,delta}));
  if(destination)await page.screenshot({path:destination+'/ordering-'+width+'.png',animations:'disabled'});
  results.push({width,anchorOffsetDelta:delta});
 }
 await page.unroute('**/api/tasks');
 return {checksPassed:results.length*3,results,syntheticOnly:true};
}
