#!/usr/bin/env node
// Explicit maintenance entry: fixed dist, original private IPC, no watcher/build/retry.
import {fork} from 'node:child_process';
import {createInterface} from 'node:readline';
import {readFileSync} from 'node:fs';
import {sealBuild,copyRuntimeDependencies} from './trusted-build.mjs';
import {randomUUID,createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {preparePinned,verifyPinned} from './pinned-build.mjs';
const code=error=>error instanceof Error&&/^[a-z][a-z0-9_]{1,80}$/.test(error.message)?error.message:'pinned_operation_failed';
const emit=value=>new Promise((accept,reject)=>process.stdout.write(JSON.stringify(value)+'\n',error=>error?reject(error):accept()));
export async function runPinned(manifestPath,configPath,port){
 const manifest=verifyPinned(manifestPath,configPath);
 const live=sealBuild({directory:manifest.directory,hash:createHash('sha256').update(readFileSync(manifestPath)).digest('hex'),config:{runtime:manifest.config.runtime}},copyRuntimeDependencies(manifest.directory,manifest.config.runtime));
 const {loadConfig}=await import(pathToFileURL(join(live.directory,'dist/config.js')).href);
 const config=loadConfig(configPath);
 if(config.runtime!==manifest.config.runtime||config.workspace!==manifest.config.workspace)throw Error('pinned_configuration_changed');
 let ready=false,stopping=false,failed=false,web;
 const pending=new Map(),inputJobs=new Set();
 const child=fork(join(live.directory,'dist/dev-host.js'),[],{cwd:live.directory,execArgv:['--disable-warning=ExperimentalWarning'],stdio:['ignore','ignore','ignore','ipc']});
 let doneResolve;const done=new Promise(accept=>doneResolve=accept);
 const send=message=>new Promise((accept,reject)=>{
  if(!child.connected)return reject(Error('pinned_child_disconnected'));
  child.send(message,error=>error?reject(Error('pinned_ipc_unconfirmed')):accept());
 });
 const stop=()=>{if(stopping)return;stopping=true;ready=false;void send({kind:'stop'}).catch(()=>{});};
 const rpc=(method,input={})=>new Promise((accept,reject)=>{
  if(!ready||stopping)return reject(Error('pinned_not_ready'));
  const id=randomUUID();
  const timeout=setTimeout(()=>{pending.delete(id);reject(Error('pinned_receipt_unconfirmed'));},method==='wechat.poll'||method==='telegram.configure'?90000:method.startsWith('wechat.')||method.startsWith('telegram.')?35000:5000);
  pending.set(id,{accept,reject,timeout});
  void send({kind:'web',id,method,input}).catch(error=>{clearTimeout(timeout);pending.delete(id);reject(error);});
 });
 const startWeb=async()=>{
  if(port===undefined)return;
  const {createWebServer}=await import(pathToFileURL(join(live.directory,'dist/web-server.js')).href);
  const bridge={state:()=>rpc('state'),submit:input=>rpc('submit',input),stop:messageId=>rpc('stop',{messageId}),respond:(id,input)=>rpc('respond',{...input,id}),artifact:runId=>rpc('artifact',{runId}),
   wechat:{state:()=>rpc('wechat.state'),beginLogin:()=>rpc('wechat.login'),pollLogin:(id,verifyCode)=>rpc('wechat.poll',{id,verifyCode}),qrPng:id=>rpc('wechat.qr',{id}),disable:()=>rpc('wechat.disable'),reconnect:()=>rpc('wechat.reconnect'),disconnect:()=>rpc('wechat.disconnect')},
   telegram:{state:()=>rpc('telegram.state'),configure:token=>rpc('telegram.configure',{token}),beginPairing:()=>rpc('telegram.pair'),candidate:code=>rpc('telegram.candidate',{code}),approve:(code,userId,chatId)=>rpc('telegram.approve',{code,userId,chatId}),connect:()=>rpc('telegram.connect'),disconnect:()=>rpc('telegram.disconnect'),forget:()=>rpc('telegram.forget')}};
  web=await createWebServer({port,bridge,uiDirectory:join(live.directory,'dist/web'),logoPath:join(live.directory,'assets/branding/homer-hippo-cool-icon-256.png')});
 };
 const rl=createInterface({input:process.stdin,terminal:false});
 rl.on('line',line=>{const job=(async()=>{
  let input;
  try{
   if(Buffer.byteLength(line)>96*1024)throw Error('pinned_input_too_large');
   try{input=JSON.parse(line);}catch{throw Error('pinned_input_json_required');}
   const value=await rpc('submit',input);await emit({kind:'accepted',requestId:input.requestId,value});
  }catch(error){await emit({kind:'rejected',...(typeof input?.requestId==='string'&&input.requestId.length<=200?{requestId:input.requestId}:{}),code:code(error)});}
 })();inputJobs.add(job);void job.catch(()=>{failed=true;stop();}).finally(()=>inputJobs.delete(job));});
 rl.on('close',()=>{
  if(port===undefined&&!stopping)void Promise.allSettled([...inputJobs]).then(()=>send({kind:'eof'})).catch(()=>{});
 });
 const fail=async error=>{failed=true;await emit({kind:'failed',code:code(error)}).catch(()=>{});stop();};
 const onSignal=()=>stop();process.on('SIGTERM',onSignal);process.on('SIGINT',onSignal);
 const readyTimeout=setTimeout(()=>{void fail(Error('pinned_start_unconfirmed'));},20000);
 child.on('error',()=>{void fail(Error('pinned_child_spawn_failed'));});
 child.on('message',message=>{void (async()=>{
  if(message.kind==='output'){await emit({kind:'output',message:message.message});await send({kind:'written',id:message.id});}
  else if(message.kind==='state_invalidated'&&message.protocol===1){web?.publish();}
  else if(message.kind==='web_result'){
   const item=pending.get(message.id);if(!item)return;pending.delete(message.id);clearTimeout(item.timeout);message.error?item.reject(Error(message.error)):item.accept(message.value);
  }else if(message.kind==='fatal'){failed=true;await emit({kind:'failed',code:code(Error(message.code))});stop();}
  else if(message.kind==='ready'){
   clearTimeout(readyTimeout);
   if(stopping)return;
   if(port!==undefined&&message.stateInvalidationProtocol!==1)throw Error('state_invalidation_protocol_required');
   if(message.thread!==manifest.database.metadata.mainThread)throw Error('pinned_thread_mismatch');
   ready=true;await startWeb();await emit({kind:'ready',thread:message.thread,engine:message.engine,pid:child.pid,...(web?{url:web.url}:{})});
  }
 })().catch(fail);});
 child.on('exit',(exitCode,signal)=>{void (async()=>{
  clearTimeout(readyTimeout);ready=false;
  for(const item of pending.values()){clearTimeout(item.timeout);item.reject(Error('pinned_receipt_unconfirmed'));}pending.clear();
  rl.close();process.stdin.pause();process.off('SIGTERM',onSignal);process.off('SIGINT',onSignal);
  await web?.close();
  if(exitCode!==0||signal||failed)process.exitCode=1;
  await emit({kind:'closed',clean:exitCode===0&&!signal&&!failed});doneResolve();
 })().catch(()=>{process.exitCode=1;doneResolve();});});
 await send({kind:'init',config,thread:manifest.database.metadata.mainThread});
 await done;
}
async function cli(){
 const [command,...args]=process.argv.slice(2),options={};
 const allowed=new Set(command==='prepare'?['build','config','snapshot','thread','manifest']:['config','manifest','port']);
 for(let i=0;i<args.length;i+=2){const key=args[i]?.replace(/^--/,'');if(!args[i]?.startsWith('--')||!allowed.has(key)||options[key]!==undefined||!args[i+1])throw Error('pinned_arguments_invalid');options[key]=args[i+1];}
 if(!options.config||!options.manifest)throw Error('pinned_arguments_invalid');
 if(command==='prepare'){
  if(!options.build||!options.snapshot||!options.thread)throw Error('pinned_arguments_invalid');
  const manifest=preparePinned({directory:options.build,configPath:options.config,snapshot:options.snapshot,thread:options.thread,manifestPath:options.manifest});
  await emit({kind:'prepared',files:manifest.files.length,node:manifest.node,unknown:manifest.database.unknown.length});
 }else if(command==='run'){
  const port=options.port===undefined?undefined:Number(options.port);
  if(port!==undefined&&(!Number.isInteger(port)||port<1024||port>65535))throw Error('pinned_port_invalid');
  await runPinned(resolve(options.manifest),resolve(options.config),port);
 }else throw Error('pinned_arguments_invalid');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{await cli();}catch(error){process.exitCode=1;await emit({kind:'failed',code:code(error)});}
}
