import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {transpileModule,ModuleKind,ScriptTarget} from 'typescript';
import {assertDesktopAdoptionLeasesRecoverable} from '../scripts/desktop-profile.mjs';
const require=createRequire(import.meta.url),tick=()=>new Promise(resolve=>setImmediate(resolve));
async function link(source,modules,context,url){
 const entry=new vm.SourceTextModule(source,{context,initializeImportMeta:meta=>{meta.url=url;},importModuleDynamically:name=>synthetic(modules[name]??require(name))});
 async function synthetic(exports){const m=new vm.SyntheticModule(Object.keys(exports),function(){for(const [k,v]of Object.entries(exports))this.setExport(k,v);},{context});await m.link(()=>{});await m.evaluate();return m;}
 await entry.link(name=>synthetic(modules[name]??require(name)));return entry;
}
async function runtimeFixture(result,{arch='arm64',releaseError=false,manifestArch=arch,platform='darwin'}={}){
 const events=[],stdin=new PassThrough(),profile='/fixture/profile',bundle='/fixture/Homer.app',resources=bundle+(platform==='win32'?'/resources':'/Contents/Resources'),homer=resources+'/homer';let complete,stopCalls=0;
 const digest=createHash('sha256').update('').digest('hex');
 const manifest={format:2,node:'22.22.0',codex:'0.163.0',arch:manifestArch,files:[],codeFiles:(platform==='win32'?['Homer.exe']:['Contents/MacOS/homer-image-decoder','Contents/MacOS/homer-window-capture','Contents/MacOS/node']).map(path=>({path,sha256:digest})),sourceHash:'synthetic-hash'};
 const proc={argv:['node','desktop-runtime','--profile',profile,'--test-profile'],version:'v22.22.0',arch,platform,execPath:platform==='win32'?resources+'/node.exe':bundle+'/Contents/MacOS/node',stdin,stdout:new Writable({write(bytes,_e,done){events.push(JSON.parse(String(bytes)));done();}}),env:{HOME:profile+'/host-home',TMPDIR:profile+'/tmp',SystemRoot:'C:\\Windows',LOCALAPPDATA:'C:\\RedirectedLocal'},cwd:()=>profile};
 const modules={
  'node:fs':{realpathSync:path=>path,existsSync:path=>path===profile+'/fixture-codex.mjs',readFileSync:path=>Buffer.from(path.endsWith('desktop-manifest.json')?JSON.stringify(manifest):path.endsWith('.homer-desktop-test-profile')?'{"format":1}':''),readdirSync:()=>[],lstatSync(){throw Error('unexpected_lstat');},mkdirSync(){},writeFileSync(){throw Error('unexpected_write');},closeSync(){}},
  'node:sqlite':{DatabaseSync:class{constructor(){throw Error('unexpected_database');}}},
  './desktop-profile.mjs':{prepareDesktopProfile:()=>({codexHome:profile+'/codex',workspace:profile+'/workspace',runtime:profile+'/runtime'}),assertDesktopAdoptionLeasesRecoverable,acquireDesktopOwner:(home,identity,runtime)=>{assert.equal(home,profile+'/codex');assert.equal(runtime,profile+'/runtime');assert.equal(identity(),'fixture-owner');return ()=>{events.push({kind:'owner-release'});if(releaseError)throw Error('desktop_owner_release_failed');};},desktopBoundary:()=> 'fixture',readDesktopModelSource:()=> 'codex'},
  [new URL('dist/processes.js','file://'+homer+'/').href]:{processIdentity:()=> 'fixture-owner',leaseOwnerGone:()=>{throw Error('unexpected_lease_probe');}},
  [new URL('dist/model-config.js','file://'+homer+'/').href]:{PRODUCT_MODEL_DEFAULTS:{model:'fixture'}},
  [new URL('dist/mobile-gateway.js','file://'+homer+'/').href]:{readMobileConfig:()=>({})},
  './trusted-build.mjs':{verifyBuild(){}},
  './dev.mjs':{runDev:async options=>{options.desktop.onHostSpawn();options.desktop.bindUpdateStop(()=>stopCalls++);return new Promise(resolve=>{complete=()=>resolve(result);});}},
 };
 const context=vm.createContext({process:proc,Buffer,console});const entry=await link(readFileSync('scripts/desktop-runtime.mjs','utf8'),modules,context,'file://'+homer+'/scripts/desktop-runtime.mjs');const done=entry.evaluate();await tick();
 return {events,proc,get stopCalls(){return stopCalls;},complete:async()=>{complete?.();await done;stdin.destroy();}};
}
async function dependencyFixture(arch,corrupt=false,platform='darwin'){
 const target=platform+'-'+arch,nodeName=platform==='win32'?'node-v22.22.0-win-x64.zip':`node-v22.22.0-${platform}-${arch}.tar.gz`,version='0.163.0',nodeVersion='22.22.0',files=new Map(),commands=[];
 const nodeBytes=Buffer.from('synthetic-node-'+arch),cli=Buffer.from('synthetic-cli'),native=Buffer.from('synthetic-codex-'+arch);
 const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),sri=bytes=>'sha512-'+createHash('sha512').update(bytes).digest('base64');
 const pin=bytes=>({sha256:sha(bytes),integrity:sri(bytes)});
 const licenses={LICENSE:Buffer.from('synthetic-license'),NOTICE:Buffer.from('synthetic-notice')};
 const locks={node:pin(nodeBytes),nodeDarwinX64:pin(nodeBytes),nodeWin32X64:pin(nodeBytes),codexWin32X64:pin(native),codex:pin(cli),codexDarwinArm64:pin(native),codexDarwinX64:{integrity:sri(native)},codexLicenseTag:'rust-v'+version,codexLicenseSha256:{LICENSE:sha(licenses.LICENSE),NOTICE:sha(licenses.NOTICE)}};
 const put=(name,bytes)=>files.set('/archives/'+name,Buffer.from(bytes));
 const cua=Buffer.from('synthetic-driver'),sdk=Buffer.from('synthetic-sdk'),notice=Buffer.from('synthetic-notice');
 const nativeSdk=Buffer.from('synthetic-platform-sdk');
 locks.cuaDriver={version:'0.46.1',archive:{file:'driver.tar.gz',url:'https://example.invalid/driver',sha256:sha(cua)},windowsArchive:{file:'driver.zip',url:'https://example.invalid/windows',sha256:sha(cua)},
  windowsPackage:{name:'@trycua/cua-driver-win32-x64-msvc',version:'0.46.1',integrity:sri(nativeSdk),license:'MIT AND MPL-2.0'},packages:[
  {name:'@trycua/cua-driver',version:'0.46.1',integrity:sri(sdk),license:'MIT'},
  {name:'@trycua/cua-driver-darwin-arm64',version:'0.46.1',integrity:sri(nativeSdk),license:'MIT AND MPL-2.0'},
 ],licenses:[{file:'Cua-NOTICE',url:'https://example.invalid/notice',sha256:sha(notice)}]};
 put('driver.tar.gz',corrupt==='driver'?'tampered':cua);
 put('driver.zip',corrupt==='driver'?'tampered':cua);
 put('cua-driver-0.46.1.tgz',corrupt==='sdk'?'tampered':sdk);
 put('cua-driver-darwin-arm64-0.46.1.tgz',nativeSdk);
 put('cua-driver-win32-x64-msvc-0.46.1.tgz',corrupt==='native-sdk'?'tampered':nativeSdk);
 put('Cua-NOTICE',corrupt==='notice'?'tampered':notice);
 put('node-shasums256.txt',sha(nodeBytes)+'  '+nodeName+'\n');put(nodeName,nodeBytes);
 for(const [v,name,bytes]of [[version,'codex-registry.json',cli],[version+'-'+target,`codex-${arch}-registry.json`,native]]){
  put(name,JSON.stringify({name:'@openai/codex',version:v,license:'Apache-2.0',dist:{tarball:`https://registry.npmjs.org/@openai/codex/-/codex-${v}.tgz`,integrity:sri(bytes)}}));
  put(`codex-${v}.tgz`,corrupt===true&&v.endsWith(target)?Buffer.from('tampered'):bytes);
 }
 for(const [name,bytes] of Object.entries(licenses))files.set(`file:///fixture/packaging/macos/codex-license/${name}`,corrupt===name?Buffer.from('tampered'):bytes);
 const modules={
  'node:fs':{readFileSync:(path,encoding)=>{const key=String(path);if(key.endsWith('dependencies-lock.json'))return JSON.stringify(locks);assert.ok(files.has(key),'unexpected network or file read '+path);return encoding?files.get(key).toString(encoding):files.get(key);},writeFileSync:(path,value)=>files.set(path,Buffer.from(value)),mkdirSync(){},existsSync:path=>files.has(path),rmSync(){throw Error('unexpected_cleanup');}},
  'node:child_process':{execFileSync:(bin,args)=>{commands.push([bin,args]);assert.equal(bin,platform==='win32'?'C:\\Windows/System32/tar.exe':'/usr/bin/tar','dependency test must never fetch or execute binaries');return args[0]==='-tf'?'package/file\n':Buffer.alloc(0);}},
 };
 const entry=await link(readFileSync('scripts/prepare-desktop-dependencies.mjs','utf8'),modules,vm.createContext({process:{arch,platform,argv:[],env:{SystemRoot:'C:\\Windows'}},Buffer,URL,console}),'file:///fixture/scripts/prepare-desktop-dependencies.mjs');await entry.evaluate();
 return {prepare:()=>entry.namespace.prepareDependencies('/scratch',{archiveSource:'/archives',arch}),commands};
}
if(!vm.SourceTextModule){
 test('desktop runtime update contracts use isolated VM modules',()=>execFileSync(process.execPath,['--experimental-vm-modules','--test',fileURLToPath(import.meta.url)],{stdio:'pipe'}));
}else{
 for(const edge of ['0','320','invalid'])test('Windows image helper uses bounded single-frame decoding '+edge,async()=>{
  const calls=[],output=[];const image={rotate(){calls.push('rotate');return this;},resize(value){calls.push(value);return this;},png(){calls.push('png');return this;},async toBuffer(){return Buffer.from('png');}};
  const proc={argv:['node','helper',edge],stdin:(async function*(){yield Buffer.from('synthetic image');})(),stdout:{write:bytes=>output.push(String(bytes))}};
  const entry=await link(readFileSync('packaging/windows/image-decoder.mjs','utf8'),{'node:module':{createRequire:()=>name=>{assert.equal(name,'sharp');return(bytes,options)=>{assert.equal(String(bytes),'synthetic image');assert.equal(options.limitInputPixels,40_000_000);assert.equal(options.animated,false);assert.equal(options.failOn,'error');return image;};}}},vm.createContext({process:proc,Buffer,URL}),'file:///fixture/resources/homer-image-decoder.mjs');await entry.evaluate();
  if(edge==='invalid'){assert.equal(proc.exitCode,1);assert.equal(output.length,0);assert.equal(calls.length,0);}else{assert.equal(proc.exitCode,undefined);assert.deepEqual(output,['png']);assert.equal(calls[0],'rotate');if(edge==='320')assert.equal(calls[1].withoutEnlargement,true);else assert.equal(calls.length,2);}
 });
 test('Windows decoder crops the original pixels before making an optional preview',async()=>{
  const sharp=require('sharp'),pixels=Buffer.from([255,0,0,255,0,0,255,0,0, 255,0,0,0,255,0,0,255,0, 255,0,0,0,255,0,0,255,0]);
  const image=await sharp(pixels,{raw:{width:3,height:3,channels:3}}).png().toBuffer();
  for(const [rect,width]of [[['1','1','2','2'],2],[['2','2','2','2'],0]]){
   let output;
   const proc={argv:['node','helper','crop',...rect,'0'],stdin:[image],stdout:{write:bytes=>output=bytes}};
   const entry=await link(readFileSync('packaging/windows/image-decoder.mjs','utf8'),{'node:module':{createRequire:()=>()=>sharp}},vm.createContext({process:proc,Buffer,URL}),'file:///fixture/resources/homer-image-decoder.mjs');
   await entry.evaluate();
   if(!width){assert.equal(proc.exitCode,1);assert.equal(output,undefined);continue;}
   const cropped=await sharp(output).raw().toBuffer({resolveWithObject:true});
   assert.equal(cropped.info.width,width);assert.equal(cropped.info.height,width);
   assert.deepEqual(cropped.data,Buffer.from([0,255,0,0,255,0,0,255,0,0,255,0]));
  }
 });
 test('Windows CUA preserves the profile when the job has no confirmed stop receipt',async()=>{
  const dir='/fixture/runtime/homer-cua-Ab123c',helper='/fixture/resources/runtime/cua/homer-cua-windows.exe',calls=[];
  let stopped=false,acknowledge=false;
  const modules={'node:fs':{...require('node:fs'),lstatSync:()=>({isDirectory:()=>true}),realpathSync:path=>path,
   readdirSync:()=>['unrelated', 'homer-cua-Ab123c'],rmSync:(path)=>calls.push(['remove',path])},
   'node:child_process':{...require('node:child_process'),spawn:()=>{
    const child=new EventEmitter();child.stdout=new PassThrough();
    child.stdin=new Writable({write(_value,_encoding,done){done();}});
    child.stdin.once('finish',()=>{child.stdout.end(acknowledge?'stopped\r\n':'');child.emit('close',0);});
    queueMicrotask(()=>child.stdout.write('ready\r\n'));return child;
   },execFile:(file,args,options,done)=>{
    calls.push([file,[...args]]);assert.equal(options.env.HOMER_DEEPSEEK_TOKEN,undefined);
    done(null,{stdout:stopped?'stopped\r\n':'unknown'});
   }},'./processes.js':{leaseOwnerGone(){},processIdentity(){}}};
  const source=transpileModule(readFileSync('src/cua-processes.ts','utf8'),{compilerOptions:{module:ModuleKind.ESNext,target:ScriptTarget.ES2023}}).outputText;
  const entry=await link(source,modules,vm.createContext({process:{env:{SystemRoot:'C:\\Windows',HOMER_DEEPSEEK_TOKEN:'fixture-only'}},Buffer,setTimeout,clearTimeout}),'file:///fixture/src/cua-processes.js');
  await entry.evaluate();
  await assert.rejects(entry.namespace.recoverCuaSessions('/fixture/runtime',helper),/cua_stop_unconfirmed/);
  assert.deepEqual(calls,[[helper,['stop',dir]]]);calls.length=0;
  stopped=true;await entry.namespace.recoverCuaSessions('/fixture/runtime',helper);
  assert.deepEqual(calls,[[helper,['stop',dir]],['remove',dir]]);
  for(acknowledge of [false,true]){
   calls.length=0;stopped=false;
   const job=entry.namespace.holdCuaWindowsJob(helper,dir);await job.ready;
   assert.equal(await entry.namespace.reclaimCuaSession(dir,undefined,helper,job),acknowledge);
   assert.deepEqual(calls,acknowledge?[['remove',dir]]:[[helper,['stop',dir]]]);
  }
 });
 test('Windows Worker uses a named pipe without filesystem permissions or cleanup',async()=>{
  let listening,unlinked=false,chmod=false;
  const modules={'./execution-tools.js':{EXECUTION_TOOLS:[]},'./worker-interaction-tools.js':{MAIN_INTERACTION_TOOLS:[]},
   './media-tools.js':{MEDIA_TOOLS:[],WORKER_MEDIA_TOOLS:[]},'./interaction-limits.js':{INTERACTION_LIMITS:{}},
   './membership-web-tools.js':{MEMBERSHIP_TOOLS:[]},'./desktop-cua.js':{CUA_TOOLS:[]},
   'node:fs':{chmodSync:()=>{chmod=true;},unlinkSync:()=>{unlinked=true;}},
   'node:net':{createConnection(){},createServer:()=>({listening:true,once(){},listen(path,done){
    listening=path;done();
   },close(done){done();}})}};
  const source=transpileModule(readFileSync('src/worker-interaction-mcp.ts','utf8'),{compilerOptions:{module:ModuleKind.ESNext,target:ScriptTarget.ES2023}}).outputText;
  const entry=await link(source,modules,vm.createContext({process:{platform:'win32',cwd:()=>'/fixture'},Buffer}),'file:///fixture/src/worker-interaction-mcp.js');
  await entry.evaluate();
  const server=new entry.namespace.WorkerInteractionMcp('/fixture/runtime',async()=>null);
  await server.start();
  assert.match(listening,/^\\\\\.\\pipe\\homer-hi-[0-9a-f-]{36}$/);
  await server.close();assert.equal(chmod||unlinked,false);
 });
 test('Windows CUA confirms the Chrome address and rejects desktop-region fallback images',async()=>{
  const calls=[],edges=[],url='https://example.test/work',target={pid:17,window_id:314},helper='runtime/cua/homer-cua-windows.exe';
  const window={x:4,y:2,width:800,height:600};
  const sha=value=>createHash('sha256').update(value).digest('hex');
  let typed=false,confirmed=true,starts=0,shotWidth=800,shotHeight=600;
  const driver={metadata:async()=>({pid:777,driverVersion:'0.46.1'}),shutdown:async()=>{},uniffiDestroy(){},callTool:async(name,input)=>{
   const args=JSON.parse(input);calls.push(name);
   const screenshot=name==='get_window_state'&&args.include_screenshot!==false;
   if(name==='hotkey')assert.deepEqual(args.keys,['ctrl','l']);
   if(name==='type_text'){assert.equal(args.text,url);typed=true;}
   if(name==='press_key')assert.equal(args.key,'Return');
   if(['bring_to_front','hotkey','type_text','press_key'].includes(name)){
    assert.equal(args.pid,target.pid);assert.equal(args.window_id,target.window_id);
   }
   const data=name==='list_windows'?{windows:[{...target,title:'Fixture',app_name:'chrome.exe',layer:0,is_on_screen:true,z_index:1}]}:
    name==='check_permissions'?{uia:true}:name==='bring_to_front'?{landed_on_target:true}:
    screenshot?{...target,window_bounds:window,screenshot_width:shotWidth,screenshot_height:shotHeight,capture_id:'fixture-capture'}:{};
   return {isError:false,structuredJson:JSON.stringify(data),images:screenshot?[{mimeType:'image/png',dataBase64:'AQ=='}]:undefined};
  }};
  const root='/fixture/Homer',resources=root+'/resources',trusted={bundleRoot:root,resources,imageDecoder:resources+'/homer-image-decoder.mjs',files:[{path:helper.replaceAll('/','\\'),sha256:sha('helper')}]};
  const modules={
   'node:fs':{...require('node:fs'),existsSync:path=>path===resources+'/'+helper,realpathSync:path=>path,readFileSync:()=>Buffer.from('helper'),mkdtempSync:()=>'/fixture/runtime/homer-cua-Ab123c',writeFileSync(_path,body){assert.deepEqual(JSON.parse(body).resources.desktop.windows,[target]);}},
   'node:path':{...require('node:path'),join:(...paths)=>require('node:path').join(...paths.map(path=>path.replaceAll('\\','/')))},
   'node:timers/promises':{setTimeout:async()=>{}},
   './desktop-resources.js':{verifiedDesktopResources:()=>trusted},'./interaction-limits.js':{TOOL_IMAGE_BYTES:1},'./media-decode.js':{mediaProcess(_bin,args){
    edges.push(args.at(-1));return args.at(-1)==='600'?Buffer.from([2]):Buffer.from([2,2]);
   }},
   './media-policy.js':{MEDIA_POLICY:{imageBytes:10,maxPixels:1_000_000},
    imageDimensions:bytes=>bytes[0]===2?{width:300,height:200}:{width:shotWidth,height:shotHeight}},
   './processes.js':{processIdentity:()=>'fixture-owner'},
   '../scripts/windows-security.mjs':{windowsCommandAsync:()=>assert.fail('ordinary Chrome must not start a browser')},
   './cua-processes.js':{CUA_SESSION_PREFIX:'homer-cua-',WINDOWS_CUA_HELPER:helper,holdCuaWindowsJob:()=>({ready:Promise.resolve()}),
    reclaimCuaSession:async()=>true,pinCuaChrome:()=>assert.fail('wrong platform'),
    runCuaWindows:async(_file,[mode])=>{calls.push(mode);return {stdout:mode==='window'?'window':mode==='frame'?JSON.stringify(window):
     mode==='page'?JSON.stringify({window,viewport:{x:5,y:100,width:798,height:501},page:'fixture-tab'}):sha(typed&&confirmed?url:'unconfirmed')};}},
   [new URL('runtime/cua/node_modules/@trycua/cua-driver/dist/index.js','file://'+resources+'/').href]:{
    SessionPermissionMode:{Bounded:'bounded'},CuaDriver:{create:()=>driver,createPrivateWorker:options=>{
     starts++;assert.equal(options.binaryPath,resources+'/'+helper);
     assert.equal(options.configuredDriver.authorization.compatibilityMode,'bounded');return driver;
    }},
   },
  };
  const source=transpileModule(readFileSync('src/desktop-cua.ts','utf8'),{compilerOptions:{module:ModuleKind.ESNext,target:ScriptTarget.ES2023}}).outputText;
  const entry=await link(source,modules,vm.createContext({process:{platform:'win32',arch:'x64'},URL,Buffer,setTimeout,clearTimeout}),'file:///fixture/src/desktop-cua.js');
  await entry.evaluate();
  const cua=entry.namespace.DesktopCua.create({bundleRoot:root},'/fixture/runtime');
  assert.equal(starts,0);
  const open=()=>cua.invoke('owner','browser_open',{url},()=>{},()=>assert.fail('navigation does not save'),()=>assert.fail('browser does not need a window approval'));
  assert.equal((await open()).state,'submitted');
  assert.deepEqual(calls.slice(-8),['window','get_window_state','bring_to_front','hotkey','address','type_text','address','press_key']);
  const before=calls.length;
  shotWidth=798;shotHeight=598;
  const preview=await cua.invoke('owner','browser_read',{},()=>{},()=>assert.fail('preview does not save'),()=>assert.fail('browser does not need approval'));
  assert.equal(JSON.parse(preview.mediaContent[0].text).capture_id,'fixture-capture');
  assert.deepEqual(edges,['1100','600']);
  assert.equal(calls.slice(before).filter(name=>name==='get_window_state').length,1);
  assert.equal(await cua.close('owner'),true);assert.equal(starts,1);
  typed=false;confirmed=false;
  await assert.rejects(open(),/chrome_address_unconfirmed/);
  assert.equal(calls.filter(name=>name==='press_key').length,1);
  assert.equal(await cua.close('owner'),true);
  let saved=0;shotWidth=800;shotHeight=600;
  const read=()=>cua.invoke('owner','desktop_read',{app:'chrome.exe',save_as:'fixture.png'},()=>{},()=>++saved,async()=>{});
  await assert.rejects(read(),/desktop_screenshot_unavailable/);
  assert.equal(saved,0);
  shotWidth=798;shotHeight=598;
  assert.equal(await read(),1);
  assert.equal(await cua.close('owner'),true);
 });
 test('Windows source snapshots retain schema owner bytes under canonical keys',async()=>{
  let bytes=Buffer.from('schema one');const source=readFileSync('scripts/dev-build.mjs','utf8');
  const modules={'node:path':{...require('node:path'),...require('node:path').win32},'node:fs':{existsSync:path=>path==='C:\\fixture\\src'||path==='C:\\fixture\\src\\store.ts',lstatSync:path=>({isSymbolicLink:()=>false,isDirectory:()=>path==='C:\\fixture\\src',isFile:()=>path.endsWith('store.ts')}),readdirSync:()=>['store.ts'],readFileSync:()=>bytes,mkdirSync(){},writeFileSync(){},symlinkSync(){},rmSync(){}},'./trusted-build.mjs':{copyRuntimeDependencies(){},sealBuild(){},freezeToolchain(){}}};
  const entry=await link(source,modules,vm.createContext({Buffer}),'file:///fixture/scripts/dev-build.mjs');await entry.evaluate();const first=entry.namespace.sourceSnapshot('C:\\fixture');assert.ok(first.files.has('src/store.ts'));const schema=entry.namespace.schemaHash(first);bytes=Buffer.from('schema two');assert.notEqual(entry.namespace.schemaHash(entry.namespace.sourceSnapshot('C:\\fixture')),schema);
 });
 for(const mode of ['valid','reused','unknown','survivor'])test('Windows process ownership '+mode+' is proved without negative PID signals',async()=>{
  const calls=[],live=new Set([2111,2112]);let reads=0;
  const modules={'../scripts/windows-security.mjs':{windowsCommand:command=>command.includes('Select-Object ProcessId')?JSON.stringify([{ProcessId:0,ParentProcessId:0},{ProcessId:2111,ParentProcessId:1,Started:'123'},{ProcessId:2112,ParentProcessId:2111,Started:'124'}].filter(p=>p.ProcessId===0||live.has(p.ProcessId))):mode==='unknown'?'null':JSON.stringify([2111,mode==='reused'&&++reads>1?'999':'123','C:\\Homer\\codex.exe'])},'node:child_process':{execFileSync:(bin,args)=>{calls.push([bin,args]);live.delete(2111);if(mode!=='survivor')live.delete(2112);}}};
  const proc={platform:'win32',env:{SystemRoot:'C:\\Windows'},kill(pid,signal){assert.equal(signal,0);if(live.has(pid))return;throw Object.assign(Error('gone'),{code:'ESRCH'});}};
  const source=transpileModule(readFileSync('src/processes.ts','utf8'),{compilerOptions:{module:ModuleKind.ESNext,target:ScriptTarget.ES2023}}).outputText;
  const entry=await link(source,modules,vm.createContext({process:proc,console,setTimeout}),'file:///fixture/src/processes.js');await entry.evaluate();
  assert.equal(await entry.namespace.terminateLease({pid:2111,identity:JSON.stringify([2111,'123','C:\\Homer\\codex.exe'])}),mode==='valid');assert.equal(calls.length,['reused','unknown'].includes(mode)?0:1);
 });
 for(const mode of ['drained','survivor','root-exited','unknown'])test('Windows drain '+mode+' does not confuse root exit with a stopped tree',async()=>{
  const live=new Set(mode==='root-exited'?[2112]:[2111,2112]);let killed=0,drained=0;
  const modules={'../scripts/windows-security.mjs':{windowsCommand:command=>command.includes('Select-Object ProcessId')?JSON.stringify([{ProcessId:0,ParentProcessId:0},{ProcessId:2111,ParentProcessId:1,Started:'123'},{ProcessId:2112,ParentProcessId:2111,Started:'124'}].filter(p=>p.ProcessId===0||live.has(p.ProcessId))):mode==='unknown'||!live.has(2111)?'null':JSON.stringify([2111,'123','C:\\Homer\\codex.exe'])},'node:child_process':{execFileSync(){killed++;throw Error('no_live_root');}}};
  const proc={platform:'win32',env:{SystemRoot:'C:\\Windows'},kill(pid,signal){assert.equal(signal,0);if(live.has(pid))return;throw Object.assign(Error('gone'),{code:'ESRCH'});}};
  const source=transpileModule(readFileSync('src/processes.ts','utf8'),{compilerOptions:{module:ModuleKind.ESNext,target:ScriptTarget.ES2023}}).outputText;
  const entry=await link(source,modules,vm.createContext({process:proc,console,setTimeout}),'file:///fixture/src/processes.js');await entry.evaluate();
  const stopped=await entry.namespace.terminateLease({pid:2111,identity:JSON.stringify([2111,'123','C:\\Homer\\codex.exe'])},async()=>{drained++;live.delete(2111);if(mode==='drained')live.delete(2112);});
  assert.equal(stopped,mode==='drained');assert.equal(drained,1);assert.equal(killed,0);
 });
 for(const [mode,want] of [['new-child',false],['orphan-grandchild',false],['unknown-parent',false],['reused-external-parent',false],['missing-time',false],['snapshot-error',false],['first-snapshot-orphan',false],['same-time-orphan',false],['external-child',true],['external-chain',true],['old-external-orphan',true]])test('Windows post-drain proof '+mode,async()=>{
  const rows=new Map([[0,{ProcessId:0,ParentProcessId:0}],[1000,{ProcessId:1000,ParentProcessId:0,Started:'10'}],[2111,{ProcessId:2111,ParentProcessId:1000,Started:'123'}]]);let snapshots=0,kills=0;
  if(mode==='old-external-orphan')rows.set(5000,{ProcessId:5000,ParentProcessId:999,Started:'20'});
  if(mode==='same-time-orphan')rows.set(5000,{ProcessId:5000,ParentProcessId:999,Started:'123'});
  if(mode==='external-chain')rows.set(5000,{ProcessId:5000,ParentProcessId:1000,Started:'125'});
  const modules={'../scripts/windows-security.mjs':{windowsCommand:command=>{if(command.includes('Select-Object ProcessId')){if(++snapshots>1&&mode==='snapshot-error')throw Error('snapshot_unavailable');if(snapshots===1&&mode==='first-snapshot-orphan')rows.set(2113,{ProcessId:2113,ParentProcessId:2112,Started:'126'});return JSON.stringify([...rows.values()]);}return JSON.stringify([2111,'123','C:\\Homer\\codex.exe']);}},'node:child_process':{execFileSync(){kills++;throw Error('do_not_kill_an_exited_root');}}};
  const proc={platform:'win32',env:{SystemRoot:'C:\\Windows'},kill(pid,signal){assert.equal(signal,0);if(rows.has(pid))return;throw Object.assign(Error('gone'),{code:'ESRCH'});}};
  const source=transpileModule(readFileSync('src/processes.ts','utf8'),{compilerOptions:{module:ModuleKind.ESNext,target:ScriptTarget.ES2023}}).outputText;
  const entry=await link(source,modules,vm.createContext({process:proc,console,setTimeout}),'file:///fixture/src/processes.js');await entry.evaluate();
  const stopped=await entry.namespace.terminateLease({pid:2111,identity:JSON.stringify([2111,'123','C:\\Homer\\codex.exe'])},async()=>{
   rows.delete(2111);
   if(mode==='new-child')rows.set(2112,{ProcessId:2112,ParentProcessId:2111,Started:'125'});
   if(mode==='orphan-grandchild')rows.set(2113,{ProcessId:2113,ParentProcessId:2112,Started:'126'});
   if(mode==='unknown-parent')rows.set(5000,{ProcessId:5000,ParentProcessId:9999,Started:'125'});
   if(mode==='reused-external-parent')rows.set(1000,{ProcessId:1000,ParentProcessId:2112,Started:'125'});
   if(mode==='missing-time')rows.set(5000,{ProcessId:5000,ParentProcessId:1000});
   if(mode==='external-child')rows.set(5000,{ProcessId:5000,ParentProcessId:1000,Started:'125'});
   if(mode==='external-chain')rows.set(5001,{ProcessId:5001,ParentProcessId:5000,Started:'126'});
  });
  assert.equal(stopped,want);assert.equal(kills,0);
 });
 test('Windows ACL validation uses a fixed system executable and fails closed',async()=>{
  let output='private',commands=[];const source=readFileSync('scripts/windows-security.mjs','utf8');const modules={'node:child_process':{execFile(){throw Error('unexpected_async_call');},execFileSync:(bin,args,options)=>{commands.push({bin,args,options});return output;}}};
  const entry=await link(source,modules,vm.createContext({process:{env:{SystemRoot:'C:\\Windows'}}}),'file:///fixture/scripts/windows-security.mjs');await entry.evaluate();
  entry.namespace.assertWindowsPrivate("C:\\private\\a'b.json");assert.equal(commands[0].bin,'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');assert.equal(commands[0].args.some(arg=>arg.includes("a'b.json")),false);assert.equal(commands[0].options.env.HOMER_PRIVATE_PATH,"C:\\private\\a'b.json");assert.equal(commands[0].options.env.PATH,undefined);assert.ok(commands[0].args.at(-1).includes('[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)'));
  output='';assert.throws(()=>entry.namespace.assertWindowsPrivate('C:\\private'),/windows_private_acl_required/);
 });
 for(const arch of ['arm64','x64'])test(arch+' runtime releases outer owner before update-stopped and exits without source builds',async()=>{
  const f=await runtimeFixture({updateStopped:true,stoppedConfirmed:true},{arch});f.proc.stdin.write('{"kind":"update-stop"}\n');await tick();assert.equal(f.stopCalls,1);assert.deepEqual(f.events,[]);await f.complete();assert.deepEqual(f.events.map(v=>v.kind),['owner-release','update-stopped']);assert.equal(f.proc.exitCode,undefined);
 });
 for(const [name,result,options]of [['ordinary',{stoppedConfirmed:true},{}],['unconfirmed',{stoppedConfirmed:false},{}],['release-failed',{stoppedConfirmed:true,updateStopped:true},{releaseError:true}],['wrong-architecture',{stoppedConfirmed:true,updateStopped:true},{manifestArch:'x64'}]])test('runtime '+name+' never claims a successful update stop',async()=>{
  const f=await runtimeFixture(result,options);await f.complete();assert.equal(f.events.some(v=>v.kind==='update-stopped'),false);if(name==='ordinary')assert.deepEqual(f.events.map(v=>v.kind),['owner-release','stopped']);else assert.equal(f.proc.exitCode,1);
 });
 test('Windows runtime validates its own helpers and releases owner before update acknowledgement',async()=>{const f=await runtimeFixture({updateStopped:true,stoppedConfirmed:true},{platform:'win32',arch:'x64'});await f.complete();assert.deepEqual(f.events.map(v=>v.kind),['owner-release','update-stopped']);assert.equal(f.proc.exitCode,undefined);assert.equal(f.proc.env.HOME,'/fixture/profile/host-home');assert.ok(f.proc.env.SystemRoot);assert.equal(f.proc.env.LOCALAPPDATA,'C:\\RedirectedLocal');});
 for(const arch of ['arm64','x64'])test(arch+' dependencies select pinned matching archives without network or executable invocation',async()=>{
  const f=await dependencyFixture(arch),result=f.prepare();assert.equal(result.vendor,arch==='arm64'?'aarch64-apple-darwin':'x86_64-apple-darwin');assert.equal(result.components.find(component=>component.version===`0.163.0-darwin-${arch}`)?.completePlatformArchive,true);
  assert.ok(f.commands.some(([_bin,args])=>args.includes(`/archives/codex-0.163.0-darwin-${arch}.tgz`)));
  assert.ok(f.commands.some(([_bin,args])=>args.includes(`node-v22.22.0-darwin-${arch}/bin/node`)));
  const bad=await dependencyFixture(arch,true);assert.throws(bad.prepare,/desktop_codex_integrity_failed/);assert.equal(bad.commands.length,0,'all bytes must pass pins before extraction');
 });
 test('Cua Driver selects only the pinned native files for macOS ARM64 and Windows x64',async()=>{
  const arm=await dependencyFixture('arm64'),prepared=arm.prepare();
  assert.equal(prepared.cua,'/scratch/official-cua');
  assert.ok(arm.commands.some(([,args])=>args.includes('/archives/driver.tar.gz')&&args.includes('cua-driver')));
  assert.ok(arm.commands.some(([,args])=>args.includes('/scratch/official-cua/node_modules/@trycua/cua-driver')));
  const intel=await dependencyFixture('x64','sdk');
  assert.equal(intel.prepare().cua,undefined);
  assert.ok(intel.commands.every(([,args])=>args.every(arg=>!arg.includes('cua-driver'))));
  const win=await dependencyFixture('x64',false,'win32');
  assert.equal(win.prepare().cua,'/scratch/official-cua');
  assert.ok(win.commands.some(([,args])=>args.includes('/archives/driver.zip')&&args.includes('cua-driver.exe')));
  assert.ok(win.commands.some(([,args])=>args.includes('/scratch/official-cua/node_modules/@trycua/cua-driver-win32-x64-msvc')));
  assert.ok(win.commands.every(([,args])=>args.every(arg=>!arg.includes('cua-driver-darwin'))));
  for(const corrupt of ['driver','sdk','notice']){
   const f=await dependencyFixture('arm64',corrupt);
   assert.throws(f.prepare,/desktop_cua_integrity_failed/);
   assert.equal(f.commands.length,0);
  }
  for(const corrupt of ['driver','native-sdk']){
   const f=await dependencyFixture('x64',corrupt,'win32');
   assert.throws(f.prepare,/desktop_cua_integrity_failed/);
   assert.equal(f.commands.length,0);
  }
 });
 test('Windows selects pinned ZIP Node and the full x64 Codex archive offline',async()=>{const f=await dependencyFixture('x64',false,'win32'),result=f.prepare();assert.equal(result.vendor,'x86_64-pc-windows-msvc');assert.ok(f.commands.some(([_bin,args])=>args.includes('/archives/node-v22.22.0-win-x64.zip')));assert.ok(f.commands.some(([_bin,args])=>args.includes('node-v22.22.0-win-x64/node.exe')));const bad=await dependencyFixture('x64',true,'win32');assert.throws(bad.prepare,/desktop_codex_integrity_failed/);assert.equal(bad.commands.length,0);});
 test('a tampered bundled Codex license fails before extraction',async()=>{const f=await dependencyFixture('arm64','LICENSE');assert.throws(f.prepare,/desktop_codex_license_integrity_failed: LICENSE/);assert.equal(f.commands.length,0);});
 test('unknown dependency architecture is refused before downloads',async()=>{
  const f=await dependencyFixture('riscv64');assert.throws(f.prepare,/desktop_dependency_target_invalid/);assert.equal(f.commands.length,0);
 });

 test('build entry resolves native Mac architecture and requires explicit Intel minimum and immutable release tag, without building',async()=>{
  async function config(arch,args=[],platform='darwin'){
   const context=vm.createContext({process:{arch,platform,version:'v22.22.0',argv:['node','build-desktop',...args],env:{HOMER_MAC_SIGNING_IDENTITY:'a'.repeat(40),HOMER_NOTARY_KEYCHAIN_PROFILE:'synthetic',HOMER_WINDOWS_CERT_SHA1:'a'.repeat(40),HOMER_WINDOWS_PUBLISHER:'CN=Homer, O=Homer'}}});
   const noBuild=()=>{throw Error('unexpected_build_or_download');};
   const modules={
    'node:fs':{readFileSync:noBuild,writeFileSync:noBuild,readdirSync:noBuild,mkdirSync(){},cpSync:noBuild,lstatSync:noBuild,symlinkSync:noBuild,statSync:noBuild,realpathSync:path=>path},
    'node:child_process':{execFileSync:noBuild},'./prepare-desktop-dependencies.mjs':{prepareDependencies:noBuild},'./desktop-source.mjs':{prepareDesktopSource:()=>{throw Error('fixture_source_boundary');}},
   };
   const entry=await link(readFileSync('scripts/build-desktop.mjs','utf8')+'\nexport {arch,minimumMacOS,distribution};',modules,context,'file:///fixture/scripts/build-desktop.mjs');
   let error;try{await entry.evaluate();}catch(e){error=e.message;}
   return {entry,error};
  }
  const origins=['--website-origin','https://website.example.invalid','--gateway-origin','https://models.example.invalid','--maintenance','/fixture/tools'];
  const arm=await config('arm64',origins);assert.equal(arm.error,'fixture_source_boundary');assert.equal(arm.entry.namespace.minimumMacOS,'27.0');
  assert.equal((await config('x64',origins)).error,'desktop_explicit_minimum_macos_required');
  assert.equal((await config('x64',[...origins,'--minimum-macos','14.0','--distribution'])).error,'desktop_distribution_inputs_required');
  for(const number of [undefined,'0','-1','1.5','9007199254740992']){const args=[...origins,'--distribution','--release-tag','v0.2.0',...(number===undefined?[]:['--build-number',number])];assert.equal((await config('arm64',args)).error,'desktop_distribution_build_number_required');}
  const intel=await config('x64',[...origins,'--minimum-macos','14.0','--distribution','--release-tag','v0.2.0','--build-number','269']);assert.equal(intel.error,'fixture_source_boundary');assert.equal(intel.entry.namespace.arch,'x64');assert.equal(intel.entry.namespace.minimumMacOS,'14.0');assert.equal(intel.entry.namespace.distribution.releaseTag,'v0.2.0');assert.equal(intel.entry.namespace.distribution.build,269);
  assert.equal((await config('x64',origins,'win32')).error,'fixture_source_boundary');
  assert.equal((await config('arm64',[...origins,'--build-number','269'])).error,'desktop_candidate_build_number_not_allowed');
  const windows=await config('x64',[...origins,'--distribution','--release-tag','v0.2.0','--build-number','269'],'win32');assert.equal(windows.error,'fixture_source_boundary');assert.equal(windows.entry.namespace.distribution.build,269);
  const unsigned=await config('x64',[...origins,'--distribution','--release-tag','v0.2.0','--build-number','269','--unsigned-windows'],'win32');assert.equal(unsigned.error,'fixture_source_boundary');assert.equal(unsigned.entry.namespace.distribution.unsignedWindows,true);
  assert.equal((await config('arm64',[...origins,'--distribution','--release-tag','v0.2.0','--build-number','269','--unsigned-windows'])).error,'desktop_unsigned_windows_invalid');
 });

}
