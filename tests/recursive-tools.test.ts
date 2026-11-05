// Real isolated SQLite and public tool adapter; no engine, model or channel.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {Store} from '../src/store.js';
import {Files} from '../src/files.js';
import {RecursiveTasks, type Actor} from '../src/recursive-tasks.js';
import {RecursiveTools, RECURSIVE_TOOLS, toolOperationId, validateToolArguments} from '../src/recursive-tools.js';
import {PendingTools} from '../src/pending-tools.js';
import {Homer} from '../src/service.js';
import {chatFixture} from './task-chat-fixture.js';
import {fixture as hostFixture, until} from './fixtures/worker-chat-host.js';

function fixture() {
  const base = resolve('.codex/scratch/chat-architecture-implementation-20261105');
  mkdirSync(base, {recursive: true});
  const dir = mkdtempSync(join(base, 'tools-')), path = join(dir, 'synthetic.sqlite');
  const store = new Store(path), tasks = new RecursiveTasks(store, new Files(join(dir, 'workspace')));
  tasks.migrate();
  store.setMeta('mainAgentId', 'main:tools'); store.setMeta('mainThread', 'thread:main');
  store.startRequest('source:tools', 'synthetic');
  const actor: Actor = {agentId: 'main:tools', threadId: 'thread:main', turnId: 'turn:main', sourceRequestId: 'source:tools', inputMessageId: 'input:tools'};
  const stopped: Record<string, unknown>[] = []; let authorityReads = 0, wakes = 0;
  let currentTaskId: string | undefined;
  const effects = {
    rootAuthority: (a: Actor) => { authorityReads++; return {sourceRequestId: a.sourceRequestId!, description: 'Only investigate the synthetic project', materials: [], resultIds: []}; },
    rootWorkingDirectory: () => tasks.files.workspace,
    currentTaskId: () => currentTaskId,
    wake: () => { wakes++; },
    stop: async (receipt: Record<string, unknown>) => { stopped.push(receipt); return receipt; },
    steer: async (receipt: Record<string, unknown>) => receipt,
  };
  const tools = new RecursiveTools(tasks, effects);
  const create = async () => { const receipt = await tools.call(actor, 'task_create', {goal: 'Investigate without edits'}, 'create') as any; currentTaskId = receipt.taskId; return receipt; };
  const counts = () => ['tasks', 'runs', 'operations'].map(table => Number(store.db.prepare('SELECT count(*) n FROM ' + table).get()!.n));
  return {dir, path, store, tasks, actor, effects, tools, create, stopped, counts, reads: () => ({authorityReads, wakes}), close() {store.close(); rmSync(dir, {recursive: true, force: true});}};
}

function transferFixture() {
  const f = chatFixture();
  const tools = new RecursiveTools(f.tasks, {
    rootAuthority: actor => {
      const source = f.tasks.pending.source(actor, actor.sourceRequestId!);
      return {sourceRequestId: source.requestId, description: source.text, materials: [], resultIds: []};
    },
    wake() {}, stop: async () => ({}), steer: async () => ({}),
  });
  const counts = () => ['tasks', 'runs', 'operations'].map(table => Number(f.store.db.prepare('SELECT count(*) n FROM ' + table).get()!.n));
  return {...f, tools, counts};
}

async function acceptedReply(f: {tools: RecursiveTools; tasks: RecursiveTasks; actor: Actor}, taskId: string, label: string) {
  const opened = await f.tools.call(f.actor, 'worker_open', {taskId, message: 'Report ' + label}, 'produce-' + label) as any;
  const run = f.tasks.claim(opened.runId)!; f.tasks.bind(run.id, run.epoch, 'thread:' + run.id, 'turn:' + run.id);
  f.tasks.endSegment(run.id, run.epoch, {status: 'completed', text: 'Exact evidence: ' + label}, true);
  const page = await f.tools.call(f.actor, 'worker_read', {workerId: opened.workerId}) as any;
  const message = page.messages.find((message: {kind: string}) => message.kind === 'worker_reply');
  assert.ok(message, 'public Worker read exposes the original reply');
  const accepted = await f.tools.call(f.actor, 'accept_result', {runId: run.id, messageId: message.id}, 'accept-' + label) as any;
  return {opened, resultId: accepted.resultId};
}

