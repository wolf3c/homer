import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {CodexEngine} from '../src/engine.js';
import {Homer} from '../src/service.js';
import {RecursiveTools} from '../src/recursive-tools.js';
import type {Config} from '../src/config.js';
import {fixture,delegate,running,main,contract} from './recursive-fixture.js';

mkdirSync(resolve('.codex/scratch/recursive-agent-implementation'),{recursive:true});
async function flush(){await new Promise<void>(done=>setImmediate(done));}
async function peer(){
 const f=fixture(),child=delegate(f),actor=running(f,child.taskId),task=f.tasks.task(child.taskId);
 const config={workspace:f.files.workspace,stopGraceMs:100} as Config;
 const engine=new CodexEngine(config,{cwd:f.files.workspace,readRoots:[],instructions:'synthetic',tools:[]},async()=>({}));
 const sent:{id:number;method:string;params:any}[]=[];
 engine.threadId=actor.threadId;engine['send']=(message:any)=>{sent.push(message);};
 const receive=(message:unknown)=>engine['receive'](JSON.stringify(message));
 const turn=engine.turn('synthetic');turn.catch(()=>{});
 await receive({id:sent[0]!.id,result:{turn:{id:actor.turnId}}});await flush();
 // Only exercise the real update effect; no pumps, real processes or production state.
 const app=Object.create(Homer.prototype) as Homer;
 Object.assign(app,{tasks:f.tasks,workers:new Map([[actor.runId,{engine}]])});
 const tools=new RecursiveTools(f.tasks,{rootAuthority:()=>f.tasks.authority(f.root.taskId,1),wake:()=>{},stop:async()=>{},update:(receipt,mode)=>app['applyUpdate'](receipt,mode)});
 const input={operationId:'steer-receipt',taskId:task.id,version:1,expectedTaskRevision:task.revision,mode:'steer',contract:{...contract(),goal:'Synthetic updated requirement'},children:[],queuedDisposition:[],independent:false};
 const update=()=>{const work=tools.call(main,'task_update',input) as Promise<Record<string,any>>;work.catch(()=>{});return work;};
 const repeat=async()=>{const count=sent.length,work=update();for(const request of sent.slice(count))if(request.method==='turn/steer')await receive({id:request.id,result:{turnId:actor.turnId}});return work;};
 const operation=()=>f.store.db.prepare("SELECT state,detailsJson FROM operations WHERE operationId='steer-receipt'").get() as {state:string;detailsJson:string};
 const writes=()=>sent.filter(x=>x.method==='turn/steer');
 return {...f,actor,child,engine,receive,update,repeat,operation,writes,dispose:async()=>{await engine.close();await Promise.allSettled([turn]);f.close();}};
}

for(const ending of ['disconnect','close'] as const)test(`steer accepted by native with lost ACK remains durably uncertain on ${ending} without replay`,async()=>{
 const p=await peer();
 try{
  const pending=p.update();assert.equal(p.writes().length,1); // Controlled native peer has received the request.
  if(ending==='close')await p.engine.close();else p.engine['fail'](Error('engine_disconnected'));
  const receipt=await pending;
  assert.equal(receipt.state,'uncertain');assert.equal(receipt.code,ending==='close'?'engine_closed':'engine_disconnected');
  assert.equal(p.operation().state,'uncertain');assert.equal(JSON.parse(p.operation().detailsJson).rpcState,'uncertain');
  assert.equal(p.tasks.run(p.actor.runId!).phase,'uncertain');
  assert.equal(p.tasks.run(p.actor.runId!).contractVersion,1);assert.equal(p.tasks.run(p.actor.runId!).targetVersion,2);
  assert.throws(()=>p.tasks.writeMarkdown(p.actor,{operationId:'stale-write',filename:'stale.md',content:'must not write'}),/adopt|phase/);
  await p.receive({id:p.writes()[0]!.id,result:{turnId:p.actor.turnId}}); // Late ACK cannot imply adoption or clear uncertainty.
  assert.equal((await p.repeat()).state,'uncertain');assert.equal(p.operation().state,'uncertain');
  assert.equal(p.writes().length,1);assert.equal(p.engine['pending'].size,0);
 }finally{await p.dispose();}
});

