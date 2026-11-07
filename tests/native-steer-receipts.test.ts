// Real native RPC receipts and Task/Worker state; no native process or model.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {CodexEngine} from '../src/engine.js';
import {Homer} from '../src/service.js';
import {RecursiveTools} from '../src/recursive-tools.js';
import type {Config} from '../src/config.js';
import {fixture,openWorker,running,main,mutation,authority} from './recursive-fixture.js';

const flush=()=>new Promise<void>(done=>setImmediate(done));
async function peer(){
 const f=fixture(),worker=openWorker(f),actor=running(f,worker.runId);
 const engine=new CodexEngine({workspace:f.files.workspace,stopGraceMs:100} as Config,{cwd:f.files.workspace,readRoots:[],instructions:'synthetic',tools:[]},async()=>({}));
 const sent:{id:number;method:string;params:any}[]=[];engine.threadId=actor.threadId;engine['send']=(message:any)=>{sent.push(message);};
 const receive=(message:unknown)=>engine['receive'](JSON.stringify(message));
 const turn=engine.turn('synthetic');turn.catch(()=>{});await receive({id:sent[0]!.id,result:{turn:{id:actor.turnId}}});await flush();
 const app=Object.assign(Object.create(Homer.prototype),{store:f.store,tasks:f.tasks,workers:new Map([[actor.runId,{id:actor.runId,epoch:actor.epoch,engine}]])}) as Homer;
 const tools=new RecursiveTools(f.tasks,{rootAuthority:()=>f.tasks.authority(f.task.taskId,1),wake(){},stop:async r=>r,steer:r=>app['applySteer'](r)});
 const input={workerId:worker.workerId,message:'Synthetic immediate correction',immediate:true};
 const steer=()=>{const work=tools.call(main,'worker_send',input,'steer-receipt') as Promise<Record<string,any>>;work.catch(()=>{});return work;};
 const operation=()=>f.store.db.prepare("SELECT * FROM operations WHERE kind='worker_steer'").get() as {id:string;state:string;detailsJson:string;responseJson:string};
 const writes=()=>sent.filter(message=>message.method==='turn/steer');
 return {...f,worker,actor,engine,receive,steer,operation,writes,async dispose(){await engine.close();await Promise.allSettled([turn]);f.close();}};
}

for(const ending of ['disconnect','close'] as const)test('native steer lost ACK stays durably uncertain on '+ending+' without replay',async()=>{
 const p=await peer();try{
  const pending=p.steer();assert.equal(p.writes().length,1);
  if(ending==='close')await p.engine.close();else p.engine['fail'](Error('engine_disconnected'));
  const receipt=await pending;assert.equal(receipt.state,'uncertain');assert.equal(receipt.code,ending==='close'?'engine_closed':'engine_disconnected');
  assert.equal(p.operation().state,'uncertain');assert.equal(JSON.parse(p.operation().detailsJson).rpcState,'uncertain');assert.equal(p.tasks.run(p.actor.runId!).phase,'uncertain');
  assert.equal(p.tasks.run(p.actor.runId!).version,1);assert.equal(p.tasks.task(p.task.taskId).headVersion,1);
  assert.throws(()=>p.tasks.writeFile(p.actor,{operationId:'stale-write',filename:'stale.md',bytes:Buffer.from('must not write')}),/phase/);
  await p.receive({id:p.writes()[0]!.id,result:{turnId:p.actor.turnId}});
  assert.equal((await p.steer()).state,'uncertain');assert.equal(p.writes().length,1);assert.equal(p.engine['pending'].size,0);
  p.tasks.endSegment(p.actor.runId!,p.actor.epoch!,{status:'completed',text:'Original partial facts'},true);
  assert.throws(()=>p.tasks.workerSend(main,{operationId:'followup',workerId:p.worker.workerId,text:'Continue'}),/operation_uncertain/);
  assert.equal(p.store.runs().length,1);
 }finally{await p.dispose();}
});

test('explicit native steer rejection is failed and never retried as unknown',async()=>{
 const p=await peer();try{
  const pending=p.steer();await p.receive({id:p.writes()[0]!.id,error:{code:-32600,message:'no active turn to steer'}});
  const receipt=await pending;assert.equal(receipt.state,'failed');assert.equal(receipt.code,'engine_rpc_failed');
  assert.equal(p.operation().state,'failed');assert.equal(JSON.parse(p.operation().detailsJson).rpcState,'failed');assert.equal(p.tasks.run(p.actor.runId!).phase,'executing');
  assert.equal((await p.steer()).state,'failed');assert.equal(p.writes().length,1);
 }finally{await p.dispose();}
});

