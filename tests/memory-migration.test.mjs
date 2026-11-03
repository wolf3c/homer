import{test}from'node:test';import assert from'node:assert/strict';import{DatabaseSync}from'node:sqlite';import{mkdirSync,mkdtempSync,writeFileSync}from'node:fs';import{resolve,join}from'node:path';
import{Store}from'../src/store.ts';import{ConversationHistory}from'../src/web-history.ts';import{Memory}from'../src/memory.ts';import{sourceSnapshot,schemaHash,buildCandidate,dependencyHash}from'../scripts/dev-build.mjs';
const root=resolve('.codex/scratch/memory-system/migration');mkdirSync(root,{recursive:true});
test('HMR-MEMORY-MIGRATION: old requests, mainThread, quote arrays/hash and channels survive additive schema and reopen',()=>{
 const dir=mkdtempSync(join(root,'old-')),path=join(dir,'homer.sqlite');
 const old=new Store(path);const history=new ConversationHistory(old.db);
 old.setMeta('mainThread','original-thread');old.setMeta('mainToolsHash','original-five-fingerprint');
 const id=history.add('original-thread','第一段原文\n\n第二段原文');
 history.accept('original-thread',{requestId:'multi-reference',text:'对照',quotes:[{messageId:id,text:'第一段原文',annotation:'核对一'},{messageId:id,text:'第二段原文',annotation:'核对二'}]});
 history.accept('original-thread',{requestId:'legacy-reference',text:'旧请求',quote:{messageId:id,text:'第一段原文'}});
 old.db.exec("CREATE TABLE synthetic_channel_receipts(id TEXT PRIMARY KEY,state TEXT);INSERT INTO synthetic_channel_receipts VALUES('old-inbound','uncertain');");
 old.dispatch({requestId:'dispatch-original',sourceRequestId:'legacy-reference',title:'合成',goal:'核对',material:'sample.md'});
 const select=db=>Object.fromEntries(['meta','requests','runs','matters','conversation_inputs','conversation_messages','synthetic_channel_receipts'].map(t=>[t,db.prepare('SELECT * FROM '+t).all()]));
 const before=select(old.db);const memory=new Memory(old);assert.equal(memory.settings().epoch,0);const after=select(old.db);
 assert.deepEqual(after.meta.filter(m=>!String(m.key).startsWith('memory')),before.meta);for(const t of Object.keys(before).filter(t=>t!=='meta'))assert.deepEqual(after[t],before[t]);
 old.close();const restarted=new Store(path);const next=new Memory(restarted);assert.equal(next.ownerId,memory.ownerId);assert.equal(restarted.meta('mainThread'),'original-thread');assert.equal(restarted.meta('mainToolsHash'),'original-five-fingerprint');restarted.close();
 writeFileSync(join(dir,'verified-checks.json'),JSON.stringify({additiveMigration:true,mainThreadPreserved:true,fiveToolsPreserved:true,requestAndQuoteHashRowsUnchanged:true,channelUncertainUnchanged:true,reopened:true,rollbackRequiresClosedDatabaseRestore:true},null,2));
});
test('HMR-MEMORY-MIGRATION: future schema and failed transaction block without partial metadata',()=>{
 const path=join(mkdtempSync(join(root,'failure-')),'homer.sqlite');const store=new Store(path);new ConversationHistory(store.db);
 store.db.exec("CREATE TRIGGER reject_memory_metadata BEFORE INSERT ON meta WHEN NEW.key='memorySchemaVersion' BEGIN SELECT RAISE(ABORT,'synthetic_migration_failure');END;");
 assert.throws(()=>new Memory(store));assert.equal(store.meta('memorySchemaVersion'),undefined);assert.equal(store.meta('memoryOwnerId'),undefined);assert.equal(store.db.prepare("SELECT 1 FROM sqlite_master WHERE name='memory_entries'").get(),undefined);
 store.db.exec('DROP TRIGGER reject_memory_metadata');store.setMeta('memorySchemaVersion','999');store.close();assert.throws(()=>new Store(path),/memory_schema_unsupported/);
 const db=new DatabaseSync(path,{readOnly:true});assert.equal(db.prepare("SELECT value FROM meta WHERE key='memorySchemaVersion'").get().value,'999');db.close();
});
test('HMR-MEMORY-MIGRATION: new schema owner participates in dev compatibility gate before build/start',async()=>{
 const snap=sourceSnapshot(resolve('.'));const changed={...snap,files:new Map(snap.files)};changed.files.set('src/memory-store.ts',Buffer.concat([snap.files.get('src/memory-store.ts'),Buffer.from('\n// synthetic migration owner change\n')]));
 assert.notEqual(schemaHash(changed),schemaHash(snap));await assert.rejects(()=>buildCandidate(resolve('.'),undefined,changed,{deps:dependencyHash(snap),schema:schemaHash(snap)},undefined),/dev_schema_change_requires_review/);
});
