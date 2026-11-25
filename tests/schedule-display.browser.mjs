// Production UI with isolated HTTP/SSE fixtures and synthetic schedule data only.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {composerFixture} from './fixtures/composer-browser-server.mjs';
import {openBrowser} from './helpers/image-zoom-browser.mjs';
const dest=resolve(process.env.HOMER_BROWSER_EVIDENCE),webDir=resolve(process.env.HOMER_COMPONENT_BUILD);mkdirSync(dest,{recursive:true});
const artifact={id:'synthetic-file',title:'原文件.md',messageId:'synthetic-reply',assetId:'asset-00000000-0000-4000-8000-000000000001',revision:1,sha256:'a'.repeat(64)};
const fixture=await composerFixture({webDir,beforeDir:webDir,branding:resolve('assets/branding/odysseus-20261030/homer-odysseus-256.png'),resource:(_req,res)=>{res.writeHead(200,{'Content-Type':'text/markdown','X-Homer-Artifact-Hash':artifact.sha256});res.end('# 原文件\n\n原文件内容保持可预览。');}});
const start=new Date('2026-11-18T00:00:00Z');
const base={revision:1,trigger:{cron:'0 10 * * *',timeZone:'Asia/Shanghai'},enabled:true,nextFireAt:Date.parse('2026-11-18T02:00:00Z'),status:'已启用',timeLabel:'下次投递',timeText:'2026年11月18日 10:00',cadence:'每天 10:00 · Asia/Shanghai',note:''};
const rows=[{...base,scheduleId:'schedule-00000000-0000-4000-8000-000000000001',title:'整理 AI 行业简报'},{...base,scheduleId:'schedule-00000000-0000-4000-8000-000000000002',title:'核对项目进展',trigger:{at:'2026-11-19T07:00:00Z'},nextFireAt:Date.parse('2026-11-19T07:00:00Z'),cadence:'仅一次 · Asia/Shanghai',timeText:'2026年11月19日 15:00'},{...base,scheduleId:'schedule-00000000-0000-4000-8000-000000000003',title:'已取消的合成安排',enabled:false,nextFireAt:null,status:'已取消后续投递',timeLabel:'后续投递',timeText:'不再投递',note:'已入箱消息不会被撤回。'}];
const extraRows=Array.from({length:99},(_,i)=>({...base,scheduleId:'schedule-00000000-0000-4000-8000-'+String(i+10).padStart(12,'0'),title:'合成分页任务 '+i,nextFireAt:null,status:'规则异常',timeText:'无法计算'}));
const text='每天汇总三条 AI 行业进展，说明来源和对项目的影响。\n\n'+('这段较长的合成任务内容用于核对详情滚动，不会创建真实日程。\n').repeat(160)+'完整任务内容尾部';
const checks=[],errors=[];let chrome,failure,exit;
try{
 chrome=await openBrowser(dest,{mockKeychain:true});
 for(const width of [1440,390,320]){
  const context=await chrome.browser.newContext({viewport:{width,height:960},timezoneId:'UTC',hasTouch:width===390,serviceWorkers:'block'}),page=await context.newPage();page.on('pageerror',error=>errors.push(String(error)));
  await context.route(url=>['http:','https:'].includes(url.protocol)&&url.origin!==fixture.url,route=>route.abort());
  await page.clock.install({time:start});
  let reads=0,listReads=0,detailReads=0,deny=false,paged=false,longList=false,staleCursor=false,empty=false,currentRows=structuredClone(rows),detailText=text,holdDetail,onHeldDetail,holdList,onHeldList;
  await page.route('**/api/schedules/read',async route=>{
   const input=route.request().postDataJSON();reads++;
   if(input.view==='detail')detailReads++;
   else listReads++;
   if(deny)return route.fulfill({status:409,json:{error:'schedule_unavailable'}});
   const common={threadId:'composer-review',readEpoch:input.readEpoch,displayTimeZone:'Asia/Shanghai'};
   if(input.view==='detail'){
    const item={...currentRows.find(x=>x.scheduleId===input.scheduleId),text:detailText};
    if(holdDetail){onHeldDetail();await holdDetail;}
    return route.fulfill({json:{...common,item}});
   }
   const extras=extraRows.slice(0,longList?99:19);
   const ordered=empty?[]:paged?(currentRows[0].enabled?[currentRows[0],...extras,currentRows[1],currentRows[2]]:[...extras,currentRows[1],currentRows[0],currentRows[2]]):currentRows;
   const offset=input.offset??0,end=offset+(input.limit??20);
   const json=structuredClone({...common,items:ordered.slice(offset,end),nextOffset:staleCursor&&offset===100?offset:end<ordered.length?end:null});
   if(holdList){const pending=holdList;holdList=undefined;onHeldList();await pending;}
   await route.fulfill({json});
  });
  fixture.reset({features:{draftUpload:true,taskOverview:false,previewReferenceCollections:2,scheduleReference:1},artifacts:[artifact],messages:[{id:artifact.messageId,threadId:'composer-review',requestId:'synthetic-request',role:'assistant',text:'已按要求登记安排。后续如需调整，直接告诉我。',status:'completed',createdAt:1700000000000,media:[{...artifact,filename:artifact.title,kind:'file',state:'ready',mime:'text/markdown',size:45}]}]});
  await page.goto(fixture.url);const editor=page.locator('[contenteditable=true]');await editor.waitFor();await editor.fill('把这个改到每天上午十点。');
  const assistant=page.locator('#message-synthetic-reply');
  assert.equal(await assistant.locator('.file-list-open').locator('..').getAttribute('data-slot'),'reference-card');
  await page.getByRole('button',{name:'预览 原文件.md',exact:true}).click();await page.locator('.canvas-markdown').waitFor();
  if(width<=800)await page.getByRole('button',{name:'收起预览',exact:true}).click();
  await page.getByRole('button',{name:'定时任务',exact:true}).click();const detailButton=page.getByRole('button',{name:'查看定时任务详情：整理 AI 行业简报',exact:true});await detailButton.waitFor();
  assert.equal(await page.locator('.canvas-tab').count(),2);
  await page.getByRole('tab',{name:artifact.title,exact:true}).click();await page.locator('.canvas-markdown').waitFor();assert.ok((await page.locator('.canvas-markdown').innerText()).includes('原文件内容保持可预览'));await page.getByRole('tab',{name:'定时任务',exact:true}).click();await detailButton.waitFor();assert.equal(await page.locator('.messages [data-slot=schedule-card]').count(),0);assert.equal(await page.locator('[data-slot=schedule-card]:visible').count(),3);
  assert.deepEqual(await page.locator('.schedule-status').allTextContents(),['已启用','已启用','已取消后续投递']);
  assert.equal(await page.locator('.schedule-inactive').count(),1);
  const firstRelative=page.locator('relative-time').first();
  await firstRelative.waitFor();
  assert.equal(await page.locator('relative-time').count(),2);
  assert.equal(await firstRelative.getAttribute('format'),'relative');
  assert.equal(await firstRelative.getAttribute('tense'),'future');
  assert.equal(await firstRelative.getAttribute('time-zone'),'Asia/Shanghai');
  assert.equal(await firstRelative.getAttribute('datetime'),new Date(rows[0].nextFireAt).toISOString());
  assert.equal(await firstRelative.getAttribute('title'),rows[0].timeText);
  assert.match(await firstRelative.evaluate(el=>el.shadowRoot.textContent),/2\s*小时后/);
  await page.getByText('不再投递',{exact:true}).waitFor();
  assert.doesNotMatch(await page.locator('.homer-schedules').innerText(),/当前定时安排|已加载/);
  assert.equal(await page.locator('.homer-schedule-card').evaluateAll(cards=>cards.every(card=>{
   const box=card.getBoundingClientRect(),list=card.parentElement.getBoundingClientRect();
   const clock=card.querySelector('.schedule-clock').getBoundingClientRect(),status=card.querySelector('.schedule-status').getBoundingClientRect();
   return Math.abs(box.left-list.left-(list.right-box.right))<2&&Math.abs(clock.top-status.top)<1&&box.right-status.right<20;
  })),true);
  await page.screenshot({animations:'disabled',path:join(dest,'center-'+width+'.png')});
  await detailButton.focus();await page.keyboard.press('Enter');const dialog=page.locator('.homer-schedule-detail');await dialog.waitFor();await dialog.locator('[data-slot=spec-sheet]').waitFor();
  await dialog.getByRole('button',{name:'关闭',exact:true}).click({trial:true});
  assert.equal(await dialog.getByRole('button',{name:'关闭',exact:true}).evaluate(node=>{const r=node.getBoundingClientRect();return node.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),true,'close button must be above the narrow Preview');
  assert.equal(await dialog.locator('[data-slot=dialog-title]').innerText(),rows[0].title);assert.equal(await dialog.locator('[data-slot=spec-sheet]>div:last-child>div').last().locator('span').last().textContent(),text);
  await dialog.getByText(rows[0].timeText,{exact:true}).waitFor();
  await dialog.getByText('Asia/Shanghai',{exact:true}).waitFor();
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
  await page.getByRole('button',{name:'发送消息',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.composer .schedule-chip'));assert.equal(fixture.received.messages.length,1);assert.equal(fixture.received.messages[0].text,'用户选择的定时任务：'+JSON.stringify({scheduleId:rows[0].scheduleId,label:rows[0].title})+'\n\n把这个改到每天上午十点。');
  const submitted=fixture.received.messages[0];
  assert.deepEqual(submitted.scheduleReference,{scheduleId:rows[0].scheduleId,label:rows[0].title});
  const sent=page.locator('[data-conversation-message="accepted-'+submitted.requestId+'"]');
  const sentCard=sent.getByRole('button',{name:'查看定时任务引用：'+rows[0].title});
  await sentCard.waitFor();
  assert.equal(await sent.locator('.schedule-chip').getAttribute('data-slot'),'reference-card');
  assert.equal(await sent.locator('.markdown').innerText(),'把这个改到每天上午十点。');
  assert.equal(await sent.getByRole('button',{name:'移除定时任务引用'}).count(),0);
  const readSent=page.waitForRequest(req=>req.url().endsWith('/api/schedules/read')&&req.postDataJSON().view==='detail');
  await sentCard.click();
  assert.equal((await readSent).postDataJSON().scheduleId,rows[0].scheduleId);
  await dialog.locator('[data-slot=spec-sheet]').waitFor();
  await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
  assert.equal(await sentCard.evaluate(node=>node===document.activeElement),true);
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText(value){window.__copied=value;return Promise.resolve();}}}));
  const copy=sent.getByRole('button',{name:'复制'});
  await sent.hover();await copy.click();
  assert.equal(await page.evaluate(()=>window.__copied),submitted.text);

  const longTitle='汇总每周发布候选、桌面和移动端验证进度，核对兼容性、签名和官网下载入口'.repeat(2);
  const longReference={scheduleId:rows[0].scheduleId,label:longTitle};
  fixture.accept({requestId:'long-schedule-reference',text:'用户选择的定时任务：'+JSON.stringify(longReference)+'\n\n把验证进度按平台分组。',scheduleReference:longReference});
  const longCard=page.locator('[data-conversation-message="accepted-long-schedule-reference"] .schedule-chip');
  assert.deepEqual(await longCard.locator('.compact-context-label').evaluate(node=>{
    const style=getComputedStyle(node);return [style.whiteSpace,style.textOverflow,node.scrollWidth>node.clientWidth];
  }),['nowrap','ellipsis',true]);
  const longBox=await longCard.boundingBox();assert.ok(longBox.x>=0&&longBox.x+longBox.width<=width);
  if(!await detailButton.isVisible())await page.getByRole('button',{name:'定时任务',exact:true}).click();
  await page.getByRole('button',{name:'在对话中说：整理 AI 行业简报',exact:true}).click();
  if(width>800)await page.getByRole('button',{name:'收起预览',exact:true}).click();
  await page.screenshot({animations:'disabled',path:join(dest,'conversation-reference-'+width+'.png')});
  await page.getByRole('button',{name:'移除定时任务引用',exact:true}).click();
  fixture.accept({requestId:'ordinary-prefixed-message',text:submitted.text});
  const legacyRow=page.locator('[data-conversation-message="accepted-ordinary-prefixed-message"]');
  assert.match(await legacyRow.locator('.markdown').innerText(),/用户选择的定时任务/);
  assert.equal(await legacyRow.locator('.schedule-chip').count(),0);
  await page.getByRole('button',{name:'定时任务',exact:true}).click();await detailButton.waitFor();
  const readBefore=reads;currentRows[0].title='已刷新：整理 AI 行业简报';fixture.update({isRunning:false});await page.getByRole('button',{name:'查看定时任务详情：已刷新：整理 AI 行业简报',exact:true}).waitFor();assert.ok(reads>readBefore);
  paged=true;fixture.update({});
  const moreButton=page.getByRole('button',{name:'加载更多',exact:true});
  await moreButton.evaluate(button=>{
   if(button.disabled)throw Error('load more should start from the enabled control');
   window.dispatchEvent(new Event('pageshow'));
   button.click();
  });
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
  const secondPageButton=page.getByRole('button',{name:'查看定时任务详情：已更新的第二页任务',exact:true});
  await secondPageButton.waitFor();
  assert.equal(await page.locator('.homer-schedule-card').count(),22);
  assert.equal(await page.getByRole('button',{name:'加载更多',exact:true}).count(),0);
  const deadline=await page.evaluate(()=>Date.now()+60_000);
  currentRows[0].nextFireAt=deadline;
  currentRows[1].nextFireAt=deadline+3*3_600_000;
  fixture.update({});
  await page.locator(`relative-time[datetime="${new Date(deadline).toISOString()}"]`).waitFor();
  const beforeDue=listReads;
  Object.assign(currentRows[0],{status:'到期待投递',timeLabel:'原定投递'});
  await page.clock.fastForward(61_000);
  await page.getByText('到期待投递',{exact:true}).waitFor();
  assert.equal(listReads,beforeDue+1);
  assert.equal(await page.locator('relative-time').count(),1);
  assert.match(await firstRelative.evaluate(el=>el.shadowRoot.textContent),/3\s*小时后/);
  assert.equal(await page.locator('.homer-schedule-card').count(),22);
  const beforeWake=listReads;
  const later=await page.evaluate(()=>Date.now()+3_600_000);
  Object.assign(currentRows[0],{revision:2,enabled:false,nextFireAt:null,status:'已停用',timeLabel:'后续投递',timeText:'不再投递'});
  await page.evaluate(()=>{
   Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});
   document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.setSystemTime(later);
  await page.evaluate(()=>{
   delete document.visibilityState;
   document.dispatchEvent(new Event('visibilitychange'));
   window.dispatchEvent(new Event('pageshow'));
  });
  await page.getByText('已停用',{exact:true}).waitFor();
  assert.equal(listReads,beforeWake+1);
  await secondPageButton.waitFor();
  assert.equal(await page.locator('.homer-schedule-card').count(),22);
  assert.match(await firstRelative.evaluate(el=>el.shadowRoot.textContent),/2\s*小时后/);
  if(width===1440){
   const more=page.getByRole('button',{name:'加载更多',exact:true});
   longList=true;fixture.update({});
   for(let i=0;i<4;i++)await more.click();
   await more.waitFor({state:'hidden'});
   assert.equal(await page.locator('.homer-schedule-card').count(),102);
   const beforeCursor=listReads;
   staleCursor=true;fixture.update({});
   const retry=page.getByRole('button',{name:'重试',exact:true});
   await retry.waitFor();
   assert.equal(listReads,beforeCursor+2);
   assert.equal(await page.locator('.homer-schedule-card').count(),102);
   staleCursor=false;longList=false;await retry.click();
   await retry.waitFor({state:'hidden'});
   await page.waitForFunction(()=>document.querySelectorAll('.homer-schedule-card').length===22);
  }
  const beforeNextRecovery=listReads;
  let releaseList;
  holdList=new Promise(resolve=>{releaseList=resolve;});
  const listHeld=new Promise(resolve=>{onHeldList=resolve;});
  await page.evaluate(()=>window.dispatchEvent(new Event('pageshow')));
  await listHeld;
  currentRows[1].title='再次回到前台后的任务';
  await page.evaluate(()=>{
   Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});
   document.dispatchEvent(new Event('visibilitychange'));
   delete document.visibilityState;
   document.dispatchEvent(new Event('visibilitychange'));
   window.dispatchEvent(new Event('pageshow'));
  });
  releaseList();
  await page.getByRole('button',{name:'查看定时任务详情：再次回到前台后的任务',exact:true}).waitFor();
  assert.equal(listReads,beforeNextRecovery+2);
  const refreshedButton=page.getByRole('button',{name:'查看定时任务详情：已刷新：整理 AI 行业简报',exact:true});
  await refreshedButton.click();await dialog.locator('[data-slot=spec-sheet]').waitFor();
  let releaseDetail;holdDetail=new Promise(resolve=>{releaseDetail=resolve;});
  const detailRequested=Promise.all([nextRead('detail'),new Promise(resolve=>{onHeldDetail=resolve;})]);
  fixture.update({});await detailRequested;
  fixture.unavailable();await dialog.waitFor({state:'hidden'});await refreshedButton.waitFor({state:'hidden'});
  paged=false;releaseDetail();holdDetail=undefined;fixture.update({});await refreshedButton.waitFor();
  assert.equal(await dialog.count(),0,'a late detail cannot restore the dialog after reconnect');
  await page.getByRole('button',{name:'查看定时任务详情：已取消的合成安排',exact:true}).waitFor();
  deny=true;fixture.update({isRunning:false});await page.getByText('定时任务未能读取，当前内容尚未确认。',{exact:false}).waitFor();assert.equal(await page.getByText('还没有定时任务',{exact:true}).count(),0);
  await page.getByRole('button',{name:'查看定时任务详情：已刷新：整理 AI 行业简报',exact:true}).click();await page.getByText('该定时任务暂不可用或未能读取。',{exact:true}).waitFor();assert.equal(await page.locator('.homer-schedule-detail [data-slot=spec-sheet]').count(),0);await page.keyboard.press('Escape');
  deny=false;await page.getByRole('button',{name:'重试',exact:true}).click();await page.getByText('定时任务未能读取，当前内容尚未确认。',{exact:false}).waitFor({state:'hidden'});
  paged=false;empty=true;fixture.update({});
  const example='每周五下午 5 点，提醒我写周报。';
  const useExample=page.getByRole('button',{name:'用示例开始',exact:true});
  await useExample.waitFor();
  await page.screenshot({animations:'disabled',path:join(dest,'empty-'+width+'.png')});
  await useExample.click();
  await page.waitForFunction(()=>document.querySelector('[contenteditable=true]')?.contains(document.activeElement));
  if(width<=800)await page.locator('#canvas-panel').waitFor({state:'hidden'});
  await page.waitForFunction(value=>document.querySelector('[contenteditable=true]')?.textContent===value,example);
  assert.equal(await page.getByRole('dialog').count(),0);
  await editor.fill('已有草稿');
  if(width<=800)await page.getByRole('button',{name:'定时任务',exact:true}).click();
  await useExample.click();
  await page.waitForFunction(value=>document.querySelector('[contenteditable=true]')?.innerText.replace(/\n+/g,'\n')==='已有草稿\n'+value,example);
  const composed=await editor.innerText();
  await page.screenshot({animations:'disabled',path:join(dest,'example-in-composer-'+width+'.png')});
  if(width<=800)await page.getByRole('button',{name:'定时任务',exact:true}).click();
  await useExample.click();
  assert.equal(await editor.innerText(),composed);
  assert.equal(fixture.received.messages.length,1,'the example must only change the draft');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const comment='保留网页批注全文。\n'+('长批注内容。'.repeat(30));
  fixture.reset({features:{draftUpload:true,taskOverview:false,previewReferenceCollections:2,scheduleReference:1},messages:[{
   id:'mixed-historical-cards',threadId:'composer-review',requestId:'mixed-historical',role:'user',text:'历史正文',
   status:'completed',createdAt:1700000000001,taskReference:{taskId:'synthetic-task',version:1,title:'合成事项'},
   quotes:[{messageId:artifact.messageId,text:'原消息摘录',annotation:'消息批注'}],
   media:[{...artifact,filename:artifact.title,kind:'file',state:'ready',mime:'text/markdown',size:45}],
   resourceReferences:[{kind:'web',source:{kind:'message-file',messageId:artifact.messageId,destination:'preview.html',title:'合成网页'},annotations:[{id:'note',element:'页面标题',elementPath:'h1',comment,x:0,y:0}]}],
  }]});
  await page.reload();
  const mixed=page.locator('#message-mixed-historical-cards');
  await mixed.locator('.web-annotation-reference').waitFor();
  assert.equal(await mixed.locator('[data-slot=reference-card]').count(),4);
  assert.equal(await mixed.locator('figure.message-attachment').getAttribute('data-slot'),'reference-card');
  assert.equal(await mixed.locator('a[data-slot=reference-card]').count(),2);
  assert.equal(await mixed.locator('.web-annotation-comment').textContent(),comment);
  assert.equal(await mixed.locator('.web-annotation-reference').locator('a,button,summary,[tabindex]').count(),0);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({animations:'disabled',path:join(dest,'mixed-reference-cards-'+width+'.png')});
  const scheduledAt=Date.parse('2026-11-17T23:59:00Z'),createdAt=Date.parse('2026-11-18T00:03:00Z');
  const message=(id,role,text,createdAt)=>({id,threadId:'composer-review',role,text,status:'completed',createdAt});
  const scheduled={...message('scheduled-answer','assistant','已整理',createdAt),audience:'user',
   process:{id:'scheduled-process',sourceKind:'scheduled',sourceMessageIds:[],turnIds:[],state:'worked',status:'completed',items:[]},
   scheduledSource:{scheduleId:rows[0].scheduleId,title:longTitle,scheduledAt}};
  fixture.reset({messages:[message('before-midnight','user','上一天',scheduledAt),scheduled,message('after-midnight','user','新一天',createdAt+60000)]});
  empty=false;
  await page.reload();
  const reply=page.locator('#message-scheduled-answer'),time=reply.locator('.assistant-message-bubble > time');
  await time.waitFor();
  assert.equal(await time.getAttribute('datetime'),new Date(createdAt).toISOString());
  assert.equal(await time.textContent(),'00:03');
  assert.equal(await reply.locator('time').count(),1);
  assert.deepEqual(await page.locator('.message-day-separator time').evaluateAll(times=>times.map(time=>time.dateTime)),['2026-11-17','2026-11-18']);
  assert.equal(await reply.evaluate(row=>row.parentElement.querySelector('.message-day-separator')),null);
  const title=reply.getByRole('button',{name:longTitle,exact:true});
  await page.waitForFunction(()=>{
   const row=document.querySelector('#message-scheduled-answer'),bubble=row.querySelector('.assistant-message-bubble').getBoundingClientRect();
   const button=row.querySelector('.schedule-source'),label=button.querySelector('span'),box=button.getBoundingClientRect();
   return Math.abs(box.left-bubble.left)<1&&box.right<=bubble.right+1&&label.scrollWidth>label.clientWidth;
  });
  if(width===390)assert.equal(await time.evaluate(node=>getComputedStyle(node).opacity),'1');
  else {
   await page.mouse.move(1,1);
   await page.waitForFunction(()=>getComputedStyle(document.querySelector('#message-scheduled-answer time')).opacity==='0');
   await time.focus();
   await page.waitForFunction(()=>getComputedStyle(document.activeElement).opacity==='1');
  }
  await title.focus();
  await page.keyboard.press('Enter');
  await dialog.locator('[data-slot=spec-sheet]').waitFor();
  await page.keyboard.press('Escape');
  await dialog.waitFor({state:'hidden'});
  assert.equal(await title.evaluate(node=>node===document.activeElement),true);
  await page.screenshot({animations:'disabled',path:join(dest,'scheduled-reply-'+width+'.png')});
  checks.push({width,reads,detailReads,relativeTime:true,loadedPagesPreserved:true,dueRefresh:true,foregroundRecovery:true,staleCursorRejected:width===1440,fileTabsPreserved:true,detailKeyboardFocus:true,longText:true,chipDraftRestored:true,exactIdSentOnce:true,stateRefresh:true,pagedDetailRefresh:true,disconnectClears:true,failureNotEmpty:true,exampleInComposer:true,existingDraftPreserved:true});await context.close();
 }
 assert.deepEqual(errors,[]);
}catch(error){failure=error;}finally{if(chrome)exit=await chrome.finish();await fixture.close();writeFileSync(join(dest,'browser-result.json'),JSON.stringify({checks,errors,exit,failure:failure?String(failure):null},null,2));}
if(failure)throw failure;assert.equal(exit.code,0);assert.equal(exit.watchdog,false);assert.equal(exit.forced,false);console.log(JSON.stringify({checks,exit}));
