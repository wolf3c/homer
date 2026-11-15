import {CommittedDatabase} from './committed-database.js';
import {SCHEDULE_SCHEMA} from './schedules.js';
import {DatabaseSync} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,realpathSync,statSync} from 'node:fs';

export const STORE_SCHEMA_VERSION='8';
export const READABLE_STORE_SCHEMA_VERSIONS:readonly string[]=['6','7',STORE_SCHEMA_VERSION];
export type MainReceiptScope={mainAgentId:string;mainThreadId:string};
export type MainReceiptEvidence={messageId:string;recipientAgentId:string;threadId:string;kind:string;sourceState:string;revision:number;nativeTurnId:string|null;processId:string|null;targetState:'pending'|'received'|'uncertain'|'rejected'|'invalid';reason:string};
export type MainReceiptPreview={sourceSchema:string;scope:MainReceiptScope;rows:MainReceiptEvidence[];fingerprint:string};
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const memoryIdentities=new WeakMap<DatabaseSync,string>();
const hasTable=(db:DatabaseSync,name:string)=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
function databaseIdentity(db:DatabaseSync){
 const file=String(db.prepare('PRAGMA database_list').all().find(row=>row.name==='main')?.file??'');
 if(file){const path=realpathSync(file),stat=statSync(path);return digest([path,stat.dev,stat.ino]);}
 if(!memoryIdentities.has(db))memoryIdentities.set(db,randomUUID());
 return memoryIdentities.get(db)!;
}
function object(value:unknown):Record<string,any>{try{const parsed=JSON.parse(String(value));if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))return parsed;}catch{}throw Error('main_receipt_evidence_invalid');}
function sourceOperationMatches(row:Record<string,any>,agent:string,payload:Record<string,any>,details:Record<string,any>,response:Record<string,any>|null){
 if(row.operationState!=='confirmed')return false;
 if(row.kind==='user_input')return row.senderAgentId==='user:'+agent&&row.operationActor===row.senderAgentId&&row.operationKind==='user_accept'&&row.operationScope===payload.requestId&&row.operationId==='accept'&&response?.messageId===row.id&&response?.replyId===row.replyId;
 if(row.senderAgentId!=='host')return false;
 if(row.kind==='scheduled_message')return row.operationActor==='host'&&row.operationKind==='schedule_delivery'&&row.operationScope==='scheduled-deliveries'&&row.operationId===payload.deliveryId&&response?.messageId===row.id&&details.threadId===payload.threadId;
 if(row.operationScope!==row.taskId)return false;
 if(row.kind==='worker_reply')return row.operationActor==='host'&&row.operationKind==='worker_return'&&response?.messageId===row.id;
 if(row.kind==='interaction_required')return row.operationActor==='host'&&row.operationKind==='interaction_notice'&&row.operationId==='interaction:'+payload.interactionId;
 return row.kind==='task_archived'&&row.operationActor===agent&&row.operationKind==='archive_work'&&response?.taskId===row.taskId&&response?.state==='archived';
}
export function inspectMainReceiptEvidence(db:DatabaseSync,scope:MainReceiptScope):MainReceiptPreview{
 if(!hasTable(db,'meta')||!hasTable(db,'agent_messages')||!hasTable(db,'agent_receipts'))throw Error('main_receipt_schema_unsupported');
 const meta=(key:string)=>db.prepare('SELECT value FROM meta WHERE key=?').get(key)?.value;
 const sourceSchema=String(meta('recursiveSchemaVersion')??'');
 if(!READABLE_STORE_SCHEMA_VERSIONS.includes(sourceSchema)||meta('mainAgentId')!==scope.mainAgentId||String(meta('mainThread')??'')!==scope.mainThreadId)throw Error('main_receipt_scope_invalid');
 if(db.prepare(`SELECT 1 FROM agent_messages m LEFT JOIN agent_receipts r ON r.messageId=m.id
   WHERE m.recipientAgentId=? AND m.targetRunId IS NULL AND r.messageId IS NULL LIMIT 1`).get(scope.mainAgentId)||
   db.prepare('SELECT 1 FROM agent_receipts r LEFT JOIN agent_messages m ON m.id=r.messageId WHERE r.recipientAgentId=? AND m.id IS NULL LIMIT 1').get(scope.mainAgentId))throw Error('main_receipt_evidence_invalid');
 const raw=db.prepare(`SELECT m.*,r.recipientAgentId receiptRecipientAgentId,r.state sourceState,r.revision receiptRevision,r.offeredTurnId,r.processedBy,o.detailsJson,
   o.actorAgentId operationActor,o.kind operationKind,o.scopeId operationScope,o.operationId,o.state operationState,o.responseJson,
   i.threadId inputThreadId,s.threadId sourceThreadId,i.replyId,q.state requestState
   FROM agent_messages m JOIN agent_receipts r ON r.messageId=m.id
   LEFT JOIN operations o ON o.id=m.operationKey
   LEFT JOIN conversation_inputs i ON m.kind='user_input' AND i.requestId=json_extract(m.payloadJson,'$.requestId')
   LEFT JOIN task_versions v ON v.taskId=m.taskId AND v.version=m.taskVersion
   LEFT JOIN conversation_inputs s ON s.requestId=CASE WHEN m.kind='task_archived' THEN json_extract(o.detailsJson,'$.sourceRequestId') ELSE v.sourceRequestId END
   LEFT JOIN requests q ON m.kind='user_input' AND q.id=json_extract(m.payloadJson,'$.requestId')
   WHERE (m.recipientAgentId=? OR r.recipientAgentId=?) AND m.targetRunId IS NULL ORDER BY m.seq,r.recipientAgentId`).all(scope.mainAgentId,scope.mainAgentId);
 const nodeRows=db.prepare("SELECT key,value FROM meta WHERE key GLOB 'publicMainNode:v1:*' ORDER BY key").all();
 const queueRows=db.prepare("SELECT scopeId,responseJson FROM operations WHERE kind='user_queue_change' AND actorAgentId=? AND state='confirmed' ORDER BY rowid").all('user:'+scope.mainAgentId);
 const queueRevisions=new Map<string,Set<number>>(),userMessages=new Map(raw.filter(row=>row.kind==='user_input').map(row=>[object(row.payloadJson).requestId,String(row.id)]));
 const queueRevision=(messageId:string|undefined,revision:unknown)=>{if(messageId&&Number.isSafeInteger(revision)&&Number(revision)>0){const values=queueRevisions.get(messageId)??new Set<number>();values.add(Number(revision));queueRevisions.set(messageId,values);}};
 for(const change of queueRows){
  const response=object(change.responseJson);if(response.state!=='queued')continue;
  if(response.action==='move'&&Array.isArray(response.changed))for(const row of response.changed)queueRevision(typeof row.messageId==='string'?row.messageId:undefined,row.revision);
  else if(response.requestId===change.scopeId)queueRevision(userMessages.get(response.requestId),response.revision);
 }
 const nodes=nodeRows.map(row=>object(row.value));
 const byMessage=new Map<string,Record<string,any>[]>();
 for(const node of nodes){
  if(!Array.isArray(node.sourceMessageIds)||!Array.isArray(node.turnIds))throw Error('main_receipt_evidence_invalid');
  for(const id of node.sourceMessageIds){if(typeof id!=='string')throw Error('main_receipt_evidence_invalid');const values=byMessage.get(id)??[];values.push(node);byMessage.set(id,values);}
 }
 const rows:MainReceiptEvidence[]=raw.map(row=>{
  const payload=object(row.payloadJson),details=object(row.detailsJson),response=row.responseJson===null?null:object(row.responseJson),matching=byMessage.get(String(row.id))??[];
  const native=row.kind==='user_input'?details.turnId:row.offeredTurnId??row.processedBy;
  const thread=row.kind==='user_input'?row.inputThreadId:row.kind==='scheduled_message'?payload.threadId:row.sourceThreadId??matching[0]?.threadId;
  const current=matching.filter(node=>node.threadId===thread);
  const exact=current.find(node=>typeof native==='string'&&node.turnIds.includes(native));
  const result:MainReceiptEvidence={messageId:String(row.id),recipientAgentId:String(row.receiptRecipientAgentId),threadId:typeof thread==='string'?thread:'',kind:String(row.kind),sourceState:String(row.sourceState),revision:Number(row.receiptRevision),nativeTurnId:typeof native==='string'?native:null,processId:exact?.id??null,targetState:'uncertain',reason:'acceptance_unconfirmed'};
  if(!sourceOperationMatches(row,scope.mainAgentId,payload,details,response)){result.targetState='invalid';result.reason='source_operation_mismatch';return result;}
  if(!result.threadId||!Number.isSafeInteger(result.revision)||row.recipientAgentId!==scope.mainAgentId||result.recipientAgentId!==scope.mainAgentId||matching.some(node=>node.threadId!==thread)||
    row.kind==='scheduled_message'&&payload.instanceId!==scope.mainAgentId||
    native&&current.length&&!exact){result.targetState='invalid';result.reason='identity_mismatch';return result;}
  // User native ID is committed by startedInTransaction; generation is a distinct reference.
  const userAck=row.kind==='user_input'&&typeof native==='string'&&!!native&&typeof row.offeredTurnId==='string'&&!!row.offeredTurnId;
  const recovered=current.find(node=>node.turnIds.some((id:unknown)=>typeof id==='string'&&Number.isFinite(node.turnClocks?.[id]?.hostStartedAtMs)));
  if(userAck||exact||!native&&recovered){
   result.targetState='received';result.reason='native_acceptance';
   if(!result.nativeTurnId){result.nativeTurnId=recovered!.turnIds.find((id:string)=>Number.isFinite(recovered!.turnClocks?.[id]?.hostStartedAtMs));result.processId=recovered!.id;}
  }else if(!native&&!matching.length&&!row.offeredTurnId){
   if(row.sourceState==='rejected'&&row.kind==='user_input'&&['cancelled','failed'].includes(payload.terminal)){result.targetState='rejected';result.reason='before_delivery_rejection';}
   else if(row.sourceState==='pending'&&!row.requestState){
    const revisions=queueRevisions.get(result.messageId)??new Set<number>();
    if(revisions.size===result.revision&&[...revisions].every(revision=>revision<=result.revision)){result.targetState='pending';result.reason='never_offered';}
   }
  }
  return result;
 });
 const nativeOwners=new Map<string,MainReceiptEvidence>();
 for(const row of rows)if(row.kind==='user_input'&&row.targetState==='received'&&row.nativeTurnId){
  const key=JSON.stringify([row.threadId,row.nativeTurnId]),other=nativeOwners.get(key);
  if(other){row.targetState=other.targetState='invalid';row.reason=other.reason='native_identity_reused';}else nativeOwners.set(key,row);
 }
 return {sourceSchema,scope,rows,fingerprint:digest({database:databaseIdentity(db),sourceSchema,scope,raw,nodeRows,queueRows})};
}
export function assertMainReceiptOwnersClosed(db:DatabaseSync){
 if(db.prepare("SELECT 1 FROM meta WHERE key LIKE 'lease:%' LIMIT 1").get()||
   db.prepare("SELECT 1 FROM runs WHERE status IN ('queued','running') OR phase='uncertain' OR (startedAt IS NOT NULL AND coalesce(json_extract(checkpointJson,'$.workerExitConfirmed'),0)<>1) LIMIT 1").get()||
   db.prepare("SELECT 1 FROM meta WHERE key GLOB 'publicMainNode:v1:*' AND json_extract(value,'$.state')='working' LIMIT 1").get())throw Error('main_receipt_owner_unconfirmed');
}
export function migrateMainReceiptsInTransaction(db:DatabaseSync,preview:MainReceiptPreview,operationId:string){
 if(!db.isTransaction)throw Error('main_receipt_transaction_required');
 if(typeof operationId!=='string'||!operationId||operationId.length>200)throw Error('main_receipt_operation_invalid');
 const key='mainReceiptMigration:'+operationId,prior=db.prepare('SELECT value FROM meta WHERE key=?').get(key);
 if(prior){
  const saved=object(prior.value);
  if(saved.fingerprint!==preview.fingerprint)throw Error('main_receipt_operation_conflict');
  if(saved.database!==databaseIdentity(db)||saved.targetSchema!==STORE_SCHEMA_VERSION||db.prepare("SELECT value FROM meta WHERE key='recursiveSchemaVersion'").get()?.value!==STORE_SCHEMA_VERSION)throw Error('main_receipt_audit_inconsistent');
  return saved.result as {changed:number;unchanged:number;uncertain:number};
 }
 const current=inspectMainReceiptEvidence(db,preview.scope);
 if(!['6','7'].includes(current.sourceSchema)||current.fingerprint!==preview.fingerprint||digest(current)!==digest(preview))throw Error('main_receipt_preview_stale');
 if(current.rows.some(row=>row.targetState==='invalid'))throw Error('main_receipt_evidence_invalid');
 assertMainReceiptOwnersClosed(db);
 let changed=0;
 for(const row of current.rows)if(row.sourceState!==row.targetState){
  const result=db.prepare('UPDATE agent_receipts SET state=?,revision=revision+1 WHERE messageId=? AND recipientAgentId=? AND state=? AND revision=?').run(row.targetState,row.messageId,row.recipientAgentId,row.sourceState,row.revision);
  if(result.changes!==1)throw Error('main_receipt_preview_stale');changed++;
 }
 db.exec(SCHEDULE_SCHEMA);
 const result={changed,unchanged:current.rows.length-changed,uncertain:current.rows.filter(row=>row.targetState==='uncertain').length};
 db.prepare('INSERT INTO meta(key,value) VALUES(?,?)').run(key,JSON.stringify({database:databaseIdentity(db),sourceSchema:preview.sourceSchema,targetSchema:STORE_SCHEMA_VERSION,fingerprint:preview.fingerprint,rows:preview.rows,result}));
 db.prepare("UPDATE meta SET value=? WHERE key='recursiveSchemaVersion'").run(STORE_SCHEMA_VERSION);
 return result;
}
export function prepareMainReceiptMigration(path:string):MainReceiptPreview|undefined{
 if(!existsSync(path))return;
 const db=new DatabaseSync(path,{readOnly:true});
 try{
  if(!hasTable(db,'meta'))return;
  const meta=(key:string)=>String(db.prepare('SELECT value FROM meta WHERE key=?').get(key)?.value??'');
  if(!['6','7'].includes(meta('recursiveSchemaVersion')))return;
  const preview=inspectMainReceiptEvidence(db,{mainAgentId:meta('mainAgentId'),mainThreadId:meta('mainThread')});
  assertMainReceiptOwnersClosed(db);return preview;
 }finally{db.close();}
}
export type Status='queued'|'running'|'succeeded'|'failed'|'cancelled'|'interrupted';
export type Run={
 id:string;taskId:string;workerId:string;version:number;sourceRequestId:string;
 goal:string;prompt:string;status:Status;phase:string;epoch:number;stateRevision:number;
 threadId:string|null;turnId:string|null;pid:number|null;startedAt:number|null;endedAt:number|null;
 stopRequestedAt:number|null;stopReason:string|null;errorCode:string|null;
 checkpointJson:string|null;replacesRunId:string|null;workingDirectory:string;
 activeMs:number;usage:string|null;createdAt:number;
};

