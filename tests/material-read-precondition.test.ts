// Local synthetic Worker sessions exercise attachment reads and exact byte export.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,unlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fixture,until} from './fixtures/worker-chat-host.js';
import type {AttachmentRef} from '../src/media-store.js';

async function setup(){
 const f=fixture();let opened:{taskId:string;runId:string}|undefined,refs:AttachmentRef[]=[];
 try{
  await f.app.start();
  const files=['first.txt','second.txt'].map(filename=>{
   const path=join(f.app.config.workspace,filename);writeFileSync(path,'Synthetic '+filename);return {path};
  });
  f.setScript(async(main,text)=>{
   if(text==='Inspect files'){
    const result=await main.call('worker_open',{message:'Inspect only the selected files',attachments:files});
    opened=result;
    const input=f.app.store.db.prepare('SELECT payloadJson FROM agent_messages WHERE id=?').get(result.messageId);
    refs=JSON.parse(String(input?.payloadJson)).attachments;
   }
   return {status:'completed',text:'Synthetic reply'};
  });
  await f.app.message('Inspect files','inspect-local-files');
  await until(()=>!!opened&&f.app.tasks.run(opened.runId).phase==='executing');
  const peer=f.engines.find(engine=>engine.options.role==='worker')!,run=f.app.tasks.run(opened!.runId),slot=f.app['workers'].get(run.id)!;
  return {...f,peer,run,slot,refs,read:(ref:AttachmentRef)=>f.app['workerMediaTool'](slot,'inspect_attachment',ref)};
 }catch(error){await f.close();throw error;}
}

test('a missing source fails without changing the running task, and healthy attachment export needs no read checkpoint',async()=>{
 const f=await setup();
 try{
  const [missing,available]=f.refs as [AttachmentRef,AttachmentRef],task=f.app.tasks.task(f.run.taskId);
  const retained=f.app.media.readAttachment(missing);
  unlinkSync(retained.path);
  await assert.rejects(f.read(missing),/media_file_missing/);
  assert.deepEqual(f.app.tasks.task(task.id),task);
  assert.equal(f.app.tasks.run(f.run.id).status,'running');
  const exportArgs={filename:'actual.txt',...available};
  const receipt=await f.peer.call('stage_file_result',exportArgs,'exact-export');
  assert.equal(readFileSync(receipt.path,'utf8'),'Synthetic second.txt');
  assert.deepEqual(await f.peer.call('stage_file_result',exportArgs,'exact-export'),receipt);
  await assert.rejects(f.peer.call('stage_file_result',{...exportArgs,filename:'changed.txt'},'exact-export'),/operation_payload_conflict/);
  writeFileSync(retained.path,retained.bytes);
  const repaired=await f.read(missing) as {extraction:{text:string}};
  assert.match(repaired.extraction.text,/Synthetic first\.txt/);
 }finally{await f.close();}
});

test('the Worker file boundary rejects obsolete writer arguments and cannot export on a stopped turn',async()=>{
 const f=await setup();
 try{
  const [ref]=f.refs as [AttachmentRef,AttachmentRef];
  await assert.rejects(f.peer.call('read_material',{}),/worker_tool_denied/);
  await assert.rejects(f.peer.call('write_markdown',{filename:'old.md',content:'# Synthetic'}),/worker_tool_denied/);
  await assert.rejects(f.peer.call('stage_file_result',{filename:'forged.txt',dataBase64:'dGV4dA=='}),/invalid_tool_arguments/);
  await assert.rejects(f.peer.call('stage_file_result',{filename:'traversal/../bad.txt',...ref}),/artifact_path_denied/);
  assert.equal(f.app.store.db.prepare("SELECT count(*) n FROM operations WHERE kind='write_file' AND state='confirmed'").get()?.n,0);
  assert.ok(await f.app['stopOwnedWorker'](f.run.id));
  await assert.rejects(f.peer.call('stage_file_result',{filename:'late.txt',...ref}),/tool_scope_denied|run_not_live|run_epoch_stale/);
  assert.equal(f.app.store.db.prepare("SELECT count(*) n FROM operations WHERE kind='write_file' AND state='confirmed'").get()?.n,0);
 }finally{await f.close();}
});
