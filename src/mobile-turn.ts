import {isIPv4} from 'node:net';
import type {IceServer} from 'node-datachannel';
import {validateHomerOrigins} from './homer-account.js';

export type MobileTurnStatus='account_required'|'configuration_required'|'network_restricted'|undefined;

// One instance belongs to one host/account lifetime; credentials never enter UI or disk.
export function createMobileTurn({gatewayOrigin,token,allowSyntheticLoopback=false}:{gatewayOrigin:string;token:string;allowSyntheticLoopback?:boolean}) {
 validateHomerOrigins({websiteOrigin:gatewayOrigin,gatewayOrigin},allowSyntheticLoopback);
 if(!/^[\x21-\x7e]{1,4096}$/.test(token))throw Error('mobile_turn_account_invalid');
 const stamp=()=>({wall:Date.now(),mono:performance.now()});
 const age=(at:ReturnType<typeof stamp>)=>Math.max(0,Date.now()-at.wall,performance.now()-at.mono);
 let cache:{servers:IceServer[];at:ReturnType<typeof stamp>;refresh:number}|undefined;
 let flight:Promise<void>|undefined,abort:AbortController|undefined,timer:ReturnType<typeof setTimeout>|undefined;
 let status:MobileTurnStatus;
 let stopped=false,paused:''|'auth'|'ip'='',retryAt=stamp(),retryDelay=0,failures=0;
 const valid=()=>cache&&age(cache.at)<3570000?cache.servers:[];
 const schedule=(delay:number)=>{if(timer)clearTimeout(timer);timer=setTimeout(()=>{timer=undefined;void request();},Math.max(1,delay));timer.unref?.();};
 const wait=()=>Math.max(0,retryDelay-age(retryAt));
 function request():Promise<void>{
  if(stopped||paused)return Promise.resolve();
  if(flight)return flight;
  if(wait()>0){schedule(wait());return Promise.resolve();}
  if(cache&&age(cache.at)<cache.refresh){schedule(cache.refresh-age(cache.at));return Promise.resolve();}
  if(timer)clearTimeout(timer);timer=undefined;
  const operation=new AbortController(),at=stamp();abort=operation;
  const deadline=setTimeout(()=>operation.abort(),5000);deadline.unref?.();
  flight=(async()=>{
   let delay=0;
   try{
    const response=await fetch(gatewayOrigin+'/api/homer/turn/credentials',{method:'POST',headers:{Authorization:'Bearer '+token},redirect:'error',credentials:'omit',cache:'no-store',signal:operation.signal});
    // Bounded read: malformed endpoints cannot retain arbitrary response bodies.
    let body='';if(response.body){const reader=response.body.getReader();try{for(;;){const {done,value}=await reader.read();if(done)break;body+=new TextDecoder().decode(value);if(body.length>8192)throw Error('mobile_turn_response_invalid');}}finally{await reader.cancel().catch(()=>{});}}
    if(stopped)return;
    if(operation.signal.aborted)throw Error('mobile_turn_timeout');
    if(response.status===401||response.status===403){
     let code;try{code=JSON.parse(body).code;}catch{}
     status=response.status===401?'account_required':code==='ip_not_allowed'?'network_restricted':'configuration_required';
     paused=response.status===403&&code==='ip_not_allowed'?'ip':'auth';cache=undefined;retryAt=stamp();retryDelay=60000;return;
    }
    if(response.status===429){const value=response.headers.get('Retry-After')??'';const seconds=/^\d+$/.test(value)?Number(value)*1000:Date.parse(value)-Date.now();delay=Number.isFinite(seconds)?Math.max(60000,seconds):60000;throw Error('mobile_turn_limited');}
    if(!response.ok)throw Error('mobile_turn_unavailable');
    const data=JSON.parse(body),server=data?.iceServers?.[0];
    const match=typeof server?.urls?.[0]==='string'?/^turn:([0-9.]+):([0-9]{1,5})\?transport=udp$/.exec(server.urls[0]):null;
    const hostname=match?.[1]??'',port=Number(match?.[2]);
    if(data.ttlSeconds!==3600||!Number.isSafeInteger(data.expiresAt)||data.expiresAt<=0||data.iceServers.length!==1||server.urls.length!==1||!match||!isIPv4(hostname)||port<1||port>65535||typeof server.username!=='string'||!new RegExp('^'+data.expiresAt+':[0-9a-f]{32}$').test(server.username)||typeof server.credential!=='string'||!/^[A-Za-z0-9+/]{27}=$/.test(server.credential))throw Error('mobile_turn_response_invalid');
    cache={servers:[{hostname,port,username:server.username,password:server.credential,relayType:'TurnUdp'}],at,refresh:2640000+Math.floor(Math.random()*60000)};
    status=undefined;failures=0;retryDelay=0;
   }catch{
    if(stopped)return;
    failures++;retryAt=stamp();retryDelay=delay||Math.min(60000*2**Math.min(failures-1,4),900000);
   }finally{
    clearTimeout(deadline);if(abort===operation)abort=undefined;flight=undefined;
    if(!stopped&&!paused)schedule(retryDelay?wait():cache?cache.refresh-age(cache.at):60000);
   }
  })();
  return flight;
 }
 return {
  get status(){return status;},
  async get():Promise<IceServer[]>{if(stopped)return [];const pending=request(),existing=valid();if(existing.length)return existing;await pending;return stopped?[]:valid();},
  // Reuse signaling reconnect as the existing network-recovery trigger.
  networkChanged(){if(stopped||paused==='auth')return;if(paused==='ip')paused='';void request();},
  close(){stopped=true;cache=undefined;paused='auth';abort?.abort();if(timer)clearTimeout(timer);timer=undefined;}
 };
}
