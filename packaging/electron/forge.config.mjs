import {cpSync,readFileSync,writeFileSync,readdirSync,lstatSync,realpathSync} from 'node:fs';
import {join,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const macCode=['homer-image-decoder','homer-window-capture','node'].map(name=>'Contents/MacOS/'+name);
function desktopManifest(bundle,metadata){
 const windows=metadata.platform==='win32',resources=windows?join(bundle,'resources'):join(bundle,'Contents/Resources'),files=[];
 if(windows&&lstatSync(join(resources,'elevate.exe'),{throwIfNoEntry:false}))throw Error('desktop_elevation_helper_denied');
 function visit(directory,prefix=''){
  for(const name of readdirSync(directory).sort()){
   if(name==='.DS_Store'||!prefix&&name==='desktop-manifest.json')continue;
   const path=join(directory,name),relative=join(prefix,name),stat=lstatSync(path);
   if(stat.isSymbolicLink())throw Error('desktop_resource_symlink_denied');
   if(stat.isDirectory())visit(path,relative);else if(stat.isFile())files.push({path:relative,sha256:sha(readFileSync(path))});else throw Error('desktop_resource_type_invalid');
  }
 }
 visit(resources);
 const codeFiles=(windows?['Homer.exe']:macCode).map(path=>({path,sha256:sha(readFileSync(join(bundle,path)))}));
 return {...metadata,codeFiles,files};
}
export function writeDesktopManifest(bundle,metadata){
 const resources=join(bundle,metadata.platform==='win32'?'resources':'Contents/Resources');
 writeFileSync(join(resources,'desktop-manifest.json'),JSON.stringify(desktopManifest(bundle,metadata),null,2)+'\n');
}
// Build configuration only; the generated shell carries its own runtime dependencies.
export default function forgeConfig({payload,metadata,icon,distribution}){
 if(metadata.platform==='win32'){
  windowsInstallerConfig({metadata,distribution});
  const signed=distribution&&!distribution.unsignedWindows;
  return {packagerConfig:{name:'Homer',executableName:'Homer',appVersion:metadata.version,buildVersion:String(metadata.build),asar:true,prune:false,extraResource:['homer','runtime','licenses','node.exe','homer-image-decoder.mjs',...(signed?['app-update.yml']:[])].map(name=>join(payload,name)),...(signed?{windowsSign:{certificateSha1:distribution.identity}}:{})},makers:[],hooks:{postPackage:async(_config,{outputPaths})=>{for(const directory of outputPaths)writeDesktopManifest(directory,metadata);}}};
 }
 if(distribution&&(!/^[0-9A-Fa-f]{40}$/.test(distribution.identity??'')||!distribution.keychainProfile||metadata.preparation||metadata.localWorkingTree||metadata.publishable!==true||metadata.appId!=='app.homer.desktop'||metadata.releaseChannel!=='stable'||!['arm64','x64'].includes(metadata.arch)||!/^\d+\.\d+\.\d+$/.test(metadata.version??'')||!/^\d+\.\d+$/.test(metadata.minimumMacOS??'')||!Number.isSafeInteger(metadata.build)||metadata.build<1||!/^v?[0-9][A-Za-z0-9._-]*$/.test(distribution.releaseTag??'')))throw Error('desktop_distribution_inputs_required');
 if(!distribution&&metadata.releaseChannel==='stable')throw Error('desktop_distribution_inputs_required');
 const releaseBase=distribution?`https://github.com/wolf3c/homer/releases/download/${distribution.releaseTag}`:undefined;
 return {
  packagerConfig:{
   name:'Homer',executableName:'Homer',appBundleId:distribution?metadata.appId:'app.homer.desktop.candidate',appVersion:metadata.version,buildVersion:String(metadata.build),appCategoryType:'public.app-category.productivity',darwinDarkModeSupport:true,
   extendInfo:{CFBundleDisplayName:'荷马',LSMinimumSystemVersion:metadata.minimumMacOS??'27.0',NSScreenCaptureUsageDescription:'截取你选择的窗口或区域，用于图片批注。'},icon,asar:true,prune:false,
   extraResource:['homer','runtime','licenses'].map(name=>join(payload,name)),
   tmpdir:join(payload,'../packager-tmp'),
   // Keep upstream executable signatures. The Cua SDK addons load inside Electron and need its team signature.
   osxSign:{identity:distribution?.identity??'-',identityValidation:!!distribution,continueOnError:false,preAutoEntitlements:false,preEmbedProvisioningProfile:false,
    optionsForFile:()=>distribution?{hardenedRuntime:true,timestamp:'http://timestamp.apple.com/ts01'}:{hardenedRuntime:false,timestamp:'none'},
    ignore:path=>path.includes('/Contents/Resources/runtime/')
      ?!/\/Contents\/Resources\/runtime\/cua\/(?:chrome-viewport$|node_modules\/.*\.(?:node|dylib)$)/.test(path)
      :macCode.some(file=>path.endsWith('/'+file))||lstatSync(path).isFile()&&!execFileSync('/usr/bin/file',['--brief',path],{encoding:'utf8'}).startsWith('Mach-O'),
   },
   afterCopyExtraResources:[async({buildPath})=>{
    const bundle=join(buildPath,'Homer.app');
    for(const file of macCode)cpSync(join(payload,basename(file)),join(bundle,file));
    writeDesktopManifest(bundle,metadata);
   }],
  },
  makers:[{name:'@electron-forge/maker-zip',platforms:['darwin'],config:releaseBase?{macUpdateManifestBaseUrl:releaseBase}:{}}],
  hooks:{postMake:async(_config,results)=>{
   if(!distribution)return results;
   for(const result of results){
    const zip=result.artifacts.find(path=>basename(path)===`Homer-darwin-${metadata.arch}-${metadata.version}.zip`),feed=result.artifacts.find(path=>basename(path)==='RELEASES.json');
    if(result.platform!=='darwin'||result.arch!==metadata.arch||!zip||!feed)throw Error('desktop_update_artifacts_invalid');
    const native=JSON.parse(readFileSync(feed,'utf8'));
    const releases=native.releases?.filter(release=>release.version===metadata.version);
    if(native.currentRelease!==metadata.version||releases?.length!==1||releases[0].updateTo?.version!==metadata.version)throw Error('desktop_update_artifacts_invalid');
    const update=releases[0].updateTo;update.name=metadata.version;update.url=releaseBase+'/'+basename(zip);delete update.notes;
    writeFileSync(feed,JSON.stringify({currentRelease:native.currentRelease,releases},null,2)+'\n');
   }
   return results;
  },postPackage:async(_config,{outputPaths})=>{
   for(const app of outputPaths){
    // Forge returns a platform directory containing the .app.
    const bundle=join(app,'Homer.app');
    // Nested native addons are signed by Forge; seal their final bytes in the outer signature.
    writeDesktopManifest(bundle,metadata);
    execFileSync('/usr/bin/codesign',['--force','--sign',distribution?.identity??'-',...(distribution?['--timestamp=http://timestamp.apple.com/ts01','--options','runtime','--preserve-metadata=entitlements']:['--timestamp=none']),bundle],{stdio:'inherit'});
    for(const path of [bundle,...macCode.map(file=>join(bundle,file))])execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',path],{stdio:'inherit'});
    if(realpathSync(bundle)!==bundle)throw Error('desktop_bundle_symlink_denied');
    if(distribution){
     const archive=join(app,'Homer-notary.zip');
     execFileSync('/usr/bin/ditto',['-c','-k','--keepParent',bundle,archive]);
     execFileSync('/usr/bin/xcrun',['notarytool','submit',archive,'--keychain-profile',distribution.keychainProfile,'--wait'],{stdio:'inherit',timeout:900000});
     execFileSync('/usr/bin/xcrun',['stapler','staple',bundle],{stdio:'inherit'});
     execFileSync('/usr/bin/xcrun',['stapler','validate',bundle],{stdio:'inherit'});
     execFileSync('/usr/sbin/spctl',['--assess','--type','execute',bundle],{stdio:'inherit'});
    }
   }
  }},
 };
}

export function windowsInstallerConfig({metadata,distribution}){
 if(metadata.arch!=='x64'||distribution&&((!distribution.unsignedWindows&&(!/^[a-f0-9]{40}$/i.test(distribution.identity??'')||!/^CN=.+,/.test(distribution.publisher??'')))||!/^v?[0-9][A-Za-z0-9._-]*$/.test(distribution.releaseTag??'')||!/^\d+\.\d+\.\d+$/.test(metadata.version??'')||!Number.isSafeInteger(metadata.build)||metadata.build<1||metadata.preparation||metadata.localWorkingTree||metadata.publishable!==true||metadata.appId!=='app.homer.desktop'||metadata.releaseChannel!=='stable')||!distribution&&metadata.releaseChannel==='stable')throw Error('desktop_distribution_inputs_required');
 const signed=distribution&&!distribution.unsignedWindows;
 return {appId:distribution?'app.homer.desktop':'app.homer.desktop.candidate',productName:'Homer',...(signed?{forceCodeSigning:true}:{}),electronVersion:metadata.electron,artifactName:'Homer-win32-x64-${version}.exe',publish:{provider:'generic',url:'https://github.com/wolf3c/homer/releases/latest/download/',channel:'latest'},nsis:{oneClick:true,perMachine:false,packElevateHelper:false,deleteAppDataOnUninstall:false,differentialPackage:false},win:{target:[{target:'nsis',arch:['x64']}],requestedExecutionLevel:'asInvoker',verifyUpdateCodeSignature:true,...(signed?{publisherName:distribution.publisher,signtoolOptions:{certificateSha1:distribution.identity}}:{})}};
}

export function assertWindowsPayload(bundle){
 const manifest=JSON.parse(readFileSync(join(bundle,'resources/desktop-manifest.json'),'utf8'));
 if(JSON.stringify(desktopManifest(bundle,manifest))!==JSON.stringify(manifest))throw Error('desktop_resource_changed');
}

export function windowsRelease(native,installer,metadata,releaseTag){
 if(!installer||basename(installer)!==`Homer-win32-x64-${metadata.version}.exe`||native?.version!==metadata.version||native.files?.length!==1||!/^v?[0-9][A-Za-z0-9._-]*$/.test(releaseTag??''))throw Error('desktop_update_artifacts_invalid');
 const bytes=readFileSync(installer),digest=createHash('sha512').update(bytes).digest('base64'),file=native.files[0];
 if(file.sha512!==digest||file.size!==bytes.length||basename(file.url)!==basename(installer)||native.path!==undefined&&basename(native.path)!==basename(installer)||native.sha512!==undefined&&native.sha512!==digest||file.isAdminRightsRequired===true||native.packages)throw Error('desktop_update_artifacts_invalid');
 const url=`https://github.com/wolf3c/homer/releases/download/${releaseTag}/${basename(installer)}`;
 file.url=url;if(native.path!==undefined)native.path=url;delete native.releaseNotes;delete native.releaseName;
 return native;
}
