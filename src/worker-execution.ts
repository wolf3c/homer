// Read-only, bounded presentation contracts. Never scheduling or a persistent log.
import type {NativeProcessEvent} from './main-process.js';
import {captureToolValue,type ToolContent,type ToolValue} from './tool-content.js';
import {publicActivityName} from './activity-facts.js';
export type CallScope={taskId:string;version:number;runId:string;epoch:number;threadId:string;turnId:string};
export type ExecutionSelector={taskId:string;runId:string};
export type WorkerCallSummary={callKey:string;seq:number;revision:number;scope:CallScope;source:'native'|'host';category:string;toolName?:string;status:NativeProcessEvent['status'];terminalObserved:boolean;firstObservedAtMs:number;lastObservedAtMs:number;startedAtMs?:number;endedAtMs?:number;durationMs?:number;timingSource:'native'|'hostObserved'|'unknown';inputSummary?:string;outputSummary?:string;errorSummary?:string;exitCode?:number;contentState:'available'|'evicted'|'not-recorded';conflict?:true};
export type WorkerExecutionPage={selector:ExecutionSelector;version:number;revision:number;observedAtMs:number;storeGeneration:string;availability:'available'|'unavailable';coverage:'partial';retention:'memory';active:WorkerCallSummary[];items:WorkerCallSummary[];before?:string;hasMore:boolean;omitted:boolean};
export type WorkerCallDetail={selector:ExecutionSelector;callKey:string;revision:number;summary:WorkerCallSummary;content?:ToolContent;contentState:WorkerCallSummary['contentState']};
export const EXECUTION_LIMITS={runs:256,calls:128,page:20,runBytes:512*1024,totalBytes:16*1024*1024} as const;
const valid=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
export {valid as validExecutionTime};
const value=(v:ToolValue|undefined):Record<string,unknown>|undefined=>v&&'value'in v&&v.value&&typeof v.value==='object'&&!Array.isArray(v.value)?v.value as Record<string,unknown>:undefined;
const code=(x:unknown)=>typeof x==='string'&&/^[a-z][a-z0-9_]{0,99}$/.test(x)?x:undefined;
// Explicit allowed fields BEFORE retention. Generic credential masking is not a
// privacy policy: stdout, file text, queries, URLs and arbitrary MCP JSON stay out.
function safeSide(side:ToolValue|undefined,category:string,input:boolean,toolName?:string):ToolValue{
 if(!side)return {state:'not-recorded'};
 if(!('value'in side))return side;
 const o=value(side),safe:Record<string,unknown>={};
 if(['command','readFiles','search','listFiles','inspectFiles'].includes(category)){
  if(input&&typeof o?.command==='string'){
   const first=o.command.trim().split(/\s/)[0]?.split('/').at(-1);
   if(first&&/^[a-z][a-z0-9._-]{0,39}$/i.test(first))safe.commandName=first;
  }
  if(!input&&Number.isSafeInteger(o?.exitCode))safe.exitCode=o!.exitCode;
 }else if(category==='fileChange'&&Array.isArray(o?.changes))safe.fileCount=o.changes.length;
 else if(toolName&&['work_inspect','task_create','task_update','worker_open','worker_send','worker_read','worker_interrupt','stage_file_result','inspect_attachment'].includes(toolName)){
  for(const key of ['state','status','outcome','decision','errorCode']){const c=code(o?.[key]);if(c)safe[key]=c;}
  for(const key of ['count','bytes','total'])if(Number.isSafeInteger(o?.[key])&&Number(o?.[key])>=0)safe[key]=o![key];
  for(const key of ['attachments'])if(Array.isArray(o?.[key]))safe[key+'Count']=(o![key] as unknown[]).length;
 }
 if(!input){const c=code(o?.errorCode)??code(o?.error);if(c)safe.errorCode=c;}
 if(!Object.keys(safe).length)return {state:'hidden',reason:side.state==='truncated'?undefined:'non-json'};
 const captured=captureToolValue(safe);
 return side.state==='truncated'&&'value'in captured?{...captured,state:'truncated'}:captured;
}
export function executionContent(event:NativeProcessEvent,toolName=event.toolName):ToolContent{
 return {input:safeSide(event.content?.input,event.category,true,toolName),output:safeSide(event.content?.output,event.category,false,toolName)};
}
export function executionSummary(value:ToolValue):string|undefined{
 return 'value'in value?JSON.stringify(value.value).slice(0,240):undefined;
}
export function safeExecutionName(name:unknown){return publicActivityName(name);}
