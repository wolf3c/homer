import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as presentation from '../ui/process-presentation.ts';
import {ProcessNodeView,ProcessMessageContent,ProcessObservationContext} from './helpers/process-ui-loader.mjs';
import {withDom,React,visibleText} from './helpers/process-dom.mjs';
import {historyFixture} from './web-history-loading-fixture.ts';
const h=React.createElement;
const tools=Array.from({length:8},(_,i)=>({id:'call-'+i,revision:1,seq:i+1,kind:'tool',category:'host',label:i===5?'核对成果':'检查资料',status:'completed'}));
const worker={id:'worker:task-a',seq:9,revision:1,kind:'worker',taskId:'task-a',version:1,taskRevision:4,runId:'run-a',runRevision:3,epoch:1,runStatus:'succeeded',state:'settled',controlState:'normal',resultState:'accepted',outcome:'partial',phase:'ended',stopRequested:false,label:'核对材料与交付范围'};
const node={id:'reading-one',threadId:'synthetic-reading',messageId:'reading-one',sourceKind:'worker',sourceMessageIds:[],seq:1,revision:1,turnIds:['internal-turn'],state:'worked',status:'completed',items:[...tools,worker]};
const observation={connected:true,serviceRunning:true,threadId:node.threadId};
const view=(value=node)=>h(ProcessObservationContext.Provider,{value:observation},h(ProcessMessageContent,{node:value,renderText:t=>h('p',null,t)},h('div',{'data-final':''},'')));

test('eight distinct missing-turn returns preserve every original call, without losing identities, order or revisions',()=>{
 const result=presentation.projectProcessItems([...tools,{...tools[0],revision:2},worker]);
 assert.deepEqual(result.items.map(t=>t.id),[...tools,worker].map(t=>t.id));assert.equal(result.items[0].revision,2);
});
test('original single disclosure shows all calls inline without another reader',async()=>withDom(async d=>{
 await d.render(view());await d.click(d.find(n=>n.tagName==='BUTTON'));
 const visible=visibleText(d.container);assert.doesNotMatch(visible,/查看原调用记录|查看活动|内部调用缺少公开工作详情/);assert.doesNotMatch(visible,/执行已结束.*已验收.*部分完成/);
 assert.deepEqual(d.all().filter(n=>'data-tool-id' in n.attrs).map(n=>n.attrs['data-tool-id']),tools.map(t=>t.id));assert.equal(d.all().filter(n=>n.tagName==='BUTTON').length,1);
 assert.equal(d.all().filter(n=>n.tagName==='DETAILS'&&'data-tool-group' in n.attrs).length,0);assert.doesNotMatch(visible,/检查通过|同一原生轮次|同一轮次/);
}));
test('legacy Worker rows do not imply their last projection was the historical event',async()=>withDom(async d=>{
 await d.render(view());await d.click(d.find(n=>n.tagName==='BUTTON'));assert.equal(d.find(n=>n.attrs['aria-label']==='关联 Worker 状态'),undefined);assert.match(visibleText(d.container),/旧后台工作记录（当时的事件内容未保留）/);assert.doesNotMatch(visibleText(d.container),/部分完成|当前任务快照|已验收/);
}));
test('missing clocks report unavailable duration without invented endpoints',async()=>withDom(async d=>{
 await d.render(view());const trigger=d.find(n=>n.tagName==='BUTTON');assert.match(trigger.textContent,/耗时未提供/);assert.doesNotMatch(trigger.textContent,/0s/);await d.click(trigger);assert.doesNotMatch(d.container.textContent,/for 0s|耗时未记录/);
}));

test('failed, denied, blocked and uncertain facts stay in lazy headers without expanding ordinary successful history',()=>{
 const f=historyFixture(1);try{const raw=JSON.parse(f.store.meta('publicMainNode:v1:node-0'));raw.items=[...tools,...['failed','declined','blocked','unknown','interrupted'].map((status,i)=>({...tools[0],id:'risk-'+i,status}))];f.store.setMeta('publicMainNode:v1:node-0',JSON.stringify(raw));const header=f.processes.headers(['node-0'])[0];assert.equal(header.details,'unloaded');assert.equal(header.items.length,0);assert.deepEqual(header.toolStatusCounts,{blocked:1,completed:8,declined:1,failed:1,interrupted:1,unknown:1});}finally{f.close();}
});


test('Worker snapshots and public progress retain their exact positions without grouping calls',()=>{
 const interleaved=[tools[0],worker,...tools.slice(1)];assert.deepEqual(presentation.projectProcessItems(interleaved).items.map(t=>t.id),interleaved.map(t=>t.id));
 const progress={id:'public-progress',kind:'commentary',seq:3,revision:1,phase:'commentary',text:'公开进展'};const items=presentation.projectProcessItems([tools[0],progress,...tools.slice(1)]).items;assert.equal(items.length,9);assert.equal(items[1].text,'公开进展');
});

test('lazy status counts use the same exact-ID/latest-revision rule and stay bounded even with many ordinary calls',()=>{
 const f=historyFixture(1);try{const key='publicMainNode:v1:node-0',raw=JSON.parse(f.store.meta(key));raw.items=[...Array.from({length:2000},(_,i)=>({...tools[0],id:'bulk-'+i})),{...tools[0],id:'bulk-0',revision:2,status:'failed'}];f.store.setMeta(key,JSON.stringify(raw));const header=f.processes.headers(['node-0'])[0];assert.deepEqual(header.toolStatusCounts,{completed:1999,failed:1});assert.equal(header.items.length,0);assert.ok(JSON.stringify(header).length<2000);}finally{f.close();}
});

 test('a missing exact-version Worker name never borrows the current work-list title',async()=>withDom(async d=>{
 const value={...node,items:[{...worker,label:undefined}]};await d.render(h(ProcessObservationContext.Provider,{value:{...observation,workerTitles:new Map([[worker.runId,'另一版本的当前事项标题']])}},h(ProcessMessageContent,{node:value,renderText:t=>t},'')));assert.equal(d.find(n=>n.tagName==='BUTTON'),undefined);assert.match(visibleText(d.container),/旧后台工作记录（当时的事件内容未保留）/);assert.doesNotMatch(visibleText(d.container),/另一版本的当前事项标题/);
 }));
