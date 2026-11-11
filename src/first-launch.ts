import {cpSync,existsSync,lstatSync,mkdirSync,mkdtempSync,renameSync,rmSync} from 'node:fs';
import {join,resolve,basename} from 'node:path';
import {capabilityHome,usesHomerNativeHome,type Config} from './config.js';
import {fileURLToPath} from 'node:url';

const BUNDLED_SKILLS=['homer-tool-management','homer-feedback','homer-archive-review'] as const;
// Only the default app-data instance owns first-launch Skill distribution.
export function shouldSeedFirstLaunchSkills(config:Config){
 return !!config.appData&&usesHomerNativeHome(config)&&resolve(config.runtime)===join(resolve(config.appData),'runtime')&&resolve(capabilityHome(config))===join(resolve(config.appData),'codex');
}
// Only called for a newly created Homer main conversation. Existing instances,
// user edits and later removals are never replenished by application updates.
export function seedFirstLaunchSkills(home:string){
 const source=fileURLToPath(new URL('../.codex/skills/',import.meta.url)),parent=join(home,'skills');
 for(const path of [home,parent]){const stat=lstatSync(path,{throwIfNoEntry:false});if(stat&&(!stat.isDirectory()||stat.isSymbolicLink()))throw Error('first_launch_directory_symlink_or_not_directory');mkdirSync(path,{recursive:true});}
 for(const name of BUNDLED_SKILLS){
  const target=join(parent,name);
  const existing=lstatSync(target,{throwIfNoEntry:false});
  if(existing){if(existing.isSymbolicLink()||!existing.isDirectory())throw Error('first_launch_directory_symlink_or_not_directory');continue;}
  if(!existsSync(join(source,name,'SKILL.md')))throw Error('first_launch_skill_bundle_missing');
  mkdirSync(parent,{recursive:true});
  const staging=mkdtempSync(join(parent,'.homer-seed-'));
  try{cpSync(join(source,name),join(staging,name),{recursive:true,errorOnExist:true,force:false,filter:path=>{if(basename(path)==='.DS_Store')return false;if(lstatSync(path).isSymbolicLink())throw Error('first_launch_source_symlink');return true;}});renameSync(join(staging,name),target);}
  finally{rmSync(staging,{recursive:true,force:true});}
 }
}
