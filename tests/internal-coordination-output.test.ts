// Real host, original replies, process projection and formal publication; synthetic transport only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,until} from './fixtures/worker-chat-host.js';
import {homerWebBridge} from '../src/web-homer.js';
import type {TurnResult} from '../src/engine.js';

for(const scenario of ['final','partial','failed','unknown','blocked','published','published-final','published-extra','unlinked-same-text','no-phase-adapter','image-error'] as const)test('internal phase boundary preserves original useful output and history: '+scenario,async()=>{
 const f=fixture();let taskId='',mainCloses=0,mainInterrupts=0;
 const errors:string[]=[],finalText=scenario==='partial'?'已核对两项，一项日期缺失。':scenario==='failed'?'执行失败，已保留报告。':scenario==='unknown'?'外部结果未知，需核对。':scenario==='blocked'?'新阻塞：缺少授权材料。':'有效业务结论';
 const result=(engine:typeof f.engines[number],messages:NonNullable<TurnResult['messages']>,extra:Partial<TurnResult>={}):TurnResult=>{
  for(const message of messages)engine.emit('agentMessage',{threadId:engine.threadId,turnId:engine.turnId,...message,completed:true});
  return {status:'completed',text:messages.map(message=>message.text).join('\n').trim(),messages,...extra};
 };
 f.setScript(async(main,text)=>{
  if(text==='synthetic:independent')return result(main,[{itemId:'independent-final',phase:'final_answer',text:finalText}]);
  if(text==='synthetic:user'){
   taskId=(await main.call('task_create',{goal:'只核对合成材料'})).taskId;
   await main.call('worker_open',{taskId,message:'核对合成材料并报告缺口'});
   return result(main,[{itemId:'initial',phase:'commentary',text:'正常起始反馈'},{itemId:'arranged',phase:'final_answer',text:'已安排核对。'}]);
  }
  try{
   const notice=JSON.parse(text.split('\n')[1]!);assert.equal(notice.kind,'worker_reply');
   const read=await main.call('worker_read',{workerId:notice.workerId,messageId:notice.messageId}),original=read.messages[0];
   assert.ok(original.text.includes(finalText));assert.ok(original.nativeMessages.some((item:any)=>item.itemId==='worker-final'));
   if(['published','published-final','published-extra'].includes(scenario)){
    const filePath=original.text.match(/\[报告\]\(([^)]+)\)/)![1]!;
    const accepted=await main.call('accept_result',{runId:notice.runId,filePath});
    await main.call('work_inspect',{resultId:accepted.resultId});
    const publication=await main.call('publish_delivery',{taskId,resultIds:[accepted.resultId],text:finalText});
    assert.equal(publication.state,'prepared');assert.equal(f.app.tasks.delivery(publication.deliveryId).state,'prepared');
   }
   if(['unknown','blocked'].includes(scenario))await main.call('task_update',{taskId,notes:finalText});
   else await main.call('task_update',{taskId,action:'settle',outcome:scenario==='partial'?'partial':scenario==='failed'?'failed':'succeeded'});
   if(scenario==='no-phase-adapter')return {status:'completed',text:finalText};
   return result(main,[{itemId:'review-comment',phase:'commentary',text:'收到成果并验收，交付已准备。'},{itemId:'business-final',phase:'final_answer',text:scenario==='published'?'':scenario==='published-extra'?finalText+'\n新增缺口：仍需补充材料。':finalText}],scenario==='image-error'?{nativeOutputError:'synthetic_image_error'}:{});
  }catch(error){errors.push(String(error));throw error;}
 });
 try{
  await f.app.start();const main=f.engines[0]!,close=main.close.bind(main),interrupt=main.interrupt.bind(main);
  main.close=async()=>{mainCloses++;return close();};main.interrupt=async()=>{mainInterrupts++;return interrupt();};
  await f.app.message('synthetic:user','coord-source');await until(()=>f.engines.some(engine=>engine.options.role==='worker'&&engine.finish));
  const worker=f.engines.find(engine=>engine.options.role==='worker')!,run=f.app.tasks.runs(taskId)[0]!,rounds=f.inputs.length;
  const before=f.app.conversationState().messages.filter(message=>message.text.trim()).map(message=>({id:message.id,text:message.text}));
  worker.emit('agentMessage',{threadId:worker.threadId,turnId:worker.turnId,itemId:'worker-progress',phase:'commentary',text:'普通中间处理',completed:true});
  await new Promise(resolve=>setTimeout(resolve,20));assert.equal(f.inputs.length,rounds,'ordinary Worker progress adds zero Main rounds');
  assert.deepEqual(f.app.conversationState().messages.filter(message=>message.text.trim()).map(message=>({id:message.id,text:message.text})),before,'progress adds no user message');
  assert.equal(f.app.workerProgress.get({taskId,version:run.version,runId:run.id,epoch:run.epoch,threadId:worker.threadId,turnId:worker.turnId!})?.output?.text,'普通中间处理');
  await worker.call('read_material',{});const file=await worker.call('write_markdown',{filename:'checked.md',content:'# 已核对的材料'});
  const raw=finalText+'\n[报告]('+file.path+')';
  worker.finish!({status:scenario==='failed'?'failed':'completed',text:raw,messages:[{itemId:'worker-final',phase:'final_answer',text:raw}],...(scenario==='failed'?{errorCode:'synthetic_failure'}:{})});
  await f.app.idle();assert.deepEqual(errors,[]);
  if(scenario==='unlinked-same-text'){await f.app.message('synthetic:independent','coord-independent');await f.app.idle();}
  const reply=f.app.tasks.workerRead({agentId:f.app.store.meta('mainAgentId')!},{workerId:run.workerId}).messages.find(message=>message.kind==='worker_reply')!;
  assert.equal(reply.text,raw);assert.ok(reply.nativeMessages.some(item=>item.itemId==='worker-progress'&&item.phase==='commentary'));
  const nodes=f.app.processes.list(f.app.store.meta('mainThread')!),process=nodes.find(node=>node.sourceMessageIds.includes(reply.id))!;
  assert.ok(process);assert.ok(process.items.some(item=>item.kind==='tool'),'original inspection remains in process details');
  assert.equal(f.inputs.filter(text=>text.startsWith('[内部协作输入')).length,1,'own acceptance/settlement/publication adds no self-confirmation round');
  const projected=f.app.conversationState(),user=projected.messages.find(message=>message.process?.sourceKind==='user')!;
  assert.equal(user.text,'已安排核对。');assert.ok(user.process?.items.some(item=>item.kind==='commentary'&&item.text==='正常起始反馈'));
  const copies=projected.messages.filter(message=>message.text.includes(finalText));
  assert.equal(copies.length,['unlinked-same-text','published-extra'].includes(scenario)?2:1,'only exact source identity can combine copies');
  assert.ok(copies.every(message=>!message.text.includes('收到成果并验收')));
  if(scenario==='image-error')assert.match(copies[0]!.text,/synthetic_image_error/);
  if(['unknown','blocked'].includes(scenario))assert.equal(f.app.tasks.task(taskId).outcome,null);
  if(['published','published-final','published-extra'].includes(scenario)){
   assert.equal(mainCloses,0);assert.equal(mainInterrupts,0);
   const delivery=f.app.tasks.deliveries()[0]!;assert.equal(delivery.state,'recorded');assert.equal(f.events.filter(message=>message.type==='delivery').length,1);
   assert.ok(copies.some(message=>message.id===delivery.historyMessageId));
   const bridge=homerWebBridge(f.app),state=await bridge.state(),attachment=state.work.flatMap(work=>work.artifacts??[]).find(artifact=>artifact.historyMessageId===delivery.historyMessageId)!;
   assert.ok(attachment);assert.equal((await bridge.artifact(attachment.id)).content,'# 已核对的材料');
  }
  assert.equal(f.app.store.db.prepare('SELECT count(*) n FROM agent_messages WHERE id=?').get(reply.id)!.n,1);
  assert.equal(f.app.store.db.prepare('SELECT state FROM agent_receipts WHERE messageId=?').get(reply.id)!.state,'processed');
 }finally{await f.close();}
});
