import {constants,copyFileSync,existsSync,lstatSync,readFileSync,realpathSync,renameSync,writeFileSync,linkSync,statSync,chmodSync,openSync,closeSync,fstatSync} from 'node:fs';
import {dirname,isAbsolute,join,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {inside,canonicalDir} from './files.js';
type Entry={path:string;before:string|null;after?:string|null;mode?:number;restored?:boolean;displaced?:string};
type Checkpoint={owner:string;state:'captured'|'sealed'|'restored';entries:Entry[]};
const digest=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
// Explicit file sets only. No recursive snapshots, git reset, shell interception,
// installer reversal, or claim of transactional rollback across files/processes.
export class FileCheckpoints {
 readonly directory:string;
 constructor(runtime:string,private protectedRoots:string[]){this.directory=canonicalDir(join(runtime,'file-checkpoints'));}
 private path(raw:string){
  if(!isAbsolute(raw)||resolve(raw)!==raw)throw Error('checkpoint_path_invalid');
  const parent=realpathSync(dirname(raw));if(parent!==dirname(raw))throw Error('checkpoint_symlink_denied');
  if(this.protectedRoots.some(root=>raw===root||inside(root,raw)))throw Error('checkpoint_protected_path');
  {const s=lstatSync(raw,{throwIfNoEntry:false});if(s){if(!s.isFile()||s.nlink!==1||s.size>16*1024*1024)throw Error('checkpoint_file_type_or_size');}}
  return raw;
 }
 private read(path:string){const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const s=fstatSync(fd),current=lstatSync(path);if(!s.isFile()||s.nlink!==1||s.size>16*1024*1024||s.ino!==current.ino||s.dev!==current.dev||realpathSync(path)!==path)throw Error('checkpoint_file_conflict');return readFileSync(fd);}finally{closeSync(fd);}}
 private hash(path:string){this.path(path);return existsSync(path)?digest(this.read(path)):null;}
 private location(id:string){if(!/^checkpoint-[a-f0-9-]{36}$/.test(id))throw Error('checkpoint_id_invalid');return join(this.directory,id);}
 private load(id:string,owner:string){const dir=this.location(id),m=JSON.parse(readFileSync(join(dir,'manifest.json'),'utf8')) as Checkpoint;if(m.owner!==owner)throw Error('checkpoint_owner_denied');return {dir,m};}
 private save(dir:string,m:Checkpoint){writeFileSync(join(dir,'manifest.json'),JSON.stringify(m),{mode:0o600});}
 capture(owner:string,paths:string[]){
  if(!paths.length||paths.length>128||new Set(paths).size!==paths.length)throw Error('checkpoint_file_limit');
  const entries=paths.map(path=>({path:this.path(path),before:this.hash(path),...(existsSync(path)?{mode:statSync(path).mode&0o777}:{})}));
  const id='checkpoint-'+randomUUID(),dir=canonicalDir(this.location(id));
  for(const [i,e] of entries.entries())if(e.before!==null){writeFileSync(join(dir,String(i)),this.read(e.path),{flag:'wx',mode:0o600});if(digest(readFileSync(join(dir,String(i))))!==e.before||this.hash(e.path)!==e.before)throw Error('checkpoint_capture_conflict');chmodSync(join(dir,String(i)),0o600);}
  const m:Checkpoint={owner,state:'captured',entries};this.save(dir,m);return {id,state:m.state,files:entries.length,scope:'explicit files only'};
 }
 seal(owner:string,id:string){const {dir,m}=this.load(id,owner);if(m.state!=='captured')throw Error('checkpoint_state_invalid');for(const e of m.entries)e.after=this.hash(e.path);m.state='sealed';this.save(dir,m);return {id,state:m.state,files:m.entries.length};}
 restore(owner:string,id:string){
  const {dir,m}=this.load(id,owner);if(m.state!=='sealed')throw Error('checkpoint_state_invalid');
  const conflicts=m.entries.filter(e=>!e.restored&&this.hash(e.path)!==e.after).map(e=>e.path);
  if(conflicts.length)return {id,state:m.state,restored:0,conflicts};
  let restored=0;
  for(const [i,e]of m.entries.entries()){
   if(e.restored)continue;
   if(this.hash(e.path)!==e.after)return {id,state:m.state,restored,conflicts:[e.path]};
   if(e.before===e.after){e.restored=true;continue;}
   // Move the exact current file aside, then verify it again. Exclusive create
   // below cannot clobber a new user file created during recovery. Displaced
   // files stay private, including late writes through an already-open fd.
   if(e.after!==null){
    if(statSync(e.path).dev!==statSync(dir).dev)throw Error('checkpoint_restore_cross_device');
    const displaced=join(dir,'displaced-'+i+'-'+randomUUID());renameSync(e.path,displaced);e.displaced=displaced;this.save(dir,m);
    if(digest(this.read(displaced))!==e.after){try{linkSync(displaced,e.path);}catch{}return {id,state:m.state,restored,conflicts:[e.path]};}
   }
   try{
    if(e.before!==null){copyFileSync(join(dir,String(i)),e.path,constants.COPYFILE_EXCL);chmodSync(e.path,e.mode??0o600);}
    else if(existsSync(e.path))return {id,state:m.state,restored,conflicts:[e.path]};
   }catch(error){if(e.displaced&&!existsSync(e.path)){try{linkSync(e.displaced,e.path);}catch{}}throw error;}
   e.restored=true;restored++;this.save(dir,m);
  }
  m.state='restored';this.save(dir,m);return {id,state:m.state,restored,conflicts:[],notice:'File-only recovery. Private displaced files retained; external effects and active writers require separate review.'};
 }
}
