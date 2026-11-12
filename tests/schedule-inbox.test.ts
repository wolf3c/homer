import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {Store} from '../src/store.js';
import {Files} from '../src/files.js';
import {RecursiveTasks} from '../src/recursive-tasks.js';
import {ConversationHistory} from '../src/web-history.js';
import {MainInputs,MAIN_INBOX_CAPACITY} from '../src/recursive-main-inputs.js';
import {CommittedDatabase} from '../src/committed-database.js';
import {DatabaseSync} from 'node:sqlite';
function fixture(){
  const base=resolve('.codex/scratch/schedule-inbox');mkdirSync(base,{recursive:true});
  const root=mkdtempSync(join(base,'case-')),path=join(root,'homer.sqlite');
  let store=new Store(path);
  const files=new Files(join(root,'workspace')),tasks=new RecursiveTasks(store,files);tasks.migrate();
  store.setMeta('mainThread','original-main');
  const history=new ConversationHistory(store.db),inputs=new MainInputs(tasks,history);
  return {root,path,store,tasks,history,inputs,close(){store.close();rmSync(root,{recursive:true,force:true});}};
}
const delivery=(id:string)=>({deliveryId:id,scheduleId:'schedule-a',scheduledAt:1,text:'Inspect at the intended time',sourceRef:'opaque-original-source'});
test('schema 6 upgrades additively and preserves original thread and operations',()=>{
  const f=fixture();
  try{
    f.store.db.prepare("INSERT INTO operations(id,actorAgentId,scopeId,operationId,kind,payloadHash,state,detailsJson) VALUES('retain-unknown','main','scope','retain','worker_send','hash','uncertain','{}')").run();
    f.store.setMeta('recursiveSchemaVersion','6');f.store.db.exec('DROP TABLE IF EXISTS schedules');f.store.close();
    const upgraded=new Store(f.path);
    try{
      assert.equal(upgraded.meta('recursiveSchemaVersion'),'7');
      assert.equal(upgraded.meta('mainThread'),'original-main');
      assert.equal(upgraded.db.prepare("SELECT state FROM operations WHERE id='retain-unknown'").get()!.state,'uncertain');
      assert.ok(upgraded.db.prepare("SELECT 1 FROM sqlite_master WHERE name='schedules'").get());
      assert.deepEqual(upgraded.db.prepare('PRAGMA foreign_key_check').all(),[]);
    }finally{upgraded.close();}
  }finally{rmSync(f.root,{recursive:true,force:true});}
});
test('failed schedule schema migration rolls back its DDL and version together',()=>{
  const f=fixture(),exec=CommittedDatabase.prototype.exec;
  f.store.setMeta('recursiveSchemaVersion','6');f.store.db.exec('DROP TABLE schedules');f.store.close();
  try{
    CommittedDatabase.prototype.exec=function(sql){exec.call(this,sql);if(sql.includes('CREATE TABLE IF NOT EXISTS schedules'))throw Error('synthetic_schedule_schema_failure');};
    assert.throws(()=>new Store(f.path),/synthetic_schedule_schema_failure/);
  }finally{CommittedDatabase.prototype.exec=exec;}
  const db=new DatabaseSync(f.path,{readOnly:true});
  try{
    assert.equal(db.prepare("SELECT value FROM meta WHERE key='recursiveSchemaVersion'").get()!.value,'6');
    assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name='schedules'").get(),undefined);
    assert.equal(db.prepare('PRAGMA quick_check').get()!.quick_check,'ok');
  }finally{db.close();rmSync(f.root,{recursive:true,force:true});}
});
test('background capacity rejects atomically while receipts, queue pages and foreground input remain usable',()=>{
  const f=fixture();
  try{
    f.store.transaction(()=>{for(let index=0;index<MAIN_INBOX_CAPACITY.backgroundMessages;index++)f.inputs.enqueueScheduled(delivery('capacity-'+index));});
    assert.throws(()=>f.store.transaction(()=>f.inputs.enqueueScheduled(delivery('over-capacity'))),/main_inbox_capacity/);
    const before=Number(f.store.db.prepare('SELECT count(*) n FROM agent_messages').get()!.n);
    assert.equal(f.store.transaction(()=>f.inputs.enqueueScheduled(delivery('capacity-0'))),'scheduled-message:capacity-0');
    assert.equal(f.store.db.prepare('SELECT count(*) n FROM agent_messages').get()!.n,before);
    const page=f.inputs.dispatchPage(undefined,'test-epoch','all');assert.equal(page.items.length,80);assert.ok(page.nextCursor);
    assert.ok(f.inputs.dispatchPage(page.nextCursor!,'test-epoch','all').items.length);
    assert.equal(f.inputs.accept({requestId:'foreground-reserve',text:'Inspect and cancel the backlog'}).fresh,true);
  }finally{f.close();}
});
test('same-instance unclaimed scheduled input survives desktop pause and claimed input is never replayed',()=>{
  const f=fixture();
  try{
    const enqueue=(f.inputs as any).enqueueScheduled;
    assert.equal(typeof enqueue,'function');
    const id=f.store.transaction(()=>enqueue.call(f.inputs,delivery('due-a')));
    assert.equal(f.store.transaction(()=>enqueue.call(f.inputs,delivery('due-a'))),id);
    const cutoff=Number(f.store.db.prepare('SELECT max(seq) n FROM agent_messages').get()!.n);
    assert.equal(new MainInputs(f.tasks,f.history,undefined,undefined,{pausedThroughSeq:cutoff,resumeScheduled:false}).claim([],'all'),undefined);
    const resumed=new MainInputs(f.tasks,f.history,undefined,undefined,{pausedThroughSeq:cutoff});
    const claimed=resumed.claim([],'all')!;
    assert.equal(claimed.origin,'scheduled');assert.equal(claimed.messageId,id);
    resumed.reconcile();
    assert.equal(resumed.claim([],'all'),undefined);
    assert.equal(f.store.db.prepare('SELECT state FROM agent_receipts WHERE messageId=?').get(id)!.state,'uncertain');
  }finally{f.close();}
});

