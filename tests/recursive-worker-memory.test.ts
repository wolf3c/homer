// Synthetic Worker snapshot inheritance and memory fencing; no model calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Memory } from '../src/memory.js';
import { ConversationHistory } from '../src/web-history.js';
import { RecursiveTasks } from '../src/recursive-tasks.js';
import { fixture, main, delegate, running, complete, accept } from './recursive-fixture.js';
test('HMR-RECURSIVE-009: child snapshot is a subset of its parent and forgetting fences old Worker reads and mutations', () => {
  const f = fixture();
  try {
    const history = new ConversationHistory(f.store.db), memory = new Memory(f.store);
    const remember = (requestId: string, text: string) => { history.accept('synthetic-memory-thread', { requestId, text }); memory.observe(requestId, 'synthetic-memory-thread'); memory.adopt(requestId, 'synthetic-memory-thread', text); return memory.propose({ operationId: requestId, content: text.slice('请记住：'.length) }, { requestId, threadId: 'synthetic-memory-thread', epoch: memory.settings().epoch }); };
    const first = remember('synthetic-preference', '请记住：以后报告都用中文。');
    const parentSnapshot = memory.snapshot('报告 中文');
    f.tasks = new RecursiveTasks(f.store, f.files, {
      validateActor(actor) {
        if (actor.runId)
          memory.validateRun(actor.runId);
      }, attemptCreated(run, context) { memory.bindSnapshot(run.id, context.parentRunId ? memory.runSnapshot(context.parentRunId) : parentSnapshot); }
    });
    const parent = delegate(f, 'parent'), actor = running(f, parent.taskId);
    remember('synthetic-extra', '请记住：我习惯简短回答。');
    const child = delegate(f, 'child', parent.taskId, actor);
    assert.deepEqual(memory.runSnapshot(child.runId).entries.map(x => x.id), memory.runSnapshot(parent.runId).entries.map(x => x.id));
    assert.equal(memory.runSnapshot(child.runId).entries.length, 1);
    memory.forget({ operationId: 'forget-first', id: first.id, expectedRevision: first.revision });
    assert.throws(() => f.tasks.inspect(actor, { taskId: parent.taskId }), /memory_epoch_stale/);
    assert.throws(() => complete(f, actor, parent.taskId), /memory_epoch_stale/);
    assert.throws(() => delegate(f, 'forbidden-after-forget', parent.taskId, actor), /memory_epoch_stale/);
    assert.equal(f.tasks.children(parent.taskId).length, 1);
  }
  finally {
    f.close();
  }
});
test('HMR-RECURSIVE-001/009: attempt snapshot failure rolls back Task, Run, authority and operation together', () => {
  const f = fixture();
  try {
    f.tasks = new RecursiveTasks(f.store, f.files, { validateActor() { }, attemptCreated() { throw Error('synthetic_snapshot_denied'); } });
    assert.throws(() => delegate(f, 'failed-snapshot', f.root.taskId, main), /synthetic_snapshot_denied/);
    assert.equal(f.tasks.tasks().length, 1);
    assert.equal(f.store.runs().length, 0);
    assert.equal(f.store.db.prepare('SELECT count(*) n FROM worker_authorities').get()!.n, 0);
    assert.equal(f.store.db.prepare("SELECT count(*) n FROM operations WHERE operationId='failed-snapshot'").get()!.n, 0);
  }
  finally {
    f.close();
  }
});
test('HMR-RECURSIVE-009: explicit recovery inherits the current coordinator snapshot while historical Workers remain fenced',()=>{
  const f=fixture();try{
    const memory=new Memory(f.store);
    f.tasks=new RecursiveTasks(f.store,f.files,{validateActor:a=>{if(a.runId)memory.validateRun(a.runId);},attemptCreated:(run,context)=>memory.bindSnapshot(run.id,context.parentRunId?memory.runSnapshot(context.parentRunId):memory.snapshot('Synthetic recovery',{matterId:run.matterId}))});
    const parent=delegate(f,'parent'),oldParent=running(f,parent.taskId),child=delegate(f,'child',parent.taskId,oldParent),oldChild=running(f,child.taskId);
    // A legacy disabled database is restored by its owner, fencing old snapshots.
    f.store.db.prepare('UPDATE memory_settings SET enabled=0 WHERE ownerId=?').run(memory.ownerId);new Memory(f.store);f.tasks.reconcile();
    const mutate=(taskId:string)=>({taskId,version:1,expectedTaskRevision:f.tasks.task(taskId).revision});
    f.tasks.takeover(main,{...mutate(parent.taskId),operationId:'take-parent',coordinatorAgentId:main.agentId});
    const next=f.tasks.continue(main,{...mutate(parent.taskId),operationId:'recover-parent'});const currentParent=running(f,parent.taskId);
    f.tasks.takeover(main,{...mutate(child.taskId),operationId:'return-child',coordinatorAgentId:currentParent.agentId});
    const recovered=f.tasks.continue(currentParent,{...mutate(child.taskId),operationId:'recover-child'});
    assert.notEqual(recovered.runId,oldChild.runId);assert.notEqual(next.runId,oldParent.runId);
    assert.equal(memory.runSnapshot(String(recovered.runId)).epoch,memory.settings().epoch);
    assert.throws(()=>memory.runSnapshot(oldChild.runId!),/memory_epoch_stale/);
    assert.equal(f.tasks.children(parent.taskId)[0]!.id,child.taskId);
  }finally{f.close();}
});
test('HMR-RECURSIVE-009: forgetting A rejects an already offered A result while unrelated offered B stays reviewable',()=>{
  const f=fixture();try{
    const memory=new Memory(f.store),history=new ConversationHistory(f.store.db);
    history.accept('synthetic-memory-review',{requestId:'synthetic-review-source',text:'请记住：合成参考代号为琥珀。'});
    memory.observe('synthetic-review-source','synthetic-memory-review');memory.adopt('synthetic-review-source','synthetic-memory-review','请记住：合成参考代号为琥珀。');
    const saved=memory.propose({operationId:'synthetic-review-save',content:'合成参考代号为琥珀。'},{requestId:'synthetic-review-source',threadId:'synthetic-memory-review',epoch:0});
    let withReference=true;
    f.tasks=new RecursiveTasks(f.store,f.files,{
      validateActor:a=>{if(a.runId)memory.validateRun(a.runId);},
      validateResult:runId=>memory.validateRun(runId),
      attemptCreated:run=>memory.bindSnapshot(run.id,{epoch:memory.settings().epoch,entries:withReference?[memory.read(saved.id)]:[]}),
    });
    const a=delegate(f,'offered-A'),aa=running(f,a.taskId),ra=complete(f,aa,a.taskId);f.tasks.endSegment(aa.runId!,aa.epoch!,true,true);
    withReference=false;
    const b=delegate(f,'offered-B'),bb=running(f,b.taskId),rb=complete(f,bb,b.taskId);f.tasks.endSegment(bb.runId!,bb.epoch!,true,true);
    memory.forget({operationId:'synthetic-review-forget',id:saved.id,expectedRevision:saved.revision});
    f.tasks.inspect(main,{resultId:ra.resultId});
    const taskA=f.tasks.task(a.taskId);
    assert.throws(()=>f.tasks.review(main,{operationId:'stale-review',taskId:a.taskId,version:1,expectedTaskRevision:taskA.revision,resultId:ra.resultId,accepted:true,outcome:'succeeded',reason:'Synthetic review raced stop'}),/memory_epoch_stale/);
    f.tasks.inspect(main,{resultId:rb.resultId});const taskB=f.tasks.task(b.taskId);
    assert.equal(f.tasks.review(main,{operationId:'fresh-review',taskId:b.taskId,version:1,expectedTaskRevision:taskB.revision,resultId:rb.resultId,accepted:true,outcome:'succeeded',reason:'Synthetic independent facts'}).state,'accepted');
  }finally{f.close();}
});
for(const boundary of ['include','publish'] as const)test('HMR-RECURSIVE-009: forgotten child memory blocks new '+boundary+' without deleting accepted history',()=>{
  const f=fixture();try{
    const memory=new Memory(f.store),history=new ConversationHistory(f.store.db),text='请记住：合成参考代号为琥珀。';
    history.accept('synthetic-memory-consumption',{requestId:'synthetic-consumption-source',text});
    memory.observe('synthetic-consumption-source','synthetic-memory-consumption');memory.adopt('synthetic-consumption-source','synthetic-memory-consumption',text);
    const saved=memory.propose({operationId:'synthetic-consumption-save',content:'合成参考代号为琥珀。'},{requestId:'synthetic-consumption-source',threadId:'synthetic-memory-consumption',epoch:0});
    f.tasks=new RecursiveTasks(f.store,f.files,{validateActor:a=>{if(a.runId)memory.validateRun(a.runId);},validateResult:runId=>memory.validateRun(runId),attemptCreated:run=>memory.bindSnapshot(run.id,memory.snapshot('琥珀'))});
    const child=delegate(f),actor=running(f,child.taskId),result=complete(f,actor,child.taskId);f.tasks.endSegment(actor.runId!,actor.epoch!,true,true);accept(f,child.taskId,result.resultId);
    const aggregate=()=>{const root=f.tasks.task(f.root.taskId);return f.tasks.complete(main,{operationId:'synthetic-aggregate',taskId:root.id,version:1,expectedTaskRevision:root.revision,outcome:'succeeded',payload:{synthetic:true},evidence:{facts:'Checked synthetic accepted child'},children:[{childTaskId:child.taskId,childVersion:1,disposition:'included',resultId:result.resultId,reason:'Synthetic included facts'}]});};
    const parent=boundary==='publish'?aggregate():undefined;
    memory.forget({operationId:'synthetic-consumption-forget',id:saved.id,expectedRevision:saved.revision});
    if(boundary==='include')assert.throws(aggregate,/memory_epoch_stale/);
    else {const root=f.tasks.task(f.root.taskId);assert.throws(()=>f.tasks.publish(main,{operationId:'synthetic-stale-publication',taskId:root.id,version:1,expectedTaskRevision:root.revision,resultId:parent!.resultId,text:'Synthetic obsolete result',publishedFileResultId:null}),/memory_epoch_stale/);}
    assert.equal(f.store.db.prepare('SELECT state FROM results WHERE id=?').get(result.resultId)!.state,'accepted');
    assert.equal(f.tasks.deliveries().length,0);
  }finally{f.close();}
});