test('v1 to v2 archival inspection separates readable source history from current dispatch authority', async () => {
  const f = hostFixture(), errors: string[] = [], followups: string[] = [];
  const initial = 'Inspect the original synthetic report.', revised = 'Inspect only the revised synthetic report.';
  let taskId = '', checked = false;
  try {
    f.setScript(async (main, text) => {
      try {
        if (text === initial) taskId = (await main.call('task_create', {goal: initial})).taskId;
        else if (text === revised) {
          await assert.rejects(main.call('task_update', {taskId, goal: revised, sourceRequestIds: ['source:initial', 'source:revised']}), /invalid_tool_arguments/);
          await main.call('task_update', {taskId, goal: revised});
          await main.call('task_update', {taskId, action: 'settle', outcome: 'succeeded'});
        } else if (text === 'Archive the completed synthetic review.') {
          assert.equal((await main.call('archive_work', {taskId})).state, 'archived');
        } else if (text.includes('"kind":"task_archived"')) {
          const details = await main.call('work_inspect', {taskId});
          assert.equal(details.task.historyState, 'archived');
          assert.equal(details.version.version, 2);
          assert.equal(details.version.sourceRequestId, 'source:revised');
          assert.deepEqual(details.version.authority, f.app.tasks.authority(taskId, 2));
          assert.deepEqual([details.version.authority.sourceRequestId, ...(details.version.authority.sourceRequestIds ?? [])], ['source:revised']);
          assert.deepEqual(new Set(details.sourceHistoryIds), new Set(['source:initial', 'source:revised']));
          assert.equal(Object.hasOwn(details, 'sourceRequestIds'), false);
          assert.equal(Object.hasOwn(details.version, 'authorityJson'), false);
          assert.equal(typeof f.app.tasks.version(taskId, 2).authorityJson, 'string', 'storage contract is unchanged');
          for (const [sourceRequestId, expected] of [['source:initial', initial], ['source:revised', revised]]) {
            const original = await main.call('work_inspect', {taskId, sourceRequestId});
            assert.equal(original.source.text, expected);
            assert.deepEqual(original.version.authority, details.version.authority);
            assert.deepEqual(original.sourceHistoryIds, details.sourceHistoryIds);
            assert.equal(Object.hasOwn(original, 'sourceRequestIds'), false);
            assert.equal(Object.hasOwn(original.version, 'authorityJson'), false);
          }
          await assert.rejects(main.call('work_inspect', {taskId, sourceRequestId: 'source:unrelated'}), /task_authority_source_denied/);
          const counts = () => ['tasks', 'runs', 'operations'].map(table => Number(f.app.store.db.prepare('SELECT count(*) n FROM ' + table).get()!.n));
          for (const sourceRequestIds of [['source:initial'], ['source:initial', 'source:revised'], ['source:revised'], ['source:unrelated'], ['source:archive']]) {
            const before = counts();
            await assert.rejects(main.call('task_create', {goal: 'Inspect remaining synthetic facts', sourceRequestIds}), /invalid_tool_arguments/);
            assert.deepEqual(counts(), before, 'rejected source selection cannot create work');
          }
          const followup = await main.call('task_create', {goal: 'Inspect remaining synthetic facts'});
          followups.push(followup.taskId);
          await main.call('worker_open', {taskId: followup.taskId, message: 'Read within the revised source only'});
          checked = true;
        }
        return {status: 'completed', text: 'Synthetic review recorded.'};
      } catch (error) {errors.push(String(error)); throw error;}
    });
    await f.app.start();
    await f.app.message('Unrelated synthetic request.', 'source:unrelated');
    await f.app.message(initial, 'source:initial');
    await f.app.message(revised, 'source:revised');
    await f.app.message('Archive the completed synthetic review.', 'source:archive');
    await until(() => checked || errors.length > 0);
    assert.deepEqual(errors, []);
    await until(() => f.engines.filter(engine => engine.options.role === 'worker' && engine.finish).length === 1);
    assert.equal(f.app.tasks.task(taskId).historyState, 'archived');
    assert.equal(f.app.tasks.runs(taskId).length, 0);
    assert.equal(followups.length, 1);
    for (const id of followups) {
      const authority = f.app.tasks.authority(id, 1);
      assert.deepEqual(new Set([authority.sourceRequestId, ...(authority.sourceRequestIds ?? [])]), new Set(['source:revised']));
      assert.equal(f.app.tasks.runs(id).length, 1);
    }
    for (const worker of f.engines.filter(engine => engine.options.role === 'worker')) worker.finish!({status: 'completed', text: 'Synthetic revised-scope observation.'});
    await f.app.idle();
    assert.deepEqual(errors, []);
  } finally {await f.close();}
});

