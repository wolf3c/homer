// Synthetic persisted output through the real Task/Worker and host receipt owners.
import type {Homer,Message} from '../../src/service.js';
import {MainInputs} from '../../src/recursive-main-inputs.js';
export function mainQueueOutput(app:Pick<Homer,'store'|'tasks'|'processes'|'history'>,sourceRequestId:string,id='synthetic-coordination'):Message&{type:'coordination';messageId:string;requestId:string}{
 const agentId=app.store.meta('mainAgentId')!,threadId=app.store.meta('mainThread')!,actor={agentId,threadId,sourceRequestId};
 const task=app.tasks.createTask(actor,{operationId:id,goal:'Synthetic work',authority:{sourceRequestId,description:'Synthetic only'}});
 const opened=app.tasks.workerOpen(actor,{operationId:'open-'+id,taskId:task.taskId,text:'Synthetic work'}),run=app.tasks.claim(opened.runId)!;
 app.tasks.bind(run.id,run.epoch,'worker-'+id,'worker-turn-'+id);
 const returned=app.tasks.endSegment(run.id,run.epoch,{status:'completed',text:'Synthetic checked facts'},true)!;
 const inputs=new MainInputs(app.tasks,app.history),input=inputs.claim([],'all');if(!input||input.origin!=='worker'||input.messageId!==returned.messageId)throw Error('synthetic_coordination_not_claimed');
 inputs.started(input.messageId,input.revision,id,'main-turn-'+id);
 const text='主 Agent 已核对合成材料，交付范围仍待确认。';
 app.processes.start({id,threadId,sourceKind:'worker',sourceMessageIds:[input.messageId],messageId:id},'main-turn-'+id);
 app.history.record(id,threadId,'','running');
 app.store.transaction(()=>app.tasks.completeMainMessagesInTransaction([input.messageId],id));
 app.processes.finish(id,'completed','turn:main-turn-'+id+':terminal',text);app.history.finish(id,text,'completed');
 return {type:'coordination',messageId:id,text,requestId:sourceRequestId};
}
