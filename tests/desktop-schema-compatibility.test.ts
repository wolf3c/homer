// Synthetic stopped-profile migration only. No user data, engine or model calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './recursive-fixture.js';
const names=['waitingEnteredAt','reviewEnteredAt','settledAt'];
for(const interrupted of [false,true])test(`reviewed additive task migration preserves all old facts; interrupted=${interrupted}`,()=>{
 const f=fixture('.codex/scratch/desktop-schema-tests');
 try{
  for(const name of names)f.store.db.exec(`ALTER TABLE tasks DROP COLUMN ${name}`);
  const columns=(f.store.db.prepare('PRAGMA table_info(tasks)').all() as {name:string}[]).map(c=>c.name),select=()=>f.store.db.prepare(`SELECT ${columns.join(',')} FROM tasks ORDER BY id`).all();
  const before=select(),meta=f.store.db.prepare('SELECT * FROM meta ORDER BY key').all();
  if(interrupted){
   const exec=f.store.db.exec.bind(f.store.db);f.store.db.exec=sql=>{if(sql==='ALTER TABLE tasks ADD COLUMN reviewEnteredAt INTEGER')throw Error('synthetic_write_failure');return exec(sql);};
   try{assert.throws(()=>f.tasks.migrate(),/synthetic_write_failure/);}finally{f.store.db.exec=exec;}
   assert.deepEqual(select(),before);assert.equal(f.store.db.prepare('PRAGMA integrity_check').get()!.integrity_check,'ok');
  }
  f.tasks.migrate();f.tasks.migrate();
  assert.deepEqual(select(),before);assert.deepEqual(f.store.db.prepare('SELECT * FROM meta ORDER BY key').all(),meta);
  const added=(f.store.db.prepare('PRAGMA table_info(tasks)').all() as {name:string;type:string;notnull:number;dflt_value:unknown}[]).filter(c=>names.includes(c.name));
  assert.equal(added.length,3);for(const c of added){assert.equal(c.type,'INTEGER');assert.equal(c.notnull,0);assert.equal(c.dflt_value,null);}
  for(const row of f.store.db.prepare(`SELECT ${names.join(',')} FROM tasks`).all())assert.ok(Object.values(row).every(v=>v===null));
  // The exact old explicit-column insert contract still works after upgrade.
  f.store.db.prepare("INSERT INTO matters(id,title,status,createdAt) VALUES('synthetic-legacy-matter','Legacy insert','queued',1)").run();
  const old=before[0]!;f.store.db.prepare(`INSERT INTO tasks(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).run(...columns.map(c=>c==='id'||c==='rootTaskId'?'synthetic-legacy-task':c==='matterId'?'synthetic-legacy-matter':old[c]!));
  assert.equal(f.store.db.prepare("SELECT waitingEnteredAt FROM tasks WHERE id='synthetic-legacy-task'").get()!.waitingEnteredAt,null);
  assert.equal(f.store.db.prepare('PRAGMA integrity_check').get()!.integrity_check,'ok');assert.equal(f.store.db.prepare('PRAGMA foreign_key_check').all().length,0);
 }finally{f.close();}
});
