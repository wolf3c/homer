// Explicit real-model regression. Both services use a fresh synthetic runtime;
// no daily conversation, material or provider credentials are copied.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { loadConfig, type Config } from '../src/config.js';
import { Homer, type EngineFactory } from '../src/service.js';
import { CodexEngine, codexVersion, engineError } from '../src/engine.js';

const [sourcePath, targetPath] = process.argv.slice(2);
if (!sourcePath || !targetPath) throw new Error('explicit_source_and_target_configs_required');
const source = loadConfig(sourcePath);
const target = loadConfig(targetPath);
for (const field of ['codexHome', 'baseUrl', 'keyEnv', 'requiresOpenaiAuth'] as const)
  assert.equal(target[field], source[field], 'account_boundary_must_match');
const base = resolve('.codex/scratch/model-switch-' + Date.now());
const directories = { runtime: join(base, 'runtime'), workspace: join(base, 'workspace') };
mkdirSync(directories.runtime, { recursive: true });
mkdirSync(join(directories.workspace, 'materials'), { recursive: true });
writeFileSync(join(directories.workspace, 'materials', 'synthetic-switch.md'), '# 公开合成材料\n日期待确认。\n');
const token = 'HMR-' + randomUUID();
let toolCalls = 0;
const factory = (config: Config): EngineFactory => (options, handler) =>
  new CodexEngine(config, options, async call => {
    if (call.tool === 'list_work') toolCalls++;
    return handler(call);
  });
let app: Homer | undefined;
let stage = 'source-start';
let result: Record<string, unknown>;
try {
  const first = { ...source, ...directories, mainTimeoutMs: 90000 };
  app = new Homer(first, async () => {}, factory(first));
  await app.start();
  const threadId = app.store.meta('mainThread');
  stage = 'remember';
  const reply = await app.message('这是公开合成测试。记住暗号 ' + token + '，只回复收到，不派发任务。');
  assert.ok(reply && !reply.includes('主 Agent 未完成'));
  await app.close();
  stage = 'target-resume';
  const next = { ...target, ...directories, mainTimeoutMs: 90000 };
  app = new Homer(next, async () => {}, factory(next));
  await app.start();
  assert.equal(app.store.meta('mainThread'), threadId);
  stage = 'recall';
  const recalled = await app.message('刚才让你记住的完整暗号是什么？只回复暗号，不派发任务。');
  assert.ok(recalled.includes(token), 'context_recall_failed');
  stage = 'tool-call';
  const before = toolCalls;
  const materials = await app.message('请现在调用 list_work 查询可用材料，只回复实际材料文件名，不派发任务。');
  assert.ok(toolCalls > before, 'real_tool_call_required');
  assert.ok(materials.includes('synthetic-switch.md'), 'material_query_failed');
  assert.equal(app.store.runs().length, 0);
  assert.equal(app.store.db.prepare('SELECT count(*) AS count FROM requests').get()!.count, 3);
  result = { scenarioId: 'HMR-MODEL-001', sourceType: 'requirements-derived', fixtureSourceType: 'synthetic', at: new Date().toISOString(), status: 'passed', fromModel: source.model, toModel: target.model, effort: target.effort, fromEngine: codexVersion(source.codexBin), toEngine: codexVersion(target.codexBin), sameThread: true, threadId, contextRecalled: true, toolQueryPassed: true, requestsPreserved: true, transcriptSaved: false, costAmount: null };
} catch (error) {
  result = { status: 'failed', stage, errorCode: engineError(error), fromModel: source.model, toModel: target.model };
  process.exitCode = 1;
} finally { await app?.close(); }
const report = join(base, 'model-switch-checks.json');
writeFileSync(report, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ ...result, report }));
