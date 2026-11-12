// Release-only entry: no source reads, npm, compiler, watcher, or port scan.
import {readFileSync,writeFileSync,existsSync,realpathSync,readdirSync,lstatSync,mkdirSync,closeSync} from 'node:fs';
import {resolve,join,dirname,relative} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {PassThrough,Writable} from 'node:stream';
import {createInterface} from 'node:readline';
import {userInfo} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {prepareDesktopProfile,acquireDesktopOwner,assertDesktopAdoptionLeasesRecoverable,desktopBoundary,readDesktopModelSource,readDesktopChatGPTConfig} from './desktop-profile.mjs';
const DEEPSEEK_KEY_ENV='HOMER_DEEPSEEK_TOKEN';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const send=value=>new Promise((accept,reject)=>process.stdout.write(JSON.stringify(value)+'\n',error=>error?reject(error):accept()));
let releaseOwner;
let hostStarted=false,refusalConfirmed=false;
try{
 const homer=realpathSync(resolve(dirname(fileURLToPath(import.meta.url)),'..'));
 const resources=resolve(homer,'..'),windows=process.platform==='win32',bundle=windows?resolve(resources,'..'):resolve(resources,'../..');
 if(realpathSync(process.execPath)!==(windows?join(resources,'node.exe'):join(bundle,'Contents/MacOS/node'))||process.version!=='v22.22.0'||!['arm64','x64'].includes(process.arch))throw Error('desktop_runtime_incompatible');
 const manifestBytes=readFileSync(join(resources,'desktop-manifest.json')),manifest=JSON.parse(manifestBytes);
 const preparation=manifest.preparation&&!(manifest.localWorkingTree===true&&manifest.publishable===false);
 if(manifest.format!==2||manifest.node!=='22.22.0'||manifest.codex!=='0.163.0'||manifest.arch!==undefined&&manifest.arch!==process.arch)throw Error('desktop_runtime_incompatible');
 const observed=[];
 function inventory(directory,prefix=''){
   for(const name of readdirSync(directory).sort()){
     if(name==='.DS_Store'||!prefix&&name==='desktop-manifest.json')continue;
     const path=join(directory,name),rel=join(prefix,name),stat=lstatSync(path);
     if(stat.isSymbolicLink())throw Error('desktop_resource_changed');
     if(stat.isDirectory())inventory(path,rel);else if(stat.isFile())observed.push({path:rel,sha256:sha(readFileSync(path))});else throw Error('desktop_resource_changed');
   }
 }
 const codeFiles=(windows?['Homer.exe']:['Contents/MacOS/homer-image-decoder','Contents/MacOS/homer-window-capture','Contents/MacOS/node',...(manifest.powerWake===1?['Contents/MacOS/homer-power-client','Contents/MacOS/homer-power-helper','Contents/Library/LaunchDaemons/app.homer.desktop.power.plist']:[])]).map(path=>{
   const file=join(bundle,path);if(realpathSync(file)!==file)throw Error('desktop_resource_changed');
   return {path,sha256:sha(readFileSync(file))};
 });
 if(JSON.stringify(codeFiles)!==JSON.stringify(manifest.codeFiles))throw Error('desktop_resource_changed');
 inventory(resources);
 if(JSON.stringify(observed)!==JSON.stringify(manifest.files))throw Error('desktop_resource_changed');
 const args=process.argv.slice(2),at=args.indexOf('--profile');
 if(at<0||!args[at+1]||args.some((arg,index)=>index!==at+1&&!['--profile','--test-profile','--deepseek-daily'].includes(arg))||args.filter(arg=>arg==='--profile').length!==1||args.filter(arg=>arg==='--deepseek-daily').length>1)throw Error('desktop_explicit_profile_required');
 const profile=resolve(args[at+1]),test=args.includes('--test-profile'),daily=args.includes('--deepseek-daily');
 if(daily&&!test&&profile!==(windows?join(process.env.APPDATA??'','Homer Desktop'):join(userInfo().homedir,'Library/Application Support/Homer Desktop')))throw Error('deepseek_profile_invalid');
 if(preparation&&!test)throw Error('desktop_preparation_profile_required');
 if(process.cwd()!==profile||process.env.HOME!==join(profile,'host-home')||process.env.TMPDIR!==join(profile,'tmp'))throw Error('desktop_environment_isolation_required');
 // No inherited provider/account/config environment reaches the host.
 const env={...(windows?{SystemRoot:process.env.SystemRoot,TEMP:join(profile,'tmp'),TMP:join(profile,'tmp'),APPDATA:process.env.APPDATA,LOCALAPPDATA:process.env.LOCALAPPDATA,USERPROFILE:join(profile,'host-home')}:{ }),PATH:windows?resources+';'+join(process.env.SystemRoot,'System32'):join(bundle,'Contents/MacOS')+':/usr/bin:/bin:/usr/sbin:/sbin',HOME:join(profile,'host-home'),TMPDIR:join(profile,'tmp'),LANG:'zh_CN.UTF-8'};
 for(const key of Object.keys(process.env))delete process.env[key];Object.assign(process.env,env);
 let connection;
 if(daily){
  // FD 3 is a one-shot private pipe from Electron, never a renderer or URL.
  try{
   const payload=readFileSync(3,'utf8');
   connection=JSON.parse(payload);
   if(connection!==null){
    const {validateHomerCredentials}=await import(pathToFileURL(join(homer,'dist/homer-account.js')).href);
    const {token,...metadata}=connection;
    validateHomerCredentials({...metadata,modelToken:token??'disconnected'},{gatewayOrigin:manifest.account?.gatewayOrigin??'',allowSyntheticLoopback:test});
   }
  }
  finally{closeSync(3);}
 }
 const paths=prepareDesktopProfile(profile,manifest,{test});
 const modelSource=readDesktopModelSource(profile,daily?'website':'codex');

 if(existsSync(join(paths.codexHome,'desktop-owner.json')))throw Error('desktop_owner_conflict');
 const {processIdentity,leaseOwnerGone}=await import(pathToFileURL(join(homer,'dist/processes.js')).href);
 let codexBin=join(resources,'runtime/codex/vendor',windows?'x86_64-pc-windows-msvc':process.arch==='arm64'?'aarch64-apple-darwin':'x86_64-apple-darwin',windows?'bin/codex.exe':'bin/codex');
 if(test){
   const fake=join(profile,'fixture-codex.mjs');
   if(!existsSync(fake)||realpathSync(fake)!==fake||JSON.parse(readFileSync(join(profile,'.homer-desktop-test-profile'),'utf8')).format!==1)throw Error('desktop_test_fixture_required');
   codexBin=fake;
 }
 const {PRODUCT_MODEL_DEFAULTS,chatgptModelConfig,chatgptModelError}=await import(pathToFileURL(join(homer,'dist/model-config.js')).href);
 const resourceIdentity={bundleRoot:bundle,manifestSha256:sha(manifestBytes)};
 let config={appData:profile,nativeCodexHome:paths.codexHome,workspace:paths.workspace,runtime:paths.runtime,codexHome:paths.codexHome,codexBin,model:PRODUCT_MODEL_DEFAULTS.model,requiresOpenaiAuth:true,stopGraceMs:3000,desktopResources:resourceIdentity};
 if(paths.adoption){
   const {loadConfig}=await import(pathToFileURL(join(homer,'dist/config.js')).href);
   const original=loadConfig(paths.adoption.sourceConfig);
   if(sha(readFileSync(paths.adoption.sourceConfig))!==paths.adoption.sha256)throw Error('desktop_adoption_source_changed');
   if(original.runtime!==paths.runtime||original.workspace!==paths.workspace||original.codexHome!==paths.codexHome)throw Error('desktop_adoption_paths_invalid');
   // Source config owns model, effort and timeouts. Only
   // the verified binary and shell HOME/tmp come from the installed App.
   config={...original,appData:paths.adoption.appData,nativeCodexHome:paths.adoption.nativeCodexHome,codexBin,desktopResources:resourceIdentity,desktopAdopted:true,pauseOldDesktopWork:true,...(daily?{dailyDeepSeek:true}:{})};
 }
 if(daily&&modelSource==='website'&&connection?.token)process.env[DEEPSEEK_KEY_ENV]=connection.token;
 const mobileTurnAccount=daily&&connection?.token?{gatewayOrigin:manifest.account.gatewayOrigin,token:connection.token,allowSyntheticLoopback:test}:undefined;
 if(daily){
   config={...config,dailyDeepSeek:true,pauseOldDesktopWork:true,desktopConnection:modelSource==='website'&&connection?.token?connection.config:undefined};connection=undefined;
 }
 if(modelSource)config={...config,desktopModelSource:modelSource,desktopProfile:profile,pauseOldDesktopWork:true};
 if(modelSource==='codex')config={...config,chatgpt:chatgptModelConfig(readDesktopChatGPTConfig(profile))};
 const database=join(paths.runtime,'homer.sqlite');let thread;
 if(existsSync(database)){
   const db=new DatabaseSync(database,{readOnly:true});
   try{
     const hasMeta=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='meta'").get();
     if(hasMeta){
       thread=db.prepare("SELECT value FROM meta WHERE key='mainThread'").get()?.value;
       const leases=db.prepare("SELECT key,value FROM meta WHERE key LIKE 'lease:%'").all();
       if(paths.adoption&&!thread)throw Error('desktop_adoption_original_thread_required');
       try{assertDesktopAdoptionLeasesRecoverable(leases,pid=>!leaseOwnerGone(pid));}
       catch{throw Error(paths.adoption?'desktop_adoption_owner_unknown':'desktop_lease_review_required');}
       const {READABLE_STORE_SCHEMA_VERSIONS}=await import(pathToFileURL(join(homer,'dist/store.js')).href);
       const schema=db.prepare("SELECT value FROM meta WHERE key='recursiveSchemaVersion'").get();
       if(!READABLE_STORE_SCHEMA_VERSIONS.includes(schema?.value))throw Error('desktop_schema_incompatible');
     }
   }finally{db.close();}
 }
 if(paths.adoption&&!thread)throw Error('desktop_adoption_original_thread_required');
 const transport=join(paths.runtime,'gateway/transport.sqlite');
 if(existsSync(transport)){
   const db=new DatabaseSync(transport,{readOnly:true});
   try{
     if(db.prepare('PRAGMA user_version').get().user_version!==1)throw Error('desktop_schema_incompatible');
     if(db.prepare("SELECT 1 FROM transport_requests WHERE state='pending' LIMIT 1").get())throw Error('desktop_transport_review_required');
     if(paths.adoption&&db.prepare("SELECT value FROM transport_meta WHERE key='binding'").get()?.value!==desktopBoundary(config,manifest.codex))throw Error('desktop_adoption_gateway_review_required');
   }finally{db.close();}
 }
 releaseOwner=acquireDesktopOwner(paths.codexHome,processIdentity,paths.runtime);
 // Retain exact original account/memory defaults; no loadConfig fallback to HOME.
 const build={directory:homer,hash:manifest.sourceHash,manifest:manifest.manifest,version:manifest.sourceHash.slice(0,12),uiHash:manifest.uiHash,schema:manifest.schema,toolsHash:manifest.toolsHash,boundary:desktopBoundary(config,manifest.codex),config,thread};
 const {verifyBuild}=await import('./trusted-build.mjs');verifyBuild(build);
 if((windows||process.arch==='arm64')&&observed.some(file=>file.path.replaceAll('\\','/').startsWith('runtime/cua/'))){
   const {recoverCuaSessions,WINDOWS_CUA_HELPER}=await import(pathToFileURL(join(homer,'dist/cua-processes.js')).href);
   if(observed.some(file=>file.path.replaceAll('\\','/')===(windows?WINDOWS_CUA_HELPER:'runtime/cua/cua-driver')))
     await recoverCuaSessions(paths.runtime,windows?join(resources,WINDOWS_CUA_HELPER):undefined);
 }
 const {runDev}=await import('./dev.mjs');
 const {readMobileConfig}=await import(pathToFileURL(join(homer,'dist/mobile-gateway.js')).href);
 const mobileConfig=readMobileConfig(join(profile,'mobile.json'));
 const input=new PassThrough(),output=new Writable({write(_chunk,_encoding,done){done();}});
 let quitting=false,nativeAccount,updateStop,power;
 const quit=()=>{if(quitting)return;quitting=true;input.write('/quit\n');};
 const reader=createInterface({input:process.stdin});
 reader.on('line',line=>{
  if(line.length>4096)return;
  try{const value=JSON.parse(line);
   if(value.kind==='quit')quit();
   else if(value.kind==='power_ack'&&Number.isSafeInteger(value.id)&&value.id>0){void power?.('ack',{id:value.id});}
   else if(value.kind==='power_resume'&&Number.isSafeInteger(value.id)&&value.id>0&&(value.afterSleep===undefined||typeof value.afterSleep==='boolean')){
    void (async()=>{try{if(quitting||!power)throw Error('power_recheck_unconfirmed');if(value.afterSleep===undefined)await power('resume');else await power('resume',{afterSleep:value.afterSleep});await send({kind:'power_result',id:value.id});}catch{await send({kind:'power_result',id:value.id,error:'power_recheck_unconfirmed'});}})();
   }
   else if(value.kind==='update-stop'){if(!quitting&&updateStop)updateStop();else void send({kind:'update-busy'});}
   else if(value.kind==='native_account'&&Number.isSafeInteger(value.id)&&value.id>0&&['state','connect','cancel','models','apply-models','channel-state'].includes(value.action)){
    void (async()=>{try{if(quitting||!nativeAccount)throw Error('desktop_account_unavailable');await send({kind:'native_account_result',id:value.id,value:await nativeAccount(value.action,value.input)});}catch(error){await send({kind:'native_account_result',id:value.id,error:value.action==='apply-models'?chatgptModelError(error?.message):'native_account_unconfirmed'});}})();
   }
  }catch{}
 });
 reader.on('close',quit);
 const result=await runDev({root:homer,input,output,...mobileConfig,mobileTurnAccount,json:false,webPort:0,fixedBuild:build,desktop:{bindAccount:callback=>{nativeAccount=callback;},bindPower:callback=>{power=callback;},bindUpdateStop:callback=>{updateStop=callback;},onHostSpawn:()=>{hostStarted=true;},onEvent:value=>{void send(value);}}});
 reader.close();input.destroy();process.stdin.pause();
 if(!result?.stoppedConfirmed&&!result?.noHostStarted)throw Error('desktop_stop_unconfirmed');
 // A successful host close includes all main/control/Worker/MCP owner evidence.
 releaseOwner();releaseOwner=undefined;
 if(result?.startupError){refusalConfirmed=true;throw Error(result.startupError);}
 await send({kind:result.updateStopped?'update-stopped':'stopped'});
}catch(error){
 if(releaseOwner&&!hostStarted){try{releaseOwner();releaseOwner=undefined;}catch{}}
 if(refusalConfirmed||!hostStarted&&!releaseOwner)await send({kind:'startup_refused'}).catch(()=>{});
 const code=error instanceof Error&&/^[a-z_]{1,70}$/.test(error.message)?error.message:'desktop_start_failed';
 await send({kind:'error',code}).catch(()=>{});
 // Never remove the owner on an unconfirmed startup/exit. No stale takeover.
 process.exitCode=1;
}
