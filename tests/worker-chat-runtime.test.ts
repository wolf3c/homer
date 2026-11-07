// Real Homer and SQLite, scripted engine boundary, isolated runtime only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fixture,until} from './fixtures/worker-chat-host.js';

test('two Worker conversations return complete original text automatically without settling the task',async()=>{
  const f=fixture();let taskId='';
  try{
    f.setScript(async(main,text)=>{
      if(text==='start'){
        taskId=(await main.call('worker_open',{message:'Read A.'})).taskId;
        await main.call('worker_open',{taskId,message:'Read B.'});
      }
      return {status:'completed',text:text==='start'?'Started.':'',messages:[]};
    });
    await f.app.start();await f.app.message('start','user-start');
    await until(()=>f.engines.filter(engine=>engine.options.role==='worker'&&engine.finish).length===2);
    const workers=f.engines.filter(engine=>engine.options.role==='worker');
    const rounds=f.inputs.length;
    workers[0]!.emit('agentMessage',{threadId:workers[0]!.threadId,turnId:workers[0]!.turnId,itemId:'progress',phase:'commentary',text:'Checking.',completed:true});
    await new Promise(resolve=>setTimeout(resolve,20));assert.equal(f.inputs.length,rounds);
    const raw='  First paragraph.\n\n[file](/synthetic/report.md)\nLast line.  ';
    for(const [index,worker]of workers.entries())worker.finish!({status:'completed',text:'wrong aggregate',messages:[{itemId:'answer-'+index,phase:'final_answer',text:raw}]});
    await f.app.idle();
    assert.equal(f.inputs.filter(text=>text.includes(raw)).length,2);
    assert.equal(f.app.tasks.task(taskId).state,'open');
    assert.equal(f.app.store.db.prepare("SELECT 1 FROM sqlite_master WHERE name='results'").get(),undefined);
    assert.equal(f.app.store.db.prepare("SELECT count(*) n FROM agent_receipts r JOIN agent_messages m ON m.id=r.messageId WHERE m.kind='worker_reply' AND r.state='processed'").get()!.n,2);
  }finally{await f.close();}
});

test('an idle conversation follow-up resumes its exact native thread in a new Run',async()=>{
  const f=fixture();let workerId='',followed=false;
  try{
    f.setScript(async(main,text)=>{
      if(text==='start'){
        workerId=(await main.call('worker_open',{message:'Read A.'})).workerId;
      }else if(!followed){followed=true;await main.call('worker_send',{workerId,message:'Explain the observation.'});}
      return {status:'completed',text:text==='start'?'Started.':'',messages:[]};
    });
    await f.app.start();await f.app.message('start','user-followup');
    await until(()=>f.engines.some(engine=>engine.options.role==='worker'&&engine.finish));
    const first=f.engines.find(engine=>engine.options.role==='worker')!;
    first.finish!({status:'completed',text:'First answer',messages:[{itemId:'first',phase:'final_answer',text:'First answer'}]});
    await until(()=>f.engines.filter(engine=>engine.options.role==='worker').length===2&&!!f.engines.filter(engine=>engine.options.role==='worker')[1]?.finish);
    const second=f.engines.filter(engine=>engine.options.role==='worker')[1]!;
    assert.equal(second.options.threadId,first.threadId);
    const runs=f.app.tasks.runs(undefined,workerId);assert.equal(runs.length,2);assert.equal(runs[1]!.workerId,workerId);
    second.finish!({status:'completed',text:'Second answer',messages:[{itemId:'second',phase:'final_answer',text:'Second answer'}]});
    await f.app.idle();
  }finally{await f.close();}
});

test('busy ordinary messages wait for confirmed exit and preserve their order in one resumed turn',async()=>{
  const f=fixture();let workerId='';
  try{
    f.setScript(async(main,text)=>{
      if(text==='start'){
        workerId=(await main.call('worker_open',{message:'First'})).workerId;
      }else if(text==='queue'){
        for(const message of ['Second','Third'])assert.equal((await main.call('worker_send',{workerId,message})).runId,null);
      }
      return {status:'completed',text:'Recorded',messages:[]};
    });
    await f.app.start();await f.app.message('start','ordered-start');
    await until(()=>f.engines.some(engine=>engine.options.role==='worker'&&engine.finish));
    const first=f.engines.find(engine=>engine.options.role==='worker')!;
    await f.app.message('queue','ordered-queue');
    assert.equal(f.engines.filter(engine=>engine.options.role==='worker').length,1);
    first.finish!({status:'completed',text:'First answer',messages:[{itemId:'first',phase:'final_answer',text:'First answer'}]});
    await until(()=>f.engines.filter(engine=>engine.options.role==='worker').length===2);
    const second=f.engines.filter(engine=>engine.options.role==='worker')[1]!;
    await until(()=>!!second.finish);
    const runs=f.app.tasks.runs(undefined,workerId);assert.equal(runs.length,2);assert.equal(runs[1]!.prompt,'Second\n\nThird');
    assert.equal(second.options.threadId,first.threadId);
    second.finish!({status:'completed',text:'Done',messages:[{itemId:'done',phase:'final_answer',text:'Done'}]});
    await f.app.idle();
  }finally{await f.close();}
});

