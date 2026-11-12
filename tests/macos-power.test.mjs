import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {createMacWakeAdapter} from '../scripts/macos-power.mjs';
import {buildMacPower} from '../scripts/build-macos-power.mjs';

const instanceId='a'.repeat(64),id='b'.repeat(32),otherId='c'.repeat(32);
const options={bundle:'/Applications/Homer.app',resources:'/Applications/Homer.app/Contents/Resources',profile:'/synthetic/profile',instanceId};
function fixture({reply,platform='darwin'}={}){
 const requests=[],children=[];
 const spawn=(file,args,settings)=>{
  assert.equal(file,'/Applications/Homer.app/Contents/MacOS/homer-power-client');
  assert.deepEqual(args,['--instance',instanceId]);
  assert.equal(settings.shell,false);
  const child=new EventEmitter();children.push(child);
  child.stdout=new PassThrough();child.stderr=new PassThrough();
  child.stdin=new Writable({write(bytes,_encoding,done){
   const request=JSON.parse(String(bytes));requests.push(request);
   const result=reply?reply(request,child):{supported:true,authorization:'authorized'};
   if(result!==false)queueMicrotask(()=>child.stdout.write(JSON.stringify({requestId:request.requestId,ok:true,result})+'\n'));
   done();
  }});
  child.kill=()=>{queueMicrotask(()=>child.emit('exit',null,'SIGTERM'));return true;};
  return child;
 };
 const adapter=createMacWakeAdapter(options,{platform,spawn,checkBundle:()=>true,timeoutMs:80});
 return {adapter,requests,children};
}
test('macOS capability is unavailable off-platform without spawning a client',async()=>{
 let calls=0;
 const adapter=createMacWakeAdapter(options,{platform:'linux',spawn(){calls++;throw Error('must not spawn');}});
 assert.deepEqual(await adapter.status(),{supported:false,authorization:'unavailable',reason:'macos_power_platform_unsupported'});
 await assert.rejects(adapter.authorize(),/macos_power_platform_unsupported/);
 await adapter.close();await adapter.prepareUpdate();assert.equal(calls,0);
});
test('missing packaged power helper fails clearly without requesting authorization',async()=>{
 const adapter=createMacWakeAdapter(options,{platform:'darwin',checkBundle:()=>false,spawn(){throw Error('must not spawn');}});
 assert.deepEqual(await adapter.status(),{supported:false,authorization:'unavailable',reason:'macos_power_bundle_unavailable'});
 await adapter.close();await adapter.prepareUpdate();
});
test('status does not authorize; explicit authorization preserves system result',async()=>{
 const f=fixture({reply:request=>request.op==='close'?null:({supported:true,authorization:request.op==='authorize'?'denied':'required'})});
 assert.equal((await f.adapter.status()).authorization,'required');
 assert.deepEqual(f.requests.map(x=>x.op),['status']);
 assert.equal((await f.adapter.authorize()).authorization,'denied');
 await f.adapter.close();
});
test('adapter rejects malformed instance ids and time/event payloads before native calls',async()=>{
 assert.throws(()=>createMacWakeAdapter({...options,instanceId:'../other'}),/macos_power_instance_invalid/);
 const f=fixture();
 for(const event of [{id:'../other',at:Date.now()+10000},{id,at:NaN},{id,at:1},{id,at:Date.now()+10000,message:'private'}])await assert.rejects(f.adapter.schedule(event),/macos_power_event_invalid/);
 assert.deepEqual(f.requests,[]);await f.adapter.close();
});
test('schedule is additive and returns the confirmed second-aligned native event',async()=>{
 const events=[];
 const f=fixture({reply:request=>{
  if(request.op==='schedule'){events.push({id:request.id,at:request.at});return events.at(-1);}
  if(request.op==='list')return [...events];
  if(request.op==='close')return null;
 }});
 const at=Math.ceil((Date.now()+1000)/1000)*1000;
 assert.deepEqual(await f.adapter.schedule({id,at}),{id,at});
 assert.deepEqual(await f.adapter.schedule({id:otherId,at:at+1000}),{id:otherId,at:at+1000});
 assert.deepEqual(await f.adapter.list(),[{id,at},{id:otherId,at:at+1000}]);
 assert.deepEqual(f.requests.map(x=>x.op),['schedule','schedule','list']);
 assert.equal(JSON.stringify(f.requests).includes('/synthetic/profile'),false);
 await f.adapter.close();
});
test('native error codes propagate without leaking native response data',async()=>{
 const f=fixture({reply:(request,child)=>{queueMicrotask(()=>child.stdout.write(JSON.stringify({requestId:request.requestId,ok:false,error:'macos_power_not_authorized',details:'private content'})+'\n'));return false;}});
 await assert.rejects(f.adapter.list(),error=>error.message==='macos_power_not_authorized');
 await assert.rejects(f.adapter.close(),/macos_power_not_authorized/);
});
test('cancel sends the precise event identity and time without broad deletion',async()=>{
 const f=fixture({reply:()=>null}),event={id,at:Math.ceil((Date.now()+10000)/1000)*1000};
 await f.adapter.cancel(event);
 assert.deepEqual(f.requests.map(({requestId,...rest})=>rest),[{op:'cancel',...event}]);
 await f.adapter.close();
});
test('malformed or foreign native events cannot be accepted as confirmed wake requests',async()=>{
 for(const response of [[{id:'foreign',at:1234}],[{id,at:1.5}],{id:otherId,at:1000}]){
  const f=fixture({reply:request=>request.op==='close'?null:response});
  if(Array.isArray(response))await assert.rejects(f.adapter.list(),/macos_power_response_invalid/);
  else await assert.rejects(f.adapter.schedule({id,at:Math.ceil((Date.now()+10000)/1000)*1000}),/macos_power_response_invalid/);
  await f.adapter.close();
 }
});
test('receipt loss times out without an automatic second schedule and supports query recovery',async()=>{
 let saved;
 const f=fixture({reply:request=>{
  if(request.op==='schedule'){saved={id:request.id,at:request.at};return false;}
  if(request.op==='list')return [saved];
  if(request.op==='close')return null;
 }});
 const event={id,at:Math.ceil((Date.now()+10000)/1000)*1000};
 await assert.rejects(f.adapter.schedule(event),/macos_power_request_timeout/);
 assert.deepEqual(await f.adapter.list(),[event]);
 assert.equal(f.requests.filter(x=>x.op==='schedule').length,1);
 await f.adapter.close();
});
test('close confirms cleanup, terminates the client and prevents late requests',async()=>{
 const f=fixture({reply:request=>request.op==='close'?null:{supported:true,authorization:'authorized'}});
 await f.adapter.status();await f.adapter.close();
 assert.deepEqual(f.requests.map(x=>x.op),['status','close']);
 await assert.rejects(f.adapter.schedule({id,at:Math.ceil((Date.now()+10000)/1000)*1000}),/macos_power_closed/);
 await f.adapter.close();
});
test('connection loss rejects pending work and reconnects for reconciliation, never replays a mutation',async()=>{
 const f=fixture({reply:(request,child)=>{
  if(request.op==='schedule'){queueMicrotask(()=>child.emit('exit',1,null));return false;}
  if(request.op==='list')return [];
  if(request.op==='close')return null;
 }});
 await assert.rejects(f.adapter.schedule({id,at:Math.ceil((Date.now()+10000)/1000)*1000}),/macos_power_client_exited/);
 assert.deepEqual(await f.adapter.list(),[]);
 assert.equal(f.children.length,2);
 assert.equal(f.requests.filter(x=>x.op==='schedule').length,1);
 await f.adapter.close();
});
test('a closed native stdin rejects pending work without an unhandled stream error',async()=>{
 const f=fixture({reply:(request,child)=>{
  if(request.op==='list'){queueMicrotask(()=>child.stdin.emit('error',Error('private native error')));return false;}
  return null;
 }});
 await assert.rejects(f.adapter.list(),error=>error.message==='macos_power_client_failed');
 await f.adapter.close();
});
test('native build requires an explicit destination before running platform commands',()=>{
 assert.throws(()=>buildMacPower({root:'/synthetic/source',arch:'arm64',minimumMacOS:'13.0',run(){throw Error('must not run');}}),/macos_power_build_inputs_invalid/);
});