test('public adapter transfers only an explicitly selected same-source result without prefilled authority grants', async () => {
  const f = transferFixture(); try {
    const task = await f.tools.call(f.actor, 'task_create', {goal: 'Produce precise evidence'}, 'producer-task') as any;
    const selected = await acceptedReply(f, task.taskId, 'selected'), privateResult = await acceptedReply(f, task.taskId, 'unselected');
    assert.deepEqual(f.tasks.authority(task.taskId, 1).resultIds, [], 'creation did not bypass the model interface');
    const sameSource = await f.tools.call(f.actor, 'task_create', {goal: 'Read a selected same-source result'}, 'consumer-task') as any;
    for (const [label, taskId] of [
      ['same-task', task.taskId],
      ['same-source-task', sameSource.taskId],
    ] as const) {
      assert.deepEqual(f.tasks.authority(taskId, 1).resultIds, []);
      const consumer = await f.tools.call(f.actor, 'worker_open', {taskId, message: 'Read exactly the selected result', resultIds: [selected.resultId]}, 'read-' + label) as any;
      const run = f.tasks.claim(consumer.runId)!; f.tasks.bind(run.id, run.epoch, 'thread:' + run.id, 'turn:' + run.id);
      const actor = {agentId: 'worker:' + consumer.workerId, runId: run.id, epoch: run.epoch, threadId: 'thread:' + run.id, turnId: 'turn:' + run.id};
      const host = Object.create(Homer.prototype) as any;
      Object.assign(host, {tasks: f.tasks, files: f.tasks.files, store: f.store, workerActor: () => actor, closing: false, accountClocks() {}});
      const read = await host.workerToolWork({id: run.id, epoch: run.epoch}, {tool: 'read_material', arguments: {}, callId: 'read-selected', threadId: actor.threadId, turnId: actor.turnId});
      assert.deepEqual(read.results.map((result: {id: string}) => result.id), [selected.resultId]);
      assert.equal(read.results[0].payload.text, 'Exact evidence: selected');
      assert.throws(() => f.tasks.readResultInput(actor, privateResult.resultId), /task_authority_input_denied/);
      assert.throws(() => f.tasks.readTask(actor, label === 'same-task' ? sameSource.taskId : task.taskId), /agent_scope_denied/);
    }
  } finally {f.close();}
});

test('public adapter rejects cross-source result selection atomically without granting another Worker', async () => {
  const f = transferFixture(); try {
    const producer = await f.tools.call(f.actor, 'task_create', {goal: 'Produce evidence for the original source'}, 'producer-task') as any;
    const source = f.source('source:other', 'Synthetic unrelated user request');
    const other = {...f.actor, sourceRequestId: 'source:other', inputMessageId: source.messageId};
    const consumer = await f.tools.call(other, 'task_create', {goal: 'Work only for this unrelated source'}, 'other-task') as any;
    const selected = await acceptedReply(f, producer.taskId, 'foreign-source');
    assert.deepEqual(f.tasks.authority(consumer.taskId, 1).resultIds, []);
    const before = f.counts();
    await assert.rejects(f.tools.call(other, 'worker_open', {taskId: consumer.taskId, message: 'Try to read foreign evidence', resultIds: [selected.resultId]}, 'cross-source'), /task_authority_input_denied/);
    assert.deepEqual(f.counts(), before);
    assert.equal(f.tasks.workers(consumer.taskId).length, 0);
  } finally {f.close();}
});

