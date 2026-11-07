// Synthetic service + actual built product. No model, database, private HOME,
// production endpoint, upload or external request. Optional synthetic screenshots.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {buildApprovalUI} from './helpers/build-approval-ui.mjs';
import {approvalFixture,approval} from './fixtures/approval-browser-server.mjs';
import {isolatedChrome} from './web-history-browser-cdp.mjs';
const destination=resolve(process.env.HOMER_BROWSER_EVIDENCE??'.codex/scratch/approval-card-official-20261023');mkdirSync(destination,{recursive:true});
const screenshots=process.argv.includes('--screenshots');
const webDir=process.env.HOMER_APPROVAL_WEB_DIR??(process.argv.includes('--reuse-build')?join(destination,'candidate'):await buildApprovalUI(join(destination,'candidate')));
const preview='Synthetic preview content',sha256=createHash('sha256').update(preview).digest('hex');
const attachment={id:'synthetic-attachment',title:'合成成果.txt',messageId:'synthetic-answer',assetId:'asset-00000000-0000-4000-8000-000000000001',revision:1,sha256};
const options={webDir,branding:resolve('assets/branding/odysseus-20261030/homer-odysseus-64.png'),resource:async(_req,res,url)=>{
 if(url.pathname!=='/api/media/'+attachment.messageId+'/'+attachment.assetId+'/'+attachment.revision){res.writeHead(404);res.end();return;}
 res.writeHead(200,{'Content-Type':'text/plain','X-Homer-Artifact-Hash':sha256});res.end(preview);
}};

