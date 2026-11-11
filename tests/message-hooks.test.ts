import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fixture,until} from './fixtures/worker-chat-host.js';

const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));

test('message hook observes committed natural, explicit, and background messages only once',async()=>{
 const f=fixture(),other=fixture();
 try{
  const seen:{messageId:string;inTransaction:boolean;status?:string}[]=[], sent:string[]=[];
  const seenElsewhere:string[]=[];
  other.app.hooks.on('message.committed',({messageId})=>{seenElsewhere.push(messageId);});
  f.app.hooks.on('message.committed',({messageId})=>{
   seen.push({messageId,inTransaction:f.app.store.db.isTransaction,status:f.app.history.message(messageId)?.status});
  });
  const path=join(f.app.config.workspace,'report.md');writeFileSync(path,'# Synthetic report');
  f.setScript(async(main,text)=>{
   if(text==='plain'){
    main.emit('textDelta',{threadId:main.threadId,turnId:main.turnId,delta:'stream'});
    assert.equal(f.app.history.message(f.app.store.db.prepare("SELECT replyId FROM conversation_inputs WHERE requestId='plain'").get()!.replyId as string)?.text,'stream');
    await tick();assert.equal(seen.length,0);
    return {status:'completed',text:'Natural reply'};
   }
   if(text==='send'){
    const args={text:'First message',attachments:[{path}]};
    const first=await main.call('send_user_message',args,'first');
    const replay=await main.call('send_user_message',args,'first');
    assert.equal(replay.messageId,first.messageId);
    await until(()=>seen.some(e=>e.messageId===first.messageId));
    const second=await main.call('send_user_message',{text:'Second message'},'second');
    sent.push(first.messageId,second.messageId);
    await until(()=>seen.some(e=>e.messageId===second.messageId));
    return {status:'completed',text:'Ignored second final'};
   }
   if(text==='delegate'){
    await main.call('worker_open',{message:'Inspect the synthetic report.'});
    return {status:'completed',text:'Started'};
   }
   const notice=JSON.parse(text.split('\n')[1]!);
   const sentBackground=await main.call('send_user_message',{taskId:notice.taskId,text:'Background message'});
   sent.push(sentBackground.messageId);
   return {status:'completed',text:''};
  });
  await f.app.start();
  await f.app.message('plain','plain');await until(()=>seen.length===1);
  const natural=seen[0]!.messageId;
  assert.equal(f.app.readCommittedMessage(natural,{requestId:'plain'})?.status,'completed');
  await f.app.message('send','send');
  await f.app.message('delegate','delegate');await until(()=>seen.length===4);
  const worker=f.engines.find(e=>e.options.role==='worker')!;
  worker.finish!({status:'completed',text:'Internal Worker result'});
  await f.app.idle();await until(()=>seen.length===5);await tick();
  assert.deepEqual(seen.map(e=>e.messageId),[natural,sent[0],sent[1],seen[3]!.messageId,sent[2]]);
  assert.equal(new Set(seen.map(e=>e.messageId)).size,5);
  assert.ok(seen.every(e=>!e.inTransaction&&e.status==='completed'));
  const message=f.app.readCommittedMessage(sent[0]!,{requestId:'send'});
  assert.equal(message?.status,'completed');
  assert.equal(message?.status==='completed'&&message.attachments?.length,1);
  assert.equal(f.app.readCommittedMessage(sent[0]!,{requestId:'wrong'}),undefined);
  f.app.history.revokeMessage(f.app.store.meta('mainThread')!,sent[0]!);
  assert.equal(f.app.readCommittedMessage(sent[0]!,{requestId:'send'}),undefined);
  const background=f.app.history.message(sent[2]!)!;
  assert.equal(f.app.readCommittedMessage(background.id,{taskId:background.taskId!,taskVersion:background.taskVersion!})?.status,'completed');
  assert.equal(f.app.readCommittedMessage(background.id,{taskId:background.taskId!,taskVersion:background.taskVersion!+1}),undefined);
  assert.deepEqual(seenElsewhere,[]);
 }finally{await f.close();await other.close();}
});

