import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {transpileModule,ModuleKind,ScriptTarget} from 'typescript';

async function fixture(options={}){
 const root=mkdtempSync(resolve('.codex/scratch/cua-driver-test-'));
 try{
  const source=readFileSync('src/desktop-cua-driver.ts','utf8');
  writeFileSync(join(root,'driver.mjs'),transpileModule(source,{compilerOptions:{module:ModuleKind.ESNext,target:ScriptTarget.ES2023}}).outputText);
  writeFileSync(join(root,'sdk.mjs'),`
   import {appendFileSync} from 'node:fs';
   import {isMainThread} from 'node:worker_threads';
   export const CuaDriver={createPrivateWorker(options){
    if(options.delay){appendFileSync(options.receipt+'.started','initializing');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,options.delay);}
    if(options.startFailure)throw Object.assign(Error('DriverError.ActionInterrupted'),{tag:'ActionInterrupted',inner:{completion:2,reason:'private worker did not answer request 0 within 15000ms'}});
    return {metadata:async()=>options.invalidMetadata?null:({pid:4242,driverVersion:'0.46.1'}),
     async callTool(name){if(name==='crash')process.exit(7);if(name==='fail')throw Object.assign(Error('secret fixture detail'),{tag:'Transport'});return {isError:false,structuredJson:JSON.stringify(name==='host_identity'?{pid:process.pid,isMainThread,budget:String(options.startupTimeoutMs),type:typeof options.startupTimeoutMs}:{name})};},
     async shutdown(){if(options.hangShutdown)await new Promise(()=>{});if(options.shutdownFailure)throw Error('private fixture error');},
     uniffiDestroy(){appendFileSync(options.receipt,'destroyed\\n');}};
   }};
  `);
  const {createPrivateCuaDriver}=await import(pathToFileURL(join(root,'driver.mjs')).href);
  const driver=createPrivateCuaDriver(pathToFileURL(join(root,'sdk.mjs')).href,{...options,receipt:join(root,'receipt')});
  return {driver,root,async close(){await driver.uniffiDestroy();rmSync(root,{recursive:true,force:true});}};
 }catch(error){rmSync(root,{recursive:true,force:true});throw error;}
}

test('private SDK startup never blocks the host and preserves the Driver contract',{timeout:5000},async()=>{
 const f=await fixture({delay:150});
 try{
  let ready=false;const metadata=f.driver.metadata().then(value=>{ready=true;return value;});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(ready,false);
  assert.deepEqual(await metadata,{pid:4242,driverVersion:'0.46.1'});
  assert.deepEqual(await f.driver.callTool('check_permissions','{}'),{isError:false,structuredJson:'{"name":"check_permissions"}'});
  await f.driver.shutdown();assert.equal(readFileSync(join(f.root,'receipt'),'utf8'),'destroyed\n');
 }finally{await f.close();}
});

test('private startup timeout keeps its safe cause instead of a generic MCP failure',{timeout:5000},async()=>{
 const f=await fixture({startFailure:true});
 try{await assert.rejects(f.driver.metadata(),{message:'cua_driver_startup_timeout'});await f.driver.shutdown();}
 finally{await f.close();}
});

test('private SDK errors cross the process boundary without native error text',{timeout:5000},async()=>{
 const f=await fixture();
 try{await f.driver.metadata();await assert.rejects(f.driver.callTool('fail','{}'),{message:'cua_driver_transport_failed'});await f.driver.shutdown();}
 finally{await f.close();}
});

test('malformed SDK startup metadata has a safe startup error',{timeout:5000},async()=>{
 const f=await fixture({invalidMetadata:true});
 try{await assert.rejects(f.driver.metadata(),{message:'cua_driver_startup_failed'});await f.driver.shutdown();}
 finally{await f.close();}
});

test('disposing during startup rejects readiness and never publishes late readiness',{timeout:5000},async()=>{
 const f=await fixture({delay:2000});
 try{
  const rejected=assert.rejects(f.driver.metadata(),{message:'cua_stopped'});
  await f.driver.uniffiDestroy();await rejected;
  await assert.rejects(f.driver.callTool('check_permissions','{}'),{message:'cua_stopped'});
 }finally{await f.close();}
});

test('shutdown failure still destroys the native handle and stops the SDK process',{timeout:5000},async()=>{
 const f=await fixture({shutdownFailure:true});
 try{
  await f.driver.metadata();await assert.rejects(f.driver.shutdown(),{message:'cua_driver_shutdown_failed'});
  assert.equal(readFileSync(join(f.root,'receipt'),'utf8'),'destroyed\n');
 }finally{await f.close();}
});

test('SDK process exit fails pending calls without restarting it',{timeout:5000},async()=>{
 const f=await fixture();
 try{await f.driver.metadata();await assert.rejects(f.driver.callTool('crash','{}'),{message:'cua_driver_unavailable'});}
 finally{await f.close();}
});

test('private SDK owns a separate process and receives BigInt options',{timeout:5000},async()=>{
 const f=await fixture({startupTimeoutMs:15000n});
 try{
  const reply=JSON.parse((await f.driver.callTool('host_identity','{}')).structuredJson);
  assert.equal(reply.isMainThread,true);assert.notEqual(reply.pid,process.pid);
  assert.equal(reply.budget,'15000');assert.equal(reply.type,'bigint');
 }finally{await f.close();}
});

test('force disposal remains reachable when native shutdown never settles',{timeout:5000},async()=>{
 const f=await fixture({hangShutdown:true});
 try{
  await f.driver.metadata();const rejected=assert.rejects(f.driver.shutdown(),{message:'cua_stopped'});
  await f.driver.uniffiDestroy();await rejected;
 }finally{await f.close();}
});

test('startup cancellation can stop a child blocked inside the SDK constructor',{timeout:5000},async()=>{
 const f=await fixture({delay:10000});
 try{
  const rejected=assert.rejects(f.driver.metadata(),{message:'cua_stopped'});
  for(let tries=0;tries<100&&!existsSync(join(f.root,'receipt.started'));tries++)await new Promise(resolve=>setTimeout(resolve,10));
  assert(existsSync(join(f.root,'receipt.started')));await f.driver.uniffiDestroy();await rejected;
 }finally{await f.close();}
});

test('SDK process exits when its owning host disconnects',{timeout:5000},async()=>{
 const f=await fixture();let pid,owner;
 try{
  writeFileSync(join(f.root,'owner.mjs'),`import {createPrivateCuaDriver} from './driver.mjs';const driver=createPrivateCuaDriver(new URL('./sdk.mjs',import.meta.url).href,{receipt:new URL('./owner-receipt',import.meta.url).pathname});const reply=JSON.parse((await driver.callTool('host_identity','{}')).structuredJson);process.send(reply.pid);process.once('message',()=>process.exit(0));`);
  owner=fork(join(f.root,'owner.mjs'),{execArgv:[],stdio:['ignore','ignore','ignore','ipc']});
  [pid]=await once(owner,'message');const exited=once(owner,'exit');owner.send('exit');await exited;
  const gone=()=>{try{process.kill(pid,0);return false;}catch(error){return error.code==='ESRCH';}};
  for(let tries=0;tries<100&&!gone();tries++)await new Promise(resolve=>setTimeout(resolve,10));
  assert(gone(),'orphaned SDK process');
 }finally{owner?.kill();if(pid&&pid!==process.pid){try{process.kill(pid,'SIGKILL');}catch{}}await f.close();}
});
