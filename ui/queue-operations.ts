import {useEffect,useRef,useState} from 'react';
import type {WebState,QueueReceipts} from '../src/web-contract.js';
import type {QueueOperationResult,MainDispatchInput} from '../src/recursive-main-inputs.js';
import {connectionFetch} from './web-connection-client.js';

export function queueMoveBefore(items:readonly Pick<MainDispatchInput,'messageId'|'state'|'movable'|'nextMessageId'>[],messageId:string,initialIndex:number,index:number):string|null|undefined{
 const source=items.findIndex(item=>item.messageId===messageId),movable=(i:number)=>items[i]?.state==='queued'&&items[i]?.movable;
 if(source<0||!movable(source)||!Number.isSafeInteger(initialIndex)||!Number.isSafeInteger(index)||initialIndex===index)return;
 let start=source,end=source;while(start>0&&movable(start-1))start--;while(end+1<items.length&&movable(end+1))end++;
 if(initialIndex!==source-start||index<0||index>end-start)return;
 return index<initialIndex?items[start+index]!.messageId:items[start+index]!.nextMessageId;
}

export type PendingQueueOperation={action:'edit'|'cancel'|'move';payload:Record<string,unknown>&({requestId:string;messageId?:never;operationId:string}|{messageId:string;requestId?:never;operationId:string})};
export function queueStorage<T>(key:string):T|undefined{try{return JSON.parse(sessionStorage.getItem(key)??'null')??undefined;}catch{return;}}
export function saveQueueStorage(key:string,value:unknown){try{if(value===undefined)sessionStorage.removeItem(key);else sessionStorage.setItem(key,JSON.stringify(value));}catch{/* Existing per-tab draft policy. */}}
class QueueRequestError extends Error{constructor(message:string,readonly definitive:boolean){super(message);}}
export async function queuePost<T>(path:string,input:unknown,signal?:AbortSignal):Promise<T>{
 const response=await connectionFetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),signal});
 const value=await response.json();if(!response.ok)throw new QueueRequestError(value.error??'queue_request_failed',/^queue_(sources_required|revision_conflict|order_conflict|input_processing|input_locked|input_not_found|input_not_movable|anchor_invalid|thread_conflict|operation_conflict)$|^history_epoch_changed$|^media_scope_denied$|^invalid_(message|quote|attachments)$/.test(value.error));return value;
}
export function useQueueOperations(state:WebState,connected:boolean){
 const key='homer-queue-operation:'+state.threadId;
 const [pending,setPending]=useState<PendingQueueOperation>(),[busy,setBusy]=useState(false);
 const current=useRef<PendingQueueOperation|undefined>(undefined),flight=useRef(false),mounted=useRef({active:true,key,connected,readEpoch:state.history?.readEpoch});
 Object.assign(mounted.current,{key,connected,readEpoch:state.history?.readEpoch});
 useEffect(()=>{mounted.current.active=true;return()=>{mounted.current.active=false;};},[]);
 useEffect(()=>{current.current=queueStorage(key);setPending(current.current);},[key]);
 function retain(value:PendingQueueOperation|undefined){current.current=value;saveQueueStorage(key,value);setPending(value);}
 function finish(operation:PendingQueueOperation){
  if(!mounted.current.active||mounted.current.key!==key||current.current!==operation)return;
  retain(undefined);window.dispatchEvent(new Event('homer-queue-updated'));
 }
 async function send(operation:PendingQueueOperation){
  if(flight.current||!connected)return;flight.current=true;setBusy(true);
  try{const result=await queuePost<QueueOperationResult>('/api/messages/'+operation.action,operation.payload,operation.action==='move'?AbortSignal.timeout(15_000):undefined);finish(operation);return result;}
  catch(error){if(mounted.current.active&&mounted.current.key===key&&current.current===operation&&error instanceof QueueRequestError&&error.definitive){retain(undefined);window.dispatchEvent(new Event('homer-queue-updated'));}}
  finally{
   flight.current=false;if(mounted.current.active)setBusy(false);
   if(operation.action==='move'&&mounted.current.active&&mounted.current.key===key&&mounted.current.connected&&mounted.current.readEpoch===state.history?.readEpoch&&current.current===operation)void reconcile();
  }
 }
 async function reconcile(signal?:AbortSignal){
  const operation=current.current;if(!operation||!connected||!state.history)return;
  const readSignal=operation.action==='move'?(signal?AbortSignal.any([signal,AbortSignal.timeout(15_000)]):AbortSignal.timeout(15_000)):signal;
  try{
   const value=await queuePost<QueueReceipts>('/api/history/receipts',{requestIds:operation.payload.requestId?[operation.payload.requestId]:[],operations:[{...(operation.payload.messageId?{messageId:operation.payload.messageId}:{requestId:operation.payload.requestId}),operationId:operation.payload.operationId}],threadId:state.threadId,readEpoch:state.history.readEpoch},readSignal);
   if(readSignal?.aborted||current.current!==operation)return;
   const receipt=value.operations?.find(item=>item.operationId===operation.payload.operationId&&(operation.payload.messageId?item.messageId===operation.payload.messageId:item.requestId===operation.payload.requestId));
   if(receipt?.committed&&receipt.result)finish(operation);
  }catch{/* Unconfirmed reads retain the original operation and its lock. */}
 }
 useEffect(()=>{if(!pending||!connected)return;const controller=new AbortController();void reconcile(controller.signal);return()=>controller.abort();},[pending,connected,state.history?.readEpoch,state.queueDispatch?.orderVersion]);
 async function run(action:PendingQueueOperation['action'],payload:PendingQueueOperation['payload']){
  if(current.current||flight.current||!connected)return;
  const operation={action,payload};retain(operation);return send(operation);
 }
 return {pending,busy,run,locked:!!pending||busy};
}
export type QueueOperations=ReturnType<typeof useQueueOperations>;
