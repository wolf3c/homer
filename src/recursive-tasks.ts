import {readWorkAssignments} from './task-overview.js';
import {INTERACTION_LIMITS} from './interaction-limits.js';
import {createHash,randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {basename,isAbsolute} from 'node:path';
import {realpathSync,statSync} from 'node:fs';
import {STORE_SCHEMA_VERSION,type Store,type Run} from './store.js';
import {mainInputProcessingSql,unconfirmedNativeEffectsSql} from './main-process.js';
import type {Files} from './files.js';
import type {TurnResult} from './engine.js';
import type {AttachmentRef} from './media-store.js';
import {attachmentReference} from './attachment-reference.js';
import {publicActivityName,type PublicActivity,type ActivityTarget,type ActivityLink} from './activity-facts.js';

// Captured by the host, never accepted from model tool arguments.
export type Actor={agentId:string;sourceRequestId?:string;runId?:string;epoch?:number;threadId?:string;turnId?:string;inputMessageId?:string;operationPayload?:unknown};
export type Authority={sourceRequestId:string;sourceRequestIds?:string[];description:string};
export type Task={id:string;title:string;headVersion:number;notes:string;state:'open'|'paused';revision:number;historyState:'visible'|'archived';createdAt:number;updatedAt:number};
export type TaskVersion={taskId:string;version:number;goal:string;authorityJson:string|null;sourceRequestId:string|null;triggerOpId:string;workingDirectory:string};
export type TaskRun=Run;
export type TaskMutation={operationId:string;taskId:string;expectedRevision:number};
export type Worker={workerId:string;taskId:string;threadId:string|null;run:TaskRun};
export type Operation={id:string;actorAgentId:string;scopeId:string;operationId:string;kind:string;payloadHash:string;state:string;detailsJson:string;responseJson:string|null;revision:number};
export type AgentMessage={seq:number;id:string;senderAgentId:string;senderRunId:string|null;senderEpoch:number|null;recipientAgentId:string;taskId:string|null;taskVersion:number|null;targetRunId:string|null;kind:string;replyTo:string|null;causationId:string|null;operationKey:string;payloadJson:string};
export type FileReceipt={path:string;sha256:string;bytes:number;state:'written';operationKey:string};
export type RecursiveTaskLifecycle={validateActor(actor:Actor):void;validateFileRead?(path:string):void;validateWorkerAttachment?(ref:AttachmentRef,messageId:string):void;reviewExitConfirmed?(run:TaskRun):boolean;unconfirmedWorkerEffects?(threadId:string):boolean;operationConfirmed?(actor:Actor,key:string,kind:string,response:Record<string,unknown>):void};
export type WorkerMessageScope={taskId:string;version:number;workerId:string;messageId:string;operationId:string};
type WorkerMessageReceipt={taskId:string;workerId:string;runId:string;version:number;threadId:string|null;reason?:string;messageId?:string;expectedTurnId?:string}&(
 {route:'blocked';state:'blocked';reason:string;status:Run['status'];phase:string}|
 {route:'steer';state:'requested';messageId:string;epoch:number;expectedTurnId:string;status:Run['status'];phase:string}|
 {route:'followup';state:'queued';messageId:string});
type PrepareAttachments=(operationKey:string,scope:WorkerMessageScope)=>AttachmentRef[];
export const taskSourceRequestsSql=`SELECT sourceRequestId FROM task_versions WHERE taskId=?
 UNION SELECT json_extract(authorityJson,'$.sourceRequestId') FROM task_versions WHERE taskId=?
 UNION SELECT s.value FROM task_versions v,json_each(v.authorityJson,'$.sourceRequestIds') s WHERE v.taskId=?
 UNION SELECT sourceRequestId FROM runs WHERE taskId=?`;
export const RECURSIVE_SCHEMA_VERSION=STORE_SCHEMA_VERSION;
const id=(kind:string)=>kind+'-'+randomUUID(),json=(value:unknown)=>JSON.stringify(value);
function canonical(value:unknown):string{if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).filter(([,v])=>v!==undefined).map(([k,v])=>json(k)+':'+canonical(v)).join(',')+'}';return json(value)??'null';}
export const recursiveHash=(value:unknown)=>createHash('sha256').update(typeof value==='string'?value:canonical(value)).digest('hex');
const text=(value:unknown,max=24000)=>{if(typeof value!=='string'||!value.trim()||value.length>max)throw Error('task_invalid_input');return value;};
const directory=(path:string)=>{if(!isAbsolute(path)||realpathSync(path)!==path||!statSync(path).isDirectory())throw Error('task_working_directory_invalid');return path;};
const active=(run:Run)=>['queued','running'].includes(run.status)||run.phase==='uncertain';
const recipient=(workerId:string)=>'worker:'+workerId;
function defaultTaskTitle(goal:string){
 const first=goal.trim().split(/[。！？!?\n]/u).map(part=>part.trim()).find(Boolean)??goal.trim();
 const chars=Array.from(first);return chars.length>48?chars.slice(0,48).join('')+'…':first;
}

function boundedPage<T>(length:number,build:(count:number)=>T):T{
 let page=build(length);
 while(length>1&&Buffer.byteLength(JSON.stringify({result:page}))>INTERACTION_LIMITS.responseBytes){
  length=Math.ceil(length/2);page=build(length);
 }
 return page;
}

