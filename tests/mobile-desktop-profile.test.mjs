// Synthetic stopped profiles and database only; never opens an installed profile.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {prepareDesktopProfile} from '../scripts/desktop-profile.mjs';
import {schemaHash,sourceSnapshot} from '../scripts/dev-build.mjs';
import {MobileDevices} from '../src/mobile-devices.ts';
import {fixture} from './recursive-fixture.ts';
import {RecursiveTasks} from '../src/recursive-tasks.ts';

const previous='88cd1139adadeb8ad99cacdb40c00a28a5c245c5092bd795fbcc04c09bcc2143';
const legacy='330bffbdd54e1e883c23c834886febe0dec84ea51f78a71de04d5821c2c91ebd';
const previousMobile='1b117d20f5d3a01bd48a25a4ced6623d0867cde7ef65b66267e0a69f3a30a670';
const main='7d4a2adb439ce4db3258eda1c4dec038a1d2255e9d487e531c9d68435d9c426a';
const mobile='f703a0fd4b797548dd0ffdd767511351ba69e7d0fb9d555baa5047a337ffae5e';
const previousReviewed='782386a959d765de6b5521cd4f638ae6997e0777ba913c0e12855c7baf6ad382';
const current='ee1189f5f4a173e99b7769014e122b4b4bb66a2adf039318ea479a7912ec5305';
test('mobile desktop admits the installed and retained legacy profiles without rewriting their markers',()=>{
 const snapshot=sourceSnapshot(resolve('.'));
 assert.equal(schemaHash(snapshot),current,'only the reviewed owner bytes may use this compatibility boundary');
 const parent=resolve('.codex/scratch/mobile-webrtc/profile-upgrade');mkdirSync(parent,{recursive:true});
 for(const schema of [previous,legacy,previousMobile,main,mobile,previousReviewed]){
  const root=mkdtempSync(join(parent,'synthetic-'));
  try{
   writeFileSync(join(root,'.homer-desktop-new'),'{"format":1}');
   const version={schema,codex:'0.163.0'},paths=prepareDesktopProfile(root,version);
   writeFileSync(join(paths.runtime,'synthetic-history'),'retained');
   const marker=readFileSync(join(root,'desktop-profile.json'));
   for(const target of schema===previousReviewed?[current]:[mobile,previousReviewed,current]){
    assert.equal(prepareDesktopProfile(root,{...version,schema:target}).runtime,paths.runtime);
    assert.deepEqual(readFileSync(join(root,'desktop-profile.json')),marker);
    assert.equal(readFileSync(join(paths.runtime,'synthetic-history'),'utf8'),'retained');
   }
   assert.equal(prepareDesktopProfile(root,version).runtime,paths.runtime,'the old build remains admissible');
   assert.throws(()=>prepareDesktopProfile(root,{schema:mobile,codex:'0.164.0'}),/desktop_schema_incompatible/);
   assert.throws(()=>prepareDesktopProfile(root,{schema:current,codex:'0.164.0'}),/desktop_schema_incompatible/);
   assert.throws(()=>prepareDesktopProfile(root,{...version,schema:'unknown'}),/desktop_schema_incompatible/);
  }finally{rmSync(root,{recursive:true,force:true});}
 }
});
test('mobile compatibility refuses unknown source fingerprints and reverse upgrades',()=>{
 const parent=resolve('.codex/scratch/mobile-webrtc/profile-upgrade');mkdirSync(parent,{recursive:true});
 for(const [from,to] of [[previousReviewed,mobile],['unknown',mobile],['unknown',current],[mobile,previous],[current,mobile],[current,previousReviewed],[current,previous],['a7c238c61c8a7927bc8de0e46238147cc07310cf0063f5dbe8f7c3015fa566ef',current]]){
  const root=mkdtempSync(join(parent,'synthetic-'));
  try{
   writeFileSync(join(root,'.homer-desktop-new'),'{"format":1}');
   prepareDesktopProfile(root,{schema:from,codex:'0.163.0'});
   const marker=readFileSync(join(root,'desktop-profile.json'));
   assert.throws(()=>prepareDesktopProfile(root,{schema:to,codex:'0.163.0'}),/desktop_schema_incompatible/);
   assert.deepEqual(readFileSync(join(root,'desktop-profile.json')),marker);
  }finally{rmSync(root,{recursive:true,force:true});}
 }
});
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
