// Synthetic public DTOs only; importing this helper starts no server or engine.
export function overviewTask(id,extra={}){
 const workerId='worker-'+id;
 return {id,title:'合成任务 '+id,goal:'合成任务 '+id,notes:'',headVersion:1,revision:1,state:'open',historyState:'visible',sourceRequestId:null,workers:[{id:workerId,taskId:id,title:'合成 Worker',pendingMain:0,run:{id:'run-'+id,workerId,taskId:id,version:1,epoch:0,status:'running',phase:'executing',sourceRequestId:null}}],...extra};
}
export function cloneTask(task,suffix,extra={}){
 const id=task.id+suffix;
 return {
  ...task,id,
  workers:task.workers.map(worker=>({
   ...worker,id:worker.id+suffix,taskId:id,
   run:{...worker.run,id:worker.run.id+suffix,workerId:worker.id+suffix,taskId:id},
  })),
  ...extra,
 };
}
