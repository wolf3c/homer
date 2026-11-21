import {openTaskWorker} from './fixtures/open-task-worker.js';
import {callEngineMcp,callHostMcp} from './fixtures/host-mcp-call.js';
// Real Homer and SQLite, scripted engine boundary, isolated runtime only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync,unlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {fixture,until} from './fixtures/worker-chat-host.js';

test('idle reports a paused queued Worker without starting or stopping it',async()=>{
 const f=fixture();let taskId='',workerId='',timeout:NodeJS.Timeout|undefined;
 try{
  f.setScript(async(main)=>{taskId=(await main.call('task_create',{title:'Queued',goal:'Keep until authorized'})).taskId;return {status:'completed',text:'Recorded'};});
  await f.app.start();await f.app.message('Record','source');await f.app.idle();
  const actor={agentId:f.app.store.meta('mainAgentId')!,threadId:f.app.store.meta('mainThread')!,sourceRequestId:'source'};
  workerId=f.app.tasks.workerOpen(actor,{taskId,operationId:'pre-pump',authority:{sourceRequestId:'source',description:'Run it'}}).workerId;
  f.app.tasks.controlTask(actor,{taskId,operationId:'pause-before-claim',action:'pause',expectedRevision:f.app.tasks.task(taskId).revision});
  const result=await Promise.race([f.app.idle(),new Promise(resolve=>{timeout=setTimeout(()=>resolve('timeout'),300);})]);
  assert.equal(result,'waiting_or_blocked');assert.equal(f.app.tasks.run(workerId).status,'queued');assert.equal(f.app.tasks.run(workerId).stopRequestedAt,null);
 }finally{clearTimeout(timeout);if(workerId)await f.app.stop(workerId);await f.close();}
});

test('two Worker conversations return complete original text automatically without settling the task',async()=>{
  const f=fixture();let taskId='';
  try{
    f.setScript(async(main,text)=>{
      if(text==='start'){
        taskId=(await openTaskWorker(main,'Read A.')).taskId;
        await main.call('worker_open',{taskId,message:'Read B.'});
      }
      return {status:'completed',text:text==='start'?'Started.':'',messages:[]};
    });
    await f.app.start();await f.app.message('start','user-start');
    await until(()=>f.engines.filter(engine=>engine.options.role==='worker'&&engine.finish).length===2);
    const workers=f.engines.filter(engine=>engine.options.role==='worker');
    const firstInput=workers.find(worker=>worker.input?.endsWith('Read A.'))?.input??'';
    const secondInput=workers.find(worker=>worker.input?.endsWith('Read B.'))?.input??'';
    assert.equal(firstInput.match(/Read A\./g)?.length,1);
    assert.match(firstInput,/"sourceRequestId":"user-start"/);
    assert.match(secondInput,/"goal":"Read A\."/);
    const rounds=f.inputs.length;
    workers[0]!.emit('agentMessage',{threadId:workers[0]!.threadId,turnId:workers[0]!.turnId,itemId:'progress',phase:'commentary',text:'Checking.',completed:true});
    await new Promise(resolve=>setTimeout(resolve,20));assert.equal(f.inputs.length,rounds);
    const raw='  First paragraph.\n\n[file](/synthetic/report.md)\nLast line.  ';
    for(const [index,worker]of workers.entries())worker.finish!({status:'completed',text:'wrong aggregate',messages:[{itemId:'answer-'+index,phase:'final_answer',text:raw}]});
    await f.app.idle();
    const replies=f.inputs.filter(text=>text.endsWith(raw));
    assert.equal(replies.length,2);
    for(const reply of replies){
      const [header,metadata]=reply.split('\n',2);
      assert.equal(header,'[内部协作输入 · Worker 回报]');
      const facts=JSON.parse(metadata!);
      assert.ok(!Object.hasOwn(facts,'operations'));
      assert.equal(facts.taskId,taskId);assert.equal(facts.version,1);
      assert.deepEqual(facts.currentTask,{title:'Read A.',goal:'Read A.'});
      assert.equal(facts.kind,'worker_reply');assert.ok(facts.workerId&&facts.messageId);
      assert.equal(facts.execution.status,'completed');assert.equal(facts.execution.exitConfirmed,true);
      for(const key of ['runId','threadId','turnId'])assert.ok(!Object.hasOwn(facts,key),key);
    }
    assert.equal(f.app.tasks.task(taskId).state,'open');
    assert.equal(f.app.store.db.prepare("SELECT 1 FROM sqlite_master WHERE name='results'").get(),undefined);
    assert.equal(f.app.store.db.prepare("SELECT count(*) n FROM agent_receipts r JOIN agent_messages m ON m.id=r.messageId WHERE m.kind='worker_reply' AND r.state='received'").get()!.n,2);
  }finally{await f.close();}
});

test('queued replies get their own current task and the full notes saved before review',async()=>{
  const f=fixture(),goal='修复导出\n并核对结果。',notes='保留观察记录。\n'.repeat(1500)+'明早核对夜间结果。';
  let exportId='',exportWorker='',docsId='',docsWorker='';
  try{
    f.setScript(async(main,text)=>{
      if(text==='delegate'){
        ({taskId:exportId,workerId:exportWorker}=await openTaskWorker(main,'导出',goal));
        ({taskId:docsId,workerId:docsWorker}=await openTaskWorker(main,'文档','校对目录'));
      }else if(text==='record observation'){
        for(const worker of f.engines.filter(e=>e.options.role==='worker'))
          worker.finish!({status:'completed',text:worker.threadId===f.app.tasks.run(exportWorker).threadId?'导出已修复':'目录已校对'});
        await until(()=>f.app.store.db.prepare("SELECT count(*) n FROM agent_messages WHERE kind='worker_reply'").get()!.n===2);
        await main.call('task_update',{taskId:exportId,notes});
      }
      return {status:'completed',text:'',messages:[]};
    });
    await f.app.start();await f.app.message('delegate','delegate-both');
    await until(()=>f.engines.filter(e=>e.options.role==='worker'&&e.finish).length===2);
    await f.app.message('record observation','observe-export');await f.app.idle();
    const reports=f.inputs.filter(text=>text.includes('[Worker 原文]'));
    assert.equal(reports.length,2);
    for(const [raw,id,workerId,currentTask] of [
      ['导出已修复',exportId,exportWorker,{title:'导出',goal,notes}],
      ['目录已校对',docsId,docsWorker,{title:'文档',goal:'校对目录'}],
    ] as const){
      const prompt=reports.find(text=>text.endsWith('[Worker 原文]\n'+raw))!;
      const facts=JSON.parse(prompt.split('\n')[1]!);
      assert.equal(facts.taskId,id);assert.equal(facts.workerId,workerId);
      assert.equal(facts.version,1);assert.deepEqual(facts.currentTask,currentTask);
      assert.equal(f.app.tasks.task(id).state,'open');
    }
    assert.equal(f.app.store.runs().length,2);
  }finally{await f.close();}
});

