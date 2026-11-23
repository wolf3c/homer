import type {DatabaseSync} from 'node:sqlite';
import {mainProcessSourceSql} from './main-process.js';

// Read-only Web facts. Task decisions and Worker execution have separate owners.
export type OverviewRun={id:string;taskId:string;workerId:string;status:string;phase:string;version:number;epoch:number;sourceRequestId:string|null;createdAt?:number;startedAt?:number|null;endedAt?:number|null;stopRequestedAt?:number|null;replacesRunId?:string|null;errorCode?:string|null;threadId?:string|null;turnId?:string|null};
export type OverviewWorker={id:string;taskId:string;title?:string|null;run:OverviewRun;pendingMain:number;pendingMainApprovals?:number;pendingMainQuestions?:number};
export type OverviewTask={id:string;title?:string|null;goal:string|null;notes:string;headVersion:number;revision:number;state:'open'|'paused';historyState:'visible'|'archived';hasExecutingWorker?:boolean;sourceRequestId:string|null;sourceRequestIds?:string[];creationOrder?:number;createdAt?:number;workers:OverviewWorker[]};
export type OverviewPage={view?:'visible'|'archived';before?:number};
export type TaskOverview={tasks:OverviewTask[];nextCursor?:number;progressRevision?:number};
export type TaskRequirement={taskId:string;version:number;goal:string|null;sourceRequestId:string|null;sourceMessageId?:string;threadId?:string};
export type RecoveryFacts={operations:{id:string;taskId:string;kind:string;state:string;revision:number}[];receipts:{messageId:string;taskId:string;taskVersion:number;state:string;revision:number}[];interactions:{id:string;runId:string;taskVersion:number|null;kind:string;state:string}[]};
export type WorkerConversationQuery={workerId:string;after?:number;messageId?:string;offset?:number};
export type WorkerConversation={taskId:string;workerId:string;threadId:string|null;messages:{id:string;seq:number;kind:'worker_input'|'worker_reply';runId:string|null;version:number;text:string;offset:number;nextOffset:number|null;receipt?:string}[];nextCursor:number|null};
export type TaskDetail={taskId:string;historyState?:OverviewTask['historyState'];publicMessages?:{id:string;role:'user'|'assistant';excerpt:string}[];moreMessages?:boolean;conversation?:WorkerConversation;requirements?:TaskRequirement[];moreHistory?:boolean;artifacts?:import('./web-contract.js').WebArtifact[];moreArtifacts?:boolean;recovery?:RecoveryFacts;runs:(OverviewRun&{stateRevision:number;activeMs:number;createdAt:number;startedAt:number|null;endedAt:number|null})[]};
export function readTaskOverview(db:DatabaseSync,page:OverviewPage={}):TaskOverview{
 const {view='visible',before}=page;
 if(!['visible','archived'].includes(view)||before!==undefined&&(!Number.isSafeInteger(before)||before<1))throw Error('task_overview_invalid');
 const liveInteraction=`(i.state='pending_main' OR i.state='pending_user' AND i.responseUserMessageId IS NOT NULL)
   AND r.stopRequestedAt IS NULL AND i.taskVersion=r.version AND i.threadId=r.threadId AND i.turnId=r.turnId
   AND (r.status='running' AND r.phase NOT IN ('ended','uncertain','held') AND i.runEpoch=r.epoch
     OR i.source='ask_main' AND r.status='succeeded' AND r.phase='ended' AND t.state='open' AND t.headVersion=r.version
       AND EXISTS(SELECT 1 FROM agent_messages m WHERE m.senderRunId=r.id AND m.kind='worker_reply' AND m.senderEpoch=i.runEpoch))
   AND (i.source='ask_main' OR NOT EXISTS(SELECT 1 FROM runs next WHERE next.workerId=r.workerId AND next.rowid>r.rowid))`;
 const pageRows=db.prepare(`SELECT t.rowid AS creationOrder,t.id,t.title,t.notes,t.headVersion,t.revision,t.state,t.historyState,t.createdAt,
   v.goal,v.sourceRequestId,json_extract(v.authorityJson,'$.sourceRequestIds') AS sources FROM tasks t JOIN task_versions v ON v.taskId=t.id AND v.version=t.headVersion WHERE t.historyState=? AND t.rowid<? ORDER BY t.rowid DESC LIMIT 21`).all(view,before??Number.MAX_SAFE_INTEGER) as (Omit<OverviewTask,'workers'|'sourceRequestIds'|'hasExecutingWorker'>&{sources:string|null})[];
 if(!pageRows.length)return {tasks:[]};
 const tasks=pageRows.slice(0,20),ids=JSON.stringify(tasks.map(t=>t.id));
 const inPage='t.id IN (SELECT value FROM json_each(?))';
 const runs=db.prepare(`SELECT r.id,r.taskId,r.workerId,r.version,r.status,r.phase,r.epoch,r.sourceRequestId,r.createdAt,r.startedAt,r.endedAt,r.stopRequestedAt,r.replacesRunId,r.errorCode,r.threadId,r.turnId,substr(first.prompt,1,80) AS title FROM tasks t JOIN runs r ON r.taskId=t.id JOIN runs first ON first.id=r.workerId WHERE ${inPage} AND NOT EXISTS(SELECT 1 FROM runs next WHERE next.workerId=r.workerId AND next.rowid>r.rowid) ORDER BY first.rowid`).all(ids) as (OverviewRun&{title:string})[];
 const pending=db.prepare(`SELECT r.workerId,i.kind,count(*) AS total FROM worker_interactions i JOIN runs r ON r.id=i.runId JOIN tasks t ON t.id=r.taskId WHERE ${inPage} AND t.historyState='visible' AND ${liveInteraction} GROUP BY r.workerId,i.kind`).all(ids) as {workerId:string;kind:string;total:number}[];
 const replies=db.prepare(`SELECT r.workerId,count(*) AS pendingMain FROM agent_messages m JOIN agent_receipts ar ON ar.messageId=m.id JOIN runs r ON r.id=m.senderRunId JOIN tasks t ON t.id=r.taskId WHERE ${inPage} AND m.kind='worker_reply' AND m.senderAgentId='host' AND m.taskId=r.taskId AND m.taskVersion=r.version AND m.senderEpoch<=r.epoch AND m.targetRunId IS NULL AND ar.recipientAgentId=m.recipientAgentId AND ar.recipientAgentId=(SELECT value FROM meta WHERE key='mainAgentId') AND (ar.state IN ('pending','offered','uncertain') OR ar.state='received' AND ${mainProcessSourceSql()}) AND NOT EXISTS(SELECT 1 FROM runs next WHERE next.workerId=r.workerId AND next.rowid>r.rowid) GROUP BY r.workerId`).all(ids) as {workerId:string;pendingMain:number}[];
 const byTask=new Map<string,OverviewTask>(tasks.map(({sources,...t})=>[t.id,{...t,sourceRequestIds:sources?JSON.parse(sources):t.sourceRequestId?[t.sourceRequestId]:[],workers:[]}]));
 const byWorker=new Map<string,OverviewWorker>();
 for(const {title,...run} of runs){const worker:OverviewWorker={id:run.workerId,taskId:run.taskId,title,run,pendingMain:0};byWorker.set(worker.id,worker);byTask.get(run.taskId)?.workers.push(worker);}
 for(const item of pending){
  const worker=byWorker.get(item.workerId);if(!worker)continue;
  worker.pendingMain+=item.total;
  if(item.kind==='authorization')worker.pendingMainApprovals=item.total;
  else worker.pendingMainQuestions=item.total;
 }
 for(const item of replies){const worker=byWorker.get(item.workerId);if(worker)worker.pendingMain+=item.pendingMain;}
 return {tasks:[...byTask.values()],...(pageRows.length>20?{nextCursor:tasks.at(-1)!.creationOrder}:{})};
}
function requireTask(db:DatabaseSync,id:string){
 const row=/^[\w:-]{1,100}$/.test(id)&&db.prepare("SELECT historyState FROM tasks WHERE id=?").get(id);
 if(!row)throw Error('task_not_found');
 return row.historyState as OverviewTask['historyState'];
}
export function readTaskSummary(db:DatabaseSync,taskId:string):TaskDetail{
 requireTask(db,taskId);
 const requirements=db.prepare(`SELECT v.taskId,v.version,v.goal,v.sourceRequestId FROM task_versions v JOIN tasks t ON t.id=v.taskId AND t.headVersion=v.version WHERE t.id=?`).all(taskId) as TaskRequirement[];
 return {taskId,runs:[],requirements};
}
export function readTaskDetail(db:DatabaseSync,taskId:string,query?:WorkerConversationQuery):TaskDetail{
 const historyState=requireTask(db,taskId);
 if(query)return {taskId,runs:[],conversation:readWorkerConversation(db,taskId,query)};
 const runs=db.prepare(`SELECT id,taskId,workerId,version,status,phase,epoch,sourceRequestId,stateRevision,activeMs,replacesRunId,errorCode,stopRequestedAt,createdAt,startedAt,endedAt,threadId,turnId FROM runs WHERE taskId=? ORDER BY rowid DESC LIMIT 81`).all(taskId) as TaskDetail['runs'];
 const operations=db.prepare(`SELECT id,scopeId AS taskId,kind,state,revision FROM operations WHERE scopeId=? AND state IN ('accepted','dispatching','uncertain') ORDER BY rowid DESC LIMIT 81`).all(taskId) as RecoveryFacts['operations'];
 const receipts=db.prepare(`SELECT m.id AS messageId,m.taskId,m.taskVersion,ar.state,ar.revision FROM agent_messages m JOIN agent_receipts ar ON ar.messageId=m.id WHERE m.taskId=? AND ar.recipientAgentId=m.recipientAgentId AND ar.recipientAgentId=(SELECT value FROM meta WHERE key='mainAgentId') AND ar.state='uncertain' AND m.kind<>'user_input' AND m.targetRunId IS NULL ORDER BY m.seq DESC LIMIT 81`).all(taskId) as RecoveryFacts['receipts'];
 const interactions=db.prepare(`SELECT i.id,i.runId,i.taskVersion,i.kind,i.state FROM worker_interactions i JOIN runs r ON r.id=i.runId WHERE r.taskId=? AND i.state IN ('expired','cancelled') ORDER BY i.rowid DESC LIMIT 81`).all(taskId) as RecoveryFacts['interactions'];
 const requirements=db.prepare(`SELECT taskId,version,goal,sourceRequestId FROM task_versions WHERE taskId=? ORDER BY version DESC LIMIT 81`).all(taskId) as TaskRequirement[];
 return {taskId,historyState,requirements:requirements.slice(0,80),runs:runs.slice(0,80),moreHistory:[requirements,runs,operations,receipts,interactions].some(rows=>rows.length>80),recovery:{operations:operations.slice(0,80),receipts:receipts.slice(0,80),interactions:interactions.slice(0,80)}};
}