test('exact steer ACK confirms one message without changing task version or implying business completion',async()=>{
 const p=await peer();try{
  const pending=p.steer(),request=p.writes()[0]!;
  assert.equal(request.params.threadId,p.actor.threadId);assert.equal(request.params.expectedTurnId,p.actor.turnId);assert.equal(request.params.input[0].text,'Synthetic immediate correction');
  await p.receive({id:request.id,result:{turnId:p.actor.turnId}});
  assert.equal((await pending).state,'received');assert.equal(p.operation().state,'confirmed');assert.equal(JSON.parse(p.operation().detailsJson).rpcState,'received');
  assert.equal((await p.steer()).state,'confirmed');assert.equal(p.writes().length,1);
  assert.equal(p.tasks.task(p.task.taskId).headVersion,1);assert.equal(p.tasks.task(p.task.taskId).outcome,null);
  const details=JSON.parse(p.operation().detailsJson);assert.equal(p.store.db.prepare('SELECT state FROM agent_receipts WHERE messageId=?').get(details.messageId)!.state,'processed');
 }finally{await p.dispose();}
});

test('duplicate steer while native ACK is pending reuses dispatch state and sends once',async()=>{
 const p=await peer();try{
  const pending=p.steer(),duplicate=p.steer();for(const request of p.writes())await p.receive({id:request.id,result:{turnId:p.actor.turnId}});
  assert.equal((await pending).state,'received');assert.equal((await duplicate).state,'dispatching');assert.equal(p.writes().length,1);
 }finally{await p.dispose();}
});

for(const reason of ['before-send','not-applicable','sync-send','mismatched-ack'])test('definite native steer failure: '+reason,async()=>{
 const p=await peer();try{
  if(reason==='before-send')p.engine['failure']=Error('engine_disconnected');
  if(reason==='not-applicable')p.engine['active']!.settling=true;
  if(reason==='sync-send')p.engine['send']=()=>{throw Error('engine_disconnected');};
  const pending=p.steer();if(reason==='mismatched-ack')await p.receive({id:p.writes()[0]!.id,result:{turnId:'other-turn'}});
  assert.equal((await pending).state,'failed');assert.equal(p.operation().state,'failed');assert.equal(p.tasks.run(p.actor.runId!).phase,'executing');
  assert.equal(p.writes().length,reason==='mismatched-ack'?1:0);
 }finally{await p.dispose();}
});

test('an old-version return survives a goal change and retains its original version',async()=>{
 const p=await peer();try{
  const pending=p.steer();await p.receive({id:p.writes()[0]!.id,result:{turnId:p.actor.turnId}});await pending;
  const change=p.tasks.updateTask(main,{...mutation(p,'goal-change'),patch:{goal:'New explicit user requirement'},authority:authority()});
  p.tasks.recordWorkerTerminal(p.actor.runId!,p.actor.epoch!,{status:'completed',text:'Original version draft'});
  p.tasks.confirmWorkerExit(p.actor.runId!,undefined);p.tasks.confirmStop(change.operationKey,true);
  const reply=p.tasks.workerRead(main,{workerId:p.worker.workerId}).messages.find(message=>message.kind==='worker_reply')!;
  assert.equal(reply.taskVersion,1);assert.equal(reply.text,'Original version draft');assert.equal(p.tasks.task(p.task.taskId).headVersion,2);assert.equal(p.tasks.task(p.task.taskId).outcome,null);
  assert.equal(reply.payload.version,1);
  const input={operationId:'followup',workerId:p.worker.workerId,text:'Continue under the new goal'};
  const next=p.tasks.workerSend(main,input);assert.deepEqual(p.tasks.workerSend(main,input),next);assert.equal(p.store.runs().length,2);
  assert.equal(p.tasks.run(next.runId!).version,2);assert.equal(p.tasks.run(next.runId!).threadId,p.actor.threadId);
  assert.equal(p.tasks.workerRead(main,{workerId:p.worker.workerId,messageId:reply.id}).messages[0]!.text,'Original version draft');
 }finally{await p.dispose();}
});

