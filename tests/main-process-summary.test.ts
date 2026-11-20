import test from 'node:test';
import assert from 'node:assert/strict';
import {Homer} from '../src/service.js';
import {MainProcessHistory} from '../src/main-process.js';
import {fixture} from './recursive-fixture.js';

test('ended process summaries retain final and Worker facts without loading ordinary commentary',()=>{
 const f=fixture();try{
  const processes=new MainProcessHistory(f.store.db),body='Synthetic detail '.repeat(65536);
  processes.start({id:'summary',threadId:'synthetic',sourceKind:'user',sourceMessageIds:['input'],messageId:'reply'},'turn');
  processes.agent('summary',{turnId:'turn',itemId:'detail',phase:'commentary',text:body,completed:true});
  processes.agent('summary',{turnId:'turn',itemId:'final',phase:'final_answer',text:'Checked final',completed:true});
  processes.agent('summary',{turnId:'turn',itemId:'streamed-final',phase:'final_answer',text:'Second public final',completed:false});
  processes.worker('summary',{taskId:'worker',version:1,taskRevision:1,runId:'run',runRevision:1,runStatus:'succeeded',resultState:'accepted',epoch:1,state:'settled',phase:'ended',stopRequested:false});
  const working=processes.headers(['summary'])[0]!;
  assert.ok(working.items.some(item=>item.kind==='commentary'&&item.text===body));
  processes.finish('summary','completed','turn:turn:completed');
  f.store.db.exec('PRAGMA query_only=ON');
  const changes=f.store.db.prepare('SELECT total_changes() n').get();
  const summary=processes.headers(['summary'])[0]!;
  assert.equal(summary.details,'unloaded');
  assert.ok(Buffer.byteLength(JSON.stringify(summary))<4096);
  assert.deepEqual(summary.items.filter(item=>item.kind==='commentary').map(item=>item.text),['Checked final','Second public final']);
  assert.deepEqual(summary.items.filter(item=>item.kind==='worker'),working.items.filter(item=>item.kind==='worker'));
  for(const detail of [processes.headers(['summary'],true)[0]!,processes.exact('summary')!])
   assert.ok(detail.items.some(item=>item.kind==='commentary'&&item.text===body));
  assert.deepEqual(f.store.db.prepare('SELECT total_changes() n').get(),changes);
 }finally{f.close();}
});

// Display retirement must not remove business identities or rewrite old rows.
test('process reads omit legacy tool bodies and new calls never persist a body',()=>{
 const f=fixture();try{
  const history=new MainProcessHistory(f.store.db);
  history.start({id:'slim',threadId:'synthetic',sourceKind:'user',sourceMessageIds:['input'],messageId:'reply'},'turn');
  const content={input:{state:'recorded',value:'SYNTHETIC_PRIVATE_INPUT'},output:{state:'recorded',value:'SYNTHETIC_PRIVATE_OUTPUT'}};
  history.native('slim',{threadId:'synthetic',turnId:'turn',itemId:'call',category:'command',status:'running',completed:false,content} as any);
  const key='publicMainNode:v1:slim',raw=()=>String(f.store.db.prepare('SELECT value FROM meta WHERE key=?').get(key)!.value);
  assert.ok(!raw().includes('SYNTHETIC_PRIVATE'));
  const old=JSON.parse(raw());old.items[0].content=content;
  f.store.db.prepare('UPDATE meta SET value=? WHERE key=?').run(JSON.stringify(old),key);const before=raw();
  for(const node of [history.exact('slim')!,history.headers(['slim'])[0]!,history.headers(['slim'],true)[0]!,history.list('synthetic')[0]!]){
   assert.ok(!JSON.stringify(node).includes('SYNTHETIC_PRIVATE'));assert.equal(node.items[0]!.id,old.items[0].id);
  }
  assert.equal(raw(),before);
 }finally{f.close();}
});

test('Main host tools return original results and errors while retaining only business metadata',async()=>{
 const f=fixture();try{
  const history=new MainProcessHistory(f.store.db);history.start({id:'host',threadId:'synthetic',sourceKind:'worker',sourceMessageIds:['notice'],messageId:'reply'},'turn');
  const fact={schemaVersion:1,action:'update_task',target:{taskId:'task',version:1,operationKey:'op'},outcome:'record_updated'};
  const app:any=Object.assign(Object.create(Homer.prototype),{mainContext:{processId:'host',event:true,nativeActivity:{turnId:'turn'}},processes:history,tasks:{captureActivity:()=>fact},mainActor:()=>({})});
  const result={text:'PRIVATE_HOST_RESULT'},error=Error('PRIVATE_HOST_ERROR');
  assert.equal(await app.mainActivity('task_update',async()=>result,{text:'PRIVATE_HOST_INPUT'}),result);
  await assert.rejects(app.mainActivity('task_update',async()=>{throw error;}),e=>e===error);
  const raw=String(f.store.db.prepare("SELECT value FROM meta WHERE key='publicMainNode:v1:host'").get()!.value);
  assert.doesNotMatch(raw,/PRIVATE_HOST/);const calls=history.exact('host')!.items.filter(i=>i.kind==='tool');assert.deepEqual(calls.map(i=>i.status),['completed','failed']);assert.deepEqual(calls[0]!.activity,fact);
 }finally{f.close();}
});
