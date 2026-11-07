// Actual isolated host process crash/shutdown; scripted engine, no model/account.
import assert from 'node:assert/strict';
import {fork,spawn} from 'node:child_process';
import {once} from 'node:events';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {test,type TestContext} from 'node:test';
import {restartHost} from './fixtures/task-restart-host.js';
import {processIdentity,terminateLease} from '../src/processes.js';

async function restart(t:TestContext,scenario:string,crash:boolean,desktop=false){
 const base=resolve('.codex/scratch');mkdirSync(base,{recursive:true});const root=mkdtempSync(join(base,'task-restart-'));
 const child=fork(new URL('./fixtures/task-restart-host.ts',import.meta.url),[root,scenario],{execArgv:['--import','./tests/fixtures/core-system-proxy.mjs','--import','tsx'],stdio:['ignore','ignore','inherit','ipc'],env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,HOME:root,CODEX_HOME:join(root,'empty-home')}}),exited=once(child,'exit');
 let host:ReturnType<typeof restartHost>|undefined;
 t.after(async()=>{try{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}await host?.app.close();}finally{rmSync(root,{recursive:true,force:true});}});
 if(['closed-before-return','queued-before-start','message-before-commit','message-after-commit'].includes(scenario)||scenario.startsWith('stop-intent:')||scenario.startsWith('steer-intent:'))assert.equal((await exited)[0],74);
 else{
  const [ready]=await Promise.race([once(child,'message'),exited.then(([code])=>{throw Error('seed exited before checkpoint: '+code);})]);assert.equal(ready,'ready');
  if(crash)child.kill('SIGKILL');else child.send('close');const [code,signal]=await exited;if(crash)assert.equal(signal,'SIGKILL');else assert.equal(code,0);
 }
 const f=host=restartHost(root,scenario,false,desktop);await f.app.start();
 return {...f,root,workerStarts:()=>readFileSync(join(root,'starts'),'utf8').trim().split('\n')};
}

for(const crash of [false,true])for(const desktop of [false,true])test(`original raw reply and bytes survive ${crash?'crash':'shutdown'}, desktop pause=${desktop}`,{timeout:15000},async t=>{
 const {app,workerStarts,attempts}=await restart(t,'reply',crash,desktop),task=app.tasks.tasks()[0]!,run=app.store.runs()[0]!;
 assert.equal(app.store.db.prepare("SELECT 1 FROM sqlite_master WHERE name='results'").get(),undefined);assert.equal(task.state,'open');assert.equal(task.outcome,null);
 assert.equal(readFileSync(join(app.files.prepareRun(task.id,run.id),'report.md'),'utf8'),'# Synthetic preserved bytes');
 await app.message('read','find-existing-reply');assert.equal(attempts[0]!.status,'fulfilled');const reply=attempts[0]!.value.messages.find((message:any)=>message.kind==='worker_reply');assert.equal(reply.text,'Synthetic report; date unknown.');
 await app.message(desktop?'settle':'send','send-original');
 if(attempts[1]?.status==='rejected')throw attempts[1].reason;
 assert.equal(app.tasks.task(task.id).outcome,'succeeded');
 if(!desktop){
  const committed=attempts[1]!.value,message=app.history.message(committed.messageId)!;
  assert.equal(app.media.readAttachment(message.attachments![0]!).bytes.toString(),'# Synthetic preserved bytes');
 }
 assert.equal(workerStarts().length,1);
});

for(const [scenario,crash] of [['running',false],['uncertain-owner',true],['queued-before-start',true]] as const)for(const desktop of [false,true])test(`followup resumes only the confirmed original conversation: ${scenario}, desktop pause=${desktop}`,{timeout:15000},async t=>{
 if(process.platform==='win32'&&scenario==='uncertain-owner'){await assert.rejects(restart(t,scenario,crash,desktop),/orphan_stop_unconfirmed|desktop_adoption_owner_unknown/);return;}
 const {app,workerStarts,attempts}=await restart(t,scenario,crash,desktop),original=app.store.runs()[0]!;
 await app.message('followup','followup-request');await app.idle();assert.equal(attempts[0]!.status,'fulfilled');
 const runs=app.tasks.runs(original.taskId);assert.equal(runs.length,2);assert.equal(runs[1]!.workerId,original.workerId);assert.equal(runs[1]!.version,1);assert.equal(runs[1]!.status,'succeeded');
 if(original.threadId)assert.equal(runs[1]!.threadId,original.threadId);assert.equal(workerStarts().length,scenario==='queued-before-start'?1:2);
});

