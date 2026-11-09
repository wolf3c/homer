import type { DatabaseSync } from 'node:sqlite';
import { createHash,randomUUID } from 'node:crypto';
import { mkdirSync,writeFileSync,renameSync,readFileSync,unlinkSync,existsSync,lstatSync,realpathSync,readdirSync,openSync,closeSync,fstatSync,constants } from 'node:fs';
import { join,resolve } from 'node:path';
import { MEDIA_POLICY,mediaLimit,type MediaKind } from './media-policy.js';
export type AttachmentRef={assetId:string;revision:number};
export type MediaView=AttachmentRef&{kind:MediaKind;state:string;mime:string|null;previewMime?:string;size:number;filename:string;error:string|null};
export type MediaAsset={id:string;requestId:string|null;bindingId:string|null;kind:MediaKind;revision:number;state:string;mime:string|null;size:number;hash:string|null;filename:string;error:string|null;attempt:number;lease:string|null;createdAt:number;expiresAt:number;originOperationKey:string|null};
const filenameOf=(name:string)=>name.replace(/[\x00-\x1f/\\]/g,'_').slice(0,120);
const stagingScope=(key:string)=>'operation:'+key;
export class MediaStore{
 constructor(readonly db:DatabaseSync,readonly directory?:string){
  const schema=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='media_schema'").get();
  const assets=db.prepare('PRAGMA table_info(media_assets)').all();
  if(schema?db.prepare('SELECT version FROM media_schema').get()?.version!==2||!assets.some(column=>column.name==='originOperationKey'):assets.length)throw Error('media_schema_unsupported');
  db.exec('SAVEPOINT media_schema_initialize');
  try{
   db.exec(`CREATE TABLE IF NOT EXISTS media_assets(id TEXT PRIMARY KEY,requestId TEXT,bindingId TEXT,kind TEXT NOT NULL,revision INTEGER NOT NULL,state TEXT NOT NULL,mime TEXT,size INTEGER NOT NULL,hash TEXT,filename TEXT NOT NULL,error TEXT,attempt INTEGER NOT NULL,lease TEXT,createdAt INTEGER NOT NULL,expiresAt INTEGER NOT NULL,originOperationKey TEXT,
   CHECK((originOperationKey IS NULL AND requestId IS NOT NULL AND bindingId IS NOT NULL) OR (originOperationKey IS NOT NULL AND requestId IS NULL AND bindingId IS NULL)));
   CREATE INDEX IF NOT EXISTS media_origin_operation ON media_assets(originOperationKey) WHERE originOperationKey IS NOT NULL;
   CREATE TABLE IF NOT EXISTS media_derivatives(assetId TEXT NOT NULL REFERENCES media_assets(id),revision INTEGER NOT NULL,sourceHash TEXT NOT NULL,transform TEXT NOT NULL,hash TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,width INTEGER NOT NULL,height INTEGER NOT NULL,PRIMARY KEY(assetId,revision,transform));
   CREATE TABLE IF NOT EXISTS media_schema(version INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS media_optional(assetId TEXT PRIMARY KEY REFERENCES media_assets(id));
   CREATE TABLE IF NOT EXISTS media_pins(assetId TEXT NOT NULL REFERENCES media_assets(id),revision INTEGER NOT NULL,scope TEXT NOT NULL,PRIMARY KEY(assetId,revision,scope));
   CREATE TABLE IF NOT EXISTS media_web_uploads(uploadId TEXT PRIMARY KEY,threadId TEXT NOT NULL,requestId TEXT NOT NULL,filename TEXT NOT NULL,hash TEXT NOT NULL,assetId TEXT NOT NULL UNIQUE REFERENCES media_assets(id));
   INSERT INTO media_schema SELECT 2 WHERE NOT EXISTS(SELECT 1 FROM media_schema);`);
   db.exec('RELEASE media_schema_initialize');
  }catch(error){
   db.exec('ROLLBACK TO media_schema_initialize');
   db.exec('RELEASE media_schema_initialize');
   throw error;
  }
  if(directory){mkdirSync(directory,{recursive:true,mode:0o700});if(lstatSync(directory).isSymbolicLink()||realpathSync(directory)!==resolve(directory))throw Error('media_directory_denied');}
 }
 intent(requestId:string,bindingId:string,kind:MediaKind,filename='附件',required=true):AttachmentRef{
  const id='asset-'+randomUUID(),now=Date.now();
  this.db.prepare("INSERT INTO media_assets(id,requestId,bindingId,kind,revision,state,size,filename,attempt,createdAt,expiresAt) VALUES(?,?,?,?,1,'received',0,?,0,?,?)").run(id,requestId,bindingId,kind,filenameOf(filename),now,now+MEDIA_POLICY.retentionMs);
  if(!required)this.db.prepare('INSERT INTO media_optional VALUES(?)').run(id);
  return {assetId:id,revision:1};
 }
 webIntent(input:{uploadId:string;threadId:string;requestId:string;filename:string;hash:string;kind:MediaKind}):AttachmentRef{
  const prior=this.db.prepare('SELECT * FROM media_web_uploads WHERE uploadId=?').get(input.uploadId);
  if(prior){
   if(['threadId','requestId','filename','hash'].some(k=>prior[k]!==input[k as keyof typeof input]))throw Error('web_upload_conflict');
   const ref={assetId:String(prior.assetId),revision:1};this.validate(input.requestId,[ref]);return ref;
  }
  if(this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='conversation_inputs'").get()&&this.db.prepare('SELECT 1 FROM conversation_inputs WHERE requestId=?').get(input.requestId))throw Error('web_upload_request_closed');
  if(this.db.prepare('SELECT 1 FROM media_assets WHERE requestId=? AND bindingId!=? LIMIT 1').get(input.requestId,'web:'+input.threadId))throw Error('media_scope_denied');
  if(Number(this.db.prepare("SELECT COUNT(*) n FROM media_assets WHERE requestId=? AND state NOT IN ('deleted','revoked','expired')").get(input.requestId)!.n)>=MEDIA_POLICY.maxItems)throw Error('media_attachment_limit');
  const ref=this.intent(input.requestId,'web:'+input.threadId,input.kind,input.filename);
  this.db.prepare('INSERT INTO media_web_uploads VALUES(?,?,?,?,?,?)').run(input.uploadId,input.threadId,input.requestId,input.filename,input.hash,ref.assetId);
  return ref;
 }
 discardWeb(input:{threadId:string;requestId:string;assetId:string;revision:number}){
  const asset=this.asset(input);
  if(asset.requestId!==input.requestId||asset.bindingId!=='web:'+input.threadId)throw Error('media_scope_denied');
  if(this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='conversation_inputs'").get()&&this.db.prepare('SELECT 1 FROM conversation_inputs WHERE requestId=?').get(input.requestId))throw Error('web_upload_request_closed');
  this.db.prepare("UPDATE media_assets SET state='revoked',lease=NULL WHERE id=? AND revision=? AND state NOT IN ('expired','deleted')").run(input.assetId,input.revision);
  return {state:'removed' as const};
 }
 asset(ref:AttachmentRef):MediaAsset{
  const row=this.db.prepare('SELECT * FROM media_assets WHERE id=? AND revision=?').get(ref.assetId,ref.revision) as MediaAsset|undefined;
  if(!row)throw Error('media_asset_not_found');return row;
 }
 view(ref:AttachmentRef):MediaView{const a=this.asset(ref),preview=this.db.prepare("SELECT mime FROM media_derivatives WHERE assetId=? AND revision=? AND mime LIKE 'audio/%' LIMIT 1").get(a.id,a.revision);return {...ref,kind:a.kind,state:a.state,mime:a.mime,...(preview?{previewMime:String(preview.mime)}:{}),size:a.size,filename:a.filename,error:a.error};}
 validate(requestId:string,refs:readonly AttachmentRef[]=[]){
  this.validateRefs(refs,asset=>asset.requestId===requestId&&asset.originOperationKey===null&&!['deleted','expired','revoked'].includes(asset.state));
 }
 // Attachment callers verify the source message grant before accessing these methods.
 validateAttachments(refs:readonly AttachmentRef[]){
  this.validateRefs(refs,asset=>this.originalAvailable(asset));
 }
 originalAvailable(asset:MediaAsset){
  // A derivative repair must not hide the previously verified original.
  return asset.state==='ready'||(asset.error==='media_derivative_missing'&&
   (asset.state==='retryable_failed'||asset.state==='failed')&&!!asset.hash&&!!asset.mime&&asset.size>0);
 }
 private validateRefs(refs:readonly AttachmentRef[],allowed:(asset:MediaAsset)=>boolean){
  if(refs.length>MEDIA_POLICY.maxItems||new Set(refs.map(r=>r.assetId)).size!==refs.length)throw Error('media_attachment_limit');
  let size=0;for(const ref of refs){const a=this.asset(ref);if(!allowed(a))throw Error('media_scope_denied');size+=a.size;}
  if(size>MEDIA_POLICY.messageBytes)throw Error('media_message_size_limit');
 }
 state(requestId:string,refs:AttachmentRef[]=[]):'ready'|'preparing'|'failed'{
  this.validate(requestId,refs);const rows=refs.map(ref=>this.asset(ref)).filter(a=>!this.db.prepare('SELECT 1 FROM media_optional WHERE assetId=?').get(a.id));
  if(rows.some(a=>['failed','expired','deleted','revoked'].includes(a.state)))return 'failed';
  return rows.every(a=>a.state==='ready'&&(a.kind!=='image'||!!this.db.prepare('SELECT 1 FROM media_derivatives WHERE assetId=? AND revision=?').get(a.id,a.revision)))?'ready':'preparing';
 }
 claim(ref:AttachmentRef){const lease=randomUUID();return this.db.prepare("UPDATE media_assets SET state='downloading',attempt=attempt+1,lease=?,error=NULL WHERE id=? AND revision=? AND originOperationKey IS NULL AND state IN ('received','retryable_failed') AND attempt<?").run(lease,ref.assetId,ref.revision,MEDIA_POLICY.attempts).changes?lease:undefined;}
 private path(id:string){if(!this.directory||!/^asset-[a-f0-9-]{36}$/.test(id))throw Error('media_storage_unavailable');return join(this.directory,id);}
 snapshot(operationKey:string,{filename,kind,mime,bytes}:{filename:string;kind:MediaKind;mime:string;bytes:Buffer}):AttachmentRef{
  if(this.db.isTransaction)throw Error('media_snapshot_transaction_conflict');
  if(!operationKey||!mime||/[\r\n]/.test(mime))throw Error('media_snapshot_invalid');
  if(!bytes.length||bytes.length>MEDIA_POLICY.fileBytes)throw Error('media_size_limit');
  const ref={assetId:'asset-'+randomUUID(),revision:1},lease=randomUUID(),now=Date.now();
  this.path(ref.assetId);
  this.db.exec('BEGIN IMMEDIATE');
  try{
   this.db.prepare("INSERT INTO media_assets(id,kind,revision,state,size,filename,attempt,lease,createdAt,expiresAt,originOperationKey) VALUES(?,?,1,'downloading',0,?,1,?,?,?,?)").run(ref.assetId,kind,filenameOf(filename),lease,now,now+MEDIA_POLICY.retentionMs,operationKey);
   this.insertPin(ref,stagingScope(operationKey));
   this.db.exec('COMMIT');
  }catch(error){this.db.exec('ROLLBACK');throw error;}
  this.ready(ref,lease,bytes,mime);
  return ref;
 }
 ready(ref:AttachmentRef,lease:string,bytes:Buffer,mime:string){
  const row=this.asset(ref);if(row.lease!==lease||row.state!=='downloading')throw Error('media_lease_superseded');
  if(!bytes.length||bytes.length>(row.originOperationKey?MEDIA_POLICY.fileBytes:mediaLimit(row.kind)))throw Error('media_size_limit');
  const hash=createHash('sha256').update(bytes).digest('hex');
  if(row.hash&&row.hash!==hash)throw Error('media_source_changed');
  // The new private temporary file coexists with the old original until rename.
  if(this.diskUsage()+bytes.length>MEDIA_POLICY.diskBytes)throw Error('media_disk_quota');
  const messageSize=Number(this.db.prepare(`SELECT COALESCE(SUM(size),0) AS n FROM media_assets WHERE ${row.originOperationKey?'originOperationKey':'requestId'}=? AND state='ready'`).get(row.originOperationKey??row.requestId)!.n);if(messageSize+bytes.length>MEDIA_POLICY.messageBytes)throw Error('media_message_size_limit');
  const path=this.path(row.id),temp=path+'.'+lease+'.part';
  try{writeFileSync(temp,bytes,{mode:0o600,flag:'wx'});renameSync(temp,path);
   const changed=this.db.prepare("UPDATE media_assets SET state='ready',mime=?,size=?,hash=?,lease=NULL,error=NULL WHERE id=? AND revision=? AND lease=? AND state='downloading'").run(mime,bytes.length,hash,row.id,ref.revision,lease);
   if(!changed.changes){unlinkSync(path);throw Error('media_lease_superseded');}
  }finally{try{unlinkSync(temp);}catch{}}
 }
 failed(ref:AttachmentRef,lease:string,error:string,retryable=false){
  this.db.prepare("UPDATE media_assets SET state=CASE WHEN ? AND attempt<? THEN 'retryable_failed' ELSE 'failed' END,error=?,lease=NULL WHERE id=? AND revision=? AND lease=? AND state='downloading'").run(retryable?1:0,MEDIA_POLICY.attempts,/^[a-z][a-z0-9_]{1,70}$/.test(error)?error:'media_prepare_failed',ref.assetId,ref.revision,lease);
 }
 read(requestId:string,ref:AttachmentRef){this.validate(requestId,[ref]);return this.readAttachment(ref);}
 readAttachment(ref:AttachmentRef){
  const asset=this.asset(ref);
  if(!this.originalAvailable(asset))throw Error(['deleted','expired','revoked'].includes(asset.state)?'media_scope_denied':'media_not_ready');
  const path=this.path(asset.id);
  let fd:number;
  try{fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);}
  catch(error){
   const code=(error as NodeJS.ErrnoException).code;
   if(code==='ELOOP')throw Error('media_file_denied');
   if(code==='ENOENT')throw Error('media_file_missing');
   throw error;
  }
  try{
   const stat=fstatSync(fd);
   if(!stat.isFile()||stat.nlink!==1)throw Error('media_file_denied');
   if(stat.size!==asset.size)throw Error('media_integrity_failed');
   const bytes=readFileSync(fd);
   if(bytes.length!==asset.size||createHash('sha256').update(bytes).digest('hex')!==asset.hash)throw Error('media_integrity_failed');
   return {asset,bytes,path};
  }finally{closeSync(fd);}
 }
 derivative(requestId:string,ref:AttachmentRef,value:{bytes:Buffer;mime:string;transform:string;width:number;height:number}){
  const {asset}=this.read(requestId,ref);if(!/^[\w-]{1,80}$/.test(value.transform))throw Error('media_transform_denied');
  const path=this.path(asset.id)+'.'+value.transform,hash=createHash('sha256').update(value.bytes).digest('hex');
  const existing=this.db.prepare('SELECT hash FROM media_derivatives WHERE assetId=? AND revision=? AND transform=?').get(asset.id,asset.revision,value.transform);
  if(existing&&existing.hash!==hash)throw Error('media_derivative_conflict');
  if(existsSync(path)){
   const stat=lstatSync(path);if(stat.isSymbolicLink()||!stat.isFile())throw Error('media_file_denied');
   if(existing&&createHash('sha256').update(readFileSync(path)).digest('hex')===hash)return value;
  }
  if(this.diskUsage()+value.bytes.length>MEDIA_POLICY.diskBytes)throw Error('media_disk_quota');
  const temp=path+'.'+randomUUID()+'.part';try{writeFileSync(temp,value.bytes,{mode:0o600,flag:'wx'});renameSync(temp,path);}finally{try{unlinkSync(temp);}catch{}}
  this.db.prepare('INSERT OR IGNORE INTO media_derivatives VALUES(?,?,?,?,?,?,?,?,?)').run(asset.id,asset.revision,asset.hash!,value.transform,hash,value.mime,value.bytes.length,value.width,value.height);
  return value;
 }
 imageSize(requestId:string,ref:AttachmentRef){
  this.validate(requestId,[ref]);const asset=this.asset(ref);
  if(asset.kind!=='image'||asset.state!=='ready')throw Error('media_not_ready');
  // Dimensions were verified by the existing decoder when this exact source
  // hash/revision was prepared. Do not allocate the full image to read its size.
  const row=this.db.prepare('SELECT width,height FROM media_derivatives WHERE assetId=? AND revision=? AND sourceHash=? ORDER BY rowid LIMIT 1').get(asset.id,asset.revision,asset.hash!);
  if(!row)throw Error('media_derivative_missing');return {width:Number(row.width),height:Number(row.height)};
 }
 image(requestId:string,ref:AttachmentRef){this.validate(requestId,[ref]);return this.imageAttachment(ref);}
 imageAttachment(ref:AttachmentRef){
  const {asset,bytes}=this.readAttachment(ref);
  const row=this.db.prepare('SELECT * FROM media_derivatives WHERE assetId=? AND revision=? AND sourceHash=? ORDER BY rowid LIMIT 1').get(asset.id,asset.revision,asset.hash!);
  if(!row){
   if(asset.originOperationKey&&asset.kind==='image'&&asset.mime)return {bytes,mime:asset.mime};
   throw Error('media_derivative_missing');
  }
  return {bytes:this.readDerivative(asset,row),mime:String(row.mime)};
 }
 extractedAttachment(ref:AttachmentRef){
  const {asset}=this.readAttachment(ref),row=this.db.prepare("SELECT * FROM media_derivatives WHERE assetId=? AND revision=? AND sourceHash=? AND mime='application/json' ORDER BY rowid DESC LIMIT 1").get(asset.id,asset.revision,asset.hash!);
  if(!row)return {state:'unavailable',error:'media_extraction_unavailable'};
  return JSON.parse(this.readDerivative(asset,row).toString());
 }
 previews(requestId:string,ref:AttachmentRef,mimePrefix:string){this.validate(requestId,[ref]);return this.previewsAttachment(ref,mimePrefix);}
 previewsAttachment(ref:AttachmentRef,mimePrefix:string){
  const {asset}=this.readAttachment(ref);
  return this.db.prepare('SELECT * FROM media_derivatives WHERE assetId=? AND revision=? AND sourceHash=? AND mime LIKE ? ORDER BY rowid').all(asset.id,asset.revision,asset.hash!,mimePrefix+'%').map(row=>({bytes:this.readDerivative(asset,row),mime:String(row.mime),transform:String(row.transform)}));
 }
 private readDerivative(asset:MediaAsset,row:{transform?:unknown;hash?:unknown}){
  const path=this.path(asset.id)+'.'+row.transform;
  if(lstatSync(path).isSymbolicLink())throw Error('media_file_denied');
  const bytes=readFileSync(path);
  if(createHash('sha256').update(bytes).digest('hex')!==row.hash)throw Error('media_integrity_failed');
  return bytes;
 }
 revoke(requestId:string){this.db.prepare("UPDATE media_assets SET state='revoked',lease=NULL WHERE requestId=? AND state NOT IN ('deleted','expired')").run(requestId);}
 retainRefs(requestId:string,refs:readonly AttachmentRef[]=[]){
  this.validate(requestId,refs);
  const keep=new Set(refs.map(ref=>ref.assetId+'@'+ref.revision));
  for(const row of this.db.prepare("SELECT id,revision FROM media_assets WHERE requestId=? AND state NOT IN ('deleted','expired','revoked')").all(requestId) as {id:string;revision:number}[]){
   if(!keep.has(row.id+'@'+row.revision))this.db.prepare("UPDATE media_assets SET state='revoked',lease=NULL WHERE id=? AND revision=?").run(row.id,row.revision);
  }
 }
 diskUsage(){
  // Count owned on-disk bytes, including a crashed write not yet in SQLite.
  if(this.directory)return readdirSync(this.directory).reduce((total,name)=>{const stat=lstatSync(join(this.directory!,name));return total+(stat.isFile()&&!stat.isSymbolicLink()?stat.size:0);},0);
  return Number(this.db.prepare("SELECT (SELECT COALESCE(SUM(size),0) FROM media_assets WHERE hash IS NOT NULL AND state!='deleted')+(SELECT COALESCE(SUM(size),0) FROM media_derivatives) n").get()!.n);
 }
 pin(requestId:string,ref:AttachmentRef,scope:string){this.validate(requestId,[ref]);this.insertPin(ref,scope);}
 pinAttachment(ref:AttachmentRef,scope:string){this.validateAttachments([ref]);this.insertPin(ref,scope);}
 private insertPin(ref:AttachmentRef,scope:string){
  if(!/^[\w:-]{1,150}$/.test(scope))throw Error('media_pin_scope_denied');
  this.db.prepare('INSERT OR IGNORE INTO media_pins VALUES(?,?,?)').run(ref.assetId,ref.revision,scope);
 }
 unpin(scope:string){this.db.prepare('DELETE FROM media_pins WHERE scope=?').run(scope);}
 abandonOperation(operationKey:string){
  this.db.exec('SAVEPOINT abandon_media_operation');
  try{
   this.unpin(stagingScope(operationKey));
   this.db.prepare(`UPDATE media_assets SET state='expired',lease=NULL,expiresAt=0 WHERE originOperationKey=? AND state NOT IN ('deleted','revoked')
    AND NOT EXISTS(SELECT 1 FROM media_pins p WHERE p.assetId=media_assets.id AND p.revision=media_assets.revision)`).run(operationKey);
   this.db.exec('RELEASE abandon_media_operation');
  }catch(error){this.db.exec('ROLLBACK TO abandon_media_operation');this.db.exec('RELEASE abandon_media_operation');throw error;}
 }
 reconcile(){
  // Called only by the unique service owner after old leases have drained.
  this.db.prepare("UPDATE media_assets SET state=CASE WHEN attempt<? THEN 'retryable_failed' ELSE 'failed' END,lease=NULL,error='media_prepare_interrupted' WHERE state='downloading'").run(MEDIA_POLICY.attempts);
  this.db.prepare("UPDATE media_assets SET state=CASE WHEN attempt<? THEN 'retryable_failed' ELSE 'failed' END,error='media_derivative_missing' WHERE state='ready' AND kind='image' AND originOperationKey IS NULL AND NOT EXISTS(SELECT 1 FROM media_derivatives d WHERE d.assetId=media_assets.id AND d.revision=media_assets.revision)").run(MEDIA_POLICY.attempts);
  if(this.directory)for(const a of this.db.prepare("SELECT id,revision,hash,originOperationKey FROM media_assets WHERE state='ready'").all()){
   const path=this.path(String(a.id));
   if(!existsSync(path)){this.db.prepare("UPDATE media_assets SET state='failed',error='media_file_missing' WHERE id=?").run(String(a.id));continue;}
   if(lstatSync(path).isSymbolicLink()||!lstatSync(path).isFile()){this.db.prepare("UPDATE media_assets SET state='failed',error='media_file_denied' WHERE id=?").run(String(a.id));continue;}
   if(a.originOperationKey)continue;
   for(const d of this.db.prepare('SELECT transform FROM media_derivatives WHERE assetId=? AND revision=? AND sourceHash=?').all(String(a.id),Number(a.revision),String(a.hash))){
    const derived=path+'.'+d.transform;
    if(!existsSync(derived)||lstatSync(derived).isSymbolicLink()||!lstatSync(derived).isFile()){
     this.db.prepare("UPDATE media_assets SET state=CASE WHEN attempt<? THEN 'retryable_failed' ELSE 'failed' END,error='media_derivative_missing' WHERE id=?").run(MEDIA_POLICY.attempts,String(a.id));break;
    }
   }
  }
 }
 gc(now=Date.now(),operationKey?:string){
  const has=(name:string)=>!!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
  const queue=has('agent_receipts')?" AND NOT EXISTS(SELECT 1 FROM agent_messages m JOIN agent_receipts r ON r.messageId=m.id WHERE json_extract(m.payloadJson,'$.requestId')=media_assets.requestId AND r.state IN ('pending','offered','received','uncertain','blocked'))":'';
  const scope=operationKey===undefined?'':' AND originOperationKey=?';
  const candidates=this.db.prepare("SELECT * FROM media_assets WHERE expiresAt<? AND state NOT IN ('deleted','downloading') AND NOT EXISTS(SELECT 1 FROM media_pins p WHERE p.assetId=media_assets.id AND p.revision=media_assets.revision)"+queue+scope)
   .all(now,...(operationKey===undefined?[]:[operationKey])) as MediaAsset[];
  for(const a of candidates){
   this.db.prepare("UPDATE media_assets SET state='expired',lease=NULL WHERE id=?").run(a.id);let clean=true;
   const transforms=this.db.prepare('SELECT transform FROM media_derivatives WHERE assetId=?').all(a.id).map(r=>String(r.transform));
   for(const path of [this.path(a.id),...transforms.map(t=>this.path(a.id)+'.'+t)])try{unlinkSync(path);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')clean=false;}
   if(clean){this.db.prepare('DELETE FROM media_derivatives WHERE assetId=?').run(a.id);this.db.prepare("UPDATE media_assets SET state='deleted' WHERE id=?").run(a.id);}
  }
  if(this.directory&&operationKey===undefined)for(const name of readdirSync(this.directory)){
   const match=name.match(/^(asset-[a-f0-9-]{36})(?:\.([\w-]{1,80}))?(?:\.[a-f0-9-]{36})?(\.part)?$/);if(!match)continue;
   const path=join(this.directory,name),stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.mtimeMs>=now-86400000)continue;
   const a=this.db.prepare('SELECT lease,state FROM media_assets WHERE id=?').get(match[1]!);if(a?.lease||a?.state==='downloading')continue;
   const known=!match[3]&&a&&a.state!=='deleted'&&(!match[2]||this.db.prepare('SELECT 1 FROM media_derivatives WHERE assetId=? AND transform=?').get(match[1]!,match[2]!));
   if(!known)try{unlinkSync(path);}catch{}
  }
  return candidates.length;
 }
}
