import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,unlinkSync,writeFileSync} from 'node:fs';
import {basename,dirname,join} from 'node:path';
import {fixture} from './fixtures/worker-chat-host.js';

test('explicit messages reuse the current reply, survive restart and preserve selected attachment bytes',async()=>{
  const f=fixture();
  const path=join(f.app.config.workspace,'note.txt');
  writeFileSync(path,'selected bytes');
  let first='',second='',beforeTerminal:string[]=[];
  try{
    f.setScript(async main=>{
      const agent=(itemId:string,phase:'commentary'|'final_answer',text:string)=>main.emit('agentMessage',{
        threadId:main.threadId,turnId:main.turnId,itemId,phase,text,completed:true,
      });
      agent('early-draft','final_answer','Draft before explicit commit');
      const args={text:'Original reply',attachments:[{path}]};
      first=(await main.call('send_user_message',args,'same-send')).messageId;
      assert.equal((await main.call('send_user_message',{attachments:args.attachments,text:args.text},'same-send')).messageId,first);
      await assert.rejects(main.call('send_user_message',{text:'different'},'same-send'),/operation_payload_conflict/);
      second=(await main.call('send_user_message',{text:'Additional reply'})).messageId;
      agent('late-final','final_answer','Duplicate from native final');
      agent('valid-progress','commentary','Progress after explicit reply');
      main.emit('textDelta',{threadId:main.threadId,turnId:main.turnId,delta:'Late native delta'});
      beforeTerminal=f.app.conversationState().messages.map(message=>message.text);
      return {status:'completed',text:'Duplicate from native final'};
    });
    await f.app.start();
    const threadId=f.app.store.meta('mainThread')!;
    const reader=f.app.webHistoryPages();
    const accepted=f.app.submitMessage({requestId:'original-input',text:'Reply with the selected file'});
    await f.app.idle();
    assert.equal(first,accepted.replyId);
    assert.notEqual(second,first);
    const message=f.app.history.message(first)!;
    assert.equal(message.text,'Original reply');
    assert.ok(beforeTerminal.includes('Original reply')&&beforeTerminal.includes('Additional reply'));
    assert.doesNotMatch(beforeTerminal.join('\n'),/Draft before explicit commit|Duplicate from native final|Late native delta/);
    assert.equal(f.events.some(event=>event.type==='delta'&&event.text==='Late native delta'),false);
    const visible=JSON.stringify(f.app.conversationState());
    assert.match(visible,/Progress after explicit reply/);
    assert.doesNotMatch(visible,/Draft before explicit commit|Duplicate from native final|Late native delta/);
    assert.equal(f.app.history.message(second)!.requestId,'original-input');
    const replyOrder=(messages:readonly {requestId?:string|null;id:string;role:string;process?:unknown}[])=>messages
      .filter(message=>message.requestId==='original-input')
      .map(message=>message.role==='user'?'user':message.process?'process':message.id);
    assert.deepEqual(replyOrder(f.app.conversationState().messages),['user','process',first,second]);
    assert.deepEqual(replyOrder(reader.read(threadId,{}).messages),['user','process',first,second]);
    const attachment={messageId:first,...message.attachments![0]!};
    assert.throws(()=>f.app.readAttachment({...attachment,messageId:second}),/media_scope_denied/);
    unlinkSync(path);
    await f.restart();
    assert.deepEqual(replyOrder(f.app.webHistoryPages().read(threadId,{}).messages),['user','process',first,second]);
    assert.equal(f.app.history.message(first)!.text,'Original reply');
    assert.equal(f.app.history.message(second)!.text,'Additional reply');
    assert.equal(Buffer.from(f.app.readAttachment(attachment).data,'base64').toString(),'selected bytes');
    assert.equal(f.app.store.db.prepare("SELECT count(*) n FROM conversation_messages WHERE text='Duplicate from native final'").get()!.n,0);
    assert.doesNotMatch(JSON.stringify(f.app.conversationState()),/Draft before explicit commit|Duplicate from native final|Late native delta/);
    f.app.history.revokeMessage(f.app.store.meta('mainThread')!,first);
    assert.throws(()=>f.app.readAttachment(attachment),/media_scope_denied/);
  }finally{await f.close();}
});