test('goal-only creation and message-only opening bind the unique current task without a contract', async () => {
  const f = fixture(); try {
    const root = await f.create();
    assert.equal(f.tasks.task(root.taskId).notes, ''); assert.equal(f.tasks.task(root.taskId).state, 'open');
    assert.equal(f.tasks.runs().length, 0);
    const opened = await f.tools.call(f.actor, 'worker_open', {message: 'Read the build files'}, 'open') as any;
    assert.equal(opened.taskId, root.taskId); assert.equal(opened.workerId, opened.runId);
    assert.equal(f.tasks.run(opened.runId).workingDirectory, f.tasks.files.workspace);
    const unbound = new RecursiveTools(f.tasks, {...f.effects, currentTaskId: () => undefined});
    await assert.rejects(unbound.call(f.actor, 'worker_open', {message: 'Ambiguous assignment'}, 'ambiguous'), /task_selection_required/);
    assert.equal(f.tasks.runs().length, 1);
  } finally {f.close();}
});

test('forged host fields, malformed collections and missing native identity fail before side effects', async () => {
  const f = fixture(); try {
    const before = f.counts();
    for (const extra of [{operationId: 'forged'}, {version: 9}, {epoch: 9}, {expectedTaskRevision: 9}, {agentId: 'host'}, {contract: {goal: 'forged'}}]) {
      await assert.rejects(f.tools.call(f.actor, 'task_create', {goal: 'Synthetic', ...extra}, 'forged'), /invalid_tool_arguments/);
    }
    await assert.rejects(f.tools.call(f.actor, 'worker_open', {taskId: 'any', message: 'Synthetic', resultIds: {}}, 'bad-array'), /invalid_tool_arguments/);
    await assert.rejects(f.tools.call(f.actor, 'task_create', {goal: 'Synthetic'}), /tool_call_identity_required/);
    await assert.rejects(f.tools.call({...f.actor, turnId: undefined}, 'task_create', {goal: 'Synthetic'}, 'missing-turn'), /tool_call_identity_required/);
    assert.deepEqual(f.counts(), before); assert.deepEqual(f.reads(), {authorityReads: 0, wakes: 0});
  } finally {f.close();}
});

test('Workers cannot invoke task or business session management before argument interpretation', async () => {
  const f = fixture(); try {
    const before = f.counts();
    for (const name of RECURSIVE_TOOLS.map(tool => tool.name)) await assert.rejects(f.tools.call({...f.actor, runId: 'run:forged'}, name, {}, 'forged'), /task_main_required/);
    assert.deepEqual(f.counts(), before); assert.deepEqual(f.reads(), {authorityReads: 0, wakes: 0});
  } finally {f.close();}
});

test('native-call replay returns one open receipt; another call with identical text is a distinct session', async () => {
  const f = fixture(); try {
    const root = await f.create(), args = {taskId: root.taskId, message: 'Read the same files'};
    const opened = await f.tools.call(f.actor, 'worker_open', args, 'open') as any;
    const replacement = new RecursiveTools(f.tasks, f.effects);
    assert.deepEqual(await replacement.call(f.actor, 'worker_open', args, 'open'), opened);
    await assert.rejects(replacement.call(f.actor, 'worker_open', {...args, message: 'Different assignment'}, 'open'), /operation_payload_conflict/);
    assert.equal(f.tasks.workers(root.taskId).length, 1);
    const prior = f.tasks.operationsForInput(f.actor, 'input:tools').find(op => op.kind === 'worker_open')!;
    assert.deepEqual(prior.response, opened); assert.equal(prior.details.threadId, 'thread:main');
    await replacement.call(f.actor, 'worker_open', args, 'independent-open');
    assert.equal(f.tasks.workers(root.taskId).length, 2);
  } finally {f.close();}
});