test('a changed goal stops every old executor and rejects queued old-version messages',async()=>{
  const f=fixture();let taskId='',workers:string[]=[];
  try{
    f.setScript(async(main,text)=>{
      if(text==='start'){
        const first=await main.call('worker_open',{message:'Original synthetic scope: A'});
        taskId=first.taskId;workers.push(first.workerId);
        workers.push((await main.call('worker_open',{taskId,message:'B'})).workerId);
      }else if(text==='change'){
        await main.call('worker_send',{workerId:workers[0],message:'Old queued action'});
        const changed=await main.call('task_update',{taskId,goal:'Revised synthetic scope'});
        assert.equal(changed.state,'confirmed');
      }
      return {status:'completed',text:'Recorded',messages:[]};
    });
    await f.app.start();await f.app.message('start','scope-start');
    await until(()=>f.engines.filter(engine=>engine.options.role==='worker'&&engine.finish).length===2);
    await f.app.message('change','scope-change');await f.app.idle();
    const task=f.app.tasks.task(taskId);assert.equal(task.headVersion,2);assert.equal(task.state,'open');assert.equal(task.controlState,'normal');
    const runs=f.app.tasks.runs(taskId);assert.equal(runs.length,2);
    for(const run of runs){assert.equal(run.version,1);assert.equal(run.status,'cancelled');assert.equal(run.phase,'ended');}
    assert.equal(f.app.store.db.prepare("SELECT count(*) n FROM agent_receipts r JOIN agent_messages m ON m.id=r.messageId WHERE m.kind='worker_input' AND r.state IN ('pending','offered','received')").get()!.n,0);
  }finally{await f.close();}
});

test('goal edits keep prior user sources until a settled resume supplies replacement authority',async()=>{
 const f=fixture();let taskId='';
 const original='Inspect A without writing outside the project.';
 const expanded='Also inspect B and keep the writing restriction.';
 const revised='While paused, inspect C instead of B and keep the writing restriction.';
 try{
  f.setScript(async(main,text)=>{
   if(text===original)taskId=(await main.call('worker_open',{message:original})).taskId;
   else if(text===expanded||text===revised)await main.call('task_update',{taskId,goal:text});
   else if(text==='Pause')await main.call('task_update',{taskId,action:'pause'});
   else if(text==='Try resuming, otherwise cancel'){
    await assert.rejects(main.call('task_update',{taskId,action:'resume'}),/task_authority_source_denied/);
    await main.call('task_update',{taskId,action:'cancel'});
   }else if(text==='Authorize a new inspection of C')await main.call('task_update',{taskId,action:'resume',goal:text});
   return {status:'completed',text:'Recorded'};
  });
  await f.app.start();await f.app.message(original,'original-authority');
  await until(()=>f.engines.some(engine=>engine.options.role==='worker'&&engine.finish));
  await f.app.message(expanded,'expanded-authority');
  await f.app.message('Pause','pause-request');
  await f.app.message(revised,'paused-authority');
  assert.equal(f.app.tasks.task(taskId).state,'paused');
  const authority=f.app.tasks.authority(taskId,3);
  assert.equal(authority.sourceRequestId,'paused-authority');
  assert.deepEqual(new Set([authority.sourceRequestId,...(authority.sourceRequestIds??[])]),new Set(['original-authority','expanded-authority','paused-authority']));
  assert.ok(authority.description.endsWith(revised));
  assert.equal(f.app.tasks.version(taskId,3).goal,revised);
  const thread=f.app.store.meta('mainThread')!,source=f.app.history.inputs(thread,['original-authority']).get('original-authority')!;
  assert.equal(f.app.history.revokeMessage(thread,source.id),true);
  await f.app.message('Try resuming, otherwise cancel','failed-resume');
  assert.equal(f.app.tasks.task(taskId).outcome,'cancelled');
  await f.app.message('Authorize a new inspection of C','renewed-authority');
  const task=f.app.tasks.task(taskId),renewed=f.app.tasks.authority(taskId,4);
  assert.equal(task.state,'open');assert.equal(task.headVersion,4);
  assert.equal(renewed.sourceRequestId,'renewed-authority');
  assert.deepEqual(renewed.sourceRequestIds??[],[]);
  assert.equal(f.app.tasks.runs(taskId).length,1);
 }finally{await f.close();}
});

