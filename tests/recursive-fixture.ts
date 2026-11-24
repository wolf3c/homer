// Real Task/Worker APIs and isolated SQLite; no model, account or channel.
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {Store} from '../src/store.js';
import {WorkerInteractions} from '../src/worker-interactions.js';
import {Files} from '../src/files.js';
import {ConversationHistory} from '../src/web-history.js';
import {MainInputs} from '../src/recursive-main-inputs.js';
import {RecursiveTasks,type Actor,type Authority} from '../src/recursive-tasks.js';
import {MainProcessHistory} from '../src/main-process.js';

export const main:Actor={agentId:'main:synthetic',threadId:'thread:synthetic-main',turnId:'turn:synthetic-main',sourceRequestId:'user-synthetic'};
export const authority=(sourceRequestId='user-synthetic'):Authority=>({sourceRequestId,description:'Synthetic authorized local work'});
export function fixture(scratch='.codex/scratch/chat-architecture-implementation-20261105/e-runtime'){
 mkdirSync(scratch,{recursive:true});const dir=mkdtempSync(join(resolve(scratch),'test-'));
 const store=new Store(join(dir,'homer.sqlite')),files=new Files(join(dir,'workspace'));
 new WorkerInteractions(store.db);const tasks=new RecursiveTasks(store,files);tasks.migrate();
 store.setMeta('mainAgentId',main.agentId);store.setMeta('mainThread',main.threadId!);
 const history=new ConversationHistory(store.db),inputs=new MainInputs(tasks,history),processes=new MainProcessHistory(store.db);
 const source=(requestId:string,text='Synthetic permission for local work')=>{
  inputs.accept({requestId,text});
  for(;;){const q=inputs.claim([],'all');if(!q)throw Error('synthetic_source_not_claimable');
   const generation='generation:'+q.messageId,turn='turn:'+q.messageId;
   if(q.origin!=='user'){
    store.transaction(()=>{processes.start({id:generation,threadId:main.threadId!,sourceKind:'worker',sourceMessageIds:[q.messageId],messageId:generation},turn);tasks.receiveMainMessagesInTransaction([q.messageId],turn);});
    processes.finish(generation,'completed','turn:'+turn+':terminal:completed');
   }else {inputs.started(q.messageId,q.revision,generation,turn);inputs.finish(q.messageId,q.revision,'completed');store.finishRequest(q.input.requestId,'Synthetic source handled');}
   if(q.origin==='user'){if(q.input.requestId!==requestId)throw Error('synthetic_source_order_conflict');break;}
  }
  return {...main,sourceRequestId:requestId};
 };
 source(main.sourceRequestId!);
 const task=tasks.createTask(main,{operationId:'create',goal:'Check synthetic input; preserve unknown dates'});
 return {dir,store,tasks,files,history,inputs,processes,source,task,close(){store.close();rmSync(dir,{recursive:true,force:true});}};
}
export type Fixture=ReturnType<typeof fixture>;
export function mutation(f:Fixture,operationId:string,taskId=f.task.taskId){return {operationId,taskId,expectedRevision:f.tasks.task(taskId).revision};}
export function openWorker(f:Fixture,operationId='open',taskId=f.task.taskId,text='Inspect synthetic input'){
 return f.tasks.workerOpen(main,{operationId,taskId,text});
}
export function running(f:Fixture,runId:string):Actor{
 const run=f.tasks.claim(runId)!;if(!run)throw Error('synthetic_run_not_claimable');
 const threadId=run.threadId??'thread:'+run.workerId,turnId='turn:'+run.id;
 f.tasks.bind(run.id,run.epoch,threadId,turnId);
 return {agentId:'worker:'+run.workerId,runId:run.id,epoch:run.epoch,threadId,turnId};
}
export function complete(f:Fixture,actor:Actor,text='Checked synthetic input; date remains unknown.',confirmed=true){
 return f.tasks.endSegment(actor.runId!,actor.epoch!,{status:'completed',text},confirmed)!;
}
export function processReplies(f:Fixture,turnId='main:processed'){
 for(;;){const q=f.inputs.claim([],'all');if(!q)return;if(q.origin!=='worker')throw Error('synthetic_expected_worker_reply');
  const generation='generation:'+q.messageId;
  f.store.transaction(()=>{f.processes.start({id:generation,threadId:main.threadId!,sourceKind:'worker',sourceMessageIds:[q.messageId],messageId:generation},turnId);f.tasks.receiveMainMessagesInTransaction([q.messageId],turnId);});
  f.processes.finish(generation,'completed','turn:'+turnId+':terminal:completed');
 }
}