export class RecursiveTasks{
 constructor(readonly store:Store,readonly files:Files,private lifecycle?:RecursiveTaskLifecycle){}
 private get db(){return this.store.db;}
 private one<T>(sql:string,...args:(string|number|null)[]):T|undefined{return this.db.prepare(sql).get(...args) as T|undefined;}
 private all<T>(sql:string,...args:(string|number|null)[]):T[]{return this.db.prepare(sql).all(...args) as T[];}
 private sql(sql:string,...args:(string|number|null)[]){return this.db.prepare(sql).run(...args);}
 private table(name:string){return !!this.one("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",name);}
 private runSummaries(runs:Run[],currentRunIds:readonly string[]){
  if(!runs.length)return [];
  const leases=new Set(this.all<{key:string}>("SELECT key FROM meta WHERE key IN (SELECT 'lease:'||value FROM json_each(?))",json(runs.map(run=>run.id))).map(row=>row.key));
  return runs.map(run=>{
   const {id,taskId,workerId,version,status,phase,epoch,stateRevision,threadId,turnId,startedAt,endedAt,stopRequestedAt,errorCode,replacesRunId}=run;
   // A historical Run passed the host owner fence before its successor could be created.
   const exitConfirmed=!active(run)&&!this.exitUnconfirmed(run)&&!leases.has('lease:'+id)&&(!currentRunIds.includes(id)||this.lifecycle?.reviewExitConfirmed?.(run)!==false);
   return {id,taskId,workerId,version,status,phase,epoch,stateRevision,threadId,turnId,startedAt,endedAt,stopRequestedAt,errorCode,replacesRunId,exitConfirmed};
  });
 }
 migrate(){
  if(this.store.meta('recursiveSchemaVersion')!==RECURSIVE_SCHEMA_VERSION)throw Error('recursive_schema_unsupported');
 }
 task(taskId:string):Task{const task=this.one<Task>('SELECT * FROM tasks WHERE id=?',taskId);if(!task)throw Error('task_not_found');return task;}
 tasks():Task[]{return this.all('SELECT * FROM tasks ORDER BY rowid');}
 version(taskId:string,version:number):TaskVersion{const v=this.one<TaskVersion>('SELECT * FROM task_versions WHERE taskId=? AND version=?',taskId,version);if(!v)throw Error('task_version_not_found');return v;}
 run(runId:string):TaskRun{const r=this.store.run(runId);if(!r)throw Error('run_not_found');return r;}
 runs(taskId?:string,workerId?:string):TaskRun[]{return this.all('SELECT * FROM runs'+(taskId?' WHERE taskId=?'+(workerId?' AND workerId=?':''):workerId?' WHERE workerId=?':'')+' ORDER BY createdAt,rowid',...(taskId?[taskId]:[]),...(workerId?[workerId]:[]));}
 workers(taskId:string):Worker[]{return this.all<TaskRun>('SELECT r.* FROM runs r WHERE taskId=? AND rowid=(SELECT max(rowid) FROM runs WHERE workerId=r.workerId) ORDER BY createdAt,rowid',taskId).map(run=>({workerId:run.workerId,taskId,threadId:run.threadId,run}));}
 worker(workerId:string):Worker{const run=this.one<TaskRun>('SELECT * FROM runs WHERE workerId=? ORDER BY rowid DESC LIMIT 1',workerId);if(!run||this.run(workerId).workerId!==workerId)throw Error('worker_not_found');return {workerId,taskId:run.taskId,threadId:run.threadId,run};}
 private main(actor:Actor){return actor.agentId===this.store.meta('mainAgentId')&&!actor.runId;}
 private requireMain(actor:Actor){if(!this.main(actor))throw Error('task_main_required');this.lifecycle?.validateActor(actor);if(actor.threadId&&actor.threadId!==this.store.meta('mainThread'))throw Error('agent_identity_denied');}
 private actorTask(actor:Actor){if(this.main(actor)){this.requireMain(actor);return;}
  if(!actor.runId)throw Error('agent_identity_denied');const run=this.run(actor.runId);
  if(actor.agentId!==recipient(run.workerId))throw Error('agent_identity_denied');if(actor.epoch!==run.epoch)throw Error('run_epoch_stale');
  if(run.status!=='running'||run.threadId!==actor.threadId||run.turnId!==actor.turnId)throw Error('run_not_live');this.lifecycle?.validateActor(actor);return this.task(run.taskId);
 }
 private readAllowed(actor:Actor,taskId:string){const own=this.actorTask(actor);if(own&&own.id!==taskId)throw Error('agent_scope_denied');}
 private writable(task:Task){if(task.historyState!=='visible')throw Error('task_history_not_visible');if(task.state!=='open')throw Error('task_not_open');}
 private check(actor:Actor,input:TaskMutation){this.requireMain(actor);const task=this.task(input.taskId);if(task.revision!==input.expectedRevision)throw Error('task_revision_conflict');return task;}
 guard(actor:Actor,phases=['executing'],inFlight=false){const task=this.actorTask(actor);if(!task||!actor.runId)throw Error('run_required');const run=this.run(actor.runId);if(!inFlight)this.writable(task);if(run.stopRequestedAt)throw Error('run_stop_requested');if(!phases.includes(run.phase))throw Error('run_phase_denied');return task;}
 source(actor:Actor,requestId:string){
  this.requireMain(actor);
  const row=this.sourceRecord(actor.agentId,requestId);
  const attachments=JSON.parse(row.refsJson??'[]') as AttachmentRef[];
  return {requestId,text:row.text,quotes:row.quote?JSON.parse(row.quote):null,attachments:attachments.map(ref=>({...ref,reference:attachmentReference(ref)}))};
 }
 private sourceRecord(mainAgentId:string,requestId:string){
  text(requestId,200);
  const row=this.one<{text:string;quote:string|null;refsJson:string|null}>(`SELECT c.text,c.quote,a.refsJson FROM conversation_inputs i
    JOIN conversation_messages c ON c.requestId=i.requestId AND c.threadId=i.threadId AND c.role='user'
    JOIN operations o ON o.actorAgentId=? AND o.scopeId=i.requestId AND o.operationId='accept' AND o.kind='user_accept' AND o.state='confirmed'
    JOIN agent_messages m ON m.operationKey=o.id AND m.id=json_extract(o.responseJson,'$.messageId')
      AND m.kind='user_input' AND json_extract(m.payloadJson,'$.requestId')=i.requestId AND m.senderAgentId=o.actorAgentId
    JOIN agent_receipts r ON r.messageId=m.id AND r.recipientAgentId=m.recipientAgentId
    LEFT JOIN conversation_attachments a ON a.messageId=c.id
    WHERE i.requestId=? AND i.threadId=? AND m.recipientAgentId=?
    AND coalesce(json_extract(m.payloadJson,'$.source'),'')<>'first_launch'
    AND c.audience='user' AND c.status<>'cancelled' AND c.revokedAt IS NULL AND r.state IN ('offered','received','processed','uncertain')`,
    'user:'+mainAgentId,requestId,this.store.meta('mainThread')!,mainAgentId);
  if(!row)throw Error('task_authority_source_denied');
  return row;
 }
 private validateQueuedQuestion(run:TaskRun){
  if(this.table('worker_interactions')&&this.one(
   `SELECT 1 FROM agent_messages m JOIN operations o ON o.id=m.operationKey JOIN worker_interactions i ON i.id=json_extract(o.detailsJson,'$.questionId')
    WHERE m.targetRunId=? AND i.state NOT IN ('answered','denied') LIMIT 1`,run.id))throw Error('question_not_deliverable');
 }
 private insertOperation(key:string,actor:string,scope:string,operationId:string,kind:string,payload:unknown,state='accepted',details:unknown={}){this.sql('INSERT INTO operations VALUES(?,?,?,?,?,?,?,?,NULL,0)',key,actor,scope,operationId,kind,recursiveHash(payload),state,json(details));}
 private mutation<T extends Record<string,unknown>>(actor:Actor,scope:string,operationId:string,kind:string,payload:unknown,write:(key:string)=>T):T&{operationKey:string}{
  this.actorTask(actor);text(operationId,500);const operationPayload=actor.operationPayload??payload;
  return this.store.transaction(()=>{const prior=this.one<Operation>('SELECT * FROM operations WHERE actorAgentId=? AND scopeId=? AND operationId=?',actor.agentId,scope,operationId);
   if(prior){const sameKind=prior.kind===kind||kind==='worker_message'&&prior.kind==='worker_steer'&&JSON.parse(prior.detailsJson).toolName===kind;if(!sameKind||prior.payloadHash!==recursiveHash(operationPayload))throw Error('operation_payload_conflict');if(!prior.responseJson)throw Error('operation_uncertain');return JSON.parse(prior.responseJson);}
   if(actor.runId)this.guard(actor);const key=id('op');this.insertOperation(key,actor.agentId,scope,operationId,kind,operationPayload,'accepted',{inputMessageId:actor.inputMessageId??null,sourceRequestId:actor.sourceRequestId??null,threadId:actor.threadId??null,turnId:actor.turnId??null});
   const response={...write(key),operationKey:key};this.lifecycle?.operationConfirmed?.(actor,key,kind,response);
   this.sql('UPDATE operations SET responseJson=?,state=?,revision=revision+1 WHERE id=?',json(response),response.state==='requested'?'accepted':'confirmed',key);return response;
  });
 }
 private details(key:string,patch:Record<string,unknown>){const op=this.operation(key);this.sql('UPDATE operations SET detailsJson=? WHERE id=?',json({...JSON.parse(op.detailsJson),...patch}),key);}
 operation(key:string):Operation{const op=this.one<Operation>('SELECT * FROM operations WHERE id=?',key);if(!op)throw Error('operation_not_found');return op;}
 inspectOperation(actor:Actor,operationId:string,scopeId?:string){this.requireMain(actor);text(operationId,500);const rows=this.all<Operation>('SELECT * FROM operations WHERE actorAgentId=? AND operationId=?'+(scopeId?' AND scopeId=?':'')+' ORDER BY rowid LIMIT 21',actor.agentId,operationId,...(scopeId?[scopeId]:[]));return {operations:rows.slice(0,20).map(({payloadHash:_hash,responseJson,detailsJson,...op})=>({...op,response:responseJson?JSON.parse(responseJson):null,details:JSON.parse(detailsJson)})),truncated:rows.length>20};}
 operationsForInput(actor:Actor,messageId:string){this.requireMain(actor);return this.all<Operation>("SELECT * FROM operations WHERE actorAgentId=? AND json_extract(detailsJson,'$.inputMessageId')=? ORDER BY rowid",actor.agentId,messageId).map(({responseJson,detailsJson,...op})=>({...op,response:responseJson?JSON.parse(responseJson):null,details:JSON.parse(detailsJson)}));}
 private activeEvent(actor:Actor){
  if(!actor.inputMessageId)return;
  return this.one<AgentMessage>(`SELECT m.* FROM agent_messages m JOIN agent_receipts r ON r.messageId=m.id AND r.recipientAgentId=m.recipientAgentId
   WHERE m.id=? AND m.recipientAgentId=? AND m.senderAgentId='host' AND r.state IN ('offered','received')
   AND m.kind IN ('task_archived','worker_reply','interaction_required','scheduled_message')`,actor.inputMessageId,actor.agentId);
 }
 archiveReview(actor:Actor){
  this.requireMain(actor);const message=this.activeEvent(actor);
  if(message?.kind!=='task_archived'||!message.taskId)return;
  const task=this.task(message.taskId),op=this.operation(message.operationKey),receipt=JSON.parse(op.responseJson??'{}');
  const latest=this.one<{id:string}>(`SELECT id FROM operations WHERE scopeId=? AND state='confirmed'
    AND ((kind='archive_work' AND EXISTS(SELECT 1 FROM agent_messages notice WHERE notice.operationKey=operations.id AND notice.kind='task_archived'))
      OR kind='restore_work' AND (json_extract(detailsJson,'$.expectedRevision') IS NULL OR json_extract(responseJson,'$.revision')=CAST(json_extract(detailsJson,'$.expectedRevision') AS INTEGER)+1))
    ORDER BY rowid DESC LIMIT 1`,task.id);
  if(task.historyState!=='archived'||op.kind!=='archive_work'||op.state!=='confirmed'||op.actorAgentId!==actor.agentId||op.scopeId!==task.id||
     receipt.taskId!==task.id||receipt.state!=='archived'||receipt.revision!==JSON.parse(message.payloadJson).revision||
     (latest?latest.id!==op.id:receipt.revision!==task.revision))return;
  const details=JSON.parse(op.detailsJson);
  return {task,sourceRequestId:typeof details.sourceRequestId==='string'?details.sourceRequestId:undefined,operationKey:op.id};
 }
 private verifiedWorkerReply(message:AgentMessage){
  if(message.kind!=='worker_reply'||message.senderAgentId!=='host'||message.recipientAgentId!==this.store.meta('mainAgentId')||!message.senderRunId)return;
  const run=this.run(message.senderRunId),op=this.operation(message.operationKey),payload=JSON.parse(message.payloadJson);
  if(payload.runId!==run.id||payload.epoch!==message.senderEpoch||run.taskId!==message.taskId||run.version!==message.taskVersion||op.scopeId!==run.taskId||op.kind!=='worker_return'||op.actorAgentId!=='host'||op.state!=='confirmed'||JSON.parse(op.responseJson??'{}').messageId!==message.id)return;
  return run;
 }
 authorizeReceiptDelivery(actor:Actor,taskId:string){
  this.requireMain(actor);const message=this.activeEvent(actor);
  if(!message||message.taskId!==taskId||!message.senderRunId||!message.taskVersion)throw Error('task_authority_source_denied');
  const task=this.task(taskId),run=this.run(message.senderRunId),op=this.operation(message.operationKey);
  if(run.taskId!==taskId||run.version!==message.taskVersion||op.scopeId!==taskId||op.actorAgentId!=='host'||op.state!=='confirmed')throw Error('task_authority_source_denied');
  if(message.kind==='worker_reply'){
   if(!this.verifiedWorkerReply(message))throw Error('task_authority_source_denied');
  }else if(message.kind!=='interaction_required'||op.kind!=='interaction_notice'||op.operationId!=='interaction:'+JSON.parse(message.payloadJson).interactionId)throw Error('task_authority_source_denied');
  return {task,version:run.version};
 }
 visibleTask(actor:Actor,taskId:string){
  this.requireMain(actor);const task=this.task(taskId);
  if(task.historyState!=='visible')throw Error('task_history_not_visible');
  return task;
 }
 createTask(actor:Actor,input:{operationId:string;goal:string;notes?:string;title?:string;workingDirectory?:string}){
  this.requireMain(actor);
  return this.mutation(actor,'tasks',input.operationId,'task_create',input,key=>{
   text(input.goal);
   if(typeof (input.notes??'')!=='string'||(input.notes??'').length>24000)throw Error('task_invalid_input');
   const taskId=id('task'),now=Date.now(),title=input.title??defaultTaskTitle(input.goal);
   text(title,200);
   this.sql("INSERT INTO tasks VALUES(?,?,1,?,'open',1,'visible',?,?)",taskId,title,input.notes??'',now,now);
   this.sql('INSERT INTO task_versions VALUES(?,1,?,?,?,?,?)',taskId,input.goal,null,
     actor.sourceRequestId??null,key,directory(input.workingDirectory??this.files.workspace));
   return {taskId,version:1,revision:1,state:'open'};
  });
 }
 private updateRequirements(actor:Actor,task:Task,goal:string,key:string){
  text(goal);
  const version=task.headVersion+1;
  this.sql('INSERT INTO task_versions VALUES(?,?,?,?,?,?,?)',task.id,version,goal,null,actor.sourceRequestId??null,key,this.version(task.id,task.headVersion).workingDirectory);
  return version;
 }
 listTasks(actor:Actor,query:{includeArchived?:boolean;threadId?:string;cursor?:string;limit?:number}={}){
  this.requireMain(actor);const limit=query.limit??20;if(!Number.isSafeInteger(limit)||limit<1||limit>80||Object.hasOwn(query,'state')||query.cursor!==undefined&&!/^\d+$/.test(query.cursor))throw Error('task_query_invalid');
  const rows=this.all<Task&{position:number}>(`SELECT t.*,t.rowid position FROM tasks t WHERE t.rowid>?${query.includeArchived?'':" AND t.historyState='visible'"}${query.threadId?' AND EXISTS(SELECT 1 FROM runs r WHERE r.taskId=t.id AND r.threadId=?)':''} ORDER BY t.rowid LIMIT ?`,Number(query.cursor??0),...(query.threadId?[query.threadId]:[]),limit+1);
  return boundedPage(Math.min(limit,rows.length),count=>({tasks:rows.slice(0,count).map(({position:_position,...task})=>task),nextCursor:rows.length>count?String(rows[count-1]!.position):null}));
 }
 readTask(actor:Actor,taskId:string){
  this.readAllowed(actor,taskId);const task=this.task(taskId),version=this.version(taskId,task.headVersion);
  const sourceRequestIds=this.all<{sourceRequestId:string}>(taskSourceRequestsSql,taskId,taskId,taskId,taskId).map(row=>row.sourceRequestId);
  const current=this.workers(taskId),summaries=this.runSummaries(current.map(worker=>worker.run),current.map(worker=>worker.run.id)),workers=current.map((worker,index)=>({...worker,run:summaries[index]!}));
  const assignments=readWorkAssignments(this.db,taskId);
  return {task,version,trigger:JSON.parse(this.operation(version.triggerOpId).detailsJson),goal:version.goal,sourceRequestIds:sourceRequestIds.filter(Boolean),workers:workers.map(worker=>({
   ...worker,assignments:assignments.filter(item=>item.workerId===worker.workerId),
  }))};
 }
 updateTask(actor:Actor,input:TaskMutation&{patch:{goal?:string;notes?:string}}){
  this.requireMain(actor);return this.mutation(actor,input.taskId,input.operationId,'task_update',input,key=>{
   const task=this.check(actor,input);const patch=input.patch;if(!patch||!Object.keys(patch).length||Object.keys(patch).some(key=>!['goal','notes'].includes(key)))throw Error('task_invalid_patch');
   if(patch.notes!==undefined&&(typeof patch.notes!=='string'||patch.notes.length>24000))throw Error('task_invalid_patch');if(task.historyState!=='visible')throw Error('task_history_not_visible');let version=task.headVersion;
   if(patch.goal!==undefined){
    version=this.updateRequirements(actor,task,patch.goal,key);
   }
   this.sql('UPDATE tasks SET headVersion=?,notes=?,revision=revision+1,updatedAt=? WHERE id=?',version,patch.notes??task.notes,Date.now(),task.id);
   this.details(key,{action:'update',taskId:task.id,version});return {taskId:task.id,version,revision:task.revision+1,state:'updated',targets:[]};
  });
 }
 questionCurrent(item:{runId:string;threadId:string;turnId:string;runEpoch?:number;taskVersion?:number}){
  const run=this.run(item.runId);
  // Recovery may fence the original epoch after saving terminal output.
  const checkpoint=JSON.parse(run.checkpointJson??'{}');
  const turnEpoch=checkpoint.outputEpoch??run.epoch;
  return run.version===item.taskVersion && turnEpoch===item.runEpoch
   && run.threadId===item.threadId && run.turnId===item.turnId && !run.stopRequestedAt
   && (run.status==='running'||run.status==='succeeded'||(run.status==='failed'&&run.phase==='ended'));
 }
 questionDelivery(id:string,taskId:string){
  const key='question:'+id;
  return this.one<{kind:string;state:string;receipt:string|null}>(`SELECT o.kind,o.state,r.state receipt FROM operations o
   LEFT JOIN agent_messages m ON m.operationKey=o.id AND m.kind='worker_input'
   LEFT JOIN agent_receipts r ON r.messageId=m.id AND r.recipientAgentId=m.recipientAgentId
   WHERE o.actorAgentId=? AND o.scopeId=? AND o.operationId IN (?,?) AND json_extract(o.detailsJson,'$.questionId')=?
   ORDER BY o.rowid DESC LIMIT 1`,this.store.meta('mainAgentId')!,taskId,key,key+':followup',id);
 }
 private cancelQuestions(taskId:string,workerId?:string){
  if(this.table('worker_interactions'))this.sql(`UPDATE worker_interactions SET state='cancelled',code='task_scope_changed',updatedAt=?
   WHERE source='ask_main' AND state IN ('pending_main','pending_user','answered','denied') AND deliveredAt IS NULL
   AND runId IN (SELECT id FROM runs WHERE taskId=?${workerId?' AND workerId=?':''})`,Date.now(),taskId,...(workerId?[workerId]:[]));
 }
 private activeRun(workerId:string){return this.one<TaskRun>("SELECT * FROM runs WHERE workerId=? AND (status IN ('queued','running') OR phase='uncertain') ORDER BY rowid DESC LIMIT 1",workerId);}
 private message(actor:Actor,key:string,to:string,taskId:string,version:number,kind:string,payload:unknown,target:string|null=null,messageId=id('message')){
  this.sql('INSERT INTO agent_messages(id,senderAgentId,senderRunId,senderEpoch,recipientAgentId,taskId,taskVersion,targetRunId,kind,operationKey,payloadJson) VALUES(?,?,?,?,?,?,?,?,?,?,?)',messageId,actor.agentId,actor.runId??null,actor.epoch??null,to,taskId,version,target,kind,key,json(payload));
  this.sql("INSERT INTO agent_receipts(messageId,recipientAgentId,state) VALUES(?,?,'pending')",messageId,to);return messageId;
 }
 private newRun(actor:Actor,task:Task,workerId:string,messageId:string,replace:string|null=null,workingDirectory?:string){
  const runId=this.store.run(workerId)?id('run'):workerId,version=this.version(task.id,task.headVersion),previous=this.one<TaskRun>('SELECT * FROM runs WHERE workerId=? ORDER BY rowid DESC LIMIT 1',workerId);
  if(this.activeRun(workerId))throw Error('worker_busy');
  if(this.one("SELECT 1 FROM operations WHERE kind='worker_steer' AND json_extract(detailsJson,'$.workerId')=? AND state IN ('accepted','dispatching','uncertain')",workerId))throw Error('operation_uncertain');
  if(previous&&(this.exitUnconfirmed(previous)||this.store.meta('lease:'+previous.id)||this.lifecycle?.reviewExitConfirmed?.(previous)===false))throw Error('run_stop_unconfirmed');
  const message=this.one<AgentMessage>('SELECT * FROM agent_messages WHERE id=?',messageId);
  if(!message||message.taskId!==task.id||message.taskVersion!==task.headVersion||message.recipientAgentId!==recipient(workerId)||message.targetRunId!==null)throw Error('message_target_stale');
  const prompt=JSON.parse(message.payloadJson).text;
  const cwd=directory(workingDirectory??previous?.workingDirectory??version.workingDirectory);
  this.sql("INSERT INTO runs(id,taskId,workerId,version,sourceRequestId,goal,prompt,status,phase,epoch,threadId,replacesRunId,workingDirectory,createdAt) VALUES(?,?,?,?,?,?,?,'queued','ready',?,?,?,?,?)",
    runId,task.id,workerId,task.headVersion,actor.sourceRequestId??null,version.goal,prompt,previous?previous.epoch+1:0,previous?.threadId??null,replace,cwd,Date.now());
  this.sql('UPDATE agent_messages SET targetRunId=? WHERE id=?',runId,messageId);return runId;
 }
 private workerInput(actor:Actor,key:string,task:Task,workerId:string,input:{operationId:string;text:string;workTitle?:string;attachments?:AttachmentRef[]},prepare?:PrepareAttachments,target:string|null=null,version=task.headVersion){
  const messageId=id('message');
  const attachments=prepare?.(key,{taskId:task.id,version,workerId,messageId,operationId:input.operationId})??input.attachments;
  return this.message(actor,key,recipient(workerId),task.id,version,'worker_input',
    {workerId,text:input.text,...(input.workTitle?{workTitle:text(input.workTitle,80)}:{}),...(attachments?.length?{attachments}:{})},target,messageId);
 }
 workerOpen(actor:Actor,input:{operationId:string;taskId:string;text?:string;workTitle?:string;workingDirectory?:string;attachments?:AttachmentRef[]},prepare?:PrepareAttachments){
  this.requireMain(actor);
  if(Object.hasOwn(input,'title'))throw Error('invalid_tool_arguments');
  const taskId=text(input.taskId,200);
  return this.mutation(actor,taskId,input.operationId,'worker_open',input,key=>{
   const task=this.task(taskId);
   this.writable(task);
   const version=this.version(taskId,task.headVersion),message=text(input.text===undefined?version.goal:input.text);
   const workerId=id('run'),messageId=this.workerInput(actor,key,task,workerId,{...input,text:message},prepare);
   const runId=this.newRun(actor,task,workerId,messageId,null,input.workingDirectory);
   return {taskId,workerId,runId,messageId,version:task.headVersion,state:'queued'};
  });
 }
 private workerMessageUnresolved(taskId:string,workerId:string){
  return this.unresolvedInteractions(taskId,workerId,true)||this.one(
   "SELECT 1 FROM operations WHERE scopeId=? AND (actorAgentId=? OR json_extract(detailsJson,'$.workerId')=?) AND state IN ('accepted','dispatching','uncertain')",taskId,recipient(workerId),workerId);
 }
 workerMessageRecovery(actor:Actor,workerId:string,operationId:string){
  this.requireMain(actor);
  const {run,taskId}=this.worker(workerId);
  if(this.one('SELECT 1 FROM operations WHERE actorAgentId=? AND scopeId=? AND operationId=?',actor.agentId,taskId,operationId))return;
  if(run.phase!=='ended'||run.stopRequestedAt!==null||this.stopExitUnconfirmed(run)||!this.workerEffectUnconfirmed(run)||this.workerMessageUnresolved(taskId,workerId))return;
  const task=this.task(taskId);
  this.writable(task);
  return {run,version:task.headVersion};
 }
 workerMessage(actor:Actor,input:{operationId:string;workerId:string;text:string;workTitle?:string;attachments?:AttachmentRef[]},prepare?:PrepareAttachments,questionId?:string,recovery?:{run:TaskRun;version:number;apply?:()=>void},questionRunId?:string){
  this.requireMain(actor);const worker=this.worker(input.workerId);
  return this.mutation<WorkerMessageReceipt>(actor,worker.taskId,input.operationId,'worker_message',input,key=>{
   const task=this.task(worker.taskId),run=this.worker(worker.workerId).run;
   this.writable(task);
   // Host-bound question replies carry the complete user answer and Main's note.
   text(input.text,questionId?1024*1024:24000);
   if(questionId)this.details(key,{questionId});
   const facts={taskId:task.id,workerId:run.workerId,runId:run.id,version:run.version,status:run.status,phase:run.phase,threadId:run.threadId};
   const blocked=(reason:string):WorkerMessageReceipt=>{
    if(questionId)throw Error(reason); // Leave the durable answer pending until this boundary clears.
    return {...facts,state:'blocked',route:'blocked',reason};
   };
   if(recovery&&(run.id!==recovery.run.id||run.epoch!==recovery.run.epoch||run.threadId!==recovery.run.threadId||
     run.turnId!==recovery.run.turnId||task.headVersion!==recovery.version||run.phase!=='ended'||run.stopRequestedAt!==null))
    return blocked('worker_not_ready');
   if(this.one("SELECT 1 FROM operations WHERE scopeId=? AND kind='worker_steer' AND json_extract(detailsJson,'$.workerId')=? AND state IN ('accepted','dispatching','uncertain')",task.id,run.workerId))return blocked('operation_uncertain');
   if(run.phase==='uncertain')return blocked('run_stop_unconfirmed');
   if(active(run)){
    if(run.stopRequestedAt!==null)return blocked('worker_stop_requested');
    if(run.status!=='running'||run.phase!=='executing'||!run.threadId||!run.turnId||questionRunId&&questionRunId!==run.id)return blocked('worker_not_ready');
    const messageId=this.workerInput(actor,key,task,run.workerId,{...input,workTitle:undefined},prepare,run.id,run.version);
    this.sql("UPDATE operations SET kind='worker_steer' WHERE id=?",key);
    this.details(key,{toolName:'worker_message',workerId:run.workerId,runId:run.id,epoch:run.epoch,threadId:run.threadId,expectedTurnId:run.turnId,messageId});
    return {...facts,route:'steer',state:'requested',messageId,epoch:run.epoch,expectedTurnId:run.turnId};
   }
   if(run.phase!=='ended'||this.stopExitUnconfirmed(run))return blocked('run_stop_unconfirmed');
   if(this.workerMessageUnresolved(task.id,run.workerId))return blocked('operation_uncertain');
   recovery?.apply?.();
   if(this.workerEffectUnconfirmed(run))return blocked('operation_uncertain');
   const neverSpawned=run.status==='failed'&&run.errorCode==='engine_spawn_failed'&&run.pid===null&&run.turnId===null;
   if(!run.threadId&&!neverSpawned)return blocked('worker_thread_unavailable');
   const messageId=this.workerInput(actor,key,task,run.workerId,neverSpawned?{...input,workTitle:undefined}:input,prepare);
   const runId=this.newRun(actor,task,run.workerId,messageId,run.status==='interrupted'||neverSpawned?run.id:null);
   return {taskId:task.id,workerId:run.workerId,runId,version:task.headVersion,threadId:run.threadId,route:'followup',state:'queued',messageId};
  });
 }
 workerAttachments(actor:Actor){
  const task=this.guard(actor,['executing','rpc_wait'],true),run=this.run(actor.runId!);
  const rows=this.all<{messageId:string;refs:string}>(`SELECT m.id messageId,json_extract(m.payloadJson,'$.attachments') refs
   FROM agent_messages m JOIN agent_receipts r ON r.messageId=m.id AND r.recipientAgentId=m.recipientAgentId
   JOIN runs target ON target.id=m.targetRunId AND target.workerId=? AND target.threadId=?
   JOIN operations o ON o.id=m.operationKey
   WHERE m.taskId=? AND m.recipientAgentId=? AND m.kind='worker_input' AND json_type(m.payloadJson,'$.attachments')='array'
   AND ((r.state IN ('received','processed') AND r.offeredRunId=target.id AND r.offeredTurnId=target.turnId)
    OR (o.kind='worker_steer' AND o.state='confirmed')
    OR (o.kind='worker_steer' AND o.state='dispatching' AND target.id=? AND json_extract(o.detailsJson,'$.epoch')=?
        AND json_extract(o.detailsJson,'$.expectedTurnId')=? AND json_extract(o.detailsJson,'$.threadId')=?))`,
    run.workerId,run.threadId,task.id,recipient(run.workerId),run.id,run.epoch,run.turnId,run.threadId);
  const refs=new Map<string,AttachmentRef>();
  for(const row of rows)for(const ref of JSON.parse(row.refs) as AttachmentRef[]){
   try{this.lifecycle?.validateWorkerAttachment?.(ref,row.messageId);}catch{continue;}
   refs.set(attachmentReference(ref).id,ref);
  }
  return [...refs.values()];
 }
 offeredWorkerAttachments(runId:string){
  const run=this.run(runId);
  if(run.status!=='running'||run.phase!=='starting'||!this.canStart(run)||run.stopRequestedAt)throw Error('run_phase_denied');
  const rows=this.all<{id:string;payloadJson:string}>(`SELECT m.id,m.payloadJson FROM agent_messages m
   JOIN agent_receipts r ON r.messageId=m.id AND r.recipientAgentId=m.recipientAgentId
   WHERE m.kind='worker_input' AND m.targetRunId=? AND m.taskId=? AND m.taskVersion=? AND m.recipientAgentId=?
   AND r.state='offered' AND r.offeredRunId=m.targetRunId AND r.offeredEpoch=? ORDER BY m.seq`,
   run.id,run.taskId,run.version,recipient(run.workerId),run.epoch);
  const refs=new Map<string,AttachmentRef>();
  for(const row of rows)for(const ref of (JSON.parse(row.payloadJson).attachments??[]) as AttachmentRef[]){
   this.lifecycle?.validateWorkerAttachment?.(ref,row.id);
   refs.set(attachmentReference(ref).id,ref);
  }
  return [...refs.values()];
 }
 workerRead(actor:Actor,input:{workerId:string;after?:number;limit?:number;messageId?:string;itemId?:string;offset?:number}){
  const worker=this.worker(input.workerId);this.readAllowed(actor,worker.taskId);if(actor.runId&&this.run(actor.runId).workerId!==input.workerId)throw Error('agent_scope_denied');
  const offset=input.offset??0;if(!Number.isSafeInteger(offset)||offset<0)throw Error('message_offset_invalid');if(input.itemId!==undefined){text(input.itemId,200);if(!input.messageId)throw Error('worker_query_invalid');}
  type PageRow=Omit<AgentMessage,'payloadJson'|'replyTo'|'causationId'>&{metadataJson:string;nativeMessagesJson:string;text:string;textLength:number};
  const body=input.itemId?"(SELECT json_extract(value,'$.text') FROM json_each(payloadJson,'$.messages') WHERE json_extract(value,'$.itemId')=?)":"json_extract(payloadJson,'$.text')";
  const fields=`seq,id,senderAgentId,senderRunId,senderEpoch,recipientAgentId,taskId,taskVersion,targetRunId,kind,operationKey,json_remove(payloadJson,'$.text','$.messages') metadataJson,(SELECT json_group_array(json_object('itemId',json_extract(value,'$.itemId'),'phase',json_extract(value,'$.phase'),'characters',length(json_extract(value,'$.text')))) FROM json_each(payloadJson,'$.messages')) nativeMessagesJson,substr(coalesce(${body},''),?,24000) text,length(coalesce(${body},'')) textLength`;
  const page=({metadataJson,nativeMessagesJson,text,textLength,...row}:PageRow)=>({...row,payload:{...JSON.parse(metadataJson),text},nativeMessages:JSON.parse(nativeMessagesJson) as {itemId:string;phase:string|null;characters:number}[],...(input.itemId?{itemId:input.itemId}:{}),text,offset,nextOffset:offset+24000<textLength?offset+24000:null});
  if(input.messageId){const row=this.one<PageRow>(`SELECT ${fields} FROM agent_messages WHERE id=? AND taskId=? AND json_extract(payloadJson,'$.workerId')=?${input.itemId?" AND EXISTS(SELECT 1 FROM json_each(payloadJson,'$.messages') WHERE json_extract(value,'$.itemId')=?)":''}`,...(input.itemId?[input.itemId]:[]),offset+1,...(input.itemId?[input.itemId]:[]),input.messageId,worker.taskId,worker.workerId,...(input.itemId?[input.itemId]:[]));if(!row)throw Error('message_not_found');return {workerId:worker.workerId,taskId:worker.taskId,threadId:worker.threadId,runs:[],messages:[page(row)],nextCursor:null};}
  const after=input.after??0,limit=input.limit??20;if(!Number.isSafeInteger(after)||after<0||!Number.isSafeInteger(limit)||limit<1||limit>50)throw Error('worker_query_invalid');
  const rows=this.all<PageRow>(`SELECT ${fields} FROM agent_messages WHERE taskId=? AND seq>? AND (recipientAgentId=? OR senderRunId IN (SELECT id FROM runs WHERE workerId=?)) ORDER BY seq LIMIT ?`,offset+1,worker.taskId,after,recipient(worker.workerId),worker.workerId,limit+1);
  return boundedPage(Math.min(limit,rows.length),count=>{
   const messages=rows.slice(0,count).map(page);
   const runIds=[...new Set([worker.run.id,...messages.flatMap(row=>[row.senderRunId,row.targetRunId].filter((value):value is string=>!!value))])];
   return {workerId:worker.workerId,taskId:worker.taskId,threadId:worker.threadId,runs:this.runSummaries(runIds.map(runId=>this.run(runId)),[worker.run.id]),messages,nextCursor:rows.length>count?rows[count-1]!.seq:null};
  });
 }
 workingDirectory(runId:string){return this.run(runId).workingDirectory;}
 selectWorkingDirectory(actor:Actor,path:string){this.guard(actor);directory(path);this.sql('UPDATE runs SET workingDirectory=? WHERE id=?',path,actor.runId!);return path;}
 nextQueuedRun(){return this.one<TaskRun>(`SELECT r.* FROM runs r JOIN tasks t ON t.id=r.taskId
      WHERE t.state='open' AND t.historyState='visible'
      AND r.status='queued' AND r.stopRequestedAt IS NULL ORDER BY r.createdAt,r.rowid LIMIT 1`);}
 claim(runId?:string):TaskRun|undefined{
  let denied=false;
  const claimed=this.store.transaction(()=>{
   for(;;){
    const run=runId?this.run(runId):this.nextQueuedRun();
    if(!run||runId&&(run.status!=='queued'||run.stopRequestedAt!==null||!this.canStart(run)))return;
    try{this.validateQueuedQuestion(run);}catch(error){
     if(!(error instanceof Error)||error.message!=='question_not_deliverable')throw error;
     const closed=!this.stopExitUnconfirmed(run);
     this.finishSegment(run,run.epoch,{status:'failed',text:'',errorCode:error.message},closed);
     if(closed)this.sql("UPDATE agent_receipts SET state='rejected',revision=revision+1 WHERE state='pending' AND messageId IN (SELECT id FROM agent_messages WHERE targetRunId=?)",run.id);
     if(runId){denied=true;return;}
     continue;
    }
    this.sql("UPDATE runs SET status='running',phase='starting',startedAt=coalesce(startedAt,?),checkpointJson=json_remove(coalesce(checkpointJson,'{}'),'$.workerExitConfirmed'),stateRevision=stateRevision+1 WHERE id=?",Date.now(),run.id);
    this.sql("UPDATE agent_receipts SET state='offered',offeredRunId=?,offeredEpoch=?,revision=revision+1 WHERE state='pending' AND messageId IN (SELECT id FROM agent_messages WHERE targetRunId=? AND recipientAgentId=?)",run.id,run.epoch,run.id,recipient(run.workerId));return this.run(run.id);
   }
  });
  if(runId&&denied)throw Error('question_not_deliverable');
  return claimed;
 }
 guardStarting(runId:string,epoch:number,acknowledging=false){
  const run=this.run(runId);if(run.status!=='running'||run.epoch!==epoch||run.phase!=='starting'||run.stopRequestedAt||!acknowledging&&!this.canStart(run))throw Error('run_epoch_or_phase_conflict');
  if(!acknowledging)this.validateQueuedQuestion(run);return run;
 }
 bind(runId:string,epoch:number,threadId:string,turnId:string){
  const bind=()=>{const run=this.guardStarting(runId,epoch,true);text(threadId,200);text(turnId,200);
   if(run.threadId&&run.threadId!==threadId||this.one('SELECT 1 FROM runs WHERE threadId=? AND workerId<>? LIMIT 1',threadId,run.workerId))throw Error('worker_thread_conflict');
   this.sql("UPDATE runs SET threadId=?,turnId=?,phase='executing',stateRevision=stateRevision+1,checkpointJson=json_set(coalesce(checkpointJson,'{}'),'$.executionAcknowledged',1) WHERE id=?",threadId,turnId,run.id);
   this.sql("UPDATE agent_receipts SET state='received',offeredTurnId=?,revision=revision+1 WHERE offeredRunId=? AND offeredEpoch=? AND state='offered'",turnId,run.id,epoch);
   if(this.table('worker_interactions'))this.sql(`UPDATE worker_interactions SET deliveredAt=? WHERE deliveredAt IS NULL AND id IN
    (SELECT json_extract(o.detailsJson,'$.questionId') FROM agent_messages m JOIN operations o ON o.id=m.operationKey JOIN agent_receipts a ON a.messageId=m.id WHERE m.targetRunId=? AND a.state='received')`,Date.now(),run.id);
  };
  if(this.store.db.isTransaction)bind();else this.store.transaction(bind);
 }
 private canStart(run:TaskRun){const task=this.task(run.taskId);return task.state==='open'&&task.historyState==='visible';}
 rpc(runId:string,epoch:number,waiting:boolean){const run=this.run(runId);if(run.epoch!==epoch||run.status!=='running'||run.stopRequestedAt)throw Error('run_epoch_stale');if(!['executing','rpc_wait'].includes(run.phase))throw Error('run_phase_denied');this.sql('UPDATE runs SET phase=?,stateRevision=stateRevision+1 WHERE id=?',waiting?'rpc_wait':'executing',run.id);}
 charge(runId:string,epoch:number,ms:number){const run=this.run(runId);if(run.epoch===epoch&&Number.isFinite(ms)&&ms>=0)this.sql('UPDATE runs SET activeMs=activeMs+? WHERE id=?',ms,runId);}
 markSteer(operationKey:string,state:'dispatching'|'received'|'failed'|'uncertain'){
  this.store.transaction(()=>{const op=this.operation(operationKey);if(op.kind!=='worker_steer')throw Error('operation_kind_conflict');if(['confirmed','cancelled','failed'].includes(op.state))return;const details=JSON.parse(op.detailsJson),run=this.run(details.runId);
   const current=run.epoch===details.epoch&&run.turnId===details.expectedTurnId&&run.threadId===details.threadId&&!run.stopRequestedAt;
   if((state==='dispatching'||state==='received')&&!current)throw Error('message_target_stale');
   if(state==='received'&&op.state!=='dispatching')throw Error('operation_state_conflict');
   if(state==='dispatching'){
    if(run.status!=='running'||run.phase!=='executing'||!this.canStart(run))throw Error('message_target_stale');
    const message=this.one<AgentMessage>('SELECT * FROM agent_messages WHERE id=?',details.messageId)!;
    for(const ref of JSON.parse(message.payloadJson).attachments??[])this.lifecycle?.validateWorkerAttachment?.(ref,message.id);
   }
   this.details(operationKey,{rpcState:state});this.sql('UPDATE operations SET state=?,revision=revision+1 WHERE id=?',state==='received'?'confirmed':state,operationKey);
   if(state==='received')this.sql("UPDATE agent_receipts SET state='processed',processedBy=?,revision=revision+1 WHERE messageId=?",run.id,details.messageId);
   if(state==='received'&&details.questionId)this.sql("UPDATE worker_interactions SET deliveredAt=? WHERE id=? AND state IN ('answered','denied') AND deliveredAt IS NULL",Date.now(),details.questionId);
   if(state==='failed')this.sql("UPDATE agent_receipts SET state='rejected',revision=revision+1 WHERE messageId=? AND state NOT IN ('processed','rejected')",details.messageId);
   if(state==='uncertain'&&current&&run.status==='running')this.sql("UPDATE runs SET phase='uncertain',stateRevision=stateRevision+1 WHERE id=?",run.id);
  });
 }
 private acceptsOutput(run:TaskRun,epoch:number){return run.status==='running'&&(run.stopRequestedAt?JSON.parse(run.checkpointJson??'{}').outputEpoch===epoch:run.epoch===epoch)&&['starting','executing','rpc_wait','uncertain'].includes(run.phase);}
 recordWorkerOutput(runId:string,epoch:number,message:{threadId?:string;turnId?:string;itemId:string;phase?:string|null;text:string}){
  const run=this.run(runId);if(!this.acceptsOutput(run,epoch)||run.threadId!==message.threadId||run.turnId!==message.turnId)return;
  const checkpoint=JSON.parse(run.checkpointJson??'{}'),messages:NonNullable<TurnResult['messages']>=checkpoint.workerOutput??[],item={itemId:message.itemId,phase:message.phase??null,text:message.text},at=messages.findIndex(row=>row.itemId===item.itemId);
  if(at<0)messages.push(item);else messages[at]=item;this.sql('UPDATE runs SET checkpointJson=? WHERE id=?',json({...checkpoint,workerOutput:messages,outputEpoch:epoch}),runId);
 }
 recordWorkerTerminal(runId:string,epoch:number,result:TurnResult){const run=this.run(runId);if(!this.acceptsOutput(run,epoch))return;this.sql("UPDATE runs SET checkpointJson=json_set(coalesce(checkpointJson,'{}'),'$.workerTerminal',json(?),'$.outputEpoch',?) WHERE id=? AND json_type(coalesce(checkpointJson,'{}'),'$.workerTerminal') IS NULL",json(result),epoch,runId);}
 private saveReturn(run:TaskRun,terminal:TurnResult,engineClosed:boolean){
  const checkpoint=JSON.parse(run.checkpointJson??'{}'),epoch=checkpoint.outputEpoch??run.epoch,operationId='worker-return:'+run.id+':'+epoch+':'+(run.turnId??'startup');
  const prior=this.one<Operation>("SELECT * FROM operations WHERE actorAgentId='host' AND scopeId=? AND operationId=?",run.taskId,operationId);if(prior?.responseJson)return JSON.parse(prior.responseJson) as {messageId:string;state:string};
  const messages:NonNullable<TurnResult['messages']>=[...(checkpoint.workerOutput??[])];
  for(const message of terminal.messages??[]){const at=messages.findIndex(item=>item.itemId===message.itemId);if(at<0)messages.push(message);else messages[at]=message;}
  const final=messages.filter(message=>message.phase==='final_answer'),body=messages.length?(final.length?final:messages.filter(message=>message.phase===null||message.phase==='commentary')).map(message=>message.text).join('\n\n'):terminal.text;
  const key=id('op');this.insertOperation(key,'host',run.taskId,operationId,'worker_return',{},'confirmed');
  const payload={workerId:run.workerId,runId:run.id,epoch,version:run.version,threadId:run.threadId,turnId:run.turnId,text:body,messages,execution:{status:terminal.status,errorCode:terminal.errorCode??null,nativeOutputError:terminal.nativeOutputError??null,exitConfirmed:engineClosed}};
  const messageId=this.message({agentId:'host',runId:run.id,epoch},key,this.store.meta('mainAgentId')!,run.taskId,run.version,'worker_reply',payload);
  const response={messageId,state:engineClosed?'ended':'uncertain'};this.sql('UPDATE operations SET responseJson=? WHERE id=?',json(response),key);
  this.sql("UPDATE runs SET checkpointJson=json_remove(coalesce(checkpointJson,'{}'),'$.workerOutput','$.workerTerminal'),stateRevision=stateRevision+1 WHERE id=?",run.id);
  this.sql("UPDATE agent_receipts SET state='processed',processedBy=?,revision=revision+1 WHERE offeredRunId=? AND state='received'",run.id,run.id);
  this.sql("UPDATE agent_receipts SET state=?,revision=revision+1 WHERE offeredRunId=? AND state='offered'",engineClosed?'rejected':'uncertain',run.id);
  return response;
 }
 endSegment(runId:string,epoch:number,terminal:TurnResult,engineClosed:boolean){return this.store.transaction(()=>this.finishSegment(this.run(runId),epoch,terminal,engineClosed));}
 private finishSegment(run:TaskRun,epoch:number,terminal:TurnResult,engineClosed:boolean){
  if(run.epoch!==epoch||run.stopRequestedAt)return;if(!active(run))return this.one<Operation>("SELECT * FROM operations WHERE scopeId=? AND kind='worker_return' AND json_extract(responseJson,'$.messageId') IN (SELECT id FROM agent_messages WHERE senderRunId=?) ORDER BY rowid DESC LIMIT 1",run.taskId,run.id)?.responseJson?JSON.parse(this.one<Operation>("SELECT * FROM operations WHERE scopeId=? AND kind='worker_return' AND json_extract(responseJson,'$.messageId') IN (SELECT id FROM agent_messages WHERE senderRunId=?) ORDER BY rowid DESC LIMIT 1",run.taskId,run.id)!.responseJson!):undefined;
  const response=this.saveReturn(run,terminal,engineClosed),status=engineClosed?(terminal.status==='completed'?'succeeded':terminal.status==='failed'?'failed':'interrupted'):'interrupted';
  this.sql('UPDATE runs SET status=?,phase=?,endedAt=?,errorCode=?,stateRevision=stateRevision+1 WHERE id=?',status,engineClosed?'ended':'uncertain',Date.now(),terminal.errorCode??(engineClosed?null:'engine_stop_unconfirmed'),run.id);if(engineClosed)this.sql("UPDATE runs SET checkpointJson=json_set(coalesce(checkpointJson,'{}'),'$.workerExitConfirmed',1) WHERE id=?",run.id);this.cancelInteractions(run.id,'worker_turn_ended',engineClosed&&['completed','failed'].includes(terminal.status));return response;
 }
 failRun(runId:string,epoch:number,code:string,uncertain=false){return this.endSegment(runId,epoch,{status:'failed',text:'',errorCode:code},!uncertain);}
 private cancelInteractions(runId:string,code:string,preserveQuestions=false){if(this.table('worker_interactions'))this.sql("UPDATE worker_interactions SET state='cancelled',code=?,updatedAt=? WHERE runId=? AND state IN ('pending_main','pending_user') AND (?=0 OR source<>'ask_main')",code,Date.now(),runId,Number(preserveQuestions));}
 private exitUnconfirmed(run:TaskRun){return run.phase==='uncertain'||run.startedAt!==null&&JSON.parse(run.checkpointJson??'{}').workerExitConfirmed!==1;}
 confirmWorkerExit(runId:string,expectedLease:string|undefined){return this.store.transaction(()=>{const key='lease:'+runId,actual=this.store.meta(key);if(actual!==expectedLease)return actual===undefined&&JSON.parse(this.run(runId).checkpointJson??'{}').workerExitConfirmed===1;this.sql("UPDATE runs SET checkpointJson=json_set(coalesce(checkpointJson,'{}'),'$.workerExitConfirmed',1),phase=CASE WHEN status NOT IN ('queued','running') THEN 'ended' ELSE phase END,stateRevision=stateRevision+1 WHERE id=?",runId);if(actual!==undefined)this.sql('DELETE FROM meta WHERE key=?',key);return true;});}
 interruptWorker(runId:string){const run=this.run(runId);if(!['queued','running'].includes(run.status)||run.stopRequestedAt)return;const checkpoint=JSON.parse(run.checkpointJson??'{}'),closed=checkpoint.workerExitConfirmed===1||run.status==='queued'&&run.startedAt===null&&!this.store.meta('lease:'+run.id);const result=this.endSegment(run.id,run.epoch,checkpoint.workerTerminal??{status:'unconfirmed',text:'',errorCode:'restart_unconfirmed'},closed);this.sql('UPDATE runs SET epoch=epoch+1,stateRevision=stateRevision+1 WHERE id=?',run.id);return result;}
 reconcile(pauseOldWork=false){
  for(const run of this.runs()){
   if(!['queued','running'].includes(run.status))continue;
   // A pending reply with no engine owner has never left the queue.
   if(!pauseOldWork&&this.table('worker_interactions')&&run.status==='queued'&&run.phase==='ready'&&run.startedAt===null&&!this.store.meta('lease:'+run.id)&&this.one(
    `SELECT 1 FROM agent_messages m JOIN operations o ON o.id=m.operationKey JOIN agent_receipts r ON r.messageId=m.id
     JOIN worker_interactions i ON i.id=json_extract(o.detailsJson,'$.questionId')
     WHERE m.targetRunId=? AND o.kind='worker_message' AND i.deliveredAt IS NULL AND i.state IN ('answered','denied') AND r.state='pending'`,run.id))continue;
   this.interruptWorker(run.id);
  }
  this.store.transaction(()=>{if(!pauseOldWork){this.sql("UPDATE agent_receipts SET state='uncertain',revision=revision+1 WHERE state='offered' OR state='received' AND recipientAgentId<>(SELECT value FROM meta WHERE key='mainAgentId')");this.sql("UPDATE operations SET state='uncertain',revision=revision+1 WHERE state='dispatching'");}});}
 private requestStops(taskId:string,reason:string,workerId:string){
  const runs=this.runs(taskId,workerId).filter(active);for(const run of runs){
   if(run.stopRequestedAt!==null)continue;
   this.sql("UPDATE runs SET stopRequestedAt=coalesce(stopRequestedAt,?),stopReason=?,epoch=epoch+1,checkpointJson=json_set(coalesce(checkpointJson,'{}'),'$.outputEpoch',coalesce(json_extract(checkpointJson,'$.outputEpoch'),?)),stateRevision=stateRevision+1 WHERE id=?",Date.now(),reason,run.epoch,run.id);this.cancelInteractions(run.id,'worker_stopped');
  }return runs.map(run=>run.id);
 }
 workerStop(actor:Actor,input:{operationId:string;workerId:string;reason?:string}){
  this.requireMain(actor);const worker=this.worker(input.workerId);return this.mutation(actor,worker.taskId,input.operationId,'worker_stop',input,key=>{
   this.cancelQuestions(worker.taskId,worker.workerId);
   const targets=this.requestStops(worker.taskId,input.reason??'worker_interrupted',worker.workerId);this.details(key,{action:'worker_stop',taskId:worker.taskId,workerId:worker.workerId,runIds:targets});return {taskId:worker.taskId,workerId:worker.workerId,state:targets.length?'requested':'confirmed',targets};
  });
 }
 private unresolved(taskId:string,except=''){
  return this.one<Operation>("SELECT * FROM operations WHERE scopeId=? AND id<>? AND state IN ('accepted','dispatching','uncertain') LIMIT 1",taskId,except);
 }
 controlTask(actor:Actor,input:TaskMutation&{action:'pause'|'resume';reason?:string}){
  this.requireMain(actor);return this.mutation(actor,input.taskId,input.operationId,'task_control',input,key=>{
   const task=this.check(actor,input);if(task.historyState!=='visible')throw Error('task_history_not_visible');if(!['pause','resume'].includes(input.action))throw Error('task_action_invalid');
   if(Object.hasOwn(input,'goal')||Object.hasOwn(input,'authority'))throw Error('task_action_invalid');
   if(input.action==='resume'){
    if(task.state!=='paused')throw Error('task_resume_unconfirmed');
    this.sql("UPDATE tasks SET state='open',revision=revision+1,updatedAt=? WHERE id=?",Date.now(),task.id);
    this.details(key,{action:'resume',taskId:task.id});
    return {taskId:task.id,version:task.headVersion,revision:task.revision+1,state:'open',targets:[]};
   }
   const blockers:{reason:string;id?:string;workerId?:string;runId?:string;status?:string;phase?:string}[]=this.runs(task.id)
    .filter(run=>active(run)||this.stopExitUnconfirmed(run)).map(run=>({reason:run.stopRequestedAt!==null?'worker_stop_requested':'run_not_closed',workerId:run.workerId,runId:run.id,status:run.status,phase:run.phase}));
   for(const {run} of this.workers(task.id))if(this.workerEffectUnconfirmed(run))blockers.push({reason:'worker_effect_unconfirmed',workerId:run.workerId,runId:run.id});
   const operation=this.unresolved(task.id,key),interaction=this.unresolvedInteractions(task.id);
   if(operation)blockers.push({reason:'operation_unresolved',id:operation.id});
   if(interaction)blockers.push({reason:'interaction_unresolved',id:interaction.id});
   this.details(key,{action:input.action,taskId:task.id});
   const changed=this.sql("UPDATE tasks SET state='paused',revision=revision+1,updatedAt=? WHERE id=? AND state='open'",Date.now(),task.id);
   return {taskId:task.id,version:task.headVersion,revision:task.revision+Number(changed.changes),state:'paused',blockers,targets:[]};
  });
 }
 private workerEffectUnconfirmed(run:TaskRun){return !!run.threadId&&this.lifecycle?.unconfirmedWorkerEffects?.(run.threadId)===true;}
 private stopExitUnconfirmed(run:TaskRun){
  return !!this.store.meta('lease:'+run.id)||
    (run.startedAt!==null&&JSON.parse(run.checkpointJson??'{}').workerExitConfirmed!==1)||
    this.lifecycle?.reviewExitConfirmed?.(run)===false;
 }
 recoverWorkerOperations(worker?:{taskId:string;workerId:string}){
  const pending=worker
   ? "actorAgentId=? AND scopeId=? AND kind='worker_stop' AND json_extract(detailsJson,'$.workerId')=? AND state IN ('accepted','uncertain')"
   : "(kind='worker_stop' AND state IN ('accepted','uncertain')) OR (kind='worker_steer' AND state IN ('accepted','dispatching'))";
  const operations=this.all<Pick<Operation,'id'|'kind'|'state'|'detailsJson'>>(`SELECT id,kind,state,detailsJson FROM operations WHERE ${pending} ORDER BY rowid`,
   ...(worker?[this.store.meta('mainAgentId')!,worker.taskId,worker.workerId]:[]));
  for(const operation of operations){
   const details=JSON.parse(operation.detailsJson);
   if(operation.kind==='worker_steer'){
    // The dispatching receipt is committed before sending the native request.
    if(!this.stopExitUnconfirmed(this.run(details.runId)))
     this.markSteer(operation.id,operation.state==='accepted'?'failed':'uncertain');
   }else if(details.runIds?.length&&details.runIds.every((runId:string)=>!this.stopExitUnconfirmed(this.run(runId)))){
    this.confirmStop(operation.id,true);
   }
  }
 }
 confirmStop(operationKey:string,confirmed:boolean){return this.store.transaction(()=>{
  const op=this.operation(operationKey),details=JSON.parse(op.detailsJson);if(op.kind!=='worker_stop')throw Error('operation_kind_conflict');if(op.state==='confirmed')return JSON.parse(op.responseJson!);
  const runs=(details.runIds??[]).map((runId:string)=>this.run(runId)) as TaskRun[];
  if(confirmed&&runs.some(run=>this.stopExitUnconfirmed(run)))throw Error('run_stop_unconfirmed');
  for(const run of runs){
   const checkpoint=JSON.parse(run.checkpointJson??'{}'),exitConfirmed=confirmed||!this.stopExitUnconfirmed(run);
   this.saveReturn(run,checkpoint.workerTerminal??{status:'interrupted',text:'',errorCode:'worker_stopped'},exitConfirmed);
   this.sql("UPDATE runs SET status=?,phase=?,endedAt=?,checkpointJson=json_set(coalesce(checkpointJson,'{}'),'$.workerExitConfirmed',?),stateRevision=stateRevision+1 WHERE id=?",exitConfirmed?'cancelled':'interrupted',exitConfirmed?'ended':'uncertain',Date.now(),exitConfirmed?1:0,run.id);
   if(exitConfirmed){this.sql("UPDATE operations SET state='cancelled',revision=revision+1 WHERE kind='worker_steer' AND state IN ('accepted','dispatching','uncertain') AND json_extract(detailsJson,'$.runId')=?",run.id);this.sql("UPDATE agent_receipts SET state='rejected',revision=revision+1 WHERE messageId IN (SELECT id FROM agent_messages WHERE targetRunId=? AND kind='worker_input') AND state IN ('pending','offered','received','uncertain')",run.id);}
  }
  const response={...JSON.parse(op.responseJson??'{}'),state:confirmed?'confirmed':'uncertain'};this.sql('UPDATE operations SET state=?,responseJson=?,revision=revision+1 WHERE id=?',confirmed?'confirmed':'uncertain',json(response),op.id);return response;
 });}
 inbox(actor:Actor,after=0){this.actorTask(actor);return this.all<AgentMessage>(`SELECT m.* FROM agent_messages m JOIN agent_receipts r ON r.messageId=m.id WHERE m.recipientAgentId=? AND
   ((m.recipientAgentId<>(SELECT value FROM meta WHERE key='mainAgentId') AND r.state NOT IN ('processed','rejected')) OR
    (m.recipientAgentId=(SELECT value FROM meta WHERE key='mainAgentId') AND (r.state NOT IN ('received','rejected') OR r.state='received' AND ${mainInputProcessingSql()})))
   AND m.kind<>'user_input' AND (m.targetRunId IS NULL OR m.targetRunId=?) AND m.seq>? ORDER BY m.seq LIMIT 100`,actor.agentId,actor.runId??null,after).map(row=>({...row,payload:JSON.parse(row.payloadJson)}));}
 receiveMainMessagesInTransaction(messageIds:string[],turnId:string){
  if(!this.db.isTransaction)throw Error('main_receipt_transaction_required');
  for(const messageId of messageIds){
   const row=this.one<{state:string;offeredTurnId:string|null}>("SELECT r.state,r.offeredTurnId FROM agent_messages m JOIN agent_receipts r ON r.messageId=m.id WHERE m.id=? AND m.recipientAgentId=? AND r.recipientAgentId=m.recipientAgentId AND m.kind<>'user_input' AND m.targetRunId IS NULL",messageId,this.store.meta('mainAgentId')!);
   if(!row||row.state!=='offered'&&!(row.state==='received'&&row.offeredTurnId===turnId))throw Error('main_receipt_identity_conflict');
   if(row.state==='offered')this.sql("UPDATE agent_receipts SET state='received',offeredTurnId=?,revision=revision+1 WHERE messageId=? AND recipientAgentId=? AND state='offered'",turnId,messageId,this.store.meta('mainAgentId')!);
  }
 }
 queueInteraction(interactionId:string){if(!this.table('worker_interactions'))throw Error('interaction_not_found');const interaction=this.one<{runId:string;threadId:string;turnId:string;kind:string}>('SELECT runId,threadId,turnId,kind FROM worker_interactions WHERE id=?',interactionId);if(!interaction)throw Error('interaction_not_found');const run=this.run(interaction.runId),key='interaction:'+interactionId;if(this.one('SELECT 1 FROM operations WHERE id=?',key))return;this.insertOperation(key,'host',run.taskId,key,'interaction_notice',{},'confirmed');this.message({agentId:'host',runId:run.id,epoch:run.epoch},key,this.store.meta('mainAgentId')!,run.taskId,run.version,'interaction_required',{interactionId,runId:run.id,workerId:run.workerId,threadId:interaction.threadId,turnId:interaction.turnId});}
 private unresolvedInteractions(taskId:string,workerId?:string,allowQuestions=false){
  return this.table('worker_interactions')?this.one<{id:string}>(`SELECT i.id FROM worker_interactions i JOIN runs r ON r.id=i.runId
    WHERE (?=0 OR i.source<>'ask_main') AND r.taskId=?${workerId?' AND r.workerId=?':''} AND (i.state IN ('pending_main','pending_user') OR i.state IN ('approved','denied','answered') AND i.deliveredAt IS NULL) LIMIT 1`,Number(allowQuestions),taskId,...(workerId?[workerId]:[])):undefined;
 }
 private commitArchive(task:Task,key:string){
  this.details(key,{expectedRevision:task.revision});
  this.sql("UPDATE tasks SET historyState='archived',state='paused',revision=revision+1,updatedAt=? WHERE id=?",Date.now(),task.id);
  this.message({agentId:'host'},key,this.store.meta('mainAgentId')!,task.id,task.headVersion,'task_archived',{historyState:'archived',revision:task.revision+1});
  return {taskId:task.id,version:task.headVersion,state:'archived' as const,revision:task.revision+1,diskBytesReclaimed:null};
 }
 webArchiveBlockers(actor:Actor,taskIds:readonly string[]){
  this.requireMain(actor);
  return new Map(taskIds.map(taskId=>[taskId,this.task(taskId).historyState==='visible'?null:'task_history_not_visible']));
 }
 archiveFromWeb(actor:Actor,input:TaskMutation){
  if(actor.inputMessageId||actor.sourceRequestId||actor.threadId!==this.store.meta('mainThread'))throw Error('history_source_required');
  return this.mutation(actor,input.taskId,input.operationId,'archive_work',input,key=>{
   const task=this.check(actor,input);
   if(task.historyState!=='visible')throw Error('task_history_not_visible');
   this.details(key,{origin:'work_status'});
   return this.commitArchive(task,key);
  });
 }
 archiveOperation(messageId:string){
  return this.one<{id:string}>(`SELECT o.id FROM agent_messages m JOIN operations o ON o.id=m.operationKey
   WHERE m.id=? AND m.kind='task_archived' AND m.senderAgentId='host' AND o.kind='archive_work'`,messageId)?.id;
 }
 recordArchiveReviewIssue(key:string,issue:'failed'|'unknown'){
  this.details(key,{reviewIssue:issue});
 }
 archiveHistory(actor:Actor,input:TaskMutation,archive:boolean){
  this.requireMain(actor);
  return this.mutation(actor,input.taskId,input.operationId,archive?'archive_work':'restore_work',input,key=>{
   const task=this.check(actor,input);
   if(archive&&task.historyState==='visible')return this.commitArchive(task,key);
   this.details(key,{expectedRevision:task.revision});
   if(!archive&&task.historyState==='archived')this.sql("UPDATE tasks SET historyState='visible',revision=revision+1,updatedAt=? WHERE id=?",Date.now(),task.id);
   return {taskId:task.id,version:task.headVersion,state:archive?'archived':'restored',revision:this.task(task.id).revision,diskBytesReclaimed:null};
  });
 }
 recoverArchives(){
  this.sql(`UPDATE operations SET state='confirmed',revision=revision+1,responseJson=json_object('taskId',scopeId,'operationKey',id,'state','skipped',
   'blockers',json_array(json_object('reason','turn_unknown','id',json_extract(detailsJson,'$.inputMessageId')))) WHERE kind='archive_work' AND state='accepted'`);
 }
 readFileReceipt(actor:Actor,operationId:string):FileReceipt|undefined{
  const task=this.guard(actor),run=this.run(actor.runId!);text(operationId,500);if(actor.operationPayload===undefined)throw Error('operation_payload_required');
  const op=this.one<Operation>('SELECT * FROM operations WHERE actorAgentId=? AND scopeId=? AND operationId=?',actor.agentId,task.id,operationId);if(!op)return;
  const details=JSON.parse(op.detailsJson);if(op.kind!=='write_file'||details.runId!==run.id||details.threadId!==actor.threadId||details.turnId!==actor.turnId||details.toolInputHash!==recursiveHash(actor.operationPayload))throw Error('operation_payload_conflict');
  if(op.state==='failed')throw Error(details.failureCode??'operation_failed');if(op.state!=='confirmed'||!op.responseJson)throw Error('operation_uncertain');
  const saved=JSON.parse(op.responseJson);if(!saved||typeof saved.path!=='string'||typeof saved.sha256!=='string'||!/^[a-f0-9]{64}$/.test(saved.sha256)||!Number.isSafeInteger(saved.bytes)||saved.bytes<0||saved.state!=='written'||saved.operationKey!==op.id)throw Error('operation_receipt_invalid');
  const receipt:FileReceipt={path:saved.path,sha256:saved.sha256,bytes:saved.bytes,state:'written',operationKey:op.id};this.lifecycle?.validateFileRead?.(receipt.path);
  const actual=this.files.verify(this.files.prepareRun(task.id,run.id),receipt.path);if(actual.sha256!==receipt.sha256||actual.bytes!==receipt.bytes)throw Error('result_hash_mismatch');
  if(op.payloadHash!==recursiveHash({filename:basename(receipt.path),sha256:receipt.sha256,bytes:receipt.bytes,toolInput:actor.operationPayload}))throw Error('operation_payload_conflict');return receipt;
 }
 writeFile(actor:Actor,input:{operationId:string;filename:string;bytes:Buffer}){
  const task=this.guard(actor),run=this.run(actor.runId!),dir=this.files.prepareRun(task.id,run.id),hash=createHash('sha256').update(input.bytes).digest('hex');
  const payload={filename:input.filename,sha256:hash,bytes:input.bytes.length,...(actor.operationPayload===undefined?{}:{toolInput:actor.operationPayload})};
  const intent=this.store.transaction(()=>{const prior=this.one<Operation>('SELECT * FROM operations WHERE actorAgentId=? AND scopeId=? AND operationId=?',actor.agentId,task.id,input.operationId);
   if(prior){if(prior.kind!=='write_file'||prior.payloadHash!==recursiveHash(payload))throw Error('operation_payload_conflict');if(prior.state==='failed')throw Error(JSON.parse(prior.detailsJson).failureCode??'artifact_filename_conflict');if(prior.responseJson)return JSON.parse(prior.responseJson) as FileReceipt;return {operationKey:prior.id,resuming:true};}
   text(input.operationId,500);if(!Buffer.isBuffer(input.bytes))throw Error('task_invalid_input');const key=id('op');this.insertOperation(key,actor.agentId,task.id,input.operationId,'write_file',payload,'accepted',{runId:run.id,threadId:actor.threadId,turnId:actor.turnId,...(actor.operationPayload===undefined?{}:{toolInputHash:recursiveHash(actor.operationPayload)})});return {operationKey:key,resuming:false};});
  if('path' in intent){const actual=this.files.verify(dir,intent.path);if(actual.sha256!==hash)throw Error('result_hash_mismatch');return intent;}
  this.guard(actor);let path:string;
  try{path=this.files.writeBinary(dir,input.filename,input.bytes);}catch(error){
   if(error instanceof Error&&['artifact_path_denied','artifact_filename_too_long','file_type_or_size_denied'].includes(error.message)){this.sql("UPDATE operations SET state='failed',detailsJson=json_set(detailsJson,'$.failureCode',?),revision=revision+1 WHERE id=?",error.message,intent.operationKey);throw error;}
   if(!(error instanceof Error)||!('code' in error)||error.code!=='EEXIST')throw error;path=dir+'/'+input.filename;
   if(!intent.resuming){let code='artifact_filename_conflict';try{this.files.verify(dir,path);}catch(error){if(error instanceof Error)code=error.message;}this.sql("UPDATE operations SET state='failed',detailsJson=json_set(detailsJson,'$.failureCode',?),revision=revision+1 WHERE id=?",code,intent.operationKey);throw Error(code);}
   const existing=this.files.verify(dir,path);if(existing.sha256!==hash)throw Error('artifact_filename_conflict');
  }
  const actual=this.files.verify(dir,path),response:FileReceipt={path,sha256:actual.sha256,bytes:actual.bytes,state:'written',operationKey:intent.operationKey};
  this.store.transaction(()=>{this.guard(actor);this.sql("UPDATE operations SET responseJson=?,state='confirmed',revision=revision+1 WHERE id=?",json(response),intent.operationKey);this.lifecycle?.operationConfirmed?.(actor,intent.operationKey,'write_file',response);});return response;
 }
 captureActivity(actor:Actor,name:string,args:unknown,receipt:unknown):PublicActivity|undefined{
  this.actorTask(actor);if(!receipt||typeof receipt!=='object')return;let r=receipt as Record<string,unknown>;const a=args&&typeof args==='object'?args as Record<string,unknown>:{};
  if(name==='work_inspect'){const row=r.task as Task|undefined;if(typeof a.taskId!=='string'||row?.id!==a.taskId)return;r={taskId:row.id,version:row.headVersion};}
  else if(name==='worker_read'){if(typeof a.workerId!=='string'||r.workerId!==a.workerId||this.worker(a.workerId).taskId!==r.taskId)return;}
  else{
   const kinds:Record<string,string[]>={task_create:['task_create'],worker_interrupt:['worker_stop'],task_update:['task_update','task_control']};
   if(!kinds[name]||typeof r.operationKey!=='string')return;const op=this.one<Operation>('SELECT * FROM operations WHERE id=?',r.operationKey);if(!op||op.actorAgentId!==actor.agentId||!kinds[name]!.includes(op.kind)||!op.responseJson)return;
   const committed=JSON.parse(op.responseJson) as Record<string,unknown>,taskId=committed.taskId??op.scopeId;
   if(a.taskId!==undefined&&a.taskId!==taskId||r.taskId!==undefined&&r.taskId!==taskId)return;
   for(const key of ['runId'] as const)if(r[key]!==undefined&&r[key]!==committed[key])return;
   r={...committed,taskId};
  }
  const taskId=typeof r.taskId==='string'?r.taskId:undefined;if(!taskId)return;this.readAllowed(actor,taskId);const task=this.task(taskId);
  const target:ActivityTarget={taskId,version:typeof r.version==='number'?r.version:task.headVersion};
  for(const key of ['runId','operationKey'] as const)if(typeof r[key]==='string')target[key]=r[key] as string;
  const objectName=publicActivityName(task.title),base={schemaVersion:1 as const,target,...(objectName?{objectName}:{})};
  if(name==='task_create')return {...base,action:'create_task',outcome:'created'};
  if(name==='work_inspect'||name==='worker_read')return {...base,action:name==='worker_read'?'inspect_run':'inspect_task',outcome:'record_read'};
  if(name==='worker_interrupt')return {...base,action:'stop_task',outcome:r.state==='confirmed'?'stop_confirmed':'stop_requested'};
  if(name==='task_update'&&r.state!=='blocked')return {...base,action:'update_task',outcome:r.state==='requested'?'update_accepted':'update_confirmed'};
 }
 executionReadScope(actor:Actor,selector:{taskId:string;runId:string},threadId:string){this.requireMain(actor);if(threadId!==this.store.meta('mainThread'))throw Error('execution_scope_denied');const run=this.run(selector.runId);if(run.taskId!==selector.taskId)throw Error('execution_scope_denied');return {version:run.version};}
 activityLink(target:ActivityTarget,threadId:string):ActivityLink|undefined{
  if(threadId!==this.store.meta('mainThread'))return;const task=this.one<Task>('SELECT * FROM tasks WHERE id=? AND historyState=\'visible\'',target.taskId);if(!task||!this.one('SELECT 1 FROM task_versions WHERE taskId=? AND version=?',task.id,target.version))return;
  if(target.runId){const run=this.store.run(target.runId);if(!run||run.taskId!==task.id||run.version!==target.version)return;}
  return {task:{...target}};
 }
 // Membership media receipts survive upgrade and never replay a POST. The service fences live calls.
 safeToUpgrade(){
  return storedWorkSafeToUpgrade(this.store.db);
 }
}