for(const kind of ['worker_reply','interaction_required'] as const)for(const control of ['change','pause','cancel'] as const)test(`stale ${kind} after ${control} cannot recreate withdrawn scope through default or explicit sources`,async()=>{
  const f=fixture();let taskId='',handled=false,checked=false,readText='',question:Promise<unknown>|undefined;
  const attempts:{status:string;error?:string;before:number[];after:number[]}[]=[],raw='  Original scope observation.\n\nThe date is unknown.  ';
  const counts=()=>['tasks','runs','task_versions','operations'].map(table=>Number(f.app.store.db.prepare('SELECT count(*) n FROM '+table).get()!.n));
  try{
    f.setScript(async(main,text)=>{
      if(text==='start'){
        taskId=(await main.call('worker_open',{message:'Investigate original scope'})).taskId;
      }else if(text==='revoke'){
        const worker=f.engines.find(engine=>engine.options.role==='worker')!;
        worker.emit('agentMessage',{threadId:worker.threadId,turnId:worker.turnId,itemId:'old-observation',phase:'final_answer',text:raw,completed:true});
        if(kind==='interaction_required'){question=worker.call('ask_main',{question:'Continue the original scope?'});void question.catch(()=>{});await until(()=>f.app.interactions.list().length===1);}
        await main.call('task_update',control==='change'?{taskId,goal:'Only inspect the newly restricted synthetic scope'}:{taskId,action:control});
      }else if(!handled&&text.includes('"kind":"'+kind+'"')){
        handled=true;
        const worker=f.app.tasks.workers(taskId)[0]!,view=await main.call('worker_read',{workerId:worker.workerId});
        readText=view.messages.find((message:any)=>message.kind==='worker_reply')?.text;
        for(const explicit of [false,true]){
          const before=counts(),[attempt]=await Promise.allSettled([main.call('worker_open',{message:'Resume the withdrawn original synthetic scope',...(explicit?{sourceRequestIds:['withdrawn-source']}:{})})]);
          const after=counts();attempts.push({status:attempt!.status,...(attempt!.status==='rejected'?{error:attempt!.reason.message}:{}),before,after});
        }
        checked=true;
      }
      return {status:'completed',text:'Recorded'};
    });
    await f.app.start();await f.app.message('start','withdrawn-source');await until(()=>f.engines.some(engine=>engine.options.role==='worker'&&engine.finish));
    await f.app.message('revoke','revoke-source');await until(()=>checked);
    assert.deepEqual(attempts.map(attempt=>attempt.status),['rejected','rejected']);
    for(const [index,attempt] of attempts.entries()){assert.equal(attempt.error,index===0?'task_authority_source_denied':'invalid_tool_arguments');assert.deepEqual(attempt.after,attempt.before);}
    assert.equal(readText,raw);assert.equal(f.app.tasks.tasks().length,1);assert.equal(f.app.store.runs().length,1);
    if(kind==='interaction_required'){assert.equal(f.app.interactions.list()[0]!.state,'cancelled');await question;}
    const task=f.app.tasks.task(taskId);assert.equal(task.headVersion,control==='change'?2:1);assert.equal(task.state,control==='pause'?'paused':control==='cancel'?'settled':'open');
    await f.app.idle();
  }finally{await f.close();}
});

for(const kind of ['worker_reply','interaction_required'] as const)test(`a current live ${kind} can create follow-up sessions within the original scope`,async()=>{
  const f=fixture();let handled=false,checked=false;
  try{
    f.setScript(async(main,text)=>{
      if(text==='start'){
        await main.call('worker_open',{message:'Investigate original authorized scope'});
      }else if(!handled&&text.includes('"kind":"'+kind+'"')){
        handled=true;
        for(const message of ['Inspect remaining authorized fact A','Inspect remaining authorized fact B'])
          await main.call('worker_open',{message});
        if(kind==='interaction_required'){
          const request=f.app.interactions.list()[0]!;await main.call('inspect_interaction',{interactionId:request.id});
          await main.call('respond_interaction',{interactionId:request.id,action:'answer',answer:'Continue within the original scope',reason:'Original source remains current'});
        }
        checked=true;
      }
      return {status:'completed',text:'Recorded'};
    });
    await f.app.start();await f.app.message('start','live-source');await until(()=>f.engines.some(engine=>engine.options.role==='worker'&&engine.finish));
    const original=f.engines.find(engine=>engine.options.role==='worker')!;
    const question=kind==='interaction_required'?original.call('ask_main',{question:'Continue the current authorized scope?'}):undefined;
    if(kind==='worker_reply')original.finish!({status:'completed',text:'Original current observation'});
    await until(()=>checked&&f.engines.filter(engine=>engine.options.role==='worker'&&engine.finish).length===(kind==='worker_reply'?2:3));
    if(question)await question;
    for(const worker of f.engines.filter(engine=>engine.options.role==='worker'))if(worker!==original||question)worker.finish!({status:'completed',text:'Authorized observation'});
    await f.app.idle();assert.equal(f.app.tasks.tasks().length,3);assert.equal(f.app.store.runs().length,3);
    for(const task of f.app.tasks.tasks())assert.equal(f.app.tasks.authority(task.id,1).sourceRequestId,'live-source');
  }finally{await f.close();}
});

