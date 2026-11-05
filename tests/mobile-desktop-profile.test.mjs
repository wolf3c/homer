// Synthetic current database only; never opens an installed profile.
import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {MobileDevices} from '../src/mobile-devices.ts';
import {fixture} from './recursive-fixture.ts';
import {RecursiveTasks} from '../src/recursive-tasks.ts';

test('adding and reopening the device table preserves every existing database table and fact',()=>{
 const f=fixture('.codex/scratch/mobile-webrtc/profile-upgrade');
 try{
  const tables=f.store.db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name").all();
  const read=()=>tables.map(({name,sql})=>({name,sql,rows:f.store.db.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'"').all()}));
  const before=read();
  for(let i=0;i<2;i++){new RecursiveTasks(f.store,f.files).migrate();const devices=new MobileDevices(join(f.dir,'homer.sqlite'));assert.deepEqual(devices.state().devices,[]);devices.close();}
  assert.deepEqual(read(),before);
  assert.deepEqual(f.store.db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name!='mobile_devices' ORDER BY name").all(),tables);
  assert.equal(f.store.db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  assert.equal(f.store.db.prepare('PRAGMA foreign_key_check').all().length,0);
 }finally{f.close();}
});
