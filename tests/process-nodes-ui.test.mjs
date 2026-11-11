// Migrated from retired UI merge/projection exports to their current owners.
import {test}from'node:test';import assert from'node:assert/strict';import React from'react';import {renderToStaticMarkup}from'react-dom/server';
import {ProcessNodeView,ProcessMessageContent,ProcessObservationContext,ProcessDetailHarness}from'./helpers/process-ui-loader.mjs';import {withDom}from'./helpers/process-dom.mjs';import {projectConversation}from'../src/conversation-projection.ts';import {HistoryWindow}from'../ui/history-window.ts';import {ActiveReadPage}from'../ui/active-read-page.ts';import {historyFixture}from'./web-history-loading-fixture.ts';
import {createRequire} from 'node:module';
import {projectProcessMessage,useProcessParts,useProcessDetails} from './helpers/tool-ui-loader.mjs';
import {ProcessDetailsContext} from './helpers/process-ui-loader.mjs';
// Use the same CJS runtime context as the existing bundled production loader.
const {AssistantRuntimeProvider,ThreadPrimitive,useExternalStoreRuntime,useAuiState}=createRequire(import.meta.url)('@assistant-ui/react');
const node={id:'node',threadId:'t',seq:1,revision:2,sourceKind:'user',sourceMessageIds:['source'],messageId:'reply',state:'working',status:'running',turnIds:['turn'],items:[{id:'commentary',seq:1,revision:1,kind:'commentary',text:'progress'}]},message={id:'reply',threadId:'t',requestId:'source',role:'assistant',text:'OLD CONCATENATED PROGRESS AND FINAL',status:'completed',createdAt:1},h=React.createElement;
const projected=(history,nodes,inbox=[])=>projectConversation(history,nodes,inbox);
const page=(messages,revision=1,units=messages.map(m=>m.id),artifacts=[])=>({protocol:3,threadId:'t',revision,messages,units,queue:[],before:null,after:null,artifacts});
const snapshot=(p)=>({threadId:'t',messages:p.messages,artifacts:p.artifacts,history:{protocol:3,readEpoch:'epoch',page:p}});
test('activity updates keep one header and the original disclosure selection',async()=>withDom(async d=>{
 const observation={connected:true,serviceRunning:true,threadId:'t',generationTurnId:'turn',mainActivity:{processId:'node',source:'user',turnId:'turn',stage:'native',summary:'准备只读诊断'}};
 const render=(activityText,value=node)=>d.render(h(ProcessNodeView,{node:value,activityText,observation,renderText:t=>h('p',null,t)}));
 await render('准备只读诊断');
 const trigger=d.find(n=>n.attrs['data-slot']==='collapsible-trigger');
 assert.match(trigger.textContent,/当前对话 · 准备只读诊断/);assert.doesNotMatch(trigger.textContent,/处理中|具体动作未提供/);
 await d.click(trigger);assert.equal(trigger.attrs['aria-expanded'],'true');
 await render('读取文件');assert.equal(trigger.attrs['aria-expanded'],'true');assert.match(trigger.textContent,/当前对话 · 读取文件/);assert.doesNotMatch(trigger.textContent,/准备只读诊断/);
 await render('准备只读诊断',{...node,state:'worked',status:'completed'});assert.match(trigger.textContent,/当前对话 · 已结束/);assert.doesNotMatch(trigger.textContent,/准备只读诊断/);
}));
test('all call statuses stay inside the disclosure with missing parts or lazy details in live and historical processes',()=>{
 const statuses=['running','completed','failed','declined','interrupted','blocked','unknown'];
 const items=statuses.map((status,i)=>({id:status,seq:i+1,revision:1,kind:'tool',label:'CALL_'+status,status}));
 for(const [state,status] of [['working','running'],['working','completed'],['worked','completed'],['worked','failed'],['worked','interrupted'],['working','unknown']]){
  for(const details of [undefined,'unloaded'])for(const parts of [undefined,{entries:items.map(item=>({id:item.id,kind:'tool',label:item.label,content:h('p',null,item.label)}))}]){
   const html=renderToStaticMarkup(h(ProcessMessageContent,{node:{...node,state,status,details,items:details?[]:items,toolStatusCounts:Object.fromEntries(statuses.map(s=>[s,2]))},parts,renderText:t=>t},h('p',null,'FINAL BODY')));
   assert.doesNotMatch(html,/\d+ 次|data-tool-id|<ol/,`${state}/${status}/${details}/${!!parts}`);
   assert.equal(html.match(/FINAL BODY/g).length,1);
   assert.equal(html.includes('data-slot="run-activity"'),state!=='worked'||status!=='completed',`${state}/${status}`);
  }
 }
});
test('aggregate categories never escape the original disclosure and legacy calls remain readable inside',async()=>withDom(async d=>{
 const counts={failed:2,declined:1,interrupted:3,unknown:4,blocked:5};
 const items=[{id:'progress',seq:1,revision:1,kind:'commentary',text:'PROGRESS'},...Object.entries(counts).flatMap(([status,count])=>Array.from({length:count},(_,i)=>({id:status+i,seq:i+2,revision:1,kind:'tool',label:'检查资料',status})))];
 for(const details of [undefined,'unloaded']){
  await d.render(h(ProcessMessageContent,{node:{...node,state:'worked',status:'failed',details,items:details?[]:items,toolStatusCounts:counts},renderText:t=>t},h('p',null,'FINAL BODY')));
  assert.doesNotMatch(d.container.textContent,/\d+ 次|检查资料/);
  const trigger=d.find(n=>n.attrs['data-slot']==='collapsible-trigger');
  assert.equal(trigger.attrs['aria-expanded'],'false');await d.click(trigger);assert.equal(trigger.attrs['aria-expanded'],'true');
  assert.match(d.container.textContent,details?/过程详情未能读取，请收起后重新展开/:/检查资料 · 调用失败/);
  assert.match(d.container.textContent,/处理失败/);assert.equal(d.container.textContent.match(/FINAL BODY/g).length,1);
  await d.click(trigger);
 }
}));
const renderPartText=t=>h('p',null,t);
function PartsMessage(){
 const process=useAuiState(s=>s.message.metadata.custom.process),parts=useProcessParts(renderPartText);
 return h(ProcessMessageContent,{node:process,parts,renderText:renderPartText},parts.renderAnswers(({text})=>h('p',{'data-final':true},text)));
}
function PartsRuntime({value,load}){
 const source=React.useMemo(()=>[{...message,id:value.messageId,text:'FINAL BODY',process:{...value,items:[...value.items,{id:'turn:body',kind:'commentary',seq:100,revision:1,phase:'final_answer',turnId:'turn',itemId:'body',text:'FINAL BODY',completed:true}]}}],[value]);
 const loadSource=React.useCallback(async(...args)=>{const value=await load(...args);return {...value,items:[...value.items,{id:'turn:body',kind:'commentary',seq:100,revision:1,phase:'final_answer',turnId:'turn',itemId:'body',text:'FINAL BODY',completed:true}]};},[load]);
 const details=useProcessDetails(source,'t','synthetic-epoch',loadSource),current=details.messages[0];
 const messages=React.useMemo(()=>{const projected=projectProcessMessage(current);return [{id:current.id,role:'assistant',content:projected.content,status:{type:'complete',reason:'stop'},metadata:{custom:{activityPresentation:projected.presentation,process:current.process}}}];},[current]);
 const runtime=useExternalStoreRuntime({messages,convertMessage:m=>m,isRunning:false,onNew:async()=>{}});
 return h(ProcessDetailsContext.Provider,{value:details.load},h(AssistantRuntimeProvider,{runtime},h(ThreadPrimitive.Messages,{components:{AssistantMessage:PartsMessage}})));
}
test('real lazy details keep failed Args/Error/Result inside Worked through recovery and folding',async()=>withDom(async d=>{
 const call={id:'failed-call',seq:2,revision:1,kind:'tool',status:'failed',toolName:'synthetic_lookup',label:'检查资料',content:{input:{state:'recorded',value:{query:'SYNTHETIC_INPUT'}},output:{state:'recorded',value:{error:'SYNTHETIC_ERROR_LOG'}}}};
 const detail={...node,state:'worked',status:'failed',items:[...node.items,call]},header={...detail,details:'unloaded',items:[],toolStatusCounts:{failed:2}};
 const reads=[],load=async(id,signal)=>{reads.push({id,signal});return detail;};
 await d.render(h(PartsRuntime,{value:header,load}));assert.doesNotMatch(d.container.textContent,/\d+ 次调用失败/);
 assert.equal(reads.length,0);
 const outer=d.find(n=>n.attrs['data-slot']==='collapsible-trigger');await d.click(outer);assert.equal(reads.length,1);assert.equal(reads[0].id,node.id);
 const row=d.find(n=>n.attrs['data-tool-id']==='failed-call'),parent=row.parentNode;
 assert.ok(row);assert.match(row.textContent,/调用失败/);assert.equal(d.all().some(n=>n.tagName==='OL'&&n.contains(row)),true);
 const tool=d.find(n=>n.attrs['data-slot']==='tool-fallback-trigger');await d.click(tool);
 assert.match(d.find(n=>n.attrs['data-slot']==='tool-fallback-args').textContent,/SYNTHETIC_INPUT/);
 assert.match(d.find(n=>n.attrs['data-slot']==='tool-fallback-error').textContent,/调用失败/);
 assert.match(d.find(n=>n.attrs['data-slot']==='tool-fallback-result').textContent,/SYNTHETIC_ERROR_LOG/);
 assert.equal(d.find(n=>n.attrs['data-final']).textContent,'FINAL BODY');assert.match(d.container.textContent,/处理失败/);
 await d.render(h(PartsRuntime,{value:{...detail,state:'working',status:'running',revision:3,items:[...node.items,{...call,revision:2,status:'running'}]},load}));
 assert.equal(d.find(n=>n.attrs['data-tool-id']==='failed-call'),row);assert.equal(row.parentNode,parent);
 assert.equal(d.all().filter(n=>n.attrs['data-tool-id']==='failed-call').length,1);assert.match(tool.textContent,/调用中/);
 assert.equal(tool.attrs['aria-expanded'],'true');assert.match(row.textContent,/SYNTHETIC_INPUT/);assert.match(row.textContent,/SYNTHETIC_ERROR_LOG/);assert.equal(reads.length,1);
 await d.render(h(PartsRuntime,{value:{...detail,revision:4,items:[...node.items,{...call,revision:3,status:'completed'}]},load}));
 assert.equal(d.find(n=>n.attrs['data-tool-id']==='failed-call'),row);assert.equal(row.parentNode,parent);assert.equal(tool.attrs['aria-expanded'],'true');assert.match(tool.textContent,/调用已返回/);
 assert.equal(d.all().filter(n=>n.attrs['data-tool-id']==='failed-call').length,1);
 await d.click(outer);assert.equal(outer.attrs['aria-expanded'],'false');
 // Synthetic DOM has no exit animation; any retained row must belong only to
 // the original closed panel, never to a sibling attention container.
 assert.ok(!d.container.contains(row)||d.all().some(n=>n.attrs['data-slot']==='collapsible-content'&&'data-closed' in n.attrs&&n.contains(row)));
 await d.click(outer);assert.equal(d.all().filter(n=>n.attrs['data-tool-id']==='failed-call').length,1);assert.equal(reads.length,1);
}));
test('all real message parts retain stable order and complete details only inside Worked across history and message switches',async()=>withDom(async d=>{
 const statuses=['running','completed','failed','interrupted','declined','unknown','blocked'];
 const items=statuses.map((status,i)=>({id:status,seq:i+2,revision:1,kind:'tool',status,label:'检查资料',toolName:status,content:{input:{state:'recorded',value:{arg:'ARG_'+status}},output:{state:'recorded',value:'RESULT_'+status}}}));
 let reads=0;const load=async()=>{reads++;throw Error('unexpected_detail_read');};
 for(const [id,state,status] of [['reply','working','running'],['history','worked','failed'],['other','worked','unknown']]){
  await d.render(h(PartsRuntime,{value:{...node,id,messageId:id,state,status,items:[...node.items,...items]},load}));
  assert.equal(d.all().filter(n=>n.attrs['data-tool-id']).length,0);
  const outer=d.find(n=>n.attrs['data-slot']==='collapsible-trigger');assert.equal(outer.attrs['aria-expanded'],'false');await d.click(outer);
  const rows=d.all().filter(n=>n.attrs['data-tool-id']);assert.deepEqual(rows.map(n=>n.attrs['data-tool-id']),statuses);
  const list=d.find(n=>n.tagName==='OL');assert.ok(rows.every(row=>list.contains(row)));assert.ok(list.textContent.indexOf('progress')<list.textContent.indexOf('调用中'));
  for(const tool of d.all().filter(n=>n.attrs['data-slot']==='tool-fallback-trigger'))await d.click(tool);
  for(const s of statuses){assert.match(d.find(n=>n.attrs['data-tool-id']===s).textContent,new RegExp('ARG_'+s));assert.match(d.find(n=>n.attrs['data-tool-id']===s).textContent,new RegExp('RESULT_'+s));}
  assert.match(d.find(n=>n.attrs['data-slot']==='tool-fallback-error').textContent,/调用失败/);
  await d.click(outer);assert.equal(outer.attrs['aria-expanded'],'false');assert.ok(rows.every(row=>!d.container.contains(row)||d.all().some(n=>n.attrs['data-slot']==='collapsible-content'&&'data-closed' in n.attrs&&n.contains(row))));
  assert.equal(d.find(n=>n.attrs['data-final']).textContent,'FINAL BODY');
 }
 assert.equal(reads,0);
}));
test('production React SSR and real projection retain one final, silent/no-final fallback and exact public action identity',()=>{
 const worked={...node,revision:3,state:'worked',status:'completed',items:[{id:'final',kind:'commentary',seq:1,revision:1,phase:'final_answer',turnId:'turn',itemId:'final',text:'ONLY FINAL',completed:true}],final:{id:'final',text:'ONLY FINAL'}},messages=projected([message],[worked]).messages;assert.equal(messages.length,1);assert.equal(messages[0].text,'ONLY FINAL');const html=renderToStaticMarkup(h(ProcessMessageContent,{node:messages[0].process,renderText:text=>h('p',null,text)},h('div',null,messages[0].text)));assert.doesNotMatch(html,/data-slot="run-activity"|<button|<dialog|已结束/);assert.equal(html.match(/ONLY FINAL/g).length,1);
 assert.equal(projected([{...message,text:''}],[{...worked,items:[],final:undefined}]).messages[0].text,'');assert.equal(projected([message],[{...worked,items:[],final:{id:'reply',text:message.text}}]).messages[0].text,message.text);assert.equal(projected([message],[]).messages[0].text,message.text);
 const delivery={...message,id:'delivery-message',text:'FORMAL'},formal={...worked,items:[],deliveryMessageId:delivery.id,final:{id:delivery.id,text:delivery.text}},formalMessages=projected([message,delivery],[formal]).messages;assert.deepEqual(formalMessages.map(m=>[m.id,m.text]),[['reply',''],['delivery-message','FORMAL']]);
 for(const feedback of ['up','down',null]){const visible=projected([{...message,feedback}],[worked]).messages[0];assert.equal(visible.id,worked.messageId);assert.equal(visible.feedback,feedback);assert.notEqual(visible.id,worked.final.id);}
});
test('A/B/C pending order and resumed processing preserve one original user through the real projection and finite cache',()=>{
 const user=id=>({...message,id:'user-'+id,requestId:id,role:'user',text:id,status:'completed'}),[a,b,c]=['A','B','C'].map(user),inbox=['A','B','C'].map((id,n)=>({messageId:'inbox-'+id,replyId:'placeholder-'+id,seq:n+1,state:id==='C'?'queued':'completed',input:{requestId:id}}));
 const first={...node,id:'A1',messageId:'A1',sourceMessageIds:['inbox-A'],replyMessageId:'placeholder-A',seq:1,state:'worked',status:'completed',final:{id:'fA',text:'A1 final'}},second={...first,id:'B1',messageId:'B1',sourceMessageIds:['inbox-B'],replyMessageId:'placeholder-B',seq:2,final:{id:'fB',text:'B final'}},resume={...node,id:'A2',messageId:'A2',sourceMessageIds:['inbox-A'],replyMessageId:'placeholder-A',seq:3,items:[]},history=[a,b,c,{...message,id:'A1'},{...message,id:'B1'},{...message,id:'A2'}],view=projected(history,[resume,first,second],inbox);
 assert.deepEqual(view.messages.map(m=>m.id),['user-A','A1','user-B','B1','A2']);assert.deepEqual(view.queue.map(q=>q.user.id),['user-C']);assert.match(view.messages.find(m=>m.id==='A2').sourceLabel,/继续处理.*A/);const cache=new HistoryWindow();cache.snapshot(snapshot(page(view.messages,2)));assert.equal(cache.snapshot(snapshot(page([c],1))),false);assert.deepEqual(cache.messages.map(m=>m.id),view.messages.map(m=>m.id));assert.match(renderToStaticMarkup(h(ProcessNodeView,{node:resume,renderText:text=>text})),/data-slot="run-activity"/);assert.deepEqual(projected([c,b],[],[inbox[1],inbox[2]].map(i=>({...i,state:'queued'}))).queue.map(q=>q.user.id),['user-B','user-C']);
});
test('authoritative owner refuses reopening a worked node and finite cache rejects older duplicate process identities',()=>{
 const f=historyFixture(1);try{const worked=f.processes.exact('node-0');assert.equal(f.processes.start({id:worked.id,threadId:worked.threadId,sourceKind:worked.sourceKind,sourceMessageIds:[],messageId:worked.messageId},'new-turn'),false);assert.deepEqual(f.processes.exact(worked.id),worked);}finally{f.close();}
 const worked={...node,revision:4,state:'worked'},current={...message,process:worked},cache=new HistoryWindow();cache.snapshot(snapshot(page([current],4)));cache.snapshot(snapshot(page([{...message,process:node},{...message,process:node}],4)));assert.equal(cache.messages.length,1);assert.equal(cache.messages[0],current);assert.equal(cache.snapshot(snapshot(page([],3))),false);assert.equal(cache.messages[0].process,worked);cache.add(page([{...message,id:'worker-message',process:{...worked,id:'worker-node'}}],4),'epoch','before');assert.deepEqual(cache.messages.map(m=>m.id),['worker-message','reply']);
});
test('current active page and history owners reject stale edits and cancellation rollback',()=>{
 const latest={messageId:'inbox-A',seq:1,revision:5,inputRevision:2,input:{requestId:'A',text:'edited accepted text'},state:'cancelled'},version={threadId:'t',readEpoch:'epoch',revision:5},owner=new ActiveReadPage();owner.snapshot(version,[latest],null);owner.snapshot({...version,revision:1},[{...latest,revision:1,state:'queued'}],null);assert.equal(owner.items[0],latest);assert.equal(owner.items[0].state,'cancelled');assert.equal(owner.items[0].revision,5);const user={...message,id:'user',role:'user',requestId:'A',text:latest.input.text},cache=new HistoryWindow();cache.snapshot(snapshot(page([user],5)));cache.snapshot(snapshot(page([{...user,text:'old text'}],1)));assert.equal(cache.messages[0].text,user.text);
});

