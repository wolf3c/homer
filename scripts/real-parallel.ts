// Explicit real-model regression; uses only public synthetic Markdown.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { Homer } from '../src/service.js';
import { loadConfig } from '../src/config.js';
import { engineError } from '../src/engine.js';

const input = process.argv[2];
if (!input) throw new Error('explicit_config_required');
const base = resolve('.codex/scratch/parallel-regression-' + Date.now());
const config = { ...loadConfig(input), runtime: join(base, 'runtime'), workspace: join(base, 'workspace'), mainTimeoutMs: 120000, timeoutMs: 120000 };
mkdirSync(config.runtime, { recursive: true });
mkdirSync(join(config.workspace, 'materials'), { recursive: true });
writeFileSync(join(config.workspace, 'materials', 'a.md'), '# 合成笔记A\n林青负责初稿，日期待确认。\n');
writeFileSync(join(config.workspace, 'materials', 'b.md'), '# 合成笔记B\n陈舟负责校对，日期待确认。\n');
const delivered = new Set<string>();
const app = new Homer(config, async m => {
  if (m.type === 'delivery' && m.runId) delivered.add(m.runId);
});
let stage = "start";
try {
  await app.start();
  stage = "dispatch";
  await app.message('请分别建立两个独立事项：读取 a.md 整理成 Markdown 行动清单；读取 b.md 整理成另一份 Markdown 行动清单。两个事项互不依赖，请现在都派发，分别保存成果，保留日期待确认。', 'parallel-public-sample');
  stage = "wait";
  await app.idle();
  stage = "assertions";
  const runs = app.store.runs();
  assert.equal(runs.length, 2);
  assert.ok(runs.every(r => r.status === 'succeeded' && r.delivery === 'delivered' && delivered.has(r.id)));
  assert.equal(new Set(runs.map(r => r.threadId)).size, 2);
  assert.equal(new Set(runs.map(r => r.artifact)).size, 2);
  const intervals = runs.map(r => {
    const events = app.store.events(r.id);
    return { start: events.find(e => e.type === 'engine_started')!.at, end: events.find(e => e.type === 'artifact_written')!.at };
  });
  assert.ok(Math.max(...intervals.map(x => x.start)) < Math.min(...intervals.map(x => x.end)), 'real_worker_intervals_must_overlap');
  for (const r of runs) {
    const content = readFileSync(r.artifact!, 'utf8');
    assert.match(content, /待确认/);
    assert.match(content, r.material === 'a.md' ? /林青/ : /陈舟/);
  }
  const report = { scenarioId: 'HMR-PARALLEL-001', sourceType: 'requirements-derived', fixtureSourceType: 'synthetic', at: new Date().toISOString(), model: config.model, passed: true, workerIntervalsOverlap: true, runs: runs.map(r => ({ id:r.id, matterId:r.matterId, threadId:r.threadId, status:r.status, delivery:r.delivery, artifact:r.artifact, usage:r.usage ? JSON.parse(r.usage) : null })), mainUsage: JSON.parse(app.store.meta('mainUsage') ?? 'null'), transcriptSaved:false, costAmount:null };
  writeFileSync(join(base, 'checks.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed:true, model:config.model, workers:runs.length, report:join(base,'checks.json') }));
} catch (error) {
  const report = { passed:false, stage, code:engineError(error), runs:app.store.runs().map(r => ({id:r.id,status:r.status,errorCode:r.errorCode})) };
  writeFileSync(join(base, 'checks.json'), JSON.stringify(report, null, 2));
  console.error(JSON.stringify({ ...report, report:join(base,'checks.json') }));
  process.exitCode = 1;
} finally {
  await app.close();
}
