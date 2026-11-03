// Real product page served by task-status-browser-fixture.mjs. All mutations
// below replace synthetic read responses; they never call business write APIs.
import assert from 'node:assert/strict';

// Exercise the existing visibility owner, rather than a persistent manual control.
export async function restoreStatusVisibility(page){
 await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
}

export async function taskStatusRefreshRemoval(page,{destination,publish}={}){
 const checks=[],metrics=[],errors=[],ok=(value,name)=>{assert.ok(value,name);checks.push(name);};
 page.on('pageerror',error=>errors.push(error.message));
 const trigger=page.locator('#task-status-trigger'),dialog=page.getByRole('dialog',{name:'工作状态卡片'});
 await trigger.locator('[data-count="working"]').waitFor();await trigger.click();
 await dialog.getByRole('button',{name:/采购选型方案/}).waitFor();
 const normal={footer:await dialog.locator('.status-footer').count(),refresh:await dialog.getByRole('button',{name:'刷新',exact:true}).count(),retry:await dialog.getByRole('button',{name:'重试',exact:true}).count()};
 await page.route('**/api/tasks',route=>route.fulfill({status:503,body:'synthetic_overview_failure'}));
 await restoreStatusVisibility(page);await dialog.getByText(/任务记录暂时无法读取/).waitFor();
 const retry=dialog.getByRole('button',{name:'重试',exact:true});
 const failed={retry:await retry.count(),items:await dialog.locator('[data-item-row]').count()};
 assert.deepEqual({normal,failed},{normal:{footer:0,refresh:0,retry:0},failed:{retry:1,items:4}},'正常无底栏，真实读取错误提供就地重试并保留已知数据');
 checks.push('正常无底栏，真实读取错误提供就地重试并保留已知数据');
 ok(await retry.isEnabled(),'总览失败可重试');
 const failedRetry=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/tasks'&&r.status()===503);
 await retry.focus();await page.keyboard.press('Enter');await failedRetry;await page.waitForFunction(()=>!document.querySelector('[aria-label="工作状态卡片"] button:disabled'));
 ok(await retry.isVisible()&&await dialog.locator('[data-item-row]').count()===4,'重试失败保留错误及已确认事项');
 await page.unroute('**/api/tasks');
 let held=[],requests=0;
 await page.route('**/api/tasks',route=>{requests++;held.push(route);});
 await retry.focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>document.querySelector('[aria-label="工作状态卡片"] button:disabled')!==null);
 ok(await retry.isDisabled(),'总览重试读取中禁用，保留原按钮');
 await page.keyboard.press('Enter');await page.keyboard.press('Space');
 ok(requests===1,'busy 时键盘重复操作仅发一个请求');
 for(const route of held)await route.continue();await page.unroute('**/api/tasks');
 await retry.waitFor({state:'hidden'});ok(await dialog.locator('[data-item-row]').count()===4,'总览重试成功移除错误及重试入口');
 for(const width of [320,390,1440]){
  await page.setViewportSize({width,height:width===1440?1000:844});
  const bounds=await dialog.evaluate(el=>{const list=el.querySelector('.status-list'),root=list.parentElement;return {last:list===root.lastElementChild,gap:root.getBoundingClientRect().bottom-list.getBoundingClientRect().bottom,right:el.getBoundingClientRect().right,scroll:document.documentElement.scrollWidth};});
  ok(bounds.last&&bounds.gap<1&&bounds.scroll===width&&bounds.right<=width,width+'px 正常列表后无空栏且无横向溢出');
  if(destination)await page.screenshot({path:destination+'/refresh-removal-'+width+'-normal.png',animations:'disabled'});
  await page.route('**/api/tasks',route=>route.fulfill({status:503,body:'synthetic_overview_failure'}));
  await restoreStatusVisibility(page);await retry.waitFor();
  if(destination)await page.screenshot({path:destination+'/refresh-removal-'+width+'-failure.png',animations:'disabled'});
  await page.unroute('**/api/tasks');await retry.click();await retry.waitFor({state:'hidden'});
 }
 // State notifications keep using the original snapshot and progress owners.
 if(publish){
  await dialog.getByRole('button',{name:/采购选型方案/}).click();
  await dialog.getByRole('button',{name:/成本分析 Worker/}).click();
  await dialog.getByText('工具调用：运行命令',{exact:true}).waitFor();
  publish('progress');await dialog.getByText('成本表已按统一口径更新。',{exact:true}).waitFor();
  ok(true,'状态通知自动更新已展开的准确公开进展');
  await dialog.getByRole('button',{name:/采购选型方案/}).click();
  let notifiedReads=0;const count= request=>{if(new URL(request.url()).pathname==='/api/tasks')notifiedReads++;};page.on('request',count);
  const automatic=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/tasks');
  for(let n=0;n<50;n++)publish();await automatic;
  ok(notifiedReads<=2,'50 次连续状态通知沿原读取节流合并');metrics.push({stateNotifications:50,overviewReads:notifiedReads});page.off('request',count);
 }
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
 await page.waitForFunction(()=>document.querySelector('#task-status-trigger').textContent.includes('上次'));
 ok(await retry.count()===0&&await dialog.getByText(/任务记录暂时无法读取/).count()===0,'页面隐藏后的上次记录不冒称读取失败或显示重试');
 const restored=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/tasks');
 await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});await restored;
 await page.waitForFunction(()=>!document.querySelector('#task-status-trigger').textContent.includes('上次'));
 ok(true,'hidden 恢复沿原 owner 自动读取最新总览');
 // No state notification means no poll.
 await page.clock.install();let overviewReads=0,progressReads=0;
 const count=request=>{const path=new URL(request.url()).pathname;if(path==='/api/tasks')overviewReads++;if(path.endsWith('/progress'))progressReads++;};page.on('request',count);
 await page.clock.runFor(3000);const settled=overviewReads;await page.clock.runFor(10000);
 ok(overviewReads===settled&&progressReads===0,'静止十秒无新增轮询，默认折叠不读取详情');
 metrics.push({idleMs:10000,overviewReads:overviewReads-settled,progressReads});
 await page.clock.resume();page.off('request',count);
 await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
 ok(await trigger.evaluate(el=>el===document.activeElement),'关闭后焦点回工作状态入口');
 let firstReadFails=true;await page.route('**/api/tasks',route=>firstReadFails?route.fulfill({status:503,body:'synthetic_first_read_failure'}):route.continue());
 await page.reload();await trigger.click();await dialog.getByText('任务记录读取失败，请重试。',{exact:true}).waitFor();
 ok(await retry.isEnabled()&&await trigger.locator('[data-count]').count()===0,'首次读取失败也有就地重试，不预报全零');
 await retry.focus();firstReadFails=false;await page.keyboard.press('Enter');await dialog.getByRole('button',{name:/采购选型方案/}).waitFor();await retry.waitFor({state:'hidden'});await page.unroute('**/api/tasks');
 ok(true,'首次总览失败可原位重试恢复');await page.keyboard.press('Escape');
 ok(errors.length===0,'移除底栏及错误恢复无页面异常');
 return {checksPassed:checks.length,checks,metrics,errors};
}

