import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,realpathSync,readFileSync,readdirSync,rmSync,writeFileSync,symlinkSync,chmodSync,renameSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import * as module from '../src/native-thread-memory.js';
function fixture(t:TestContext){
 const parent=resolve('.codex/scratch/native-thread-memory-unit');mkdirSync(parent,{recursive:true});
 const home=realpathSync(mkdtempSync(join(parent,'case-'))),path=join(home,'state_5.sqlite');
 t.after(()=>rmSync(home,{recursive:true,force:true}));
 const create=()=>{const db=new DatabaseSync(path);db.exec("CREATE TABLE threads(id TEXT PRIMARY KEY,memory_mode TEXT); INSERT INTO threads VALUES('enabled-thread','enabled'),('disabled-thread','disabled')");db.close();};
 return {home,path,create,read:module.readNativeMemoryMode,confirm:module.confirmNativeMemoryMode};
}

test('native mode uses the exact configured database row without writing files',t=>{
 const f=fixture(t);f.create();chmodSync(f.path,0o400);const before=readFileSync(f.path),entries=readdirSync(f.home);
 assert.equal(f.read(f.home,'enabled-thread'),'enabled');assert.equal(f.read(f.home,'disabled-thread'),'disabled');
 assert.deepEqual(readFileSync(f.path),before);assert.deepEqual(readdirSync(f.home),entries);
});

test('missing database or row cannot create a database or infer a mode',t=>{
 const f=fixture(t);assert.throws(()=>f.read(f.home,'missing'),/native_memory_mode_unavailable/);assert.deepEqual(readdirSync(f.home),[]);
 f.create();assert.throws(()=>f.read(f.home,'missing'),/native_memory_mode_missing/);
});

for(const value of [null,'on','Enabled',1])test('unknown native memory mode is refused: '+String(value),t=>{
 const f=fixture(t);f.create();const db=new DatabaseSync(f.path);db.prepare('UPDATE threads SET memory_mode=? WHERE id=?').run(value,'enabled-thread');db.close();
 assert.throws(()=>f.read(f.home,'enabled-thread'),/native_memory_mode_invalid/);
});

test('unreadable schema and malformed database fail without a fallback',t=>{
 const f=fixture(t);writeFileSync(f.path,'synthetic invalid database');const before=readFileSync(f.path);
 assert.throws(()=>f.read(f.home,'enabled-thread'),/native_memory_mode_unavailable/);assert.deepEqual(readFileSync(f.path),before);
 rmSync(f.path);const db=new DatabaseSync(f.path);db.exec('CREATE TABLE unrelated(id TEXT)');db.close();
 assert.throws(()=>f.read(f.home,'enabled-thread'),/native_memory_mode_unavailable/);
});

test('an ambiguous native row is invalid even when its first value looks valid',t=>{
 const f=fixture(t);const db=new DatabaseSync(f.path);
 db.exec("CREATE TABLE threads(id TEXT,memory_mode TEXT); INSERT INTO threads VALUES('duplicate','enabled'),('duplicate','disabled')");db.close();
 assert.throws(()=>f.read(f.home,'duplicate'),/native_memory_mode_invalid/);
});

test('symlinked home or database and relative configuration paths are rejected',t=>{
 const f=fixture(t);f.create();const alias=join(f.home,'alias');symlinkSync(f.home,alias);
 assert.throws(()=>f.read(alias,'enabled-thread'),/native_memory_home_invalid/);
 assert.throws(()=>f.read('.','enabled-thread'),/native_memory_home_invalid/);
 const original=join(f.home,'source.sqlite');renameSync(f.path,original);symlinkSync(original,f.path);const before=readFileSync(original);
 assert.throws(()=>f.read(f.home,'enabled-thread'),/native_memory_mode_unavailable/);assert.deepEqual(readFileSync(original),before);
});

test('mode confirmation observes delayed native state and checks current owner',async t=>{
 const f=fixture(t);f.create();assert.ok(f.confirm);
 await f.confirm(f.home,'enabled-thread','enabled',()=>true);
 await assert.rejects(f.confirm(f.home,'enabled-thread','enabled',()=>false),/native_thread_owner_changed/);
 let checks=0;await assert.rejects(f.confirm(f.home,'enabled-thread','enabled',()=>++checks===1),/native_thread_owner_changed/);
 const timer=setTimeout(()=>{const db=new DatabaseSync(f.path);db.prepare('UPDATE threads SET memory_mode=? WHERE id=?').run('disabled','enabled-thread');db.close();},40);
 try{await f.confirm(f.home,'enabled-thread','disabled',()=>true);}finally{clearTimeout(timer);}
 assert.equal(f.read(f.home,'enabled-thread'),'disabled');
});

test('stale native projection is bounded and cannot change the saved mode',async t=>{
 const f=fixture(t);f.create();assert.ok(f.confirm);const before=readFileSync(f.path);
 await assert.rejects(f.confirm(f.home,'enabled-thread','disabled',()=>true),/native_memory_mode_mismatch/);
 assert.deepEqual(readFileSync(f.path),before);
});

test('confirmation stops on revoked ownership or a replaced native database path',async t=>{
 const f=fixture(t);f.create();assert.ok(f.confirm);let current=true;
 const revoke=setTimeout(()=>{current=false;},10);
 try{await assert.rejects(f.confirm(f.home,'enabled-thread','disabled',()=>current),/native_thread_owner_changed/);}finally{clearTimeout(revoke);}
 const original=join(f.home,'original.sqlite');const replace=setTimeout(()=>{renameSync(f.path,original);symlinkSync(original,f.path);},10);
 try{await assert.rejects(f.confirm(f.home,'enabled-thread','disabled',()=>true),/native_memory_mode_unavailable/);}finally{clearTimeout(replace);}
});
