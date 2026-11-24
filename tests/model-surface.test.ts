// The published model interface, without a model, account or external service.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadPrompts} from '../src/prompts.js';
import {MAIN_TOOLS} from '../src/tools.js';
import {MAIN_TOOLS_HASH, RECURSIVE_TOOLS, validateToolArguments} from '../src/recursive-tools.js';
import {HOST_MCP_TOOLS, WORKER_HOST_MCP_TOOLS} from '../src/worker-interaction-mcp.js';
import {WORKER_MEDIA_TOOLS, WORKER_FILE_TOOLS} from '../src/media-tools.js';
import {fixture, until} from './fixtures/worker-chat-host.js';
import {Homer} from '../src/service.js';

test('incompatible native tool catalog preserves the original thread and refuses to start', async () => {
  const f = fixture(), hash = '615506d5ebbfc9ade218daa6793de1b0318d10a3016463b99da0395d498aaccf';
  try {
    f.app.store.setMeta('mainThread', 'previous-native-thread');
    f.app.store.setMeta('mainToolsHash', hash);
    const schedules = test.mock.method(f.app.schedules, 'start', () => {});
    await assert.rejects(f.app.start({keepManagementOnFailure:true}), /main_tools_migration_required/);
    assert.equal(schedules.mock.callCount(), 0);
    assert.equal(f.app.store.meta('mainThread'), 'previous-native-thread');
    assert.equal(f.app.store.meta('mainToolsHash'), hash);
    assert.equal(f.engines.length, 0);
    const config = f.app.config;
    await f.app.close();
    const desktop = new Homer({...config, pauseOldDesktopWork:true, desktopModelSource:'codex',
      desktopResources:{bundleRoot:config.runtime, manifestSha256:'a'.repeat(64)}}, async () => {});
    try {
      assert.equal(desktop.store.meta('desktopUserQueueBoundary'), undefined);
    } finally {await desktop.close();}
  } finally {await f.close();}
});

test('ordinary collaboration accepts a titled goal or message without host identity', () => {
  for (const [name, args] of [
    ['task_create', {goal: '查清预览为空白的原因，先别改文件。', title:'排查空白预览'}],
    ['worker_open', {taskId: 'task:synthetic', message: '只读核对构建文件名。'}],
    ['worker_message', {workerId: 'run:synthetic', message: '请说明实际观察到的文件名。'}],
    ['worker_read', {workerId: 'run:synthetic'}],
    ['worker_interrupt', {workerId: 'run:synthetic'}],
  ] as const) {
    const tool = RECURSIVE_TOOLS.find(tool => tool.name === name);
    assert.ok(tool, name);
    validateToolArguments(args, tool.inputSchema);
  }
});

test('one Worker message tool covers steer and continuation without a queuing option', () => {
  assert.ok(!RECURSIVE_TOOLS.some(tool => tool.name === 'worker_send'));
  const message = RECURSIVE_TOOLS.find(tool => tool.name === 'worker_message')!;
  assert.throws(() => validateToolArguments({workerId:'example',message:'next',immediate:true},message.inputSchema), /invalid_tool_arguments/);
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
      const input = {taskId:recorded.taskId};
      const opened = await main.call('worker_open', input, 'first-dispatch');
      const committed = counts();
      assert.deepEqual(await main.call('worker_open', input, 'first-dispatch'), opened);
      assert.deepEqual(counts(), committed);
      assert.equal(f.app.tasks.task(opened.taskId).title, title);
      assert.equal(f.app.tasks.version(opened.taskId, 1).goal, message);
      assert.equal(f.app.tasks.run(opened.runId).prompt, message);
      const part = await main.call('worker_open', {...input, message:'只核对附件。'});
      assert.equal(part.taskId, recorded.taskId);
      assert.equal(f.app.tasks.run(part.runId).goal, message);
      assert.equal(f.app.tasks.run(part.runId).prompt, '只核对附件。');
      assert.equal(f.app.tasks.tasks().length, 1);
      return {status:'completed', text:'title-contract-verified'};
    });
    assert.equal(await f.app.message('核对合同附件和补充条款', source), 'title-contract-verified');
    assert.equal(f.engines.length, 1);
  } finally {await f.close();}
});

