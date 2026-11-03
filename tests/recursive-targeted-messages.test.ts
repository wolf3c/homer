// Requirements-derived synthetic fixtures only; no live DB, engine or channels.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, delegate, running, main, contract } from './recursive-fixture.js';
import type { Actor } from '../src/recursive-tasks.js';
import { Homer } from '../src/service.js';
import {MainInputs} from '../src/recursive-main-inputs.js';
import {ConversationHistory} from '../src/web-history.js';
type F = ReturnType<typeof fixture>;
function send(f:F, taskId:string, operationId:string, targetRunId?:string) {
  const t=f.tasks.task(taskId);
  return f.tasks.send(main,{operationId,taskId,version:t.headVersion,expectedTaskRevision:t.revision,recipientAgentId:t.executorAgentId,kind:'synthetic',payload:{fixture:true},...(targetRunId?{targetRunId}:{})});
}
function replace(f:F, actor:Actor, taskId:string) {
  f.tasks.failRun(actor.runId!,actor.epoch!,'synthetic_attempt_failure');
  const t=f.tasks.task(taskId);
  const result=f.tasks.update(main,{operationId:'replace',taskId,version:t.headVersion,expectedTaskRevision:t.revision,mode:'stop_replace',contract:contract(),children:[],queuedDisposition:[]});
  assert.ok(result.runId);return {...result,runId:result.runId};
}
const receipt=(f:F,id:string)=>f.store.db.prepare('SELECT * FROM agent_receipts WHERE messageId=?').get(id)!;
const ack=(f:F,actor:Actor,id:string,operationId='ack')=>f.tasks.ack(actor,{operationId,messageId:id,disposition:'processed',reason:'Synthetic verified consumption'});

