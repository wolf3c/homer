export type MobileSignalEvent={type:'session'|'signal'|'closed';sessionId:string;description?:{type:'offer'|'answer';sdp:string};candidate?:{candidate:string;sdpMid:string|null;sdpMLineIndex:number|null;usernameFragment:string|null}|null};
// Same narrow WebSocket contract in Yezi2 production and its isolated lab.
export async function openMobileSignal(base:string,role:'host'|'mobile',onEvent:(event:MobileSignalEvent)=>void|Promise<void>,onClose=()=>{},abort?:AbortSignal){
 if(abort?.aborted)throw Error('mobile_signal_unavailable');
 const address=new URL(base+'/'+role);
 if(address.protocol!=='wss:'&&!(address.protocol==='ws:'&&address.hostname==='127.0.0.1'))throw Error('mobile_signal_origin_invalid');
 const socket=new WebSocket(address);let sequence=0,closed=false,eventTail=Promise.resolve();
 const pending=new Map<string,{resolve:(value:any)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
 const close=()=>{if(closed)return;closed=true;socket.close();for(const item of pending.values()){clearTimeout(item.timer);item.reject(Error('mobile_signal_unavailable'));}pending.clear();onClose();};
 socket.addEventListener('close',close);socket.addEventListener('error',close);
 socket.addEventListener('message',event=>{
  try{
   if(typeof event.data!=='string'||event.data.length>98304)throw Error();const frame=JSON.parse(event.data);
   if(frame.id){const item=pending.get(frame.id);if(!item)return;pending.delete(frame.id);clearTimeout(item.timer);if(frame.error)item.reject(Error('mobile_signal_'+String(frame.error.code).toLowerCase()));else item.resolve(frame.result);}
   else if(frame.event){if(!['session','signal','closed'].includes(frame.event.type)||! /^[A-Za-z0-9_-]{22}$/.test(frame.event.sessionId))throw Error();eventTail=eventTail.then(async()=>{if(!closed)await onEvent(frame.event);}).catch(close);}
   else throw Error();
  }catch{close();}
 });
 await new Promise<void>((resolve,reject)=>{
  const cleanup=()=>{clearTimeout(timer);socket.removeEventListener('open',opened);socket.removeEventListener('error',failed);socket.removeEventListener('close',failed);abort?.removeEventListener('abort',cancelled);};
  const opened=()=>{cleanup();resolve();},failed=()=>{cleanup();reject(Error('mobile_signal_unavailable'));},cancelled=()=>{close();failed();};
  const timer=setTimeout(()=>{cleanup();close();reject(Error('mobile_signal_timeout'));},10000);
  socket.addEventListener('open',opened);socket.addEventListener('error',failed);socket.addEventListener('close',failed);abort?.addEventListener('abort',cancelled,{once:true});
 });
 return {close,get closed(){return closed;},call(method:'challenge'|'register'|'connect'|'send'|'close',params:unknown):Promise<any>{
  if(closed||socket.readyState!==1||pending.size>=32)return Promise.reject(Error('mobile_signal_unavailable'));
  const id=String(++sequence),packet=JSON.stringify({id,method:'homer.rtc.'+method,params});if(packet.length>98304)return Promise.reject(Error('mobile_signal_size_limit'));
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('mobile_signal_timeout'));},10000);pending.set(id,{resolve,reject,timer});socket.send(packet);});
 }};
}
