import test from 'node:test';import assert from 'node:assert/strict';import React from 'react';
import {ProcessMessageContent} from './helpers/process-ui-loader.mjs';import {withDom} from './helpers/process-dom.mjs';
test('immutable Worker cards retain original plain text and identity without a tool reader',async()=>withDom(async d=>{
 const item={id:'event',kind:'workerEvent',seq:1,revision:1,eventKey:'event',event:{eventKind:'start_failed',title:'准确事项',body:'<img src=x onerror=never()> **原文**'}};
 const node={id:'node',threadId:'t',state:'working',status:'running',items:[item]};const render=n=>d.render(React.createElement(ProcessMessageContent,{node:n},'正式正文'));
 await render(node);const card=d.find(n=>n.attrs['data-worker-event']==='event');assert.ok(card);assert.equal(card.attrs['data-state'],'failed');
 await d.click(card.firstChild);assert.match(card.textContent,/<img src=x onerror=never\(\)>/);assert.equal(d.all().filter(n=>['IMG','DIALOG','A'].includes(n.tagName)).length,0);
 await render({...node,revision:2,status:'unknown'});assert.equal(d.find(n=>n.attrs['data-worker-event']==='event'),card);assert.equal(card.firstChild.attrs['aria-expanded'],'true');assert.match(d.container.textContent,/正式正文/);
}));
