import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recoveryFixture} from './main-history-recovery-fixture.js';
import {homerWebBridge} from '../src/web-homer.js';

test('user submission reconciles original uncertain receipts in order through the production tools without replay',async()=>{
 const f=await recoveryFixture(2);try{
  const db=f.app.store.db,bodies=db.prepare('SELECT * FROM agent_messages ORDER BY seq').all();
  const receipts=new Map(db.prepare('SELECT messageId,revision,offeredTurnId FROM agent_receipts').all().map(row=>[row.messageId,row]));
  const runs=db.prepare('SELECT * FROM runs ORDER BY id').all();
  assert.equal(f.turns.length,0,'opening Homer does not trigger recovery');
  await f.submit();
  assert.deepEqual(f.calls.filter(call=>call.tool==='inbox_ack').map(call=>call.args.messageId),f.originals.map(item=>item.id));
  assert.equal(f.turns.length,3,'one user turn followed by one reconciliation per original');
  assert.ok(f.turns.every(turn=>turn.requestId==='new-user'));
  for(const item of f.originals){
   assert.equal(db.prepare('SELECT state FROM agent_receipts WHERE messageId=?').get(item.id)!.state,'rejected');
   assert.equal(db.prepare("SELECT count(*) n FROM operations WHERE kind='ack' AND scopeId=?").get(item.id)!.n,1);
   const receipt=db.prepare('SELECT revision,offeredTurnId FROM agent_receipts WHERE messageId=?').get(item.id)!;
   assert.equal(receipt.revision,Number(receipts.get(item.id)!.revision)+1,'only the original ACK changes the receipt revision');
   assert.equal(receipt.offeredTurnId,receipts.get(item.id)!.offeredTurnId,'the original is never offered to a new turn');
  }
  assert.deepEqual(db.prepare("SELECT * FROM agent_messages WHERE kind<>'user_input' ORDER BY seq").all(),bodies.filter(row=>row.kind!=='user_input'));
  assert.deepEqual(db.prepare('SELECT * FROM runs ORDER BY id').all(),runs,'no business work is retried or resumed');
  assert.equal(f.app.inputs.dispatchPage(undefined,'epoch','all').items.length,0);
  assert.equal(f.app.inputs.dispatchSummary().awaitingUser,undefined);
  const history=await homerWebBridge(f.app).history!.state();
  assert.ok(history.messages.some(message=>message.text.includes('Synthetic user requirement handled')),'continuations preserve the native user answer');
  await f.reopen();assert.equal(f.turns.length,3);await f.submit('another-user');assert.equal(f.turns.length,4,'confirmed history is not reconciled again');
 }finally{await f.close();}
});

test('reconciliation handles a finite snapshot larger than the inbox read page',async()=>{
 const f=await recoveryFixture(81);try{
  await f.submit();
  assert.equal(f.turns.length,82);
  assert.deepEqual(f.calls.filter(call=>call.tool==='inbox_ack').map(call=>call.args.messageId),f.originals.map(item=>item.id));
  assert.equal(f.app.inputs.dispatchPage(undefined,'epoch','all').items.length,0);
 }finally{await f.close();}
});

for(const behavior of ['processed','empty'] as const)test('recovery accepts existing ACK dispositions and an empty internal final: '+behavior,async()=>{
 const f=await recoveryFixture();try{
  f.behavior=behavior;await f.submit();
  assert.equal(f.turns.length,2);
  assert.equal(f.app.store.db.prepare('SELECT state FROM agent_receipts WHERE messageId=?').get(f.originals[0]!.id)!.state,behavior==='processed'?'processed':'rejected');
  assert.ok(f.messages.some(message=>message.type==='reply'&&message.text.includes('Synthetic user requirement handled')));
  const state=await homerWebBridge(f.app).history!.state();
  assert.ok(state.messages.some(message=>message.text.includes('Synthetic user requirement handled')));
 }finally{await f.close();}
});

test('opening and first-launch initialization never reconcile old receipts',async()=>{
 const f=await recoveryFixture();try{
  await f.submit('initialization','first_launch');
  assert.equal(f.turns.length,1);assert.deepEqual(f.calls,[]);
  assert.equal(f.app.inputs.dispatchSummary().awaitingUser,true);
  await f.submit('real-user');assert.equal(f.turns.length,3);
 }finally{await f.close();}
});

