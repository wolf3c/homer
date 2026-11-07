import {mobileChannel} from '../src/mobile-channel.js';
import {openMobileSignal} from '../src/mobile-signaling.js';
import {WEB_PROTOCOL} from '../src/web-contract.js';
declare global{interface Window{__homerMobileNonce?:string;__homerMobileUpdate?:{version:string;openError:boolean}|null;ReactNativeWebView?:{postMessage:(message:string)=>void};}}

type Binding={signalOrigin:string;routeId:string;invitation?:string;credential?:string;deviceName?:string};
type Packet={id?:string;result?:any;error?:string;event?:string;value?:unknown};
export const mobileEvents=new EventTarget();
let binding:Binding|undefined,dispose:(()=>void)|undefined,retry:ReturnType<typeof setTimeout>|undefined;
let request:((op:string,input:unknown)=>Promise<any>)|undefined,connected=false,manualRescanRequired=false;
let cancelPairing:(()=>Promise<'cancelled'|'absent'|'approved'>)|undefined;
function notice(code:string,nonce=window.__homerMobileNonce){window.ReactNativeWebView?.postMessage(JSON.stringify({type:'connection-status',code,nonce}));}
function changed(){mobileEvents.dispatchEvent(new Event('connection'));}
export function mobileConnected(){return connected;}
export async function mobileCall(op:string,input:unknown={}){if(!connected||!request)throw Error('mobile_not_connected');return request(op,input);}
function start(){
 dispose?.();if(retry)clearTimeout(retry);retry=undefined;connected=false;request=undefined;cancelPairing=undefined;changed();
 const current=binding,nonce=window.__homerMobileNonce;if(!current){notice('scan',nonce);return;}
 const update=(code:string)=>notice(code,nonce);
 const abort=new AbortController(),pc=new RTCPeerConnection({iceServers:[{urls:['stun:120.27.120.125:3478','stun:stun.l.google.com:19302']}]});
 let ended=false,sessionId:string|undefined,sequence=0,link:Awaited<ReturnType<typeof openMobileSignal>>|undefined,channel:ReturnType<typeof mobileChannel>|undefined,poll:ReturnType<typeof setTimeout>|undefined;
 const pending=new Map<string,{resolve:(v:any)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
 const finish=(reconnect=true)=>{if(ended)return;ended=true;abort.abort();if(poll)clearTimeout(poll);clearTimeout(deadline);link?.close();channel?.close();pc.close();connected=false;request=undefined;for(const value of pending.values()){clearTimeout(value.timer);value.reject(Error('web_receipt_unconfirmed'));}pending.clear();changed();if(reconnect&&binding===current){update('unavailable');retry=setTimeout(start,3000);}};
 dispose=()=>finish(false);
 const deadline=setTimeout(()=>finish(),30000);
 const call=(op:string,input:unknown):Promise<any>=>{
  if(ended||!channel||pending.size>=8)return Promise.reject(Error('mobile_not_connected'));
  const id=String(++sequence);
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('web_receipt_unconfirmed'));},op==='media.upload'?180000:15000);pending.set(id,{resolve,reject,timer});void channel!.send({id,op,input}).catch(()=>finish());});
 };
 cancelPairing=async()=>{
  if(!current.credential)throw Error('mobile_credential_missing');
  const result=await call('pair.cancel',{credential:current.credential});
  if(result.protocol!==WEB_PROTOCOL||!['cancelled','absent','approved'].includes(result.status))throw Error('mobile_cancel_unconfirmed');
  return result.status;
 };
 async function authorize(){
  if(ended)return;
  const credential=current!.credential;
  let result=await call('status',{credential});
  if(!ended&&result.protocol===WEB_PROTOCOL&&current!.invitation){
   result=await call('pair',{invitation:current!.invitation,credential,deviceName:current!.deviceName,protocol:WEB_PROTOCOL});
  }
  if(ended)return;
  if(result.protocol!==WEB_PROTOCOL){update('version');finish(false);return;}
  if(result.credential){current!.credential=result.credential;delete current!.invitation;window.ReactNativeWebView?.postMessage(JSON.stringify({type:'credential',routeId:current!.routeId,credential:result.credential,nonce}));}
  if(result.status==='pending'){update('pending');poll=setTimeout(()=>void authorize().catch(authorizationFailed),1500);return;}
  if(result.status==='expired'){manualRescanRequired=true;update('approval-timeout');finish(false);return;}
  if(result.status!=='active'){update('denied');finish(false);return;}
  connected=true;request=call;update('active');changed();
 }
 const authorizationFailed=(error:unknown)=>{
  if(ended)return;
  if(error instanceof Error&&(error.message==='mobile_invitation_expired'||error.message==='mobile_pairing_busy')){
   manualRescanRequired=true;update(error.message==='mobile_pairing_busy'?'pairing-busy':'invitation-expired');finish(false);
  }else finish();
 };
 pc.ondatachannel=({channel:dc})=>{
  dc.binaryType='arraybuffer';dc.onclose=()=>finish();dc.onerror=()=>finish();
  dc.onopen=()=>{clearTimeout(deadline);channel=mobileChannel({send:bytes=>dc.send(bytes as Uint8Array<ArrayBuffer>),buffered:()=>dc.bufferedAmount,closed:()=>dc.readyState!=='open',close:()=>dc.close(),receive:fn=>{dc.onmessage=event=>{if(!(event.data instanceof ArrayBuffer)){finish();return;}fn(new Uint8Array(event.data));};}},value=>{
   const packet=value as Packet;
   if(packet?.id){const item=pending.get(packet.id);if(!item)return;clearTimeout(item.timer);pending.delete(packet.id);if(packet.error)item.reject(Error(packet.error));else item.resolve(packet.result);}
   else if(connected&&packet?.event)mobileEvents.dispatchEvent(new MessageEvent(packet.event,{data:JSON.stringify(packet.value)}));
  });void authorize().catch(authorizationFailed);};
 };
 pc.onconnectionstatechange=()=>{if(['failed','disconnected','closed'].includes(pc.connectionState))finish();};
 pc.onicecandidate=({candidate})=>{if(candidate&&sessionId)void link?.call('send',{sessionId,candidate:{candidate:candidate.candidate,sdpMid:candidate.sdpMid??null,sdpMLineIndex:candidate.sdpMLineIndex??null,usernameFragment:candidate.usernameFragment??null}}).catch(()=>{if(!connected)finish();});};
 update('connecting');
 void (async()=>{
  link=await openMobileSignal(current.signalOrigin.replace(/^http/,'ws')+'/homer/rtc','mobile',async event=>{
   if(ended)return;sessionId=event.sessionId;
   if(event.type==='closed'){if(!channel)finish();return;}
   if(event.description){await pc.setRemoteDescription(event.description);await pc.setLocalDescription(await pc.createAnswer());await link!.call('send',{sessionId,description:pc.localDescription!.toJSON()});}
   else if(event.candidate)await pc.addIceCandidate(event.candidate);
  },()=>{if(!channel)finish();},abort.signal);
  if(ended){link.close();return;}
  await link.call('connect',{routeId:current.routeId});
 })().catch(()=>{if(!channel)finish();});
}
if(typeof window!=='undefined')window.addEventListener?.('homer-mobile-connect',event=>{
 const next=(event as CustomEvent).detail as Binding|undefined;
 if(next&&(!/^[a-f0-9]{64}$/.test(next.routeId)||typeof next.signalOrigin!=='string'))return;
 binding=next?{...next}:undefined;manualRescanRequired=false;start();
});
if(typeof window!=='undefined')window.addEventListener?.('homer-mobile-cancel',()=>{
 const nonce=window.__homerMobileNonce,cancel=cancelPairing;
 void (async()=>{
  let result:'cancelled'|'absent'|'approved'|'unavailable'='unavailable';
  try{if(cancel)result=await cancel();}catch{/* No receipt means the request is still unconfirmed. */}
  window.ReactNativeWebView?.postMessage(JSON.stringify({type:'cancel-result',result,nonce}));
 })();
});
if(typeof document!=='undefined')document.addEventListener?.('visibilitychange',()=>{if(document.visibilityState!=='hidden'&&binding&&!connected&&!manualRescanRequired)start();});
// Native load-end can precede this module's listener registration on iOS.
if(typeof window!=='undefined')window.ReactNativeWebView?.postMessage(JSON.stringify({type:'ready'}));
