import {test} from 'node:test';
import assert from 'node:assert/strict';
import {restoreComposerDraft,singleComposerDraft} from '../ui/conversation-client.js';
test('retired queue editor original draft restores without consuming references, attachments or request identity',()=>{
 const original={text:'普通草稿',requestId:'draft-original',quotes:[{messageId:'one',text:'第一段',annotation:'原批注'},{messageId:'two',text:'第二段',annotation:''}],attachments:[{assetId:'asset-original',revision:2,filename:'保留.txt',kind:'file' as const,state:'ready' as const,mime:'text/plain',size:5,error:null}]};
 const before=JSON.stringify(original),restored=singleComposerDraft(restoreComposerDraft(original,undefined,false)!);
 assert.equal(restored.requestId,original.requestId);assert.deepEqual(restored.attachments,original.attachments);
 assert.equal(restored.text,original.text);assert.deepEqual(restored.quotes,original.quotes);
 assert.equal(JSON.stringify(original),before,'original archive is unchanged');
});
