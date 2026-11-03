// Full document cases are synthetic behavior checks, NOT real model acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { main, contract, fixture, delegate, running, complete, accept } from './recursive-fixture.js';
test('HMR-RECURSIVE-CASE-1: root A/B/C; sibling communication, wait, replacement, same children, internal acceptance and root-only file publication', () => {
  const f = fixture();
  try {
    const a = delegate(f, 'a', f.root.taskId, main, 'markdown'), b = delegate(f, 'b');
    let aa = running(f, a.taskId);
    const bb = running(f, b.taskId), c = delegate(f, 'c'), cc = running(f, c.taskId);
    const m = f.tasks.send(cc, { operationId: 'question', taskId: c.taskId, version: 1, expectedTaskRevision: f.tasks.task(c.taskId).revision, recipientAgentId: b.agentId, kind: 'question', payload: { question: 'Is the synthetic date confirmed?' } });
    const answer = f.tasks.send(bb, { operationId: 'answer', taskId: b.taskId, version: 1, expectedTaskRevision: f.tasks.task(b.taskId).revision, recipientAgentId: c.agentId, kind: 'answer', replyTo: m.messageId, payload: { answer: 'No, keep unknown' } });
    f.tasks.ack(bb, { operationId: 'read-question', messageId: m.messageId, disposition: 'processed', reason: 'Answered' });
    f.tasks.ack(cc, { operationId: 'read-answer', messageId: answer.messageId, disposition: 'processed', reason: 'Keep unknown' });
    f.tasks.wait(aa, { operationId: 'wait-c', taskId: a.taskId, version: 1, expectedTaskRevision: f.tasks.task(a.taskId).revision, condition: { type: 'result_or_terminal', taskId: c.taskId, version: 1 } });
    f.tasks.endSegment(aa.runId!, aa.epoch!, {status:'completed',text:'Synthetic final result'}, false);
    assert.equal(f.tasks.run(aa.runId!).phase, 'parked');
    const fc = complete(f, cc, c.taskId);
    f.tasks.endSegment(cc.runId!, cc.epoch!, {status:'completed',text:'Synthetic final result'}, true);
    assert.equal(f.tasks.run(aa.runId!).phase, 'ready');
    const root = f.tasks.task(f.root.taskId);
    f.tasks.update(main, { operationId: 'root-v2', taskId: root.id, version: 1, expectedTaskRevision: root.revision, mode: 'stop_replace', contract: { ...contract('aggregate'), goal: 'Synthetic owner grouping, dates unknown' }, children: [{ taskId: a.taskId, action: 'retain' }, { taskId: b.taskId, action: 'retain' }, { taskId: c.taskId, action: 'retain' }], queuedDisposition: [] });
    const before = f.tasks.task(a.taskId), change = f.tasks.update(main, { operationId: 'a-v2', taskId: a.taskId, version: 1, expectedTaskRevision: before.revision, mode: 'stop_replace', contract: { ...contract('markdown'), goal: 'Synthetic owner grouping, dates unknown' }, children: [], queuedDisposition: [] });
    f.tasks.confirmStop(change.operationKey, true);
    assert.equal(f.tasks.children(a.taskId).length, 0);
    assert.equal(f.tasks.task(c.taskId).parentTaskId, root.id);
    assert.equal(f.tasks.run(aa.runId!).status, 'cancelled');
    aa = running(f, a.taskId);
    accept(f, c.taskId, fc.resultId);
    const fb = complete(f, bb, b.taskId);
    f.tasks.endSegment(bb.runId!, bb.epoch!, {status:'completed',text:'Synthetic final result'}, true);
    accept(f, b.taskId, fb.resultId);
    f.tasks.markMaterialRead(aa);
    const file = f.tasks.writeMarkdown(aa, { operationId: 'write-v2', filename: 'owner-report.md', content: '# Synthetic owner report\nOwner A: date unknown.\n' });
    f.tasks.endSegment(aa.runId!,aa.epoch!,{status:'completed',text:JSON.stringify({ summary: 'Grouped by owner' })},true)!;
    f.tasks.endSegment(aa.runId!, aa.epoch!, {status:'completed',text:'Synthetic final result'}, true);
    accept(f, a.taskId, file.resultId,main,{facts:'C checked dates'});
    assert.equal(f.tasks.publishedArtifact(aa.runId!), undefined);
    assert.equal(f.tasks.publishedArtifact(cc.runId!), undefined);
    assert.equal(f.tasks.pendingDeliveries().length, 0);
    const rootResult = ({operationId: 'complete-root',taskId: root.id,version: 2,expectedTaskRevision: f.tasks.task(root.id).revision,outcome: 'succeeded',evidence: { facts: 'A and B accepted' },children: [{ childTaskId: a.taskId, childVersion: 2, disposition: 'included', resultId: file.resultId, reason: 'Report used' }, { childTaskId: b.taskId, childVersion: 1, disposition: 'included', resultId: fb.resultId, reason: 'Verification used' }, {childTaskId:c.taskId,childVersion:1,disposition:'included',resultId:fc.resultId,reason:'Date check used'}],resultId:null,text:JSON.stringify({ summary: 'Synthetic owner report' }),publishedFileResultId:null} satisfies Parameters<typeof f.tasks.publish>[1]);
    const publication = f.tasks.publish(main, {...rootResult, operationId: 'publish', taskId: root.id, version: 2, expectedTaskRevision: f.tasks.task(root.id).revision, resultId: rootResult.resultId, text: 'Synthetic completed owner report', publishedFileResultId: file.resultId });
    assert.equal(f.tasks.publishedArtifact(aa.runId!)!.deliveryId, publication.deliveryId);
    assert.equal(f.tasks.delivery(publication.deliveryId).routeSourceRequestId, 'user-synthetic');
    f.tasks.markDelivery(publication.deliveryId, 'submitting');
    f.tasks.markDelivery(publication.deliveryId, 'recorded');
    assert.equal(f.tasks.task(root.id).outcome, 'succeeded');
    assert.equal(f.store.runs().length, 4);
  }
  finally {
    f.close();
  }
});
test('HMR-RECURSIVE-CASE-2: failed child, parent precise self-stop, accepted sibling, crash and partial root publication retain all original identities', () => {
  const f = fixture();
  try {
    const a = delegate(f, 'a', f.root.taskId, main, 'aggregate'), b = delegate(f, 'b', f.root.taskId, main, 'markdown'), aa = running(f, a.taskId), bb = running(f, b.taskId), c = delegate(f, 'c'), cc = running(f, c.taskId);
    f.tasks.wait(aa, { operationId: 'wait-c', taskId: a.taskId, version: 1, expectedTaskRevision: f.tasks.task(a.taskId).revision, condition: { type: 'result_or_terminal', taskId: c.taskId, version: 1 } });
    f.tasks.endSegment(aa.runId!, aa.epoch!, {status:'completed',text:'Synthetic final result'}, false);
    f.tasks.failRun(cc.runId!, cc.epoch!, 'synthetic_input_missing');
    assert.equal(f.tasks.run(aa.runId!).phase, 'ready');
    f.tasks.claim(aa.runId!);
    f.tasks.bind(aa.runId!, aa.epoch!, aa.threadId!, 'turn-followup');
    const followed = { ...aa, turnId: 'turn-followup' };
    f.tasks.rpc(followed.runId!, followed.epoch!, true);
    const stopped = f.tasks.stop(main, { operationId: 'stop-a', taskId: a.taskId, version: 1, expectedTaskRevision: f.tasks.task(a.taskId).revision, scope: 'self', reason: 'Synthetic user stopped A only' });
    f.tasks.confirmStop(stopped.operationKey, true);
    assert.equal(f.tasks.task(a.taskId).outcome, 'cancelled');
    assert.equal(f.tasks.task(b.taskId).controlState, 'normal');
    f.tasks.markMaterialRead(bb);
    const fb = f.tasks.writeMarkdown(bb, { operationId: 'write-b', filename: 'partial-report.md', content: '# Synthetic partial report\nAttachment checked. Missing input prevents full verification.\n' });
    f.tasks.endSegment(bb.runId!,bb.epoch!,{status:'completed',text:JSON.stringify({ summary: 'Attachment checked' })},true)!;
    f.tasks.endSegment(bb.runId!, bb.epoch!, {status:'completed',text:'Synthetic final result'}, true);
    accept(f, b.taskId, fb.resultId);
    const before = f.tasks.tasks().map(t => t.id);
    assert.equal(f.tasks.publishedArtifact(bb.runId!), undefined);
    f.tasks.reconcile();
    assert.deepEqual(f.tasks.tasks().map(t => t.id), before);
    assert.equal(f.tasks.task(b.taskId).outcome, 'succeeded');
    assert.equal(f.tasks.task(c.taskId).outcome, 'failed');
    assert.equal(f.tasks.task(a.taskId).outcome, 'cancelled');
    const root = f.tasks.task(f.root.taskId);
    const partial = ({operationId: 'partial-root',taskId: root.id,version: 1,expectedTaskRevision: root.revision,outcome: 'partial',evidence: { facts: 'B accepted', gaps: 'A stopped; C missing input' },children: [{ childTaskId: a.taskId, childVersion: 1, disposition: 'gap', reason: 'Stopped with C missing input' }, { childTaskId: b.taskId, childVersion: 1, disposition: 'included', resultId: fb.resultId, reason: 'Useful verified attachment' }, {childTaskId:c.taskId,childVersion:1,disposition:'gap',reason:'Missing synthetic input'}],resultId:null,text:JSON.stringify({ summary: 'Available attachment verified' }),publishedFileResultId:null} satisfies Parameters<typeof f.tasks.publish>[1]);
    const d = f.tasks.publish(main, {...partial, operationId: 'publish-partial', taskId: root.id, version: 1, expectedTaskRevision: f.tasks.task(root.id).revision, resultId: partial.resultId, text: 'Synthetic partially completed; missing input and stopped A', publishedFileResultId: fb.resultId });
    f.tasks.markDelivery(d.deliveryId, 'recorded');
    assert.equal(f.tasks.task(root.id).outcome, 'partial');
    assert.equal(f.store.matters()[0]!.status, 'failed');
    assert.ok(f.tasks.publishedArtifact(bb.runId!));
    assert.equal(f.tasks.delivery(d.deliveryId).state, 'recorded');
    assert.equal(f.store.runs().length, 3);
  }
  finally {
    f.close();
  }
});