export async function taskStatusPresentation(page,{destination}={}){
 const checks=[],errors=[],ok=(value,name)=>{assert.ok(value,name);checks.push(name);};
 page.on('pageerror',error=>errors.push(error.message));
 const trigger=page.locator('#task-status-trigger'),dialog=page.getByRole('dialog',{name:'工作状态卡片'});
 await trigger.locator('[data-count="working"]').waitFor();
 const original=await page.evaluate(async()=>await(await fetch('/api/tasks')).json());
 const target=original.tasks.find(t=>t.goal==='成本分析 Worker');
 let snapshot=original,output={type:'tool',text:'正在执行合成命令'},plan,failProgress=false;
 await page.route('**/api/tasks',route=>route.fulfill({json:snapshot}));
 await page.route('**/api/tasks/*/progress',route=>failProgress?route.fulfill({status:503,body:'synthetic_progress_failure'}):route.fulfill({json:{taskId:target.rootTaskId,workers:[{
  taskId:target.id,version:target.headVersion,runId:target.currentRunId,epoch:target.run.epoch,threadId:target.run.threadId,turnId:target.run.turnId,revision:1,observedAtMs:1,output,plan,
 }]}}));
 const open=async extra=>{
  snapshot={...original,tasks:original.tasks.map(t=>t.id===target.id?{...t,...extra}:t)};
  await page.reload();await trigger.locator('[data-count="working"]').waitFor();await trigger.click();
  await dialog.getByRole('button',{name:/采购选型方案/}).click();
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/tasks/'+target.rootTaskId+'/progress');
  const button=dialog.getByRole('button',{name:/成本分析 Worker/});await button.click();await response;
  const card=button.locator('..');
  await card.getByText('正在读取公开进展…',{exact:true}).waitFor({state:'hidden'});
  return card;
 };
 let card=await open({});
 await card.getByText('工具调用：正在执行合成命令',{exact:true}).waitFor();
 ok(await dialog.getByText('执行、验收与正式交付分别核对',{exact:true}).count()===0,'移除浮层通用解释');
 ok(await dialog.getByRole('button',{name:'刷新',exact:true}).count()===0,'正常状态无常驻刷新按钮');
 plan=[{step:'合成并行展示计划',status:'inProgress'}];output={type:'text',text:'合成计划对应的最新公开进展'};
 card=await open({});await card.getByText('合成并行展示计划',{exact:true}).waitFor();
 await card.getByText('合成计划对应的最新公开进展',{exact:true}).waitFor();
 ok(true,'已有计划与最新公开进展同时显示');plan=undefined;output={type:'tool',text:'正在执行合成命令'};
 for(const [status,label]of [['succeeded','执行已结束 · 待验收'],['failed','执行失败'],['cancelled','已取消'],['interrupted','执行已中断']]){
  card=await open({run:{...target.run,status,phase:'ended',summary:'合成的已记录说明'}});
  await card.getByText('已记录说明（非实时进展）：合成的已记录说明',{exact:true}).waitFor();
  ok(await card.getByText('工具调用：正在执行合成命令',{exact:true}).count()===0,status+' 结束后不以末次工具进度覆盖现有摘要');
  ok((await card.locator('>button').innerText()).includes(label),status+' 保留准确状态');
 }
 card=await open({run:{...target.run,status:'awaiting_review',phase:'ended',summary:null},result:{id:'partial',state:'offered',outcome:'partial'}});
 ok(await card.locator('.status-output').count()===0&&await card.getByText('尚无可确认的公开进展。',{exact:true}).count()===0,'部分成果结束后无摘要则省略工具进度及空说明');
 ok((await card.locator('>button').innerText()).includes('部分成果'),'省略正文不丢失部分成果事实');
 plan=[{step:'合成已完成计划',status:'completed'}];
 card=await open({run:{...target.run,status:'succeeded',phase:'ended',summary:'合成摘要'}});
 await card.getByText('合成已完成计划',{exact:true}).waitFor();ok(true,'结束后的真实计划保留');plan=undefined;
 output={type:'text',text:'合成公开正文'};
 card=await open({run:{...target.run,status:'succeeded',phase:'ended',summary:null}});
 await card.getByText('合成公开正文',{exact:true}).waitFor();ok(true,'结束后的公开文字进展保留');
 output={type:'tool',text:'正在执行合成命令'};
 card=await open({state:'recovery',run:{...target.run,status:'succeeded',phase:'ended',summary:null}});
 await card.getByText('工具调用：正在执行合成命令',{exact:true}).waitFor();
 ok((await card.locator('>button').innerText()).includes('状态待核实'),'状态未知时不根据旧 ended 隐藏记录');
 card=await open({controlState:'stopping',run:{...target.run,status:'succeeded',phase:'ended',summary:null}});
 await card.getByText('工具调用：正在执行合成命令',{exact:true}).waitFor();
 ok((await card.locator('>button').innerText()).includes('停止待确认'),'停止待确认不凭 ended 隐藏记录');
 failProgress=true;
 card=await open({run:{...target.run,status:'succeeded',phase:'ended',summary:null}});
 await card.getByText('公开进展读取失败，可收起后重新展开重试。',{exact:true}).waitFor();
 ok(true,'已结束但读取失败仍显示重试提示');failProgress=false;
 output=undefined;card=await open({});await card.getByText('尚无可确认的公开进展。',{exact:true}).waitFor();
 ok(true,'未结束且无进展仍明确说明');
 await page.setViewportSize({width:320,height:844});
 card=await open({run:{...target.run,status:'succeeded',phase:'ended',summary:'合成的已记录说明'}});
 await card.getByText('已记录说明（非实时进展）：合成的已记录说明',{exact:true}).waitFor();
 ok(await page.evaluate(()=>document.documentElement.scrollWidth===320),'320px 展开与刷新无横向溢出');
 if(destination)await page.screenshot({path:destination+'/presentation-320.png',animations:'disabled'});
 await page.unroute('**/api/tasks');await page.unroute('**/api/tasks/*/progress');
 ok(errors.length===0,'展示精简所有场景无页面异常');
 return {checksPassed:checks.length,checks,errors};
}