test('explicit native steer rejection is failed and never retried as an unknown receipt',async()=>{
 const p=await peer();
 try{
  const pending=p.update();await p.receive({id:p.writes()[0]!.id,error:{code:-32600,message:'no active turn to steer'}});
  const receipt=await pending;assert.equal(receipt.state,'failed');assert.equal(receipt.code,'engine_rpc_failed');
  assert.equal(p.operation().state,'failed');assert.equal(JSON.parse(p.operation().detailsJson).rpcState,'failed');
  assert.equal(p.tasks.run(p.actor.runId!).phase,'executing');
  assert.equal((await p.repeat()).state,'failed');assert.equal(p.writes().length,1);
 }finally{await p.dispose();}
});

test('normal steer ACK is received but not adopted, and duplicate operation does not resend',async()=>{
 const p=await peer();
 try{
  const pending=p.update();await p.receive({id:p.writes()[0]!.id,result:{turnId:p.actor.turnId}});
  const receipt=await pending;assert.equal(receipt.state,'received');assert.equal(receipt.adopted,false);
  assert.equal(p.operation().state,'dispatching');assert.equal(JSON.parse(p.operation().detailsJson).rpcState,'received');
  assert.equal(p.tasks.run(p.actor.runId!).contractVersion,1);assert.equal(p.tasks.run(p.actor.runId!).targetVersion,2);
  assert.throws(()=>p.tasks.writeMarkdown(p.actor,{operationId:'unadopted-write',filename:'stale.md',content:'must not write'}),/adopt/);
  assert.equal((await p.repeat()).state,'received');assert.equal(p.writes().length,1);
  p.tasks.inspect(p.actor,{taskId:p.child.taskId});
  p.tasks.adopt(p.actor,{operationId:'adopt',taskId:p.child.taskId,version:2,expectedTaskRevision:p.tasks.task(p.child.taskId).revision,contractHash:receipt.contractHash});
  assert.equal(p.operation().state,'confirmed');assert.equal(p.tasks.run(p.actor.runId!).contractVersion,2);
  const adopted=await p.repeat();assert.equal(adopted.adopted,true);assert.equal(p.writes().length,1);
 }finally{await p.dispose();}
});

test('duplicate update while steer ACK is pending reuses dispatch state and sends once',async()=>{
 const p=await peer();
 try{
  const pending=p.update();
  const duplicate=p.update();
  // Supply receipts to all observed requests so the red implementation cannot hang this test.
  for(const request of p.writes())await p.receive({id:request.id,result:{turnId:p.actor.turnId}});
  assert.equal((await pending).state,'received');assert.equal((await duplicate).state,'dispatching');
  assert.equal(p.writes().length,1);
 }finally{await p.dispose();}
});

test('pre-send transport failure, inapplicable turn and mismatched ACK remain definite failures',async()=>{
 for(const reason of ['before-send','not-applicable','sync-send','mismatched-ack']){
  const p=await peer();
  try{
   if(reason==='before-send')p.engine['failure']=Error('engine_disconnected');
   if(reason==='not-applicable')p.engine.turnId='other-turn';
   if(reason==='sync-send')p.engine['send']=()=>{throw Error('engine_disconnected');};
   const pending=p.update();
   if(reason==='mismatched-ack')await p.receive({id:p.writes()[0]!.id,result:{turnId:'other-turn'}});
   const receipt=await pending;assert.equal(receipt.state,'failed',reason);assert.equal(p.operation().state,'failed',reason);
   assert.equal(p.tasks.run(p.actor.runId!).phase,'executing',reason);
   assert.equal(p.writes().length,reason==='mismatched-ack'?1:0,reason);
  }finally{await p.dispose();}
 }
});

// A host terminal records evidence even when the Worker never adopted its target.
test('host records an old-contract return without treating it as adoption or current-version completion',async()=>{
 const p=await peer();try{
  const pending=p.update();await p.receive({id:p.writes()[0]!.id,result:{turnId:p.actor.turnId}});await pending;
  const result=p.tasks.endSegment(p.actor.runId!,p.actor.epoch!,{status:'completed',text:'Synthetic old-contract return'},true)!;
  assert.ok(result.resultId);const run=p.tasks.run(p.actor.runId!),task=p.tasks.task(p.child.taskId);
  assert.equal(run.contractVersion,1);assert.equal(run.targetVersion,2);assert.equal(task.state,'recovery');assert.equal(task.outcome,null);
  const actual=p.tasks.inspect(main,{resultId:result.resultId});assert.equal(actual.actualResult?.version,1);
  assert.equal(JSON.parse(p.operation().detailsJson).rpcState,'received');
 }finally{await p.dispose();}
});
