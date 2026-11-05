// Reviewed rollback metadata only. Never loads config helpers, engines or channels.
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,lstatSync,realpathSync,existsSync,writeFileSync} from 'node:fs';
import {resolve,join,dirname,sep} from 'node:path';
import {createRequire} from 'node:module';
const hash=value=>createHash('sha256').update(value).digest('hex');
const jsonHash=value=>hash(JSON.stringify(value));
export function pinnedInventory(directory){
 const files=[];
 function visit(path){
  const full=join(directory,path),stat=lstatSync(full);
  if(stat.isSymbolicLink())throw Error('pinned_build_symlink_denied');
  if(stat.isDirectory())for(const name of readdirSync(full).sort())visit(join(path,name));
  else if(stat.isFile())files.push({path,sha256:hash(readFileSync(full))});
  else throw Error('pinned_build_file_invalid');
 }
 for(const name of ['dist','prompts','assets','package.json','package-lock.json',...(existsSync(join(directory,'scripts'))?['scripts']:[]),...(existsSync(join(directory,'.codex/skills'))?['.codex/skills']:[])])visit(name);
 return files;
}
export function dependencyIdentity(directory){
 const modules=realpathSync(join(directory,'node_modules'));
 const packages=[],seen=new Set(),lock=JSON.parse(readFileSync(join(directory,'package-lock.json'),'utf8'));
 function visit(name,from,optional=false){
  const require=createRequire(join(from,'package.json'));
  let path;
  try{path=dirname(require.resolve(name+'/package.json'));}
  catch{
   try{path=dirname(require.resolve(name));}
   catch(error){
    if(optional&&error.code==='MODULE_NOT_FOUND')return;
    if(error.code!=='ERR_PACKAGE_PATH_NOT_EXPORTED')throw error;
    path=require.resolve.paths(name)?.map(base=>join(base,name)).find(candidate=>existsSync(join(candidate,'package.json')));
    if(!path)throw error;
   }
   while(!existsSync(join(path,'package.json'))||JSON.parse(readFileSync(join(path,'package.json'),'utf8')).name!==name){const parent=dirname(path);if(parent===path)throw Error('pinned_dependency_unresolved');path=parent;}
  }
  path=realpathSync(path);if(seen.has(path))return;seen.add(path);
  const metadata=JSON.parse(readFileSync(join(path,'package.json'),'utf8'));
  const relative=path.startsWith(modules+sep)?'node_modules/'+path.slice(modules.length+1).split(sep).join('/'):undefined;
  if(!relative||lock.packages?.[relative]?.version!==metadata.version)throw Error('pinned_dependency_lock_mismatch');
  const files=[];
  function collect(part){for(const entry of readdirSync(join(path,part)).sort()){
   if(entry==='node_modules')continue;const item=join(part,entry),stat=lstatSync(join(path,item));
   if(stat.isSymbolicLink())throw Error('pinned_dependency_symlink_denied');
   if(stat.isDirectory())collect(item);else if(stat.isFile())files.push([item,hash(readFileSync(join(path,item)))]);
  }}
  collect('');packages.push({name,path,version:metadata.version,filesHash:jsonHash(files)});
  for(const dependency of Object.keys(metadata.dependencies??{}).sort())visit(dependency,path);
  for(const dependency of Object.keys(metadata.optionalDependencies??{}).sort())visit(dependency,path,true);
 }
 const metadata=JSON.parse(readFileSync(join(directory,'package.json'),'utf8'));
 for(const name of Object.keys(metadata.dependencies??{}).sort())visit(name,directory);
 for(const name of Object.keys(metadata.optionalDependencies??{}).sort())visit(name,directory,true);
 return {modules,installLockHash:hash(readFileSync(join(modules,'.package-lock.json'))),packages:packages.sort((a,b)=>a.path.localeCompare(b.path))};
}
export function pinnedConfigIdentity(path){
 const bytes=readFileSync(path),raw=JSON.parse(bytes);
 if(typeof raw.runtime!=='string'||typeof raw.workspace!=='string')throw Error('pinned_explicit_paths_required');
 return {sha256:hash(bytes),runtime:resolve(dirname(path),raw.runtime),workspace:resolve(dirname(path),raw.workspace)};
}
export function pinnedDatabaseIdentity(path){
 if(!existsSync(path))throw Error('pinned_database_missing');
 const db=new DatabaseSync(path,{readOnly:true});
 try{
  db.exec('PRAGMA query_only=ON;PRAGMA busy_timeout=3000;BEGIN');
  const schema=db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all();
  const metadata=Object.fromEntries(['mainThread','mainToolsHash','binding','bindingVersion','recursiveSchemaVersion','pendingSchemaVersion'].map(key=>[key,db.prepare('SELECT value FROM meta WHERE key=?').get(key)?.value??null]));
  const hasOutbox=schema.some(row=>row.type==='table'&&row.name==='wechat_outbox');
  const unknown=hasOutbox?db.prepare("SELECT * FROM wechat_outbox WHERE state='uncertain' ORDER BY id").all().map(row=>({identityHash:jsonHash(row.id),rowHash:jsonHash(row)})):[];
  const hasTable=name=>schema.some(row=>row.type==='table'&&row.name===name);
  const exists=sql=>!!db.prepare(sql).get();
  const runColumns=hasTable('runs')?db.prepare('PRAGMA table_info(runs)').all().map(row=>row.name):[];
  const executionReviewRequired=exists("SELECT 1 FROM meta WHERE key LIKE 'lease:%' LIMIT 1")||
   (hasTable('requests')&&exists("SELECT 1 FROM requests WHERE state!='completed' LIMIT 1"))||
   (hasTable('runs')&&exists("SELECT 1 FROM runs WHERE status NOT IN ('succeeded','failed','cancelled','interrupted') LIMIT 1"))||
   (runColumns.includes('phase')&&exists("SELECT 1 FROM runs WHERE phase IN ('uncertain','stopping') LIMIT 1"))||
   (hasTable('deliveries')&&exists("SELECT 1 FROM deliveries WHERE state IN ('prepared','submitting','uncertain') LIMIT 1"))||
   (hasTable('worker_interactions')&&exists("SELECT 1 FROM worker_interactions WHERE state IN ('pending_main','pending_user') OR (state IN ('approved','denied','answered') AND deliveredAt IS NULL) LIMIT 1"))||
   (hasTable('wechat_outbox')&&exists("SELECT 1 FROM wechat_outbox WHERE state='sending' LIMIT 1"))||
   (hasTable('tg_outbox')&&exists("SELECT 1 FROM tg_outbox WHERE state='sending' LIMIT 1"))||
   (hasTable('tasks')&&exists('SELECT 1 FROM tasks LIMIT 1'));
  const mediaVersion=hasTable('media_schema')?db.prepare('SELECT version FROM media_schema').get()?.version:null;
  return {schemaHash:jsonHash(schema),metadata,unknown,executionReviewRequired,mediaVersion};
 }finally{db.close();}
}
function reviewedSchema(directory,database){
 if(database.mediaVersion!=null&&(database.mediaVersion!==1||!existsSync(join(directory,'dist','media-store.js'))))throw Error('pinned_schema_unsupported');
 // The selected artifact must declare the exact persisted schema. A manifest
 // cannot authorize a different version to migrate or reinterpret these facts.
 for(const [key,owner] of [['recursiveSchemaVersion','store.js'],['pendingSchemaVersion','pending-items.js']]){
  const version=database.metadata[key];
  const file=join(directory,'dist',owner);
  const source=existsSync(file)?readFileSync(file,'utf8'):'';
  const declared=source.match(key==='recursiveSchemaVersion'?/STORE_SCHEMA_VERSION\s*=\s*['"]([0-9]+)['"]/:/PENDING_SCHEMA_VERSION\s*=\s*['"]([0-9]+)['"]/ )?.[1];
  const supported=version===declared;
  if(version!==null&&(!supported||!existsSync(file)))throw Error('pinned_schema_unsupported');
 }
}
export function preparePinned({directory,configPath,snapshot,thread,manifestPath}){
 directory=realpathSync(resolve(directory));configPath=realpathSync(resolve(configPath));
 const config=pinnedConfigIdentity(configPath),database=pinnedDatabaseIdentity(resolve(snapshot));
 if(!thread||database.metadata.mainThread!==thread)throw Error('pinned_thread_mismatch');
 reviewedSchema(directory,database);
 const manifest={format:1,node:process.version,cwd:process.cwd(),directory,configPath,config,database,dependencies:dependencyIdentity(directory),files:pinnedInventory(directory)};
 // Caller chooses a reviewed destination. Refuse overwrite and keep operational metadata private.
 writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
 return manifest;
}
export function verifyPinned(manifestPath,configPath){
 const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));configPath=realpathSync(resolve(configPath));
 if(manifest.format!==1||manifest.node!==process.version||manifest.cwd!==process.cwd())throw Error('pinned_runtime_incompatible');
 if(manifest.configPath!==configPath||jsonHash(pinnedConfigIdentity(configPath))!==jsonHash(manifest.config))throw Error('pinned_configuration_changed');
 if(jsonHash(pinnedInventory(manifest.directory))!==jsonHash(manifest.files))throw Error('pinned_build_changed');
 if(jsonHash(dependencyIdentity(manifest.directory))!==jsonHash(manifest.dependencies))throw Error('pinned_dependencies_changed');
 // Do not let loadConfig silently choose a different account, engine or model.
 if(['HOMER_CODEX_BIN','HOMER_CODEX_HOME','HOMER_MODEL','HOMER_EFFORT','HOMER_CODEX_BASE_URL','HOMER_CODEX_KEY_ENV'].some(key=>process.env[key]!==undefined))throw Error('pinned_environment_override_denied');
 const raw=JSON.parse(readFileSync(configPath,'utf8'));
 if(!raw.codexHome&&process.env.CODEX_HOME)throw Error('pinned_explicit_codex_home_required');
 const runtime=manifest.config.runtime;
 for(const path of [runtime,manifest.config.workspace,join(manifest.config.workspace,'materials'),join(manifest.config.workspace,'outputs')]){
  if(!existsSync(path)||!lstatSync(path).isDirectory())throw Error('pinned_workspace_missing');
  if(realpathSync(path)!==path)throw Error('pinned_path_changed');
 }
 if(existsSync(join(runtime,'cli.lock')))throw Error('pinned_runtime_lock_present');
 if(existsSync(join(runtime,'gateway','cli.lock')))throw Error('pinned_gateway_lock_present');
 const current=pinnedDatabaseIdentity(join(runtime,'homer.sqlite'));
 reviewedSchema(manifest.directory,current);
 if(current.metadata.mainThread!==manifest.database.metadata.mainThread)throw Error('pinned_thread_mismatch');
 if(current.schemaHash!==manifest.database.schemaHash)throw Error('pinned_schema_mismatch');
 if(jsonHash(current.metadata)!==jsonHash(manifest.database.metadata))throw Error('pinned_metadata_mismatch');
 if(!manifest.database.unknown.every(row=>current.unknown.some(after=>after.identityHash===row.identityHash&&after.rowHash===row.rowHash)))throw Error('pinned_unknown_facts_changed');
 if(current.executionReviewRequired)throw Error('pinned_execution_review_required');
 const transport=join(runtime,'gateway','transport.sqlite');
 if(existsSync(transport)){
  const db=new DatabaseSync(transport,{readOnly:true});
  try{db.exec('PRAGMA query_only=ON');if(db.prepare("SELECT 1 FROM transport_requests WHERE state='pending' LIMIT 1").get())throw Error('pinned_gateway_pending_review');}
  finally{db.close();}
 }
 return manifest;
}
