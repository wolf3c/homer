import {createHash,randomUUID} from 'node:crypto';
import {EXECUTION_LIMITS,executionContent,executionSummary,safeExecutionName,validExecutionTime as valid,type ExecutionSelector,type WorkerCallSummary,type WorkerExecutionPage,type WorkerCallDetail} from './worker-execution.js';
import type {ToolContent} from './tool-content.js';
import {nativeLabels as labels,type NativeProcessEvent} from './main-process.js';
import type {PublicPlanStep,WorkerProgress} from './task-status.js';
export type WorkerScope=Pick<WorkerProgress,'taskId'|'version'|'runId'|'epoch'|'threadId'|'turnId'>;
const same=(a:WorkerScope,b:WorkerScope)=>a.taskId===b.taskId&&a.version===b.version&&a.runId===b.runId&&a.epoch===b.epoch&&a.threadId===b.threadId&&a.turnId===b.turnId;
// Ephemeral public presentation and authorized execution facts. No persistence,
// reasoning, scheduling, or reconstruction from prior run summaries.
export class WorkerProgressStore {
 revision=0;
 private records=new Map<string,WorkerProgress>();
 private generation=randomUUID();
 private executions=new Map<string,{taskId:string;calls:Map<string,{summary:WorkerCallSummary;content?:ToolContent;bytes:number}>;next:number;revision:number;observedAtMs:number;omitted:boolean}>();
 private retained=new Map<string,true>();
 private touch(runId:string){this.retained.delete(runId);this.retained.set(runId,true);if(this.retained.size>EXECUTION_LIMITS.runs){const id=this.retained.keys().next().value!;this.retained.delete(id);this.records.delete(id);this.executions.delete(id);}}

