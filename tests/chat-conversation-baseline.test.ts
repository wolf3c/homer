import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {Store} from '../src/store.js';
import {Files} from '../src/files.js';
import {WorkerInteractions} from '../src/worker-interactions.js';
import {RecursiveTasks} from '../src/recursive-tasks.js';
import {ConversationHistory} from '../src/web-history.js';
import {MainInputs} from '../src/recursive-main-inputs.js';
import {MainProcessHistory} from '../src/main-process.js';
import {WebHistoryPages} from '../src/web-history-pages.js';
import {readTaskOverview,readTaskDetail,readTaskSummary} from '../src/task-overview.js';
import {Homer} from '../src/service.js';
import {createWebServer} from '../src/web-server.js';
import {homerWebBridge} from '../src/web-homer.js';

function fixture(){
  const parent=resolve('.codex/scratch/chat-conversation-baseline-test');mkdirSync(parent,{recursive:true});
  const dir=mkdtempSync(join(parent,'synthetic-')),store=new Store(join(dir,'synthetic.sqlite'));
  new WorkerInteractions(store.db);const history=new ConversationHistory(store.db),tasks=new RecursiveTasks(store,new Files(join(dir,'workspace')));tasks.migrate();store.setMeta('mainThread','synthetic');
  const processes=new MainProcessHistory(store.db),inputs=new MainInputs(tasks,history),pages=new WebHistoryPages(history,processes,inputs);
  return {dir,store,history,tasks,inputs,processes,pages,close(){store.close();rmSync(dir,{recursive:true,force:true});}};
}

test('conversation baseline reads legacy persisted replies and a separate queue without changing stored timestamps',()=>{
 const f=fixture();try{
  f.history.record('publication','synthetic','正式答复');
  f.inputs.accept({requestId:'pending',text:'待处理请求'});
  const expected=f.history.message('publication')!;
  const page=f.pages.read('synthetic',{limit:40});assert.deepEqual(page.messages.map(m=>m.id),['publication']);assert.equal(page.messages[0]!.createdAt,expected.createdAt);assert.equal(f.pages.queuePage().items.length,1);
  assert.deepEqual(readTaskOverview(f.store.db).tasks,[]);
 }finally{f.close();}
});

test('conversation baseline summary/detail readers work with the committed task schema',()=>{
 const f=fixture();try{
  f.inputs.accept({requestId:'synthetic-source',text:'合成验证'});const source=f.inputs.claim()!;f.inputs.finish(source.messageId,source.revision,'completed');
  const root=f.tasks.createTask({agentId:f.store.meta('mainAgentId')!,threadId:'synthetic',sourceRequestId:'synthetic-source'},{operationId:'root',title:'合成事项',goal:'只读验证',authority:{sourceRequestId:'synthetic-source',description:'合成验证'}});
  assert.equal(readTaskOverview(f.store.db).tasks[0]!.id,root.taskId);
  assert.equal(readTaskSummary(f.store.db,root.taskId).taskId,root.taskId);assert.equal(readTaskDetail(f.store.db,root.taskId).taskId,root.taskId);
 }finally{f.close();}
});

test('production Web bridge emits bounded history state using the selected service read integration',async()=>{
 const f=fixture();try{
  f.history.record('reply','synthetic','已有答复');f.inputs.accept({requestId:'queued',text:'排队请求'});
  const host={registerWebSurface(){},store:f.store,history:f.history,inputs:f.inputs,tasks:f.tasks,processes:f.processes,webReadEpoch:'synthetic-epoch',webHistoryPages:()=>f.pages,conversationControlState:()=>({observedAtMs:1,isRunning:false,activeMessageId:null,generation:null,mainActivity:null,usage:null}),onStateChange:()=>()=>{},media:{view:()=>{throw Error('unexpected_media');}}};
  const bridge=homerWebBridge(host as unknown as Homer),state=await bridge.history!.state();
  assert.equal(state.history!.protocol,3);assert.equal(state.history!.readEpoch,'synthetic-epoch');assert.deepEqual(state.messages.map(m=>m.id),['reply']);assert.equal(state.queue!.length,1);assert.equal(state.queueDispatch!.totalWaiting,1);
 }finally{f.close();}
});


test('history HTTP allows local same-origin access and rejects cross-origin reads',async()=>{
 const f=fixture();let server:Awaited<ReturnType<typeof createWebServer>>|undefined;
 try{
  f.history.record('http-reply','synthetic','已有答复');
  const host={registerWebSurface(){},store:f.store,history:f.history,inputs:f.inputs,tasks:f.tasks,processes:f.processes,webReadEpoch:'synthetic-epoch',webHistoryPages:()=>f.pages,conversationControlState:()=>({observedAtMs:1,isRunning:false,activeMessageId:null,generation:null,mainActivity:null,usage:null}),onStateChange:()=>()=>{},media:{view:()=>{throw Error('unexpected_media');}}};
  server=await createWebServer({bridge:homerWebBridge(host as unknown as Homer),port:0});
  assert.equal((await fetch(server.url+'/api/history/state',{headers:{Origin:'https://synthetic.invalid'}})).status,403);
  assert.equal((await fetch(server.url+'/api/history/state',{headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
  const response=await fetch(server.url+'/api/history/state',{headers:{Origin:server.url}});assert.equal(response.status,200);
  const state=await response.json() as {messages:{id:string}[]};assert.deepEqual(state.messages.map(m=>m.id),['http-reply']);
 }finally{await server?.close();f.close();}
});
