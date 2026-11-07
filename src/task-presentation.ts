import {classifyTask,type OverviewTask,type OverviewWorker} from './task-overview.js';

export function taskName(task:Pick<OverviewTask,'title'|'goal'>,index?:number){
 const title=task.title?.trim();
 if(title&&title.length<=64)return {text:title,source:'事项名称'};
 const first=task.goal?.trim().split(/[。！？\n]/u)[0]?.trim();
 if(first&&first.length<=36)return {text:first,source:'要求首句'};
 return {text:index===undefined?'未命名事项':`Worker ${index}`,source:'名称未记录'};
}
export function pendingUserCount(worker:OverviewWorker){
 return worker.pendingUser>0&&worker.run.status==='running'&&!['ended','uncertain','held'].includes(worker.run.phase)?worker.pendingUser:0;
}
export function validPendingUsers(worker:OverviewWorker){return pendingUserCount(worker)?worker.pendingUsers:[];}
export function readableStatus(task:OverviewTask){return classifyTask(task).label;}
