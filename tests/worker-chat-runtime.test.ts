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
        taskId=(await main.call('task_create',{goal:'Read the two synthetic facts.'})).taskId;
        await main.call('worker_open',{taskId,message:'Read A.'});
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
    assert.equal(f.app.tasks.readTask({agentId:f.app.store.meta('mainAgentId')!},taskId).results.length,0);
    assert.equal(f.app.store.db.prepare("SELECT count(*) n FROM agent_receipts r JOIN agent_messages m ON m.id=r.messageId WHERE m.kind='worker_reply' AND r.state='processed'").get()!.n,2);
  }finally{await f.close();}
});

test('an idle conversation follow-up resumes its exact native thread in a new Run',async()=>{
  const f=fixture();let workerId='',followed=false;
  try{
    f.setScript(async(main,text)=>{
      if(text==='start'){
        const task=await main.call('task_create',{goal:'Read the synthetic fact.'});
        workerId=(await main.call('worker_open',{taskId:task.taskId,message:'Read A.'})).workerId;
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
        const task=await main.call('task_create',{goal:'Synthetic ordered follow-up'});
        workerId=(await main.call('worker_open',{taskId:task.taskId,message:'First'})).workerId;
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
        taskId=(await main.call('task_create',{goal:'Original synthetic scope'})).taskId;
        for(const message of ['A','B'])workers.push((await main.call('worker_open',{taskId,message})).workerId);
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

for(const kind of ['worker_reply','interaction_required'] as const)for(const control of ['change','pause','cancel'] as const)test(`stale ${kind} after ${control} cannot recreate withdrawn scope through default or explicit sources`,async()=>{
  const f=fixture();let taskId='',handled=false,checked=false,readText='',question:Promise<unknown>|undefined;
  const attempts:{status:string;error?:string;before:number[];after:number[]}[]=[],raw='  Original scope observation.\n\nThe date is unknown.  ';
  const counts=()=>['tasks','runs','task_versions','operations'].map(table=>Number(f.app.store.db.prepare('SELECT count(*) n FROM '+table).get()!.n));
  try{
    f.setScript(async(main,text)=>{
      if(text==='start'){
        taskId=(await main.call('task_create',{goal:'Investigate the original synthetic scope'})).taskId;
        await main.call('worker_open',{taskId,message:'Investigate original scope'});
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
          const before=counts(),[attempt]=await Promise.allSettled([main.call('task_create',{goal:'Resume the withdrawn original synthetic scope',...(explicit?{sourceRequestIds:['withdrawn-source']}:{})})]);
          const after=counts();attempts.push({status:attempt!.status,...(attempt!.status==='rejected'?{error:attempt!.reason.message}:{}),before,after});
          if(attempt!.status==='fulfilled')await main.call('worker_open',{taskId:attempt!.value.taskId,message:'Resume original scope'});
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

for(const kind of ['worker_reply','interaction_required'] as const)test(`a current live ${kind} can create authorized follow-up Tasks by context or existing Pending`,async()=>{
  const f=fixture();let taskId='',pendingId='',handled=false,checked=false;
  try{
    f.setScript(async(main,text)=>{
      if(text==='start'){
        taskId=(await main.call('task_create',{goal:'Investigate the authorized synthetic scope'})).taskId;
        await main.call('worker_open',{taskId,message:'Investigate original scope'});
        pendingId=(await main.call('pending_add',{content:'Track the original remaining work',relatedTaskId:taskId})).id;
      }else if(!handled&&text.includes('"kind":"'+kind+'"')){
        handled=true;
        for(const explicit of [false,true]){
          const followup=await main.call('task_create',{goal:'Inspect a remaining authorized synthetic fact',...(explicit?{pendingIds:[pendingId]}:{})});
          await main.call('worker_open',{taskId:followup.taskId,message:'Inspect the authorized fact'});
        }
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

test('a later Pending-linked primary source supplies only its own attachments to a failed-task follow-up',async()=>{
  const f=fixture();let taskId='',followupId='',pendingId='',handled=false;const errors:string[]=[];
  try{
    f.setScript(async(main,text)=>{
      try{
        if(text.startsWith('start')){
          taskId=(await main.call('task_create',{goal:'Inspect the original assigned source'})).taskId;
          await main.call('worker_open',{taskId,message:'Inspect the original source'});
        }else if(text.startsWith('authorize'))pendingId=(await main.call('pending_add',{content:'Follow up using the later assigned source',relatedTaskId:taskId})).id;
        else if(!handled&&text.includes('"kind":"worker_reply"')){
          handled=true;await main.call('task_update',{taskId,action:'settle',outcome:'failed'});
          await main.call('pending_update',{id:pendingId,patch:{handlingNote:'An event note cannot grant the unrelated source'},sourceRequestIds:['unrelated-primary']});
          for(const pendingIds of [[],[pendingId,pendingId],['missing-pending'],['later-primary']]) await assert.rejects(main.call('task_create',{goal:'Invalid selection',pendingIds}),/pending_invalid_input|pending_source_denied/);
          followupId=(await main.call('task_create',{goal:'Use the later user source for the authorized follow-up',pendingIds:[pendingId]})).taskId;
          await main.call('worker_open',{taskId:followupId,message:'Use only the later assigned attachment'});
        }
        return {status:'completed',text:'Recorded'};
      }catch(error){errors.push(String(error));throw error;}
    });
    await f.app.start();
    const binding='web:'+f.app.store.meta('mainThread'),originalRef=f.app.media.intent('original-primary',binding,'file'),laterRef=f.app.media.intent('later-primary',binding,'file');
    f.app.media.ready(originalRef,f.app.media.claim(originalRef)!,Buffer.from('Original bytes'),'text/plain');
    f.app.media.ready(laterRef,f.app.media.claim(laterRef)!,Buffer.from('Later bytes'),'text/plain');
    f.app.submitMessage({requestId:'original-primary',text:'start with the original attachment',attachments:[originalRef]});
    await until(()=>f.app.store.request('original-primary')?.state==='completed'&&f.engines.some(engine=>engine.options.role==='worker'&&engine.finish));
    const original=f.engines.find(engine=>engine.options.role==='worker')!;
    f.app.submitMessage({requestId:'later-primary',text:'authorize follow-up using only this later attachment',attachments:[laterRef]});
    await until(()=>!!pendingId&&f.app.store.request('later-primary')?.state==='completed');
    await f.app.message('An unrelated user request, not permission for the original task','unrelated-primary');
    original.finish!({status:'failed',text:'The original inspection failed',errorCode:'synthetic_failure'});
    await until(()=>!!followupId||errors.length>0);assert.deepEqual(errors,[]);
    await until(()=>f.engines.some(engine=>engine.options.role==='worker'&&engine!==original&&engine.finish));
    const authority=f.app.tasks.authority(followupId,1),worker=f.engines.find(engine=>engine.options.role==='worker'&&engine!==original)!;
    assert.equal(authority.sourceRequestId,'later-primary');assert.deepEqual(authority.attachments,[laterRef.assetId+'@'+laterRef.revision]);
    assert.match(authority.description,/authorize follow-up using only this later attachment/);
    assert.equal((await worker.call('stage_file_result',{filename:'later.txt',...laterRef})).bytes,Buffer.byteLength('Later bytes'));
    await assert.rejects(worker.call('stage_file_result',{filename:'original.txt',...originalRef}),/media_scope_denied/);
    assert.equal(f.app.tasks.task(taskId).outcome,'failed');assert.equal(f.app.tasks.tasks().length,2);
    worker.finish!({status:'completed',text:'Follow-up checked'});await f.app.idle();assert.deepEqual(errors,[]);
  }finally{await f.close();}
});

test('a later user can select an accepted result without a Pending, but a Worker event cannot borrow an unrelated result source',async()=>{
  const f=fixture();let original='',selected='',unselected='',foreign='',consumer='',checked=false;
  try{
    f.setScript(async(main,text)=>{
      if(text==='prepare'||text==='foreign'){
        const taskId=(await main.call('task_create',{goal:text+' evidence'})).taskId;
        const filePath=join(f.app.config.workspace,text+'.txt');writeFileSync(filePath,text+' exact evidence');
        const result=(await main.call('accept_result',{taskId,filePath})).resultId;
        if(text==='prepare'){
          original=taskId;selected=result;
          unselected=(await main.call('accept_result',{taskId,filePath})).resultId;
        }else foreign=result;
      }else if(text==='reuse'){
        assert.equal(f.app.store.db.prepare('SELECT count(*) n FROM pending_items').get()!.n,0);
        const args={goal:'Use the selected earlier evidence',resultIds:[selected]};
        consumer=(await main.call('task_create',args,'reuse-create')).taskId;
        assert.equal((await main.call('task_create',args,'reuse-create')).taskId,consumer);
        await main.call('worker_open',{taskId:consumer,message:'Read the selected evidence',resultIds:[selected]});
      }else if(text.includes('"kind":"worker_reply"')){
        const counts=()=>['tasks','runs','operations'].map(table=>f.app.store.db.prepare('SELECT count(*) n FROM '+table).get()!.n);
        const before=counts();
        await assert.rejects(main.call('task_create',{goal:'Borrow unrelated evidence',resultIds:[foreign]}),/task_authority_input_denied/);
        assert.deepEqual(counts(),before);checked=true;
      }
      return {status:'completed',text:'Recorded'};
    });
    await f.app.start();await f.app.message('prepare','original-result-source');await f.app.message('reuse','current-result-source');
    await until(()=>f.engines.some(engine=>engine.options.role==='worker'&&engine.finish));
    const authority=f.app.tasks.authority(consumer,1);
    assert.equal(authority.sourceRequestId,'current-result-source');
    assert.deepEqual(new Set(authority.sourceRequestIds),new Set(['original-result-source','current-result-source']));
    const worker=f.engines.find(engine=>engine.options.role==='worker')!;
    const read=await worker.call('read_material',{});assert.deepEqual(read.results.map((r:any)=>r.id),[selected]);
    await assert.rejects(worker.call('read_material',{resultId:unselected}),/invalid_tool_arguments|task_authority_input_denied/);
    await assert.rejects(worker.call('work_inspect',{taskId:original}),/tool_denied/);
    await f.app.message('foreign','foreign-result-source');
    worker.finish!({status:'completed',text:'Checked selected evidence'});await f.app.idle();assert.equal(checked,true);
  }finally{await f.close();}
});

test('a restored input exposes its committed open and cannot duplicate it with a new native call',async()=>{
  const f=fixture();let taskId='',originalWorker='',lost=false,recovered=false;
  try{
    f.setScript(async(main,text)=>{
      if(text==='start'){
        taskId=(await main.call('task_create',{goal:'Recover an original action'})).taskId;
        await main.call('worker_open',{taskId,message:'Original input'});
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

test('archival follow-up binds only the current notification original user source',async()=>{
  const f=fixture();let original='',followup='',foreignResult='';
  try{
    f.setScript(async(main,text)=>{
      if(text==='unrelated'){
        const taskId=(await main.call('task_create',{goal:'Unrelated evidence'})).taskId,filePath=join(f.app.config.workspace,'unrelated.txt');writeFileSync(filePath,'Unrelated accepted evidence');
        foreignResult=(await main.call('accept_result',{taskId,filePath})).resultId;
        return {status:'completed',text:'Recorded'};
      }
      if(text==='prepare'){
        original=(await main.call('task_create',{goal:'Original completed goal'})).taskId;
        await main.call('task_update',{taskId:original,action:'settle',outcome:'succeeded'});
      }else if(text==='archive'){
        const receipt=await main.call('archive_work',{taskId:original});assert.equal(receipt.state,'archived');
      }else if(text.includes('task_archived')){
        await assert.rejects(main.call('task_create',{goal:'Forged source',sourceRequestIds:['unrelated-source']}),/invalid_tool_arguments/);
        const before=f.app.tasks.tasks().length;
        await assert.rejects(main.call('task_create',{goal:'Borrow unrelated evidence',resultIds:[foreignResult]}),/task_authority_input_denied/);
        assert.equal(f.app.tasks.tasks().length,before);
        followup=(await main.call('task_create',{goal:'Inspect authorized temporary resources'})).taskId;
        await assert.rejects(main.call('worker_open',{taskId:original,message:'Reopen original'}),/task_history_not_visible/);
      }
      return {status:'completed',text:text==='archive'?'Archived':'',messages:[]};
    });
    await f.app.start();await f.app.message('unrelated','unrelated-source');await f.app.message('prepare','prepare-source');
    writeFileSync(join(f.app.config.workspace,'materials','later.md'),'Unrelated later material');
    await f.app.message('archive','archive-source');await f.app.idle();
    assert.ok(followup);assert.equal(f.app.tasks.task(original).historyState,'archived');assert.equal(f.app.tasks.task(original).state,'settled');
    assert.equal(f.app.tasks.authority(followup,1).sourceRequestId,'prepare-source');
    assert.deepEqual(f.app.tasks.authority(followup,1).materials,[]);
    assert.equal(f.app.store.db.prepare("SELECT count(*) n FROM agent_messages WHERE kind='task_archived'").get()!.n,1);
  }finally{await f.close();}
});

test('a restored archive input cannot create another Task to duplicate an already opened Worker',async()=>{
  const f=fixture();let original='',followup='',workerId='',lost=false,recovered=false;
  try{
    f.setScript(async(main,text)=>{
      if(text==='prepare'){
        original=(await main.call('task_create',{goal:'Original completed goal'})).taskId;
        await main.call('task_update',{taskId:original,action:'settle',outcome:'succeeded'});
      }else if(text==='archive')await main.call('archive_work',{taskId:original});
      else if(text.includes('"kind":"task_archived"')){
        if(!lost){
          followup=(await main.call('task_create',{goal:'Inspect authorized temporary resources'},'committed-create')).taskId;
          workerId=(await main.call('worker_open',{taskId:followup,message:'Inspect authorized temporary resources'})).workerId;
          lost=true;throw Error('synthetic_response_lost');
        }
        recovered=true;assert.ok(text.includes(followup)&&text.includes(workerId));
        await assert.rejects(main.call('task_create',{goal:'Inspect authorized temporary resources'},'replacement-create'),/coordination_action_already_committed/);
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
        const task=await main.call('task_create',{goal:'Exact session identity'});
        workerId=(await main.call('worker_open',{taskId:task.taskId,message:'First'})).workerId;
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

for(const control of ['none','change','pause','cancel'] as const)test(`prepared publication honors ${control} before its queued channel submission`,async()=>{
  const f=fixture();let taskId='',deliveryId='',historyId='';
  try{
    const sourcePath=join(f.app.config.workspace,'publication.txt');writeFileSync(sourcePath,'Synthetic publication bytes');
    f.setScript(async(main,text)=>{
      if(text==='publish'){
        taskId=(await main.call('task_create',{goal:'Publish the authorized synthetic file'})).taskId;
        const result=await main.call('accept_result',{taskId,filePath:sourcePath}),receipt=await main.call('publish_delivery',{taskId,resultIds:[result.resultId],text:'Synthetic final publication'});
        deliveryId=receipt.deliveryId;historyId=receipt.historyMessageId;
        assert.equal(receipt.state,'prepared');assert.equal(f.app.history.message(historyId),undefined);
        if(control!=='none')await main.call('task_update',control==='change'?{taskId,goal:'Only inspect the restricted replacement scope'}:{taskId,action:control});
      }else if(text==='resume')await main.call('task_update',{taskId,action:'resume'});
      return {status:'completed',text:'Recorded'};
    });
    await f.app.start();await f.app.message('publish','publication-source');await f.app.idle();
    const sends=()=>f.events.filter(message=>message.type==='delivery');
    assert.equal(sends().length,control==='none'?1:0);
    const delivery=f.app.tasks.delivery(deliveryId);
    assert.equal(delivery.state,control==='none'?'recorded':control==='pause'?'prepared':'revoked');
    if(control!=='none')assert.equal(f.app.history.message(historyId),undefined);
    if(control==='pause'){
      await f.app.message('resume','publication-resume-source');await f.app.idle();
      assert.equal(f.app.tasks.delivery(deliveryId).state,'recorded');assert.equal(sends().length,1);assert.equal(sends()[0]!.deliveryId,deliveryId);
    }
    assert.equal(f.app.tasks.deliveries().length,1);
  }finally{await f.close();}
});

test('a lost publication receipt stays unknown across restart without another external send',async()=>{
  const f=fixture();let taskId='',published=false,recovered=false;
  try{
    f.setSink(async message=>{if(message.type==='delivery')throw Error('synthetic_send_receipt_lost');});
    f.setScript(async(main,text)=>{
      if(text==='start'){
        taskId=(await main.call('task_create',{goal:'Preserve an unknown external receipt'})).taskId;
        await main.call('worker_open',{taskId,message:'Return a synthetic fact'});
      }else if(text.includes('"kind":"publish"')){
        recovered=true;
        const view=await main.call('work_inspect',{taskId}),delivery=view.deliveries[0];
        assert.equal(delivery.state,'uncertain');
        await assert.rejects(main.call('publish_delivery',{taskId,resultIds:delivery.resultIds,text:'Synthetic final'},'new-publish-after-restart'),/coordination_action_already_committed/);
      }else if(!published){
        const worker=(await main.call('work_inspect',{taskId})).workers[0];
        const messages=(await main.call('worker_read',{workerId:worker.workerId})).messages;
        const reply=messages.find((message:any)=>message.kind==='worker_reply');
        const result=await main.call('accept_result',{runId:worker.run.id,messageId:reply.id});
        await main.call('publish_delivery',{taskId,resultIds:[result.resultId],text:'Synthetic final'},'committed-publication');
        published=true;throw Error('synthetic_publication_response_lost');
      }
      return {status:'completed',text:text==='start'?'Started':'',messages:[]};
    });
    await f.app.start();await f.app.message('start','unknown-send-source');
    await until(()=>f.engines.some(engine=>engine.options.role==='worker'&&engine.finish));
    const worker=f.engines.find(engine=>engine.options.role==='worker')!;
    worker.finish!({status:'completed',text:'Synthetic fact',messages:[{itemId:'fact',phase:'final_answer',text:'Synthetic fact'}]});
    await until(()=>f.app.tasks.deliveries()[0]?.state==='uncertain');
    assert.equal(f.events.filter(message=>message.type==='delivery').length,1);
    await f.restart();await until(()=>recovered);await f.app.idle();
    assert.equal(f.app.tasks.deliveries().length,1);assert.equal(f.app.tasks.deliveries()[0]!.state,'uncertain');
    assert.equal(f.events.filter(message=>message.type==='delivery').length,1);
  }finally{await f.close();}
});

test('a Worker question wakes Main and returns the persisted answer to that exact caller',async()=>{
  const f=fixture();
  try{
    f.setScript(async(main,text)=>{
      if(text==='start'){
        const task=await main.call('task_create',{goal:'Ask for one synthetic decision'});
        await main.call('worker_open',{taskId:task.taskId,message:'Ask one question'});
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

test('native file tools bind real call identity, replay exact receipts and create no formal Result',async()=>{
  const f=fixture();let taskId='';
  try{
    f.setScript(async(main,text)=>{
      if(text==='start'){taskId=(await main.call('task_create',{goal:'Write a synthetic draft'})).taskId;await main.call('worker_open',{taskId,message:'Write a draft'});}
      return {status:'completed',text:text==='start'?'Started':'',messages:[]};
    });
    await f.app.start();await f.app.message('start','file-source');await until(()=>f.engines.some(engine=>engine.options.role==='worker'&&engine.finish));
    const worker=f.engines.find(engine=>engine.options.role==='worker')!;
    assert.ok(worker.options.tools.some(tool=>tool.name==='stage_file_result'));
    const args={filename:'draft.txt',dataBase64:Buffer.from('Synthetic bytes').toString('base64')};
    const first=await worker.call('stage_file_result',args,'exact-file');assert.deepEqual(await worker.call('stage_file_result',args,'exact-file'),first);
    await assert.rejects(worker.call('stage_file_result',{...args,dataBase64:Buffer.from('Changed bytes').toString('base64')},'exact-file'),/operation_payload_conflict/);
    await assert.rejects(worker.call('stage_file_result',{...args,operationId:'forged'},'different-file'),/invalid_tool_arguments/);
    const markdown=await worker.call('write_markdown',{filename:'report.md',content:'# Synthetic report'},'exact-md');
    assert.deepEqual(await worker.call('write_markdown',{filename:'report.md',content:'# Synthetic report'},'exact-md'),markdown);
    assert.equal(f.app.tasks.readTask({agentId:f.app.store.meta('mainAgentId')!},taskId).results.length,0);
    worker.finish!({status:'completed',text:'Draft written',messages:[{itemId:'draft',phase:'final_answer',text:'Draft written'}]});await f.app.idle();
  }finally{await f.close();}
});

test('a committed staged attachment replays its native receipt after the source is revoked',async()=>{
  const f=fixture();
  try{
    f.setScript(async(main,text)=>{
      if(text.startsWith('start')){const task=await main.call('task_create',{goal:'Preserve the assigned synthetic bytes'});await main.call('worker_open',{taskId:task.taskId,message:'Stage the assigned source'});}
      return {status:'completed',text:'Started'};
    });
    await f.app.start();
    const source='stage-replay-source',ref=f.app.media.intent(source,'web:'+f.app.store.meta('mainThread'),'file');
    f.app.media.ready(ref,f.app.media.claim(ref)!,Buffer.from('Synthetic staged bytes'),'text/plain');
    f.app.submitMessage({requestId:source,text:'start',attachments:[ref]});
    await until(()=>f.engines.some(engine=>engine.options.role==='worker'&&engine.finish));
    const worker=f.engines.find(engine=>engine.options.role==='worker')!,args={filename:'source.txt',...ref};
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

test('selecting a broad working directory never authorizes host private files for adoption',async()=>{
  const f=fixture();let checked=false;
  try{
    const privatePath=join(f.app.config.runtime,'private-control.txt'),publicPath=join(f.app.config.workspace,'public-report.txt');
    writeFileSync(privatePath,'Synthetic private control');writeFileSync(publicPath,'Synthetic public report');
    f.setScript(async(main,text)=>{
      if(text==='read'){
        const broad=await main.call('task_create',{goal:'Read synthetic work',workingDirectory:'/'});
        await assert.rejects(main.call('accept_result',{taskId:broad.taskId,filePath:privatePath}),/artifact_path_denied/);
        const scoped=await main.call('task_create',{goal:'Read public synthetic work',workingDirectory:f.app.config.workspace});
        const result=await main.call('accept_result',{taskId:scoped.taskId,filePath:publicPath}),view=await main.call('work_inspect',{resultId:result.resultId});
        assert.equal(view.file.content,'Synthetic public report');checked=true;
      }
      return {status:'completed',text:'Checked'};
    });
    await f.app.start();await f.app.message('read','file-boundary-source');assert.equal(checked,true);
    assert.equal(f.app.store.db.prepare('SELECT count(*) n FROM results').get()!.n,1);
  }finally{await f.close();}
});
