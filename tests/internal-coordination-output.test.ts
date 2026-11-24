import {openTaskWorker} from './fixtures/open-task-worker.js';
import {readTestConversation} from './fixtures/read-test-conversation.js';
// Real host, original replies and final answer projection; synthetic transport only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
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
   taskId=(await openTaskWorker(main,'核对合成材料并报告缺口')).taskId;
   return result(main,[{itemId:'initial',phase:'commentary',text:'正常起始反馈'},{itemId:'arranged',phase:'final_answer',text:'已安排核对。'}]);
  }
  try{
   const notice=JSON.parse(text.split('\n')[1]!);assert.equal(notice.kind,'worker_reply');
   const read=await main.call('worker_read',{workerId:notice.workerId,messageId:notice.messageId}),original=read.messages[0];
   assert.ok(original.text.includes(finalText));assert.ok(original.nativeMessages.some((item:any)=>item.itemId==='worker-final'));
   const publishFile=['published','published-final','published-extra'].includes(scenario);
   if(['unknown','blocked'].includes(scenario))await main.call('task_update',{taskId,notes:finalText});
   if(scenario==='no-phase-adapter')return {status:'completed',text:finalText};
   if(scenario==='final'){
    main.emit('agentMessage',{threadId:main.threadId,turnId:main.turnId,itemId:'business-final',phase:'final_answer',text:'有效',completed:false});
    assert.equal((await homerWebBridge(f.app).history!.state()).mainActivity?.finalText,'有效');
   }
   const answer=publishFile?original.text+(scenario==='published-extra'?'\n新增缺口：仍需补充材料。':''):finalText;
   return result(main,[{itemId:'review-comment',phase:'commentary',text:'收到成果并验收，交付已准备。'},{itemId:'business-final',phase:'final_answer',text:answer}],scenario==='image-error'?{nativeOutputError:'synthetic_image_error'}:{});
  }catch(error){errors.push(String(error));throw error;}
 });
 try{
  await f.app.start();const main=f.engines[0]!,close=main.close.bind(main),interrupt=main.interrupt.bind(main);
  main.close=async()=>{mainCloses++;return close();};main.interrupt=async()=>{mainInterrupts++;return interrupt();};
  await f.app.message('synthetic:user','coord-source');await until(()=>f.engines.some(engine=>engine.options.role==='worker'&&engine.finish));
  const worker=f.engines.find(engine=>engine.options.role==='worker')!,run=f.app.tasks.runs(taskId)[0]!,rounds=f.inputs.length;
  const before=readTestConversation(f.app).messages.filter(message=>message.text.trim()).map(message=>({id:message.id,text:message.text}));
  worker.emit('agentMessage',{threadId:worker.threadId,turnId:worker.turnId,itemId:'worker-progress',phase:'commentary',text:'普通中间处理',completed:true});
  await new Promise(resolve=>setTimeout(resolve,20));assert.equal(f.inputs.length,rounds,'ordinary Worker progress adds zero Main rounds');
  assert.deepEqual(readTestConversation(f.app).messages.filter(message=>message.text.trim()).map(message=>({id:message.id,text:message.text})),before,'progress adds no user message');
  assert.equal('workerProgress' in f.app,false);
  const path=join(f.app.config.workspace,'checked.md');writeFileSync(path,'# 已核对的材料');
  const raw=finalText+'\n[报告]('+path+')';
  worker.finish!({status:scenario==='failed'?'failed':'completed',text:raw,messages:[{itemId:'worker-final',phase:'final_answer',text:raw}],...(scenario==='failed'?{errorCode:'synthetic_failure'}:{})});
  await f.app.idle();assert.deepEqual(errors,[]);
  if(scenario==='unlinked-same-text'){await f.app.message('synthetic:independent','coord-independent');await f.app.idle();}
  const reply=f.app.tasks.workerRead({agentId:f.app.store.meta('mainAgentId')!},{workerId:run.workerId}).messages.find(message=>message.kind==='worker_reply')!;
  assert.equal(reply.text,raw);assert.ok(reply.nativeMessages.some(item=>item.itemId==='worker-progress'&&item.phase==='commentary'));
  const nodes=f.app.processes.list(f.app.store.meta('mainThread')!),process=nodes.find(node=>node.sourceMessageIds.includes(reply.id))!;
  assert.ok(process);assert.ok(process.items.some(item=>item.kind==='tool'),'original inspection remains in process details');
  assert.equal(f.inputs.filter(text=>text.startsWith('[内部协作输入')).length,1,'notes and publishing add no self-confirmation round');
  const projected=readTestConversation(f.app),user=projected.messages.find(message=>message.process?.sourceKind==='user')!;
  assert.equal(user.text,'已安排核对。');assert.ok(user.process?.items.some(item=>item.kind==='commentary'&&item.text==='正常起始反馈'));
  const copies=projected.messages.filter(message=>message.text.includes(finalText));
  assert.equal(copies.length,scenario==='no-phase-adapter'?0:scenario==='unlinked-same-text'?2:1);
  assert.ok(copies.every(message=>!message.text.includes('收到成果并验收')));
  assert.equal(f.app.tasks.task(taskId).historyState,'visible');
  if(['published','published-final','published-extra'].includes(scenario)){
   assert.equal(mainCloses,0);assert.equal(mainInterrupts,0);
   const sentId=copies[0]!.id;
   assert.equal(sentId,process.messageId);assert.ok(copies[0]!.text.includes(raw));
   const bridge=homerWebBridge(f.app),state=await bridge.history!.state(),attachment=state.artifacts?.find(artifact=>artifact.messageId===sentId)!;
   assert.ok(attachment);
   const file=await bridge.media!.read({messageId:sentId,assetId:attachment.assetId,revision:attachment.revision});
   assert.equal(Buffer.from(file.data!,'base64').toString(),'# 已核对的材料');
  }
  assert.equal(f.app.store.db.prepare('SELECT count(*) n FROM agent_messages WHERE id=?').get(reply.id)!.n,1);
  assert.equal(f.app.store.db.prepare('SELECT state FROM agent_receipts WHERE messageId=?').get(reply.id)!.state,'received');
 }finally{await f.close();}
});

