import {useCallback,useLayoutEffect,useRef,useState} from 'react';
import type {TaskOverview} from '../src/task-overview';
import {connectionFetch} from './web-connection-client';

type ReadMode='refresh'|'append';

export function useTaskStatusData(
 archived:boolean, enabled:boolean, connected:boolean, refreshKey:unknown,
 canAppend:()=>boolean, beforeCommit:()=>void,
){
 const options=useRef({canAppend,beforeCommit});
 options.current={canAppend,beforeCommit};
 const [data,setData]=useState<TaskOverview|null>(null);
 const [failure,setFailure]=useState<ReadMode|null>(null);
 const [reading,setReading]=useState<ReadMode|null>(null);
 const [stale,setStale]=useState(true);
 const life=useRef({
  data:null as TaskOverview|null, active:false, dirty:false, preferAppend:false, retryAppend:false,
  failure:null as ReadMode|null, controller:null as AbortController|null,
  timer:undefined as ReturnType<typeof setTimeout>|undefined,lastRefresh:0,
 });

 const wake=useCallback(function wake(){
  const current=life.current;
  if(!current.active||document.hidden||current.controller||current.failure==='refresh')return;
  const tailVisible=!current.failure&&current.data?.nextCursor!==undefined&&(current.retryAppend||options.current.canAppend());
  const mode:ReadMode=current.dirty&&!(current.preferAppend&&tailVisible)?'refresh':'append';
  if(mode==='append'&&!tailVisible){clearTimeout(current.timer);return;}
  clearTimeout(current.timer);
  const wait=mode==='refresh'?Math.max(0,2000-(Date.now()-current.lastRefresh)):0;
  current.timer=setTimeout(async()=>{
   if(!current.active||document.hidden||current.controller||current.failure==='refresh')return;
   const previous=current.data;
   if(mode==='append'&&!current.retryAppend&&!options.current.canAppend()){wake();return;}
   if(mode==='refresh')current.dirty=false;
   current.preferAppend=false;
   current.retryAppend=false;
   const controller=new AbortController();
   current.controller=controller;
   setReading(mode);
   async function read(before?:number):Promise<TaskOverview>{
    const path=!archived&&before===undefined?'/api/tasks'
     : `/api/tasks/list/${archived?'archived':'visible'}${before===undefined?'':'/before/'+before}`;
    const timeout=setTimeout(()=>controller.abort('task_status_timeout'),15000);
    try{
     const response=await connectionFetch(path,{signal:controller.signal});
     if(!response.ok)throw Error('task_status_read_failed');
     const page:TaskOverview=await response.json();
     if(!Array.isArray(page.tasks)||page.nextCursor!==undefined&&
        (!Number.isSafeInteger(page.nextCursor)||page.nextCursor<1||
         (before!==undefined&&page.nextCursor>=before)))throw Error('task_status_invalid_page');
     controller.signal.throwIfAborted();
     return page;
    }finally{clearTimeout(timeout);}
   }
   try{
    const tasks=new Map(mode==='append'?previous!.tasks.map(task=>[task.id,task]):[]);
    const oldTail=mode==='refresh'?previous?.tasks.at(-1)?.creationOrder:undefined;
    let page=await read(mode==='append'?previous!.nextCursor:undefined);
    for(;;){
     for(const task of page.tasks)tasks.set(task.id,task);
     if(oldTail===undefined||page.nextCursor===undefined||page.nextCursor<=oldTail)break;
     page=await read(page.nextCursor);
    }
    if(current.controller!==controller)return;
    options.current.beforeCommit();
    current.data={tasks:[...tasks.values()],nextCursor:page.nextCursor};
    setData(current.data);
    if(mode==='refresh'){
     current.preferAppend=true;
     setStale(false);
     if(current.failure==='append'&&page.nextCursor===undefined){current.failure=null;setFailure(null);}
    }
   }catch{
    if(current.controller!==controller)return;
    current.failure=mode;
    setFailure(mode);
    if(mode==='refresh')setStale(true);
   }finally{
    if(current.controller===controller){
     current.controller=null;
     if(mode==='refresh')current.lastRefresh=Date.now();
     setReading(null);
     // The component checks the tail again after the new rows are laid out.
    }
   }
  },wait);
 },[archived]);

 useLayoutEffect(()=>{
  const current=life.current;
  function stop(){
   clearTimeout(current.timer);
   current.controller?.abort();
   current.controller=null;
   current.preferAppend=false;
   current.retryAppend=false;
  }
  function resume(){
   current.failure=null;
   current.lastRefresh=0;
   current.dirty=true;
   setFailure(null);
   wake();
  }
  function visibility(){
   if(document.hidden){stop();setStale(true);setReading(null);}
   else resume();
  }
  current.active=enabled&&connected;
  setReading(null);
  setStale(true);
  if(!enabled){current.data=null;current.failure=null;setData(null);setFailure(null);}
  if(current.active)resume();
  if(current.active)document.addEventListener('visibilitychange',visibility);
  return()=>{
   current.active=false;
   stop();
   document.removeEventListener('visibilitychange',visibility);
  };
 },[enabled,connected,wake]);

 useLayoutEffect(()=>{
  life.current.dirty=true;
  wake();
 },[refreshKey,wake]);

 function retry(){
  const current=life.current;
  if(!current.active||!current.failure)return;
  const mode=current.failure;
  current.failure=null;
  if(mode==='refresh'){current.dirty=true;current.lastRefresh=0;}
  else {
   current.preferAppend=true;
   // The user explicitly requested this batch, even if layout has shifted.
   current.retryAppend=true;
  }
  setFailure(null);
  wake();
 }

 return {data,reading,failure,stale:stale||!connected,wake,retry};
}
