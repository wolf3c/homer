import {test} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {ProcessNodeView} from './helpers/process-ui-loader.mjs';
import {withDom} from './helpers/process-dom.mjs';
const h=React.createElement;
const node={id:'question',threadId:'thread',seq:1,revision:1,sourceKind:'worker',sourceMessageIds:['notice'],messageId:'question',state:'working',status:'running',turnIds:['turn'],items:[{id:'question:source',seq:1,revision:1,kind:'commentary',phase:'commentary',text:'处理 Worker 提问：保持历史消息阅读位置'}]};

test('the original disclosure explains a silent Worker turn, displays its live stage, and keeps the source when complete',async()=>withDom(async d=>{
 const render=(value,activityText='原生轮执行中')=>d.render(h(ProcessNodeView,{node:value,activityText,observation:{connected:true,serviceRunning:true},renderText:t=>h('p',null,t)}));
 await render(node);assert.doesNotMatch(d.container.textContent,/处理 Worker 提问：保持历史消息阅读位置/);
 const button=d.find(n=>n.tagName==='BUTTON');assert.equal(button.attrs['aria-expanded'],'false');
 await render(node,'正在压缩上下文，等待原生完成');assert.match(d.container.textContent,/当前事项.*压缩上下文/);
 await d.click(button);await render({...node,state:'worked',status:'completed'},'正在压缩上下文，等待原生完成');
 assert.equal(button.attrs['aria-expanded'],'true');assert.match(d.container.textContent,/处理 Worker 提问/);assert.doesNotMatch(d.container.textContent,/压缩上下文/);
}));

test('tool facts use plain paragraphs with one result, retaining each call and non-success states',async()=>withDom(async d=>{
 const activity={schemaVersion:1,action:'inspect_task',objectName:'公开任务',outcome:'record_read'};
 const tools=[{id:'read',kind:'tool',seq:2,revision:1,label:'检查资料',status:'completed',activity},{id:'review',kind:'tool',seq:3,revision:1,label:'核对成果',status:'completed',activity:{...activity,action:'review_result',outcome:'changes_requested'}},{id:'failed',kind:'tool',seq:4,revision:1,label:'检查资料',status:'failed',activity}];
 await d.render(h(ProcessNodeView,{node:{...node,items:tools},observation:{connected:true,serviceRunning:true},renderText:t=>t}));
 await d.click(d.find(n=>n.tagName==='BUTTON'));
 const rows=d.all().filter(n=>n.attrs['data-tool-id']);
 assert.deepEqual(rows.map(n=>n.tagName),['P','P','P']);
 assert.match(rows[0].textContent,/查看任务记录：公开任务 · 已读取/);assert.doesNotMatch(rows[0].textContent,/调用已返回|记录已读取/);
 assert.match(rows[1].textContent,/已要求修改/);assert.match(rows[2].textContent,/调用失败/);assert.doesNotMatch(rows[2].textContent,/已读取/);
 assert.equal(d.all().filter(n=>n.attrs.class==='process-tool-row').length,0);
}));