for(const crash of [false,true])for(const desktop of [false,true])test(`changed goal stays bound to the new version after ${crash?'crash':'shutdown'}, desktop pause=${desktop}`,{timeout:15000},async t=>{
 const {app,workerStarts}=await restart(t,'goal-change',crash,desktop),original=app.store.runs()[0]!,task=app.tasks.tasks()[0]!;assert.equal(task.headVersion,2);assert.equal(task.outcome,null);
 const before=app.store.db.prepare("SELECT payloadJson FROM agent_messages WHERE senderRunId=? AND kind='worker_reply'").get(original.id)!;assert.equal(JSON.parse(String(before.payloadJson)).version,1);
 await app.message('followup','followup-new-requirement');await app.idle();const latest=app.tasks.runs(task.id).at(-1)!;
 assert.equal(latest.version,2);assert.equal(latest.sourceRequestId,'changed-source');assert.equal(latest.workerId,original.workerId);assert.equal(latest.threadId,original.threadId);assert.equal(workerStarts().length,2);
 assert.equal(app.store.db.prepare("SELECT payloadJson FROM agent_messages WHERE senderRunId=? AND kind='worker_reply'").get(original.id)!.payloadJson,before.payloadJson);
});

for(const scenario of ['written-before-terminal','checkpoint','closed-before-return'])for(const desktop of [false,true])test(`crash preserves the exact output at ${scenario}, desktop pause=${desktop}`,{timeout:15000},async t=>{
 if(process.platform==='win32'&&scenario!=='closed-before-return'){await assert.rejects(restart(t,scenario,true,desktop),/orphan_stop_unconfirmed|desktop_adoption_owner_unknown/);return;}
 const {app,workerStarts,attempts}=await restart(t,scenario,true,desktop),run=app.store.runs()[0]!;
 await app.message(desktop?'settle':'send','send-crash-file');
 if(attempts[0]?.status==='rejected')throw attempts[0].reason;
 assert.equal(app.tasks.tasks()[0]!.outcome,'succeeded');assert.equal(workerStarts().length,1);
 if(desktop)assert.equal(readFileSync(join(app.files.prepareRun(run.taskId,run.id),'report.md'),'utf8'),'# Synthetic preserved bytes');
 else{
  const message=app.history.message(attempts[0]!.value.messageId)!;
  assert.equal(app.media.readAttachment(message.attachments![0]!).bytes.toString(),'# Synthetic preserved bytes');
 }
 const replies=app.store.db.prepare("SELECT payloadJson FROM agent_messages WHERE kind='worker_reply' AND senderRunId=?").all(run.id);assert.equal(replies.length,1);assert.equal(JSON.parse(String(replies[0]!.payloadJson)).text,'Synthetic report; date unknown.');
});

test('missing physical exit evidence preserves the original fence and prevents a new writer',{timeout:15000},async t=>{
 const {app,workerStarts,attempts}=await restart(t,'missing-owner',true),run=app.store.runs()[0]!;assert.equal(app.tasks.run(run.id).phase,'uncertain');
 await app.message('followup','followup-request');await app.idle();assert.equal(attempts[0]!.status,'fulfilled');assert.equal(attempts[0]!.value.runId,null);
 assert.equal(workerStarts().length,1);assert.equal(app.store.runs().length,1);assert.equal(app.tasks.task(run.taskId).outcome,null);
});

for(const [action,state,outcome,version] of [['pause','paused',null,1],['cancel','settled','cancelled',1],['change-goal','open',null,2],['interrupt','open',null,1]] as const)
for(const desktop of [false,true])test(`restart confirms the original ${action} stop intent after proven exit, desktop pause=${desktop}`,{timeout:15000},async t=>{
 const {app,workerStarts}=await restart(t,'stop-intent:'+action,true,desktop);
 const task=app.tasks.tasks()[0]!,run=app.store.runs()[0]!;
 const operation=app.store.db.prepare("SELECT id,state,responseJson FROM operations WHERE kind IN ('task_control','task_update','worker_stop')").get()!;
 assert.equal(operation.state,'confirmed');
 assert.equal(JSON.parse(String(operation.responseJson)).operationKey,operation.id);
 assert.equal(task.controlState,'normal');assert.equal(task.state,state);assert.equal(task.outcome,outcome);assert.equal(task.headVersion,version);
 assert.equal(run.status,'cancelled');assert.equal(run.phase,'ended');
 assert.equal(app.store.db.prepare("SELECT count(*) n FROM agent_messages WHERE senderRunId=? AND kind='worker_reply'").get(run.id)?.n,1);
 assert.equal(workerStarts().length,1);
});

