// Synthetic persisted output for channel-boundary tests; no model or transport.
import type {Homer,Message} from '../../src/service.js';
export function mainQueueOutput(app:Pick<Homer,'store'|'tasks'|'processes'|'history'>,sourceRequestId:string,id='synthetic-coordination'):Message&{type:'coordination';messageId:string;requestId:string}{
 const agentId=app.store.meta('mainAgentId')!,threadId=app.store.meta('mainThread')!;
 const root=app.tasks.createRoot({agentId,sourceRequestId},{operationId:id,title:'Synthetic Worker',executorKind:'worker',contract:{goal:'Synthetic work',inputs:[],resultKind:'structured',acceptance:{criteria:[]}},authority:{sourceRequestId,description:'Synthetic only',materials:[],resultIds:[],collaborateTaskIds:[],maxActiveMs:10000}});
 const run=app.tasks.claim(root.runId!)!;app.tasks.bind(run.id,run.epoch,'worker-'+id,'worker-turn-'+id);
 const task=app.tasks.task(root.taskId),message=app.tasks.send({agentId:task.executorAgentId,runId:run.id,epoch:run.epoch,threadId:'worker-'+id,turnId:'worker-turn-'+id},{operationId:id,taskId:task.id,version:task.headVersion,expectedTaskRevision:task.revision,recipientAgentId:agentId,kind:'progress',payload:{text:'Synthetic checked facts'}});
 const text='主 Agent 已核对合成材料，交付范围仍待确认。';
 app.processes.start({id,threadId,sourceKind:'worker',sourceMessageIds:[message.messageId],messageId:id},'main-turn-'+id);
 app.history.record(id,threadId,'','running');
 app.tasks.ack({agentId},{operationId:'ack-'+id,messageId:message.messageId,disposition:'processed',reason:'Synthetic processed'});
 app.processes.finish(id,'completed','turn:main-turn-'+id+':terminal',text);app.history.finish(id,text,'completed');
 return {type:'coordination',messageId:id,text,requestId:sourceRequestId};
}
