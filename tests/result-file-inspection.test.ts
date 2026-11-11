import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {htmlAttachmentFixture} from './canvas-html-publication-fixture.js';

const body='实际合成文档内容';
function fixture(){
 const f=htmlAttachmentFixture('answer.txt',Buffer.from(body)),sent=f.send();
 const {assetId,revision}=sent;
 return {...f,sent,inspect:()=>f.app.mediaTool('inspect_attachment',{assetId,revision})};
}

test('attachment inspection returns exact text and source digest without a separate inspection receipt',async()=>{
 const f=fixture();
 try{
  const operations=()=>f.store.db.prepare("SELECT id,kind,state FROM operations ORDER BY rowid").all();
  const before=operations();
  const result=await f.inspect();
  assert.equal(result.extraction.state,'ready');
  assert.equal(result.extraction.text,body);assert.equal(result.extraction.sourceHash,f.sent.sha256);
  assert.equal(result.assetId,f.sent.assetId);assert.equal(result.revision,f.sent.revision);
  assert.deepEqual(operations(),before);
 }finally{f.close();}
});

test('attachment inspection rejects changed bytes and invalid message provenance',async()=>{
 const f=fixture();
 try{
  writeFileSync(f.sent.path,Buffer.alloc(f.bytes.length,42));
  await assert.rejects(f.inspect(),/media_integrity_failed/);
  writeFileSync(f.sent.path,f.bytes);
  const stage=f.media.asset(f.sent).originOperationKey!;
  const edit=f.store.db.prepare('UPDATE operations SET state=? WHERE id=?');
  edit.run('accepted',stage);
  await assert.rejects(f.inspect(),/media_scope_denied/);
  edit.run('confirmed',stage);
  f.store.db.prepare('UPDATE operations SET detailsJson=? WHERE id=?').run('null',stage);
  await assert.rejects(f.inspect(),/media_scope_denied/);
 }finally{f.close();}
});

test('attachment inspection cannot complete into a replaced main context',async()=>{
 const f=fixture();
 try{
  const pending=f.inspect();f.app.mainContext={...f.app.mainContext};
  await assert.rejects(pending,/tool_scope_denied/);
 }finally{f.close();}
});

test('revocation during extraction fences the in-flight attachment read',async()=>{
 const f=fixture();
 try{
  const pending=f.inspect();
  assert.ok(f.history.revokeMessage(f.threadId,f.sent.messageId));
  await assert.rejects(pending,/media_scope_denied/);
 }finally{f.close();}
});
