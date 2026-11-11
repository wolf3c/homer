import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {Store} from '../src/store.js';
import {Files} from '../src/files.js';
import {RecursiveTasks} from '../src/recursive-tasks.js';
import {WorkerInteractions} from '../src/worker-interactions.js';
import {ConversationHistory} from '../src/web-history.js';
import {MainInputs} from '../src/recursive-main-inputs.js';
export function overviewFixture(){
 const scratch=resolve('.codex/scratch/chat-architecture-implementation-20261105');mkdirSync(scratch,{recursive:true});
 const dir=mkdtempSync(join(scratch,'projection-')),store=new Store(join(dir,'test.sqlite')),files=new Files(join(dir,'workspace'));
 const tasks=new RecursiveTasks(store,files);tasks.migrate();new WorkerInteractions(store.db);
 store.setMeta('mainAgentId','main:projection');store.setMeta('mainThread','thread:projection');
 const actor={agentId:'main:projection',threadId:'thread:projection',sourceRequestId:'source:projection'};
 const history=new ConversationHistory(store.db),inputs=new MainInputs(tasks,history);
 inputs.accept({requestId:actor.sourceRequestId,text:'Inspect synthetic inputs'});const source=inputs.claim()!;inputs.started(source.messageId,source.revision,'generation:projection','turn:projection');inputs.finish(source.messageId,source.revision,'completed');
 const authority={sourceRequestId:actor.sourceRequestId,description:'Inspect synthetic inputs'};
 const created=tasks.createTask(actor,{operationId:'projection:create',goal:'Inspect synthetic inputs',authority});
 return {store,files,tasks,actor,authority,taskId:created.taskId,open:(name:string)=>tasks.workerOpen(actor,{operationId:'open:'+name,taskId:created.taskId,text:name}),close(){store.close();rmSync(dir,{recursive:true,force:true});}};
}
