import type { Tool } from './engine.js';
import type { Actor, RecursiveTasks } from './recursive-tasks.js';
import { validateToolArguments } from './recursive-tools.js';
import type { PendingPatch, PendingQuery } from './pending-items.js';
const str = { type:'string' }, nullable = { type:['string','null'] }, sources = {type:'array',items:str}, integer = {type:'integer',minimum:1};
const tool = (name:string,description:string,properties:Record<string,unknown>,required:string[]):Tool => ({type:'function',name,description,inputSchema:{type:'object',properties,required,additionalProperties:false}});
export const PENDING_TOOLS:Tool[] = [
 tool('pending_add','Main only: persist a fact or suggestion, not execution authorization. Host binds current real user source; selected sourceRequestIds must be actual visible user requests. No dispatch or steer. Reuse operationId to recover receipt.',{operationId:str,content:str,relatedTaskId:nullable,sourceRequestIds:sources},['operationId','content']),
 tool('pending_list','Main only: read latest records. With id, read one original user source; sourceRequestId selects which (default first). Filter by id, related OR linked taskId, state; bounded pagination. Query operationId with operationScope pending_items or pending_dispatch to recover an uncertain receipt before retrying.',{id:str,sourceRequestId:str,taskId:str,state:{type:'string',enum:['open','closed']},cursor:str,limit:{type:'integer',minimum:1,maximum:50},operationId:str,operationScope:{type:'string',enum:['pending_items','pending_dispatch']}},[]),
 tool('pending_update','Main only: explicit CAS edit; omitted fields stay, null clears task link. open/closed only track attention, never Task success or delivery. User edits append their real source. No dispatch, stop or steer.',{operationId:str,id:str,expectedRevision:integer,patch:{type:'object',properties:{content:str,handlingNote:str,state:{type:'string',enum:['open','closed']},relatedTaskId:nullable,linkedTaskId:nullable},additionalProperties:false},sourceRequestIds:sources},['operationId','id','expectedRevision','patch']),
];
export class PendingTools {
 constructor(private tasks:RecursiveTasks){}
 async call(actor:Actor,name:string,args:unknown){
  const definition=PENDING_TOOLS.find(t=>t.name===name);if(!definition)throw Error('tool_denied');
  validateToolArguments(args,definition.inputSchema);
  if(name==='pending_add')return this.tasks.pending.add(actor,args as {operationId:string;content:string;relatedTaskId?:string|null;sourceRequestIds?:string[]});
  if(name==='pending_update')return this.tasks.pending.update(actor,args as {operationId:string;id:string;expectedRevision:number;patch:PendingPatch;sourceRequestIds?:string[]});
  return this.tasks.pending.list(actor,args as PendingQuery);
 }
}
