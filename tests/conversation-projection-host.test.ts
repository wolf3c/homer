import {test} from 'node:test';
import assert from 'node:assert/strict';
import {syntheticHost} from '../scripts/recursive-synthetic-host.js';
import {syntheticFile} from './recursive-publication-fixture.js';
import {homerWebBridge} from '../src/web-homer.js';
import {createWebServer,fetch} from './web-connected-fixture.js';
for(const scenario of ['pre-call-failure','ack-db-failure','no-ack','after-ack-lost','failed-terminal','failed-terminal-closed','completed'] as const){
 test('real host synthetic native boundary: '+scenario,async()=>{
  const f=syntheticHost();try{
   await f.app.start();const peer=f.engines[0]!;let calls=0,observedAtomic=false,closedAfterTerminal=false;
   Object.defineProperty(peer,'available',{get:()=>!closedAfterTerminal});
   if(scenario==='pre-call-failure')f.app['recoverMain']=async()=>{throw Error('synthetic_prepare_failure');};
   if(scenario==='ack-db-failure')f.app.store.db.exec("CREATE TEMP TRIGGER fail_native_ack BEFORE UPDATE OF state ON agent_receipts WHEN NEW.state='received' BEGIN SELECT RAISE(ABORT,'synthetic_ack_db_failure'); END");
   peer.turn=async(_text,options)=>{
    calls++;peer.turnId='synthetic-native';
    if(scenario==='no-ack')throw Error('synthetic_connection_lost');
    options?.onStarted?.(peer.turnId);
    const node=f.app.processes.list(peer.threadId)[0];
    observedAtomic=!!node&&f.app.inputs.list()[0]!.generationId===f.app['mainContext']?.generation?.generationId;
    if(scenario==='after-ack-lost')throw Error('synthetic_connection_lost');
    peer.emit('agentMessage',{threadId:peer.threadId,turnId:peer.turnId,itemId:'native-final',phase:'final_answer',text:'合成最终答复',completed:true});
    closedAfterTerminal=scenario==='failed-terminal-closed';
    return {status:scenario.startsWith('failed-terminal')?'failed':'completed',text:'Synthetic native aggregate'};
   };
   f.app.submitMessage({requestId:'synthetic-boundary',text:'合成输入'});await f.app.idle();
   assert.equal(calls,scenario==='pre-call-failure'?0:1);const item=f.app.inputs.list()[0]!,state=f.app.conversationState();
   if(scenario==='pre-call-failure'){assert.equal(item.state,'failed');assert.equal(state.queue.length,0);assert.equal(state.messages.length,1);assert.equal(state.messages[0]?.source?.text,'合成输入');}
   else if(['ack-db-failure','no-ack','after-ack-lost'].includes(scenario)){
    assert.equal(item.state,'uncertain');assert.equal(f.app.inputs.claim(),undefined);
    if(scenario==='after-ack-lost'){assert.ok(observedAtomic);assert.equal(state.messages.filter(m=>m.role==='user').length,1);assert.equal(state.messages.find(m=>m.process)?.process?.status,'unknown');}
    else{assert.equal(f.app.processes.list(peer.threadId).length,0);assert.equal(state.queue[0]?.state,'uncertain');assert.ok(state.messages.some(m=>m.id.startsWith('input-outcome:')));}
    const revision=item.revision;f.app.inputs.reconcile();assert.equal(f.app.inputs.list()[0]!.revision,revision);
   }else{assert.ok(observedAtomic);assert.equal(item.state,scenario==='completed'?'completed':'failed');assert.equal(state.queue.length,0);assert.equal(state.messages.find(m=>m.process)?.text,'合成最终答复');}
  }finally{await f.close();}
 });
}
test('authorized result origin reads exact old-thread publication and refuses revoked/unpublished/arbitrary selectors',async()=>{
 const f=syntheticHost();try{
  await f.app.start();f.app.inputs.accept({requestId:'synthetic-origin',text:'合成成果授权'});
  const claimed=f.app.inputs.claim()!;f.app.inputs.finish(claimed.messageId,claimed.revision,'completed');f.app.store.finishRequest('synthetic-origin','Synthetic accepted request');
  const file=syntheticFile(f.app,'synthetic-origin','synthetic-plan.md','# Plan',[{filename:'synthetic-draft.md',content:'# Draft'}]);const delivery=file.publish('旧线程原答复，正文完整');
  f.app.tasks.markDelivery(delivery.id,'recorded');f.app.history.record(delivery.historyMessageId,'synthetic-older-thread',delivery.text);
  const bridge=homerWebBridge(f.app),origin=await bridge.artifactOrigin!(file.resultId);
  assert.equal(origin.message.id,delivery.historyMessageId);assert.equal(origin.message.threadId,'synthetic-older-thread');assert.equal(origin.message.text,delivery.text);assert.deepEqual(new Set(origin.files.map(file=>file.id)),new Set(file.resultIds));
  const web=await createWebServer({bridge,port:0});try{
   assert.equal((await fetch(web.url+'/api/files/'+file.resultId+'/origin')).status,200);
   assert.equal((await fetch(web.url+'/api/files/'+file.resultId+'/origin?threadId=other')).status,400);
   assert.equal((await fetch(web.url+'/api/files/result-not-published/origin')).status,409);
   assert.equal((await fetch(web.url+'/api/files/run-arbitrary/origin')).status,404);
   f.app.tasks.markDelivery(delivery.id,'revoked');assert.equal((await fetch(web.url+'/api/files/'+file.resultId+'/origin')).status,409);
  }finally{await web.close();}
 }finally{await f.close();}
});
test('internal worker turn with host closure remains unknown and never promotes private text to a public final',async()=>{
 const f=syntheticHost();try{
  await f.app.start();const peer=f.engines[0]!;
  peer.turn=async(_text,options)=>{peer.turnId='synthetic-internal-turn';options?.onStarted?.(peer.turnId);peer.emit('agentMessage',{threadId:peer.threadId,turnId:peer.turnId,itemId:'private',phase:'final_answer',text:'PRIVATE_WORKER_BODY',completed:true});throw Error('synthetic_worker_connection_lost');};
  await assert.rejects(()=>f.app['mainTurn']('[内部协作事件 synthetic]',{event:true,inspected:new Set()}),/synthetic_worker_connection_lost/);
   const node=f.app.processes.list(peer.threadId)[0]!;assert.equal(node.status,'unknown');assert.equal(node.state,'worked');assert.match(node.endEventId!,/^host:engine_closed:/);assert.equal(node.final,undefined);assert.equal(node.items.length,1);assert.ok(!JSON.stringify(f.app.conversationState()).includes('PRIVATE_WORKER_BODY'));
 }finally{await f.close();}
});
test('new user input runs independently after Worker host closure while its old receipt stays uncertain',async()=>{
 const f=syntheticHost();try{
  await f.app.start();const peer=f.engines[0]!;
  peer.turn=async(_text,options)=>{peer.turnId='synthetic-worker-receipt';options?.onStarted?.(peer.turnId);throw Error('synthetic_worker_connection_lost');};
  f.app.inputs.accept({requestId:'synthetic-worker-source',text:'Synthetic authorized file'});
  const source=f.app.inputs.claim()!;f.app.inputs.finish(source.messageId,source.revision,'completed');
  syntheticFile(f.app,'synthetic-worker-source');
  const input=f.app.inputs.claim([],'all');assert.ok(input);assert.equal(input.origin,'worker');
  if(input.origin!=='worker')assert.fail('worker input required');
  await f.app['processWorkerInput'](input);await f.app.idle();
  assert.equal(f.app.store.db.prepare('SELECT state FROM agent_receipts WHERE messageId=? AND recipientAgentId=?').get(input.messageId,f.app.store.meta('mainAgentId')!)!.state,'uncertain');
  const node=f.app.processes.list(peer.threadId)[0]!;assert.equal(node.state,'worked');assert.equal(node.status,'unknown');assert.equal(node.final?.text.includes('主 Agent 本次协调未完成'),true);
  assert.equal(await f.app.message('Synthetic next input','synthetic-next-user'),'Synthetic reply: Synthetic next input');
  assert.ok(f.seen.includes('Synthetic next input'),'the new user input reaches the recovered engine');
  assert.equal(f.seen.filter(text=>text.includes(input.messageId)).length,0,'unrelated historical uncertainty adds no model round to the new request');
  assert.equal(f.app.inputs.byRequestIds(['synthetic-next-user'])[0]!.state,'completed');
  assert.equal(f.app.processes.list(peer.threadId).filter(item=>item.sourceKind==='worker'&&item.sourceMessageIds.includes(input.messageId)).length,1,'the old Worker input is not replayed');
  assert.equal(f.app.store.db.prepare('SELECT state FROM agent_receipts WHERE messageId=? AND recipientAgentId=?').get(input.messageId,f.app.store.meta('mainAgentId')!)!.state,'uncertain');
 }finally{await f.close();}
});
test('unknown/no-final process keeps the exact original publication and both authorized files reachable',async()=>{
 const f=syntheticHost();try{
  await f.app.start();const thread=f.app.store.meta('mainThread')!;
  f.app.inputs.accept({requestId:'synthetic-fast-origin',text:'合成方案与配套草稿'});const input=f.app.inputs.claim()!;
  f.app.store.transaction(()=>{f.app.processes.start({id:'synthetic-fast-node',threadId:thread,sourceKind:'user',sourceMessageIds:[input.messageId],messageId:'synthetic-fast-node',replyMessageId:input.replyId},'synthetic-fast-turn');f.app.history.record('synthetic-fast-node',thread,'','running');f.app.inputs.startedInTransaction(input.messageId,input.revision,'synthetic-fast-generation','synthetic-fast-turn');});
  const file=syntheticFile(f.app,input.input.requestId,'synthetic-fast-plan.md','# Plan',[{filename:'synthetic-fast-draft.md',content:'# Draft'}]),delivery=file.publish('Fast 合成原交付正文，两个文件关系完整。');
  f.app.history.record(delivery.historyMessageId,thread,delivery.text);f.app.processes.delivery('synthetic-fast-node',{historyMessageId:delivery.historyMessageId,text:delivery.text});f.app.processes.finish('synthetic-fast-node','unknown');f.app.inputs.uncertain(input.messageId,input.revision);
  const bridge=homerWebBridge(f.app),state=await bridge.state();assert.equal(state.messages.find(message=>message.id==='synthetic-fast-node')?.process?.status,'unknown');assert.equal(state.messages.find(message=>message.id==='synthetic-fast-node')?.process?.final,undefined);assert.equal(state.messages.find(message=>message.id===delivery.historyMessageId)?.text,delivery.text);
  assert.deepEqual(new Set(state.artifacts?.filter(file=>file.messageId===delivery.historyMessageId).map(file=>file.id)),new Set(file.resultIds));assert.equal((await bridge.artifactOrigin!(file.resultId)).message.id,delivery.historyMessageId);assert.equal(state.queue?.length,0);assert.equal(state.messages.filter(message=>message.role==='user').length,1);
 }finally{await f.close();}
});