for(const state of ['accepted','dispatching'] as const)for(const desktop of [false,true])test(`restart distinguishes ${state} steer from a confirmed send, desktop pause=${desktop}`,{timeout:15000},async t=>{
 const scenario='steer-intent:'+state;
 if(process.platform==='win32'){await assert.rejects(restart(t,scenario,true,desktop),/orphan_stop_unconfirmed|desktop_adoption_owner_unknown/);return;}
 const {app,workerStarts,attempts}=await restart(t,scenario,true,desktop),original=app.store.runs()[0]!;
 const operation=app.store.db.prepare("SELECT state,detailsJson FROM operations WHERE kind='worker_steer'").get()!;
 const receipt=app.store.db.prepare('SELECT state FROM agent_receipts WHERE messageId=?').get(JSON.parse(String(operation.detailsJson)).messageId)!;
 assert.equal(operation.state,state==='accepted'?'failed':'uncertain');
 if(state==='accepted')assert.equal(receipt.state,'rejected');else assert.notEqual(receipt.state,'processed');
 await app.message('followup','after-steer-recovery');await app.idle();
 if(state==='dispatching'){
  assert.equal(attempts[0]?.status,'rejected');assert.match(String((attempts[0] as PromiseRejectedResult).reason),/operation_uncertain/);
  assert.equal(app.tasks.runs(original.taskId).length,1);assert.equal(workerStarts().length,1);
 }else{
  assert.equal(attempts[0]?.status,'fulfilled');
  const successor=app.tasks.runs(original.taskId)[1]!;assert.equal(successor.workerId,original.workerId);assert.equal(successor.threadId,original.threadId);
  assert.equal(workerStarts().length,2);
 }
});

for(const scenario of ['message-before-commit','message-after-commit'] as const)for(const desktop of [false,true])test(`local message and attachment recover exactly once after ${scenario}, desktop pause=${desktop}`,{timeout:15000},async t=>{
 const {app,workerStarts}=await restart(t,scenario,true,desktop),before=scenario==='message-before-commit';
 const stages=app.store.db.prepare("SELECT * FROM operations WHERE kind='attachment_stage'").all();
 assert.equal(stages.length,1);assert.equal(stages[0]!.state,before?'failed':'confirmed');
 const row=app.store.db.prepare("SELECT state,detailsJson,responseJson FROM operations WHERE kind='send_user_message'").get()!;
 if(before){
  assert.equal(row.state,'failed');
  assert.equal(row.responseJson,null);
  assert.equal(JSON.parse(String(row.detailsJson)).failureCode,'message_not_committed');
  assert.equal(app.store.db.prepare('SELECT count(*) n FROM media_pins').get()!.n,0);
  const [{assetId}]=JSON.parse(String(stages[0]!.responseJson));
  assert.equal(existsSync(join(app.config.runtime,'media',assetId)),false);
  assert.equal(app.history.list(app.store.meta('mainThread')!).filter(m=>m.attachments?.length).length,0);
 }else{
  assert.equal(row.state,'confirmed');
  const receipt=JSON.parse(String(row.responseJson)),message=app.history.message(receipt.messageId)!;
  assert.equal(message.text,'Synthetic report');
  assert.equal(app.media.readAttachment(message.attachments![0]!).bytes.toString(),'# Synthetic preserved bytes');
  assert.equal(app.store.db.prepare("SELECT count(*) n FROM media_pins WHERE scope=?").get('message:'+message.id)!.n,1);
  assert.equal(app.history.list(app.store.meta('mainThread')!).filter(m=>m.attachments?.length).length,1);
 }
 const run=app.store.runs()[0]!;
 assert.equal(readFileSync(join(app.files.prepareRun(run.taskId,run.id),'report.md'),'utf8'),'# Synthetic preserved bytes');
 assert.equal(workerStarts().length,1);
});

if(process.platform!=='win32')test('a dead lease owner with a surviving process group is not a confirmed exit',async t=>{
 const program="const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});process.send(child.pid);";
 const owner=spawn(process.execPath,['-e',program],{detached:true,stdio:['ignore','ignore','ignore','ipc']}),exited=once(owner,'exit');t.after(()=>{try{process.kill(-owner.pid!,'SIGKILL');}catch{}});await once(owner,'message');
 const lease={pid:owner.pid!,identity:processIdentity(owner.pid!)!};assert.ok(lease.identity);owner.kill('SIGKILL');await exited;assert.equal(await terminateLease(lease),false);
});
