import type {DatabaseSync} from 'node:sqlite';

// Read-only Web facts. Task decisions and Worker execution have separate owners.
export type OverviewRun={id:string;taskId:string;workerId:string;status:string;phase:string;version:number;epoch:number;sourceRequestId:string|null;createdAt?:number;startedAt?:number|null;endedAt?:number|null;stopRequestedAt?:number|null;replacesRunId?:string|null;errorCode?:string|null;threadId?:string|null;turnId?:string|null};
export type OverviewWorker={id:string;taskId:string;title?:string|null;run:OverviewRun;pendingUser:number;pendingMain:number;pendingUsers:{id:string;after:number;kind?:'question'|'authorization'}[];pendingUserCreatedAt?:number|null;pendingMainCreatedAt?:number|null};
export type OverviewTask={id:string;title?:string|null;goal:string|null;notes:string;headVersion:number;revision:number;state:string;outcome:string|null;controlState:string;historyState:string;sourceRequestId:string|null;sourceRequestIds?:string[];creationOrder?:number;createdAt?:number;settledAt?:number|null;workers:OverviewWorker[]};
export type TaskOverview={tasks:OverviewTask[];progressRevision?:number};
export type TaskRequirement={taskId:string;version:number;goal:string|null;sourceRequestId:string|null;sourceMessageId?:string;threadId?:string};
export type RecoveryFacts={operations:{id:string;taskId:string;kind:string;state:string;revision:number}[];receipts:{messageId:string;taskId:string;taskVersion:number;state:string;revision:number}[];interactions:{id:string;runId:string;taskVersion:number|null;kind:string;state:string}[]};
export type WorkerConversationQuery={workerId:string;after?:number;messageId?:string;offset?:number};
export type WorkerConversation={taskId:string;workerId:string;threadId:string|null;messages:{id:string;seq:number;kind:'worker_input'|'worker_reply';runId:string|null;version:number;text:string;offset:number;nextOffset:number|null}[];nextCursor:number|null};
export type TaskDetail={taskId:string;conversation?:WorkerConversation;requirements?:TaskRequirement[];moreHistory?:boolean;artifacts?:import('./web-contract.js').WebArtifact[];moreArtifacts?:boolean;recovery?:RecoveryFacts;runs:(OverviewRun&{stateRevision:number;activeMs:number;createdAt:number;startedAt:number|null;endedAt:number|null})[]};
type Classification={key:'running'|'queued'|'user'|'main'|'other'|'unknown'|'complete';label:string};
export function classifyTask(task:OverviewTask):Classification{
 if(task.controlState==='stopping')return {key:'other',label:'停止待确认'};
 if(task.state==='paused')return {key:'other',label:'已暂停'};
 if(task.state==='settled')return task.outcome==='succeeded'?{key:'complete',label:'已完成'}:{key:'other',label:({partial:'部分完成',failed:'未完成',cancelled:'已取消'} as Record<string,string>)[task.outcome??'']??'已结案'};
 if(task.workers.some(w=>w.pendingUser>0&&w.run.status==='running'&&!['ended','uncertain','held'].includes(w.run.phase)))return {key:'user',label:'待我处理'};
 if(task.workers.some(w=>w.run.status==='running'&&w.run.phase==='executing'&&w.run.stopRequestedAt==null))return {key:'running',label:'进行中'};
 if(task.workers.some(w=>w.run.phase==='uncertain'))return {key:'unknown',label:'执行状态待核实'};
 if(task.workers.some(w=>w.pendingMain>0))return {key:'main',label:'待主 Agent 处理'};
 if(task.workers.some(w=>w.run.status==='queued'&&w.run.phase==='ready'))return {key:'queued',label:'排队中'};
 return {key:'other',label:'办理中'};
}
export function readTaskOverview(db:DatabaseSync):TaskOverview{
 const tasks=db.prepare(`SELECT t.rowid AS creationOrder,t.id,t.title,t.notes,t.headVersion,t.revision,t.state,t.outcome,t.controlState,t.historyState,t.createdAt,t.settledAt,v.goal,v.sourceRequestId,json_extract(v.authorityJson,'$.sourceRequestIds') AS sources FROM tasks t JOIN task_versions v ON v.taskId=t.id AND v.version=t.headVersion WHERE t.historyState='visible' ORDER BY t.rowid DESC`).all() as (Omit<OverviewTask,'workers'|'sourceRequestIds'>&{sources:string|null})[];
 const runs=db.prepare(`SELECT r.id,r.taskId,r.workerId,r.version,r.status,r.phase,r.epoch,r.sourceRequestId,r.createdAt,r.startedAt,r.endedAt,r.stopRequestedAt,r.replacesRunId,r.errorCode,r.threadId,r.turnId,substr(first.prompt,1,80) AS title FROM tasks t JOIN runs r ON r.taskId=t.id JOIN runs first ON first.id=r.workerId WHERE t.historyState='visible' AND NOT EXISTS(SELECT 1 FROM runs next WHERE next.workerId=r.workerId AND next.rowid>r.rowid) ORDER BY first.rowid`).all() as (OverviewRun&{title:string})[];
 const pending=db.prepare(`SELECT r.workerId,i.id,i.rowid-1 AS after,i.kind,i.state,i.createdAt FROM worker_interactions i JOIN runs r ON r.id=i.runId JOIN tasks t ON t.id=r.taskId WHERE t.historyState='visible' AND t.controlState='normal' AND t.state='open' AND i.state IN ('pending_user','pending_main') AND r.status='running' AND r.phase NOT IN ('ended','uncertain','held') AND i.runEpoch=r.epoch AND i.taskVersion=r.version AND i.threadId=r.threadId AND i.turnId=r.turnId AND NOT EXISTS(SELECT 1 FROM runs next WHERE next.workerId=r.workerId AND next.rowid>r.rowid) ORDER BY i.rowid`).all() as {workerId:string;id:string;after:number;kind:'question'|'authorization';state:string;createdAt:number}[];
 const replies=db.prepare(`SELECT r.workerId,count(*) AS pendingMain,max(r.endedAt) AS pendingMainCreatedAt FROM agent_messages m JOIN agent_receipts ar ON ar.messageId=m.id JOIN runs r ON r.id=m.senderRunId JOIN tasks t ON t.id=r.taskId WHERE t.historyState='visible' AND m.kind='worker_reply' AND m.senderAgentId='host' AND m.taskId=r.taskId AND m.taskVersion=r.version AND m.taskVersion=t.headVersion AND m.senderEpoch<=r.epoch AND m.targetRunId IS NULL AND ar.recipientAgentId=m.recipientAgentId AND ar.recipientAgentId=(SELECT value FROM meta WHERE key='mainAgentId') AND ar.state IN ('pending','offered','received','blocked','uncertain') AND NOT EXISTS(SELECT 1 FROM runs next WHERE next.workerId=r.workerId AND next.rowid>r.rowid) GROUP BY r.workerId`).all() as {workerId:string;pendingMain:number;pendingMainCreatedAt:number|null}[];
 const byTask=new Map<string,OverviewTask>(tasks.map(({sources,...t})=>[t.id,{...t,sourceRequestIds:sources?JSON.parse(sources):t.sourceRequestId?[t.sourceRequestId]:[],workers:[]}]));
 const byWorker=new Map<string,OverviewWorker>();
 for(const {title,...run} of runs){const worker:OverviewWorker={id:run.workerId,taskId:run.taskId,title,run,pendingUser:0,pendingMain:0,pendingUsers:[]};byWorker.set(worker.id,worker);byTask.get(run.taskId)?.workers.push(worker);}
 for(const item of pending){const w=byWorker.get(item.workerId);if(!w)continue;if(item.state==='pending_user'){w.pendingUser++;w.pendingUsers.push({id:item.id,after:item.after,kind:item.kind});w.pendingUserCreatedAt=Math.max(w.pendingUserCreatedAt??0,item.createdAt);}else{w.pendingMain++;w.pendingMainCreatedAt=Math.max(w.pendingMainCreatedAt??0,item.createdAt);}}
 for(const item of replies){const w=byWorker.get(item.workerId);if(w){w.pendingMain+=item.pendingMain;w.pendingMainCreatedAt=Math.max(w.pendingMainCreatedAt??0,item.pendingMainCreatedAt??0);}}
 return {tasks:[...byTask.values()]};
}
function requireTask(db:DatabaseSync,id:string){
 if(!/^[\w:-]{1,100}$/.test(id)||!db.prepare("SELECT id FROM tasks WHERE id=? AND historyState='visible'").get(id))throw Error('task_not_found');
}
export function readTaskSummary(db:DatabaseSync,taskId:string):TaskDetail{
 requireTask(db,taskId);
 const requirements=db.prepare(`SELECT v.taskId,v.version,v.goal,v.sourceRequestId FROM task_versions v JOIN tasks t ON t.id=v.taskId AND t.headVersion=v.version WHERE t.id=?`).all(taskId) as TaskRequirement[];
 return {taskId,runs:[],requirements};
}
export function readTaskDetail(db:DatabaseSync,taskId:string,query?:WorkerConversationQuery):TaskDetail{
 requireTask(db,taskId);
 if(query)return {taskId,runs:[],conversation:readWorkerConversation(db,taskId,query)};
 const runs=db.prepare(`SELECT id,taskId,workerId,version,status,phase,epoch,sourceRequestId,stateRevision,activeMs,replacesRunId,errorCode,stopRequestedAt,createdAt,startedAt,endedAt,threadId,turnId FROM runs WHERE taskId=? ORDER BY rowid DESC LIMIT 81`).all(taskId) as TaskDetail['runs'];
 const operations=db.prepare(`SELECT id,scopeId AS taskId,kind,state,revision FROM operations WHERE scopeId=? AND state IN ('accepted','dispatching','uncertain') ORDER BY rowid DESC LIMIT 81`).all(taskId) as RecoveryFacts['operations'];
 const receipts=db.prepare(`SELECT m.id AS messageId,m.taskId,m.taskVersion,ar.state,ar.revision FROM agent_messages m JOIN agent_receipts ar ON ar.messageId=m.id WHERE m.taskId=? AND ar.recipientAgentId=m.recipientAgentId AND ar.recipientAgentId=(SELECT value FROM meta WHERE key='mainAgentId') AND ar.state IN ('blocked','uncertain') AND m.kind<>'user_input' AND m.targetRunId IS NULL ORDER BY m.seq DESC LIMIT 81`).all(taskId) as RecoveryFacts['receipts'];
 const interactions=db.prepare(`SELECT i.id,i.runId,i.taskVersion,i.kind,i.state FROM worker_interactions i JOIN runs r ON r.id=i.runId WHERE r.taskId=? AND i.state IN ('expired','cancelled') ORDER BY i.rowid DESC LIMIT 81`).all(taskId) as RecoveryFacts['interactions'];
 const requirements=db.prepare(`SELECT taskId,version,goal,sourceRequestId FROM task_versions WHERE taskId=? ORDER BY version DESC LIMIT 81`).all(taskId) as TaskRequirement[];
 return {taskId,requirements:requirements.slice(0,80),runs:runs.slice(0,80),moreHistory:[requirements,runs,operations,receipts,interactions].some(rows=>rows.length>80),recovery:{operations:operations.slice(0,80),receipts:receipts.slice(0,80),interactions:interactions.slice(0,80)}};
}

