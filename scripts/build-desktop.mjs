// Prepare the existing backend, then let Forge own the app and ZIP lifecycle.
import {readFileSync,writeFileSync,readdirSync,mkdirSync,cpSync,lstatSync,symlinkSync,statSync,realpathSync} from 'node:fs';
import {resolve,join,dirname,relative} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {prepareDependencies} from './prepare-desktop-dependencies.mjs';
import {prepareDesktopSource} from './desktop-source.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
if(process.version!=='v22.22.0'||!(process.platform==='darwin'&&['arm64','x64'].includes(process.arch)||process.platform==='win32'&&process.arch==='x64'))throw Error('desktop_build_runtime_required');
const option=name=>{const at=process.argv.indexOf(name);if(at<0)return;if(!process.argv[at+1]||process.argv[at+1].startsWith('--'))throw Error('desktop_build_option_missing');return process.argv[at+1];};
const websiteOrigin=option('--website-origin'),gatewayOrigin=option('--gateway-origin');
const windows=process.platform==='win32',git=windows?'git.exe':'/usr/bin/git';
const arch=process.arch,minimumMacOS=option('--minimum-macos')??(arch==='arm64'?'27.0':undefined);
if(!windows&&!/^\d+\.\d+$/.test(minimumMacOS??''))throw Error('desktop_explicit_minimum_macos_required');
if(!websiteOrigin||!gatewayOrigin)throw Error('desktop_account_origins_required');
const unsignedWindows=process.argv.includes('--unsigned-windows');
const distribution=process.argv.includes('--distribution')?{identity:windows?process.env.HOMER_WINDOWS_CERT_SHA1:process.env.HOMER_MAC_SIGNING_IDENTITY,publisher:windows?process.env.HOMER_WINDOWS_PUBLISHER:undefined,keychainProfile:process.env.HOMER_NOTARY_KEYCHAIN_PROFILE,releaseTag:option('--release-tag'),...(unsignedWindows?{unsignedWindows:true}:{})}:undefined;
if(unsignedWindows&&(!windows||!distribution))throw Error('desktop_unsigned_windows_invalid');
if(distribution&&(!unsignedWindows&&(!/^[0-9A-Fa-f]{40}$/.test(distribution.identity??'')||(!windows&&!distribution.keychainProfile)||(windows&&!/^CN=.+,/.test(distribution.publisher??'')))||!/^v?[0-9][A-Za-z0-9._-]*$/.test(distribution.releaseTag??'')||process.argv.includes('--prepare-candidate')||process.argv.includes('--local-working-tree')))throw Error('desktop_distribution_inputs_required');
const requestedBuild=option('--build-number');
if(distribution&&(!/^[1-9][0-9]*$/.test(requestedBuild??'')||!Number.isSafeInteger(Number(requestedBuild))))throw Error('desktop_distribution_build_number_required');
if(!distribution&&requestedBuild!==undefined)throw Error('desktop_candidate_build_number_not_allowed');
if(distribution)distribution.build=Number(requestedBuild);
const sourceSha=option('--source-sha'),scratch=resolve(option('--scratch')??join(root,'.codex/scratch/electron-desktop')),maintenance=option('--maintenance');
if(!maintenance)throw Error('desktop_explicit_maintenance_required');
if(!scratch.startsWith(join(root,'.codex/scratch/')))throw Error('desktop_build_scratch_required');
mkdirSync(scratch,{recursive:true});
if(realpathSync(scratch)!==scratch)throw Error('desktop_source_symlink_denied');
const stage=join(scratch,'compiled-product'),payload=join(scratch,'payload'),shell=join(scratch,'shell');
const provenance=prepareDesktopSource({root,sourceSha,stage,prepareCandidate:process.argv.includes('--prepare-candidate'),localWorkingTree:process.argv.includes('--local-working-tree')});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),digest=value=>hash(JSON.stringify(value));
const modules=realpathSync(join(resolve(maintenance),'node_modules'));
const lock=JSON.parse(readFileSync(join(stage,'package-lock.json')));
for(const name of ['typescript','vite','electron','@electron-forge/core','@electron-forge/maker-zip',...(windows?['electron-updater','electron-builder','js-yaml','sharp']:[])]){
 const version=JSON.parse(readFileSync(join(modules,name,'package.json'))).version;
 if(version!==lock.packages?.['node_modules/'+name]?.version)throw Error('desktop_toolchain_lock_mismatch:'+name);
}
symlinkSync(modules,join(stage,'node_modules'),windows?'junction':'dir');
const sources=[];
function visit(directory,prefix,accept){for(const name of readdirSync(directory).sort()){
 if(['.DS_Store','node_modules'].includes(name))continue;
 const path=join(directory,name),rel=join(prefix,name),stat=lstatSync(path);
 if(stat.isSymbolicLink())throw Error('desktop_source_symlink_denied');
 if(stat.isDirectory())visit(path,rel,accept);else if(stat.isFile())accept(path,rel);
}}
visit(stage,'',(path,rel)=>sources.push({path:rel,sha256:hash(readFileSync(path))}));
const run=(bin,args,cwd=stage)=>execFileSync(bin,args,{cwd,stdio:'inherit',env:{...(windows?{SystemRoot:process.env.SystemRoot,TEMP:join(scratch,'build-tmp'),TMP:join(scratch,'build-tmp')}:{ }),PATH:dirname(process.execPath)+(windows?';'+join(process.env.SystemRoot,'System32')+ ';'+process.env.PATH:':/usr/bin:/bin'),HOME:join(scratch,'build-home'),TMPDIR:join(scratch,'build-tmp'),LANG:'en_US.UTF-8'},timeout:180000});
for(const directory of ['build-home','build-tmp','payload','shell'])mkdirSync(join(scratch,directory),{recursive:true});
run(process.execPath,[join(modules,'typescript/bin/tsc'),'-p',join(stage,'tsconfig.json')]);
run(process.execPath,[join(modules,'typescript/bin/tsc'),'--noEmit','-p',join(stage,'ui/tsconfig.json')]);
cpSync(join(stage,'src/media-documents.py'),join(stage,'dist/media-documents.py'));
run(process.execPath,[join(stage,'scripts/build-preview-annotation.mjs')]);
const uiHash=digest(sources.filter(x=>x.path.replaceAll('\\','/').startsWith('ui/')||x.path.replaceAll('\\','/').startsWith('assets/branding/')));
run(process.execPath,[join(modules,'vite/bin/vite.js'),'build','--configLoader','runner','--base',`/ui/${uiHash}/`,'--config',join(stage,'ui/vite.config.ts')],join(stage,'ui'));
run(process.execPath,[join(modules,'vite/bin/vite.js'),'build','--config',join(stage,'ui/capture-panel-vite.config.mjs')],join(stage,'ui'));
const dependencies=prepareDependencies(scratch,option('--archive-source')?{archiveSource:resolve(option('--archive-source'))}:undefined);
const homer=join(payload,'homer');
for(const part of ['dist','prompts','assets','package.json','package-lock.json','.codex/skills'])cpSync(join(stage,part),join(homer,part),{recursive:true,filter:path=>path!==join(stage,'dist/update-review-page.js')});
for(const name of ['dev.mjs','trusted-build.mjs','pinned-build.mjs','dev-ingress.mjs','desktop-runtime.mjs','desktop-profile.mjs','windows-security.mjs']){mkdirSync(join(homer,'scripts'),{recursive:true});cpSync(join(stage,'scripts',name),join(homer,'scripts',name));}
const {dependencyIdentity,pinnedInventory}=await import(pathToFileURL(join(stage,'scripts/pinned-build.mjs')).href);
let dependencyRoot=stage;
if(windows){dependencyRoot=join(scratch,'windows-dependencies');mkdirSync(dependencyRoot);const product=JSON.parse(readFileSync(join(stage,'package.json')));product.dependencies.sharp=product.devDependencies.sharp;writeFileSync(join(dependencyRoot,'package.json'),JSON.stringify(product));cpSync(join(stage,'package-lock.json'),join(dependencyRoot,'package-lock.json'));symlinkSync(modules,join(dependencyRoot,'node_modules'),'junction');cpSync(join(dependencyRoot,'package.json'),join(homer,'package.json'));}
const identity=dependencyIdentity(dependencyRoot),notices=[];
if(windows&&!identity.packages.some(pkg=>pkg.name==='@img/sharp-win32-x64'&&pkg.version==='0.35.5'))throw Error('desktop_windows_image_dependency_missing');
for(const pkg of identity.packages){
 const rel=relative(modules,pkg.path);if(rel.startsWith('..'))throw Error('desktop_external_dependency');
 cpSync(pkg.path,join(homer,'node_modules',rel),{recursive:true,dereference:false,filter:path=>path===pkg.path||!relative(pkg.path,path).split(/[\\/]/).includes('node_modules')});
 notices.push({name:pkg.name,version:pkg.version,license:JSON.parse(readFileSync(join(pkg.path,'package.json'))).license,contentsHash:pkg.filesHash,path:rel});
}
cpSync(join(dependencies.node,windows?'node.exe':'bin/node'),join(payload,windows?'node.exe':'node'));
if(distribution&&!windows)execFileSync('/usr/bin/codesign',['--force','--sign',distribution.identity,'--timestamp=http://timestamp.apple.com/ts01','--options','runtime','--entitlements',join(stage,'packaging/electron/node-entitlements.plist'),join(payload,'node')],{stdio:'inherit'});
mkdirSync(join(payload,'runtime'),{recursive:true});mkdirSync(join(payload,'licenses'),{recursive:true});
cpSync(dependencies.codex,join(payload,'runtime/codex'),{recursive:true});cpSync(dependencies.cli,join(payload,'runtime/codex-cli'),{recursive:true});
if(dependencies.cua){
 if(!windows)execFileSync('/usr/bin/codesign',['--verify','--strict',join(dependencies.cua,'cua-driver')],{stdio:'inherit'});
 cpSync(dependencies.cua,join(payload,'runtime/cua'),{recursive:true});
 if(windows){
  const framework=join(process.env.SystemRoot,'Microsoft.NET/Framework64/v4.0.30319');
  run(join(framework,'csc.exe'),['/nologo','/target:winexe','/platform:x64','/optimize+',
   ...['System.Web.Extensions.dll','WPF/WindowsBase.dll','WPF/UIAutomationClient.dll','WPF/UIAutomationTypes.dll'].map(file=>'/reference:'+join(framework,file)),
   '/out:'+join(payload,'runtime/cua/homer-cua-windows.exe'),join(stage,'packaging/windows/CuaWindows.cs')]);
 }else run('/usr/bin/xcrun',['swiftc','-O','-target','arm64-apple-macos'+minimumMacOS,'-module-cache-path',join(scratch,'native-build/module-cache'),join(stage,'packaging/macos/ChromeViewport.swift'),'-o',join(payload,'runtime/cua/chrome-viewport')]);
}
for(const [source,name]of [[join(dependencies.node,'LICENSE'),'Node-LICENSE'],[join(scratch,'codex-LICENSE'),'Codex-LICENSE'],[join(scratch,'codex-NOTICE'),'Codex-NOTICE']])cpSync(source,join(payload,'licenses',name));
cpSync(join(modules,'electron/LICENSE'),join(payload,'licenses/Electron-LICENSE'));
cpSync(join(modules,'electron/dist/LICENSES.chromium.html'),join(payload,'licenses/Chromium-LICENSES.html'));
if(windows){
 cpSync(join(stage,'packaging/windows/image-decoder.mjs'),join(payload,'homer-image-decoder.mjs'));
}else{
 for(const [name,source] of [['homer-image-decoder','ImageDecoder.swift'],['homer-window-capture','WindowCapture.swift']]){
  const executable=join(payload,name);
  run('/usr/bin/xcrun',['swiftc','-O',...(name==='homer-window-capture'?['-parse-as-library']:[]),'-target',`${arch==='arm64'?'arm64':'x86_64'}-apple-macos${minimumMacOS}`,'-module-cache-path',join(scratch,'native-build/module-cache'),join(stage,'packaging/macos',source),'-o',executable]);
  execFileSync('/usr/bin/codesign',['--force','--sign',distribution?.identity??'-',...(distribution?['--timestamp=http://timestamp.apple.com/ts01','--options','runtime']:[]),executable],{stdio:'inherit'});
 }
}
const vendor=join(payload,'runtime/codex/vendor',dependencies.vendor),voice=JSON.parse(readFileSync(join(vendor,'codex-resources/voice/manifest.json')));
for(const [path,sha]of Object.entries(voice.sha256))if(hash(readFileSync(join(vendor,path)))!==sha)throw Error('desktop_codex_original_manifest_changed');
const files=pinnedInventory(homer),sourceHash=digest({sources,provenance}),manifest=digest(files);
writeFileSync(join(homer,'build-manifest.json'),JSON.stringify({sourceHash,manifest,files})+'\n');
const {schemaHash,sourceSnapshot}=await import(pathToFileURL(join(stage,'scripts/dev-build.mjs')).href);
const {MAIN_TOOLS_HASH}=await import(pathToFileURL(join(homer,'dist/recursive-tools.js')).href);
const product=JSON.parse(readFileSync(join(stage,'package.json'))),electron=product.devDependencies.electron;
const build=distribution?.build??Number(execFileSync(git,['rev-list','--count',sourceSha],{cwd:root,encoding:'utf8'}));
const {validateHomerOrigins}=await import(pathToFileURL(join(homer,'dist/homer-account.js')).href);
const account=validateHomerOrigins({websiteOrigin,gatewayOrigin},provenance.preparation);
const metadata={account,arch,minimumMacOS,...(windows?{platform:'win32'}:{}),...(distribution?{appId:'app.homer.desktop',releaseChannel:'stable'}:{}),...(provenance.localWorkingTree?{localWorkingTree:true}:{}),format:2,version:product.version,build,gitSha:sourceSha,preparation:provenance.preparation,publishable:provenance.publishable,sourceHash,manifest,uiHash,schema:schemaHash(sourceSnapshot(stage)),toolsHash:MAIN_TOOLS_HASH,node:'22.22.0',codex:'0.163.0',electron};
cpSync(join(stage,'packaging/electron/main.mjs'),join(shell,'main.mjs'));
cpSync(join(stage,'packaging/electron/preload.cjs'),join(shell,'preload.cjs'));
cpSync(join(stage,'packaging/electron/capture-panel-preload.cjs'),join(shell,'capture-panel-preload.cjs'));
writeFileSync(join(shell,'package.json'),JSON.stringify({...(windows?{dependencies:{'electron-updater':product.devDependencies['electron-updater'],'js-yaml':product.devDependencies['js-yaml']}}:{}),name:'homer-desktop',author:'Homer',version:product.version,private:true,type:'module',main:'main.mjs',devDependencies:{electron}})+'\n');
const {createDesktopIcon}=await import(pathToFileURL(join(stage,'scripts/desktop-icon.mjs')).href);
const icon=windows?undefined:createDesktopIcon({source:join(stage,'assets/branding/odysseus-20261030/homer-odysseus-1024.png'),directory:join(scratch,'icons'),run});
const {default:config,windowsInstallerConfig,windowsRelease,assertWindowsPayload}=await import(pathToFileURL(join(stage,'packaging/electron/forge.config.mjs')).href);
const {api,utils}=await import(pathToFileURL(join(modules,'@electron-forge/core/dist/api/index.js')).href);
utils.registerForgeConfigForDirectory(shell,config({payload,metadata,icon,distribution}));
if(windows){
 // Carry runtime dependencies into the generated shell before ASAR sealing.
 const shellInputs=join(scratch,'shell-dependencies');mkdirSync(shellInputs);writeFileSync(join(shellInputs,'package.json'),readFileSync(join(shell,'package.json')));cpSync(join(stage,'package-lock.json'),join(shellInputs,'package-lock.json'));symlinkSync(modules,join(shellInputs,'node_modules'),windows?'junction':'dir');
 for(const pkg of dependencyIdentity(shellInputs).packages){const rel=relative(modules,pkg.path);notices.push({name:pkg.name,version:pkg.version,license:JSON.parse(readFileSync(join(pkg.path,'package.json'))).license,contentsHash:pkg.filesHash,path:'app.asar/node_modules/'+rel});cpSync(pkg.path,join(shell,'node_modules',rel),{recursive:true,dereference:false,filter:path=>path===pkg.path||!relative(pkg.path,path).split(/[\\/]/).includes('node_modules')});}
 if(distribution)writeFileSync(join(payload,'app-update.yml'),JSON.stringify({provider:'generic',url:'https://github.com/wolf3c/homer/releases/latest/download/',channel:'latest',...(unsignedWindows?{verifyUpdateCodeSignature:false}:{publisherName:[distribution.publisher]})})+'\n');
}
writeFileSync(join(payload,'licenses/Homer-runtime-notices.json'),JSON.stringify({dependencies:notices,official:dependencies.components},null,2)+'\n');
let result;
try{result=windows?await api.package({dir:shell,outDir:join(scratch,'forge'),platform:'win32',arch}):await api.make({dir:shell,outDir:join(scratch,'forge'),platform:'darwin',arch});}
finally{utils.unregisterForgeConfigForDirectory(shell);}
let artifacts=windows?[]:result.flatMap(item=>item.artifacts);const bundle=windows?join(scratch,'forge/Homer-win32-x64'):join(scratch,`forge/Homer-darwin-${arch}/Homer.app`);
if(windows){
 const {build}=await import(pathToFileURL(join(modules,'electron-builder/out/index.js')).href);
 const output=join(scratch,'nsis');artifacts=await build({prepackaged:bundle,publish:'never',config:{...windowsInstallerConfig({metadata,distribution}),directories:{output,app:shell}}});
 assertWindowsPayload(bundle);
 if(distribution){const {load,dump}=(await import(pathToFileURL(join(modules,'js-yaml/index.js')).href)).default;const feed=join(output,'latest.yml'),native=load(readFileSync(feed,'utf8')),installer=artifacts.find(path=>path.endsWith('.exe'));writeFileSync(feed,dump(windowsRelease(native,installer,metadata,distribution.releaseTag)));artifacts.push(feed);}
}
if(JSON.stringify(JSON.parse(readFileSync(join(bundle,windows?'resources/desktop-manifest.json':'Contents/Resources/desktop-manifest.json'),'utf8')).account)!==JSON.stringify(account))throw Error('desktop_account_manifest_mismatch');
const receipt={...metadata,provenance,bundle,signature:distribution?(windows?(unsignedWindows?'unsigned Windows; native acceptance unverified':'Authenticode NSIS; native acceptance unverified'):'Developer ID; notarized and stapled'):'ad-hoc local candidate; not Developer ID or notarized',artifacts:artifacts.map(path=>({path,bytes:statSync(path).size,sha256:hash(readFileSync(path))})),runtimePackages:identity.packages.length};
writeFileSync(join(scratch,'desktop-build-result.json'),JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify(receipt,null,2));
