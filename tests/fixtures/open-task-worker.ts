// Exercise both Main tool calls when a fixture needs a running Worker.
export async function openTaskWorker<T>(main:{call(tool:string,args:unknown):Promise<T>},title:string,goal=title,options:Record<string,unknown>={}):Promise<T>{
 const {taskId}=await main.call('task_create',{title,goal}) as {taskId:string};
 return main.call('worker_open',{taskId,...options});
}
