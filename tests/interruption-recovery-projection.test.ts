import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {fixture,running,complete,replacement,mutation,snapshot,main} from './interruption-fixture.js';
import {readTaskOverview,readTaskDetail,classifyTask} from '../src/task-overview.js';
import {homerWebBridge} from '../src/web-homer.js';
import {MainInputs} from '../src/recursive-main-inputs.js';
import {ConversationHistory} from '../src/web-history.js';
import {withDom,visibleText} from './helpers/process-dom.mjs';
import type {Homer} from '../src/service.js';
import {MainProcessHistory,type ProcessNode} from '../src/main-process.js';
import {ProcessNodeView} from './helpers/process-ui-loader.mjs';

test('A blocked receipt metadata is current-version scoped and never replaces true completion classification',t=>{
 const f=fixture(t),a=running(f);complete(f,a);
 const publication=f.tasks.publish(main,{...mutation(f,undefined,'publish-complete'),resultId:readTaskOverview(f.store.db).tasks[0]!.result!.id,text:'Synthetic complete',publishedFileResultId:null});f.tasks.markDelivery(publication.deliveryId!,'recorded');
 const pending=f.tasks.inbox(main);assert.ok(pending.length);f.store.db.prepare("UPDATE agent_receipts SET state='blocked'").run();
 const before=snapshot(f),data=readTaskOverview(f.store.db),task=data.tasks[0]!;
 assert.ok((task as any).coordination?.blocked>0);assert.equal(classifyTask(task).key,'complete');
 const detail=readTaskDetail(f.store.db,f.root.taskId) as any;assert.ok(detail.recovery.receipts.length);assert.equal(detail.recovery.receipts[0].taskVersion,1);
 assert.deepEqual(Object.keys(detail.recovery.receipts[0]).sort(),['messageId','revision','state','taskId','taskVersion']);
 assert.equal(snapshot(f),before);assert.deepEqual(f.effects,[]);
 f.tasks.update(main,replacement(f));const current=readTaskOverview(f.store.db).tasks[0] as any;assert.equal(current.coordination.blocked,0);
 assert.ok((readTaskDetail(f.store.db,f.root.taskId) as any).recovery.receipts.some((r:any)=>r.taskVersion===1));
});
test('A accepted historical results and deliveries preserve exact version/run/result metadata without payload or grants',t=>{
 const f=fixture(t),a=running(f),result=complete(f,a);
 const publication=f.tasks.publish(main,{...mutation(f,undefined,'publish'),resultId:result.resultId!,text:'Synthetic private payload sentinel',publishedFileResultId:null});
 f.tasks.markDelivery(publication.deliveryId!,'recorded');assert.equal(classifyTask(readTaskOverview(f.store.db).tasks[0]!).key,'complete');
 f.tasks.update(main,replacement(f));running(f);f.tasks.reconcile();const before=snapshot(f),d=readTaskDetail(f.store.db,f.root.taskId) as any;
 const r=d.recovery.results.find((r:any)=>r.id===result.resultId);assert.equal(r.version,1);assert.equal(r.runId,a.runId);assert.equal(r.state,'accepted');
 assert.deepEqual(Object.keys(r).sort(),['completionResultId','id','outcome','runId','state','taskId','version']);
 const delivery=d.recovery.deliveries.find((r:any)=>r.id===publication.deliveryId);assert.equal(delivery.resultId,r.id);assert.equal(delivery.version,1);assert.ok(delivery.historyMessageId);assert.equal(delivery.state,'recorded');
 assert.notEqual(readTaskOverview(f.store.db).tasks[0]!.result?.id,result.resultId);assert.equal(readTaskOverview(f.store.db).tasks[0]!.result?.state,'offered');assert.doesNotMatch(JSON.stringify(d.recovery),/sentinel|filePath|payload|details|authority|decision/);assert.equal(snapshot(f),before);
 f.tasks.markDelivery(publication.deliveryId!,'revoked');assert.equal(readTaskDetail(f.store.db,f.root.taskId).recovery!.deliveries.find(d=>d.id===publication.deliveryId)!.state,'revoked');
});
test('A unknown processing exposes returned safe label only on expansion without claiming business completion',async t=>{
 const f=fixture(t),h=new MainProcessHistory(f.store.db);h.start({id:'node-synthetic',threadId:'synthetic-main',sourceKind:'user',sourceMessageIds:['user-message'],messageId:'reply'},'turn');
 h.tool('node-synthetic',{id:'tool',label:'检查资料',phase:'end',status:'completed'});h.finish('node-synthetic','unknown');
 const node=h.list('synthetic-main')[0]!,before=snapshot(f);const html=renderToStaticMarkup(React.createElement(ProcessNodeView,{node,renderText:x=>x}));
 assert.match(html,/状态待确认/);await withDom(async d=>{await d.render(React.createElement(ProcessNodeView,{node,renderText:x=>x}));await d.click(d.find(n=>n.attrs['data-slot']==='collapsible-trigger'));assert.match(visibleText(d.container),/调用已返回/);assert.doesNotMatch(visibleText(d.container),/已经完成任务/);});assert.doesNotMatch(html,/重试全部|自动恢复|已经完成任务/);assert.equal(snapshot(f),before);
 const normal={...node,state:'worked',status:'completed'} as ProcessNode;assert.doesNotMatch(renderToStaticMarkup(React.createElement(ProcessNodeView,{node:normal,renderText:x=>x})),/不代表实际操作完成/);
});
for(const kind of ['question','authorization'] as const)test(`A inactive ${kind} is linked only to exact source/process; pending remains original card`,async t=>{
 const f=fixture(t),a=running(f);f.store.setMeta('mainThread','synthetic-main');
 const opened=f.interactions.open({runId:a.runId!,threadId:a.threadId!,turnId:a.turnId!,requestId:'native',source:'native',kind,details:{historyThreadId:'synthetic-main',params:{secret:'do not export'}},authority:{description:'private',sourceRequestId:main.sourceRequestId!,nativeApprovals:true}},()=>true);
 f.interactions.escalate(opened.id,'private question','private reason');
 let messages:any[]=[{id:'exact-user-message',role:'user',requestId:main.sourceRequestId,text:'Synthetic input',threadId:'synthetic-main',status:'completed'}];
 const app={store:f.store,tasks:f.tasks,inputs:new MainInputs(f.tasks,new ConversationHistory(f.store.db)),files:{},interactions:f.interactions,registerChannelCapabilities(){},snapshot:()=>({matters:f.store.matters(),runs:f.store.runs(),tasks:f.tasks.tasks(),deliveries:f.tasks.deliveries(),interactions:f.interactions.list()}),conversationState:()=>({threadId:'synthetic-main',messages,processNodes:[],isRunning:false,activeMessageId:null})} as unknown as Homer;
 const bridge=homerWebBridge(app);assert.equal((await bridge.state()).interactions.length,1);
 f.interactions.expire(opened.id,'process_callback_lost');await opened.response;
 const before=snapshot(f),state=await bridge.state() as any;assert.equal(state.interactions.length,0);assert.equal(state.inactiveInteractions.length,1);assert.equal(state.inactiveInteractions[0].messageId,'exact-user-message');
 assert.deepEqual(Object.keys(state.inactiveInteractions[0]).sort(),['code','id','kind','messageId','sourceRequestId','state']);assert.equal(state.inactiveInteractions[0].code,'process_callback_lost');assert.doesNotMatch(JSON.stringify(state.inactiveInteractions),/private|secret|details|authority|decision/);assert.equal(snapshot(f),before);
 messages=[{...messages[0],requestId:'different-source'}];assert.deepEqual((await bridge.state() as any).inactiveInteractions,[]);
});

