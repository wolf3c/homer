// Public, fixed-template facts only. Never a tool argument/output archive.
export type ActivityAction='inspect_task'|'inspect_run'|'inspect_attachment'|'create_task'|'update_task'|'stop_task'|'continue_task';
export type ActivityOutcome='record_read'|'attachment_read'|'extraction_unavailable'|'created'|'update_accepted'|'update_queued'|'update_confirmed'|'stop_requested'|'stop_confirmed'|'stop_noop'|'continue_queued'|'continue_ready'|'operation_uncertain'|'operation_failed';
export type ActivityTarget={taskId:string;version:number;runId?:string;operationKey?:string};
export type PublicActivity={schemaVersion:1;action:ActivityAction;objectName?:string;outcome:ActivityOutcome;target?:ActivityTarget};
// Web-only, freshly authorized navigation, never persisted with the historical fact.
export type ActivityLink={task:ActivityTarget};
export const activityActions:Record<ActivityAction,string>={inspect_task:'查看任务记录',inspect_run:'查看执行记录',inspect_attachment:'读取附件材料',create_task:'创建任务',update_task:'调整任务',stop_task:'停止任务',continue_task:'续接任务'};
export const activityOutcomes:Record<ActivityOutcome,string>={record_read:'记录已读取',attachment_read:'材料已读取',extraction_unavailable:'附件记录已读取，内容当前不可读',created:'任务已创建',update_accepted:'调整已受理，尚待采用',update_queued:'后续要求已排队',update_confirmed:'新要求已就绪，尚待执行',stop_requested:'停止待确认',stop_confirmed:'已确认停止',stop_noop:'事项此前已结束',continue_queued:'续接已排队',continue_ready:'续接已就绪，尚待执行',operation_uncertain:'操作状态待核实',operation_failed:'操作未完成'};
// Only already-public display names; reject path-like or control-laden values.
export function publicActivityName(value:unknown):string|undefined{
 if(typeof value!=='string'||!value.trim()||value.length>240||/[\x00-\x1f\x7f/\\]/.test(value)||/https?:|file:|Bearer |(?:api[_-]?key|token|password)\s*[:=]/i.test(value))return;
 return value.trim();
}
