// Synthetic old-schema upgrade and optional previous-code rollback rehearsal.
// Never accepts a database path; only a source-code directory may be provided.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync,mkdirSync,rmSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ConversationHistory } from '../src/web-history.js';
import { Store } from '../src/store.js';
import { Files } from '../src/files.js';
import { WorkerInteractions } from '../src/worker-interactions.js';
import { RecursiveTasks } from '../src/recursive-tasks.js';
import { MainInputs } from '../src/recursive-main-inputs.js';
const root=resolve('.codex/scratch/main-agent-reception-optimization');mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'synthetic-index-upgrade-')),path=join(dir,'synthetic.sqlite');
let db=new DatabaseSync(path);
try{
 db.exec(`CREATE TABLE conversation_inputs(requestId TEXT PRIMARY KEY,threadId TEXT NOT NULL,hash TEXT NOT NULL,replyId TEXT NOT NULL);
 CREATE TABLE conversation_messages(id TEXT PRIMARY KEY,threadId TEXT NOT NULL,requestId TEXT,role TEXT NOT NULL,text TEXT NOT NULL,status TEXT NOT NULL,quote TEXT,createdAt INTEGER NOT NULL);
 CREATE INDEX conversation_thread ON conversation_messages(threadId,createdAt);
 CREATE TABLE conversation_attachments(requestId TEXT PRIMARY KEY REFERENCES conversation_inputs(requestId),refsJson TEXT NOT NULL);`);
 const before=db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='conversation_messages' ORDER BY name").all();
 let history=new ConversationHistory(db);history.accept('synthetic-thread',{requestId:'synthetic-before-rollback',text:'Synthetic old-schema input'});
 new ConversationHistory(db);new ConversationHistory(db);
 const index=db.prepare("SELECT name,sql FROM sqlite_master WHERE type='index' AND name='conversation_request_user'").all();assert.equal(index.length,1);assert.ok(!String(index[0]!.sql).includes('UNIQUE'));
 const plan=db.prepare("EXPLAIN QUERY PLAN SELECT text,quote FROM conversation_messages WHERE threadId=? AND requestId=? AND role='user' ORDER BY createdAt,rowid LIMIT 1").all('synthetic-thread','synthetic-before-rollback');assert.ok(plan.some(row=>String(row.detail).includes('conversation_request_user')));
 db.close();db=new DatabaseSync(path);
 let previousCodeRead=false;
 if(process.argv[2]){
  const {ConversationHistory:Previous}=await import(pathToFileURL(join(resolve(process.argv[2]),'src/web-history.ts')).href);
  const previous=new Previous(db);assert.equal(previous.list('synthetic-thread').length,2);assert.equal(previous.accept('synthetic-thread',{requestId:'synthetic-before-rollback',text:'Synthetic old-schema input'}).fresh,false);previousCodeRead=true;
 }
 history=new ConversationHistory(db);assert.equal(history.list('synthetic-thread').length,2);assert.equal(history.accept('synthetic-thread',{requestId:'synthetic-before-rollback',text:'Synthetic old-schema input'}).fresh,false);
 let queueRollback:unknown={status:'not requested: previous source directory absent'};
 if(process.argv[2]){
  const previousSource=resolve(process.argv[2]);
  const load=(name:string)=>import(pathToFileURL(join(previousSource,'src',name+'.ts')).href);
  const [{Store:OldStore},{Files:OldFiles},{WorkerInteractions:OldInteractions},{ConversationHistory:OldHistory},{RecursiveTasks:OldTasks},{MainInputs:OldInputs}]=await Promise.all(['store','files','worker-interactions','web-history','recursive-tasks','recursive-main-inputs'].map(load));
  const queuePath=join(dir,'synthetic-queue.sqlite');let store=new OldStore(queuePath);
  try{
   new OldInteractions(store.db);let tasks=new OldTasks(store,new OldFiles(join(dir,'workspace')));tasks.migrate();store.setMeta('mainThread','synthetic-thread');
   let queue=new OldInputs(tasks,new OldHistory(store.db));queue.accept({requestId:'synthetic-queue-rollback',text:'Synthetic queue compatibility input'});
   assert.equal(store.db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='agent_receipt_state'").get()!.n,0);
   store.close();store=new Store(queuePath);new WorkerInteractions(store.db);tasks=new RecursiveTasks(store,new Files(join(dir,'workspace')));tasks.migrate();tasks.migrate();
   assert.equal(store.db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='agent_receipt_state'").get()!.n,1);
   // Reopen through the actual previous owner, then exercise its original CAS.
   store.close();store=new OldStore(queuePath);new OldInteractions(store.db);tasks=new OldTasks(store,new OldFiles(join(dir,'workspace')));tasks.migrate();queue=new OldInputs(tasks,new OldHistory(store.db));
   assert.equal(queue.accept({requestId:'synthetic-queue-rollback',text:'Synthetic queue compatibility input'}).fresh,false);
   const claimed=queue.claim();assert.ok(claimed);queue.finish(claimed.messageId,claimed.revision,'completed');
   const current=new MainInputs(tasks,new ConversationHistory(store.db));assert.equal(current.list().length,1);assert.equal(current.list()[0]!.state,'completed');
   queueRollback={status:'passed',previousCodeClaimAndFinish:true,idempotentReaccept:true,queueItems:1,terminal:'completed',receiptIndexRetained:true};
  }finally{store.close();}
 }
 console.log(JSON.stringify({scope:'synthetic only',before,index,plan,repeatedUpgrade:'passed',previousCodeRead,idempotentReaccept:'passed',messages:2,queueRollback,rollback:'retain additive non-unique indices; no queue reset or business replay'},null,2));
}finally{db.close();rmSync(dir,{recursive:true,force:true});}
