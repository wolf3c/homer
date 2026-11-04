// Actual fixed native sandbox RPC, empty synthetic HOME, no model/account.
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';import {createServer} from 'node:http';
import assert from 'node:assert/strict';import {CodexEngine,profileOverrides} from '../src/engine.js';import {createWebServer} from '../src/web-server.js';
const root=resolve('.codex/scratch/local-development-web-access-implementation');mkdirSync(root,{recursive:true});const d=mkdtempSync(join(root,'native-profile-'));
const config={appData:d,codexHome:join(d,'codex'),runtime:join(d,'runtime'),workspace:join(d,'A'),controlBrowserData:[join(d,'browser')],codexBin:resolve(process.argv[2]!),model:'gpt-6.1-sol',requiresOpenaiAuth:false,timeoutMs:90000,mainTimeoutMs:90000,stopGraceMs:1000};
for(const p of [config.codexHome,config.runtime,config.workspace,join(d,'B'),join(d,'C'),...config.controlBrowserData])mkdirSync(p,{recursive:true});
writeFileSync(join(config.runtime,'protected.txt'),'synthetic-private');writeFileSync(join(d,'browser/session'),'synthetic-browser-secret');
const dev=createServer((_q,r)=>r.end('synthetic-local-development'));await new Promise<void>(r=>dev.listen(0,'127.0.0.1',r));const devUrl=`http://127.0.0.1:${(dev.address() as any).port}/`;
let controls=0;const bridge:any={state:async()=>({threadId:'synthetic',pending:true}),submit:async()=>{controls++;return{};},stop:async()=>{controls++;},respond:async()=>{controls++;},artifact:async()=>({filename:'x',content:'x'})};
const web=await createWebServer({bridge,port:0});
const receipt:any={synthetic:true,model:false,account:false,protocol:'native command/exec; no scripted model calls',roles:{}};let engine:CodexEngine|undefined;
try{
 for(const role of ['main','worker'] as const){
  const options={cwd:config.workspace,readRoots:[],instructions:'No model turns.',tools:[],nativeTools:role,nativeCapabilities:true,controlOnly:true};
  const profile=profileOverrides(config,options);for(const cwd of ['A','B','C'].map(x=>join(d,x)))assert.deepEqual(profileOverrides(config,{...options,cwd}),profile);
  engine=new CodexEngine(config,options,async()=>{throw Error('no_model');});await engine.start();receipt.version=engine.version;
  const proof:any={sameFilesystemABC:true,networkApprovals:0};receipt.roles[role]=proof;
  const run=(command:string[],timeoutMs=10000)=>engine!.request('command/exec',{command,cwd:config.workspace,permissionProfile:'homer',timeoutMs});
  proof.ordinaryExit=(await run(['/bin/sh','-c','printf synthetic > ordinary.txt'])).exitCode;assert.equal(proof.ordinaryExit,0);
  proof.privateReadExit=(await run(['/bin/cat',join(config.runtime,'protected.txt')])).exitCode;assert.notEqual(proof.privateReadExit,0);
  proof.privateWriteExit=(await run(['/bin/sh','-c','printf overwritten > "$1"','probe',join(config.runtime,'protected.txt')])).exitCode;assert.notEqual(proof.privateWriteExit,0);
  proof.browserReadExit=(await run(['/bin/cat',join(d,'browser/session')])).exitCode;assert.notEqual(proof.browserReadExit,0);
  const attempts=[['GET','/api/state','{}','200'],['POST','/api/stop',JSON.stringify({messageId:'synthetic-message'}),'202'],['POST','/api/interactions/synthetic',JSON.stringify({requestId:'synthetic-decision',text:'拒绝本次操作'}),'202']];proof.localCallerProtection='deferred';proof.localControlStatus=[];
  for(const [method,path,payload,expected]of attempts){const r=await run(['/usr/bin/curl','--noproxy','*','--silent','--output','/dev/null','--write-out','%{http_code}','--request',method!,'--header','Origin: '+web.url,'--header','Cookie: homer=forged','--header','X-Homer-Connection: forged','--header','Content-Type: application/json','--data',payload!,web.url+path]);assert.equal(r.exitCode,0);proof.localControlStatus.push(r.stdout?.trim());assert.equal(r.stdout?.trim(),expected);}
  const commands=[
   ['/usr/bin/curl','--fail','--silent','--max-time','10','--output','https-'+role+'.txt','https://github.com/robots.txt'],
   ['/usr/bin/git','-c','credential.helper=','-c','core.askPass=','-c','http.lowSpeedLimit=1','-c','http.lowSpeedTime=8','ls-remote','https://github.com/makecindy/cindy.git','HEAD'],
   ['/usr/bin/curl','--fail','--silent','--max-time','10','--output','dependency-'+role+'.tgz','https://registry.npmjs.org/is-number/-/is-number-7.0.0.tgz'],
   ['/usr/bin/curl','--noproxy','*','--fail','--silent','--max-time','5',devUrl]
  ];proof.networkExits=[];for(const [index,command]of commands.entries()){const r=await run(command,12000);proof.networkExits.push(r.exitCode);assert.equal(r.exitCode,0,'native network command '+index);if(index===1)assert.match(r.stdout??'',/^[a-f0-9]+\s+HEAD/);if(index===3)assert.equal(r.stdout,'synthetic-local-development');}
  proof.publicHttps=true;proof.publicGitRead=true;proof.registryDownloadOnly=true;proof.lifecycleScriptsExecuted=false;proof.localhost=true;
  const effective=await engine.request('config/read',{cwd:config.workspace});proof.nativeAgentsEnabled=effective.config.features.multi_agent;assert.equal(proof.nativeAgentsEnabled,role==='worker');
  await engine.close();engine=undefined;
 }
 assert.equal(controls,4);receipt.controlMutations=controls;receipt.securityStatus='local_caller_isolation_deferred';receipt.status='passed';
}catch(error){receipt.status='failed';receipt.error=error instanceof Error&&'code'in error?String(error.code):error instanceof Error&&/^[a-z_]{1,70}$/.test(error.message)?error.message:'native_profile_failed';process.exitCode=1;}
finally{await engine?.close();await web.close();await new Promise<void>(r=>dev.close(()=>r()));writeFileSync(join(root,'native-profile-receipt.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));}
