import {randomUUID} from 'node:crypto';
import {CommittedDatabase} from './committed-database.js';
import {SCHEDULE_SCHEMA} from './schedules.js';
export const STORE_SCHEMA_VERSION='9';
export const READABLE_STORE_SCHEMA_VERSIONS:readonly string[]=[STORE_SCHEMA_VERSION];
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
 constructor(path:string){
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
    if(recursive!==STORE_SCHEMA_VERSION)throw Error('recursive_schema_unsupported');
    if(['tasks','task_versions','operations','agent_messages','agent_receipts'].some(table=>!tables.includes(table)))throw Error('recursive_schema_unsupported');
    if(!tables.includes('schedules'))throw Error('recursive_schema_unsupported');
    const taskColumns=this.db.prepare('PRAGMA table_info(tasks)').all().map(row=>row.name);
    if(['id','title','headVersion','notes','revision','historyState','state','createdAt','updatedAt'].some(name=>!taskColumns.includes(name))||
       ['outcome','settledAt','controlState'].some(name=>taskColumns.includes(name)))throw Error('recursive_schema_unsupported');
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
   this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000');
   if(!tables.includes('meta'))this.transaction(()=>{
    // A concurrent initializer may have finished while this connection waited for the write lock.
    if(this.db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='meta'").get()){
     if(this.meta('recursiveSchemaVersion')!==STORE_SCHEMA_VERSION)throw Error('recursive_schema_unsupported');
     return;
    }
    this.db.exec(`
    CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,taskId TEXT NOT NULL REFERENCES tasks(id),workerId TEXT NOT NULL REFERENCES runs(id) DEFERRABLE INITIALLY DEFERRED,version INTEGER NOT NULL,sourceRequestId TEXT NOT NULL,goal TEXT NOT NULL,prompt TEXT NOT NULL,status TEXT NOT NULL,phase TEXT NOT NULL DEFAULT 'ready',epoch INTEGER NOT NULL DEFAULT 0,stateRevision INTEGER NOT NULL DEFAULT 0,threadId TEXT,turnId TEXT,pid INTEGER,startedAt INTEGER,endedAt INTEGER,stopRequestedAt INTEGER,stopReason TEXT,errorCode TEXT,checkpointJson TEXT,replacesRunId TEXT REFERENCES runs(id),workingDirectory TEXT NOT NULL,activeMs INTEGER NOT NULL DEFAULT 0,usage TEXT,createdAt INTEGER NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS one_live_run_per_worker ON runs(workerId) WHERE status IN ('queued','running') OR phase='uncertain';
    CREATE INDEX IF NOT EXISTS runs_task ON runs(taskId,createdAt);
    CREATE INDEX IF NOT EXISTS runs_worker ON runs(workerId);
    CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,runId TEXT REFERENCES runs(id),type TEXT NOT NULL,code TEXT,at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY,hash TEXT NOT NULL,state TEXT NOT NULL,response TEXT,createdAt INTEGER NOT NULL);
    CREATE TABLE tasks(id TEXT PRIMARY KEY,title TEXT NOT NULL,headVersion INTEGER NOT NULL,notes TEXT NOT NULL DEFAULT '',state TEXT NOT NULL CHECK(state IN ('open','paused')),revision INTEGER NOT NULL,historyState TEXT NOT NULL DEFAULT 'visible' CHECK(historyState IN ('visible','archived')),createdAt INTEGER NOT NULL,updatedAt INTEGER NOT NULL);
    CREATE TABLE operations(id TEXT PRIMARY KEY,actorAgentId TEXT NOT NULL,scopeId TEXT NOT NULL,operationId TEXT NOT NULL,kind TEXT NOT NULL,payloadHash TEXT NOT NULL,state TEXT NOT NULL,detailsJson TEXT NOT NULL,responseJson TEXT,revision INTEGER NOT NULL DEFAULT 0,UNIQUE(actorAgentId,scopeId,operationId));
    CREATE TABLE task_versions(taskId TEXT NOT NULL REFERENCES tasks(id),version INTEGER NOT NULL,goal TEXT NOT NULL,authorityJson TEXT,sourceRequestId TEXT,triggerOpId TEXT NOT NULL UNIQUE REFERENCES operations(id),workingDirectory TEXT NOT NULL,PRIMARY KEY(taskId,version));
    CREATE TABLE agent_messages(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,senderAgentId TEXT NOT NULL,senderRunId TEXT REFERENCES runs(id),senderEpoch INTEGER,recipientAgentId TEXT NOT NULL,taskId TEXT REFERENCES tasks(id),taskVersion INTEGER,targetRunId TEXT REFERENCES runs(id),kind TEXT NOT NULL,replyTo TEXT REFERENCES agent_messages(id),causationId TEXT REFERENCES agent_messages(id),operationKey TEXT NOT NULL UNIQUE REFERENCES operations(id),payloadJson TEXT NOT NULL);
    CREATE TABLE agent_receipts(messageId TEXT NOT NULL REFERENCES agent_messages(id),recipientAgentId TEXT NOT NULL,state TEXT NOT NULL,offeredRunId TEXT REFERENCES runs(id),offeredEpoch INTEGER,offeredTurnId TEXT,processedBy TEXT,revision INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(messageId,recipientAgentId));
    CREATE INDEX agent_inbox ON agent_receipts(recipientAgentId,state);CREATE INDEX agent_receipt_state ON agent_receipts(state,messageId);CREATE INDEX messages_task ON agent_messages(taskId,seq);
    CREATE INDEX tasks_history ON tasks(historyState);
    CREATE INDEX uncertain_operations_scope ON operations(scopeId) WHERE state='uncertain';
    CREATE INDEX pending_archive_inputs ON operations(json_extract(detailsJson,'$.inputMessageId')) WHERE kind='archive_work' AND state='accepted';
    ${SCHEDULE_SCHEMA}`);
    this.setMeta('mainAgentId','main:'+randomUUID());
    this.setMeta('recursiveSchemaVersion',STORE_SCHEMA_VERSION);
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