test('a later real user can reopen failed work and delegate only selected attachment bytes',async()=>{
  const f=fixture();let taskId='',followupId='',settled=false;
  try{
    const binding=()=> 'web:'+f.app.store.meta('mainThread');
    let originalRef:{assetId:string;revision:number},laterRef:{assetId:string;revision:number};
    f.setScript(async(main,text)=>{
      if(text.startsWith('start')){
        taskId=(await main.call('worker_open',{message:'Inspect original source',attachments:[originalRef]})).taskId;
      }else if(!settled&&text.includes('"kind":"worker_reply"')){
        await main.call('task_update',{taskId,action:'settle',outcome:'failed'});
        await assert.rejects(main.call('worker_open',{message:'Continue the failed task'}),/task_authority_source_denied/);
        settled=true;
      }else if(text.startsWith('continue')){
        const revised=await main.call('task_update',{taskId,action:'resume',goal:'Use the later assigned source'});
        assert.equal(revised.version,2);assert.equal(f.app.tasks.runs(taskId).length,1);
        followupId=(await main.call('worker_open',{taskId,message:'Use the later attachment only',attachments:[laterRef]})).workerId;
      }
      return {status:'completed',text:'Recorded'};
    });
    await f.app.start();
    originalRef=f.app.media.intent('original-primary',binding(),'file');
    f.app.media.ready(originalRef,f.app.media.claim(originalRef)!,Buffer.from('Original bytes'),'text/plain');
    f.app.submitMessage({requestId:'original-primary',text:'start',attachments:[originalRef]});
    await until(()=>f.engines.some(engine=>engine.options.role==='worker'&&engine.finish));
    const original=f.engines.find(engine=>engine.options.role==='worker')!;
    original.finish!({status:'failed',text:'Original inspection failed',errorCode:'synthetic_failure'});
    await until(()=>settled);await f.app.idle();
    laterRef=f.app.media.intent('later-primary',binding(),'file');
    f.app.media.ready(laterRef,f.app.media.claim(laterRef)!,Buffer.from('Later bytes'),'text/plain');
    f.app.submitMessage({requestId:'later-primary',text:'continue',attachments:[laterRef]});
    await until(()=>!!followupId&&f.engines.some(engine=>engine.options.role==='worker'&&engine!==original&&engine.finish));
    const worker=f.engines.find(engine=>engine.options.role==='worker'&&engine!==original)!;
    assert.equal(f.app.tasks.authority(taskId,2).sourceRequestId,'later-primary');
    assert.equal((await worker.call('stage_file_result',{filename:'later.txt',...laterRef})).bytes,Buffer.byteLength('Later bytes'));
    await assert.rejects(worker.call('stage_file_result',{filename:'original.txt',...originalRef}),/media_scope_denied/);
    assert.equal(f.app.tasks.task(taskId).state,'open');assert.equal(f.app.tasks.tasks().length,1);
    worker.finish!({status:'completed',text:'Follow-up checked'});await f.app.idle();
  }finally{await f.close();}
});

test('background Worker replies cannot delegate another user source’s attachment',async()=>{
 const f=fixture();let assigned:{assetId:string;revision:number},foreign:{assetId:string;revision:number},checked=false;
 try{
  f.setScript(async(main,text)=>{
   if(text.startsWith('start'))await main.call('worker_open',{message:'Use the assigned file',attachments:[assigned]});
   else if(text.includes('"kind":"worker_reply"')){
    const before=f.app.tasks.tasks().length;
    await assert.rejects(main.call('worker_open',{message:'Borrow unrelated evidence',attachments:[foreign]}),/media_scope_denied/);
    assert.equal(f.app.tasks.tasks().length,before);checked=true;
   }
   return {status:'completed',text:'Recorded'};
  });
  await f.app.start();
  const binding='web:'+f.app.store.meta('mainThread');
  foreign=f.app.media.intent('foreign',binding,'file');
  f.app.media.ready(foreign,f.app.media.claim(foreign)!,Buffer.from('Unrelated bytes'),'text/plain');
  f.app.submitMessage({requestId:'foreign',text:'Record foreign evidence',attachments:[foreign]});
  await f.app.idle();
  assigned=f.app.media.intent('assigned',binding,'file');
  f.app.media.ready(assigned,f.app.media.claim(assigned)!,Buffer.from('Assigned bytes'),'text/plain');
  f.app.submitMessage({requestId:'assigned',text:'start',attachments:[assigned]});
  await until(()=>f.engines.some(engine=>engine.options.role==='worker'&&engine.finish));
  const worker=f.engines.find(engine=>engine.options.role==='worker')!;
  assert.equal((await worker.call('stage_file_result',{filename:'assigned.txt',...assigned})).bytes,Buffer.byteLength('Assigned bytes'));
  await assert.rejects(worker.call('stage_file_result',{filename:'foreign.txt',...foreign}),/media_scope_denied/);
  worker.finish!({status:'completed',text:'Checked assigned evidence'});
  await f.app.idle();assert.equal(checked,true);
 }finally{await f.close();}
});

