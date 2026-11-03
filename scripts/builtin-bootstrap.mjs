import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, join, dirname, delimiter } from 'node:path';

function directory(path){
 const full=resolve(path),parent=dirname(full);
 if(parent!==full)directory(parent);
 if(existsSync(full)){if(lstatSync(full).isSymbolicLink()||!lstatSync(full).isDirectory())throw Error('builtin_directory_symlink_or_not_directory');}
 else mkdirSync(full,{mode:0o700});
}
// Seeds ordinary native skills only. Codex owns discovery, configuration and .system.
// An existing skill directory is always user-owned, including a disabled/edited one.
export function seedBuiltinSkills(resources,nativeHome){
 resources=resolve(resources);nativeHome=resolve(nativeHome);
 directory(nativeHome);const destination=join(nativeHome,'skills');directory(destination);
 const result={created:[],preserved:[]},source=join(resources,'skills');
 if(!existsSync(source)||lstatSync(source).isSymbolicLink())throw Error('builtin_source_symlink_or_missing');
 const entries=readdirSync(source,{withFileTypes:true});
 const marker=join(nativeHome,'.homer-builtin-seeded');
 if(existsSync(marker)){if(lstatSync(marker).isSymbolicLink()||!lstatSync(marker).isFile())throw Error('builtin_seed_marker_symlink');return {...result,alreadySeeded:true};}
 const lock=join(nativeHome,'.homer-builtin-seed-lock');
 try{mkdirSync(lock,{mode:0o700});}catch{throw Error('builtin_seed_busy');}
 try{
 for(const entry of entries){
  if(!entry.isDirectory()||!/^homer-[a-z0-9-]+$/.test(entry.name))throw Error('builtin_skill_source_invalid');
  const bytes=readFileSync(join(source,entry.name,'SKILL.md'));
  if(lstatSync(join(source,entry.name,'SKILL.md')).isSymbolicLink())throw Error('builtin_skill_source_symlink');
  const target=join(destination,entry.name);
  if(existsSync(target)){if(lstatSync(target).isSymbolicLink())throw Error('builtin_skill_destination_symlink');result.preserved.push(entry.name);continue;}
  mkdirSync(target,{mode:0o700});
  writeFileSync(join(target,'SKILL.md'),bytes,{flag:'wx',mode:0o600});result.created.push(entry.name);
 }
 writeFileSync(marker,'Initial bundled methods seeded; native management owns later edits, disable and removal.\n',{flag:'wx',mode:0o600});
 return result;
 }finally{rmSync(lock,{recursive:true,force:true});}
}
export function builtinEnvironment(resources,nativeHome){
 resources=resolve(resources);nativeHome=resolve(nativeHome);
 return {HOMER_BUILTIN_ROOT:resources,HOME:join(nativeHome,'host-home'),CODEX_HOME:nativeHome,
  PATH:[join(resources,'node/bin'),join(resources,'python/bin'),join(resources,'desktop'),'/usr/bin','/bin','/usr/sbin','/sbin'].join(delimiter),
  PLAYWRIGHT_BROWSERS_PATH:join(resources,'browsers'),PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD:'1',
  NODE_PATH:join(resources,'node_modules'),PYTHONNOUSERSITE:'1',PYTHONDONTWRITEBYTECODE:'1',
  PIP_DISABLE_PIP_VERSION_CHECK:'1',PIP_CACHE_DIR:join(nativeHome,'tmp/pip')};
}
