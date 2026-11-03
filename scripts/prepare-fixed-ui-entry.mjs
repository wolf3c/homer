// Explicit preparation only; never stops services or modifies runtime data.
import {mkdirSync,copyFileSync,cpSync,realpathSync,readdirSync,symlinkSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {prepareFixedUi} from './fixed-ui-launcher.mjs';
export function freezeFixedUiInputs({baseline,patch}){
 const root=process.cwd(),builds=resolve('.codex/scratch/dev-upgrade/builds'),directory=join(builds,'fixed-ui-'+randomUUID());
 for(const input of [baseline,patch]){
  const path=realpathSync(input),scratch=realpathSync(resolve('.codex/scratch'));
  if(!path.startsWith(scratch+'/')||!path.includes('/.codex/scratch/dev-upgrade/builds/ui-'))throw Error('fixed_input_location_denied');
  const allowed=new Set(['src','prompts','assets','ui','dist','package.json','package-lock.json','tsconfig.json','node_modules','scripts','.codex']);
  if(readdirSync(path).some(name=>!allowed.has(name))||(readdirSync(path).includes('.codex')&&(readdirSync(join(path,'.codex')).some(name=>name!=='skills')||readdirSync(join(path,'.codex/skills')).some(name=>!['homer-initialize','homer-tool-management'].includes(name)))))throw Error('fixed_input_inventory_invalid');
 }
 mkdirSync(join(directory,'scripts'),{recursive:true,mode:0o700});
 for(const name of ['dev.mjs','dev-build.mjs','trusted-build.mjs','dev-ingress.mjs','pinned-build.mjs','fixed-ui-launcher.mjs'])copyFileSync(join(root,'scripts',name),join(directory,'scripts',name));
 for(const [name,input] of [['baseline',baseline],['patch',patch]]){
  const target=join(directory,name);
  // Only immutable source/build trees, no runtime, auth, sessions or private files.
  cpSync(realpathSync(input),target,{recursive:true,filter:path=>!path.endsWith('/node_modules')});
  symlinkSync(realpathSync(join(input,'node_modules')),join(target,'node_modules'),'dir');
 }
 return {directory,entryDirectory:join(directory,'scripts'),baseline:join(directory,'baseline'),patch:join(directory,'patch')};
}
if(process.argv[1]&&resolve(process.argv[1])===new URL(import.meta.url).pathname){
 const [pin,baseline,patch,manifest,version,baseHash,patchHash]=process.argv.slice(2);
 try{
  if(!patchHash)throw Error('fixed_prepare_arguments_invalid');
  const frozen=freezeFixedUiInputs({baseline,patch});
  prepareFixedUi({pinnedManifest:pin,...frozen,manifestPath:manifest,expectedVersion:version,expectedBaseUi:baseHash,expectedPatchUi:patchHash});
  console.log(JSON.stringify({entry:join(frozen.entryDirectory,'fixed-ui-launcher.mjs'),manifest:resolve(manifest)}));
 }catch(error){console.error(/^[a-z_]+$/.test(error.message)?error.message:'fixed_prepare_failed');process.exitCode=1;}
}