test('explicit message rollback keeps the original failed receipt',async()=>{
  const f=fixture();
  let checked=false;
  try{
    f.setScript(async main=>{
      const db=f.app.store.db;
      db.exec("CREATE TEMP TRIGGER block_explicit_reply BEFORE UPDATE ON conversation_messages WHEN new.operationKey GLOB 'send:*' BEGIN SELECT RAISE(ABORT,'synthetic_commit_failure'); END");
      const args={text:'Only one reply'};
      await assert.rejects(main.call('send_user_message',args,'rolled-back-send'),/synthetic_commit_failure/);
      db.exec('DROP TRIGGER block_explicit_reply');
      await assert.rejects(main.call('send_user_message',args,'rolled-back-send'),/message_not_committed/);
      assert.equal(db.prepare("SELECT state FROM operations WHERE kind='send_user_message'").get()?.state,'failed');
      assert.equal(f.app.history.list(main.threadId).some(message=>message.text===args.text),false);
      await main.call('send_user_message',args,'deliberate-new-send');
      checked=true;
      return {status:'completed',text:''};
    });
    await f.app.start();
    await f.app.message('Reply once','explicit-rollback');
    assert.equal(checked,true);
    assert.equal(f.app.conversationState().messages.filter(message=>message.text==='Only one reply').length,1);
  }finally{await f.close();}
});

test('a path alias cannot attach a protected runtime file',async()=>{
  const f=fixture();
  try{
    const runtime=f.app.config.runtime,filename='synthetic-protected.txt';
    const path=join(runtime,filename),alias=join(dirname(runtime),basename(runtime).toUpperCase(),filename);
    writeFileSync(path,'Synthetic private host data');
    let checked=false;
    f.setScript(async main=>{
      await assert.rejects(main.call('send_user_message',{attachments:[{path}]}),/artifact_path_denied/);
      await assert.rejects(main.call('send_user_message',{attachments:[{path:alias}]}),existsSync(alias)?/artifact_path_denied/:/artifact_missing/);
      checked=true;
      return {status:'completed',text:'Protected'};
    });
    await f.app.start();
    await f.app.message('Try the test alias','check-runtime-alias');
    assert.equal(checked,true);
    assert.equal(f.app.store.db.prepare("SELECT count(*) n FROM conversation_attachments").get()!.n,0);
  }finally{await f.close();}
});

test('a live capability continuation can send a distinct reply to the same request',async()=>{
  const f=fixture();
  try{
    f.setScript(async(main,text)=>{
      if(text.startsWith('[宿主续接')){
        await main.call('send_user_message',{text:'Second reply'});
      }else{
        await main.call('send_user_message',{text:'First reply'});
        f.app['mainContext']!.capabilityRevision=1;
      }
      return {status:'completed',text:''};
    });
    await f.app.start();
    Object.assign(f.engines[0]!,{refreshCapabilities:async()=>({pending:false})});
    await f.app.message('Continue after refreshing tools','capability-reply');
    assert.deepEqual(f.app.conversationState().messages
      .filter(message=>message.requestId==='capability-reply'&&message.operationKey).map(message=>message.text),
    ['First reply','Second reply']);
  }finally{await f.close();}
});

test('first dispatch freezes an attachment and grants the selected Worker only',async()=>{
  const f=fixture();
  const path=join(f.app.config.workspace,'evidence.txt');
  writeFileSync(path,'original worker bytes');
  let taskId='',workerId='';
  try{
    f.setScript(async(main,text)=>{
      if(text==='Delegate to two Workers'){
        const args={message:'Read the selected attachment.',attachments:[{path}]};
        const first=await main.call('worker_open',args,'one-dispatch');
        assert.deepEqual(await main.call('worker_open',args,'one-dispatch'),first);
        taskId=first.taskId;
        workerId=first.workerId;
        await main.call('worker_open',{taskId,message:'Read only the task description.'});
      }
      return {status:'completed',text:'Workers scheduled.'};
    });
    await f.app.start();
    await f.app.message('Delegate to two Workers','delegate-two');
    const {until}=await import('./fixtures/worker-chat-host.js');
    await until(()=>f.engines.filter(engine=>engine.options.role==='worker'&&engine.finish).length===2);
    const rows=f.app.store.db.prepare("SELECT payloadJson FROM agent_messages WHERE taskId=? AND kind='worker_input' AND recipientAgentId=?").all(taskId,'worker:'+workerId);
    assert.equal(rows.length,1);
    const [ref]=JSON.parse(String(rows[0]!.payloadJson)).attachments;
    unlinkSync(path);
    const workers=f.engines.filter(engine=>engine.options.role==='worker');
    const run=f.app.tasks.runs(taskId,workerId)[0]!;
    const owner=workers.find(peer=>peer.threadId===f.app.tasks.run(run.id).threadId)!;
    const other=workers.find(peer=>peer!==owner)!;
    await assert.rejects(other.call('stage_file_result',{filename:'forbidden.txt',...ref}),/media_scope_denied/);
    const saved=await owner.call('stage_file_result',{filename:'selected.txt',...ref});
    const {readFileSync}=await import('node:fs');
    assert.equal(readFileSync(saved.path,'utf8'),'original worker bytes');
    assert.equal(f.app.tasks.runs(taskId).length,2);
  }finally{await f.close();}
});
