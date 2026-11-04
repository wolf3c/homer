import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,rmSync,chmodSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {loadPrompts} from '../src/prompts.js';
import {CodexEngine} from '../src/engine.js';
import type {Config} from '../src/config.js';
import {fixture} from './prompt-resources-fixture.js';
test("HMR-PROMPTS-001: maintained product instructions have one file source", () => {
  const prompts = loadPrompts();
  for (const value of Object.values(prompts)) {
    assert.equal(typeof value, "string");
    assert.ok(value.trim().length > 0);
    assert.doesNotMatch(value, /\{\{HOMER_MEMORY_POLICY\}\}/);
  }
  assert.deepEqual(Object.keys(prompts).sort(),["main","worker"]);
  assert.ok(Object.isFrozen(prompts));
});

test('both roles receive the same bounded temporary-resource lifecycle authority', () => {
  const prompts = loadPrompts();
  const boundary = '\n\n## 临时资源生命周期授权\n\n';
  const policy = prompts.main.split(boundary)[1];
  assert.ok(policy);
  assert.equal(prompts.worker.split(boundary)[1], policy);
  for (const clause of ['仅服务本任务', '无独有价值且无其他依赖', '无须逐项再次申请', '用户原有、共享、持久、归属不明及仍有用途的资源不在该许可内', '用户明确限制和宿主审批继续生效']) assert.ok(policy.includes(clause), clause);
  assert.equal(prompts.main.split(boundary).length, 2);
  assert.equal(prompts.worker.split(boundary).length, 2);
});

test("HMR-PROMPTS-001: snapshot stays fixed and the next load sees edits", () => {
  const f = fixture();
  try {
    const first = loadPrompts(f.directory);
    const snapshot = {...first};
    f.write("main", "Synthetic main B"); f.write("worker", "Synthetic worker B");
    assert.deepEqual(first, snapshot);
    assert.ok(first.main.startsWith("Synthetic main A\n\n")); assert.ok(first.worker.startsWith("Synthetic worker A\n\n"));
    const next = loadPrompts(f.directory);
    assert.ok(next.main.startsWith("Synthetic main B\n\n")); assert.ok(next.worker.startsWith("Synthetic worker B\n\n"));
  } finally { f.cleanup(); }
});

test("HMR-PROMPTS-001: missing, empty and unreadable resources fail explicitly without fallback", () => {
  const f = fixture();
  try {
    rmSync(join(f.root, "main.md"));
    assert.throws(() => loadPrompts(f.directory), /^Error: prompt_file_missing:main.md$/);
    f.write("main", " \n\t");
    assert.throws(() => loadPrompts(f.directory), /^Error: prompt_file_empty:main.md$/);
    rmSync(join(f.root, "main.md")); mkdirSync(join(f.root, "main.md"));
    assert.throws(() => loadPrompts(f.directory), /^Error: prompt_file_unreadable:main.md$/);
  } finally { f.cleanup(); }
});

test("HMR-PROMPTS-001: native resume attaches developer instructions on the same thread", async () => {
  const f = fixture();
  const binary = resolve("tests/fixtures/worker-interaction-app-server.mjs"); chmodSync(binary, 0o755);
  const config: Config = { workspace: f.root, runtime: f.root, codexHome: f.root, codexBin: binary, model: "prompt-reload", timeoutMs: 1000, mainTimeoutMs: 1000, stopGraceMs: 50, requiresOpenaiAuth: false };
  const create = (threadId?: string) => new CodexEngine(config, { cwd: f.root, readRoots: [], instructions: loadPrompts(f.directory).main, tools: [], threadId }, async () => ({}));
  const first = create(); let next: CodexEngine | undefined;
  try {
    const thread = await first.start();
    assert.equal((await first.turn("first")).text, loadPrompts(f.directory).main);
    await first.close(); f.write("main", "Synthetic main B"); next = create(thread);
    assert.equal(await next.start(), thread);
    assert.equal((await next.turn("resumed")).text, loadPrompts(f.directory).main);
  } finally { await first.close(); await next?.close(); f.cleanup(); }
});
