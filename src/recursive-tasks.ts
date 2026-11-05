import {createHash,randomUUID} from 'node:crypto';
import {basename,isAbsolute} from 'node:path';
import {realpathSync,statSync,constants,openSync,fstatSync,readFileSync,closeSync} from 'node:fs';
import {PendingItems} from './pending-items.js';
import {STORE_SCHEMA_VERSION,type Store,type Run} from './store.js';
import {inside,type Files} from './files.js';
import type {TurnResult} from './engine.js';
import type {AttachmentRef} from './media-store.js';
import {parseAttachmentReference} from './attachment-reference.js';
import {publicActivityName,type PublicActivity,type ActivityTarget,type ActivityLink} from './activity-facts.js';

// Captured by the host, never accepted from model tool arguments.
export type Actor={agentId:string;sourceRequestId?:string;runId?:string;epoch?:number;threadId?:string;turnId?:string;inputMessageId?:string;operationPayload?:unknown};
export type Outcome='succeeded'|'partial'|'failed'|'cancelled';
export type Authority={sourceRequestId:string;sourceRequestIds?:string[];description:string;materials:string[];resultIds:string[];attachments?:string[]};
export type Task={id:string;title:string;headVersion:number;notes:string;state:'open'|'paused'|'settled';outcome:Outcome|null;revision:number;controlState:'normal'|'stopping';historyState:'visible'|'archived';createdAt:number;updatedAt:number;settledAt:number|null};
export type TaskVersion={taskId:string;version:number;goal:string;authorityJson:string;sourceRequestId:string;triggerOpId:string;workingDirectory:string};
export type TaskRun=Run;
export type TaskMutation={operationId:string;taskId:string;expectedRevision:number};
export type Worker={workerId:string;taskId:string;threadId:string|null;run:TaskRun};
export type Operation={id:string;actorAgentId:string;scopeId:string;operationId:string;kind:string;payloadHash:string;state:string;detailsJson:string;responseJson:string|null;revision:number};
export type AgentMessage={seq:number;id:string;senderAgentId:string;senderRunId:string|null;senderEpoch:number|null;recipientAgentId:string;taskId:string|null;taskVersion:number|null;targetRunId:string|null;kind:string;replyTo:string|null;causationId:string|null;operationKey:string;payloadJson:string};
export type Result={id:string;taskId:string;version:number;runId:string|null;messageId:string|null;kind:'text'|'file';payloadJson:string;filePath:string|null;sha256:string|null;state:'accepted';operationKey:string};
export type Delivery={id:string;taskId:string;version:number;resultIdsJson:string;routeSourceRequestId:string;text:string;historyMessageId:string;state:string;revision:number;attemptedAt:number|null;revokedAt:number|null;operationKey:string};
export type FileReceipt={path:string;sha256:string;bytes:number;state:'written';operationKey:string};
export type RecursiveTaskLifecycle={validateActor(actor:Actor):void;validateFileRead?(path:string):void;validateAttachments?(sourceRequestId:string,refs:readonly AttachmentRef[]):void;reviewExitConfirmed?(run:TaskRun):boolean;operationConfirmed?(actor:Actor,key:string,kind:string,response:Record<string,unknown>):void};
export class TaskCreationRejected extends Error{}
export const RECURSIVE_SCHEMA_VERSION=STORE_SCHEMA_VERSION;
const id=(kind:string)=>kind+'-'+randomUUID(),json=(value:unknown)=>JSON.stringify(value);
function canonical(value:unknown):string{if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).filter(([,v])=>v!==undefined).map(([k,v])=>json(k)+':'+canonical(v)).join(',')+'}';return json(value)??'null';}
export const recursiveHash=(value:unknown)=>createHash('sha256').update(typeof value==='string'?value:canonical(value)).digest('hex');
const text=(value:unknown,max=24000)=>{if(typeof value!=='string'||!value.trim()||value.length>max)throw Error('task_invalid_input');return value;};
const directory=(path:string)=>{if(!isAbsolute(path)||realpathSync(path)!==path||!statSync(path).isDirectory())throw Error('task_working_directory_invalid');return path;};
const active=(run:Run)=>['queued','running'].includes(run.status)||run.phase==='uncertain';
const recipient=(workerId:string)=>'worker:'+workerId;