for(const obstruction of ['exit','lease','owner','rpc'] as const)test('original return does not bypass unresolved '+obstruction,async()=>{
 const p=await peer();try{
  const pending=p.steer();await p.receive({id:p.writes()[0]!.id,result:{turnId:p.actor.turnId}});await pending;
  const returned=p.tasks.endSegment(p.actor.runId!,p.actor.epoch!,{status:'completed',text:'Original draft'},obstruction!=='exit')!;
  if(obstruction==='lease')p.store.setMeta('lease:'+p.actor.runId,'synthetic-owner');
  if(obstruction==='owner')p.tasks['lifecycle']={validateActor(){},reviewExitConfirmed:()=>false};
  if(obstruction==='rpc')p.store.db.prepare("UPDATE operations SET state='uncertain' WHERE id=?").run(p.operation().id);
  const before=p.operation();
  if(obstruction==='exit'){
   assert.equal(p.tasks.workerSend(main,{operationId:'followup',workerId:p.worker.workerId,text:'Continue'}).runId,null);assert.equal(p.tasks.claim(),undefined);
  }else assert.throws(()=>p.tasks.workerSend(main,{operationId:'followup',workerId:p.worker.workerId,text:'Continue'}),/operation_uncertain|run_stop_unconfirmed/);
  assert.deepEqual(p.operation(),before);assert.equal(p.store.runs().length,1);
  assert.equal(p.tasks.workerRead(main,{workerId:p.worker.workerId,messageId:returned.messageId}).messages[0]!.text,'Original draft');
 }finally{await p.dispose();}
});

for(const identity of ['threadId','turnId','epoch'] as const)test('late native ACK cannot confirm a changed '+identity,async()=>{
 const p=await peer();try{
  const pending=p.steer();p.store.db.prepare('UPDATE runs SET '+identity+'=? WHERE id=?').run(identity==='epoch'?99:'other-'+identity,p.actor.runId!);
  await p.receive({id:p.writes()[0]!.id,result:{turnId:p.actor.turnId}});
  const target=p.tasks.run(p.actor.runId!);
  assert.equal((await pending).state,'uncertain');assert.equal(p.operation().state,'uncertain');
  assert.equal(p.tasks.run(p.actor.runId!).stateRevision,target.stateRevision);assert.equal(p.tasks.run(p.actor.runId!).phase,target.phase);
  const details=JSON.parse(p.operation().detailsJson);assert.notEqual(p.store.db.prepare('SELECT state FROM agent_receipts WHERE messageId=?').get(details.messageId)!.state,'processed');
  assert.equal(p.writes().length,1);
 }finally{await p.dispose();}
});

test('confirmed stop retires a pending steer and a late ACK cannot revive its receipt',async()=>{
 const p=await peer();try{
  const pending=p.steer(),stop=p.tasks.workerStop(main,{operationId:'stop',workerId:p.worker.workerId});
  p.tasks.confirmWorkerExit(p.actor.runId!,undefined);p.tasks.confirmStop(stop.operationKey,true);
  await p.receive({id:p.writes()[0]!.id,result:{turnId:p.actor.turnId}});assert.equal((await pending).state,'cancelled');
  assert.equal(p.operation().state,'cancelled');assert.equal((await p.steer()).state,'cancelled');assert.equal(p.writes().length,1);
  assert.throws(()=>p.tasks.writeFile(p.actor,{operationId:'late',filename:'late.md',bytes:Buffer.from('late')}),/stale|live/);
 }finally{await p.dispose();}
});

for(const state of ['dispatching','uncertain','confirmed'] as const)test('settlement respects scoped steering state='+state,async()=>{
 const p=await peer();try{
  const sent=p.tasks.workerSend(main,{operationId:'steer',workerId:p.worker.workerId,text:'Supplement',immediate:true});
  p.tasks.markSteer(sent.operationKey,'dispatching');
  if(state==='confirmed')p.tasks.markSteer(sent.operationKey,'received');
  else if(state==='uncertain')p.tasks.markSteer(sent.operationKey,'uncertain');
  const returned=p.tasks.endSegment(p.actor.runId!,p.actor.epoch!,{status:'completed',text:'Original draft'},true)!;
  if(state==='confirmed')assert.equal(p.tasks.settleTask(main,{...mutation(p,'settle'),outcome:'succeeded'}).state,'settled');
  else assert.throws(()=>p.tasks.settleTask(main,{...mutation(p,'settle'),outcome:'succeeded'}),/operation_uncertain/);
  assert.equal(p.tasks.workerRead(main,{workerId:p.worker.workerId,messageId:returned.messageId}).messages[0]!.text,'Original draft');
  assert.equal(p.tasks.operation(sent.operationKey).state,state);
 }finally{await p.dispose();}
});

