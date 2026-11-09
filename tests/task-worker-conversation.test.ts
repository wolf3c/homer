import {test} from 'node:test';import assert from 'node:assert/strict';
import {overviewFixture} from './task-overview-fixture.js';
import {readTaskDetail} from '../src/task-overview.js';
import {fixture as hostFixture,until} from './fixtures/worker-chat-host.js';
test('Task detail pages original public conversation through its exact Worker, retaining every long-message character',()=>{
 const f=overviewFixture();try{
  const w=f.open('first instruction'),r=f.tasks.claim(w.runId)!;f.tasks.bind(r.id,r.epoch,'thread:worker','turn:one');
  const body='第一段\n\n'+ '含😀的原文与文件地址 /safe/report.md\n'.repeat(2100);
  f.tasks.endSegment(r.id,r.epoch,{status:'completed',text:body,messages:[{itemId:'final',phase:'final_answer',text:body},{itemId:'private',phase:'analysis',text:'PRIVATE_ANALYSIS'}]},true);
  for(let n=0;n<22;n++)f.tasks.workerSend(f.actor,{operationId:'send:'+n,workerId:w.workerId,text:'followup '+n});
  f.store.db.exec('PRAGMA query_only=ON');
  const first=readTaskDetail(f.store.db,f.taskId,{workerId:w.workerId}).conversation!;
  assert.equal(first.messages.length,20);assert.ok(first.nextCursor);assert.equal(first.messages[0]!.text,'first instruction');
  const reply=first.messages.find(m=>m.kind==='worker_reply')!;let complete=reply.text,next=reply.nextOffset;
  while(next!==null){const chunk=readTaskDetail(f.store.db,f.taskId,{workerId:w.workerId,messageId:reply.id,offset:next}).conversation!.messages[0]!;assert.equal(chunk.offset,next);complete+=chunk.text;next=chunk.nextOffset;}
  assert.equal(complete,body);assert.doesNotMatch(JSON.stringify(first),/payloadJson|PRIVATE_ANALYSIS|checkpoint|authorityJson/);
  const second=readTaskDetail(f.store.db,f.taskId,{workerId:w.workerId,after:first.nextCursor!}).conversation!;
  assert.equal(second.nextCursor,null);assert.equal(second.messages.length,4);assert.ok(second.messages.every(m=>m.seq>first.nextCursor!));
  assert.throws(()=>readTaskDetail(f.store.db,f.taskId,{workerId:w.workerId,after:-1}),/worker_query_invalid/);
  assert.throws(()=>readTaskDetail(f.store.db,f.taskId,{workerId:w.workerId,messageId:reply.id,offset:NaN}),/worker_query_invalid/);
  const other=f.store.db.prepare('SELECT id FROM tasks WHERE id<>?').get(f.taskId);assert.equal(other,undefined);
 }finally{f.close();}
});
test('conversation denies another Task or Worker message and non-conversation payload',()=>{
 const f=overviewFixture();try{
  const w=f.open('first'),other=f.open('second');
  assert.throws(()=>readTaskDetail(f.store.db,f.taskId,{workerId:other.workerId,messageId:w.messageId,offset:0}),/worker_message_not_found/);
  const t=f.tasks.createTask(f.actor,{operationId:'other',goal:'other',authority:f.authority});
  assert.throws(()=>readTaskDetail(f.store.db,t.taskId,{workerId:w.workerId}),/worker_not_found/);
  assert.throws(()=>readTaskDetail(f.store.db,f.taskId,{workerId:'invalid/id'}),/worker_query_invalid/);
  f.store.db.prepare('UPDATE agent_messages SET senderAgentId=? WHERE id=?').run('worker:forged',w.messageId);
  assert.throws(()=>readTaskDetail(f.store.db,f.taskId,{workerId:w.workerId,messageId:w.messageId}),/worker_message_not_found/);
 }finally{f.close();}
});

