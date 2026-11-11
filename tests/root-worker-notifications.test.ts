import {readTestConversation} from './fixtures/read-test-conversation.js';
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
    rootId=(await main.call('worker_open',{message:'Inspect the original synthetic input'})).taskId;
    if(overlap)publishedId=(await main.call('worker_open',{message:'Inspect separate input'})).taskId;
    const reply={itemId:'initial-final',phase:'final_answer' as const,text:'Synthetic host reply'};
    main.emit('agentMessage',{threadId:main.threadId,turnId:main.turnId,...reply,completed:true});
    return {status:'completed',text:reply.text,messages:[reply]};
   }
   const notice=JSON.parse(text.split('\n')[1]!);
   assert.equal(notice.kind,'worker_reply');
   const facts=await main.call('work_inspect',{taskId:notice.taskId}),read=await main.call('worker_read',{workerId:notice.workerId,messageId:notice.messageId}),original=read.messages[0];
   observed.push({messageId:notice.messageId,taskId:notice.taskId,kind:notice.kind,outcome:facts.task.outcome,text:original.text});
   const outcome=original.payload.execution.status==='failed'?'failed':'succeeded';
   if(notice.taskId===publishedId)await main.call('send_user_message',{taskId:notice.taskId,text:original.text});
   await main.call('task_update',{taskId:notice.taskId,action:'settle',outcome});
   return {status:'completed',text:''};
  }catch(error){errors.push(String(error));throw error;}
 });
 const worker=(taskId:string)=>f.engines.find(engine=>engine.options.role==='worker'&&f.app.tasks.runs(taskId).some(run=>run.threadId===engine.threadId))!;
 return {...f,get rootId(){return rootId;},get publishedId(){return publishedId;},worker,observed,errors};
}

for(const outcome of ['failed','succeeded'] as const)test('ordinary Worker '+outcome+' original reaches Main without an unsolicited user message or extra confirmation turn',async()=>{
 const f=notifications();try{
  await f.app.start();await f.app.message('synthetic:start','synthetic-source');await until(()=>!!f.worker(f.rootId)?.finish);
  const before=f.inputs.length;
  const publicBefore=readTestConversation(f.app).messages.filter(message=>message.role==='assistant'&&message.text.trim()).map(message=>({id:message.id,text:message.text}));
  assert.equal(publicBefore.length,1);assert.equal(publicBefore[0]!.text,'Synthetic host reply');
  f.worker(f.rootId).finish!({status:outcome==='failed'?'failed':'completed',text:'Synthetic result',...(outcome==='failed'?{errorCode:'synthetic_failure'}:{})});
  await f.app.idle();assert.deepEqual(f.errors,[]);
  assert.deepEqual(f.observed.map(({taskId,kind,outcome:prior,text})=>({taskId,kind,outcome:prior,text})),[{taskId:f.rootId,kind:'worker_reply',outcome:null,text:'Synthetic result'}]);
  assert.equal(f.app.tasks.task(f.rootId).outcome,outcome);assert.equal(f.inputs.length,before+1);
  assert.equal(f.events.filter(message=>message.type==='reply'&&message.messageId!==undefined).length,0);
  assert.equal(f.app.store.db.prepare("SELECT count(*) n FROM operations WHERE kind='send_user_message'").get()!.n,0);
  assert.deepEqual(readTestConversation(f.app).messages.filter(message=>message.role==='assistant'&&message.text.trim()).map(message=>({id:message.id,text:message.text})),publicBefore,'ordinary internal completion adds no user-facing confirmation');
 }finally{await f.close();}
});

test('a separate explicit user message cannot consume another Worker original or duplicate its process output',async()=>{
 const f=notifications(true);try{
  await f.app.start();await f.app.message('synthetic:start','synthetic-source');await until(()=>!!f.worker(f.rootId)?.finish&&!!f.worker(f.publishedId)?.finish);
  f.worker(f.publishedId).finish!({status:'failed',text:'Separate failure report',errorCode:'synthetic_separate_failure'});
  f.worker(f.rootId).finish!({status:'failed',text:'Synthetic failed result',errorCode:'synthetic_overlap_failure'});
  await f.app.idle();assert.deepEqual(f.errors,[]);
  assert.equal(f.events.filter(message=>message.type==='reply'&&message.messageId!==undefined).length,1);
  const sent=f.events.find(message=>message.type==='reply'&&message.messageId!==undefined)!;
  const message=f.app.history.message(sent.messageId!)!;
  assert.equal(message.taskId,f.publishedId);assert.equal(message.requestId,null);
  const operation=f.app.tasks.operation(message.operationKey!);
  const ordinary=f.observed.find(message=>message.taskId===f.rootId)!;
  assert.equal(ordinary.outcome,null);assert.equal(ordinary.text,'Synthetic failed result');
  assert.notEqual(JSON.parse(operation.detailsJson).inputMessageId,ordinary.messageId);
  assert.equal(readTestConversation(f.app).messages.filter(m=>m.text==='Separate failure report').length,1);
  for(const message of f.observed)assert.equal(f.app.store.db.prepare('SELECT state FROM agent_receipts WHERE messageId=?').get(message.messageId)!.state,'processed');
  assert.equal(f.inputs.filter(text=>text.startsWith('[内部协作输入')).length,2);
 }finally{await f.close();}
});