test('role instructions and archive Skill refer only to tools actually available to that role', async () => {
  const prompts = loadPrompts();
  const f=fixture([{id:'synthetic',async send(){throw Error('unexpected_channel_send');}}]);
  const worker = WORKER_HOST_MCP_TOOLS;
  const archive = readFileSync(new URL('../.codex/skills/homer-archive-review/SKILL.md', import.meta.url), 'utf8');
  try{
    await f.app.start();
    const main=f.engines[0]!.options.interactionMcp!.catalog;
    assert.ok(main);
    for (const [source, tools] of [[prompts.main, main], [archive, HOST_MCP_TOOLS], [prompts.worker, worker]] as const) {
      const names = new Set(tools.map(tool => tool.name));
      for (const match of source.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)) assert.ok(names.has(match[1]!), match[1]);
    }
  }finally{await f.close();}
});

test('the real host exposes business tools once in its role MCP catalog', async () => {
  const f = fixture();
  try {
    f.setScript(async (main, text) => {
      if (text === 'inspect catalog') {
        const {taskId} = await main.call('task_create', {title:'Synthetic read only', goal:'Synthetic read only'});
        await main.call('worker_open', {taskId});
      }
      return {status: 'completed', text: 'Synthetic response'};
    });
    await f.app.start();
    await f.app.message('inspect catalog', 'synthetic-catalog-source');
    await until(() => f.engines.some(engine => engine.options.role === 'worker'));
    for (const [role, migrated] of [['main', [...MAIN_TOOLS, ...RECURSIVE_TOOLS]], ['worker', WORKER_FILE_TOOLS]] as const) {
      const options = f.engines.find(engine => (engine.options.role ?? 'main') === role)!.options;
      const catalog = options.interactionMcp!.catalog!.map(tool => tool.name);
      assert.equal(new Set(catalog).size, catalog.length);
      for (const tool of migrated) {
        assert.ok(catalog.includes(tool.name), tool.name);
        assert.ok(!options.tools.some(entry => entry.name === tool.name), tool.name);
      }
    }
  } finally {await f.close();}
});

test('new collaboration has one MCP outlet and Workers cannot manage business work', () => {
  const dynamic = new Set(RECURSIVE_TOOLS.map(tool => tool.name));
  for (const name of dynamic) assert.ok(HOST_MCP_TOOLS.some(tool => tool.name === name), name);
  const worker = new Set(WORKER_HOST_MCP_TOOLS.map(tool => tool.name));
  for (const name of ['task_create', 'task_update', 'worker_open', 'worker_message', 'worker_interrupt', 'accept_result', 'publish_delivery', 'archive_work', 'restore_work', 'delete_work']) {
    assert.ok(!worker.has(name), name);
  }
});

test('one text investigation uses three business calls without a result, publication or manual acknowledgment', async () => {
  const f = fixture(), calls: string[] = []; let taskId = '';
  try {
    f.setScript(async (main, text) => {
      const call = async (tool: string, args: unknown) => {calls.push(tool); return main.call(tool, args);};
      if (text === 'investigate text only') {
        taskId = (await call('task_create', {title:'Report the exact observed file names',goal: 'Report the exact observed file names'})).taskId;
        await call('worker_open', {taskId});
        return {status: 'completed', text: 'Synthetic investigation started'};
      }
      assert.ok(text.includes('page.js references missing build.js'), 'host supplies the original Worker reply');
      await call('task_update', {taskId, notes: 'Checked the exact file names'});
      return {status: 'completed', text: 'Synthetic investigation complete'};
    });
    await f.app.start(); await f.app.message('investigate text only', 'synthetic-text-source');
    await until(() => f.engines.some(engine => engine.options.role === 'worker' && engine.finish));
    f.engines.find(engine => engine.options.role === 'worker')!.finish!({status: 'completed', text: 'page.js references missing build.js'});
    await until(() => f.app.tasks.task(taskId).notes === 'Checked the exact file names');
    await f.app.idle();
    assert.deepEqual(calls, ['task_create', 'worker_open', 'task_update']);
    assert.equal(f.app.store.db.prepare('SELECT count(*) n FROM conversation_attachments').get()!.n,0);
    assert.equal(f.inputs.length, 2);
  } finally {await f.close();}
});
