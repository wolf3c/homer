import {classifyTask,type OverviewTask} from './task-overview.js';
import {pendingUserCount,readableStatus,validPendingUsers} from './task-presentation.js';
export type StatusIcon='working'|'waiting'|'done'|'failed'|'cancelled';
export type PublicPlanStep={step:string;status:'pending'|'inProgress'|'completed'};
export type WorkerProgress={taskId:string;version:number;runId:string;epoch:number;threadId:string;turnId:string;revision:number;observedAtMs:number;plan?:PublicPlanStep[];output?:{type:'text'|'tool';text:string};next?:{id:string;text:string}[]};
export type TaskProgress={taskId:string;workers:WorkerProgress[]};
export function workerStatus(task:OverviewTask):{state:StatusIcon;label:string}{
 const run=task.run;
 if(task.controlState==='stopping')return {state:'waiting',label:'停止待确认'};
 if(task.state==='recovery'||run?.phase==='uncertain')return {state:'waiting',label:'状态待核实'};
 if(task.controlState==='held'||run?.phase==='held')return {state:'waiting',label:'已暂停'};
 const nativeMain=task.executorKind==='main'&&!task.currentRunId;
 const label=classifyTask(task).key==='complete'?'已正式交付':readableStatus(task);
 if(nativeMain){
  if(task.state==='settled'&&task.outcome==='cancelled')return {state:'cancelled',label:'已取消'};
  if(task.state==='settled'&&task.outcome==='failed')return {state:'failed',label:'执行失败'};
  if(task.result?.state==='accepted')return {state:'done',label};
  return {state:'waiting',label};
 }
 if(!run||run.id!==task.currentRunId||run.contractVersion!==task.headVersion)return {state:'waiting',label:'状态待核实'};
 if(run.stopRequestedAt!=null&&run.phase!=='ended')return {state:'waiting',label:'停止待确认'};
 if(run.phase==='ended'){
  if(run.status==='failed')return {state:'failed',label:'执行失败'};
  if(run.status==='cancelled')return {state:'cancelled',label:'已取消'};
  if(task.result?.outcome==='failed')return {state:'failed',label:task.result.state==='offered'?'执行失败 · 待验收':task.result.state==='accepted'?'失败成果已接受':'执行失败'};
  if(task.result?.state==='offered')return {state:'done',label:'执行已结束 · 待验收'+(task.result.outcome==='partial'?'（部分成果）':'')};
  if(task.result?.state==='accepted'||label==='已正式交付')return {state:'done',label};
  return {state:'done',label:run.status==='interrupted'?'执行已中断':run.status==='succeeded'?'执行已结束 · 待验收':'执行已结束 · 结果待核实'};
 }
 if(pendingUserCount(task)>0)return {state:'waiting',label:'待你处理'};
 if(task.pendingMain>0)return {state:'waiting',label:'等待协调者处理'};
 if(run.status==='running'&&run.phase==='executing')return {state:'working',label:task.rework?'返工中':'运行中'};
 if(run.status==='awaiting_review')return {state:'waiting',label:'等待验收'};
 return {state:'waiting',label};
}
export type TaskSemanticIcon='Send'|'CornerDownRight'|'Clock3'|'RotateCcw'|'MessagesSquare'|'MessageCircleQuestion'|'ShieldQuestion'|'Activity'|'Inbox'|'Check'|'CircleDashed'|'CircleX'|'OctagonAlert'|'CircleStop'|'Pause'|'RefreshCw'|'CheckCheck';
export function taskCardPresentation(t:OverviewTask):{state:StatusIcon;label:string;owner:'main'|'worker'|'user'|'ended'|'unknown';icon:TaskSemanticIcon;attention:'none'|'user'}{
 const make=(state:StatusIcon,label:string,owner:'main'|'worker'|'user'|'ended'|'unknown',icon:TaskSemanticIcon,attention:'none'|'user'='none')=>({state,label,owner,icon,attention});
 const r=t.run,native=t.executorKind==='main'&&!t.currentRunId;
 if(t.controlState==='stopping'||r?.stopRequestedAt!=null&&r.phase!=='ended')return make('waiting','停止待确认','main','CircleStop');
 if(t.state==='recovery'||r?.phase==='uncertain')return make('waiting','状态待核实','main','Pause');
 if(t.controlState==='held'||r?.phase==='held')return make('waiting','已暂停','main','Pause');
 const update=t.updates?.find(u=>u.version===t.headVersion);
 if(update&&['accepted','received','replacing','uncertain','failed','blocked','cancelled'].includes(update.stage)){
  const labels={accepted:'调整已受理，待采用',received:'要求已送达，待采用',replacing:'旧执行停止待确认',uncertain:'调整状态待核实',failed:'调整未完成',blocked:'后续要求受阻',cancelled:'调整已撤销'};
  return make('waiting',labels[update.stage as keyof typeof labels],'main',update.stage==='uncertain'?'Pause':'CornerDownRight');
 }
 if(!native&&(!r||r.id!==t.currentRunId||r.contractVersion!==t.headVersion))return make('waiting','状态待核实','unknown','Pause');
 if(pendingUserCount(t)>0)return make('waiting',validPendingUsers(t).some(q=>q.kind==='authorization')?'需你审批':'需你答复','user',validPendingUsers(t).some(q=>q.kind==='authorization')?'ShieldQuestion':'MessageCircleQuestion','user');
 if(t.delivery?.state==='uncertain'||t.delivery?.state==='revoked')return make('waiting',t.delivery.state==='revoked'?'交付已撤回':'交付状态待核实','main','Pause');
 if(t.result?.outcome==='partial'&&['offered','accepted'].includes(t.result.state))return make('waiting','部分成果'+(t.result.state==='offered'?' · 待核对':''),'main','CircleDashed');
 if(t.result?.state==='offered')return make('waiting','收到成果 · 待核对','main','Inbox');
 if(t.pendingMain>0)return make('waiting','主 Agent 协调中','main','MessagesSquare');
 const recovered=!!r?.replacesRunId&&t.previousRun?.id===r.replacesRunId&&['failed','interrupted'].includes(t.previousRun.status)&&t.previousRun.errorCode!=='revision_requested';
 if(classifyTask(t).key==='complete')return make('done','已正式交付','ended',recovered?'CheckCheck':'Check');
 if(r?.phase==='ended'&&r.status==='cancelled'||native&&t.state==='settled'&&t.outcome==='cancelled')return make('cancelled','已停止','ended','CircleStop');
 if(r?.phase==='ended'&&r.status==='failed'||native&&t.state==='settled'&&t.outcome==='failed')return make('failed','执行失败','main','CircleX');
 if(r?.phase==='ended'&&r.status==='interrupted')return make('waiting','执行已中断，待核实','main','Pause');
 if(t.state==='blocked')return make('waiting','任务受阻','main','OctagonAlert');
 if(t.result?.state==='accepted')return t.parentTaskId&&t.result.outcome==='succeeded'?make('done','成果已验收','ended','Check'):make('waiting','成果已验收 · 待正式交付','main','Inbox');
 if(r?.status==='running'&&r.phase==='executing')return make('working',t.rework?'返工中':recovered?'恢复执行中':'运行中','worker',t.rework?'RotateCcw':recovered?'RefreshCw':'Activity');
 if(update?.stage==='replacement_ready')return make('waiting','新要求就绪，待执行','main','CornerDownRight');
 if(t.rework)return make('waiting','待补充核验','main','RotateCcw');
 if(r?.phase==='ready'||update?.stage==='activated')return make('waiting','等待调度','main','Clock3');
 return make('waiting',workerStatus(t).label,'main','Clock3');
}
export const taskOwnerLabels={main:'主 Agent',worker:'Worker',user:'你',ended:'已结束',unknown:'待核实'};
export const taskUpdateLabels:Record<import('./task-overview.js').TaskUpdateSummary['stage'],string>={queued:'后续要求待执行',accepted:'调整已受理',received:'要求已送达，待采用',adopted:'要求已采用',activated:'已激活，待调度',replacing:'旧执行停止待确认',replacement_ready:'新要求就绪，待执行',uncertain:'调整状态待核实',failed:'调整未完成',cancelled:'调整已撤销',blocked:'后续要求受阻'};
export type StatusWorker={task:OverviewTask};
export type StatusMatter={task:OverviewTask;workers:StatusWorker[]};
export function statusTree(tasks:OverviewTask[]):StatusMatter[]{
 const unique=new Map(tasks.map(t=>[t.id,t]));
 const workers=new Map<string,StatusWorker[]>();
 for(const task of unique.values()){
  const root=unique.get(task.rootTaskId);
  if(task.executorKind!=='worker'||!root||root.parentTaskId!==null||root.id!==root.rootTaskId||
   (root.executorKind==='worker'?task.id!==root.id:task.parentTaskId!==root.id))continue;
  const group=workers.get(root.id)??[];group.push({task});workers.set(root.id,group);
 }
 return [...unique.values()].filter(t=>t.parentTaskId===null&&t.id===t.rootTaskId).map(task=>({task,
  workers:workers.get(task.id)??[]}));
}
export type StatusFilter='working'|'done'|'needsUser';
// One snapshot owns full-root work/queue membership and the existing successful
// Worker execution / pending-request units. The visible list never owns counts.
export function statusCountSnapshot(tasks:OverviewTask[],matters=statusTree(tasks)){
 let done=0,unlocatedPending=0,workingKnown=true;const interactions=new Set<string>();
 const unique=new Map(tasks.map(t=>[t.id,t])),roots=new Set(matters.map(m=>m.task.id));
 const matches={working:new Set<string>(),queued:new Set<string>(),done:new Set<string>(),needsUser:new Set<string>()};
 for(const t of unique.values()){
  const pending=validPendingUsers(t),count=pendingUserCount(t);for(const q of pending)interactions.add(q.id);unlocatedPending+=Math.max(0,count-pending.length);if(count)matches.needsUser.add(t.rootTaskId);
  // Reuse current execution facts, including native roots with an independent
  // Run and nested Workers. Orphans/cycles cannot contribute to a user root.
  const root=unique.get(t.rootTaskId);
  if(!root||!roots.has(root.id))continue;
  let member:OverviewTask|undefined=t;const path=new Set<string>();
  while(member&&member.id!==root.id&&!path.has(member.id)){
   path.add(member.id);member=member.parentTaskId?unique.get(member.parentTaskId):undefined;
   if(member?.rootTaskId!==root.id)member=undefined;
  }
  if(member?.id!==root.id)continue;
  if(workerStatus(t).label==='状态待核实')workingKnown=false;
  if(root.controlState!=='normal'||root.state==='recovery'||root.state==='settled'||root.run?.phase==='uncertain'||root.run?.phase==='held')continue;
  if(workerStatus(t).state==='working')matches.working.add(root.id);
  if(classifyTask(t).key==='queued')matches.queued.add(root.id);
 }
 // Preserve the existing confirmed-successful-execution unit for this filter.
 matters.forEach(m=>m.workers.forEach(({task:t})=>{
  const r=t.run;
  if(workerStatus(t).state==='done'&&r?.phase==='ended'&&(r.status==='succeeded'||r.status==='awaiting_review'&&t.result?.state==='offered'&&t.result.outcome==='succeeded')){done++;matches.done.add(m.task.id);}
 }));
 return {workingKnown,counts:{working:matches.working.size,queued:matches.queued.size,done,needsUser:interactions.size+unlocatedPending},matches};
}
export function statusCounts(tasks:OverviewTask[],matters=statusTree(tasks)){
 return statusCountSnapshot(tasks,matters).counts;
}
export function matterStatus(matter:StatusMatter):{state:StatusIcon;label:string}{
 const t=matter.task,own=workerStatus(t);
 if(!matter.workers.length||t.currentRunId||t.controlState!=='normal'||t.state==='recovery'||t.state==='settled'||t.result||t.delivery)return own;
 const workers=matter.workers.map(w=>w.task);
 const statuses=workers.map(workerStatus),counts=statusCounts([t,...workers]);
 if(statuses.some(s=>s.state==='working'))return {state:'working',label:counts.needsUser?counts.needsUser+' 待处理':matter.workers.length+' Worker'};
 if(counts.needsUser)return {state:'waiting',label:counts.needsUser+' 待处理'};
 const unresolved=statuses.find(s=>s.state==='waiting');if(unresolved)return unresolved;
 if(statuses.some(s=>s.state==='failed'))return {state:'waiting',label:'有 Worker 执行失败'};
 if(statuses.some(s=>s.state==='cancelled'))return {state:'waiting',label:'有 Worker 已取消'};
 if(statuses.some(s=>s.label==='执行已中断'))return {state:'waiting',label:'有 Worker 执行中断'};
 // Child completion never claims root acceptance or formal delivery.
 return {state:'waiting',label:'待协调者验收'};
}
// Display-only keys: normalize each member once; comparison never reads clocks.
export type StatusSortKey={priority:0|1|2|3|4;enteredAtMs:number;creationOrder:number;id:string};
export type RankedStatusMatter={matter:StatusMatter;key:StatusSortKey};
function statusTimeMs(value:unknown):number{
 if(typeof value==='string'){
  if(/^(0|[1-9]\d*)$/.test(value))value=Number(value);
  else{
   const match=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
   if(!match)return -Infinity;
   const [,y,m,d,h,mi,se,,zone]=match,year=Number(y),month=Number(m),day=Number(d);
   const days=new Date(Date.UTC(year,month,0)).getUTCDate();
   if(month<1||month>12||day<1||day>days||Number(h)>23||Number(mi)>59||Number(se)>59||zone!=='Z'&&(Number(zone!.slice(1,3))>23||Number(zone!.slice(4))>59))return -Infinity;
   value=Date.parse(value);
  }
 }
 return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:-Infinity;
}
function memberSortFact(t:OverviewTask):Pick<StatusSortKey,'priority'|'enteredAtMs'>{
 const r=t.run,native=t.executorKind==='main'&&t.currentRunId===null;
 const current=!!r&&r.id===t.currentRunId&&r.contractVersion===t.headVersion;
 const waiting=()=>{const saved=statusTimeMs(t.waitingEnteredAt);return {priority:3 as const,enteredAtMs:saved!==-Infinity?saved:current&&r.stopRequestedAt!=null?statusTimeMs(r.stopRequestedAt):current&&r.status==='queued'&&r.phase==='ready'?statusTimeMs(r.createdAt):-Infinity};};
 if(t.controlState!=='normal'||t.state==='recovery'||!native&&!current||r?.phase==='uncertain'||r?.phase==='held'||current&&r.stopRequestedAt!=null&&r.phase!=='ended')return waiting();
 if(pendingUserCount(t)>0)return {priority:0,enteredAtMs:statusTimeMs(t.pendingUserCreatedAt)};
 const pendingMain=current&&r.status==='running'&&!['ended','uncertain','held'].includes(r.phase)&&t.pendingMain>0;
 const delivery=t.parentTaskId===null&&t.delivery&&(t.result?t.delivery.resultId===t.result.id:t.state==='settled'&&t.delivery.resultId===null)?t.delivery:null;
 const closed=native||current&&r.phase==='ended';
 const review=closed&&(t.result?.state==='offered'||r?.status==='awaiting_review'||t.parentTaskId===null&&t.result?.state==='accepted'&&delivery?.state!=='recorded')||!!delivery&&['prepared','submitting','uncertain'].includes(delivery.state);
 if(pendingMain||review){
  const saved=statusTimeMs(t.reviewEnteredAt),historical=closed&&t.result&&['offered','accepted'].includes(t.result.state)&&current?statusTimeMs(r.endedAt):-Infinity;
  return {priority:2,enteredAtMs:Math.max(pendingMain?statusTimeMs(t.pendingMainCreatedAt):-Infinity,review?(saved===-Infinity?historical:saved):-Infinity)};
 }
 if(current&&r.status==='running'&&r.phase==='executing')return {priority:1,enteredAtMs:statusTimeMs(r.startedAt)};
 if(current&&r.phase==='ended'||native&&t.state==='settled')return {priority:4,enteredAtMs:statusTimeMs(current?r.endedAt:t.settledAt)};
 return waiting();
}
export function matterSortKey(matter:StatusMatter):StatusSortKey{
 const root=matter.task,members=[...new Map([root,...matter.workers.map(w=>w.task)].map(t=>[t.id,t])).values()];
 let facts=members.map(memberSortFact);
 // A native structural root becomes reviewable when every child is accepted.
 if(root.executorKind==='main'&&!root.currentRunId&&root.controlState==='normal'&&root.state!=='recovery'&&root.state!=='settled'&&!root.result&&!root.delivery&&matter.workers.length){
  const children=members.filter(t=>t.id!==root.id);
  const ready=children.every(t=>t.controlState==='normal'&&t.state!=='recovery'&&t.run?.id===t.currentRunId&&t.run.contractVersion===t.headVersion&&t.run.phase==='ended'&&t.run.status==='succeeded'&&t.result?.state==='accepted'&&['succeeded','partial'].includes(t.result.outcome??'')&&t.pendingUser===0&&t.pendingMain===0);
  if(ready)facts=[{priority:2,enteredAtMs:Math.max(...facts.slice(1).map(f=>f.enteredAtMs))}];
 }
 const priority=Math.min(...facts.map(f=>f.priority)) as StatusSortKey['priority'];
 return {priority,enteredAtMs:Math.max(...facts.filter(f=>f.priority===priority).map(f=>f.enteredAtMs)),creationOrder:statusTimeMs(root.creationOrder),id:root.id};
}
export function compareStatusKeys(a:StatusSortKey,b:StatusSortKey):number{
 return a.priority-b.priority||(a.enteredAtMs===b.enteredAtMs?0:a.enteredAtMs>b.enteredAtMs?-1:1)||(a.creationOrder===b.creationOrder?0:a.creationOrder>b.creationOrder?-1:1)||(a.id===b.id?0:a.id<b.id?-1:1);
}
export function rankedStatusMatters(matters:StatusMatter[]):RankedStatusMatter[]{
 return matters.map(matter=>({matter,key:matterSortKey(matter)})).sort((a,b)=>compareStatusKeys(a.key,b.key));
}
export function statusVisibleLimit(ranked:readonly RankedStatusMatter[],requested:number,retainedIds:readonly string[]=[]):number{
 const retained=new Set(retainedIds);let limit=requested;
 ranked.forEach((r,i)=>{if(r.key.priority<4||retained.has(r.key.id))limit=Math.max(limit,i+1);});
 return Math.min(ranked.length,limit);
}
export function linearPlanIndex(steps:PublicPlanStep[]):number|null{
 if(!steps.length)return null;
 let done=0;while(steps[done]?.status==='completed')done++;
 if(done===steps.length)return done;
 return steps[done]?.status==='inProgress'&&steps.slice(done+1).every(s=>s.status==='pending')?done:null;
}
export function progressMatches(task:OverviewTask,progress:WorkerProgress){
 const r=task.run;return !!r&&r.id===task.currentRunId&&r.contractVersion===task.headVersion&&task.id===progress.taskId&&task.headVersion===progress.version&&task.currentRunId===progress.runId&&r.epoch===progress.epoch&&r.threadId===progress.threadId&&r.turnId===progress.turnId;
}
