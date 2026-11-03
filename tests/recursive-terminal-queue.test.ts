// F2 requirements-derived synthetic regression. No live database, Homer constructor/start or engine.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {Store} from '../src/store.js';
import {Files} from '../src/files.js';
import {WorkerInteractions} from '../src/worker-interactions.js';
import {RecursiveTasks,recursiveHash,type Actor,type Contract,type Outcome} from '../src/recursive-tasks.js';
import {RecursiveTools,RECURSIVE_TOOLS} from '../src/recursive-tools.js';
import {engineError} from '../src/engine.js';
const main:Actor={agentId:'main:f2-synthetic',sourceRequestId:'f2-synthetic-user'};
const contract=(kind:Contract['resultKind']='structured'):Contract=>({goal:'F2 synthetic contract',inputs:[],resultKind:kind,acceptance:{criteria:[{id:'facts',required:true,description:'Synthetic evidence'}]}});
function fixture(){
  mkdirSync('.codex/scratch/terminal-queue-rejection',{recursive:true});
  const dir=mkdtempSync(resolve('.codex/scratch/terminal-queue-rejection/fixture-'));
  const store=new Store(':memory:'),files=new Files(join(dir,'workspace'));
  new WorkerInteractions(store.db);const tasks=new RecursiveTasks(store,files);tasks.migrate();
  store.setMeta('mainAgentId',main.agentId);store.startRequest(main.sourceRequestId!,'synthetic');
  const root=tasks.createRoot(main,{operationId:'root',title:'F2 synthetic',contract:contract('aggregate'),authority:{sourceRequestId:main.sourceRequestId!,description:'Synthetic authorized work',materials:[],resultIds:[],collaborateTaskIds:[]}});
  return {store,tasks,files,root,close(){store.close();rmSync(dir,{recursive:true,force:true});}};
}
type F=ReturnType<typeof fixture>;
function mutation(f:F,taskId:string,operationId:string){const t=f.tasks.task(taskId);return {operationId,taskId,version:t.headVersion,expectedTaskRevision:t.revision};}
function update(f:F,taskId:string,operationId='queue',mode:'queue'|'stop_replace'|'steer'='queue'){
  return {...mutation(f,taskId,operationId),mode,contract:contract(f.tasks.task(taskId).executorKind==='main'?'aggregate':'structured'),children:[],queuedDisposition:[],independent:false};
}
function worker(f:F){return f.tasks.delegate(main,{...mutation(f,f.root.taskId,'delegate'),contract:contract(),dependencies:[]});}
function running(f:F,taskId:string):Actor{
  const t=f.tasks.task(taskId),r=f.tasks.claim(t.currentRunId!)!;assert.ok(r);f.tasks.bind(r.id,r.epoch,'thread-'+r.id,'turn-'+r.id);
  return {agentId:t.executorAgentId,runId:r.id,epoch:r.epoch,threadId:'thread-'+r.id,turnId:'turn-'+r.id};
}
function finish(f:F,taskId:string,outcome:Outcome,actor:Actor=main){
  if(!actor.runId){const t=f.tasks.task(taskId);return f.tasks.publish(main,{...mutation(f,taskId,'publish-'+t.headVersion),resultId:null,text:'Synthetic result',publishedFileResultId:null,outcome,evidence:{facts:'Checked',gaps:'Synthetic gap'},children:[]});}
  const r=f.tasks.endSegment(actor.runId,actor.epoch!,{status:'completed',text:'Synthetic inspected result'},true)!;
  f.tasks.inspect(main,{resultId:r.resultId});
  f.tasks.review(main,{...mutation(f,taskId,'review-'+r.resultId),resultId:r.resultId,accepted:true,outcome,reason:'Synthetic inspected',evidence:{facts:'Checked',gaps:'Synthetic gap'},children:[]});
  return r;
}

