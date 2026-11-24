import {test} from 'node:test';import assert from 'node:assert/strict';
import {join} from 'node:path';
import {chatFixture} from './task-chat-fixture.js';import {homerWebBridge} from '../src/web-homer.js';import {Homer} from '../src/service.js';
import {WorkerInteractions} from '../src/worker-interactions.js';
import {MediaStore,type AttachmentRef} from '../src/media-store.js';
function setup(){
 const f=chatFixture(),media=new MediaStore(f.store.db,join(f.dir,'media'));
 const host=Object.assign(Object.create(Homer.prototype),f,{media,interactions:new WorkerInteractions(f.store.db),registerWebSurface(){}}) as Homer;
 const send=(taskId:string,text:string,attachments:AttachmentRef[]=[])=>f.store.transaction(()=>{
  const operationKey='send:'+taskId;
  const id=f.history.commitAssistant({threadId:'thread:main',taskId,taskVersion:1,text,attachments,operationKey});
  for(const ref of attachments)media.pinAttachment(ref,id);
  return id;
 });
 return {f,media,send,bridge:homerWebBridge(host)};
}
test('exact task source and committed text are readable without unbounded history or file grants',async()=>{
 const {f,send,bridge}=setup();try{
  const task=f.create();f.history.list=()=>{throw Error('unbounded_history_forbidden');};const original=f.store.db.prepare("SELECT id FROM conversation_messages WHERE role='user'").get()!;
  const overview=bridge.taskOverview!,before=await overview.summary!(task.taskId);
  assert.equal(before.requirements?.[0]?.sourceMessageId,original.id);
  assert.equal(before.requirements?.[0]?.threadId,'thread:main');
  assert.equal((await overview.origin!(task.taskId,String(original.id))).message.text,'Investigate without edits');
  const messageId=send(task.taskId,'合成纯文字答复'),out=await overview.origin!(task.taskId,messageId);
  assert.equal(out.message.id,messageId);assert.equal(out.message.text,'合成纯文字答复');assert.deepEqual(out.files,[]);
  assert.deepEqual((await overview.summary!(task.taskId)).artifacts,[]);
  const neighbor=f.history.add('thread:main','邻居不可泄漏');
  await assert.rejects(()=>overview.origin!(task.taskId,neighbor),/task_origin_not_found/);
  await assert.rejects(()=>overview.origin!('wrong-task',messageId),/task_origin_not_found/);
  assert.ok(f.history.revokeMessage('thread:main',messageId));
  await assert.rejects(()=>overview.origin!(task.taskId,messageId),/task_origin_not_found/);
 }finally{f.close();}
});
test('file origins retain exact message authorization and reject unattached, revoked and unrelated files',async()=>{
 const {f,media,send,bridge}=setup();try{
  const {taskId}=f.create(),overview=bridge.taskOverview!,access=bridge.media!;
  const ref=media.snapshot('stage',{filename:'readability.md',kind:'file',mime:'text/markdown',bytes:Buffer.from('# Synthetic file')});
  const sibling=media.snapshot('stage',{filename:'unattached.md',kind:'file',mime:'text/markdown',bytes:Buffer.from('# Private file')});
  assert.deepEqual((await overview.summary!(taskId)).artifacts,[]);
  await assert.rejects(()=>access.read({messageId:'unrelated',...ref}),/media_scope_denied/);
  const messageId=send(taskId,'合成文件答复',[ref]),selector={messageId,...ref};
  const projected=(await overview.summary!(taskId)).artifacts!;
  assert.equal(projected.length,1);
  assert.deepEqual((await overview.origin!(taskId,messageId)).files,projected);
  assert.deepEqual((await access.origin!(selector)).files,projected);
  assert.deepEqual((await overview.detail(taskId)).artifacts,projected);
  const file=await access.read(selector);
  assert.equal(file.filename,'readability.md');assert.equal(Buffer.from(file.data,'base64').toString(),'# Synthetic file');
  await assert.rejects(()=>access.read({messageId,...sibling}),/media_scope_denied/);
  assert.ok(f.history.revokeMessage('thread:main',messageId));
  assert.deepEqual((await overview.summary!(taskId)).artifacts,[]);
  await assert.rejects(()=>access.read(selector),/media_scope_denied/);
 }finally{f.close();}
});

test('archived history includes both registration and later delegation, scoped to their original messages',async()=>{
 const {f,bridge}=setup();try{
  const {taskId}=f.tasks.createTask(f.actor,{operationId:'register',goal:'Record this for later'});
  const requestId='source:start',later=f.source(requestId,'Start work on the registered task');
  const actor={...f.actor,sourceRequestId:requestId,inputMessageId:later.messageId,turnId:'turn:'+requestId};
  const worker=f.tasks.workerOpen(actor,{operationId:'dispatch',taskId});
  const run=f.start(worker.workerId),reply=f.tasks.endSegment(run.id,run.epoch,{status:'completed',text:'Done'},true)!;
  f.consumeMain(reply.messageId);
  const archived=f.tasks.archiveHistory(actor,{operationId:'archive',taskId,expectedRevision:f.tasks.task(taskId).revision},true);
  assert.equal(archived.state,'archived');
  const overview=bridge.taskOverview!,messages=(await overview.detail(taskId)).publicMessages!;
  assert.deepEqual(messages.map(row=>row.excerpt),['Start work on the registered task','Investigate without edits']);
  assert.equal((await overview.origin!(taskId,messages[0]!.id)).message.requestId,requestId);
  f.history.revokeMessage('thread:main',messages[0]!.id);
  assert.equal((await overview.detail(taskId)).publicMessages!.length,1);
  await assert.rejects(()=>overview.origin!(taskId,messages[0]!.id),/task_origin_not_found/);
 }finally{f.close();}
});
