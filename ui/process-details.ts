import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import type {WebProcessNode,WebState} from '../src/web-contract';
type Message=WebState['messages'][number];
export function useProcessDetails(messages:readonly Message[],threadId:string,epoch:string|undefined,read:(id:string,signal:AbortSignal)=>Promise<WebProcessNode>){
 const [details,setDetails]=useState<ReadonlyMap<string,WebProcessNode>>(new Map());
 const scope=JSON.stringify([threadId,epoch]),current=useRef({scope,messages,disposed:false});
 current.current={scope,messages,disposed:false};
 useEffect(()=>()=>{current.current.disposed=true;},[]);
 // One cache, bounded by the existing visible history window. The header still
 // owns lifecycle; a newer exact response supplies only its process entries.
 useEffect(()=>{setDetails(previous=>{
  const keep=new Map([...previous].filter(([key,value])=>key===scope+':'+value.id&&messages.some(message=>message.process?.id===value.id&&message.process.details==='unloaded'&&value.revision>=message.process.revision)));
  return keep.size===previous.size?previous:keep;
 });},[messages,scope]);
 const load=useCallback(async(id:string,signal:AbortSignal)=>{
  const requestScope=current.current.scope,header=current.current.messages.find(message=>message.process?.id===id)?.process;
  if(!header||header.threadId!==threadId)throw Error('history_process_scope_changed');
  const value=await read(id,signal),owner=current.current;
  const latest=owner.messages.find(message=>message.process?.id===id)?.process;
  if(signal.aborted||owner.disposed||owner.scope!==requestScope||value.id!==id||value.threadId!==threadId||!latest||value.revision<latest.revision)throw Error('history_process_scope_changed');
  setDetails(previous=>new Map(previous).set(requestScope+':'+id,value));return value;
 },[read,threadId]);
 const projected=useMemo(()=>messages.map(message=>{
  const node=message.process,detail=node?.details==='unloaded'?details.get(scope+':'+node.id):undefined;
  if(!node||!detail||detail.revision<node.revision)return message;
  const {details:_unloaded,...header}=node;
  return {...message,process:{...header,items:detail.items}};
 }),[messages,details,scope]);
 return {messages:projected,load};
}
