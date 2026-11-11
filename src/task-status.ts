import {classifyTask,type OverviewTask,type OverviewWorker} from './task-overview.js';
import {pendingUserCount,readableStatus,validPendingUsers} from './task-presentation.js';
export type StatusIcon='working'|'waiting'|'done'|'failed'|'cancelled';
export type PublicPlanStep={step:string;status:'pending'|'inProgress'|'completed'};
export type WorkerProgress={taskId:string;version:number;runId:string;epoch:number;threadId:string;turnId:string;revision:number;observedAtMs:number;plan?:PublicPlanStep[];output?:{type:'text'|'tool';text:string};next?:{id:string;text:string}[]};
export type TaskProgress={taskId:string;workers:WorkerProgress[]};
export function workerStatus(worker:OverviewWorker):{state:StatusIcon;label:string}{
 const run=worker.run;
 if(run.phase==='uncertain')return {state:'waiting',label:'状态待核实'};
 if(run.stopRequestedAt!=null&&run.phase!=='ended')return {state:'waiting',label:'停止待确认'};
 if(run.phase==='held')return {state:'waiting',label:'已暂停'};
 if(pendingUserCount(worker)>0)return {state:'waiting',label:validPendingUsers(worker).some(q=>q.kind==='authorization')?'需你审批':'需你答复'};
 if(run.phase==='ended'){
  if(run.status==='failed')return {state:'failed',label:'执行失败'};
  if(run.status==='cancelled')return {state:'cancelled',label:'本轮已停止'};
  if(run.status==='interrupted')return {state:'waiting',label:'执行已中断'};
  return run.status==='succeeded'?{state:'done',label:'已回复'}:{state:'waiting',label:'结束状态待核实'};
 }
 if(worker.pendingMain>0)return {state:'waiting',label:'主 Agent 处理中'};
 if(run.status==='running'&&run.phase==='executing')return {state:'working',label:'运行中'};
 const labels:Record<string,string>={ready:'等待调度',starting:'正在启动',parked:'等待协作事件',rpc_wait:'等待工具或交互',yielding:'正在交接',sealing:'正在收束'};
 return {state:'waiting',label:labels[run.phase]??'状态待核实'};
}
export type TaskSemanticIcon='Send'|'CornerDownRight'|'Clock3'|'LoaderCircle'|'RotateCcw'|'MessagesSquare'|'MessageCircleQuestion'|'ShieldQuestion'|'Activity'|'Inbox'|'Check'|'CircleDashed'|'CircleX'|'OctagonAlert'|'CircleStop'|'Pause'|'RefreshCw'|'CheckCheck';
export function taskCardPresentation(task:OverviewTask,worker?:OverviewWorker):{state:StatusIcon;label:string;owner:'main'|'worker'|'user'|'ended'|'unknown';icon:TaskSemanticIcon;attention:'none'|'user'}{
 const make=(state:StatusIcon,label:string,owner:'main'|'worker'|'user'|'ended'|'unknown',icon:TaskSemanticIcon,attention:'none'|'user'='none')=>({state,label,owner,icon,attention});
 if(!worker){
  if(task.controlState==='stopping')return make('waiting','停止待确认','main','CircleStop');
  if(task.state==='paused')return make('waiting','已暂停','main','Pause');
  if(task.state==='settled'){
   const label=readableStatus(task);
   return task.outcome==='failed'?make('failed',label,'ended','CircleX'):task.outcome==='cancelled'?make('cancelled',label,'ended','CircleStop'):make('done',label,'ended',task.outcome==='partial'?'CircleDashed':'Check');
  }
 }
 const members=worker?[worker]:task.workers;
 const pending=members.flatMap(validPendingUsers);
 if(members.some(w=>pendingUserCount(w)>0))return make('waiting',pending.some(q=>q.kind==='authorization')?'需你审批':'需你答复','user',pending.some(q=>q.kind==='authorization')?'ShieldQuestion':'MessageCircleQuestion','user');
 if(worker){
  const status=workerStatus(worker);
  return make(status.state,status.label,status.state==='working'?'worker':'main',status.state==='working'?'Activity':status.state==='failed'?'CircleX':status.state==='cancelled'?'CircleStop':status.state==='done'?'MessagesSquare':status.label==='状态待核实'?'Pause':'Clock3');
 }
 const classification=classifyTask(task);
 if(classification.key==='running')return make('working','运行中','worker','LoaderCircle');
 if(classification.key==='unknown')return make('waiting',classification.label,'main','Pause');
 if(classification.key==='main')return make('waiting','主 Agent 处理中','main','MessagesSquare');
 return make('waiting',classification.label,'main','Clock3');
}
export const taskOwnerLabels={main:'主 Agent',worker:'Worker',user:'你',ended:'已结束',unknown:'待核实'};
export type StatusWorker={task:OverviewTask;worker:OverviewWorker};
export type StatusMatter={task:OverviewTask;workers:StatusWorker[]};
export function statusTree(tasks:OverviewTask[]):StatusMatter[]{
 return [...new Map(tasks.map(t=>[t.id,t])).values()].filter(t=>t.historyState==='visible').map(original=>{const workers=[...new Map(original.workers.filter(w=>w.taskId===original.id&&w.run.taskId===original.id&&w.run.workerId===w.id).map(w=>[w.id,w])).values()],task={...original,workers};return {task,workers:workers.map(worker=>({task,worker}))};});
}
export type StatusFilter='working'|'done'|'needsUser';
export function statusCountSnapshot(_tasks:OverviewTask[],matters=statusTree(_tasks)){
 let done=0,unlocatedPending=0,workingKnown=true;const interactions=new Set<string>();
 const matches={working:new Set<string>(),queued:new Set<string>(),done:new Set<string>(),needsUser:new Set<string>()};
 for(const {task,workers} of matters){
  let active=false,unknown=false;
  for(const {worker} of workers){
   const run=worker.run,pending=validPendingUsers(worker),count=task.state==='open'&&task.controlState==='normal'?pendingUserCount(worker):0;
   if(count){pending.forEach(q=>interactions.add(q.id));unlocatedPending+=Math.max(0,count-pending.length);matches.needsUser.add(task.id);}
   if(run.status==='succeeded'&&run.phase==='ended'){done++;matches.done.add(task.id);}
   if(task.state!=='open'||task.controlState!=='normal')continue;
   if(run.status==='running'&&run.phase==='executing'&&run.stopRequestedAt==null)active=true;
   if(run.phase==='uncertain')unknown=true;
   if(run.status==='queued'&&run.phase==='ready')matches.queued.add(task.id);
  }
  if(active)matches.working.add(task.id);
  else if(unknown)workingKnown=false;
 }
 return {workingKnown,counts:{working:matches.working.size,queued:matches.queued.size,done,needsUser:interactions.size+unlocatedPending},matches};
}
export function matterStatus(matter:StatusMatter){return taskCardPresentation(matter.task);}
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
export function matterSortKey(matter:StatusMatter):StatusSortKey{
 const task=matter.task,workers=matter.workers.map(w=>w.worker);
 const pending=workers.filter(w=>pendingUserCount(w)>0);
 const active=workers.filter(w=>w.run.status==='running'&&w.run.phase==='executing'&&w.run.stopRequestedAt==null);
 const main=workers.filter(w=>w.pendingMain>0);
 let priority:StatusSortKey['priority']=3,enteredAtMs=statusTimeMs(task.createdAt);
 if(task.state==='settled'){priority=4;enteredAtMs=statusTimeMs(task.settledAt);}
 else if(task.controlState==='normal'&&task.state==='open'){
  if(pending.length){priority=0;enteredAtMs=Math.max(...pending.map(w=>statusTimeMs(w.pendingUserCreatedAt)));}
  else if(active.length){priority=1;enteredAtMs=Math.max(...active.map(w=>statusTimeMs(w.run.startedAt)));}
  else if(main.length){priority=2;enteredAtMs=Math.max(...main.map(w=>statusTimeMs(w.pendingMainCreatedAt)));}
  else if(workers.length)enteredAtMs=Math.max(...workers.map(w=>statusTimeMs(w.run.createdAt)));
 }
 return {priority,enteredAtMs,creationOrder:statusTimeMs(task.creationOrder),id:task.id};
}
export function compareStatusKeys(a:StatusSortKey,b:StatusSortKey):number{
 return a.priority-b.priority||(a.enteredAtMs===b.enteredAtMs?0:a.enteredAtMs>b.enteredAtMs?-1:1)||(a.creationOrder===b.creationOrder?0:a.creationOrder>b.creationOrder?-1:1)||(a.id===b.id?0:a.id<b.id?-1:1);
}
export function rankedStatusMatters(matters:StatusMatter[]):RankedStatusMatter[]{return matters.map(matter=>({matter,key:matterSortKey(matter)})).sort((a,b)=>compareStatusKeys(a.key,b.key));}
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
export function progressMatches(worker:OverviewWorker,progress:WorkerProgress){
 const run=worker.run;
 return worker.taskId===progress.taskId&&run.version===progress.version&&run.id===progress.runId&&run.epoch===progress.epoch&&run.threadId===progress.threadId&&run.turnId===progress.turnId;
}