test('the real host retains late old drafts, confirms both paused exits and resumes only the original Worker conversations',async()=>{
 const f=hostFixture(),errors:unknown[]=[],workerIds:string[]=[],queued:{messageId:string;runId:string|null}[]=[],releases:(()=>void)[]=[],closing=[false,false];
 const notices:{messageId:string;runId:string;version:number;text:string}[]=[];
 const original='记录目标并让 A、B 并行核对旧版事实',changedText='改要求：仅核对新版事实；保留缺失日期，不补猜';
 let taskId='',obsoleteMessage='',change:any,pause:any,resume:any,pauseChecked=false,pauseWork:Promise<string>|undefined;
 const peers=()=>f.engines.filter(engine=>engine.options.role==='worker');
 const receiptState=(messageId:string)=>String(f.app.store.db.prepare('SELECT state FROM agent_receipts WHERE messageId=?').get(messageId)!.state);
 f.setScript(async(main,text)=>{
  try{
   if(text===original){
    const first=await main.call('worker_open',{message:'A 核对旧版事实'});
    taskId=first.taskId;workerIds.push(first.workerId);
    workerIds.push((await main.call('worker_open',{taskId,message:'B 核对旧版事实'})).workerId);
   }else if(text===changedText){
    obsoleteMessage=(await main.call('worker_send',{workerId:workerIds[0],message:'仅属于旧版的排队动作'})).messageId;
    change=await main.call('task_update',{taskId,goal:'仅核对新版事实；保留缺失日期，不补猜'});
    for(const [index,workerId] of workerIds.entries())await main.call('worker_send',{workerId,message:(index?'B':'A')+' 按新版续谈'});
   }else if(text==='暂停整件事，保留已经排队的后续问题'){
    for(const [index,workerId] of workerIds.entries())queued.push(await main.call('worker_send',{workerId,message:(index?'B':'A')+' 暂停后继续核对'}));
    const stopping=main.call('task_update',{taskId,action:'pause'});
    await until(()=>f.app.tasks.task(taskId).controlState==='stopping');
    await assert.rejects(main.call('worker_send',{workerId:workerIds[0],message:'停止中不得新增执行'}),/task_stop_requested/);
    await assert.rejects(main.call('task_update',{taskId,action:'resume'}),/task_resume_unconfirmed/);pauseChecked=true;
    pause=await stopping;
    await assert.rejects(main.call('worker_send',{workerId:workerIds[0],message:'暂停中不得新增执行'}),/task_not_open/);
   }else if(text==='暂停时只改目标，不执行'){
    await main.call('task_update',{taskId,goal:'第三版目标，保留缺失日期'});
   }else if(text==='恢复办理原会话中的排队问题'){
    resume=await main.call('task_update',{taskId,action:'resume'});
    assert.equal(f.app.tasks.runs(taskId).length,4,'resume alone cannot create Worker runs');
    for(const [index,workerId] of workerIds.entries())await main.call('worker_send',{workerId,message:(index?'B':'A')+' 暂停后继续核对'});
   }
   else if(text==='核对新版原文后结案')await main.call('task_update',{taskId,action:'settle',outcome:'succeeded'});
   else{
    const notice=JSON.parse(text.split('\n')[1]!);assert.equal(notice.kind,'worker_reply');assert.equal(notice.taskId,taskId);
    const read=await main.call('worker_read',{workerId:notice.workerId,messageId:notice.messageId}),reply=read.messages[0];
    assert.equal(Object.hasOwn(reply,'replyTo'),false);assert.equal(Object.hasOwn(reply,'causationId'),false);
    assert.equal(reply.senderRunId,reply.payload.runId);assert.equal(reply.taskVersion,notice.version);assert.equal(reply.payload.version,notice.version);
    notices.push({messageId:reply.id,runId:reply.senderRunId,version:notice.version,text:reply.text});
    if(notice.version===1){
     assert.equal(f.app.tasks.task(taskId).headVersion,2);
     await assert.rejects(main.call('accept_result',{taskId,messageId:reply.id}),/tool_denied/);
    }
    return {status:'completed',text:'',messages:[]};
   }
   return {status:'completed',text:'Recorded',messages:[]};
  }catch(error){errors.push(error);throw error;}
 });
 try{
  await f.app.start();await f.app.message(original,'lifecycle-initial');await until(()=>peers().length===2&&peers().every(peer=>!!peer.finish));
  const first=peers().slice(),oldRuns=f.app.tasks.runs(taskId),oldBodies=new Map(oldRuns.map((run,index)=>[run.workerId,'  '+(index?'B':'A')+' 旧版迟到原文。\n\n缺少的日期仍未知。  ']));
  assert.equal(oldRuns.length,2);assert.equal(new Set(workerIds).size,2);assert.ok(oldRuns.every(run=>run.phase==='executing'&&run.version===1&&run.sourceRequestId==='lifecycle-initial'));
  for(const [index,peer] of first.entries())peer.interrupt=async()=>{
   if(peer.finish){
    assert.equal(f.app.tasks.task(taskId).headVersion,2,'the old draft arrives after the new requirement is committed');
    const run=oldRuns.find(run=>run.threadId===peer.threadId)!;
    const message={itemId:'late-old-'+index,phase:'final_answer' as const,text:oldBodies.get(run.workerId)!},result={status:'completed' as const,text:message.text,messages:[message]};
    peer.emit('agentMessage',{threadId:peer.threadId,turnId:peer.turnId,...message,completed:true});
    peer.emit('nativeCompleted',{threadId:peer.threadId,turnId:peer.turnId,result});
    const finish=peer.finish;peer.finish=undefined;finish(result);
   }
   return true;
  };
  await f.app.message(changedText,'lifecycle-change');await until(()=>peers().length===4&&peers().slice(2).every(peer=>!!peer.finish));
  assert.deepEqual(errors,[]);assert.equal(change.state,'confirmed');assert.equal(receiptState(obsoleteMessage),'rejected');
  const task=f.app.tasks.task(taskId),version=f.app.tasks.version(taskId,2),authority=f.app.tasks.authority(taskId,2),second=peers().slice(2),secondRuns=f.app.tasks.runs(taskId).filter(run=>run.version===2);
  assert.equal(task.headVersion,2);assert.equal(version.sourceRequestId,'lifecycle-change');assert.equal(version.triggerOpId,change.operationKey);assert.equal(authority.sourceRequestId,'lifecycle-change');assert.match(authority.description,/改要求：仅核对新版事实/);
  assert.equal(secondRuns.length,2);assert.ok(secondRuns.every(run=>run.sourceRequestId==='lifecycle-change'&&run.phase==='executing'));
  for(const run of secondRuns)assert.equal(run.threadId,oldRuns.find(old=>old.workerId===run.workerId)!.threadId);
  for(const [index,peer] of second.entries()){
   let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});releases.push(release);
   const close=peer.close.bind(peer);peer.close=async()=>{closing[index]=true;await gate;return close();};
  }
  pauseWork=f.app.message('暂停整件事，保留已经排队的后续问题','lifecycle-pause');pauseWork.catch(()=>{});
  await until(()=>closing.some(Boolean)&&pauseChecked);assert.deepEqual(errors,[]);
  assert.equal(f.app.tasks.task(taskId).controlState,'stopping');assert.equal(f.app.tasks.task(taskId).state,'open');
  assert.equal(queued.length,2);assert.ok(queued.every(receipt=>receipt.runId===null&&receiptState(receipt.messageId)==='pending'));
  assert.equal(peers().length,4);assert.equal(f.app.tasks.runs(taskId).length,4);
  const firstClosing=closing.findIndex(Boolean),secondClosing=1-firstClosing;
  const confirmed=secondRuns.find(run=>run.threadId===second[firstClosing]!.threadId)!,waiting=secondRuns.find(run=>run.threadId===second[secondClosing]!.threadId)!;
  releases[firstClosing]!();await until(()=>JSON.parse(f.app.tasks.run(confirmed.id).checkpointJson??'{}').workerExitConfirmed===1);
  assert.equal(JSON.parse(f.app.tasks.run(confirmed.id).checkpointJson??'{}').workerExitConfirmed,1);
  assert.notEqual(JSON.parse(f.app.tasks.run(waiting.id).checkpointJson??'{}').workerExitConfirmed,1);
  assert.equal(f.app.tasks.task(taskId).controlState,'stopping');assert.notEqual(f.app.tasks.task(taskId).state,'paused');
  assert.ok(queued.every(receipt=>receiptState(receipt.messageId)==='pending'));assert.equal(peers().length,4);
  releases[secondClosing]!();await pauseWork;await f.app.idle();assert.deepEqual(errors,[]);
  assert.equal(pause.state,'confirmed');assert.equal(f.app.tasks.task(taskId).state,'paused');assert.equal(f.app.tasks.task(taskId).controlState,'normal');
  for(const run of secondRuns){assert.equal(f.app.tasks.run(run.id).phase,'ended');assert.equal(JSON.parse(f.app.tasks.run(run.id).checkpointJson??'{}').workerExitConfirmed,1);}
  assert.deepEqual(JSON.parse(f.app.tasks.operation(pause.operationKey).detailsJson).runIds.slice().sort(),secondRuns.map(run=>run.id).sort());
  assert.equal(peers().length,4);assert.ok(queued.every(receipt=>receiptState(receipt.messageId)==='rejected'));
  await f.app.message('暂停时只改目标，不执行','lifecycle-paused-edit');
  assert.equal(f.app.tasks.task(taskId).state,'paused');
  assert.equal(f.app.tasks.task(taskId).headVersion,3);assert.equal(peers().length,4);
  await f.app.message('恢复办理原会话中的排队问题','lifecycle-resume');await until(()=>peers().length===6&&peers().slice(4).every(peer=>!!peer.finish));
  assert.equal(resume.state,'open');const resumed=f.app.tasks.runs(taskId).slice(4);
  assert.equal(resumed.length,2);assert.deepEqual(new Set(resumed.map(run=>run.workerId)),new Set(workerIds));
  const newBodies=new Map<string,string>();
  for(const run of resumed){
   assert.equal(run.version,3);assert.equal(run.sourceRequestId,'lifecycle-paused-edit');assert.equal(run.threadId,oldRuns.find(old=>old.workerId===run.workerId)!.threadId);
   const expected=(run.workerId===workerIds[0]?'A':'B')+' 暂停后继续核对';assert.equal(run.prompt,expected);
   const peer=peers().slice(4).find(peer=>peer.threadId===run.threadId)!;assert.equal(peer.options.threadId,run.threadId);
   const body='  新版核对原文：'+expected+'\n\n缺失日期保持未知。  ';newBodies.set(run.id,body);
   peer.finish!({status:'completed',text:body,messages:[{itemId:'new-final',phase:'final_answer',text:body}]});
  }
  await f.app.idle();assert.deepEqual(errors,[]);assert.equal(f.app.tasks.task(taskId).outcome,null);
  await f.app.message('核对新版原文后结案','lifecycle-settle');await f.app.idle();assert.deepEqual(errors,[]);
  assert.equal(f.app.tasks.tasks().length,1);assert.equal(f.app.tasks.task(taskId).outcome,'succeeded');assert.equal(f.app.tasks.runs(taskId).length,6);
  for(const run of oldRuns){
   const notice=notices.find(notice=>notice.runId===run.id)!;assert.equal(notice.version,1);assert.equal(notice.text,oldBodies.get(run.workerId));
   const detail=readTaskDetail(f.app.store.db,taskId,{workerId:run.workerId,messageId:notice.messageId}).conversation!.messages[0]!;
   assert.equal(detail.text,oldBodies.get(run.workerId));assert.equal(detail.version,1);
  }
  for(const run of resumed){
   const readback=notices.filter(notice=>notice.runId===run.id);assert.equal(readback.length,1);
   assert.equal(readback[0]!.text,newBodies.get(run.id));assert.equal(readback[0]!.version,3);
   const detail=readTaskDetail(f.app.store.db,taskId,{workerId:run.workerId,messageId:readback[0]!.messageId}).conversation!.messages[0]!;
   assert.equal(detail.text,newBodies.get(run.id));assert.equal(detail.version,3);
  }
  assert.equal(notices.length,6);for(const notice of notices)assert.equal(receiptState(notice.messageId),'processed');
  for(const receipt of queued){
   const saved=f.app.store.db.prepare('SELECT m.taskVersion,m.targetRunId,r.offeredRunId,r.processedBy FROM agent_messages m JOIN agent_receipts r ON r.messageId=m.id WHERE m.id=?').get(receipt.messageId)!;
   assert.equal(receiptState(receipt.messageId),'rejected');assert.equal(saved.taskVersion,2);
   assert.equal(saved.targetRunId,null);assert.equal(saved.offeredRunId,null);assert.equal(saved.processedBy,null);
  }
  for(const [receipt,requestId] of [[change,'lifecycle-change'],[pause,'lifecycle-pause'],[resume,'lifecycle-resume']] as const){
   const operation=f.app.tasks.operation(receipt.operationKey),inputMessageId=JSON.parse(operation.detailsJson).inputMessageId;
   assert.equal(operation.state,'confirmed');const input=f.app.store.db.prepare('SELECT kind,payloadJson FROM agent_messages WHERE id=?').get(inputMessageId)!;
   assert.equal(input.kind,'user_input');assert.equal(JSON.parse(String(input.payloadJson)).requestId,requestId);assert.equal(receiptState(inputMessageId),'processed');
  }
  assert.equal(f.app.store.db.prepare("SELECT 1 FROM sqlite_master WHERE name IN ('results','deliveries')").get(),undefined);
 }finally{for(const release of releases)release();await f.close();}
});
