import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {existsSync,mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {createConnection} from 'node:net';
import {isAbsolute,join,resolve} from 'node:path';
import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {assertWindowsPayload} from '../packaging/electron/forge.config.mjs';
import {windowsCommand} from '../scripts/windows-security.mjs';

const [mode,childResources,childDir]=process.argv.slice(2);
const fromPackage=(resources,relative)=>import(pathToFileURL(join(resources,relative)).href);
if(mode==='--cua-child'){
 const {WorkerInteractionMcp,hostMcpTools}=await fromPackage(childResources,'homer/dist/worker-interaction-mcp.js');
 const mcp=new WorkerInteractionMcp(childDir,async tool=>({tool}),hostMcpTools('worker',false,false,true));
 await mcp.start();
 try{
  const socket=createConnection(mcp.path);socket.setEncoding('utf8');
  socket.setTimeout(2000,()=>socket.destroy(Error('packaged_cua_pipe_timeout')));
  socket.once('connect',()=>socket.write('{"tool":"browser_read","arguments":{}}\n'));
  let reply='';for await(const chunk of socket)reply+=chunk;
  assert.deepEqual(JSON.parse(reply),{result:{tool:'browser_read'}});
 }finally{await mcp.close();}
 const {holdCuaWindowsJob,reclaimCuaSession,WINDOWS_CUA_HELPER}=await fromPackage(childResources,'homer/dist/cua-processes.js');
 const {CuaDriver,SessionPermissionMode}=await fromPackage(childResources,'runtime/cua/node_modules/@trycua/cua-driver/dist/index.js');
 const helper=join(childResources,WINDOWS_CUA_HELPER),job=holdCuaWindowsJob(helper,childDir);
 await job.ready;
 const manifest=join(childDir,'capabilities.json'),bounded=SessionPermissionMode.Bounded;
 writeFileSync(manifest,JSON.stringify({version:3,expires_after:'15m',idle_timeout:'5m',allow:{tools:['check_permissions','start_session','end_session']}}));
 const driver=CuaDriver.createPrivateWorker({binaryPath:helper,hostBundleId:'app.homer.desktop',startupTimeoutMs:3000n,shutdownTimeoutMs:3000n,
  environment:[{name:'CUA_DRIVER_RS_HOME',value:childDir},{name:'CUA_DRIVER_RS_TELEMETRY_ENABLED',value:'0'},{name:'CUA_DRIVER_RS_UPDATE_CHECK',value:'0'}],
  configuredDriver:{claudeCodeCompatibility:false,authorization:{allowedModes:[bounded],compatibilityMode:bounded,compatibilityCapabilityManifestPath:manifest}}});
 const {pid,driverVersion}=await driver.metadata();assert.equal(driverVersion,'0.46.1');
 const reply=await driver.callTool('check_permissions','{"session":"homer-cua","prompt":false}');
 assert.equal(JSON.parse(reply.structuredJson).uia,true);
 const stopped=once(process,'message');
 process.send(pid);
 await stopped;
 // No graceful driver response is required to stop the owned process tree.
 assert.equal(await reclaimCuaSession(childDir,pid,helper,job),true);
 try{await driver.shutdown();}catch{}finally{driver.uniffiDestroy();}
 process.disconnect();
}else{
 test('signed Windows package boots the original SDK and reaps its job on stop and owner death',{timeout:50000},async t=>{
  const app=process.env.HOMER_TEST_WINDOWS_APP;
  assert.ok(process.platform==='win32'&&process.arch==='x64'&&app&&isAbsolute(app),'requires the absolute path to a signed Windows x64 app directory');
  assertWindowsPayload(app);
  const resources=join(app,'resources'),native=join(resources,'runtime/cua/node_modules/@trycua/cua-driver-win32-x64-msvc');
  const files=[join(app,'Homer.exe'),...['cua_driver_sdk.dll','cua_driver_node_runtime.node'].map(name=>join(native,name)),
   ...['cua-driver.exe','homer-cua-windows.exe'].map(name=>join(resources,'runtime/cua',name))];
  assert.equal(windowsCommand("$certs=@(ConvertFrom-Json $env:HOMER_CUA_FILES | ForEach-Object { $s=Get-AuthenticodeSignature -LiteralPath $_; if($s.Status -ne 'Valid'){throw 'invalid_signature'}; $s.SignerCertificate.Thumbprint }); if(@($certs|Select-Object -Unique).Count -ne 1){throw 'different_signers'}; 'verified'",
   {HOMER_CUA_FILES:JSON.stringify(files)}),'verified');
  const {recoverCuaSessions,WINDOWS_CUA_HELPER}=await fromPackage(resources,'homer/dist/cua-processes.js');
  const root=resolve('.codex/scratch/windows-cua-package');mkdirSync(root,{recursive:true});
  for(const force of [false,true]){
   const dir=mkdtempSync(join(root,'homer-cua-'));
   const child=fork(fileURLToPath(import.meta.url),['--cua-child',resources,dir],{execPath:join(resources,'node.exe'),execArgv:[],stdio:['ignore','ignore','ignore','ipc']});
   try{
    const exit=once(child,'exit',{signal:t.signal});
    const [pid]=await Promise.race([once(child,'message',{signal:t.signal}),exit.then(()=>{throw Error('packaged_cua_child_exited_early');})]);
    assert.ok(Number.isSafeInteger(pid)&&pid>1);assert.doesNotThrow(()=>process.kill(pid,0));
    if(force)child.kill('SIGKILL');else child.send('stop');
    const [code]=await exit;if(!force)assert.equal(code,0);
    for(let wait=0;force&&existsSync(dir)&&wait<60;wait++)await delay(50);
    await recoverCuaSessions(root,join(resources,WINDOWS_CUA_HELPER));
    assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
    assert.equal(existsSync(dir),false);
   }finally{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');}
  }
 });
}
