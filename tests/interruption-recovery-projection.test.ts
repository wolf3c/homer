import test from 'node:test';import assert from 'node:assert/strict';import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import {chatFixture} from './task-chat-fixture.js';import {WorkerInteractions} from '../src/worker-interactions.js';import {readTaskOverview,readTaskDetail,classifyTask} from '../src/task-overview.js';import {homerWebBridge} from '../src/web-homer.js';import type {Homer} from '../src/service.js';import {MainProcessHistory,type ProcessNode} from '../src/main-process.js';import {ProcessNodeView} from './helpers/process-ui-loader.mjs';import {withDom,visibleText} from './helpers/process-dom.mjs';
function fixture(){const f=chatFixture(),interactions=new WorkerInteractions(f.store.db),task=f.create(),worker=f.tasks.workerOpen(f.actor,{operationId:'open',taskId:task.taskId,text:'Inspect'}),run=f.start(worker.workerId);return {...f,interactions,task,worker,run};}
const changes=(f:ReturnType<typeof fixture>)=>f.store.db.prepare('SELECT total_changes() n').get();
function reply(f:ReturnType<typeof fixture>){return f.tasks.endSegment(f.run.id,f.run.epoch,{status:'completed',text:'PRIVATE_SENTINEL'},true)!;}
test('blocked receipt metadata remains read-only and cannot override the explicit Main settlement',()=>{
 const f=fixture();try{
  const returned=reply(f);f.store.db.prepare("UPDATE agent_receipts SET state='blocked' WHERE messageId=?").run(returned.messageId);f.tasks.settleTask(f.actor,{operationId:'settle',taskId:f.task.taskId,expectedRevision:1,outcome:'succeeded'});f.store.db.exec('PRAGMA query_only=ON');const before=changes(f),task=readTaskOverview(f.store.db).tasks[0]!;
  assert.equal(classifyTask(task).key,'complete');const receipts=readTaskDetail(f.store.db,task.id).recovery!.receipts;assert.equal(receipts.length,1);assert.equal(receipts[0]!.taskVersion,1);assert.deepEqual(Object.keys(receipts[0]!).sort(),['messageId','revision','state','taskId','taskVersion']);assert.deepEqual(changes(f),before);
 }finally{f.close();}
});
test('historical Worker receipt retains its version and exact identity without private payload or grants',()=>{
 const f=fixture();try{
  const returned=reply(f);
  f.store.db.prepare("UPDATE agent_receipts SET state='blocked' WHERE messageId=?").run(returned.messageId);
  f.tasks.updateTask(f.actor,{operationId:'new-goal',taskId:f.task.taskId,expectedRevision:1,patch:{goal:'Changed scope'},authority:f.authority});
  f.tasks.workerSend(f.actor,{operationId:'followup',workerId:f.worker.workerId,text:'Continue'});f.start(f.worker.workerId);f.tasks.reconcile();
  f.store.db.exec('PRAGMA query_only=ON');const before=changes(f),detail=readTaskDetail(f.store.db,f.task.taskId);
  const original=detail.recovery!.receipts.find(receipt=>receipt.messageId===returned.messageId)!;
  assert.equal(original.taskVersion,1);assert.equal(original.state,'blocked');
  assert.deepEqual(Object.keys(original).sort(),['messageId','revision','state','taskId','taskVersion']);
  assert.doesNotMatch(JSON.stringify(detail.recovery),/PRIVATE_SENTINEL|filePath|payload|details|authority|decision/);
  assert.deepEqual(changes(f),before);
 }finally{f.close();}
});
test('unknown process exposes returned safe status only on expansion without claiming Task completion',async()=>{
 const f=fixture();try{
  const history=new MainProcessHistory(f.store.db);history.start({id:'node',threadId:'thread:main',sourceKind:'user',sourceMessageIds:[],messageId:'reply'},'turn');history.tool('node',{id:'tool',label:'检查资料',phase:'end',status:'completed'});history.finish('node','unknown');const node=history.list('thread:main')[0]!,before=changes(f),html=renderToStaticMarkup(React.createElement(ProcessNodeView,{node,renderText:x=>x}));assert.match(html,/状态待确认/);
  await withDom(async d=>{await d.render(React.createElement(ProcessNodeView,{node,renderText:x=>x}));await d.click(d.find(n=>n.attrs['data-slot']==='collapsible-trigger'));assert.match(visibleText(d.container),/调用已返回/);assert.doesNotMatch(visibleText(d.container),/已经完成任务/);});assert.doesNotMatch(html,/重试全部|自动恢复|已经完成任务/);assert.deepEqual(changes(f),before);
 }finally{f.close();}
});
for(const kind of ['question','authorization'] as const)test(`inactive ${kind} links only its exact source and excludes private interaction fields`,async()=>{
 const f=fixture();try{
  const opened=f.interactions.open({runId:f.run.id,threadId:f.run.threadId!,turnId:f.run.turnId!,requestId:'native',source:'native',kind,details:{historyThreadId:'thread:main',params:{secret:'do not export'}},authority:{description:'PRIVATE',sourceRequestId:f.actor.sourceRequestId!,nativeApprovals:true}},()=>true);f.interactions.escalate(opened.id,'private question','private reason');let messages:any[]=f.history.list('thread:main').filter(m=>m.role==='user');
  const app={...f,registerWebSurface(){},snapshot:()=>({runs:f.store.runs(),tasks:f.tasks.tasks(),interactions:f.interactions.list()}),conversationState:()=>({threadId:'thread:main',messages,processNodes:[],isRunning:false,activeMessageId:null})} as unknown as Homer,bridge=homerWebBridge(app);assert.equal((await bridge.state()).interactions.length,1);f.interactions.expire(opened.id,'process_callback_lost');await opened.response;
  f.store.db.exec('PRAGMA query_only=ON');const before=changes(f),state=await bridge.state();assert.equal(state.interactions.length,0);assert.equal(state.inactiveInteractions!.length,1);assert.equal(state.inactiveInteractions![0]!.messageId,messages[0]!.id);assert.deepEqual(Object.keys(state.inactiveInteractions![0]!).sort(),['code','id','kind','messageId','sourceRequestId','state']);assert.doesNotMatch(JSON.stringify(state.inactiveInteractions),/private|secret|details|authority|decision/);assert.deepEqual(changes(f),before);messages=[{...messages[0],requestId:'different'}];assert.deepEqual((await bridge.state()).inactiveInteractions,[]);
 }finally{f.close();}
});
test('exact process ownership wins over source proximity and foreign history identity denies interaction links',async()=>{
 const f=fixture();try{
  const history=new MainProcessHistory(f.store.db);history.start({id:'worker-process',threadId:f.run.threadId!,sourceKind:'worker',sourceMessageIds:[],messageId:'process-reply'},f.run.turnId!);const opened=f.interactions.open({runId:f.run.id,threadId:f.run.threadId!,turnId:f.run.turnId!,requestId:'native',source:'native',kind:'question',details:{historyThreadId:'thread:main'},authority:{description:'Synthetic',sourceRequestId:f.actor.sourceRequestId!,nativeApprovals:true}},()=>true);f.interactions.expire(opened.id,'process_callback_lost');await opened.response;
  const app={...f,registerWebSurface(){},snapshot:()=>({runs:f.store.runs(),tasks:f.tasks.tasks(),interactions:f.interactions.list()}),conversationState:()=>({threadId:'thread:main',messages:f.history.list('thread:main'),processNodes:history.list(f.run.threadId!),isRunning:false,activeMessageId:null})} as unknown as Homer,bridge=homerWebBridge(app),projected=(await bridge.state()).inactiveInteractions!;assert.equal(projected[0]!.processId,'worker-process');assert.equal(projected[0]!.messageId,undefined);
  const record=f.interactions.inspect(opened.id);f.store.db.prepare('UPDATE worker_interactions SET details=? WHERE id=?').run(JSON.stringify({...record.details,historyThreadId:'foreign-thread'}),opened.id);assert.deepEqual((await bridge.state()).inactiveInteractions,[]);const node={...history.list(f.run.threadId!)[0]!,status:'unknown',state:'worked',items:[{id:'raw',seq:1,revision:1,kind:'tool',status:'completed',label:'secret-native-tool-args'}]} as ProcessNode,html=renderToStaticMarkup(React.createElement(ProcessNodeView,{node,renderText:x=>x}));assert.match(html,/状态待确认/);assert.doesNotMatch(html,/已记录调用返回：secret/);
 }finally{f.close();}
});
test('receipt projections exclude foreign recipients, targeted Runs and user input; old versions stay history',()=>{
 const f=fixture();try{
  const returned=reply(f);f.store.db.prepare("UPDATE agent_receipts SET state='blocked' WHERE messageId=?").run(returned.messageId);
  const pending=()=>readTaskOverview(f.store.db).tasks[0]!.workers[0]!.pendingMain,receipts=()=>readTaskDetail(f.store.db,f.task.taskId).recovery!.receipts;
  assert.equal(pending(),1);assert.equal(receipts().length,1);
  const empty=()=>{const before=changes(f);assert.equal(pending(),0);assert.deepEqual(receipts(),[]);assert.deepEqual(changes(f),before);};
  f.store.db.prepare('UPDATE agent_receipts SET recipientAgentId=? WHERE messageId=?').run('foreign',returned.messageId);empty();f.store.db.prepare('UPDATE agent_receipts SET recipientAgentId=? WHERE messageId=?').run(f.actor.agentId,returned.messageId);
  f.store.db.prepare('UPDATE agent_messages SET targetRunId=? WHERE id=?').run(f.run.id,returned.messageId);empty();f.store.db.prepare("UPDATE agent_messages SET targetRunId=NULL,kind='user_input' WHERE id=?").run(returned.messageId);empty();f.store.db.prepare("UPDATE agent_messages SET kind='worker_reply',taskVersion=0 WHERE id=?").run(returned.messageId);assert.equal(pending(),0);assert.equal(receipts()[0]!.taskVersion,0);
 }finally{f.close();}
});
