import {test} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ProcessNodeView} from './helpers/process-ui-loader.mjs';

const node={id:'accessibility',threadId:'synthetic',seq:1,revision:1,sourceKind:'user',sourceMessageIds:[],messageId:'answer',state:'working',status:'running',turnIds:['turn'],items:[{id:'public-progress',kind:'commentary',text:'核对公开材料',seq:1,revision:1}]};
test('historical process rows do not repeat the live status or announce progress text',()=>{
 const html=renderToStaticMarkup(React.createElement(ProcessNodeView,{node}));
 assert.doesNotMatch(html,/role="status"|aria-live|aria-busy|核对公开材料|耗时/);
});