export function storedWorkSafeToUpgrade(db:DatabaseSync,legacy=false){
 const has=(sql:string)=>!!db.prepare(sql).get();
 return !has("SELECT 1 FROM runs WHERE status IN ('queued','running') OR phase='uncertain'")
   && !has("SELECT 1 FROM operations WHERE state IN ('accepted','dispatching','uncertain') AND kind NOT IN ('membership_video','membership_audio')")
   && !has(`SELECT 1 FROM meta p WHERE p.key GLOB 'publicMainNode:v1:*' AND ${unconfirmedNativeEffectsSql()} LIMIT 1`)
   && !(has("SELECT 1 FROM sqlite_master WHERE type='table' AND name='worker_interactions'")&&has(`SELECT 1 FROM worker_interactions WHERE state='pending_main' OR state='pending_user'${legacy?'':" AND source<>'ask_main'"} OR state IN ('approved','denied','answered') AND deliveredAt IS NULL LIMIT 1`))
   && !has(`SELECT 1 FROM agent_receipts r JOIN agent_messages m ON m.id=r.messageId
     WHERE (r.recipientAgentId<>(SELECT value FROM meta WHERE key='mainAgentId') AND r.state NOT IN ('processed','rejected'))
       OR (r.recipientAgentId=(SELECT value FROM meta WHERE key='mainAgentId') AND
         (r.state NOT IN ('received','rejected') OR r.state='received' AND ${mainInputProcessingSql()}))`);
}
