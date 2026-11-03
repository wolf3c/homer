import {test} from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {useProcessDetails} from './helpers/tool-ui-loader.mjs';
import {withDom} from './helpers/process-dom.mjs';
const header={id:'node',threadId:'thread',revision:1,details:'unloaded',items:[]};
test('one bounded message-level detail owner hydrates parts and rejects late epoch/thread/revision/abort/unmount reads',async()=>withDom(async d=>{
 let result;const waiting=[];
 const read=(id,signal)=>new Promise(resolve=>waiting.push({id,signal,resolve}));
 function Host({messages,thread='thread',epoch='epoch'}){result=useProcessDetails(messages,thread,epoch,read);return React.createElement('div',null,JSON.stringify(result.messages));}
 const message=process=>({id:'message',role:'assistant',text:'ANSWER',process});
 const render=props=>d.render(React.createElement(Host,{messages:[message(header)],...props}));
 await render({});const first=result.load('node',new AbortController().signal);
 await act(async()=>{waiting.shift().resolve({...header,revision:2,details:undefined,items:[{id:'tool',kind:'tool',content:{input:{state:'recorded',value:'BODY'}}}]});await first;});await render({});
 assert.match(d.container.textContent,/BODY/);
 await render({messages:[message({...header,revision:3})]});assert.doesNotMatch(d.container.textContent,/BODY/);
 const late=result.load('node',new AbortController().signal);const request=waiting.shift();await render({thread:'other',epoch:'other',messages:[]});request.resolve({...header,revision:4});await assert.rejects(late,/scope_changed/);
 assert.doesNotMatch(d.container.textContent,/BODY/);
 await render({});const controller=new AbortController(),aborted=result.load('node',controller.signal);controller.abort();waiting.shift().resolve({...header,revision:9});await assert.rejects(aborted,/scope_changed/);
 const stale=result.load('node',new AbortController().signal);await render({messages:[message({...header,revision:8})]});waiting.shift().resolve({...header,revision:7});await assert.rejects(stale,/scope_changed/);
 const pending=result.load('node',new AbortController().signal);await d.render(null);waiting.shift().resolve({...header,revision:9});await assert.rejects(pending,/scope_changed/);
}));