export default async function inlineTaskRows(page,{destination}={}){
 const checks=[],metrics=[],errors=[];
 const ok=(value,name)=>{assert.ok(value,name);checks.push(name);};
 page.on('pageerror',e=>errors.push(e.message));
 const trigger=page.locator('#task-status-trigger'),dialog=page.getByRole('dialog',{name:'工作状态卡片'});
 const card=name=>dialog.getByRole('button',{name:new RegExp(name)}).locator('..');
 const toggle=name=>card(name).locator('>button');
 const ready=async()=>{await trigger.locator('[data-count="working"]').waitFor();};
 const open=async()=>{await ready();await trigger.click();await dialog.waitFor();};
 const collapsed=async()=>{await open();ok(await dialog.locator('[data-slot="task-status-row"]').count()===4,'四类根事项仅挂载四个紧凑任务行');};
 const capture=async name=>{if(destination)await page.screenshot({path:destination+'/'+name+'.png',animations:'disabled'});};
 await page.reload();await ready();
 const original=await page.evaluate(async()=>await(await fetch('/api/tasks')).json());
 await collapsed();
 ok(await dialog.locator('[data-item-row="true"]').count()===4,'全部根事项采用同一种紧凑行，单 Worker 与事项合并');
 ok(await dialog.locator('[data-slot="task-status-row"]>button[aria-expanded="false"]').count()===4,'根事项初次全部收起');
 ok(await card('停止旧版市场调研').getAttribute('data-state')==='waiting'&&await card('活动资料整理').getAttribute('data-state')==='waiting','停止未确认和状态未知都是 waiting');
 ok((await toggle('停止旧版市场调研').innerText()).includes('停止待确认')&&(await toggle('活动资料整理').innerText()).includes('状态待核实'),'未知与停止中文事实保持');
 ok((await trigger.innerText()).includes('3 工作中')&&(await trigger.innerText()).includes('1 完成')&&(await trigger.innerText()).includes('1 待处理'),'未知、停止和根汇总不新增计数');
 ok(await dialog.locator('[data-slot="card"]').count()===0,'没有旧 Card 或 UnknownWorker 分支');
 ok(await dialog.locator('[data-slot="task-card"]').count()===0,'总览不再嵌套独立 TaskCard');
 // Shared TaskCard accessibility remains valid for other consumers of the scoped CSS.
 await page.keyboard.press('Tab');
 const shared=await dialog.evaluate(el=>{
  const host=document.createElement('div'),button=document.createElement('button');host.className='homer-task-status';host.dataset.slot='task-card';button.textContent='合成共享组件';host.append(button);el.append(host);button.focus();
  const style=getComputedStyle(button),value={minHeight:parseFloat(style.minHeight),outline:style.outlineStyle,outlineWidth:style.outlineWidth};host.remove();return value;
 });
 ok(!Number.isFinite(shared.minHeight)||shared.minHeight<44,'官方 TaskCard 不再叠加宿主 44px 最小高度');
 ok(shared.outline!=='none'&&shared.outlineWidth==='2px','保留其他 TaskCard 消费者的共享焦点描边');

 await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
 ok(await trigger.evaluate(e=>e===document.activeElement),'Escape 关闭并回到顶部入口');
 for(const width of [320,390,704,1440]){
  await page.setViewportSize({width,height:width<600?844:1000});await collapsed();
  await page.waitForTimeout(250); // Read the completed Radix transition, not its scaled first frame.
  const sizes=await dialog.locator('[data-slot="task-status-row"]>button').evaluateAll(nodes=>nodes.map(n=>({height:n.getBoundingClientRect().height,width:n.getBoundingClientRect().width})));
  const bounds=await dialog.evaluate(e=>({x:e.getBoundingClientRect().x,right:e.getBoundingClientRect().right,viewport:innerWidth,document:document.documentElement.scrollWidth,scroll:e.scrollWidth,width:e.clientWidth}));
  ok(sizes.every(s=>s.height>=44&&s.width>=44),width+'px 四种根事项同为至少 44px 点击区');
  ok(Math.max(...sizes.map(s=>s.height))-Math.min(...sizes.map(s=>s.height))<0.5,width+'px 四种根事项行高一致');
  ok(bounds.x>=0&&bounds.right<=width&&bounds.document===width&&bounds.scroll<=bounds.width,width+'px 浮层及页面无横向溢出');
  const rowStyle=await toggle('采购选型方案').evaluate(el=>({font:getComputedStyle(el.querySelector('.truncate')).fontSize,icon:parseFloat(getComputedStyle(el.querySelector('svg')).width)}));
  ok(bounds.width<=384&&rowStyle.font==='13px'&&rowStyle.icon===12,width+'px 保持紧凑宽度、13px 标题和 12px 图标 '+JSON.stringify({bounds,rowStyle}));
  metrics.push({width,sizes,bounds});await capture((width<600?'mobile':'desktop')+'-'+width+'-collapsed');
  await toggle('采购选型方案').focus();await page.keyboard.press('Space');
  ok(await toggle('采购选型方案').getAttribute('aria-expanded')==='true',width+'px 键盘打开多 Worker 根事项');
  await page.keyboard.press('Tab');
  ok(await card('采购选型方案').locator('[data-worker-id] > [data-slot="task-status-row"] > button').first().evaluate(el=>el===document.activeElement),width+'px Tab 进入已展开子层');
  await toggle('采购选型方案').focus();await page.keyboard.press('Enter');
  ok(await toggle('采购选型方案').getAttribute('aria-expanded')==='false'&&await toggle('采购选型方案').evaluate(el=>el===document.activeElement),width+'px Enter 收起并保留入口焦点');
  await page.keyboard.press('Tab');
  ok(await dialog.locator('[data-item-row] > button').evaluateAll(nodes=>nodes.slice(1).includes(document.activeElement)),width+'px 收起后 Tab 跳过已卸载子层');
  await toggle('采购选型方案').focus();await page.keyboard.press('Enter');
  ok(await toggle('采购选型方案').getAttribute('aria-expanded')==='true',width+'px Enter 原地展开');
  ok(await dialog.getByRole('button',{name:/资料整理 Worker/}).count()===1&&await dialog.getByRole('button',{name:/税费资料 Worker/}).count()===1,width+'px 同时显示直属 Worker');
  ok(await card('采购选型方案').locator('[data-worker-id] > [data-slot="task-status-row"] > button[aria-expanded="false"]').count()===4,width+'px Worker 独立默认收起');
  await toggle('成本分析 Worker').click();await toggle('税费资料 Worker').waitFor();
  ok(await toggle('税费资料 Worker').getAttribute('aria-expanded')==='false',width+'px 同级 Worker 独立收起');
  await capture((width<600?'mobile':'desktop')+'-'+width+'-nested');
  await toggle('税费资料 Worker').click();await card('税费资料 Worker').getByText(/已整理税费参考说明/).waitFor();
  const nesting=await card('税费资料 Worker').evaluate(el=>({child:el.getBoundingClientRect().left,parent:[...document.querySelectorAll('[data-worker-id]')].find(row=>row.textContent.includes('成本分析 Worker')).getBoundingClientRect().left,scroll:document.querySelector('.status-list').scrollWidth,width:document.querySelector('.status-list').clientWidth}));
  ok(nesting.child===nesting.parent&&nesting.scroll<=nesting.width,width+'px 同级 Worker 平面展开且列表无横向溢出');
  ok(await page.getByRole('dialog').count()===1,width+'px 详情留在总览内，不增加第二层弹窗');
  await capture((width<600?'mobile':'desktop')+'-'+width+'-child-expanded');
  await toggle('采购选型方案').click();await toggle('采购选型方案').click();
  ok(await toggle('成本分析 Worker').getAttribute('aria-expanded')==='false'&&await toggle('税费资料 Worker').getAttribute('aria-expanded')==='false',width+'px 收起重开根卡后直属 Worker 回到收起');
  await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
 }
 await open();await toggle('采购选型方案').click();await toggle('资料整理 Worker').click();
 await card('资料整理 Worker').locator('[data-slot="agent-plan"]').waitFor();
 await toggle('成本分析 Worker').click();await toggle('税费资料 Worker').click();
 await card('税费资料 Worker').getByText(/已整理税费参考说明/).waitFor();
 await toggle('成本分析 Worker').evaluate(e=>window.__sameStatusButton=e);
 const automaticRead=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/tasks');await restoreStatusVisibility(page);await automaticRead;
 ok(await toggle('成本分析 Worker').evaluate(e=>e===window.__sameStatusButton&&e.getAttribute('aria-expanded')==='true'),'普通刷新保持准确身份、同一个 DOM 及展开选择');
 ok(await toggle('税费资料 Worker').getAttribute('aria-expanded')==='true','普通刷新不收起正在阅读的子层');
 await page.emulateMedia({reducedMotion:'reduce'});
 ok(await toggle('成本分析 Worker').locator('.animate-spin').evaluate(e=>getComputedStyle(e).animationName==='none'),'reduced-motion 关闭运行图标动画');
 await page.emulateMedia({colorScheme:'dark'});await page.setViewportSize({width:390,height:844});
 ok(await dialog.evaluate(el=>getComputedStyle(el).getPropertyValue('--background').trim()==='0 0% 3.9%'),'浮层沿既有局部暗色主题');
 await capture('mobile-390-dark-expanded');await page.emulateMedia({colorScheme:'light'});await page.setViewportSize({width:1440,height:1000});
 await toggle('采购选型方案').focus();await page.keyboard.press('ArrowDown');
 ok(await toggle('采购选型方案').evaluate(e=>getComputedStyle(e).outlineStyle!=='none'),'键盘焦点可见');
 await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});

 // Existing exact-ID interaction and result entry points remain in their owners.
 await open();await toggle('采购选型方案').click();await toggle('收费数据 Worker').click();
 await card('收费数据 Worker').getByRole('button',{name:'前往原待答卡'}).click();await dialog.waitFor({state:'hidden'});
 await page.waitForFunction(()=>document.activeElement?.id==='task-interaction-status-approval');
 ok(true,'有效待答沿原 interaction 身份定位并返回准确焦点');
 await page.getByRole('button',{name:/九月供应商比较报告.md/}).click();
 await page.getByRole('button',{name:'关闭 Canvas'}).waitFor();
 ok((await page.locator('.canvas-panel').innerText()).includes('九月供应商比较报告'),'原成果继续通过授权 Canvas 读取');
 await page.getByRole('button',{name:'关闭 Canvas'}).click();

 let snapshot=original;
 const replace=async value=>{snapshot=value;await page.reload();await ready();};
 await page.route('**/api/tasks',route=>route.fulfill({json:snapshot}));
 const change=(goal,fn)=>({...original,tasks:original.tasks.map(t=>t.goal===goal?fn(t):t)});
 // Out-of-order completion keeps an active sibling and a valid approval.
 await replace(change('税费资料 Worker',t=>({...t,run:{...t.run,status:'succeeded',phase:'ended'},result:{id:'tax-result',state:'offered',outcome:'succeeded'}})));
 await open();await toggle('采购选型方案').click();await toggle('成本分析 Worker').click();
 ok((await trigger.innerText()).includes('2 工作中')&&(await trigger.innerText()).includes('2 完成')&&(await trigger.innerText()).includes('1 待处理'),'同级 Worker 先结束时，运行兄弟及有效批准独立计数');
 ok(await card('税费资料 Worker').getAttribute('data-state')==='done'&&(await toggle('税费资料 Worker').innerText()).includes('执行已结束 · 待验收'),'候选执行结束仅表示待验收');
 ok(await card('采购选型方案').getAttribute('data-state')==='working','同级 Worker 成功不将根事项标为已交付');
 await replace(change('成本分析 Worker',t=>({...t,rework:true})));
 await open();await toggle('采购选型方案').click();ok((await toggle('成本分析 Worker').innerText()).includes('返工中'),'返工使用同一 Worker 身份和明确中文状态');

 for(const [status,state,label]of [['failed','failed','执行失败'],['cancelled','cancelled','已取消'],['interrupted','done','执行已中断']]){
  await replace(change('停止旧版市场调研',t=>({...t,controlState:'normal',state:'settled',outcome:status,run:{...t.run,status,phase:'ended'}})));
  await open();ok(await card('停止旧版市场调研').getAttribute('data-state')===state,status+' 映射准确官方状态');
  ok((await toggle('停止旧版市场调研').innerText()).includes(label),status+' 保留具体中文事实');
  ok((await trigger.innerText()).includes('1 完成')&&(await trigger.innerText()).includes('1 待处理'),status+' 不被图标加入成功或待处理统计');
 }
 await replace(change('资料整理 Worker',t=>({...t,run:{...t.run,status:'awaiting_review',phase:'ended'},result:{id:'partial-result',state:'offered',outcome:'partial'}})));
 await open();await toggle('采购选型方案').click();ok((await toggle('资料整理 Worker').innerText()).includes('部分成果'),'部分成果保真，未冒称验收或正式交付');

 // Same name is not identity. Current run/segment changes must reset only that card.
 await replace(original);await open();await toggle('采购选型方案').click();await toggle('资料整理 Worker').click();
 await card('资料整理 Worker').locator('[data-slot="agent-plan"]').waitFor();
 snapshot=change('资料整理 Worker',t=>({...t,run:{...t.run,threadId:t.run.threadId+'-rebound'}}));
 await restoreStatusVisibility(page);
 await page.waitForFunction(()=>[...document.querySelectorAll('[data-slot="task-status-row"]>button')].some(e=>e.textContent.includes('资料整理 Worker')&&e.getAttribute('aria-expanded')==='false'));
 ok(await toggle('采购选型方案').getAttribute('aria-expanded')==='true','线程身份变化只收起目标 Worker，保留根层');
 await toggle('资料整理 Worker').click();await card('资料整理 Worker').getByText('尚无可确认的公开进展。',{exact:true}).waitFor();
 ok(await card('资料整理 Worker').locator('[data-slot="agent-plan"]').count()===0,'线程重绑定不使用旧公开计划');

 // Navigation revalidates the latest exact identity even if the visible record is older.
 await replace(original);await open();await toggle('采购选型方案').click();await toggle('收费数据 Worker').click();
 snapshot=change('收费数据 Worker',t=>({...t,pendingUser:0,pendingUsers:[]}));
 await card('收费数据 Worker').getByRole('button',{name:'前往原待答卡'}).click();
 await dialog.getByText(/这项待答已变化或暂不可读，请收起后重新打开工作状态核对。/).waitFor();ok(true,'过期待答拒绝导航并指向现有重开恢复入口');
 await page.keyboard.press('Escape');await open();
 ok(await dialog.getByText(/这项待答已变化或暂不可读/).count()===0,'按提示重开后清除旧定位错误');

 await page.setViewportSize({width:320,height:844});
 await replace({...original,tasks:original.tasks.map(t=>({...t,title:'保留准确事项身份及完整中文说明的很长名称'.repeat(2)}))});
 await open();ok(await page.evaluate(()=>document.documentElement.scrollWidth===320),'320px 长中文不扩张页面');
 ok((await dialog.locator('[data-item-row]').first().getAttribute('aria-label')).length>30,'长中文名称保留在可访问标签');
 await replace({tasks:[]});await open();await dialog.getByText('暂无已安排的事项。',{exact:true}).waitFor();
 ok((await trigger.innerText()).includes('0 工作中'),'真正空集合可以明确显示零');

 // First read is unknown until the server answers; failures retain known facts.
 await page.unroute('**/api/tasks');
 let held=[];await page.route('**/api/tasks',route=>{held.push(route);});
 await page.reload();await trigger.waitFor();ok(await trigger.locator('[data-count]').count()===0,'首次读取未返回时不提前报全零');
 await trigger.click();await dialog.getByText('正在读取任务记录…',{exact:true}).waitFor();
 for(const r of held)await r.fulfill({status:503,body:'synthetic_failure'});held=[];
 await dialog.getByText('任务记录读取失败，请重试。',{exact:true}).waitFor();ok(true,'首次读取失败区别于真实空集合');
 await page.unroute('**/api/tasks');await page.reload();await ready();await open();
 await page.route('**/api/tasks',r=>r.fulfill({status:503,body:'synthetic_failure'}));
 await restoreStatusVisibility(page);await dialog.getByText(/任务记录暂时无法读取/).waitFor();
 ok(await dialog.locator('[data-item-row]').count()===4&&(await trigger.innerText()).includes('上次'),'刷新失败保留四个已知事项与上次计数');
 await page.unroute('**/api/tasks');await page.keyboard.press('Escape');
 ok(errors.length===0,'全部交互无页面异常');
 return {checksPassed:checks.length,checks,metrics,errors};
}

