import {classifyTask,classifyRoot,type OverviewTask} from './task-overview.js';

// Presentation only: never persisted, scheduled or described as a generated summary.
export function taskName(task:OverviewTask,index?:number){
 const title=task.title?.trim();
 if(title&&title.length<=64)return {text:title,source:'事项名称'};
 const first=task.goal?.trim().split(/[。！？\n]/u)[0]?.trim();
 if(first&&first.length<=36)return {text:first,source:'要求首句'};
 return {text:index===undefined?'未命名事项':`子任务 ${index}`,source:'名称未记录'};
}
export function validPendingUsers(task:OverviewTask){
 return pendingUserCount(task)?task.pendingUsers??[]:[];
}
export function pendingUserCount(task:OverviewTask){
 const run=task.run;
 return task.pendingUser>0&&task.controlState==='normal'&&run?.id===task.currentRunId&&run.contractVersion===task.headVersion&&run.status==='running'&&!['ended','uncertain','held'].includes(run.phase)?task.pendingUser:0;
}
export function readableStatus(task:OverviewTask,members?:OverviewTask[]){
 const current=task.controlState==='normal'&&task.state!=='recovery'&&task.run?.phase!=='uncertain'&&(!task.currentRunId&&task.executorKind==='main'||task.run?.id===task.currentRunId&&task.run?.contractVersion===task.headVersion);
 if(current&&task.parentTaskId&&task.result?.state==='accepted')return task.result.outcome==='partial'?'已验收部分成果':task.result.outcome==='succeeded'?'成果已验收':'成果已接受，结论待核实';
 if(current&&task.parentTaskId&&task.result?.state==='offered')return '待协调者验收';
 const status=members?classifyRoot(task,members):classifyTask(task);
 return status.label==='取消请求待确认'?'停止待确认':status.label==='主 Agent 事项，尚无独立 Run'?'已记录，进展未确认':status.label==='候选待主 Agent 验收'?'成果待验收':status.label==='待主 Agent 处理'?'等待协调者处理':status.label;
}
export function taskProgress(task:OverviewTask,members:OverviewTask[]=[task]){
 const pending=members.reduce((n,t)=>n+pendingUserCount(t),0);
 if(pending)return `${pending} 项需你答复；主状态与待答分别核对`;
 if(task.controlState==='stopping')return '已记录停止请求，原执行结束尚未确认';
 const offered=members.filter(t=>t.result?.state==='offered').length;
 if(offered)return `${offered} 份候选成果等待验收`;
 if(task.delivery?.state==='recorded')return task.delivery.outcome==='partial'?'已记录部分成果的正式交付':'已记录正式交付；验收与执行见详情';
 if(task.delivery?.state==='uncertain')return '正式交付是否完成尚待核实';
 const accepted=members.filter(t=>t.parentTaskId&&t.result?.state==='accepted').length;
 if(accepted)return `${accepted} 项子任务成果已验收；根事项交付另行核对`;
 const active=members.filter(t=>t.run?.id===t.currentRunId&&t.run.contractVersion===t.headVersion&&t.run.status==='running'&&t.run.phase==='executing').length;
 return active?`${active} 项正在执行；尚无新的成果记录`:'尚无可确认的进展记录';
}