test('a missing current goal preserves the original Worker reply',async()=>{
  const f=fixture();let taskId='';
  try{
    f.setScript(async(main,text)=>{
      if(text==='start')taskId=(await openTaskWorker(main,'Check the original goal')).taskId;
      return {status:'completed',text:'',messages:[]};
    });
    await f.app.start();await f.app.message('start','missing-head');
    await until(()=>f.engines.some(e=>e.options.role==='worker'&&e.finish));
    f.app.store.db.prepare('UPDATE tasks SET headVersion=headVersion+1 WHERE id=?').run(taskId);
    f.engines.find(e=>e.options.role==='worker')!.finish!({status:'completed',text:'Original finding'});
    await f.app.idle();
    const prompt=f.inputs.find(text=>text.endsWith('[Worker 原文]\nOriginal finding'))!;
    assert.equal(JSON.parse(prompt.split('\n')[1]!).currentTask,'当前事项详情不可用');
  }finally{await f.close();}
});

test('an idle conversation follow-up resumes its exact native thread in a new Run',async()=>{
  const f=fixture();let workerId='',followed=false;
  try{
    f.setScript(async(main,text)=>{
      if(text==='start'){
        workerId=(await openTaskWorker(main,'Read A.')).workerId;
      }else if(!followed){followed=true;await main.call('worker_message',{workerId,message:'Explain the observation.'});}
      return {status:'completed',text:text==='start'?'Started.':'',messages:[]};
    });
    await f.app.start();await f.app.message('start','user-followup');
    await until(()=>f.engines.some(engine=>engine.options.role==='worker'&&engine.finish));
    const first=f.engines.find(engine=>engine.options.role==='worker')!;
    first.finish!({status:'completed',text:'First answer',messages:[{itemId:'first',phase:'final_answer',text:'First answer'}]});
    await until(()=>f.engines.filter(engine=>engine.options.role==='worker').length===2&&!!f.engines.filter(engine=>engine.options.role==='worker')[1]?.finish);
    const second=f.engines.filter(engine=>engine.options.role==='worker')[1]!;
    assert.equal(second.options.threadId,first.threadId);
    assert.match(second.input!,/"goal":"Read A\."/);
    assert.ok(second.input!.endsWith('Explain the observation.'));
    assert.ok(!second.options.tools.some(tool=>tool.name==='create_voice_result'));
    await assert.rejects(second.call('create_voice_result',{filename:'voice.silk',text:'Synthetic text'}),/worker_tool_denied/);
    const runs=f.app.tasks.runs(undefined,workerId);assert.equal(runs.length,2);assert.equal(runs[1]!.workerId,workerId);
    second.finish!({status:'completed',text:'Second answer',messages:[{itemId:'second',phase:'final_answer',text:'Second answer'}]});
    await f.app.idle();
  }finally{await f.close();}
});

test('a goal edit leaves both original Runs live; Homer steers just the report and reviews its original-version reply',async()=>{
  const f=fixture(),steers:string[]=[];
  let taskId='',reportId='',reviewed=false;
  const report=join(f.app.config.workspace,'report.txt');
  const link='[报告]('+pathToFileURL(report).href+')';
  try{
    f.setScript(async(main,text)=>{
      if(text==='start'){
        taskId=(await openTaskWorker(main,'Investigate the fault')).taskId;
        reportId=(await main.call('worker_open',{taskId,message:'Prepare the report'})).workerId;
      }else if(text==='中文报告'){
        await main.call('task_update',{taskId,goal:'Investigate the fault and deliver the report in Chinese'});
        await main.call('worker_message',{workerId:reportId,message:'用中文撰写报告'});
      }else if(text.includes('"kind":"worker_reply"')&&text.endsWith(link)){
        reviewed=true;
        const facts=JSON.parse(text.split('\n')[1]!);
        assert.equal(facts.version,1);
        assert.deepEqual(facts.currentTask,{title:'Investigate the fault',goal:'Investigate the fault and deliver the report in Chinese',version:2});
        return {status:'completed',text:link,messages:[{itemId:'reviewed-report',phase:'final_answer',text:link}]};
      }
      return {status:'completed',text:'',messages:[]};
    });
    await f.app.start();await f.app.message('start','scope-start');
    await until(()=>f.engines.filter(e=>e.options.role==='worker'&&e.finish).length===2);
    const workers=f.engines.filter(e=>e.options.role==='worker');
    const writer=workers.find(e=>e.input?.endsWith('Prepare the report'))!;
    for(const e of workers)e.steer=async(turnId,message)=>{assert.equal(e,writer);steers.push(message);return {turnId};};
    await f.app.message('中文报告','scope-change');
    assert.deepEqual(steers,['用中文撰写报告']);
    assert.equal(f.app.tasks.task(taskId).headVersion,2);
    for(const run of f.app.tasks.runs(taskId)){assert.equal(run.version,1);assert.equal(run.status,'running');assert.equal(run.stopRequestedAt,null);}
    writeFileSync(report,'中文报告');
    for(const e of workers)e.finish!({status:'completed',text:e===writer?link:'Fact checked'});
    await f.app.idle();
    assert.equal(reviewed,true);assert.equal(f.app.tasks.runs(taskId).length,2);
    const final=f.app.history.list(f.app.store.meta('mainThread')!).find(m=>m.role==='assistant'&&m.audience==='user'&&m.attachments?.length);
    assert.equal(final?.taskVersion,2);
    assert.deepEqual(f.app.readCommittedMessage(final!.id,{taskId,taskVersion:2})?.attachments,final!.attachments);
  }finally{await f.close();}
});

