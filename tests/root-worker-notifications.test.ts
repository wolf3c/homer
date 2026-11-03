// Exercise actual host queues and tool contracts; no model, credentials or channels.
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {Homer,type Message} from '../src/service.js';
import type {EngineLike,EngineOptions,ToolCall,TurnResult} from '../src/engine.js';
const until=async(check:()=>boolean)=>{const end=Date.now()+4000;while(!check()){if(Date.now()>end)throw Error('root_notice_timeout');await new Promise(r=>setTimeout(r,5));}};
function fixture(overlap=false){
 const scratch=resolve('.codex/scratch/root-worker-notifications');mkdirSync(scratch,{recursive:true});
 const base=mkdtempSync(join(scratch,'host-')),workspace=join(base,'workspace'),runtime=join(base,'runtime');
 mkdirSync(join(workspace,'materials'),{recursive:true});mkdirSync(runtime);
 writeFileSync(join(workspace,'materials/synthetic.md'),'Public synthetic material');
 const messages:Message[]=[],observed:{taskId:string;kind:string;outcome:string|null}[]=[],errors:string[]=[];
 const workers=new Map<string,(result:TurnResult)=>void>();let sequence=0,rootId='',legacyId='',app:Homer;
 class Peer extends EventEmitter implements EngineLike{
  threadId:string;turnId?:string;finish?: (result:TurnResult)=>void;
  constructor(readonly options:EngineOptions,readonly handler:(call:ToolCall)=>Promise<unknown>){super();this.threadId=options.threadId??'notice-thread-'+ ++sequence;}
  async start(){return this.threadId;}
  async call(tool:string,args:unknown):Promise<any>{return this.handler({threadId:this.threadId,turnId:this.turnId!,callId:'notice-call-'+ ++sequence,tool,arguments:args});}
  async turn(text:string,options?:{onStarted?:(id:string)=>void}):Promise<TurnResult>{
   this.turnId='notice-turn-'+ ++sequence;options?.onStarted?.(this.turnId);
   if(this.options.tools.some(t=>t.name==='read_material')){
    const run=JSON.parse(text),taskId=run.taskId;
    const result=await new Promise<TurnResult>(r=>{this.finish=r;workers.set(taskId,r);});
    return result;
   }
   try{
    if(text==='synthetic:start'){
     const root=await this.call('task_delegate',{operationId:'root',parentTaskId:null,parentVersion:null,expectedTaskRevision:null,title:'Normal root Worker',executorKind:'worker',contract:{goal:'Synthetic root',inputs:[],resultKind:'structured',acceptance:{criteria:[]}},dependencies:[]});rootId=root.taskId;
     if(overlap){const legacy=await this.call('dispatch_work',{title:'Legacy adapter',goal:'Synthetic legacy',material:'synthetic.md',matterId:null});legacyId=app.tasks.run(legacy.id).taskId;}
    }else if(text.startsWith('[内部协作事件')||text.startsWith('[执行结果待审阅]')){
     for(const notice of text.startsWith('[执行结果待审阅]')?(await this.call('inbox_read',{after:0})).filter((n:any)=>n.taskId===legacyId&&n.kind==='terminal'):JSON.parse(text.slice(text.indexOf('\n')+1))){
      const facts=await this.call('work_inspect',{taskId:notice.taskId,runId:null,resultId:null});
      observed.push({taskId:notice.taskId,kind:notice.kind,outcome:facts.task.outcome});
      const result=facts.results.find((r:any)=>r.state==='offered');
      if(result){await this.call('work_inspect',{taskId:notice.taskId,runId:null,resultId:result.id});await this.call('task_review',{operationId:'review-'+result.id,taskId:notice.taskId,version:facts.task.headVersion,expectedTaskRevision:facts.task.revision,resultId:result.id,accepted:true,outcome:notice.kind==='terminal'?'failed':'succeeded',reason:'Synthetic result inspected',evidence:{},children:[]});}
      await this.call('inbox_ack',{operationId:'coordinator-'+notice.id,messageId:notice.id,disposition:'processed',reason:'Coordinator inspected and decided',resultId:null});
     }
    }
   }catch(error){errors.push(String(error));throw error;}
   return {status:'completed',text:'Synthetic host reply'};
  }
  async close(){this.finish?.({status:'failed',text:'',errorCode:'synthetic_closed'});return true;}
  async interrupt(){return this.close();}
 }
 app=new Homer({workspace,runtime,codexHome:join(base,'empty-home'),codexBin:'/usr/bin/false',model:'synthetic',requiresOpenaiAuth:false,stopGraceMs:100},async message=>{
  messages.push(message);

 },(o,h)=>new Peer(o,h));
 return {app,messages,observed,errors,get rootId(){return rootId;},get legacyId(){return legacyId;},workers,async close(){await app.close();rmSync(base,{recursive:true,force:true});}};
}
for(const outcome of ['failed','succeeded'] as const)test('ordinary root Worker '+outcome+' notification reaches its main coordinator',async()=>{
 const f=fixture();try{
  await f.app.start();await f.app.message('synthetic:start','synthetic-source');await until(()=>f.workers.has(f.rootId));
  f.workers.get(f.rootId)!({status:outcome==='failed'?'failed':'completed',text:'Synthetic result',...(outcome==='failed'?{errorCode:'synthetic_failure'}:{})});
  await f.app.idle();assert.deepEqual(f.errors,[]);
  assert.ok(f.observed.some(n=>n.kind===(outcome==='failed'?'terminal':'result_ready')),'main must receive the actual root Worker notice');
  assert.equal(f.app.tasks.task(f.rootId).outcome,outcome);
  assert.equal(f.messages.filter(m=>m.type==='delivery').length,0,'host must not publish ordinary roots through the legacy adapter');
 }finally{await f.close();}
});
test('legacy publication does not acknowledge another ordinary root Worker notification',async()=>{
 const f=fixture(true);try{
  await f.app.start();await f.app.message('synthetic:start','synthetic-source');await until(()=>f.workers.has(f.rootId)&&f.workers.has(f.legacyId));
  f.workers.get(f.legacyId)!({status:'failed',text:'',errorCode:'synthetic_legacy_failure'});
  f.workers.get(f.rootId)!({status:'failed',text:'Synthetic failed result',errorCode:'synthetic_overlap_failure'});
  await f.app.idle();assert.deepEqual(f.errors,[]);
  assert.equal(f.messages.filter(m=>m.type==='delivery').length,1,'legacy publication remains exactly once');
  const delivery=f.app.tasks.deliveries()[0]!,owner=f.app.processes.list(f.app.store.meta('mainThread')!).find(node=>node.deliveryMessageIds?.includes(delivery.historyMessageId));
  assert.ok(owner,'legacy adapter associates its actual publication before finishing the original process');
  assert.equal(owner.final,undefined,'the adapter does not copy the same formal delivery into a coordination report');
  assert.equal(f.app.processes.coordination(owner.id),undefined,'channel recovery cannot manufacture a second copy');
  assert.ok(f.observed.some(n=>n.taskId===f.rootId&&n.kind==='terminal'&&n.outcome===null),'normal root failure must still reach main after the unrelated delivery');
 }finally{await f.close();}
});