test('multiple publications and files keep exact IDs once; unrelated legacy file stays independent and Worker labels hide internal fields',()=>{
 const n={...node,state:'worked',status:'completed',items:[],sourceKind:'worker',final:{id:'d1',text:'FIRST\n\nSECOND'},deliveryMessageIds:['d1','d2'],deliveryMessageId:'d1'},history=[message,{...message,id:'d1',text:'FIRST'},{...message,id:'d2',text:'SECOND'}],view=projected(history,[n]).messages;assert.deepEqual(view.map(m=>[m.id,m.text]),[['reply',''],['d1','FIRST'],['d2','SECOND']]);const cache=new HistoryWindow(),files=[{id:'f1',messageId:'d1'},{id:'f2',messageId:'d2'},{id:'old',messageId:'other-message'}];cache.snapshot(snapshot(page(view,1,view.map(m=>m.id),files)));cache.add(page(view,1,view.map(m=>m.id),files),'epoch','before');assert.deepEqual(cache.artifacts.map(f=>[f.id,f.messageId]),[['f1','d1'],['f2','d2'],['old','other-message']]);
 const item={id:'w',seq:1,revision:1,kind:'worker',label:'准确工作',taskId:'INTERNAL_TASK_ID',runId:'run',version:777,epoch:888,state:'working',controlState:'normal'},html=renderToStaticMarkup(h(ProcessObservationContext.Provider,{value:{connected:true,serviceRunning:true,workerTitles:new Map([['run','准确工作']])}},h(ProcessMessageContent,{node:{...n,items:[item]},renderText:text=>text},'PUBLIC')));assert.doesNotMatch(html,/<button/);assert.match(html,/旧后台工作记录/);assert.doesNotMatch(html,/INTERNAL_TASK_ID|777|888|执行代次/);assert.match(html,/PUBLIC/);
});
test('original disclosure preserves manual expansion across completion, replay and Worker updates',async()=>withDom(async d=>{
 const render=value=>d.render(h(ProcessNodeView,{node:value,renderText:text=>h('p',null,text)}));await render(node);const button=d.find(n=>n.tagName==='BUTTON');assert.equal(button.attrs['aria-expanded'],'false');
 await d.click(button);const worked={...node,state:'worked',status:'completed',revision:4};await render(worked);assert.equal(button.attrs['aria-expanded'],'true');
 await render({...worked,revision:5,items:[...worked.items,{id:'worker',seq:2,revision:1,kind:'worker',taskId:'synthetic',state:'working',controlState:'normal'}]});assert.equal(button.attrs['aria-expanded'],'true');
 await d.click(button);await render({...worked,revision:6});assert.equal(d.all().some(n=>n.attrs['data-slot']==='run-activity'),false);
}));

