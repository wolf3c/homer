import {test} from 'node:test';import assert from 'node:assert/strict';
import {withTaskSources} from '../src/web-homer.js';import {MainProcessHistory,type ProcessNode} from '../src/main-process.js';import {chatFixture} from './task-chat-fixture.js';import type {DisplayMessage} from '../src/conversation-projection.js';
import {WorkerInteractions} from '../src/worker-interactions.js';
const node=(ids:string[],items:ProcessNode['items']=[]):ProcessNode=>({id:'process',threadId:'thread:main',seq:1,revision:1,sourceKind:'worker',sourceMessageIds:ids,messageId:'public',state:'worked',status:'completed',turnIds:['turn'],items});
const message=(process:ProcessNode,text='Public conclusion'):DisplayMessage=>({id:'public',threadId:'thread:main',requestId:null,role:'assistant',text,status:'completed',createdAt:2,process});
function setup(){const f=chatFixture(),task=f.create('Inspect synthetic evidence');const worker=f.tasks.workerOpen(f.actor,{operationId:'open',taskId:task.taskId,text:'PRIVATE_INSTRUCTION'}),run=f.start(worker.workerId),reply=f.tasks.endSegment(run.id,run.epoch,{status:'completed',text:'PRIVATE_REPLY'},true)!;return {...f,task,worker,run,reply,project:(m:DisplayMessage,thread='thread:main')=>withTaskSources(f.store.db,[m],thread)[0]!};}
test('only consumed authenticated scoped replies become sources, with immutable version and no raw body',()=>{
 const f=setup();try{
  const input=message(node([f.reply.messageId])),source=f.project(input);assert.equal(source.taskSources?.length,1);assert.equal(source.taskSources![0]!.phaseLabel,'收到 Worker 回复');assert.ok(source.taskSources![0]!.originalRequestMessageId);assert.doesNotMatch(JSON.stringify(source),/PRIVATE/);
  f.store.db.prepare("UPDATE agent_receipts SET state='rejected' WHERE messageId=?").run(f.reply.messageId);assert.deepEqual(f.project(input).taskSources,source.taskSources);
  assert.equal(f.project({...input,process:{...input.process!,turnIds:[]}}).taskSources,undefined);assert.equal(f.project(input,'other').taskSources,undefined);assert.deepEqual(f.project({...input,text:''}).taskSources,source.taskSources);assert.equal(f.project(message(node([]))).taskSources,undefined);
  f.tasks.updateTask(f.actor,{operationId:'next',taskId:f.task.taskId,expectedRevision:1,patch:{goal:'Changed scope'},authority:f.authority});assert.equal(f.project(input).taskSources![0]!.target.version,1);
  for(const column of ['senderAgentId','senderRunId','recipientAgentId']){const previous=f.store.db.prepare(`SELECT ${column} value FROM agent_messages WHERE id=?`).get(f.reply.messageId)!.value;f.store.db.prepare(`UPDATE agent_messages SET ${column}=? WHERE id=?`).run(column==='senderRunId'?null:'forged',f.reply.messageId);assert.equal(f.project(input).taskSources,undefined);f.store.db.prepare(`UPDATE agent_messages SET ${column}=? WHERE id=?`).run(previous??null,f.reply.messageId);}
 }finally{f.close();}
});
test('an acknowledged Worker process has its authenticated title before any public answer',()=>{
 const f=setup();try{
  f.store.db.prepare('UPDATE tasks SET title=? WHERE id=?').run('关于荷马显示版本号',f.task.taskId);
  const input=message({...node([f.reply.messageId]),state:'working',status:'running'},'');
  const source=f.project(input);
  assert.equal(source.taskSources?.[0]?.title,'关于荷马显示版本号');
  assert.doesNotMatch(JSON.stringify(source),/PRIVATE/);
  assert.equal(f.project({...input,process:{...input.process!,turnIds:[]}}).taskSources,undefined);
  assert.equal(f.project({...input,process:{...input.process!,threadId:'other'}}).taskSources,undefined);
  f.store.db.prepare("UPDATE agent_messages SET senderAgentId='forged' WHERE id=?").run(f.reply.messageId);
  assert.equal(f.project(input).taskSources,undefined);
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

test('formal text and attachment replies keep their stored task version without a process',()=>{
 const f=chatFixture();try{
  const task=f.create();f.store.db.prepare('UPDATE tasks SET title=? WHERE id=?').run('正式事项',task.taskId);
  const originals=['Public reply',''].map((text,index)=>{
   const id=f.store.transaction(()=>f.history.commitAssistant({threadId:f.actor.threadId!,text,taskId:task.taskId,taskVersion:1,operationKey:'send:formal-'+index,attachments:text?[]:[{assetId:'asset-demo',revision:1} as any]}));
   return f.history.message(id)!;
  });
  f.tasks.updateTask(f.actor,{operationId:'next',taskId:task.taskId,expectedRevision:1,patch:{goal:'Next version'},authority:f.authority});
  const before=JSON.stringify(originals),projected=withTaskSources(f.store.db,originals,f.actor.threadId!);
  for(const [index,result] of projected.entries()){
   assert.equal(result.taskSources?.length,1);assert.equal(result.taskSources![0]!.title,'正式事项');
   assert.deepEqual(result.taskSources![0]!.target,{taskId:task.taskId,version:1});
   assert.deepEqual(result.taskSources![0]!.origin,{kind:'message',messageId:originals[index]!.id});
   assert.equal(result.text,originals[index]!.text);assert.deepEqual(result.attachments,originals[index]!.attachments);
   assert.equal(result.process,undefined);assert.equal(result.taskSourceUnresolved,undefined);
  }
  assert.equal(JSON.stringify(originals),before);
 }finally{f.close();}
});
test('formal titles require complete same-thread task bindings and never infer an unbound reply',()=>{
 const f=chatFixture();try{
  const task=f.create(),id=f.store.transaction(()=>f.history.commitAssistant({threadId:f.actor.threadId!,text:'Public reply',taskId:task.taskId,taskVersion:1,operationKey:'send:bound'}));
  const raw=f.history.message(id)!;
  const project=(patch:object={})=>withTaskSources(f.store.db,[{...raw,...patch}],f.actor.threadId!)[0]!;
  for(const patch of [{taskId:null,taskVersion:null},{taskVersion:null},{taskId:null},{taskVersion:0},{taskVersion:-1},{taskVersion:1.5},{taskVersion:99},{taskId:'missing'},{operationKey:null},{threadId:'other'}]){
   assert.equal(project(patch).taskSources,undefined,JSON.stringify(patch));
  }
  assert.ok(project().taskSources);
  f.store.db.prepare("DELETE FROM conversation_messages WHERE role='user'").run();
  assert.ok(project().taskSources);assert.equal(project().taskSources![0]!.originalRequestMessageId,undefined);
  f.store.db.prepare("UPDATE conversation_inputs SET threadId='other' WHERE requestId=?").run(f.authority.sourceRequestId);
  assert.equal(project().taskSources,undefined);
 }finally{f.close();}
});

test('formal replies batch distinct task versions and deduplicate repeated lookup keys',()=>{
 const f=chatFixture();try{
  const tasks=Array.from({length:201},(_,i)=>f.create('Synthetic task '+i,'batch-'+i));
  const messages=tasks.flatMap(task=>[0,1].map(index=>{
   const id=f.store.transaction(()=>f.history.commitAssistant({threadId:f.actor.threadId!,text:'Public reply',taskId:task.taskId,taskVersion:1,operationKey:'send:'+task.taskId+':'+index}));
   return f.history.message(id)!;
  }));
  const prepare=f.store.db.prepare.bind(f.store.db);let versionQueries=0;
  f.store.db.prepare=((sql:string)=>{if(sql.includes('JOIN task_versions'))versionQueries++;return prepare(sql);}) as typeof prepare;
  const result=withTaskSources(f.store.db,messages,f.actor.threadId!);
  assert.equal(result.length,402);assert.equal(versionQueries,2);
  for(let i=0;i<result.length;i++)assert.deepEqual(result[i]!.taskSources?.map(s=>[s.target.taskId,s.target.version]),[[tasks[Math.floor(i/2)]!.taskId,1]]);
 }finally{f.close();}
});

test('interaction notices require the persisted interaction, execution and receiving round',()=>{
 const f=chatFixture();try{
  const task=f.create(),worker=f.tasks.workerOpen(f.actor,{operationId:'open',taskId:task.taskId,text:'Synthetic input'}),run=f.start(worker.workerId);
  const db=f.store.db,interactions=new WorkerInteractions(db,{persisted:id=>f.tasks.queueInteraction(id)});
  const {id}=interactions.open({runId:run.id,threadId:run.threadId!,turnId:run.turnId!,requestId:'question',source:'ask_main',kind:'question',
   runEpoch:run.epoch,taskVersion:run.version,details:{question:'PRIVATE_QUESTION'},authority:{...f.authority,nativeApprovals:false}},()=>true);
  const key='interaction:'+id,notice=String(db.prepare('SELECT id FROM agent_messages WHERE operationKey=?').get(key)!.id);
  f.consumeMain(notice);
  const process=new MainProcessHistory(db).headers(['consumer:'+notice])[0]!;
  const project=(n=process)=>withTaskSources(db,[message(n,'')],f.actor.threadId!)[0]!;
  assert.deepEqual(project().taskSources?.[0]?.target,{taskId:task.taskId,version:run.version,runId:run.id});
  assert.equal(project().taskSourceUnresolved,undefined);
  assert.doesNotMatch(JSON.stringify(project()),/PRIVATE_QUESTION/);
  const rejected=()=>{assert.equal(project().taskSources,undefined);assert.equal(project().taskSourceUnresolved,true);};
  for(const sql of [
   "UPDATE operations SET operationId='other' WHERE id=?",
   "UPDATE operations SET kind='notify' WHERE id=?",
   "UPDATE operations SET kind='worker_return' WHERE id=?",
   "UPDATE agent_messages SET payloadJson=json_set(payloadJson,'$.workerId','other') WHERE operationKey=?",
   "UPDATE agent_messages SET payloadJson=json_set(payloadJson,'$.turnId','other') WHERE operationKey=?",
   "UPDATE agent_messages SET senderEpoch=senderEpoch-1 WHERE operationKey=?",
   "UPDATE agent_messages SET senderRunId=NULL WHERE operationKey=?",
   "UPDATE worker_interactions SET taskVersion=taskVersion+1 WHERE 'interaction:'||id=?",
   "UPDATE worker_interactions SET authority=json_set(authority,'$.sourceRequestId','elsewhere') WHERE 'interaction:'||id=?",
   "UPDATE conversation_inputs SET threadId='other' WHERE requestId=(SELECT json_extract(authority,'$.sourceRequestId') FROM worker_interactions WHERE 'interaction:'||id=?)",
   "DELETE FROM worker_interactions WHERE 'interaction:'||id=?",
   "UPDATE agent_receipts SET offeredTurnId='other' WHERE messageId=(SELECT id FROM agent_messages WHERE operationKey=?)",
   "DELETE FROM agent_receipts WHERE messageId=(SELECT id FROM agent_messages WHERE operationKey=?)",
  ]){
   db.exec('SAVEPOINT bad_source');db.prepare(sql).run(key);rejected();db.exec('ROLLBACK TO bad_source; RELEASE bad_source');
  }
  db.prepare("UPDATE agent_receipts SET processedBy=offeredTurnId,offeredTurnId=NULL,state='processed' WHERE messageId=?").run(notice);
  assert.equal(project().taskSourceUnresolved,undefined);
  assert.equal(project({...process,sourceMessageIds:['missing']}).taskSourceUnresolved,true);
 }finally{f.close();}
});

test('archive notices bind the committed revision and the original user trigger, including after restore',()=>{
 const f=chatFixture();try{
  const task=f.create(),initial=f.tasks.settleTask(f.actor,{operationId:'settle',taskId:task.taskId,expectedRevision:1,outcome:'failed'});
  const trigger=f.source('archive-request'),actor={...f.actor,sourceRequestId:'archive-request',inputMessageId:trigger.messageId,turnId:'turn:archive-request'};
  const archived=f.tasks.archiveHistory(actor,{operationId:'archive',taskId:task.taskId,expectedRevision:initial.revision},true);
  const db=f.store.db,key=archived.operationKey,notice=String(db.prepare('SELECT id FROM agent_messages WHERE operationKey=?').get(key)!.id);
  f.consumeMain(notice);
  const process=new MainProcessHistory(db).headers(['consumer:'+notice])[0]!;
  const project=()=>withTaskSources(db,[message(process,'')],f.actor.threadId!)[0]!;
  const source=project().taskSources?.[0];
  assert.equal(source?.phaseLabel,'事项已归档');
  assert.equal(project().taskSourceUnresolved,undefined);
  f.tasks.archiveHistory(actor,{operationId:'restore',taskId:task.taskId,expectedRevision:f.tasks.task(task.taskId).revision},false);
  assert.deepEqual(project().taskSources?.[0],source);
  for(const sql of [
   "UPDATE operations SET actorAgentId='host' WHERE id=?",
   "UPDATE operations SET responseJson=json_set(responseJson,'$.revision',999) WHERE id=?",
   "UPDATE agent_messages SET taskVersion=999 WHERE operationKey=?",
   "UPDATE operations SET detailsJson=json_set(detailsJson,'$.inputMessageId','other') WHERE id=?",
   "UPDATE operations SET detailsJson=json_set(detailsJson,'$.turnId','other') WHERE id=?",
   "UPDATE conversation_inputs SET threadId='other' WHERE requestId=json_extract((SELECT detailsJson FROM operations WHERE id=?),'$.sourceRequestId')",
   "UPDATE agent_receipts SET offeredTurnId='other' WHERE messageId=(SELECT id FROM agent_messages WHERE operationKey=?)",
  ]){
   db.exec('SAVEPOINT bad_source');db.prepare(sql).run(key);
   assert.equal(project().taskSources,undefined,sql);assert.equal(project().taskSourceUnresolved,true,sql);
   db.exec('ROLLBACK TO bad_source; RELEASE bad_source');
  }
  db.prepare("UPDATE operations SET actorAgentId='host',kind='notify',detailsJson='{}',responseJson=NULL WHERE id=?").run(key);
  db.prepare("UPDATE agent_receipts SET offeredTurnId=NULL WHERE messageId=?").run(notice);
  assert.deepEqual(project().taskSources?.[0],source);
  assert.equal(project().taskSourceUnresolved,undefined);
 }finally{f.close();}
});

test('task settlement and controls use exact confirmed operation and input identities from terminal headers',()=>{
 const f=chatFixture();try{
  const db=f.store.db,task=f.create(),actor={...f.actor,turnId:'turn:'+f.authority.sourceRequestId};
  const receipt=(operationId:string)=>({operationId,taskId:task.taskId,expectedRevision:f.tasks.task(task.taskId).revision});
  const worker=f.tasks.workerOpen(actor,{operationId:'open',taskId:task.taskId,text:'Synthetic input'});
  const stop=f.tasks.controlTask(actor,{...receipt('pause'),action:'pause'});
  assert.deepEqual(stop.targets,[worker.runId]);
  const paused=f.tasks.confirmStop(stop.operationKey,true);
  f.consumeMain(String(db.prepare("SELECT id FROM agent_messages WHERE senderRunId=? AND kind='worker_reply'").get(worker.runId)!.id));
  const resumed=f.tasks.controlTask(actor,{...receipt('resume'),action:'resume'});
  const settled=f.tasks.settleTask(actor,{...receipt('settle'),outcome:'failed',notes:'PRIVATE_NOTES'});
  const restart=f.source('restart-source'),restartActor={...actor,sourceRequestId:'restart-source',turnId:'turn:restart-source',inputMessageId:restart.messageId};
  const next=f.tasks.controlTask(restartActor,{...receipt('restart'),action:'resume',authority:{...f.authority,sourceRequestId:restartActor.sourceRequestId}});
  const cancelled=f.tasks.controlTask(actor,{...receipt('cancel'),action:'cancel'});
  const processes=new MainProcessHistory(db);
  for(const result of [paused,resumed,settled,next,cancelled]){
   const source=result===next?restartActor:actor,process={...node([source.inputMessageId!]),sourceKind:'user' as const,turnIds:[source.turnId]};
   const activity=f.tasks.captureActivity(actor,'task_update',{taskId:task.taskId},result)!;
   const item={id:'activity',kind:'tool' as const,seq:1,revision:1,status:'completed' as const,label:'调整任务',turnId:source.turnId,activity};
   f.store.setMeta('publicMainNode:v1:process',JSON.stringify({...process,items:[item]}));
   const header=processes.headers(['process'])[0]!;
   const project=(n=header)=>withTaskSources(db,[message(n)],actor.threadId!)[0]!;
   assert.deepEqual(project().taskSources?.[0]?.target,activity.target);
   assert.equal(project().taskSourceUnresolved,undefined);
   assert.doesNotMatch(JSON.stringify(project()),/PRIVATE_NOTES/);
   assert.equal(project({...header,turnIds:['other']}).taskSourceUnresolved,true);
   assert.equal(project({...header,sourceMessageIds:['other']}).taskSourceUnresolved,true);
   const target={...activity.target!,version:activity.target!.version===1?2:1};
   assert.equal(project({...header,items:[{...item,activity:{...activity,target}}]}).taskSourceUnresolved,true);
   for(const sql of [
    "UPDATE operations SET state='uncertain' WHERE id=?",
    "UPDATE operations SET actorAgentId='host' WHERE id=?",
    "UPDATE operations SET detailsJson=json_set(detailsJson,'$.threadId','other') WHERE id=?",
    "UPDATE operations SET responseJson=json_set(responseJson,'$.state','uncertain') WHERE id=?",
    "UPDATE conversation_inputs SET threadId='other' WHERE requestId=json_extract((SELECT detailsJson FROM operations WHERE id=?),'$.sourceRequestId')",
   ]){
    db.exec('SAVEPOINT bad_source');db.prepare(sql).run(activity.target!.operationKey!);
    assert.equal(project().taskSources,undefined,sql);assert.equal(project().taskSourceUnresolved,true,sql);
    db.exec('ROLLBACK TO bad_source; RELEASE bad_source');
   }
  }
 }finally{f.close();}
});

test('a coordination round can settle a task using its received Worker message',()=>{
 const f=setup();try{
  const db=f.store.db,notice=f.reply.messageId;
  f.consumeMain(notice);
  const process=new MainProcessHistory(db).headers(['consumer:'+notice])[0]!;
  const actor={...f.actor,sourceRequestId:undefined,inputMessageId:notice,turnId:process.turnIds[0]!};
  const result=f.tasks.settleTask(actor,{operationId:'settle',taskId:f.task.taskId,expectedRevision:f.tasks.task(f.task.taskId).revision,outcome:'failed'});
  const activity=f.tasks.captureActivity(actor,'task_update',{taskId:f.task.taskId},result)!;
  process.items.push({id:'settle',kind:'tool',seq:1,revision:1,status:'completed',label:'调整任务',activity});
  assert.equal(f.project(message(process)).taskSources?.length,2);
  assert.equal(f.project(message(process)).taskSourceUnresolved,undefined);
  db.prepare("UPDATE agent_receipts SET offeredTurnId='other' WHERE messageId=?").run(notice);
  assert.equal(f.project(message(process)).taskSources?.length,1);
  assert.equal(f.project(message(process)).taskSourceUnresolved,true);
 }finally{f.close();}
});

test('a scheduled round binds task control to its delivery receipt',()=>{
 const f=chatFixture();try{
  const db=f.store.db,task=f.create();
  const notice=f.store.transaction(()=>f.inputs.enqueueScheduled({deliveryId:'delivery',scheduleId:'schedule',scheduledAt:1,text:'Synthetic schedule',sourceRef:'synthetic'}));
  f.consumeMain(notice);
  const process=new MainProcessHistory(db).headers(['consumer:'+notice])[0]!;
  process.sourceKind='scheduled';
  const actor={...f.actor,sourceRequestId:undefined,inputMessageId:notice,turnId:process.turnIds[0]!};
  const result=f.tasks.controlTask(actor,{operationId:'pause',taskId:task.taskId,expectedRevision:1,action:'pause'});
  const activity=f.tasks.captureActivity(actor,'task_update',{taskId:task.taskId},result)!;
  process.items.push({id:'pause',kind:'tool',seq:1,revision:1,status:'completed',label:'调整任务',activity});
  const project=()=>withTaskSources(db,[message(process)],actor.threadId!)[0]!;
  assert.deepEqual(project().taskSources?.[0]?.target,activity.target);
  assert.equal(project().taskSourceUnresolved,undefined);
  db.prepare("UPDATE agent_messages SET payloadJson=json_set(payloadJson,'$.threadId','other') WHERE id=?").run(notice);
  assert.equal(project().taskSources,undefined);
  assert.equal(project().taskSourceUnresolved,true);
 }finally{f.close();}
});
