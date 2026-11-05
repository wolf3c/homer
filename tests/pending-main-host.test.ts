// Real Main input, dynamic tools and Worker originals; synthetic transport only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {MediaStore} from '../src/media-store.js';
import {fixture as hostFixture,until} from './fixtures/worker-chat-host.js';

function fixture(choice:'repair'|'defer'|'close',emptyEventReply=false,emptyUserReply=false,failedEventReply=false){
 const host=hostFixture(),errors:string[]=[];let itemId='',taskId='',handled=false;
 host.setScript(async(main,text)=>{
  const internal=text.startsWith('[内部协作输入');
  try{
   if(text.startsWith('开始原工作')){
    taskId=(await main.call('task_create',{goal:'核对原工作'})).taskId;
    await main.call('worker_open',{taskId,message:'核对并如实报告执行结果'});
   }else if(text.startsWith('先记下')){
    itemId=(await main.call('pending_add',{content:'稍后支持导出',relatedTaskId:taskId})).id;
   }else if(text.startsWith('允许后续')){
    const row=(await main.call('pending_list',{id:itemId})).items[0];assert.equal(row.id,itemId);
    await main.call('pending_update',{id:itemId,patch:{handlingNote:'用户明确允许后续处理'}});
   }else if(internal){
    const notice=JSON.parse(text.split('\n')[1]!);assert.equal(notice.kind,'worker_reply');assert.equal(notice.taskId,taskId);
    const read=await main.call('worker_read',{workerId:notice.workerId,messageId:notice.messageId});
    assert.equal(read.messages[0].text,'原工作执行失败，需按后续授权决定是否修复。');
    assert.equal(read.messages[0].payload.execution.status,'failed');
    const facts=await main.call('work_inspect',{taskId});assert.equal(facts.task.outcome,null);
    await main.call('task_update',{taskId,action:'settle',outcome:'failed',notes:'已核对原始执行失败'});
    assert.equal(host.app.tasks.task(taskId).outcome,'failed');
    assert.ok(text.includes(itemId),'relevant item must be discoverable without retained conversation');
    const latest=(await main.call('pending_list',{id:itemId,sourceRequestId:'allow-followup'})).items[0];
    assert.equal(latest.sources[0].requestId,'allow-followup');assert.match(latest.sources[0].text,/允许后续/);
    if(choice==='repair'){
     const args={goal:'按用户后续授权修复导出',pendingIds:[itemId]};
     const repaired=await main.call('task_create',args,'repair-create');
     assert.deepEqual(await main.call('task_create',args,'repair-create'),repaired);
     assert.equal(host.app.tasks.authority(repaired.taskId,1).sourceRequestId,'allow-followup');
     await main.call('pending_update',{id:itemId,patch:{linkedTaskId:repaired.taskId,handlingNote:'已根据真实后续授权安排修复'}});
    }else await main.call('pending_update',{id:itemId,sourceRequestIds:['start'],patch:{handlingNote:choice==='defer'?'等待用户再决定':'结束关注',...(choice==='close'?{state:'closed'}:{})}});
    handled=true;
   }else if(text.startsWith('边界验证')){
    const args={goal:'scope-test',pendingIds:[itemId]};
    await assert.rejects(()=>main.call('task_create',{...args,deliveryTarget:'new-target'}),/invalid_tool_arguments/);
    await assert.rejects(()=>main.call('task_create',{...args,pendingIds:['unknown-pending']}),/source_denied/);
    const refs=(requestId:string)=>JSON.parse(String(host.app.store.db.prepare('SELECT refsJson FROM conversation_attachments WHERE requestId=?').get(requestId)!.refsJson));
    const media=new MediaStore(host.app.store.db);
    for(const requestId of ['remember','start'])assert.throws(()=>media.validate('allow-followup',refs(requestId)),/media_scope_denied/);
    const chosen=await main.call('task_create',args),authority=host.app.tasks.authority(chosen.taskId,1),ref=refs('allow-followup')[0];
    assert.equal(authority.sourceRequestId,'allow-followup');assert.deepEqual(authority.attachments,[ref.assetId+'@'+ref.revision]);
    const filePath=join(host.app.files.workspace,'scope-report.md');writeFileSync(filePath,'# Synthetic scope report');
    const accepted=await main.call('accept_result',{taskId:chosen.taskId,filePath});
    const publish=await main.call('publish_delivery',{taskId:chosen.taskId,resultIds:[accepted.resultId],text:'synthetic delivery'});
    assert.equal(host.app.tasks.delivery(publish.deliveryId).routeSourceRequestId,'allow-followup');
   }else if(text.startsWith('恢复后查询')){
    assert.ok(text.includes(itemId));const latest=await main.call('pending_list',{id:itemId});assert.equal(latest.items[0].id,itemId);
   }
   if(failedEventReply&&internal)return {status:'failed',text:'',errorCode:'synthetic_main_engine_failed'};
   return {status:'completed',text:emptyEventReply&&internal||emptyUserReply&&!internal?'':'Synthetic reply'};
  }catch(error){errors.push(String(error));throw error;}
 });
 return {get app(){return host.app;},seen:host.inputs,events:host.events,errors,get itemId(){return itemId;},get taskId(){return taskId;},get handled(){return handled;},
  release(){host.engines.find(engine=>engine.options.role==='worker'&&engine.finish)!.finish!({status:'failed',text:'原工作执行失败，需按后续授权决定是否修复。',errorCode:'synthetic_same_failure'});},
  restart:()=>host.restart(),close:()=>host.close()};
}

