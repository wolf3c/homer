import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {MediaStore} from '../src/media-store.js';
test('ILINK-QUEUE-003 retained attachment stays scoped while removed lease is revoked atomically',()=>{
 const db=new DatabaseSync(':memory:');try{
  const media=new MediaStore(db),a=media.intent('input','binding','image'),b=media.intent('input','binding','image'),other=media.intent('other','binding','image');
  media.claim(a);media.claim(b);
  media.retainRefs('input',[a]);
  assert.equal(media.asset(a).state,'downloading');assert.equal(media.asset(b).state,'revoked');assert.equal(media.asset(b).lease,null);assert.equal(media.asset(other).state,'received');
  assert.throws(()=>media.retainRefs('input',[other]),/media_scope_denied/);
 }finally{db.close();}
});