function updateFixture({receipt={ok:true},code=0,signal=null,autoClose=true,emitReceipt=true,reply}={}){
 const calls=[],kills=[],requests=[];let child;
 const adapter=createMacWakeAdapter(options,{platform:'darwin',checkBundle:()=>true,timeoutMs:80,spawn(file,args,settings){
  calls.push({file,args,settings});child=new EventEmitter();child.stdout=new PassThrough();
  const current=child;
  current.kill=signal=>{kills.push(signal);queueMicrotask(()=>current.emit('close',null,signal));return true;};
  if(args[0]!=='--uninstall'){
   current.stdin=new Writable({write(bytes,_encoding,done){
    const request=JSON.parse(String(bytes));requests.push(request);
    const result=request.op==='close'?null:reply(request,current);
    if(result!==false)queueMicrotask(()=>current.stdout.write(JSON.stringify({requestId:request.requestId,ok:true,result})+'\n'));
    done();
   }});
   return current;
  }
  queueMicrotask(()=>{
   if(emitReceipt)current.stdout.write(typeof receipt==='string'?receipt:JSON.stringify(receipt)+'\n');
   if(autoClose){current.emit('exit',code,signal);current.emit('close',code,signal);}
  });
  return current;
 }});
 return {adapter,calls,kills,requests,get child(){return child;}};
}
test('prepareUpdate requires ordinary close before invoking the uninstaller',async()=>{
 const f=updateFixture();
 await assert.rejects(f.adapter.prepareUpdate(),/macos_power_close_required/);
 assert.deepEqual(f.calls,[]);await f.adapter.close();
});
test('prepareUpdate runs the fixed packaged uninstaller as the current user after cleanup',async()=>{
 const f=updateFixture();await f.adapter.close();await f.adapter.prepareUpdate();
 assert.equal(f.calls.length,1);
 const [{file,args,settings}]=f.calls;
 assert.equal(file,'/Applications/Homer.app/Contents/MacOS/homer-power-client');
 assert.deepEqual(args,['--uninstall','--instance',instanceId]);
 assert.equal(settings.shell,false);assert.equal(settings.uid,undefined);assert.equal(settings.gid,undefined);
 assert.deepEqual(settings.stdio,['ignore','pipe','ignore']);assert.deepEqual(f.kills,[]);
});
test('prepareUpdate propagates active instance, incomplete unregister and ad-hoc rejection outcomes',async()=>{
 for(const error of ['macos_power_other_instances_active','macos_power_unregister_unconfirmed','macos_power_developer_signature_required']){
  const f=updateFixture({receipt:{ok:false,error},code:1});await f.adapter.close();
  await assert.rejects(f.adapter.prepareUpdate(),actual=>actual.message===error);
 }
});
test('prepareUpdate rejects a missing or malformed receipt and a nonzero or signaled success',async()=>{
 for(const settings of [{receipt:''},{receipt:'private malformed native output'},{receipt:{ok:true,unexpected:'private'}},{receipt:{ok:false,error:'private native output'}},{receipt:{ok:false,error:'macos_power_unregister_failed',unexpected:'private'}},{receipt:'{"ok":true}\n{"ok":true}\n'},{code:1},{code:null,signal:'SIGTERM'}]){
  const f=updateFixture(settings);await f.adapter.close();
  await assert.rejects(f.adapter.prepareUpdate(),/macos_power_(?:response_invalid|update_unconfirmed)/);
 }
});
test('prepareUpdate waits for native close even after a success receipt and exit event',async()=>{
 const f=updateFixture({autoClose:false});await f.adapter.close();
 let settled=false;const work=f.adapter.prepareUpdate().finally(()=>settled=true);
 await new Promise(resolve=>setImmediate(resolve));f.child.emit('exit',0,null);
 assert.equal(settled,false);f.child.emit('close',0,null);await work;
});
test('prepareUpdate kills an unresponsive native client after the bounded timeout',async()=>{
 const f=updateFixture({autoClose:false,emitReceipt:false});await f.adapter.close();
 await assert.rejects(f.adapter.prepareUpdate(),/macos_power_request_timeout/);
 assert.deepEqual(f.kills,['SIGKILL']);
});
test('prepareUpdate preserves a failed ordinary close and does not spawn another process',async()=>{
 const f=fixture({reply:(request,child)=>{
  if(request.op==='status')return {supported:true,authorization:'authorized'};
  queueMicrotask(()=>child.stdout.write(JSON.stringify({requestId:request.requestId,ok:false,error:'macos_power_cancel_unconfirmed'})+'\n'));return false;
 }});
 await f.adapter.status();await assert.rejects(f.adapter.close(),/macos_power_cancel_unconfirmed/);
 await assert.rejects(f.adapter.prepareUpdate(),/macos_power_cancel_unconfirmed/);
 assert.equal(f.children.length,1);
});
test('prepareUpdate skips an unregistered helper using the latest native capability',async()=>{
 for(const capability of [
  {supported:true,authorization:'required',reason:'macos_power_registration_required'},
  {supported:false,authorization:'unavailable',reason:'macos_power_helper_missing'},
  {supported:false,authorization:'unavailable',reason:'macos_power_developer_signature_required'}
 ]){
  const f=updateFixture({reply:()=>capability});
  assert.deepEqual(await f.adapter.status(),capability);
  await f.adapter.close();await f.adapter.prepareUpdate();
  assert.deepEqual(f.requests.map(request=>request.op),['status','close']);
  assert.equal(f.calls.length,1);
 }
});
test('prepareUpdate does not hide lost authorization after a helper was authorized',async()=>{
 let status=0;
 const f=updateFixture({receipt:{ok:false,error:'macos_power_cleanup_not_authorized'},code:1,reply:()=>++status===1?
  {supported:true,authorization:'authorized'}:{supported:false,authorization:'unavailable',reason:'macos_power_developer_signature_required'}});
 await f.adapter.status();await f.adapter.status();await f.adapter.close();
 await assert.rejects(f.adapter.prepareUpdate(),/macos_power_cleanup_not_authorized/);
 assert.deepEqual(f.calls.at(-1).args,['--uninstall','--instance',instanceId]);
});
test('prepareUpdate does not skip uncertain registration or scheduling after capability becomes unavailable',async()=>{
 for(const op of ['authorize','schedule']){
  const f=updateFixture({receipt:{ok:false,error:'macos_power_cleanup_not_authorized'},code:1,reply:request=>request.op===op?false:
   {supported:false,authorization:'unavailable',reason:'macos_power_developer_signature_required'}});
  const mutation=op==='authorize'?f.adapter.authorize():f.adapter.schedule({id,at:Math.ceil((Date.now()+10000)/1000)*1000});
  await assert.rejects(mutation,/macos_power_request_timeout/);
  await f.adapter.status();await f.adapter.close();
  await assert.rejects(f.adapter.prepareUpdate(),/macos_power_cleanup_not_authorized/);
  assert.deepEqual(f.calls.at(-1).args,['--uninstall','--instance',instanceId]);
 }
});
test('prepareUpdate still checks native uninstall when unavailable status does not prove absence',async()=>{
 for(const capability of [
  {supported:true,authorization:'required',reason:'macos_power_approval_required'},
  {supported:false,authorization:'unavailable',reason:'macos_power_connection_failed'}
 ]){
  const f=updateFixture({receipt:{ok:false,error:'macos_power_unregister_failed'},code:1,reply:()=>capability});
  await f.adapter.status();await f.adapter.close();
  await assert.rejects(f.adapter.prepareUpdate(),/macos_power_unregister_failed/);
  assert.deepEqual(f.requests.map(request=>request.op),['status','close']);
  assert.deepEqual(f.calls.at(-1).args,['--uninstall','--instance',instanceId]);
 }
});
test('prepareUpdate cannot treat an inconsistent capability as proof the helper is absent',async()=>{
 const f=updateFixture({receipt:{ok:false,error:'macos_power_unregister_failed'},code:1,reply:()=>
  ({supported:true,authorization:'required',reason:'macos_power_developer_signature_required'})});
 await f.adapter.status();await f.adapter.close();
 await assert.rejects(f.adapter.prepareUpdate(),/macos_power_unregister_failed/);
 assert.equal(f.calls.length,2);
});
test('prepareUpdate capability history cannot be rewritten by a status caller',async()=>{
 const f=updateFixture({receipt:{ok:false,error:'macos_power_unregister_failed'},code:1,reply:()=>
  ({supported:false,authorization:'unavailable',reason:'macos_power_connection_failed'})});
 const capability=await f.adapter.status();capability.reason='macos_power_developer_signature_required';
 await f.adapter.close();await assert.rejects(f.adapter.prepareUpdate(),/macos_power_unregister_failed/);
 assert.equal(f.calls.length,2);
});
test('prepareUpdate terminates a native process whose output exceeds the receipt limit',async()=>{
 const f=updateFixture({receipt:' '.repeat(65537)+'{"ok":true}',autoClose:false});await f.adapter.close();
 await assert.rejects(f.adapter.prepareUpdate(),/macos_power_response_invalid/);
 assert.deepEqual(f.kills,['SIGKILL']);
});
test('prepareUpdate rejects native launch failures without leaking process errors',async()=>{
 for(const synchronous of [true,false]){
  const adapter=createMacWakeAdapter(options,{platform:'darwin',checkBundle:()=>true,spawn(){
   if(synchronous)throw Error('private native error');
   const child=new EventEmitter();child.stdout=new PassThrough();
   queueMicrotask(()=>child.emit('error',Error('private native error')));return child;
  }});
  await adapter.close();await assert.rejects(adapter.prepareUpdate(),error=>error.message==='macos_power_client_failed');
 }
});
