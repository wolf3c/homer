import test from 'node:test';import assert from 'node:assert/strict';import React from 'react';
import {ProcessMessageContent} from './helpers/process-ui-loader.mjs';import {withDom} from './helpers/process-dom.mjs';
test('a recorded startup failure keeps its original plain text and identity across updates',async()=>withDom(async d=>{
 const item={id:'event',kind:'workerEvent',seq:1,revision:1,eventKey:'event',event:{eventKind:'start_failed',title:'准确事项',body:'<img src=x onerror=never()> **原文**'}};
 const node={id:'node',threadId:'t',state:'working',status:'running',items:[item]};const render=n=>d.render(React.createElement(ProcessMessageContent,{node:n},'正式正文'));
 await render(node);const note=d.find(n=>n.tagName==='P');assert.match(note.textContent,/准确事项.*<img src=x onerror=never\(\)>/);
 assert.equal(d.all().filter(n=>['IMG','BUTTON','DIALOG','A'].includes(n.tagName)).length,0);
 await render({...node,revision:2,status:'unknown'});assert.equal(d.find(n=>n.tagName==='P'),note);assert.match(d.container.textContent,/正式正文/);
}));
