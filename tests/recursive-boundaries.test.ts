// Requirements-derived synthetic inputs. No account, model, or network access.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ConversationHistory } from '../src/web-history.js';
import { MainInputs } from '../src/recursive-main-inputs.js';
import { main, contract, fixture, delegate, running, complete, accept } from './recursive-fixture.js';
test('HMR-RECURSIVE-005: internal messages cannot impersonate the user queue or acknowledge queued user work', () => {
  const f = fixture();
  try {
    const a = delegate(f), aa = running(f, a.taskId);
    assert.throws(() => f.tasks.send(aa, { operationId: 'forged-user', taskId: a.taskId, version: 1, expectedTaskRevision: f.tasks.task(a.taskId).revision, recipientAgentId: main.agentId, kind: 'user_input', payload: { requestId: 'made-up', source: 'web' } }), /message_kind_reserved/);
    f.store.setMeta('mainThread', 'synthetic-thread');
    const history = new ConversationHistory(f.store.db), inputs = new MainInputs(f.tasks, history);
    const queued = inputs.accept({ requestId: 'synthetic-user', text: 'Synthetic waiting text' });
    assert.equal(f.tasks.inbox(main).length, 0);
    assert.throws(() => f.tasks.ack(main, { operationId: 'skip-queued', messageId: queued.queueMessageId!, disposition: 'processed', reason: 'Synthetic invalid bypass' }), /message_kind_reserved/);
    assert.equal(inputs.claim()!.input.requestId, 'synthetic-user');
  }
  finally {
    f.close();
  }
});
test('HMR-RECURSIVE-004/011: a yielded Worker segment cannot acknowledge messages or change control state before ending',()=>{
  const f=fixture();try{
    const a=delegate(f,'a'),b=delegate(f,'b'),aa=running(f,a.taskId),bb=running(f,b.taskId);
    const sent=f.tasks.send(bb,{operationId:'message-before-park',taskId:b.taskId,version:1,expectedTaskRevision:f.tasks.task(b.taskId).revision,recipientAgentId:aa.agentId,kind:'notice',payload:{synthetic:true}});
    f.tasks.wait(aa,{operationId:'park',taskId:a.taskId,version:1,expectedTaskRevision:f.tasks.task(a.taskId).revision,condition:{type:'result_or_terminal',taskId:b.taskId,version:1}});
    assert.throws(()=>f.tasks.ack(aa,{operationId:'late-ack',messageId:sent.messageId,disposition:'processed',reason:'Late synthetic call'}),/phase|yield/);
    assert.throws(()=>f.tasks.stop(aa,{operationId:'late-stop',taskId:a.taskId,version:1,expectedTaskRevision:f.tasks.task(a.taskId).revision,scope:'self',reason:'Late synthetic stop'}),/task_main_required/);
    assert.equal(f.tasks.inbox(aa).length,1);
    f.tasks.endSegment(aa.runId!,aa.epoch!,{status:'completed',text:'Synthetic final result'},false);
  }finally{f.close();}
});
test('HMR-RECURSIVE-012: publication follows exact historical included result IDs, even after a later root contract activates', () => {
  const f = fixture();
  try {
    const leaf = delegate(f, 'file', f.root.taskId, main, 'markdown'), actor = running(f, leaf.taskId);
    f.tasks.markMaterialRead(actor);
    const file = f.tasks.writeMarkdown(actor, { operationId: 'write', filename: 'synthetic.md', content: '# Synthetic\nUnknown date.\n' });
    let child = f.tasks.task(leaf.taskId);
    f.tasks.endSegment(actor.runId!,actor.epoch!,{status:'completed',text:'Synthetic final result'},true)!;
    f.tasks.endSegment(actor.runId!, actor.epoch!, {status:'completed',text:'Synthetic final result'}, true);
    accept(f, child.id, file.resultId);
    let root = f.tasks.task(f.root.taskId);
    f.tasks.update(main, { operationId: 'later-root', taskId: root.id, version: 1, expectedTaskRevision: root.revision, mode: 'queue', contract: { ...contract('aggregate'), goal: 'Synthetic later root contract' }, children: [], queuedDisposition: [] });
    root = f.tasks.task(root.id);
    const result = ({operationId: 'finish-root',taskId: root.id,version: 1,expectedTaskRevision: root.revision,outcome: 'succeeded',evidence: { facts: 'Checked' },children: [{ childTaskId: child.id, childVersion: 1, disposition: 'included', resultId: file.resultId, reason: 'Used exact file' }],resultId:null,text:JSON.stringify({ summary: 'Synthetic included file' }),publishedFileResultId:null} satisfies Parameters<typeof f.tasks.publish>[1]);
    assert.equal(f.tasks.task(root.id).headVersion, 1);
    const delivery=f.tasks.publish(main, {...result, operationId: 'historical-publication', taskId: root.id, version: 1, expectedTaskRevision: f.tasks.task(root.id).revision, resultId: result.resultId, text: 'Synthetic first-version delivery', publishedFileResultId: file.resultId });
    assert.equal(f.tasks.task(root.id).headVersion,2);
    child = f.tasks.task(child.id);
    f.tasks.update(main, { operationId: 'revise-child', taskId: child.id, version: 1, expectedTaskRevision: child.revision, mode: 'stop_replace', contract: contract('markdown'), children: [], queuedDisposition: [] });
    const next = running(f, child.id);
    f.tasks.markMaterialRead(next);
    const unrelated = f.tasks.writeMarkdown(next, { operationId: 'write-v2', filename: 'synthetic-v2.md', content: '# Synthetic\nLater version.\n' });
    child = f.tasks.task(child.id);
    f.tasks.endSegment(next.runId!,next.epoch!,{status:'completed',text:'Synthetic final result'},true)!;
    f.tasks.endSegment(next.runId!, next.epoch!, {status:'completed',text:'Synthetic final result'}, true);
    accept(f, child.id, unrelated.resultId);
    assert.throws(() => f.tasks.publish(main, {...result, operationId: 'wrong-result-publication', taskId: root.id, version: 1, expectedTaskRevision: f.tasks.task(root.id).revision, resultId: delivery.resultId, text: 'Synthetic incorrect file', publishedFileResultId: unrelated.resultId }), /file_not_included/);
  }
  finally {
    f.close();
  }
});
test('HMR-RECURSIVE-005: a readable task selector cannot launder another tree result into inspection', () => {
  const f = fixture();
  try {
    const a = delegate(f), aa = running(f, a.taskId);
    const other = f.tasks.createRoot(main, { operationId: 'other-root', title: 'Other synthetic scope', contract: contract('aggregate'), authority: { sourceRequestId: 'user-synthetic', description: 'Separate scope', materials: ['sample.md'], resultIds: [], collaborateTaskIds: [], maxActiveMs: 10000 } });
    const child = delegate(f, 'other-child', other.taskId), actor = running(f, child.taskId), result = complete(f, actor, child.taskId);
    assert.throws(() => f.tasks.inspect(aa, { taskId: a.taskId, resultId: result.resultId }), /scope|selector/);
    assert.throws(() => f.tasks.inspect(aa, { taskId: a.taskId, runId: actor.runId }), /scope|selector/);
  }
  finally {
    f.close();
  }
});
test('HMR-QUEUE-006: persisted but unclaimed or withdrawn user text cannot authorize root creation', () => {
  const f = fixture();
  try {
    f.store.setMeta('mainThread', 'synthetic-thread');
    const history = new ConversationHistory(f.store.db), inputs = new MainInputs(f.tasks, history);
    inputs.accept({ requestId: 'queued-source', text: 'Synthetic new request' });
    const actor = { ...main, sourceRequestId: 'queued-source' }, authority = { ...f.tasks.authority(f.root.taskId, 1), sourceRequestId: 'queued-source' };
    const create = (operationId: string) => f.tasks.createRoot(actor, { operationId, title: 'Synthetic unauthorized early root', contract: contract('aggregate'), authority });
    assert.throws(() => create('too-early'), /authority_source_denied/);
    const row = inputs.list()[0]!;
    inputs.cancel({ requestId: 'queued-source', operationId: 'cancel-source', expectedRevision: row.revision });
    assert.throws(() => create('withdrawn'), /authority_source_denied/);
    inputs.accept({ requestId: 'actual-source', text: 'Synthetic actually processed request' });
    const current = inputs.claim()!;
    const valid = f.tasks.createRoot({ ...main, sourceRequestId: 'actual-source' }, { operationId: 'actual', title: 'Synthetic actual source', contract: contract('aggregate'), authority: { ...authority, sourceRequestId: 'actual-source' } });
    inputs.finish(current.messageId, current.revision, 'completed');
    assert.equal(f.tasks.authority(valid.taskId, 1).sourceRequestId, 'actual-source');
  }
  finally {
    f.close();
  }
});
