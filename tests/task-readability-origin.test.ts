import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture,main} from './recursive-fixture.js';
import {ConversationHistory} from '../src/web-history.js';
import {homerWebBridge} from '../src/web-homer.js';
import {syntheticFile} from './recursive-publication-fixture.js';
import {Homer} from '../src/service.js';

function setup(){
 const f=fixture(),history=new ConversationHistory(f.store.db);
 history.accept('old-synthetic-thread',{requestId:main.sourceRequestId!,text:'合成完整交办'});
 const host=Object.assign(Object.create(Homer.prototype),f,{history,registerChannelCapabilities(){}}) as Homer;
 return {f,history,host,bridge:homerWebBridge(host)};
}
test('exact original source and pure text publication are accessible without loading history or granting a file',async()=>{
 const {f,history,bridge}=setup();try{
  history.list=()=>{throw Error('unbounded_history_forbidden');};
  const original=f.store.db.prepare("SELECT id FROM conversation_messages WHERE role='user'").get()!;
  const before=await bridge.taskOverview!.summary!(f.root.taskId);
  assert.equal(before.requirements?.[0]?.sourceMessageId,original.id);assert.equal(before.requirements?.[0]?.threadId,'old-synthetic-thread');
  assert.equal((await bridge.taskOverview!.origin!(f.root.taskId,String(original.id))).message.text,'合成完整交办');
  const task=f.tasks.task(f.root.taskId);
  const d=f.tasks.publish(main,{operationId:'text-publish',taskId:task.id,version:1,expectedTaskRevision:task.revision,resultId:null,outcome:'succeeded',evidence:{facts:'Synthetic text inspected'},children:[],text:'合成纯文字成果',publishedFileResultId:null});
  history.record(d.historyMessageId,'old-synthetic-thread','合成纯文字成果');
  assert.deepEqual((await bridge.taskOverview!.summary!(task.id)).publications,[],'prepared is not formally recorded');
  await assert.rejects(()=>bridge.taskOverview!.origin!(task.id,d.historyMessageId),/task_origin_not_found/);
  f.tasks.markDelivery(d.deliveryId,'recorded');
  const summary=await bridge.taskOverview!.summary!(task.id);assert.equal(summary.publications?.length,1);assert.deepEqual(summary.artifacts,[]);
  const origin=await bridge.taskOverview!.origin!(task.id,d.historyMessageId);assert.equal(origin.message.id,d.historyMessageId);assert.deepEqual(origin.files,[]);
  const neighbor=history.add('old-synthetic-thread','邻居不可泄漏');
  await assert.rejects(()=>bridge.taskOverview!.origin!(task.id,neighbor),/task_origin_not_found/);
  await assert.rejects(()=>bridge.taskOverview!.origin!('wrong-root',d.historyMessageId),/task_origin_not_found/);
  f.tasks.markDelivery(d.deliveryId,'revoked');
  assert.deepEqual((await bridge.taskOverview!.summary!(task.id)).publications,[]);
  await assert.rejects(()=>bridge.taskOverview!.origin!(task.id,d.historyMessageId),/task_origin_not_found/);
 }finally{f.close();}
});
test('file entries use existing exact publication authority; candidates, revoked and unrelated files stay inaccessible',async()=>{
 const {f,history,host,bridge}=setup();try{
  f.store.startRequest('file-source','synthetic-file');const file=syntheticFile(host,'file-source','readability.md','# Synthetic authorized result');
  assert.equal(f.tasks.publishedResult(file.resultId),undefined,'accepted alone grants no publication');
  const delivery=file.publish('合成文件成果');history.record(delivery.historyMessageId,'old-synthetic-thread',delivery.text);
  assert.deepEqual((await bridge.taskOverview!.summary!(delivery.rootTaskId)).artifacts,[],'submitting is not recorded');
  f.tasks.markDelivery(delivery.id,'recorded');
  const detail=await bridge.taskOverview!.summary!(delivery.rootTaskId);assert.deepEqual(detail.artifacts?.map(a=>a.id),[file.resultId]);
  const origin=await bridge.taskOverview!.origin!(delivery.rootTaskId,delivery.historyMessageId);assert.deepEqual(origin.files.map(a=>a.id),[file.resultId]);
  assert.equal((await bridge.artifact(file.resultId)).filename,'readability.md');
  await assert.rejects(()=>bridge.artifact('result-unrelated'),/artifact_not_authorized/);
  f.tasks.markDelivery(delivery.id,'revoked');
  assert.deepEqual((await bridge.taskOverview!.summary!(delivery.rootTaskId)).artifacts,[]);
  await assert.rejects(()=>bridge.artifact(file.resultId),/artifact_not_authorized/);
 }finally{f.close();}
});
