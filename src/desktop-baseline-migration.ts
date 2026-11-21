import {constants,closeSync,copyFileSync,createReadStream,existsSync,fsyncSync,lstatSync,mkdirSync,openSync,readdirSync,realpathSync,renameSync,rmSync,writeSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {createInterface} from 'node:readline';
import {backup,DatabaseSync} from 'node:sqlite';
import {MAIN_TOOLS_HASH} from './recursive-tools.js';
import {storedWorkSafeToUpgrade} from './recursive-tasks.js';
import {STORE_SCHEMA_VERSION,TASK_COLUMNS,TASK_INDEXES} from './store.js';

const legacyHashes=new Set([
 '615506d5ebbfc9ade218daa6793de1b0318d10a3016463b99da0395d498aaccf',
 '2741b9169535017c5b55d191ee7a246333f0074ee0162a951be11f370cd84b19',
 'd8a4bd52a287759bcbcd4eb754a8e41e344ac6e1ab287576f4c8b2172202f150',
 'f579ad37daedcef8a429e13a0511668b2ef954abbc180e47b408475c5395cffe',
]);
const legacyMain='archive_work,list_work,restore_work,task_create,task_update,work_inspect,worker_interrupt,worker_open,worker_read,worker_send';
const legacyMainWithSend='archive_work,list_work,restore_work,send_user_message,task_create,task_update,work_inspect,worker_interrupt,worker_open,worker_read,worker_send';
const legacyWorker='ask_main,stage_file_result',legacyWorkerWithVoice='ask_main,create_voice_result,stage_file_result';
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
type Edit={at:number;bytes:Buffer};
type Rollout={id:string;path:string;edits:Edit[]};
const unsupported=():never=>{throw Error('main_tools_migration_required');};

function privateFile(path:string){
 const stat=lstatSync(path);
 if(!stat.isFile()||stat.nlink!==1||realpathSync(path)!==path)throw Error('desktop_schema_incompatible');
 return stat;
}

async function rolloutEdits(path:string,id:string,main:boolean){
 const stat=privateFile(path);
 const input=createReadStream(path),reader=createInterface({input,crlfDelay:Infinity});
 const edits:Edit[]=[];
 let offset=0,hasHeader=false;
 try{
  for await(const line of reader){
   const at=offset;offset+=Buffer.byteLength(line)+1;
   if(at!==0&&!line.includes('"dynamic_tools"'))continue;
   const item=JSON.parse(line);
   if(at===0){if(item.type!=='session_meta'||item.payload?.id!==id)unsupported();hasHeader=true;}
   const initial=item.type==='session_meta';
   const value=initial?item.payload?.dynamic_tools:item.type==='compacted'?item.payload?.resume_metadata?.dynamic_tools:undefined;
   if(value==null)continue;
   if(initial?item.payload.id!==id:value.thread_id!==id)unsupported();
   const tools=initial?value:value.tools;
   if(!Array.isArray(tools))unsupported();
   if(!tools.length)continue;
   const names=tools.map((tool:{name?:string})=>tool?.name).sort().join(',');
   if(!(main?[legacyMain,legacyMainWithSend]:[legacyWorker,legacyWorkerWithVoice]).includes(names))unsupported();
   const legacy=JSON.stringify(value),field='"dynamic_tools":'+legacy,index=line.indexOf(field);
   if(index<0||line.indexOf(field,index+field.length)>=0)unsupported();
   const replacement=JSON.stringify(initial?[]:{...value,tools:[]});
   const length=Buffer.byteLength(legacy);
   if(Buffer.byteLength(replacement)>length)unsupported();
   const bytes=Buffer.alloc(length,0x20);bytes.write(replacement);
   // Native history indexes store byte offsets into this file, including after compaction.
   edits.push({at:at+Buffer.byteLength(line.slice(0,index+'"dynamic_tools":'.length)),bytes});
  }
 }finally{reader.close();input.destroy();}
 if(!hasHeader||offset!==stat.size)unsupported();
 return edits;
}

function flush(path:string){const fd=openSync(path,'r');try{fsyncSync(fd);}finally{closeSync(fd);}}
function publish(temp:string,path:string){
 flush(temp);renameSync(temp,path);
 if(process.platform!=='win32')flush(dirname(path));
}

function rewriteRollout(item:Rollout,directory:string){
 const before=join(directory,item.id+'.jsonl'),temp=join(directory,item.id+'.pending');
 rmSync(temp,{force:true});
 try{
  if(!existsSync(before)){
   copyFileSync(item.path,temp,constants.COPYFILE_FICLONE);
   publish(temp,before);
  }else privateFile(before);
  copyFileSync(item.path,temp,constants.COPYFILE_FICLONE);
  const fd=openSync(temp,'r+');
  try{for(const edit of item.edits)if(writeSync(fd,edit.bytes,0,edit.bytes.length,edit.at)!==edit.bytes.length)throw Error('desktop_baseline_write_unconfirmed');}
  finally{closeSync(fd);}
  publish(temp,item.path);
 }finally{rmSync(temp,{force:true});}
}

// Called by the packaged runtime while it owns the stopped desktop profile.
export async function migrateDesktopBaseline(runtime:string,codexHome:string){
 const database=join(runtime,'homer.sqlite');privateFile(database);
 const db=new DatabaseSync(database,{enableForeignKeyConstraints:false});
 try{
  const meta=(key:string)=>db.prepare('SELECT value FROM meta WHERE key=?').get(key)?.value as string|undefined;
  if(meta('recursiveSchemaVersion')===STORE_SCHEMA_VERSION)return;
  if(meta('recursiveSchemaVersion')!=='8')throw Error('desktop_schema_incompatible');
  if(existsSync(join(runtime,'cli.lock'))||existsSync(join(runtime,'gateway','cli.lock'))||db.prepare("SELECT 1 FROM meta WHERE key LIKE 'lease:%' LIMIT 1").get()||
   db.prepare("SELECT 1 FROM tasks WHERE controlState<>'normal' LIMIT 1").get()||!storedWorkSafeToUpgrade(db,true))throw Error('desktop_run_review_required');
  if(db.prepare('PRAGMA foreign_key_check').get())throw Error('desktop_schema_incompatible');
  const main=meta('mainThread'),hash=meta('mainToolsHash');
  if(main?!hash||!legacyHashes.has(hash):hash!==undefined)unsupported();
  const head=(thread:string)=>meta('nativeThreadHead:v1:'+thread)??thread;
  const mainId=main?head(main):undefined;
  const ids=new Set(db.prepare('SELECT DISTINCT threadId FROM runs WHERE threadId IS NOT NULL').all().map(row=>head(String(row.threadId))));
  if(mainId&&ids.has(mainId)||!main&&ids.size)unsupported();
  if(mainId)ids.add(mainId);
  if([...ids].some(id=>!uuid.test(id)))unsupported();
  const plans:Rollout[]=[];
  if(ids.size){
   const state=join(codexHome,'state_5.sqlite');privateFile(state);
   const native=new DatabaseSync(state,{readOnly:true});
   try{const check=native.prepare('SELECT 1 FROM thread_dynamic_tools WHERE thread_id=? LIMIT 1');for(const id of ids)if(check.get(id))unsupported();}
   finally{native.close();}
   const files=new Map<string,string>();
   for(const folder of ['sessions','archived_sessions']){
    const root=join(codexHome,folder);if(!existsSync(root))continue;
    if(realpathSync(root)!==root)unsupported();
    for(const file of readdirSync(root,{recursive:true,withFileTypes:true})){
     if(!file.name.endsWith('.jsonl'))continue;
     const id=file.name.slice(-42,-6);if(!ids.has(id))continue;
     if(files.has(id))unsupported();
     files.set(id,join(file.parentPath,file.name));
    }
   }
   for(const id of ids){
    const path=files.get(id)??unsupported(),edits=await rolloutEdits(path,id,id===mainId);
    if(edits.length)plans.push({id,path,edits});
   }
  }
  const directory=join(codexHome,'homer-baseline-v8-backup');
  if(!existsSync(directory)){mkdirSync(directory,{mode:0o700});if(process.platform!=='win32')flush(codexHome);}
  if(realpathSync(directory)!==directory||!lstatSync(directory).isDirectory())throw Error('desktop_schema_incompatible');
  const saved=join(directory,'homer.sqlite'),temp=join(directory,'homer.sqlite.pending');
  if(!existsSync(saved)){
   rmSync(temp,{force:true});
   try{await backup(db,temp);publish(temp,saved);}finally{rmSync(temp,{force:true});}
  }else{
   privateFile(saved);
   const previous=new DatabaseSync(saved,{readOnly:true});
   try{
    const old=previous.prepare('SELECT value FROM meta WHERE key=?');
    if(old.get('recursiveSchemaVersion')?.value!=='8'||old.get('mainThread')?.value!==main||old.get('mainToolsHash')?.value!==hash||
     JSON.stringify(previous.prepare('SELECT * FROM tasks ORDER BY rowid').all())!==JSON.stringify(db.prepare('SELECT * FROM tasks ORDER BY rowid').all()))throw Error('desktop_baseline_backup_changed');
   }finally{previous.close();}
  }
  for(const item of plans)rewriteRollout(item,directory);
  const columns='rowid,id,title,headVersion,notes,state,revision,historyState,createdAt,updatedAt';
  db.exec('PRAGMA synchronous=FULL; BEGIN IMMEDIATE;');
  try{
   db.exec(`CREATE TABLE tasks_v9${TASK_COLUMNS};
    INSERT INTO tasks_v9(${columns}) SELECT rowid,id,title,headVersion,notes,CASE state WHEN 'settled' THEN 'paused' ELSE state END,revision,historyState,createdAt,updatedAt FROM tasks;
    DROP TABLE tasks; ALTER TABLE tasks_v9 RENAME TO tasks; ${TASK_INDEXES}`);
   if(db.prepare('PRAGMA foreign_key_check').get())throw Error('desktop_schema_incompatible');
   if(main)db.prepare("UPDATE meta SET value=? WHERE key='mainToolsHash'").run(MAIN_TOOLS_HASH);
   db.prepare("UPDATE meta SET value=? WHERE key='recursiveSchemaVersion'").run(STORE_SCHEMA_VERSION);
   db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
 }finally{db.close();}
}
