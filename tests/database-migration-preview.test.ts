import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {Store} from '../src/store.js';
import {ConversationHistory} from '../src/web-history.js';
import {RecursiveTasks} from '../src/recursive-tasks.js';
import {Files} from '../src/files.js';
import {previewMigration} from '../scripts/database-migration-preview.js';
const hash=(path:string)=>createHash('sha256').update(readFileSync(path)).digest('hex');
function fixture(withOperations=false){
 const parent=resolve('.codex/scratch/seamless-migration');mkdirSync(parent,{recursive:true});
 const directory=mkdtempSync(join(parent,'migration-fixture-')),snapshot=join(directory,'old.sqlite');
 const store=new Store(snapshot),history=new ConversationHistory(store.db);
 store.setMeta('mainThread','synthetic-kept-thread');store.setMeta('mainToolsHash','synthetic-kept-tools');
 const source=history.add('synthetic-kept-thread','Synthetic facts remain unknown.');
 history.accept('synthetic-kept-thread',{requestId:'synthetic-original',text:'Synthetic input',quotes:[{messageId:source,text:'Synthetic facts',annotation:'First'},{messageId:source,text:'unknown',annotation:'Second'}]},{source:'web'});
 if(withOperations){
  new RecursiveTasks(store,new Files(join(directory,'workspace'))).migrate();
  for(let i=0;i<6;i++)store.db.prepare("INSERT INTO operations(id,actorAgentId,scopeId,operationId,kind,payloadHash,state,detailsJson) VALUES(?, 'main', 'synthetic-scope', ?, 'worker_steer', 'synthetic-hash', 'uncertain', '{}')").run('synthetic-id-'+i,'synthetic-operation-'+i);
 }
 return {directory,snapshot,store};
}
test('offline schema preview preserves original facts and six unknown rows; backup restore reproduces the old database',async(t)=>{
 const f=fixture(true);t.after(()=>rmSync(f.directory,{recursive:true,force:true}));f.store.close();const before=hash(f.snapshot);
 const r=await previewMigration(f.snapshot,join(f.directory,'preview'));
 assert.equal(r.passed,true);assert.equal(hash(f.snapshot),before);assert.equal(r.mainThreadPreserved,true);
assert.deepEqual(r.allowedMetadataChanges,[]);
 assert.equal(r.tables.operations!.countAfter,6);assert.equal(r.tables.operations!.unchanged,true);assert.ok(Object.values(r.tables).every(v=>v.unchanged));
 assert.deepEqual(r.rollback,{fileBytesMatch:true,schemaUnchanged:true,factsUnchanged:true});assert.equal(r.automaticActivationAllowed,false);
 assert.deepEqual(r.permissions,{directory:0o700,before:0o600,candidate:0o600,rollback:0o600});
});
test('migration failure and future schema remain offline; recovery uses the exact pre-migration backup',async(t)=>{
 const f=fixture();t.after(()=>rmSync(f.directory,{recursive:true,force:true}));f.store.db.exec("CREATE TRIGGER synthetic_recursive_failure BEFORE INSERT ON meta WHEN NEW.key='recursiveSchemaVersion' BEGIN SELECT RAISE(ABORT,'synthetic_migration_failure');END;");f.store.close();
 const originalHash=hash(f.snapshot),failed=await previewMigration(f.snapshot,join(f.directory,'failed'));
 assert.equal(failed.passed,false);assert.equal(failed.error,'synthetic_migration_failure');assert.equal(hash(f.snapshot),originalHash);
 assert.equal(failed.rollback.factsUnchanged,true);assert.equal(failed.rollback.schemaUnchanged,true);assert.equal(failed.rollback.fileBytesMatch,true);
 const restored=new DatabaseSync(join(f.directory,'failed/rollback-restored.sqlite'),{readOnly:true});
 assert.equal(restored.prepare("SELECT 1 FROM sqlite_master WHERE name='tasks'").get(),undefined);restored.close();
 const future=new DatabaseSync(f.snapshot);future.exec('DROP TRIGGER synthetic_recursive_failure');future.prepare("INSERT INTO meta VALUES('recursiveSchemaVersion','999')").run();future.close();
 const futureHash=hash(f.snapshot),blocked=await previewMigration(f.snapshot,join(f.directory,'future'));
 assert.equal(blocked.passed,false);assert.equal(blocked.error,'recursive_schema_unsupported');assert.equal(hash(f.snapshot),futureHash);assert.deepEqual(blocked.stages,[]);
 await assert.rejects(previewMigration(f.snapshot,join(f.directory,'preview/../../../../../../outside')),/private_destination_required/);
});

test('offline preview includes every existing source table in preservation checks',async(t)=>{
 const f=fixture();t.after(()=>rmSync(f.directory,{recursive:true,force:true}));
 const tables=f.store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row=>String(row.name));f.store.close();
 const r=await previewMigration(f.snapshot,join(f.directory,'source-preview'));
 assert.equal(r.passed,true);assert.ok(tables.filter(table=>table!=='meta').every(table=>table in r.tables),'all existing data owners must be checked');
 const inputs=r.tables.conversation_inputs,messages=r.tables.conversation_messages;assert.ok(inputs);assert.ok(messages);
 assert.equal(inputs.countBefore,1);assert.equal(inputs.unchanged,true);assert.equal(messages.unchanged,true);
});

function schema2Fixture(){
 const f=fixture();new RecursiveTasks(f.store,new Files(join(f.directory,'workspace'))).migrate();
 f.store.setMeta('recursiveSchemaVersion','2');return f;
}
test('offline preview refuses unsupported historical schemas without activating or changing the source',async()=>{
 const f=schema2Fixture();f.store.close();const before=hash(f.snapshot);
 try{
  const r=await previewMigration(f.snapshot,join(f.directory,'unsupported-preview'));
  assert.equal(r.passed,false);assert.equal(r.error,'recursive_schema_unsupported');
  assert.equal(hash(f.snapshot),before);assert.equal(r.mainThreadPreserved,true);
  assert.equal(r.originalMetadataPreserved,true);assert.deepEqual(r.allowedMetadataChanges,[]);
  assert.deepEqual(r.rollback,{fileBytesMatch:true,schemaUnchanged:true,factsUnchanged:true});assert.equal(r.automaticActivationAllowed,false);
 }finally{rmSync(f.directory,{recursive:true,force:true});}
});
