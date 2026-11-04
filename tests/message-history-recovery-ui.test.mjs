import {test} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {historicalQueueState,queuedPair} from './fixtures/historical-queue-state.mjs';
import {projectConversation} from '../src/conversation-projection.js';
import {HistoryWindow} from '../ui/history-window.js';
import {ProcessNodeView} from './helpers/process-ui-loader.mjs';
import {withDom,visibleText} from './helpers/process-dom.mjs';

const project=s=>projectConversation(s.messages,s.processNodes,s.queue);
function state(){
 const s=historicalQueueState();
 // A native final requires its original item, not an aggregate summary.
 const n=s.processNodes[1];n.items=[{id:n.final.id,kind:'commentary',phase:'final_answer',text:n.final.text,completed:true,seq:1,revision:1}];
 return s;
}

test('historical receipt identities retain source order and separate similar long inputs at actual ACK nodes',()=>{
 const s=state(),before=JSON.stringify(s),shown=project(s).messages;
 const cancelled=new Set(s.queue.filter(q=>q.state==='cancelled').map(q=>q.input.requestId));
 assert.deepEqual(shown.filter(m=>m.requestId?.startsWith('legacy-')).map(m=>m.id),s.messages.filter(m=>m.requestId?.startsWith('legacy-')&&!cancelled.has(m.requestId)).map(m=>m.id));
 assert.deepEqual(shown.slice(-4).map(m=>m.id),['user-handoff-original','node-handoff-original','user-handoff-later','node-handoff-later']);
 for(const id of ['handoff-original','handoff-later'])assert.equal(shown.filter(m=>m.requestId===id&&m.role==='user').length,1);
 assert.equal(shown.at(-1).text,'合成核对已完成');assert.equal(project(s).queue.length,0);assert.equal(JSON.stringify(s),before);
});

test('historical terminal receipts keep their replies while a newly accepted input stays in the FIFO queue',()=>{
 for(const status of ['completed','failed','uncertain','interrupted']){
  const s=state();s.processNodes=[];s.messages=s.messages.slice(0,2);s.queue=s.queue.slice(0,1);s.queue[0].state=status;
  const live=queuedPair('fresh',90);s.messages.push(live.user);s.queue.push(live.queue);
  assert.deepEqual(project(s).messages.map(m=>m.id),['user-legacy-0','reply-legacy-0'],status);
  assert.deepEqual(project(s).queue.map(q=>q.user.id),['user-fresh'],status);
 }
});

test('accepted inputs appear once in queue then move to formal history only at their own ACK nodes',()=>{
 const s=state(),q=Array.from({length:6},(_,i)=>queuedPair('queue-'+i,80+i));
 s.messages.push(...q.map(x=>x.user));s.queue.push(...q.map(x=>x.queue));
 assert.deepEqual(project(s).queue.map(q=>q.user.id),q.map(x=>x.user.id));
 for(let i=0;i<q.length;i++){
  const pair=q[i];pair.queue.state='processing';pair.queue.revision++;
  assert.ok(project(s).queue.some(q=>q.messageId===pair.queue.messageId));
  const n={...s.processNodes[1],id:'process-'+i,messageId:'process-'+i,replyMessageId:pair.queue.replyId,sourceMessageIds:[pair.queue.messageId],seq:3+i,revision:1,final:undefined,items:[]};
  s.processNodes.push(n);s.messages.push({...pair.user,id:n.messageId,role:'assistant',text:'',status:'completed'});
  const view=project(s);assert.equal(view.messages.filter(m=>m.id===pair.user.id).length,1);assert.ok(!view.queue.some(q=>q.messageId===pair.queue.messageId));
  assert.deepEqual(view.queue.map(q=>q.user.id),q.slice(i+1).map(x=>x.user.id));
 }
});

test('history cache refuses an older snapshot that would revive an unknown process',()=>{
 const s=state(),cache=new HistoryWindow();
 const snapshot=(revision,status)=>({...s,messages:project({...s,processNodes:s.processNodes.map(n=>({...n,status,revision}))}).messages,history:{protocol:3,readEpoch:'epoch',page:{protocol:3,threadId:s.threadId,revision,units:['unit'],before:null,after:null}}});
 cache.snapshot(snapshot(4,'unknown'));assert.equal(cache.snapshot(snapshot(3,'running')),false);
 assert.equal(cache.messages.find(m=>m.id==='node-handoff-original').process.status,'unknown');
});

test('unknown node stays inactive and its unfinished call reports historical uncertainty only when expanded',async()=>{
 const s=state(),n=s.processNodes[0],shown=project(s).messages.find(m=>m.id===n.messageId);
 assert.notEqual(shown.status,'running');assert.equal(s.isRunning,false);assert.equal(s.activeMessageId,null);
 const html=renderToStaticMarkup(React.createElement(ProcessNodeView,{node:n,renderText:t=>t}));assert.match(html,/状态待确认/);assert.doesNotMatch(html,/本次主 Agent 正在处理/);
 await withDom(async d=>{await d.render(React.createElement(ProcessNodeView,{node:n,renderText:t=>t}));await d.click(d.find(n=>n.attrs['data-slot']==='collapsible-trigger'));assert.match(visibleText(d.container),/结束未确认/);assert.doesNotMatch(visibleText(d.container),/· 调用中/);});
});