test('F3: replacement Run never offers or reads old targeted input; history and original receipt remain intact',()=>{
 const f=fixture();try {
  const a=delegate(f),old=running(f,a.taskId),message=send(f,a.taskId,'target',old.runId),untargeted=send(f,a.taskId,'untargeted');
  const before=receipt(f,message.messageId);replace(f,old,a.taskId);const next=running(f,a.taskId);
  assert.notEqual(next.runId,old.runId);
  assert.deepEqual(receipt(f,message.messageId),before);
  assert.deepEqual(f.tasks.inbox(next).map(m=>m.id),[untargeted.messageId]);
  const history=f.store.db.prepare('SELECT targetRunId,payloadJson FROM agent_messages WHERE id=?').get(message.messageId)!;
  assert.equal(history.targetRunId,old.runId);assert.deepEqual(JSON.parse(String(history.payloadJson)),{fixture:true});
  ack(f,next,untargeted.messageId);assert.equal(receipt(f,untargeted.messageId).processedBy,next.runId);
 }finally{f.close();}
});
test('F3: new Run cannot ACK old target by fresh or previously confirmed operation key',()=>{
 for(const confirmed of [false,true]) {
  const f=fixture();try {
   const a=delegate(f),old=running(f,a.taskId),m=send(f,a.taskId,'target',old.runId);
   if(confirmed) {const first=ack(f,old,m.messageId);assert.deepEqual(ack(f,old,m.messageId),first);}
   replace(f,old,a.taskId);const next=running(f,a.taskId),before=receipt(f,m.messageId);
   for(const op of ['ack','fresh'])assert.throws(()=>ack(f,next,m.messageId,op),/message_target_stale/);
   assert.deepEqual(receipt(f,m.messageId),before);
  }finally{f.close();}
 }
});
test('F3: matching target claim/bind/ACK and idempotent retry preserve identity and fencing',()=>{
 const f=fixture();try {
  const a=delegate(f),m=send(f,a.taskId,'target',a.runId),actor=running(f,a.taskId);
  assert.equal(receipt(f,m.messageId).offeredRunId,actor.runId);assert.equal(receipt(f,m.messageId).state,'received');
  assert.equal(f.tasks.inbox(actor)[0]!.id,m.messageId);
  const result=ack(f,actor,m.messageId),before=receipt(f,m.messageId);assert.deepEqual(ack(f,actor,m.messageId),result);assert.deepEqual(receipt(f,m.messageId),before);
  for(const forged of [{...actor,epoch:actor.epoch!+1},{...actor,turnId:'foreign'},{...actor,agentId:main.agentId}])assert.throws(()=>ack(f,forged,m.messageId),/identity|epoch|live|recipient/);
  const b=delegate(f,'other'),other=running(f,b.taskId);assert.throws(()=>ack(f,other,m.messageId),/recipient/);
  f.tasks.failRun(actor.runId!,actor.epoch!,'synthetic_end');assert.throws(()=>ack(f,actor,m.messageId),/live|epoch/);
 }finally{f.close();}
});
test('F3: legacy wrong offer is not received at bind and cannot wake replacement wait',()=>{
 const f=fixture();try {
  const a=delegate(f),old=running(f,a.taskId),m=send(f,a.taskId,'target',old.runId);
  const next=replace(f,old,a.taskId);f.tasks.claim(next.runId);
  f.store.db.prepare("UPDATE agent_receipts SET state='offered',offeredRunId=?,offeredEpoch=? WHERE messageId=?").run(next.runId,f.tasks.run(next.runId).epoch,m.messageId);
  const before=receipt(f,m.messageId),r=f.tasks.run(next.runId);f.tasks.bind(r.id,r.epoch,'new-thread','new-turn');
  const actor={agentId:a.agentId,runId:r.id,epoch:r.epoch,threadId:'new-thread',turnId:'new-turn'};
  assert.deepEqual(receipt(f,m.messageId),before);
  const t=f.tasks.task(a.taskId),wait=f.tasks.wait(actor,{operationId:'wait-old',taskId:t.id,version:t.headVersion,expectedTaskRevision:t.revision,condition:{type:'message',messageId:m.messageId}});
  assert.equal(wait.state,'waiting');f.tasks.endSegment(r.id,r.epoch,{status:'completed',text:'Synthetic final result'},false);
  send(f,a.taskId,'unrelated');assert.equal(f.tasks.run(r.id).phase,'parked');
  assert.equal(f.store.db.prepare('SELECT state FROM run_waits WHERE id=?').get(wait.waitId)!.state,'armed');
 }finally{f.close();}
});
test('F3: matching Run message still wakes a parked wait, with no duplicate claim',()=>{
 const f=fixture();try {
  const a=delegate(f),actor=running(f,a.taskId),original=send(f,a.taskId,'request',actor.runId);
  ack(f,actor,original.messageId);
  const t=f.tasks.task(a.taskId),wait=f.tasks.wait(actor,{operationId:'wait-reply',taskId:t.id,version:t.headVersion,expectedTaskRevision:t.revision,condition:{type:'message',replyTo:original.messageId}});
  assert.equal(wait.state,'waiting');f.tasks.endSegment(actor.runId!,actor.epoch!,{status:'completed',text:'Synthetic final result'},false);
  // Synthetic legacy reply fixture: target and reply relation, without widening send reply authorization.
  const reply=send(f,a.taskId,'reply',actor.runId);f.store.db.prepare('UPDATE agent_messages SET replyTo=? WHERE id=?').run(original.messageId,reply.messageId);
  send(f,a.taskId,'wake');assert.equal(f.tasks.run(actor.runId!).phase,'ready');assert.ok(f.tasks.claim(actor.runId!));assert.equal(f.tasks.claim(actor.runId!),undefined);
 }finally{f.close();}
});
test('F3: known terminal target residue does not block idle, but uncertain and invalid source still block',()=>{
 const f=fixture();try {
  const a=delegate(f),actor=running(f,a.taskId),m=send(f,a.taskId,'target',actor.runId);
  assert.equal(f.tasks.safeToUpgrade(),false);f.tasks.failRun(actor.runId!,actor.epoch!,'synthetic_end');
  for(const n of f.tasks.inbox(main))ack(f,main,n.id,'main-'+n.id);
  const before=receipt(f,m.messageId);assert.equal(f.tasks.safeToUpgrade(),true);assert.deepEqual(receipt(f,m.messageId),before);
  f.store.db.prepare("UPDATE runs SET phase='uncertain' WHERE id=?").run(actor.runId!);assert.equal(f.tasks.safeToUpgrade(),false);
  f.store.db.prepare("UPDATE runs SET phase='ended' WHERE id=?").run(actor.runId!);
  f.store.db.prepare('UPDATE tasks SET executorAgentId=? WHERE id=?').run('worker:invalid-recipient',a.taskId);assert.equal(f.tasks.safeToUpgrade(),false);
  f.store.db.prepare('UPDATE tasks SET executorAgentId=? WHERE id=?').run(a.agentId,a.taskId);
  f.store.db.prepare('UPDATE agent_messages SET targetRunId=NULL WHERE id=?').run(m.messageId);assert.equal(f.tasks.safeToUpgrade(),false);
 }finally{f.close();}
});
test('F3: runless main delivery never consumes explicit targets; untargeted notifications remain normal',()=>{
 const f=fixture();try {
  const a=delegate(f),m=send(f,a.taskId,'target',a.runId);
  // Impossible via public send; defensive compatibility for pre-existing inconsistent rows.
  f.store.db.prepare('UPDATE agent_messages SET recipientAgentId=? WHERE id=?').run(main.agentId,m.messageId);
  f.store.db.prepare("UPDATE agent_receipts SET recipientAgentId=?,state='offered' WHERE messageId=?").run(main.agentId,m.messageId);
  const before=receipt(f,m.messageId);f.tasks.receiveMainMessages([m.messageId],'main-turn');assert.deepEqual(receipt(f,m.messageId),before);
  f.store.db.prepare("UPDATE agent_receipts SET state='pending' WHERE messageId=?").run(m.messageId);
  assert.equal(f.tasks.offerMainMessages().some(x=>x.id===m.messageId),false);assert.equal(f.tasks.inbox(main).some(x=>x.id===m.messageId),false);
  assert.throws(()=>ack(f,main,m.messageId),/target_stale/);
  const host=Object.create(Homer.prototype) as any;
  f.store.setMeta('mainThread','target-test-main');
  const history=new ConversationHistory(f.store.db);history.accept('target-test-main',{requestId:'user-synthetic',text:'Synthetic source'});
  const inputs=new MainInputs(f.tasks,history);
  Object.assign(host,{store:f.store,tasks:f.tasks,inputs,enqueue(){throw Error('stale_target_scheduled');}});
  host.scheduleInternal();assert.notEqual(host.inputScheduled,true);
  const actor=running(f,a.taskId),t=f.tasks.task(a.taskId);
  const normal=f.tasks.send(actor,{operationId:'main-normal',taskId:t.id,version:t.headVersion,expectedTaskRevision:t.revision,recipientAgentId:main.agentId,kind:'notice',payload:{fixture:true}});
  f.store.db.prepare("UPDATE agent_receipts SET state='offered' WHERE messageId=?").run(m.messageId);
  assert.equal(inputs.claim([],'all')!.messageId,normal.messageId);
  f.tasks.receiveMainMessages([normal.messageId],'real-main-turn');assert.equal(receipt(f,normal.messageId).state,'received');ack(f,main,normal.messageId);
 }finally{f.close();}
});
