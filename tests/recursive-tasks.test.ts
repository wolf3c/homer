// All fixtures are requirements-derived / synthetic. No model or network calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { Store } from '../src/store.js';
import { WorkerInteractions } from '../src/worker-interactions.js';
import { Files } from '../src/files.js';
import { RecursiveTasks } from '../src/recursive-tasks.js';
import {readTaskOverview} from '../src/task-overview.js';
import {rankedStatusMatters,statusTree} from '../src/task-status.js';
import { main, contract, fixture, delegate, running, complete, accept } from './recursive-fixture.js';
test('main delegation is atomic and idempotent; peer Workers do not occupy the root slot',()=>{
 const f=fixture();try{
  const revision=f.tasks.task(f.root.taskId).revision,a=delegate(f,'a'),b=delegate(f,'b');
  const replay=f.tasks.delegate(main,{operationId:'a',taskId:f.root.taskId,version:1,expectedTaskRevision:revision,contract:contract(),dependencies:[]});
  assert.equal(replay.taskId,a.taskId);assert.notEqual(a.runId,b.runId);assert.equal(f.store.runs().length,2);
  assert.ok(f.store.db.prepare('SELECT 1 FROM worker_authorities WHERE runId=?').get(a.runId));
  assert.throws(()=>f.tasks.delegate(main,{operationId:'bad-input',taskId:f.root.taskId,version:1,expectedTaskRevision:f.tasks.task(f.root.taskId).revision,contract:{...contract(),inputs:[{type:'material',id:'private.md'}]},dependencies:[]}),/authority/);
  assert.equal(f.store.runs().length,2);
 }finally{f.close();}
});
test('HMR-RECURSIVE-004/008: child failure never overwrites root; successful settlement requires every child and required dependency', () => {
  const f = fixture();
  try {
    const a = delegate(f);
    const actor = running(f, a.taskId);
    f.tasks.failRun(actor.runId!, actor.epoch!, 'synthetic_missing');
    assert.equal(f.tasks.task(a.taskId).outcome, 'failed');
    assert.equal(f.store.matters()[0]!.status, 'running');
    const t = f.tasks.task(f.root.taskId);
    assert.throws(() => f.tasks.publish(main,{operationId: 'false-success',taskId: t.id,version: 1,expectedTaskRevision: t.revision,outcome: 'succeeded',evidence: { facts: 'checked' },children: [],resultId:null,text:JSON.stringify({ summary: 'done' }),publishedFileResultId:null}), /child/);
    assert.throws(() => f.tasks.publish(main,{operationId: 'gap-success',taskId: t.id,version: 1,expectedTaskRevision: t.revision,outcome: 'succeeded',evidence: { facts: 'checked' },children: [{ childTaskId: a.taskId, childVersion: 1, disposition: 'gap', reason: 'missing' }],resultId:null,text:JSON.stringify({ summary: 'done' }),publishedFileResultId:null}), /gap/);
  }
  finally {
    f.close();
  }
});
test('HMR-RECURSIVE-003/011: wait returns before turn ends; early/late result produces one continuation and no overlapping turn', () => {
  for (const early of [true, false]) {
    const f = fixture();
    try {
      const a = delegate(f, 'a'), b = delegate(f, 'b');
      const aa = running(f, a.taskId), bb = running(f, b.taskId);
      const finish = () => { complete(f, bb, b.taskId); f.tasks.endSegment(bb.runId!, bb.epoch!, {status:'completed',text:'Synthetic final result'}, true); };
      if (early)
        finish();
      const t = f.tasks.task(a.taskId);
      const w = f.tasks.wait(aa, { operationId: 'wait', taskId: t.id, version: 1, expectedTaskRevision: t.revision, condition: { type: 'result_or_terminal', taskId: b.taskId, version: 1 } });
      assert.equal(w.state, early ? 'ready' : 'waiting');
      assert.equal(f.tasks.run(aa.runId!).phase, 'yielding');
      assert.equal(f.tasks.claim(aa.runId!), undefined);
      assert.throws(() => f.tasks.guard(aa), /yield/);
      f.tasks.endSegment(aa.runId!, aa.epoch!, {status:'completed',text:'Synthetic final result'}, false);
      if (!early)
        finish();
      assert.equal(f.tasks.run(aa.runId!).phase, 'ready');
      assert.ok(f.tasks.claim(aa.runId!));
      assert.equal(f.tasks.claim(aa.runId!), undefined);
    }
    finally {
      f.close();
    }
  }
});
test('HMR-RECURSIVE-005: message identity and authorization come from bound context; messages are not dependencies or approvals', () => {
  const f = fixture();
  try {
    const a = delegate(f, 'a'), b = delegate(f, 'b');
    const aa = running(f, a.taskId), bb = running(f, b.taskId);
    const message = f.tasks.send(aa, { operationId: 'message', taskId: a.taskId, version: 1, expectedTaskRevision: f.tasks.task(a.taskId).revision, recipientAgentId: b.agentId, kind: 'question', payload: { question: 'Synthetic date?' } });
    assert.equal(f.tasks.inbox(bb)[0]!.id, message.messageId);
    assert.equal(f.tasks.inbox(bb)[0]!.senderAgentId, a.agentId);
    assert.throws(() => f.tasks.ack(aa, { operationId: 'forged-ack', messageId: message.messageId, disposition: 'processed', reason: 'self' }), /recipient/);
    f.tasks.ack(bb, { operationId: 'ack', messageId: message.messageId, disposition: 'processed', reason: 'Read synthetic question' });
    assert.equal(f.tasks.inbox(bb).length, 0);
    assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM task_dependencies').get()!.n, 0);
    const other = f.tasks.createRoot(main, { operationId: 'other-root', title: 'Other synthetic root', contract: contract('aggregate'), authority: { sourceRequestId: 'user-synthetic', description: 'Different scope', materials: ['sample.md'], resultIds: [], collaborateTaskIds: [], maxActiveMs: 10000 } });
    const otherChild = delegate(f, 'other-child', other.taskId);
    assert.throws(() => f.tasks.send(aa, { operationId: 'cross', taskId: a.taskId, version: 1, expectedTaskRevision: f.tasks.task(a.taskId).revision, recipientAgentId: otherChild.agentId, kind: 'question', payload: {} }), /scope/);
  }
  finally {
    f.close();
  }
});
test('HMR-RECURSIVE-012: internal structured result needs no file; even accepted child cannot be downloaded before explicit root publication', () => {
  const f = fixture();
  try {
    const a = delegate(f), aa = running(f, a.taskId);
    const result = complete(f, aa, a.taskId);
    f.tasks.endSegment(aa.runId!, aa.epoch!, {status:'completed',text:'Synthetic final result'}, true);
    accept(f, a.taskId, result.resultId);
    assert.equal(f.tasks.publishedArtifact(aa.runId!), undefined);
    assert.equal(f.tasks.pendingDeliveries().length, 0);
    const root = f.tasks.task(f.root.taskId);
    const aggregate = ({operationId: 'root-complete',taskId: root.id,version: 1,expectedTaskRevision: root.revision,outcome: 'succeeded',evidence: { facts: 'Checked accepted child' },children: [{ childTaskId: a.taskId, childVersion: 1, disposition: 'included', resultId: result.resultId, reason: 'Used facts' }],resultId:null,text:JSON.stringify({ summary: 'Dates unknown' }),publishedFileResultId:null} satisfies Parameters<typeof f.tasks.publish>[1]);
    assert.equal(f.tasks.task(root.id).outcome, null);
    const publishRevision = f.tasks.task(root.id).revision;
    const delivery = f.tasks.publish(main, {...aggregate, operationId: 'publish', taskId: root.id, version: 1, expectedTaskRevision: f.tasks.task(root.id).revision, resultId: aggregate.resultId, text: 'Synthetic completed', publishedFileResultId: null });
    assert.equal(f.tasks.pendingDeliveries()[0]!.id, delivery.deliveryId);
    f.tasks.markDelivery(delivery.deliveryId, 'uncertain');
    assert.equal(f.tasks.pendingDeliveries().length, 0);
    assert.equal(f.tasks.delivery(delivery.deliveryId).historyMessageId, delivery.historyMessageId);
    assert.equal(f.tasks.publish(main, {...aggregate, operationId: 'publish', taskId: root.id, version: 1, expectedTaskRevision: publishRevision, resultId: aggregate.resultId, text: 'Synthetic completed', publishedFileResultId: null }).deliveryId, delivery.deliveryId);
  }
  finally {
    f.close();
  }
});
test('HMR-RECURSIVE-006: steer requires active matching turn and explicit adopt; queue preserves current contract', () => {
  const f = fixture();
  try {
    const a = delegate(f), aa = running(f, a.taskId);
    let t = f.tasks.task(a.taskId);
    const change = f.tasks.update(main, { operationId: 'steer', taskId: t.id, version: 1, expectedTaskRevision: t.revision, mode: 'steer', contract: { ...contract(), goal: 'Keep dates unknown and group by owner' }, children: [], queuedDisposition: [] });
    assert.equal(f.tasks.run(aa.runId!).contractVersion, 1);
    assert.equal(f.tasks.run(aa.runId!).targetVersion, 2);
    assert.throws(() => f.tasks.guard(aa), /adopt/);
    f.tasks.inspect(aa, { taskId: t.id });
    f.tasks.adopt(aa, { operationId: 'adopt', taskId: t.id, version: 2, expectedTaskRevision: f.tasks.task(t.id).revision, contractHash: change.contractHash });
    assert.equal(f.tasks.run(aa.runId!).contractVersion, 2);
    t = f.tasks.task(t.id);
    f.tasks.update(main, { operationId: 'queue', taskId: t.id, version: 2, expectedTaskRevision: t.revision, mode: 'queue', contract: contract(), children: [], queuedDisposition: [] });
    assert.equal(f.tasks.task(t.id).headVersion, 2);
    assert.equal(f.store.runs().length, 1);
  }
  finally {
    f.close();
  }
});
test('HMR-RECURSIVE-007: self-stop fences old callbacks and siblings continue; confirmation is separate', () => {
  const f = fixture();
  try {
    const a = delegate(f, 'a'), b = delegate(f, 'b'), aa = running(f, a.taskId);
    let t = f.tasks.task(a.taskId);
    const stopped = f.tasks.stop(main, { operationId: 'stop', taskId: t.id, version: 1, expectedTaskRevision: t.revision, scope: 'self', reason: 'Synthetic precise stop' });
    assert.equal(stopped.state, 'requested');
    assert.equal(f.tasks.task(b.taskId).controlState, 'normal');
    assert.throws(() => f.tasks.guard(aa), /epoch|stop/);
    f.tasks.confirmStop(stopped.operationKey, true);
    assert.equal(f.tasks.task(a.taskId).outcome, 'cancelled');
    assert.equal(f.tasks.safeToUpgrade(), false);
  }
  finally {
    f.close();
  }
});
test('HMR-RECURSIVE-009: restart preserves peer IDs, invalidates old epoch, blocks uncertain operations and retains root budget across attempts', () => {
  const f = fixture();
  try {
    const a = delegate(f), aa = running(f, a.taskId);
    const c = delegate(f, 'c');
    f.tasks.charge(aa.runId!, aa.epoch!, 400);
    f.tasks.reconcile();
    assert.equal(f.tasks.task(a.taskId).state, 'recovery');
    assert.throws(() => f.tasks.guard(aa), /epoch|live/);
    f.tasks.takeover(main, { operationId: 'take', taskId: a.taskId, version: 1, expectedTaskRevision: f.tasks.task(a.taskId).revision, coordinatorAgentId: main.agentId });
    const retry = f.tasks.continue(main, { operationId: 'continue', taskId: a.taskId, version: 1, expectedTaskRevision: f.tasks.task(a.taskId).revision });
    assert.notEqual(retry.runId, aa.runId);
    assert.ok(f.tasks.children(f.root.taskId).some(t=>t.id===c.taskId));
    assert.equal(f.tasks.usedBudget(a.taskId), 400);
  }
  finally {
    f.close();
  }
});
test('HMR-RECURSIVE-010: dependency changes use CAS/idempotent operations and reject multi-task cycles', () => {
  const f = fixture();
  try {
    const a = delegate(f, 'a'), b = delegate(f, 'b');
    const change = { operationId: 'edge', taskId: a.taskId, version: 1, expectedTaskRevision: f.tasks.task(a.taskId).revision, dependsOnTaskId: b.taskId, dependsOnVersion: 1, required: true };
    f.tasks.addDependency(main, change);
    f.tasks.addDependency(main, change);
    assert.equal(f.store.db.prepare('SELECT count(*) n FROM task_dependencies').get()!.n, 1);
    assert.throws(() => f.tasks.addDependency(main, { ...change, operationId: 'stale-edge' }), /revision/);
    assert.throws(() => f.tasks.addDependency(main, { operationId: 'reverse-edge', taskId: b.taskId, version: 1, expectedTaskRevision: f.tasks.task(b.taskId).revision, dependsOnTaskId: a.taskId, dependsOnVersion: 1, required: true }), /cycle/);
  }
  finally {
    f.close();
  }
});
test('HMR-RECURSIVE-004/012: file intent receipt loss reuses exact staged file; explicit publication grants download and revocation removes it', () => {
  const f = fixture();
  try {
    const a = delegate(f, 'file', f.root.taskId, main, 'markdown'), aa = running(f, a.taskId);
    f.tasks.markMaterialRead(aa);
    const input = { operationId: 'write', filename: 'synthetic.md', content: '# Synthetic\nDates unknown.\n' };
    const written = f.tasks.writeMarkdown(aa, input);
    const replay = f.tasks.writeMarkdown(aa, input);
    assert.equal(replay.resultId, written.resultId);
    assert.equal(replay.path, written.path);
    assert.throws(() => f.tasks.writeMarkdown(aa, { ...input, operationId: 'second-write' }), /artifact_filename_conflict/);
    f.tasks.endSegment(aa.runId!,aa.epoch!,{status:'completed',text:JSON.stringify({ summary: 'Synthetic' })},true)!;
    f.tasks.endSegment(aa.runId!, aa.epoch!, {status:'completed',text:'Synthetic final result'}, true);
    accept(f, a.taskId, written.resultId);
    assert.equal(f.tasks.publishedArtifact(aa.runId!), undefined);
    const root = f.tasks.task(f.root.taskId), result = ({operationId: 'root-file',taskId: root.id,version: 1,expectedTaskRevision: root.revision,outcome: 'succeeded',evidence: { facts: 'Inspected' },children: [{ childTaskId: a.taskId, childVersion: 1, disposition: 'included', resultId: written.resultId, reason: 'Used file' }],resultId:null,text:JSON.stringify({ summary: 'Done' }),publishedFileResultId:null} satisfies Parameters<typeof f.tasks.publish>[1]);
    const d = f.tasks.publish(main, {...result, operationId: 'publish-file', taskId: root.id, version: 1, expectedTaskRevision: f.tasks.task(root.id).revision, resultId: result.resultId, text: 'Synthetic delivery', publishedFileResultId: written.resultId });
    assert.ok(f.tasks.publishedArtifact(aa.runId!));
    assert.equal(f.tasks.publishedArtifact(aa.runId!, { sourceRequestId: 'unrelated' }), undefined);
    f.tasks.markDelivery(d.deliveryId, 'revoked');
    assert.equal(f.tasks.publishedArtifact(aa.runId!), undefined);
  }
  finally {
    f.close();
  }
});
test('HMR-RECURSIVE-006: stop_replace cannot start before stop confirmation; queued rebase preserves its complete contract', () => {
  const f = fixture();
  try {
    const a = delegate(f), aa = running(f, a.taskId);
    let t = f.tasks.task(a.taskId);
    const queued = f.tasks.update(main, { operationId: 'q', taskId: t.id, version: 1, expectedTaskRevision: t.revision, mode: 'queue', contract: { ...contract(), goal: 'Synthetic queued requirement must survive' }, children: [], queuedDisposition: [] });
    t = f.tasks.task(t.id);
    assert.throws(() => f.tasks.update(main, { operationId: 'bad-replace', taskId: t.id, version: 1, expectedTaskRevision: t.revision, mode: 'stop_replace', contract: contract(), children: [], queuedDisposition: [] }), /queued_disposition/);
    const replacement = f.tasks.update(main, { operationId: 'replace', taskId: t.id, version: 1, expectedTaskRevision: t.revision, mode: 'stop_replace', contract: { ...contract(), goal: 'Synthetic replacement' }, children: [], queuedDisposition: [{ version: queued.version, action: 'rebase', contract: { ...contract(), goal: 'Synthetic queued requirement must survive after replacement' } }] });
    assert.equal(f.store.runs().length, 1);
    assert.equal(f.tasks.claim(), undefined);
    assert.throws(() => f.tasks.guard(aa), /epoch|stop/);
    f.tasks.confirmStop(replacement.operationKey, true);
    assert.equal(f.store.runs().length, 2);
    const later = f.tasks.queuedVersions(t.id);
    assert.equal(later.length, 1);
    assert.equal(f.tasks.contract(t.id, later[0]!.version).goal, 'Synthetic queued requirement must survive after replacement');
  }
  finally {
    f.close();
  }
});
test('HMR-RECURSIVE-006/009: uncertain steer fences mutation and retry; no silent queue fallback or auto adoption', () => {
  const f = fixture();
  try {
    const a = delegate(f), aa = running(f, a.taskId), t = f.tasks.task(a.taskId);
    const update = f.tasks.update(main, { operationId: 'steer-timeout', taskId: t.id, version: 1, expectedTaskRevision: t.revision, mode: 'steer', contract: contract(), children: [], queuedDisposition: [] });
    f.tasks.markSteer(update.operationKey, 'dispatching');
    f.tasks.markSteer(update.operationKey, 'uncertain');
    assert.equal(f.tasks.run(aa.runId!).targetVersion, 2);
    assert.equal(f.tasks.run(aa.runId!).contractVersion, 1);
    assert.equal(f.tasks.safeToUpgrade(), false);
    assert.throws(() => f.tasks.guard(aa), /adopt|phase/);
    assert.equal(f.store.runs().length, 1);
  }
  finally {
    f.close();
  }
});
test('unsupported unmapped historical data is refused without adding schema or changing runs', () => {
  mkdirSync(resolve('.codex/scratch/recursive-agent-implementation'),{recursive:true});
  const dir = mkdtempSync(resolve('.codex/scratch/recursive-agent-implementation/broken-'));
  const store = new Store(join(dir, 'old.sqlite'));
  new WorkerInteractions(store.db);
  try {
    const r = store.dispatch({ requestId: 'legacy', title: 'Synthetic', goal: 'Synthetic', material: 'sample.md' });
    store.db.prepare("INSERT INTO runs(id,matterId,requestId,goal,material,status,createdAt) VALUES('run-second',?,'legacy-second','Synthetic','sample.md','running',?)").run(r.matterId, Date.now());
    const tasks = new RecursiveTasks(store, new Files(join(dir, 'workspace')));
    assert.throws(() => tasks.migrate(), /recursive_schema_unsupported/);
    assert.equal(store.meta('recursiveSchemaVersion'), undefined);
    assert.equal(store.db.prepare("SELECT 1 FROM sqlite_master WHERE name='tasks'").get(), undefined);
    assert.equal(store.runs().length, 2);
  }
  finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('HMR-RECURSIVE-013: legacy dispatch keeps original request IDs and root busy semantics while child Runs share its matter', () => {
  const f = fixture();
  try {
    const authority = { sourceRequestId: 'user-synthetic', description: 'Synthetic authority', materials: ['sample.md'], resultIds: [], collaborateTaskIds: [], maxActiveMs: 10000 };
    const first = f.tasks.legacyDispatch(main, { requestId: 'original-dispatch', sourceRequestId: 'user-synthetic', title: 'Synthetic legacy root', goal: 'Synthetic original goal', material: 'sample.md' }, authority);
    assert.equal(first.requestId, 'original-dispatch');
    assert.equal(first.sourceRequestId, 'user-synthetic');
    assert.throws(() => f.tasks.legacyDispatch(main, { requestId: 'busy-revision', sourceRequestId: 'user-synthetic', matterId: first.matterId, title: 'Revise', goal: 'Synthetic revised', material: 'sample.md' }, authority), /matter_busy/);
    assert.throws(()=>delegate(f,'business-child-denied',first.taskId),/parent_denied/);
    assert.equal(f.tasks.legacyDispatch(main, { requestId: 'original-dispatch', sourceRequestId: 'user-synthetic', title: 'Synthetic legacy root', goal: 'Synthetic original goal', material: 'sample.md' }, authority).id, first.id);
  }
  finally {
    f.close();
  }
});

// Break caught: restarting a waiting phase must not rewrite entry/first claim facts.
test('ordering facts persist across same-Run rpc, wait, claim and real new attempts',()=>{
 const f=fixture();let now=100;const clock=Date.now;Date.now=()=>now;
 try{
  const a=delegate(f,'ordering-a'),b=delegate(f,'ordering-b');
  assert.equal(f.tasks.task(a.taskId).waitingEnteredAt,100);
  now=200;const actor=running(f,a.taskId);assert.equal(f.tasks.run(actor.runId!).startedAt,200);
  now=300;f.tasks.rpc(actor.runId!,actor.epoch!,true);assert.equal(f.tasks.task(a.taskId).waitingEnteredAt,300);
  now=400;f.tasks.rpc(actor.runId!,actor.epoch!,true);assert.equal(f.tasks.task(a.taskId).waitingEnteredAt,300);
  now=500;f.tasks.rpc(actor.runId!,actor.epoch!,false);assert.equal(f.tasks.run(actor.runId!).startedAt,200);
  now=600;f.tasks.wait(actor,{operationId:'ordering-wait',taskId:a.taskId,version:1,expectedTaskRevision:f.tasks.task(a.taskId).revision,condition:{type:'result_or_terminal',taskId:b.taskId,version:1}});
  now=700;f.tasks.endSegment(actor.runId!,actor.epoch!,{status:'completed',text:''},false);
  assert.equal(f.tasks.task(a.taskId).waitingEnteredAt,600);
  now=725;const peer=running(f,b.taskId);complete(f,peer,b.taskId);
  assert.equal(f.tasks.task(a.taskId).waitingEnteredAt,600);
  now=750;running(f,a.taskId);assert.equal(f.tasks.run(actor.runId!).startedAt,200);
  now=800;const stop=f.tasks.stop(main,{operationId:'ordering-stop',taskId:a.taskId,version:1,expectedTaskRevision:f.tasks.task(a.taskId).revision,scope:'self',reason:'test',runOnly:true});
  assert.equal(f.tasks.task(a.taskId).waitingEnteredAt,800);
  now=900;f.tasks.confirmStop(stop.operationKey,true);
  now=1000;const next=f.tasks.continue(main,{operationId:'ordering-retry',taskId:a.taskId,version:1,expectedTaskRevision:f.tasks.task(a.taskId).revision});
  assert.notEqual(next.runId,actor.runId);assert.equal(f.tasks.task(a.taskId).waitingEnteredAt,1000);
  assert.equal(f.tasks.task(a.taskId).reviewEnteredAt,null);assert.equal(f.tasks.task(a.taskId).settledAt,null);
  now=1100;const retry=running(f,a.taskId);assert.equal(f.tasks.run(retry.runId!).startedAt,1100);
  assert.throws(()=>f.tasks.rpc(actor.runId!,actor.epoch!,true),/stale/);
 }finally{Date.now=clock;f.close();}
});
test('ordering review entry is closure time and native no-Run settlement is durable',()=>{
 const f=fixture();let now=100;const clock=Date.now;Date.now=()=>now;
 try{
  const a=delegate(f,'ordering-review'),actor=running(f,a.taskId);
  now=200;const result=f.tasks.endSegment(actor.runId!,actor.epoch!,{status:'completed',text:'result'},false)!;
  assert.equal(f.tasks.task(a.taskId).reviewEnteredAt,null);
  now=300;f.tasks.reconcile();assert.equal(f.tasks.task(a.taskId).reviewEnteredAt,300);
  now=400;f.tasks.reconcile();assert.equal(f.tasks.task(a.taskId).reviewEnteredAt,300);
  accept(f,a.taskId,result.resultId);assert.equal(f.tasks.task(a.taskId).settledAt,400);
  const entry=rankedStatusMatters(statusTree(readTaskOverview(f.store.db).tasks)).find(r=>r.key.id===f.root.taskId)!.key;
  assert.equal(entry.priority,2);assert.equal(entry.enteredAtMs,400);
  now=500;const t=f.tasks.task(f.root.taskId);
  const published=f.tasks.publish(main,{operationId:'ordering-native',taskId:t.id,version:1,expectedTaskRevision:t.revision,resultId:null,text:'checked',publishedFileResultId:null,outcome:'succeeded',evidence:{facts:'checked'},children:[{childTaskId:a.taskId,childVersion:1,disposition:'included',resultId:result.resultId,reason:'checked'}]});
  assert.equal(f.tasks.task(t.id).settledAt,500);assert.equal(f.tasks.task(t.id).reviewEnteredAt,entry.enteredAtMs);
  assert.equal(rankedStatusMatters(statusTree(readTaskOverview(f.store.db).tasks)).find(r=>r.key.id===t.id)!.key.enteredAtMs,entry.enteredAtMs);
  now=600;f.tasks.markDelivery(published.deliveryId,'submitting');f.tasks.markDelivery(published.deliveryId,'recorded');
  assert.equal(f.tasks.task(t.id).reviewEnteredAt,entry.enteredAtMs);assert.equal(f.tasks.task(t.id).settledAt,500);
 }finally{Date.now=clock;f.close();}
});
test('ordering additive migration leaves missing historical facts null and is idempotent on reopen',()=>{
 const f=fixture();
 try{
  for(const col of ['waitingEnteredAt','reviewEnteredAt','settledAt'])if(f.store.db.prepare('PRAGMA table_info(tasks)').all().some(r=>r.name===col))f.store.db.exec('ALTER TABLE tasks DROP COLUMN '+col);
  f.tasks.migrate();
  assert.equal(f.tasks.task(f.root.taskId).waitingEnteredAt,null);
  f.store.db.exec('UPDATE tasks SET settledAt=123');f.tasks.migrate();
  const reopened=new Store(join(f.dir,'homer.sqlite'));
  try{const tasks=new RecursiveTasks(reopened,f.files);tasks.migrate();assert.equal(tasks.task(f.root.taskId).settledAt,123);assert.equal(tasks.task(f.root.taskId).waitingEnteredAt,null);}finally{reopened.close();}
 }finally{f.close();}
});
test('ordering native review keeps unknown history and rejects an unready child identity',()=>{
 for(const mode of ['missing-time','invalid-time','unready']){
  const f=fixture();let now=100;const clock=Date.now;Date.now=()=>now;
  try{
   const a=delegate(f,'native-'+mode),actor=running(f,a.taskId);
   now=300;const result=complete(f,actor,a.taskId);now=400;accept(f,a.taskId,result.resultId);
   if(mode==='unready')f.store.db.prepare('UPDATE tasks SET currentRunId=NULL WHERE id=?').run(a.taskId);
   else f.store.db.prepare('UPDATE runs SET endedAt=? WHERE id=?').run(mode==='missing-time'?null:'invalid',actor.runId!);
   const before=rankedStatusMatters(statusTree(readTaskOverview(f.store.db).tasks)).find(r=>r.key.id===f.root.taskId)!.key;
   assert.equal(before.priority,mode==='unready'?3:2);
   now=500;const t=f.tasks.task(f.root.taskId);
   f.tasks.publish(main,{operationId:'publish-native-'+mode,taskId:t.id,version:1,expectedTaskRevision:t.revision,resultId:null,text:'checked',publishedFileResultId:null,outcome:'succeeded',evidence:{facts:'checked'},children:[{childTaskId:a.taskId,childVersion:1,disposition:'included',resultId:result.resultId,reason:'checked'}]});
   const after=rankedStatusMatters(statusTree(readTaskOverview(f.store.db).tasks)).find(r=>r.key.id===t.id)!.key;
   assert.equal(after.enteredAtMs,mode==='unready'?500:-Infinity);
   assert.equal(f.tasks.task(t.id).reviewEnteredAt,mode==='unready'?500:null);
  }finally{Date.now=clock;f.close();}
 }
});
test('ordering native review aggregates the same visible members as the list',()=>{
 const f=fixture();let now=100;const clock=Date.now;Date.now=()=>now;
 try{
  const a=delegate(f,'visible'),hidden=delegate(f,'hidden');
  now=300;const result=complete(f,running(f,a.taskId),a.taskId);now=400;accept(f,a.taskId,result.resultId);
  f.store.db.prepare("UPDATE tasks SET state='settled',outcome='failed',historyState='archived' WHERE id=?").run(hidden.taskId);
  const before=rankedStatusMatters(statusTree(readTaskOverview(f.store.db).tasks)).find(r=>r.key.id===f.root.taskId)!.key;
  assert.equal(before.enteredAtMs,400);
  now=500;const t=f.tasks.task(f.root.taskId);
  f.tasks.publish(main,{operationId:'visible-review',taskId:t.id,version:1,expectedTaskRevision:t.revision,resultId:null,text:'checked',publishedFileResultId:null,outcome:'partial',evidence:{facts:'checked',gaps:['hidden failed child']},children:[{childTaskId:a.taskId,childVersion:1,disposition:'included',resultId:result.resultId,reason:'checked'},{childTaskId:hidden.taskId,childVersion:1,disposition:'gap',reason:'failed'}]});
  assert.equal(f.tasks.task(t.id).reviewEnteredAt,before.enteredAtMs);
 }finally{Date.now=clock;f.close();}
});

test('ordering root review interval survives acceptance/publication and same-Run adopt keeps claim',()=>{
 const f=fixture();let now=100;const clock=Date.now;Date.now=()=>now;
 try{
  const root=f.tasks.createRoot(main,{operationId:'ordering-worker-root',title:'root',executorKind:'worker',contract:contract('aggregate'),authority:f.tasks.authority(f.root.taskId,1)});
  now=200;let actor=running(f,root.taskId);
  now=300;const t=f.tasks.task(root.taskId);const change=f.tasks.update(main,{operationId:'ordering-adopt',taskId:t.id,version:1,expectedTaskRevision:t.revision,mode:'steer',contract:contract('aggregate'),children:[],queuedDisposition:[]});
  assert.equal(f.tasks.task(t.id).waitingEnteredAt,300);assert.equal(f.tasks.task(t.id).reviewEnteredAt,null);
  now=400;f.tasks.inspect(actor,{taskId:t.id});f.tasks.adopt(actor,{operationId:'ordering-adopt-now',taskId:t.id,version:2,expectedTaskRevision:f.tasks.task(t.id).revision,contractHash:change.contractHash});
  assert.equal(f.tasks.run(actor.runId!).startedAt,200);
  now=500;const result=complete(f,actor,t.id);assert.equal(f.tasks.task(t.id).reviewEnteredAt,500);
  now=600;accept(f,t.id,result.resultId);assert.equal(f.tasks.task(t.id).reviewEnteredAt,500);
  now=700;const publish=f.tasks.publish(main,{operationId:'ordering-worker-publish',taskId:t.id,version:2,expectedTaskRevision:f.tasks.task(t.id).revision,resultId:result.resultId,text:'checked',publishedFileResultId:null});
  now=800;f.tasks.markDelivery(publish.deliveryId,'submitting');now=900;f.tasks.markDelivery(publish.deliveryId,'uncertain');
  assert.equal(f.tasks.task(t.id).reviewEnteredAt,500);assert.equal(f.tasks.run(actor.runId!).endedAt,600);
 }finally{Date.now=clock;f.close();}
});
test('ordering no-Run cancellation records settlement while held/stopping metadata preserve waiting entry',()=>{
 const f=fixture();let now=100;const clock=Date.now;Date.now=()=>now;
 try{
  const a=delegate(f,'ordering-held'),actor=running(f,a.taskId);
  now=200;const stop=f.tasks.stop(main,{operationId:'ordering-native-stop',taskId:f.root.taskId,version:1,expectedTaskRevision:f.tasks.task(f.root.taskId).revision,scope:'self',reason:'checked'});
  assert.equal(f.tasks.task(a.taskId).waitingEnteredAt,200);
  now=300;const childStop=f.tasks.stop(main,{operationId:'ordering-held-stop',taskId:a.taskId,version:1,expectedTaskRevision:f.tasks.task(a.taskId).revision,scope:'self',reason:'checked'});
  assert.equal(f.tasks.task(a.taskId).waitingEnteredAt,200);
  now=400;f.tasks.confirmStop(stop.operationKey,true);assert.equal(f.tasks.task(f.root.taskId).settledAt,400);
  now=500;f.tasks.confirmStop(childStop.operationKey,false);assert.equal(f.tasks.task(a.taskId).waitingEnteredAt,200);
  assert.throws(()=>f.tasks.rpc(actor.runId!,actor.epoch!,true),/stale/);
 }finally{Date.now=clock;f.close();}
});
