import {test} from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {mkdirSync,mkdtempSync,rmSync,existsSync} from 'node:fs';import {resolve,join} from 'node:path';
import {MediaStore} from '../src/media-store.js';
import {writeFileSync,utimesSync,readFileSync} from 'node:fs';
test('ILINK-LIFE-002 missing derivatives are recoverable, orphan bytes count and only aged unowned files are collected',()=>{
 const parent=resolve('.codex/scratch/media-lifecycle');mkdirSync(parent,{recursive:true});const dir=mkdtempSync(join(parent,'recovery-')),db=new DatabaseSync(':memory:');
 try{
  const m=new MediaStore(db,join(dir,'assets')),ref=m.intent('source','binding','file'),lease=m.claim(ref)!;
  m.ready(ref,lease,Buffer.from('source'),'text/plain');
  const d={bytes:Buffer.from('derived'),mime:'text/plain',transform:'text-v1',width:0,height:0};m.derivative('source',ref,d);
  const derived=join(dir,'assets',ref.assetId+'.text-v1');rmSync(derived);m.reconcile();assert.equal(m.asset(ref).state,'retryable_failed');
  const retry=m.claim(ref)!;assert.throws(()=>m.ready(ref,retry,Buffer.from('changed'),'text/plain'),/media_source_changed/);
  assert.equal(readFileSync(join(dir,'assets',ref.assetId)).toString(),'source');m.ready(ref,retry,Buffer.from('source'),'text/plain');m.derivative('source',ref,d);assert.equal(m.asset(ref).state,'ready');
  const orphan=join(dir,'assets',ref.assetId+'.orphan-v1'),temp=join(dir,'assets',ref.assetId+'.00000000-0000-0000-0000-000000000001.part'),unrelated=join(dir,'assets','unrelated.txt');
  for(const path of [orphan,temp,unrelated]){writeFileSync(path,'orphan');utimesSync(path,new Date(Date.now()-25*3600000),new Date(Date.now()-25*3600000));}
  assert.equal(m.diskUsage(),31);m.gc();assert.equal(existsSync(orphan),false);assert.equal(existsSync(temp),false);assert.equal(existsSync(unrelated),true);assert.equal(existsSync(derived),true);assert.equal(m.diskUsage(),19);
  db.prepare('UPDATE media_assets SET attempt=3').run();rmSync(derived);m.reconcile();assert.equal(m.asset(ref).state,'failed');
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
test('ILINK-LIFE-001 original+derivatives count toward quota, pins prevent GC and release removes both',()=>{
 const root=resolve('.codex/scratch/media-lifecycle');mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'fixture-')),db=new DatabaseSync(join(dir,'db.sqlite'));try{
  const m=new MediaStore(db,join(dir,'assets')),r=m.intent('request','binding','file'),lease=m.claim(r)!;m.ready(r,lease,Buffer.from('source'),'text/plain');m.derivative('request',r,{bytes:Buffer.from('derived'),mime:'text/plain',transform:'text-v1',width:0,height:0});assert.equal(m.diskUsage(),13);
  m.pin('request',r,'task:active');assert.equal(m.gc(Date.now()+31*86400000),0);m.unpin('task:active');assert.equal(m.gc(Date.now()+31*86400000),1);assert.equal(m.asset(r).state,'deleted');assert.equal(m.diskUsage(),0);assert.equal(existsSync(join(dir,'assets',r.assetId+'.text-v1')),false);
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
test('ILINK-MEDIA-003 interrupted transfer recovery fences stale lease and missing originals fail clearly',()=>{
 const root=resolve('.codex/scratch/media-lifecycle'),dir=mkdtempSync(join(root,'fixture-')),db=new DatabaseSync(join(dir,'db.sqlite'));try{
  const m=new MediaStore(db,join(dir,'assets')),r=m.intent('request','binding','file'),old=m.claim(r)!;m.reconcile();assert.equal(m.asset(r).state,'retryable_failed');assert.throws(()=>m.ready(r,old,Buffer.from('late'),'text/plain'),/lease/);const next=m.claim(r)!;m.ready(r,next,Buffer.from('current'),'text/plain');rmSync(join(dir,'assets',r.assetId));m.reconcile();assert.equal(m.asset(r).error,'media_file_missing');
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
