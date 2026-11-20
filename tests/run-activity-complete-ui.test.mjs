import {test} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {ProcessNodeView} from './helpers/process-ui-loader.mjs';
import {withDom} from './helpers/process-dom.mjs';
const h=React.createElement;
const node={id:'question',threadId:'thread',seq:1,revision:1,sourceKind:'worker',sourceMessageIds:['notice'],messageId:'question',state:'working',status:'running',turnIds:['turn'],items:[{id:'question:source',seq:1,revision:1,kind:'commentary',phase:'commentary',text:'处理 Worker 提问：保持历史消息阅读位置'}]};

test('a silent Worker turn does not repeat intermediate text when running or completed',async()=>withDom(async d=>{
 for(const [state,status] of [['working','running'],['worked','completed']]){
  await d.render(h(ProcessNodeView,{node:{...node,state,status}}));
  assert.equal(d.container.textContent,'');
  assert.equal(d.find(n=>n.tagName==='BUTTON'),undefined);
 }
}));

test('completed and failed tool calls have no disclosure or text in the conversation',async()=>withDom(async d=>{
 const items=['completed','failed'].map((status,i)=>({id:String(i),kind:'tool',seq:i+1,revision:1,label:'工具详情',status}));
 await d.render(h(ProcessNodeView,{node:{...node,items}}));
 assert.equal(d.container.textContent,'');
 assert.equal(d.find(n=>n.attrs['data-tool-id']||n.tagName==='BUTTON'),undefined);
}));
