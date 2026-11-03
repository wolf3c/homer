import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {MainProcessHistory} from '../src/main-process.js';
import {fixture,main,contract,delegate,running} from './recursive-fixture.js';
import {RecursiveTasks} from '../src/recursive-tasks.js';
import {publicStartupCode,startupErrorText} from '../src/worker-card-events.js';
test('Worker failure notices preserve distinct safe quota and rate-limit classifications',()=>{
 for(const [code,notice,absent] of [['engine_quota_insufficient',/额度不足/,/限流/],['engine_rate_limited',/限流/,/额度不足/]] as const){
  assert.equal(publicStartupCode(code),code);
  assert.match(startupErrorText(code),notice);assert.doesNotMatch(startupErrorText(code),absent);
 }
 assert.equal(publicStartupCode('PRIVATE_PROVIDER_DETAILS'),'worker_start_failed');
 assert.doesNotMatch(startupErrorText('PRIVATE_PROVIDER_DETAILS'),/PRIVATE_PROVIDER_DETAILS/);
});
function setup(){const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT)');const history=new MainProcessHistory(db);const start=(id:string)=>history.start({id,threadId:'test-thread',sourceKind:'user',sourceMessageIds:[],messageId:id},id+'-turn');return {db,history,start};}
const event={eventKey:'dispatch:operation-1',eventKind:'delegated' as const,title:'检查会议记录',body:'核对日期并整理行动项。',bodySource:'description' as const,taskId:'task-1',version:1,runId:'run-1',resultId:null,sourceMessageId:null,operationKey:'operation-1',observedAtMs:1};
test('worker event snapshots remain fixed, same-task result gets a new card, replay keeps its original anchor',()=>{const f=setup();try{
 f.start('create');f.history.workerEvent('create',event);f.history.finish('create','completed','end-create');const before=f.history.exact('create');
 f.start('result');f.history.workerEvent('result',{...event,eventKey:'result:result-1',eventKind:'result_received',body:'已核对3项，保留1个待确认日期。',bodySource:'summary',resultId:'result-1',operationKey:null,observedAtMs:2});
 f.history.workerEvent('result',{...event,observedAtMs:3});
 assert.deepEqual(f.history.exact('create'),before);assert.equal(f.history.exact('result')!.items.length,1);
 assert.equal(f.history.exact('create')!.items[0]!.kind,'workerEvent');
 const restored=new MainProcessHistory(f.db);assert.deepEqual(restored.headers(['create'])[0],{...before,toolStatusCounts:{},details:'unloaded'});
 assert.equal((restored.exact('result')!.items[0] as any).event.body,'已核对3项，保留1个待确认日期。');
 assert.throws(()=>f.history.workerEvent('result',{...event,body:'替换历史内容'}),/worker_event_conflict/);
}finally{f.db.close();}});
test('event and node reference are atomic; raw arguments and unknown fields are never public',()=>{const f=setup();try{
 f.start('node');f.db.exec('BEGIN');f.history.workerEvent('node',{...event,rawArguments:'SECRET',credentials:'SECRET'} as any);f.db.exec('ROLLBACK');
 assert.equal(f.history.exact('node')!.items.length,0);assert.equal(f.db.prepare('SELECT count(*) n FROM worker_card_events').get()!.n,0);
 f.history.workerEvent('node',{...event,rawArguments:'SECRET',credentials:'SECRET'} as any);
 assert.ok(!JSON.stringify(f.history.exact('node')).includes('SECRET'));
 const stored=String(f.db.prepare('SELECT value FROM meta WHERE key=?').get('publicMainNode:v1:node')!.value);assert.ok(!stored.includes(event.body));
 f.db.exec("CREATE TRIGGER reject_event_ref BEFORE UPDATE ON meta WHEN new.key='publicMainNode:v1:node' BEGIN SELECT RAISE(ABORT,'reference_failure');END");
 assert.throws(()=>f.history.workerEvent('node',{...event,eventKey:'second'}),/reference_failure/);assert.equal(f.db.prepare('SELECT count(*) n FROM worker_card_events').get()!.n,1);
}finally{f.db.close();}});
test('legacy task snapshots cannot overwrite a historical occurrence',()=>{const f=setup();try{f.start('node');const old={taskId:'task-1',version:1,taskRevision:1,runId:'run-1',runRevision:1,runStatus:'queued',resultState:null,epoch:0,state:'queued',controlState:'normal',outcome:null,phase:'ready',stopRequested:false};f.history.worker('node',old);f.history.finish('node','completed','end');const before=f.history.exact('node');f.history.worker('node',{...old,taskRevision:2,runRevision:2,runStatus:'succeeded',outcome:'partial',phase:'ended'});assert.deepEqual(f.history.exact('node'),before);}finally{f.db.close();}});
test('presentation is retained by contract version and for delegated children',()=>{const f=fixture();try{const c={...contract(),presentation:{title:'核对行动项',description:'检查日期并保留待确认项。'}};const child=f.tasks.delegate(main,{operationId:'presentation',taskId:f.root.taskId,version:1,expectedTaskRevision:f.tasks.task(f.root.taskId).revision,contract:c,dependencies:[]});assert.deepEqual(f.tasks.contract(child.taskId,1).presentation,c.presentation);}finally{f.close();}});
test('business creation, public snapshot and reference roll back together and retry is exact',()=>{const f=fixture();try{
 const history=new MainProcessHistory(f.store.db);history.start({id:'main-dispatch',threadId:'test-thread',sourceKind:'user',sourceMessageIds:[],messageId:'main-dispatch'},'main-turn');
 let reject=true;const tasks=new RecursiveTasks(f.store,f.files,{validateActor(){},operationConfirmed(_actor,key,kind,response){if(kind!=='delegate')return;history.workerEvent('main-dispatch',{...event,eventKey:'dispatch:'+key,operationKey:key,taskId:String(response.taskId),runId:String(response.runId)});if(reject)throw Error('snapshot_commit_failure');}});
 const args={operationId:'atomic-dispatch',taskId:f.root.taskId,version:1,expectedTaskRevision:tasks.task(f.root.taskId).revision,contract:contract(),dependencies:[]};
 const before=tasks.tasks().length;assert.throws(()=>tasks.delegate(main,args),/snapshot_commit_failure/);assert.equal(tasks.tasks().length,before);assert.equal(history.exact('main-dispatch')!.items.length,0);assert.equal(f.store.db.prepare('SELECT count(*) n FROM worker_card_events').get()!.n,0);
 reject=false;const receipt=tasks.delegate(main,args);assert.deepEqual(tasks.delegate(main,args),receipt);assert.equal(history.exact('main-dispatch')!.items.length,1);
 }finally{f.close();}});