export async function taskStatusLateResponses(page){
 const checks=[],errors=[];const ok=(value,name)=>{assert.ok(value,name);checks.push(name);};page.on('pageerror',e=>errors.push(e.message));
 // Reuse the fixture's real SSE transport while injecting only a synthetic
 // scope notification. The owners and their authorization stay unchanged.
 await page.addInitScript(()=>{
  const original=window.fetch;
  window.fetch=async(...args)=>{
   const response=await original(...args);
   if(String(args[0]).endsWith('/api/history/events')&&response.body){
    let buffer='',latest;const decoder=new TextDecoder(),encoder=new TextEncoder();
    const transform=new TransformStream({transform(chunk,controller){
     buffer+=decoder.decode(chunk,{stream:true});const events=buffer.split('\n\n');buffer=events.pop()??'';
     for(const event of events){const line=event.split('\n').find(line=>line.startsWith('data: '));if(line)try{latest=JSON.parse(line.slice(6));}catch{}}
     window.__switchStatusScope=kind=>controller.enqueue(encoder.encode('event: state\ndata: '+JSON.stringify(kind==='thread'?{...latest,threadId:'synthetic-next-thread'}:{...latest,history:{...latest.history,readEpoch:latest.history.readEpoch+'-next'}})+'\n\n'));
     controller.enqueue(chunk);
    }});
    return new Response(response.body.pipeThrough(transform),{status:response.status,headers:response.headers});
   }
   return response;
  };
 });
 await page.reload();const trigger=page.locator('#task-status-trigger'),dialog=page.getByRole('dialog',{name:'工作状态卡片'});
 await trigger.locator('[data-count="working"]').waitFor();const original=await page.evaluate(async()=>await(await fetch('/api/tasks')).json());
 const root=original.tasks.find(t=>t.title==='采购选型方案'),research=original.tasks.find(t=>t.goal==='资料整理 Worker');
 const oldProgress=await page.evaluate(async id=>await(await fetch('/api/tasks/'+id+'/progress')).json(),root.id);
 await trigger.click();await dialog.getByRole('button',{name:/采购选型方案/}).click();
 let held=[],started;const request=new Promise(resolve=>{started=resolve;});
 await page.route('**/api/tasks/*/progress',route=>{held.push(route);started();});
 await dialog.getByRole('button',{name:/资料整理 Worker/}).click();await request;
 await dialog.getByText('正在读取公开进展…',{exact:true}).waitFor();
 const changed={...original,tasks:original.tasks.map(t=>t.id===research.id?{...t,headVersion:t.headVersion+1,currentRunId:t.currentRunId+'-next',run:{...t.run,id:t.currentRunId+'-next',contractVersion:t.headVersion+1,epoch:t.run.epoch+1,threadId:'next-worker-thread',turnId:'next-worker-turn'}}:t)};
 await page.route('**/api/tasks',r=>r.fulfill({json:changed}));
 await restoreStatusVisibility(page);
 await page.waitForFunction(()=>[...document.querySelectorAll('[data-slot="task-status-row"]>button')].some(b=>b.textContent.includes('资料整理 Worker')&&b.getAttribute('aria-expanded')==='false'));
 ok(true,'版本/Run/epoch/线程变化重置目标 Worker');
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 // Overview identity changes collapse the old card without rereading its progress.
 assert.equal(held.length,1,'新 Run 的卡片收起后不沿旧展开标记读取进展');
 checks.push('新 Run 的卡片收起后不沿旧展开标记读取进展');
 for(const route of held)await route.fulfill({json:oldProgress}).catch(()=>{});held=[];await page.unroute('**/api/tasks/*/progress');
 await dialog.getByRole('button',{name:/资料整理 Worker/}).click();await dialog.getByText('尚无可确认的公开进展。',{exact:true}).waitFor();
 ok(await dialog.locator('[data-slot="agent-plan"]').count()===0,'旧 Run 的迟到公开计划不能进入新身份');
 await page.unroute('**/api/tasks');await page.keyboard.press('Escape');await page.reload();await trigger.locator('[data-count="working"]').waitFor();await trigger.click();
 await dialog.getByRole('button',{name:/采购选型方案/}).click();await dialog.getByRole('button',{name:/收费数据 Worker/}).click();
 const navigationRequest=new Promise(resolve=>{started=resolve;});
 await page.route('**/api/tasks',route=>{held.push(route);started();});
 await dialog.getByRole('button',{name:'前往原待答卡'}).click();await navigationRequest;
 await page.evaluate(()=>window.__switchStatusScope('epoch'));await dialog.waitFor({state:'hidden'});
 ok(true,'读取代际变化关闭旧浮层并中止旧待答导航');
 for(const route of held)await route.fulfill({json:original}).catch(()=>{});held=[];
 await page.unroute('**/api/tasks');await trigger.locator('[data-count="working"]').waitFor();await trigger.click();
 ok(await dialog.locator('[data-slot="task-status-row"]>button[aria-expanded="false"]').count()===4,'新线程重新打开时所有根事项收起');
 ok(await dialog.getByText(/这项待答已变化或暂不可读/).count()===0,'旧线程迟到导航不污染新线程提示');
 await page.keyboard.press('Escape');await page.reload();await trigger.locator('[data-count="working"]').waitFor();await trigger.click();
 await dialog.getByRole('button',{name:/采购选型方案/}).click();await dialog.getByRole('button',{name:/收费数据 Worker/}).click();
 const disconnectedNavigation=new Promise(resolve=>{started=resolve;});
 await page.route('**/api/tasks',route=>{held.push(route);started();});
 await dialog.getByRole('button',{name:'前往原待答卡'}).click();await disconnectedNavigation;
 await page.evaluate(()=>window.__switchStatusScope('thread'));
 await page.getByText('主对话标识发生变化，已暂停发送。请检查服务配置。',{exact:true}).waitFor();
 await page.waitForFunction(()=>document.querySelector('#task-status-trigger').textContent.includes('上次'));
 ok(await dialog.getByRole('button',{name:'前往原待答卡'}).isDisabled(),'主对话线程变动沿原 owner 暂停连接并禁用旧入口');
 for(const route of held)await route.fulfill({json:original}).catch(()=>{});held=[];await page.unroute('**/api/tasks');
 ok(await dialog.getByText(/这项待答已变化或暂不可读/).count()===0,'断连中止在途导航，迟到响应不再调用旧待答入口');
 ok(errors.length===0,'迟到响应和线程切换无页面异常');await page.keyboard.press('Escape');
 return {checksPassed:checks.length,checks,errors};
}

