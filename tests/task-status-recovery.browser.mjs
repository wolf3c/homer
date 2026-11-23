import {restoreStatusVisibility} from './task-status-unified.browser.mjs';
// Run against tests/task-status-browser-fixture.mjs only. Pass the default
// export as a function to Playwright CLI run-code; no business writes.
export default async function taskStatusRecovery(page){
 await page.setViewportSize({width:1100,height:1000});
 const checks=[],errors=[];const ok=(value,label)=>{if(!value)throw Error(label);checks.push(label);};page.on('pageerror',e=>errors.push(e.message));
 await page.context().setOffline(false);
 await page.addInitScript(()=>{
  const original=window.fetch;
  window.fetch=async(...args)=>{
   const response=await original(...args);
   if(String(args[0]).endsWith('/api/history/events')&&response.body){
    const transform=new TransformStream({transform(chunk,controller){window.__breakStatusStream=()=>controller.error(Error('synthetic_stream_disconnected'));controller.enqueue(chunk);}});
    return new Response(response.body.pipeThrough(transform),{status:response.status,headers:response.headers});
   }
   return response;
  };
 });
 await page.reload();
 const trigger=page.locator('#task-status-trigger');
 await trigger.click();
 const dialog=page.getByRole('dialog',{name:'工作状态卡片'});
 const purchase=dialog.getByText('采购选型方案',{exact:true});
 await purchase.waitFor();
 await page.evaluate(()=>window.__breakStatusStream());
 await dialog.getByText(/显示上次记录/).waitFor();
 ok(await purchase.isVisible()&&await dialog.getByRole('button',{name:'重试',exact:true}).count()===0,'断线保留上次事项且不显示错误重试');
 await dialog.getByText(/显示上次记录/).waitFor({state:'hidden',timeout:20000});
 ok(await purchase.isVisible(),'重连后恢复事项读取');
 const held=[];
 await page.clock.install();
 let overviewStarted;const overviewRequest=new Promise(resolve=>{overviewStarted=resolve;});
 await page.route('**/api/tasks',route=>{held.push(route);overviewStarted();});await restoreStatusVisibility(page);await page.clock.runFor(1);await overviewRequest;await page.clock.fastForward(15050);await dialog.getByText(/任务记录暂时无法读取/).waitFor();ok(await dialog.locator('[data-todo-id]').count()===3,'总览读取超时保留已有事项');ok(await dialog.getByRole('button',{name:'重试',exact:true}).isEnabled(),'总览超时后就地重试可用');
 for(const r of held)await r.abort().catch(()=>{});await page.unroute('**/api/tasks');await page.clock.resume();await dialog.getByRole('button',{name:'重试',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#task-status-panel').textContent.includes('显示上次记录'));ok(errors.length===0,'恢复路径无页面异常');await page.keyboard.press('Escape');return {checksPassed:checks.length,checks,errors};
}