test('a restored input exposes its committed open and cannot duplicate it with a new native call',async()=>{
  const f=fixture();let taskId='',originalWorker='',lost=false,recovered=false;
  try{
    f.setScript(async(main,text)=>{
      if(text==='start'){
        taskId=(await main.call('worker_open',{message:'Recover an original action'})).taskId;
      }else if(!lost){
        lost=true;originalWorker=(await main.call('worker_open',{taskId,message:'Inspect the returned fact'},'committed-open')).workerId;
        throw Error('synthetic_response_lost');
      }else if(text.includes(originalWorker)&&text.includes('\"kind\":\"worker_open\"')){
        recovered=true;
        const view=await main.call('work_inspect',{taskId});
        assert.equal(view.workers.filter((worker:any)=>worker.workerId===originalWorker).length,1);
        await assert.rejects(main.call('worker_open',{taskId,message:'Inspect the returned fact'},'new-after-restart'),/coordination_action_already_committed/);
      }
      return {status:'completed',text:text==='start'?'Started':'',messages:[]};
    });
    await f.app.start();await f.app.message('start','recovery-start');
    await until(()=>f.engines.some(engine=>engine.options.role==='worker'&&engine.finish));
    const first=f.engines.find(engine=>engine.options.role==='worker')!;
    first.finish!({status:'completed',text:'Original answer',messages:[{itemId:'original',phase:'final_answer',text:'Original answer'}]});
    await until(()=>lost&&f.app.store.db.prepare("SELECT 1 FROM agent_receipts r JOIN agent_messages m ON m.id=r.messageId WHERE m.kind='worker_reply' AND r.state='uncertain'").get()!==undefined);
    const before=f.app.tasks.workers(taskId).length;
    await f.restart();await until(()=>recovered);
    assert.equal(f.app.tasks.workers(taskId).length,before);await f.app.idle();
    assert.ok(f.inputs.some(text=>text.includes(originalWorker)&&text.includes('worker_open')&&text.includes('operations')));
  }finally{await f.close();}
});

test('a restored Worker input cannot repeat a committed immediate message',async()=>{
 const f=fixture();let workerId='',steers=0,attempted=false,recovered=false;
 try{
  f.setScript(async(main,text)=>{
   if(text==='start'){
    const first=await main.call('worker_open',{message:'Collect the finding'});
    workerId=(await main.call('worker_open',{taskId:first.taskId,message:'Wait for the finding'})).workerId;
   }else if(text.includes('Exact synthetic finding')){
    const args={workerId,message:'Incorporate this exact finding',immediate:true};
    if(!attempted){
     attempted=true;
     assert.equal((await main.call('worker_send',args,'committed-immediate')).state,'received');
     throw Error('synthetic_response_lost');
    }
    await assert.rejects(main.call('worker_send',args,'new-native-call'),/coordination_action_already_committed/);
    recovered=true;
   }
   return {status:'completed',text:text==='start'?'Started':'',messages:[]};
  });
  await f.app.start();await f.app.message('start','recovery-start');
  await until(()=>f.engines.filter(engine=>engine.options.role==='worker'&&engine.finish).length===2);
  const [producer,receiver]=f.engines.filter(engine=>engine.options.role==='worker');
  receiver!.steer=async(turnId,message)=>{assert.equal(turnId,receiver!.turnId);assert.equal(message,'Incorporate this exact finding');steers++;return {turnId};};
  producer!.finish!({status:'completed',text:'Exact synthetic finding'});
  await until(()=>!!f.app.store.db.prepare("SELECT 1 FROM agent_receipts r JOIN agent_messages m ON m.id=r.messageId WHERE m.kind='worker_reply' AND r.state='uncertain'").get());
  assert.equal(steers,1);await f.restart();await until(()=>recovered);await f.app.idle();
  assert.equal(steers,1);assert.equal(f.app.store.db.prepare("SELECT count(*) n FROM operations WHERE kind='worker_steer'").get()!.n,1);
 }finally{await f.close();}
});

test('archival follow-up binds only the current notification original user source',async()=>{
  const f=fixture();let original='',followup='';
  try{
    f.setScript(async(main,text)=>{
      if(text==='prepare'){
        original=(await main.call('task_create',{goal:'Original completed goal'})).taskId;
        await main.call('task_update',{taskId:original,goal:'Original completed goal'});
        await main.call('task_update',{taskId:original,action:'settle',outcome:'succeeded'});
      }else if(text==='archive'){
        const receipt=await main.call('archive_work',{taskId:original});assert.equal(receipt.state,'archived');
      }else if(text.includes('task_archived')){
        await assert.rejects(main.call('task_create',{goal:'Forged source',sourceRequestIds:['unrelated-source']}),/invalid_tool_arguments/);
        const before=f.app.tasks.tasks().length;
        await assert.rejects(main.call('worker_open',{message:'Borrow unrelated source',sourceRequestIds:['unrelated-source']}),/invalid_tool_arguments/);
        assert.equal(f.app.tasks.tasks().length,before);
        followup=(await main.call('worker_open',{message:'Inspect authorized temporary resources'})).taskId;
        await assert.rejects(main.call('worker_open',{taskId:original,message:'Reopen original'}),/task_history_not_visible/);
      }
      return {status:'completed',text:text==='archive'?'Archived':text==='prepare'?'Prepared':'',messages:[]};
    });
    await f.app.start();await f.app.message('unrelated','unrelated-source');await f.app.message('prepare','prepare-source');
    await f.app.message('archive','archive-source');await until(()=>!!followup&&f.engines.some(engine=>engine.options.role==='worker'&&engine.finish));
    f.engines.find(engine=>engine.options.role==='worker')!.finish!({status:'completed',text:'Checked archive'});await f.app.idle();
    assert.ok(followup);assert.equal(f.app.tasks.task(original).historyState,'archived');assert.equal(f.app.tasks.task(original).state,'settled');
    assert.equal(f.app.tasks.authority(followup,1).sourceRequestId,'prepare-source');
    assert.equal(f.app.store.db.prepare("SELECT count(*) n FROM agent_messages WHERE kind='task_archived'").get()!.n,1);
  }finally{await f.close();}
});

