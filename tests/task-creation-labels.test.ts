// Local in-memory projections, actual creation transactions and RPC outlets only.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {Homer} from '../src/service.js';
import {TaskCreationRejected} from '../src/recursive-tasks.js';
import {RecursiveTools} from '../src/recursive-tools.js';
import {ConversationHistory} from '../src/web-history.js';
import {MainProcessHistory} from '../src/main-process.js';
import {fixture,contract,main} from './recursive-fixture.js';
mkdirSync('.codex/scratch/recursive-agent-implementation',{recursive:true});
function setup(event:boolean){
 const f=fixture(),history=new ConversationHistory(f.store.db),processes=new MainProcessHistory(f.store.db);
 history.record('reply','thread','','running');
 processes.start({id:'node',threadId:'thread',sourceKind:event?'worker':'user',sourceMessageIds:[],messageId:'reply'},'turn');
 const context:any={event,processId:'node',generation:{generationId:'generation',threadId:'thread',turnId:'turn',messageId:'reply',sourceRequestId:'synthetic'}};
 const app:any=Object.create(Homer.prototype);
 Object.assign(app,{mainContext:context,history,processes,validateMainMemory(){},emit:async()=>{}});
 const items=()=>event?processes.list('thread')[0]!.items:history.list('thread')[0]!.toolActivities!;
 const work=(fn:()=>Promise<unknown>)=>app.mainActivity('task_delegate',fn);
 return {...f,app,history,processes,context,items,work};
}
for(const event of [false,true])test('creation labels survive refresh without interpreting arbitrary failures, event='+event,async()=>{
 const f=setup(event);try{
  const input={operationId:'create',title:'Synthetic',executorKind:'worker' as const,contract:contract(),authority:{sourceRequestId:main.sourceRequestId!,description:'synthetic',materials:['sample.md'],resultIds:[],collaborateTaskIds:[]}};
  const receipt=f.tasks.createRoot(main,input);
  let release!:(v:unknown)=>void;
  const inFlight=f.work(()=>new Promise(done=>{release=done;}));
  assert.equal((f.items()[0] as any).label,'创建任务');release(receipt);await inFlight;
  assert.equal((f.items()[0] as any).label,'任务已创建');
  const bad={...input,operationId:'invalid',contract:{...contract(),inputs:[{type:'attachment' as const,id:'asset-missing-revision'}]}};
  let rejection:unknown;try{f.tasks.createRoot(main,bad);}catch(error){rejection=error;}
  assert.ok(rejection instanceof TaskCreationRejected);
  await assert.rejects(()=>f.work(async()=>{throw rejection;}),/task_attachment_reference_invalid/);
  assert.equal((f.items()[1] as any).label,'未创建任务');
  for(const error of [Error('task_attachment_reference_invalid'),Error('operation_payload_conflict'),Error('operation_uncertain'),Error('synthetic_postcommit_context_failure')]){
   await assert.rejects(()=>f.work(async()=>{throw error;}));assert.equal((f.items().at(-1) as any).label,'创建结果待核对');
  }
  const tools=new RecursiveTools(f.tasks,{rootAuthority:()=>input.authority,wake:()=>{throw Error('synthetic_postcommit_wake_failure');}} as any);
  const args={operationId:'wake',parentTaskId:null,parentVersion:null,expectedTaskRevision:null,executorKind:'worker',title:'Synthetic wake',contract:contract(),dependencies:[]};
  await assert.rejects(()=>f.work(()=>tools.call(main,'task_delegate',args)),/synthetic_postcommit_wake_failure/);
  assert.equal((f.items().at(-1) as any).label,'创建结果待核对');
  const operation=f.store.db.prepare("SELECT responseJson FROM operations WHERE operationId='wake'").get()!;
  assert.ok(JSON.parse(String(operation.responseJson)).taskId);
  // A returned receipt is durable even if a caller then loses the transport reply.
  const refreshed=event?new MainProcessHistory(f.store.db).list('thread')[0]!.items:new ConversationHistory(f.store.db).list('thread')[0]!.toolActivities!;
  assert.equal((refreshed[0] as any).label,'任务已创建');
  // Late starts cannot overwrite a terminal label/status; old history stays literal.
  const first=refreshed[0] as any;
  if(event)f.processes.tool('node',{id:first.id,label:'创建任务',phase:'start'});else f.history.tool('reply',{id:first.id,label:'创建任务',phase:'start'});
  assert.equal((f.items()[0] as any).label,'任务已创建');
  const legacy={id:'legacy',label:'执行任务',phase:'end' as const,status:'failed' as const};
  if(event)f.processes.tool('node',legacy);else f.history.tool('reply',legacy);
  assert.equal((f.items().at(-1) as any).label,'执行任务');
 }finally{f.close();}
});

for(const event of [false,true])test('interrupted current creation stays unknown after recovery; legacy history stays literal, event='+event,async()=>{
 const f=setup(event);try{
  let release!:(v:unknown)=>void;const pending=f.work(()=>new Promise(done=>{release=done;}));
  const old={id:'legacy-running',label:'执行任务',phase:'start' as const};
  if(event){f.processes.tool('node',old);f.processes.reconcileUnknown('thread');}else{f.history.tool('reply',old);f.history.reconcile();}
  assert.equal((f.items()[0] as any).label,'创建结果待核对');assert.equal((f.items()[0] as any).status,'blocked');
  if(event){assert.equal(f.processes.list('thread')[0]!.state,'working');assert.equal(f.processes.list('thread')[0]!.status,'unknown');}
  assert.equal((f.items()[1] as any).label,'执行任务');
  release({taskId:'synthetic',operationKey:'synthetic'});await pending;
  assert.equal((f.items()[0] as any).label,'创建结果待核对');
 }finally{f.close();}
});