test('success removes a collapsed live process without replacing its answer',async()=>withDom(async d=>{
 const render=value=>d.render(h(ProcessMessageContent,{node:value,renderText:t=>t},h('p',{'data-answer':true},'FORMAL ANSWER')));
 await render(node);assert.equal(d.find(n=>n.attrs['data-slot']==='collapsible-trigger').attrs['aria-expanded'],'false');
 const answer=d.find(n=>n.attrs['data-answer']);
 await render({...node,state:'worked',status:'completed'});
 assert.equal(d.all().some(n=>n.attrs['data-slot']==='run-activity'),false);
 assert.equal(d.find(n=>n.attrs['data-answer']),answer);
}));

test('collapsed success does not construct legacy disclosure content',()=>{
 const completed={...node,state:'worked',status:'completed'};
 const html=renderToStaticMarkup(h(ProcessMessageContent,{node:completed,renderText:()=>assert.fail('hidden process content was rendered')},h('p',null,'FINAL BODY')));
 assert.match(html,/FINAL BODY/);
});

test('immutable Worker events use default-closed static TaskCards and only disclose original plain text',async()=>withDom(async d=>{
 const events=[{id:'e1',kind:'workerEvent',seq:1,revision:1,eventKey:'one',event:{eventKind:'delegated',title:'准确交办',body:'原交办正文\n保留换行'}},{id:'e2',kind:'workerEvent',seq:2,revision:1,eventKey:'two',event:{eventKind:'reply_received',title:'准确接收',body:'<img src=x onerror=never()> **原文**'}},{id:'e3',kind:'workerEvent',seq:3,revision:1,eventKey:'three',event:{eventKind:'start_failed',title:'准确失败',body:'认证失败，Worker 未能启动。'}}];
 const render=n=>d.render(h(ProcessMessageContent,{node:n,renderText:t=>t},h('div',null,'FORMAL ANSWER'))),worked={...node,state:'worked',status:'completed',items:[...node.items,...events]};
 const cards=()=>d.all().filter(n=>n.attrs['data-worker-event']),toggle=card=>card.childNodes.find(n=>n.tagName==='BUTTON');
 await render(worked);
 assert.deepEqual(cards().map(c=>c.attrs['data-state']),['waiting','waiting','failed']);
 assert.deepEqual(cards().map(c=>c.attrs['data-worker-event']),['one','two','three']);
 assert.deepEqual(cards().map(c=>toggle(c).attrs['aria-expanded']),['false','false','false']);
 assert.doesNotMatch(d.container.textContent,/原交办正文|认证失败|<img|待验收|尚未发布/);
 assert.equal(d.all().some(n=>n.attrs['data-slot']==='task-card-result'||n.attrs['data-slot']==='task-card-actions'||n.attrs.class?.includes('animate-spin')),false);
 assert.match(d.container.textContent,/FORMAL ANSWER/);
 await d.click(toggle(cards()[0]));assert.match(d.container.textContent,/原交办正文\n保留换行/);
 await render({...worked,revision:3,status:'unknown'});
 assert.equal(toggle(cards()[0]).attrs['aria-expanded'],'true');assert.equal(cards()[0].attrs['data-state'],'waiting');
 const originalCards=cards(),parent=originalCards[0].parentNode;
 toggle(originalCards[0]).focus();
 await d.click(d.find(n=>n.attrs['data-slot']==='collapsible-trigger'));
 assert.equal(cards().length,3);assert.ok(cards().every((c,i)=>c===originalCards[i]&&c.parentNode===parent),'outer disclosure preserves each card and its parent');
 assert.equal(d.doc.activeElement,toggle(originalCards[0]));
 assert.equal(toggle(cards()[0]).attrs['aria-expanded'],'true');
 for(const card of cards().slice(1))await d.click(toggle(card));
 assert.equal(d.container.textContent.match(/原交办正文/g).length,1);assert.match(d.container.textContent,/<img src=x onerror=never\(\)> \*\*原文\*\*/);
 assert.equal(d.all().filter(n=>n.tagName==='BUTTON').length,4,'one outer disclosure and three card disclosures');
 assert.equal(d.all().filter(n=>['IMG','DIALOG','A'].includes(n.tagName)).length,0);
 await d.click(d.find(n=>n.attrs['data-slot']==='collapsible-trigger'));
 assert.equal(cards().length,3);assert.ok(cards().every((c,i)=>c===originalCards[i]&&toggle(c).attrs['aria-expanded']==='true'));
}));