test('an ordinary user message with no old receipts needs no recovery round',async()=>{
 const f=await recoveryFixture(0);try{
  await f.submit();assert.equal(f.turns.length,1);assert.deepEqual(f.calls,[]);
 }finally{await f.close();}
});

test('an original already acknowledged during the user task needs no extra recovery turn',async()=>{
 const f=await recoveryFixture();try{
  f.app.submitMessage({requestId:'direct-review',text:'Reconcile this original: '+f.originals[0]!.id});await f.app.idle();
  assert.equal(f.turns.length,1);assert.equal(f.calls.filter(call=>call.tool==='inbox_ack').length,1);
  assert.deepEqual(f.app.inputs.recoveryQueue(),[]);
 }finally{await f.close();}
});

test('a user message arriving during reconciliation retains its own request and runs once',async()=>{
 const f=await recoveryFixture(2);try{
  f.beforeRecovery=async()=>{f.beforeRecovery=undefined;f.app.submitMessage({requestId:'newer-user',text:'Synthetic newer requirement'});};
  await f.submit();
  assert.deepEqual(f.turns.map(turn=>turn.requestId),['new-user','new-user','new-user','newer-user']);
  assert.equal(f.calls.filter(call=>call.tool==='inbox_ack').length,2);
 }finally{await f.close();}
});

for(const behavior of ['ignore','error','stop','fail-user','ack-then-error'] as const)test('user recovery preserves the exact remaining receipts after '+behavior,async()=>{
 const f=await recoveryFixture(2);try{
  f.behavior=behavior;await f.submit();
  assert.equal(f.turns.length,behavior==='fail-user'?1:2,'no infinite or automatic recovery retry');
  const states=f.originals.map(item=>f.app.store.db.prepare('SELECT state FROM agent_receipts WHERE messageId=?').get(item.id)!.state);
  assert.deepEqual(states,behavior==='ack-then-error'?['rejected','uncertain']:['uncertain','uncertain']);
  assert.equal(f.app.inputs.dispatchSummary().awaitingUser,true);
  if(behavior==='ignore'){
   const page=await homerWebBridge(f.app).history!.state();
   assert.ok(f.messages.some(message=>message.text.includes('旧回执')&&message.text.includes('未确认')),'host must report a missing ACK rather than trust a successful model final');
   assert.ok(JSON.stringify(page).includes('旧回执'),'the failure is visible in persisted Web history, not only the sink');
  }
  const firstTurns=f.turns.length;await f.reopen();assert.equal(f.turns.length,firstTurns);
  f.behavior='ack';await f.submit('retry-user');
  assert.ok(f.originals.every(item=>f.app.store.db.prepare('SELECT state FROM agent_receipts WHERE messageId=?').get(item.id)!.state==='rejected'));
  for(const original of f.originals)assert.equal(f.calls.filter(call=>call.tool==='inbox_ack'&&call.args.messageId===original.id).length,1,'already confirmed originals are not submitted again');
 }finally{await f.close();}
});

for(const behavior of ['ignore','error','stop','fail-user','ack-then-error'] as const)test('a new user message can reconcile the remainder without restarting after '+behavior,async()=>{
 const f=await recoveryFixture(2);try{
  f.behavior=behavior;await f.submit();const before=f.turns.length;
  f.behavior='ack';await f.submit('retry-without-restart');
  assert.ok(f.turns.length>before,'confirmed closure releases ownership for the next user input');
  assert.equal(f.app.inputs.byRequestIds(['retry-without-restart'])[0]!.state,'completed');
  assert.deepEqual(f.app.inputs.recoveryQueue(),[]);
  for(const original of f.originals)assert.equal(f.calls.filter(call=>call.tool==='inbox_ack'&&call.args.messageId===original.id).length,1);
 }finally{await f.close();}
});

test('an unconfirmed engine closure blocks replacement and preserves the original receipts',async()=>{
 const f=await recoveryFixture();try{
  f.behavior='unconfirmed-close';await f.submit();
  assert.equal(f.turns.length,2);assert.equal(f.app['mainBroken'],true);
  assert.throws(()=>f.app.submitMessage({requestId:'unsafe-retry',text:'Synthetic retry'}),/main_engine_unavailable/);
  assert.equal(f.app.store.db.prepare('SELECT state FROM agent_receipts WHERE messageId=?').get(f.originals[0]!.id)!.state,'uncertain');
  assert.deepEqual(f.calls,[]);
 }finally{f.behavior='ack';await f.close();}
});
