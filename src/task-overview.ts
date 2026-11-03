import type { DatabaseSync } from 'node:sqlite';

// Web-only projection. These types are not persisted and never drive scheduling.
export type OverviewRun = {id:string;status:string;phase:string;contractVersion:number;epoch:number;summary:string|null;sourceRequestId:string|null;createdAt?:number;startedAt?:number|null;endedAt?:number|null;stopRequestedAt?:number|null;replacesRunId?:string|null;errorCode?:string|null;threadId?:string|null;turnId?:string|null};
export type TaskUpdateSummary={operationKey:string;version:number;mode:'steer'|'queue'|'stop_replace';revision:number;runId:string|null;stage:'queued'|'accepted'|'received'|'adopted'|'activated'|'replacing'|'replacement_ready'|'uncertain'|'failed'|'cancelled'|'blocked'};
export type OverviewTask = {
 updates?:TaskUpdateSummary[];moreUpdates?:boolean;previousRun?:{id:string;status:string;errorCode:string|null}|null;
 id:string;rootTaskId:string;parentTaskId:string|null;title?:string|null;goal:string|null;executorKind:string;executorAgentId:string;coordinatorAgentId:string;
 creationOrder?:number;waitingEnteredAt?:number|null;reviewEnteredAt?:number|null;settledAt?:number|null;pendingUserCreatedAt?:number|null;pendingMainCreatedAt?:number|null;
 sourceRequestId:string|null;rework?:boolean;headVersion:number;revision:number;state:string;outcome:string|null;controlState:string;currentRunId:string|null;run:OverviewRun|null;
 result:{id:string;state:string;outcome:string|null}|null;
 coordination?:{blocked:number;uncertain:number};
 delivery:{state:string;outcome:string;resultId:string|null}|null;pendingUser:number;pendingMain:number;pendingUsers?:{id:string;after:number;kind?:'question'|'authorization'}[];
};
export type TaskOverview = {tasks:OverviewTask[];detailSummary?:boolean;progressRevision?:number};
export type TaskRequirement={taskId:string;version:number;goal:string|null;acceptanceJson:string|null;sourceRequestId:string|null;sourceMessageId?:string;threadId?:string};
export type TaskPublication={id:string;version:number;resultId:string|null;historyMessageId:string|null;outcome:string};
export type RecoveryFacts = {
 results:{id:string;taskId:string;version:number;runId:string|null;state:string;outcome:string|null;completionResultId:string|null}[];
 deliveries:{id:string;rootTaskId:string;version:number;resultId:string|null;historyMessageId:string|null;state:string;outcome:string}[];
 operations:{id:string;taskId:string;kind:string;state:string;revision:number}[];
 receipts:{messageId:string;taskId:string;taskVersion:number;state:string;revision:number}[];
 interactions:{id:string;runId:string;contractVersion:number|null;kind:string;state:string}[];
};
export type TaskDetail = {requirements?:TaskRequirement[];publications?:TaskPublication[];morePublications?:boolean;moreHistory?:boolean;artifacts?:{id:string;title:string;historyMessageId:string}[];moreArtifacts?:boolean;taskId:string;recovery?:RecoveryFacts;runs:(OverviewRun & {taskId:string;stateRevision:number;activeMs:number;replacesRunId:string|null;createdAt:number;startedAt:number|null;endedAt:number|null})[]};
export const overviewFilters = {all:'全部',running:'进行中',queued:'排队',user:'待我处理',review:'待主验收',main:'待主 Agent',blocked:'受阻',other:'其他状态',unknown:'待核实',complete:'已完成'} as const;
export type OverviewFilter = keyof typeof overviewFilters;
type Classification = {key:Exclude<OverviewFilter,'all'>;label:string};
export function classifyTask(t:OverviewTask):Classification {
 const r=t.run;
 if(t.controlState==='stopping')return {key:'other',label:'取消请求待确认'};
 if(r?.phase==='uncertain'||t.state==='recovery')return {key:'unknown',label:'状态待核实'};
 if(t.controlState==='held'||r?.phase==='held')return {key:'other',label:'已暂停'};
 const nativeMain=t.executorKind==='main'&&t.currentRunId===null;
 if(!nativeMain&&(!r||r.id!==t.currentRunId||r.contractVersion!==t.headVersion))return {key:'unknown',label:'状态待核实'};
 if(t.state==='settled'&&t.outcome==='cancelled'&&(nativeMain||r?.status==='cancelled'&&r.phase==='ended'))return {key:'other',label:'已取消'};
 if(t.pendingUser)return {key:'user',label:'待我处理'};
 if(t.result?.state==='offered')return {key:'review',label:'候选待主 Agent 验收'};
 if(t.pendingMain)return {key:'main',label:'待主 Agent 处理'};
 if((nativeMain||r?.status==='succeeded'&&r.phase==='ended')&&t.state==='settled'&&t.outcome==='succeeded'&&t.result?.state==='accepted'&&t.result.outcome==='succeeded'&&t.delivery?.state==='recorded'&&t.delivery.outcome==='succeeded'&&t.delivery.resultId===t.result.id)return {key:'complete',label:'已完成'};
 if(t.result?.state==='accepted'&&t.result.outcome==='partial')return {key:'other',label:'已接受部分成果'};
 if(t.delivery?.state==='uncertain')return {key:'unknown',label:'交付状态待核实'};
 if(t.delivery&&['prepared','submitting'].includes(t.delivery.state))return {key:'other',label:'待正式交付确认'};
 if(r?.status==='running'&&r.phase==='executing')return {key:'running',label:'进行中'};
 if(r?.status==='queued'&&r.phase==='ready'&&t.controlState==='normal')return {key:'queued',label:'排队中'};
 if(r&&['failed','cancelled','interrupted'].includes(r.status)&&r.phase==='ended')return {key:'other',label:({failed:'执行失败',cancelled:'本次执行已取消',interrupted:'执行已中断'} as Record<string,string>)[r.status]!};
 if(t.state==='blocked')return {key:'blocked',label:'受阻'};
 if(r?.status==='running'&&['parked','rpc_wait','starting','ready','yielding','sealing'].includes(r.phase))return {key:'other',label:({parked:'等待协作事件',rpc_wait:'等待工具或交互',starting:'正在启动',ready:'等待恢复执行',yielding:'正在停驻',sealing:'正在收束'} as Record<string,string>)[r.phase]!};
 if(nativeMain&&t.state==='settled'&&t.outcome==='failed')return {key:'other',label:'执行失败'};
 if(nativeMain&&!t.result)return {key:'other',label:'主 Agent 事项，尚无独立 Run'};
 if(t.result?.state==='accepted')return {key:'other',label:'结果已接受，交付未确认'};
 return {key:'unknown',label:'状态待核实'};
}
export function rootGroups(tasks:OverviewTask[]) {
 const groups=new Map<string,OverviewTask[]>();
 for(const task of tasks){const group=groups.get(task.rootTaskId)??[];group.push(task);groups.set(task.rootTaskId,group);}
 return groups;
}
export function classifyRoot(root:OverviewTask,members:OverviewTask[]):Classification {
 const own=classifyTask(root);
 if(own.key==='complete'||root.state==='settled'||root.controlState!=='normal'||own.key==='unknown')return own;
 for(const key of ['unknown','user','review','main','running','queued','blocked'] as const){
  const match=members.find(t=>classifyTask(t).key===key);if(match)return classifyTask(match);
 }
 return own;
}
export function filterRoots(tasks:OverviewTask[],filter:OverviewFilter,query:string) {
 const groups=rootGroups(tasks),needle=query.trim().toLocaleLowerCase();
 return tasks.filter(t=>t.parentTaskId===null&&t.id===t.rootTaskId).filter(t=>{
  const group=groups.get(t.id)??[t],status=classifyRoot(t,group);
  return (filter==='all'||(filter==='user'?group.some(c=>c.pendingUser>0):status.key===filter))&&(!needle||group.some(c=>`${c.title??''}\n${c.goal??''}`.toLocaleLowerCase().includes(needle)));
 });
}
export function overviewStats(tasks:OverviewTask[]) {
 const current=tasks.filter(t=>t.run?.id===t.currentRunId&&t.run?.contractVersion===t.headVersion&&t.controlState==='normal');
 const active=current.filter(t=>t.run?.status==='running'&&t.run.phase==='executing');
 return {roots:tasks.filter(t=>t.parentTaskId===null&&t.id===t.rootTaskId).length,activeRuns:active.length,activeWorkers:new Set(active.filter(t=>t.executorKind==='worker').map(t=>t.executorAgentId)).size,queuedWorkers:new Set(current.filter(t=>t.executorKind==='worker'&&t.run?.status==='queued'&&t.run.phase==='ready').map(t=>t.executorAgentId)).size};
}
// Batched read-only SELECTs; no historical runs, result payloads, file bytes, meta
// projection, migration, interaction inspection or per-row host calls.
export function readTaskOverview(db:DatabaseSync):TaskOverview {
 type Joined=Omit<OverviewTask,'run'|'result'|'delivery'|'pendingUser'|'pendingMain'|'coordination'|'pendingUsers'|'rework'|'updates'|'moreUpdates'|'previousRun'> & {runId:string|null;status:string;phase:string;contractVersion:number;epoch:number;summary:string|null;runSourceRequestId:string|null;stopRequestedAt:number|null;threadId:string|null;turnId:string|null;rework:number;runCreatedAt:number;startedAt:number|null;endedAt:number|null;replacesRunId:string|null;errorCode:string|null;priorId:string|null;priorStatus:string;priorErrorCode:string|null};
 const rows=db.prepare(`SELECT t.rowid AS creationOrder,t.waitingEnteredAt,t.reviewEnteredAt,t.settledAt,t.id,t.rootTaskId,t.parentTaskId,CASE WHEN t.parentTaskId IS NULL THEN m.title ELSE NULL END AS title,t.executorKind,t.executorAgentId,t.coordinatorAgentId,t.headVersion,t.revision,t.state,t.outcome,t.controlState,t.currentRunId,v.goal,v.sourceRequestId,
 r.replacesRunId,r.errorCode,prior.id AS priorId,prior.status AS priorStatus,prior.errorCode AS priorErrorCode,r.createdAt AS runCreatedAt,r.startedAt,r.endedAt,r.id AS runId,r.status,r.phase,r.contractVersion,r.epoch,r.summary,r.stopRequestedAt,r.threadId,r.turnId,CASE WHEN prior.errorCode='revision_requested' THEN 1 ELSE 0 END AS rework,r.sourceRequestId AS runSourceRequestId
 FROM tasks t LEFT JOIN matters m ON m.id=t.matterId LEFT JOIN task_versions v ON v.taskId=t.id AND v.version=t.headVersion LEFT JOIN runs r ON r.id=t.currentRunId AND r.taskId=t.id LEFT JOIN runs prior ON prior.id=r.replacesRunId AND prior.taskId=t.id WHERE t.historyState='visible' AND EXISTS(SELECT 1 FROM tasks root WHERE root.id=t.rootTaskId AND root.historyState='visible') ORDER BY t.rowid DESC`).all() as Joined[];
 const results=db.prepare(`SELECT r.taskId,r.id,r.state,r.outcome,r.rowid AS resultOrder FROM tasks t CROSS JOIN results r INDEXED BY results_run ON r.runId=t.currentRunId
 WHERE t.currentRunId IS NOT NULL AND r.taskId=t.id AND r.version=t.headVersion AND r.completionResultId IS NULL AND r.state<>'staged'
 UNION ALL SELECT r.taskId,r.id,r.state,r.outcome,r.rowid AS resultOrder FROM results r INDEXED BY results_run JOIN tasks t ON t.id=r.taskId AND t.headVersion=r.version
 WHERE r.runId IS NULL AND t.executorKind='main' AND t.currentRunId IS NULL AND r.completionResultId IS NULL AND r.state<>'staged' ORDER BY resultOrder`).all() as {taskId:string;id:string;state:string;outcome:string|null;resultOrder:number}[];
 const deliveries=db.prepare(`SELECT d.rootTaskId,d.state,d.outcome,d.resultId FROM tasks t CROSS JOIN deliveries d ON d.rootTaskId=t.id AND d.version=t.headVersion WHERE t.parentTaskId IS NULL AND d.revokedAt IS NULL`).all() as {rootTaskId:string;state:string;outcome:string;resultId:string|null}[];
 const interactions=db.prepare(`SELECT t.id AS taskId,SUM(i.state='pending_user') AS pendingUser,SUM(i.state='pending_main') AS pendingMain,MAX(CASE WHEN i.state='pending_user' THEN i.createdAt END) AS pendingUserCreatedAt,MAX(CASE WHEN i.state='pending_main' THEN i.createdAt END) AS pendingMainCreatedAt,json_group_array(json_object('id',i.id,'after',i.rowid-1,'kind',i.kind)) FILTER(WHERE i.state='pending_user') AS pendingUsers FROM worker_interactions i JOIN runs r ON r.id=i.runId JOIN tasks t ON t.currentRunId=r.id AND t.id=r.taskId AND t.headVersion=r.contractVersion WHERE i.state IN ('pending_user','pending_main') AND r.status='running' AND r.phase NOT IN ('ended','uncertain','held') AND t.controlState='normal' AND i.runEpoch=r.epoch AND i.contractVersion=r.contractVersion AND i.threadId=r.threadId AND i.turnId=r.turnId GROUP BY t.id`).all() as {taskId:string;pendingUser:number;pendingMain:number;pendingUsers:string;pendingUserCreatedAt:number|null;pendingMainCreatedAt:number|null}[];
 const coordination=db.prepare(`SELECT t.id AS taskId,SUM(ar.state='blocked') AS blocked,SUM(ar.state='uncertain') AS uncertain
 FROM tasks t JOIN agent_messages m ON m.taskId=t.id AND m.taskVersion=t.headVersion JOIN agent_receipts ar ON ar.messageId=m.id
 WHERE ar.recipientAgentId=(SELECT value FROM meta WHERE key='mainAgentId') AND ar.state IN ('blocked','uncertain') AND m.kind<>'user_input' AND m.targetRunId IS NULL GROUP BY t.id`).all() as {taskId:string;blocked:number;uncertain:number}[];
 // Start at visible current tasks and their version PK range, then operation PK.
 const updates=db.prepare(`SELECT t.id AS taskId,t.headVersion,v.version,o.id AS operationKey,o.state,o.revision,o.detailsJson,o.responseJson
 FROM tasks t CROSS JOIN task_versions v ON v.taskId=t.id AND v.version>=t.headVersion JOIN operations o ON o.id=v.triggerOpId AND o.kind='update'
 WHERE t.historyState='visible' AND EXISTS(SELECT 1 FROM tasks root WHERE root.id=t.rootTaskId AND root.historyState='visible') ORDER BY t.id,v.version`).all() as {taskId:string;headVersion:number;version:number;operationKey:string;state:string;revision:number;detailsJson:string;responseJson:string|null}[];
 const byUpdates=new Map<string,TaskUpdateSummary[]>();
 for(const row of updates){
  const d=JSON.parse(row.detailsJson),r=JSON.parse(row.responseJson??'{}');
  if(d.version!==row.version||!['steer','queue','stop_replace'].includes(d.mode))continue;
  let stage:TaskUpdateSummary['stage'];
  if(['uncertain','failed','cancelled'].includes(row.state))stage=row.state as 'uncertain'|'failed'|'cancelled';
  else if(d.mode==='steer')stage=row.state==='confirmed'&&d.adopted===true?'adopted':d.rpcState==='received'?'received':'accepted';
  else if(d.mode==='queue')stage=row.state==='confirmed'&&r.state==='activated'?'activated':d.state==='blocked'?'blocked':'queued';
  else stage=row.state==='confirmed'&&r.state==='confirmed'?'replacement_ready':'replacing';
  if(row.version>row.headVersion&&(d.mode!=='queue'||!['queued','blocked','uncertain','failed'].includes(stage)))continue;
  const list=byUpdates.get(row.taskId)??[];list.push({operationKey:row.operationKey,version:row.version,revision:row.revision,mode:d.mode,runId:d.replacementRunId??r.runId??d.runId??null,stage});byUpdates.set(row.taskId,list);
 }
 const byCoordination=new Map(coordination.map(({taskId,...counts})=>[taskId,counts]));
 const byResult=new Map(results.map(({taskId,id,state,outcome})=>[taskId,{id,state,outcome}])),byDelivery=new Map(deliveries.map(({rootTaskId,...d})=>[rootTaskId,d])),byInteraction=new Map(interactions.map(i=>[i.taskId,i]));
 return {detailSummary:true,tasks:rows.map(({runId,status,phase,contractVersion,epoch,summary,runSourceRequestId,stopRequestedAt,threadId,turnId,rework,runCreatedAt,startedAt,endedAt,replacesRunId,errorCode,priorId,priorStatus,priorErrorCode,...t})=>({...t,previousRun:priorId?{id:priorId,status:priorStatus,errorCode:priorErrorCode}:null,updates:(byUpdates.get(t.id)??[]).slice(0,20),moreUpdates:(byUpdates.get(t.id)?.length??0)>20,rework:rework===1,coordination:byCoordination.get(t.id)??{blocked:0,uncertain:0},run:runId?{id:runId,createdAt:runCreatedAt,startedAt,endedAt,status,phase,contractVersion,epoch,summary,stopRequestedAt,threadId,turnId,replacesRunId,errorCode,sourceRequestId:runSourceRequestId}:null,result:byResult.get(t.id)??null,delivery:byDelivery.get(t.id)??null,pendingUserCreatedAt:byInteraction.get(t.id)?.pendingUserCreatedAt??null,pendingMainCreatedAt:byInteraction.get(t.id)?.pendingMainCreatedAt??null,pendingUser:byInteraction.get(t.id)?.pendingUser??0,pendingMain:byInteraction.get(t.id)?.pendingMain??0,pendingUsers:JSON.parse(byInteraction.get(t.id)?.pendingUsers??'[]')}))};
}
export function readTaskSummary(db:DatabaseSync,rootId:string):TaskDetail {
 if(!/^[\w:-]{1,100}$/.test(rootId)||!db.prepare('SELECT id FROM tasks WHERE id=? AND rootTaskId=id AND parentTaskId IS NULL').get(rootId))throw Error('task_not_found');
 const requirements=db.prepare(`SELECT t.id AS taskId,v.version,v.goal,v.acceptanceJson,v.sourceRequestId FROM tasks t JOIN task_versions v ON v.taskId=t.id AND v.version=t.headVersion WHERE t.rootTaskId=? ORDER BY t.rowid`).all(rootId) as TaskRequirement[];
 const publications=db.prepare(`SELECT id,version,resultId,historyMessageId,outcome FROM deliveries WHERE rootTaskId=? AND state='recorded' AND revokedAt IS NULL ORDER BY version DESC,rowid DESC LIMIT 81`).all(rootId) as TaskPublication[];
 return {taskId:rootId,runs:[],requirements,publications:publications.slice(0,80),morePublications:publications.length>80};
}
export function readTaskDetail(db:DatabaseSync,rootId:string):TaskDetail {
 if(!/^[\w:-]{1,100}$/.test(rootId)||!db.prepare('SELECT id FROM tasks WHERE id=? AND rootTaskId=id AND parentTaskId IS NULL').get(rootId))throw Error('task_not_found');
 const runs=db.prepare(`SELECT r.id,r.taskId,r.status,r.phase,r.contractVersion,r.epoch,r.summary,r.errorCode,r.stopRequestedAt,r.sourceRequestId,r.stateRevision,r.activeMs,r.replacesRunId,r.createdAt,r.startedAt,r.endedAt FROM runs r JOIN tasks t ON t.id=r.taskId WHERE t.rootTaskId=? ORDER BY r.createdAt DESC,r.rowid DESC LIMIT 81`).all(rootId) as TaskDetail['runs'];
 const results=db.prepare(`SELECT r.id,r.taskId,r.version,r.runId,r.state,r.outcome,r.completionResultId FROM results r JOIN tasks t ON t.id=r.taskId WHERE t.rootTaskId=? ORDER BY r.rowid DESC LIMIT 81`).all(rootId) as RecoveryFacts['results'];
 const deliveries=db.prepare(`SELECT id,rootTaskId,version,resultId,historyMessageId,state,outcome FROM deliveries WHERE rootTaskId=? ORDER BY rowid DESC LIMIT 81`).all(rootId) as RecoveryFacts['deliveries'];
 const operations=db.prepare(`SELECT o.id,o.scopeId AS taskId,o.kind,o.state,o.revision FROM operations o JOIN tasks t ON t.id=o.scopeId WHERE t.rootTaskId=? AND o.state IN ('accepted','dispatching','uncertain') ORDER BY o.rowid DESC LIMIT 81`).all(rootId) as RecoveryFacts['operations'];
 const receipts=db.prepare(`SELECT m.id AS messageId,m.taskId,m.taskVersion,ar.state,ar.revision FROM agent_messages m JOIN tasks t ON t.id=m.taskId JOIN agent_receipts ar ON ar.messageId=m.id WHERE t.rootTaskId=? AND ar.recipientAgentId=(SELECT value FROM meta WHERE key='mainAgentId') AND ar.state IN ('blocked','uncertain') AND m.kind<>'user_input' AND m.targetRunId IS NULL ORDER BY m.seq DESC LIMIT 81`).all(rootId) as RecoveryFacts['receipts'];
 const interactions=db.prepare(`SELECT i.id,i.runId,i.contractVersion,i.kind,i.state FROM worker_interactions i JOIN runs r ON r.id=i.runId JOIN tasks t ON t.id=r.taskId WHERE t.rootTaskId=? AND i.state IN ('expired','cancelled') ORDER BY i.rowid DESC LIMIT 81`).all(rootId) as RecoveryFacts['interactions'];
 const requirements=db.prepare(`SELECT v.taskId,v.version,v.goal,v.acceptanceJson,v.sourceRequestId FROM task_versions v JOIN tasks t ON t.id=v.taskId WHERE t.rootTaskId=? ORDER BY v.version DESC,v.rowid DESC LIMIT 81`).all(rootId) as TaskRequirement[];
 return {taskId:rootId,requirements:requirements.slice(0,80),runs:runs.slice(0,80),moreHistory:[requirements,runs,results,deliveries,operations,receipts,interactions].some(rows=>rows.length>80),recovery:{results:results.slice(0,80),deliveries:deliveries.slice(0,80),operations:operations.slice(0,80),receipts:receipts.slice(0,80),interactions:interactions.slice(0,80)}};
}
