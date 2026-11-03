// Synthetic test setup through the real task/result/publication contracts.
import type {Homer} from '../src/service.js';
import type {Actor} from '../src/recursive-tasks.js';
export function syntheticFile(app:Homer,sourceRequestId:string,filename='synthetic.md',content:string|Buffer='# Synthetic result',additionalFiles:{filename:string;content:string}[]=[],binary=false){
  const main:Actor={agentId:app.store.meta('mainAgentId')!,sourceRequestId};
  const root=app.tasks.createRoot(main,{operationId:'synthetic-file:'+sourceRequestId,title:'Synthetic file',executorKind:'worker',contract:{goal:'Synthetic file',inputs:[],resultKind:'markdown',acceptance:{criteria:[]}},authority:{sourceRequestId,description:'Synthetic authorized file only',materials:[],resultIds:[],collaborateTaskIds:[],maxActiveMs:10000}});
  const run=app.tasks.claim(root.runId!)!,worker:Actor={agentId:root.agentId,runId:run.id,epoch:run.epoch,threadId:'synthetic-file-worker',turnId:'synthetic-file-turn'};
  app.tasks.bind(run.id,run.epoch,worker.threadId!,worker.turnId!);app.tasks.markMaterialRead(worker);
  const file=binary?app.tasks.writeFile(worker,{operationId:'synthetic-write',filename,bytes:typeof content==='string'?Buffer.from(content):content}):app.tasks.writeMarkdown(worker,{operationId:'synthetic-write',filename,content:typeof content==='string'?content:content.toString('utf8')});
  const files=[file,...additionalFiles.map((item,index)=>app.tasks.writeMarkdown(worker,{operationId:'synthetic-write-'+index,...item}))];
  app.tasks.endSegment(worker.runId!,worker.epoch!,{status:'completed',text:'Synthetic final result'},true)!;
  app.tasks.endSegment(run.id,run.epoch,{status:'completed',text:'Synthetic final result'},true);files.forEach(file=>app.tasks.inspect(main,{resultId:file.resultId}));app.tasks.review(main,{operationId:'synthetic-review',taskId:root.taskId,version:1,expectedTaskRevision:app.tasks.task(root.taskId).revision,resultId:file.resultId,accepted:true,outcome:'succeeded',reason:'Synthetic bytes inspected'});
  return {run:app.store.run(run.id)!,resultId:file.resultId,resultIds:files.map(file=>file.resultId),publish(text='Synthetic formal result'){
    const d=app.tasks.publish(main,{operationId:'synthetic-publish',taskId:root.taskId,version:1,expectedTaskRevision:app.tasks.task(root.taskId).revision,resultId:file.resultId,publishedFileResultId:file.resultId,...(additionalFiles.length?{publishedFileResultIds:files.map(file=>file.resultId)}:{}),text});app.tasks.markDelivery(d.deliveryId,'submitting');return app.tasks.delivery(d.deliveryId);
  }};
}
