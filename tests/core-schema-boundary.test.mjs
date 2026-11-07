// Current schema only; older schemas are refused before WAL/schema writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,rmSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {Store} from '../src/store.ts';
import {Files} from '../src/files.ts';
import {RecursiveTasks} from '../src/recursive-tasks.ts';
import {schemaHash} from '../scripts/dev-build.mjs';
import {pinnedDatabaseIdentity,preparePinned} from '../scripts/pinned-build.mjs';
const base=resolve('.codex/scratch/chat-architecture-implementation-20261105/e-schema');mkdirSync(base,{recursive:true});

test('current schema reopens idempotently and preserves uncertain operations',()=>{
 const dir=mkdtempSync(join(base,'current-')),path=join(dir,'homer.sqlite');let store=new Store(path);
 try{
  const files=new Files(join(dir,'workspace')),tasks=new RecursiveTasks(store,files);tasks.migrate();
  store.db.prepare("INSERT INTO operations(id,actorAgentId,scopeId,operationId,kind,payloadHash,state,detailsJson) VALUES('unknown','main','synthetic-scope','operation-id','worker_steer','hash','uncertain','{}')").run();
  const capture=()=>Object.fromEntries(store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({name})=>[name,store.db.prepare('SELECT * FROM '+name+' ORDER BY rowid').all()]));
  const before=capture();store.close();store=new Store(path);const reopened=new RecursiveTasks(store,files);reopened.migrate();reopened.migrate();
  assert.deepEqual(capture(),before);assert.equal(store.meta('recursiveSchemaVersion'),'6');
  assert.equal(store.db.prepare("SELECT state FROM operations WHERE id='unknown'").get().state,'uncertain');
  for(const table of ['pending_items','deliveries','results','worker_authorities','wechat_outbox','tg_outbox'])assert.equal(before[table],undefined);
  assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('task owner remains part of the source schema fingerprint',()=>{
 const files=new Map(),before=schemaHash({files});files.set('src/recursive-tasks.ts',Buffer.from('changed'));assert.notEqual(schemaHash({files}),before);
});

for(const version of ['5','999','unmapped'])test('unsupported '+version+' database is refused with identical bytes and no new files',()=>{
 const dir=mkdtempSync(join(base,'refused-')),path=join(dir,'old.sqlite'),db=new DatabaseSync(path);
 try{
  db.exec("CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);CREATE TABLE tasks(id TEXT PRIMARY KEY);INSERT INTO tasks VALUES('keep-original')");
  if(version!=='unmapped')db.prepare('INSERT INTO meta VALUES(?,?)').run('recursiveSchemaVersion',version);
  db.close();
  const bytes=readFileSync(path),files=readdirSync(dir).sort();assert.throws(()=>new Store(path),/recursive_schema_unsupported/);
  assert.deepEqual(readFileSync(path),bytes);assert.deepEqual(readdirSync(dir).sort(),files);
  const check=new DatabaseSync(path);try{assert.equal(check.prepare('SELECT id FROM tasks').get().id,'keep-original');assert.equal(check.prepare("SELECT 1 FROM sqlite_master WHERE name='runs'").get(),undefined);}finally{check.close();}
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('pinned ABI refuses a missing or unsupported current schema owner before creating a manifest',()=>{
 const dir=mkdtempSync(join(base,'pinned-')),path=join(dir,'homer.sqlite'),store=new Store(path);
 try{
  const tasks=new RecursiveTasks(store,new Files(join(dir,'workspace')));tasks.migrate();store.setMeta('mainThread','synthetic-thread');store.close();
  assert.equal(pinnedDatabaseIdentity(path).metadata.recursiveSchemaVersion,'6');
  mkdirSync(join(dir,'dist'));
  const config=join(dir,'config.json');writeFileSync(config,JSON.stringify({runtime:'runtime',workspace:'workspace'}));
  const args={directory:dir,configPath:config,snapshot:path,thread:'synthetic-thread',manifestPath:join(dir,'manifest.json')};
  assert.throws(()=>preparePinned(args),/pinned_schema_unsupported/);
  writeFileSync(join(dir,'dist/store.js'),"export const STORE_SCHEMA_VERSION='999';");assert.throws(()=>preparePinned(args),/pinned_schema_unsupported/);
  assert.equal(readdirSync(dir).includes('manifest.json'),false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
