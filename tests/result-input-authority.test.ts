// Real source records, authority constructors, task tools and Worker reader;
// no model, account, native executor or external service.
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Homer } from '../src/service.js';
import { RecursiveTools } from '../src/recursive-tools.js';
import { MainInputs } from '../src/recursive-main-inputs.js';
import { ConversationHistory } from '../src/web-history.js';
import { MediaStore } from '../src/media-store.js';
import { WorkerProgressStore } from '../src/worker-progress.js';
import type { Actor, Contract } from '../src/recursive-tasks.js';
import { fixture, main, contract, delegate, running, complete, accept } from './recursive-fixture.js';

function setup() {
  const f = fixture('.codex/scratch/result-input-authority-20261104');
  f.store.setMeta('mainThread', 'synthetic-main-thread');
  const inputs = new MainInputs(f.tasks, new ConversationHistory(f.store.db));
  for (const requestId of ['source-a', 'source-b']) {
    inputs.accept({ requestId, text: 'Synthetic authorized work ' + requestId });
    const q = inputs.claim()!;
    inputs.started(q.messageId, q.revision, 'generation', 'turn');
    inputs.finish(q.messageId, q.revision, 'completed');
  }
  const event: Actor = { agentId: main.agentId, threadId: 'synthetic-main-thread' };
  const host = Object.create(Homer.prototype) as any;
  Object.assign(host, { tasks: f.tasks, store: f.store, files: f.files, media: new MediaStore(f.store.db, join(f.dir, 'media')),
    workerProgress: new WorkerProgressStore(), closing: false, accountClocks() {} });
  const tools = new RecursiveTools(f.tasks, {
    rootAuthority: (actor, selection) => selection ? host.pendingAuthority(actor, selection) : host.rootAuthority(actor),
    wake() {}, async stop(r) { return r; }, async update(r) { return r; }
  });
  let seq = 0;
  const c = (ids: string[] = []): Contract => ({ ...contract('markdown'), inputs: ids.map(id => ({ type: 'result', id })) });
  const args = (ids: string[] = []) => ({ operationId: 'dispatch-' + ++seq, parentTaskId: null, parentVersion: null, expectedTaskRevision: null,
    title: 'Synthetic work', executorKind: 'worker', contract: c(ids), dependencies: [] });
  async function dispatch(ids: string[] = [], sources = ['source-a'], pending = true): Promise<any> {
    if (!pending) {
      const actor = { ...event, sourceRequestId: sources[0]! };
      host.mainContext = { requestId: actor.sourceRequestId, userText: 'Synthetic authorized work' };
      return tools.call(actor, 'task_delegate', args(ids));
    }
    host.mainContext = { event: true };
    const item = f.tasks.pending.add(event, { operationId: 'item-' + ++seq, content: 'Synthetic continuation', sourceRequestIds: sources });
    return tools.call(event, 'task_delegate', { ...args(ids), pending: { items: [{ id: item.id, expectedRevision: item.revision }], sourceRequestIds: sources, primarySourceRequestId: sources[0]! } });
  }
  async function produce(sources = ['source-a'], accepted = true) {
    const root = await dispatch([], sources), actor = running(f, root.taskId);
    const file = f.tasks.writeMarkdown(actor, { operationId: 'file', filename: 'report.md', content: '# Synthetic accepted work' });
    f.tasks.endSegment(actor.runId!, actor.epoch!, { status: 'completed', text: 'Synthetic result' }, true);
    if (accepted) accept(f, root.taskId, file.resultId, event);
    return { root, file };
  }
  async function read(root: { taskId: string }) {
    const actor = running(f, root.taskId);
    host.workerActor = () => actor;
    const value = await host.workerTool({ id: actor.runId, epoch: actor.epoch }, {
      tool: 'read_material', arguments: {}, callId: 'read', threadId: actor.threadId, turnId: actor.turnId
    });
    return { actor, value };
  }
  return { ...f, host, event, tools, dispatch, produce, read, args, c };
}

for (const pending of [false, true]) test('Main hands off an exact accepted result through ' + (pending ? 'event/pending' : 'user') + ' dispatch without producer-task access', async () => {
  const f = setup(); try {
    const { root: producer, file } = await f.produce();
    const consumer = await f.dispatch([file.resultId], ['source-a'], pending);
    const a = f.tasks.authority(consumer.taskId, 1);
    assert.deepEqual(a.resultIds, [file.resultId]);
    assert.deepEqual(a.collaborateTaskIds, []);
    const { actor, value } = await f.read(consumer);
    assert.equal(value.results[0].file.path, file.path);
    assert.equal(value.results[0].file.content, '# Synthetic accepted work');
    assert.equal(value.results[0].file.sha256, file.sha256);
    assert.equal(value.results[0].id, file.resultId);
    assert.throws(() => f.tasks.inspect(actor, { taskId: producer.taskId }), /agent_scope_denied/);
    assert.throws(() => f.tasks.inspect(actor, { resultId: file.resultId }), /agent_scope_denied/);
    const task = f.tasks.task(producer.taskId);
    await assert.rejects(() => f.tools.call(actor, 'task_stop', { operationId: 'stop-producer', taskId: task.id, version: 1, expectedTaskRevision: task.revision, reason: 'Attempted cross-task control' }), /task_main_required/);
  } finally { f.close(); }
});

