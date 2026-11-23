// Real bundled UI + synthetic HTTP/SSE; no engine, account or external calls.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {composerFixture} from './fixtures/composer-browser-server.mjs';
import {openBrowser} from './helpers/image-zoom-browser.mjs';
const destination=resolve(process.env.HOMER_BROWSER_EVIDENCE),webDir=resolve(process.env.HOMER_COMPONENT_BUILD);mkdirSync(destination,{recursive:true});
const decisions=[];let state;
const pageReads=[];
const fixture=await composerFixture({webDir,beforeDir:webDir,branding:resolve('assets/branding/odysseus-20261030/homer-odysseus-256.png'),historyPage:({body,json,revision})=>{
 pageReads.push(body.request.around);
 if(body.request.around!==older.id)return json({error:'history_message_not_found'},404);
 const messages=[older,...state.messages];
 json({protocol:3,threadId:older.threadId,revision,messages,units:messages.map(m=>m.id),before:null,after:null,artifacts:state.artifacts});
},interaction:({body,json})=>{
 decisions.push(body);state={...state,interactions:[],acceptedRequestIds:[body.requestId],messages:[...state.messages,{id:'decision',threadId:'composer-review',role:'user',text:'拒绝本次操作',status:'completed',createdAt:1700000005000,interaction:{id:'approval',kind:'authorization',title:'合成操作审批',scope:'仅隔离测试',answers:[{text:'你已拒绝本次操作'}]}}]};fixture.reset(state);json({ok:true});
}});
const chrome=await openBrowser(destination,{mockKeychain:true}),checks=[];let failure,exit;
const worker={id:'worker',taskId:'task',title:'合成 Worker',pendingUser:0,pendingMain:0,pendingUsers:[],run:{id:'run',taskId:'task',workerId:'worker',version:1,epoch:1,threadId:'worker-thread',turnId:'worker-turn',status:'running',phase:'executing',createdAt:1700000000000,startedAt:1700000001000,endedAt:null}};
const task={id:'task',title:'合成精简事项',goal:'保留原文与审批',notes:'',headVersion:1,revision:1,state:'open',controlState:'normal',historyState:'visible',workers:[worker]};
const processNode={id:'process',messageId:'reply',threadId:'composer-review',seq:1,revision:1,sourceKind:'user',sourceMessageIds:[],turnIds:['turn'],state:'working',status:'running',items:[...['running','completed','failed','declined','interrupted','unknown','blocked'].map((status,i)=>({id:'tool-'+i,kind:'tool',seq:i+1,revision:1,status,label:'PRIVATE_TOOL',content:{input:{state:'recorded',value:'PRIVATE_INPUT'},output:{state:'recorded',value:'PRIVATE_OUTPUT'}}})),{id:'progress',kind:'commentary',seq:8,revision:1,phase:'commentary',text:'PRIVATE_PROGRESS'},{id:'final',kind:'commentary',seq:9,revision:1,phase:'final_answer',turnId:'turn',itemId:'final',text:'正式正文与事项标题保持。',completed:true},{id:'event',kind:'workerEvent',seq:10,revision:1,eventKey:'receipt',event:{eventKind:'reply_received',title:'合成精简事项',bodySource:'reply',body:'Worker 原始反馈预览'}}]};
const message={id:'reply',threadId:'composer-review',role:'assistant',text:'正式正文与事项标题保持。',status:'running',createdAt:1700000000000,process:processNode,taskSources:[{key:'task',target:{taskId:'task',version:1},title:'合成精简事项'}]};
const silent={...message,id:'silent',text:'',createdAt:1699900000000,taskSources:[],process:{...processNode,id:'silent',messageId:'silent',items:[
 {id:'delegation',kind:'workerEvent',seq:1,revision:1,eventKey:'delegate',event:{eventKind:'delegated',title:'隐藏的交办标题',bodySource:'description',body:'隐藏的交办原文'}},
 {id:'legacy',kind:'worker',seq:2,revision:1,label:'旧后台工作记录'},
]}};
const older={...silent,id:'older',status:'completed',createdAt:1699800000000,process:{...silent.process,id:'older',messageId:'older',state:'worked',status:'completed'}};
const failed={...message,id:'failed',text:'',status:'completed',taskSources:[],taskSourceUnresolved:true,process:{...processNode,id:'failed',messageId:'failed',state:'worked',status:'completed',items:[
 {id:'failure',kind:'workerEvent',seq:1,revision:1,eventKey:'failure',event:{eventKind:'start_failed',title:'核对合成附件',bodySource:'error',body:'认证失败，请检查模型连接。'}},
]}};
const quoted={id:'quoted',threadId:message.threadId,role:'user',text:'核对旧记录的位置',status:'completed',createdAt:1700000003000,quotes:[{messageId:older.id,text:'旧版摘录'}]};
const artifact={id:'file',title:'合成成果.txt',messageId:message.id};
try{
 for(const width of [1080,390]){
  const context=await chrome.browser.newContext({viewport:{width,height:1000}}),page=await context.newPage(),errors=[],requests=[];
  page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(String(e)));page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/'))requests.push(new URL(r.url()).pathname);});
  await page.route('**/api/tasks',route=>route.fulfill({json:{tasks:[task]}}));
  state={features:{draftUpload:true,taskOverview:true},messages:[silent,message,failed,quoted],artifacts:[artifact],inactiveInteractions:[{id:'expired',kind:'authorization',state:'expired',processId:'failed',sourceRequestId:'old-request'}],interactions:[{id:'approval',kind:'authorization',runId:'run',question:'合成操作审批',reason:'确认原请求',approval:{title:'合成操作审批',scope:'仅隔离测试',details:'node synthetic-check.mjs'}}]};fixture.reset(state);
  await page.goto(fixture.url);await page.getByText('正式正文与事项标题保持。',{exact:true}).waitFor();assert.equal(new URL(page.url()).origin,new URL(fixture.url).origin);assert.ok(await page.title());assert.equal(await page.locator('vite-error-overlay').count(),0);
  assert.ok((await page.locator('.message-task-title').allTextContents()).includes('合成精简事项'));assert.doesNotMatch(await page.locator('body').innerText(),/PRIVATE_|当前对话 ·|过程耗时/);assert.equal(await page.locator('[data-tool-id]').count(),0);
  const hidden=page.locator('#message-silent');
  const rowHeight=(row=hidden)=>row.evaluate(node=>({anchor:node.getBoundingClientRect().height,row:node.parentElement.getBoundingClientRect().height}));
  assert.deepEqual(await rowHeight(),{anchor:0,row:0});
  assert.equal(await page.locator('.process-node,[data-worker-event],.process-workers').count(),0);
  assert.doesNotMatch(await page.locator('body').innerText(),/协作记录|回传预览|Worker 原始反馈预览|隐藏的交办|旧后台工作记录/);
  assert.ok(await page.getByText('核对合成附件 · 认证失败，请检查模型连接。',{exact:true}).isVisible());
  assert.ok(await page.getByText('部分任务来源尚未核实。',{exact:true}).isVisible());
  assert.ok(await page.getByText('原授权请求已失效，旧决定不能恢复此回调。可在原事项对话核对当前状态。',{exact:true}).isVisible());
  assert.ok(await page.getByRole('button',{name:'预览 合成成果.txt',exact:true}).isVisible());
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const focus=page.getByRole('button',{name:'拒绝本次操作',exact:true});
  await focus.focus();
  const finalText='正式正文与事项标题保持。已完成。';
  state={...state,messages:[{...silent,status:'completed',process:{...silent.process,state:'worked',status:'completed',revision:2}},{...message,text:finalText,status:'completed',process:{...processNode,state:'worked',status:'completed',revision:2,items:processNode.items.map(item=>item.id==='final'?{...item,text:finalText}:item)}},failed,quoted]};
  fixture.reset(state);
  await page.getByText(finalText,{exact:true}).waitFor();
  assert.deepEqual(await rowHeight(),{anchor:0,row:0});
  assert.ok(await focus.evaluate(node=>document.activeElement===node));
  assert.equal(await page.locator('#message-older').count(),0);
  await page.getByRole('link',{name:'查看引用 1 的原消息',exact:true}).press('Enter');
  await page.getByText('原消息已定位；原文暂无法准确定位，摘录与批注已保留。',{exact:true}).waitFor();
  assert.equal(pageReads.at(-1),older.id);
  assert.deepEqual(await rowHeight(page.locator('#message-older')),{anchor:0,row:0});
  assert.ok(await page.locator('.thread-viewport').evaluate(node=>document.activeElement===node));
  await page.getByRole('button',{name:'工作状态',exact:true}).click();
  const row=page.locator('#task-status-panel [data-slot="task-status-row"]');await row.click();
  assert.equal(await row.innerText(),'合成精简事项');assert.equal(await row.locator('button, [aria-expanded]').count(),0);
  assert.ok(!requests.some(path=>/^\/api\/tasks\/task(?:\/|$)|\/execution\/|\/history\/process/.test(path)),requests.join('\n'));await page.screenshot({path:join(destination,'work-status-'+width+'.png')});
  // Resetting the viewport reloads the same persisted synthetic scene with the panel closed.
  await page.reload();await page.getByRole('button',{name:'拒绝本次操作',exact:true}).click();await page.getByText('你已拒绝本次操作',{exact:true}).waitFor();assert.equal(decisions.at(-1)?.text,'拒绝本次操作');
  await page.screenshot({path:join(destination,'message-approval-'+width+'.png')});assert.deepEqual(errors,[]);checks.push({width,title:true,formalAnswer:true,noToolParts:true,noProgressReads:true,noCoordinationRows:true,silentAnchor:true,approvalFocusPreserved:true,failureNotice:true,inactiveNotice:true,artifact:true,staticTaskRow:true,approvalDecision:true,consoleErrors:errors});await context.close();
 }
}catch(error){failure=error;const page=chrome.browser.contexts().flatMap(c=>c.pages()).at(-1);if(page){await page.screenshot({path:join(destination,'failure.png')}).catch(()=>{});writeFileSync(join(destination,'failure.txt'),await page.locator('body').innerText().catch(()=>''));}}finally{exit=await chrome.finish();await fixture.close();writeFileSync(join(destination,'result.json'),JSON.stringify({checks,exit,failure:failure?String(failure):null},null,2));}
if(failure)throw failure;assert.equal(exit.code,0);assert.equal(exit.watchdog,false);assert.equal(exit.forced,false);console.log(JSON.stringify({checks,exit}));