test('confirmed failure and interruption expose status only, while uncertain and recovered placeholders stay silent',async()=>{
 const f=fixture();try{
  const seen:string[]=[];
  f.app.hooks.on('message.committed',({messageId})=>{seen.push(messageId);});
  f.setScript(async(main,text)=>{
   main.emit('textDelta',{threadId:main.threadId,turnId:main.turnId,delta:'private fragment'});
   if(text==='lost')throw Error('synthetic_transport_lost');
   if(text==='fail')return {status:'failed',text:'private fragment',errorCode:'synthetic_failure'};
   return {status:'interrupted',text:'private fragment',errorCode:'main_user_interrupted'};
  });
  await f.app.start();
  for(const [requestId,status] of [['fail','failed'],['interrupt','interrupted']]){
   await f.app.message(requestId!,requestId!);
   await until(()=>seen.length===(status==='failed'?1:2));
   const messageId=seen.at(-1)!;
   assert.ok(f.app.history.message(messageId)?.text.includes('private fragment'));
   assert.deepEqual(f.app.readCommittedMessage(messageId,{requestId:requestId!}),{messageId,requestId,status});
   assert.equal(f.app.readCommittedMessage(messageId,{requestId:'other-request'}),undefined);
   const auxiliary=f.app.history.message('input-outcome:'+messageId);
   if(auxiliary)assert.equal(f.app.readCommittedMessage(auxiliary.id,{requestId:requestId!}),undefined);
  }
  await f.app.message('lost','lost');await tick();
  const lost=f.app.store.db.prepare("SELECT replyId FROM conversation_inputs WHERE requestId='lost'").get()!;
  assert.equal(f.app.readCommittedMessage(String(lost.replyId),{requestId:'lost'}),undefined);
  assert.equal(seen.length,2);
  const orphan=f.app.history.accept(f.app.store.meta('mainThread')!,{requestId:'orphan',text:'Orphaned synthetic input'}).replyId;
  await f.restart();
  assert.equal(f.app.history.message(orphan)?.status,'interrupted');
  assert.equal(f.app.readCommittedMessage(orphan,{requestId:'orphan'}),undefined);
 }finally{await f.close();}
});

test('a rejected input notifies only its canonical failure status after the failure transaction',async()=>{
 const f=fixture();try{
  const seen:string[]=[];
  f.app.hooks.on('message.committed',({messageId})=>{seen.push(messageId);});
  await f.app.start();
  f.app.store.db.exec("CREATE TEMP TRIGGER reject_hook_input BEFORE INSERT ON requests BEGIN SELECT RAISE(ABORT,'synthetic_claim_rejected'); END");
  await assert.rejects(f.app.message('synthetic input','rejected'),/synthetic_claim_rejected/);
  await until(()=>seen.length===1);
  const reply=f.app.store.db.prepare("SELECT replyId FROM conversation_inputs WHERE requestId='rejected'").get()!;
  assert.equal(seen[0],reply.replyId);
  assert.deepEqual(f.app.readCommittedMessage(seen[0]!,{requestId:'rejected'}),{messageId:seen[0],requestId:'rejected',status:'failed'});
 }finally{await f.close();}
});

test('rolled back explicit sends do not notify; a subsequent natural reply still does',async()=>{
 const f=fixture();try{
  const seen:string[]=[];
  f.app.hooks.on('message.committed',({messageId})=>{seen.push(messageId);});
  f.setScript(async main=>{
   const db=f.app.store.db;
   db.exec("CREATE TEMP TRIGGER abort_hook_send BEFORE UPDATE ON operations WHEN OLD.kind='send_user_message' AND NEW.state='confirmed' BEGIN SELECT RAISE(ABORT,'synthetic_send_rollback'); END");
   try{await assert.rejects(main.call('send_user_message',{text:'Must roll back'}),/synthetic_send_rollback/);}
   finally{db.exec('DROP TRIGGER abort_hook_send');}
   await tick();assert.deepEqual(seen,[]);
   return {status:'completed',text:'Natural fallback'};
  });
  await f.app.start();
  assert.equal(await f.app.message('rollback','rollback'),'Natural fallback');
  await until(()=>seen.length===1);
  assert.equal(f.app.history.message(seen[0]!)?.text,'Natural fallback');
 }finally{await f.close();}
});

