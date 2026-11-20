// Raw Worker originals, a user-visible answer and task archival have separate owners.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync,unlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fixture as hostFixture,until} from './fixtures/worker-chat-host.js';
import {openTaskWorker} from './fixtures/open-task-worker.js';
import {RecursiveTools} from '../src/recursive-tools.js';
import {fixture,main,authority,openWorker,running,complete,mutation} from './recursive-fixture.js';
import {htmlAttachmentFixture} from './canvas-html-publication-fixture.js';

test('Worker text keeps exact original paragraphs without sending or archiving the task',()=>{
 const f=fixture();
 try{
  const worker=openWorker(f),actor=running(f,worker.runId),raw='Unknown date.\n\nExact second paragraph.',reply=complete(f,actor,raw);
  assert.equal(f.tasks.workerRead(main,{workerId:worker.workerId,messageId:reply.messageId}).messages[0]!.text,raw);
  assert.equal(f.tasks.task(f.task.taskId).historyState,'visible');
  assert.equal(f.history.list(main.threadId!).some(message=>message.text===raw),false);
  for(const table of ['results','deliveries'])assert.equal(f.store.db.prepare('SELECT name FROM sqlite_master WHERE name=?').get(table),undefined);
 }finally{f.close();}
});

test('one user-visible attachment message records the exact task version without archiving the task',()=>{
 const f=htmlAttachmentFixture();
 try{
  const actor=f.app.mainActor(),created=f.app.tasks.createTask(actor,{
   operationId:'create-authorized',goal:'Review files',authority:authority(actor.sourceRequestId),
  });
  const scope={taskId:created.taskId,taskVersion:1};
  const receipt=f.send([{path:f.original}],'send-once',scope);
  assert.deepEqual(f.send([{path:f.original}],'send-once',scope),receipt);
  assert.equal(receipt.messageId,f.replyId);
  const message=f.history.message(receipt.messageId)!;
  assert.equal(message.taskId,created.taskId);
  assert.equal(message.taskVersion,1);
  assert.equal(message.requestId,actor.sourceRequestId);
  assert.deepEqual(f.media.readAttachment(message.attachments![0]!).bytes,f.bytes);
  assert.equal(f.app.tasks.task(created.taskId).historyState,'visible');
  assert.throws(()=>f.app.readAttachment({...receipt,messageId:'foreign'}),/media_scope_denied/);
 }finally{f.close();}
});

test('public tool validation exposes schema paths without echoing private property names or values',async()=>{
 const f=fixture();
 try{
  const api=new RecursiveTools(f.tasks,{rootAuthority:()=>authority(),wake(){},stop:async r=>r,steer:async r=>r});
  await assert.rejects(()=>api.call(main,'worker_open',{message:'Check scope',taskId:f.task.taskId,private_argument_name:'PRIVATE_VALUE'},'invalid'),error=>{
   assert.equal((error as Error).message,'invalid_tool_arguments');assert.doesNotMatch(JSON.stringify(error),/private_argument_name|PRIVATE_VALUE/);return true;
  });
  assert.equal(f.store.db.prepare("SELECT 1 FROM operations WHERE kind='send_user_message'").get(),undefined);
  assert.equal(f.tasks.runs().length,0);
 }finally{f.close();}
});

test('new requirements preserve the version and text of a previously committed answer',()=>{
 const f=fixture();
 try{
  const id=f.store.transaction(()=>f.history.commitAssistant({
   threadId:main.threadId!,taskId:f.task.taskId,taskVersion:1,text:'Earlier answer',operationKey:'earlier-answer',
  }));
  const source=f.source('changed','Change the requirements');
  f.tasks.updateTask(source,{...mutation(f,'change'),patch:{goal:'New requirements'},authority:authority(source.sourceRequestId)});
  assert.equal(f.tasks.task(f.task.taskId).headVersion,2);
  assert.equal(f.history.message(id)?.taskVersion,1);
  assert.equal(f.history.message(id)?.text,'Earlier answer');
 }finally{f.close();}
});


test('archive review lets Homer remove the authorized preview and preserve the editable source',async()=>{
 const f=hostFixture();
 try{
  const preview=join(f.app.config.workspace,'preview.txt'),source=join(f.app.config.workspace,'source.txt');
  const instruction='Keep the editable source. Remove only the temporary preview at archive.';
  let taskId='',reviews=0;
  f.setScript(async(main,text)=>{
   if(text===instruction){
    taskId=(await openTaskWorker(main,instruction)).taskId;
    return {status:'completed',text:'Assigned'};
   }
   if(text==='Archive this record'){
    await main.call('archive_work',{taskId});
    return {status:'completed',text:'Recorded'};
   }
   const notice=JSON.parse(text.split('\n')[1]!);
   if(notice.kind==='task_archived'){
    const record=await main.call('work_inspect',{taskId});
    assert.equal(record.task.historyState,'archived');
    assert.equal(record.goal,instruction);
    assert.equal(readFileSync(preview,'utf8'),'Temporary preview');
    assert.equal(readFileSync(source,'utf8'),'Editable original');
    unlinkSync(preview);
    reviews++;
   }
   return {status:'completed',text:''};
  });
  await f.app.start();
  await f.app.message(instruction,'original');
  const worker=()=>f.engines.find(engine=>engine.options.role==='worker'&&engine.finish);
  await until(()=>!!worker());
  writeFileSync(source,'Editable original');writeFileSync(preview,'Temporary preview');
  worker()!.finish!({status:'completed',text:'Source and preview are ready.'});
  await f.app.idle();
  assert.equal(f.app.tasks.task(taskId).historyState,'visible');
  assert.ok(existsSync(preview));
  await f.app.message('Archive this record','archive');
  await f.app.idle();
  assert.equal(reviews,1);assert.equal(existsSync(preview),false);
  assert.equal(readFileSync(source,'utf8'),'Editable original');
  assert.equal(f.app.tasks.runs(taskId).length,1);
 }finally{await f.close();}
});
