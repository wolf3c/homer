// Actual product UI + persisted synthetic interactions, no engine/account or external requests.
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {historyFixture} from './web-history-loading-fixture.ts';
import {MainNativeApprovals} from '../src/main-native-approvals.ts';
import {withInteractionResponses} from '../src/web-homer.ts';
import {projectQuestions} from '../src/question-schema.ts';
import {WebHistoryPages} from '../src/web-history-pages.ts';
import {composerFixture} from './fixtures/composer-browser-server.mjs';
import {buildApprovalUI} from './helpers/build-approval-ui.mjs';
import {isolatedChrome} from './web-history-browser-cdp.mjs';
const destination=resolve(process.env.HOMER_BROWSER_EVIDENCE??'.codex/scratch/interaction-completion-20261111/browser');
mkdirSync(destination,{recursive:true});
const webDir=process.env.HOMER_COMPONENT_BUILD??await buildApprovalUI(join(destination,'web'));
const results=[],browser=process.argv.includes('--serve')?null:await isolatedChrome(destination);
async function scene(name,width){
 const database=join(mkdtempSync(join(destination,'data-'+name+'-'+width+'-')),'history.sqlite');let store=historyFixture(0,160,false,database),approvals=new MainNativeApprovals(store.interactions,store.history),unknown=name==='allow',submissions=0;
 const thread='synthetic-history',scope={threadId:thread,turnId:'turn',generationId:name+'-'+width,sourceRequestId:'original',userText:'合成请求',isCurrent:()=>true};
 store.history.accept(thread,{requestId:'original',text:name==='free'?'请整理一份问题说明。':name==='question'?'关于页面中加上版本信息。':'请检查隔离浏览器截图是否可用。'});
 const questions=[{id:'format',question:'版本信息如何显示？',options:[{label:'版本号和构建号'},{label:'仅版本号'}]},{id:'audience',question:'面向谁展示？',options:[{label:'所有用户'},{label:'开发人员'}]}];
 const native={requestId:name,threadId:thread,turnId:'turn',itemId:name,kind:name==='question'?'question':'authorization',method:name==='question'?'item/tool/requestUserInput':'item/commandExecution/requestApproval',details:name==='question'?{questions}:{command:'node /synthetic/中文目录/'+('long-path-'.repeat(9))+'/browser-check.mjs',cwd:'/synthetic/临时目录',reason:'使用一次性配置验证截图，不使用日常浏览器资料。',availableDecisions:['accept','decline']}};
 const opened=name==='free'?store.interactions.open({runId:'worker-'+name,threadId:'worker-thread',turnId:'turn',requestId:name,source:'ask_main',kind:'question',details:{question:'Worker 的原始问题'},authority:{sourceRequestId:'original',description:'合成来源',nativeApprovals:true}},()=>true):approvals.open(native,scope);
 if(name==='free')store.interactions.escalate(opened.id,'你希望问题说明重点包含哪些内容？','需要确认说明范围');
 new WebHistoryPages(store.history,store.processes,store.inputs);
 const state=()=>{const item=store.interactions.inspect(opened.id);return {threadId:thread,messages:withInteractionResponses(store.store.db,store.history.list(thread).filter(m=>m.role==='user'||m.text.trim()),thread),interactions:item.responseUserMessageId?[]:[{id:item.id,kind:item.kind,runId:item.runId,question:item.userQuestion,reason:item.escalationReason,approval:item.details.approval,questions:projectQuestions(item.kind,item.details)}],acceptedRequestIds:item.responseUserMessageId?[item.responseUserMessageId]:[],features:{taskOverview:true,nativeQuestionAnswers:true}};};
 const f=await composerFixture({webDir,branding:resolve('assets/branding/odysseus-20261030/homer-odysseus-64.png'),interaction({body,json}){
  submissions++;if(unknown){unknown=false;return json({error:'synthetic_unconfirmed'},503);}
  if(name==='free'){store.history.accept(thread,{...body,interactionId:opened.id});store.interactions.respond(opened.id,{action:'answer',reason:'合成用户答复',answer:'Worker 转述，不展示'},{userMessageId:body.requestId,userText:body.text});}
  else approvals.respond(opened.id,body);
  f.update(state());return json({fresh:true});
 }});f.reset(state());
 return {...f,state,get submissions(){return submissions;},restart(){store.close();store=historyFixture(0,160,false,database);approvals=new MainNativeApprovals(store.interactions,store.history);new WebHistoryPages(store.history,store.processes,store.inputs);f.update(state());},close:async()=>{await f.close();store.close();}};
}
if(process.argv.includes('--serve')){
 const f=await scene('question',0);console.log('Product interaction completion preview: '+f.url);
 process.once('SIGINT',async()=>{await f.close();process.exit(0);});
}else try{
 for(const width of [1440,390,320])for(const name of ['allow','deny','question','free']){
  const f=await scene(name,width),p=await browser.page(f.url,width);
  try{
   await p.navigate();await p.until(()=>!!document.querySelector('[contenteditable=true]')&&!!document.querySelector('.interaction-list button'));
   const click=label=>p.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)});if(!b)throw Error('missing control');b.click();})()`);
   if(name==='allow'||name==='deny'){
    await click(name==='allow'?'允许本次操作':'拒绝本次操作');
    if(name==='allow'){
     await p.until(()=>document.body.textContent.includes('答复尚未确认'));
     assert.equal(await p.evaluate(()=>!!document.querySelector('.interaction-message > [role="group"]')),false);
     await click('允许本次操作');
    }
   }else if(name==='question'){
    await click('版本号和构建号');await p.until(()=>document.body.textContent.includes('面向谁展示？'));await click('所有用户');
   }else{
    await click('回答此问题');await p.evaluate(()=>document.querySelector('[contenteditable=true]').focus());await p.command('Input.insertText',{text:'重点说明已确认的原因。\n验证结果和剩余限制。'});
    await p.evaluate(()=>document.querySelector('button[aria-label="提交答复"]').click());
   }
   await p.until(()=>!!document.querySelector('.interaction-message > [role="group"]'));
   const before=await p.evaluate(()=>{
    const group=document.querySelector('.interaction-message > [role="group"]'),receipt=group.querySelector('[data-slot="question-flow"]'),approval=group.querySelector('[data-slot="approval-card"]'),paper=receipt??approval??group;
    return {text:group.innerText,count:document.querySelectorAll('.interaction-message > [role="group"]').length,background:getComputedStyle(paper).backgroundColor,left:paper.getBoundingClientRect().left,parent:document.querySelector('.messages').getBoundingClientRect().left,overflow:document.documentElement.scrollWidth>innerWidth,buttons:group.querySelectorAll('button,details').length,receipt:receipt?.dataset.state??null,approval:!!approval,decision:approval?.querySelector('[role="status"]')?.textContent??null};
   });
   assert.equal(before.count,1);assert.equal(before.background,'rgb(255, 255, 255)');assert.equal(before.left,before.parent);assert.equal(before.overflow,false);assert.equal(before.buttons,0);assert.equal(before.receipt,['question','free'].includes(name)?'receipt':null);
   assert.doesNotMatch(before.text,/你的回答|决定已接收|查看完整|查看原问题|Worker 转述/);
   assert.equal(await p.evaluate(()=>!!document.querySelector('.completed-interaction-navigation')),false);
   if(['allow','deny'].includes(name)){assert.equal(before.approval,true);assert.equal(before.decision,name==='allow'?'你已允许本次操作':'你已拒绝本次操作');}
   if(name==='free')assert.match(before.text,/原因。\n验证结果/);
   assert.match(before.text,name==='allow'?/你已允许本次操作/:name==='deny'?/你已拒绝本次操作/:name==='question'?/版本信息如何显示？[\s\S]*版本号和构建号[\s\S]*面向谁展示？[\s\S]*所有用户/:/重点说明已确认/);
   await p.command('Page.reload');await p.until(()=>!!document.querySelector('.interaction-message > [role="group"]'));
   assert.equal(await p.evaluate(()=>document.querySelector('.interaction-message > [role="group"]').innerText),before.text);
   f.restart();await p.command('Page.reload');await p.until(()=>!!document.querySelector('.interaction-message > [role="group"]'));
   assert.equal(await p.evaluate(()=>document.querySelector('.interaction-message > [role="group"]').innerText),before.text);
   await p.evaluate(()=>document.querySelector('.interaction-message > [role="group"]').scrollIntoView({block:'center'}));await p.screenshot(name+'-'+width+'.png');
   assert.deepEqual(p.errors,[]);assert.deepEqual(p.blocked,[]);assert.equal(f.submissions,name==='allow'?2:1);
   results.push({width,name,passed:true,unknownReceipt:name==='allow',refresh:true,reopenedDatabase:true});
  }finally{await p.close();await f.close();}
 }
 writeFileSync(join(destination,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify({passed:results.length,results}));
}finally{await browser?.close();}