test('scheduled and user messages preserve one durable queue order',()=>{
  const f=fixture();
  try{
    f.inputs.accept({requestId:'before-schedule',text:'User before'});
    f.store.transaction(()=>f.inputs.enqueueScheduled(delivery('between-users')));
    f.inputs.accept({requestId:'after-schedule',text:'User after'});
    const items=f.inputs.dispatchPage(undefined,'mixed-epoch','all').items;
    assert.deepEqual(items.map(item=>item.origin),['user','scheduled','user']);
    assert.equal(items[1]!.editable,false);
  }finally{f.close();}
});

test('a future delivery from old authority cannot bypass the desktop adoption pause by obtaining a new queue sequence',()=>{
  const f=fixture();
  try{
    f.inputs.accept({requestId:'old-owner-source',text:'Old ongoing work'});
    const cutoff=Number(f.store.db.prepare('SELECT max(seq) n FROM agent_messages').get()!.n);
    const adopted=new MainInputs(f.tasks,f.history,undefined,undefined,{pausedThroughSeq:cutoff,resumeScheduled:false});
    const sourceRef=JSON.stringify({authority:{sourceRequestId:'old-owner-source'}});
    f.store.transaction(()=>adopted.enqueueScheduled({...delivery('new-sequence-old-authority'),sourceRef}));
    assert.equal(adopted.claim([],'all'),undefined);
    adopted.accept({requestId:'new-owner-source',text:'New authorized work'});
    const current=adopted.claim([],'all')!;assert.equal(current.origin,'user');
    adopted.finish(current.messageId,current.revision,'completed');
    f.store.transaction(()=>adopted.enqueueScheduled({...delivery('new-authority'),sourceRef:JSON.stringify({authority:{sourceRequestId:'new-owner-source'}})}));
    assert.equal(adopted.claim([],'all')!.origin,'scheduled');
  }finally{f.close();}
});