test('a retried notes edit uses the original native receipt after the hidden revision advances', async () => {
  const f = fixture(); try {
    const root = await f.create(), args = {taskId: root.taskId, notes: 'Check both reports'};
    const edited = await f.tools.call(f.actor, 'task_update', args, 'notes');
    assert.deepEqual(await f.tools.call(f.actor, 'task_update', args, 'notes'), edited);
    assert.equal(f.tasks.task(root.taskId).revision, 2);
    await assert.rejects(f.tools.call(f.actor, 'task_update', {...args, notes: 'Different'}, 'notes'), /operation_payload_conflict/);
    assert.equal(f.tasks.task(root.taskId).notes, 'Check both reports');
  } finally {f.close();}
});

test('changing requirements invokes the host stop effect for all affected in-flight sessions', async () => {
  const f = fixture(); try {
    const root = await f.create();
    const a = await f.tools.call(f.actor, 'worker_open', {message: 'Inspect page'}, 'page') as any;
    const b = await f.tools.call(f.actor, 'worker_open', {message: 'Inspect build'}, 'build') as any;
    for (const opened of [a, b]) {const run = f.tasks.claim(opened.runId)!; f.tasks.bind(run.id, run.epoch, 'thread:' + run.id, 'turn:' + run.id);}
    await f.tools.call(f.actor, 'task_update', {taskId: root.taskId, goal: 'Stop the old investigation; only explain existing evidence'}, 'changed-goal');
    assert.equal(f.stopped.length, 1);
    assert.deepEqual(new Set(f.stopped[0]!.targets as string[]), new Set([a.runId, b.runId]));
    assert.ok(f.tasks.run(a.runId).stopRequestedAt); assert.ok(f.tasks.run(b.runId).stopRequestedAt);
    assert.equal(f.tasks.task(root.taskId).controlState, 'stopping');
  } finally {f.close();}
});

test('task controls reject ambiguous mixed edits and settlement without an explicit outcome', async () => {
  const f = fixture(); try {
    const root = await f.create(), before = f.counts();
    for (const args of [{action: 'pause', goal: 'also change'}, {action: 'settle'}, {outcome: 'succeeded'}, {sourceRequestIds: ['source:tools'], notes: 'no goal'}]) await assert.rejects(f.tools.call(f.actor, 'task_update', {taskId: root.taskId, ...args}, 'invalid'), /invalid_tool_arguments/);
    assert.deepEqual(f.counts(), before);
    const paused = await f.tools.call(f.actor, 'task_update', {taskId: root.taskId, action: 'pause'}, 'pause') as any;
    assert.equal(paused.state, 'paused'); assert.equal(f.stopped.length, 1);
    await f.tools.call(f.actor, 'task_update', {taskId: root.taskId, action: 'resume'}, 'resume');
    assert.equal(f.tasks.task(root.taskId).state, 'open');
  } finally {f.close();}
});

