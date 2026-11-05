import {test} from 'node:test';import assert from 'node:assert/strict';
import {chatFixture} from './task-chat-fixture.js';import {homerWebBridge} from '../src/web-homer.js';import {syntheticFile} from './recursive-publication-fixture.js';import {Homer} from '../src/service.js';
import {WorkerInteractions} from '../src/worker-interactions.js';
function setup(){const f=chatFixture(),host=Object.assign(Object.create(Homer.prototype),f,{interactions:new WorkerInteractions(f.store.db),registerChannelCapabilities(){}}) as Homer;return {f,host,bridge:homerWebBridge(host)};}
test('exact user source and text publication read without unbounded history or file grants',async()=>{
 const {f,bridge}=setup();try{
  const task=f.create();f.history.list=()=>{throw Error('unbounded_history_forbidden');};const original=f.store.db.prepare("SELECT id FROM conversation_messages WHERE role='user'").get()!;
  const before=await bridge.taskOverview!.summary!(task.taskId);assert.equal(before.requirements?.[0]?.sourceMessageId,original.id);assert.equal(before.requirements?.[0]?.threadId,'thread:main');assert.equal((await bridge.taskOverview!.origin!(task.taskId,String(original.id))).message.text,'Investigate without edits');
  const w=f.tasks.workerOpen(f.actor,{operationId:'open',taskId:task.taskId,text:'Inspect'}),r=f.start(w.workerId),reply=f.tasks.endSegment(r.id,r.epoch,{status:'completed',text:'Text answer'},true)!,adopted=f.tasks.adoptResult(f.actor,{operationId:'adopt',taskId:task.taskId,version:1,messageId:reply.messageId});
  const d=f.tasks.publish(f.actor,{operationId:'publish',taskId:task.taskId,version:1,resultIds:[adopted.resultId],text:'合成纯文字成果'});f.history.record(d.historyMessageId,'thread:main','合成纯文字成果');assert.deepEqual((await bridge.taskOverview!.summary!(task.taskId)).publications,[]);await assert.rejects(()=>bridge.taskOverview!.origin!(task.taskId,d.historyMessageId),/task_origin_not_found/);
  f.tasks.markDelivery(d.deliveryId,'submitting');f.tasks.markDelivery(d.deliveryId,'recorded');const summary=await bridge.taskOverview!.summary!(task.taskId);assert.equal(summary.publications?.length,1);assert.deepEqual(summary.artifacts,[]);assert.deepEqual((await bridge.taskOverview!.origin!(task.taskId,d.historyMessageId)).files,[]);
  const neighbor=f.history.add('thread:main','邻居不可泄漏');await assert.rejects(()=>bridge.taskOverview!.origin!(task.taskId,neighbor),/task_origin_not_found/);await assert.rejects(()=>bridge.taskOverview!.origin!('wrong-task',d.historyMessageId),/task_origin_not_found/);
  f.tasks.markDelivery(d.deliveryId,'revoked');assert.deepEqual((await bridge.taskOverview!.summary!(task.taskId)).publications,[]);await assert.rejects(()=>bridge.taskOverview!.origin!(task.taskId,d.historyMessageId),/task_origin_not_found/);
 }finally{f.close();}
});
test('file origins retain exact publication authority and reject accepted-only, revoked and unrelated files',async()=>{
 const {f,host,bridge}=setup();try{
  const file=syntheticFile(host,f.actor.sourceRequestId!,'readability.md','# Synthetic authorized result');assert.equal(f.tasks.publishedResult(file.resultId),undefined);
  const d=file.publish('合成文件成果');f.history.record(d.historyMessageId,'thread:main',d.text);assert.deepEqual((await bridge.taskOverview!.summary!(d.taskId)).artifacts,[]);f.tasks.markDelivery(d.id,'recorded');
  assert.deepEqual((await bridge.taskOverview!.summary!(d.taskId)).artifacts?.map(a=>a.id),[file.resultId]);assert.deepEqual((await bridge.taskOverview!.origin!(d.taskId,d.historyMessageId)).files.map(a=>a.id),[file.resultId]);assert.equal((await bridge.artifact(file.resultId)).filename,'readability.md');await assert.rejects(()=>bridge.artifact('result-unrelated'),/artifact_not_authorized/);
  assert.equal((await bridge.taskOverview!.summary!(d.taskId)).artifacts?.[0]?.title,'readability.md');assert.equal((await bridge.taskOverview!.detail!(d.taskId)).artifacts?.[0]?.title,'readability.md');
  assert.equal((await bridge.taskOverview!.origin!(d.taskId,d.historyMessageId)).files[0]?.title,'readability.md');assert.equal((await bridge.artifactOrigin!(file.resultId)).files[0]?.title,'readability.md');
  f.tasks.markDelivery(d.id,'revoked');assert.deepEqual((await bridge.taskOverview!.summary!(d.taskId)).artifacts,[]);await assert.rejects(()=>bridge.artifact(file.resultId),/artifact_not_authorized/);
 }finally{f.close();}
});
