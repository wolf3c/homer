// Actual host queue and dynamic tools; no model, credentials or external channel.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,until} from './fixtures/worker-chat-host.js';

function notifications(overlap=false){
 const f=fixture(),observed:{messageId:string;taskId:string;kind:string;outcome:string|null;text:string}[]=[],errors:string[]=[];
 let rootId='',publishedId='';
 f.setScript(async(main,text)=>{
  try{
   if(text==='synthetic:start'){
    rootId=(await main.call('task_create',{goal:'Synthetic ordinary Worker task'})).taskId;
    await main.call('worker_open',{taskId:rootId,message:'Inspect the original synthetic input'});
    if(overlap){publishedId=(await main.call('task_create',{goal:'Separate formally published task'})).taskId;await main.call('worker_open',{taskId:publishedId,message:'Inspect separate input'});}
    const reply={itemId:'initial-final',phase:'final_answer' as const,text:'Synthetic host reply'};
    main.emit('agentMessage',{threadId:main.threadId,turnId:main.turnId,...reply,completed:true});
    return {status:'completed',text:reply.text,messages:[reply]};
   }
   const notice=JSON.parse(text.split('\n')[1]!);
   assert.equal(notice.kind,'worker_reply');
   const facts=await main.call('work_inspect',{taskId:notice.taskId}),read=await main.call('worker_read',{workerId:notice.workerId,messageId:notice.messageId}),original=read.messages[0];
   observed.push({messageId:notice.messageId,taskId:notice.taskId,kind:notice.kind,outcome:facts.task.outcome,text:original.text});
   const outcome=original.payload.execution.status==='failed'?'failed':'succeeded';
   if(notice.taskId===publishedId){
    const result=await main.call('accept_result',{runId:notice.runId,messageId:notice.messageId});
    await main.call('publish_delivery',{taskId:notice.taskId,resultIds:[result.resultId],text:original.text});
   }
   await main.call('task_update',{taskId:notice.taskId,action:'settle',outcome});
   return {status:'completed',text:''};
  }catch(error){errors.push(String(error));throw error;}
 });
 const worker=(taskId:string)=>f.engines.find(engine=>engine.options.role==='worker'&&f.app.tasks.runs(taskId).some(run=>run.threadId===engine.threadId))!;
 return {...f,get rootId(){return rootId;},get publishedId(){return publishedId;},worker,observed,errors};
}

for(const outcome of ['failed','succeeded'] as const)test('ordinary Worker '+outcome+' original reaches Main without automatic publication or extra confirmation turn',async()=>{
 const f=notifications();try{
  await f.app.start();await f.app.message('synthetic:start','synthetic-source');await until(()=>!!f.worker(f.rootId)?.finish);
  const before=f.inputs.length;
  const publicBefore=f.app.conversationState().messages.filter(message=>message.role==='assistant'&&message.text.trim()).map(message=>({id:message.id,text:message.text}));
  assert.equal(publicBefore.length,1);assert.equal(publicBefore[0]!.text,'Synthetic host reply');
  f.worker(f.rootId).finish!({status:outcome==='failed'?'failed':'completed',text:'Synthetic result',...(outcome==='failed'?{errorCode:'synthetic_failure'}:{})});
  await f.app.idle();assert.deepEqual(f.errors,[]);
  assert.deepEqual(f.observed.map(({taskId,kind,outcome:prior,text})=>({taskId,kind,outcome:prior,text})),[{taskId:f.rootId,kind:'worker_reply',outcome:null,text:'Synthetic result'}]);
  assert.equal(f.app.tasks.task(f.rootId).outcome,outcome);assert.equal(f.inputs.length,before+1);
  assert.equal(f.events.filter(message=>message.type==='delivery').length,0);
  assert.equal(f.app.tasks.readTask({agentId:f.app.store.meta('mainAgentId')!},f.rootId).results.length,0);
  assert.deepEqual(f.app.conversationState().messages.filter(message=>message.role==='assistant'&&message.text.trim()).map(message=>({id:message.id,text:message.text})),publicBefore,'ordinary internal completion adds no user-facing confirmation');
 }finally{await f.close();}
});

test('a separate explicit publication cannot consume another Worker original or duplicate its process output',async()=>{
 const f=notifications(true);try{
  await f.app.start();await f.app.message('synthetic:start','synthetic-source');await until(()=>!!f.worker(f.rootId)?.finish&&!!f.worker(f.publishedId)?.finish);
  f.worker(f.publishedId).finish!({status:'failed',text:'Separate failure report',errorCode:'synthetic_separate_failure'});
  f.worker(f.rootId).finish!({status:'failed',text:'Synthetic failed result',errorCode:'synthetic_overlap_failure'});
  await f.app.idle();assert.deepEqual(f.errors,[]);
  assert.equal(f.events.filter(message=>message.type==='delivery').length,1);
  const delivery=f.app.tasks.deliveries()[0]!,owner=f.app.processes.list(f.app.store.meta('mainThread')!).find(node=>node.deliveryMessageIds?.includes(delivery.historyMessageId))!;
  assert.ok(owner);assert.equal(owner.final,undefined);assert.equal(f.app.processes.coordination(owner.id),undefined);
  const ordinary=f.observed.find(message=>message.taskId===f.rootId)!;assert.equal(ordinary.outcome,null);assert.equal(ordinary.text,'Synthetic failed result');
  assert.equal(owner.sourceMessageIds.includes(ordinary.messageId),false);
  for(const message of f.observed)assert.equal(f.app.store.db.prepare('SELECT state FROM agent_receipts WHERE messageId=?').get(message.messageId)!.state,'processed');
  assert.equal(f.inputs.filter(text=>text.startsWith('[内部协作输入')).length,2);
 }finally{await f.close();}
});
