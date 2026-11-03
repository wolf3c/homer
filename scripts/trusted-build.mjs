// Trusted gateway helpers. Copies live code into the existing model-denied runtime;
// file modes alone are not the security boundary. No approval files are consumed.
import {cpSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync,existsSync,lstatSync,renameSync,realpathSync,readdirSync} from 'node:fs';
import {join,relative,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {pinnedInventory,dependencyIdentity} from './pinned-build.mjs';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function copyRuntimeDependencies(root,runtime){
 const identity=dependencyIdentity(root),directory=join(runtime,'trusted-builds','dependencies-'+digest(identity));
 if(!existsSync(directory)){
  mkdirSync(directory,{recursive:true,mode:0o700});
  for(const item of identity.packages){const target=join(directory,relative(identity.modules,item.path));mkdirSync(dirname(target),{recursive:true,mode:0o700});cpSync(item.path,target,{recursive:true,dereference:false,filter:path=>path===item.path||!relative(item.path,path).split('/').includes('node_modules')});}
  writeFileSync(join(directory,'.dependency-identity.json'),JSON.stringify(identity),{mode:0o600});
 }
 return directory;
}
export function sealBuild(build,dependencies){
 const directory=join(build.config.runtime,'trusted-builds',build.hash.slice(0,12)+'-'+randomUUID());mkdirSync(directory,{recursive:true,mode:0o700});
 try{
  for(const name of ['dist','prompts','assets','package.json','package-lock.json',...(existsSync(join(build.directory,'scripts'))?['scripts']:[]),...(existsSync(join(build.directory,'.codex/skills'))?['.codex/skills']:[])])cpSync(join(build.directory,name),join(directory,name),{recursive:true,dereference:false});
  // Never retain a link to shared project dependencies in a live host.
  symlinkSync(dependencies,join(directory,'node_modules'),'dir');
  const files=pinnedInventory(directory),manifest=digest(files);
  writeFileSync(join(directory,'build-manifest.json'),JSON.stringify({sourceHash:build.hash,manifest,files}),{flag:'wx',mode:0o600});
  return {...build,directory,stagingDirectory:build.directory,manifest};
 }catch(error){rmSync(directory,{recursive:true,force:true});throw error;}
}
export function verifyBuild(build){
 const saved=JSON.parse(readFileSync(join(build.directory,'build-manifest.json'),'utf8'));
 if(saved.sourceHash!==build.hash||saved.manifest!==build.manifest||digest(pinnedInventory(build.directory))!==build.manifest)throw Error('dev_trusted_build_changed');
}
export function freezeToolchain(root,runtime){
 const key=createHash('sha256').update(readFileSync(join(root,'package-lock.json'))).digest('hex');
 const directory=join(runtime,'trusted-builds','toolchain-'+key);
 if(existsSync(directory))return directory;
 const temporary=directory+'-'+randomUUID();mkdirSync(temporary,{recursive:true,mode:0o700});
 try{
  const modules=join(temporary,'node_modules');
  // macOS/APFS clone is an independent copy, not a hardlink/shared writable tree.
  // Copying thousands of files through cpSync exceeded the existing startup deadline.
  if(process.platform==='darwin')execFileSync('/bin/cp',['-c','-R','-P',realpathSync(join(root,'node_modules')),modules],{stdio:'ignore',timeout:30000});
  else cpSync(realpathSync(join(root,'node_modules')),modules,{recursive:true,dereference:false});
  const lock=JSON.parse(readFileSync(join(root,'package-lock.json'),'utf8'));
  for(const [name,item]of Object.entries(lock.packages??{}))if(item.link&&name.startsWith('node_modules/'))rmSync(join(temporary,name),{force:true});
  function verifyLinks(directory){for(const name of readdirSync(directory)){const path=join(directory,name),stat=lstatSync(path);if(stat.isSymbolicLink()){if(!realpathSync(path).startsWith(modules+'/'))throw Error('dev_toolchain_external_link');}else if(stat.isDirectory())verifyLinks(path);}}
  verifyLinks(modules);
  try{renameSync(temporary,directory);}catch(error){if(!existsSync(directory))throw error;rmSync(temporary,{recursive:true,force:true});}
  return directory;
 }catch(error){rmSync(temporary,{recursive:true,force:true});throw error;}
}
