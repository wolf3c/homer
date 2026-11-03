import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,until} from './ilink-host-fixture.js';
import {ffmpegPath,mediaProcess} from '../src/media-decode.js';
import {imageDimensions} from '../src/media-policy.js';

test('ILINK-QUEUE-001 / ENGINE-001: real host waits for all images, keeps FIFO and submits native images with original thread',async()=>{
 const s=await setup();try{
  s.receive('101',[{type:1,text_item:{text:'描述这两张图'}},{type:2,image_item:{media:{encrypt_query_param:'a'}}},{type:2,image_item:{media:{encrypt_query_param:'b'}}}]);
  await until(()=>s.app.inputs.list().length===1);s.receive('102',[{type:1,text_item:{text:'后续文字'}}]);await until(()=>s.app.inputs.list().length===2);
  assert.equal(s.turns.length,0);assert.equal(s.app.inputs.preparation(s.app.inputs.list()[0]!.input),'preparing');s.release();
  await until(()=>s.turns.length===2);assert.equal(s.turns[0]!.images?.length,2);assert.ok(s.turns[0]!.images![0]!.url.startsWith('data:image/png;base64,'));assert.equal(s.turns[1]!.images,undefined);assert.equal(s.app.store.meta('mainThread'),'synthetic-main');
  const message=s.app.conversationState().messages.find(m=>m.role==='user'&&m.attachments?.length===2)!;assert.equal(message.media?.filter(a=>a.state==='ready').length,2);
  const ref=message.attachments![0]!;assert.ok(s.app.readAttachment({messageId:message.id,...ref}).data);assert.throws(()=>s.app.readAttachment({messageId:'message-forged',...ref}),/media_scope_denied/);
 }finally{await s.close();}
});
test('ILINK-QUEUE-003 removing a queued attachment revokes only removed lease and retained image still runs',async()=>{
 const s=await setup();try{
  s.receive('401',[{type:1,text_item:{text:'保留第一张'}},{type:2,image_item:{media:{encrypt_query_param:'a'}}},{type:2,image_item:{media:{encrypt_query_param:'b'}}}]);
  await until(()=>s.app.inputs.list().length===1);const row=s.app.inputs.list()[0]!,refs=row.input.attachments!;
  s.app.editQueued({requestId:row.input.requestId,operationId:'remove-second',expectedRevision:row.revision,input:{...row.input,attachments:[refs[0]!]}});
  assert.equal(s.app.media.asset(refs[1]!).state,'revoked');assert.notEqual(s.app.media.asset(refs[0]!).state,'revoked');
  s.release();await until(()=>s.turns.length===1);assert.equal(s.turns[0]!.images?.length,1);
 }finally{await s.close();}
});
