import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve,join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdirSync,mkdtempSync,rmSync } from 'node:fs';
const source=resolve(process.env.HOMER_RECEPTION_SOURCE??'.');
const load=async(name:string)=>import(pathToFileURL(join(source,'src',name+'.ts')).href);
const [{Homer},{Store},{Files},{WorkerInteractions},{ConversationHistory},{MainProcessHistory},{RecursiveTasks},{homerWebBridge},{createWebServer},{MainInputs}]=await Promise.all(['service','store','files','worker-interactions','web-history','main-process','recursive-tasks','web-homer','web-server','recursive-main-inputs'].map(load));
const scratch=resolve('.codex/scratch/main-agent-reception-optimization');mkdirSync(scratch,{recursive:true});
test('state: repeated WebState reads never project/write Worker facts or revisions',async t=>{
 t.mock.method(Date,'now',()=>1790000000000);
 const store=new Store(':memory:'),dir=mkdtempSync(join(scratch,'pure-state-'));
 try{
  new WorkerInteractions(store.db);const files=new Files(dir),tasks=new RecursiveTasks(store,files);tasks.migrate();store.setMeta('mainThread','synthetic-thread');
  const history=new ConversationHistory(store.db),processes=new MainProcessHistory(store.db),app:any=Object.create(Homer.prototype);
  Object.assign(app,{store,files,tasks,history,processes,inputs:new MainInputs(tasks,history),registerWebSurface(){},snapshot:()=>({tasks:[],runs:[],matters:[],interactions:[],deliveries:[]}),projectProcessWorker(){store.setMeta('synthetic-read-side-effect','forbidden');}});
  processes.start({id:'synthetic-node',threadId:'synthetic-thread',sourceKind:'user',sourceMessageIds:[],messageId:'synthetic-node'},'synthetic-turn');
  processes.worker('synthetic-node',{taskId:'synthetic-worker',version:1,taskRevision:1,runId:null,runRevision:null,runStatus:null,resultState:null,epoch:null,state:'working',controlState:'normal',outcome:null,phase:null,stopRequested:false});
  app.webHistoryPages();
  const before=store.db.prepare('SELECT * FROM meta ORDER BY key').all();
  const first=await homerWebBridge(app).history!.state(),second=await homerWebBridge(app).history!.state();
  assert.deepEqual(first,second);assert.deepEqual(store.db.prepare('SELECT * FROM meta ORDER BY key').all(),before);
  const changes=store.db.prepare('SELECT total_changes() n').get()!.n;
  app.mainContext={event:true};
  const internal=await homerWebBridge(app).history!.state();assert.equal(internal.isRunning,false);assert.equal(internal.activeMessageId,null);assert.equal(internal.generation,null);
  assert.deepEqual(await homerWebBridge(app).history!.state(),internal);assert.deepEqual(internal.messages,first.messages);
  const generation={generationId:'synthetic-user-generation',messageId:'synthetic-user-reply'};
  app.mainContext={messageId:generation.messageId,generation};
  const user=await homerWebBridge(app).history!.state();assert.equal(user.isRunning,true);assert.equal(user.activeMessageId,generation.messageId);assert.deepEqual(user.generation,generation);
  assert.equal(store.db.prepare('SELECT total_changes() n').get()!.n,changes);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
test('state: parallel GET and initial SSE clients share a single current build',async()=>{
 let builds=0,release!:()=>void;const gate=new Promise<void>(r=>release=r);
 const state={threadId:'synthetic-thread',messages:[],isRunning:false,activeMessageId:null,work:[],interactions:[],upgrade:{phase:'running'}};
 const bridge:any={history:{state:async()=>{builds++;await gate;return state;}},submit:async()=>{},stop:async()=>{},respond:async()=>{},artifact:async()=>{}};
 const dir=mkdtempSync(join(scratch,'shared-state-')),web=await createWebServer({bridge,port:0,connectionDirectory:dir});
 const controllers=[new AbortController(),new AbortController()];
 try{
  assert.equal('connectionFile' in web,false,'loopback access needs no pairing file');
  const requests=[fetch(web.url+'/api/history/state'),...controllers.map(controller=>fetch(web.url+'/api/history/events',{signal:controller.signal}))];
  await new Promise(r=>setTimeout(r,50));release();const responses=await Promise.all(requests);
  await responses[0]!.json();for(const response of responses.slice(1)){const reader=response.body!.getReader();const first=await reader.read();assert.ok(new TextDecoder().decode(first.value).includes('synthetic-thread'));await reader.cancel();}
  assert.equal(builds,1);
 }finally{release();controllers.forEach(c=>c.abort());await web.close();rmSync(dir,{recursive:true,force:true});}
});
