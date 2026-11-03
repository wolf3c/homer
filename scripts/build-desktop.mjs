// Prepare the existing backend, then let Forge own the app and ZIP lifecycle.
import {readFileSync,writeFileSync,readdirSync,mkdirSync,cpSync,lstatSync,symlinkSync,statSync,realpathSync} from 'node:fs';
import {resolve,join,dirname,relative} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {prepareDependencies} from './prepare-desktop-dependencies.mjs';
import {prepareDesktopSource} from './desktop-source.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
if(process.version!=='v22.22.0'||process.platform!=='darwin'||process.arch!=='arm64')throw Error('desktop_build_runtime_required');
const option=name=>{const at=process.argv.indexOf(name);if(at<0)return;if(!process.argv[at+1]||process.argv[at+1].startsWith('--'))throw Error('desktop_build_option_missing');return process.argv[at+1];};
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
for(const name of ['typescript','vite','electron','@electron-forge/core','@electron-forge/maker-zip']){
 const version=JSON.parse(readFileSync(join(modules,name,'package.json'))).version;
 if(version!==lock.packages?.['node_modules/'+name]?.version)throw Error('desktop_toolchain_lock_mismatch:'+name);
}
symlinkSync(modules,join(stage,'node_modules'),'dir');
const sources=[];
function visit(directory,prefix,accept){for(const name of readdirSync(directory).sort()){
 if(['.DS_Store','node_modules'].includes(name))continue;
 const path=join(directory,name),rel=join(prefix,name),stat=lstatSync(path);
 if(stat.isSymbolicLink())throw Error('desktop_source_symlink_denied');
 if(stat.isDirectory())visit(path,rel,accept);else if(stat.isFile())accept(path,rel);
}}
visit(stage,'',(path,rel)=>sources.push({path:rel,sha256:hash(readFileSync(path))}));
const run=(bin,args,cwd=stage)=>execFileSync(bin,args,{cwd,stdio:'inherit',env:{PATH:dirname(process.execPath)+':/usr/bin:/bin',HOME:join(scratch,'build-home'),TMPDIR:join(scratch,'build-tmp'),LANG:'en_US.UTF-8'},timeout:180000});
for(const directory of ['build-home','build-tmp','payload','shell'])mkdirSync(join(scratch,directory),{recursive:true});
run(process.execPath,[join(modules,'typescript/bin/tsc'),'-p',join(stage,'tsconfig.json')]);
run(process.execPath,[join(modules,'typescript/bin/tsc'),'--noEmit','-p',join(stage,'ui/tsconfig.json')]);
cpSync(join(stage,'src/media-documents.py'),join(stage,'dist/media-documents.py'));
run(process.execPath,[join(stage,'scripts/build-preview-annotation.mjs')]);
const uiHash=digest(sources.filter(x=>x.path.startsWith('ui/')||x.path.startsWith('assets/branding/')));
run(process.execPath,[join(modules,'vite/bin/vite.js'),'build','--configLoader','runner','--base',`/ui/${uiHash}/`,'--config',join(stage,'ui/vite.config.ts')],join(stage,'ui'));
const dependencies=prepareDependencies(scratch,option('--archive-source')?{archiveSource:resolve(option('--archive-source'))}:undefined);
const homer=join(payload,'homer');
for(const part of ['dist','prompts','assets','package.json','package-lock.json','.codex/skills'])cpSync(join(stage,part),join(homer,part),{recursive:true});
for(const name of ['dev.mjs','dev-build.mjs','trusted-build.mjs','pinned-build.mjs','dev-ingress.mjs','desktop-runtime.mjs','desktop-profile.mjs','desktop-deepseek.mjs']){mkdirSync(join(homer,'scripts'),{recursive:true});cpSync(join(stage,'scripts',name),join(homer,'scripts',name));}
const {dependencyIdentity,pinnedInventory}=await import(pathToFileURL(join(stage,'scripts/pinned-build.mjs')).href);
const identity=dependencyIdentity(stage),notices=[];
for(const pkg of identity.packages){
 const rel=relative(modules,pkg.path);if(rel.startsWith('..'))throw Error('desktop_external_dependency');
 cpSync(pkg.path,join(homer,'node_modules',rel),{recursive:true,dereference:false,filter:path=>path===pkg.path||!relative(pkg.path,path).split('/').includes('node_modules')});
 notices.push({name:pkg.name,version:pkg.version,license:JSON.parse(readFileSync(join(pkg.path,'package.json'))).license,contentsHash:pkg.filesHash,path:rel});
}
cpSync(join(dependencies.node,'bin/node'),join(payload,'node'));
mkdirSync(join(payload,'runtime'),{recursive:true});mkdirSync(join(payload,'licenses'),{recursive:true});
cpSync(dependencies.codex,join(payload,'runtime/codex'),{recursive:true});cpSync(dependencies.cli,join(payload,'runtime/codex-cli'),{recursive:true});
for(const [source,name]of [[join(dependencies.node,'LICENSE'),'Node-LICENSE'],[join(scratch,'codex-LICENSE'),'Codex-LICENSE'],[join(scratch,'codex-NOTICE'),'Codex-NOTICE']])cpSync(source,join(payload,'licenses',name));
cpSync(join(modules,'electron/LICENSE'),join(payload,'licenses/Electron-LICENSE'));
cpSync(join(modules,'electron/dist/LICENSES.chromium.html'),join(payload,'licenses/Chromium-LICENSES.html'));
writeFileSync(join(payload,'licenses/Homer-runtime-notices.json'),JSON.stringify({dependencies:notices,official:dependencies.components},null,2)+'\n');
run('/usr/bin/xcrun',['swiftc','-O','-target','arm64-apple-macos27.0','-module-cache-path',join(scratch,'native-build/module-cache'),join(stage,'packaging/macos/ImageDecoder.swift'),'-o',join(payload,'homer-image-decoder')]);
run('/usr/bin/codesign',['--force','--sign','-',join(payload,'homer-image-decoder')]);
const vendor=join(payload,'runtime/codex/vendor/aarch64-apple-darwin'),voice=JSON.parse(readFileSync(join(vendor,'codex-resources/voice/manifest.json')));
for(const [path,sha]of Object.entries(voice.sha256))if(hash(readFileSync(join(vendor,path)))!==sha)throw Error('desktop_codex_original_manifest_changed');
const files=pinnedInventory(homer),sourceHash=digest({sources,provenance}),manifest=digest(files);
writeFileSync(join(homer,'build-manifest.json'),JSON.stringify({sourceHash,manifest,files})+'\n');
const {schemaHash,sourceSnapshot}=await import(pathToFileURL(join(stage,'scripts/dev-build.mjs')).href);
const {MAIN_TOOLS}=await import(pathToFileURL(join(homer,'dist/tools.js')).href);
const product=JSON.parse(readFileSync(join(stage,'package.json'))),electron=product.devDependencies.electron;
const build=Number(execFileSync('/usr/bin/git',['rev-list','--count',sourceSha],{cwd:root,encoding:'utf8'}));
const {validateHomerOrigins}=await import(pathToFileURL(join(homer,'dist/homer-account.js')).href);
const websiteOrigin=option('--website-origin'),gatewayOrigin=option('--gateway-origin');
const account=websiteOrigin||gatewayOrigin?validateHomerOrigins({websiteOrigin,gatewayOrigin},provenance.preparation):undefined;
const metadata={...(account?{account}:{}),...(provenance.localWorkingTree?{localWorkingTree:true}:{}),format:2,version:product.version,build,gitSha:sourceSha,preparation:provenance.preparation,publishable:provenance.publishable,sourceHash,manifest,uiHash,schema:schemaHash(sourceSnapshot(stage)),toolsHash:hash(JSON.stringify(MAIN_TOOLS)),node:'22.22.0',codex:'0.163.0',electron,minimumTestedMacOS:'27.0'};
cpSync(join(stage,'packaging/electron/main.mjs'),join(shell,'main.mjs'));
cpSync(join(stage,'packaging/electron/preload.cjs'),join(shell,'preload.cjs'));
writeFileSync(join(shell,'package.json'),JSON.stringify({name:'homer-desktop',version:product.version,private:true,type:'module',main:'main.mjs',devDependencies:{electron}})+'\n');
const {createDesktopIcon}=await import(pathToFileURL(join(stage,'scripts/desktop-icon.mjs')).href);
const icon=createDesktopIcon({source:join(stage,'assets/branding/odysseus-20261030/homer-odysseus-1024.png'),directory:join(scratch,'icons'),run});
const {default:config}=await import(pathToFileURL(join(stage,'packaging/electron/forge.config.mjs')).href);
const {api,utils}=await import(pathToFileURL(join(modules,'@electron-forge/core/dist/api/index.js')).href);
utils.registerForgeConfigForDirectory(shell,config({payload,metadata,icon}));
let result;
try{result=await api.make({dir:shell,outDir:join(scratch,'forge'),platform:'darwin',arch:'arm64'});}
finally{utils.unregisterForgeConfigForDirectory(shell);}
const artifacts=result.flatMap(item=>item.artifacts),bundle=join(scratch,'forge/Homer-darwin-arm64/Homer.app');
const receipt={...metadata,provenance,bundle,signature:'ad-hoc local candidate; not Developer ID or notarized',artifacts:artifacts.map(path=>({path,bytes:statSync(path).size,sha256:hash(readFileSync(path))})),runtimePackages:identity.packages.length};
writeFileSync(join(scratch,'desktop-build-result.json'),JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify(receipt,null,2));
