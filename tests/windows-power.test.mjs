import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdirSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {createConnection,createServer} from 'node:net';
import {basename,join,relative,resolve} from 'node:path';
import {test} from 'node:test';
import {createWindowsWakeAdapter} from '../scripts/windows-power.mjs';
import {notifyWindowsWake,serveWindowsWake} from '../scripts/desktop-wake.mjs';

const instanceId='a'.repeat(64),session='b'.repeat(32);
const options={bundle:'C:\\Program Files\\Homer',resources:'C:\\Program Files\\Homer\\resources',profile:'C:\\Users\\test\\Homer',instanceId,onWake(){}};
const first={id:'1'.repeat(32),at:1900000000000},second={id:'2'.repeat(32),at:1900000060000};
function fixture(t){
 const events=[],requests=[],watchers=[];let lost=false,denied=false,malformed=false,release,holdGuardianExit=false,finishGuardian;
 const taskScript=readFileSync(new URL('../packaging/windows/power-task.ps1',import.meta.url),'utf8');
 const execFile=async(file,args,settings)=>{
  assert.equal(file,'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.deepEqual(args,['-NoLogo','-NoProfile','-NonInteractive','-Command',taskScript]);
  assert.equal(settings.windowsHide,true);assert.ok(settings.timeout>0&&settings.timeout<=15000);
  assert.equal(settings.env.NODE_OPTIONS,undefined);assert.equal(settings.env.PATH,undefined);
  const request=JSON.parse(Buffer.from(settings.env.HOMER_WAKE_REQUEST,'base64').toString('utf8'));
  assert.equal(request.instanceId,instanceId);assert.equal(request.resources,options.resources);
  requests.push(request);
  if(denied)return {stdout:JSON.stringify({ok:false,error:'denied'})};
  if(request.operation==='schedule'){
   events.push({...request.event,session:request.session});
   if(release)await new Promise(done=>release.done=done);
   if(lost){lost=false;throw Object.assign(Error('transport failure with private output'),{stdout:'private output'});}
  }
  if(request.operation==='cancel'){
   const at=events.findIndex(event=>event.id===request.event.id&&event.at===request.event.at);
   if(at>=0)events.splice(at,1);
  }
  if(request.operation==='clear')for(let i=events.length-1;i>=0;i--)if(events[i].session===request.session)events.splice(i,1);
  return {stdout:JSON.stringify({ok:true,instanceId,events:malformed?[{...first,session:'wrong'}]:events})};
 };
 const spawn=(file,args,settings)=>{
  assert.equal(file,options.resources+'\\node.exe');
  assert.deepEqual(args,[options.resources+'\\homer\\scripts\\desktop-wake.mjs','watch']);
  assert.deepEqual(settings.stdio,['ignore','ignore','ignore','ipc']);
  const child=new EventEmitter();child.connected=true;child.exitCode=null;child.unref=()=>{};
  child.send=value=>{assert.equal(value.type,'watch');assert.equal(value.context.instanceId,instanceId);queueMicrotask(()=>child.emit('message',{type:'ready'}));};
  child.disconnect=()=>{child.connected=false;const finish=()=>{child.exitCode=0;child.emit('exit',0);};if(holdGuardianExit)finishGuardian=finish;else finish();};
  child.kill=()=>{child.connected=false;child.exitCode=1;child.emit('exit',1);};
  watchers.push(child);return child;
 };
 const root=resolve('.codex/scratch/windows-power-tests');mkdirSync(root,{recursive:true});
 const directory=mkdtempSync(join(root,'case-')),path=join(directory,'wake.sock');
 const adapter=createWindowsWakeAdapter(options,{platform:'win32',systemRoot:'C:\\Windows',session,execFile,spawn,
  createServer:handler=>{const server=createServer(handler),listen=server.listen.bind(server);server.listen=()=>listen(path);return server;},now:()=>1800000000000});
 t.after(async()=>{try{await adapter.close();}finally{for(const child of watchers)child.kill();rmSync(directory,{recursive:true,force:true});}});
 return {adapter,events,requests,watchers,set lost(value){lost=value;},set denied(value){denied=value;},set malformed(value){malformed=value;},set holdGuardianExit(value){holdGuardianExit=value;},finishGuardian:()=>finishGuardian?.(),block(){release={};return ()=>release.done();}};
}

test('Windows candidate registration preserves old events and recovers a lost receipt by own list',async t=>{
 const f=fixture(t);assert.deepEqual(await f.adapter.status(),{supported:true,authorization:'authorized'});
 assert.deepEqual(await f.adapter.authorize(),{supported:true,authorization:'authorized'});
 assert.equal(f.watchers.length,0);
 assert.deepEqual(await f.adapter.schedule(first),first);
 f.lost=true;await assert.rejects(f.adapter.schedule(second),/windows_wake_transport_failed/);
 assert.deepEqual(await f.adapter.list(),[first,second]);
 assert.equal(f.requests.filter(request=>request.operation==='schedule').length,2);
 await f.adapter.cancel(first);assert.deepEqual(await f.adapter.list(),[second]);
 await f.adapter.cancel({...second,at:second.at+1000});assert.deepEqual(await f.adapter.list(),[second]);
 await f.adapter.close();assert.deepEqual(f.events,[]);
});

test('Windows validates identities, UTC precision and command boundaries before registration',async t=>{
 const f=fixture(t);
 for(const event of [{id:'bad',at:first.at},{id:[first.id],at:first.at},{...first,at:first.at+1},{...first,at:NaN},{...first,at:1700000000000},{...first,command:'anything'}])await assert.rejects(f.adapter.schedule(event),/windows_wake_event_invalid/);
 assert.equal(f.requests.length,0);
 for(const changed of [{instanceId:'x'},{instanceId:[instanceId]},{bundle:'C:\\app\\..\\Homer'},{resources:'D:\\other'},{profile:'\\\\remote\\profile'},{profile:'C:\\bad\"path'},{onWake:undefined}])assert.throws(()=>createWindowsWakeAdapter({...options,...changed},{platform:'win32'}),/windows_wake_context_invalid/);
 await f.adapter.close();await assert.rejects(f.adapter.schedule(first),/windows_wake_closed/);
});

test('Windows startup reconciliation sees stale owned sessions and a dead guardian is restarted',async t=>{
 const f=fixture(t);f.events.push({...first,session:'c'.repeat(32)});
 assert.deepEqual(await f.adapter.list(),[]);assert.equal(f.events.length,0);
 await f.adapter.schedule(second);assert.equal(f.watchers.length,1);f.watchers[0].kill();
 await f.adapter.cancel(first);assert.deepEqual(await f.adapter.list(),[]);
 await f.adapter.schedule({...first,at:first.at+1000});assert.equal(f.watchers.length,2);
});

test('a matching due time from an old session cannot be reused or later erased by its delayed guardian',async t=>{
 const f=fixture(t),oldSession='c'.repeat(32);f.events.push({...first,session:oldSession});
 assert.deepEqual(await f.adapter.list(),[]);
 assert.ok(f.requests.some(request=>request.operation==='clear'&&request.session===oldSession));
 await f.adapter.schedule(first);assert.equal(f.watchers.length,1);
 for(let i=f.events.length-1;i>=0;i--)if(f.events[i].session===oldSession)f.events.splice(i,1);
 assert.deepEqual(await f.adapter.list(),[first]);assert.equal(f.events[0].session,session);
});

test('a guardian replacement waits for old cleanup to exit before reusing its session',async t=>{
 const f=fixture(t);await f.adapter.schedule(first);f.holdGuardianExit=true;
 f.watchers[0].emit('error',Error('synthetic_unavailable'));
 const restarting=f.adapter.schedule(second);await new Promise(done=>setImmediate(done));
 try{assert.equal(f.requests.filter(request=>request.operation==='schedule').length,1);}
 finally{f.holdGuardianExit=false;f.finishGuardian();}
 await restarting;assert.equal(f.watchers.length,2);
});

test('Windows capability denial and malformed receipts stay unconfirmed and exclude private errors',async t=>{
 const f=fixture(t);f.denied=true;
 assert.deepEqual(await f.adapter.status(),{supported:true,authorization:'denied',reason:'windows_wake_denied'});
 await assert.rejects(f.adapter.schedule(first),/windows_wake_denied/);
 f.denied=false;f.malformed=true;await assert.rejects(f.adapter.list(),/windows_wake_receipt_invalid/);
 f.malformed=false;
 const unsupported=createWindowsWakeAdapter(options,{platform:'darwin',execFile(){assert.fail('must not invoke Windows');}});
 assert.deepEqual(await unsupported.status(),{supported:false,authorization:'unavailable',reason:'windows_wake_platform_unavailable'});
 await unsupported.close();
});

test('Windows close serializes after an in-flight candidate and reports failed cleanup',async t=>{
 const f=fixture(t),unblock=f.block(),scheduled=f.adapter.schedule(first);
 while(!f.requests.some(request=>request.operation==='schedule'))await new Promise(done=>setImmediate(done));
 const closing=f.adapter.close();unblock();await scheduled;await closing;
 assert.deepEqual(f.events,[]);
 const g=fixture(t);await g.adapter.schedule(second);g.denied=true;
 await assert.rejects(g.adapter.close(),/windows_wake_denied/);assert.equal(g.events.length,1);g.denied=false;
});

test('fixed wake entry rejects forged or oversized IPC and exits harmlessly without an owner',async t=>{
 const root=resolve('.codex/scratch/windows-power-tests');mkdirSync(root,{recursive:true});
 // Relative socket names stay below Unix path limits in deeply nested checkouts.
 const directory=mkdtempSync(join(root,'pipe-')),socketDirectory=relative(process.cwd(),directory);
 const socketPath=name=>process.platform==='win32'?'\\\\.\\pipe\\homer-wake-test-'+basename(directory)+'-'+name:join(socketDirectory,name+'.sock');
 const path=socketPath('owner');let wakes=0;
 const server=serveWindowsWake(path,session,()=>{wakes++;});await new Promise((done,reject)=>{server.once('listening',done);server.once('error',reject);});
 t.after(async()=>{await new Promise(done=>server.close(done));rmSync(directory,{recursive:true,force:true});});
 for(const payload of ['homer-wake-v1 wrong\n','x'.repeat(1024)])await new Promise(done=>{const socket=createConnection(path,()=>socket.end(payload));socket.on('error',()=>{});socket.on('close',done);});
 assert.equal(wakes,0);
 assert.equal(await notifyWindowsWake(path,session),true);assert.equal(wakes,1);
 assert.equal(await notifyWindowsWake(socketPath('absent'),session),false);assert.equal(wakes,1);
});
