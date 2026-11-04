// Isolated synthetic current-schema fixture; no live snapshots or accounts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {Store} from '../src/store.ts';
import {Files} from '../src/files.ts';
import {RecursiveTasks} from '../src/recursive-tasks.ts';
import {WorkerInteractions} from '../src/worker-interactions.ts';
import {ConversationHistory} from '../src/web-history.ts';
import {WechatStore} from '../src/channels/wechat-store.ts';
import {schemaHash} from '../scripts/dev-build.mjs';
import {pinnedDatabaseIdentity,preparePinned} from '../scripts/pinned-build.mjs';
const parent=resolve('.codex/scratch/main-pending-implementation');mkdirSync(parent,{recursive:true});
test('AC07: additive pending migration preserves recursive rows, task queue and uncertain send; repeat is inert',()=>{
 const dir=mkdtempSync(join(parent,'migration-')),path=join(dir,'synthetic.sqlite');let store=new Store(path);
 try{
  new WorkerInteractions(store.db);new ConversationHistory(store.db);new WechatStore(store.db);
  const tasks=new RecursiveTasks(store,new Files(join(dir,'workspace')));tasks.migrate();store.setMeta('mainAgentId','main:synthetic');store.setMeta('mainThread','synthetic-thread');
  store.startRequest('synthetic-source','hash');store.finishRequest('synthetic-source','done');
  const authority={sourceRequestId:'synthetic-source',description:'synthetic task',materials:[],resultIds:[],collaborateTaskIds:[],maxActiveMs:10000};
  const contract={goal:'preserved',inputs:[],resultKind:'structured',acceptance:{criteria:[]}};
  tasks.createRoot({agentId:'main:synthetic',sourceRequestId:'synthetic-source'},{operationId:'root',title:'preserved',contract,authority,executorKind:'worker'});
  store.db.prepare("INSERT INTO wechat_inbox VALUES('synthetic-inbound','synthetic-binding','1','synthetic-owner','synthetic-context','','submitted')").run();
  store.db.prepare("INSERT INTO wechat_outbox VALUES('unknown','synthetic-inbound','synthetic-binding','event',0,'synthetic','uncertain','wechat_send_uncertain')").run();
  // Remove exactly the addon to represent the prior pending addon ABI.
  store.db.exec("DROP TABLE pending_items;DELETE FROM meta WHERE key='pendingSchemaVersion'");
  const tables=store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r=>r.name);
  const capture=()=>Object.fromEntries(tables.map(table=>[table,store.db.prepare('SELECT * FROM "'+table+'"').all()]));
  const before=capture();store.close();store=new Store(path);
  const migrated=new RecursiveTasks(store,tasks.files);migrated.migrate();
  assert.equal(store.meta('recursiveSchemaVersion'),'4');assert.equal(store.meta('pendingSchemaVersion'),'1');
  const after=capture();after.meta=after.meta.filter(row=>row.key!=='pendingSchemaVersion');assert.deepEqual(after,before);
  assert.equal(store.db.prepare("SELECT state FROM wechat_outbox WHERE id='unknown'").get().state,'uncertain');
  const once=capture();migrated.migrate();assert.deepEqual(capture(),once);assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.equal(store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
  store.setMeta('pendingSchemaVersion','999');store.close();store=undefined;
  assert.throws(()=>new Store(path),/pending_schema_unsupported/);
 }finally{store?.close();rmSync(dir,{recursive:true,force:true});}
});
test('AC07: pending owner participates in schema fingerprint and pinned ABI rejects missing/unsupported owner',()=>{
 const files=new Map();const old=schemaHash({files});files.set('src/pending-items.ts',Buffer.from('changed'));assert.notEqual(schemaHash({files}),old);
 const dir=mkdtempSync(join(parent,'pin-')),path=join(dir,'synthetic.sqlite'),db=new Store(path);
 try{
  db.setMeta('mainThread','thread');db.setMeta('pendingSchemaVersion','1');db.close();
  assert.equal(pinnedDatabaseIdentity(path).metadata.pendingSchemaVersion,'1');
  mkdirSync(join(dir,'dist'));const config=join(dir,'config.json');writeFileSync(config,JSON.stringify({runtime:'runtime',workspace:'workspace'}));
  const args={directory:dir,configPath:config,snapshot:path,thread:'thread',manifestPath:join(dir,'manifest.json')};
  assert.throws(()=>preparePinned(args),/pinned_schema_unsupported/);
  writeFileSync(join(dir,'dist/pending-items.js'),"export const PENDING_SCHEMA_VERSION='999';");assert.throws(()=>preparePinned(args),/pinned_schema_unsupported/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
