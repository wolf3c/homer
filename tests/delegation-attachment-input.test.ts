// Real Homer attachment routing and transactions with local synthetic engines.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {fixture,until} from './fixtures/worker-chat-host.js';
import type {AttachmentRef} from '../src/media-store.js';

function upload(f:ReturnType<typeof fixture>,requestId:string){
 const ref=f.app.media.intent(requestId,'web:'+f.app.store.meta('mainThread'),'file','selected.txt');
 f.app.media.ready(ref,f.app.media.claim(ref)!,Buffer.from('Synthetic source'),'text/plain');
 return ref;
}
function state(f:ReturnType<typeof fixture>){
 const db=f.app.store.db;
 return Object.fromEntries(['tasks','task_versions','runs','agent_messages','media_pins'].map(table=>[table,db.prepare('SELECT count(*) n FROM '+table).get()!.n]));
}
function running(f:ReturnType<typeof fixture>,workerId:string){
 const run=f.app.tasks.runs().find(run=>run.workerId===workerId&&run.phase==='executing');
 return run&&f.app['workers'].get(run.id);
}
type Opened={taskId:string;workerId:string;runId:string;operationKey:string};

test('Worker attachment input rejects malformed selectors and foreign sources before accepting a task',async()=>{
 const f=fixture();let checked=false;
 try{
  await f.app.start();
  const requestId='selected-input',ref=upload(f,requestId),other=upload(f,'foreign-unsubmitted-input');
  f.setScript(async(main,text)=>{
   if(text.includes('Inspect the source')){
    const before=state(f);
    for(const invalid of [{assetId:ref.assetId},{...ref,revision:'1'},{...ref,revision:0},{...ref,path:'/tmp/synthetic'}])
     await assert.rejects(main.call('worker_open',{message:'Inspect',attachments:[invalid]}),/invalid_tool_arguments|invalid_attachment/);
    for(const unavailable of [{...ref,revision:2},other])
     await assert.rejects(main.call('worker_open',{message:'Inspect',attachments:[unavailable]}),/media_scope_denied/);
    assert.deepEqual(state(f),before);checked=true;
   }
   return {status:'completed',text:'Synthetic reply'};
  });
  f.app.submitMessage({requestId,text:'Inspect the source',attachments:[ref]});
  await f.app.message('Barrier','selection-barrier');assert.ok(checked);
 }finally{await f.close();}
});

test('only the addressed Worker can read the offered revision and a revoked source denies a later read',async()=>{
 const f=fixture();let selected:Opened|undefined,other:Opened|undefined;
 try{
  await f.app.start();
  const requestId='selected-worker-source',ref=upload(f,requestId);
  f.setScript(async(main,text)=>{
   if(text.includes('Inspect the source')){
    selected=await main.call('worker_open',{message:'Inspect selected source',attachments:[ref]});
    other=await main.call('worker_open',{taskId:selected!.taskId,message:'Check a separate issue'});
   }
   return {status:'completed',text:'Synthetic reply'};
  });
  f.app.submitMessage({requestId,text:'Inspect the source',attachments:[ref]});
  await until(()=>!!selected&&!!other&&!!running(f,selected.workerId)&&!!running(f,other.workerId));
  const receiver=running(f,selected!.workerId)!,bystander=running(f,other!.workerId)!;
  const read=(slot:typeof receiver,selector:AttachmentRef=ref)=>f.app['workerMediaTool'](slot,'inspect_attachment',selector);
  const checked=await read(receiver) as AttachmentRef;
  assert.deepEqual({assetId:checked.assetId,revision:checked.revision},ref);
  await assert.rejects(read(receiver,{...ref,revision:2}),/media_scope_denied/);
  await assert.rejects(read(bystander),/media_scope_denied/);
  const task=f.app.tasks.task(selected!.taskId),source=f.app.history.list(f.app.store.meta('mainThread')!).find(message=>message.role==='user'&&message.requestId===requestId)!;
  const move=f.app.store.db.prepare('UPDATE media_assets SET requestId=? WHERE id=?');
  move.run('foreign-source',ref.assetId);
  await assert.rejects(read(receiver),/media_scope_denied/);
  assert.throws(()=>f.app.readAttachment({...ref,messageId:source.id}),/media_scope_denied/);
  move.run(requestId,ref.assetId);
  await read(receiver);
  const peer=f.engines.find(engine=>engine.threadId===receiver.engine.threadId)!;
  const exportArgs={...ref,filename:'retained.txt'},exported=await peer.call('stage_file_result',exportArgs,'retained-export');
  assert.ok(f.app.history.revokeMessage(source.threadId,source.id));
  await assert.rejects(read(receiver),/media_scope_denied/);
  await assert.rejects(peer.call('stage_file_result',{...ref,filename:'revoked.txt'}),/media_scope_denied/);
  assert.deepEqual(await peer.call('stage_file_result',exportArgs,'retained-export'),exported);
  assert.equal(readFileSync(exported.path,'utf8'),'Synthetic source');
  assert.deepEqual(f.app.tasks.task(task.id),task);
  assert.equal(f.app.tasks.run(selected!.runId).status,'running');
 }finally{await f.close();}
});

