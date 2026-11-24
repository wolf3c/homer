import assert from 'node:assert/strict';
import {copyFileSync,existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import test from 'node:test';
import {Store} from '../src/store.js';
import {MAIN_TOOLS_HASH} from '../src/recursive-tools.js';
import {migrateDesktopBaseline} from '../src/desktop-baseline-migration.js';

const main='01982000-0000-7000-8000-000000000001',worker='01982000-0000-7000-8000-000000000002';
const toolHash='f579ad37daedcef8a429e13a0511668b2ef954abbc180e47b408475c5395cffe';
const legacyTools=['archive_work','list_work','restore_work','send_user_message','task_create','task_update','work_inspect','worker_interrupt','worker_open','worker_read','worker_send'];
const facts={type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'合成记录 dynamic_tools'}]}};
function fixture(){
 const parent=resolve('.codex/scratch/desktop-baseline-migration-tests');mkdirSync(parent,{recursive:true});
 const root=mkdtempSync(join(parent,'case-')),runtime=join(root,'runtime'),codexHome=join(root,'codex'),sessions=join(codexHome,'sessions'),database=join(runtime,'homer.sqlite');
 mkdirSync(runtime);mkdirSync(sessions,{recursive:true});
 const store=new Store(database);store.close();
 const db=new DatabaseSync(database,{enableForeignKeyConstraints:false});
 db.exec(`DROP TABLE tasks;
 CREATE TABLE tasks(id TEXT PRIMARY KEY,title TEXT NOT NULL,headVersion INTEGER NOT NULL,notes TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('open','paused','settled')),outcome TEXT,revision INTEGER NOT NULL,controlState TEXT NOT NULL,historyState TEXT NOT NULL,createdAt INTEGER NOT NULL,updatedAt INTEGER NOT NULL,settledAt INTEGER);
 DROP INDEX uncertain_operations_scope; DROP INDEX pending_archive_inputs;
 INSERT INTO tasks VALUES('task','Synthetic',1,'kept','settled','succeeded',3,'normal','archived',4,5,6);
 INSERT INTO runs(id,taskId,workerId,version,sourceRequestId,goal,prompt,status,phase,threadId,workingDirectory,createdAt)
 VALUES('run','task','run',1,'synthetic','goal','prompt','succeeded','ended','${worker}','${root.replaceAll("'","''")}',1);
 INSERT INTO meta VALUES('mainThread','${main}'),('mainToolsHash','${toolHash}');
 UPDATE meta SET value='8' WHERE key='recursiveSchemaVersion';`);
 db.close();
 const native=new DatabaseSync(join(codexHome,'state_5.sqlite'));native.exec('CREATE TABLE thread_dynamic_tools(thread_id TEXT,name TEXT)');native.close();
 const paths=[main,worker].map(id=>join(sessions,'rollout-'+id+'.jsonl'));
 function seed(path:string,id:string,names:string[]){
  const tools=names.map(name=>({type:'function',name,description:'工具',inputSchema:{type:'object'}}));
  const text=[{type:'session_meta',payload:{id,dynamic_tools:tools}},facts,{type:'compacted',payload:{resume_metadata:{dynamic_tools:{thread_id:id,tools}},replacement_history:[facts.payload]}}].map(line=>JSON.stringify(line)).join('\n')+'\n';
  writeFileSync(path,text);return text;
 }
 const originals=[seed(paths[0]!,main,legacyTools),seed(paths[1]!,worker,['ask_main','stage_file_result'])];
 return {runtime,codexHome,database,paths,originals,seed,close:()=>rmSync(root,{recursive:true,force:true})};
}

