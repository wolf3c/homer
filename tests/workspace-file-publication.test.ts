import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync,readFileSync,symlinkSync,linkSync,truncateSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {htmlAttachmentFixture} from './canvas-html-publication-fixture.js';

test('ordinary workspace files become exact snapshots only when sent and replay keeps the original bytes',()=>{
 const f=htmlAttachmentFixture('report.md',Buffer.from('# Synthetic report\nUnknown date.\n'));
 try{
  assert.equal(f.history.message(f.replyId)?.attachments,undefined);
  const first=f.send();
  assert.notEqual(first.path,f.original);
  assert.deepEqual(readFileSync(first.path),f.bytes);
  writeFileSync(f.original,'# Source changed later');
  assert.deepEqual(f.send(),first);
  assert.deepEqual(readFileSync(first.path),f.bytes);
  const second=join(dirname(f.original),'second.md');
  writeFileSync(second,'A different file');
  assert.throws(()=>f.send([{path:second}]),/operation_payload_conflict/);
  assert.equal(f.history.list(f.threadId).filter(message=>message.attachments?.length).length,1);
  const foreignMessage=f.store.transaction(()=>f.history.commitAssistant({
   threadId:'other-thread',text:'Other thread attachment',operationKey:'synthetic-other-thread',attachments:[{assetId:first.assetId,revision:first.revision}],
  }));
  assert.throws(()=>f.app.readAttachment({...first,messageId:foreignMessage}),/media_scope_denied/);
 }finally{f.close();}
});

test('attachment selection rejects missing, protected, relative, linked and empty files without committing',()=>{
 const f=htmlAttachmentFixture(),workspace=dirname(f.original);
 try{
  const symbolic=join(workspace,'symbolic.md'),hard=join(workspace,'hard.md'),linked=join(workspace,'linked.md'),empty=join(workspace,'empty.md');
  writeFileSync(linked,'Synthetic linked file');symlinkSync(linked,symbolic);linkSync(linked,hard);writeFileSync(empty,'');
  for(const [index,path] of [join(workspace,'missing.md'),f.protectedFile,'relative.md',symbolic,hard,empty].entries()){
   assert.throws(()=>f.send([{path}], 'denied-'+index),/artifact_missing|artifact_path_denied|file_type_or_size_denied/);
   assert.equal(f.history.message(f.replyId)?.status,'running');
   assert.equal(f.history.message(f.replyId)?.attachments,undefined);
  }
  assert.throws(()=>f.send([{path:f.original},{path:f.protectedFile}],'partial'),/artifact_path_denied/);
  assert.equal(f.history.message(f.replyId)?.attachments,undefined);
  assert.equal(f.store.db.prepare("SELECT count(*) n FROM media_pins WHERE scope='operation:stage:partial'").get()?.n,0);
  assert.equal(f.store.db.prepare("SELECT state FROM media_assets WHERE originOperationKey='stage:partial'").get()?.state,'deleted');
  assert.equal(f.media.gc(),0,'only the partially staged local snapshot was collected');
  assert.deepEqual(readFileSync(f.original),f.bytes);
  assert.equal(f.media.readAttachment(f.hidden).bytes.toString(),'uncommitted bytes');
 }finally{f.close();}
});

test('oversized local source is rejected before a message or a pin can be committed',()=>{
 const f=htmlAttachmentFixture();
 try{
  truncateSync(f.original,50*1024*1024+1);
  assert.throws(()=>f.send(),/file_type_or_size_denied|media_size_limit/);
  assert.equal(f.history.message(f.replyId)?.attachments,undefined);
  assert.equal(f.store.db.prepare("SELECT count(*) n FROM media_pins WHERE scope='operation:stage:synthetic-send'").get()?.n,0);
 }finally{f.close();}
});

test('a late send call in the stopped native turn cannot commit attachments',async()=>{
 const f=htmlAttachmentFixture();
 try{
  assert.deepEqual(await f.app.stopMain(f.replyId),{requested:true});
  assert.throws(()=>f.send(),/tool_scope_denied/);
  assert.equal(f.history.message(f.replyId)?.attachments,undefined);
  assert.equal(f.store.db.prepare("SELECT 1 FROM operations WHERE kind='send_user_message'").get(),undefined);
 }finally{f.close();}
});
