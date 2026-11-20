import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {ProcessMessageContent} from './helpers/process-ui-loader.mjs';
import {withDom,visibleText} from './helpers/process-dom.mjs';
const h=React.createElement;
const node={id:'internal',threadId:'t',seq:1,revision:1,sourceKind:'worker',sourceMessageIds:['notice'],messageId:'internal',turnIds:['turn'],state:'worked',status:'completed'};
const event=(key,kind,bodySource,body)=>({id:key,kind:'workerEvent',seq:1,revision:1,eventKey:key,event:{eventKind:kind,title:key,bodySource,body}});
test('routine coordination stays out of main chat while startup failure keeps its reason',async()=>withDom(async d=>{
 const items=[
  event('委派事项','delegated','description','合成交办原文'),
  event('回传事项','reply_received','reply','已收到的完整摘要'),
  event('空回传','reply_received','missing','未提供摘要'),
  {id:'legacy',kind:'worker',seq:2,revision:1},
  event('核对附件','start_failed','error','认证失败，请检查模型连接。'),
 ];
 for(const value of [{...node,state:'working',status:'running'},node]){
  await d.render(h(ProcessMessageContent,{node:{...value,items}},h('p',null,'部分可用结果，仍有缺口。')));
  assert.doesNotMatch(visibleText(d.container),/协作记录|委派事项|合成交办原文|回传事项|已收到的完整摘要|空回传|未提供摘要|旧后台工作记录/);
  assert.match(visibleText(d.container),/核对附件.*认证失败，请检查模型连接。/);
  assert.match(visibleText(d.container),/部分可用结果，仍有缺口/);
  assert.equal(d.all().filter(n=>n.tagName==='BUTTON').length,0);
 }
}));
test('an unresolved source warning and answer remain without a separate task source card',async()=>withDom(async d=>{
 const sources=['验收已接受','交付已准备'].map((phaseLabel,i)=>({key:'source-'+i,target:{taskId:'task',version:1},title:'合成任务',icon:'Check',origin:{kind:'activity',processId:'internal',itemId:'tool-'+i},phaseLabel,owner:'main'}));
 await d.render(h(ProcessMessageContent,{node:{...node,items:[]},taskSources:sources,taskSourceUnresolved:true,renderText:t=>t},h('p',null,'唯一结论正文')));
 assert.doesNotMatch(visibleText(d.container),/验收已接受|交付已准备/);
 assert.match(visibleText(d.container),/部分任务来源尚未核实/);assert.match(visibleText(d.container),/唯一结论正文/);
 assert.equal(d.all().filter(n=>n.tagName==='BUTTON').length,0);
}));

test('tool progress and commentary never create a disclosure without business events',async()=>withDom(async d=>{
 await d.render(h(ProcessMessageContent,{node:{...node,state:'working',status:'running',items:[{id:'call',kind:'tool',seq:1,revision:1,label:'SYNTHETIC_TOOL',status:'running'},{id:'progress',kind:'commentary',seq:2,revision:1,phase:'commentary',text:'SYNTHETIC_PROGRESS'}]},renderText:t=>t},h('p',null,'正式正文')));
 assert.match(visibleText(d.container),/正式正文/);
 assert.doesNotMatch(visibleText(d.container),/当前事项|处理过程|SYNTHETIC/);
 assert.equal(d.all().filter(n=>n.attrs['data-slot']==='collapsible-trigger').length,0);
}));
