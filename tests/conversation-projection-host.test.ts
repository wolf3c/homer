import {test} from 'node:test';
import assert from 'node:assert/strict';
import {syntheticHost} from '../scripts/recursive-synthetic-host.js';
import {commitSyntheticMessage} from './fixtures/synthetic-message.js';
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
test('attachment origin returns exactly its owning message and rejects foreign, revoked and mismatched identities',async()=>{
 const f=syntheticHost();try{
  await f.app.start();
  const thread=f.app.store.meta('mainThread')!,text='原答复，正文完整';
  const message=commitSyntheticMessage(f.app,thread,text,[{filename:'synthetic-plan.md',content:'# Plan'},{filename:'synthetic-draft.md',content:'# Draft'}]);
  const foreign=commitSyntheticMessage(f.app,'synthetic-older-thread','Unrelated private text',[{filename:'foreign.md',content:'# Foreign'}]);
  const ref={messageId:message.messageId,...message.attachments[0]!},bridge=homerWebBridge(f.app),origin=await bridge.media!.origin!(ref);
  assert.equal(origin.message.id,message.messageId);assert.equal(origin.message.threadId,thread);assert.equal(origin.message.text,text);
  assert.deepEqual(origin.files.map(({assetId,revision})=>({assetId,revision})),message.attachments);
  const web=await createWebServer({bridge,port:0});try{
   const path=message.paths[0]!;
   assert.equal((await fetch(web.url+path+'/origin')).status,200);
   assert.equal((await fetch(web.url+path+'/origin?threadId=other')).status,400);
   assert.equal((await fetch(web.url+path.replace(message.messageId,'message-not-sent')+'/origin')).status,409);
   assert.equal((await fetch(web.url+foreign.paths[0]+'/origin')).status,409);
   assert.equal((await fetch(web.url+'/api/files/run-arbitrary/origin')).status,404);
   assert.ok(f.app.history.revokeMessage(thread,message.messageId));
   assert.equal((await fetch(web.url+path+'/origin')).status,409);
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
  const main={agentId:f.app.store.meta('mainAgentId')!,sourceRequestId:source.input.requestId,threadId:f.app.store.meta('mainThread')!};
  const opened=f.app.tasks.workerOpen(main,{operationId:'synthetic-open',text:'Read the synthetic file',authority:{sourceRequestId:source.input.requestId,description:'Synthetic authorized request'}});
  const run=f.app.tasks.claim(opened.runId)!;
  f.app.tasks.bind(run.id,run.epoch,'synthetic-worker-thread','synthetic-worker-turn');
  f.app.tasks.endSegment(run.id,run.epoch,{status:'completed',text:'Original Worker answer'},true);
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
test('unknown/no-final process keeps the exact explicit message and both authorized files reachable',async()=>{
 const f=syntheticHost();try{
  await f.app.start();const thread=f.app.store.meta('mainThread')!;
  f.app.inputs.accept({requestId:'synthetic-fast-origin',text:'合成方案与配套草稿'});const input=f.app.inputs.claim()!;
  f.app.store.transaction(()=>{f.app.processes.start({id:'synthetic-fast-node',threadId:thread,sourceKind:'user',sourceMessageIds:[input.messageId],messageId:'synthetic-fast-node',replyMessageId:input.replyId},'synthetic-fast-turn');f.app.history.record('synthetic-fast-node',thread,'','running');f.app.inputs.startedInTransaction(input.messageId,input.revision,'synthetic-fast-generation','synthetic-fast-turn');});
  const text='合成原答复，两个文件关系完整。',sent=commitSyntheticMessage(f.app,thread,text,[{filename:'synthetic-plan.md',content:'# Plan'},{filename:'synthetic-draft.md',content:'# Draft'}],input.input.requestId);
  assert.equal(sent.messageId,input.replyId);
  f.app.processes.finish('synthetic-fast-node','unknown');f.app.inputs.uncertain(input.messageId,input.revision);
  const bridge=homerWebBridge(f.app),state=await bridge.state();
  const process=state.messages.find(message=>message.id==='synthetic-fast-node')?.process;
  assert.equal(process?.status,'unknown');assert.equal(process?.final,undefined);
  assert.equal(state.messages.find(message=>message.id===sent.messageId)?.text,text);
  assert.deepEqual(state.artifacts?.filter(file=>file.messageId===sent.messageId).map(({assetId,revision})=>({assetId,revision})),sent.attachments);
  assert.equal((await bridge.media!.origin!({messageId:sent.messageId,...sent.attachments[0]!})).message.id,sent.messageId);
  assert.equal(state.queue?.length,0);assert.equal(state.messages.filter(message=>message.role==='user').length,1);
 }finally{await f.close();}
});
