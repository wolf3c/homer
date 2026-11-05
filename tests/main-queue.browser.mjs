// Real isolated browser + Homer service. Synthetic data, no native model/account.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {queueBrowserFixture,queueUntil} from './fixtures/message-queue-browser-server.ts';
const {chromium}=await import(pathToFileURL(resolve(process.env.HOMER_PLAYWRIGHT_MODULE)).href);
const dir=resolve(process.env.HOMER_QUEUE_DRAG_DIR??'.codex/scratch/queue-drag-v3/browser');await mkdir(dir,{recursive:true});
let fixture,singleton,app,browser,context,page;
const report={checks:[],errors:[],screenshots:[]};
function check(name,condition){assert.ok(condition,name);report.checks.push(name);}
try{
 fixture=await queueBrowserFixture(resolve(process.env.HOMER_QUEUE_WEB_DIR??'.codex/scratch/queue-drag-v3/candidate/web'),0,dir);app=fixture.app;
 browser=await chromium.launch({channel:'chrome',headless:true});
 context=await browser.newContext({viewport:{width:1440,height:1000},hasTouch:true});page=await context.newPage();
 await context.route('**/*',route=>route.request().url().startsWith(fixture.server.url+'/')||/^(data:|blob:)/.test(route.request().url())?route.continue():route.abort());
 page.on('pageerror',error=>report.errors.push(error.message));
 app.submitMessage({requestId:'web',text:'Web 用户第一条'});
 app.submitMessage({requestId:'wechat',text:'微信用户第二条'},{source:'wechat',persist(){}});
 const actor={agentId:app.store.meta('mainAgentId'),sourceRequestId:'A',threadId:app.store.meta('mainThread')};
 const task=app.tasks.createTask(actor,{operationId:'browser-task',title:'合成调查',goal:'只检查合成材料',authority:{sourceRequestId:'A',description:'只检查合成材料',materials:[],resultIds:[]}});
 const opened=app.tasks.workerOpen(actor,{operationId:'browser-worker',taskId:task.taskId,text:'只检查合成材料'});
 const run=app.tasks.claim(opened.runId);app.tasks.bind(run.id,run.epoch,'worker-thread','worker-turn');
 const worker=app.tasks.endSegment(run.id,run.epoch,{status:'completed',text:'Worker 新进展：材料已核对，日期仍待确认。'},true);
 app.submitMessage({requestId:'telegram',text:'Telegram 用户第三条'},{source:'telegram',persist(){}});
 await page.goto(fixture.server.url);await page.getByRole('textbox',{name:'给荷马发消息'}).waitFor();
 const rows=page.locator('li[data-queue-message]'),workerRow=page.locator(`[data-queue-message="${worker.messageId}"]`);
 const handle=row=>row.getByRole('button',{name:/拖动调整顺序/}),moves=()=>fixture.changes.filter(change=>change.action==='move');
 const keyMove=async(row,keys,confirm='Space')=>{await handle(row).focus();await page.keyboard.press('Space');for(const key of keys){await page.keyboard.press(key);await page.waitForTimeout(120);}await page.keyboard.press(confirm);};
 const unlocked=()=>page.waitForFunction(()=>!sessionStorage.getItem('homer-queue-operation:synthetic-queue-browser'));
 const focused=()=>page.waitForFunction(id=>document.activeElement?.closest('li')?.dataset.queueMessage===id,worker.messageId);
 await workerRow.waitFor({state:'attached'});
 const toggle=page.getByRole('button',{name:'消息队列 · 已加载 5 条',exact:true});
 check('queue starts collapsed',await toggle.getAttribute('aria-expanded')==='false');
 await toggle.click();await handle(workerRow).waitFor();await toggle.click();check('collapsed queue hides rows',await rows.filter({visible:true}).count()===0&&await toggle.getAttribute('aria-expanded')==='false');
 await toggle.click();check('expanded queue restores rows',await rows.filter({visible:true}).count()===5&&await toggle.getAttribute('aria-expanded')==='true');
 check('same mixed order in UI and service',JSON.stringify(await page.locator('li[data-queue-message]').evaluateAll(nodes=>nodes.map(node=>node.dataset.queueMessage)))===JSON.stringify(app.inputs.dispatchPage(undefined,app.webReadEpoch,'all').items.map(item=>item.messageId)));
 check('Worker has no edit or cancel',await workerRow.getByRole('button',{name:/编辑|取消发送/}).count()===0);
 await keyMove(workerRow,['ArrowUp','ArrowUp']);await queueUntil(()=>fixture.order()[0]===worker.messageId);await unlocked();await focused();
 check('keyboard Worker move writes once with exact seven-field message identity',moves().length===1&&Object.keys(moves()[0].input).sort().join(',')==='beforeMessageId,expectedOrderVersion,expectedRevision,messageId,operationId,readEpoch,threadId');
 check('move commits original Worker ID at service head',app.inputs.runnableHead('all').messageId===worker.messageId);
 await page.reload();await page.locator('.queue-toggle').click();await handle(workerRow).waitFor();check('refresh preserves the confirmed service order',fixture.order()[0]===worker.messageId);
 let count=moves().length,order=fixture.order();
 await handle(workerRow).focus();await page.keyboard.press('Space');await page.keyboard.press('ArrowDown');await page.keyboard.press('Escape');await focused();
 check('Escape restores DOM/service order without writes',moves().length===count&&JSON.stringify(fixture.order())===JSON.stringify(order)&&JSON.stringify(await page.locator('li[data-queue-state="queued"]').evaluateAll(nodes=>nodes.map(node=>node.dataset.queueMessage)))===JSON.stringify(order));
 await keyMove(workerRow,[]);await focused();check('same-position confirmation writes zero',moves().length===count);
 for(const confirm of ['Enter','Tab']){await keyMove(workerRow,[],confirm);await focused();check(`${confirm} same-position confirmation writes zero`,moves().length===count);}
 // Mouse moves by the source handle; body and user cancellation stay separate.
 await rows.nth(1).waitFor({state:'visible'});
 const from=await handle(workerRow).boundingBox(),target=await rows.filter({hasText:'Web 用户第一条'}).boundingBox();
 await page.mouse.move(from.x+from.width/2,from.y+from.height/2);await page.mouse.down();await page.mouse.move(target.x+20,target.y+target.height*.8,{steps:12});await page.mouse.up();
 await queueUntil(()=>moves().length===count+1);await unlocked();await focused();check('mouse drop submits once',moves().length===++count);
 // Trusted browser touch input, rather than dispatchEvent or a synthetic DOM.
 const cdp=await context.newCDPSession(page),touchFrom=await handle(workerRow).boundingBox(),touchTarget=await page.locator('li[data-queue-state=queued]').first().boundingBox();
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:touchFrom.x+touchFrom.width/2,y:touchFrom.y+touchFrom.height/2}]});await page.waitForTimeout(300);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:touchTarget.x+20,y:touchTarget.y+5}]});await page.waitForTimeout(150);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await queueUntil(()=>moves().length===count+1);await unlocked();check('trusted touch commits one move',moves().length===++count);
 // An observed arrival invalidates the active scope before an old drop can write.
 await handle(workerRow).focus();await page.keyboard.press('Space');app.submitMessage({requestId:'arrival',text:'Concurrent arrival'});
 await rows.filter({hasText:'Concurrent arrival'}).waitFor();await page.keyboard.press('Escape');check('observed version change cancels the old gesture',moves().length===count);
 // Hold before commit: the first receipt is negative. Timeout retains the exact ID/payload.
 fixture.mode.holdNextMove=true;fixture.mode.loseNextMove=true;fixture.mode.hideOperations=true;
 await keyMove(workerRow,['ArrowDown']);await queueUntil(()=>moves().length===count+1);
 const original=await page.evaluate(()=>sessionStorage.getItem('homer-queue-operation:synthetic-queue-browser'));
 check('unknown operation retains a complete original messageId payload',original!==null&&JSON.parse(original).payload.messageId===worker.messageId);
 await page.waitForTimeout(16000);check('timeout keeps exact unknown identity and no write replay',original===await page.evaluate(()=>sessionStorage.getItem('homer-queue-operation:synthetic-queue-browser'))&&moves().length===count+1);
 fixture.releaseMove();await queueUntil(()=>fixture.order()[0]!==worker.messageId);fixture.mode.hideOperations=false;await page.reload();await unlocked();
 check('automatic original receipt confirms a late committed move without a second write',moves().length===++count);
 for(const width of [320,390,1440])for(const colorScheme of ['light','dark']){
  await page.setViewportSize({width,height:width===1440?1000:844});await page.emulateMedia({colorScheme});
  await page.reload();await workerRow.waitFor({state:'attached'});await page.locator('.queue-toggle').click();await workerRow.waitFor();
  check(`${width}/${colorScheme} no page overflow`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  check(`${width}/${colorScheme} keeps user and Worker rows`,await rows.count()===6&&await workerRow.count()===1);
  const screenshot=`queue-${width}-${colorScheme}.png`;await page.screenshot({path:join(dir,screenshot),animations:'disabled'});report.screenshots.push(screenshot);
 }
 // Page end is not the global end. Drag just one slot near the visible tail.
 for(let n=0;n<165;n++)app.submitMessage({requestId:'page-'+n,text:'Paged message '+n});await page.reload();await page.locator('.queue-toggle').click();
 const first=app.inputs.dispatchPage(undefined,app.webReadEpoch,'all'),tailSource=first.items[78],successor=first.items[79].nextMessageId;
 const tail=page.locator(`[data-queue-message="${tailSource.messageId}"]`);await handle(tail).scrollIntoViewIfNeeded();await keyMove(tail,['ArrowDown']);await queueUntil(()=>moves().length===count+1);await unlocked();
 check('visible page-tail drop sends the unloaded global successor',moves().at(-1).input.beforeMessageId===successor&&successor!==null);count++;
 await page.getByRole('button',{name:'查看下一页'}).click();await page.getByRole('button',{name:'返回待发送首页'}).waitFor();
 const second=app.inputs.dispatchPage(app.inputs.dispatchPage(undefined,app.webReadEpoch,'all').nextCursor,app.webReadEpoch,'all');
 const secondRow=page.locator(`[data-queue-message="${second.items[1].messageId}"]`);await keyMove(secondRow,['ArrowUp']);await queueUntil(()=>moves().length===count+1);await unlocked();
 check('second page uses segment-local indices',moves().at(-1).input.beforeMessageId===second.items[0].messageId);
 // Existing user cancellation remains available after a completed gesture.
 const cancel=page.getByRole('button',{name:/取消发送第/}).first();await cancel.click();await queueUntil(()=>fixture.changes.some(change=>change.action==='cancel'));
 check('normal user cancellation remains available',fixture.changes.filter(change=>change.action==='cancel').length===1);
 // A single item cannot be reordered, but must remain cancellable and accessible.
 singleton=await queueBrowserFixture(resolve(process.env.HOMER_QUEUE_WEB_DIR??'.codex/scratch/queue-drag-v3/candidate/web'),1,dir);
 const singleContext=await browser.newContext(),singlePage=await singleContext.newPage();
 await singlePage.goto(singleton.server.url);await singlePage.locator('.queue-toggle').click();
 const singleCancel=singlePage.getByRole('button',{name:/取消发送第/});await singleCancel.waitFor();
 check('singleton cancel is accessible and enabled',await singleCancel.isEnabled()&&await singleCancel.evaluate(node=>!node.closest('[aria-disabled="true"]')));
 await singleCancel.focus();await singlePage.keyboard.press('Enter');await queueUntil(()=>singleton.changes.some(change=>change.action==='cancel'));
 check('singleton cancel works by keyboard',singleton.changes.filter(change=>change.action==='cancel').length===1);
 await singleContext.close();
 check('no browser JavaScript errors',report.errors.length===0);
}catch(error){report.failure=String(error.stack??error);process.exitCode=1;await page?.screenshot({path:join(dir,'queue-failure.png')}).catch(()=>{});}
finally{await writeFile(join(dir,'browser-results.json'),JSON.stringify(report,null,2)+'\n');await context?.close();await browser?.close();await singleton?.close();await fixture?.close();}
console.log(JSON.stringify(report));