for(const action of ['allow','deny','stop'] as const)test('archive command approval can '+action+' without blocking the next message',async()=>{
  const f=fixture();let taskId='',resolution='';
  try{
    f.setScript(async(main,text)=>{
      if(text==='prepare'){
        taskId=(await main.call('task_create',{goal:'Synthetic archived task'})).taskId;
        await main.call('task_update',{taskId,goal:'Synthetic archived task'});
        await main.call('task_update',{taskId,action:'settle',outcome:'succeeded'});
      }else if(text==='archive')await main.call('archive_work',{taskId});
      else if(text.includes('"kind":"task_archived"')){
        const reply=await Promise.resolve().then(()=>main.options.onInteraction!({requestId:1,method:'item/commandExecution/requestApproval',kind:'authorization',threadId:main.threadId,turnId:main.turnId!,itemId:'command',details:{command:'synthetic cleanup',availableDecisions:['accept','decline']}})).catch(error=>{resolution=error.message;throw error;});
        resolution=reply.status;
      }
      return {status:'completed',text:'Recorded'};
    });
    await f.app.start();await f.app.message('prepare','original-request');await f.app.message('archive','archive-request');
    await until(()=>f.app.interactions.list().some(item=>item.state==='pending_user')||!!resolution);
    const [card]=f.app.interactions.list();assert.ok(card,'archive command should open an approval card');
    assert.equal(f.app.interactions.inspect(card.id).authority.sourceRequestId,'original-request');
    const next=f.app.message('unrelated','later-request');
    if(action==='stop'){
      const stopId=f.app.conversationControlState().activeMessageId;assert.ok(stopId);
      await f.app.stopMain(stopId);
      assert.throws(()=>f.app.submitMessage({requestId:'late',interactionId:card.id,text:'允许本次操作'}),/interaction_not_live/);
    }else f.app.submitMessage({requestId:'decision',interactionId:card.id,text:action==='allow'?'允许本次操作':'拒绝本次操作'});
    assert.equal(await next,'Recorded');
    assert.equal(resolution,{allow:'approved',deny:'denied',stop:'cancelled'}[action]);
  }finally{await f.close();}
});

for(const action of ['approve','deny'] as const)test('a desktop Worker command waits for Homer to apply the user '+action+' decision',async()=>{
  const f=fixture();let seen='',mediated=false,resolved=false,wrongDecisionRejected=false;
  try{
    f.setScript(async(main,text)=>{
      if(text==='start'){
        await main.call('worker_open',{message:'Prepare a synthetic operation'});
      }else if(text.includes('"kind":"interaction_required"')){
        const id=JSON.parse(text.split('\n')[1]!).messageId;
        const notice=f.app.store.db.prepare('SELECT payloadJson FROM agent_messages WHERE id=?').get(id)!;
        seen=JSON.parse(String(notice.payloadJson)).interactionId;
        await main.call('inspect_interaction',{interactionId:seen});
        await assert.rejects(main.call('respond_interaction',{interactionId:seen,action:'approve',reason:'No user approval'}),/user.*required/);
        await main.call('escalate_interaction',{interactionId:seen,question:'Confirm the operation',reason:'Needs user authorization'});
      }else if(text.includes('[用户答复原待答]')){
        assert.equal(resolved,false);mediated=true;
        await main.call('inspect_interaction',{interactionId:seen});
        if(action==='deny'){
          await assert.rejects(main.call('respond_interaction',{interactionId:seen,action:'approve',reason:'Cannot turn a refusal into permission'}),/user.*required/);
          wrongDecisionRejected=true;
        }
        await main.call('respond_interaction',{interactionId:seen,action,reason:'Use the actual user decision'});
      }
      return {status:'completed',text:'Recorded'};
    });
    await f.app.start();await f.app.message('start','worker-source');
    await until(()=>f.engines.some(engine=>engine.options.role==='worker'&&engine.finish));
    const worker=f.engines.find(engine=>engine.options.role==='worker')!;
    const result=worker.options.onInteraction!({requestId:1,method:'item/commandExecution/requestApproval',kind:'authorization',threadId:worker.threadId,turnId:worker.turnId!,itemId:'command',details:{command:'synthetic operation',availableDecisions:['accept','decline']}}).then(value=>{resolved=true;return value;});
    await until(()=>f.app.interactions.list().some(item=>item.state==='pending_user'));
    const [card]=f.app.interactions.list();assert.equal(card?.id,seen,'Homer must inspect before a card is shown');
    assert.equal(await f.app.message('unrelated','other-user-message'),'Recorded');assert.equal(resolved,false);
    const runId=f.app.interactions.inspect(seen).runId;
    await assert.rejects(f.app.manageCapabilities({action:'state'},'agent',f.app['workers'].get(runId)),/run_phase_denied/);
    const input={requestId:'user-decision',interactionId:seen,text:action==='approve'?'允许本次操作':'拒绝本次操作'};
    assert.equal(f.app.submitMessage(input).fresh,true);
    assert.equal(f.app.submitMessage(input).fresh,false);
    assert.equal((await result).status,action==='approve'?'approved':'denied');assert.ok(mediated);
    if(action==='deny')assert.ok(wrongDecisionRejected);
    worker.emit('interactionDelivered',1);worker.finish!({status:'completed',text:'Refused',messages:[]});
    await f.app.idle();
    assert.equal(f.app.interactions.inspect(seen).responseUserMessageId,'user-decision');
  }finally{await f.close();}
});

