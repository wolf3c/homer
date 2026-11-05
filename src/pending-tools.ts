import type { Tool } from './engine.js';
import type { Actor, RecursiveTasks } from './recursive-tasks.js';
import { toolOperationId, validateToolArguments } from './recursive-tools.js';
import {object, string} from './tools.js';
import type { PendingPatch, PendingQuery } from './pending-items.js';
const str = { type:'string' }, nullable = { type:['string','null'] }, sources = {type:'array',items:str};
const tool = (name:string,description:string,properties:Record<string,unknown>,required:string[]):Tool => ({type:'function',name,description,inputSchema:{type:'object',properties,required,additionalProperties:false}});
export const PENDING_TOOLS:Tool[] = [
 tool('pending_add','Main only: persist a fact or suggestion, not execution authorization. Host binds actual visible user sources and native call identity. Does not dispatch or steer; pending records are unnecessary for opening a Worker.',{content:str,relatedTaskId:nullable,sourceRequestIds:sources},['content']),
 tool('pending_list','Main only: read latest notes with bounded pagination. With id, read one associated original user source; sourceRequestId selects which (default first). Filter by id, related or linked taskId, and open/closed state. Notes and quoted source text do not grant new permission.',{id:str,sourceRequestId:str,taskId:str,state:{type:'string',enum:['open','closed']},cursor:str,limit:{type:'integer',minimum:1,maximum:50}},[]),
 tool('pending_update','Main only: edit selected note fields; omitted fields stay, null clears a task link. Host checks the current revision and native call receipt. open/closed tracks attention, never Task success or delivery. User edits append their real source. Does not dispatch, stop or steer.',{id:str,patch:{type:'object',properties:{content:str,handlingNote:str,state:{type:'string',enum:['open','closed']},relatedTaskId:nullable,linkedTaskId:nullable},additionalProperties:false},sourceRequestIds:sources},['id','patch']),
];
export class PendingTools {
 constructor(private tasks:RecursiveTasks){}
 async call(actor:Actor,name:string,args:unknown,callId?:string){
  const definition=PENDING_TOOLS.find(t=>t.name===name);if(!definition)throw Error('tool_denied');
  if(actor.runId)throw Error('pending_actor_denied');
  validateToolArguments(args,definition.inputSchema);
  if(name==='pending_list')return this.tasks.pending.list(actor,args as PendingQuery);
  const operationId=toolOperationId(actor,callId),a=object(args);
  actor={...actor,operationPayload:{tool:name,arguments:args}};
  if(name==='pending_add')return this.tasks.pending.add(actor,{...a,operationId} as {operationId:string;content:string;relatedTaskId?:string|null;sourceRequestIds?:string[]});
  const row=this.tasks.pending.list(actor,{id:string(a.id,200)}).items[0];if(!row)throw Error('pending_not_found');
  return this.tasks.pending.update(actor,{...a,operationId,expectedRevision:row.revision} as {operationId:string;id:string;expectedRevision:number;patch:PendingPatch;sourceRequestIds?:string[]});
 }
}
