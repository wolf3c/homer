import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {ProcessMessageContent} from './helpers/process-ui-loader.mjs';
import {withDom,visibleText} from './helpers/process-dom.mjs';
const h=React.createElement;
const node={id:'internal',threadId:'t',seq:1,revision:1,sourceKind:'worker',sourceMessageIds:['notice'],messageId:'internal',turnIds:['turn'],state:'worked',status:'completed'};
const event=(key,kind,bodySource,body)=>({id:key,kind:'workerEvent',seq:1,revision:1,eventKey:key,event:{eventKind:kind,title:key,bodySource,body}});
test('routine received result belongs to process details; missing and failed facts remain visible',async()=>withDom(async d=>{
 const items=[event('received','reply_received','reply','已收到的完整摘要'),event('failed','start_failed','error','启动失败'),event('missing','reply_received','missing','未提供摘要')];
 const render=value=>d.render(h(ProcessMessageContent,{node:{...value,items},renderText:t=>t},h('p',null,'部分可用结果，仍有缺口。')));
 await render({...node,state:'working',status:'running'});
 assert.doesNotMatch(visibleText(d.container),/received|已收到的完整摘要/);
 assert.match(visibleText(d.container),/启动失败/);assert.match(visibleText(d.container),/当时：收到回复/);
 assert.match(visibleText(d.container),/部分可用结果，仍有缺口/);
 const trigger=d.find(n=>n.attrs['data-slot']==='collapsible-trigger');await d.click(trigger);
 await render(node);
 assert.ok(d.find(n=>n.attrs['data-worker-event']==='received'),'exact immutable receipt is available on expansion');
 await d.click(trigger);
 assert.doesNotMatch(visibleText(d.container),/received|已收到的完整摘要|已结束/);
 assert.match(visibleText(d.container),/启动失败/);assert.match(visibleText(d.container),/当时：收到回复/);
}));
test('an unresolved source warning and answer remain without a separate task source card',async()=>withDom(async d=>{
 const sources=['验收已接受','交付已准备'].map((phaseLabel,i)=>({key:'source-'+i,target:{taskId:'task',version:1},title:'合成任务',icon:'Check',origin:{kind:'activity',processId:'internal',itemId:'tool-'+i},phaseLabel,owner:'main'}));
 await d.render(h(ProcessMessageContent,{node:{...node,items:[]},taskSources:sources,taskSourceUnresolved:true,renderText:t=>t},h('p',null,'唯一结论正文')));
 assert.doesNotMatch(visibleText(d.container),/验收已接受|交付已准备/);
 assert.match(visibleText(d.container),/部分任务来源尚未核实/);assert.match(visibleText(d.container),/唯一结论正文/);
 assert.equal(d.all().filter(n=>n.tagName==='BUTTON').length,0);
}));
