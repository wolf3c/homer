// Historical database preflight rejects the old layout without touching its bytes.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {Store} from '../src/store.js';

test('unsupported historical layout is refused without rewriting columns, indexes or facts',()=>{
 const root=resolve('.codex/scratch/historical-schema-rejection');
 mkdirSync(root,{recursive:true});
 const dir=mkdtempSync(join(root,'fixture-')),path=join(dir,'old.sqlite');
 try{
  const old=new DatabaseSync(path);
  try{old.exec(`
   CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
   INSERT INTO meta VALUES('recursiveSchemaVersion','5');
   CREATE TABLE results(id TEXT PRIMARY KEY,runId TEXT,bytes BLOB);
   CREATE UNIQUE INDEX one_result_per_run ON results(runId) WHERE runId IS NOT NULL;
   INSERT INTO results VALUES('old-result','old-run',x'504446');
   CREATE TABLE deliveries(id TEXT PRIMARY KEY,publishedFileResultId TEXT,state TEXT);
   INSERT INTO deliveries VALUES('old-delivery','old-result','uncertain');
  `);}finally{old.close();}
  const before=readFileSync(path);
  assert.throws(()=>new Store(path),/recursive_schema_unsupported/);
  assert.deepEqual(readFileSync(path),before);
  assert.equal(existsSync(path+'-wal'),false);
  assert.equal(existsSync(path+'-shm'),false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