test('a restored archive input cannot create another Task to duplicate an already opened Worker',async()=>{
  const f=fixture();let original='',followup='',workerId='',lost=false,recovered=false;
  try{
    f.setScript(async(main,text)=>{
      if(text==='prepare'){
        original=(await main.call('task_create',{goal:'Original completed goal'})).taskId;
        await main.call('task_update',{taskId:original,goal:'Original completed goal'});
        await main.call('task_update',{taskId:original,action:'settle',outcome:'succeeded'});
      }else if(text==='archive')await main.call('archive_work',{taskId:original});
      else if(text.includes('"kind":"task_archived"')){
        if(!lost){
          const opened=await main.call('worker_open',{message:'Inspect authorized temporary resources'},'committed-open');
          followup=opened.taskId;workerId=opened.workerId;
          lost=true;throw Error('synthetic_response_lost');
        }
        recovered=true;assert.ok(text.includes(followup)&&text.includes(workerId));
        await assert.rejects(main.call('worker_open',{message:'Inspect authorized temporary resources'},'replacement-open'),/coordination_action_already_committed/);
      }
      return {status:'completed',text:text==='prepare'?'Prepared':'',messages:[]};
    });
    await f.app.start();await f.app.message('prepare','archive-prepare');await f.app.message('archive','archive-request');
    await until(()=>lost&&f.app.store.db.prepare("SELECT 1 FROM agent_receipts r JOIN agent_messages m ON m.id=r.messageId WHERE m.kind='task_archived' AND r.state='uncertain'").get()!==undefined);
    await f.restart();await until(()=>recovered);await f.app.idle();
    assert.equal(f.app.tasks.tasks().length,2);assert.equal(f.app.tasks.workers(followup).length,1);
  }finally{await f.close();}
});

test('a mismatched resumed native thread cannot replace the durable Worker binding',async()=>{
  const f=fixture();let workerId='',followed=false;
  try{
    f.setScript(async(main,text)=>{
      if(text==='start'){
        workerId=(await main.call('worker_open',{message:'First'})).workerId;
      }else if(!followed){followed=true;await main.call('worker_send',{workerId,message:'Follow up'});}
      return {status:'completed',text:text==='start'?'Started':'',messages:[]};
    });
    await f.app.start();await f.app.message('start','exact-thread-source');
    await until(()=>f.engines.some(engine=>engine.options.role==='worker'&&engine.finish));
    const first=f.engines.find(engine=>engine.options.role==='worker')!,factory=f.app['factory']!;
    f.app['factory']=(options,handle)=>{const engine=factory(options,handle);if(options.role==='worker')engine.start=async()=>{engine.threadId='wrong-native-thread';return engine.threadId;};return engine;};
    first.finish!({status:'completed',text:'Answer',messages:[{itemId:'answer',phase:'final_answer',text:'Answer'}]});await f.app.idle();
    const runs=f.app.tasks.runs(undefined,workerId);assert.equal(runs.length,2);assert.equal(runs[1]!.threadId,first.threadId);assert.equal(runs[1]!.errorCode,'engine_resume_thread_mismatch');
    assert.equal(f.engines.filter(engine=>engine.options.role==='worker')[1]!.finish,undefined);
  }finally{await f.close();}
});

test('a Worker question wakes Main and returns the persisted answer to that exact caller',async()=>{
  const f=fixture();
  try{
    f.setScript(async(main,text)=>{
      if(text==='start'){
        await main.call('worker_open',{message:'Ask one question'});
      }else if(text.includes('interaction_required')){
        const request=f.app.interactions.list().find(item=>item.source==='ask_main')!;
        await main.call('inspect_interaction',{interactionId:request.id});
        await main.call('respond_interaction',{interactionId:request.id,action:'answer',answer:'Use A',reason:'Within the original synthetic goal'});
      }
      return {status:'completed',text:text==='start'?'Started':'',messages:[]};
    });
    await f.app.start();await f.app.message('start','question-source');
    await until(()=>f.engines.some(engine=>engine.options.role==='worker'&&engine.finish));
    const worker=f.engines.find(engine=>engine.options.role==='worker')!;
    const answer=await worker.call('ask_main',{question:'A or B?'});assert.equal(answer.answer,'Use A');
    assert.ok(f.app.interactions.list().find(item=>item.source==='ask_main')!.deliveredAt);
    worker.finish!({status:'completed',text:'Used A',messages:[{itemId:'answer',phase:'final_answer',text:'Used A'}]});await f.app.idle();
    assert.equal(f.app.store.db.prepare("SELECT r.state FROM agent_receipts r JOIN agent_messages m ON m.id=r.messageId WHERE m.kind='interaction_required'").get()!.state,'processed');
  }finally{await f.close();}
});

