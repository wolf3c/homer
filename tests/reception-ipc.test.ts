import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { mkdtempSync,mkdirSync,rmSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { once } from 'node:events';
const until=async(check:()=>boolean)=>{const end=Date.now()+8000;while(!check()){if(Date.now()>end)throw Error('synthetic_ipc_timeout');await new Promise(r=>setTimeout(r,5));}};
test('real host IPC: dedicated notifications survive filtered output; GET is pure; feedback invalidates; payload contains no content',async()=>{
 const parent=resolve('.codex/scratch/main-agent-reception-optimization');mkdirSync(parent,{recursive:true});const base=mkdtempSync(join(parent,'ipc-host-'));mkdirSync(join(base,'runtime'));
 const child=fork(resolve('dist/dev-host.js'),[],{stdio:['ignore','ignore','ignore','ipc'],execArgv:['--disable-warning=ExperimentalWarning']});
 const exited=once(child,'exit'),messages:any[]=[];let next=0;
 child.on('message',(message:any)=>{messages.push(message);if(message.kind==='output')child.send({kind:'written',id:message.id});});
 const rpc=async(method:string,input:unknown={})=>{const id='synthetic-ipc-'+ ++next;child.send({kind:'web',id,method,input});await until(()=>messages.some(message=>message.kind==='web_result'&&message.id===id));const response=messages.find(message=>message.kind==='web_result'&&message.id===id);if(response.error)throw Error(response.error);return response.value;};
 try{
  child.send({kind:'init',config:{runtime:join(base,'runtime'),workspace:join(base,'workspace'),codexHome:join(base,'empty-home'),codexBin:resolve('tests/fixtures/reception-app-server.mjs'),model:'synthetic-only',requiresOpenaiAuth:false,stopGraceMs:100},webUploadProtocol:1});
  await until(()=>messages.some(message=>message.kind==='ready'||message.kind==='fatal'));assert.equal(messages.find(message=>message.kind==='ready')?.stateInvalidationProtocol,1);
  const receipt=await rpc('submit',{requestId:'synthetic-ipc-input',text:'Synthetic private input excluded from notifications'});
  let state:any;const end=Date.now()+4000;
  do{state=await rpc('state');if(state.messages.some((item:any)=>item.role==='user'&&item.requestId==='synthetic-ipc-input'&&item.inputState==='completed'))break;if(Date.now()>end)throw Error('synthetic_turn_timeout');await new Promise(r=>setTimeout(r,10));}while(true);
  const invalidations=messages.filter(message=>message.kind==='state_invalidated');assert.ok(invalidations.length>=3);
  for(const message of invalidations)assert.deepEqual(message,{kind:'state_invalidated',protocol:1});
  assert.ok(!messages.some(message=>message.kind==='output'&&['main_start','main_terminal','tool_progress'].includes(message.message.type)));
  const process=state.processNodes.find((node:any)=>node.replyMessageId===receipt.replyId);assert.ok(process);
  assert.equal(state.queue.length,0);assert.equal(process.state,'worked');assert.equal(process.status,'completed');
  assert.deepEqual(process.items.filter((item:any)=>item.phase==='final_answer').map((item:any)=>item.text),['Synthetic final answer']);
  await new Promise(r=>setTimeout(r,100));const before=messages.filter(message=>message.kind==='state_invalidated').length;
  await Promise.all([rpc('state'),rpc('state')]);await new Promise(r=>setTimeout(r,180));assert.equal(messages.filter(message=>message.kind==='state_invalidated').length,before);
  await rpc('feedback',{messageId:process.messageId,value:'up'});await until(()=>messages.filter(message=>message.kind==='state_invalidated').length>before);
  assert.equal((await rpc('state')).messages.find((item:any)=>item.id===process.messageId).feedback,'up');
 }finally{if(child.connected)child.send({kind:'stop'});await exited;rmSync(base,{recursive:true,force:true});}
});

test('real host IPC: plain terminal skips hundreds of discarded deltas after channels; streaming and legacy callers retain ordered written fences',{timeout:30000},async t=>{
 const parent=resolve('.codex/scratch/main-agent-reception-optimization');mkdirSync(parent,{recursive:true});
 for(const [terminalDeltas,count] of [[false,300],[false,1],[true,300],[undefined,3]] as const){
  const base=mkdtempSync(join(parent,'ipc-delta-mode-'));mkdirSync(join(base,'runtime'));
  const child=fork(resolve('dist/dev-host.js'),[],{stdio:['ignore','ignore','ignore','ipc'],execArgv:['--disable-warning=ExperimentalWarning','--import',resolve('tests/fixtures/reception-channel-observer.mjs')]});
  const exited=once(child,'exit'),messages:any[]=[],pending:string[]=[];let next=0,draining=false;
  const acknowledge=async()=>{while(pending.length&&child.connected){const id=pending.shift()!;await new Promise(r=>setTimeout(r,1));if(child.connected)child.send({kind:'written',id});}};
  child.on('message',(message:any)=>{
   messages.push(message);if(message.kind!=='output')return;
   if(message.message.type==='delta'){pending.push(message.id);if(draining)void acknowledge();return;}
   child.send({kind:'written',id:message.id});
  });
  const rpc=async(method:string,input:unknown={})=>{const id='synthetic-delta-rpc-'+ ++next;child.send({kind:'web',id,method,input});await until(()=>messages.some(m=>m.kind==='web_result'&&m.id===id));const response=messages.find(m=>m.kind==='web_result'&&m.id===id);if(response.error)throw Error(response.error);return response.value;};
  try{
   child.send({kind:'init',terminalDeltas,config:{runtime:join(base,'runtime'),workspace:join(base,'workspace'),codexHome:join(base,'empty-home'),codexBin:resolve('tests/fixtures/reception-app-server.mjs'),model:'synthetic-only',requiresOpenaiAuth:false,stopGraceMs:100}});
   await until(()=>messages.some(m=>m.kind==='ready'));
   for(let i=0;i<2;i++)await rpc('submit',{requestId:'synthetic-delta-'+i,text:'Synthetic delta mode input synthetic:delta-count='+count});
   await until(()=>messages.some(m=>m.kind==='synthetic_start_blocked'));
   assert.equal((await rpc('state')).queue.find((item:any)=>item.input.requestId==='synthetic-delta-1')?.state,'queued','the next input is already queued before channel deltas drain');
   child.send({kind:'synthetic_release_start'});
   await until(()=>messages.some(m=>m.kind==='output'&&m.message.requestId==='synthetic-delta-0'&&['delta','reply'].includes(m.message.type)));
   if(terminalDeltas===false){
    assert.equal(pending.length,0,'plain terminal must not wait for any discarded delta written receipt');
   }else{
    assert.equal(pending.length,1,'one ordered delta is in flight until written');
    const waiting=await rpc('state');assert.equal(waiting.queue.find((item:any)=>item.input.requestId==='synthetic-delta-1')?.state,'queued');
    draining=true;await acknowledge();
   }
   await until(()=>messages.some(m=>m.kind==='output'&&m.message.type==='reply'&&m.message.requestId==='synthetic-delta-1'));
   const state=await rpc('state');assert.equal(state.queue.length,0);
   assert.deepEqual(state.messages.filter((item:any)=>item.role==='user').map((item:any)=>[item.requestId,item.inputState]),[['synthetic-delta-0','completed'],['synthetic-delta-1','completed']]);
   for(let i=0;i<2;i++){
    const requestId='synthetic-delta-'+i,events=messages.filter(m=>(m.requestId??m.message?.requestId)===requestId);
    const observed=events.filter(m=>m.kind==='synthetic_channel_observed');
    assert.deepEqual(observed.map(m=>[m.channel,m.type]),['main_start',...Array(count).fill('delta'),'main_terminal','reply'].flatMap(type=>[['wechat',type],['telegram',type]]));
    const ipc=events.filter(m=>m.kind==='output');
    assert.deepEqual(ipc.map(m=>m.message.type),[...Array(terminalDeltas===false?0:count).fill('delta'),'reply']);
    if(terminalDeltas!==false)assert.deepEqual(ipc.filter(m=>m.message.type==='delta').map(m=>m.message.text),Array.from({length:count},(_,n)=>`Synthetic-${n};`));
    // The full stream still reached history/process projection and Web reads.
    assert.ok(JSON.stringify(state.processNodes).includes(Array.from({length:count},(_,n)=>`Synthetic-${n};`).join('')));
   }
   t.diagnostic(JSON.stringify({terminalDeltas:terminalDeltas??'legacy',deltasPerInput:count,inputs:2,deltaIPC:messages.filter(m=>m.kind==='output'&&m.message.type==='delta').length,channelDeltas:messages.filter(m=>m.kind==='synthetic_channel_observed'&&m.type==='delta').length}));
  }finally{
   draining=true;if(child.connected)child.send({kind:'synthetic_release_start'});await acknowledge();if(child.connected)child.send({kind:'stop'});await exited;rmSync(base,{recursive:true,force:true});
  }
 }
});

test('real host IPC: withheld delta and reply written acknowledgements locate tail waiting without starting the next queued input',async()=>{
 const parent=resolve('.codex/scratch/main-agent-reception-optimization');mkdirSync(parent,{recursive:true});const base=mkdtempSync(join(parent,'ipc-tail-'));mkdirSync(join(base,'runtime'));
 const child=fork(resolve('dist/dev-host.js'),[],{stdio:['ignore','ignore','ignore','ipc'],execArgv:['--disable-warning=ExperimentalWarning']});
 const exited=once(child,'exit'),messages:any[]=[];let next=0,deltaId:string|undefined,replyId:string|undefined,releasedDelta=false,releasedReply=false;
 child.on('message',(message:any)=>{
  messages.push(message);if(message.kind!=='output')return;
  if(message.message.requestId==='synthetic-ipc-tail-0'){
   if(message.message.type==='delta'&&!releasedDelta){deltaId??=message.id;return;}
   if(message.message.type==='reply'&&!releasedReply){replyId=message.id;return;}
  }
  child.send({kind:'written',id:message.id});
 });
 const rpc=async(method:string,input:unknown={})=>{const id='synthetic-tail-rpc-'+ ++next;child.send({kind:'web',id,method,input});await until(()=>messages.some(message=>message.kind==='web_result'&&message.id===id));const response=messages.find(message=>message.kind==='web_result'&&message.id===id);if(response.error)throw Error(response.error);return response.value;};
 const timings=async()=>{const count=messages.filter(message=>message.kind==='timings').length;child.send({kind:'timings'});await until(()=>messages.filter(message=>message.kind==='timings').length>count);return messages.filter(message=>message.kind==='timings').at(-1)!.diagnostics;};
 const waitReport=async(check:(report:any)=>boolean)=>{const end=Date.now()+8000;for(;;){const report=await timings();if(check(report))return report;if(Date.now()>end)throw Error('synthetic_tail_report_timeout');await new Promise(r=>setTimeout(r,5));}};
 try{
  child.send({kind:'init',config:{runtime:join(base,'runtime'),workspace:join(base,'workspace'),codexHome:join(base,'empty-home'),codexBin:resolve('tests/fixtures/reception-app-server.mjs'),model:'synthetic-only',requiresOpenaiAuth:false,stopGraceMs:100}});
  await until(()=>messages.some(message=>message.kind==='ready'));
  for(let i=0;i<6;i++)await rpc('submit',{requestId:'synthetic-ipc-tail-'+i,text:'Synthetic content omitted from diagnostics '+i});
  let report=await waitReport(report=>report.records.some((row:any)=>row.requestId==='synthetic-ipc-tail-0'&&row.phase==='output_wait_start'));
  const phases=report.records.filter((row:any)=>row.requestId==='synthetic-ipc-tail-0').map((row:any)=>row.phase);
  const boundaries=['native_completed','background_refreshed','engine_settled','host_finalize_start','host_finalize_end','output_wait_start'];
  for(const [index,phase] of boundaries.entries())assert.ok(phases.indexOf(phase)>=0&&(index===0||phases.indexOf(phase)>phases.indexOf(boundaries[index-1]!)),phase);
  assert.ok(deltaId);assert.ok(report.outputPending.some((row:any)=>row.outputId===deltaId&&row.requestId==='synthetic-ipc-tail-0'&&row.sentAt));
  assert.ok(!JSON.stringify(report).includes('Synthetic content omitted'));
  const state=await rpc('state');assert.deepEqual(state.queue.map((item:any)=>[item.input.requestId,item.state]),Array.from({length:5},(_,i)=>['synthetic-ipc-tail-'+(i+1),'queued']));
  assert.equal(state.messages.find((item:any)=>item.role==='user'&&item.requestId==='synthetic-ipc-tail-0').inputState,'completed');
  assert.equal(state.processNodes[0].state,'worked');assert.ok(!report.records.some((row:any)=>row.requestId==='synthetic-ipc-tail-1'&&row.phase==='native_start'));
  releasedDelta=true;child.send({kind:'written',id:deltaId});await until(()=>!!replyId);
  report=await timings();assert.ok(report.outputPending.some((row:any)=>row.outputId===replyId));
  assert.ok(report.records.some((row:any)=>row.requestId==='synthetic-ipc-tail-0'&&row.phase==='reply_delivery_start'));
  assert.ok(!report.records.some((row:any)=>row.requestId==='synthetic-ipc-tail-0'&&row.phase==='reply_delivery_end'));
  releasedReply=true;child.send({kind:'written',id:replyId});
  report=await waitReport(report=>report.records.some((row:any)=>row.requestId==='synthetic-ipc-tail-5'&&row.phase==='round_end'));
  const records=report.records.filter((row:any)=>row.outputId===replyId);
  for(const phase of ['output_ipc_start','output_ipc_sent','output_ipc_ack'])assert.ok(records.some((row:any)=>row.phase===phase),phase);
  assert.equal(report.outputPending.length,0);const finished=await rpc('state');assert.equal(finished.queue.length,0);
  assert.deepEqual(finished.messages.filter((item:any)=>item.role==='user').map((item:any)=>[item.requestId,item.inputState]),Array.from({length:6},(_,i)=>['synthetic-ipc-tail-'+i,'completed']));
 }finally{
  releasedDelta=releasedReply=true;if(child.connected){if(deltaId)child.send({kind:'written',id:deltaId});if(replyId)child.send({kind:'written',id:replyId});child.send({kind:'stop'});}
  await exited;rmSync(base,{recursive:true,force:true});
 }
});
