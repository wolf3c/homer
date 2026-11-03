// Synthetic acceptance engine only. Never constructs a CodexEngine or accesses an account.
import {EventEmitter} from 'node:events';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {Homer,type Message} from '../src/service.js';
import type {EngineLike,EngineOptions,ToolCall,TurnResult} from '../src/engine.js';
import type {Contract} from '../src/recursive-tasks.js';
const until=async(check:()=>boolean)=>{const end=Date.now()+4000;while(!check()){if(Date.now()>end)throw Error('synthetic_wait_timeout');await new Promise(r=>setTimeout(r,5));}};
const contract=(goal:string,resultKind:Contract['resultKind']='structured'):Contract=>({goal,inputs:[{type:'material',id:'synthetic.md'}],resultKind,acceptance:{criteria:[{id:'facts',required:true,description:'Keep the synthetic date unknown'}]}});
export function syntheticHost(failChild=false,retainRuntime=false){
  mkdirSync(resolve('.codex/scratch/recursive-agent-implementation'),{recursive:true});
  const root=mkdtempSync(resolve('.codex/scratch/recursive-agent-implementation/host-'));mkdirSync(join(root,'workspace/materials'),{recursive:true});writeFileSync(join(root,'workspace/materials/synthetic.md'),'Synthetic date: unknown.');
  const events:Message[]=[],engines:Peer[]=[],seen:string[]=[];let sequence=0,app:Homer;
  class Peer extends EventEmitter implements EngineLike{
    threadId:string;turnId?:string;turns=0;pending?: (value:TurnResult)=>void;interrupts=0;
    constructor(readonly options:EngineOptions,readonly tool:(call:ToolCall)=>Promise<unknown>){super();this.threadId=options.threadId??'synthetic-thread-'+ ++sequence;engines.push(this);}
    get worker(){return this.options.tools.some(t=>t.name==='read_material');}
    async start(){return this.threadId;}
    async call(name:string,args:unknown):Promise<any>{return this.tool({threadId:this.threadId,turnId:this.turnId!,callId:'synthetic-call-'+ ++sequence,tool:name,arguments:args});}
    inspect(taskId:string,resultId:string|null=null){return this.call('work_inspect',{taskId,runId:null,resultId});}
    async mutation(name:string,taskId:string,extra:Record<string,unknown>={}){const state=await this.inspect(taskId);return this.call(name,{operationId:'synthetic-op-'+ ++sequence,taskId,version:state.task.headVersion,expectedTaskRevision:state.task.revision,...extra});}
    async delegate(parentTaskId:string|null,goal:string,kind:Contract['resultKind']='structured',executorKind='worker'){
      const parent=parentTaskId?await this.inspect(parentTaskId):null;
      return this.call('task_delegate',{operationId:'synthetic-op-'+ ++sequence,parentTaskId,parentVersion:parent?.task.headVersion??null,expectedTaskRevision:parent?.task.revision??null,title:parentTaskId?null:'Synthetic business root',executorKind,contract:contract(goal,kind),dependencies:[]});
    }
    async wait(taskId:string,type:string,target:string|null=null,replyTo:string|null=null){await this.mutation('task_wait',taskId,{condition:{type,taskId:target,version:target?1:null,messageId:null,replyTo}});}
    async ack(){for(const m of await this.call('inbox_read',{after:0}))await this.call('inbox_ack',{operationId:'synthetic-ack-'+m.id,messageId:m.id,disposition:'processed',reason:'Synthetic peer processed',resultId:null});}
    async review(taskId:string,resultId:string,_outcome?:string|null){
      const state=await this.inspect(taskId,resultId),goal=state.contract.goal;
      const outcome=failChild&&goal==='C'?'failed':failChild&&goal==='A'?'partial':'succeeded';
      const children=[];for(const child of state.children){const childState=await this.inspect(child.id),result=childState.results.find((r:any)=>r.state==='accepted'&&!r.completionResultId);children.push({childTaskId:child.id,childVersion:child.headVersion,disposition:result?'included':'gap',resultId:result?.id??null,nextCoordinatorId:null,reason:'Synthetic child reviewed'});}
      return this.mutation('task_review',taskId,{resultId,accepted:true,outcome,reason:'Synthetic result bytes and evidence inspected',evidence:{facts:true,gaps:'Synthetic unavailable input'},children});
    }
    async turn(text:string,options?:{onStarted?:(id:string)=>void}):Promise<TurnResult>{
      this.turnId='synthetic-turn-'+ ++sequence;this.turns++;options?.onStarted?.(this.turnId);
      if(!this.worker){
        if((text==='synthetic:tree'||text==='运行递归合成案例')){
          const root=await this.delegate(null,'root','aggregate','main');await this.delegate(root.taskId,'A','markdown');await this.delegate(root.taskId,'B');await this.delegate(root.taskId,'C');return {status:'completed',text:'Synthetic work accepted'};
        }
        if(text.startsWith('[内部协作事件')){
          for(const task of app.tasks.tasks().filter(t=>t.coordinatorAgentId===app.store.meta('mainAgentId')&&!!t.parentTaskId)){
            const state=await this.inspect(task.id),result=state.results.find((r:any)=>r.version===task.headVersion&&r.state==='offered');if(result)await this.review(task.id,result.id,result.outcome);
          }
          await this.ack();
          for(const root of app.tasks.tasks().filter(t=>!t.parentTaskId&&t.executorKind==='main'&&t.state!=='settled')){
            const children=app.tasks.children(root.id);if(children.length===3&&children.every(t=>t.state==='settled')){
              const resolutions=[];let file:string|null=null;
              for(const child of children){const state=await this.inspect(child.id),r=state.results.find((r:any)=>r.state==='accepted');resolutions.push({childTaskId:child.id,childVersion:child.headVersion,disposition:r?'included':'gap',resultId:r?.id??null,nextCoordinatorId:null,reason:'Synthetic child fact'});if(r?.filePath)file=r.id;}
              await this.mutation('publish_delivery',root.id,{resultId:null,outcome:failChild?'partial':'succeeded',evidence:{facts:true,...(failChild?{gaps:'C unavailable'}:{})},children:resolutions,text:failChild?'Synthetic partially completed; missing C':'Synthetic completed; date unknown',publishedFileResultId:file});
            }
          }return {status:'completed',text:'已核对收到的工作结果。'};
        }
        seen.push(text);if((text==='synthetic:stream'||text==='开始长回复合成验收'))return new Promise(resolve=>{this.pending=resolve;this.emit('textDelta',{threadId:this.threadId,turnId:this.turnId,delta:'Synthetic streaming'});});
        const reply='Synthetic reply: '+text;
        this.emit('agentMessage',{threadId:this.threadId,turnId:this.turnId,itemId:'reply',phase:'final_answer',text:reply,completed:true});
        return {status:'completed',text:reply};
      }
      const input=JSON.parse(text),taskId=input.taskId,goal=input.contract.goal;
      if(goal==='A'){
        if(this.turns===1){await until(()=>app.tasks.tasks().some(t=>app.tasks.contract(t.id,t.headVersion).goal==='C'));const child={taskId:app.tasks.tasks().find(t=>t.rootTaskId===app.tasks.task(taskId).rootTaskId&&app.tasks.contract(t.id,t.headVersion).goal==='C')!.id};await this.wait(taskId,'result_or_terminal',child.taskId);return {status:'completed',text:'Synthetic A waiting'};}
        await this.ack();await this.call('read_material',{});await this.call('write_markdown',{filename:'synthetic-report.md',content:'# Synthetic report\nDate unknown.\n'});
      }else if(goal==='B'){
        // Hold this synthetic peer's computation until C's question is durable.
        await until(()=>!!app.store.db.prepare("SELECT 1 FROM agent_messages WHERE recipientAgentId=? AND kind='question'").get(app.tasks.task(taskId).executorAgentId));
        const messages=await this.call('inbox_read',{after:0}),question=messages.find((m:any)=>m.kind==='question');
        const c=app.tasks.tasks().find(t=>t.rootTaskId===app.tasks.task(taskId).rootTaskId&&app.tasks.contract(t.id,t.headVersion).goal==='C')!;
        await this.mutation('agent_send',taskId,{recipientAgentId:c.executorAgentId,kind:'answer',payload:{date:'unknown'},replyTo:question.id,targetRunId:null});await this.ack();
      }else{
        if(this.turns===1){const b=app.tasks.tasks().find(t=>t.rootTaskId===app.tasks.task(taskId).rootTaskId&&app.tasks.contract(t.id,t.headVersion).goal==='B')!;const question=await this.mutation('agent_send',taskId,{recipientAgentId:b.executorAgentId,kind:'question',payload:{question:'Synthetic date?'},replyTo:null,targetRunId:null});await this.wait(taskId,'message',null,question.messageId);return {status:'completed',text:'Synthetic C waiting'};}
        await this.ack();if(failChild)return {status:'failed',text:'Synthetic input unavailable; verification incomplete.',errorCode:'synthetic_input_missing'};
      }
      return {status:'completed',text:'Synthetic worker finished'};
    }
    async interrupt(){this.interrupts++;this.pending?.({status:'interrupted',text:'Synthetic partial'});this.pending=undefined;return true;}
    async close(){this.pending?.({status:'interrupted',text:''});this.pending=undefined;return true;}
  }
  mkdirSync(join(root,'runtime'));app=new Homer({runtime:join(root,'runtime'),workspace:join(root,'workspace'),codexBin:'/usr/bin/false',codexHome:join(root,'empty-home'),model:'synthetic',effort:'medium',requiresOpenaiAuth:false,timeoutMs:20000,mainTimeoutMs:5000,stopGraceMs:100},async m=>{events.push(m);},(o,h)=>new Peer(o,h));
  return {app,events,engines,seen,root,async close(){await app.close();if(!retainRuntime)rmSync(root,{recursive:true,force:true});}};
}
