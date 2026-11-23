// Real product page served by task-status-browser-fixture.mjs. All mutations
// below replace synthetic read responses; they never call business write APIs.
import assert from 'node:assert/strict';

// Exercise the existing visibility owner, rather than a persistent manual control.
export async function restoreStatusVisibility(page){
 await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
}

export async function taskStatusRefreshRemoval(page,{destination,publish}={}){
 await page.setViewportSize({width:1100,height:1000});
 const checks=[],metrics=[],errors=[],ok=(value,name)=>{assert.ok(value,name);checks.push(name);};
 page.on('pageerror',error=>errors.push(error.message));
 const trigger=page.locator('#task-status-trigger'),dialog=page.getByRole('dialog',{name:'工作状态卡片'});
 await trigger.click();
 await dialog.getByText('采购选型方案',{exact:true}).waitFor();
 const normal={footer:await dialog.locator('.status-footer').count(),refresh:await dialog.getByRole('button',{name:'刷新',exact:true}).count(),retry:await dialog.getByRole('button',{name:'重试',exact:true}).count()};
 await page.route('**/api/tasks',route=>route.fulfill({status:503,body:'synthetic_overview_failure'}));
 await restoreStatusVisibility(page);await dialog.getByText(/任务记录暂时无法读取/).waitFor();
 const retry=dialog.getByRole('button',{name:'重试',exact:true});
 const failed={retry:await retry.count(),items:await dialog.locator('[data-item-row]').count()};
 assert.deepEqual({normal,failed},{normal:{footer:0,refresh:0,retry:0},failed:{retry:1,items:3}},'正常无底栏，真实读取错误提供就地重试并保留已知数据');
 checks.push('正常无底栏，真实读取错误提供就地重试并保留已知数据');
 ok(await retry.isEnabled(),'总览失败可重试');
 const failedRetry=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/tasks'&&r.status()===503);
 await retry.focus();await page.keyboard.press('Enter');await failedRetry;await page.waitForFunction(()=>!document.querySelector('[aria-label="工作状态卡片"] button:disabled'));
 ok(await retry.isVisible()&&await dialog.locator('[data-item-row]').count()===3,'重试失败保留错误及已确认事项');
 await page.unroute('**/api/tasks');
 let held=[],requests=0;
 await page.route('**/api/tasks',route=>{requests++;held.push(route);});
 await retry.focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>document.querySelector('[aria-label="工作状态卡片"] button:disabled')!==null);
 ok(await retry.isDisabled(),'总览重试读取中禁用，保留原按钮');
 await page.keyboard.press('Enter');await page.keyboard.press('Space');
 ok(requests===1,'busy 时键盘重复操作仅发一个请求');
 for(const route of held)await route.continue();await page.unroute('**/api/tasks');
 await retry.waitFor({state:'hidden'});ok(await dialog.locator('[data-item-row]').count()===3,'总览重试成功移除错误及重试入口');
 for(const width of [320,390,1100]){
  await page.setViewportSize({width,height:844});
  await dialog.evaluate(el=>Promise.allSettled(el.getAnimations().map(animation=>animation.finished)));
  const bounds=await dialog.evaluate(el=>{const list=el.querySelector('.status-list'),root=list.parentElement,style=getComputedStyle(root);return {last:list===root.lastElementChild,extraGap:root.getBoundingClientRect().bottom-list.getBoundingClientRect().bottom-parseFloat(style.paddingBottom)-parseFloat(style.borderBottomWidth),right:el.getBoundingClientRect().right,scroll:document.documentElement.scrollWidth};});
  ok(bounds.last&&Math.abs(bounds.extraGap)<1&&bounds.scroll===width&&bounds.right<=width,width+'px 正常列表后无空栏且无横向溢出 '+JSON.stringify(bounds));
  if(destination)await page.screenshot({path:destination+'/refresh-removal-'+width+'-normal.png',animations:'disabled'});
  await page.route('**/api/tasks',route=>route.fulfill({status:503,body:'synthetic_overview_failure'}));
  await restoreStatusVisibility(page);await retry.waitFor();
  if(destination)await page.screenshot({path:destination+'/refresh-removal-'+width+'-failure.png',animations:'disabled'});
  await page.unroute('**/api/tasks');await retry.click();await retry.waitFor({state:'hidden'});
 }
 // State notifications keep using the original snapshot owner.
 if(publish){
  let notifiedReads=0;const count= request=>{if(new URL(request.url()).pathname==='/api/tasks')notifiedReads++;};page.on('request',count);
  const automatic=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/tasks');
  for(let n=0;n<50;n++)publish();await automatic;
  ok(notifiedReads<=2,'50 次连续状态通知沿原读取节流合并');metrics.push({stateNotifications:50,overviewReads:notifiedReads});page.off('request',count);
 }
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
 await page.waitForFunction(()=>document.querySelector('#task-status-panel').textContent.includes('显示上次记录'));
 ok(await retry.count()===0&&await dialog.getByText(/任务记录暂时无法读取/).count()===0,'页面隐藏后的上次记录不冒称读取失败或显示重试');
 const restored=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/tasks');
 await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});await restored;
 await page.waitForFunction(()=>!document.querySelector('#task-status-panel').textContent.includes('显示上次记录'));
 ok(true,'hidden 恢复沿原 owner 自动读取最新总览');
 // No state notification means no poll.
 await page.clock.install();let overviewReads=0,progressReads=0;
 const count=request=>{const path=new URL(request.url()).pathname;if(path==='/api/tasks')overviewReads++;if(path.endsWith('/progress'))progressReads++;};page.on('request',count);
 await page.clock.runFor(3000);const settled=overviewReads;await page.clock.runFor(10000);
 ok(overviewReads===settled&&progressReads===0,'静止十秒无新增轮询，静态事项行不读取详情');
 metrics.push({idleMs:10000,overviewReads:overviewReads-settled,progressReads});
 await page.clock.resume();page.off('request',count);
 await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
 ok(await trigger.evaluate(el=>el===document.activeElement),'关闭后焦点回工作状态入口');
 let firstReadFails=true;await page.route('**/api/tasks',route=>firstReadFails?route.fulfill({status:503,body:'synthetic_first_read_failure'}):route.continue());
 await page.reload();await trigger.click();await dialog.getByRole('status').filter({hasText:'任务记录暂时无法读取，请重试。'}).waitFor();
 ok(await retry.isEnabled()&&await trigger.locator('[data-count]').count()===0,'首次读取失败也有就地重试，不预报全零');
 await retry.focus();firstReadFails=false;await page.keyboard.press('Enter');await dialog.getByText('采购选型方案',{exact:true}).waitFor();await retry.waitFor({state:'hidden'});await page.unroute('**/api/tasks');
 ok(true,'首次总览失败可原位重试恢复');await page.keyboard.press('Escape');
 ok(errors.length===0,'移除底栏及错误恢复无页面异常');
 return {checksPassed:checks.length,checks,metrics,errors};
}
