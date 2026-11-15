// Synthetic protocol only: no installed profile, accounts, native engine or network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {chatFixture} from './task-chat-fixture.js';
import {MainProcessHistory} from '../src/main-process.js';

function receipt(f:ReturnType<typeof chatFixture>,id:string){return f.store.db.prepare('SELECT state,revision,offeredTurnId FROM agent_receipts WHERE messageId=?').get(id)!;}

for(const outcome of ['completed','failed','interrupted'] as const)test('main mailbox retains received after user processing '+outcome,()=>{
 const f=chatFixture();try{
  f.inputs.accept({requestId:'next',text:'Synthetic followup'});const input=f.inputs.claim()!;
  f.inputs.started(input.messageId,input.revision,'generation:next','native:next');
  f.inputs.finish(input.messageId,input.revision,outcome);
  assert.equal(receipt(f,input.messageId).state,'received');
  assert.equal(f.inputs.confirmedReplyStatus('next',input.replyId),outcome);
  assert.equal(f.inputs.list().find(row=>row.messageId===input.messageId)!.state,outcome);
  f.inputs.accept({requestId:'independent',text:'Independent synthetic input'});
  assert.equal(f.inputs.claim()!.input.requestId,'independent');
 }finally{f.close();}
});

test('duplicate accepted native acknowledgement is idempotent but a different native identity is refused',()=>{
 const f=chatFixture();try{
  f.inputs.accept({requestId:'next',text:'Synthetic input'});const input=f.inputs.claim()!;
  f.inputs.started(input.messageId,input.revision,'generation:next','native:next');
  assert.doesNotThrow(()=>f.inputs.started(input.messageId,input.revision,'generation:next','native:next'));
  assert.throws(()=>f.inputs.started(input.messageId,input.revision,'generation:next','native:other'),/identity|revision/);
 }finally{f.close();}
});

test('known receipt survives uncertain user processing and recovery without replay',()=>{
 const f=chatFixture();try{
  f.inputs.accept({requestId:'next',text:'Synthetic input'});const input=f.inputs.claim()!;
  f.inputs.started(input.messageId,input.revision,'generation:next','native:next');
  f.inputs.uncertain(input.messageId,input.revision);
  assert.equal(receipt(f,input.messageId).state,'received');
  assert.equal(f.inputs.list().find(row=>row.messageId===input.messageId)!.state,'uncertain');
  f.inputs.reconcile();assert.equal(receipt(f,input.messageId).state,'received');
  assert.equal(f.inputs.claim(),undefined);
 }finally{f.close();}
});

test('failed internal processing does not retain delivery ownership or reopen on restart',()=>{
 const f=chatFixture();try{
  const task=f.create(),worker=f.tasks.workerOpen(f.actor,{operationId:'worker',taskId:task.taskId,text:'Synthetic analysis'}),run=f.start(worker.workerId);
  f.tasks.endSegment(run.id,run.epoch,{status:'completed',text:'Synthetic result'},true);
  const input=f.inputs.claim([],'all')!;assert.equal(input.origin,'worker');
  const processes=new MainProcessHistory(f.store.db);
  f.store.transaction(()=>{
   processes.start({id:'synthetic-process',threadId:'thread:main',sourceKind:'worker',sourceMessageIds:[input.messageId],messageId:'synthetic-process'},'native:internal');
   f.tasks.receiveMainMessagesInTransaction([input.messageId],'native:internal');
  });
  processes.finish('synthetic-process','failed','turn:native:internal:terminal:completed');
  assert.equal(receipt(f,input.messageId).state,'received');
  assert.equal(f.inputs.dispatchPage(undefined,'synthetic','all').items.length,0);
  assert.equal(f.tasks.inbox(f.actor).length,0,'delivery inbox does not return received historical business failures');
  assert.equal(f.tasks.safeToUpgrade(),true,'only historical failure remains; no live Run/interaction/operation');
  f.tasks.reconcile();f.inputs.reconcile();
  assert.equal(receipt(f,input.messageId).state,'received');
  f.inputs.accept({requestId:'fresh',text:'Independent request'});
  assert.equal(f.inputs.claim([],'all')?.origin,'user');
  assert.equal(processes.exact('synthetic-process')!.status,'failed');
 }finally{f.close();}
});

test('unacknowledged internal delivery stays uncertain and never automatically reopens',()=>{
 const f=chatFixture();try{
  const task=f.create(),worker=f.tasks.workerOpen(f.actor,{operationId:'worker',taskId:task.taskId,text:'Synthetic analysis'}),run=f.start(worker.workerId);
  f.tasks.endSegment(run.id,run.epoch,{status:'completed',text:'Synthetic result'},true);
  const input=f.inputs.claim([],'all')!;
  f.inputs.reconcile();
  assert.equal(receipt(f,input.messageId).state,'uncertain');
  assert.equal(f.inputs.claim([],'all'),undefined);
  assert.equal(f.tasks.safeToUpgrade(),false);
 }finally{f.close();}
});

test('user generation and internal native acknowledgement cannot cross inbox entry types',()=>{
 const f=chatFixture();try{
  const task=f.create(),worker=f.tasks.workerOpen(f.actor,{operationId:'worker',taskId:task.taskId,text:'Synthetic analysis'}),run=f.start(worker.workerId);
  f.tasks.endSegment(run.id,run.epoch,{status:'completed',text:'Synthetic result'},true);
  const input=f.inputs.claim([],'all')!;
  assert.throws(()=>f.inputs.started(input.messageId,input.revision,'generation:wrong','native:internal'),/scope|revision/);
  f.store.transaction(()=>f.tasks.receiveMainMessagesInTransaction([input.messageId],'native:internal'));
  assert.doesNotThrow(()=>f.store.transaction(()=>f.tasks.receiveMainMessagesInTransaction([input.messageId],'native:internal')));
  assert.throws(()=>f.store.transaction(()=>f.tasks.receiveMainMessagesInTransaction([input.messageId],'native:other')),/identity/);
  f.inputs.accept({requestId:'user',text:'Synthetic user'});
  const user=f.inputs.claim([],'all')!;
  assert.throws(()=>f.store.transaction(()=>f.tasks.receiveMainMessagesInTransaction([user.messageId],'native:user')),/scope|identity/);
 }finally{f.close();}
});
