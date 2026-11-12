// Dedicated desktop data. Existing development data is never adopted implicitly.
import {readFileSync,writeFileSync,existsSync,mkdirSync,lstatSync,realpathSync,unlinkSync,openSync,closeSync,readdirSync,renameSync,fsyncSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {assertWindowsPrivate,secureWindowsDirectory} from './windows-security.mjs';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const markerName='desktop-profile.json';
export function readDesktopModelSource(root,fallback){
 const value=JSON.parse(privateFile(join(root,markerName))).modelSource??fallback;
 if(value!=='codex'&&value!=='website')throw Error('desktop_model_source_invalid');
 return value;
}
export function saveDesktopModelSource(root,source,chatgpt){
 if(source!=='codex'&&source!=='website')throw Error('desktop_model_source_invalid');
 writeDesktopProfile(root,{modelSource:source,...(chatgpt!==undefined?{chatgpt:Object.keys(chatgpt).length?chatgpt:undefined}:{})});
}
export function readDesktopChatGPTConfig(root){return JSON.parse(privateFile(join(root,markerName))).chatgpt;}
export function readDesktopCaptureShortcut(root){
 return JSON.parse(privateFile(join(root,markerName))).captureShortcut;
}
export function saveDesktopCaptureShortcut(root,shortcut){
 writeDesktopProfile(root,{captureShortcut:shortcut});
}
export function readDesktopPowerConfig(root){return JSON.parse(privateFile(join(root,markerName))).power;}
export function saveDesktopPowerConfig(root,power){writeDesktopProfile(root,{power});}
function writeDesktopProfile(root,fields){
 const file=join(root,markerName),temporary=file+'.pending';
 let fd,created=false;
 try{
  fd=openSync(temporary,'wx',0o600);created=true;
  const value=JSON.parse(privateFile(file));writeFileSync(fd,JSON.stringify({...value,...fields})+'\n');fsyncSync(fd);closeSync(fd);fd=undefined;
  renameSync(temporary,file);created=false;
 }finally{if(fd!==undefined)closeSync(fd);if(created)unlinkSync(temporary);}
}
const bytesHash=bytes=>createHash('sha256').update(bytes).digest('hex');
function privateFileStat(path){
 const stat=lstatSync(path,{throwIfNoEntry:false});
 if(!stat?.isFile()||realpathSync(path)!==path||(process.platform==='win32'?(assertWindowsPrivate(path),false):stat.uid!==process.getuid()||(stat.mode&0o077)!==0))throw Error('desktop_adoption_private_file_required');
 return stat;
}
function privateFile(path){privateFileStat(path);return readFileSync(path);}
function existingOwnedDirectory(path){
 const stat=lstatSync(path,{throwIfNoEntry:false});
 if(!stat?.isDirectory()||realpathSync(path)!==path||(process.platform==='win32'?(assertWindowsPrivate(path),false):stat.uid!==process.getuid()))throw Error('desktop_adoption_paths_invalid');
}
function readAdoption(root,test){
 const record=JSON.parse(privateFile(join(root,'desktop-adoption.json')));
 if(record.format!==1||typeof record.test!=='boolean'||!/^([a-f0-9]{64})$/.test(record.sha256??'')||typeof record.sourceConfig!=='string'||Object.keys(record).some(k=>!['format','test','sha256','sourceConfig'].includes(k)))throw Error('desktop_adoption_source_invalid');
 if(record.test!==test)throw Error('desktop_profile_mode_mismatch');
 const source=resolve(record.sourceConfig),privateRoot=dirname(source);
 if(source!==record.sourceConfig||!source.endsWith('/.codex/private/local-chatgpt.config.json')||realpathSync(source)!==source)throw Error('desktop_adoption_source_invalid');
 const bytes=privateFile(source);
 if(bytesHash(bytes)!==record.sha256)throw Error('desktop_adoption_source_changed');
 const raw=JSON.parse(bytes),appData=join(dirname(root),'Homer'),codexHome=join(appData,'codex');
 if(['runtime','workspace','codexHome','codexBin'].some(name=>typeof raw[name]!=='string'))throw Error('desktop_adoption_paths_invalid');
 const fromBase=(value,fallback,base)=>resolve(base,value??fallback);
 // This is the one existing local Homer layout. No arbitrary data roots,
 // executable, environment or command can be supplied by the descriptor.
 const paths={runtime:join(privateRoot,'runtime-local-subscription'),workspace:join(privateRoot,'workspace'),codexHome};
 if(fromBase(raw.appData,appData,dirname(dirname(privateRoot)))!==appData||fromBase(raw.nativeCodexHome,codexHome,dirname(dirname(privateRoot)))!==codexHome||fromBase(raw.codexHome,codexHome,dirname(dirname(privateRoot)))!==codexHome||fromBase(raw.runtime,paths.runtime,privateRoot)!==paths.runtime||fromBase(raw.workspace,paths.workspace,privateRoot)!==paths.workspace||raw.baseUrl||raw.keyEnv||raw.requiresOpenaiAuth===false)throw Error('desktop_adoption_paths_invalid');
 for(const path of [appData,...Object.values(paths)])existingOwnedDirectory(path);
 return {...paths,appData,nativeCodexHome:codexHome,sourceConfig:source,sha256:record.sha256};
}
// A disappeared process is only an ownership fact. Homer.start retains unknown
// tool/results through its existing recovery; this function deletes nothing.
export function assertDesktopAdoptionLeasesRecoverable(leases,alive=pid=>{
 try{process.kill(pid,0);return true;}catch(error){return error.code==='ESRCH'?false:undefined;}
}){
 for(const row of leases){
  let lease;try{lease=JSON.parse(row.value);}catch{throw Error('desktop_adoption_owner_unknown');}
  if(!row.key?.startsWith('lease:')||!Number.isSafeInteger(lease.pid)||lease.pid<1||typeof lease.identity!=='string'||!lease.identity)throw Error('desktop_adoption_owner_unknown');
  const state=alive(lease.pid);
  if(state===true)throw Error('desktop_adoption_owner_active');
  if(state!==false)throw Error('desktop_adoption_owner_unknown');
 }
 return {count:leases.length,recovery:'existing-homer-start',sideEffectsConfirmed:false};
}
function assertDirectory(path){
 if(lstatSync(path,{throwIfNoEntry:false})?.isSymbolicLink())throw Error('desktop_profile_symlink_denied');
 mkdirSync(path,{recursive:true,mode:0o700});
 if(realpathSync(path)!==resolve(path))throw Error('desktop_profile_symlink_denied');
}
// Validate existing ancestors and leaf types before any SQLite open, chmod,
// lock recovery or marker write. lstat also sees dangling symbolic links.
function controlPath(path,type){
 const parent=dirname(path);
 if(parent!==path)controlPath(parent,'directory');
 const stat=lstatSync(path,{throwIfNoEntry:false});
 if(!stat)return;
 if(stat.isSymbolicLink()||realpathSync(path)!==path||(type==='directory'?!stat.isDirectory():!stat.isFile()))throw Error('desktop_control_path_invalid');
}
export function assertDesktopControlPaths({root,runtime,codexHome,workspace}){
 for(const path of [root,runtime,codexHome,workspace,join(root,'host-home'),join(root,'host-home/electron'),join(root,'tmp'),join(runtime,'gateway')])controlPath(path,'directory');
 for(const name of [markerName,'desktop-adoption.json','.homer-desktop-new','.homer-desktop-test-profile'])controlPath(join(root,name),'file');
 for(const database of [join(runtime,'homer.sqlite'),join(runtime,'gateway/transport.sqlite')]){
  for(const suffix of ['','-wal','-shm','-journal'])controlPath(database+suffix,'file');
 }
 for(const path of [join(runtime,'cli.lock'),join(runtime,'gateway/cli.lock'),join(codexHome,'desktop-owner.json')])controlPath(path,'file');
}
export function prepareDesktopProfile(root,version,{test=false,initialize=false}={}){
 root=resolve(root);
 if(process.platform==='win32'&&lstatSync(root,{throwIfNoEntry:false}))assertWindowsPrivate(root);
 if(initialize&&!test){
  controlPath(root,'directory');
  if(!lstatSync(root,{throwIfNoEntry:false})){mkdirSync(root,{recursive:true,mode:0o700});if(process.platform==='win32')secureWindowsDirectory(root);}
  if(process.platform==='win32')assertWindowsPrivate(root);
  if(readdirSync(root).length===0)writeFileSync(join(root,'.homer-desktop-new'),'{"format":1}\n',{flag:'wx',mode:0o600});
 }
 if(!lstatSync(root,{throwIfNoEntry:false})?.isDirectory()||lstatSync(root).isSymbolicLink()||realpathSync(root)!==root)throw Error('desktop_data_unrecognized');
 // Check descriptor/marker before even reading them; no existsSync bypass for
 // dangling links. Adopted data paths are known only after private validation.
 for(const name of [markerName,'desktop-adoption.json','.homer-desktop-new','.homer-desktop-test-profile'])controlPath(join(root,name),'file');
 const adoption=existsSync(join(root,'desktop-adoption.json'))?readAdoption(root,test):undefined;
 const paths={root,runtime:adoption?.runtime??join(root,'runtime'),workspace:adoption?.workspace??join(root,'workspace'),codexHome:adoption?.codexHome??join(root,'codex')};
 assertDesktopControlPaths(paths);
 const marker=join(root,markerName),fresh=join(root,'.homer-desktop-new'),fixture=join(root,'.homer-desktop-test-profile');
 const acceptedVersion={format:1,schema:version.schema,codex:version.codex};
 if(existsSync(marker)){
   const saved=JSON.parse(readFileSync(marker,'utf8'));
   if(saved.format!==1||typeof saved.schema!=='string'||!saved.schema||saved.codex!==version.codex)throw Error('desktop_schema_incompatible');
   if(saved.test!==test)throw Error('desktop_profile_mode_mismatch');
 }else{
   const permission=test?fixture:fresh;
   if(!adoption&&(!existsSync(permission)||JSON.parse(readFileSync(permission,'utf8')).format!==1))throw Error('desktop_data_unrecognized');
   // Even a new-marker cannot authorize adopting pre-existing business/account data.
   if(['runtime','codex','workspace'].some(name=>existsSync(join(root,name))))throw Error('desktop_data_unrecognized');
   writeFileSync(marker,JSON.stringify({...acceptedVersion,test})+'\n',{flag:'wx',mode:0o600});
   if(!test&&!adoption)unlinkSync(fresh);
 }
 if(adoption){
  for(const name of ['host-home','tmp'])assertDirectory(join(root,name));
  return {root,runtime:adoption.runtime,workspace:adoption.workspace,codexHome:adoption.codexHome,adoption};
 }
 for(const path of [paths.runtime,paths.workspace,paths.codexHome,join(root,'host-home'),join(root,'tmp')])assertDirectory(path);
 return paths;
}
// Unlike the dev-runtime lock, an unconfirmed desktop owner is never auto-stale.
// OS exit alone cannot prove a detached native execution was stopped.
export function acquireDesktopOwner(codexHome,identity,runtime){
 controlPath(codexHome,'directory');
 if(typeof runtime!=='string'||resolve(runtime)!==runtime)throw Error('desktop_owner_runtime_required');
 controlPath(runtime,'directory');existingOwnedDirectory(runtime);
 const file=join(codexHome,'desktop-owner.json');controlPath(file,'file');assertDirectory(codexHome);
 const value={format:1,pid:process.pid,identity:identity(process.pid),runtime};
 if(!value.identity)throw Error('desktop_process_identity_unavailable');
 let fd;try{fd=openSync(file,'wx',0o600);}catch{throw Error('desktop_owner_conflict');}
 try{writeFileSync(fd,JSON.stringify(value)+'\n');}finally{closeSync(fd);}
 let released=false;
 return ()=>{if(released)return;controlPath(file,'file');const current=JSON.parse(readFileSync(file,'utf8'));if(hash(current)!==hash(value))throw Error('desktop_owner_release_unconfirmed');unlinkSync(file);released=true;};
}
// Only Electron calls this while holding the single-instance lock for this home.
export function recoverDesktopOwner(codexHome,identity,ownerGone){
 controlPath(codexHome,'directory');existingOwnedDirectory(codexHome);
 const file=join(codexHome,'desktop-owner.json');controlPath(file,'file');if(!existsSync(file))return;
 const snapshots=[];
 const parse=value=>{try{const owner=JSON.parse(value);if(!owner||!Number.isSafeInteger(owner.pid)||owner.pid<=1||typeof owner.identity!=='string'||!owner.identity)throw Error();return owner;}catch{throw Error('desktop_owner_unknown');}};
 const read=path=>{controlPath(path,'file');const stat=privateFileStat(path),bytes=readFileSync(path);if(stat.nlink!==1)throw Error('desktop_owner_unknown');snapshots.push({path,stat,bytes});return parse(bytes);};
 const exited=owner=>{if(identity(owner.pid)===owner.identity)throw Error('desktop_owner_conflict');if(!ownerGone(owner.pid))throw Error('desktop_owner_unknown');};
 const owner=read(file);
 if(owner.format!==1||typeof owner.runtime!=='string'||resolve(owner.runtime)!==owner.runtime||Object.keys(owner).some(key=>!['format','pid','identity','runtime'].includes(key)))throw Error('desktop_owner_unknown');
 const runtime=owner.runtime;controlPath(runtime,'directory');existingOwnedDirectory(runtime);
 if(process.platform==='win32')assertWindowsPrivate(runtime);else if(lstatSync(runtime).mode&0o077)throw Error('desktop_owner_unknown');
 exited(owner);
 for(const path of [join(runtime,'cli.lock'),join(runtime,'gateway/cli.lock')]){controlPath(path,'file');if(existsSync(path))exited(read(path));}
 const database=join(runtime,'homer.sqlite');
 for(const suffix of ['','-wal','-shm','-journal']){
  const path=database+suffix;controlPath(path,'file');const stat=lstatSync(path,{throwIfNoEntry:false});
  if(!stat){if(!suffix)throw Error('desktop_owner_unknown');continue;}
  if(stat.nlink!==1||(process.platform==='win32'?(assertWindowsPrivate(path),false):stat.uid!==process.getuid()||(stat.mode&0o022)!==0))throw Error('desktop_owner_unknown');
 }
 const db=new DatabaseSync(database,{readOnly:true});
 try{
  const leases=db.prepare("SELECT key,value FROM meta WHERE key LIKE 'lease:%' ORDER BY key").all();
  for(const row of leases)exited(parse(row.value));
  if(hash(db.prepare("SELECT key,value FROM meta WHERE key LIKE 'lease:%' ORDER BY key").all())!==hash(leases))throw Error('desktop_owner_recovery_unconfirmed');
 }finally{db.close();}
 for(const {path,stat,bytes}of snapshots){const current=privateFileStat(path);if(current.dev!==stat.dev||current.ino!==stat.ino||current.ctimeMs!==stat.ctimeMs||!readFileSync(path).equals(bytes))throw Error('desktop_owner_recovery_unconfirmed');}
 unlinkSync(file);
}
export function desktopBoundary(config,componentIdentity){
 // Stable across relocation/replacement of the .app. Account and data paths
 // retain their original exact identities; the fixed engine is content-bound.
 return hash([config.runtime,config.workspace,componentIdentity,config.codexHome,config.baseUrl,config.keyEnv,config.requiresOpenaiAuth]);
}
