// Raw Worker originals, a user-visible answer and task settlement have separate owners.
import test from 'node:test';
import assert from 'node:assert/strict';
import {RecursiveTools} from '../src/recursive-tools.js';
import {fixture,main,authority,openWorker,running,complete,mutation} from './recursive-fixture.js';
import {htmlAttachmentFixture} from './canvas-html-publication-fixture.js';

test('Worker text keeps exact original paragraphs without sending or settling the task',()=>{
 const f=fixture();
 try{
  const worker=openWorker(f),actor=running(f,worker.runId),raw='Unknown date.\n\nExact second paragraph.',reply=complete(f,actor,raw);
  assert.equal(f.tasks.workerRead(main,{workerId:worker.workerId,messageId:reply.messageId}).messages[0]!.text,raw);
  assert.equal(f.tasks.task(f.task.taskId).outcome,null);
  assert.equal(f.history.list(main.threadId!).some(message=>message.text===raw),false);
  for(const table of ['results','deliveries'])assert.equal(f.store.db.prepare('SELECT name FROM sqlite_master WHERE name=?').get(table),undefined);
 }finally{f.close();}
});

test('one user-visible attachment message records the exact task version without settling the task',()=>{
 const f=htmlAttachmentFixture();
 try{
  const actor=f.app.mainActor(),created=f.app.tasks.createTask(actor,{
   operationId:'create-authorized',goal:'Review files',authority:authority(actor.sourceRequestId),
  });
  const args={operationId:'send-once',taskId:created.taskId,attachments:[{path:f.original}],text:'Checked the source'};
  const receipt=f.app.sendUserMessage(actor,args);
  assert.deepEqual(f.app.sendUserMessage(actor,args),receipt);
  assert.equal(receipt.messageId,f.replyId);
  const message=f.history.message(receipt.messageId)!;
  assert.equal(message.taskId,created.taskId);
  assert.equal(message.taskVersion,1);
  assert.equal(message.requestId,actor.sourceRequestId);
  assert.deepEqual(f.media.readAttachment(message.attachments![0]!).bytes,f.bytes);
  assert.equal(f.app.tasks.task(created.taskId).outcome,null);
  assert.throws(()=>f.app.sendUserMessage({...actor,sourceRequestId:'foreign'}, {...args,operationId:'foreign-send'}),/source_denied|tool_scope_denied/);
 }finally{f.close();}
});

test('public tool validation exposes schema paths without echoing private property names or values',async()=>{
 const f=fixture();
 try{
  const api=new RecursiveTools(f.tasks,{rootAuthority:()=>authority(),wake(){},stop:async r=>r,steer:async r=>r});
  await assert.rejects(()=>api.call(main,'send_user_message',{private_argument_name:'PRIVATE_VALUE'},'invalid'),error=>{
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
