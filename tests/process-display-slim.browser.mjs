// Real bundled UI + synthetic HTTP/SSE; no engine, account or external calls.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {composerFixture} from './fixtures/composer-browser-server.mjs';
import {openBrowser} from './helpers/image-zoom-browser.mjs';
const destination=resolve(process.env.HOMER_BROWSER_EVIDENCE),webDir=resolve(process.env.HOMER_COMPONENT_BUILD);mkdirSync(destination,{recursive:true});
const decisions=[];let state;
const fixture=await composerFixture({webDir,beforeDir:webDir,branding:resolve('assets/branding/odysseus-20261030/homer-odysseus-256.png'),interaction:({body,json})=>{
 decisions.push(body);state={...state,interactions:[],acceptedRequestIds:[body.requestId],messages:[...state.messages,{id:'decision',threadId:'composer-review',role:'user',text:'拒绝本次操作',status:'completed',createdAt:1700000005000,interaction:{id:'approval',kind:'authorization',title:'合成操作审批',scope:'仅隔离测试',answers:[{text:'你已拒绝本次操作'}]}}]};fixture.reset(state);json({ok:true});
}});
const chrome=await openBrowser(destination,{mockKeychain:true}),checks=[];let failure,exit;
const worker={id:'worker',taskId:'task',title:'合成 Worker',pendingUser:0,pendingMain:0,pendingUsers:[],run:{id:'run',taskId:'task',workerId:'worker',version:1,epoch:1,threadId:'worker-thread',turnId:'worker-turn',status:'running',phase:'executing',createdAt:1700000000000,startedAt:1700000001000,endedAt:null}};
const task={id:'task',title:'合成精简事项',goal:'保留原文与审批',notes:'',headVersion:1,revision:1,state:'open',controlState:'normal',historyState:'visible',workers:[worker]};
const processNode={id:'process',messageId:'reply',threadId:'composer-review',seq:1,revision:1,sourceKind:'user',sourceMessageIds:[],turnIds:['turn'],state:'working',status:'running',items:[...['running','completed','failed','declined','interrupted','unknown','blocked'].map((status,i)=>({id:'tool-'+i,kind:'tool',seq:i+1,revision:1,status,label:'PRIVATE_TOOL',content:{input:{state:'recorded',value:'PRIVATE_INPUT'},output:{state:'recorded',value:'PRIVATE_OUTPUT'}}})),{id:'progress',kind:'commentary',seq:8,revision:1,phase:'commentary',text:'PRIVATE_PROGRESS'},{id:'final',kind:'commentary',seq:9,revision:1,phase:'final_answer',turnId:'turn',itemId:'final',text:'正式正文与事项标题保持。',completed:true},{id:'event',kind:'workerEvent',seq:10,revision:1,eventKey:'receipt',event:{eventKind:'reply_received',title:'合成精简事项',bodySource:'reply',body:'Worker 原始反馈预览'}}]};
const message={id:'reply',threadId:'composer-review',role:'assistant',text:'正式正文与事项标题保持。',status:'running',createdAt:1700000000000,process:processNode,taskSources:[{key:'task',target:{taskId:'task',version:1},title:'合成精简事项'}]};
try{
 for(const width of [1080,390]){
  const context=await chrome.browser.newContext({viewport:{width,height:1000}}),page=await context.newPage(),errors=[],requests=[];
  page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(String(e)));page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/'))requests.push(new URL(r.url()).pathname);});
  await page.route('**/api/tasks**',route=>{const path=new URL(route.request().url()).pathname,value=path==='/api/tasks'?{tasks:[task]}:path.includes('/workers/')?{taskId:'task',conversation:{taskId:'task',workerId:'worker',messages:[{id:'original',seq:1,kind:'worker_reply',version:1,text:'可读取的 Worker 原始反馈',offset:0,nextOffset:null}],nextCursor:null}}:{taskId:'task',runs:[worker.run],requirements:[],artifacts:[]};return route.fulfill({contentType:'application/json',body:JSON.stringify(value)});});
  state={features:{draftUpload:true,taskOverview:true},messages:[message],interactions:[{id:'approval',kind:'authorization',runId:'run',question:'合成操作审批',reason:'确认原请求',approval:{title:'合成操作审批',scope:'仅隔离测试',details:'node synthetic-check.mjs'}}]};fixture.reset(state);
  await page.goto(fixture.url);await page.getByText('正式正文与事项标题保持。',{exact:true}).waitFor();assert.equal(new URL(page.url()).origin,new URL(fixture.url).origin);assert.ok(await page.title());assert.equal(await page.locator('vite-error-overlay').count(),0);
  assert.ok((await page.locator('.message-task-title').allTextContents()).includes('合成精简事项'));assert.doesNotMatch(await page.locator('body').innerText(),/PRIVATE_|当前对话 ·|过程耗时/);assert.equal(await page.locator('[data-tool-id]').count(),0);
  const fold=page.locator('.process-node > [data-slot="collapsible-trigger"]');await fold.click();assert.equal(await fold.getAttribute('aria-busy'),null);
  await page.locator('[data-worker-event="receipt"] button').click();await page.getByText('Worker 原始反馈预览',{exact:true}).waitFor();
  state={...state,messages:[{...message,status:'completed',process:{...processNode,state:'worked',status:'completed',revision:2}}]};fixture.reset(state);await page.waitForFunction(()=>document.querySelector('[data-conversation-message="reply"]')?.getAttribute('data-process-completed')==='true');
  await fold.focus();await fold.click();await page.waitForFunction(()=>document.activeElement?.id==='message-reply');assert.equal(await page.locator('.process-node').count(),0);
  await page.getByRole('button',{name:/工作状态/}).click();await page.locator('.status-row-trigger').first().click();
  await page.getByRole('button',{name:'执行记录',exact:true}).click();await page.getByRole('button',{name:'会话原文',exact:true}).click();await page.getByText('可读取的 Worker 原始反馈',{exact:true}).waitFor();assert.doesNotMatch(await page.locator('body').innerText(),/近期内存记录|参数与结果|工具步骤尚未接入/);
  assert.ok(!requests.some(path=>/\/progress$|\/execution\/|\/history\/process/.test(path)),requests.join('\n'));await page.screenshot({path:join(destination,'worker-original-'+width+'.png')});
  // Resetting the viewport reloads the same persisted synthetic scene with the panel closed.
  await page.reload();await page.getByRole('button',{name:'拒绝本次操作',exact:true}).click();await page.getByText('你已拒绝本次操作',{exact:true}).waitFor();assert.equal(decisions.at(-1)?.text,'拒绝本次操作');
  await page.screenshot({path:join(destination,'message-approval-'+width+'.png')});assert.deepEqual(errors,[]);checks.push({width,title:true,formalAnswer:true,noToolParts:true,noProgressReads:true,staticReceipt:true,focusTransferred:true,workerOriginal:true,approvalDecision:true,consoleErrors:errors});await context.close();
 }
}catch(error){failure=error;const page=chrome.browser.contexts().flatMap(c=>c.pages()).at(-1);if(page){await page.screenshot({path:join(destination,'failure.png')}).catch(()=>{});writeFileSync(join(destination,'failure.txt'),await page.locator('body').innerText().catch(()=>''));}}finally{exit=await chrome.finish();await fixture.close();writeFileSync(join(destination,'result.json'),JSON.stringify({checks,exit,failure:failure?String(failure):null},null,2));}
if(failure)throw failure;assert.equal(exit.code,0);assert.equal(exit.watchdog,false);assert.equal(exit.forced,false);console.log(JSON.stringify({checks,exit}));
