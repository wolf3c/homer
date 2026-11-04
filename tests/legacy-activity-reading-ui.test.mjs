import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {ProcessNodeView,ProcessDetailHarness} from './helpers/process-ui-loader.mjs';
import {withDom,visibleText} from './helpers/process-dom.mjs';
const h=React.createElement;
const call=(id,status='completed',extra={})=>({id,kind:'tool',seq:Number(id.replace(/\D/g,''))||1,revision:1,category:'host',label:'检查资料',status,...extra});
const node=items=>({id:'node',threadId:'thread',seq:1,revision:1,sourceKind:'user',sourceMessageIds:[],messageId:'node',state:'working',status:'running',turnIds:['turn'],items});
const rows=d=>d.all().filter(n=>n.attrs['data-tool-id']).map(n=>n.attrs['data-tool-id']);
const toggle=d=>d.find(n=>n.tagName==='BUTTON');
const noAdditions=d=>{
 assert.equal(d.all().filter(n=>n.tagName==='BUTTON'&&n.attrs['data-slot']==='collapsible-trigger').length,1);
 assert.equal(d.all().filter(n=>n.tagName==='DIALOG').length,0);
 assert.doesNotMatch(d.container.textContent,/查看原调用记录|内部调用缺少公开工作详情|次调用已返回/);
};
test('original disclosure is initially closed and exposes every original call inline with no extra reader',async()=>withDom(async d=>{
 const items=Array.from({length:12},(_,i)=>call('call-'+(i+1))),value=node(items),original=JSON.stringify(value);
 await d.render(h(ProcessNodeView,{node:value,renderText:t=>t}));
 assert.equal(toggle(d).attrs['aria-expanded'],'false');
 await d.click(toggle(d));
 assert.deepEqual(rows(d),items.map(i=>i.id));noAdditions(d);
 assert.equal(JSON.stringify(value),original);
 await d.render(h(ProcessNodeView,{node:{...value,revision:2,state:'worked',status:'completed'},renderText:t=>t}));
 assert.equal(toggle(d).attrs['aria-expanded'],'true','completion preserves the user-opened disclosure');noAdditions(d);
}));
test('mixed public facts and all original statuses remain independent in the same list through revisions',async()=>withDom(async d=>{
 const fact={schemaVersion:1,action:'inspect_task',objectName:'公开事项',outcome:'record_read'};
 const items=[call('call-1'),call('call-2','completed',{activity:fact}),call('call-3'),...['running','failed','declined','interrupted','unknown','blocked'].map((s,i)=>call('call-'+(i+4),s))];
 const render=items=>d.render(h(ProcessNodeView,{node:node(items),renderText:t=>t}));
 await render(items);await d.click(toggle(d));
 assert.deepEqual(rows(d),items.map(i=>i.id));assert.match(d.container.textContent,/查看任务记录：公开事项/);assert.equal(d.all().filter(n=>n.attrs.class==='process-activity-link').length,0);noAdditions(d);
 for(const status of ['调用失败','调用被拒绝','调用已中断','结束状态待核实','调用受阻'])assert.match(d.container.textContent,new RegExp(status));
 await render([...items,call('call-4','completed',{revision:2,activity:fact})]);
 assert.deepEqual(rows(d),items.map(i=>i.id));assert.equal(d.all().filter(n=>n.attrs['data-tool-id']==='call-4').length,1);
}));
test('history reads only on original disclosure expansion and shows original call identities inline',async()=>withDom(async d=>{
 const detail={...node([call('call-1'),call('call-2')]),state:'worked',status:'completed'},header={...detail,items:[],details:'unloaded',toolStatusCounts:{completed:2}};
 let reads=0;const load=async()=>{reads++;return detail;};
 const render=()=>d.render(h(ProcessDetailHarness,{node:header,load,viewOnly:true,renderText:t=>t}));
 await render();assert.equal(reads,0);await d.click(toggle(d));await render();
 assert.equal(reads,1);assert.deepEqual(rows(d),['call-1','call-2']);noAdditions(d);
 await d.click(toggle(d));await d.click(toggle(d));await render();assert.equal(toggle(d).attrs['aria-expanded'],'true');assert.deepEqual(rows(d),['call-1','call-2']);
}));
test('approved Worker event card stays visible once when folded and in the ordered list when expanded',async()=>withDom(async d=>{
 const event={id:'event',seq:1,revision:1,kind:'workerEvent',eventKey:'result:one',event:{eventKind:'result_received',title:'后台研究',body:'保留一个待确认事项。'}};
 const render=value=>d.render(h(ProcessNodeView,{node:value,renderText:t=>t}));await render(node([call('call-1'),event]));
 assert.match(visibleText(d.container),/后台研究/);assert.equal(d.all().filter(n=>n.attrs['data-worker-event']==='result:one').length,1);await d.click(toggle(d));
 const card=d.find(n=>n.attrs['data-worker-event']==='result:one').childNodes.find(n=>n.tagName==='BUTTON');assert.ok(card);await d.click(card);assert.equal(visibleText(d.container).match(/保留一个待确认事项。/g).length,1);assert.match(visibleText(d.container),/后台研究/);noAdditions(d);
 await render({...node([call('call-1'),event]),revision:2,state:'worked',status:'completed'});assert.equal(toggle(d).attrs['aria-expanded'],'true');
}));
