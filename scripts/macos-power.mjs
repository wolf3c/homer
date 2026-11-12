import {spawn as spawnProcess} from 'node:child_process';
import {lstatSync,realpathSync} from 'node:fs';
import {isAbsolute,join,resolve} from 'node:path';

const validEvent=event=>event&&Object.keys(event).sort().join(',')==='at,id'&&/^[a-f0-9]{32}$/.test(event.id)&&Number.isSafeInteger(event.at)&&event.at>0&&event.at%1000===0;
const failure=value=>Error(typeof value==='string'&&/^macos_power_[a-z0-9_]+(?::[0-9-]+)?$/.test(value)?value:'macos_power_native_failed');
function packaged(bundle,resources){
 try{
  if(!isAbsolute(bundle)||resolve(bundle)!==bundle||realpathSync(bundle)!==bundle||resources!==join(bundle,'Contents/Resources'))return false;
  for(const part of ['Contents/MacOS/homer-power-client','Contents/MacOS/homer-power-helper','Contents/Library/LaunchDaemons/app.homer.desktop.power.plist']){
   const path=join(bundle,part),stat=lstatSync(path);if(!stat.isFile()||realpathSync(path)!==path||(stat.mode&0o022))return false;
  }
  return true;
 }catch{return false;}
}

// Native dependencies are injected only by offline tests. No renderer chooses a binary or command.
export function createMacWakeAdapter({bundle,resources,instanceId,onWake}, {platform=process.platform,spawn=spawnProcess,checkBundle=packaged,timeoutMs=10000}={}){
 if(typeof instanceId!=='string'||!/^[a-f0-9]{64}$/.test(instanceId))throw Error('macos_power_instance_invalid');
 const unavailable=platform!=='darwin'?'macos_power_platform_unsupported':!checkBundle(bundle,resources)?'macos_power_bundle_unavailable':undefined;
 let client,sequence=0,closed=false,closing,started=false,capability,helperMayExist=false;
 const pending=new Map();
 function launch(){
  if(client)return client;
  const child=spawn(join(bundle,'Contents/MacOS/homer-power-client'),['--instance',instanceId],{shell:false,stdio:['pipe','pipe','ignore'],env:{PATH:'/usr/bin:/bin',HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,LANG:'en_US.UTF-8'}});
  client=child;started=true;
  let buffer='';
  function lost(reason){
   if(client===child)client=undefined;
   for(const [key,call]of pending)if(call.child===child){clearTimeout(call.timer);pending.delete(key);call.reject(failure(reason));}
  }
  child.once('error',()=>lost('macos_power_client_failed'));
  child.once('exit',()=>lost('macos_power_client_exited'));
  child.stdin.on('error',()=>lost('macos_power_client_failed'));
  child.stdout.on('error',()=>lost('macos_power_client_failed'));
  child.stdout.on('data',bytes=>{
   buffer+=bytes.toString('utf8');
   if(Buffer.byteLength(buffer)>65536){lost('macos_power_response_invalid');child.kill();return;}
   for(let at;(at=buffer.indexOf('\n'))>=0;){
    const line=buffer.slice(0,at);buffer=buffer.slice(at+1);
    let result;
    try{result=JSON.parse(line);}catch{lost('macos_power_response_invalid');child.kill();return;}
    if(result?.kind==='wake'&&Object.keys(result).length===1){try{onWake?.();}catch{}continue;}
    if(!Number.isSafeInteger(result?.requestId)||typeof result.ok!=='boolean'){lost('macos_power_response_invalid');child.kill();return;}
    const call=pending.get(result.requestId);if(!call||call.child!==child)continue;
    clearTimeout(call.timer);pending.delete(result.requestId);
    if(result.ok)call.resolve(result.result);else call.reject(failure(result.error));
   }
  });
  return child;
 }
 function request(op,fields={},allowClosing=false){
  if(closed&&!allowClosing)return Promise.reject(Error('macos_power_closed'));
  if(unavailable)return Promise.reject(Error(unavailable));
  // An unavailable capability cannot erase a possibly completed registration or event request.
  if(!['status','close'].includes(op))helperMayExist=true;
  return new Promise((resolve,reject)=>{
   let child;
   try{child=launch();}catch{return reject(Error('macos_power_client_failed'));}
   const requestId=++sequence,timer=setTimeout(()=>{pending.delete(requestId);reject(Error('macos_power_request_timeout'));},timeoutMs);
   pending.set(requestId,{child,timer,resolve,reject});
   child.stdin.write(JSON.stringify({requestId,op,...fields})+'\n',error=>{
    if(error&&pending.has(requestId)){clearTimeout(timer);pending.delete(requestId);reject(Error('macos_power_client_failed'));}
   });
  });
 }
 function statusResult(value){
  if(!value||typeof value.supported!=='boolean'||!['required','authorized','denied','unavailable'].includes(value.authorization)||value.reason!==undefined&&failure(value.reason).message!==value.reason)throw Error('macos_power_response_invalid');
  capability={supported:value.supported,authorization:value.authorization,...(value.reason?{reason:value.reason}:{})};
  if(value.authorization==='authorized'||value.reason==='macos_power_approval_required')helperMayExist=true;
  return {...capability};
 }
 return {
  async status(){
   if(unavailable)return {supported:false,authorization:'unavailable',reason:unavailable};
   try{return statusResult(await request('status'));}catch(error){return statusResult({supported:false,authorization:'unavailable',reason:failure(error.message).message});}
  },
  async authorize(){return statusResult(await request('authorize'));},
  async list(){
   const events=await request('list');
   if(!Array.isArray(events)||events.length>2||!events.every(validEvent)||new Set(events.map(event=>event.id)).size!==events.length)throw Error('macos_power_response_invalid');
   return events;
  },
  async schedule(event){
   if(!validEvent(event)||event.at<=Date.now())throw Error('macos_power_event_invalid');
   const actual=await request('schedule',event);
   if(!validEvent(actual)||actual.id!==event.id||actual.at!==event.at)throw Error('macos_power_response_invalid');
   return actual;
  },
  async cancel(event){
   if(!validEvent(event))throw Error('macos_power_event_invalid');
   const result=await request('cancel',event);if(result!==null)throw Error('macos_power_response_invalid');
  },
  close(){
   if(closing)return closing;
   closed=true;
   closing=(async()=>{
    try{if(!unavailable&&started){const result=await request('close',{},true);if(result!==null)throw Error('macos_power_response_invalid');}}
    finally{const child=client;client=undefined;child?.stdin.end();child?.kill();}
   })();
   return closing;
  },
  async prepareUpdate(){
   if(!closing)throw Error('macos_power_close_required');
   await closing;
   const helperAbsent=capability?.supported===true&&capability.authorization==='required'&&capability.reason==='macos_power_registration_required'||
    capability?.supported===false&&capability.authorization==='unavailable'&&['macos_power_helper_missing','macos_power_developer_signature_required'].includes(capability.reason);
   if(unavailable||!helperMayExist&&helperAbsent)return;
   await new Promise((resolve,reject)=>{
    let child,buffer='',settled=false;
    const finish=error=>{if(settled)return;settled=true;clearTimeout(timer);if(error)reject(error);else resolve();};
    const timer=setTimeout(()=>{finish(Error('macos_power_request_timeout'));child?.kill('SIGKILL');},timeoutMs);
    try{child=spawn(join(bundle,'Contents/MacOS/homer-power-client'),['--uninstall','--instance',instanceId],{shell:false,stdio:['ignore','pipe','ignore'],env:{PATH:'/usr/bin:/bin',HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,LANG:'en_US.UTF-8'}});}
    catch{finish(Error('macos_power_client_failed'));return;}
    child.once('error',()=>finish(Error('macos_power_client_failed')));
    child.stdout.on('error',()=>{finish(Error('macos_power_client_failed'));child.kill('SIGKILL');});
    child.stdout.on('data',bytes=>{
     if(settled)return;
     buffer+=bytes.toString('utf8');
     if(Buffer.byteLength(buffer)>65536){finish(Error('macos_power_response_invalid'));child.kill('SIGKILL');}
    });
    child.once('close',(code,signal)=>{
     if(settled)return;
     let receipt;
     try{receipt=JSON.parse(buffer);}catch{finish(Error('macos_power_response_invalid'));return;}
     if(receipt?.ok===false&&Object.keys(receipt).sort().join(',')==='error,ok'&&failure(receipt.error).message===receipt.error){finish(failure(receipt.error));return;}
     if(receipt?.ok!==true||Object.keys(receipt).join(',')!=='ok'){finish(Error('macos_power_response_invalid'));return;}
     finish(code===0&&!signal?undefined:Error('macos_power_update_unconfirmed'));
    });
   });
  }
 };
}