for(const choice of ['repair','defer','close'] as const)test('AC01/02/03/04/05/08 actual main path: same Worker failure, Agent selects '+choice,async()=>{
 const f=fixture(choice);try{
  await f.app.start();await f.app.message('开始原工作','start');await until(()=>f.app.snapshot().activeWorkers===1);
  const before=f.app.tasks.tasks().length;
  assert.equal(await f.app.message('先记下导出，不执行且不打断 Worker','remember'),'Synthetic reply');
  assert.ok(f.itemId);assert.equal(f.app.tasks.tasks().length,before);assert.equal(f.app.tasks.task(f.taskId).headVersion,1);assert.equal(f.app.snapshot().activeWorkers,1);
  await f.app.message('允许后续根据实际结果自主处理导出需求','allow-followup');
  f.release();await until(()=>f.handled||f.errors.length>0);assert.deepEqual(f.errors,[]);await f.app.idle();
  const actor={agentId:f.app.store.meta('mainAgentId')!,threadId:f.app.store.meta('mainThread')!};
  const item=f.app.tasks.pending.list(actor,{id:f.itemId}).items[0]!;
  assert.equal(item.state,choice==='close'?'closed':'open');assert.equal(f.app.tasks.task(f.taskId).outcome,'failed');
  assert.ok(item.sourceRequestIds.includes('remember'));assert.ok(item.sourceRequestIds.includes('allow-followup'));
  assert.equal(f.app.tasks.tasks().length,before+(choice==='repair'?1:0));assert.equal(f.events.filter(m=>m.type==='delivery').length,0);
  if(choice==='repair')assert.ok(item.linkedTaskId);
  const turns=f.seen.length;await new Promise(r=>setTimeout(r,60));assert.equal(f.seen.length,turns,'open alone must not wake main');
  if(choice==='defer'){
   await f.restart();await f.app.idle();const before=f.seen.length;assert.equal(before,turns,'restart does not wake for open items');
   await f.app.message('恢复后查询','after-restart');assert.deepEqual(f.errors,[]);assert.equal(f.seen.length,before+1);
  }
 }finally{await f.close();}
});

test('AC05/07 actual tool owner: chosen primary controls attachment scope and formal route; no new external target',async()=>{
 const f=fixture('defer');try{
  await f.app.start();await f.app.message('开始原工作','start');await until(()=>f.app.snapshot().activeWorkers===1);
  await f.app.message('先记下导出，不执行','remember');await f.app.message('允许后续处理','allow-followup');
  f.release();await until(()=>f.handled||f.errors.length>0);assert.deepEqual(f.errors,[]);await f.app.idle();
  const media=new MediaStore(f.app.store.db);
  for(const requestId of ['start','remember','allow-followup']){
   const ref=media.intent(requestId,'web:'+f.app.store.meta('mainThread'),'file','synthetic.txt');
   f.app.store.db.prepare('INSERT INTO conversation_attachments VALUES(?,?)').run(requestId,JSON.stringify([ref]));
  }
  await f.app.message('边界验证','boundary');assert.deepEqual(f.errors,[]);await f.app.idle();
  assert.equal(f.app.tasks.deliveries().length,1);assert.equal(f.app.tasks.deliveries()[0]!.routeSourceRequestId,'allow-followup');
 }finally{await f.close();}
});

test('AC08 empty internal narrative preserves completed actions and following normal input',async()=>{
 const f=fixture('defer',true);try{
  await f.app.start();await f.app.message('开始原工作','start');await until(()=>f.app.snapshot().activeWorkers===1);
  await f.app.message('先记下导出，不执行','remember');await f.app.message('允许后续处理','allow-followup');
  f.release();await until(()=>f.handled||f.errors.length>0);assert.deepEqual(f.errors,[]);await f.app.idle();
  assert.equal(await f.app.message('恢复后查询','after-empty-internal'),'Synthetic reply');assert.deepEqual(f.errors,[]);
  assert.equal(f.app.snapshot().activeWorkers,0);
 }finally{await f.close();}
});

test('AC08 an empty normal user reply fails clearly and admits a later independent input',async()=>{
 const f=fixture('defer',false,true);try{
  await f.app.start();assert.match(await f.app.message('普通空回复','empty-user'),/main_empty_reply/);
  assert.match(await f.app.message('后续普通输入','after-empty-user'),/main_empty_reply/);
  assert.equal(f.app.inputs.list().filter(i=>i.state==='failed').length,2);assert.equal(f.app.tasks.tasks().length,0);
 }finally{await f.close();}
});

test('AC08 a failed internal engine result preserves failure and receives later user input',async()=>{
 const f=fixture('defer',true,false,true);try{
  await f.app.start();await f.app.message('开始原工作','start');await until(()=>f.app.snapshot().activeWorkers===1);
  await f.app.message('先记下导出，不执行','remember');await f.app.message('允许后续处理','allow-followup');
  f.release();await until(()=>f.handled||f.errors.length>0);assert.deepEqual(f.errors,[]);await f.app.idle();
  assert.equal(f.app.tasks.task(f.taskId).outcome,'failed');
  assert.ok(f.app.store.db.prepare("SELECT 1 FROM events WHERE type='main_turn_failed' AND code='synthetic_main_engine_failed'").get());
  assert.equal(await f.app.message('恢复后查询','after-failed-internal'),'Synthetic reply');
 }finally{await f.close();}
});
