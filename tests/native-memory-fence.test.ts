import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,unlinkSync,symlinkSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {Store} from '../src/store.js';
import {Memory} from '../src/memory.js';
import {NativeMemory} from '../src/native-memory.js';
function fixture(){
 const parent=resolve('.codex/scratch/native-memory-fence-tests');mkdirSync(parent,{recursive:true});const root=mkdtempSync(join(parent,'synthetic-'));
 const store=new Store(join(root,'business.sqlite'));new Memory(store);
 const home=join(root,'codex'),notes=join(home,'memories/extensions/ad_hoc/notes');mkdirSync(notes,{recursive:true});
 const memory=new NativeMemory(store,home);let n=0;
 const run=()=>{const r=store.dispatch({requestId:'r-'+ ++n,title:'synthetic',goal:'synthetic',material:'a.md'});memory.bindSnapshot(r.id,memory.snapshot('synthetic'));return r;};
 return {root,home,notes,store,memory,run};
}
test('native authority never reads or writes legacy facts; old host calls fail without a receipt',()=>{
 const f=fixture();try{
  for(const table of ['memory_entries','memory_sources','memory_operations','memory_jobs','memory_suppressions','memory_settings'])for(const op of ['INSERT','UPDATE','DELETE'])f.store.db.exec(`CREATE TRIGGER deny_${table}_${op} BEFORE ${op} ON ${table} BEGIN SELECT RAISE(ABORT,'legacy_access'); END`);
  f.memory.observe('r','t');f.memory.adopt('r','t','synthetic');f.memory.refreshQueuedSource('r','t');f.memory.revokeQueuedSource('r');
  assert.deepEqual(f.memory.autoSave({threadId:'t',epoch:0}),[]);assert.deepEqual(f.memory.acceptCandidates('r',{content:'synthetic',hash:'h'}),[]);
  assert.deepEqual(f.memory.snapshot('').entries,[]);assert.deepEqual(f.memory.list().entries,[]);
  assert.throws(()=>f.memory.read('legacy'),/native_tools_required/);assert.throws(()=>f.memory.search(''),/native_tools_required/);
  assert.throws(()=>f.memory.propose({operationId:'op',content:'synthetic'},{threadId:'t',epoch:0}),/native_tools_required/);
  assert.throws(()=>f.memory.stageCandidate('r','synthetic',{content:'synthetic',hash:'h'}),/native_tools_required/);
 }finally{f.store.close();}
});
test('native additions, edits and deletions do not invalidate existing consumers',()=>{
 const f=fixture();try{
  const a=f.run(),b=f.run(),snapshot=f.memory.runSnapshot(a.id),before=f.store.db.prepare('SELECT * FROM meta').all();
  const file=join(f.notes,'synthetic.md');writeFileSync(file,'Synthetic A');
  for(const r of [a,b])f.memory.validateRun(r.id);
  writeFileSync(file,'Synthetic B');assert.equal(f.memory.refresh(),false);unlinkSync(file);
  f.memory.validateSnapshot(snapshot);f.memory.bindSnapshot(f.run().id,snapshot);
  assert.deepEqual(f.store.db.prepare('SELECT * FROM meta').all(),before);
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM memory_snapshots').get()!.n,0);
 }finally{f.store.close();}
});
test('native restart preserves legacy snapshots without rewriting their history',()=>{
 const f=fixture();try{
  const run=f.run();f.store.db.prepare("INSERT INTO memory_snapshots VALUES(?,0,'[]','current')").run(run.id);
  const before=f.store.db.prepare('SELECT * FROM memory_snapshots').all();writeFileSync(join(f.notes,'synthetic.md'),'Synthetic changed');
  const next=new NativeMemory(f.store,f.home);next.validateRun(run.id);assert.deepEqual(f.store.db.prepare('SELECT * FROM memory_snapshots').all(),before);
 }finally{f.store.close();}
});
test('the host does not inspect native note bodies or follow links to maintain a parallel fingerprint',()=>{
 const f=fixture();try{
  const a=f.run();writeFileSync(join(f.root,'outside'),'SYNTHETIC');symlinkSync(join(f.root,'outside'),join(f.notes,'native-link'));
  f.memory.validateRun(a.id);assert.equal(f.memory.refresh(),false);assert.equal(f.store.meta('nativeMemoryFingerprint'),undefined);
 }finally{f.store.close();}
});
