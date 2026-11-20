import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {composerFixture} from './fixtures/composer-browser-server.mjs';
import {openBrowser} from './helpers/image-zoom-browser.mjs';

const root=resolve(process.env.HOMER_BROWSER_EVIDENCE);
const webDir=resolve(process.env.HOMER_COMPONENT_BUILD??process.env.HISTORY_FOLLOWUP_BUILD);
const dest=join(root,'main-processing-indicator');
mkdirSync(dest,{recursive:true});
const fixture=await composerFixture({webDir,beforeDir:webDir,branding:resolve('assets/branding/odysseus-20261030/homer-odysseus-256.png')});
const threadId='composer-review';
const message=(id,role,text)=>({id,threadId,requestId:id,role,text,status:'completed',createdAt:1700000000000});
const messages=Array.from({length:18},(_,i)=>message('history-'+i,i%2?'assistant':'user',i%2?'我会按先前商定的步骤核对材料，并将需要确认的问题单独列出。':'请整理这一轮的示例材料。'));
messages.push(message('latest-user','user','请帮我读信，再起草一份回信。'));
const queue=['核对回信里的时间','准备一个简短版本','比较两个版本'].map((text,i)=>{
  const user=message('queued-'+i,'user',text);
  return {messageId:user.id,user,input:{text,requestId:user.id},origin:'user',state:'queued',editable:false,statusText:'待发送',position:i+1};
});
const generation={generationId:'generation',threadId,turnId:'turn',messageId:'active',sourceRequestId:'latest-user'};
const running={isRunning:true,activeMessageId:'active',generation,mainActivity:{source:'user',processId:'process',turnId:'turn',stage:'native'}};
const queueDispatch={orderVersion:'synthetic-order',totalWaiting:queue.length};
const emptyQueue={orderVersion:'synthetic-empty',totalWaiting:0};
const chrome=await openBrowser(dest,{mockKeychain:true});

