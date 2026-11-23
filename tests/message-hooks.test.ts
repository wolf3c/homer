import {openTaskWorker} from './fixtures/open-task-worker.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {fixture,until} from './fixtures/worker-chat-host.js';

const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));

test('message hook observes committed natural, file, and background messages only once',async()=>{
 const f=fixture(),other=fixture();
 try{
  const seen:{messageId:string;inTransaction:boolean;status?:string}[]=[];
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
    const final=`First message [Report](${pathToFileURL(path).href})`;
    await tick();assert.equal(seen.length,1);
    return {status:'completed',text:final,messages:[{itemId:'file-final',phase:'final_answer',text:final}]};
   }
   if(text==='delegate'){
    await openTaskWorker(main,'Inspect the synthetic report.');
    return {status:'completed',text:'Started'};
   }
   const final='Background message';
   return {status:'completed',text:final,messages:[{itemId:'worker-final',phase:'final_answer',text:final}]};
  });
  await f.app.start();
  await f.app.message('plain','plain');await until(()=>seen.length===1);
  const natural=seen[0]!.messageId;
  assert.equal(f.app.readCommittedMessage(natural,{requestId:'plain'})?.status,'completed');
  await f.app.message('send','send');await until(()=>seen.length===2);
  await f.app.message('delegate','delegate');await until(()=>seen.length===3);
  const worker=f.engines.find(e=>e.options.role==='worker')!;
  worker.finish!({status:'completed',text:'Internal Worker result'});
  await f.app.idle();await until(()=>seen.length===4);await tick();
  assert.equal(new Set(seen.map(e=>e.messageId)).size,4);
  assert.ok(seen.every(e=>!e.inTransaction&&e.status==='completed'));
  const fileId=seen[1]!.messageId;
  const message=f.app.readCommittedMessage(fileId,{requestId:'send'});
  assert.equal(message?.status,'completed');
  assert.equal(message?.status==='completed'&&message.attachments?.length,1);
  assert.equal(f.app.readCommittedMessage(fileId,{requestId:'wrong'}),undefined);
  f.app.history.revokeMessage(f.app.store.meta('mainThread')!,fileId);
  assert.equal(f.app.readCommittedMessage(fileId,{requestId:'send'}),undefined);
  const background=f.app.history.message(seen[3]!.messageId)!;
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

test('a rolled back file final does not notify; a subsequent natural reply still does',async()=>{
 const f=fixture();try{
  const seen:string[]=[];
  f.app.hooks.on('message.committed',({messageId})=>{seen.push(messageId);});
  const path=join(f.app.config.workspace,'report.md');writeFileSync(path,'# Report');
  f.setScript(async(_main,text)=>{
   if(text==='fallback')return {status:'completed',text:'Natural fallback'};
   const final=`Must roll back [Report](${pathToFileURL(path).href})`;
   return {status:'completed',text:final,messages:[{itemId:'f',phase:'final_answer',text:final}]};
  });
  await f.app.start();
  f.app.store.db.exec("CREATE TEMP TRIGGER abort_hook_send BEFORE INSERT ON operations WHEN NEW.kind='request_final' BEGIN SELECT RAISE(ABORT,'synthetic_send_rollback'); END");
  await assert.rejects(f.app.message('rollback','rollback'),/synthetic_send_rollback/);
  await tick();assert.equal(seen.length,0);
  await f.restart(app=>app.hooks.on('message.committed',({messageId})=>{seen.push(messageId);}));
  assert.equal(await f.app.message('fallback','fallback'),'Natural fallback');
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

for(const file of [false,true])test('a real COMMIT failure never emits for '+(file?'a file final':'a natural reply'),async()=>{
 const f=fixture();try{
  const seen:string[]=[];
  f.app.hooks.on('message.committed',({messageId})=>{seen.push(messageId);});
  const path=join(f.app.config.workspace,'commit.md');writeFileSync(path,'# File');
  f.setScript(async()=>{
   f.app.store.db.exec(`
    CREATE TEMP TABLE hook_parent(id INTEGER PRIMARY KEY);
    CREATE TEMP TABLE hook_child(id INTEGER REFERENCES hook_parent(id) DEFERRABLE INITIALLY DEFERRED);
    CREATE TEMP TRIGGER reject_hook_commit AFTER UPDATE OF status ON conversation_messages
    WHEN NEW.role='assistant' AND NEW.status='completed'
    BEGIN INSERT INTO hook_child VALUES(1); END;
   `);
   if(file){
    const final=`Uncommitted [File](${pathToFileURL(path).href})`;
    return {status:'completed',text:final,messages:[{itemId:'f',phase:'final_answer',text:final}]};
   }
   return {status:'completed',text:'Natural reply'};
  });
  await f.app.start();
  await assert.rejects(f.app.message('commit test','commit-test'),/FOREIGN KEY constraint failed/);
  await tick();assert.deepEqual(seen,[]);
  const row=f.app.store.db.prepare("SELECT replyId FROM conversation_inputs WHERE requestId='commit-test'").get()!;
  assert.equal(f.app.readCommittedMessage(String(row.replyId),{requestId:'commit-test'}),undefined);
 }finally{await f.close();}
});

test('desktop receives the committed reply without streaming text or history replay', async () => {
 const f=fixture();
 try {
  const events:{kind:string;id:string;threadId:string}[]=[];
  f.app.onDesktopNotification(event=>{
   assert.equal(f.app.store.db.isTransaction,false);
   events.push(event);
  });
  f.setScript(async()=>({status:'completed',text:'Private reply'}));
  await f.app.start();
  assert.equal(events.length,0);
  await f.app.submitMessage({requestId:'desktop-notice',text:'Private input'});
  await until(()=>events.length===1);
  const {replyId}=f.app.store.db.prepare("SELECT replyId FROM conversation_inputs WHERE requestId='desktop-notice'").get()!;
  const threadId=f.app.store.meta('mainThread')!;
  const event=events[0]!;
  assert.equal(event.kind,'message');assert.equal(event.threadId,threadId);
  const page=f.app.webHistoryPages().read(threadId,{around:event.id});
  assert.ok(page.messages.some(message=>message.id===event.id||message.process?.replyMessageId===replyId),'the notification reaches a displayed message');
  await f.restart(app=>app.onDesktopNotification(value=>events.push(value)));
  await tick();
  assert.equal(events.length,1);
 } finally {await f.close();}
});