function readWorkerConversation(db:DatabaseSync,taskId:string,query:WorkerConversationQuery):WorkerConversation{
 const validId=(id:unknown)=>typeof id==='string'&&/^[\w:-]{1,100}$/.test(id);
 if(!validId(query.workerId)||query.after!==undefined&&(!Number.isSafeInteger(query.after)||query.after<0)||query.offset!==undefined&&(!Number.isSafeInteger(query.offset)||query.offset<0)||query.messageId!==undefined&&!validId(query.messageId)||query.offset!==undefined&&!query.messageId||query.messageId!==undefined&&query.after!==undefined)throw Error('worker_query_invalid');
 const worker=db.prepare('SELECT threadId FROM runs WHERE taskId=? AND workerId=? AND EXISTS(SELECT 1 FROM runs first WHERE first.id=? AND first.taskId=? AND first.workerId=first.id) ORDER BY rowid DESC LIMIT 1').get(taskId,query.workerId,query.workerId,taskId);
 if(!worker)throw Error('worker_not_found');
 const where=`m.taskId=? AND json_extract(m.payloadJson,'$.workerId')=? AND ((m.kind='worker_input' AND m.senderAgentId=(SELECT value FROM meta WHERE key='mainAgentId') AND m.recipientAgentId=? AND (m.targetRunId IS NULL OR EXISTS(SELECT 1 FROM runs target WHERE target.id=m.targetRunId AND target.taskId=m.taskId AND target.workerId=json_extract(m.payloadJson,'$.workerId')))) OR (m.kind='worker_reply' AND m.senderAgentId='host' AND EXISTS(SELECT 1 FROM runs r WHERE r.id=m.senderRunId AND r.taskId=m.taskId AND r.workerId=? AND r.version=m.taskVersion AND m.senderEpoch IS NOT NULL AND m.senderEpoch<=r.epoch)))`;
 const rows=db.prepare(`SELECT m.id,m.seq,m.kind,m.senderRunId,m.targetRunId,m.taskVersion,json_extract(m.payloadJson,'$.text') AS text,ar.state AS receipt FROM agent_messages m LEFT JOIN agent_receipts ar ON ar.messageId=m.id AND ar.recipientAgentId=m.recipientAgentId WHERE ${where} AND ${query.messageId?'m.id=?':'m.seq>?'} ORDER BY m.seq LIMIT 21`).all(taskId,query.workerId,'worker:'+query.workerId,query.workerId,query.messageId??query.after??0);
 if(query.messageId&&!rows.length)throw Error('worker_message_not_found');
 const messages=rows.slice(0,20).map(row=>{
  const text=typeof row.text==='string'?row.text:'',offset=query.offset??0;
  return {id:String(row.id),seq:Number(row.seq),kind:row.kind as 'worker_input'|'worker_reply',runId:(row.senderRunId??row.targetRunId) as string|null,version:Number(row.taskVersion),text:text.slice(offset,offset+24000),...(typeof row.receipt==='string'?{receipt:row.receipt}:{}),offset,nextOffset:offset+24000<text.length?offset+24000:null};
 });
 return {taskId,workerId:query.workerId,threadId:worker.threadId as string|null,messages,nextCursor:rows.length>20?messages.at(-1)!.seq:null};
}
