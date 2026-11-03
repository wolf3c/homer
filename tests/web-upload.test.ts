import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {MediaStore} from '../src/media-store.js';
import {webUpload} from '../src/web-upload.js';
const input={threadId:'synthetic-main',requestId:'synthetic-request',uploadId:'synthetic-upload',filename:'notes.txt',data:Buffer.from('synthetic note').toString('base64')};
test('Web upload validates binary bytes and metadata without trusting filename or MIME',()=>{
 assert.equal(webUpload(input).kind,'file');
 assert.equal(webUpload({...input,filename:'pretend.png'}).kind,'file');
 for(const change of [{filename:'../escape'},{data:'Zg='},{data:'Zg==\n'},{requestId:undefined},{url:'http://example.invalid'},{data:''}])assert.throws(()=>webUpload({...input,...change}),/web_upload_/);
});
test('Web upload retry retains one scoped asset and rejects changed bytes, scope and accepted request',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  const media=new MediaStore(db),v=webUpload(input),ref=media.webIntent(v);
  assert.deepEqual(media.webIntent(v),ref);
  assert.equal(media.asset(ref).bindingId,'web:synthetic-main');
  for(const change of [{hash:'different'},{threadId:'other-main'},{requestId:'other-request'},{filename:'other.txt'}])assert.throws(()=>media.webIntent({...v,...change}),/web_upload_conflict/);
  db.exec('CREATE TABLE conversation_inputs(requestId TEXT PRIMARY KEY)');db.prepare('INSERT INTO conversation_inputs VALUES(?)').run(input.requestId);
  assert.deepEqual(media.webIntent(v),ref);
  assert.throws(()=>media.webIntent({...v,uploadId:'another-upload'}),/web_upload_request_closed/);
 }finally{db.close();}
});
test('Web draft removal is scoped, idempotent, terminal for that upload and fenced once accepted',()=>{
 const db=new DatabaseSync(':memory:');try{
  const media=new MediaStore(db),v=webUpload(input),ref=media.webIntent(v),remove={...ref,threadId:input.threadId,requestId:input.requestId};
  assert.throws(()=>media.discardWeb({...remove,threadId:'foreign'}),/media_scope_denied/);
  assert.deepEqual(media.discardWeb(remove),{state:'removed'});assert.deepEqual(media.discardWeb(remove),{state:'removed'});
  assert.throws(()=>media.webIntent(v),/media_scope_denied/);
  const next=media.webIntent({...v,uploadId:'new-upload'});assert.notEqual(next.assetId,ref.assetId);
  assert.throws(()=>media.webIntent({...v,uploadId:'foreign',threadId:'foreign'}),/media_scope_denied/);
  db.exec('CREATE TABLE conversation_inputs(requestId TEXT PRIMARY KEY)');db.prepare('INSERT INTO conversation_inputs VALUES(?)').run(input.requestId);
  assert.throws(()=>media.discardWeb({...remove,...next}),/web_upload_request_closed/);
 }finally{db.close();}
});
