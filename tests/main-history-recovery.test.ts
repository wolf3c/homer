import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recoveryFixture} from './main-history-recovery-fixture.js';
import {homerWebBridge} from '../src/web-homer.js';

for(const count of [0,1,81])test('unrelated historical receipts add no main turns: '+count,async()=>{
 const f=await recoveryFixture(count);try{
  const db=f.app.store.db,originals=db.prepare('SELECT * FROM agent_receipts WHERE messageId IN (SELECT id FROM agent_messages WHERE kind=\'worker_reply\') ORDER BY messageId').all(),runs=db.prepare('SELECT * FROM runs ORDER BY id').all();
  assert.equal(f.turns.length,0);await f.submit();
  assert.equal(f.turns.length,1);assert.equal(f.turns[0]!.requestId,'new-user');assert.deepEqual(f.calls,[]);
  assert.deepEqual(db.prepare('SELECT * FROM agent_receipts WHERE messageId IN (SELECT id FROM agent_messages WHERE kind=\'worker_reply\') ORDER BY messageId').all(),originals);
  assert.deepEqual(db.prepare('SELECT * FROM runs ORDER BY id').all(),runs);assert.equal(db.prepare('SELECT count(*) n FROM results').get()!.n,0);
  await f.reopen();assert.equal(f.turns.length,1);await f.submit('another-user');assert.equal(f.turns.length,2);
  assert.ok((await homerWebBridge(f.app).history!.state()).messages.some(message=>message.text.includes('Synthetic user requirement handled')));
 }finally{await f.close();}
});

test('first launch and ordinary user reception preserve original unknown inputs without a recovery round',async()=>{
 const f=await recoveryFixture(2);try{
  await f.submit('initialization','first_launch');await f.submit('real-user');assert.equal(f.turns.length,2);assert.deepEqual(f.calls,[]);
  for(const original of f.originals)assert.equal(f.app.store.db.prepare('SELECT state FROM agent_receipts WHERE messageId=?').get(original.id)!.state,'uncertain');
 }finally{await f.close();}
});

test('an explicit user inspection reads the exact original Worker message without replay or manual ACK',async()=>{
 const f=await recoveryFixture(2);try{
  const before=f.app.store.db.prepare('SELECT * FROM agent_receipts WHERE messageId=?').get(f.originals[0]!.id);
  await f.app.message('inspect '+f.originals[0]!.id,'explicit-inspection');await f.app.idle();
  assert.equal(f.turns.length,1);assert.deepEqual(f.calls.map(call=>call.tool),['work_inspect','worker_read']);
  assert.equal(f.calls[1]!.args.messageId,f.originals[0]!.id);assert.equal(f.calls[1]!.args.workerId,f.originals[0]!.workerId);
  assert.deepEqual(f.app.store.db.prepare('SELECT * FROM agent_receipts WHERE messageId=?').get(f.originals[0]!.id),before);
  assert.equal(f.app.store.runs().length,2);
 }finally{await f.close();}
});

test('a user arriving during historical inspection retains its own request and runs once',async()=>{
 const f=await recoveryFixture(2);try{
  f.beforeRecovery=async()=>{f.beforeRecovery=undefined;f.app.submitMessage({requestId:'newer-user',text:'Synthetic newer requirement'});};
  await f.app.message('inspect '+f.originals[0]!.id,'inspection');await f.app.idle();
  assert.deepEqual(f.turns.map(turn=>turn.requestId),['inspection','newer-user']);assert.equal(f.calls.filter(call=>call.tool==='worker_read').length,1);
 }finally{await f.close();}
});

for(const behavior of ['ignore','error','fail-user'] as const)test('historical receipts survive unrelated '+behavior+' and a later user retry',async()=>{
 const f=await recoveryFixture(2);try{
  f.behavior=behavior;await f.submit();assert.equal(f.turns.length,1);
  for(const original of f.originals)assert.equal(f.app.store.db.prepare('SELECT state FROM agent_receipts WHERE messageId=?').get(original.id)!.state,'uncertain');
  f.behavior='inspect';await f.submit('retry-without-restart');assert.equal(f.turns.length,2);assert.equal(f.app.inputs.byRequestIds(['retry-without-restart'])[0]!.state,'completed');
  await f.reopen();assert.equal(f.turns.length,2);assert.deepEqual(f.calls,[]);
 }finally{await f.close();}
});

test('an unconfirmed engine closure blocks replacement and preserves every original receipt',async()=>{
 const f=await recoveryFixture();try{
  f.behavior='unconfirmed-close';await f.submit();assert.equal(f.turns.length,1);assert.equal(f.app['mainBroken'],true);
  assert.throws(()=>f.app.submitMessage({requestId:'unsafe-retry',text:'Synthetic retry'}),/main_engine_unavailable/);
  assert.equal(f.app.store.db.prepare('SELECT state FROM agent_receipts WHERE messageId=?').get(f.originals[0]!.id)!.state,'uncertain');
  assert.deepEqual(f.calls,[]);
 }finally{await f.close();}
});