test('raw replies remain readable without a Result; formal adoption and unknown publication stay explicit', async () => {
  const f = fixture(); try {
    const root = await f.create(), opened = await f.tools.call(f.actor, 'worker_open', {message: 'Inspect'}, 'open') as any;
    const run = f.tasks.claim(opened.runId)!; f.tasks.bind(run.id, run.epoch, 'thread:worker', 'turn:worker');
    const body = 'First paragraph.\n\n' + '证据'.repeat(15000);
    f.tasks.endSegment(run.id, run.epoch, {status: 'completed', text: body, messages: [{itemId: 'native:reply', phase: 'final_answer', text: body}]}, true);
    const reply = f.tasks.inbox(f.actor).find(message => message.kind === 'worker_reply')!;
    const page = await f.tools.call(f.actor, 'worker_read', {workerId: opened.workerId, messageId: reply.id}) as any;
    assert.ok(page.messages[0].text === body.slice(0, 24000), 'first chunk keeps original text'); assert.equal(page.messages[0].nextOffset, 24000);
    const tail = await f.tools.call(f.actor, 'worker_read', {workerId: opened.workerId, messageId: reply.id, offset: 24000}) as any;
    assert.ok(page.messages[0].text + tail.messages[0].text === body, 'chunks preserve the complete original');
    assert.equal(f.tasks.readTask(f.actor, root.taskId).results.length, 0); assert.equal(f.tasks.task(root.taskId).state, 'open');
    const adopted = await f.tools.call(f.actor, 'accept_result', {runId: run.id, messageId: reply.id}, 'adopt') as any;
    const accepted = await f.tools.call(f.actor, 'work_inspect', {resultId: adopted.resultId}) as any;
    assert.ok(accepted.payload.text === body, 'formal inspection reads the accepted source text');
    const args = {taskId: root.taskId, resultIds: [adopted.resultId], text: 'Checked synthetic evidence'};
    const delivery = await f.tools.call(f.actor, 'publish_delivery', args, 'publish') as any;
    f.tasks.markDelivery(delivery.deliveryId, 'submitting'); f.tasks.markDelivery(delivery.deliveryId, 'uncertain');
    await assert.rejects(f.tools.call(f.actor, 'publish_delivery', args, 'new-publish'), /delivery_already_prepared/);
    assert.equal(f.tasks.deliveries().length, 1); assert.equal(f.tasks.delivery(delivery.deliveryId).state, 'uncertain');
    const details = await f.tools.call(f.actor, 'work_inspect', {taskId: root.taskId}) as any;
    assert.equal(details.deliveries[0].state, 'uncertain');
    const receipt = await f.tools.call(f.actor, 'work_inspect', {operationKey: delivery.operationKey}) as any;
    assert.equal(receipt.operations[0].response.deliveryId, delivery.deliveryId);
    await assert.rejects(f.tools.call(f.actor, 'work_inspect', {taskId: root.taskId, resultId: adopted.resultId}), /invalid_tool_arguments/);
    await assert.rejects(f.tools.call(f.actor, 'work_inspect', {taskId: root.taskId, sourceRequestId: 'source:foreign'}), /task_authority_source_denied/);
  } finally {f.close();}
});

test('worker_read selects and pages one original native public item through the model interface', async () => {
  const f = fixture(); try {
    await f.create();
    const opened = await f.tools.call(f.actor, 'worker_open', {message: 'Inspect exact public items'}, 'open') as any;
    const run = f.tasks.claim(opened.runId)!; f.tasks.bind(run.id, run.epoch, 'thread:worker', 'turn:worker');
    const body = '原始公开证据'.repeat(6000);
    f.tasks.endSegment(run.id, run.epoch, {status: 'completed', text: 'Aggregate reply', messages: [
      {itemId: 'native:note', phase: 'commentary', text: 'Earlier public note'},
      {itemId: 'native:report', phase: 'final_answer', text: body},
    ]}, true);
    const reply = f.tasks.inbox(f.actor).find(message => message.kind === 'worker_reply')!;
    const query = {workerId: opened.workerId, messageId: reply.id, itemId: 'native:report'};
    const page = await f.tools.call(f.actor, 'worker_read', query) as any;
    assert.equal(page.messages[0].itemId, 'native:report');assert.equal(page.messages[0].text, body.slice(0, 24000));
    assert.equal(page.messages[0].nextOffset, 24000);
    const tail = await f.tools.call(f.actor, 'worker_read', {...query, offset: page.messages[0].nextOffset}) as any;
    assert.equal(page.messages[0].text + tail.messages[0].text, body);assert.equal(tail.messages[0].nextOffset, null);
    const note = await f.tools.call(f.actor, 'worker_read', {...query, itemId: 'native:note'}) as any;
    assert.equal(note.messages[0].text, 'Earlier public note');
    await assert.rejects(f.tools.call(f.actor, 'worker_read', {...query, itemId: 'native:missing'}), /message_not_found/);
    await assert.rejects(f.tools.call(f.actor, 'worker_read', {workerId: opened.workerId, itemId: 'native:report'}), /worker_query_invalid/);
  } finally {f.close();}
});