test('a committed staged attachment replays its native receipt after the source is revoked',async()=>{
  const f=fixture();let ref:{assetId:string;revision:number};
  try{
    f.setScript(async(main,text)=>{
      if(text.startsWith('start'))await main.call('worker_open',{message:'Stage the assigned source',attachments:[ref]});
      return {status:'completed',text:'Started'};
    });
    await f.app.start();
    const source='stage-replay-source';ref=f.app.media.intent(source,'web:'+f.app.store.meta('mainThread'),'file');
    f.app.media.ready(ref,f.app.media.claim(ref)!,Buffer.from('Synthetic staged bytes'),'text/plain');
    f.app.submitMessage({requestId:source,text:'start',attachments:[ref]});
    await until(()=>f.engines.some(engine=>engine.options.role==='worker'&&engine.finish));
    const worker=f.engines.find(engine=>engine.options.role==='worker')!,args={filename:'source.txt',...ref};
    await assert.rejects(worker.call('stage_file_result',{filename:'legacy.txt',dataBase64:'AQ=='},'legacy'),/invalid_tool_arguments/);
    await assert.rejects(worker.call('stage_file_result',{...args,operationId:'forged'},'forged'),/invalid_tool_arguments/);
    await assert.rejects(worker.call('write_markdown',{filename:'legacy.md',content:'old'},'legacy-write'),/worker_tool_denied/);
    const receipt=await worker.call('stage_file_result',args,'original-stage');
    f.app.media.revoke(source);
    assert.deepEqual(await worker.call('stage_file_result',args,'original-stage'),receipt);
    await assert.rejects(worker.call('stage_file_result',{...args,filename:'changed.txt'},'original-stage'),/operation_payload_conflict/);
    await assert.rejects(worker.call('stage_file_result',args,'new-stage'),/media_not_ready|media_scope_denied/);
    writeFileSync(receipt.path,'Changed staged bytes');
    await assert.rejects(worker.call('stage_file_result',args,'original-stage'),/result_hash_mismatch/);
    assert.equal(f.app.store.db.prepare("SELECT count(*) n FROM operations WHERE kind='write_file'").get()!.n,1);
    worker.finish!({status:'completed',text:'Staged',messages:[{itemId:'staged',phase:'final_answer',text:'Staged'}]});await f.app.idle();
  }finally{await f.close();}
});

test('selecting a broad working directory never authorizes host private files for user messages',async()=>{
  const f=fixture();let checked=false;
  try{
    const privatePath=join(f.app.config.runtime,'private-control.txt'),publicPath=join(f.app.config.workspace,'public-report.txt');
    writeFileSync(privatePath,'Synthetic private control');writeFileSync(publicPath,'Synthetic public report');
    f.setScript(async(main,text)=>{
      if(text==='read'){
        await main.call('task_create',{goal:'Read synthetic work',workingDirectory:'/'});
        await assert.rejects(main.call('send_user_message',{attachments:[{path:privatePath}]}),/artifact_path_denied/);
        const sent=await main.call('send_user_message',{attachments:[{path:publicPath}]}),view=await main.call('work_inspect',{messageId:sent.messageId});
        assert.equal(f.app.media.readAttachment(view.attachments[0]).bytes.toString(),'Synthetic public report');checked=true;
      }
      return {status:'completed',text:'Checked'};
    });
    await f.app.start();await f.app.message('read','file-boundary-source');assert.equal(checked,true);
    assert.deepEqual(f.app.store.db.prepare("SELECT state FROM operations WHERE kind='send_user_message' ORDER BY rowid").all().map(row=>row.state),['failed','confirmed']);
  }finally{await f.close();}
});

test('a dispatched Worker can read its exact attachment before the user turn ends',async()=>{
 const f=fixture();
 let ref:{assetId:string;revision:number},release!:()=>void;
 const mainEnd=new Promise<void>(resolve=>{release=resolve;});
 try{
  f.setScript(async(main,text)=>{
   if(text.startsWith('delegate')){
    await main.call('worker_open',{message:'Read the current input',attachments:[ref]});
    await mainEnd;
   }
   return {status:'completed',text:'Recorded'};
  });
  await f.app.start();
  const source='still-processing',thread=f.app.store.meta('mainThread')!;
  ref=f.app.media.intent(source,'web:'+thread,'file');
  f.app.media.ready(ref,f.app.media.claim(ref)!,Buffer.from('Current attachment'),'text/plain');
  f.app.submitMessage({requestId:source,text:'delegate',attachments:[ref]});
  await until(()=>f.engines.some(engine=>engine.options.role==='worker'&&engine.finish));
  const worker=f.engines.find(engine=>engine.options.role==='worker')!;
  assert.equal(f.app.history.inputs(thread,[source]).get(source)?.status,'processing');
  const receipt=await worker.call('stage_file_result',{filename:'input.txt',...ref});
  assert.equal(receipt.bytes,Buffer.byteLength('Current attachment'));
  worker.finish!({status:'completed',text:'Checked input'});
  release();await f.app.idle();
 }finally{release();await f.close();}
});
