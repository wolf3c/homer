import {test} from 'node:test';import assert from 'node:assert/strict';
import {withTaskSources} from '../src/web-homer.js';import {MainProcessHistory,type ProcessNode} from '../src/main-process.js';import {chatFixture} from './task-chat-fixture.js';import type {DisplayMessage} from '../src/conversation-projection.js';
const node=(ids:string[],items:ProcessNode['items']=[]):ProcessNode=>({id:'process',threadId:'thread:main',seq:1,revision:1,sourceKind:'worker',sourceMessageIds:ids,messageId:'public',state:'worked',status:'completed',turnIds:['turn'],items});
const message=(process:ProcessNode,text='Public conclusion'):DisplayMessage=>({id:'public',threadId:'thread:main',requestId:null,role:'assistant',text,status:'completed',createdAt:2,process});
function setup(){const f=chatFixture(),task=f.create('Inspect synthetic evidence');const worker=f.tasks.workerOpen(f.actor,{operationId:'open',taskId:task.taskId,text:'PRIVATE_INSTRUCTION'}),run=f.start(worker.workerId),reply=f.tasks.endSegment(run.id,run.epoch,{status:'completed',text:'PRIVATE_REPLY'},true)!;return {...f,task,worker,run,reply,project:(m:DisplayMessage,thread='thread:main')=>withTaskSources(f.store.db,[m],thread)[0]!};}
test('only consumed authenticated scoped replies become sources, with immutable version and no raw body',()=>{
 const f=setup();try{
  const input=message(node([f.reply.messageId])),source=f.project(input);assert.equal(source.taskSources?.length,1);assert.equal(source.taskSources![0]!.phaseLabel,'收到 Worker 回复');assert.ok(source.taskSources![0]!.originalRequestMessageId);assert.doesNotMatch(JSON.stringify(source),/PRIVATE/);
  f.store.db.prepare("UPDATE agent_receipts SET state='rejected' WHERE messageId=?").run(f.reply.messageId);assert.deepEqual(f.project(input).taskSources,source.taskSources);
  assert.equal(f.project({...input,process:{...input.process!,turnIds:[]}}).taskSources,undefined);assert.equal(f.project(input,'other').taskSources,undefined);assert.equal(f.project({...input,text:''}).taskSources,undefined);assert.equal(f.project(message(node([]))).taskSources,undefined);
  f.tasks.updateTask(f.actor,{operationId:'next',taskId:f.task.taskId,expectedRevision:1,patch:{goal:'Changed scope'},authority:f.authority});assert.equal(f.project(input).taskSources![0]!.target.version,1);
  for(const column of ['senderAgentId','senderRunId','recipientAgentId']){const previous=f.store.db.prepare(`SELECT ${column} value FROM agent_messages WHERE id=?`).get(f.reply.messageId)!.value;f.store.db.prepare(`UPDATE agent_messages SET ${column}=? WHERE id=?`).run(column==='senderRunId'?null:'forged',f.reply.messageId);assert.equal(f.project(input).taskSources,undefined);f.store.db.prepare(`UPDATE agent_messages SET ${column}=? WHERE id=?`).run(previous??null,f.reply.messageId);}
 }finally{f.close();}
});
test('terminal headers preserve exact public action and drop a MiB raw body; action kinds cannot be forged',()=>{
 const f=setup();try{
  const args={operationId:'notes',taskId:f.task.taskId,expectedRevision:1,patch:{notes:'PRIVATE_NOTES'}},receipt=f.tasks.updateTask(f.actor,args),activity=f.tasks.captureActivity(f.actor,'task_update',args,receipt)!;
  const n={...node([],[{id:'tool',seq:1,revision:1,kind:'tool',status:'completed',label:'调整任务',activity,content:{private:'x'.repeat(1024*1024)}} as any]),sourceKind:'user' as const};f.store.setMeta('publicMainNode:v1:process',JSON.stringify(n));const header=new MainProcessHistory(f.store.db).headers(['process'])[0]!;
  assert.equal(header.items.length,1);assert.equal((header.items[0] as any).content,undefined);assert.ok(JSON.stringify(header).length<2000);assert.equal(f.project(message(header)).taskSources?.[0]?.target.taskId,f.task.taskId);
  (header.items[0] as any).activity.action='prepare_delivery';assert.equal(f.project(message(header)).taskSources,undefined);
 }finally{f.close();}
});
test('a reply remains a plain conversation fact and matching event cards suppress only the same occurrence',()=>{
 const f=setup();try{
  assert.equal(f.tasks.workerRead(f.actor,{workerId:f.worker.workerId}).messages.at(-1)?.text,'PRIVATE_REPLY');assert.equal(f.tasks.task(f.task.taskId).state,'open');
  const event={schemaVersion:1 as const,eventKind:'reply_received' as const,title:'Worker',body:'Public short preview',bodySource:'reply' as const,taskId:f.task.taskId,version:1,runId:f.run.id,sourceMessageId:f.reply.messageId,operationKey:null,observedAtMs:1,failureStage:null,errorCode:null};
  const n=node([f.reply.messageId],[{id:'e',kind:'workerEvent',seq:1,revision:1,eventKey:'e',event}]);assert.equal(f.project(message(n)).taskSources,undefined);
  (n.items[0] as any).event={...event,sourceMessageId:'unrelated'};assert.equal(f.project(message(n)).taskSources?.length,1);
 }finally{f.close();}
});
test('verified sources distinguish a literal title from an unavailable public name',()=>{
 const f=setup();try{
  const input=message(node([f.reply.messageId])),rename=f.store.db.prepare('UPDATE tasks SET title=? WHERE id=?');
  rename.run('后台工作',f.task.taskId);
  assert.equal(f.project(input).taskSources?.[0]?.title,'后台工作');
  rename.run('file:synthetic',f.task.taskId);
  const source=f.project(input).taskSources?.[0];
  assert.equal(source?.target.taskId,f.task.taskId);
  assert.equal(source?.title,'');
 }finally{f.close();}
});
test('creation provenance authenticates the actual returned Task and never a neighbouring Task',()=>{
 const f=chatFixture();try{
  const task=f.create(),activity=f.tasks.captureActivity(f.actor,'task_create',{},task)!;const n={...node([],[{id:'create',kind:'tool' as const,seq:1,revision:1,label:'创建任务',status:'completed' as const,activity}]),sourceKind:'user' as const};
  assert.equal(withTaskSources(f.store.db,[message(n)],'thread:main')[0]!.taskSources?.[0]?.target.taskId,task.taskId);
  const other=f.create('Another task','another');activity.target={...activity.target!,taskId:other.taskId};assert.equal(withTaskSources(f.store.db,[message(n)],'thread:main')[0]!.taskSources,undefined);
 }finally{f.close();}
});
