import type {OverviewWorker} from './task-overview.js';
export type PublicPlanStep={step:string;status:'pending'|'inProgress'|'completed'};
export type WorkerProgress={taskId:string;version:number;runId:string;epoch:number;threadId:string;turnId:string;revision:number;observedAtMs:number;plan?:PublicPlanStep[];output?:{type:'text'|'tool';text:string};next?:{id:string;text:string}[]};
export type TaskProgress={taskId:string;workers:WorkerProgress[]};
export type TaskSemanticIcon='Send'|'CornerDownRight'|'Clock3'|'LoaderCircle'|'RotateCcw'|'MessagesSquare'|'MessageCircleQuestion'|'ShieldQuestion'|'Activity'|'Inbox'|'Check'|'CircleDashed'|'CircleX'|'OctagonAlert'|'CircleStop'|'Pause'|'RefreshCw'|'CheckCheck';
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
