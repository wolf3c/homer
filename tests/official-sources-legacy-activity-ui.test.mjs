import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import {createRequire} from 'node:module';
import React from 'react';
import {withDom} from './helpers/process-dom.mjs';
const require=createRequire(import.meta.url);
const {AssistantRuntimeProvider,ThreadPrimitive,useExternalStoreRuntime}=require('@assistant-ui/react');
const result=buildSync({entryPoints:['ui/message-details.tsx'],bundle:true,write:false,format:'cjs',platform:'node',jsx:'automatic',external:['react','react/jsx-runtime','@assistant-ui/*'],loader:{'.css':'empty'}});
const module={exports:{}};Function('require','module','exports',result.outputFiles[0].text)(require,module,module.exports);
const {MessageDetails}=module.exports,h=React.createElement;
const message={id:'legacy',threadId:'synthetic',role:'assistant',text:'',status:'completed',requestId:null,createdAt:1};
const slot=(d,name)=>d.find(n=>n.attrs['data-slot']===name);
test('empty historical metadata creates no disclosure',async()=>withDom(async d=>{
 await d.render(h(MessageDetails,{message}));assert.equal(slot(d,'sources'),undefined);assert.equal(slot(d,'run-activity'),undefined);
 await d.render(h(MessageDetails,{message:{...message,sources:[{id:'invalid',title:'禁止',url:'javascript:alert(1)'}]}}));assert.equal(slot(d,'sources'),undefined);
}));
test('official Sources preserves safe row identity/order without fetching icons or interpreting titles',async()=>withDom(async d=>{
 const sources=[{id:'b',title:'<img onerror=alert(1)>长中文',url:'https://www.example.com/a'},{id:'a',title:'同一URL另一条身份',url:'https://www.example.com/a'},...['javascript:alert(1)','data:text/html,x','https://name:secret@example.com/','/api/files/private','file:///private/test','broken'].map((url,i)=>({id:'bad-'+i,title:'不应显示',url}))];
 await d.render(h(MessageDetails,{message:{...message,sources}}));
 const root=slot(d,'sources');assert.ok(root,'official Sources root');
 assert.equal(root.attrs['data-layout'],'list');const trigger=slot(d,'collapsible-trigger');assert.equal(trigger.attrs['aria-expanded'],'false');await d.click(trigger);
 const links=d.all().filter(n=>n.attrs['data-slot']==='source-card');assert.deepEqual(links.map(n=>n.attrs['data-source-id']),['b','a']);
 assert.deepEqual(links.map(n=>n.attrs.href),sources.slice(0,2).map(s=>s.url));
 for(const link of links){assert.equal(link.attrs.target,'_blank');assert.equal(link.attrs.rel,'noopener noreferrer');}
 assert.match(d.container.textContent,/<img onerror=alert\(1\)>长中文/);assert.match(d.container.textContent,/未经独立核验/);assert.doesNotMatch(d.container.textContent,/不应显示|secret/);
 assert.equal(d.all().some(n=>n.tagName==='IMG'),false);
}));
test('legacy calls use one neutral RunActivity, preserve same-name IDs and user disclosure across updates',async()=>withDom(async d=>{
 const tools=['completed','failed','blocked','running','unexpected'].map((status,i)=>({id:'call-'+i,label:i===4?'':'同名检查',status}));
 const render=(status='completed')=>d.render(h(MessageDetails,{message:{...message,status,toolActivities:tools}}));
 await render('running');const root=slot(d,'run-activity');assert.ok(root);assert.equal(root.attrs['data-status'],'incomplete');assert.equal(slot(d,'collapsible-trigger').attrs['aria-expanded'],'false');
 await d.click(slot(d,'collapsible-trigger'));assert.deepEqual(d.all().filter(n=>n.attrs['data-tool-id']).map(n=>n.attrs['data-tool-id']),tools.map(t=>t.id));
 for(const text of ['调用已返回','调用失败','已中断，待核对','调用中','结束状态待核实','工具名称未保留'])assert.ok(d.container.textContent.includes(text),text);
 assert.doesNotMatch(d.container.textContent,/成功|验收|交付|查看活动|查看关联任务|\d+s/);
 await render();assert.equal(slot(d,'collapsible-trigger').attrs['aria-expanded'],'true');
 assert.equal(d.all().filter(n=>n.attrs['data-slot']==='run-activity').length,1);
 await d.render(h(MessageDetails,{message:{...message,id:'another',toolActivities:tools}}));assert.equal(slot(d,'collapsible-trigger').attrs['aria-expanded'],'false');
}));

// Real message runtime and MessageDetails; synthetic DOM, no native clipboard/layout.
test('runtime text messages expose only Copy while preserving copy feedback',async()=>withDom(async d=>{
 const text='**literal source**',original={...message,id:'copy-message',text},writes=[];
 const previous=Object.getOwnPropertyDescriptor(globalThis,'navigator');
 let fail=false;
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard:{writeText:async value=>{if(fail)throw Error('synthetic_clipboard_denied');writes.push(value);}}}});
 try{
 function Harness(){
  const runtime=useExternalStoreRuntime({messages:[{id:original.id,role:'assistant',content:[{type:'text',text}]}],convertMessage:value=>value,onNew:async()=>{}});
  return h(AssistantRuntimeProvider,{runtime},h(ThreadPrimitive.Messages,{components:{AssistantMessage:()=>h(MessageDetails,{message:original,runtime:true})}}));
 }
 await d.render(h(Harness));
 const bar=slot(d,'message-actions');assert.ok(bar);
 assert.deepEqual(bar.childNodes.filter(n=>n.tagName==='BUTTON').map(n=>n.attrs['aria-label']),['复制']);
 const copy=()=>slot(d,'message-actions').childNodes.find(n=>n.tagName==='BUTTON');
 assert.equal(copy().attrs['aria-busy'],'false');
 await d.click(copy());assert.deepEqual(writes,[text]);
 const notice=()=>d.find(n=>n.attrs.role==='status');
 assert.equal(notice().textContent,'已复制');assert.match(notice().attrs.class,/sr-only/);
 fail=true;await d.click(copy());
 assert.match(notice().textContent,/复制失败：synthetic_clipboard_denied/);assert.doesNotMatch(notice().attrs.class,/sr-only/);
 assert.equal(copy().attrs['aria-busy'],'false');assert.deepEqual(writes,[text]);
 }finally{if(previous)Object.defineProperty(globalThis,'navigator',previous);else delete globalThis.navigator;}
}));
