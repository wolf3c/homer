// Synthetic public DTOs only; importing this helper starts no server or engine.
export function overviewTask(id,extra={}){
 const workerId='worker-'+id;
 return {id,title:'合成任务 '+id,goal:'合成任务 '+id,notes:'',headVersion:1,revision:1,state:'open',outcome:null,controlState:'normal',historyState:'visible',sourceRequestId:null,workers:[{id:workerId,taskId:id,title:'合成 Worker',pendingUser:0,pendingMain:0,pendingUsers:[],run:{id:'run-'+id,workerId,taskId:id,version:1,epoch:0,status:'running',phase:'executing',sourceRequestId:null}}],results:[],deliveries:[],...extra};
}
export function workerNamed(overview,title){
 for(const task of overview.tasks){const worker=task.workers.find(w=>w.title===title);if(worker)return {task,worker};}
 throw Error('synthetic_worker_missing: '+title);
}
export function changeWorker(overview,title,change){
 return {...overview,tasks:overview.tasks.map(task=>({...task,workers:task.workers.map(worker=>worker.title===title?change(worker):worker)}))};
}
export function cloneTask(task,suffix,extra={}){
 const id=task.id+suffix;
 return {...task,id,workers:task.workers.map(worker=>({...worker,id:worker.id+suffix,taskId:id,pendingUsers:worker.pendingUsers.map(q=>({...q,id:q.id+suffix})),run:{...worker.run,id:worker.run.id+suffix,workerId:worker.id+suffix,taskId:id}})),results:task.results.map(r=>({...r,id:r.id+suffix})),deliveries:task.deliveries.map(d=>({...d,id:d.id+suffix,resultIds:d.resultIds.map(id=>id+suffix)})),...extra};
}
