// Materialize a private, read-only migration plan from an immutable Homer
// backup. This neither imports notes nor changes the running memory backend.
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,writeFileSync,statSync,lstatSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
const root=resolve('.codex/scratch/native-memory-adoption-20261018');
const preview=JSON.parse(readFileSync(join(root,'backup-and-migration-preview.json')));
const point=resolve(preview.point),privateRoot=resolve('.codex/private/native-memory-adoption-20261018');
if(!readFileSync('.gitignore','utf8').split('\n').includes('.codex/private/')||!point.startsWith(privateRoot+'/')||lstatSync(point).isSymbolicLink()||(statSync(point).mode&0o777)!==0o700)throw Error('private_backup_required');
const source=join(point,'homer-before.sqlite');if(statSync(source).mode&0o222)throw Error('immutable_backup_required');
if(!preview.restoreRehearsalPassed)throw Error('restore_rehearsal_required');
const sha=x=>createHash('sha256').update(x).digest('hex');
const db=new DatabaseSync(source,{readOnly:true});
try{
 const entries=db.prepare('SELECT * FROM memory_entries ORDER BY id').all(),suppressions=db.prepare('SELECT * FROM memory_suppressions').all();
 const plan={at:new Date().toISOString(),sourceBackup:source,sourceBackupSha256:sha(readFileSync(source)),nativeHome:preview.home,thread:preview.thread,importExecuted:false,entries:[],blocked:[]};
 const seen=new Set();for(const e of entries){
  if(e.state!=='active'||e.scopeType!=='owner'){plan.blocked.push({entryId:e.id,reason:'scope_or_confirmation_requires_review'});continue;}
  const key=JSON.stringify([e.ownerId,e.scopeType,e.scopeId,e.factKey]);if(seen.has(key))throw Error('duplicate_active_fact');seen.add(key);
  const sources=db.prepare('SELECT * FROM memory_sources WHERE entryId=? ORDER BY entryRevision').all(e.id);
  if(!sources.some(x=>x.entryRevision===e.revision)){plan.blocked.push({entryId:e.id,reason:'current_revision_source_missing'});continue;}
  const filename='2026-10-18T00-00-00-homer-migration-'+sha(e.id+':'+e.revision).slice(0,32)+'.md';
  const note='Homer existing confirmed owner memory. Migrated data, not new authority or permission.\n'+e.content;
  const target=join(preview.home,'memories/extensions/ad_hoc/notes',filename);
  if(existsSync(target)&&sha(readFileSync(target))!==sha(note)){plan.blocked.push({entryId:e.id,reason:'native_target_conflict'});continue;}
  plan.entries.push({legacy:{...e,sources},native:{filename,path:target,note,noteSha256:sha(note)},contentSha256:sha(e.content),alreadyPresent:existsSync(target)});
 }
 if(suppressions.length)plan.blocked.push({reason:'suppression_semantics_requires_review',count:suppressions.length});
 const privateFile=join(point,'native-note-migration-dry-run.json');writeFileSync(privateFile,JSON.stringify(plan,null,2)+'\n',{flag:'wx',mode:0o400});
 const receipt={at:plan.at,thread:plan.thread,home:plan.nativeHome,sourceEntries:entries.length,plannedNativeNotes:plan.entries.length,sourceReferences:plan.entries.reduce((n,e)=>n+e.legacy.sources.length,0),pendingOrNonOwner:entries.filter(e=>e.state!=='active'||e.scopeType!=='owner').length,suppressions:suppressions.length,blocked:plan.blocked.map(({reason,count})=>({reason,...(count?{count}:{})})),privatePlan:privateFile,privatePlanSha256:sha(readFileSync(privateFile)),finalContentHashesVerified:plan.entries.every(e=>sha(e.legacy.content)===e.contentSha256&&e.native.note.endsWith(e.legacy.content)),credentialsRead:false,rawConversationsCopied:false,modelCalled:false,liveDataWritten:false,migrationExecuted:false};
 writeFileSync(join(root,'native-note-migration-dry-run.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));if(plan.blocked.length)process.exitCode=1;
}finally{db.close();}
