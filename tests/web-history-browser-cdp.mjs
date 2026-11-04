// Existing Chrome only, fresh task-local profile; no user browser/account/model.
import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,existsSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
const wait=ms=>new Promise(done=>setTimeout(done,ms));
export async function isolatedChrome(destination,{zoomFactor}={}){
 const profile=join(resolve(destination),'isolated-chrome-profile-'+Date.now());mkdirSync(profile,{recursive:true});
 // Chromium ChromeZoomLevelPrefs stores the default partition under the key 'x'.
 if(zoomFactor){mkdirSync(join(profile,'Default'),{recursive:true});writeFileSync(join(profile,'Default','Preferences'),JSON.stringify({partition:{default_zoom_level:{x:Math.log(zoomFactor)/Math.log(1.2)}}}));}
 const activeFile=join(profile,'DevToolsActivePort');rmSync(activeFile,{force:true});
 const process=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--remote-debugging-port=0','--user-data-dir='+profile,'--disable-background-networking','--disable-component-update','--disable-default-apps','--disable-sync','--no-first-run','--no-default-browser-check','--disable-features=MediaRouter,OptimizationHints,AutofillServerCommunication,Translate','about:blank'],{stdio:['ignore','ignore','pipe']});
 let startup='';process.stderr.on('data',data=>{if(startup.length<8000)startup+=String(data);});
 let port,path;
 for(let n=0;n<600&&process.exitCode===null;n++){if(existsSync(activeFile)){const values=readFileSync(activeFile,'utf8').trim().split('\n');if(/^\d+$/.test(values[0]??'')&&values[1]?.startsWith('/devtools/browser/')){[port,path]=values;break;}}await wait(50);}
 if(!port||!path){const status={exitCode:process.exitCode,signalCode:process.signalCode,stderr:startup};if(process.exitCode===null)process.kill('SIGTERM');writeFileSync(join(destination,'chrome-startup-failure.log'),JSON.stringify(status,null,2));throw Error('synthetic_chrome_start_failed');}
 const socket=new WebSocket('ws://127.0.0.1:'+port+path);try{await new Promise((done,reject)=>{const timer=setTimeout(()=>reject(Error('synthetic_cdp_connect_timeout')),10000);socket.addEventListener('open',()=>{clearTimeout(timer);done();},{once:true});socket.addEventListener('error',error=>{clearTimeout(timer);reject(error);},{once:true});});}catch(error){socket.close();if(process.exitCode===null)process.kill('SIGTERM');throw error;}
 let seq=0;const pending=new Map(),listeners=new Map();
 socket.addEventListener('message',({data})=>{const message=JSON.parse(String(data));
  if(message.id){const request=pending.get(message.id);if(!request)return;pending.delete(message.id);clearTimeout(request.timeout);message.error?request.reject(Error(JSON.stringify(message.error))):request.done(message.result);}
  else for(const listener of listeners.get(message.method)??[])listener(message.params,message.sessionId);
 });
 const send=(method,params={},sessionId)=>new Promise((done,reject)=>{const id=++seq,timeout=setTimeout(()=>{pending.delete(id);reject(Error('cdp_timeout:'+method));},60000);pending.set(id,{done,reject,timeout});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
 const on=(method,listener)=>{const list=listeners.get(method)??new Set();list.add(listener);listeners.set(method,list);return()=>list.delete(listener);};
 const version=await send('Browser.getVersion');
 const page=async(origin,width=1440)=>{
  const {browserContextId}=await send('Target.createBrowserContext');
  const {targetId}=await send('Target.createTarget',{url:'about:blank',browserContextId});
  const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
  const command=(method,params)=>send(method,params,sessionId),blocked=[],errors=[],requests=[];
  const unpause=on('Fetch.requestPaused',(event,session)=>{if(session!==sessionId)return;const address=new URL(event.request.url);
   if(address.origin!==origin&&!['about:','blob:','data:'].includes(address.protocol)){blocked.push(address.origin);void command('Fetch.failRequest',{requestId:event.requestId,errorReason:'BlockedByClient'}).catch(error=>{if(!String(error).includes('Invalid InterceptionId')&&!String(error).includes('Session with given id not found'))errors.push(String(error));});}
   else {requests.push({path:address.pathname,method:event.request.method});void command('Fetch.continueRequest',{requestId:event.requestId}).catch(error=>{if(!String(error).includes('Invalid InterceptionId')&&!String(error).includes('Session with given id not found'))errors.push(String(error));});}
  });
  const unerror=on('Runtime.exceptionThrown',(event,session)=>{if(session===sessionId)errors.push(event.exceptionDetails.exception?.description??event.exceptionDetails.text);});
  await command('Page.enable');await command('Runtime.enable');await command('Fetch.enable',{patterns:[{urlPattern:'*'}]});
  if(!zoomFactor)await command('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
  const evaluate=async(expression)=>{const r=await command('Runtime.evaluate',{expression:typeof expression==='string'?expression:'('+expression.toString()+')()',awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;};
  const until=async(expression,timeout=60000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(await evaluate(expression))return;await wait(40);}throw Error('browser_condition_timeout');};
  const screenshot=async filename=>{const data=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(join(destination,filename),Buffer.from(data.data,'base64'));};
  return {browserContextId,command,evaluate,until,screenshot,errors,requests,blocked,navigate:async()=>{await command('Page.navigate',{url:origin});},close:async()=>{unpause();unerror();await send('Target.disposeBrowserContext',{browserContextId});}};
 };
 return {page,version,command:send,close:async()=>{try{await send('Browser.close');}catch{}socket.close();for(const p of pending.values()){clearTimeout(p.timeout);p.reject(Error('browser_closed'));}pending.clear();if(process.exitCode===null)await new Promise(done=>{const timer=setTimeout(()=>{process.kill('SIGTERM');done();},2000);process.once('exit',()=>{clearTimeout(timer);done();});});}};
}
export const probeScript=`(()=>{
 window.__historyProbe={longTasks:[],parseMs:[],started:performance.now()};
 window.__mediaProbe={created:0,revoked:0,aborted:0,inFlight:0,max:0};
 const create=URL.createObjectURL,revoke=URL.revokeObjectURL,fetch=window.fetch;
 URL.createObjectURL=function(...args){window.__mediaProbe.created++;return create.apply(this,args);};URL.revokeObjectURL=function(...args){window.__mediaProbe.revoked++;return revoke.apply(this,args);};
 window.fetch=async function(...args){const media=new URL(typeof args[0]==='string'||args[0] instanceof URL?args[0]:args[0].url,location.href).pathname.startsWith('/api/media/'),p=window.__mediaProbe;if(media){p.inFlight++;p.max=Math.max(p.max,p.inFlight);}try{return await fetch.apply(this,args);}catch(error){if(media&&error.name==='AbortError')p.aborted++;throw error;}finally{if(media)p.inFlight--;}};
 const parse=JSON.parse;JSON.parse=function(...args){const t=performance.now();try{return parse.apply(this,args);}finally{window.__historyProbe.parseMs.push(performance.now()-t);}};
 try{new PerformanceObserver(list=>{for(const item of list.getEntries())window.__historyProbe.longTasks.push(item.duration);}).observe({entryTypes:['longtask']});}catch{}
 const check=()=>{const p=window.__historyProbe,readable=document.querySelector('[data-conversation-message]'),box=document.querySelector('[contenteditable=true]');if(readable&&!p.readableMs)p.readableMs=performance.now();if(readable&&box&&!p.inputMs)p.inputMs=performance.now();if(!p.inputMs)requestAnimationFrame(check);};requestAnimationFrame(check);
})()`;