test('an exact accepted Worker receipt survives revocation, but a missing receipt stays uncertain',async()=>{
 const f=fixture();let checked=false;
 try{
  await f.app.start();
  const requestId='selected-receipt-source',ref=upload(f,requestId);
  f.setScript(async(main,text)=>{
   if(text.includes('Inspect the source')){
    const args={message:'Inspect selected source',attachments:[ref]};
    const accepted=await main.call('worker_open',args,'selected-receipt'),before=state(f);
    f.app.media.revoke(requestId);
    assert.deepEqual(await main.call('worker_open',args,'selected-receipt'),accepted);
    assert.deepEqual(state(f),before);
    await assert.rejects(main.call('worker_open',{...args,message:'Different scope'},'selected-receipt'),/operation_payload_conflict/);
    await assert.rejects(main.call('worker_open',args,'fresh-selection'),/media_scope_denied/);
    f.app.store.db.prepare('UPDATE operations SET responseJson=NULL WHERE id=?').run(accepted.operationKey);
    await assert.rejects(main.call('worker_open',args,'selected-receipt'),/operation_uncertain/);
    assert.deepEqual(state(f),before);checked=true;
   }
   return {status:'completed',text:'Synthetic reply'};
  });
  f.app.submitMessage({requestId,text:'Inspect the source',attachments:[ref]});
  await f.app.message('Barrier','selected-receipt-barrier');assert.ok(checked);
 }finally{await f.close();}
});

test('a Worker message commit failure rolls back the task and releases only its staged snapshot',async()=>{
 const f=fixture();let checked=false;
 try{
  await f.app.start();
  const path=join(f.app.config.workspace,'selected.txt');writeFileSync(path,'Synthetic local file');
  f.setScript(async(main,text)=>{
   if(text.includes('Inspect the source')){
    const db=f.app.store.db,before=state(f);
    db.exec("CREATE TEMP TRIGGER reject_worker_input BEFORE INSERT ON agent_messages WHEN NEW.kind='worker_input' BEGIN SELECT RAISE(ABORT,'synthetic_worker_commit_abort'); END");
    try{await assert.rejects(main.call('worker_open',{message:'Inspect',attachments:[{path}]}),/synthetic_worker_commit_abort/);}
    finally{db.exec('DROP TRIGGER reject_worker_input');}
    assert.deepEqual(state(f),before);
    const stage=db.prepare("SELECT state,responseJson FROM operations WHERE kind='attachment_stage'").get()!;
    assert.equal(stage.state,'failed');
    const [snapshot]=JSON.parse(String(stage.responseJson)) as AttachmentRef[];
    assert.ok(snapshot);
    assert.equal(f.app.media.asset(snapshot).state,'deleted');
    assert.equal(existsSync(join(f.app.config.runtime,'media',snapshot.assetId)),false);
    const corrected=await main.call('worker_open',{message:'Inspect',attachments:[{path}]});
    assert.ok(corrected.taskId);
    assert.equal(db.prepare("SELECT count(*) n FROM operations WHERE kind='worker_open'").get()?.n,1);
    checked=true;
   }
   return {status:'completed',text:'Synthetic reply'};
  });
  await f.app.message('Inspect the source','worker-commit-abort');
  await until(()=>checked);
 }finally{await f.close();}
});
