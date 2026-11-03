import {readFileSync,lstatSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {MobileDevices} from './mobile-devices.js';
import {mobileRoute} from './mobile-route.js';
import {startMobileRtc} from './mobile-rtc.js';
import {createWebServer} from './web-server.js';
import {createWebChat} from './web-chat.js';
import {StatePublication} from './state-publication.js';

export async function createMobileGateway(options:Parameters<typeof createWebServer>[0]&{databasePath:string;signalOrigin:string;routeKeyPath?:string}){
 const {databasePath,signalOrigin,routeKeyPath=join(dirname(databasePath),'mobile-route.pem'),...webOptions}=options;
 const origin=new URL(signalOrigin);
 if(origin.origin!==signalOrigin||origin.username||origin.password||!(origin.protocol==='https:'||origin.protocol==='http:'&&origin.hostname==='127.0.0.1'))throw Error('mobile_signal_origin_invalid');
 const route=mobileRoute(routeKeyPath),devices=new MobileDevices(databasePath);
 const chat=createWebChat({...webOptions.bridge,submit:async input=>{
  const state=await webOptions.bridge.state();
  if(state.upgrade.phase!=='running'||state.upgrade.accepting===false)throw Error('service_upgrading');
  return webOptions.bridge.submit(input);
 }});
 const rtc=startMobileRtc({signalOrigin,route,devices,call:chat});
 const publication=new StatePublication(()=>chat('history.state'),value=>{void rtc.event('state',value);},()=>{void rtc.event('unavailable',{});},()=>rtc.connected);
 const unsubscribe=webOptions.bridge.onStateChange?.(()=>publication.invalidate());
 let main:Awaited<ReturnType<typeof createWebServer>>;
 try{main=await createWebServer({...webOptions,deviceManagement:{devices,invitationUrl:signalOrigin+'/homer/mobile/'+route.routeId}});}
 catch(error){unsubscribe?.();publication.close();rtc.close();devices.close();throw error;}
 return {url:main.url,ready:rtc.ready,
  publish(){main.publish();publication.invalidate();},reset(){main.reset();publication.reset();},
  disconnectClients(){main.disconnectClients();rtc.disconnect();},
  async close(){unsubscribe?.();publication.close();rtc.close();try{await main.close();}finally{devices.close();}}
 };
}

// One shared signaling service; no per-host domain or public HTTP listener.
export function readMobileConfig(path:string):{mobileSignalOrigin:string}{
 const stat=lstatSync(path,{throwIfNoEntry:false});if(!stat)return {mobileSignalOrigin:'https://super-tree.com'};
 if(!stat.isFile()||stat.isSymbolicLink())throw Error('mobile_config_invalid');
 let value;try{value=JSON.parse(readFileSync(path,'utf8'));}catch{throw Error('mobile_config_invalid');}
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>key!=='signalOrigin')||typeof value.signalOrigin!=='string')throw Error('mobile_config_invalid');
 let origin;try{origin=new URL(value.signalOrigin);}catch{throw Error('mobile_signal_origin_invalid');}
 if(origin.protocol!=='https:'||origin.origin!==value.signalOrigin||origin.username||origin.password)throw Error('mobile_signal_origin_invalid');
 return {mobileSignalOrigin:value.signalOrigin};
}
