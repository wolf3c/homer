// The published model interface, without a model, account or external service.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadPrompts} from '../src/prompts.js';
import {MAIN_TOOLS} from '../src/tools.js';
import {MAIN_TOOLS_HASH, RECURSIVE_TOOLS, validateToolArguments} from '../src/recursive-tools.js';
import {HOST_MCP_TOOLS, WORKER_HOST_MCP_TOOLS} from '../src/worker-interaction-mcp.js';
import {WORKER_INTERACTION_TOOLS} from '../src/worker-interaction-tools.js';
import {WORKER_MEDIA_TOOLS, WORKER_FILE_TOOLS} from '../src/media-tools.js';
import {fixture, until} from './fixtures/worker-chat-host.js';

test('ordinary collaboration accepts a titled goal or message without host identity', () => {
  for (const [name, args] of [
    ['task_create', {goal: '查清预览为空白的原因，先别改文件。', title:'排查空白预览'}],
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
    if (Array.isArray(schema.oneOf)) for (const branch of schema.oneOf) visit(branch, name);
  };
  for (const tool of [...RECURSIVE_TOOLS, ...WORKER_MEDIA_TOOLS, ...WORKER_FILE_TOOLS]) visit(tool.inputSchema, tool.name);
});

test('new Main validates titles before staging and commits one original dispatch receipt', async () => {
  const f = fixture();
  try {
    await f.app.start();
    assert.equal(f.app.store.meta('mainToolsHash'), MAIN_TOOLS_HASH);
    f.app['pump'] = () => {};
    const source = 'title-contract-source', title = '核对合同', message = '用户要求核对合同附件并保留审阅细节。';
    const attachments = [{path: '/synthetic/path/must-not-be-staged.txt'}];
    const counts = () => ['tasks', 'operations', 'agent_messages', 'runs'].map(table =>
      f.app.store.db.prepare('SELECT count(*) n FROM ' + table).get()!.n);
    f.setScript(async main => {
      const before = counts();
      for (const args of [{goal: message}, {goal: message, title: ' \t'}, {goal: message, title: 'x'.repeat(81)}, {goal: message, title, other: true}])
        await assert.rejects(main.call('task_create', args), /invalid_tool_arguments/);
      for (const fields of [{}, {title:' \n'}, {title:'x'.repeat(81)}, {title, taskId:'other'}, {title, other: true}])
        await assert.rejects(main.call('worker_open', {message, attachments, ...fields}), /invalid_tool_arguments/);
      assert.deepEqual(counts(), before);
      const recorded = await main.call('task_create', {goal: message, title});
      const version = f.app.tasks.version(recorded.taskId, 1);
      assert.equal(version.goal, message);
      assert.equal(version.sourceRequestId, source);
      assert.equal(version.authorityJson, null);
      assert.equal(f.app.tasks.task(recorded.taskId).title, title);
      await main.call('task_update', {taskId: recorded.taskId, goal: message});
      const existing = await main.call('worker_open', {taskId: recorded.taskId, message});
      assert.equal(existing.taskId, recorded.taskId);
      assert.equal(f.app.tasks.task(existing.taskId).title, title);
      const input = {message, title: '核对补充条款'};
      const opened = await main.call('worker_open', input, 'first-dispatch');
      const committed = counts();
      assert.deepEqual(await main.call('worker_open', input, 'first-dispatch'), opened);
      assert.deepEqual(counts(), committed);
      assert.equal(f.app.tasks.task(opened.taskId).title, input.title);
      assert.equal(f.app.tasks.version(opened.taskId, 1).sourceRequestId, source);
      assert.equal(f.app.tasks.version(opened.taskId, 1).goal, message);
      assert.equal(f.app.tasks.run(opened.runId).prompt, message);
      assert.equal(f.app.store.db.prepare('SELECT count(*) n FROM operations WHERE id=? AND state=?').get(opened.operationKey, 'confirmed')!.n, 1);
      return {status:'completed', text:'title-contract-verified'};
    });
    assert.equal(await f.app.message('核对合同附件和补充条款', source), 'title-contract-verified');
    assert.equal(f.engines.length, 1);
  } finally {await f.close();}
});

for (const [hash, optionalTitle] of [
  ['f579ad37daedcef8a429e13a0511668b2ef954abbc180e47b408475c5395cffe', false],
  ['d8a4bd52a287759bcbcd4eb754a8e41e344ac6e1ab287576f4c8b2172202f150', true],
] as const) test('cold-restored Main applies its persisted title rules ' + hash.slice(0,8), async () => {
  const f = fixture();
  try {
    f.app.store.setMeta('mainThread', 'synthetic-legacy-thread');
    f.app.store.setMeta('mainToolsHash', hash);
    await f.app.start();
    f.app['pump'] = () => {};
    const goal = 'Check an old proposal\nKeep the full scope in the task version.';
    f.setScript(async main => {
      const recorded = await main.call('task_create', {goal});
      assert.equal(f.app.tasks.task(recorded.taskId).title, 'Check an old proposal');
      const opened = await main.call('worker_open', {message: goal}, 'legacy-open');
      assert.equal(f.app.tasks.task(opened.taskId).title, 'Check an old proposal');
      assert.deepEqual(await main.call('worker_open', {message: goal}, 'legacy-open'), opened);
      const named = {message: goal, title: 'Proposal review'};
      if (optionalTitle) {
        const result = await main.call('worker_open', named);
        assert.equal(f.app.tasks.task(result.taskId).title, named.title);
      } else {
        await assert.rejects(main.call('worker_open', named), /invalid_tool_arguments/);
      }
      await assert.rejects(main.call('worker_open', {...named, taskId: opened.taskId}), /invalid_tool_arguments/);
      return {status:'completed', text:'legacy-contract-verified'};
    });
    assert.equal(await f.app.message('Review the legacy proposal', 'legacy-title-source'), 'legacy-contract-verified');
    assert.equal(f.app.store.meta('mainToolsHash'), hash);
    assert.equal(f.engines[0]!.threadId, 'synthetic-legacy-thread');
    assert.equal(f.engines.length, 1);
  } finally {await f.close();}
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
        await main.call('worker_open', {title:"Synthetic read only",message: 'Synthetic read only'});
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
        taskId = (await call('worker_open', {title:"Report the exact observed file names",message: 'Report the exact observed file names'})).taskId;
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
