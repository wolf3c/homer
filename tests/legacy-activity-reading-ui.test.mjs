import test from 'node:test';import assert from 'node:assert/strict';import React from 'react';
import {ProcessMessageContent} from './helpers/process-ui-loader.mjs';import {withDom,visibleText} from './helpers/process-dom.mjs';
test('legacy tool and Worker details stay hidden while formal content remains',async()=>withDom(async d=>{
 await d.render(React.createElement(ProcessMessageContent,{node:{id:'legacy',threadId:'t',state:'worked',status:'failed',items:[{id:'call',kind:'tool',seq:1,revision:1,label:'PRIVATE_TOOL',status:'failed'},{id:'worker',kind:'worker',seq:2,revision:1}]}},React.createElement('p',null,'保留正文')));
 assert.match(visibleText(d.container),/保留正文/);assert.doesNotMatch(visibleText(d.container),/旧后台工作记录|PRIVATE_TOOL|调用失败|过程详情/);
 assert.equal(d.all().filter(n=>n.attrs['data-slot']==='collapsible-trigger').length,0);
}));