test('Worker cards stay outside their own process and before their own answer across toggles, replay and terminal states',async()=>withDom(async d=>{
 const event=(id,seq)=>({id,kind:'workerEvent',seq,revision:1,eventKey:id,event:{eventKind:'delegated',title:id,body:'Original '+id}});
 const first={...node,items:[...node.items,{id:'create',kind:'tool',seq:2,revision:1,category:'host',label:'创建任务',status:'completed'},event('first-worker',3)]};
 const second={...node,id:'second',messageId:'second-answer',items:[...node.items,event('second-worker',2)]};
 const render=(a,b=second)=>d.render(h('main',null,[a,b].map(n=>h('article',{key:n.id,'data-round':n.id},h(ProcessMessageContent,{node:n,renderText:t=>h('p',null,t)},h('div',{'data-answer':n.id},'Answer '+n.id))))));
 await render(first);
 const cards=()=>d.all().filter(n=>n.attrs['data-worker-event']),original=cards();
 const firstRound=d.find(n=>n.attrs['data-round']===first.id);
 await d.click(original[0].firstChild);
 for(const [state,status] of [['working','running'],['worked','completed'],['worked','failed'],['worked','interrupted'],['working','unknown']]){
  const toggle=d.find(n=>firstRound.contains(n)&&n.attrs['data-slot']==='collapsible-trigger');
  if(toggle)await d.click(toggle);
  await render({...first,state,status,revision:first.revision+1});
  assert.ok(cards().every((c,i)=>c===original[i]));
  assert.equal(original[0].firstChild.attrs['aria-expanded'],'true');
  for(const card of cards()){
   const round=card.parentNode,activity=round.childNodes.find(n=>n.attrs['data-slot']==='run-activity'),answer=round.childNodes.find(n=>n.attrs['data-answer']);
   assert.equal(!!activity,round!==firstRound||status!=='completed');
   if(activity){assert.ok(!activity.contains(card));assert.ok(round.childNodes.indexOf(activity)<round.childNodes.indexOf(card));}
   assert.ok(round.childNodes.indexOf(card)<round.childNodes.indexOf(answer));
  }
 }
 assert.deepEqual(cards().map(c=>c.attrs['data-worker-event']),['first-worker','second-worker']);
 assert.equal(original[0].attrs['data-state'],'waiting','historical delegation does not inherit run failure/cancellation');
 await render({...first,items:[]},{...second,items:[]});
 assert.equal(cards().length,0);assert.equal(d.all().some(n=>n.attrs.class==='process-workers'),false);
}));

