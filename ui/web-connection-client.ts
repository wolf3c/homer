import {mobileFetch} from './mobile-request.js';
import {markMobileRecovery,mobileEvents,mobileCall,mobileConnected} from './mobile-connection.js';
export const mobileView=typeof document!=='undefined'&&document.querySelector?.('meta[name="homer-mobile"]')?.getAttribute('content')==='true';
// Desktop uses its local HTTP owner; the bundled App uses the same chat contract over RTC.
export const connectionFetch:typeof globalThis.fetch=(input,init)=>{
 const address=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href);
 if(address.origin!==location.origin)throw Error('web_connection_origin_denied');
 return mobileView?mobileFetch(new Request(input instanceof Request?input:address,init)):globalThis.fetch(input,{...init,credentials:'omit'});
};
export class ConnectionEvents extends EventTarget {
 private controller=new AbortController();
 private onStateApplied?:()=>void;
 onerror?:(code:string)=>void;
 constructor(path:string){super();if(mobileView)this.mobile(path);else void this.read(path);}
 close(){this.controller.abort();}
 stateApplied(){this.onStateApplied?.();}
 private mobile(path:string){
  if(path!=='/api/history/events'){queueMicrotask(()=>this.onerror?.('route_not_found'));return;}
  let pending:{superseded:boolean}|undefined,retry:ReturnType<typeof setTimeout>|undefined,retryMs=500;
  const clearRetry=()=>{clearTimeout(retry);retry=undefined;};
  const visible=()=>document.visibilityState!=='hidden';
  this.onStateApplied=()=>{
   if(pending)pending.superseded=true;
   clearRetry();retryMs=500;
   markMobileRecovery('state-applied');
  };
  const forward=(event:Event)=>{
   if(event.type==='unavailable'&&pending)pending.superseded=true;
   this.dispatchEvent(new MessageEvent(event.type,{data:(event as MessageEvent).data}));
  };
  const refresh=async()=>{
   clearRetry();
   if(this.controller.signal.aborted||!mobileConnected()||!visible())return;
   markMobileRecovery('authorized');
   if(pending)return;
   const read={superseded:false};
   pending=read;
   try{
    const value=await mobileCall('history.state');
    if(pending===read&&!read.superseded)this.dispatchEvent(new MessageEvent('state',{data:JSON.stringify(value)}));
   }catch(error){
    if(pending!==read||read.superseded)return;
    const code=error instanceof Error?error.message:'';
    if(['history_protocol_required','mobile_device_denied','route_not_found'].includes(code)){
     this.onerror?.(code);return;
    }
    this.onerror?.(code==='service_not_ready'?code:'web_state_unavailable');
    if(visible()){
     retry=setTimeout(refresh,retryMs);
     retryMs=Math.min(retryMs*2,10000);
    }
   }finally{if(pending===read)pending=undefined;}
  };
  const connection=()=>{
   if(this.controller.signal.aborted)return;
   if(mobileConnected()){void refresh();return;}
   pending=undefined;clearRetry();retryMs=500;
   this.onerror?.('mobile_not_connected');
  };
  mobileEvents.addEventListener('state',forward);
  mobileEvents.addEventListener('unavailable',forward);
  mobileEvents.addEventListener('connection',connection);
  mobileEvents.addEventListener('foreground',refresh);
  this.controller.signal.addEventListener('abort',()=>{
   pending=undefined;clearRetry();
   mobileEvents.removeEventListener('state',forward);
   mobileEvents.removeEventListener('unavailable',forward);
   mobileEvents.removeEventListener('connection',connection);
   mobileEvents.removeEventListener('foreground',refresh);
  },{once:true});
  queueMicrotask(connection);
 }
 private async read(path:string){
  try{
   const response=await connectionFetch(path,{signal:this.controller.signal});
   if(!response.ok){
    const value=await response.json().catch(()=>null);
    throw Error(typeof value?.error==='string'&&/^[a-z][a-z0-9_]{1,70}$/.test(value.error)?value.error:'web_state_unavailable');
   }
   if(!response.body)throw Error('web_state_unavailable');
   const reader=response.body.pipeThrough(new TextDecoderStream()).getReader();let buffer='';
   while(true){const {done,value}=await reader.read();if(done)throw Error('web_events_closed');buffer+=value;
    let boundary;while((boundary=buffer.indexOf('\n\n'))>=0){const frame=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);
     const lines=frame.split('\n'),name=lines.find(line=>line.startsWith('event:'))?.slice(6).trim()??'message';
     const data=lines.filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
     if(data)this.dispatchEvent(new MessageEvent(name,{data}));
    }
   }
  }catch(error){if(!this.controller.signal.aborted)this.onerror?.(error instanceof Error?error.message:'web_state_unavailable');}
 }
}