try{
  for(const [width,height,touch] of [[805,826,false],[390,650,true]]){
    fixture.reset({messages,features:touch?{queueDispatch:1,queueSources:1}:{},queueDispatch:emptyQueue,...running});
    const context=await chrome.browser.newContext({viewport:{width,height},isMobile:touch,hasTouch:touch});
    const page=await context.newPage();
    let dispatch=emptyQueue;
    if(touch)await page.route('**/api/history/queue',route=>route.fulfill({json:{
      ...dispatch,protocol:3,readEpoch:'composer-synthetic-epoch',threadId,view:'dispatch-v1',sources:'all',
      items:dispatch.totalWaiting?queue:[],nextCursor:null,
    }}));
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await page.goto(fixture.url);
    assert.match(await page.title(),/Homer/);
    const view=page.locator('.thread-viewport');
    const sprite=page.locator('.processing-sprite');
    const row=page.locator('.queue-toggle');
    const down=()=>view.evaluate(el=>el.scrollTo(0,el.scrollHeight));
    const history=()=>view.evaluate(el=>el.scrollTo(0,100));
    const position=()=>view.evaluate(el=>el.scrollTop);
    const size=width=>page.waitForFunction(width=>{
      const el=document.querySelector('.processing-sprite');
      return el&&Math.abs(el.getBoundingClientRect().width-width)<.2;
    },width,{timeout:5000});
    const state=arrow=>page.waitForFunction(arrow=>{
      const glyph=document.querySelector('.queue-toggle svg'),sprite=document.querySelector('.processing-sprite');
      return glyph&&sprite&&getComputedStyle(glyph).opacity===(arrow?'1':'0')&&getComputedStyle(sprite).opacity===(arrow?'0':'1');
    },arrow,{timeout:5000});

    await page.locator('.processing-inline').waitFor({timeout:4000});
    await down();
    await size(40);
    await sprite.waitFor();
    await page.waitForFunction(()=>document.querySelector('.processing-sprite')?.naturalWidth===96);
    const announcement=page.getByRole('status').filter({hasText:/^AI 正在处理$/});
    assert.equal(await announcement.count(),1);
    const first=await sprite.screenshot();
    await page.waitForTimeout(850);
    assert.notDeepEqual(first,await sprite.screenshot());
    await sprite.evaluate(el=>{window.originalProcessingSprite=el;});
    await page.screenshot({path:join(dest,width+'-inline.png')});
    await history();
    await sprite.waitFor({state:'hidden'});

    dispatch=queueDispatch;
    fixture.update({queue,queueDispatch});
    await size(26);
    await state(false);
    assert.match(await row.innerText(),/3 条待发送/);
    assert.doesNotMatch(await row.innerText(),/处理中/);
    const reading=await position();
    assert.ok(await sprite.evaluate(el=>el===window.originalProcessingSprite));
    const [icon,button]=await Promise.all([sprite.boundingBox(),row.boundingBox()]);
    assert.ok(icon.x>=button.x&&icon.y>=button.y&&icon.y+icon.height<=button.y+button.height);
    await page.screenshot({path:join(dest,width+'-docked.png')});

    if(touch){
      await row.tap();
      assert.equal(await row.getAttribute('aria-expanded'),'true');
      await page.getByText(/比较两个版本/).waitFor();
      await row.tap();
      assert.equal(await row.getAttribute('aria-expanded'),'false');
    }else{
      await row.hover();
      await state(true);
      await row.click();
      assert.equal(await row.getAttribute('aria-expanded'),'true');
      await page.getByText(/比较两个版本/).waitFor();
      await row.click();
      assert.equal(await row.getAttribute('aria-expanded'),'false');
      await page.mouse.move(300,40);
      await state(false);
      await page.keyboard.press('Tab');
      await row.focus();
      await state(true);
      await page.keyboard.press('Space');
      assert.equal(await row.getAttribute('aria-expanded'),'true');
      await page.keyboard.press('Space');
      assert.equal(await row.getAttribute('aria-expanded'),'false');
    }
    assert.equal(await position(),reading);
    await down();
    await size(40);
    assert.ok(await sprite.evaluate(el=>el===window.originalProcessingSprite));
    assert.doesNotMatch(await row.innerText(),/待发送/);

    await view.evaluate(el=>{
      const marker=el.querySelector('.processing-inline').getBoundingClientRect();
      el.scrollTop-=el.getBoundingClientRect().bottom-marker.bottom+20;
    });
    await size(33);
    assert.ok(await sprite.evaluate(el=>el===window.originalProcessingSprite));
    await down();
    await size(40);
    await page.emulateMedia({reducedMotion:'reduce'});
    await sprite.waitFor({state:'hidden'});
    assert.equal(await row.locator('svg').evaluate(el=>getComputedStyle(el).opacity),'1');
    assert.equal(await page.getByRole('status').filter({hasText:'AI 正在处理'}).count(),1);
    await page.emulateMedia({reducedMotion:'no-preference'});
    await history();
    await size(26);
    dispatch=emptyQueue;
    fixture.update({queue:[],queueDispatch:emptyQueue});
    await row.waitFor({state:'hidden'});
    await sprite.waitFor({state:'hidden'});
    fixture.unavailable();
    await sprite.waitFor({state:'detached'});
    fixture.update(running);
    await page.locator('.processing-inline').waitFor();
    fixture.update({isRunning:false,activeMessageId:null,generation:null,mainActivity:null});
    await sprite.waitFor({state:'detached'});
    const id='archive-receipt',title='聊天回复事项标题缺失调查';
    const activity={processId:id,source:'internal',stage:'native',turnId:'archive-turn'};
    const process={id,messageId:id,threadId,sourceKind:'worker',sourceMessageIds:['archive-notice'],turnIds:[activity.turnId],state:'working',status:'running',revision:1,seq:1,items:[]};
    const receipt={...message(id,'assistant',''),status:'running',process,taskSources:[{title,target:{taskId:'archived-task',version:1}}]};
    fixture.update({messages:[...messages,receipt],mainActivity:activity});
    const receiptRow=page.locator('#message-'+id),bubble=receiptRow.locator('.assistant-message-bubble');
    await down();
    await receiptRow.getByText(title,{exact:true}).waitFor();
    await down();
    await sprite.waitFor({state:'visible'});
    assert.equal(await bubble.count(),0);
    for(const text of ['已核对','已核对归档。']){
      fixture.update({mainActivity:{...activity,finalText:text}});
      await bubble.getByText(text,{exact:true}).waitFor();
      assert.equal(await bubble.count(),1);
    }
    fixture.update({mainActivity:null,messages:[...messages,{...receipt,text:'已核对归档。',status:'completed',process:{...process,revision:2,state:'worked',status:'completed',endEventId:'end',final:{id,text:'已核对归档。'}}}]});
    await sprite.waitFor({state:'detached'});
    assert.equal(await bubble.getByText('已核对归档。',{exact:true}).count(),1);
    assert.deepEqual(errors,[]);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await context.close();
    console.log(width+'px: shared GIF, late queue anchor, hover/keyboard or touch, reduced motion, queue removal, reconnect and completion');
  }

  fixture.reset({messages,queue,queueDispatch,features:{},...running});
  const page=await chrome.browser.newPage({viewport:{width:805,height:826}});
  await page.route('**/assets/homer-processing-*.gif',route=>route.fulfill({contentType:'image/gif',body:'invalid GIF'}));
  await page.goto(fixture.url);
  await page.waitForFunction(()=>{
    const sprite=document.querySelector('.processing-sprite');
    return sprite?.complete&&sprite.naturalWidth===0;
  },null,{timeout:4000});
  await page.locator('.thread-viewport').evaluate(el=>el.scrollTo(0,100));
  const row=page.locator('.queue-toggle');
  await row.waitFor();
  await page.waitForTimeout(180);
  assert.equal(await row.locator('svg').evaluate(el=>getComputedStyle(el).opacity),'1','The collapsed queue arrow stays visible after an image decode error');
  await row.click();
  assert.equal(await row.getAttribute('aria-expanded'),'true');
  await page.close();
  console.log('Image decode failure: the queue keeps its arrow and can still be opened');
}finally{
  await fixture.close();
  const exit=await chrome.finish();
  assert.equal(exit.code,0);
  assert.equal(exit.forced,false);
}
