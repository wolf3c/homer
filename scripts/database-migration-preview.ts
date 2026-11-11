// Offline only: no Homer, engine, channel, keychain or credential provider is constructed.
import {DatabaseSync,backup} from 'node:sqlite';
import {chmodSync,copyFileSync,mkdirSync,readFileSync,statSync,writeFileSync} from 'node:fs';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {MediaStore} from '../src/media-store.js';
import {Store} from '../src/store.js';
import {Files} from '../src/files.js';
import {ConversationHistory} from '../src/web-history.js';
import {WorkerInteractions} from '../src/worker-interactions.js';
import {RecursiveTasks} from '../src/recursive-tasks.js';
const sha=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fileHash=(path:string)=>createHash('sha256').update(readFileSync(path)).digest('hex');
const quote=(value:string)=>'"'+value.replaceAll('"','""')+'"';
// Hash content internally; never emit rows, text, prompts, context, tokens or IDs.
function has(db:DatabaseSync,table:string){return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);}
function fingerprint(db:DatabaseSync,table:string,columns:string[]){
 const rows=db.prepare('SELECT '+columns.map(quote).join(',')+' FROM '+quote(table)+' ORDER BY rowid').all();
 return {count:rows.length,sha256:sha(rows)};
}
function capture(db:DatabaseSync){
 const tables:Record<string,{columns:string[];count:number;sha256:string}>={};
 const preservedTables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'meta' ORDER BY name").all().map(row=>String(row.name));
 for(const table of preservedTables){
  const columns=db.prepare('PRAGMA table_info('+quote(table)+')').all().map(r=>String(r.name));
  tables[table]={columns,...fingerprint(db,table,columns)};
 }
 const meta=has(db,'meta')?db.prepare('SELECT key,value FROM meta ORDER BY key').all():[];
 const thread=meta.find(r=>r.key==='mainThread')?.value;
 return {tables,meta,thread};
}
export async function previewMigration(snapshot:string,directory:string){
 snapshot=resolve(snapshot);directory=resolve(directory);
 const privateRoot=resolve('.codex/private'),scratchRoot=resolve('.codex/scratch');
 const inside=(root:string)=>{const rel=relative(root,directory);return !!rel&&!rel.startsWith('..')&&!isAbsolute(rel);};
 if(!inside(privateRoot)&&!inside(scratchRoot))throw Error('migration_preview_private_destination_required');
 // A fresh directory and immutable read-only input prevent in-place migration.
 mkdirSync(directory,{mode:0o700});chmodSync(directory,0o700);
 const before=join(directory,'before.sqlite'),candidate=join(directory,'candidate.sqlite'),rollback=join(directory,'rollback-restored.sqlite');
 const source=new DatabaseSync(snapshot,{readOnly:true});
 try{source.exec('PRAGMA query_only=ON;PRAGMA busy_timeout=3000');await backup(source,before,{rate:128});}finally{source.close();}
 chmodSync(before,0o600);copyFileSync(before,candidate);chmodSync(candidate,0o600);
 const baseline=new DatabaseSync(before,{readOnly:true});
 const original=capture(baseline),originalSchema=sha(baseline.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all());
 const integrityBefore=baseline.prepare('PRAGMA quick_check').get()?.quick_check;baseline.close();
 const stages:string[]=[];let error:string|undefined;let store:Store|undefined;
 try{
  store=new Store(candidate);stages.push('store');
  new WorkerInteractions(store.db);stages.push('interactions');
  new ConversationHistory(store.db);stages.push('history');
  new MediaStore(store.db);stages.push('media-schema-only');
  new RecursiveTasks(store,new Files(join(directory,'empty-workspace'))).migrate();stages.push('recursive');
 }catch(e){error=e instanceof Error&&/^[a-z][a-z0-9_]{1,90}$/.test(e.message)?e.message:'migration_preview_failed';}
 finally{store?.close();}
 const migrated=new DatabaseSync(candidate,{readOnly:true});
 const comparisons=Object.fromEntries(Object.entries(original.tables).map(([table,prior])=>{
  const after=fingerprint(migrated,table,prior.columns);return [table,{countBefore:prior.count,countAfter:after.count,unchanged:prior.count===after.count&&prior.sha256===after.sha256,beforeHash:prior.sha256,afterHash:after.sha256}];
 }));
 const current=capture(migrated);
 const oldMetaPreserved=original.meta.every(row=>current.meta.some(after=>after.key===row.key&&after.value===row.value));
 const schemaVersions=Object.fromEntries(['recursiveSchemaVersion'].map(key=>[key,migrated.prepare('SELECT value FROM meta WHERE key=?').get(key)?.value??null]));
 const candidateSchemaHash=sha(migrated.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all());
 const integrityAfter=migrated.prepare('PRAGMA quick_check').get()?.quick_check;
 const foreignKeyViolations=migrated.prepare('PRAGMA foreign_key_check').all().length;
 const counts=Object.fromEntries(['tasks','operations'].filter(t=>has(migrated,t)).map(t=>[t,migrated.prepare('SELECT count(*) n FROM '+quote(t)).get()?.n]));
 migrated.close();
 // Restore preview is an OFFLINE copy, never an overwrite of the source/live DB.
 copyFileSync(before,rollback);chmodSync(rollback,0o600);
 const restored=new DatabaseSync(rollback,{readOnly:true});
 const rollbackSchemaUnchanged=sha(restored.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all())===originalSchema;
 const rollbackFacts=capture(restored);restored.close();
 const receipt={at:new Date().toISOString(),offline:true,originalSchemaHash:originalSchema,candidateSchemaHash,schemaUnchanged:originalSchema===candidateSchemaHash,noEngineChannelOrKeychain:true,stages,error:error??null,integrityBefore,integrityAfter,foreignKeyViolations,schemaVersions,counts,
  mainThreadPreserved:current.thread===original.thread,originalMetadataPreserved:oldMetaPreserved,allowedMetadataChanges:[],tables:comparisons,
  rollback:{fileBytesMatch:fileHash(before)===fileHash(rollback),schemaUnchanged:rollbackSchemaUnchanged,factsUnchanged:sha(rollbackFacts)===sha(original)},
  permissions:{directory:statSync(directory).mode&0o777,before:statSync(before).mode&0o777,candidate:statSync(candidate).mode&0o777,rollback:statSync(rollback).mode&0o777},
  beforeFileHash:fileHash(before),candidateFileHash:fileHash(candidate),automaticActivationAllowed:false,
  passed:!error&&integrityBefore==='ok'&&integrityAfter==='ok'&&!foreignKeyViolations&&oldMetaPreserved&&current.thread===original.thread&&Object.values(comparisons).every(v=>v.unchanged)};
 writeFileSync(join(directory,'migration-preview-receipt.json'),JSON.stringify(receipt,null,2),{mode:0o600});
 return receipt;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [snapshot,directory]=process.argv.slice(2);if(!snapshot||!directory)throw Error('migration_preview_requires_snapshot_and_new_directory');
 const receipt=await previewMigration(snapshot,directory);
 process.stdout.write(JSON.stringify({passed:receipt.passed,error:receipt.error,stages:receipt.stages,mainThreadPreserved:receipt.mainThreadPreserved,changedTables:Object.entries(receipt.tables).filter(([,v])=>!v.unchanged).map(([name])=>name),rollback:receipt.rollback})+'\n');
 if(!receipt.passed)process.exitCode=1;
}
