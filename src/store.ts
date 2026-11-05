import {CommittedDatabase} from './committed-database.js';

export const STORE_SCHEMA_VERSION='5';
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
    const recursive=this.meta('recursiveSchemaVersion'),pending=this.meta('pendingSchemaVersion');
    if(recursive!==undefined&&recursive!==STORE_SCHEMA_VERSION)throw Error('recursive_schema_unsupported');
    if(recursive===STORE_SCHEMA_VERSION&&['tasks','task_versions','operations','agent_messages','agent_receipts','results','deliveries'].some(table=>!tables.includes(table)))throw Error('recursive_schema_unsupported');
    if(pending!==undefined&&pending!=='1')throw Error('pending_schema_unsupported');
    if(recursive===undefined&&['runs','tasks','matters'].some(table=>tables.includes(table)&&this.db.prepare('SELECT 1 FROM '+table+' LIMIT 1').get()))throw Error('recursive_schema_unsupported');
   }else if(tables.some(table=>!table.startsWith('sqlite_')))throw Error('recursive_schema_unsupported');
   this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000;
    CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,taskId TEXT NOT NULL REFERENCES tasks(id),workerId TEXT NOT NULL REFERENCES runs(id) DEFERRABLE INITIALLY DEFERRED,version INTEGER NOT NULL,sourceRequestId TEXT NOT NULL,goal TEXT NOT NULL,prompt TEXT NOT NULL,status TEXT NOT NULL,phase TEXT NOT NULL DEFAULT 'ready',epoch INTEGER NOT NULL DEFAULT 0,stateRevision INTEGER NOT NULL DEFAULT 0,threadId TEXT,turnId TEXT,pid INTEGER,startedAt INTEGER,endedAt INTEGER,stopRequestedAt INTEGER,stopReason TEXT,errorCode TEXT,checkpointJson TEXT,replacesRunId TEXT REFERENCES runs(id),workingDirectory TEXT NOT NULL,activeMs INTEGER NOT NULL DEFAULT 0,usage TEXT,createdAt INTEGER NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS one_live_run_per_worker ON runs(workerId) WHERE status IN ('queued','running') OR phase='uncertain';
    CREATE INDEX IF NOT EXISTS runs_task ON runs(taskId,createdAt);
    CREATE INDEX IF NOT EXISTS runs_worker ON runs(workerId);
    CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,runId TEXT REFERENCES runs(id),type TEXT NOT NULL,code TEXT,at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY,hash TEXT NOT NULL,state TEXT NOT NULL,response TEXT,createdAt INTEGER NOT NULL);`);
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
