import {fork} from 'node:child_process';

export type CuaReply={isError:boolean;errorCode?:string;text?:string;structuredJson?:string;images?:{dataBase64:string;mimeType:string}[]};
export type CuaDriver={callTool(name:string,args:string):Promise<CuaReply>;metadata():Promise<{pid:number;driverVersion:string}>;shutdown():Promise<void>;uniffiDestroy():void|Promise<void>};

export function cuaDriverFailure(error:unknown,stage:'startup'|'call'){
 const e=error as {tag?:string;inner?:{reason?:unknown}}|undefined;
 if(stage==='startup')return e?.tag==='ActionInterrupted'&&typeof e.inner?.reason==='string'&&
  /^private worker did not answer request 0 within \d+ms$/.test(e.inner.reason)?'cua_driver_startup_timeout':'cua_driver_startup_failed';
 return e?.tag==='Transport'?'cua_driver_transport_failed':e?.tag==='Protocol'?'cua_driver_protocol_failed':'cua_driver_unavailable';
}

export function createPrivateCuaDriver(sdkUrl:string,options:object):CuaDriver{
 // The native SDK cannot safely share a process across Node isolates.
 const child=fork(new URL(import.meta.url),['--homer-cua-driver'],{execArgv:[],serialization:'advanced',stdio:['ignore','ignore','ignore','ipc']});
 let sequence=0,stopping=false,closed=false,failed:string|undefined,shutdown:Promise<void>|undefined;
 const pending=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void}>();
 let readyResolve!:(value:{pid:number;driverVersion:string})=>void,readyReject!:(error:Error)=>void,exitedResolve!:()=>void;
 const ready=new Promise<{pid:number;driverVersion:string}>((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
 void ready.catch(()=>{});
 const exited=new Promise<void>(resolve=>{exitedResolve=resolve;});
 const fail=(code:string)=>{
  failed??=code;readyReject(Error(failed));
  for(const call of pending.values())call.reject(Error(failed));
  pending.clear();
 };
 child.on('message',(message:any)=>{
  if(message.type==='ready'){if(!stopping)readyResolve(message.metadata);return;}
  if(message.type==='startup_error'){fail(message.code);return;}
  const call=pending.get(message.id);if(!call)return;
  pending.delete(message.id);
  if(message.error)call.reject(Error(message.error));else call.resolve(message.result);
 });
 child.once('error',()=>fail('cua_driver_unavailable'));
 child.once('close',()=>{closed=true;fail(stopping?'cua_stopped':'cua_driver_unavailable');exitedResolve();});
 const post=(message:object)=>{
  try{child.send(message,error=>{if(error)fail('cua_driver_unavailable');});}
  catch{fail('cua_driver_unavailable');}
 };
 const send=(method:string,name?:string,args?:string)=>new Promise<any>((resolve,reject)=>{
  if(closed){reject(Error(failed??'cua_stopped'));return;}
  const id=++sequence;pending.set(id,{resolve,reject});post({id,method,name,args});
 });
 post({sdkUrl,options});
 return {
  async metadata(){if(stopping)throw Error('cua_stopped');if(failed)throw Error(failed);return ready;},
  async callTool(name,args){await ready;if(stopping)throw Error('cua_stopped');if(failed)throw Error(failed);return send('call',name,args);},
  shutdown(){
   if(!shutdown){stopping=true;readyReject(Error('cua_stopped'));shutdown=closed?Promise.resolve():send('shutdown').finally(()=>exited);}
   return shutdown;
  },
  async uniffiDestroy(){stopping=true;fail('cua_stopped');if(!closed)child.kill('SIGKILL');await exited;},
 };
}

if(process.argv[2]==='--homer-cua-driver'&&process.send){
 process.once('disconnect',()=>process.exit(0));
 const {sdkUrl,options}=await new Promise<{sdkUrl:string;options:object}>(resolve=>process.once('message',resolve));
 let driver:CuaDriver|undefined;
 const initialized=(async()=>{
  try{
   const {CuaDriver}=await import(sdkUrl);
   driver=CuaDriver.createPrivateWorker(options);
   const metadata=await driver!.metadata();
   if(!metadata||!Number.isSafeInteger(metadata.pid)||metadata.pid<=1||typeof metadata.driverVersion!=='string')throw Error('invalid_metadata');
   process.send!({type:'ready',metadata});
  }catch(error){process.send!({type:'startup_error',code:cuaDriverFailure(error,'startup')});}
 })();
 process.on('message',async(message:any)=>{
  await initialized;
  if(message.method==='shutdown'){
   let error:string|undefined;
   try{await driver?.shutdown();}catch{error='cua_driver_shutdown_failed';}
   finally{try{await driver?.uniffiDestroy();}catch{error='cua_driver_shutdown_failed';}}
   process.send!({id:message.id,error},()=>process.disconnect());return;
  }
  try{process.send!({id:message.id,result:await driver!.callTool(message.name,message.args)});}
  catch(error){process.send!({id:message.id,error:cuaDriverFailure(error,'call')});}
 });
}