 private update(scope:WorkerScope,change:Partial<Pick<WorkerProgress,'plan'|'output'>>){
  this.revision++;
  const old=this.records.get(scope.runId),prior=old&&same(old,scope)?old:undefined;
  const value={...prior,...scope,...change,revision:(prior?.revision??0)+1,observedAtMs:Date.now()};
  this.records.delete(scope.runId);this.records.set(scope.runId,value);
  this.touch(scope.runId);
 }
 plan(scope:WorkerScope,value:unknown){
  if(!Array.isArray(value)||value.length>32)return false;
  if(!value.every(s=>s&&typeof s.step==='string'&&s.step.trim()&&s.step.length<=640&&['pending','inProgress','completed'].includes(s.status)))return false;
  this.update(scope,{plan:value.map(s=>({step:s.step.trim(),status:s.status})) as PublicPlanStep[]});return true;
 }
 message(scope:WorkerScope,value:{phase?:unknown;text?:unknown;completed?:unknown}){
  if(value.completed!==true||!['commentary','final_answer'].includes(String(value.phase))||typeof value.text!=='string'||!value.text.trim())return false;
  const text=value.text.trim();this.update(scope,{output:{type:'text',text:text.length>1600?text.slice(0,1600)+'…':text}});return true;
 }
 tool(scope:WorkerScope,event:NativeProcessEvent){
  const text=labels[event.category];if(!text)return false;this.update(scope,{output:{type:'tool',text}});return true;
 }
 recordCall(scope:WorkerScope,event:NativeProcessEvent,terminalOnly=false,source:'native'|'host'='native'){
  if(event.threadId!==scope.threadId||event.turnId!==scope.turnId||!event.itemId||!Object.hasOwn(labels,event.category)||!['running','completed','failed','declined','interrupted','unknown'].includes(event.status))return false;
  const key=createHash('sha256').update(JSON.stringify([source,scope.taskId,scope.version,scope.runId,scope.epoch,scope.threadId,scope.turnId,event.itemId])).digest('hex');
  let record=this.executions.get(scope.runId);const prior=record?.calls.get(key);
  if(terminalOnly&&(!event.completed||!prior))return false;
  if(record&&record.taskId!==scope.taskId)return false;
  if(!record){record={taskId:scope.taskId,calls:new Map(),next:0,revision:0,observedAtMs:Date.now(),omitted:false};this.executions.set(scope.runId,record);}
  if(!prior&&record.calls.size>=EXECUTION_LIMITS.calls){const victim=[...record.calls].find(([,v])=>v.summary.terminalObserved);if(victim)record.calls.delete(victim[0]);record.omitted=true;if(!victim){record.revision++;this.revision++;return false;}}
  const name=safeExecutionName(event.toolName),content=executionContent(event,name),at=valid(event.observedAtMs)?event.observedAtMs:Date.now();
  const summary:WorkerCallSummary=prior?{...prior.summary}:{callKey:key,seq:++record.next,revision:0,scope:{...scope},source,category:event.category,status:event.status,terminalObserved:event.completed,firstObservedAtMs:at,lastObservedAtMs:at,timingSource:'hostObserved',contentState:'available'};
  const keepOutput=prior?.summary.terminalObserved&&(!event.completed||content.output.state==='not-recorded');
  const body:ToolContent={input:prior?.content&&content.input.state==='not-recorded'?prior.content.input:content.input,output:keepOutput?(prior?.content?.output??{state:'not-recorded'}):content.output};
  if(name)summary.toolName=name;
  if(valid(event.startedAtMs))summary.startedAtMs=event.startedAtMs;
  if(event.completed){
   if(prior?.summary.terminalObserved&&prior.summary.status!==event.status){summary.status='unknown';summary.conflict=true;}else if(!summary.conflict)summary.status=event.status;
   summary.terminalObserved=true;
   if(valid(event.endedAtMs))summary.endedAtMs=event.endedAtMs;
   if(valid(event.durationMs))summary.durationMs=event.durationMs;
  }
  if(summary.startedAtMs!==undefined&&summary.endedAtMs!==undefined&&summary.endedAtMs>=summary.startedAtMs&&summary.durationMs===undefined)summary.durationMs=summary.endedAtMs-summary.startedAtMs;
  summary.timingSource=summary.durationMs!==undefined||summary.startedAtMs!==undefined?'native':'hostObserved';
  summary.inputSummary=executionSummary(body.input);summary.outputSummary=executionSummary(body.output);
  if('value'in body.output&&body.output.value&&typeof body.output.value==='object'&&!Array.isArray(body.output.value)){
   const out=body.output.value as Record<string,unknown>;if(Number.isSafeInteger(out.exitCode))summary.exitCode=out.exitCode as number;
   if(typeof out.errorCode==='string')summary.errorSummary=out.errorCode;
  }
  // Observation timestamps are not semantic revisions. Duplicate protocol
  // snapshots must not cause a perpetual browser re-fetch loop.
  if(prior&&JSON.stringify({...summary,lastObservedAtMs:0})===JSON.stringify({...prior.summary,lastObservedAtMs:0})&&JSON.stringify(body)===JSON.stringify(prior.content))return false;
  summary.lastObservedAtMs=Math.max(at,summary.lastObservedAtMs);summary.revision++;
  record.calls.set(key,{summary,content:body,bytes:Buffer.byteLength(JSON.stringify(body))});record.revision++;record.observedAtMs=Date.now();this.revision++;this.touch(scope.runId);this.limitBodies();return true;
 }
 completeCall(runId:string,epoch:number,event:NativeProcessEvent){
  const calls=this.executions.get(runId)?.calls;
  if(!calls||!event.completed)return false;
  for(const {summary} of calls.values()){
   const scope=summary.scope;
   const key=createHash('sha256').update(JSON.stringify(['native',scope.taskId,scope.version,scope.runId,scope.epoch,event.threadId,event.turnId,event.itemId])).digest('hex');
   if(scope.epoch===epoch&&scope.threadId===event.threadId&&scope.turnId===event.turnId&&summary.callKey===key)return this.recordCall(scope,event,true);
  }
  return false;
 }
 private limitBodies(){
  const bytes=(r:typeof this.executions extends Map<string,infer V>?V:never)=>[...r.calls.values()].reduce((n,c)=>n+c.bytes,0);
  const evict=(r:typeof this.executions extends Map<string,infer V>?V:never)=>{const c=[...r.calls.values()].find(c=>c.content&&c.summary.terminalObserved)??[...r.calls.values()].find(c=>c.content);if(!c)return false;c.content=undefined;c.bytes=0;c.summary.contentState='evicted';c.summary.revision++;r.revision++;return true;};
  for(const r of this.executions.values())while(bytes(r)>EXECUTION_LIMITS.runBytes&&evict(r)){}
  let total=[...this.executions.values()].reduce((n,r)=>n+bytes(r),0);
  for(const r of this.executions.values()){while(total>EXECUTION_LIMITS.totalBytes){const before=bytes(r);if(!evict(r))break;total-=before-bytes(r);}}
 }
 execution(selector:ExecutionSelector,version:number,before?:string):WorkerExecutionPage{
  const record=this.executions.get(selector.runId),binding=JSON.stringify([selector,version]);let edge=Infinity;
  if(before){try{if(before.length>256||!/^[A-Za-z0-9_-]+$/.test(before))throw Error();const c=JSON.parse(Buffer.from(before,'base64url').toString());if(c.g!==this.generation)throw Error('expired');if(c.b!==createHash('sha256').update(binding).digest('hex')||!Number.isSafeInteger(c.s)||c.s<1)throw Error();edge=c.s;}catch(error){throw Error(error instanceof Error&&error.message==='expired'?'execution_cursor_expired':'execution_cursor_invalid');}}
  const available=record?.taskId===selector.taskId;
  const calls=available?[...record.calls.values()].map(c=>c.summary).filter(c=>c.scope.version===version):[];
  const ended=calls.filter(c=>c.terminalObserved&&c.seq<edge).sort((a,b)=>b.seq-a.seq),items=ended.slice(0,EXECUTION_LIMITS.page).reverse(),hasMore=ended.length>items.length;
  return structuredClone({selector,version,revision:available?record.revision:0,observedAtMs:available?record.observedAtMs:Date.now(),storeGeneration:this.generation,availability:available?'available':'unavailable',coverage:'partial',retention:'memory',active:calls.filter(c=>!c.terminalObserved).sort((a,b)=>a.seq-b.seq),items,hasMore,omitted:available?record.omitted:false,...(hasMore?{before:Buffer.from(JSON.stringify({g:this.generation,b:createHash('sha256').update(binding).digest('hex'),s:items[0]!.seq})).toString('base64url')}:{})});
 }
 call(selector:ExecutionSelector,version:number,callKey:string):WorkerCallDetail{
  const record=this.executions.get(selector.runId),call=record?.calls.get(callKey);
  if(!call||record!.taskId!==selector.taskId||call.summary.scope.version!==version)throw Error('execution_call_unavailable');
  return structuredClone({selector,callKey,revision:call.summary.revision,summary:call.summary,...(call.content?{content:call.content}:{}),contentState:call.summary.contentState});
 }
 get(scope:WorkerScope){const value=this.records.get(scope.runId);return value&&same(value,scope)?structuredClone(value):undefined;}
}