test('lazy details keep the header event card mounted; event-only and absent process add no empty disclosure',async()=>withDom(async d=>{
 const event={id:'event',kind:'workerEvent',seq:2,revision:1,eventKey:'lazy-event',event:{eventKind:'reply_received',title:'准确收到结果',body:'原结果正文'}};
 const header={...node,details:'unloaded',toolStatusCounts:{completed:1},items:[event]},detail={...node,revision:3,items:[...node.items,event]};
 const requests=[],load=async(id,signal)=>{requests.push({id,signal});return detail;};
 await d.render(h(ProcessDetailHarness,{node:header,load,renderText:t=>t},'ANSWER'));
 const card=d.find(n=>n.attrs['data-worker-event']==='lazy-event'),parent=card.parentNode,trigger=d.find(n=>n.attrs['data-slot']==='collapsible-trigger');
 await d.click(card.firstChild);await d.click(trigger);
 assert.equal(requests.length,1);assert.equal(requests[0].id,node.id);
 assert.equal(d.find(n=>n.attrs['data-worker-event']==='lazy-event'),card);assert.equal(card.parentNode,parent);assert.equal(card.firstChild.attrs['aria-expanded'],'true');
 assert.match(d.container.textContent,/progress/);
 await d.click(trigger);assert.equal(d.find(n=>n.attrs['data-worker-event']==='lazy-event'),card);
 await d.render(h(ProcessMessageContent,{node:{...node,items:[event]},renderText:t=>t},'ANSWER'));
 assert.equal(d.all().filter(n=>n.attrs['data-slot']==='collapsible-trigger').length,0,'events alone do not create an empty process panel');
 assert.equal(d.all().filter(n=>n.attrs['data-worker-event']).length,1);
 await d.render(h(ProcessMessageContent,{renderText:t=>t},'ANSWER'));
 assert.equal(d.container.textContent,'ANSWER');assert.equal(d.all().filter(n=>n.attrs['data-slot']).length,0);
}));