for(const revoked of [false,true])test('a current archive receipt streams its Main final after source revocation='+revoked,async()=>{
 const f=fixture(),bridge=homerWebBridge(f.app);
 let taskId='',release!:()=>void;
 const hold=new Promise<void>(resolve=>{release=resolve;});
 const final={itemId:'answer',phase:'final_answer' as const,text:'已核对归档。'};
 f.setScript(async(main,text)=>{
  if(text==='prepare'){
   taskId=(await main.call('task_create',{title:'归档示例',goal:'核对归档'})).taskId;
   await main.call('task_update',{taskId,goal:'核对归档'});
  }else if(text==='archive')await main.call('archive_work',{taskId});
  else{
   await hold;
   return {status:'completed',text:final.text,messages:[final]};
  }
  return {status:'completed',text:'完成'};
 });
 try{
  await f.app.start();await f.app.message('prepare','prepare-source');await f.app.message('archive','archive-source');
  await until(()=>f.app.conversationControlState().mainActivity?.source==='internal'&&!!f.app.conversationControlState().mainActivity?.turnId);
  const main=f.engines[0]!,id=f.app.conversationControlState().mainActivity!.processId;
  const emit=(itemId:string,patch:Record<string,unknown>)=>main.emit('agentMessage',{threadId:main.threadId,turnId:main.turnId,itemId,completed:false,...patch});
  const snapshot=()=>bridge.history!.state();
  emit('private',{phase:'commentary',text:'PRIVATE_COMMENT'});emit('unknown',{delta:'UNKNOWN_PHASE'});
  emit('stale',{phase:'final_answer',turnId:'old-turn',text:'STALE_FINAL'});
  assert.doesNotMatch(JSON.stringify(await snapshot()),/PRIVATE_COMMENT|UNKNOWN_PHASE|STALE_FINAL/);
  emit('reclassified',{phase:'final_answer',text:'临时正文'});
  emit('reclassified',{phase:'commentary',text:'PRIVATE_CORRECTION',completed:true});
  assert.equal((await snapshot()).mainActivity?.finalText,undefined);
  emit('answer',{phase:'final_answer',text:''});emit('answer',{delta:'已核对'});
  assert.equal((await snapshot()).mainActivity?.finalText,'已核对');
  assert.equal(f.app.history.message(id)?.text,'');
  if(revoked){
   const source=(await snapshot()).messages.find(message=>message.role==='user'&&message.requestId==='archive-source')!;
   f.app.history.revokeMessage(main.threadId,source.id);
  }
  emit('answer',{delta:'归档。'});
  assert.equal((await snapshot()).mainActivity?.finalText,final.text);
  release();await f.app.idle();
  const end=await snapshot();assert.equal(end.mainActivity,null);
  assert.equal(end.messages.filter(message=>message.text===final.text).length,1);
  assert.equal(end.messages.find(message=>message.id===id)?.status,'completed');
 }finally{release();await f.close();}
});
