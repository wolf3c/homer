import {execFile as execute,spawn as spawnProcess} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createServer as server} from 'node:net';
import {win32} from 'node:path';
import {promisify} from 'node:util';
import {serveWindowsWake,windowsWakePipe} from './desktop-wake.mjs';

const run=promisify(execute),instancePattern=/^[a-f0-9]{64}$/,idPattern=/^[a-f0-9]{32}$/;
const taskSource=()=>readFileSync(new URL('../packaging/windows/power-task.ps1',import.meta.url),'utf8');
const validPath=value=>typeof value==='string'&&/^[a-z]:\\/i.test(value)&&!/[<>"|?*\x00-\x1f]/.test(value)&&!value.slice(2).includes(':')&&win32.normalize(value)===value;
function contextValue({bundle,resources,profile,instanceId}){
 if(![bundle,resources,profile].every(validPath)||resources!==win32.join(bundle,'resources')||typeof instanceId!=='string'||!instancePattern.test(instanceId))throw Error('windows_wake_context_invalid');
 return {bundle,resources,profile,instanceId};
}
function eventValue(event,future,now){
 if(!event||Object.keys(event).some(key=>!['id','at'].includes(key))||typeof event.id!=='string'||!idPattern.test(event.id)||!Number.isSafeInteger(event.at)||event.at<=0||event.at>253402300499000||event.at%1000||future&&event.at<=now())throw Error('windows_wake_event_invalid');
 return {id:event.id,at:event.at};
}
function receiptValue(result,instanceId){
 let reply;try{reply=JSON.parse(result.stdout.replace(/^\uFEFF/,'').trim());}catch{throw Error('windows_wake_receipt_invalid');}
 if(reply?.ok===false){
  if(!['denied','unavailable','context_invalid','event_invalid','ownership_unconfirmed','conflict','cleanup_unconfirmed'].includes(reply.error))throw Error('windows_wake_receipt_invalid');
  throw Error('windows_wake_'+reply.error);
 }
 if(reply?.ok!==true||reply.instanceId!==instanceId||!Array.isArray(reply.events))throw Error('windows_wake_receipt_invalid');
 const seen=new Set();
 for(const event of reply.events){
  try{eventValue({id:event.id,at:event.at},false,Date.now);}catch{throw Error('windows_wake_receipt_invalid');}
  if(typeof event.session!=='string'||!idPattern.test(event.session)||Object.keys(event).some(key=>!['id','at','session'].includes(key))||seen.has(event.session+event.id))throw Error('windows_wake_receipt_invalid');
  seen.add(event.session+event.id);
 }
 return reply.events;
}

// Also used by the IPC-bound guardian; no shell text or executable is accepted.
export function createWindowsWakeTaskClient(options,{systemRoot=process.env.SystemRoot,execFile=run}={}){
 const context=contextValue(options);
 if(!validPath(systemRoot))throw Error('windows_wake_unavailable');
 const executable=win32.join(systemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
 return async(operation,{session=null,event=null}={})=>{
  if(!['status','list','schedule','cancel','clear'].includes(operation)||session!==null&&(typeof session!=='string'||!idPattern.test(session)))throw Error('windows_wake_context_invalid');
  if(event!==null)event=eventValue(event,false,Date.now);
  if(['schedule','cancel'].includes(operation)&&!event||['schedule','clear'].includes(operation)&&session===null)throw Error('windows_wake_context_invalid');
  let result;
  try{result=await execFile(executable,['-NoLogo','-NoProfile','-NonInteractive','-Command',taskSource()],{
   encoding:'utf8',timeout:15000,maxBuffer:65536,windowsHide:true,
   env:{SystemRoot:systemRoot,PSModulePath:win32.join(systemRoot,'System32/WindowsPowerShell/v1.0/Modules'),
    HOMER_WAKE_REQUEST:Buffer.from(JSON.stringify({format:1,...context,operation,session,event})).toString('base64')}
  });}catch{throw Error('windows_wake_transport_failed');}
  return receiptValue(result,context.instanceId);
 };
}

export function createWindowsWakeAdapter(options,dependencies={}){
 const {platform=process.platform,spawn=spawnProcess,createServer=server,session=randomBytes(16).toString('hex'),now=Date.now}=dependencies;
 const supported=platform==='win32',context=supported?contextValue(options):undefined;
 if(typeof session!=='string'||!idPattern.test(session)||supported&&typeof options.onWake!=='function')throw Error('windows_wake_context_invalid');
 let request;
 const invoke=(operation,fields)=>{
  if(!supported)throw Error('windows_wake_platform_unavailable');
  request??=createWindowsWakeTaskClient(context,dependencies);return request(operation,fields);
 };
 let closed=false,queue=Promise.resolve(),owner,pipe,guardian,guardianAlive=false,closing;
 const serialize=action=>{const result=queue.then(action);queue=result.catch(()=>{});return result;};
 async function startOwner(){
  if(owner&&!guardianAlive){await stopOwner();owner=undefined;}
  if(owner)return owner;
  owner=(async()=>{
   pipe=serveWindowsWake(windowsWakePipe(context.instanceId,session),session,()=>{if(!closed)Promise.resolve().then(options.onWake).catch(()=>{});},createServer);
   await new Promise((done,reject)=>{pipe.once('listening',done);pipe.once('error',()=>reject(Error('windows_wake_pipe_unavailable')));});
   pipe.unref();
   const child=spawn(win32.join(context.resources,'node.exe'),[win32.join(context.resources,'homer/scripts/desktop-wake.mjs'),'watch'],{
    cwd:context.profile,env:{SystemRoot:dependencies.systemRoot??process.env.SystemRoot},windowsHide:true,stdio:['ignore','ignore','ignore','ipc']
   });
   guardian=child;guardianAlive=true;
   child.once('exit',()=>{if(guardian===child)guardianAlive=false;});child.once('error',()=>{if(guardian===child)guardianAlive=false;});
   await new Promise((done,reject)=>{
    const timer=setTimeout(()=>failed(),5000);
    const finish=action=>{clearTimeout(timer);guardian.off('message',message);guardian.off('error',failed);guardian.off('exit',failed);action();};
    const failed=()=>finish(()=>reject(Error('windows_wake_guardian_unavailable')));
    const message=value=>{if(value?.type==='ready')finish(done);};
    guardian.on('message',message);guardian.once('error',failed);guardian.once('exit',failed);
    guardian.send({type:'watch',context,session},error=>{if(error)failed();});
   });
   guardian.unref();
  })();
  try{await owner;}catch(error){await stopOwner();owner=undefined;throw error;}
 }
 async function stopOwner(){
  if(pipe){await new Promise(done=>pipe.close(done));pipe=undefined;}
  const child=guardian;
  if(child&&typeof child.exitCode!=='number'&&typeof child.signalCode!=='string')await new Promise((done,reject)=>{
   const finish=error=>{clearTimeout(timer);child.off('exit',exited);child.off('close',exited);error?reject(error):done();};
   const exited=()=>finish(),timer=setTimeout(()=>finish(Error('windows_wake_guardian_stop_unconfirmed')),5000);
   child.once('exit',exited);child.once('close',exited);
   if(child.connected)child.disconnect();
  });
  if(guardian===child){guardian=undefined;guardianAlive=false;}
 }
 async function capability(){
  if(!supported)return {supported:false,authorization:'unavailable',reason:'windows_wake_platform_unavailable'};
  try{await invoke('status');return {supported:true,authorization:'authorized'};}
  catch(error){return {supported:error.message==='windows_wake_denied',authorization:error.message==='windows_wake_denied'?'denied':'unavailable',reason:error.message};}
 }
 return {
  status:()=>serialize(capability),authorize:()=>serialize(capability),
  list:()=>serialize(async()=>{
   let events=await invoke('list');
   const stale=new Set(events.filter(event=>event.session!==session||!guardianAlive).map(event=>event.session));
   for(const previous of stale){events=await invoke('clear',{session:previous});if(events.some(event=>event.session===previous))throw Error('windows_wake_cleanup_unconfirmed');}
   return events.filter(event=>event.session===session).map(({id,at})=>({id,at}));
  }),
  schedule(event){
   let value;try{if(closed)throw Error('windows_wake_closed');value=eventValue(event,true,now);}catch(error){return Promise.reject(error);}
   return serialize(async()=>{
    await startOwner();if(!guardianAlive)throw Error('windows_wake_guardian_unavailable');
    const events=await invoke('schedule',{session,event:value});
    if(!events.some(event=>event.session===session&&event.id===value.id&&event.at===value.at))throw Error('windows_wake_receipt_invalid');
    return value;
   });
  },
  cancel(event){
   let value;try{value=eventValue(event,false,now);}catch(error){return Promise.reject(error);}
   return serialize(async()=>{const events=await invoke('cancel',{event:value});if(events.some(event=>event.id===value.id&&event.at===value.at))throw Error('windows_wake_cleanup_unconfirmed');});
  },
  close(){
   closed=true;
   if(closing)return closing;
   closing=serialize(async()=>{
    try{if(supported){const events=await invoke('clear',{session});if(events.some(event=>event.session===session))throw Error('windows_wake_cleanup_unconfirmed');}}
    finally{await stopOwner();}
   });
   closing.catch(()=>{closing=undefined;});return closing;
  }
 };
}