test('goal edits keep prior user sources until a fresh user resumes execution',async()=>{
 const f=fixture();let taskId='';
 const original='Inspect A without writing outside the project.';
 const expanded='Also inspect B and keep the writing restriction.';
 const revised='While paused, inspect C instead of B and keep the writing restriction.';
 try{
  f.setScript(async(main,text)=>{
   if(text===original)taskId=(await openTaskWorker(main,"Synthetic task",original)).taskId;
   else if(text===expanded||text===revised)await main.call('task_update',{taskId,goal:text});
   else if(text==='Pause'){
    const run=f.app.tasks.workers(taskId)[0]!.run;
    const paused=await main.call('task_update',{taskId,action:'pause'});
    assert.equal(paused.state,'paused');assert.equal(f.app.tasks.run(run.id).stopRequestedAt,null);
    await main.call('worker_interrupt',{workerId:run.workerId});
   }
   else if(text==='Authorize a new inspection of C')await main.call('task_update',{taskId,action:'resume',goal:text});
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
  await f.app.message('Authorize a new inspection of C','renewed-authority');
  const task=f.app.tasks.task(taskId),renewed=f.app.tasks.authority(taskId,4);
  assert.equal(task.state,'open');assert.equal(task.headVersion,4);
  assert.equal(renewed.sourceRequestId,'renewed-authority');
  assert.deepEqual(renewed.sourceRequestIds??[],[]);
  assert.equal(f.app.tasks.runs(taskId).length,1);
 }finally{await f.close();}
});

for(const kind of ['worker_reply','interaction_required'] as const)for(const control of ['change','pause'] as const)test(`stale ${kind} after ${control} cannot recreate withdrawn scope through default or explicit sources`,async()=>{
  const f=fixture();let taskId='',handled=false,checked=false,readText='',question:Promise<unknown>|undefined;
  const attempts:{status:string;error?:string;before:number[];after:number[]}[]=[],raw='  Original scope observation.\n\nThe date is unknown.  ';
  const counts=()=>['tasks','runs','task_versions','operations'].map(table=>Number(f.app.store.db.prepare('SELECT count(*) n FROM '+table).get()!.n));
  try{
    f.setScript(async(main,text)=>{
      if(text==='start'){
        taskId=(await openTaskWorker(main,'Investigate original scope')).taskId;
      }else if(text==='revoke'){
        const worker=f.engines.find(engine=>engine.options.role==='worker')!;
        worker.emit('agentMessage',{threadId:worker.threadId,turnId:worker.turnId,itemId:'old-observation',phase:'final_answer',text:raw,completed:true});
        if(kind==='interaction_required'){question=worker.call('ask_main',{question:'Continue the original scope?'});void question.catch(()=>{});await until(()=>f.app.interactions.list().length===1);}
        await main.call('worker_interrupt',{workerId:f.app.tasks.workers(taskId)[0]!.workerId});
        await main.call('task_update',control==='change'?{taskId,goal:'Only inspect the newly restricted synthetic scope'}:{taskId,action:control});
      }else if(!handled&&text.includes('"kind":"'+kind+'"')){
        handled=true;
        const worker=f.app.tasks.workers(taskId)[0]!,view=await main.call('worker_read',{workerId:worker.workerId});
        readText=view.messages.find((message:any)=>message.kind==='worker_reply')?.text;
        const record=await main.call('task_create',{title:'Withdrawn scope',goal:'Resume the withdrawn original synthetic scope'});
        for(const explicit of [false,true]){
          const before=counts(),[attempt]=await Promise.allSettled([main.call('worker_open',{taskId:record.taskId,...(explicit?{sourceRequestIds:['withdrawn-source']}:{})})]);
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
    assert.equal(readText,raw);assert.equal(f.app.tasks.tasks().length,2);assert.equal(f.app.store.runs().length,1);
    if(kind==='interaction_required'){assert.equal(f.app.interactions.list()[0]!.state,'cancelled');await question;}
    const task=f.app.tasks.task(taskId);assert.equal(task.headVersion,control==='change'?2:1);assert.equal(task.state,control==='pause'?'paused':'open');
    await f.app.idle();
  }finally{await f.close();}
});

for(const hash of [
  'f579ad37daedcef8a429e13a0511668b2ef954abbc180e47b408475c5395cffe',
  'd8a4bd52a287759bcbcd4eb754a8e41e344ac6e1ab287576f4c8b2172202f150',
])test('a saved Main with a retired dispatch catalog stays closed ('+hash.slice(0,8)+')',async()=>{
  const f=fixture();
  try{
    f.app.store.setMeta('mainThread','synthetic-legacy-main');
    f.app.store.setMeta('mainToolsHash',hash);
    await assert.rejects(f.app.start({keepManagementOnFailure:true}),/main_tools_migration_required/);
    assert.equal(f.engines.length,0);
    assert.equal(f.app.store.meta('mainToolsHash'),hash);
  }finally{await f.close();}
});

for(const kind of ['worker_reply','interaction_required'] as const)test(`a current live ${kind} can create follow-up sessions within the original scope`,async()=>{
  const f=fixture();let handled=false,checked=false;
  try{
    f.setScript(async(main,text)=>{
      if(text==='start'){
        await openTaskWorker(main,'Authorized inspection','Investigate original authorized scope');
      }else if(!handled&&text.includes('"kind":"'+kind+'"')){
        handled=true;
        await assert.rejects(main.call('worker_open',{message:'Missing task ID'}),/invalid_tool_arguments/);
        for(const message of ['Inspect remaining authorized fact A','Inspect remaining authorized fact B'])
          await openTaskWorker(main,'Authorized inspection',message);
        if(kind==='interaction_required'){
          assert.equal(Object.hasOwn(JSON.parse(text.split('\n')[1]!),'currentTask'),false);
          assert.doesNotMatch(text,/"(?:runId|threadId|turnId)"|\[Worker 原文\]/);
          const interactionId=text.match(/\[待答入口\] interactionId=([^；]+)/)?.[1];
          assert.equal(interactionId,f.app.interactions.list()[0]!.id);
          await callEngineMcp(main, 'inspect_interaction',{interactionId});
          await callEngineMcp(main, 'respond_interaction',{interactionId,action:'answer',answer:'Continue within the original scope',reason:'Original source remains current'});
        }
        checked=true;
      }
      return {status:'completed',text:'Recorded'};
    });
    await f.app.start();await f.app.message('start','live-source');await until(()=>f.engines.some(engine=>engine.options.role==='worker'&&engine.finish));
    const original=f.engines.find(engine=>engine.options.role==='worker')!;
    original.steer=async(turnId,text)=>{assert.equal(turnId,original.turnId);assert.match(text,/Continue within the original scope/);return {turnId};};
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
  const f=fixture();let taskId='',followupId='',paused=false;
  try{
    const binding=()=> 'web:'+f.app.store.meta('mainThread');
    let originalRef:{assetId:string;revision:number},laterRef:{assetId:string;revision:number};
    f.setScript(async(main,text)=>{
      if(text.startsWith('start')){
        taskId=(await openTaskWorker(main,"Inspect original source",'Inspect original source',{attachments:[originalRef]})).taskId;
      }else if(!paused&&text.includes('"kind":"worker_reply"')){
        await main.call('task_update',{taskId,action:'pause'});
        await assert.rejects(openTaskWorker(main,'Continue the failed task'),/task_authority_source_denied/);
        paused=true;
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
    await until(()=>paused);await f.app.idle();
    laterRef=f.app.media.intent('later-primary',binding(),'file');
    f.app.media.ready(laterRef,f.app.media.claim(laterRef)!,Buffer.from('Later bytes'),'text/plain');
    f.app.submitMessage({requestId:'later-primary',text:'continue',attachments:[laterRef]});
    await until(()=>!!followupId&&f.engines.some(engine=>engine.options.role==='worker'&&engine!==original&&engine.finish));
    const worker=f.engines.find(engine=>engine.options.role==='worker'&&engine!==original)!;
    assert.equal(f.app.tasks.authority(taskId,2).sourceRequestId,'later-primary');
    assert.equal((await worker.call('stage_file_result',{filename:'later.txt',...laterRef})).bytes,Buffer.byteLength('Later bytes'));
    await assert.rejects(worker.call('stage_file_result',{filename:'original.txt',...originalRef}),/media_scope_denied/);
    assert.equal(f.app.tasks.task(taskId).state,'open');assert.equal(f.app.tasks.tasks().length,2);
    worker.finish!({status:'completed',text:'Follow-up checked'});await f.app.idle();
  }finally{await f.close();}
});

test('background Worker replies cannot delegate another user source’s attachment',async()=>{
 const f=fixture();let assigned:{assetId:string;revision:number},foreign:{assetId:string;revision:number},checked=false;
 try{
  f.setScript(async(main,text)=>{
   if(text.startsWith('start'))await openTaskWorker(main,"Use the assigned file",'Use the assigned file',{attachments:[assigned]});
   else if(text.includes('"kind":"worker_reply"')){
    const {taskId}=await main.call('task_create',{title:'Borrow unrelated evidence',goal:'Borrow unrelated evidence'});
    const before=f.app.tasks.tasks().length;
    await assert.rejects(main.call('worker_open',{taskId,attachments:[foreign]}),/media_scope_denied/);
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

test('a failed received input retains its committed open and restart never replays it',async()=>{
  const f=fixture();let taskId='',originalWorker='',lost=false,recovered=false;
  try{
    f.setScript(async(main,text)=>{
      if(text==='start'){
        taskId=(await openTaskWorker(main,'Recover an original action')).taskId;
      }else if(!lost){
        lost=true;originalWorker=(await main.call('worker_open',{taskId,message:'Inspect the returned fact'},'committed-open')).workerId;
        assert.equal((await main.call('worker_open',{taskId,message:'Inspect the returned fact'},'committed-open')).workerId,originalWorker);
        throw Error('synthetic_response_lost');
      }else if(text==='review originals'){
        recovered=true;
        const view=await main.call('work_inspect',{taskId});
        assert.equal(view.workers.filter((worker:any)=>worker.workerId===originalWorker).length,1);
      }
      return {status:'completed',text:['start','review originals'].includes(text)?'Reviewed':'',messages:[]};
    });
    await f.app.start();await f.app.message('start','recovery-start');
    await until(()=>f.engines.some(engine=>engine.options.role==='worker'&&engine.finish));
    const first=f.engines.find(engine=>engine.options.role==='worker')!;
    first.finish!({status:'completed',text:'Original answer',messages:[{itemId:'original',phase:'final_answer',text:'Original answer'}]});
    await until(()=>lost);await f.app['mainQueue'];
    const original=f.app.store.db.prepare("SELECT m.id FROM agent_receipts r JOIN agent_messages m ON m.id=r.messageId WHERE m.kind='worker_reply' AND r.state='received'").get()!.id as string;
    const before=f.app.tasks.workers(taskId).length;
    await f.restart();await f.app.idle();assert.equal(recovered,false);
    await f.app.message('review originals','review-originals');assert.equal(recovered,true);
    assert.equal(f.app.tasks.workers(taskId).length,before);await f.app.idle();
    assert.equal(f.app.processes.list(f.app.store.meta('mainThread')!).filter(node=>node.sourceMessageIds.includes(original)).length,1);
  }finally{await f.close();}
});

test('retry of a blocked message with a file reuses its receipt after the Worker becomes ready',async()=>{
 const f=fixture();let workerId='',checked=false;
 try{
  f.setScript(async(main,text)=>{
   if(text==='open')workerId=(await openTaskWorker(main,'Inspect the file')).workerId;
   if(text==='send file'){
    const run=f.app.tasks.run(workerId),path=join(f.app.config.workspace,'sample.txt');
    writeFileSync(path,'Synthetic file');
    const args={workerId,message:'Read the sample',attachments:[{path}]};
    f.app.tasks.rpc(run.id,run.epoch,true);
    const blocked=await main.call('worker_message',args,'send-file');
    assert.equal(blocked.route,'blocked');
    f.app.tasks.rpc(run.id,run.epoch,false);
    unlinkSync(path);
    assert.deepEqual(await main.call('worker_message',args,'send-file'),blocked);
    const db=f.app.store.db;
    assert.equal(db.prepare("SELECT count(*) n FROM agent_messages WHERE kind='worker_input'").get()!.n,1);
    assert.equal(db.prepare("SELECT state FROM operations WHERE kind='attachment_stage'").get()!.state,'failed');
    assert.equal(db.prepare("SELECT count(*) n FROM media_pins WHERE scope LIKE 'operation:%'").get()!.n,0);
    checked=true;
   }
   return {status:'completed',text:'Reviewed',messages:[]};
  });
  await f.app.start();await f.app.message('open','blocked-open');
  await until(()=>f.engines.some(engine=>engine.options.role==='worker'&&engine.finish));
  await f.app.message('send file','blocked-send');assert.equal(checked,true);
 }finally{await f.close();}
});

test('a failed received Worker input cannot repeat its committed immediate message on restart',async()=>{
 const f=fixture();let workerId='',steers=0,attempted=false,recovered=false;
 try{
  f.setScript(async(main,text)=>{
   if(text==='start'){
    const first=await openTaskWorker(main,'Collect the finding');
    workerId=(await main.call('worker_open',{taskId:first.taskId,message:'Wait for the finding'})).workerId;
   }else if(text.includes('Exact synthetic finding')){
    const args={workerId,message:'Incorporate this exact finding'};
    if(!attempted){
     attempted=true;
     assert.equal((await main.call('worker_message',args,'committed-immediate')).state,'received');
     assert.equal((await main.call('worker_message',args,'committed-immediate')).state,'received');
     throw Error('synthetic_response_lost');
    }
   }else if(text==='review original steer'){
    const view=await main.call('work_inspect',{taskId:f.app.tasks.run(workerId).taskId});assert.ok(view.workers.some((worker:any)=>worker.workerId===workerId));recovered=true;
   }
   return {status:'completed',text:['start','review original steer'].includes(text)?'Reviewed':'',messages:[]};
  });
  await f.app.start();await f.app.message('start','recovery-start');
  await until(()=>f.engines.filter(engine=>engine.options.role==='worker'&&engine.finish).length===2);
  const [producer,receiver]=f.engines.filter(engine=>engine.options.role==='worker');
  receiver!.steer=async(turnId,message)=>{assert.equal(turnId,receiver!.turnId);assert.equal(message,'Incorporate this exact finding');steers++;return {turnId};};
  producer!.finish!({status:'completed',text:'Exact synthetic finding'});
  await until(()=>attempted);await f.app['mainQueue'];
  assert.equal(steers,1);await f.restart();await f.app.idle();assert.equal(recovered,false);
  await f.app.message('review original steer','review-steer');assert.equal(recovered,true);await f.app.idle();
  assert.equal(steers,1);assert.equal(f.app.store.db.prepare("SELECT count(*) n FROM operations WHERE kind='worker_steer'").get()!.n,1);
 }finally{await f.close();}
});

for(const status of ['completed','failed'] as const)test('newly recorded Task archives with its source turn only on '+status,async()=>{
 const f=fixture();let taskId='',key='',reviews=0;
 try{
  f.setScript(async(main,text)=>{
   if(text==='Record and archive'){
    taskId=(await main.call('task_create',{title:'Idea',goal:'Keep this idea'})).taskId;
    const receipt=await main.call('archive_work',{taskId});
    assert.equal(receipt.state,'requested');assert.equal(f.app.tasks.task(taskId).historyState,'visible');key=receipt.operationKey;
    return {status,text:'Recorded'};
   }
   if(text.includes('"kind":"task_archived"'))reviews++;
   return {status:'completed',text:'',messages:[]};
  });
  await f.app.start();await f.app.message('Record and archive','source');await f.app.idle();
  assert.equal(JSON.parse(f.app.tasks.operation(key).responseJson!).state,status==='completed'?'archived':'skipped');
  assert.equal(f.app.tasks.task(taskId).historyState,status==='completed'?'archived':'visible');
  assert.equal(f.app.tasks.version(taskId,1).authorityJson,null);assert.equal(f.app.tasks.runs().length,0);
  if(status==='completed')assert.match(f.inputs.find(text=>text.includes('"kind":"task_archived"'))??'',/\n\n\[宿主归档通知\]\n\{/);
  assert.equal(reviews,status==='completed'?1:0);await f.restart();await f.app.idle();assert.equal(reviews,status==='completed'?1:0);
 }finally{await f.close();}
});

test('two records from one input each complete their archive in its terminal transaction',async()=>{
 const f=fixture();const keys:string[]=[];
 try{
  f.setScript(async(main,text)=>{
   if(text==='Record two ideas'){
    for(const title of ['A','B']){
     const {taskId}=await main.call('task_create',{goal:title,title});
     const receipt=await main.call('archive_work',{taskId});keys.push(receipt.operationKey);
     assert.equal(receipt.state,'requested');
    }
   }
   return {status:'completed',text:'Recorded'};
  });
  await f.app.start();await f.app.message('Record two ideas','two-ideas');await f.app.idle();
  assert.equal(keys.length,2);assert.deepEqual(keys.map(key=>JSON.parse(f.app.tasks.operation(key).responseJson!).state),['archived','archived']);
 }finally{await f.close();}
});

test('explicit pause withdraws future scoped publications while committed scheduled results remain readable',async()=>{
 const f=fixture();let taskId='',workerId='';
 try{
  f.setScript(async(main,text)=>{
   if(text==='Start'){
    const work=await openTaskWorker(main,'Prepare scheduled reports');taskId=work.taskId;workerId=work.workerId;
   }else if(text==='Pause')await main.call('task_update',{taskId,action:'pause'});
   else if(text==='Archive')await main.call('archive_work',{taskId});
   else if(text.startsWith('[定时消息；')){
    const final=text.split('[定时消息正文]\n').at(-1)!;
    return {status:'completed',text:final,messages:[{itemId:'final',phase:'final_answer',text:final}]};
   }
   return {status:'completed',text:'Recorded',messages:[]};
  });
  await f.app.start();await f.app.message('Start','original');await until(()=>f.engines.some(e=>e.options.role==='worker'&&e.finish));
  f.engines.find(e=>e.options.role==='worker')!.finish!({status:'completed',text:'Done'});await f.app.idle();
  const thread=f.app.store.meta('mainThread')!,agent=f.app.store.meta('mainAgentId')!;
  const scope={taskId,taskVersion:f.app.tasks.run(workerId).version};
  const sourceRef=JSON.stringify({instanceId:agent,threadId:thread,creatorAgentId:agent,authority:f.app.tasks.authority(taskId,scope.taskVersion),deliveryTask:scope});
  const fire=async(text:string)=>{
   f.app.store.transaction(()=>f.app.inputs.enqueueScheduled({deliveryId:text,scheduleId:'synthetic',scheduledAt:Date.now(),text,sourceRef}));
   f.app.recheckScheduledMessages();await f.app.idle();
   return f.app.history.list(thread).find(m=>m.text===text&&m.audience==='user')!;
  };
  const before=await fire('before');assert.equal(before.taskId,taskId);
  await f.app.message('Pause','pause');await f.app.message('Archive','archive');await f.app.idle();
  assert.equal(f.app.tasks.task(taskId).historyState,'archived');
  assert.equal((await fire('after')).taskId,null);
  assert.equal(f.app.readCommittedMessage(before.id,scope)?.text,'before');
 }finally{await f.close();}
});

test('archival follow-up binds only the current notification original user source',async()=>{
  const f=fixture();let original='',followup='';
  try{
    f.setScript(async(main,text)=>{
      if(text==='prepare'){
        const assigned=await openTaskWorker(main,'Original completed goal');
        original=assigned.taskId;
        await main.call('worker_interrupt',{workerId:assigned.workerId});
      }else if(text==='archive'){
        const receipt=await main.call('archive_work',{taskId:original});assert.equal(receipt.state,'archived');
      }else if(text.includes('task_archived')){
        await assert.rejects(main.call('task_create',{title:"Forged source",goal:'Forged source',sourceRequestIds:['unrelated-source']}),/invalid_tool_arguments/);
        const before=f.app.tasks.tasks().length;
        await assert.rejects(main.call('worker_open',{taskId:original,sourceRequestIds:['unrelated-source']}),/invalid_tool_arguments/);
        assert.equal(f.app.tasks.tasks().length,before);
        followup=(await openTaskWorker(main,'Inspect authorized temporary resources')).taskId;
        await assert.rejects(main.call('worker_open',{taskId:original,message:'Reopen original'}),/task_history_not_visible/);
      }
      return {status:'completed',text:text==='archive'?'Archived':text==='prepare'?'Prepared':'',messages:[]};
    });
    await f.app.start();await f.app.message('unrelated','unrelated-source');await f.app.message('prepare','prepare-source');
    await f.app.message('archive','archive-source');await until(()=>!!followup&&f.engines.some(engine=>engine.options.role==='worker'&&engine.finish));
    f.engines.find(engine=>engine.options.role==='worker'&&engine.finish)!.finish!({status:'completed',text:'Checked archive'});await f.app.idle();
    assert.ok(followup);assert.equal(f.app.tasks.task(original).historyState,'archived');assert.equal(f.app.tasks.task(original).state,'paused');
    assert.equal(f.app.tasks.authority(followup,1).sourceRequestId,'prepare-source');
    assert.equal(f.app.store.db.prepare("SELECT count(*) n FROM agent_messages WHERE kind='task_archived'").get()!.n,1);
  }finally{await f.close();}
});

for(const channelSource of ['delegation','archive'] as const)test('archive review rechecks revoked channel '+channelSource+' while history stays readable',async()=>{
 const f=fixture([{id:'simulation',send:async()=>({state:'sent'})}]);
 const address={adapterId:'simulation',accountKey:'account',senderKey:'sender',conversationKey:'chat'};
 let taskId='',binding='',reviewMessage='',checked=false;
 try{
  f.setScript(async(main,text)=>{
   if(text.endsWith('Prepare')){
    const work=await openTaskWorker(main,'Review these records');taskId=work.taskId;
    await main.call('worker_interrupt',{workerId:work.workerId});
   }else if(text.endsWith('Archive')){
    assert.equal((await main.call('archive_work',{taskId})).state,'archived');
    f.app.channels!.revokeBinding(binding);
   }else if(text.includes('"kind":"task_archived"')){
    reviewMessage=JSON.parse(text.split('\n')[1]!).messageId;
    assert.equal((await main.call('work_inspect',{taskId})).task.id,taskId);
    await assert.rejects(openTaskWorker(main,'Check recorded cleanup scope'),/channel_binding_denied/);
    checked=true;
   }
   return {status:'completed',text:text.includes('"kind":')?'':'Recorded',messages:[]};
  });
  await f.app.start();const plugin=f.app.channels!;binding=plugin.bind(address);
  const submit=async(text:string,channel:boolean)=>{
   if(channel)plugin.receiveText({...address,eventId:text,text});else await f.app.message(text,text);
   await f.app.idle();
  };
  await submit('Prepare',channelSource==='delegation');await submit('Archive',channelSource==='archive');
  assert.equal(checked,true);assert.equal(f.app.tasks.runs().length,1);
  assert.equal(f.app.store.db.prepare("SELECT state FROM agent_receipts WHERE messageId=?").get(reviewMessage)?.state,'received');
  assert.equal(await f.app.message('Next','next'),'Recorded');
 }finally{await f.close();}
});

for(const action of ['allow','deny','stop'] as const)test('archive command approval can '+action+' without blocking the next message',async()=>{
  const f=fixture();let taskId='',resolution='';
  try{
    f.setScript(async(main,text)=>{
      if(text==='prepare'){
        const assigned=await openTaskWorker(main,'Synthetic archived task');
        taskId=assigned.taskId;
        await main.call('worker_interrupt',{workerId:assigned.workerId});
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
        await openTaskWorker(main,'Prepare a synthetic operation');
      }else if(text.includes('"kind":"interaction_required"')){
        const id=JSON.parse(text.split('\n')[1]!).messageId;
        const notice=f.app.store.db.prepare('SELECT payloadJson FROM agent_messages WHERE id=?').get(id)!;
        seen=JSON.parse(String(notice.payloadJson)).interactionId;
        await callEngineMcp(main, 'inspect_interaction',{interactionId:seen});
        await callEngineMcp(main, 'escalate_interaction',{interactionId:seen,question:'Confirm the operation',reason:'Needs user authorization'});
        await assert.rejects(callEngineMcp(main, 'respond_interaction',{interactionId:seen,action:'approve',reason:'No user approval'}),/user.*required/);
        const final={itemId:'approval-notice',phase:'final_answer' as const,text:'Please confirm the proposed operation.'};
        return {status:'completed',text:final.text,messages:[final]};
      }else if(text.includes('[用户答复原待答]')){
        assert.equal(resolved,false);mediated=true;
        await callEngineMcp(main, 'inspect_interaction',{interactionId:seen});
        if(action==='deny'){
          await assert.rejects(callEngineMcp(main, 'respond_interaction',{interactionId:seen,action:'approve',reason:'Cannot turn a refusal into permission'}),/user.*required/);
          wrongDecisionRejected=true;
        }
        await callEngineMcp(main, 'respond_interaction',{interactionId:seen,action,reason:'Use the actual user decision'});
      }
      return {status:'completed',text:'Recorded'};
    });
    await f.app.start();await f.app.message('start','worker-source');
    await until(()=>f.engines.some(engine=>engine.options.role==='worker'&&engine.finish));
    const worker=f.engines.find(engine=>engine.options.role==='worker')!;
    const result=worker.options.onInteraction!({requestId:1,method:'item/commandExecution/requestApproval',kind:'authorization',threadId:worker.threadId,turnId:worker.turnId!,itemId:'command',details:{command:'synthetic operation',availableDecisions:['accept','decline']}}).then(value=>{resolved=true;return value;});
    await until(()=>f.app.interactions.list().some(item=>item.state==='pending_user'));
    const [card]=f.app.interactions.list();assert.equal(card?.id,seen,'Homer must inspect before a card is shown');
    await until(()=>f.events.some(message=>message.type==='coordination'&&message.text==='Please confirm the proposed operation.'));
    assert.equal(await f.app.message('unrelated','other-user-message'),'Recorded');assert.equal(resolved,false);
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

test('a received archive input cannot create another Task on restart after a lost response',async()=>{
  const f=fixture();let original='',followup='',workerId='',lost=false,recovered=false;
  try{
    f.setScript(async(main,text)=>{
      if(text==='prepare'){
        const assigned=await openTaskWorker(main,'Original completed goal');
        original=assigned.taskId;
        await main.call('worker_interrupt',{workerId:assigned.workerId});
      }else if(text==='archive')await main.call('archive_work',{taskId:original});
      else if(text.includes('"kind":"task_archived"')){
        if(!lost){
          const {taskId}=await main.call('task_create',{title:'Inspect authorized temporary resources',goal:'Inspect authorized temporary resources'});
          const opened=await main.call('worker_open',{taskId},'committed-open');
          followup=opened.taskId;workerId=opened.workerId;
          assert.equal((await main.call('worker_open',{taskId},'committed-open')).workerId,workerId);
          lost=true;throw Error('synthetic_response_lost');
        }
      }else if(text==='review archive originals'){
        const view=await main.call('work_inspect',{taskId:followup});assert.ok(view.workers.some((worker:any)=>worker.workerId===workerId));recovered=true;
      }
      return {status:'completed',text:['prepare','review archive originals'].includes(text)?'Reviewed':'',messages:[]};
    });
    await f.app.start();await f.app.message('prepare','archive-prepare');await f.app.message('archive','archive-request');
    await until(()=>lost);await f.app['mainQueue'];
    assert.equal(f.app.store.db.prepare("SELECT r.state FROM agent_receipts r JOIN agent_messages m ON m.id=r.messageId WHERE m.kind='task_archived'").get()!.state,'received');
    await f.restart();await f.app.idle();assert.equal(recovered,false);
    await f.app.message('review archive originals','review-archive');assert.equal(recovered,true);await f.app.idle();
    assert.equal(f.app.tasks.tasks().length,2);assert.equal(f.app.tasks.workers(followup).length,1);
  }finally{await f.close();}
});

test('a mismatched resumed native thread cannot replace the durable Worker binding',async()=>{
  const f=fixture();let workerId='',followed=false;
  try{
    f.setScript(async(main,text)=>{
      if(text==='start'){
        workerId=(await openTaskWorker(main,'First')).workerId;
      }else if(!followed){followed=true;await main.call('worker_message',{workerId,message:'Follow up'});}
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
        await openTaskWorker(main,'Ask one question');
      }else if(text.includes('interaction_required')){
        const request=f.app.interactions.list().find(item=>item.source==='ask_main')!;
        await callEngineMcp(main, 'inspect_interaction',{interactionId:request.id});
        await callEngineMcp(main, 'respond_interaction',{interactionId:request.id,action:'answer',answer:'Use A',reason:'Within the original synthetic goal'});
      }
      return {status:'completed',text:text==='start'?'Started':'',messages:[]};
    });
    await f.app.start();await f.app.message('start','question-source');
    await until(()=>f.engines.some(engine=>engine.options.role==='worker'&&engine.finish));
    const worker=f.engines.find(engine=>engine.options.role==='worker')!;
    let answer='';
    worker.steer=async(turnId,text)=>{assert.equal(turnId,worker.turnId);answer=text.slice(text.indexOf('\n')+1);return {turnId};};
    const pending=await worker.call('ask_main',{question:'A or B?'});assert.equal(pending.status,'pending');
    await until(()=>!!f.app.interactions.inspect(pending.interactionId).deliveredAt);assert.equal(answer,'Use A');
    assert.ok(f.app.interactions.list().find(item=>item.source==='ask_main')!.deliveredAt);
    worker.finish!({status:'completed',text:'Used A',messages:[{itemId:'answer',phase:'final_answer',text:'Used A'}]});await f.app.idle();
    assert.equal(f.app.store.db.prepare("SELECT r.state FROM agent_receipts r JOIN agent_messages m ON m.id=r.messageId WHERE m.kind='interaction_required'").get()!.state,'received');
  }finally{await f.close();}
});

test('a committed staged attachment replays its native receipt after the source is revoked',async()=>{
  const f=fixture();let ref:{assetId:string;revision:number},taskId='',runId='';
  try{
    f.setScript(async(main,text)=>{
      if(text.startsWith('start'))({taskId,runId}=await openTaskWorker(main,"Stage the assigned source",'Stage the assigned source',{attachments:[ref]}));
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
    const output=join(f.app.files.outputs,taskId,runId);
    assert.equal(existsSync(output),false);
    const blocked=join(f.app.files.outputs,taskId);
    writeFileSync(blocked,'Synthetic path collision');
    try{await assert.rejects(worker.call('stage_file_result',args,'blocked-stage'),/EEXIST|ENOTDIR/);}
    finally{unlinkSync(blocked);}
    const receipt=await worker.call('stage_file_result',args,'original-stage');
    assert.equal(receipt.path,join(output,'source.txt'));
    assert.deepEqual(readFileSync(receipt.path),Buffer.from('Synthetic staged bytes'));
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
  const f=fixture();
  try{
    const privatePath=join(f.app.config.runtime,'private-control.txt'),publicPath=join(f.app.config.workspace,'public-report.txt');
    writeFileSync(privatePath,'Synthetic private control');writeFileSync(publicPath,'Synthetic public report');
    f.setScript(async(main,text)=>{
      if(text==='read'){
        await main.call('task_create',{title:"Read synthetic work",goal:'Read synthetic work',workingDirectory:'/'});
        const final=`[Private](${pathToFileURL(privatePath).href}) [Report](${pathToFileURL(publicPath).href})`;
        return {status:'completed',text:final,messages:[{itemId:'linked-final',phase:'final_answer',text:final}]};
      }
      return {status:'completed',text:'Checked'};
    });
    await f.app.start();const text=await f.app.message('read','file-boundary-source');
    assert.match(text,/部分文件未能保存/);
    const reply=f.app.store.db.prepare("SELECT replyId FROM conversation_inputs WHERE requestId='file-boundary-source'").get()!;
    const committed=f.app.readCommittedMessage(String(reply.replyId),{requestId:'file-boundary-source'});
    assert.equal(committed?.attachments?.length,1);
    assert.equal(f.app.media.readAttachment(committed!.attachments![0]!).bytes.toString(),'Synthetic public report');
  }finally{await f.close();}
});

test('a dispatched Worker can read its exact attachment before the user turn ends',async()=>{
 const f=fixture();
 let ref:{assetId:string;revision:number},release!:()=>void;
 const mainEnd=new Promise<void>(resolve=>{release=resolve;});
 try{
  f.setScript(async(main,text)=>{
   if(text.startsWith('delegate')){
    await openTaskWorker(main,"Read the current input",'Read the current input',{attachments:[ref]});
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

test('Main can finish coordination while a durable answer awaits Worker startup',async()=>{
 const f=fixture();let questionId='',attempted=false;
 try{
  f.setScript(async(main,text)=>{
   if(text==='start'){
    const w=await openTaskWorker(main,'Ask about format');
    await until(()=>f.engines.some(e=>e.options.role==='worker'&&e.finish));
    const worker=f.engines.find(e=>e.options.role==='worker')!;
    questionId=(await worker.call('ask_main',{question:'Which format?'})).interactionId;
    worker.finish!({status:'completed',text:'Awaiting format'});
    await until(()=>f.app.tasks.run(w.runId).status==='succeeded');
   }else if(text.includes('interaction_required')){
    await callEngineMcp(main,'inspect_interaction',{interactionId:questionId});
    const answer={interactionId:questionId,action:'answer',answer:'Markdown',reason:'Original request'};
    await assert.rejects(callHostMcp(main.options,'respond_interaction',answer),/schedule_call_scope_denied/);
    assert.equal(f.app.interactions.inspect(questionId).state,'pending_main');
    const result=await callEngineMcp(main,'respond_interaction',answer);
    assert.equal(result.delivery,'queued');attempted=true;
   }
   return {status:'completed',text:text==='start'?'Started':''};
  });
  await f.app.start();
  const claim=f.app.tasks.claim.bind(f.app.tasks);
  f.app.tasks.claim=(id?:string)=>questionId?undefined:claim(id);
  await f.app.message('start','queued-answer-source');
  await until(()=>attempted);
  await f.app['mainQueue'];
  assert.equal(f.app.interactions.inspect(questionId).deliveredAt,null);
  assert.equal(f.app.store.db.prepare("SELECT code FROM events WHERE type='internal_processing_failed'").get(),undefined);
  f.app.tasks.claim=claim;f.app['pump']();
  await until(()=>!!f.app.interactions.inspect(questionId).deliveredAt);
  const receiver=f.engines.at(-1)!;assert.match(receiver.input!,/Markdown/);
  receiver.finish!({status:'completed',text:'Used Markdown'});await f.app.idle();
 }finally{await f.close();}
});
