import {readTestConversation} from './fixtures/read-test-conversation.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {unlinkSync,writeFileSync} from 'node:fs';
import {basename,dirname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {commitSyntheticMessage} from './fixtures/synthetic-message.js';
import {fixture} from './fixtures/worker-chat-host.js';

test('a native final reuses the current reply and preserves selected attachment bytes across restart',async()=>{
  const f=fixture();
  const path=join(f.app.config.workspace,'note.txt');
  const final=`Original reply. [Selected file](<${pathToFileURL(path).href}>)`;
  writeFileSync(path,'selected bytes');
  let replyId='',turns=0;
  try{
    f.setScript(async main=>{
      turns++;
      const commentary='Progress before the reply';
      const messages=[{itemId:'progress',phase:'commentary',text:commentary},{itemId:'final',phase:'final_answer',text:final}];
      for(const item of messages)main.emit('agentMessage',{threadId:main.threadId,turnId:main.turnId,...item,completed:true});
      assert.equal(f.app.history.message(replyId)?.status,'running');
      assert.equal(f.app.readCommittedMessage(replyId,{requestId:'original-input'}),undefined);
      assert.equal(f.app.history.message(replyId)?.attachments,undefined);
      return {status:'completed',text:commentary+'\n\n'+final,messages};
    });
    await f.app.start();
    const threadId=f.app.store.meta('mainThread')!;
    const input={requestId:'original-input',text:'Reply with the selected file'};
    replyId=f.app.submitMessage(input).replyId;
    await f.app.idle();
    const message=f.app.history.message(replyId)!;
    assert.equal(message.text,final);
    assert.equal(message.requestId,input.requestId);
    assert.equal(message.attachments?.length,1);
    assert.match(JSON.stringify(readTestConversation(f.app)),/Progress before the reply/);
    const replyOrder=(messages:readonly {requestId?:string|null;id:string;role:string;process?:unknown}[])=>messages
      .filter(message=>message.requestId==='original-input')
      .map(message=>message.role==='user'?'user':message.process?'process':message.id);
    const visible=f.app.webHistoryPages().read(threadId,{}).messages;
    assert.deepEqual(replyOrder(visible),['user','process',replyId]);
    assert.equal(visible.some(row=>row.process?.items.some(item=>item.kind==='commentary'&&item.phase==='final_answer')),false);
    const unrelated=f.app.history.add(threadId,'Unrelated reply');
    const attachment={messageId:replyId,...message.attachments![0]!};
    assert.throws(()=>f.app.readAttachment({...attachment,messageId:unrelated}),/media_scope_denied/);
    unlinkSync(path);
    await f.restart();
    const restarted=f.app.webHistoryPages().read(threadId,{}).messages;
    assert.deepEqual(replyOrder(restarted),['user','process',replyId]);
    assert.equal(restarted.some(row=>row.process?.items.some(item=>item.kind==='commentary'&&item.phase==='final_answer')),false);
    assert.equal(f.app.history.message(replyId)!.text,final);
    assert.match(await f.app.message(input.text,input.requestId),/^重复请求的历史回执/);
    assert.equal(turns,1);
    assert.equal(Buffer.from(f.app.readAttachment(attachment).data,'base64').toString(),'selected bytes');
    f.app.history.revokeMessage(threadId,replyId);
    assert.throws(()=>f.app.readAttachment(attachment),/media_scope_denied/);
  }finally{await f.close();}
});

test('confirmed historical replies retain their exact attachment grants across restart',async()=>{
  const f=fixture();
  try{
    await f.app.start();
    const threadId=f.app.store.meta('mainThread')!;
    const requestId='historical-request';
    const {replyId}=f.app.history.accept(threadId,{requestId,text:'Historical request'});
    const {messageId,attachments}=commitSyntheticMessage(f.app,threadId,'Historical reply',[{filename:'historical.txt',content:'Historical bytes'}],requestId);
    const additional=commitSyntheticMessage(f.app,threadId,'Additional historical reply',[],requestId).messageId;
    assert.equal(messageId,replyId);
    await f.restart();
    assert.deepEqual(f.app.webHistoryPages().read(threadId,{}).messages.filter(message=>message.requestId===requestId).map(message=>message.text),
      ['Historical request','Historical reply','Additional historical reply']);
    assert.equal(f.app.readCommittedMessage(messageId,{requestId})?.text,'Historical reply');
    assert.equal(f.app.readCommittedMessage(additional,{requestId})?.text,'Additional historical reply');
    assert.equal(Buffer.from(f.app.readAttachment({messageId,...attachments[0]!}).data,'base64').toString(),'Historical bytes');
    assert.throws(()=>f.app.readAttachment({messageId:additional,...attachments[0]!}),/media_scope_denied/);
  }finally{await f.close();}
});

test('a native final commit rollback abandons the file stage and leaves no publishable reply',async()=>{
  const f=fixture();
  try{
    const path=join(f.app.config.workspace,'note.txt');writeFileSync(path,'Only one copy');
    const text=`Only one reply. [File](<${pathToFileURL(path).href}>)`;
    f.setScript(async()=>({status:'completed',text,messages:[{itemId:'answer',phase:'final_answer',text}]}));
    await f.app.start();
    const db=f.app.store.db;
    db.exec("CREATE TEMP TRIGGER block_final_attachment BEFORE INSERT ON conversation_attachments BEGIN SELECT RAISE(ABORT,'synthetic_commit_failure'); END");
    await assert.rejects(f.app.message('Reply once','final-rollback'),/synthetic_commit_failure/);
    assert.equal(db.prepare("SELECT state FROM operations WHERE kind='attachment_stage'").get()?.state,'failed');
    assert.equal(db.prepare("SELECT count(*) n FROM operations WHERE kind='request_final'").get()?.n,0);
    assert.equal(db.prepare('SELECT count(*) n FROM media_pins').get()?.n,0);
    assert.equal(db.prepare('SELECT count(*) n FROM conversation_attachments').get()?.n,0);
    assert.equal(readTestConversation(f.app).messages.some(message=>message.text===text),false);
    await f.restart();
    await assert.rejects(f.app.message('Reply once','final-rollback'),/request_interrupted_use_new_id/);
    assert.equal(await f.app.message('Reply once','new-final'),text);
    const saved=f.app.history.list(f.app.store.meta('mainThread')!).filter(message=>message.text===text);
    assert.equal(saved.length,1);assert.equal(saved[0]?.attachments?.length,1);
  }finally{await f.close();}
});

test('a path alias cannot attach a protected runtime file',async()=>{
  const f=fixture();
  try{
    const runtime=f.app.config.runtime,filename='synthetic-protected.txt';
    const path=join(runtime,filename),alias=join(dirname(runtime),basename(runtime).toUpperCase(),filename);
    writeFileSync(path,'Synthetic private host data');
    const text=`Protected. [Original](<${pathToFileURL(path).href}>) [Alias](<${pathToFileURL(alias).href}>)`;
    f.setScript(async()=>({status:'completed',text,messages:[{itemId:'answer',phase:'final_answer',text}]}));
    await f.app.start();
    assert.equal(await f.app.message('Try the test alias','check-runtime-alias'),text+'\n\n部分文件未能保存为可跨端打开的版本。');
    assert.equal(f.app.store.db.prepare("SELECT count(*) n FROM conversation_attachments").get()!.n,0);
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
        const args={title:'Selected attachment',message:'Read the selected attachment.',attachments:[{path}]};
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
