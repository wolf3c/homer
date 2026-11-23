// Production UI with isolated HTTP/SSE fixtures and synthetic schedule data only.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {composerFixture} from './fixtures/composer-browser-server.mjs';
import {openBrowser} from './helpers/image-zoom-browser.mjs';
const dest=resolve(process.env.HOMER_BROWSER_EVIDENCE),webDir=resolve(process.env.HOMER_COMPONENT_BUILD);mkdirSync(dest,{recursive:true});
const artifact={id:'synthetic-file',title:'原文件.md',messageId:'synthetic-reply',assetId:'asset-00000000-0000-4000-8000-000000000001',revision:1,sha256:'a'.repeat(64)};
const fixture=await composerFixture({webDir,beforeDir:webDir,branding:resolve('assets/branding/odysseus-20261030/homer-odysseus-256.png'),resource:(_req,res)=>{res.writeHead(200,{'Content-Type':'text/markdown','X-Homer-Artifact-Hash':artifact.sha256});res.end('# 原文件\n\n原文件内容保持可预览。');}});
const base={revision:1,trigger:{cron:'0 9 * * *',timeZone:'Asia/Shanghai'},enabled:true,nextFireAt:1794963600000,status:'已启用',timeLabel:'下次投递',timeText:'2026年11月18日 09:00',cadence:'每天 09:00 · Asia/Shanghai',note:''};
const rows=[{...base,scheduleId:'schedule-00000000-0000-4000-8000-000000000001',title:'整理 AI 行业简报'},{...base,scheduleId:'schedule-00000000-0000-4000-8000-000000000002',title:'核对项目进展',trigger:{at:'2026-11-19T07:00:00Z'},cadence:'仅一次 · Asia/Shanghai',timeText:'2026年11月19日 15:00'},{...base,scheduleId:'schedule-00000000-0000-4000-8000-000000000003',title:'已取消的合成安排',enabled:false,status:'已取消后续投递',timeLabel:'后续投递',timeText:'不再投递',note:'已入箱消息不会被撤回。'}];
const text='每天汇总三条 AI 行业进展，说明来源和对项目的影响。\n\n'+('这段较长的合成任务内容用于核对详情滚动，不会创建真实日程。\n').repeat(160)+'完整任务内容尾部';
const checks=[],errors=[];let chrome,failure,exit;
try{
 chrome=await openBrowser(dest,{mockKeychain:true});
 for(const width of [1440,390,320]){
  const context=await chrome.browser.newContext({viewport:{width,height:960}}),page=await context.newPage();page.on('pageerror',error=>errors.push(String(error)));
  let reads=0,detailReads=0,deny=false,paged=false,currentRows=structuredClone(rows),detailText=text,holdDetail,onHeldDetail;
  await page.route('**/api/schedules/read',async route=>{
   const input=route.request().postDataJSON();reads++;
   if(input.view==='detail')detailReads++;
   if(deny)return route.fulfill({status:409,json:{error:'schedule_unavailable'}});
   const common={threadId:'composer-review',readEpoch:input.readEpoch,displayTimeZone:'Asia/Shanghai'};
   if(input.view==='detail'){
    const item={...currentRows.find(x=>x.scheduleId===input.scheduleId),text:detailText};
    if(holdDetail){onHeldDetail();await holdDetail;}
    return route.fulfill({json:{...common,item}});
   }
   const items=paged?(input.offset?[currentRows[1]]:[currentRows[0],currentRows[2]]):currentRows;
   await route.fulfill({json:{...common,items,nextOffset:paged&&!input.offset?2:null}});
  });
  fixture.reset({features:{draftUpload:true,taskOverview:false,previewReferenceCollections:2},artifacts:[artifact],messages:[{id:artifact.messageId,threadId:'composer-review',requestId:'synthetic-request',role:'assistant',text:'已按要求登记安排。后续如需调整，直接告诉我。',status:'completed',createdAt:1700000000000,media:[{...artifact,filename:artifact.title,kind:'file',state:'ready',mime:'text/markdown',size:45}]}]});
  await page.goto(fixture.url);const editor=page.locator('[contenteditable=true]');await editor.waitFor();await editor.fill('把这个改到每天上午十点。');
  await page.getByRole('button',{name:'预览 原文件.md',exact:true}).click();await page.locator('.canvas-markdown').waitFor();
  if(width<=800)await page.getByRole('button',{name:'收起预览',exact:true}).click();
  await page.getByRole('button',{name:'定时任务',exact:true}).click();const detailButton=page.getByRole('button',{name:'查看定时任务详情：整理 AI 行业简报',exact:true});await detailButton.waitFor();
  assert.equal(await page.locator('.canvas-tab').count(),2);
  await page.getByRole('tab',{name:artifact.title,exact:true}).click();await page.locator('.canvas-markdown').waitFor();assert.ok((await page.locator('.canvas-markdown').innerText()).includes('原文件内容保持可预览'));await page.getByRole('tab',{name:'定时任务',exact:true}).click();await detailButton.waitFor();assert.equal(await page.locator('.messages [data-slot=schedule-card]').count(),0);assert.equal(await page.locator('[data-slot=schedule-card]:visible').count(),2);
  await page.screenshot({animations:'disabled',path:join(dest,'center-'+width+'.png')});
  await detailButton.focus();await page.keyboard.press('Enter');const dialog=page.locator('.homer-schedule-detail');await dialog.waitFor();await dialog.locator('[data-slot=spec-sheet]').waitFor();
  await dialog.getByRole('button',{name:'关闭',exact:true}).click({trial:true});
  assert.equal(await dialog.getByRole('button',{name:'关闭',exact:true}).evaluate(node=>{const r=node.getBoundingClientRect();return node.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),true,'close button must be above the narrow Preview');
  assert.equal(await dialog.locator('[data-slot=dialog-title]').innerText(),rows[0].title);assert.equal(await dialog.locator('[data-slot=spec-sheet]>div:last-child>div').last().locator('span').last().textContent(),text);
  await page.keyboard.press('Tab');await page.waitForFunction(()=>document.querySelector('.homer-schedule-detail')?.contains(document.activeElement));await page.keyboard.press('Shift+Tab');await page.waitForFunction(()=>document.querySelector('.homer-schedule-detail')?.contains(document.activeElement));
  await page.screenshot({animations:'disabled',path:join(dest,'detail-'+width+'.png')});
  await dialog.locator('[data-slot=spec-sheet]').evaluate(node=>{node.scrollTop=node.scrollHeight;});assert.ok(await dialog.getByRole('button',{name:'关闭',exact:true}).isVisible());await page.screenshot({animations:'disabled',path:join(dest,'detail-bottom-'+width+'.png')});
  await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});assert.equal(await detailButton.evaluate(node=>node===document.activeElement),true);assert.equal(await page.locator('#canvas-panel').count(),1);
  const before=detailReads;await page.getByRole('button',{name:'在对话中说：整理 AI 行业简报',exact:true}).click();
  await page.getByRole('button',{name:'移除定时任务引用',exact:true}).waitFor();assert.equal(detailReads,before);assert.equal(fixture.received.messages.length,0);assert.equal(await editor.innerText(),'把这个改到每天上午十点。');
  if(width<=800){await page.locator('#canvas-panel').waitFor({state:'hidden'});assert.equal(await editor.evaluate(node=>node.contains(document.activeElement)),true);}
  await page.screenshot({animations:'disabled',path:join(dest,'chip-'+width+'.png')});
  await page.getByRole('button',{name:'移除定时任务引用',exact:true}).click();assert.equal(await page.locator('.schedule-chip').count(),0);assert.equal(await editor.innerText(),'把这个改到每天上午十点。');
  if(width<=800)await page.getByRole('button',{name:'定时任务',exact:true}).click();
  await page.getByRole('button',{name:'在对话中说：整理 AI 行业简报',exact:true}).click();await page.getByRole('button',{name:'移除定时任务引用',exact:true}).waitFor();
  await page.reload();await page.getByRole('button',{name:'移除定时任务引用',exact:true}).waitFor();assert.equal(await editor.innerText(),'把这个改到每天上午十点。');
  await page.getByRole('button',{name:'发送消息',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.schedule-chip'));assert.equal(fixture.received.messages.length,1);assert.equal(fixture.received.messages[0].text,'用户选择的定时任务：'+JSON.stringify({scheduleId:rows[0].scheduleId,label:rows[0].title})+'\n\n把这个改到每天上午十点。');
  await page.getByRole('button',{name:'定时任务',exact:true}).click();await detailButton.waitFor();
  const readBefore=reads;currentRows[0].title='已刷新：整理 AI 行业简报';fixture.update({isRunning:false});await page.getByRole('button',{name:'查看定时任务详情：已刷新：整理 AI 行业简报',exact:true}).waitFor();assert.ok(reads>readBefore);
  paged=true;fixture.update({});await page.getByRole('button',{name:'加载更多',exact:true}).click();
  await page.getByRole('button',{name:'查看定时任务详情：核对项目进展',exact:true}).click();
  await dialog.locator('[data-slot=spec-sheet]').waitFor();
  let releaseRefresh;holdDetail=new Promise(resolve=>{releaseRefresh=resolve;});
  const beforeRefresh=detailReads;
  const nextRead=view=>page.waitForRequest(request=>request.url().endsWith('/api/schedules/read')&&request.postDataJSON().view===view);
  const started=Promise.all([nextRead('detail'),new Promise(resolve=>{onHeldDetail=resolve;})]);fixture.update({});await started;
  detailText='更新后的第二页任务正文';currentRows[1].title='已更新的第二页任务';
  const listRefreshed=nextRead('list');
  await page.evaluate(()=>{for(let i=0;i<3;i++)window.dispatchEvent(new Event('pageshow'));});await listRefreshed;
  assert.equal(detailReads,beforeRefresh+1,'refresh events share the pending detail read');
  holdDetail=undefined;releaseRefresh();await dialog.getByText(detailText,{exact:true}).waitFor();
  assert.equal(detailReads,beforeRefresh+2,'pending refresh runs once after the old detail settles');
  await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
  assert.equal(await page.getByRole('button',{name:'查看定时任务详情：已更新的第二页任务',exact:true}).count(),0);
  const refreshedButton=page.getByRole('button',{name:'查看定时任务详情：已刷新：整理 AI 行业简报',exact:true});
  await refreshedButton.click();await dialog.locator('[data-slot=spec-sheet]').waitFor();
  let releaseDetail;holdDetail=new Promise(resolve=>{releaseDetail=resolve;});
  const detailRequested=Promise.all([nextRead('detail'),new Promise(resolve=>{onHeldDetail=resolve;})]);
  fixture.update({});await detailRequested;
  fixture.unavailable();await dialog.waitFor({state:'hidden'});await refreshedButton.waitFor({state:'hidden'});
  releaseDetail();holdDetail=undefined;fixture.update({});await refreshedButton.waitFor();
  assert.equal(await dialog.count(),0,'a late detail cannot restore the dialog after reconnect');
  await page.locator('.schedule-stopped summary').click();await page.getByRole('button',{name:'查看定时任务详情：已取消的合成安排',exact:true}).waitFor();
  deny=true;fixture.update({isRunning:false});await page.getByText('定时任务未能读取，当前内容尚未确认。',{exact:false}).waitFor();assert.equal(await page.getByText('暂无定时任务',{exact:true}).count(),0);
  await page.getByRole('button',{name:'查看定时任务详情：已刷新：整理 AI 行业简报',exact:true}).click();await page.getByText('该定时任务暂不可用或未能读取。',{exact:true}).waitFor();assert.equal(await page.locator('.homer-schedule-detail [data-slot=spec-sheet]').count(),0);await page.keyboard.press('Escape');
  deny=false;await page.getByRole('button',{name:'重试',exact:true}).click();await page.getByText('定时任务未能读取，当前内容尚未确认。',{exact:false}).waitFor({state:'hidden'});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  checks.push({width,reads,detailReads,fileTabsPreserved:true,detailKeyboardFocus:true,longText:true,chipDraftRestored:true,exactIdSentOnce:true,stateRefresh:true,pagedDetailRefresh:true,disconnectClears:true,failureNotEmpty:true});await context.close();
 }
 assert.deepEqual(errors,[]);
}catch(error){failure=error;}finally{if(chrome)exit=await chrome.finish();await fixture.close();writeFileSync(join(dest,'browser-result.json'),JSON.stringify({checks,errors,exit,failure:failure?String(failure):null},null,2));}
if(failure)throw failure;assert.equal(exit.code,0);assert.equal(exit.watchdog,false);assert.equal(exit.forced,false);console.log(JSON.stringify({checks,exit}));