test('unrelated sources, missing coverage, unaccepted and unknown results cannot be assigned; rejected dispatch is atomic', async () => {
  const f = setup(); try {
    const single = await f.produce(), combined = await f.produce(['source-a', 'source-b']), offered = await f.produce(['source-a'], false);
    for (const [ids, sources] of [
      [[single.file.resultId], ['source-b']],
      [[combined.file.resultId], ['source-a']],
      [[offered.file.resultId], ['source-a']],
      [['result-does-not-exist'], ['source-a']],
      [[single.file.resultId, offered.file.resultId], ['source-a']]
    ]) {
      const before = f.tasks.tasks().length;
      await assert.rejects(() => f.dispatch(ids!, sources!), /task_authority_input_denied/);
      assert.equal(f.tasks.tasks().length, before);
      assert.equal(f.store.db.prepare('SELECT count(*) n FROM pending_items WHERE linkedTaskId IS NOT NULL').get()!.n, 3);
    }
    const consumer = await f.dispatch([combined.file.resultId], ['source-b', 'source-a']);
    assert.deepEqual(f.tasks.authority(consumer.taskId, 1).resultIds, [combined.file.resultId]);
    assert.equal((await f.read(consumer)).value.results[0].id, combined.file.resultId);
  } finally { f.close(); }
});

test('result read revalidates actual bytes and does not mark failed input reads as successful', async () => {
  const f = setup(); try {
    const { file } = await f.produce(), consumer = await f.dispatch([file.resultId]);
    writeFileSync(file.path, '# Modified after acceptance');
    await assert.rejects(() => f.read(consumer), /result_hash_mismatch/);
    assert.equal(JSON.parse(f.tasks.run(consumer.runId).checkpointJson ?? '{}').materialRead, undefined);
  } finally { f.close(); }
});

test('a result grant cannot bypass exact contract inputs, live identity or version adoption', async () => {
  const f = setup(); try {
    const selected = await f.produce(), unlisted = await f.produce();
    const consumer = await f.dispatch([selected.file.resultId]), { actor } = await f.read(consumer);
    assert.throws(() => f.tasks.readResultInput(actor, unlisted.file.resultId), /task_authority_input_denied/);
    assert.throws(() => f.tasks.readResultInput({ ...actor, epoch: actor.epoch! + 1 }, selected.file.resultId), /run_epoch_stale/);
    const task = f.tasks.task(consumer.taskId);
    const change = f.tasks.update(f.event, { operationId: 'remove-input', taskId: task.id, version: 1, expectedTaskRevision: task.revision,
      mode: 'steer', contract: f.c(), children: [], queuedDisposition: [] });
    assert.throws(() => f.tasks.readResultInput(actor, selected.file.resultId), /run_adopt_required/);
    f.tasks.inspect(actor, { taskId: task.id });
    f.tasks.adopt(actor, { operationId: 'adopt', taskId: task.id, version: change.version, expectedTaskRevision: f.tasks.task(task.id).revision, contractHash: change.contractHash });
    assert.deepEqual(f.tasks.authority(task.id, change.version).resultIds, [selected.file.resultId]);
    assert.throws(() => f.tasks.readResultInput(actor, selected.file.resultId), /task_authority_input_denied/);
  } finally { f.close(); }
});

test('existing accepted sibling-result inputs remain readable without a cross-root grant', async () => {
  const f = setup(); try {
    const producer = delegate(f, 'sibling-producer'), actor = running(f, producer.taskId);
    const result = complete(f, actor, producer.taskId);
    accept(f, producer.taskId, result.resultId, f.event);
    const parent = f.tasks.task(f.root.taskId);
    const consumer = f.tasks.delegate(f.event, { operationId: 'sibling-consumer', taskId: parent.id, version: 1, expectedTaskRevision: parent.revision,
      contract: f.c([result.resultId]), dependencies: [] });
    assert.deepEqual(f.tasks.authority(consumer.taskId, 1).resultIds, []);
    assert.equal((await f.read(consumer)).value.results[0].id, result.resultId);
  } finally { f.close(); }
});
