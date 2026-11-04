import rtc,{type PeerConnection,type DataChannel} from 'node-datachannel';
import type {createMobileTurn} from './mobile-turn.js';
import type {MobileDevices} from './mobile-devices.js';
import type {mobileRoute} from './mobile-route.js';
import {openMobileSignal,type MobileSignalEvent} from './mobile-signaling.js';
import {openMobileSession} from './mobile-session.js';

// The stable gateway owns all Node RTC peers; signaling never sees device secrets.
export function startMobileRtc({signalOrigin,route,devices,call,turn,iceServers=['stun:stun.l.google.com:19302']}:{signalOrigin:string;route:ReturnType<typeof mobileRoute>;devices:MobileDevices;call:(op:string,input:unknown)=>Promise<unknown>;iceServers?:string[];turn?:Pick<ReturnType<typeof createMobileTurn>,'get'|'networkChanged'>}){
 const origin=new URL(signalOrigin);
 if(origin.origin!==signalOrigin||origin.username||origin.password||!(origin.protocol==='https:'||origin.protocol==='http:'&&origin.hostname==='127.0.0.1'))throw Error('mobile_signal_origin_invalid');
 if(iceServers.some(value=>!/^stun:[a-z0-9.-]+(?::[0-9]{1,5})?$/i.test(value)))throw Error('mobile_stun_invalid');
 const address=signalOrigin.replace(/^http/,'ws')+'/homer/rtc',abort=new AbortController();
 type Peer={peer:PeerConnection;channel:DataChannel;session?:ReturnType<typeof openMobileSession>;timer:ReturnType<typeof setTimeout>};
 const peers=new Map<string,Peer>();let generation=0,closed=false,link:Awaited<ReturnType<typeof openMobileSignal>>|undefined,retry:ReturnType<typeof setTimeout>|undefined;
 const remove=(id:string)=>{const current=peers.get(id);if(!current)return;peers.delete(id);clearTimeout(current.timer);current.session?.close();current.channel.close();current.peer.close();};
 function schedule(){if(closed||retry)return;retry=setTimeout(()=>{retry=undefined;void register().catch(schedule);},5000);retry.unref?.();}
 async function handle(client:Awaited<ReturnType<typeof openMobileSignal>>,event:MobileSignalEvent){
  if(closed)return;
  const id=event.sessionId;
  if(event.type==='session'){
   if(peers.has(id))return;
   if(peers.size>=8){void client.call('close',{sessionId:id}).catch(()=>{});return;}
   const observed=generation,started=Date.now();
   const relay=await turn?.get()??[];
   if(closed||client.closed||observed!==generation)return;
   const peer=new rtc.PeerConnection('homer-mobile',{iceServers:[...iceServers,...relay]});
   const send=(value:unknown)=>void client.call('send',value).catch(()=>{if(!peers.get(id)?.session)remove(id);});
   peer.onLocalDescription((sdp,type)=>send({sessionId:id,description:{type,sdp}}));
   peer.onLocalCandidate((candidate,sdpMid)=>send({sessionId:id,candidate:{candidate:candidate.replace(/^a=/,''),sdpMid,sdpMLineIndex:0,usernameFragment:null}}));
   peer.onStateChange(state=>{if(['closed','failed','disconnected'].includes(state))remove(id);});
   const channel=peer.createDataChannel('homer'),timer=setTimeout(()=>remove(id),Math.max(1,30000-(Date.now()-started)));timer.unref?.();
   const current:Peer={peer,channel,timer};peers.set(id,current);
   channel.onClosed(()=>remove(id));channel.onError(()=>remove(id));
   channel.onOpen(()=>{
    if(closed||!peers.has(id)){channel.close();return;}
    clearTimeout(current.timer);
    current.session=openMobileSession({devices,call,port:{
     // false means SCTP queued the bytes; mobileChannel already waits on bufferedAmount.
     send:value=>{channel.sendMessageBinary(value);},
     buffered:()=>channel.bufferedAmount(),closed:()=>!channel.isOpen(),close:()=>remove(id),
     receive:fn=>channel.onMessage(value=>{if(typeof value==='string')remove(id);else fn(new Uint8Array(value));})
    }});
    current.timer=setTimeout(()=>{if(!current.session?.authorized)remove(id);},5*60*1000);current.timer.unref?.();
   });
  }else if(event.type==='closed'){
   // Yezi2 expires negotiation state; an established data channel survives it.
   if(!peers.get(id)?.session)remove(id);
  }else{
   const current=peers.get(id);if(!current)return;
   try{if(event.description)current.peer.setRemoteDescription(event.description.sdp,event.description.type);else if(event.candidate?.candidate)current.peer.addRemoteCandidate(event.candidate.candidate,event.candidate.sdpMid??'0');}catch{remove(id);}
  }
 }
 async function register(){
  const current=await openMobileSignal(address,'host',event=>handle(current,event),()=>{for(const [id,peer] of peers)if(!peer.session)remove(id);schedule();},abort.signal);
  if(closed){current.close();return;}
  link=current;
  try{const challenge=await current.call('challenge',{routeId:route.routeId});await current.call('register',route.prove(challenge));turn?.networkChanged();}
  catch(error){current.close();throw error;}
 }
 const ready=register();void ready.catch(schedule);
 return {ready,routeId:route.routeId,
  get connected(){return [...peers.values()].some(peer=>peer.session?.authorized);},
  disconnect(){generation++;for(const id of peers.keys())remove(id);},
  async event(name:string,value:unknown){await Promise.all([...peers].map(async([id,peer])=>{try{await peer.session?.event(name,value);}catch{remove(id);}}));},
  close(){if(closed)return;closed=true;abort.abort();link?.close();if(retry)clearTimeout(retry);for(const id of peers.keys())remove(id);rtc.cleanup();}
 };
}