test('a verified source can name a live process without a second disclosure; Worker receipt stays independent',async()=>withDom(async d=>{
 const source={key:'exact',target:{taskId:'task',version:2,runId:'run'},title:'核对公开来源',icon:'CornerDownRight',origin:{kind:'activity',processId:'node',itemId:'tool'},phaseLabel:'调整已受理，尚待采用',owner:'main'};
 const event={id:'received',kind:'workerEvent',seq:2,revision:1,eventKey:'received',event:{eventKind:'reply_received',title:'准确收到结果',body:'原结果正文'}};
 await d.render(h(ProcessMessageContent,{node:{...node,items:[...node.items,event]},taskSources:[source],renderText:t=>t},'ANSWER'));
 const card=d.find(n=>n.attrs['data-worker-event']==='received');assert.equal(card.attrs['data-state'],'waiting');
 assert.match(d.find(n=>n.attrs['data-slot']==='collapsible-trigger').textContent,/核对公开来源/);
 assert.equal(d.all().some(n=>n.attrs['data-task-source']),false);
 assert.match(d.container.textContent,/当时：收到回复/);assert.equal(d.all().some(n=>n.attrs.class?.includes('animate-spin')),false);
 await d.click(card.firstChild);assert.match(card.textContent,/原结果正文/);
 await d.render(h(ProcessMessageContent,{node:{...node,details:'unloaded',items:[event]},taskSources:[source],renderText:t=>t},'ANSWER'));
 assert.ok(d.find(n=>n.attrs['data-worker-event']==='received')===card);assert.equal(card.firstChild.attrs['aria-expanded'],'true');
 assert.equal(d.all().filter(n=>n.tagName==='BUTTON'&&card.contains(n)).length,1);
}));