test('additive presentation migration preserves legacy contracts and is repeatable',()=>{const f=fixture();try{
 const before=f.tasks.contract(f.root.taskId,1);f.store.db.exec('ALTER TABLE task_versions DROP COLUMN presentationJson');const tasks=new RecursiveTasks(f.store,f.files);tasks.migrate();tasks.migrate();assert.deepEqual(tasks.contract(f.root.taskId,1),before);assert.equal(f.store.db.prepare('SELECT presentationJson FROM task_versions WHERE taskId=?').get(f.root.taskId)!.presentationJson,null);
 }finally{f.close();}});
test('only confirmed failure before a Worker turn ACK is a startup failure',()=>{for(const phase of ['starting','acknowledged','uncertain']){const f=fixture();try{const child=delegate(f,'failure-boundary');const claimed=f.tasks.claim(child.runId!)!;if(phase==='acknowledged')f.tasks.bind(claimed.id,claimed.epoch,'thread','turn');f.tasks.failRun(claimed.id,claimed.epoch,'engine_authentication_failed',phase==='uncertain');const notices=f.tasks.inbox(main).filter(m=>m.kind==='terminal');assert.equal(notices.length,1);assert.equal((notices[0]!.payload as any).startupFailure,phase==='starting');}finally{f.close();}}});
test('queued contract presentation never replaces the old version',()=>{const f=fixture();try{const child=delegate(f,'versions'),actor=running(f,child.taskId);const old=f.tasks.contract(child.taskId,1);const updated={...old,presentation:{title:'后续核对',description:'这是后续要求。'}};const next=f.tasks.update(main,{operationId:'new-version',taskId:child.taskId,version:1,expectedTaskRevision:f.tasks.task(child.taskId).revision,mode:'queue',contract:updated,children:[],queuedDisposition:[]});assert.equal(next.version,2);assert.deepEqual(f.tasks.contract(child.taskId,1),old);assert.deepEqual(f.tasks.contract(child.taskId,2).presentation,updated.presentation);assert.ok(actor.runId);}finally{f.close();}});
test('closed process nodes accept identical replay but never a new Worker event',()=>{const f=setup();try{f.start('closed');f.history.workerEvent('closed',event);f.history.finish('closed','completed','terminal');const before=f.history.exact('closed');assert.doesNotThrow(()=>f.history.workerEvent('closed',{...event,observedAtMs:2}));assert.throws(()=>f.history.workerEvent('closed',{...event,eventKey:'new-on-closed-node'}),/worker_event_anchor_closed/);assert.deepEqual(f.history.exact('closed'),before);assert.equal(f.db.prepare('SELECT count(*) n FROM worker_card_events').get()!.n,1);}finally{f.db.close();}});
