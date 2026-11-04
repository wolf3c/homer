import {test} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ProcessNodeView} from './helpers/process-ui-loader.mjs';

const node={id:'accessibility',threadId:'synthetic',seq:1,revision:1,sourceKind:'user',sourceMessageIds:[],messageId:'answer',state:'working',status:'running',turnIds:['turn'],items:[{id:'public-progress',kind:'commentary',text:'核对公开材料',seq:1,revision:1}]};
test('run status is announced without repeating the active duration or public progress',()=>{
 const html=renderToStaticMarkup(React.createElement(ProcessNodeView,{node,renderText:text=>React.createElement('p',null,text)}));
 assert.match(html,/aria-busy="true"/);
 const announcement=html.match(/<span[^>]*role="status"[^>]*>(.*?)<\/span>/s)?.[1];
 assert.ok(announcement,'one run status live region');
 assert.match(announcement,/当前对话 · 状态待确认/);
 assert.doesNotMatch(announcement,/核对公开材料|耗时/);
});
