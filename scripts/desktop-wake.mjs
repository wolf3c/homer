import {createConnection,createServer} from 'node:net';
import {pathToFileURL} from 'node:url';

const instancePattern=/^[a-f0-9]{64}$/,sessionPattern=/^[a-f0-9]{32}$/;
export function windowsWakePipe(instance,session){
 if(typeof instance!=='string'||typeof session!=='string'||!instancePattern.test(instance)||!sessionPattern.test(session))throw Error('windows_wake_context_invalid');
 return '\\\\.\\pipe\\homer-wake-v1-'+instance+'-'+session;
}
const protocol=session=>Buffer.from('homer-wake-v1 '+session+'\n');
export function serveWindowsWake(path,session,onWake,listen=createServer){
 if(typeof session!=='string'||!sessionPattern.test(session)||typeof onWake!=='function')throw Error('windows_wake_context_invalid');
 const expected=protocol(session),server=listen(socket=>{
  let value=Buffer.alloc(0);socket.setTimeout(1000,()=>socket.destroy());socket.on('error',()=>{});
  socket.on('data',chunk=>{value=Buffer.concat([value,chunk]);if(value.length>expected.length)socket.destroy();});
  socket.on('end',()=>{if(value.equals(expected)){Promise.resolve().then(onWake).catch(()=>{});socket.end('ok\n');}else socket.destroy();});
 });
 server.maxConnections=8;server.listen({path,readableAll:false,writableAll:false});return server;
}
export function notifyWindowsWake(path,session){
 if(typeof session!=='string'||!sessionPattern.test(session))throw Error('windows_wake_context_invalid');
 return new Promise(done=>{
  const socket=createConnection(path);let reply='';socket.setEncoding('utf8');
  socket.setTimeout(1500,()=>socket.destroy());socket.once('connect',()=>socket.end(protocol(session)));
  socket.on('data',chunk=>{reply+=chunk;if(reply.length>3)socket.destroy();});
  socket.on('error',()=>{});socket.on('close',()=>done(reply==='ok\n'));
 });
}

export async function watchWindowsWake(createClient){
 if(!process.send)throw Error('windows_wake_guardian_ipc_required');
 createClient??=(await import('./windows-power.mjs')).createWindowsWakeTaskClient;
 let client,session,cleaning=false;
 async function cleanup(){
  if(cleaning)return;cleaning=true;
  if(client)for(let attempt=0;attempt<3;attempt++){
   try{const events=await client('clear',{session});if(events.some(event=>event.session===session))throw Error('windows_wake_cleanup_unconfirmed');break;}
   catch{if(attempt<2)await new Promise(done=>setTimeout(done,250));else process.exitCode=1;}
  }
  if(process.connected)process.disconnect();
 }
 const ready=setTimeout(()=>{process.exitCode=1;void cleanup();},5000);
 process.on('error',()=>{process.exitCode=1;void cleanup();});
 process.once('disconnect',()=>{clearTimeout(ready);void cleanup();});
 process.once('message',message=>{
  clearTimeout(ready);
  try{
   if(!process.connected||message?.type!=='watch'||typeof message.session!=='string'||!sessionPattern.test(message.session))throw Error('windows_wake_context_invalid');
   session=message.session;client=createClient(message.context);process.send({type:'ready'});
  }catch{process.exitCode=1;void cleanup();}
 });
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const [mode,instance,session,...extra]=process.argv.slice(2);
  if(process.platform!=='win32')throw Error('windows_wake_platform_unavailable');
  if(mode==='wake'&&!extra.length){await notifyWindowsWake(windowsWakePipe(instance,session),session);}
  // The guardian client imports this module; finish evaluating before loading it.
  else if(mode==='watch'&&!instance&&!session&&!extra.length)void watchWindowsWake().catch(()=>{process.exitCode=1;if(process.connected)process.disconnect();});
  else throw Error('windows_wake_context_invalid');
 }catch{process.exitCode=1;}
}
