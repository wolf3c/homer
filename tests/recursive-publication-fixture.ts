// Exact bytes adopted through the real new Task/Worker/Result owners.
import type {Homer} from '../src/service.js';
import type {Actor} from '../src/recursive-tasks.js';
export function syntheticFile(app:Homer,sourceRequestId:string,filename='synthetic.md',content:string|Buffer='# Synthetic result',additionalFiles:{filename:string;content:string}[]=[],binary=false){
 const main:Actor={agentId:app.store.meta('mainAgentId')!,sourceRequestId,threadId:app.store.meta('mainThread')!};
 const task=app.tasks.createTask(main,{operationId:'synthetic-file:'+sourceRequestId+':'+filename,goal:'Synthetic file',authority:{sourceRequestId,description:'Synthetic authorized file only',materials:[],resultIds:[]}});
 const opened=app.tasks.workerOpen(main,{operationId:'synthetic-open',taskId:task.taskId,text:'Prepare exact synthetic files'}),run=app.tasks.claim(opened.runId)!;
 app.tasks.bind(run.id,run.epoch,'synthetic-file-thread:'+run.id,'synthetic-file-turn:'+run.id);
 const directory=app.files.prepareRun(task.taskId,run.id),sources=[{filename,content},...additionalFiles];
 const paths=sources.map((item,index)=>index===0&&binary?app.files.writeBinary(directory,item.filename,Buffer.isBuffer(item.content)?item.content:Buffer.from(item.content)):app.files.writeMarkdown(directory,item.filename,typeof item.content==='string'?item.content:item.content.toString('utf8')));
 app.tasks.endSegment(run.id,run.epoch,{status:'completed',text:'Synthetic final result'},true);
 const files=paths.map((filePath,index)=>app.tasks.adoptResult(main,{operationId:'synthetic-adopt:'+index,taskId:task.taskId,version:1,runId:run.id,filePath}));
 return {run:app.tasks.run(run.id),resultId:files[0]!.resultId,resultIds:files.map(file=>file.resultId),publish(text='Synthetic formal result'){
  const delivery=app.tasks.publish(main,{operationId:'synthetic-publish',taskId:task.taskId,version:1,resultIds:files.map(file=>file.resultId),text});
  app.tasks.markDelivery(delivery.deliveryId,'submitting');return app.tasks.delivery(delivery.deliveryId);
 }};
}