test('desktop migration preserves native rollout offsets and historical data while pausing settled work',async()=>{
 const f=fixture();try{
  await migrateDesktopBaseline(f.runtime,f.codexHome);
  const store=new Store(f.database);try{
   assert.equal(store.meta('mainThread'),main);assert.equal(store.meta('mainToolsHash'),MAIN_TOOLS_HASH);
   assert.deepEqual({...store.db.prepare('SELECT rowid,id,state,historyState,notes,revision FROM tasks').get()},{rowid:1,id:'task',state:'paused',historyState:'archived',notes:'kept',revision:3});
   assert.equal(store.run('run')!.threadId,worker);
   assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{store.close();}
  for(const [i,path] of f.paths.entries()){
   const out=readFileSync(path,'utf8'),previous=f.originals[i]!;
   assert.equal(Buffer.byteLength(out),Buffer.byteLength(previous));
   assert.equal(out.split('\n')[1],previous.split('\n')[1]);
   assert.deepEqual(JSON.parse(out.split('\n')[0]!).payload.dynamic_tools,[]);
   const checkpoint=JSON.parse(out.split('\n')[2]!).payload;
   assert.deepEqual(checkpoint.resume_metadata.dynamic_tools.tools,[]);
   assert.deepEqual(checkpoint.replacement_history,[facts.payload]);
  }
  const backup=new DatabaseSync(join(f.codexHome,'homer-baseline-v8-backup','homer.sqlite'),{readOnly:true});
  try{assert.equal(backup.prepare('SELECT outcome FROM tasks').get()?.outcome,'succeeded');}finally{backup.close();}
  await migrateDesktopBaseline(f.runtime,f.codexHome);
 }finally{f.close();}
});

test('unknown Worker declarations are rejected before any migration writes',async()=>{
 const f=fixture();try{
  f.seed(f.paths[1]!,worker,['unknown_tool']);
  await assert.rejects(migrateDesktopBaseline(f.runtime,f.codexHome),/main_tools_migration_required/);
  assert.equal(readFileSync(f.paths[0]!,'utf8'),f.originals[0]);
  assert.equal(existsSync(join(f.codexHome,'homer-baseline-v8-backup')),false);
 }finally{f.close();}
});

test('the desktop resumes a partially published migration without replacing its original backup',async()=>{
 const f=fixture();try{
  await migrateDesktopBaseline(f.runtime,f.codexHome);
  const backup=join(f.codexHome,'homer-baseline-v8-backup');
  const mainAfter=readFileSync(f.paths[0]!);
  // Power loss can leave a rewritten native thread before the Homer transaction commits.
  copyFileSync(join(backup,'homer.sqlite'),f.database);
  writeFileSync(f.paths[1]!,f.originals[1]!);
  await migrateDesktopBaseline(f.runtime,f.codexHome);
  assert.deepEqual(readFileSync(f.paths[0]!),mainAfter);
  assert.equal(readFileSync(join(backup,worker+'.jsonl'),'utf8'),f.originals[1]);
  assert.deepEqual(JSON.parse(readFileSync(f.paths[1]!,'utf8').split('\n')[0]!).payload.dynamic_tools,[]);
  const store=new Store(f.database);try{assert.equal(store.meta('mainToolsHash'),MAIN_TOOLS_HASH);}finally{store.close();}
 }finally{f.close();}
});

test('v9 migration rolls back on a copy error and preserves Run rowids, references and queue order on retry',async()=>{
 const f=fixture();try{
  await migrateDesktopBaseline(f.runtime,f.codexHome);
  const db=new DatabaseSync(f.database,{enableForeignKeyConstraints:false});
  try{
   db.exec(`UPDATE meta SET value='9' WHERE key='recursiveSchemaVersion';
    UPDATE tasks SET state='open',historyState='visible';
    UPDATE runs SET rowid=13;
    INSERT INTO runs(rowid,id,taskId,workerId,version,sourceRequestId,goal,prompt,status,phase,workingDirectory,createdAt,replacesRunId)
      SELECT 20,'next',taskId,id,version,sourceRequestId,goal,prompt,'queued','ready',workingDirectory,1,id FROM runs WHERE id='run';
    INSERT INTO runs(rowid,id,taskId,workerId,version,sourceRequestId,goal,prompt,status,phase,workingDirectory,createdAt)
      SELECT 25,'peer',taskId,'peer',version,sourceRequestId,goal,prompt,'queued','ready',workingDirectory,1 FROM runs WHERE id='run';
    INSERT INTO events(runId,type,at) VALUES('next','synthetic',1);
    ALTER TABLE runs ADD COLUMN unrecognized TEXT;`);
   assert.throws(()=>new Store(f.database),/desktop_store_migration_required/);
   await assert.rejects(migrateDesktopBaseline(f.runtime,f.codexHome),/unrecognized/);
   assert.equal(db.prepare("SELECT value FROM meta WHERE key='recursiveSchemaVersion'").get()?.value,'9');
   assert.equal(db.prepare("SELECT rowid FROM runs WHERE id='next'").get()?.rowid,20);
   assert.equal(db.prepare("SELECT name FROM sqlite_schema WHERE name='runs_v10'").get(),undefined);
   db.exec('ALTER TABLE runs DROP COLUMN unrecognized;');
   const before=db.prepare('SELECT rowid,* FROM runs ORDER BY rowid').all();
   const indexes=db.prepare("SELECT name FROM sqlite_schema WHERE type='index' AND tbl_name='runs' ORDER BY name").all();
   await migrateDesktopBaseline(f.runtime,f.codexHome);
   assert.deepEqual(db.prepare('SELECT rowid,* FROM runs ORDER BY rowid').all(),before);
   assert.deepEqual(db.prepare("SELECT name FROM sqlite_schema WHERE type='index' AND tbl_name='runs' ORDER BY name").all(),indexes);
   assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
   assert.equal(db.prepare('SELECT runId FROM events').get()?.runId,'next');
   const store=new Store(f.database);try{
    assert.deepEqual(store.runs().map(run=>run.id),['run','next','peer']);
    assert.equal(store.run('next')!.replacesRunId,'run');
    assert.equal(store.db.prepare("SELECT \"notnull\" AS required FROM pragma_table_info('runs') WHERE name='sourceRequestId'").get()?.required,0);
   }finally{store.close();}
  }finally{db.close();}
 }finally{f.close();}
});