test('A source mapping never guesses nearby messages; exact process match wins and safe summary rejects raw labels',async t=>{
 const f=fixture(t),a=running(f),history=new MainProcessHistory(f.store.db);f.store.setMeta('mainThread','synthetic-main');
 history.start({id:'worker-process',threadId:a.threadId!,sourceKind:'worker',sourceMessageIds:[],messageId:'process-reply'},a.turnId!);
 const opened=f.interactions.open({runId:a.runId!,threadId:a.threadId!,turnId:a.turnId!,requestId:'native',source:'native',kind:'question',details:{historyThreadId:'synthetic-main'},authority:{description:'Synthetic test',nativeApprovals:true,sourceRequestId:main.sourceRequestId!}},()=>true);f.interactions.expire(opened.id,'process_callback_lost');await opened.response;
 const app={store:f.store,tasks:f.tasks,inputs:new MainInputs(f.tasks,new ConversationHistory(f.store.db)),files:{},interactions:f.interactions,registerChannelCapabilities(){},snapshot:()=>({matters:f.store.matters(),runs:f.store.runs(),tasks:f.tasks.tasks(),deliveries:f.tasks.deliveries(),interactions:f.interactions.list()}),conversationState:()=>({threadId:'synthetic-main',messages:[{id:'source',role:'user',requestId:main.sourceRequestId,text:'synthetic'}],processNodes:history.list(a.threadId!),isRunning:false,activeMessageId:null})} as unknown as Homer;
 const projected=(await homerWebBridge(app).state()).inactiveInteractions!;assert.equal(projected[0]!.processId,'worker-process');assert.equal(projected[0]!.messageId,undefined);
 const record=f.interactions.inspect(opened.id);f.store.db.prepare('UPDATE worker_interactions SET details=? WHERE id=?').run(JSON.stringify({...record.details,historyThreadId:'foreign-thread'}),opened.id);assert.deepEqual((await homerWebBridge(app).state()).inactiveInteractions,[]);
 const node={...history.list(a.threadId!)[0]!,status:'unknown',state:'worked',items:[{id:'raw',seq:1,revision:1,kind:'tool',status:'completed',label:'secret-native-tool-args'}]} as ProcessNode;
 const html=renderToStaticMarkup(React.createElement(ProcessNodeView,{node,renderText:x=>x}));assert.match(html,/状态待确认/);assert.doesNotMatch(html,/已记录调用返回：secret/);
});
test('A receipt projection excludes foreign recipients, targeted runs, user inputs and old versions',t=>{
 const f=fixture(t),a=running(f);complete(f,a);f.tasks.inbox(main);f.store.db.prepare("UPDATE agent_receipts SET state='blocked'").run();
 const receipt=f.store.db.prepare("SELECT m.id,m.kind,m.taskVersion FROM agent_messages m JOIN agent_receipts ar ON ar.messageId=m.id WHERE ar.recipientAgentId=? AND m.kind<>'user_input' LIMIT 1").get(main.agentId) as {id:string;kind:string;taskVersion:number};assert.ok(receipt);
 // Isolate this single receipt; synthetic fixture changes are outside reads.
 f.store.db.prepare('DELETE FROM agent_receipts WHERE messageId<>?').run(receipt.id);
 function empty(){const before=snapshot(f);assert.equal(readTaskOverview(f.store.db).tasks[0]!.coordination!.blocked,0);assert.equal(readTaskDetail(f.store.db,f.root.taskId).recovery!.receipts.length,0);assert.equal(snapshot(f),before);assert.deepEqual(f.effects,[]);}
 f.store.db.prepare('UPDATE agent_receipts SET recipientAgentId=? WHERE messageId=?').run('main:foreign',receipt.id);empty();f.store.db.prepare('UPDATE agent_receipts SET recipientAgentId=? WHERE messageId=?').run(main.agentId,receipt.id);
 f.store.db.prepare('UPDATE agent_messages SET targetRunId=? WHERE id=?').run(a.runId!,receipt.id);empty();f.store.db.prepare('UPDATE agent_messages SET targetRunId=NULL,kind=? WHERE id=?').run('user_input',receipt.id);empty();
 f.store.db.prepare('UPDATE agent_messages SET kind=?,taskVersion=? WHERE id=?').run(receipt.kind,0,receipt.id);
 const before=snapshot(f);assert.equal(readTaskOverview(f.store.db).tasks[0]!.coordination!.blocked,0);assert.equal(readTaskDetail(f.store.db,f.root.taskId).recovery!.receipts[0]!.taskVersion,0);assert.equal(snapshot(f),before);
});