export async function taskStatusCachedProgress(page){
 const checks=[];await page.reload();const trigger=page.locator('#task-status-trigger');
 await trigger.locator('[data-count="working"]').waitFor();
 const original=await page.evaluate(async()=>await(await fetch('/api/tasks')).json());
 await trigger.click();const dialog=page.getByRole('dialog',{name:'工作状态卡片'});
 await dialog.getByRole('button',{name:/采购选型方案/}).click();await dialog.getByRole('button',{name:/资料整理 Worker/}).click();
 const plan=dialog.locator('[data-slot="agent-plan"]');await plan.waitFor();
 let failures=0,revisionRequestStarted;const revisionRequest=new Promise(resolve=>{revisionRequestStarted=resolve;});
 await page.route('**/api/tasks/*/progress',route=>{if(++failures===1)revisionRequestStarted();return route.fulfill({status:503,body:'synthetic_progress_failure'});});
 await page.route('**/api/tasks',route=>route.fulfill({json:{...original,progressRevision:(original.progressRevision??0)+1}}));
 await restoreStatusVisibility(page);
 await revisionRequest;
 await dialog.getByText('公开进展读取失败，可收起后重新展开重试。',{exact:true}).waitFor();
 assert.equal(await plan.count(),1,'版本通知后的读取失败必须保留同一执行身份已确认的计划');
 checks.push('进展版本变化后读取失败仍保留同一身份的已确认计划');
 await page.unroute('**/api/tasks/*/progress');await page.unroute('**/api/tasks');
 const research=dialog.getByRole('button',{name:/资料整理 Worker/});await research.click();await research.click();await plan.waitFor();
 checks.push('读取失败后仍可收起重开恢复读取');await page.keyboard.press('Escape');
 return {checksPassed:checks.length,checks};
}
