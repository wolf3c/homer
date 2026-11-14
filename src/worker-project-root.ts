import {lstat,stat,open,realpath} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {inside} from './files.js';

export const HOME_PROJECT_MARKER='.homer-project-root';

export async function prepareWorkerProjectRoot(cwd:string,home:string,configured:unknown,isCurrent=()=>true):Promise<string[]>{
 if(configured!=null&&(!Array.isArray(configured)||configured.some(value=>typeof value!=='string'||!value)))throw Error('worker_project_root_config_invalid');
 const markers=[...new Set<string>([...(configured??[]) as string[],'.git',HOME_PROJECT_MARKER])];
 const guard=()=>{if(!isCurrent())throw Error('engine_configuration_cancelled');};
 guard();
 try{
  home=await realpath(home);guard();
  if(cwd!==home&&!inside(home,cwd))return markers;
  // A nearer native root does not depend on a writable home fallback.
  for(let dir=cwd;;dir=dirname(dir)){
   guard();
   for(const name of markers.filter(name=>name!==HOME_PROJECT_MARKER)){
    try{await stat(resolve(dir,name));guard();return markers;}catch(error){if(!['ENOENT','ENOTDIR'].includes((error as NodeJS.ErrnoException).code??''))throw error;}
   }
   if(dir===home)break;
  }
  const path=resolve(home,HOME_PROJECT_MARKER);
  guard();
  try{
   const existing=await lstat(path);guard();
   if(!existing.isFile()||existing.isSymbolicLink())throw Error('worker_project_root_unavailable');
  }catch(error){
   if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
   guard();
   try{const file=await open(path,'wx',0o600);await file.close();}
   catch(error){
    if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
    const existing=await lstat(path);
    if(!existing.isFile()||existing.isSymbolicLink())throw Error('worker_project_root_unavailable');
   }
  }
  guard();return markers;
 }catch(error){
  if((error as Error).message==='engine_configuration_cancelled')throw error;
  throw Error('worker_project_root_unavailable');
 }
}
