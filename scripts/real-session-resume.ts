// Explicit real-model continuity check. Uses synthetic content and its own runtime.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { loadConfig } from '../src/config.js';
import { Homer, type Message } from '../src/service.js';
import { engineError } from '../src/engine.js';
const input = process.argv[2];
if (!input) throw new Error('explicit_config_required');
const base = resolve('.codex/scratch/session-resume-' + Date.now());
const config = { ...loadConfig(input), runtime: join(base, 'runtime'), workspace: join(base, 'workspace'), mainTimeoutMs: 60000 };
mkdirSync(config.runtime, {recursive: true});
mkdirSync(config.workspace, {recursive: true});
const token = 'HMR-' + randomUUID();
const replies: string[] = [];
const sink = async (m: Message) => { if (m.type === 'reply') replies.push(m.text); };
let app: Homer | undefined;
let stage = 'first-start';
let result: Record<string, unknown>;
try {
  app = new Homer(config, sink);
  await app.start();
  const thread = app.store.meta('mainThread');
  stage = 'remember';
  await app.message('这是公开合成的重启测试。请记住暗号 ' + token + '，只回复收到。不创建任务。');
  await app.close();
  stage = 'restart';
  app = new Homer(config, sink);
  await app.start();
  assert.equal(app.store.meta('mainThread'), thread);
  stage = 'recall';
  replies.length = 0;
  await app.message('刚才让我记住的暗号是什么？只回复暗号。');
  assert.ok(replies.some(text => text.includes(token)), 'context_recall_failed');
  result = { status: 'passed', model: config.model, effort: config.effort, sameThread: true, recalled: true };
} catch (e) {
  result = { status: 'failed', stage, errorCode: engineError(e), model: config.model };
  process.exitCode = 1;
} finally { await app?.close(); }
writeFileSync(join(base, 'checks.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ ...result, evidence: join(base, 'checks.json') }));