export class Store {
 readonly db:CommittedDatabase;
 constructor(path:string,options:{mainReceiptMigration?:MainReceiptPreview}={}){
  this.db=new CommittedDatabase(path);
  try{
   const tables=this.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>String(row.name));
   if(tables.includes('matters'))throw Error('recursive_schema_unsupported');
   if(tables.includes('runs')){
    const columns=this.db.prepare('PRAGMA table_info(runs)').all().map(row=>String(row.name));
    if(['taskId','workerId','version','prompt','checkpointJson','workingDirectory'].some(column=>!columns.includes(column))||columns.includes('matterId'))throw Error('recursive_schema_unsupported');
   }
   if(tables.includes('meta')){
    const recursive=this.meta('recursiveSchemaVersion');
    if(recursive!==undefined&&!READABLE_STORE_SCHEMA_VERSIONS.includes(recursive))throw Error('recursive_schema_unsupported');
    if(['6','7'].includes(recursive??'')&&!options.mainReceiptMigration)throw Error('main_receipt_migration_required');
    if(recursive!==undefined&&['tasks','task_versions','operations','agent_messages','agent_receipts'].some(table=>!tables.includes(table)))throw Error('recursive_schema_unsupported');
    if(recursive===STORE_SCHEMA_VERSION&&!tables.includes('schedules'))throw Error('recursive_schema_unsupported');
    if(recursive===undefined&&['runs','tasks','matters'].some(table=>tables.includes(table)&&this.db.prepare('SELECT 1 FROM '+table+' LIMIT 1').get()))throw Error('recursive_schema_unsupported');
   }else if(tables.some(table=>!table.startsWith('sqlite_')))throw Error('recursive_schema_unsupported');
   if(tables.includes('media_schema')||tables.includes('media_assets')){
    if(!tables.includes('media_schema')||this.db.prepare('SELECT version FROM media_schema').get()?.version!==2
      ||!this.db.prepare('PRAGMA table_info(media_assets)').all().some(column=>column.name==='originOperationKey'))throw Error('media_schema_unsupported');
   }
   if(tables.includes('conversation_attachments')&&!this.db.prepare('PRAGMA table_info(conversation_attachments)').all().some(column=>column.name==='messageId'))
    throw Error('conversation_schema_unsupported');
   if(tables.includes('conversation_messages')){
    const columns=this.db.prepare('PRAGMA table_info(conversation_messages)').all().map(column=>column.name);
    if(['taskId','taskVersion','operationKey','audience','revokedAt'].some(column=>!columns.includes(column)))throw Error('conversation_schema_unsupported');
   }
   this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000;
    CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,taskId TEXT NOT NULL REFERENCES tasks(id),workerId TEXT NOT NULL REFERENCES runs(id) DEFERRABLE INITIALLY DEFERRED,version INTEGER NOT NULL,sourceRequestId TEXT NOT NULL,goal TEXT NOT NULL,prompt TEXT NOT NULL,status TEXT NOT NULL,phase TEXT NOT NULL DEFAULT 'ready',epoch INTEGER NOT NULL DEFAULT 0,stateRevision INTEGER NOT NULL DEFAULT 0,threadId TEXT,turnId TEXT,pid INTEGER,startedAt INTEGER,endedAt INTEGER,stopRequestedAt INTEGER,stopReason TEXT,errorCode TEXT,checkpointJson TEXT,replacesRunId TEXT REFERENCES runs(id),workingDirectory TEXT NOT NULL,activeMs INTEGER NOT NULL DEFAULT 0,usage TEXT,createdAt INTEGER NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS one_live_run_per_worker ON runs(workerId) WHERE status IN ('queued','running') OR phase='uncertain';
    CREATE INDEX IF NOT EXISTS runs_task ON runs(taskId,createdAt);
    CREATE INDEX IF NOT EXISTS runs_worker ON runs(workerId);
    CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,runId TEXT REFERENCES runs(id),type TEXT NOT NULL,code TEXT,at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY,hash TEXT NOT NULL,state TEXT NOT NULL,response TEXT,createdAt INTEGER NOT NULL);`);
   this.transaction(()=>{
    this.db.exec(SCHEDULE_SCHEMA);
    if(options.mainReceiptMigration)migrateMainReceiptsInTransaction(this.db,options.mainReceiptMigration,'startup:'+STORE_SCHEMA_VERSION);
   });
  }catch(error){this.db.close();throw error;}
 }
 close(){this.db.close();}
 meta(key:string):string|undefined{return (this.db.prepare('SELECT value FROM meta WHERE key=?').get(key) as {value:string}|undefined)?.value;}
 setMeta(key:string,value:string){this.db.prepare('INSERT INTO meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,value);}
 run(id:string):Run|undefined{return this.db.prepare('SELECT * FROM runs WHERE id=?').get(id) as Run|undefined;}
 runs():Run[]{return this.db.prepare('SELECT * FROM runs ORDER BY createdAt,rowid').all() as Run[];}
 events(runId:string){return this.db.prepare('SELECT * FROM events WHERE runId=? ORDER BY seq').all(runId) as {seq:number;type:string;code:string|null;at:number}[];}
 event(runId:string|null,type:string,code:string|null=null){this.db.prepare('INSERT INTO events(runId,type,code,at) VALUES(?,?,?,?)').run(runId,type,code,Date.now());}
 transaction<T>(fn:()=>T):T{
  this.db.exec('BEGIN IMMEDIATE');
  try{const result=fn();this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 engine(id:string,fields:{threadId?:string;turnId?:string;pid?:number}){for(const [key,value] of Object.entries(fields))this.db.prepare(`UPDATE runs SET ${key}=? WHERE id=? AND status='running'`).run(value,id);}
 usage(id:string,value:unknown){this.db.prepare('UPDATE runs SET usage=? WHERE id=?').run(JSON.stringify(value),id);}
 request(id:string){return this.db.prepare('SELECT * FROM requests WHERE id=?').get(id) as {id:string;hash:string;state:string;response:string|null;createdAt:number}|undefined;}
 startRequest(id:string,hash:string){
  const prior=this.request(id);if(prior){if(prior.hash!==hash)throw Error('request_conflict');return prior;}
  this.db.prepare("INSERT INTO requests VALUES(?,?,'started',NULL,?)").run(id,hash,Date.now());return this.request(id)!;
 }
 finishRequest(id:string,response:string){this.db.prepare("UPDATE requests SET state='completed',response=? WHERE id=?").run(response,id);}
}
