import {useCallback,useEffect,useRef,useState} from 'react';
import type {TaskOverview} from '../src/task-overview';
import type {WebState} from '../src/web-contract';
import {connectionFetch} from './web-connection-client';
// One snapshot owns both collapsed counts and the opened tree. Notifications
// invalidate it; they do not create a poller per card or per streaming token.
export function useTaskStatusData(state:WebState,connected:boolean,onBeforeSnapshot?:()=>void){
 const beforeSnapshot=useRef(onBeforeSnapshot);beforeSnapshot.current=onBeforeSnapshot;
 const scope=state.threadId+':'+(state.history?.readEpoch??'legacy');
 const [record,setRecord]=useState<{scope:string;data:TaskOverview}|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[stale,setStale]=useState(true);
 const lifecycle=useRef({serial:0,enabled:false,scope:'',controller:null as AbortController|null,timer:undefined as ReturnType<typeof setTimeout>|undefined,lastRead:0,dirty:false});
 const refresh=useCallback((urgent=false)=>{
  const life=lifecycle.current;if(!life.enabled||document.hidden)return;
  life.dirty=true;if(life.controller)return;
  clearTimeout(life.timer);const delay=urgent?0:Math.max(0,2000-(Date.now()-life.lastRead));
  life.timer=setTimeout(async()=>{
   if(!life.enabled||document.hidden)return;life.dirty=false;
   const controller=new AbortController(),serial=life.serial,requestScope=life.scope;life.controller=controller;setBusy(true);
   const timeout=setTimeout(()=>controller.abort('task_status_timeout'),15000);
   try{const response=await connectionFetch('/api/tasks',{signal:controller.signal});if(!response.ok)throw Error();const data:TaskOverview=await response.json();if(!Array.isArray(data.tasks))throw Error();
    if(controller.signal.aborted||serial!==life.serial)return;
    beforeSnapshot.current?.();setRecord({scope:requestScope,data});setError('');setStale(false);
   }catch{if((!controller.signal.aborted||controller.signal.reason==='task_status_timeout')&&serial===life.serial){setError('任务记录暂时无法读取，请重试。');setStale(true);}}
   finally{clearTimeout(timeout);if(life.controller===controller){life.controller=null;life.lastRead=Date.now();if(serial===life.serial)setBusy(false);if(life.dirty&&life.enabled)refresh();}}
  },delay);
 },[]);
 useEffect(()=>{
  const life=lifecycle.current;life.serial++;life.controller?.abort();life.controller=null;clearTimeout(life.timer);life.enabled=connected;life.scope=scope;life.lastRead=0;life.dirty=false;setBusy(false);setStale(true);setError('');
  if(connected)refresh(true);
  const visibility=()=>{if(document.hidden){clearTimeout(life.timer);life.controller?.abort();life.controller=null;life.serial++;life.dirty=false;setBusy(false);setStale(true);}else refresh(true);};
  document.addEventListener('visibilitychange',visibility);
  return()=>{life.enabled=false;life.serial++;clearTimeout(life.timer);life.controller?.abort();life.controller=null;document.removeEventListener('visibilitychange',visibility);};
 },[scope,connected,refresh]);
 useEffect(()=>{refresh();},[state,refresh]);
 return {data:record?.scope===scope?record.data:null,error,busy,stale:stale||!connected,refresh};
}
