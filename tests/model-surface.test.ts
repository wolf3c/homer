// The published model interface, without a model, account or external service.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadPrompts} from '../src/prompts.js';
import {MAIN_TOOLS} from '../src/tools.js';
import {RECURSIVE_TOOLS, validateToolArguments} from '../src/recursive-tools.js';
import {HOST_MCP_TOOLS, WORKER_HOST_MCP_TOOLS} from '../src/worker-interaction-mcp.js';
import {WORKER_INTERACTION_TOOLS} from '../src/worker-interaction-tools.js';
import {WORKER_MEDIA_TOOLS, WORKER_FILE_TOOLS} from '../src/media-tools.js';
import {fixture, until} from './fixtures/worker-chat-host.js';

test('ordinary collaboration accepts a goal or message without a contract or host identity', () => {
  for (const [name, args] of [
    ['task_create', {goal: '查清预览为空白的原因，先别改文件。'}],
    ['worker_open', {taskId: 'task:synthetic', message: '只读核对构建文件名。'}],
    ['worker_send', {workerId: 'run:synthetic', message: '请说明实际观察到的文件名。'}],
    ['worker_read', {workerId: 'run:synthetic'}],
    ['worker_interrupt', {workerId: 'run:synthetic'}],
  ] as const) {
    const tool = RECURSIVE_TOOLS.find(tool => tool.name === name);
    assert.ok(tool, name);
    validateToolArguments(args, tool.inputSchema);
  }
});

test('collaboration schemas cannot let a model supply host identity or concurrency tokens', () => {
  const forbidden = new Set(['operationId', 'operationScopeId', 'version', 'epoch', 'expectedTaskRevision', 'expectedRunRevision', 'expectedRevision', 'parentVersion', 'coordinatorAgentId', 'nextCoordinatorId', 'contract', 'resultKind']);
  const visit = (schema: Record<string, unknown>, name: string) => {
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      assert.ok(!forbidden.has(key), name + '.' + key);
      visit(child as Record<string, unknown>, name + '.' + key);
    }
    if (schema.items) visit(schema.items as Record<string, unknown>, name + '[]');
  };
  for (const tool of [...RECURSIVE_TOOLS, ...WORKER_MEDIA_TOOLS, ...WORKER_FILE_TOOLS]) visit(tool.inputSchema, tool.name);
});

test('role instructions and archive Skill refer only to tools actually available to that role', () => {
  const prompts = loadPrompts();
  const main = [...MAIN_TOOLS, ...RECURSIVE_TOOLS, ...HOST_MCP_TOOLS];
  const worker = [...WORKER_INTERACTION_TOOLS, ...WORKER_FILE_TOOLS, ...WORKER_HOST_MCP_TOOLS];
  const archive = readFileSync(new URL('../.codex/skills/homer-archive-review/SKILL.md', import.meta.url), 'utf8');
  for (const [source, tools] of [[prompts.main, main], [archive, main], [prompts.worker, worker]] as const) {
    const names = new Set(tools.map(tool => tool.name));
    for (const match of source.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)) assert.ok(names.has(match[1]!), match[1]);
  }
});

test('the real host registers the complete role catalog as native dynamic tools', async () => {
  const f = fixture();
  try {
    f.setScript(async (main, text) => {
      if (text === 'inspect catalog') {
        await main.call('worker_open', {message: 'Synthetic read only'});
      }
      return {status: 'completed', text: 'Synthetic response'};
    });
    await f.app.start();
    await f.app.message('inspect catalog', 'synthetic-catalog-source');
    await until(() => f.engines.some(engine => engine.options.role === 'worker'));
    for (const [role, expected, mcp] of [
      ['main', [...MAIN_TOOLS, ...RECURSIVE_TOOLS], HOST_MCP_TOOLS],
      ['worker', [...WORKER_INTERACTION_TOOLS, ...WORKER_FILE_TOOLS], WORKER_HOST_MCP_TOOLS],
    ] as const) {
      const actual = f.engines.find(engine => role === 'main' ? engine.options.role !== 'worker' : engine.options.role === 'worker')!.options.tools;
      assert.deepEqual(actual, expected, role);
      const names = [...actual, ...mcp].map(tool => tool.name);
      assert.equal(new Set(names).size, names.length, role + ' has one outlet per tool');
    }
  } finally {await f.close();}
});

test('new collaboration has one dynamic-tool outlet and Workers cannot manage business work', () => {
  const dynamic = new Set(RECURSIVE_TOOLS.map(tool => tool.name));
  for (const tool of [...HOST_MCP_TOOLS, ...WORKER_HOST_MCP_TOOLS]) assert.ok(!dynamic.has(tool.name), tool.name);
  const worker = new Set([...WORKER_INTERACTION_TOOLS, ...WORKER_FILE_TOOLS, ...WORKER_HOST_MCP_TOOLS].map(tool => tool.name));
  for (const name of ['task_create', 'task_update', 'worker_open', 'worker_send', 'worker_interrupt', 'accept_result', 'publish_delivery', 'archive_work', 'restore_work', 'delete_work']) {
    assert.ok(!worker.has(name), name);
  }
});

test('one text investigation uses two business calls without a result, publication or manual acknowledgment', async () => {
  const f = fixture(), calls: string[] = []; let taskId = '';
  try {
    f.setScript(async (main, text) => {
      const call = async (tool: string, args: unknown) => {calls.push(tool); return main.call(tool, args);};
      if (text === 'investigate text only') {
        taskId = (await call('worker_open', {message: 'Report the exact observed file names'})).taskId;
        return {status: 'completed', text: 'Synthetic investigation started'};
      }
      assert.ok(text.includes('page.js references missing build.js'), 'host supplies the original Worker reply');
      await call('task_update', {taskId, action: 'settle', outcome: 'succeeded', notes: 'Checked the exact file names'});
      return {status: 'completed', text: 'Synthetic investigation complete'};
    });
    await f.app.start(); await f.app.message('investigate text only', 'synthetic-text-source');
    await until(() => f.engines.some(engine => engine.options.role === 'worker' && engine.finish));
    f.engines.find(engine => engine.options.role === 'worker')!.finish!({status: 'completed', text: 'page.js references missing build.js'});
    await until(() => f.app.tasks.task(taskId).state === 'settled');
    await f.app.idle();
    assert.deepEqual(calls, ['worker_open', 'task_update']);
    assert.equal(f.app.store.db.prepare('SELECT count(*) n FROM conversation_attachments').get()!.n,0);
    assert.equal(f.inputs.length, 2);
  } finally {await f.close();}
});
