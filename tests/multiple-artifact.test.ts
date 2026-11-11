// Exact selected files, Worker write fences and task settlement remain independent.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,symlinkSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fixture,openWorker,running,complete,main,mutation,authority} from './recursive-fixture.js';
import {MediaStore} from '../src/media-store.js';
import {htmlAttachmentFixture} from './canvas-html-publication-fixture.js';

test('different export operations cannot claim one filename, including identical bytes',()=>{
 const f=fixture(),worker=openWorker(f),actor=running(f,worker.runId);
 try{
  const write=(operationId:string,content:string,filename='same.md')=>f.tasks.writeFile(actor,{operationId,filename,bytes:Buffer.from(content)});
  const written=write('original','first');
  assert.deepEqual(write('original','first'),written);
  for(const content of ['first','changed'])assert.throws(()=>write('other-'+content,content),/artifact_filename_conflict/);
  assert.throws(()=>write('original','changed'),/operation_payload_conflict/);
  assert.equal(readFileSync(written.path,'utf8'),'first');
  const link=join(dirname(written.path),'symbolic.md');
  symlinkSync(written.path,link);
  assert.throws(()=>write('link','Synthetic','symbolic.md'),/symlink_denied|artifact_path_denied/);
  for(const filename of ['../bad.md','/bad.md'])assert.throws(()=>write(filename,'Synthetic',filename),/artifact_path_denied/);
  complete(f,actor);
  assert.throws(()=>write('late','Synthetic','late.md'),/run_not_live/);
 }finally{f.close();}
});

test('mixed binary and Markdown bytes are attached exactly and unselected files stay private',()=>{
 const f=htmlAttachmentFixture('generated.bin',Buffer.from([0,255,3,4,8]));
 try{
  const notes=join(dirname(f.original),'notes.md');writeFileSync(notes,'# Notes');
  const hidden=join(dirname(f.original),'private.txt');writeFileSync(hidden,'Private local note');
  const sent=f.send([{path:f.original},{path:notes}]);
  const message=f.history.message(sent.messageId)!;
  assert.equal(message.attachments!.length,2);
  const files=message.attachments!.map(ref=>f.media.readAttachment(ref));
  assert.deepEqual(files.map(file=>file.asset.filename),['generated.bin','notes.md']);
  assert.deepEqual(files[0]!.bytes,f.bytes);
  assert.equal(files[1]!.bytes.toString(),'# Notes');
  assert.equal(f.store.db.prepare("SELECT 1 FROM media_assets WHERE filename='private.txt'").get(),undefined);
  assert.equal(readFileSync(hidden,'utf8'),'Private local note');
 }finally{f.close();}
});

test('plain and structured-looking Worker replies keep local work without making it public or settling',()=>{
 for(const text of ['Synthetic files checked',JSON.stringify({summary:'synthetic'})]){
  const f=fixture();
  try{
   const worker=openWorker(f),actor=running(f,worker.runId);
   const files=['a.md','b.md'].map(name=>{const path=join(f.files.workspace,name);writeFileSync(path,'# '+name);return path;});
   complete(f,actor,text);
   const read=f.tasks.workerRead(main,{workerId:worker.workerId});
   assert.equal(read.messages.at(-1)?.text,text);
   assert.equal(f.tasks.task(f.task.taskId).outcome,null);
   assert.equal(f.history.list(main.threadId!).some(message=>message.attachments?.length),false);
   assert.deepEqual(files.map(path=>readFileSync(path,'utf8')),['# a.md','# b.md']);
  }finally{f.close();}
 }
});

test('Main can settle partial and failed tasks while committed attachment bytes remain exact',()=>{
 for(const outcome of ['partial','failed'] as const){
  const f=fixture();
  try{
   const media=new MediaStore(f.store.db,join(f.dir,'media')),ref=media.snapshot('seed',{filename:'partial.txt',kind:'file',mime:'text/plain',bytes:Buffer.from('Retained work')});
   const messageId=f.store.transaction(()=>{
    const id=f.history.commitAssistant({threadId:main.threadId!,taskId:f.task.taskId,taskVersion:1,text:'Progress',attachments:[ref],operationKey:'retained-message'});
    media.pinAttachment(ref,'message:'+id);media.unpin('operation:seed');return id;
   });
   const input={...mutation(f,'settle'),outcome,notes:'Synthetic optional part missing'},settled=f.tasks.settleTask(main,input);
   assert.equal(f.tasks.task(f.task.taskId).outcome,outcome);
   assert.equal(f.tasks.task(f.task.taskId).state,'settled');
   assert.deepEqual(f.history.message(messageId)?.attachments,[ref]);
   assert.equal(media.gc(Date.now()+31*86400000),0);
   assert.equal(media.readAttachment(ref).bytes.toString(),'Retained work');
   assert.deepEqual(f.tasks.settleTask(main,input),settled);
  }finally{f.close();}
 }
});

test('requirements replacement fences the old writer and keeps the successor Run on its actual version',()=>{
 const f=fixture();
 try{
  const worker=openWorker(f),actor=running(f,worker.runId);
  const source=f.source('changed-requirement','Prepare replacement files');
  const update=f.tasks.updateTask(source,{...mutation(f,'replace'),patch:{goal:'Prepare replacement files'},authority:authority(source.sourceRequestId)});
  assert.throws(()=>f.tasks.writeFile(actor,{operationId:'stale',filename:'stale.md',bytes:Buffer.from('old attempt')}),/run_epoch_stale|run_stop_requested|task_stop_requested|run_version_stale/);
  assert.equal(f.tasks.confirmWorkerExit(worker.runId,undefined),true);
  f.tasks.confirmStop(update.operationKey,true);
  const next=f.tasks.workerSend(source,{operationId:'continue',workerId:worker.workerId,text:'Prepare replacement files'}),replacement=running(f,next.runId!);
  const current=f.tasks.writeFile(replacement,{operationId:'current',filename:'current.md',bytes:Buffer.from('new attempt')});
  const reply=complete(f,replacement,'Exact new attempt');
  assert.equal(readFileSync(current.path,'utf8'),'new attempt');
  assert.equal(f.tasks.run(next.runId!).version,2);
  assert.equal(f.tasks.workerRead(main,{workerId:worker.workerId,messageId:reply.messageId}).messages[0]?.text,'Exact new attempt');
  assert.equal(f.tasks.run(worker.runId).version,1);
 }finally{f.close();}
});