test('persisted native terminal recovers exact original output once and resumes the original thread',async()=>{
 const p=await peer();try{
  const pending=p.steer();await p.receive({id:p.writes()[0]!.id,result:{turnId:p.actor.turnId}});await pending;
  p.tasks.recordWorkerTerminal(p.actor.runId!,p.actor.epoch!,{status:'completed',text:'Persisted original draft'});
  p.tasks.confirmWorkerExit(p.actor.runId!,undefined);p.tasks.reconcile();
  assert.equal(p.tasks.run(p.actor.runId!).epoch,p.actor.epoch!+1);
  const replies=p.tasks.workerRead(main,{workerId:p.worker.workerId}).messages.filter(message=>message.kind==='worker_reply');
  assert.equal(replies.length,1);assert.equal(replies[0]!.text,'Persisted original draft');assert.equal(replies[0]!.taskVersion,1);
  const next=p.tasks.workerSend(main,{operationId:'followup',workerId:p.worker.workerId,text:'Continue'});
  assert.equal(p.tasks.run(next.runId!).threadId,p.actor.threadId);assert.equal(p.tasks.run(next.runId!).version,1);
  assert.equal((await p.steer()).state,'confirmed');assert.equal(p.writes().length,1);
 }finally{await p.dispose();}
});

test('ACK after a returned draft cannot launch a successor before the exact exit checkpoint',async()=>{
 const p=await peer();try{
  const pending=p.steer(),returned=p.tasks.endSegment(p.actor.runId!,p.actor.epoch!,{status:'completed',text:'Draft before ACK'},false)!;
  assert.throws(()=>p.tasks.workerSend(main,{operationId:'before-ack',workerId:p.worker.workerId,text:'Continue'}),/operation_uncertain/);
  await p.receive({id:p.writes()[0]!.id,result:{turnId:p.actor.turnId}});await pending;
  assert.equal(p.tasks.workerSend(main,{operationId:'followup',workerId:p.worker.workerId,text:'Continue'}).runId,null);assert.equal(p.tasks.claim(),undefined);
  p.tasks.confirmWorkerExit(p.actor.runId!,undefined);const next=p.tasks.claim()!;assert.ok(next);assert.equal(next.threadId,p.actor.threadId);
  assert.equal(p.tasks.workerRead(main,{workerId:p.worker.workerId,messageId:returned.messageId}).messages[0]!.text,'Draft before ACK');assert.equal(p.writes().length,1);
 }finally{await p.dispose();}
});

test('lost file-write receipt preserves the raw return and blocks settlement without replaying the write',async()=>{
 const p=await peer();try{
  const write=p.files.writeBinary.bind(p.files);p.files.writeBinary=(...args)=>{write(...args);throw Error('synthetic_write_receipt_lost');};
  assert.throws(()=>p.tasks.writeFile(p.actor,{operationId:'unfinished-write',filename:'pending.md',bytes:Buffer.from('Actual preserved bytes')}),/synthetic_write_receipt_lost/);
  p.files.writeBinary=write;
  const returned=p.tasks.endSegment(p.actor.runId!,p.actor.epoch!,{status:'completed',text:'Original draft'},true)!;
  const operation=p.store.db.prepare("SELECT * FROM operations WHERE operationId='unfinished-write'").get()!;
  assert.equal(operation.state,'accepted');assert.throws(()=>p.tasks.settleTask(main,{...mutation(p,'settle'),outcome:'succeeded'}),/operation_uncertain/);
  assert.deepEqual(p.store.db.prepare("SELECT * FROM operations WHERE operationId='unfinished-write'").get(),operation);
  const runDirectory=p.files.prepareRun(p.task.taskId,p.actor.runId!);
  assert.equal(readFileSync(join(runDirectory,'pending.md'),'utf8'),'Actual preserved bytes');
  assert.equal(p.tasks.workerRead(main,{workerId:p.worker.workerId,messageId:returned.messageId}).messages[0]!.text,'Original draft');
 }finally{await p.dispose();}
});

test('another Task unknown steer does not block this Task settlement or alter its receipt',async()=>{
 const p=await peer();try{
  const other=p.tasks.createTask(main,{operationId:'other-task',goal:'Separate goal',authority:authority()}),worker=p.tasks.workerOpen(main,{operationId:'other-worker',taskId:other.taskId,text:'Inspect separate input'}),actor=running(p,worker.runId);
  const sent=p.tasks.workerSend(main,{operationId:'steer-other',workerId:worker.workerId,text:'Separate supplement',immediate:true});
  p.tasks.markSteer(sent.operationKey,'dispatching');p.tasks.markSteer(sent.operationKey,'uncertain');
  p.tasks.endSegment(actor.runId!,actor.epoch!,{status:'completed',text:'Separate checked facts'},true);
  const original=p.tasks.operation(sent.operationKey);
  p.tasks.endSegment(p.actor.runId!,p.actor.epoch!,{status:'completed',text:'Current checked facts'},true);
  assert.equal(p.tasks.settleTask(main,{...mutation(p,'settle'),outcome:'succeeded'}).state,'settled');
  assert.deepEqual(p.tasks.operation(sent.operationKey),original);
 }finally{await p.dispose();}
});