if(process.argv.includes('--serve')){
 const f=await approvalFixture(options);console.log('Synthetic ApprovalCard product preview: '+f.url+' (unknown receipt fixture; no real commands execute)');
 const close=async()=>{await f.close();process.exit(0);};process.once('SIGINT',close);process.once('SIGTERM',close);
}else{
 const browser=await isolatedChrome(destination),results=[];
 try{for(const width of [1440,390,320]){
  const f=await approvalFixture(options),p=await browser.page(f.url,width),checks=[];
  const wait=fn=>p.until('Boolean(('+String(fn)+')())',12000);
  const loaded=()=>wait(()=>document.querySelector('[data-slot=approval-card-allow-once]')&&!document.querySelector('[data-slot=approval-card-allow-once]').disabled);
  const received=async count=>{for(let n=0;n<250;n++){if(f.decisions.length>=count)return;await new Promise(resolve=>setTimeout(resolve,20));}throw Error('synthetic_decision_not_received');};
  const action=async slot=>{await p.evaluate(`document.querySelector('[data-slot="approval-card-${slot}"]').click()`);};
  const reload=async()=>{await p.command('Page.reload');await loaded();};
  const shot=async state=>{if(screenshots){await p.evaluate(()=>document.querySelector('[data-slot=approval-card]').scrollIntoView({block:'center'}));await p.screenshot('approval-'+state+'-'+width+'.png');}};
  try{
   await p.navigate();await loaded();
   await shot('request');
   assert.equal(await p.evaluate(()=>document.querySelector('[data-slot=approval-card] .font-mono').textContent),approval.question);
   assert.equal(await p.evaluate(()=>!!document.querySelector('[data-slot=approval-card] script')),false);
   assert.equal(await p.evaluate(()=>document.querySelector('[data-slot=approval-card] a').getAttribute('href')),'#message-synthetic-original');
   assert.equal(await p.evaluate(()=>document.querySelectorAll('[data-slot=approval-card] button').length),2);
   assert.equal(await p.evaluate(()=>!!document.querySelector('.native-approval-actions,[data-slot=approval-card-always-allow]')),false);
   assert.equal(await p.evaluate(()=>document.querySelector('[data-slot=approval-card]').closest('.interaction-card')!==null),false);
   await p.evaluate(()=>document.querySelector('[data-slot=approval-card] a').click());await wait(()=>document.activeElement.id==='message-synthetic-original');
   checks.push('real official card replaces custom root; full command is inert text; exact source; only current-request controls');
   const layout=await p.evaluate(()=>{const root=document.querySelector('[data-slot=approval-card]'),command=root.querySelector('.font-mono'),b=root.querySelector('button');return {pageOverflow:document.documentElement.scrollWidth>innerWidth,cardOverflow:root.scrollWidth>root.clientWidth,commandOverflow:command.scrollWidth>command.clientWidth,cardWidth:root.getBoundingClientRect().width,gap:getComputedStyle(root).gap,padding:getComputedStyle(root).padding,radius:getComputedStyle(root).borderRadius,titleSize:getComputedStyle(root.querySelector('p')).fontSize,commandWhiteSpace:getComputedStyle(command).whiteSpace,buttons:[...root.querySelectorAll('button')].map(b=>({height:b.getBoundingClientRect().height,width:b.getBoundingClientRect().width})),buttonRadius:getComputedStyle(b).borderRadius};});
   assert.equal(layout.pageOverflow,false);assert.equal(layout.cardOverflow,false);assert.equal(layout.commandOverflow,false);assert.equal(layout.gap,'14px');assert.equal(layout.padding,'16px');assert.equal(layout.radius,'20px');assert.equal(layout.titleSize,'13.5px');assert.equal(layout.commandWhiteSpace,'pre-wrap');assert.ok(layout.buttons.every(b=>b.height===32&&b.width>0));
   checks.push('official 14px gap / 16px padding / 20px radius / 13.5px title retained; 32px controls; long Chinese command fits');
   await p.command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});assert.equal(await p.evaluate(()=>getComputedStyle(document.querySelector('[data-slot=approval-card-allow-once]')).transitionDuration),'0s');
   await p.evaluate(()=>document.querySelector('[data-slot=approval-card] a').focus());await p.command('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await p.command('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
   assert.equal(await p.evaluate(()=>document.activeElement.dataset.slot),'approval-card-deny');assert.equal(await p.evaluate(()=>getComputedStyle(document.activeElement).outlineWidth),'2px');
   f.setMode('hold');await p.command('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',windowsVirtualKeyCode:13});await p.command('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
   await wait(()=>document.querySelector('[data-slot=approval-card]')?.getAttribute('aria-busy')==='true');await action('deny');assert.equal(f.decisions.length,1);assert.equal(f.decisions[0].text,'拒绝本次操作');assert.equal(f.decisions[0].id,approval.id);
   assert.equal(await p.evaluate(()=>[...document.querySelectorAll('[data-slot=approval-card] button')].every(b=>b.disabled)),true);checks.push('Tab focus visible; Enter denies exact interaction once; pending locks both controls');
   await shot('sending');
   f.release('synthetic_receipt_unknown');await loaded();await shot('unknown');const original={...f.decisions[0]};
   await reload();assert.match(await p.evaluate(()=>document.querySelector('[data-slot=approval-card]').textContent),/上次决定尚未确认/);f.setMode('unknown');await action('deny');await loaded();assert.deepEqual(f.decisions.at(-1),original);checks.push('unknown receipt preserved through refresh; explicit same decision retries exact request ID and payload');
   f.update({acceptedRequestIds:[original.requestId]});await wait(()=>document.querySelector('[data-slot=approval-card-allow-once]')?.disabled);assert.match(await p.evaluate(()=>document.querySelector('[data-slot=approval-card]').textContent),/决定已送达.*尚未确认执行结果/);
   assert.equal(await p.evaluate(()=>!!document.querySelector('[data-slot=approval-card] .lucide-check')),false);await p.command('Page.reload');await wait(()=>document.querySelector('[data-slot=approval-card-allow-once]')?.disabled);assert.match(await p.evaluate(()=>document.querySelector('[data-slot=approval-card]').textContent),/决定已送达/);await shot('accepted');checks.push('accepted receipt locks after refresh, without execution-success icon or claim');
   await p.evaluate(()=>sessionStorage.clear());f.reset();await reload();f.setMode('hold');await action('allow-once');await received(1);f.update({acceptedRequestIds:[f.decisions[0].requestId]});await wait(()=>document.querySelector('[data-slot=approval-card]')?.textContent.includes('决定已送达'));f.release('synthetic_receipt_lost');await p.evaluate(()=>new Promise(resolve=>setTimeout(resolve,100)));assert.equal(await p.evaluate(()=>!!document.querySelector('.error-banner')),false);assert.equal(await p.evaluate(()=>document.querySelector('[data-slot=approval-card-allow-once]').disabled),true);checks.push('exact accepted receipt wins over a later lost POST response without false unknown error');
   await p.evaluate(()=>sessionStorage.clear());f.reset();await reload();f.unavailable();await wait(()=>document.querySelector('[data-slot=approval-card-allow-once]')?.disabled);const count=f.decisions.length;await action('allow-once');assert.equal(f.decisions.length,count);assert.match(await p.evaluate(()=>document.querySelector('[data-slot=approval-card]').textContent),/正在核对/);f.update({});await loaded();checks.push('disconnect/unverified retains request, disables actions; verified reconnect unlocks');
   f.setMode('hold');await p.command('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});const touch=await p.evaluate(()=>{const b=document.querySelector('[data-slot=approval-card-allow-once]');b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};});await p.command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[touch]});await p.command('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await wait(()=>document.querySelector('[data-slot=approval-card-allow-once]')?.disabled);await received(1);assert.equal(f.decisions.at(-1).text,'允许本次操作');checks.push('real touch activation allows only current synthetic request; reduced motion disables transitions');
   const other={...approval,id:'other-approval',sourceRequestId:'other-source',sourceMessageId:'other-original',workTitle:'另一条准确请求'};f.update({interactions:[other],messages:[{id:'other-original',threadId:'approval-thread',requestId:'other-source',role:'user',text:'另一条准确请求',status:'completed',createdAt:1700000002000}]});await loaded();f.release('interaction_not_live');
   await p.evaluate(()=>new Promise(resolve=>setTimeout(resolve,100)));assert.ok(await p.evaluate(()=>!!document.querySelector('#task-interaction-other-approval')));assert.equal(await p.evaluate(()=>!!document.querySelector('.error-banner')),false);assert.equal(await p.evaluate(()=>document.querySelector('[data-slot=approval-card] a').getAttribute('href')),'#message-other-original');checks.push('late expiry from unmounted old target does not expire replacement or change exact source');
   f.setMode('expired');await action('deny');await wait(()=>!document.querySelector('[data-slot=approval-card]'));assert.equal(f.decisions.at(-1).id,'other-approval');checks.push('exact interaction_not_live removes only that request via existing owner');
   await p.evaluate(()=>sessionStorage.clear());f.reset();await reload();f.setMode('hold');await action('allow-once');await wait(()=>document.querySelector('[data-slot=approval-card-allow-once]')?.disabled);f.update({threadId:'other-thread'});await wait(()=>document.querySelector('.error-banner')?.textContent.includes('主对话标识发生变化'));f.release('synthetic_late_failure');await p.evaluate(()=>new Promise(resolve=>setTimeout(resolve,100)));assert.equal(await p.evaluate(()=>document.querySelector('[data-slot=approval-card-allow-once]').disabled),true);assert.match(await p.evaluate(()=>document.querySelector('.error-banner').textContent),/主对话标识发生变化/);checks.push('thread change keeps product global send barrier; late failure cannot unlock approvals or overwrite barrier');
   if(!process.argv.includes('--approval-only')){
   await p.evaluate(()=>sessionStorage.clear());f.reset({interactions:[{...approval,id:'free',runId:'worker:synthetic',kind:'question',question:'普通自由答复'}]});await p.command('Page.reload');
   await wait(()=>document.querySelector('#task-interaction-free button'));assert.equal(await p.evaluate(()=>!!document.querySelector('[data-slot=approval-card]')),false);assert.match(await p.evaluate(()=>document.querySelector('#task-interaction-free').textContent),/普通自由答复/);
   f.setMode('unknown');await p.evaluate(()=>document.querySelector('#task-interaction-free button').click());
   await wait(()=>document.querySelector('.composer-answer-target')?.textContent.includes('普通自由答复'));
   await p.evaluate(()=>document.querySelector('.composer [contenteditable=true]').focus());await p.command('Input.insertText',{text:'合成自由答复'});
   await wait(()=>document.querySelector('.send-button[aria-label="提交答复"]:not(:disabled)'));await p.evaluate(()=>document.querySelector('.send-button[aria-label="提交答复"]').click());await received(1);assert.equal(f.decisions.at(-1).id,'free');assert.equal(f.decisions.at(-1).text,'合成自由答复');
   f.update({features:{taskOverview:true,nativeQuestionAnswers:true},interactions:[{...approval,id:'questions',kind:'question',questions:[{id:'format',question:'合成格式问题',options:[{label:'Markdown'}],allowOther:false}]}]});
   await wait(()=>document.querySelector('[data-slot=question-flow] button'));
   await p.evaluate(()=>[...document.querySelectorAll('[data-slot=question-flow] button')].find(b=>b.textContent.trim()==='Markdown').click());
   await received(2);assert.equal(f.decisions.at(-1).id,'questions');assert.equal(f.decisions.at(-1).text,'1. 合成格式问题\n答案：Markdown');assert.deepEqual(f.decisions.at(-1).questionAnswers,{format:['Markdown']});
   assert.ok(await p.evaluate(()=>!!document.querySelector('[contenteditable=true]')));assert.ok(await p.evaluate(()=>!!document.querySelector('header')));checks.push('ordinary free reply and official QuestionFlow submit their exact payloads; composer and header retain product components');
   f.reset({artifacts:[attachment]});await loaded();
   await p.evaluate(()=>{if(!document.querySelector('#task-status-panel'))document.querySelector('#task-status-trigger').click();});await wait(()=>document.querySelector('#task-status-panel'));
   await p.evaluate(()=>document.querySelector('button[aria-label="收起工作状态"]').click());await wait(()=>!document.querySelector('#task-status-panel'));
   await wait(()=>document.querySelector('button[aria-label="预览 合成成果.txt"]'));
   await p.evaluate(()=>document.querySelector('button[aria-label="预览 合成成果.txt"]').click());
   await wait(()=>document.querySelector('#canvas-panel')?.textContent.includes('Synthetic preview content'));
   await p.evaluate(()=>document.querySelector('#canvas-panel button[aria-label="关闭文件：合成成果.txt"]').click());await wait(()=>!document.querySelector('#canvas-panel'));checks.push('top TaskCard opens and closes; the exact message attachment opens and closes in Canvas');
   }
   assert.deepEqual(p.errors,[]);assert.deepEqual(p.blocked,[]);assert.deepEqual(f.received.denied,[]);assert.equal(f.received.messages.length,0);assert.equal(f.received.uploads.length,0);
   results.push({width,layout,checks,passed:true});
  }catch(error){results.push({width,checks,passed:false,error:String(error),decisions:f.decisions.length,browserErrors:p.errors});throw error;}finally{await p.close();await f.close();}
 }}finally{await browser.close();writeFileSync(join(destination,'browser-results.json'),JSON.stringify({browser:browser.version,syntheticOnly:true,screenshots,webDir,results},null,2)+'\n');}
 console.log(JSON.stringify({passed:results.length===3,widths:results.map(r=>r.width),checks:results.reduce((n,r)=>n+r.checks.length,0)}));
}
