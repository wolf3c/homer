import {classifyTask,type OverviewTask,type OverviewWorker} from './task-overview.js';
export type StatusIcon='working'|'waiting'|'done'|'failed'|'cancelled';
export type PublicPlanStep={step:string;status:'pending'|'inProgress'|'completed'};
export type WorkerProgress={taskId:string;version:number;runId:string;epoch:number;threadId:string;turnId:string;revision:number;observedAtMs:number;plan?:PublicPlanStep[];output?:{type:'text'|'tool';text:string};next?:{id:string;text:string}[]};
export type TaskProgress={taskId:string;workers:WorkerProgress[]};
export function workerStatus(worker:OverviewWorker):{state:StatusIcon;label:string}{
 const run=worker.run;
 if(run.phase==='uncertain')return {state:'waiting',label:'状态待核实'};
 if(run.stopRequestedAt!=null&&run.phase!=='ended')return {state:'waiting',label:'停止待确认'};
 if(run.phase==='held')return {state:'waiting',label:'已暂停'};
 if(run.phase==='ended'){
  if(run.status==='failed')return {state:'failed',label:'执行失败'};
  if(run.status==='cancelled')return {state:'cancelled',label:'本轮已停止'};
  if(run.status==='interrupted')return {state:'waiting',label:'执行已中断'};
  return run.status==='succeeded'?{state:'done',label:'已回复'}:{state:'waiting',label:'结束状态待核实'};
 }
 if(worker.pendingMain>0)return {state:'waiting',label:worker.pendingMainApprovals?`等待 Homer 审批 ${worker.pendingMainApprovals}`:worker.pendingMainQuestions?`等待 Homer 答复 ${worker.pendingMainQuestions}`:'Homer处理中'};
 if(run.status==='running'&&run.phase==='executing')return {state:'working',label:'运行中'};
 const labels:Record<string,string>={ready:'等待调度',starting:'正在启动',parked:'等待协作事件',rpc_wait:'等待工具或交互',yielding:'正在交接',sealing:'正在收束'};
 return {state:'waiting',label:labels[run.phase]??'状态待核实'};
}
export type TaskSemanticIcon='Send'|'CornerDownRight'|'Clock3'|'LoaderCircle'|'RotateCcw'|'MessagesSquare'|'MessageCircleQuestion'|'ShieldQuestion'|'Activity'|'Inbox'|'Check'|'CircleDashed'|'CircleX'|'OctagonAlert'|'CircleStop'|'Pause'|'RefreshCw'|'CheckCheck';
export function taskCardPresentation(task:OverviewTask,worker?:OverviewWorker):{state:StatusIcon;label:string;icon:TaskSemanticIcon}{
 if(!worker)return {state:'waiting',label:classifyTask(task).label,icon:'Pause'};
 const status=workerStatus(worker);
 const icon=status.state==='working'?'Activity':status.state==='failed'?'CircleX':status.state==='cancelled'?'CircleStop':status.state==='done'?'MessagesSquare':status.label==='状态待核实'?'Pause':'Clock3';
 return {...status,icon};
}
export type StatusMatter={task:OverviewTask};
export function statusTree(tasks:OverviewTask[],historyState:OverviewTask['historyState']='visible'):StatusMatter[]{
 return [...new Map(tasks.map(t=>[t.id,t])).values()].filter(t=>t.historyState===historyState).map(original=>{const workers=[...new Map(original.workers.filter(w=>w.taskId===original.id&&w.run.taskId===original.id&&w.run.workerId===w.id).map(w=>[w.id,w])).values()],task={...original,workers};return {task};});
}
export function matterStatus(matter:StatusMatter){return taskCardPresentation(matter.task);}
export type StatusSortKey={priority:1|2;enteredAtMs:number;creationOrder:number;id:string};
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
 const task=matter.task;
 return {priority:classifyTask(task).key==='unknown'?1:2,enteredAtMs:statusTimeMs(task.createdAt),creationOrder:statusTimeMs(task.creationOrder),id:task.id};
}
export function compareStatusKeys(a:StatusSortKey,b:StatusSortKey):number{
 return a.priority-b.priority||(a.enteredAtMs===b.enteredAtMs?0:a.enteredAtMs>b.enteredAtMs?-1:1)||(a.creationOrder===b.creationOrder?0:a.creationOrder>b.creationOrder?-1:1)||(a.id===b.id?0:a.id<b.id?-1:1);
}
export function rankedStatusMatters(matters:StatusMatter[]):RankedStatusMatter[]{return matters.map(matter=>({matter,key:matterSortKey(matter)})).sort((a,b)=>compareStatusKeys(a.key,b.key));}
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
