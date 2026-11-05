export const PROGRESS_LABELS=['检查资料','执行任务','核对成果','整理交付','创建任务','任务已创建','未创建任务','创建结果待核对','检查协作请求','答复协作请求','转交用户确认','发送协作消息','调用工具'] as const;
export type MainProgress={id:string;label:typeof PROGRESS_LABELS[number]}&({phase:'start'}|{phase:'end';status:'completed'|'failed'|'blocked'});
export function progressLabel(tool:string):MainProgress['label']{
 if(['inspect_attachment','inspect_result_file','read_material','work_inspect','worker_read','list_work'].includes(tool))return '检查资料';
 if(tool==='task_create')return '创建任务';
 if(['task_update','worker_open','worker_interrupt'].includes(tool))return '执行任务';
 if(tool==='accept_result')return '核对成果';
 if(tool==='publish_delivery')return '整理交付';
 if(tool==='inspect_interaction')return '检查协作请求';
 if(tool==='respond_interaction')return '答复协作请求';
 if(tool==='escalate_interaction')return '转交用户确认';
 if(tool==='worker_send')return '发送协作消息';
 return '调用工具';
}
