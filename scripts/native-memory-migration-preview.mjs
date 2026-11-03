// Read-only consistent backup and restore rehearsal. Never restores a live DB.
import {existsSync,mkdirSync,lstatSync,readFileSync,writeFileSync,readdirSync,cpSync,chmodSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync,backup} from 'node:sqlite';
const path=process.argv[2];if(!path)throw Error('explicit_homer_config_required');
if(!readFileSync('.gitignore','utf8').split('\n').includes('.codex/private/'))throw Error('private_not_ignored');
const configPath=resolve(path),raw=JSON.parse(readFileSync(configPath,'utf8')),base=dirname(configPath);
const home=resolve(base,raw.codexHome),runtime=resolve(base,raw.runtime);
if(home!==resolve(raw.nativeCodexHome??join(raw.appData??join(process.env.HOME,'Library/Application Support/Homer'),'codex')))throw Error('dedicated_home_required');
const publicRoot=resolve('.codex/scratch/native-memory-adoption-20261018');mkdirSync(publicRoot,{recursive:true});
const privateRoot=resolve('.codex/private/native-memory-adoption-20261018');mkdirSync(privateRoot,{recursive:true,mode:0o700});
if(lstatSync(privateRoot).isSymbolicLink()||(lstatSync(privateRoot).mode&0o777)!==0o700)throw Error('private_permissions_invalid');
const point=join(privateRoot,'before-'+Date.now());mkdirSync(point,{mode:0o700});
const state=await fetch('http://127.0.0.1:4780/api/state').then(r=>r.json());
const active=state.queue.filter(x=>!['completed','failed','interrupted','cancelled','canceled','superseded'].includes(x.state));
if(state.isRunning||state.work.length||state.interactions.length||active.length||state.upgrade.transportPending.length)throw Error('daily_not_idle');
const caps=await fetch('http://127.0.0.1:4780/api/capabilities').then(r=>r.json());
if(!caps.boundToNativeHome||!caps.account?.connected||caps.settingsPath!==join(home,'config.toml'))throw Error('native_binding_not_confirmed');
const sha=b=>createHash('sha256').update(b).digest('hex');
const sqliteBackup=async(source,target)=>{const connection=new DatabaseSync(source,{readOnly:true});try{await backup(connection,target);}finally{connection.close();}chmodSync(target,0o600);};
await sqliteBackup(join(runtime,'homer.sqlite'),join(point,'homer-before.sqlite'));
const db=new DatabaseSync(join(point,'homer-before.sqlite'),{readOnly:true});
const memoryCounts={};for(const name of ['memory_entries','memory_sources','memory_operations','memory_suppressions','memory_jobs','memory_snapshots'])memoryCounts[name]=db.prepare('SELECT COUNT(*) n FROM '+name).get().n;
const entryStates=db.prepare('SELECT state,scopeType,COUNT(*) n FROM memory_entries GROUP BY state,scopeType').all();
const uncertain=db.prepare("SELECT * FROM wechat_outbox WHERE state='uncertain' ORDER BY id").all().map(x=>sha(JSON.stringify(x)));
const main=db.prepare("SELECT value FROM meta WHERE key='mainThread'").get()?.value;
if(main!==state.threadId)throw Error('main_thread_mismatch');db.close();
const nativeRoot=join(point,'native');mkdirSync(nativeRoot,{mode:0o700});
const nativeDatabases=readdirSync(home).filter(x=>/^(state_\d+|memories.*)\.sqlite$/.test(x));
for(const name of nativeDatabases)await sqliteBackup(join(home,name),join(nativeRoot,name));
const copiedMemoryRoots=[];
for(const name of ['memories','memories_v2','memories_extensions'])if(existsSync(join(home,name))){cpSync(join(home,name),join(nativeRoot,name),{recursive:true,dereference:false});copiedMemoryRoots.push(name);}
writeFileSync(join(point,'homer-config-before.json'),readFileSync(configPath),{mode:0o600});
writeFileSync(join(point,'native-config-before.toml'),readFileSync(join(home,'config.toml')),{mode:0o600});
// No authentication store or unrelated rollout is read or copied.
const nativeState=existsSync(join(home,'state_5.sqlite'))?new DatabaseSync(join(home,'state_5.sqlite'),{readOnly:true}):undefined;
let nativeThreadModes=[];if(nativeState){nativeThreadModes=nativeState.prepare('SELECT memory_mode,COUNT(*) n FROM threads GROUP BY memory_mode').all();nativeState.close();}
const rehearsal=join(point,'restore-rehearsal.sqlite');await sqliteBackup(join(point,'homer-before.sqlite'),rehearsal);
const restored=new DatabaseSync(rehearsal,{readOnly:true});
if(restored.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('rehearsal_integrity_failed');
for(const [name,n]of Object.entries(memoryCounts))if(restored.prepare('SELECT COUNT(*) n FROM '+name).get().n!==n)throw Error('rehearsal_counts_failed');
if(restored.prepare("SELECT value FROM meta WHERE key='mainThread'").get().value!==main)throw Error('rehearsal_thread_failed');restored.close();
// The rollback source is immutable evidence, never a writable live database.
for(const name of ['homer-before.sqlite','restore-rehearsal.sqlite'])chmodSync(join(point,name),0o400);
for(const name of nativeDatabases)chmodSync(join(nativeRoot,name),0o400);
const receipt={at:new Date().toISOString(),point,thread:main,version:state.upgrade.version,home,memoryCounts,entryStates,uncertainCount:uncertain.length,nativeDatabases,copiedMemoryRoots,nativeThreadModes,restoreRehearsalPassed:true,liveDataWritten:false,credentialsCopied:false,migrationExecuted:false};
writeFileSync(join(point,'backup-and-preview.json'),JSON.stringify({...receipt,uncertain},null,2)+'\n',{mode:0o600});
writeFileSync(join(publicRoot,'backup-and-migration-preview.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