test('pending tools bind native identity without exposing a concurrency token or authorizing execution', async () => {
  const f = fixture(); try {
    const pending = new PendingTools(f.tasks), event = {...f.actor, sourceRequestId: undefined};
    const note = await pending.call(event, 'pending_add', {content: 'A suggestion, not an assignment'}, 'add-note') as any;
    assert.deepEqual(await pending.call(event, 'pending_add', {content: 'A suggestion, not an assignment'}, 'add-note'), note);
    const args = {id: note.id, patch: {handlingNote: 'Waiting for a real user decision'}};
    const edited = await pending.call(event, 'pending_update', args, 'edit-note');
    assert.deepEqual(await pending.call(event, 'pending_update', args, 'edit-note'), edited);
    assert.equal(f.tasks.tasks().length, 0); assert.equal(f.tasks.runs().length, 0);
    await assert.rejects(pending.call(event, 'pending_update', {...args, expectedRevision: 2}, 'spoof'), /invalid_tool_arguments/);
  } finally {f.close();}
});

test('Main can explicitly adopt its own actual task file without opening a Worker', async () => {
  const f = fixture(); try {
    const root = await f.create(), filePath = join(f.tasks.files.workspace, 'main-answer.txt');
    writeFileSync(filePath, 'Synthetic Main result');
    const adopted = await f.tools.call(f.actor, 'accept_result', {taskId: root.taskId, filePath}, 'main-file') as any;
    assert.equal(f.tasks.runs().length, 0);
    const actual = await f.tools.call(f.actor, 'work_inspect', {resultId: adopted.resultId}) as any;
    assert.equal(actual.file.content, 'Synthetic Main result');
    assert.equal(actual.version, 1);
    await assert.rejects(f.tools.call(f.actor, 'accept_result', {taskId: root.taskId, runId: 'unrelated', filePath}, 'mixed-source'), /invalid_tool_arguments/);
    await assert.rejects(f.tools.call(f.actor, 'accept_result', {filePath}, 'missing-source'), /invalid_tool_arguments/);
  } finally {f.close();}
});

test('Main can explicitly adopt a Worker file from that exact Run output directory', async () => {
  const f = fixture(); try {
    await f.create();
    const workingDirectory = join(f.dir, 'authorized-project'); mkdirSync(workingDirectory);
    const opened = await f.tools.call(f.actor, 'worker_open', {message: 'Write a synthetic file', workingDirectory}, 'open-file') as any;
    const run = f.tasks.claim(opened.runId)!; f.tasks.bind(run.id, run.epoch, 'thread:file-worker', 'turn:file-worker');
    const actor = {agentId: 'worker:' + opened.workerId, runId: run.id, epoch: run.epoch, threadId: 'thread:file-worker', turnId: 'turn:file-worker'};
    const written = f.tasks.writeMarkdown(actor, {operationId: toolOperationId(actor, 'write'), filename: 'worker-answer.md', content: '# Synthetic Worker result'});
    assert.equal(f.tasks.readTask(f.actor, run.taskId).results.length, 0);
    f.tasks.endSegment(run.id, run.epoch, {status: 'completed', text: written.path}, true);
    const adopted = await f.tools.call(f.actor, 'accept_result', {runId: run.id, filePath: written.path}, 'accept-worker-file') as any;
    const actual = await f.tools.call(f.actor, 'work_inspect', {resultId: adopted.resultId}) as any;
    assert.equal(actual.file.content, '# Synthetic Worker result');
  } finally {f.close();}
});

test('schema validation reports trusted paths without copying unknown field names or values', () => {
  const schema = RECURSIVE_TOOLS.find(tool => tool.name === 'worker_send')!.inputSchema;
  let error: unknown;
  try {validateToolArguments({workerId: 'synthetic', message: 'ok', privateSecret: 'do-not-echo'}, schema);} catch (caught) {error = caught;}
  assert.ok(error instanceof Error);
  assert.doesNotMatch(JSON.stringify(error), /privateSecret|do-not-echo/);
  assert.notEqual(toolOperationId({agentId: 'main', threadId: 'a', turnId: 'b'}, 'c'), toolOperationId({agentId: 'main', threadId: 'a', turnId: 'other'}, 'c'));
});
