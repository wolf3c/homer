// Real Main inputs, task rows and Worker originals with a synthetic engine.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture as hostFixture,until} from './fixtures/worker-chat-host.js';

function fixture(choice:'repair'|'defer'|'close',emptyEventReply=false,emptyUserReply=false,failedEventReply=false){
 const host=hostFixture(),errors:string[]=[];let itemId='',taskId='',handled=false,repairWorker='';
 host.setScript(async(main,text)=>{
  const internal=text.startsWith('[内部协作输入');
  try{
   if(text.startsWith('开始原工作')){
    taskId=(await main.call('worker_open',{message:'核对并如实报告原工作执行结果'})).taskId;
   }else if(text.startsWith('先记下')){
    itemId=(await main.call('task_create',{goal:'稍后支持导出',notes:'等待决定，不执行'})).taskId;
   }else if(internal&&text.includes('原工作执行失败')){
    const notice=JSON.parse(text.split('\n')[1]!);assert.equal(notice.kind,'worker_reply');assert.equal(notice.taskId,taskId);
    const read=await main.call('worker_read',{workerId:notice.workerId,messageId:notice.messageId});
    assert.equal(read.messages[0].text,'原工作执行失败，需按后续授权决定是否修复。');
    assert.equal(read.messages[0].payload.execution.status,'failed');
    assert.equal((await main.call('work_inspect',{taskId})).task.outcome,null);
    await main.call('task_update',{taskId,action:'settle',outcome:'failed',notes:'已核对原始执行失败'});
    if(choice==='close')await main.call('task_update',{taskId:itemId,action:'cancel',reason:'不再处理导出'});
    else await main.call('task_update',{taskId:itemId,notes:'已获原工作回报，等待明确执行决定'});
    await assert.rejects(main.call('worker_open',{taskId:itemId,message:'未经授权就执行'}),/task_not_open|task_authority_source_denied/);
    handled=true;
   }else if(text.startsWith('现在执行')){
    await main.call('task_update',{taskId:itemId,goal:'修复导出'});
    const args={taskId:itemId,message:'按新用户要求修复导出'};
    const repaired=await main.call('worker_open',args,'repair-open');
    assert.deepEqual(await main.call('worker_open',args,'repair-open'),repaired);
    assert.equal(host.app.tasks.authority(itemId,2).sourceRequestId,'allow-followup');repairWorker=repaired.workerId;
   }else if(text.startsWith('恢复后查询')){
    const latest=await main.call('work_inspect',{taskId:itemId});
    assert.equal(latest.task.id,itemId);assert.match(latest.task.notes,/等待明确执行决定/);
   }
   if(failedEventReply&&internal)return {status:'failed',text:'',errorCode:'synthetic_main_engine_failed'};
   return {status:'completed',text:emptyEventReply&&internal||emptyUserReply&&!internal?'':'Synthetic reply'};
  }catch(error){errors.push(String(error));throw error;}
 });
 return {get app(){return host.app;},seen:host.inputs,errors,get itemId(){return itemId;},get taskId(){return taskId;},get handled(){return handled;},get repairWorker(){return repairWorker;},
  release(){host.engines.find(engine=>engine.options.role==='worker'&&engine.finish)!.finish!({status:'failed',text:'原工作执行失败，需按后续授权决定是否修复。',errorCode:'synthetic_same_failure'});},
  restart:()=>host.restart(),close:()=>host.close()};
}

async function failedOriginal(f:ReturnType<typeof fixture>){
 await f.app.start();await f.app.message('开始原工作','start');await until(()=>f.app.snapshot().activeWorkers===1);
 assert.equal(await f.app.message('先记下导出，不执行且不打断 Worker','remember'),'Synthetic reply');
 assert.ok(f.itemId);assert.equal(f.app.tasks.tasks().length,2);assert.equal(f.app.tasks.task(f.taskId).headVersion,1);assert.equal(f.app.snapshot().activeWorkers,1);
 f.release();await until(()=>f.handled||f.errors.length>0);assert.deepEqual(f.errors,[]);await f.app.idle();
}

for(const choice of ['repair','defer','close'] as const)test('same original Worker failure leaves Main free to '+choice,async()=>{
 const f=fixture(choice);try{
  await failedOriginal(f);
  assert.equal(f.app.tasks.task(f.taskId).outcome,'failed');
  assert.equal(f.app.tasks.task(f.itemId).state,choice==='close'?'settled':'open');
  assert.equal(f.app.tasks.version(f.itemId,1).sourceRequestId,'remember');assert.equal(f.app.tasks.version(f.itemId,1).authorityJson,null);
  assert.equal(f.app.tasks.runs(f.itemId).length,0);
  if(choice==='repair'){
   await f.app.message('现在执行导出修复','allow-followup');await until(()=>!!f.repairWorker||f.errors.length>0);
   assert.deepEqual(f.errors,[]);assert.equal(f.app.tasks.runs(f.itemId).length,1);assert.equal(f.app.tasks.tasks().length,2);
  }else{
   const turns=f.seen.length;await new Promise(r=>setTimeout(r,60));assert.equal(f.seen.length,turns,'recorded work alone must not wake Main');
   if(choice==='defer'){
    await f.restart();await f.app.idle();assert.equal(f.seen.length,turns,'restart does not wake for recorded work');
    await f.app.message('恢复后查询','after-restart');assert.deepEqual(f.errors,[]);assert.equal(f.seen.length,turns+1);
   }
  }
 }finally{await f.close();}
});

test('empty internal narrative preserves committed actions and following normal input',async()=>{
 const f=fixture('defer',true);try{
  await failedOriginal(f);
  assert.equal(await f.app.message('恢复后查询','after-empty-internal'),'Synthetic reply');assert.deepEqual(f.errors,[]);
  assert.equal(f.app.snapshot().activeWorkers,0);
 }finally{await f.close();}
});

test('an empty normal user reply fails clearly and admits a later independent input',async()=>{
 const f=fixture('defer',false,true);try{
  await f.app.start();assert.match(await f.app.message('普通空回复','empty-user'),/main_empty_reply/);
  assert.match(await f.app.message('后续普通输入','after-empty-user'),/main_empty_reply/);
  assert.equal(f.app.inputs.list().filter(i=>i.state==='failed').length,2);assert.equal(f.app.tasks.tasks().length,0);
 }finally{await f.close();}
});

test('a failed internal engine result preserves failure and receives later user input',async()=>{
 const f=fixture('defer',true,false,true);try{
  await failedOriginal(f);
  assert.equal(f.app.tasks.task(f.taskId).outcome,'failed');
  assert.ok(f.app.store.db.prepare("SELECT 1 FROM events WHERE type='main_turn_failed' AND code='synthetic_main_engine_failed'").get());
  assert.equal(await f.app.message('恢复后查询','after-failed-internal'),'Synthetic reply');
 }finally{await f.close();}
});
