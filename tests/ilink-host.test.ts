import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,until} from './ilink-host-fixture.js';
import {setTimeout as delay} from 'node:timers/promises';

test('ILINK-QUEUE-002 / LIFE-001: revoke during download fences late data and does not execute cancelled message',async()=>{
 const s=await setup();try{
  s.receive('201',[{type:2,image_item:{media:{encrypt_query_param:'a'}}}]);await until(()=>s.app.inputs.list().length===1);const row=s.app.inputs.list()[0]!;
  s.app.cancelQueued({requestId:row.input.requestId,operationId:'cancel',expectedRevision:row.revision});s.release();await delay(120);
  assert.equal(s.turns.length,0);assert.equal(s.app.inputs.list()[0]!.state,'cancelled');assert.equal(s.app.media.asset(row.input.attachments![0]!).state,'revoked');
 }finally{await s.close();}
});
test('ILINK-QUEUE-001: one failed image prevents partial execution and releases FIFO for next text',async()=>{
 const s=await setup();try{
  s.receive('301',[{type:1,text_item:{text:'不可执行残缺图文'}},{type:2,image_item:{aeskey:'fail',media:{encrypt_query_param:'a'}}}]);
  s.receive('302',[{type:1,text_item:{text:'后续消息'}}]);s.release();await until(()=>s.app.inputs.list().some(r=>r.state==='failed'));await until(()=>s.turns.length===1);assert.ok(s.turns[0]!.text.includes('后续消息'));
 }finally{await s.close();}
});
