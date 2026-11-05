import {cloneTask,changeWorker} from './task-status-browser-data.mjs';
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
 await page.reload();const trigger=page.locator('#task-status-trigger');await trigger.locator('[data-count="working"]').waitFor();await trigger.click();const dialog=page.getByRole('dialog',{name:'工作状态卡片'}),research=dialog.getByRole('button',{name:/资料整理 Worker/}).locator('..');
 await dialog.getByRole('button',{name:/采购选型方案/}).click();
 let attempts=0,held=[];await page.route('**/api/tasks/*/progress',route=>{attempts++;if(attempts===1){held.push(route);return;}return route.continue();});
 await research.locator('>button').click();await research.getByText('正在读取公开进展…',{exact:true}).waitFor();
 await page.evaluate(()=>window.__breakStatusStream());await page.waitForFunction(()=>document.querySelector('#task-status-trigger').title.includes('上次'),{},{timeout:15000});ok(true,'断线中止读取并标记上次记录');
 ok(await dialog.getByRole('button',{name:'重试',exact:true}).count()===0&&await dialog.getByText(/任务记录暂时无法读取/).count()===0,'断线不冒称总览读取失败或提供错误重试');
 for(const r of held)await r.abort().catch(()=>{});held=[];
 await research.locator('[data-slot="agent-plan"]').waitFor({timeout:20000});ok(attempts>=2,'重连后未完成读取会自动重试，不保留 loading 缓存');ok(await research.locator('>button').getAttribute('aria-expanded')==='true','断线恢复保留已展开卡片');
 await page.unroute('**/api/tasks/*/progress');
 const snapshot=await page.evaluate(async()=>await(await fetch('/api/tasks')).json());
 await page.route('**/api/tasks',route=>route.fulfill({json:changeWorker(snapshot,'资料整理 Worker',w=>({...w,run:{...w.run,threadId:w.run.threadId+'-rebound'}}))}));
 await restoreStatusVisibility(page);
 await page.waitForFunction(()=>[...document.querySelectorAll('[data-worker-id] > [data-slot="task-status-row"] > button')].some(b=>b.textContent.includes('资料整理 Worker')&&b.getAttribute('aria-expanded')==='false'));
 ok(true,'即使 turnId 未变，threadId 变化也重置展开身份');
 await research.locator('>button').click();await research.getByText('尚无可确认的公开进展。',{exact:true}).waitFor();ok(await research.locator('[data-slot="agent-plan"]').count()===0,'线程重绑定不复用旧计划');
 await page.unroute('**/api/tasks');await page.keyboard.press('Escape');await page.reload();await trigger.locator('[data-count="working"]').waitFor();await trigger.click();
 await dialog.getByRole('button',{name:/采购选型方案/}).click();
 await page.clock.install();await page.route('**/api/tasks/*/progress',route=>{held.push(route);});await research.locator('>button').click();await research.getByText('正在读取公开进展…',{exact:true}).waitFor();await page.clock.fastForward(15050);await research.getByText('公开进展读取失败，可收起后重新展开重试。',{exact:true}).waitFor();ok(true,'公开进展超时结束等待，明确可重试');
 for(const r of held)await r.abort().catch(()=>{});held=[];await page.unroute('**/api/tasks/*/progress');await research.locator('>button').click();await research.locator('>button').click();await research.locator('[data-slot="agent-plan"]').waitFor();ok(true,'超时后收起重开可恢复读取');
 let overviewStarted;const overviewRequest=new Promise(resolve=>{overviewStarted=resolve;});
 await page.route('**/api/tasks',route=>{held.push(route);overviewStarted();});await restoreStatusVisibility(page);await page.clock.runFor(1);await overviewRequest;await page.clock.fastForward(15050);await dialog.getByText(/任务记录暂时无法读取/).waitFor();ok(await dialog.locator('section').count()===4,'总览读取超时保留已有事项');ok(await dialog.getByRole('button',{name:'重试',exact:true}).isEnabled(),'总览超时后就地重试可用');
 for(const r of held)await r.abort().catch(()=>{});await page.unroute('**/api/tasks');await page.clock.resume();await dialog.getByRole('button',{name:'重试',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#task-status-trigger').title.includes('上次'));ok(errors.length===0,'恢复路径无页面异常');await page.keyboard.press('Escape');return {checksPassed:checks.length,checks,errors};
}

export async function taskStatusBatches(page){
 let progressReads=0;const countProgress=request=>{if(new URL(request.url()).pathname.endsWith('/progress'))progressReads++;};page.on('request',countProgress);
 await page.setViewportSize({width:390,height:844});await page.reload();await page.locator('#task-status-trigger [data-count="working"]').waitFor();const original=await page.evaluate(async()=>await(await fetch('/api/tasks')).json());
 const tasks=[];for(let n=0;n<250;n++)for(const t of original.tasks)tasks.push(cloneTask(t,'-'+n));
 await page.route('**/api/tasks',r=>r.fulfill({json:{...original,tasks}}));await page.reload();const trigger=page.locator('#task-status-trigger');await page.getByRole('button',{name:'工作状态，250 个任务工作中',exact:true}).waitFor();
 await page.evaluate(()=>window.__renderStart=performance.now());await trigger.click();const dialog=page.getByRole('dialog',{name:'工作状态卡片'});await dialog.waitFor();const result=await page.evaluate(async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return {openToFrameMs:performance.now()-window.__renderStart,sections:document.querySelectorAll('[data-todo-id]').length,domNodes:document.querySelectorAll('*').length};});
 if(result.sections!==750)throw Error('all unsettled Tasks must remain visible before the settled-history batch');
 const more=dialog.getByRole('button',{name:/显示更多事项/});await more.click();
 if(await dialog.locator('[data-todo-id]').count()!==770)throw Error('next matter batch inaccessible');
 if(!await more.evaluate(e=>e===document.activeElement))throw Error('load more loses focus');
 if(progressReads!==0)throw Error('collapsed task rows eagerly read progress');
 result.progressReadsWhileCollapsed=progressReads;page.off('request',countProgress); result.nextBatchSections=770;result.focusKept=true;result.tasks=tasks.length;await page.keyboard.press('Escape');await page.unroute('**/api/tasks');await page.reload();return result;
}

export async function taskStatusLargeCounts(page){
 await page.emulateMedia({reducedMotion:'reduce'});await page.setViewportSize({width:320,height:844});await page.reload();await page.locator('#task-status-trigger [data-count="working"]').waitFor();
 const original=await page.evaluate(async()=>await(await fetch('/api/tasks')).json());
 const tasks=[];for(let n=0;n<1000;n++)for(const t of original.tasks)tasks.push(cloneTask(t,'-'+n));
 await page.route('**/api/tasks',r=>r.fulfill({json:{...original,tasks}}));const start=Date.now();await page.reload();await page.getByRole('button',{name:'工作状态，1000 个任务工作中',exact:true}).waitFor();
 const result=await page.locator('#task-status-trigger').evaluate(e=>({text:e.innerText,viewport:innerWidth,doc:document.documentElement.scrollWidth,rect:e.getBoundingClientRect().toJSON()}));if(result.rect.right>320||result.rect.x<0)throw Error('large counts leave the viewport');result.tasks=tasks.length;result.endToEndMs=Date.now()-start;await page.unroute('**/api/tasks');await page.reload();return result;
}