function snapshot(f:F){
  const names=f.store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as {name:string}[];
  return Object.fromEntries(names.map(({name})=>[name,f.store.db.prepare('SELECT * FROM '+name+' ORDER BY rowid').all()]));
}
const outcomes:Outcome[]=['succeeded','partial','failed','cancelled','interrupted'];
for(const kind of ['main','worker'] as const)for(const outcome of outcomes)test(`F2: settled ${kind} ${outcome} rejects new queue atomically, including independent`,()=>{
  const f=fixture();try{
    const taskId=kind==='main'?f.root.taskId:worker(f).taskId,actor=kind==='main'?main:running(f,taskId);
    finish(f,taskId,outcome,actor);assert.equal(f.tasks.task(taskId).state,'settled');assert.equal(f.tasks.task(taskId).outcome,outcome);
    assert.throws(()=>f.tasks.continue(main,mutation(f,taskId,'terminal-continue')),/task_terminal/);
    const before=snapshot(f);
    for(const independent of [false,true]){
      const input={...update(f,taskId,'reject-'+independent),independent};
      for(let i=0;i<2;i++)assert.throws(()=>f.tasks.update(main,input),{message:'task_queue_not_applicable'});
      assert.deepEqual(snapshot(f),before);
    }
    assert.equal(f.tasks.queuedVersions(taskId).length,0);
  }finally{f.close();}
});
test('F2: actual failRun and confirmed stop are terminal; rejected queue cannot block otherwise idle upgrade',()=>{
  for(const action of ['fail','stop'] as const){const f=fixture();try{
    const w=worker(f),actor=running(f,w.taskId);
    if(action==='fail')f.tasks.failRun(actor.runId!,actor.epoch!,'synthetic_failure');
    else {const stop=f.tasks.stop(main,{...mutation(f,w.taskId,'stop'),scope:'self',reason:'Synthetic cancellation'});f.tasks.confirmStop(stop.operationKey,true);}
    for(const m of f.tasks.inbox(main))f.tasks.ack(main,{operationId:'ack-'+m.id,messageId:m.id,disposition:'processed',reason:'Synthetic observed'});
    assert.equal(f.tasks.task(w.taskId).state,'settled');assert.equal(f.tasks.safeToUpgrade(),true);
    const before=snapshot(f);assert.throws(()=>f.tasks.update(main,update(f,w.taskId)),{message:'task_queue_not_applicable'});
    assert.deepEqual(snapshot(f),before);assert.equal(f.tasks.safeToUpgrade(),true);
  }finally{f.close();}}
});
for(const boundary of ['queued','executing','held','recovery','awaiting_review'] as const)test('F2: nonterminal '+boundary+' retains queue acceptance and replay',()=>{
  const f=fixture();try{
    const w=worker(f);let actor:Actor|undefined;
    if(boundary!=='queued')actor=running(f,w.taskId);
    if(boundary==='held'){
      f.tasks.stop(main,{...mutation(f,f.root.taskId,'hold-parent'),scope:'self',reason:'Synthetic parent hold'});
      assert.equal(f.tasks.task(w.taskId).controlState,'held');
    }
    if(boundary==='recovery'){f.tasks.failRun(actor!.runId!,actor!.epoch!,'synthetic_unconfirmed',true);assert.equal(f.tasks.task(w.taskId).state,'recovery');}
    if(boundary==='awaiting_review'){
      f.tasks.endSegment(actor!.runId!,actor!.epoch!,{status:'completed',text:JSON.stringify({synthetic:true})},true)!;
      f.tasks.endSegment(actor!.runId!,actor!.epoch!,{status:'completed',text:'Synthetic final result'},true);assert.equal(f.tasks.run(actor!.runId!).status,'awaiting_review');
    }
    const before=f.tasks.task(w.taskId),input=update(f,w.taskId),receipt=f.tasks.update(main,input);
    assert.equal(receipt.state,'queued');assert.equal(f.tasks.task(w.taskId).headVersion,before.headVersion);assert.equal(f.tasks.task(w.taskId).currentRunId,before.currentRunId);
    const after=snapshot(f);assert.deepEqual(f.tasks.update(main,input),receipt);assert.deepEqual(snapshot(f),after);
    assert.throws(()=>f.tasks.update(main,{...input,independent:true}),/operation_payload_conflict/);
  }finally{f.close();}
});
test('F2: active queued versions activate in order, receipts replay their latest stored state and new attempts remain claimable',()=>{
  const f=fixture();try{
    const w=worker(f),actor=running(f,w.taskId),q1=update(f,w.taskId,'queue-1'),r1=f.tasks.update(main,q1),q2=update(f,w.taskId,'queue-2'),r2=f.tasks.update(main,q2);
    finish(f,w.taskId,'succeeded',actor);
    assert.equal(f.tasks.task(w.taskId).headVersion,r1.version);assert.equal(f.tasks.queuedVersions(w.taskId)[0]!.version,r2.version);
    const replay=f.tasks.update(main,q1);assert.equal(replay.state,'activated');assert.equal(replay.operationKey,r1.operationKey);
    finish(f,w.taskId,'succeeded',running(f,w.taskId));assert.equal(f.tasks.task(w.taskId).headVersion,r2.version);
    assert.equal(f.tasks.update(main,q2).state,'activated');assert.ok(running(f,w.taskId).runId);
  }finally{f.close();}
});
for(const outcome of ['failed','cancelled'] as const)for(const independent of [false,true])test(`F2: preaccepted queue retains ${outcome} / independent=${independent} settlement policy`,()=>{
  const f=fixture();try{
    const w=worker(f),actor=running(f,w.taskId),input={...update(f,w.taskId),independent},receipt=f.tasks.update(main,input);
    finish(f,w.taskId,outcome,actor);const op=f.tasks.operation(receipt.operationKey);
    assert.equal(op.state,outcome==='cancelled'?(independent?'confirmed':'cancelled'):'accepted');
    assert.equal(f.tasks.task(w.taskId).headVersion,outcome==='cancelled'&&independent?receipt.version:1);
    if(outcome==='failed')assert.equal(JSON.parse(op.detailsJson).state,'blocked');
    const before=snapshot(f);assert.deepEqual(f.tasks.update(main,input),JSON.parse(op.responseJson!));assert.deepEqual(snapshot(f),before);
  }finally{f.close();}
});
test('F2: legacy dangling accepted receipt replays verbatim without activation; payload conflicts and explicit queue disposition remain intact',()=>{
  const f=fixture();try{
    finish(f,f.root.taskId,'succeeded');const input=update(f,f.root.taskId,'legacy-accepted'),key='op-f2-legacy';
    // Synthetic pre-upgrade fact: an accepted terminal queue, not a new API call.
    const receipt={taskId:input.taskId,version:2,state:'queued',contractHash:recursiveHash({...input.contract,workingDirectory:f.files.workspace}),operationKey:key};
    f.store.db.prepare("INSERT INTO operations VALUES(?,?,?,?,?,?,'accepted',?,?,1)").run(key,main.agentId,input.taskId,input.operationId,'update',recursiveHash(input),JSON.stringify({mode:'queue',version:2,predecessor:1,independent:false,state:'ordered'}),JSON.stringify(receipt));
    f.store.db.prepare('INSERT INTO task_versions(taskId,version,goal,inputsJson,resultKind,acceptanceJson,authorityJson,sourceRequestId,triggerOpId,workingDirectory) SELECT taskId,2,goal,inputsJson,resultKind,acceptanceJson,authorityJson,sourceRequestId,?,workingDirectory FROM task_versions WHERE taskId=? AND version=1').run(key,input.taskId);
    f.store.db.prepare('UPDATE tasks SET revision=revision+1 WHERE id=?').run(input.taskId);
    const before=snapshot(f);assert.deepEqual(f.tasks.update(main,input),receipt);assert.deepEqual(f.tasks.update(main,input),receipt);assert.deepEqual(snapshot(f),before);
    assert.equal(f.tasks.task(input.taskId).headVersion,1);assert.equal(f.tasks.safeToUpgrade(),false);
    assert.throws(()=>f.tasks.update(main,{...input,contract:{...input.contract,goal:'Changed'}}),/operation_payload_conflict/);assert.deepEqual(snapshot(f),before);
    assert.throws(()=>f.tasks.update(main,update(f,input.taskId,'replace-needs-disposition','stop_replace')),/task_queued_disposition_required/);assert.deepEqual(snapshot(f),before);
  }finally{f.close();}
});
for(const kind of ['main','worker'] as const)for(const outcome of outcomes)test(`F2: explicit stop_replace restarts settled ${kind} ${outcome} on the same Task`,()=>{
  const f=fixture();try{
    const taskId=kind==='main'?f.root.taskId:worker(f).taskId,actor=kind==='main'?main:running(f,taskId);finish(f,taskId,outcome,actor);
    const old=f.tasks.task(taskId),input=update(f,taskId,'replace','stop_replace'),receipt=f.tasks.update(main,input);
    assert.equal(receipt.state,'confirmed');assert.equal(f.tasks.task(taskId).headVersion,2);assert.equal(f.tasks.task(taskId).outcome,null);
    if(kind==='worker'){const next=running(f,taskId);assert.notEqual(next.runId,old.currentRunId);assert.equal(f.tasks.run(next.runId!).replacesRunId,old.currentRunId);finish(f,taskId,'succeeded',next);}
    else {assert.equal(f.tasks.task(taskId).state,'waiting');finish(f,taskId,'succeeded');}
    assert.equal(f.tasks.task(taskId).outcome,'succeeded');const before=snapshot(f);assert.deepEqual(f.tasks.update(main,input),receipt);assert.deepEqual(snapshot(f),before);
  }finally{f.close();}
});
test('F2: tool rejection preserves machine error, publishes guidance and never invokes update/wake effects',async()=>{
  const f=fixture();try{
    finish(f,f.root.taskId,'succeeded');let updates=0,wakes=0;
    const tools=new RecursiveTools(f.tasks,{rootAuthority(){throw Error('unexpected_authority');},wake(){wakes++;},async stop(){throw Error('unexpected_stop');},async update(receipt){updates++;return receipt;}});
    const description=RECURSIVE_TOOLS.find(t=>t.name==='task_update')!.description;
    assert.match(description,/task_queue_not_applicable/);assert.match(description,/settled/);assert.match(description,/work_inspect/);assert.match(description,/stop_replace/);
    await assert.rejects(tools.call(main,'task_update',update(f,f.root.taskId)),(error:unknown)=>{assert.equal(engineError(error),'task_queue_not_applicable');return true;});
    assert.equal(updates,0);assert.equal(wakes,0);
    const replacement=await tools.call(main,'task_update',update(f,f.root.taskId,'replace','stop_replace')) as {state:string};assert.equal(replacement.state,'confirmed');assert.equal(updates,1);assert.equal(wakes,1);
  }finally{f.close();}
});

test('F2: existing CAS and subtree stop fences retain precedence; guidance does not lift a stop fence',()=>{
  const f=fixture();try{
    const taskId=worker(f).taskId,actor=running(f,taskId);
    const stop=f.tasks.stop(main,{...mutation(f,taskId,'subtree-stop'),scope:'subtree',reason:'Synthetic subtree stop'});f.tasks.confirmStop(stop.operationKey,true);
    assert.equal(f.tasks.task(taskId).state,'settled');
    const before=snapshot(f);
    for(const mode of ['queue','stop_replace'] as const)assert.throws(()=>f.tasks.update(main,update(f,taskId,mode,mode)),/task_stop_requested/);
    assert.throws(()=>f.tasks.update(main,{...update(f,taskId),expectedTaskRevision:0}),/task_revision_conflict/);
    assert.deepEqual(snapshot(f),before);assert.equal(f.tasks.run(actor.runId!).status,'cancelled');
  }finally{f.close();}
});
