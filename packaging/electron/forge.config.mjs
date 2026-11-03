import {cpSync,readFileSync,writeFileSync,readdirSync,lstatSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export function writeDesktopManifest(bundle,metadata){
 const resources=join(bundle,'Contents/Resources'),files=[];
 function visit(directory,prefix=''){
  for(const name of readdirSync(directory).sort()){
   if(name==='.DS_Store'||!prefix&&name==='desktop-manifest.json')continue;
   const path=join(directory,name),relative=join(prefix,name),stat=lstatSync(path);
   if(stat.isSymbolicLink())throw Error('desktop_resource_symlink_denied');
   if(stat.isDirectory())visit(path,relative);else if(stat.isFile())files.push({path:relative,sha256:sha(readFileSync(path))});else throw Error('desktop_resource_type_invalid');
  }
 }
 visit(resources);
 const codeFiles=['Contents/MacOS/homer-image-decoder','Contents/MacOS/node'].map(path=>({path,sha256:sha(readFileSync(join(bundle,path)))}));
 writeFileSync(join(resources,'desktop-manifest.json'),JSON.stringify({...metadata,codeFiles,files},null,2)+'\n');
}
// Build configuration only. The generated app contains just main.mjs/package.json.
export default function forgeConfig({payload,metadata,icon}){
 return {
  packagerConfig:{
   name:'Homer',executableName:'Homer',appBundleId:'app.homer.desktop.candidate',appVersion:metadata.version,buildVersion:String(metadata.build),appCategoryType:'public.app-category.productivity',darwinDarkModeSupport:true,
   extendInfo:{CFBundleDisplayName:'荷马',LSMinimumSystemVersion:'27.0'},icon,asar:true,prune:false,
   extraResource:['homer','runtime','licenses'].map(name=>join(payload,name)),
   tmpdir:join(payload,'../packager-tmp'),
   // Preserve original upstream signatures and the already signed ImageIO helper.
   osxSign:{identity:'-',identityValidation:false,continueOnError:false,preAutoEntitlements:false,preEmbedProvisioningProfile:false,
    optionsForFile:()=>({hardenedRuntime:false,timestamp:'none'}),
    ignore:path=>path.includes('/Contents/Resources/runtime/')||path.endsWith('/Contents/MacOS/node')||path.endsWith('/Contents/MacOS/homer-image-decoder'),
   },
   afterCopyExtraResources:[async({buildPath})=>{
    const bundle=join(buildPath,'Homer.app');
    for(const name of ['node','homer-image-decoder'])cpSync(join(payload,name),join(bundle,'Contents/MacOS',name));
    writeDesktopManifest(bundle,metadata);
   }],
  },
  makers:[{name:'@electron-forge/maker-zip',platforms:['darwin'],config:{}}],
  hooks:{postPackage:async(_config,{outputPaths})=>{
   for(const app of outputPaths){
    // Forge returns a platform directory containing the .app.
    const bundle=join(app,'Homer.app');
    // Nested native addons are signed by Forge; seal their final bytes in the outer signature.
    writeDesktopManifest(bundle,metadata);
    execFileSync('/usr/bin/codesign',['--force','--sign','-','--timestamp=none',bundle],{stdio:'inherit'});
    for(const path of [bundle,join(bundle,'Contents/MacOS/node'),join(bundle,'Contents/MacOS/homer-image-decoder')])execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',path],{stdio:'inherit'});
    if(realpathSync(bundle)!==bundle)throw Error('desktop_bundle_symlink_denied');
   }
  }},
 };
}
