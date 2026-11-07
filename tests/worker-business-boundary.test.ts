// Real task ownership and the published Worker interface; no model or account.
import test from 'node:test';
import assert from 'node:assert/strict';
import {chatFixture} from './task-chat-fixture.js';
import {WORKER_HOST_MCP_TOOLS} from '../src/worker-interaction-mcp.js';
import {WORKER_INTERACTION_TOOLS} from '../src/worker-interaction-tools.js';
import {WORKER_FILE_TOOLS} from '../src/media-tools.js';

 test('only Main manages user goals and business Worker conversations', () => {
  const f = chatFixture(); try {
    const root = f.create(), opened = f.tasks.workerOpen(f.actor, {operationId: 'open', taskId: root.taskId, text: 'Read only'}), run = f.start(opened.workerId);
    const actor = {agentId: 'worker:' + opened.workerId, runId: run.id, epoch: run.epoch, threadId: run.threadId!, turnId: run.turnId!};
    const mutation = {operationId: 'forged', taskId: root.taskId, expectedRevision: f.tasks.task(root.taskId).revision};
    const counts = () => ['tasks', 'runs', 'operations'].map(table => Number(f.store.db.prepare('SELECT count(*) n FROM ' + table).get()!.n));
    const before = counts();
    for (const attempt of [
      () => f.tasks.createTask(actor, {operationId: 'forged-create', goal: 'New goal', authority: f.authority}),
      () => f.tasks.updateTask(actor, {...mutation, patch: {notes: 'Forged'}}),
      () => f.tasks.controlTask(actor, {...mutation, action: 'pause'}),
      () => f.tasks.settleTask(actor, {...mutation, outcome: 'succeeded'}),
      () => f.tasks.workerOpen(actor, {operationId: 'forged-open', taskId: root.taskId, text: 'Create another business worker'}),
      () => f.tasks.workerSend(actor, {operationId: 'forged-send', workerId: opened.workerId, text: 'Pretend to be main'}),
      () => f.tasks.workerStop(actor, {operationId: 'forged-stop', workerId: opened.workerId}),
      () => f.tasks.archiveHistory(actor, mutation, true),
    ]) {
      assert.throws(attempt, /main_required|history_actor_denied/);
      assert.deepEqual(counts(), before);
    }
    assert.throws(() => f.tasks.guard({...actor, agentId: 'worker:foreign'}), /identity_denied/);
  } finally {f.close();}
});

test('Workers retain scoped input reads, synchronous questions and capabilities without business management', () => {
  const names = new Set([...WORKER_INTERACTION_TOOLS, ...WORKER_FILE_TOOLS, ...WORKER_HOST_MCP_TOOLS].map(tool => tool.name));
  for (const name of ['ask_main', 'capabilities', 'inspect_attachment', 'create_voice_result', 'stage_file_result']) assert.ok(names.has(name), name);
  for (const name of ['read_material', 'write_markdown', 'send_user_message', 'task_create', 'task_update', 'worker_open', 'worker_send', 'worker_interrupt', 'accept_result', 'publish_delivery', 'archive_work', 'restore_work', 'pending_add', 'pending_update', 'task_delegate', 'agent_send', 'inbox_read', 'inbox_ack', 'task_wait', 'adopt_version']) assert.ok(!names.has(name), name);
});
