import {test} from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {mkdirSync,mkdtempSync,rmSync,existsSync} from 'node:fs';import {resolve,join} from 'node:path';
import {MediaStore} from '../src/media-store.js';
import {writeFileSync,utimesSync,readFileSync,rmdirSync} from 'node:fs';
test('ILINK-LIFE-002 missing derivatives are recoverable, orphan bytes count and only aged unowned files are collected',()=>{
 const parent=resolve('.codex/scratch/media-lifecycle');mkdirSync(parent,{recursive:true});const dir=mkdtempSync(join(parent,'recovery-')),db=new DatabaseSync(':memory:');
 try{
  const m=new MediaStore(db,join(dir,'assets')),ref=m.intent('source','binding','file'),lease=m.claim(ref)!;
  m.ready(ref,lease,Buffer.from('source'),'text/plain');
  const d={bytes:Buffer.from('derived'),mime:'text/plain',transform:'text-v1',width:0,height:0};m.derivative('source',ref,d);
  const derived=join(dir,'assets',ref.assetId+'.text-v1');rmSync(derived);m.reconcile();assert.equal(m.asset(ref).state,'retryable_failed');
  assert.equal(m.asset(ref).error,'media_derivative_missing');
  assert.deepEqual(m.readAttachment(ref).bytes,Buffer.from('source'));
  const retry=m.claim(ref)!;assert.throws(()=>m.ready(ref,retry,Buffer.from('changed'),'text/plain'),/media_source_changed/);
  assert.equal(readFileSync(join(dir,'assets',ref.assetId)).toString(),'source');m.ready(ref,retry,Buffer.from('source'),'text/plain');m.derivative('source',ref,d);assert.equal(m.asset(ref).state,'ready');
  const orphan=join(dir,'assets',ref.assetId+'.orphan-v1'),temp=join(dir,'assets',ref.assetId+'.00000000-0000-0000-0000-000000000001.part'),unrelated=join(dir,'assets','unrelated.txt');
  for(const path of [orphan,temp,unrelated]){writeFileSync(path,'orphan');utimesSync(path,new Date(Date.now()-25*3600000),new Date(Date.now()-25*3600000));}
  assert.equal(m.diskUsage(),31);m.gc();assert.equal(existsSync(orphan),false);assert.equal(existsSync(temp),false);assert.equal(existsSync(unrelated),true);assert.equal(existsSync(derived),true);assert.equal(m.diskUsage(),19);
  db.prepare('UPDATE media_assets SET attempt=3').run();rmSync(derived);m.reconcile();assert.equal(m.asset(ref).state,'failed');
  assert.deepEqual(m.readAttachment(ref).bytes,Buffer.from('source'));
  writeFileSync(join(dir,'assets',ref.assetId),'forged');
  assert.throws(()=>m.readAttachment(ref),/media_integrity_failed/);
  m.revoke('source');
  assert.throws(()=>m.readAttachment(ref),/media_scope_denied/);
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
test('exact local snapshots stay pinned by each committed message and abandon only unreferenced staging',()=>{
 const root=resolve('.codex/scratch/media-lifecycle');
 mkdirSync(root,{recursive:true});
 const dir=mkdtempSync(join(root,'snapshot-')),db=new DatabaseSync(join(dir,'db.sqlite'));
 try {
  const media=new MediaStore(db,join(dir,'assets'));
  const ref=media.snapshot('origin',{filename:'output.txt',kind:'file',mime:'text/plain',bytes:Buffer.from('captured bytes')});
  const expiredAt=Date.now()+31*86400000;
  assert.equal(media.asset(ref).originOperationKey,'origin');
  assert.equal(media.asset(ref).requestId,null);
  assert.throws(()=>media.read('source',ref),/media_scope_denied/);
  assert.equal(media.gc(expiredAt),0);
  media.pinAttachment(ref,'message:first');
  media.pinAttachment(ref,'message:second');
  media.abandonOperation('origin');
  media.unpin('message:first');
  const orphan=media.snapshot('orphan',{filename:'draft.txt',kind:'file',mime:'text/plain',bytes:Buffer.from('draft')});
  media.abandonOperation('orphan');
  const upload=media.intent('unrelated-upload','binding','file');
  media.ready(upload,media.claim(upload)!,Buffer.from('unrelated'),'text/plain');
  db.prepare('UPDATE media_assets SET expiresAt=0 WHERE id=?').run(upload.assetId);
  assert.equal(media.gc(Date.now(),'orphan'),1);
  assert.equal(media.asset(orphan).state,'deleted');
  assert.equal(media.asset(upload).state,'ready');
  assert.equal(media.gc(),1);
  assert.equal(media.gc(expiredAt),0);
  assert.equal(media.readAttachment(ref).bytes.toString(),'captured bytes');
  writeFileSync(join(dir,'assets',ref.assetId),'altered bytes!');
  assert.throws(()=>media.readAttachment(ref),/media_integrity_failed/);
  media.unpin('message:second');
  assert.equal(media.gc(expiredAt),1);
  assert.equal(media.asset(ref).state,'deleted');
 } finally { db.close();rmSync(dir,{recursive:true,force:true}); }
});
test('legacy media schema is rejected before any media tables are created',()=>{
 const db=new DatabaseSync(':memory:');
 try {
  db.exec('CREATE TABLE media_schema(version INTEGER); INSERT INTO media_schema VALUES(1)');
  assert.throws(()=>new MediaStore(db),/media_schema_unsupported/);
  assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>row.name),['media_schema']);
 } finally { db.close(); }
});
test('failed first initialization rolls back media tables and allows a fresh retry',()=>{
 const db=new DatabaseSync(':memory:'),execute=db.exec.bind(db);
 try{
  db.exec=sql=>{
   const version=sql.indexOf('INSERT INTO media_schema');
   if(version<0){execute(sql);return;}
   execute(sql.slice(0,version));
   throw Error('synthetic_media_schema_interrupted');
  };
  assert.throws(()=>new MediaStore(db),/synthetic_media_schema_interrupted/);
  assert.equal(db.isTransaction,false);
  assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'media_%'").all(),[]);
  db.exec=execute;
  new MediaStore(db);
  assert.equal(db.prepare('SELECT version FROM media_schema').get()?.version,2);
 }finally{db.close();}
});
test('an interrupted local write keeps its operation pin until owner-confirmed abandonment',()=>{
 const root=resolve('.codex/scratch/media-lifecycle');
 mkdirSync(root,{recursive:true});
 const dir=mkdtempSync(join(root,'snapshot-recovery-')),db=new DatabaseSync(join(dir,'db.sqlite'));
 const assets=join(dir,'assets');
 try{
  const media=new MediaStore(db,assets);
  rmdirSync(assets);
  assert.throws(()=>media.snapshot('interrupted',{filename:'unfinished.txt',kind:'file',mime:'text/plain',bytes:Buffer.from('source')}),/ENOENT/);
  const pinned=db.prepare("SELECT assetId,revision FROM media_pins WHERE scope='operation:interrupted'").get();
  assert.ok(pinned);
  const ref={assetId:String(pinned.assetId),revision:Number(pinned.revision)};
  const recovered=new MediaStore(db,assets);
  recovered.reconcile();
  assert.throws(()=>recovered.readAttachment(ref),/media_not_ready/);
  assert.equal(recovered.claim(ref),undefined);
  assert.equal(recovered.gc(Date.now()+31*86400000),0);
  recovered.abandonOperation('interrupted');
  assert.equal(recovered.gc(),1);
  assert.equal(recovered.asset(ref).state,'deleted');
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