function readWorkerConversation(db:DatabaseSync,taskId:string,query:WorkerConversationQuery):WorkerConversation{
 const validId=(id:unknown)=>typeof id==='string'&&/^[\w:-]{1,100}$/.test(id);
 if(!validId(query.workerId)||query.after!==undefined&&(!Number.isSafeInteger(query.after)||query.after<0)||query.offset!==undefined&&(!Number.isSafeInteger(query.offset)||query.offset<0)||query.messageId!==undefined&&!validId(query.messageId)||query.offset!==undefined&&!query.messageId||query.messageId!==undefined&&query.after!==undefined)throw Error('worker_query_invalid');
 const worker=db.prepare('SELECT threadId FROM runs WHERE taskId=? AND workerId=? AND EXISTS(SELECT 1 FROM runs first WHERE first.id=? AND first.taskId=? AND first.workerId=first.id) ORDER BY rowid DESC LIMIT 1').get(taskId,query.workerId,query.workerId,taskId);
 if(!worker)throw Error('worker_not_found');
 const where=`m.taskId=? AND json_extract(m.payloadJson,'$.workerId')=? AND ((m.kind='worker_input' AND m.senderAgentId=(SELECT value FROM meta WHERE key='mainAgentId') AND m.recipientAgentId=? AND (m.targetRunId IS NULL OR EXISTS(SELECT 1 FROM runs target WHERE target.id=m.targetRunId AND target.taskId=m.taskId AND target.workerId=json_extract(m.payloadJson,'$.workerId')))) OR (m.kind='worker_reply' AND m.senderAgentId='host' AND EXISTS(SELECT 1 FROM runs r WHERE r.id=m.senderRunId AND r.taskId=m.taskId AND r.workerId=? AND r.version=m.taskVersion AND m.senderEpoch IS NOT NULL AND m.senderEpoch<=r.epoch)))`;
 const rows=db.prepare(`SELECT m.id,m.seq,m.kind,m.senderRunId,m.targetRunId,m.taskVersion,json_extract(m.payloadJson,'$.text') AS text FROM agent_messages m WHERE ${where} AND ${query.messageId?'m.id=?':'m.seq>?'} ORDER BY m.seq LIMIT 21`).all(taskId,query.workerId,'worker:'+query.workerId,query.workerId,query.messageId??query.after??0);
 if(query.messageId&&!rows.length)throw Error('worker_message_not_found');
 const messages=rows.slice(0,20).map(row=>{
  const text=typeof row.text==='string'?row.text:'',offset=query.offset??0;
  return {id:String(row.id),seq:Number(row.seq),kind:row.kind as 'worker_input'|'worker_reply',runId:(row.senderRunId??row.targetRunId) as string|null,version:Number(row.taskVersion),text:text.slice(offset,offset+24000),offset,nextOffset:offset+24000<text.length?offset+24000:null};
 });
 return {taskId,workerId:query.workerId,threadId:worker.threadId as string|null,messages,nextCursor:rows.length>20?messages.at(-1)!.seq:null};
}
