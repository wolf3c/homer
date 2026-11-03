import type {MobileDevices} from './mobile-devices.js';
import {mobileChannel,type MobileChannelPort} from './mobile-channel.js';
import {WEB_PROTOCOL} from './web-contract.js';

// Credentials and approval stay with the existing device owner, never signaling.
export function openMobileSession({devices,port,call}:{devices:MobileDevices;port:MobileChannelPort;call:(op:string,input:unknown)=>Promise<unknown>}){
 let credential:string|undefined,deviceId:string|undefined,closed=false,inFlight=0;
 const code=(error:unknown)=>error instanceof Error&&/^[a-z][a-z0-9_]{1,70}$/.test(error.message)?error.message:'mobile_request_failed';
 const close=()=>{if(closed)return;closed=true;unsubscribe();credential=undefined;channel.close();};
 const channel=mobileChannel(port,value=>{
  if(closed)return;
  if(!value||typeof value!=='object'||Array.isArray(value)){close();return;}
  const packet=value as {id?:unknown;op?:unknown;input?:unknown};
  if(typeof packet.id!=='string'||!/^\d{1,9}$/.test(packet.id)||typeof packet.op!=='string'||!/^[a-z][a-z.]{0,63}$/.test(packet.op)){close();return;}
  const {id,op,input}=packet;
  if(inFlight>=8){void channel.send({id,error:'mobile_request_busy'}).catch(close);return;}
  inFlight++;
  void (async()=>{
   try{
    let result:unknown;
    if(op==='pair'||op==='status'||op==='pair.cancel'){
     if(!input||typeof input!=='object'||Array.isArray(input))throw Error('mobile_pairing_invalid');
     const fields=input as {credential?:unknown;invitation?:unknown;deviceName?:unknown};
     if(fields.credential!==undefined&&(typeof fields.credential!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(fields.credential)))throw Error('mobile_credential_invalid');
     if(op==='pair.cancel'){
      if(typeof fields.credential!=='string')throw Error('mobile_credential_invalid');
      result={status:devices.cancelPairing(fields.credential),protocol:WEB_PROTOCOL};
     }else if(op==='pair'){
      const paired=devices.pair(fields.invitation,fields.credential as string|undefined,fields.deviceName);
      credential=paired.credential;deviceId=devices.authorize(credential);result={...paired,protocol:WEB_PROTOCOL};
     }else{
      credential=fields.credential as string|undefined??credential;deviceId=devices.authorize(credential);
      result={status:devices.status(credential),protocol:WEB_PROTOCOL};
     }
    }else{
     deviceId=devices.authorize(credential);
     if(!deviceId)throw Error('mobile_device_denied');
     result=await call(op,input);
    }
    if(!closed)await channel.send({id,result:result??{}});
   }catch(error){if(!closed)await channel.send({id,error:code(error)});}
   finally{inFlight--;}
  })().catch(close);
 });
 const unsubscribe=devices.onRevoke(id=>{if(id===deviceId)close();});
 return {close,get authorized(){return !closed&&!!devices.authorize(credential);},async event(event:string,value:unknown){if(!closed&&devices.authorize(credential))await channel.send({event,value});}};
}
