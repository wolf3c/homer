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
export function taskProgress(task:OverviewTask){
 const pending=task.workers.reduce((n,w)=>n+pendingUserCount(w),0);
 if(pending)return `${pending} 项需你处理`;
 if(task.controlState==='stopping')return '已记录停止请求，执行结束尚待确认';
 if(task.state==='settled')return readableStatus(task);
 const active=task.workers.filter(w=>w.run.status==='running'&&w.run.phase==='executing'&&w.run.stopRequestedAt==null).length;
 return active?`${active} 个 Worker 正在执行`:task.workers.length?'Worker 会话可继续追问':'事项已记录';
}