export class RecursiveTasks{
 readonly pending=new PendingItems(this);
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
  const version=this.store.meta('recursiveSchemaVersion');if(version!==undefined&&version!==RECURSIVE_SCHEMA_VERSION)throw Error('recursive_schema_unsupported');
  if(version===undefined)this.store.transaction(()=>{
   this.db.exec(`
    CREATE TABLE tasks(id TEXT PRIMARY KEY,title TEXT NOT NULL,headVersion INTEGER NOT NULL,notes TEXT NOT NULL DEFAULT '',state TEXT NOT NULL CHECK(state IN ('open','paused','settled')),outcome TEXT,revision INTEGER NOT NULL,controlState TEXT NOT NULL DEFAULT 'normal',historyState TEXT NOT NULL DEFAULT 'visible' CHECK(historyState IN ('visible','archived')),createdAt INTEGER NOT NULL,updatedAt INTEGER NOT NULL,settledAt INTEGER);
    CREATE TABLE operations(id TEXT PRIMARY KEY,actorAgentId TEXT NOT NULL,scopeId TEXT NOT NULL,operationId TEXT NOT NULL,kind TEXT NOT NULL,payloadHash TEXT NOT NULL,state TEXT NOT NULL,detailsJson TEXT NOT NULL,responseJson TEXT,revision INTEGER NOT NULL DEFAULT 0,UNIQUE(actorAgentId,scopeId,operationId));
    CREATE TABLE task_versions(taskId TEXT NOT NULL REFERENCES tasks(id),version INTEGER NOT NULL,goal TEXT NOT NULL,authorityJson TEXT NOT NULL,sourceRequestId TEXT NOT NULL,triggerOpId TEXT NOT NULL UNIQUE REFERENCES operations(id),workingDirectory TEXT NOT NULL,PRIMARY KEY(taskId,version));
    CREATE TABLE agent_messages(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,senderAgentId TEXT NOT NULL,senderRunId TEXT REFERENCES runs(id),senderEpoch INTEGER,recipientAgentId TEXT NOT NULL,taskId TEXT REFERENCES tasks(id),taskVersion INTEGER,targetRunId TEXT REFERENCES runs(id),kind TEXT NOT NULL,replyTo TEXT REFERENCES agent_messages(id),causationId TEXT REFERENCES agent_messages(id),operationKey TEXT NOT NULL UNIQUE REFERENCES operations(id),payloadJson TEXT NOT NULL);
    CREATE TABLE agent_receipts(messageId TEXT NOT NULL REFERENCES agent_messages(id),recipientAgentId TEXT NOT NULL,state TEXT NOT NULL,offeredRunId TEXT REFERENCES runs(id),offeredEpoch INTEGER,offeredTurnId TEXT,processedBy TEXT,resultRef TEXT,revision INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(messageId,recipientAgentId));
    CREATE INDEX agent_inbox ON agent_receipts(recipientAgentId,state);CREATE INDEX agent_receipt_state ON agent_receipts(state,messageId);CREATE INDEX messages_task ON agent_messages(taskId,seq);
    CREATE TABLE results(id TEXT PRIMARY KEY,taskId TEXT NOT NULL,version INTEGER NOT NULL,runId TEXT REFERENCES runs(id),messageId TEXT REFERENCES agent_messages(id),kind TEXT NOT NULL,payloadJson TEXT NOT NULL,filePath TEXT,sha256 TEXT,state TEXT NOT NULL DEFAULT 'accepted',operationKey TEXT NOT NULL UNIQUE REFERENCES operations(id),FOREIGN KEY(taskId,version) REFERENCES task_versions(taskId,version));
    CREATE INDEX results_task ON results(taskId,version);CREATE INDEX results_run ON results(runId);
    CREATE TABLE deliveries(id TEXT PRIMARY KEY,taskId TEXT NOT NULL,version INTEGER NOT NULL,resultIdsJson TEXT NOT NULL,routeSourceRequestId TEXT NOT NULL,text TEXT NOT NULL,historyMessageId TEXT NOT NULL UNIQUE,state TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0,attemptedAt INTEGER,revokedAt INTEGER,operationKey TEXT NOT NULL UNIQUE REFERENCES operations(id),FOREIGN KEY(taskId,version) REFERENCES task_versions(taskId,version));
    CREATE TABLE IF NOT EXISTS worker_authorities(runId TEXT PRIMARY KEY,sourceRequestId TEXT NOT NULL,description TEXT NOT NULL);`);
   this.store.setMeta('mainAgentId',this.store.meta('mainAgentId')??'main:'+randomUUID());this.store.setMeta('recursiveSchemaVersion',RECURSIVE_SCHEMA_VERSION);
  });
  this.pending.migrate();
 }
 task(taskId:string):Task{const task=this.one<Task>('SELECT * FROM tasks WHERE id=?',taskId);if(!task)throw Error('task_not_found');return task;}
 tasks():Task[]{return this.all('SELECT * FROM tasks ORDER BY rowid');}
 version(taskId:string,version:number):TaskVersion{const v=this.one<TaskVersion>('SELECT * FROM task_versions WHERE taskId=? AND version=?',taskId,version);if(!v)throw Error('task_version_not_found');return v;}
 authority(taskId:string,version:number):Authority{return JSON.parse(this.version(taskId,version).authorityJson);}
 run(runId:string):TaskRun{const r=this.store.run(runId);if(!r)throw Error('run_not_found');return r;}
 runs(taskId?:string,workerId?:string):TaskRun[]{return this.all('SELECT * FROM runs'+(taskId?' WHERE taskId=?'+(workerId?' AND workerId=?':''):workerId?' WHERE workerId=?':'')+' ORDER BY createdAt,rowid',...(taskId?[taskId]:[]),...(workerId?[workerId]:[]));}
 workers(taskId:string):Worker[]{return this.all<TaskRun>('SELECT r.* FROM runs r WHERE taskId=? AND rowid=(SELECT max(rowid) FROM runs WHERE workerId=r.workerId) ORDER BY createdAt,rowid',taskId).map(run=>({workerId:run.workerId,taskId,threadId:run.threadId,run}));}
 private worker(workerId:string):Worker{const run=this.one<TaskRun>('SELECT * FROM runs WHERE workerId=? ORDER BY rowid DESC LIMIT 1',workerId);if(!run||this.run(workerId).workerId!==workerId)throw Error('worker_not_found');return {workerId,taskId:run.taskId,threadId:run.threadId,run};}
 private main(actor:Actor){return actor.agentId===this.store.meta('mainAgentId')&&!actor.runId;}
 private requireMain(actor:Actor){if(!this.main(actor))throw Error('task_main_required');this.lifecycle?.validateActor(actor);if(actor.threadId&&actor.threadId!==this.store.meta('mainThread'))throw Error('agent_identity_denied');}
 private actorTask(actor:Actor){if(this.main(actor)){this.requireMain(actor);return;}
  if(!actor.runId)throw Error('agent_identity_denied');const run=this.run(actor.runId);
  if(actor.agentId!==recipient(run.workerId))throw Error('agent_identity_denied');if(actor.epoch!==run.epoch)throw Error('run_epoch_stale');
  if(run.status!=='running'||run.threadId!==actor.threadId||run.turnId!==actor.turnId)throw Error('run_not_live');this.lifecycle?.validateActor(actor);return this.task(run.taskId);
 }
 private readAllowed(actor:Actor,taskId:string){const own=this.actorTask(actor);if(own&&own.id!==taskId)throw Error('agent_scope_denied');}
 private writable(task:Task){if(task.historyState!=='visible')throw Error('task_history_not_visible');if(task.controlState!=='normal')throw Error('task_stop_requested');if(task.state!=='open')throw Error('task_not_open');}
 private check(actor:Actor,input:TaskMutation){this.requireMain(actor);const task=this.task(input.taskId);if(task.revision!==input.expectedRevision)throw Error('task_revision_conflict');return task;}
 guard(actor:Actor,phases=['executing']){const task=this.actorTask(actor);if(!task||!actor.runId)throw Error('run_required');const run=this.run(actor.runId);this.writable(task);if(run.stopRequestedAt)throw Error('run_stop_requested');if(run.version!==task.headVersion)throw Error('run_version_stale');if(!phases.includes(run.phase))throw Error('run_phase_denied');return task;}
 requirePendingActor(actor:Actor){this.requireMain(actor);if(actor.threadId!==this.store.meta('mainThread'))throw Error('pending_actor_denied');}
 private trustedSource(actor:Actor,source:string){
  text(source,200);if(this.table('conversation_inputs'))return this.pending.source(actor,source);
  if(!this.store.request(source))throw Error('task_authority_source_denied');return {requestId:source};
 }
 private validateAuthority(actor:Actor,authority:Authority){
  if(!authority||typeof authority!=='object')throw Error('task_authority_source_denied');text(authority.description,24000);
  const sources=[...new Set([authority.sourceRequestId,...(authority.sourceRequestIds??[])])];if(!sources.length||sources.length>20)throw Error('task_authority_source_denied');for(const source of sources)this.trustedSource(actor,source);
  for(const key of ['materials','resultIds','attachments'] as const)if(authority[key]!==undefined&&(!Array.isArray(authority[key])||new Set(authority[key]).size!==authority[key]!.length||authority[key]!.some(x=>typeof x!=='string'||!x)))throw Error('task_authority_input_denied');
  if(!Array.isArray(authority.materials)||!Array.isArray(authority.resultIds))throw Error('task_authority_input_denied');
  for(const resultId of authority.resultIds){const result=this.result(resultId),origin=this.authority(result.taskId,result.version);if([origin.sourceRequestId,...(origin.sourceRequestIds??[])].some(source=>!sources.includes(source)))throw Error('task_authority_input_denied');this.actualResult(result);}
  const refs=(authority.attachments??[]).map(parseAttachmentReference);if(refs.length)this.lifecycle?.validateAttachments?.(authority.sourceRequestId,refs);
  return sources;
 }
 private insertOperation(key:string,actor:string,scope:string,operationId:string,kind:string,payload:unknown,state='accepted',details:unknown={}){this.sql('INSERT INTO operations VALUES(?,?,?,?,?,?,?,?,NULL,0)',key,actor,scope,operationId,kind,recursiveHash(payload),state,json(details));}
 private mutation<T extends Record<string,unknown>>(actor:Actor,scope:string,operationId:string,kind:string,payload:unknown,write:(key:string)=>T,state='confirmed'):T&{operationKey:string}{
  this.actorTask(actor);text(operationId,500);const operationPayload=actor.operationPayload??payload;
  return this.store.transaction(()=>{const prior=this.one<Operation>('SELECT * FROM operations WHERE actorAgentId=? AND scopeId=? AND operationId=?',actor.agentId,scope,operationId);
   if(prior){if(prior.kind!==kind||prior.payloadHash!==recursiveHash(operationPayload))throw Error('operation_payload_conflict');if(!prior.responseJson)throw Error('operation_uncertain');return JSON.parse(prior.responseJson);}
   if(actor.runId)this.guard(actor);const key=id('op');this.insertOperation(key,actor.agentId,scope,operationId,kind,operationPayload,'accepted',{inputMessageId:actor.inputMessageId??null,threadId:actor.threadId??null,turnId:actor.turnId??null});
   const response={...write(key),operationKey:key};this.lifecycle?.operationConfirmed?.(actor,key,kind,response);
   this.sql('UPDATE operations SET responseJson=?,state=?,revision=revision+1 WHERE id=?',json(response),response.state==='requested'?state==='confirmed'?'accepted':state:state,key);return response;
  });
 }
 pendingMutation<T extends Record<string,unknown>>(actor:Actor,operationId:string,kind:'pending_add'|'pending_update',payload:unknown,write:()=>T){this.requirePendingActor(actor);return this.mutation(actor,'pending_items',operationId,kind,payload,write);}
 private details(key:string,patch:Record<string,unknown>){const op=this.operation(key);this.sql('UPDATE operations SET detailsJson=? WHERE id=?',json({...JSON.parse(op.detailsJson),...patch}),key);}
 operation(key:string):Operation{const op=this.one<Operation>('SELECT * FROM operations WHERE id=?',key);if(!op)throw Error('operation_not_found');return op;}
 inspectOperation(actor:Actor,operationId:string,scopeId?:string){this.requireMain(actor);text(operationId,500);const rows=this.all<Operation>('SELECT * FROM operations WHERE actorAgentId=? AND operationId=?'+(scopeId?' AND scopeId=?':'')+' ORDER BY rowid LIMIT 21',actor.agentId,operationId,...(scopeId?[scopeId]:[]));return {operations:rows.slice(0,20).map(({payloadHash:_hash,responseJson,detailsJson,...op})=>({...op,response:responseJson?JSON.parse(responseJson):null,details:JSON.parse(detailsJson)})),truncated:rows.length>20};}
 operationsForInput(actor:Actor,messageId:string){this.requireMain(actor);return this.all<Operation>("SELECT * FROM operations WHERE actorAgentId=? AND json_extract(detailsJson,'$.inputMessageId')=? ORDER BY rowid",actor.agentId,messageId).map(({responseJson,detailsJson,...op})=>({...op,response:responseJson?JSON.parse(responseJson):null,details:JSON.parse(detailsJson)}));}
 private creationSource(actor:Actor,authority:Authority){
  const sources=[...new Set([authority.sourceRequestId,...(authority.sourceRequestIds??[])])];
  if(actor.sourceRequestId){if(!sources.includes(actor.sourceRequestId))throw Error('task_authority_source_denied');return;}
  const message=actor.inputMessageId?this.one<AgentMessage>("SELECT m.* FROM agent_messages m JOIN agent_receipts r ON r.messageId=m.id WHERE m.id=? AND m.recipientAgentId=? AND m.senderAgentId='host' AND r.recipientAgentId=m.recipientAgentId AND r.state IN ('offered','received')",actor.inputMessageId,actor.agentId):undefined;
  if(!message?.taskId||!message.taskVersion||!['task_archived','worker_reply','interaction_required'].includes(message.kind))throw Error('task_authority_source_denied');
  const task=this.task(message.taskId);if(message.taskVersion!==task.headVersion||task.controlState!=='normal')throw Error('task_authority_source_denied');
  const origin=this.authority(message.taskId,message.taskVersion),allowed=[origin.sourceRequestId,...(origin.sourceRequestIds??[])],later=sources.filter(source=>!allowed.includes(source));
  if(message.kind==='task_archived'){
   if(task.state!=='settled'||task.historyState!=='archived'||later.length)throw Error('task_authority_source_denied');
  }else{
   if(task.historyState!=='visible'||task.state==='paused'||task.outcome==='cancelled'||task.state!=='open'&&!later.length)throw Error('task_authority_source_denied');
   const currentSources=[...new Set([...allowed,this.version(task.id,task.headVersion).sourceRequestId])];
   if(later.some(source=>!authority.sourceRequestIds?.includes(source)||!this.pending.hasLaterTaskSource(actor,task.id,source,currentSources)))throw Error('task_authority_source_denied');
  }
  if(authority.materials.some(material=>!origin.materials.includes(material))||allowed.includes(authority.sourceRequestId)&&(authority.attachments??[]).some(attachment=>!origin.attachments?.includes(attachment)))throw Error('task_authority_source_denied');
 }
 createTask(actor:Actor,input:{operationId:string;goal:string;notes?:string;title?:string;workingDirectory?:string;resultIds?:string[];authority:Authority}){
  this.requireMain(actor);return this.mutation(actor,'tasks',input.operationId,'task_create',input,key=>{
   let authority=input.authority;this.validateAuthority(actor,authority);
   if(input.resultIds!==undefined){
    if(!Array.isArray(input.resultIds)||input.resultIds.length>50||new Set(input.resultIds).size!==input.resultIds.length)throw Error('task_authority_input_denied');
    const sources=[authority.sourceRequestId,...(authority.sourceRequestIds??[])];
    for(const resultId of input.resultIds){const result=this.result(resultId);if(result.state!=='accepted'||!actor.sourceRequestId&&!this.resultGranted(result,authority))throw Error('task_authority_input_denied');this.actualResult(result);
     const origin=this.authority(result.taskId,result.version);sources.push(origin.sourceRequestId,...(origin.sourceRequestIds??[]));
    }
    authority={...authority,sourceRequestIds:[...new Set(sources)]};this.validateAuthority(actor,authority);
   }
   text(input.goal);if(typeof (input.notes??'')!=='string'||(input.notes??'').length>24000)throw Error('task_invalid_input');
   this.creationSource(actor,authority);
   const taskId=id('task'),now=Date.now(),title=input.title??input.goal.split('\n')[0]!.slice(0,200);text(title,200);
   this.sql("INSERT INTO tasks VALUES(?,?,1,?,'open',NULL,1,'normal','visible',?,?,NULL)",taskId,title,input.notes??'',now,now);
   this.sql('INSERT INTO task_versions VALUES(?,1,?,?,?,?,?)',taskId,input.goal,json(authority),actor.sourceRequestId??authority.sourceRequestId,key,directory(input.workingDirectory??this.files.workspace));
   return {taskId,version:1,revision:1,state:'open'};
  });
 }
 listTasks(actor:Actor,query:{state?:Task['state'];includeArchived?:boolean;threadId?:string;cursor?:string;limit?:number}={}){
  this.requireMain(actor);const limit=query.limit??20;if(!Number.isSafeInteger(limit)||limit<1||limit>80||query.state&&!['open','paused','settled'].includes(query.state)||query.cursor!==undefined&&!/^\d+$/.test(query.cursor))throw Error('task_query_invalid');
  const rows=this.all<Task&{position:number}>(`SELECT t.*,t.rowid position FROM tasks t WHERE t.rowid>?${query.includeArchived?'':" AND t.historyState='visible'"}${query.state?' AND t.state=?':''}${query.threadId?' AND EXISTS(SELECT 1 FROM runs r WHERE r.taskId=t.id AND r.threadId=?)':''} ORDER BY t.rowid LIMIT ?`,Number(query.cursor??0),...(query.state?[query.state]:[]),...(query.threadId?[query.threadId]:[]),limit+1);
  return {tasks:rows.slice(0,limit).map(({position:_position,...task})=>task),nextCursor:rows.length>limit?String(rows[limit-1]!.position):null};
 }
 readTask(actor:Actor,taskId:string){
  this.readAllowed(actor,taskId);const task=this.task(taskId),version=this.version(taskId,task.headVersion);
  const sourceRequestIds=this.all<{sourceRequestId:string}>("SELECT sourceRequestId FROM task_versions WHERE taskId=? UNION SELECT json_extract(authorityJson,'$.sourceRequestId') FROM task_versions WHERE taskId=? UNION SELECT s.value sourceRequestId FROM task_versions v,json_each(v.authorityJson,'$.sourceRequestIds') s WHERE v.taskId=?",taskId,taskId,taskId).map(row=>row.sourceRequestId);
  const current=this.workers(taskId),summaries=this.runSummaries(current.map(worker=>worker.run),current.map(worker=>worker.run.id)),workers=current.map((worker,index)=>({...worker,run:summaries[index]!}));
  const results=this.all<Pick<Result,'id'|'taskId'|'version'|'runId'|'messageId'|'kind'|'state'>>('SELECT id,taskId,version,runId,messageId,kind,state FROM results WHERE taskId=? ORDER BY rowid',taskId);
  const deliveries=this.all<Pick<Delivery,'id'|'taskId'|'version'|'state'|'historyMessageId'|'revision'>>('SELECT id,taskId,version,state,historyMessageId,revision FROM deliveries WHERE taskId=? ORDER BY rowid',taskId);
  return {task,version,goal:version.goal,sourceRequestIds,workers,results,deliveries};
 }
 updateTask(actor:Actor,input:TaskMutation&{patch:{goal?:string;notes?:string};authority?:Authority}){
  this.requireMain(actor);return this.mutation(actor,input.taskId,input.operationId,'task_update',input,key=>{
   const task=this.check(actor,input);const patch=input.patch;if(!patch||!Object.keys(patch).length||Object.keys(patch).some(key=>!['goal','notes'].includes(key)))throw Error('task_invalid_patch');
   if(patch.notes!==undefined&&(typeof patch.notes!=='string'||patch.notes.length>24000))throw Error('task_invalid_patch');if(task.historyState!=='visible')throw Error('task_history_not_visible');let version=task.headVersion,targets:string[]=[];
   if(patch.goal!==undefined){this.writable(task);text(patch.goal);if(!input.authority)throw Error('task_authority_source_denied');this.validateAuthority(actor,input.authority);if(!actor.sourceRequestId||![input.authority.sourceRequestId,...(input.authority.sourceRequestIds??[])].includes(actor.sourceRequestId))throw Error('task_authority_source_denied');this.trustedSource(actor,actor.sourceRequestId);
    version++;this.sql('INSERT INTO task_versions VALUES(?,?,?,?,?,?,?)',task.id,version,patch.goal,json(input.authority),actor.sourceRequestId,key,this.version(task.id,task.headVersion).workingDirectory);
    targets=this.requestStops(task.id,'requirements_changed');this.revokePrepared(task.id);
    this.sql("UPDATE agent_receipts SET state='rejected',revision=revision+1 WHERE messageId IN (SELECT id FROM agent_messages WHERE taskId=? AND kind='worker_input' AND taskVersion<>?) AND state='pending'",task.id,version);
   }
   this.sql('UPDATE tasks SET headVersion=?,notes=?,revision=revision+1,updatedAt=?,controlState=? WHERE id=?',version,patch.notes??task.notes,Date.now(),patch.goal!==undefined?(targets.length?'stopping':'normal'):task.controlState,task.id);
   this.details(key,{action:'update',taskId:task.id,version,runIds:targets});return {taskId:task.id,version,revision:task.revision+1,state:targets.length?'requested':'updated',targets};
  });
 }
 private activeRun(workerId:string){return this.one<TaskRun>("SELECT * FROM runs WHERE workerId=? AND (status IN ('queued','running') OR phase='uncertain') ORDER BY rowid DESC LIMIT 1",workerId);}
 private message(actor:Actor,key:string,to:string,taskId:string,version:number,kind:string,payload:unknown,target:string|null=null){
  const messageId=id('message');this.sql('INSERT INTO agent_messages(id,senderAgentId,senderRunId,senderEpoch,recipientAgentId,taskId,taskVersion,targetRunId,kind,operationKey,payloadJson) VALUES(?,?,?,?,?,?,?,?,?,?,?)',messageId,actor.agentId,actor.runId??null,actor.epoch??null,to,taskId,version,target,kind,key,json(payload));
  this.sql("INSERT INTO agent_receipts(messageId,recipientAgentId,state) VALUES(?,?,'pending')",messageId,to);return messageId;
 }
 private notify(task:Task,kind:string,payload:unknown){const key=id('op');this.insertOperation(key,'host',task.id,key,'notify',{},'confirmed');return this.message({agentId:'host'},key,this.store.meta('mainAgentId')!,task.id,task.headVersion,kind,payload);}
 private newRun(task:Task,workerId:string,messageIds:string[],replace:string|null=null,workingDirectory?:string,resultIds?:string[]){
  const runId=this.store.run(workerId)?id('run'):workerId,version=this.version(task.id,task.headVersion),authority=this.authority(task.id,task.headVersion),previous=this.one<TaskRun>('SELECT * FROM runs WHERE workerId=? ORDER BY rowid DESC LIMIT 1',workerId);
  if(this.activeRun(workerId))throw Error('worker_busy');
  if(this.one("SELECT 1 FROM operations WHERE kind='worker_steer' AND json_extract(detailsJson,'$.workerId')=? AND state IN ('accepted','dispatching','uncertain')",workerId))throw Error('operation_uncertain');
  if(previous&&(this.exitUnconfirmed(previous)||this.store.meta('lease:'+previous.id)||this.lifecycle?.reviewExitConfirmed?.(previous)===false))throw Error('run_stop_unconfirmed');
  const prompt=messageIds.map(messageId=>{const message=this.one<AgentMessage>('SELECT * FROM agent_messages WHERE id=?',messageId)!;if(message.taskId!==task.id||message.taskVersion!==task.headVersion||message.recipientAgentId!==recipient(workerId))throw Error('message_target_stale');return JSON.parse(message.payloadJson).text;}).join('\n\n');
  const cwd=directory(workingDirectory??previous?.workingDirectory??version.workingDirectory);
  this.sql("INSERT INTO runs(id,taskId,workerId,version,sourceRequestId,goal,prompt,status,phase,epoch,threadId,checkpointJson,replacesRunId,workingDirectory,createdAt) VALUES(?,?,?,?,?,?,?,'queued','ready',?,?,?,?,?,?)",runId,task.id,workerId,task.headVersion,authority.sourceRequestId,version.goal,prompt,previous?previous.epoch+1:0,previous?.threadId??null,json({resultIds:(resultIds??JSON.parse(previous?.checkpointJson??'{}').resultIds??[]).filter((resultId:string)=>this.resultGranted(this.result(resultId),authority))}),replace,cwd,Date.now());
  this.sql('INSERT INTO worker_authorities VALUES(?,?,?)',runId,authority.sourceRequestId,authority.description);
  for(const messageId of messageIds)this.sql('UPDATE agent_messages SET targetRunId=? WHERE id=?',runId,messageId);return runId;
 }
 workerOpen(actor:Actor,input:{operationId:string;taskId:string;text:string;workingDirectory?:string;resultIds?:string[]}){
  this.requireMain(actor);return this.mutation(actor,input.taskId,input.operationId,'worker_open',input,key=>{
   const task=this.task(input.taskId);this.writable(task);text(input.text);const authority=this.authority(task.id,task.headVersion);this.validateAuthority(actor,authority);
   if(input.resultIds!==undefined){if(!Array.isArray(input.resultIds)||input.resultIds.length>50||new Set(input.resultIds).size!==input.resultIds.length)throw Error('task_authority_input_denied');for(const resultId of input.resultIds){const result=this.result(resultId);if(!this.resultGranted(result,authority))throw Error('task_authority_input_denied');this.actualResult(result);}}
   const workerId=id('run'),messageId=this.message(actor,key,recipient(workerId),task.id,task.headVersion,'worker_input',{workerId,text:input.text});
   const runId=this.newRun(task,workerId,[messageId],null,input.workingDirectory,input.resultIds);return {taskId:task.id,workerId,runId,messageId,state:'queued'};
  });
 }
 workerSend(actor:Actor,input:{operationId:string;workerId:string;text:string;immediate?:boolean}){
  this.requireMain(actor);const worker=this.worker(input.workerId);
  return this.mutation(actor,worker.taskId,input.operationId,input.immediate?'worker_steer':'worker_send',input,key=>{
   const task=this.task(worker.taskId);this.writable(task);text(input.text);this.validateAuthority(actor,this.authority(task.id,task.headVersion));const current=this.activeRun(worker.workerId);
   if(this.one("SELECT 1 FROM operations WHERE scopeId=? AND id<>? AND kind='worker_steer' AND json_extract(detailsJson,'$.workerId')=? AND state IN ('accepted','dispatching','uncertain')",task.id,key,worker.workerId))throw Error('operation_uncertain');
   if(input.immediate){
    if(!current||current.status!=='running'||current.phase!=='executing'||current.version!==task.headVersion||!current.threadId||!current.turnId||current.stopRequestedAt)throw Error('worker_steer_not_applicable');
    if(this.one("SELECT 1 FROM operations WHERE scopeId=? AND id<>? AND kind='worker_steer' AND json_extract(detailsJson,'$.workerId')=? AND state IN ('accepted','dispatching','uncertain')",task.id,key,worker.workerId))throw Error('operation_uncertain');
    const messageId=this.message(actor,key,recipient(worker.workerId),task.id,current.version,'worker_input',{workerId:worker.workerId,text:input.text},current.id);
    this.details(key,{workerId:worker.workerId,runId:current.id,epoch:current.epoch,threadId:current.threadId,expectedTurnId:current.turnId,messageId});
    return {taskId:task.id,workerId:worker.workerId,runId:current.id,messageId,state:'requested',threadId:current.threadId,expectedTurnId:current.turnId};
   }
   const messageId=this.message(actor,key,recipient(worker.workerId),task.id,task.headVersion,'worker_input',{workerId:worker.workerId,text:input.text});
   let runId:string|null=null;
   if(!current){const pending=this.pendingWorkerMessages(worker.workerId,task.headVersion);runId=this.newRun(task,worker.workerId,pending.map(row=>row.id),worker.run.status==='interrupted'?worker.run.id:null);}
   return {taskId:task.id,workerId:worker.workerId,runId,messageId,state:'queued'};
  },input.immediate?'accepted':'confirmed');
 }
 private pendingWorkerMessages(workerId:string,version:number){return this.all<AgentMessage>("SELECT m.* FROM agent_messages m JOIN agent_receipts r ON r.messageId=m.id WHERE m.recipientAgentId=? AND m.kind='worker_input' AND m.targetRunId IS NULL AND m.taskVersion=? AND r.state='pending' ORDER BY m.seq",recipient(workerId),version);}
 workerRead(actor:Actor,input:{workerId:string;after?:number;limit?:number;messageId?:string;itemId?:string;offset?:number}){
  const worker=this.worker(input.workerId);this.readAllowed(actor,worker.taskId);if(actor.runId&&this.run(actor.runId).workerId!==input.workerId)throw Error('agent_scope_denied');
  const offset=input.offset??0;if(!Number.isSafeInteger(offset)||offset<0)throw Error('message_offset_invalid');if(input.itemId!==undefined){text(input.itemId,200);if(!input.messageId)throw Error('worker_query_invalid');}
  type PageRow=Omit<AgentMessage,'payloadJson'>&{metadataJson:string;nativeMessagesJson:string;text:string;textLength:number};
  const body=input.itemId?"(SELECT json_extract(value,'$.text') FROM json_each(payloadJson,'$.messages') WHERE json_extract(value,'$.itemId')=?)":"json_extract(payloadJson,'$.text')";
  const fields=`seq,id,senderAgentId,senderRunId,senderEpoch,recipientAgentId,taskId,taskVersion,targetRunId,kind,replyTo,causationId,operationKey,json_remove(payloadJson,'$.text','$.messages') metadataJson,(SELECT json_group_array(json_object('itemId',json_extract(value,'$.itemId'),'phase',json_extract(value,'$.phase'),'characters',length(json_extract(value,'$.text')))) FROM json_each(payloadJson,'$.messages')) nativeMessagesJson,substr(coalesce(${body},''),?,24000) text,length(coalesce(${body},'')) textLength`;
  const page=({metadataJson,nativeMessagesJson,text,textLength,...row}:PageRow)=>({...row,payload:{...JSON.parse(metadataJson),text},nativeMessages:JSON.parse(nativeMessagesJson) as {itemId:string;phase:string|null;characters:number}[],...(input.itemId?{itemId:input.itemId}:{}),text,offset,nextOffset:offset+24000<textLength?offset+24000:null});
  if(input.messageId){const row=this.one<PageRow>(`SELECT ${fields} FROM agent_messages WHERE id=? AND taskId=? AND json_extract(payloadJson,'$.workerId')=?${input.itemId?" AND EXISTS(SELECT 1 FROM json_each(payloadJson,'$.messages') WHERE json_extract(value,'$.itemId')=?)":''}`,...(input.itemId?[input.itemId]:[]),offset+1,...(input.itemId?[input.itemId]:[]),input.messageId,worker.taskId,worker.workerId,...(input.itemId?[input.itemId]:[]));if(!row)throw Error('message_not_found');return {workerId:worker.workerId,taskId:worker.taskId,threadId:worker.threadId,runs:[],messages:[page(row)],nextCursor:null};}
  const after=input.after??0,limit=input.limit??20;if(!Number.isSafeInteger(after)||after<0||!Number.isSafeInteger(limit)||limit<1||limit>50)throw Error('worker_query_invalid');
  const rows=this.all<PageRow>(`SELECT ${fields} FROM agent_messages WHERE taskId=? AND seq>? AND (recipientAgentId=? OR senderRunId IN (SELECT id FROM runs WHERE workerId=?)) ORDER BY seq LIMIT ?`,offset+1,worker.taskId,after,recipient(worker.workerId),worker.workerId,limit+1);
  const runIds=[...new Set([worker.run.id,...rows.slice(0,limit).flatMap(row=>[row.senderRunId,row.targetRunId].filter((value):value is string=>!!value))])];
  return {workerId:worker.workerId,taskId:worker.taskId,threadId:worker.threadId,runs:this.runSummaries(runIds.map(runId=>this.run(runId)),[worker.run.id]),messages:rows.slice(0,limit).map(page),nextCursor:rows.length>limit?rows[limit-1]!.seq:null};
 }
 workingDirectory(runId:string){return this.run(runId).workingDirectory;}
 selectWorkingDirectory(actor:Actor,path:string){this.guard(actor);directory(path);this.sql('UPDATE runs SET workingDirectory=? WHERE id=?',path,actor.runId!);return path;}
 private canClaim(run:TaskRun){const task=this.task(run.taskId);return run.status==='queued'&&!run.stopRequestedAt&&task.state==='open'&&task.controlState==='normal'&&task.historyState==='visible'&&run.version===task.headVersion;}
 claim(runId?:string):TaskRun|undefined{
  return this.store.transaction(()=>{
   let run=runId?this.run(runId):this.all<TaskRun>("SELECT * FROM runs WHERE status='queued' ORDER BY createdAt,rowid").find(row=>this.canClaim(row));
   if(!run&&!runId){next:for(const task of this.tasks().filter(task=>task.state==='open'&&task.controlState==='normal'&&task.historyState==='visible'))for(const worker of this.workers(task.id)){
    if(this.activeRun(worker.workerId)||this.one("SELECT 1 FROM operations WHERE kind='worker_steer' AND json_extract(detailsJson,'$.workerId')=? AND state IN ('accepted','dispatching','uncertain')",worker.workerId))continue;const pending=this.pendingWorkerMessages(worker.workerId,task.headVersion);if(!pending.length)continue;
    if(this.exitUnconfirmed(worker.run)||this.store.meta('lease:'+worker.run.id)||this.lifecycle?.reviewExitConfirmed?.(worker.run)===false)continue;
    run=this.run(this.newRun(task,worker.workerId,pending.map(row=>row.id),worker.run.status==='interrupted'?worker.run.id:null));break next;
   }}
   if(!run||!this.canClaim(run))return;this.trustedSource({agentId:this.store.meta('mainAgentId')!,threadId:this.store.meta('mainThread')},run.sourceRequestId);
   this.sql("UPDATE runs SET status='running',phase='starting',startedAt=coalesce(startedAt,?),checkpointJson=json_remove(coalesce(checkpointJson,'{}'),'$.workerExitConfirmed'),stateRevision=stateRevision+1 WHERE id=?",Date.now(),run.id);
   this.sql("UPDATE agent_receipts SET state='offered',offeredRunId=?,offeredEpoch=?,revision=revision+1 WHERE state='pending' AND messageId IN (SELECT id FROM agent_messages WHERE targetRunId=? AND recipientAgentId=?)",run.id,run.epoch,run.id,recipient(run.workerId));return this.run(run.id);
  });
 }
 bind(runId:string,epoch:number,threadId:string,turnId:string){
  this.store.transaction(()=>{const run=this.run(runId);if(run.epoch!==epoch||run.phase!=='starting'||run.stopRequestedAt||!this.canStart(run))throw Error('run_epoch_or_phase_conflict');text(threadId,200);text(turnId,200);
   if(run.threadId&&run.threadId!==threadId||this.one('SELECT 1 FROM runs WHERE threadId=? AND workerId<>? LIMIT 1',threadId,run.workerId))throw Error('worker_thread_conflict');
   this.sql("UPDATE runs SET threadId=?,turnId=?,phase='executing',stateRevision=stateRevision+1,checkpointJson=json_set(coalesce(checkpointJson,'{}'),'$.executionAcknowledged',1) WHERE id=?",threadId,turnId,run.id);
   this.sql("UPDATE agent_receipts SET state='received',offeredTurnId=?,revision=revision+1 WHERE offeredRunId=? AND offeredEpoch=? AND state='offered'",turnId,run.id,epoch);
  });
 }
 private canStart(run:TaskRun){const task=this.task(run.taskId);return task.state==='open'&&task.controlState==='normal'&&task.historyState==='visible'&&task.headVersion===run.version;}
 rpc(runId:string,epoch:number,waiting:boolean){const run=this.run(runId);if(run.epoch!==epoch||run.status!=='running'||run.stopRequestedAt)throw Error('run_epoch_stale');if(!['executing','rpc_wait'].includes(run.phase))throw Error('run_phase_denied');this.sql('UPDATE runs SET phase=?,stateRevision=stateRevision+1 WHERE id=?',waiting?'rpc_wait':'executing',run.id);}
 charge(runId:string,epoch:number,ms:number){const run=this.run(runId);if(run.epoch===epoch&&Number.isFinite(ms)&&ms>=0)this.sql('UPDATE runs SET activeMs=activeMs+? WHERE id=?',ms,runId);}
 markSteer(operationKey:string,state:'dispatching'|'received'|'failed'|'uncertain'){
  this.store.transaction(()=>{const op=this.operation(operationKey);if(op.kind!=='worker_steer')throw Error('operation_kind_conflict');if(['confirmed','cancelled','failed'].includes(op.state))return;const details=JSON.parse(op.detailsJson),run=this.run(details.runId);
   if(state==='received'&&(run.epoch!==details.epoch||run.turnId!==details.expectedTurnId||run.threadId!==details.threadId||run.stopRequestedAt))throw Error('message_target_stale');
   this.details(operationKey,{rpcState:state});this.sql('UPDATE operations SET state=?,revision=revision+1 WHERE id=?',state==='received'?'confirmed':state,operationKey);
   if(state==='received')this.sql("UPDATE agent_receipts SET state='processed',processedBy=?,revision=revision+1 WHERE messageId=?",run.id,details.messageId);
   if(state==='failed')this.sql("UPDATE agent_receipts SET state='rejected',revision=revision+1 WHERE messageId=? AND state NOT IN ('processed','rejected')",details.messageId);
   if(state==='uncertain')this.sql("UPDATE runs SET phase='uncertain',stateRevision=stateRevision+1 WHERE id=?",run.id);
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
  this.sql("UPDATE agent_receipts SET state='processed',processedBy=?,revision=revision+1 WHERE offeredRunId=? AND state IN ('offered','received')",run.id,run.id);return response;
 }
 endSegment(runId:string,epoch:number,terminal:TurnResult,engineClosed:boolean){return this.store.transaction(()=>{
  const run=this.run(runId);if(run.epoch!==epoch||run.stopRequestedAt)return;if(!active(run))return this.one<Operation>("SELECT * FROM operations WHERE scopeId=? AND kind='worker_return' AND json_extract(responseJson,'$.messageId') IN (SELECT id FROM agent_messages WHERE senderRunId=?) ORDER BY rowid DESC LIMIT 1",run.taskId,run.id)?.responseJson?JSON.parse(this.one<Operation>("SELECT * FROM operations WHERE scopeId=? AND kind='worker_return' AND json_extract(responseJson,'$.messageId') IN (SELECT id FROM agent_messages WHERE senderRunId=?) ORDER BY rowid DESC LIMIT 1",run.taskId,run.id)!.responseJson!):undefined;
  const response=this.saveReturn(run,terminal,engineClosed),status=engineClosed?(terminal.status==='completed'?'succeeded':terminal.status==='failed'?'failed':'interrupted'):'interrupted';
  this.sql('UPDATE runs SET status=?,phase=?,endedAt=?,errorCode=?,stateRevision=stateRevision+1 WHERE id=?',status,engineClosed?'ended':'uncertain',Date.now(),terminal.errorCode??(engineClosed?null:'engine_stop_unconfirmed'),run.id);if(engineClosed)this.sql("UPDATE runs SET checkpointJson=json_set(coalesce(checkpointJson,'{}'),'$.workerExitConfirmed',1) WHERE id=?",run.id);this.cancelInteractions(run.id,'worker_turn_ended');return response;
 });}
 failRun(runId:string,epoch:number,code:string,uncertain=false){return this.endSegment(runId,epoch,{status:'failed',text:'',errorCode:code},!uncertain);}
 private cancelInteractions(runId:string,code:string){if(this.table('worker_interactions'))this.sql("UPDATE worker_interactions SET state='cancelled',code=?,updatedAt=? WHERE runId=? AND state IN ('pending_main','pending_user')",code,Date.now(),runId);}
 private exitUnconfirmed(run:TaskRun){return run.phase==='uncertain'||run.startedAt!==null&&JSON.parse(run.checkpointJson??'{}').workerExitConfirmed!==1;}
 confirmWorkerExit(runId:string,expectedLease:string|undefined){return this.store.transaction(()=>{const key='lease:'+runId,actual=this.store.meta(key);if(actual!==expectedLease)return actual===undefined&&JSON.parse(this.run(runId).checkpointJson??'{}').workerExitConfirmed===1;this.sql("UPDATE runs SET checkpointJson=json_set(coalesce(checkpointJson,'{}'),'$.workerExitConfirmed',1),phase=CASE WHEN status NOT IN ('queued','running') THEN 'ended' ELSE phase END,stateRevision=stateRevision+1 WHERE id=?",runId);if(actual!==undefined)this.sql('DELETE FROM meta WHERE key=?',key);return true;});}
 interruptWorker(runId:string){const run=this.run(runId);if(!['queued','running'].includes(run.status)||run.stopRequestedAt)return;const checkpoint=JSON.parse(run.checkpointJson??'{}'),closed=checkpoint.workerExitConfirmed===1||run.status==='queued'&&run.startedAt===null&&!this.store.meta('lease:'+run.id);const result=this.endSegment(run.id,run.epoch,checkpoint.workerTerminal??{status:'unconfirmed',text:'',errorCode:'restart_unconfirmed'},closed);this.sql('UPDATE runs SET epoch=epoch+1,stateRevision=stateRevision+1 WHERE id=?',run.id);return result;}
 reconcile(pauseOldWork=false){for(const run of this.runs())if(['queued','running'].includes(run.status))this.interruptWorker(run.id);this.store.transaction(()=>{this.sql("UPDATE deliveries SET state='uncertain',revision=revision+1 WHERE state='submitting'");if(!pauseOldWork){this.sql("UPDATE agent_receipts SET state='uncertain',revision=revision+1 WHERE state IN ('offered','received')");this.sql("UPDATE operations SET state='uncertain',revision=revision+1 WHERE state='dispatching'");}});}
 private requestStops(taskId:string,reason:string,workerId?:string){
  const runs=this.runs(taskId,workerId).filter(active);for(const run of runs){
   this.sql("UPDATE runs SET stopRequestedAt=coalesce(stopRequestedAt,?),stopReason=?,epoch=epoch+1,checkpointJson=json_set(coalesce(checkpointJson,'{}'),'$.outputEpoch',coalesce(json_extract(checkpointJson,'$.outputEpoch'),?)),stateRevision=stateRevision+1 WHERE id=?",Date.now(),reason,run.epoch,run.id);this.cancelInteractions(run.id,'worker_stopped');
  }return runs.map(run=>run.id);
 }
 workerStop(actor:Actor,input:{operationId:string;workerId:string;reason?:string}){
  this.requireMain(actor);const worker=this.worker(input.workerId);return this.mutation(actor,worker.taskId,input.operationId,'worker_stop',input,key=>{
   const targets=this.requestStops(worker.taskId,input.reason??'worker_interrupted',worker.workerId);this.details(key,{action:'worker_stop',taskId:worker.taskId,workerId:worker.workerId,runIds:targets});return {taskId:worker.taskId,workerId:worker.workerId,state:targets.length?'requested':'confirmed',targets};
  });
 }
 private unresolved(taskId:string,except=''){
  return this.one<Operation>("SELECT * FROM operations WHERE scopeId=? AND id<>? AND state IN ('accepted','dispatching','uncertain') LIMIT 1",taskId,except)||this.one<Delivery>("SELECT * FROM deliveries WHERE taskId=? AND state IN ('submitting','uncertain') LIMIT 1",taskId);
 }
 private revokePrepared(taskId:string){this.sql("UPDATE deliveries SET state='revoked',revokedAt=?,revision=revision+1 WHERE taskId=? AND state='prepared'",Date.now(),taskId);}
 controlTask(actor:Actor,input:TaskMutation&{action:'pause'|'resume'|'cancel';reason?:string}){
  this.requireMain(actor);return this.mutation(actor,input.taskId,input.operationId,'task_control',input,key=>{
   const task=this.check(actor,input);if(task.historyState!=='visible')throw Error('task_history_not_visible');if(!['pause','resume','cancel'].includes(input.action))throw Error('task_action_invalid');
   if(input.action==='resume'){
    if(task.state!=='paused'||task.controlState!=='normal'||this.runs(task.id).some(run=>active(run)||this.exitUnconfirmed(run))||this.unresolved(task.id,key))throw Error('task_resume_unconfirmed');
    this.sql("UPDATE tasks SET state='open',outcome=NULL,revision=revision+1,updatedAt=? WHERE id=?",Date.now(),task.id);return {taskId:task.id,state:'open',targets:[]};
   }
   if(task.state==='settled')throw Error('task_terminal');if(task.controlState!=='normal')throw Error('task_stop_requested');
   if(input.action==='cancel')this.revokePrepared(task.id);
   const targets=this.requestStops(task.id,input.reason??input.action);this.details(key,{action:input.action,taskId:task.id,runIds:targets});
   if(targets.length)this.sql("UPDATE tasks SET controlState='stopping',revision=revision+1,updatedAt=? WHERE id=?",Date.now(),task.id);
   else this.sql('UPDATE tasks SET state=?,outcome=?,controlState=\'normal\',settledAt=?,revision=revision+1,updatedAt=? WHERE id=?',input.action==='pause'?'paused':'settled',input.action==='cancel'?'cancelled':null,input.action==='cancel'?Date.now():null,Date.now(),task.id);
   if(!targets.length&&input.action==='cancel')this.sql("UPDATE agent_receipts SET state='rejected',revision=revision+1 WHERE state='pending' AND messageId IN (SELECT id FROM agent_messages WHERE taskId=? AND kind='worker_input')",task.id);
   return {taskId:task.id,state:targets.length?'requested':input.action==='pause'?'paused':'settled',targets};
  });
 }
 confirmStop(operationKey:string,confirmed:boolean){return this.store.transaction(()=>{
  const op=this.operation(operationKey),details=JSON.parse(op.detailsJson);if(!['worker_stop','task_control','task_update'].includes(op.kind))throw Error('operation_kind_conflict');if(op.state==='confirmed')return JSON.parse(op.responseJson!);
  const runs=(details.runIds??[]).map((runId:string)=>this.run(runId)) as TaskRun[];
  if(confirmed&&runs.some(run=>this.store.meta('lease:'+run.id)||run.startedAt!==null&&JSON.parse(run.checkpointJson??'{}').workerExitConfirmed!==1||this.lifecycle?.reviewExitConfirmed?.(run)===false))throw Error('run_stop_unconfirmed');
  for(const run of runs){const checkpoint=JSON.parse(run.checkpointJson??'{}');this.saveReturn(run,checkpoint.workerTerminal??{status:'interrupted',text:'',errorCode:'worker_stopped'},confirmed);
   this.sql("UPDATE runs SET status=?,phase=?,endedAt=?,checkpointJson=json_set(coalesce(checkpointJson,'{}'),'$.workerExitConfirmed',?),stateRevision=stateRevision+1 WHERE id=?",confirmed?'cancelled':'interrupted',confirmed?'ended':'uncertain',Date.now(),confirmed?1:0,run.id);
   if(confirmed){this.sql("UPDATE operations SET state='cancelled',revision=revision+1 WHERE kind='worker_steer' AND state IN ('accepted','dispatching','uncertain') AND json_extract(detailsJson,'$.runId')=?",run.id);this.sql("UPDATE agent_receipts SET state='rejected',revision=revision+1 WHERE messageId IN (SELECT id FROM agent_messages WHERE targetRunId=? AND kind='worker_input') AND state IN ('pending','offered','received','uncertain')",run.id);}
  }
  if(confirmed&&op.kind!=='worker_stop'){
   const state=details.action==='pause'?'paused':details.action==='cancel'?'settled':'open';this.sql("UPDATE tasks SET state=?,outcome=?,controlState='normal',settledAt=?,revision=revision+1,updatedAt=? WHERE id=?",state,details.action==='cancel'?'cancelled':null,details.action==='cancel'?Date.now():null,Date.now(),op.scopeId);
   if(details.action==='cancel')this.sql("UPDATE agent_receipts SET state='rejected',revision=revision+1 WHERE state='pending' AND messageId IN (SELECT id FROM agent_messages WHERE taskId=? AND kind='worker_input')",op.scopeId);
  }
  const response={...JSON.parse(op.responseJson??'{}'),state:confirmed?'confirmed':'uncertain'};this.sql('UPDATE operations SET state=?,responseJson=?,revision=revision+1 WHERE id=?',confirmed?'confirmed':'uncertain',json(response),op.id);return response;
 });}
 settleTask(actor:Actor,input:TaskMutation&{outcome:'succeeded'|'partial'|'failed';notes?:string}){
  this.requireMain(actor);return this.mutation(actor,input.taskId,input.operationId,'task_settle',input,key=>{
   const task=this.check(actor,input);this.writable(task);if(!['succeeded','partial','failed'].includes(input.outcome))throw Error('task_outcome_invalid');if(input.notes!==undefined&&(typeof input.notes!=='string'||input.notes.length>24000))throw Error('task_invalid_input');
   if(this.runs(task.id).some(run=>active(run)||this.exitUnconfirmed(run)||this.store.meta('lease:'+run.id)||this.lifecycle?.reviewExitConfirmed?.(run)===false))throw Error('run_stop_unconfirmed');if(this.unresolved(task.id,key))throw Error('operation_uncertain');
   this.sql("UPDATE tasks SET state='settled',outcome=?,notes=?,settledAt=?,updatedAt=?,revision=revision+1 WHERE id=?",input.outcome,input.notes??task.notes,Date.now(),Date.now(),task.id);return {taskId:task.id,version:task.headVersion,revision:task.revision+1,state:'settled',outcome:input.outcome};
  });
 }
 inbox(actor:Actor,after=0){this.actorTask(actor);return this.all<AgentMessage>("SELECT m.* FROM agent_messages m JOIN agent_receipts r ON r.messageId=m.id WHERE m.recipientAgentId=? AND r.state NOT IN ('processed','rejected') AND m.kind<>'user_input' AND (m.targetRunId IS NULL OR m.targetRunId=?) AND m.seq>? ORDER BY m.seq LIMIT 100",actor.agentId,actor.runId??null,after).map(row=>({...row,payload:JSON.parse(row.payloadJson)}));}
 receiveMainMessagesInTransaction(messageIds:string[],turnId:string){for(const messageId of messageIds)this.sql("UPDATE agent_receipts SET state='received',offeredTurnId=?,revision=revision+1 WHERE messageId=? AND recipientAgentId=? AND state='offered'",turnId,messageId,this.store.meta('mainAgentId')!);}
 completeMainMessagesInTransaction(messageIds:string[],turnId:string){for(const messageId of messageIds){
  if(this.one("SELECT 1 FROM operations WHERE actorAgentId=? AND json_extract(detailsJson,'$.inputMessageId')=? AND state IN ('accepted','dispatching','uncertain')",this.store.meta('mainAgentId')!,messageId))throw Error('coordination_operations_unresolved');
  this.sql("UPDATE agent_receipts SET state='processed',processedBy=?,revision=revision+1 WHERE messageId=? AND recipientAgentId=? AND state IN ('received','offered') AND offeredTurnId=?",turnId,messageId,this.store.meta('mainAgentId')!,turnId);
 }}
 queueInteraction(interactionId:string){if(!this.table('worker_interactions'))throw Error('interaction_not_found');const interaction=this.one<{runId:string;threadId:string;turnId:string;kind:string}>('SELECT runId,threadId,turnId,kind FROM worker_interactions WHERE id=?',interactionId);if(!interaction)throw Error('interaction_not_found');const run=this.run(interaction.runId),key='interaction:'+interactionId;if(this.one('SELECT 1 FROM operations WHERE id=?',key))return;this.insertOperation(key,'host',run.taskId,key,'interaction_notice',{},'confirmed');this.message({agentId:'host',runId:run.id,epoch:run.epoch},key,this.store.meta('mainAgentId')!,run.taskId,run.version,'interaction_required',{interactionId,runId:run.id,workerId:run.workerId,threadId:interaction.threadId,turnId:interaction.turnId});}
 private result(resultId:string):Result{const result=this.one<Result>('SELECT * FROM results WHERE id=?',resultId);if(!result)throw Error('result_not_found');return result;}
 private resultGranted(result:Result,authority:Authority){const origin=this.authority(result.taskId,result.version),sources=[authority.sourceRequestId,...(authority.sourceRequestIds??[])];return result.state==='accepted'&&[origin.sourceRequestId,...(origin.sourceRequestIds??[])].every(source=>sources.includes(source));}
 private resultPayload(result:Result){let payload:Record<string,any>;try{payload=JSON.parse(result.payloadJson);if(!payload||typeof payload!=='object'||Array.isArray(payload))throw Error();}catch{throw Error('artifact_source_invalid');}return payload;}
 private provenance(result:Result,payload:Record<string,any>){
  if(!Object.hasOwn(payload,'workspaceSource'))return;const source=payload.workspaceSource;
  if(!source||typeof source!=='object'||Array.isArray(source)||typeof source.path!=='string'||!isAbsolute(source.path)||typeof source.sha256!=='string'||!/^[a-f0-9]{64}$/.test(source.sha256))throw Error('artifact_source_invalid');
  const root=result.runId?this.run(result.runId).workingDirectory:this.version(result.taskId,result.version).workingDirectory,owned=result.runId?this.files.prepareRun(result.taskId,result.runId):null;if(!inside(root,source.path)&&!(owned&&inside(owned,source.path)))throw Error('artifact_path_denied');this.lifecycle?.validateFileRead?.(source.path);return source as {path:string;sha256:string};
 }
 private actualResult(result:Result){
  const payload=this.resultPayload(result);if(!result.filePath)return {id:result.id,version:result.version,payload,file:null};if(!result.sha256||!/^[a-f0-9]{64}$/.test(result.sha256))throw Error('artifact_version_unknown');
  const source=this.provenance(result,payload);this.lifecycle?.validateFileRead?.(result.filePath);const dir=this.files.prepareRun(result.taskId,result.runId??payload.storageRunId),verified=this.files.verify(dir,result.filePath);
  if(verified.sha256!==result.sha256)throw Error('result_hash_mismatch');const filename=typeof payload.filename==='string'&&basename(payload.filename)===payload.filename?payload.filename:basename(source?.path??result.filePath);
  return {id:result.id,version:result.version,payload,file:{...verified,filename}};
 }
 readResult(actor:Actor,resultId:string){const result=this.result(resultId);if(this.main(actor)){this.requireMain(actor);return this.actualResult(result);}return this.readResultInput(actor,resultId);}
 readResultInput(actor:Actor,resultId:string){this.guard(actor);const run=this.run(actor.runId!),result=this.result(resultId),grants=JSON.parse(run.checkpointJson??'{}').resultIds??[];
  if(!grants.includes(resultId)||!this.resultGranted(result,this.authority(run.taskId,run.version)))throw Error('task_authority_input_denied');return this.actualResult(result);
 }
 adoptResult(actor:Actor,input:{operationId:string;taskId:string;version:number;messageId?:string;runId?:string;filePath?:string}){
  this.requireMain(actor);return this.mutation(actor,input.taskId,input.operationId,'result_adopt',input,key=>{
   const task=this.task(input.taskId);if(task.historyState!=='visible'||task.controlState!=='normal')throw Error('task_history_not_visible');const version=this.version(task.id,input.version);if(!input.messageId&&!input.filePath)throw Error('result_source_required');
   const message=input.messageId?this.one<AgentMessage>("SELECT * FROM agent_messages WHERE id=? AND kind='worker_reply' AND taskId=? AND taskVersion=?",input.messageId,task.id,input.version):undefined;if(input.messageId&&!message)throw Error('result_source_denied');
   const runId=input.runId??message?.senderRunId??null;if(runId){const run=this.run(runId);if(run.taskId!==task.id||run.version!==input.version||message?.senderRunId&&message.senderRunId!==runId)throw Error('result_source_denied');}
   const resultId=id('result'),payload:Record<string,unknown>=message?{messageId:message.id,text:JSON.parse(message.payloadJson).text}:{};let filePath:string|null=null,sha256:string|null=null;
   if(input.filePath){const root=runId?this.run(runId).workingDirectory:version.workingDirectory,owned=runId?this.files.prepareRun(task.id,runId):null;const sourcePath=input.filePath;if(!isAbsolute(sourcePath)||realpathSync(sourcePath)!==sourcePath||!inside(root,sourcePath)&&!(owned&&inside(owned,sourcePath)))throw Error('artifact_path_denied');this.lifecycle?.validateFileRead?.(sourcePath);
    const fd=openSync(sourcePath,constants.O_RDONLY|constants.O_NOFOLLOW);let bytes:Buffer;
    try{const stat=fstatSync(fd);if(!stat.isFile()||stat.nlink!==1||stat.size===0||stat.size>50*1024*1024)throw Error('file_type_or_size_denied');bytes=readFileSync(fd);}finally{closeSync(fd);}
    const storageRunId=runId??'run-'+resultId,dir=this.files.prepareRun(task.id,storageRunId);filePath=this.files.writeBinary(dir,'adopted-'+resultId.slice(-8)+'-'+basename(sourcePath).replace(/[^\p{L}\p{N}_.-]/gu,'_').slice(-80),bytes);
    const actual=this.files.verify(dir,filePath);sha256=actual.sha256;payload.filename=basename(sourcePath);payload.storageRunId=storageRunId;payload.workspaceSource={path:sourcePath,sha256};
   }
   this.sql("INSERT INTO results VALUES(?,?,?,?,?,?,?,?,?,'accepted',?)",resultId,task.id,input.version,runId,input.messageId??null,input.filePath?'file':'text',json(payload),filePath,sha256,key);return {resultId,taskId:task.id,version:input.version,state:'accepted'};
  });
 }
 publish(actor:Actor,input:{operationId:string;taskId:string;version:number;resultIds:string[];text:string;sourceRequestId?:string}){
  this.requireMain(actor);return this.mutation(actor,input.taskId,input.operationId,'publish',input,key=>{
   const task=this.task(input.taskId);if(task.state==='paused'||task.outcome==='cancelled')throw Error('delivery_scope_frozen');if(task.historyState!=='visible'||task.controlState!=='normal'||task.headVersion!==input.version)throw Error('delivery_version_conflict');text(input.text);if(!Array.isArray(input.resultIds)||!input.resultIds.length||new Set(input.resultIds).size!==input.resultIds.length)throw Error('delivery_result_required');
   const authority=this.authority(task.id,input.version),sources=[authority.sourceRequestId,...(authority.sourceRequestIds??[])],source=input.sourceRequestId??authority.sourceRequestId;if(!sources.includes(source))throw Error('delivery_source_unresolved');this.trustedSource(actor,source);
   if(this.one("SELECT 1 FROM deliveries WHERE taskId=? AND version=? AND state<>'revoked'",task.id,input.version))throw Error('delivery_already_prepared');
   for(const resultId of input.resultIds){const result=this.result(resultId);if(result.taskId!==task.id||result.version!==input.version||result.state!=='accepted')throw Error('delivery_result_not_accepted');this.actualResult(result);}
   const deliveryId=id('delivery'),historyMessageId=id('message');this.sql("INSERT INTO deliveries VALUES(?,?,?,?,?,?,?,'prepared',0,NULL,NULL,?)",deliveryId,task.id,input.version,json(input.resultIds),source,input.text,historyMessageId,key);return {deliveryId,historyMessageId,state:'prepared'};
  });
 }
 delivery(deliveryId:string){const delivery=this.one<Delivery>('SELECT * FROM deliveries WHERE id=?',deliveryId);if(!delivery)throw Error('delivery_not_found');return this.deliveryView(delivery);}
 private deliveryView(delivery:Delivery){const resultIds=JSON.parse(delivery.resultIdsJson) as string[];return {...delivery,resultIds,publishedFileResultIds:resultIds.filter(resultId=>this.result(resultId).filePath!==null)};}
 deliveries(taskIds?:readonly string[]){return (taskIds===undefined?this.all<Delivery>('SELECT * FROM deliveries ORDER BY rowid'):this.all<Delivery>('SELECT * FROM deliveries WHERE taskId IN (SELECT value FROM json_each(?)) ORDER BY rowid',json(taskIds))).map(row=>this.deliveryView(row));}
 private deliveryReady(delivery:Delivery){const task=this.task(delivery.taskId);return task.historyState==='visible'&&task.controlState==='normal'&&task.state!=='paused'&&task.outcome!=='cancelled'&&delivery.version===task.headVersion;}
 pendingDeliveries(){return this.all<Delivery>("SELECT * FROM deliveries WHERE state='prepared' ORDER BY rowid").filter(delivery=>this.deliveryReady(delivery)).map(row=>this.deliveryView(row));}
 markDelivery(deliveryId:string,state:'submitting'|'recorded'|'uncertain'|'revoked'){
  this.store.transaction(()=>{const delivery=this.delivery(deliveryId);if(delivery.state===state)return;const allowed:Record<string,string[]>={prepared:['submitting','revoked'],submitting:['recorded','uncertain'],uncertain:['recorded','revoked'],recorded:['revoked'],revoked:[]};if(!allowed[delivery.state]?.includes(state))throw Error('delivery_transition_denied');
   if(state==='submitting'&&!this.deliveryReady(delivery))throw Error('delivery_scope_frozen');
   this.sql('UPDATE deliveries SET state=?,revision=revision+1,attemptedAt=CASE WHEN ?=\'submitting\' THEN coalesce(attemptedAt,?) ELSE attemptedAt END,revokedAt=CASE WHEN ?=\'revoked\' THEN ? ELSE revokedAt END WHERE id=?',state,state,Date.now(),state,Date.now(),deliveryId);
  });
 }
 private publishedFiles(selector:{runId?:string;resultId?:string;historyMessageIds?:readonly string[]},viewer?:{sourceRequestId?:string}){
  const deliveries=selector.historyMessageIds?this.all<Delivery>("SELECT * FROM deliveries WHERE historyMessageId IN (SELECT value FROM json_each(?)) AND revokedAt IS NULL AND state IN ('prepared','submitting','recorded','uncertain') ORDER BY rowid DESC",json(selector.historyMessageIds)):this.all<Delivery>("SELECT * FROM deliveries WHERE revokedAt IS NULL AND state IN ('prepared','submitting','recorded','uncertain') ORDER BY rowid DESC");const seen=new Set<string>(),files=[];
  for(const delivery of deliveries){if(viewer?.sourceRequestId&&viewer.sourceRequestId!==delivery.routeSourceRequestId)continue;for(const resultId of JSON.parse(delivery.resultIdsJson) as string[]){const result=this.result(resultId);if(seen.has(resultId)||!result.filePath||selector.resultId&&resultId!==selector.resultId||selector.runId&&result.runId!==selector.runId)continue;const actual=this.actualResult(result);seen.add(resultId);files.push({deliveryId:delivery.id,routeSourceRequestId:delivery.routeSourceRequestId,historyMessageId:delivery.historyMessageId,runId:result.runId,resultId,taskId:result.taskId,version:result.version,...actual.file!});}}return files;
 }
 publishedArtifacts(runId:string,viewer?:{sourceRequestId?:string}){return this.publishedFiles({runId},viewer);}
 publishedArtifact(runId:string,viewer?:{sourceRequestId?:string}){return this.publishedArtifacts(runId,viewer)[0];}
 publishedResult(resultId:string,viewer?:{sourceRequestId?:string}){return this.publishedFiles({resultId},viewer)[0];}
 publishedForMessages(historyMessageIds:readonly string[]){if(historyMessageIds.length>80)throw Error('publication_ids_limit');return historyMessageIds.length?this.publishedFiles({historyMessageIds}):[];}
 publishedRevealTarget(resultId:string){
  const published=this.publishedResult(resultId);if(!published)throw Error('artifact_not_authorized');const result=this.result(resultId),source=this.provenance(result,this.resultPayload(result));if(!source)return {...published,target:'published' as const};
  if(source.path===published.path){if(published.sha256!==source.sha256)throw Error('artifact_source_changed');return {...published,target:'source' as const};}
  let actual:string;try{actual=realpathSync(source.path);}catch{throw Error('material_missing');}if(actual!==source.path)throw Error('symlink_denied');
  const fd=openSync(source.path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const stat=fstatSync(fd);if(!stat.isFile()||stat.nlink!==1||stat.size>50*1024*1024)throw Error('file_type_or_size_denied');if(createHash('sha256').update(readFileSync(fd)).digest('hex')!==source.sha256)throw Error('artifact_source_changed');}finally{closeSync(fd);}return {...published,path:source.path,target:'source' as const};
 }
 private historyBlockers(task:Task,except=''){
  const blocked:{reason:string;id?:string}[]=[],add=(reason:string,row:{id?:string}|undefined)=>{if(row)blocked.push({reason,...(row.id?{id:row.id}:{})});};if(task.state!=='settled'||task.controlState!=='normal')blocked.push({reason:'task_unsettled'});
  add('run_not_closed',this.runs(task.id).find(run=>active(run)||this.exitUnconfirmed(run)||this.store.meta('lease:'+run.id)||this.lifecycle?.reviewExitConfirmed?.(run)===false));add('operation_unresolved',this.unresolved(task.id,except));
  add('delivery_unresolved',this.one<Delivery>("SELECT * FROM deliveries WHERE taskId=? AND state NOT IN ('recorded','revoked') LIMIT 1",task.id));
  add('message_unprocessed',this.one<AgentMessage>("SELECT m.* FROM agent_messages m LEFT JOIN agent_receipts r ON r.messageId=m.id WHERE m.taskId=? AND (r.state IS NULL OR r.state NOT IN ('processed','rejected')) LIMIT 1",task.id));
  if(this.table('worker_interactions'))add('interaction_unresolved',this.one("SELECT i.id FROM worker_interactions i JOIN runs r ON r.id=i.runId WHERE r.taskId=? AND (i.state IN ('pending_main','pending_user') OR i.state IN ('approved','answered') AND i.deliveredAt IS NULL) LIMIT 1",task.id));
  add('pending_item_open',this.one("SELECT id FROM pending_items WHERE state='open' AND (relatedTaskId=? OR linkedTaskId=?) LIMIT 1",task.id,task.id));
  const sources="SELECT sourceRequestId FROM task_versions WHERE taskId=? UNION SELECT json_extract(authorityJson,'$.sourceRequestId') FROM task_versions WHERE taskId=? UNION SELECT s.value FROM task_versions v,json_each(v.authorityJson,'$.sourceRequestIds') s WHERE v.taskId=?";
  add('source_input_unprocessed',this.one(`SELECT m.id FROM agent_messages m JOIN agent_receipts r ON r.messageId=m.id WHERE m.kind='user_input' AND json_extract(m.payloadJson,'$.requestId') IN (${sources}) AND r.state NOT IN ('processed','rejected') LIMIT 1`,task.id,task.id,task.id));
  if(this.table('media_assets'))add('attachment_in_progress',this.one(`SELECT id FROM media_assets WHERE requestId IN (${sources}) AND (lease IS NOT NULL OR state IN ('downloading','pending','preparing')) LIMIT 1`,task.id,task.id,task.id));
  if(this.table('wechat_outbox'))add('channel_unresolved',this.one(`SELECT id FROM wechat_outbox WHERE requestId IN (${sources}) AND state<>'sent' LIMIT 1`,task.id,task.id,task.id));
  if(this.table('tg_outbox')&&this.table('tg_routes'))add('channel_unresolved',this.one(`SELECT id FROM tg_outbox WHERE origin IN (SELECT origin FROM tg_routes WHERE requestId IN (${sources})) AND state<>'sent' LIMIT 1`,task.id,task.id,task.id));
  add('coordination_consumer_unresolved',this.one(`SELECT m.id FROM agent_messages m JOIN meta p ON p.key GLOB 'publicMainNode:v1:*' JOIN json_each(p.value,'$.sourceMessageIds') source ON source.value=m.id WHERE m.taskId=? AND json_extract(p.value,'$.threadId')=? AND (json_extract(p.value,'$.state')<>'worked' OR json_extract(p.value,'$.status')='unknown') LIMIT 1`,task.id,this.store.meta('mainThread')!));
  if(['succeeded','partial'].includes(task.outcome??'')){
   const reply=this.one("SELECT 1 FROM agent_messages m JOIN agent_receipts r ON r.messageId=m.id WHERE m.taskId=? AND m.taskVersion=? AND m.kind='worker_reply' AND length(json_extract(m.payloadJson,'$.text'))>0 AND r.state='processed' LIMIT 1",task.id,task.headVersion);
   const mainReply=this.table('conversation_messages')&&this.one(`SELECT 1 FROM conversation_messages WHERE role='assistant' AND text<>'' AND requestId IN (${sources}) LIMIT 1`,task.id,task.id,task.id);
   const delivery=this.one("SELECT 1 FROM deliveries WHERE taskId=? AND version=? AND state='recorded' AND revokedAt IS NULL",task.id,task.headVersion);if(!reply&&!mainReply&&!delivery)blocked.push({reason:'completion_evidence_missing'});
  }
  return blocked;
 }
 archiveHistory(actor:Actor,input:TaskMutation,archive:boolean){
  this.requireMain(actor);if(!actor.sourceRequestId||actor.threadId!==this.store.meta('mainThread'))throw Error('history_source_required');this.trustedSource(actor,actor.sourceRequestId);
  return this.mutation(actor,input.taskId,input.operationId,archive?'archive_work':'restore_work',input,key=>{const task=this.check(actor,input);if(archive&&task.historyState!=='archived'){const blockers=this.historyBlockers(task,key);if(blockers.length)return {taskId:task.id,state:'skipped',blockers};}
   const state=archive?'archived':'visible';if(task.historyState!==state){this.sql('UPDATE tasks SET historyState=?,revision=revision+1,updatedAt=? WHERE id=?',state,Date.now(),task.id);if(archive)this.notify(this.task(task.id),'task_archived',{historyState:state,revision:task.revision+1});}return {taskId:task.id,state:archive?'archived':'restored',revision:this.task(task.id).revision,diskBytesReclaimed:null};
  });
 }
 readFileReceipt(actor:Actor,operationId:string):FileReceipt|undefined{
  const task=this.guard(actor),run=this.run(actor.runId!);text(operationId,500);if(actor.operationPayload===undefined)throw Error('operation_payload_required');
  const op=this.one<Operation>('SELECT * FROM operations WHERE actorAgentId=? AND scopeId=? AND operationId=?',actor.agentId,task.id,operationId);if(!op)return;
  const details=JSON.parse(op.detailsJson);if(op.kind!=='write_file'||details.runId!==run.id||details.threadId!==actor.threadId||details.turnId!==actor.turnId||details.toolInputHash!==recursiveHash(actor.operationPayload))throw Error('operation_payload_conflict');
  if(op.state==='failed')throw Error(details.failureCode??'operation_failed');if(op.state!=='confirmed'||!op.responseJson)throw Error('operation_uncertain');
  const saved=JSON.parse(op.responseJson);if(!saved||typeof saved.path!=='string'||typeof saved.sha256!=='string'||!/^[a-f0-9]{64}$/.test(saved.sha256)||!Number.isSafeInteger(saved.bytes)||saved.bytes<1||saved.state!=='written'||saved.operationKey!==op.id)throw Error('operation_receipt_invalid');
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
   if(error instanceof Error&&['artifact_path_denied','file_type_or_size_denied'].includes(error.message)){this.sql("UPDATE operations SET state='failed',detailsJson=json_set(detailsJson,'$.failureCode',?),revision=revision+1 WHERE id=?",error.message,intent.operationKey);throw error;}
   if(!(error instanceof Error)||!('code' in error)||error.code!=='EEXIST')throw error;path=dir+'/'+input.filename;
   if(!intent.resuming){let code='artifact_filename_conflict';try{this.files.verify(dir,path);}catch(error){if(error instanceof Error)code=error.message;}this.sql("UPDATE operations SET state='failed',detailsJson=json_set(detailsJson,'$.failureCode',?),revision=revision+1 WHERE id=?",code,intent.operationKey);throw Error(code);}
   const existing=this.files.verify(dir,path);if(existing.sha256!==hash)throw Error('artifact_filename_conflict');
  }
  const actual=this.files.verify(dir,path),response:FileReceipt={path,sha256:actual.sha256,bytes:actual.bytes,state:'written',operationKey:intent.operationKey};
  this.store.transaction(()=>{this.guard(actor);this.sql("UPDATE operations SET responseJson=?,state='confirmed',revision=revision+1 WHERE id=?",json(response),intent.operationKey);this.lifecycle?.operationConfirmed?.(actor,intent.operationKey,'write_file',response);});return response;
 }
 writeMarkdown(actor:Actor,input:{operationId:string;filename:string;content:string}){text(input.content,128*1024);if(!input.filename.endsWith('.md'))throw Error('filename_denied');return this.writeFile(actor,{operationId:input.operationId,filename:input.filename,bytes:Buffer.from(input.content)});}
 captureActivity(actor:Actor,name:string,args:unknown,receipt:unknown):PublicActivity|undefined{
  this.actorTask(actor);if(!receipt||typeof receipt!=='object')return;let r=receipt as Record<string,unknown>;const a=args&&typeof args==='object'?args as Record<string,unknown>:{};
  if(name==='work_inspect'){const row=r.task as Task|undefined;if(typeof a.taskId!=='string'||row?.id!==a.taskId)return;r={taskId:row.id,version:row.headVersion};}
  else if(name==='worker_read'){if(typeof a.workerId!=='string'||r.workerId!==a.workerId||this.worker(a.workerId).taskId!==r.taskId)return;}
  else{
   const kinds:Record<string,string[]>={task_create:['task_create'],worker_open:['worker_open'],accept_result:['result_adopt'],publish_delivery:['publish'],worker_interrupt:['worker_stop'],task_update:['task_update','task_control','task_settle']};
   if(!kinds[name]||typeof r.operationKey!=='string')return;const op=this.one<Operation>('SELECT * FROM operations WHERE id=?',r.operationKey);if(!op||op.actorAgentId!==actor.agentId||!kinds[name]!.includes(op.kind)||!op.responseJson)return;
   const committed=JSON.parse(op.responseJson) as Record<string,unknown>,taskId=committed.taskId??op.scopeId;
   if(a.taskId!==undefined&&a.taskId!==taskId||r.taskId!==undefined&&r.taskId!==taskId)return;
   for(const key of ['runId','resultId','deliveryId'] as const)if(r[key]!==undefined&&r[key]!==committed[key])return;
   r={...committed,taskId};
  }
  const taskId=typeof r.taskId==='string'?r.taskId:undefined;if(!taskId)return;this.readAllowed(actor,taskId);const task=this.task(taskId);
  const target:ActivityTarget={taskId,version:typeof r.version==='number'?r.version:task.headVersion};
  for(const key of ['runId','resultId','deliveryId','operationKey'] as const)if(typeof r[key]==='string')target[key]=r[key] as string;
  const objectName=publicActivityName(task.title),base={schemaVersion:1 as const,target,...(objectName?{objectName}:{})};
  if(name==='task_create'||name==='worker_open')return {...base,action:'create_task',outcome:'created'};
  if(name==='work_inspect'||name==='worker_read')return {...base,action:name==='worker_read'?'inspect_run':'inspect_task',outcome:'record_read'};
  if(name==='accept_result')return {...base,action:'review_result',outcome:'accepted'};
  if(name==='publish_delivery')return {...base,action:'prepare_delivery',outcome:'delivery_prepared'};
  if(name==='worker_interrupt')return {...base,action:'stop_task',outcome:r.state==='confirmed'?'stop_confirmed':'stop_requested'};
  if(name==='task_update')return {...base,action:'update_task',outcome:r.state==='requested'?'update_accepted':'update_confirmed'};
 }
 executionReadScope(actor:Actor,selector:{taskId:string;runId:string},threadId:string){this.requireMain(actor);if(threadId!==this.store.meta('mainThread'))throw Error('execution_scope_denied');const run=this.run(selector.runId);if(run.taskId!==selector.taskId)throw Error('execution_scope_denied');return {version:run.version};}
 activityLink(target:ActivityTarget,threadId:string):ActivityLink|undefined{
  if(threadId!==this.store.meta('mainThread'))return;const task=this.one<Task>('SELECT * FROM tasks WHERE id=? AND historyState=\'visible\'',target.taskId);if(!task||!this.one('SELECT 1 FROM task_versions WHERE taskId=? AND version=?',task.id,target.version))return;
  if(target.runId){const run=this.store.run(target.runId);if(!run||run.taskId!==task.id||run.version!==target.version)return;}
  if(target.resultId){const result=this.one<Result>('SELECT * FROM results WHERE id=?',target.resultId);if(!result||result.taskId!==task.id||result.version!==target.version)return;}
  const link:ActivityLink={task:{...target}};if(target.resultId){const file=this.publishedResult(target.resultId);if(file)link.artifact={id:target.resultId,title:file.filename};}
  let delivery:Delivery|undefined;
  if(target.deliveryId){delivery=this.one<Delivery>('SELECT * FROM deliveries WHERE id=? AND taskId=? AND version=?',target.deliveryId,task.id,target.version);if(!delivery||delivery.revokedAt!==null||target.resultId&&!(JSON.parse(delivery.resultIdsJson) as string[]).includes(target.resultId))return;}
  else if(target.resultId)delivery=this.one<Delivery>("SELECT * FROM deliveries WHERE taskId=? AND version=? AND state='recorded' AND revokedAt IS NULL AND EXISTS(SELECT 1 FROM json_each(resultIdsJson) WHERE value=?) ORDER BY rowid DESC LIMIT 1",task.id,target.version,target.resultId);
  if(delivery?.state==='recorded'&&this.table('conversation_messages')&&this.one("SELECT 1 FROM conversation_messages WHERE id=? AND threadId=? AND role='assistant'",delivery.historyMessageId,threadId))link.messageId=delivery.historyMessageId;return link;
 }
 safeToUpgrade(){return !this.runs().some(active)&&!this.tasks().some(task=>task.controlState==='stopping')&&!this.one("SELECT 1 FROM operations WHERE state IN ('accepted','dispatching','uncertain')")&&!this.one("SELECT 1 FROM agent_receipts WHERE state NOT IN ('processed','rejected')")&&!this.one("SELECT 1 FROM deliveries WHERE state IN ('prepared','submitting','uncertain')");}
}
