// Requirement-derived input only. Real product bundle, HTTP authorization,
// execution-boundary adapters and SQLite owners; no spawned engine/account.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fixture} from './web-history-followup-fixture.mjs';
import {isolatedChrome} from './web-history-browser-cdp.mjs';
import {CodexEngine} from '../src/engine.ts';
import {Homer} from '../src/service.ts';
import {MainNativeApprovals} from '../src/main-native-approvals.ts';
import {nativeResponse} from '../src/worker-interaction-protocol.ts';
const destination=resolve(process.env.HOMER_BROWSER_EVIDENCE??'.codex/scratch/run-activity-official-tool-implementation-20261025/browser');
mkdirSync(destination,{recursive:true});
const browser=await isolatedChrome(destination),results=[];
const key=async(p,value,code,number)=>{await p.command('Input.dispatchKeyEvent',{type:'keyDown',key:value,code,windowsVirtualKeyCode:number,...(value==='Enter'?{text:'\r'}:value===' '?{text:' '}:{})});await p.command('Input.dispatchKeyEvent',{type:'keyUp',key:value,code,windowsVirtualKeyCode:number});};
async function setup(){
 const f=await fixture(4,'after'),reads=[],callbacks=[];
 const reset=n=>{
  const name='publicMainNode:v1:node-'+n,node=JSON.parse(f.store.meta(name));
  delete node.final;node.items=[];node.completedItemIds=[];node.state='working';node.status='running';node.revision++;
  f.store.setMeta(name,JSON.stringify(node));
  f.store.db.prepare("UPDATE conversation_messages SET text='',status='running' WHERE id=?").run('node-'+n);
 };
 const native=n=>{
  const engine=new CodexEngine({runtime:'/synthetic',workspace:process.cwd(),codexHome:'/synthetic'},{cwd:process.cwd(),readRoots:[],instructions:'',tools:[],nativeTools:'main'},async()=>({}));
  engine.threadId='synthetic-history';engine.turnId='turn-'+n;engine.active={text:'',messages:[],earlyEvents:[],resolve:()=>{}};engine.refreshBackground=async()=>{};
  engine.on('nativeProcess',event=>f.processes.native('node-'+n,event));
  return async(item,completed=true)=>{await engine.receive(JSON.stringify({method:completed?'item/completed':'item/started',params:{threadId:'synthetic-history',turnId:'turn-'+n,item}}));};
 };
 reset(3);const receive=native(3);
 await receive({id:'command',type:'commandExecution',command:'cat synthetic.txt',cwd:'/synthetic',aggregatedOutput:'合成文件正文',exitCode:0,status:'completed'});
 await receive({id:'mcp',type:'mcpToolCall',server:'synthetic',tool:'lookup',arguments:{query:'合成查询',password:'FICTIONAL_DO_NOT_STORE'},result:{content:[{type:'text',text:'合成 MCP 返回'}]},status:'completed'});
 await receive({id:'dynamic',type:'dynamicToolCall',tool:'synthetic_dynamic',arguments:false,contentItems:0,status:'completed',success:true});
 const app=Object.create(Homer.prototype);Object.assign(app,{processes:f.processes,mainContext:{event:true,processId:'node-3',nativeActivity:{turnId:'turn-3'}},mainActor:()=>({}),tasks:{captureActivity:()=>undefined}});
 await app.mainActivity('inspect_run',async()=>({body:'合成宿主返回'}),{id:'合成宿主参数',authorization:'FICTIONAL_DO_NOT_STORE'});
 f.processes.workerEvent('node-3',{eventKey:'stable-worker',eventKind:'delegated',title:'合成交办记录',body:'合成固定事件正文',bodySource:'description',taskId:'synthetic-task',version:1,runId:'synthetic-run',resultId:null,sourceMessageId:null,operationKey:'synthetic-op',observedAtMs:1});
 f.processes.agent('node-3',{turnId:'turn-3',itemId:'final',phase:'final_answer',text:'正式答复仅一次。',completed:true});f.processes.finish('node-3','completed','end-3');
 reset(2);const error=native(2);await error({id:'failure',type:'mcpToolCall',server:'synthetic',tool:'failed_lookup',arguments:{query:'失败合成'},result:{isError:true,content:[]},error:{message:'合成工具错误'},status:'failed'});f.processes.finish('node-2','completed','end-2');
 reset(1);f.processes.tool('node-1',{id:'legacy',label:'检查资料',phase:'end',status:'completed'});f.processes.finish('node-1','completed','end-1');
 reset(0);const live=native(0);await live({id:'live',type:'dynamicToolCall',tool:'synthetic_live',arguments:{query:'运行中'},startedAtMs:Date.now()-5000,status:'inProgress'},false);
 let fresh=true;const state=f.bridge.history.state;
 f.bridge.history.state=async()=>({...await state(),mainActivity:fresh?{processId:'node-0',source:'user',turnId:'turn-0',stage:'native'}:null,generation:fresh?{turnId:'turn-0',generationId:'synthetic-generation',messageId:'node-0'}:null});
 const actual=f.bridge.history.process;f.bridge.history.process=async input=>{reads.push(input.id);return actual(input);};
 const approvals=new MainNativeApprovals(f.interactions,f.history);let responseCount=0;
 f.bridge.respond=async(id,input)=>{responseCount++;return approvals.respond(id,input);};
 const scope={threadId:'synthetic-history',turnId:'turn-0',generationId:'synthetic-generation',sourceRequestId:'request-0',userText:'合成本次授权',isCurrent:()=>true};
 const request={requestId:1,method:'item/commandExecution/requestApproval',threadId:'synthetic-history',turnId:'turn-0',itemId:'live',kind:'authorization',details:{command:'echo synthetic',availableDecisions:['accept','decline']}};
 return {...f,reads,live,request,approvals,callbacks,setFresh(value){fresh=value;f.server.publish();},approval:()=>{const opened=approvals.open(request,scope);opened.response.then(value=>callbacks.push(nativeResponse(request,value.decision)));f.server.publish();return opened;},responses:()=>responseCount};
}
try{
 for(const width of [1440,390,320]){
  const f=await setup(),p=await browser.page(f.server.url,width),checks=[];
  const until=expression=>p.until(typeof expression==='function'?'Boolean(('+expression.toString()+')())':expression,10000),ev=expression=>p.evaluate(expression);
  const outer='#message-node-3 [data-slot=run-activity] > [data-slot=collapsible] > [data-slot=collapsible-trigger]';
  try{
   await p.navigate();await until(()=>document.querySelector('#message-node-3 .assistant-message-bubble')?.textContent.includes('正式答复仅一次。'));
   await p.command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
   assert.deepEqual(f.reads,[],'closed headers do not read call bodies');
   await ev(()=>{window.__worker=document.querySelector('[data-worker-event=stable-worker]');window.__workerParent=window.__worker.parentNode;window.__worker.querySelector('button').click();});
   await ev(`document.querySelector('${outer}').focus({preventScroll:true})`);await key(p,' ','Space',32);
   await until(()=>document.querySelectorAll('#message-node-3 [data-slot=tool-fallback-trigger]').length===4);
   assert.equal(f.reads.filter(id=>id==='node-3').length,1);
   const api=f.processes.exact('node-3');assert.doesNotMatch(JSON.stringify(api),/FICTIONAL_DO_NOT_STORE/);
   assert.ok(await ev(()=>[...document.querySelectorAll('#message-node-3 [data-tool-id]')].every(e=>e.tagName==='DIV')));
   await ev(()=>document.querySelector('#message-node-3 [data-slot=tool-fallback-trigger]').focus({preventScroll:true}));await key(p,'Enter','Enter',13);
   await until(()=>document.querySelector('#message-node-3 [data-slot=tool-fallback-args]'));
   await ev(()=>{for(const button of document.querySelectorAll('#message-node-3 [data-slot=tool-fallback-trigger]'))if(button.getAttribute('aria-expanded')!=='true')button.click();});
   await until(()=>document.querySelectorAll('#message-node-3 [data-slot=tool-fallback-result]').length===4);
   const body=await ev(()=>document.querySelector('#message-node-3').textContent);
   for(const text of ['cat synthetic.txt','合成文件正文','合成查询','合成 MCP 返回','合成宿主参数','合成宿主返回','false','0','明确凭据已遮蔽'])assert.ok(body.includes(text),text);
   assert.doesNotMatch(body,/FICTIONAL_DO_NOT_STORE/);
   assert.equal(await ev(()=>document.querySelector('#message-node-3 .assistant-message-bubble').textContent),'正式答复仅一次。');
   assert.equal(await ev(()=>document.querySelector('#message-node-3 [data-aui-quote-selectable]').querySelectorAll('[data-tool-id]').length),0);
   assert.equal(await ev(()=>document.documentElement.scrollWidth>innerWidth),false);
   await ev(()=>document.querySelector('#message-node-3').scrollIntoView({block:'start'}));await p.screenshot('expanded-'+width+'.png');
   checks.push('real native/host capture -> persistence -> authorized lazy API -> same-message parts -> official Args/Result; keyboard outer disclosure; no overflow');
   await ev(`document.querySelector('${outer}').click()`);await until(()=>document.querySelector('#message-node-3 [data-slot=run-activity] > [data-slot=collapsible] > button').getAttribute('aria-expanded')==='false');
   assert.ok(await ev(()=>window.__worker===document.querySelector('[data-worker-event=stable-worker]')&&window.__worker.parentNode===window.__workerParent&&window.__worker.querySelector('button').getAttribute('aria-expanded')==='true'));
   await ev(`document.querySelector('${outer}').click()`);await until(()=>document.querySelectorAll('#message-node-3 [data-slot=tool-fallback-trigger]').length===4);assert.equal(f.reads.filter(id=>id==='node-3').length,1);
   await ev(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:text=>{window.__copied=text;return Promise.resolve();}}});document.querySelector('#message-node-3 button[aria-label="复制"]').click();});await until(()=>window.__copied==='正式答复仅一次。');
   await ev(()=>document.querySelector('#message-node-3 button[aria-label="引用"]').click());await until(()=>document.querySelector('[data-slot=composer-quote]')?.textContent.includes('正式答复仅一次。'));
   checks.push('copy/reference only formal body; cached detail survives folding; immutable Worker card retains DOM, parent and local disclosure');
   await ev(()=>document.querySelector('#message-node-2 [data-slot=run-activity] button').click());await until(()=>!!document.querySelector('#message-node-2 [data-tool-id]'));
   assert.ok(await ev(()=>document.querySelector('#message-node-2 [data-slot=tool-fallback-trigger]').textContent.includes('调用失败')));
   assert.equal(await ev(()=>!!document.querySelector('#message-node-2 [data-slot=run-activity] ol [data-tool-id]')),true);
   assert.ok(await ev(()=>document.querySelector('#message-node-2 [data-slot=run-activity]').textContent.includes('Worked')));
   await ev(()=>document.querySelector('#message-node-2 [data-slot=tool-fallback-trigger]').click());await until(()=>document.querySelector('#message-node-2 [data-slot=tool-fallback-error]')&&document.querySelector('#message-node-2 [data-slot=tool-fallback-result]'));
   assert.ok(await ev(()=>document.querySelector('#message-node-2 [data-slot=tool-fallback-result]').textContent.includes('合成工具错误')));
   await ev(()=>document.querySelector('#message-node-2 [data-slot=run-activity] > [data-slot=collapsible] > button').click());
   await until(()=>!document.querySelector('#message-node-2 [data-tool-id]')?.checkVisibility());
   assert.equal(await ev(()=>[...document.querySelectorAll('#message-node-2 [data-tool-id]')].filter(e=>e.checkVisibility()).length),0);
   await ev(()=>document.querySelector('#message-node-1 [data-slot=run-activity] button').click());await until(()=>!!document.querySelector('#message-node-1 [data-slot=tool-fallback-trigger]'));await ev(()=>document.querySelector('#message-node-1 [data-slot=tool-fallback-trigger]').click());await until(()=>document.querySelector('#message-node-1 [role=note]')?.textContent.includes('当时未保存'));
   assert.equal(await ev(()=>document.querySelectorAll('#message-node-1 [data-slot=tool-fallback-result]').length),0);
   checks.push('failed tool Error/Result remains inside Worked and disappears when folded; old records explicitly not recorded without fake Result');
   await ev(()=>document.querySelector('#message-node-0 [data-slot=run-activity] button').click());await until(()=>!!document.querySelector('#message-node-0 [data-slot=tool-fallback-trigger]'));assert.ok(await ev(()=>document.querySelector('#message-node-0 [data-slot=tool-fallback-trigger]').textContent.includes('调用中')));
   assert.ok(await ev(()=>!!document.querySelector('#message-node-0 [data-slot=tool-fallback-trigger] .animate-spin')));
   f.setFresh(false);await until(()=>document.querySelector('#message-node-0 [data-slot=tool-fallback-trigger]').textContent.includes('上次调用中'));
   assert.equal(await ev(()=>!!document.querySelector('#message-node-0 .animate-spin,#message-node-0 [data-slot=tool-fallback-duration]')),false);
   f.setFresh(true);await until(()=>!document.querySelector('#message-node-0 [data-slot=tool-fallback-trigger]').textContent.includes('上次'));
   await ev(()=>document.querySelector('#message-node-0 [data-slot=tool-fallback-trigger]').click());await until(()=>document.querySelector('#message-node-0 [data-slot=tool-fallback-args]'));
   await ev(()=>{const range=document.createRange();range.selectNodeContents(document.querySelector('#message-node-0 [data-slot=tool-fallback-args] pre'));getSelection().removeAllRanges();getSelection().addRange(range);document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));});
   await ev(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   assert.equal(await ev(()=>!!document.querySelector('[data-slot=selection-toolbar-quote]')),false);await ev(()=>getSelection().removeAllRanges());
   checks.push('current thread/turn required for running icon/timer; stale observation freezes; process-only message cannot enter selected-text quote');
   const approval=f.approval();await until(()=>!!document.querySelector('[data-slot=approval-card]'));
   assert.equal(await ev(()=>document.querySelectorAll('[data-slot=tool-fallback-approval] button').length),0);
   await ev(()=>[...document.querySelectorAll('[data-slot=approval-card] button')].find(e=>e.textContent.includes('允许本次操作')).click());
   await until(()=>!document.querySelector('[data-slot=approval-card]')||document.querySelector('[data-slot=approval-card]').textContent.includes('决定已送达'));
   assert.equal(f.responses(),1);assert.equal(f.callbacks.length,1);assert.deepEqual(f.callbacks[0],{decision:'accept'});assert.equal(f.interactions.inspect(approval.id).decision.action,'approve');
   f.approvals.end('synthetic-generation');f.server.publish();
   checks.push('original real approval protocol simulated once; native only-once decision, no extra official-tool buttons or business call');
   for(const status of ['declined','interrupted','unknown'])await f.live({id:'state-'+status,type:'dynamicToolCall',tool:'synthetic_'+status,arguments:{query:status},status,contentItems:null});
   f.processes.tool('node-0',{id:'state-blocked',label:'调用工具',phase:'end',status:'blocked'});
   for(const [id,value]of [['false',false],['zero',0],['null',null],['empty',''],['large','大'.repeat(100000)]])await f.live({id:'value-'+id,type:'dynamicToolCall',tool:'synthetic_'+id,arguments:{query:id},status:'completed',contentItems:value});
   f.server.publish();await until(()=>document.querySelector('#message-node-0 [data-tool-status=blocked]'));
   const labels=await ev(()=>[...document.querySelectorAll('#message-node-0 [data-tool-status]')].map(e=>[e.dataset.toolStatus,e.querySelector('button')?.textContent]));
   for(const label of ['调用被拒绝','调用已中断','结束状态待核实','调用受阻'])assert.ok(labels.some(([,text])=>text.includes(label)),label);
   await ev(()=>{for(const button of document.querySelectorAll('#message-node-0 [data-slot=tool-fallback-trigger]'))if(button.getAttribute('aria-expanded')!=='true')button.click();});
   await until(()=>document.querySelector('#message-node-0').textContent.includes('结果为空字符串'));
   assert.ok(await ev(()=>document.querySelector('#message-node-0').textContent.includes('已省略超限内容')));assert.equal(await ev(()=>document.documentElement.scrollWidth>innerWidth),false);
   checks.push('declined/interrupted/unknown/blocked use distinct labels; false/0/null/empty and bounded omission remain distinguishable in real official renderer');
   f.processes.agent('node-0',{turnId:'turn-0',itemId:'stream-answer',phase:'final_answer',text:'流式正式答复',completed:false});f.server.publish();
   await until(()=>document.querySelector('#message-node-0 .assistant-message-bubble')?.textContent==='流式正式答复');
   await ev(()=>document.querySelector('#message-node-0 button[aria-label="复制"]').click());await until(()=>window.__copied==='流式正式答复');
   f.processes.agent('node-0',{turnId:'turn-0',itemId:'stream-answer',delta:'继续更新。',completed:false});f.server.publish();
   await until(()=>document.querySelector('#message-node-0 .assistant-message-bubble')?.textContent==='流式正式答复继续更新。');
   await ev(()=>document.querySelector('#message-node-0 button[aria-label="复制"]').click());await until(()=>window.__copied==='流式正式答复继续更新。');
   assert.ok(await ev(()=>!!document.querySelector('#message-node-0 [data-tool-status=declined]')?.closest('ol')));
   checks.push('streaming formal answer retains one bubble and copies current body only; abnormal calls stay in the original process list');
   assert.deepEqual(p.errors,[]);assert.deepEqual(p.blocked,[]);assert.equal(f.fakeEngine.invocations,0);assert.equal(f.submitted.length,0);assert.equal(f.stopped.length,0);
   results.push({width,checks,passed:true,reads:f.reads,network:p.requests});
  }catch(error){await p.screenshot('failure-'+width+'.png');writeFileSync(join(destination,'failure-'+width+'.json'),JSON.stringify({error:String(error),body:await ev(()=>document.body.innerText),errors:p.errors},null,2));throw error;}
  finally{await p.close();await f.close();}
 }
}finally{await browser.close();writeFileSync(join(destination,'results.json'),JSON.stringify({syntheticOnly:true,browser:browser.version,results},null,2));}
console.log(JSON.stringify({passed:results.length,widths:results.map(r=>r.width)}));
