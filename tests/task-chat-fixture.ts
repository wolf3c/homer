// Isolated core protocol: real Store/SQLite/history/input queue, no engine or account.
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {Store} from '../src/store.js';
import {Files} from '../src/files.js';
import {ConversationHistory} from '../src/web-history.js';
import {MainInputs} from '../src/recursive-main-inputs.js';
import {RecursiveTasks,type Actor,type Authority,type RecursiveTaskLifecycle} from '../src/recursive-tasks.js';
export function chatFixture(lifecycle?:RecursiveTaskLifecycle){
 const base=resolve('.codex/scratch/chat-architecture-implementation-20261105');mkdirSync(base,{recursive:true});const dir=mkdtempSync(join(base,'core-'));
 const path=join(dir,'test.sqlite'),store=new Store(path),files=new Files(join(dir,'workspace')),tasks=new RecursiveTasks(store,files,lifecycle);tasks.migrate();
 store.setMeta('mainAgentId','main:test');store.setMeta('mainThread','thread:main');const history=new ConversationHistory(store.db),inputs=new MainInputs(tasks,history);
 const actor:Actor={agentId:'main:test',threadId:'thread:main',turnId:'turn:main',sourceRequestId:'source:test'};
 function source(requestId:string,body='Investigate without edits'){
  inputs.accept({requestId,text:body});const input=inputs.claim()!;if(input.origin!=='user'||input.input.requestId!==requestId)throw Error('fixture_source_order');inputs.started(input.messageId,input.revision,'generation:'+requestId,'turn:'+requestId);inputs.finish(input.messageId,input.revision,'completed');return input;
 }
 const original=source('source:test');actor.inputMessageId=original.messageId;
 const authority:Authority={sourceRequestId:'source:test',description:'Investigate only'};
 function create(goal='Investigate without edits',operationId='create',extra:Partial<Authority>={}){return tasks.createTask(actor,{operationId,goal,authority:{...authority,...extra}});}
 function start(workerId:string){const worker=tasks.workers(tasks.run(workerId).taskId).find(worker=>worker.workerId===workerId)!;const run=tasks.claim(worker.run.id)!;if(!run)throw Error('fixture_not_claimed');tasks.bind(run.id,run.epoch,worker.threadId??'thread:'+workerId,'turn:'+run.id);return tasks.run(run.id);}
 return {dir,path,store,files,tasks,history,inputs,actor,authority,source,create,start,close(){store.close();rmSync(dir,{recursive:true,force:true});}};
}