test('slow and failing listeners do not block others, and only the latest pending notification is retained',async()=>{
 const f=fixture();try{
  const slow:string[]=[],fast:string[]=[], cancelled:string[]=[];
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  f.app.hooks.on('message.committed',async({messageId})=>{slow.push(messageId);await gate;});
  let failures=0;
  f.app.hooks.on('message.committed',()=>{failures++;throw Error('private sync diagnostic');});
  f.app.hooks.on('message.committed',async()=>{failures++;throw Error('private async diagnostic');});
  f.app.hooks.on('message.committed',({messageId})=>{fast.push(messageId);});
  const off=f.app.hooks.on('message.committed',({messageId})=>{cancelled.push(messageId);});off();off();
  await f.app.start();
  for(let i=0;i<6;i++){
   await f.app.message('synthetic',`request-${i}`);
   await until(()=>fast.length===i+1);
  }
  assert.deepEqual(slow,[fast[0]]);
  assert.deepEqual(cancelled,[]);
  assert.equal(failures,12);
  const diagnostics=f.app.store.db.prepare("SELECT code FROM events WHERE type='hook_listener_failed'").all();
  assert.equal(diagnostics.length,12);
  assert.ok(diagnostics.every(row=>/^message\.committed:\d+$/.test(String(row.code))));
  release();await until(()=>slow.length===2);
  assert.deepEqual(slow,[fast[0],fast.at(-1)]);
 }finally{await f.close();}
});

test('committed reads do not expose later uncommitted edits or revocation changes',async()=>{
 const f=fixture();try{
  await f.app.start();await f.app.message('synthetic','committed-read');
  const row=f.app.store.db.prepare("SELECT replyId FROM conversation_inputs WHERE requestId='committed-read'").get()!;
  const id=String(row.replyId),scope={requestId:'committed-read'};
  const original=f.app.readCommittedMessage(id,scope);
  assert.equal(original?.status,'completed');
  const db=f.app.store.db;
  db.exec('BEGIN IMMEDIATE');
  try{
   db.prepare('UPDATE conversation_messages SET text=? WHERE id=?').run('Uncommitted private text',id);
   assert.equal(f.app.readCommittedMessage(id,scope),undefined);
  }finally{db.exec('ROLLBACK');}
  assert.deepEqual(f.app.readCommittedMessage(id,scope),original);
  f.app.history.revokeMessage(f.app.store.meta('mainThread')!,id);
  db.exec('BEGIN IMMEDIATE');
  try{
   db.prepare('UPDATE conversation_messages SET revokedAt=NULL WHERE id=?').run(id);
   assert.equal(f.app.readCommittedMessage(id,scope),undefined);
  }finally{db.exec('ROLLBACK');}
  assert.equal(f.app.readCommittedMessage(id,scope),undefined);
 }finally{await f.close();}
});

for(const explicit of [false,true])test('a real COMMIT failure never emits for '+(explicit?'an explicit message':'a natural reply'),async()=>{
 const f=fixture();try{
  const seen:string[]=[];
  f.app.hooks.on('message.committed',({messageId})=>{seen.push(messageId);});
  f.setScript(async main=>{
   f.app.store.db.exec(`
    CREATE TEMP TABLE hook_parent(id INTEGER PRIMARY KEY);
    CREATE TEMP TABLE hook_child(id INTEGER REFERENCES hook_parent(id) DEFERRABLE INITIALLY DEFERRED);
    CREATE TEMP TRIGGER reject_hook_commit AFTER UPDATE OF status ON conversation_messages
    WHEN NEW.role='assistant' AND NEW.status='completed'
    BEGIN INSERT INTO hook_child VALUES(1); END;
   `);
   if(explicit){
    try{await assert.rejects(main.call('send_user_message',{text:'Uncommitted explicit reply'}),/FOREIGN KEY constraint failed/);}
    finally{f.app.store.db.exec('DROP TRIGGER reject_hook_commit');}
    await tick();assert.equal(seen.length,0);
   }
   return {status:'completed',text:'Natural reply'};
  });
  await f.app.start();
  if(explicit){
   assert.equal(await f.app.message('commit test','commit-test'),'Natural reply');
   await until(()=>seen.length===1);
   assert.equal(f.app.history.message(seen[0]!)?.operationKey,null);
  }else{
   await assert.rejects(f.app.message('commit test','commit-test'),/FOREIGN KEY constraint failed/);
   await tick();assert.deepEqual(seen,[]);
   const row=f.app.store.db.prepare("SELECT replyId FROM conversation_inputs WHERE requestId='commit-test'").get()!;
   assert.equal(f.app.readCommittedMessage(String(row.replyId),{requestId:'commit-test'}),undefined);
  }
 }finally{await f.close();}
});
