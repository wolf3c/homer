// Synthetic references only; no model or production data.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {attachmentReference,parseAttachmentReference} from '../src/attachment-reference.js';
const assetId='asset-00000000-0000-4000-8000-000000000001';
test('canonical attachment references round trip without selecting or coercing a revision',()=>{
 for(const revision of [1,23,Number.MAX_SAFE_INTEGER]){
  const ref={assetId,revision};const reference=attachmentReference(ref);
  assert.deepEqual(reference,{type:'attachment',id:assetId+'@'+revision});
  assert.deepEqual(parseAttachmentReference(reference.id),ref);
 }
 for(const id of [assetId,assetId+'@',assetId+'@0',assetId+'@01',assetId+'@+1',assetId+'@1.0',assetId+'@1e0',assetId+'@1@2',assetId+'@9007199254740992',assetId+'@1 ',assetId.toUpperCase()+'@1',null,23])assert.throws(()=>parseAttachmentReference(id),/^Error: task_attachment_reference_invalid$/);
 for(const revision of [0,-1,1.1,Infinity,NaN])assert.throws(()=>attachmentReference({assetId,revision}),/task_attachment_reference_invalid/);
});
