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
  if (m.type === 'delivery' && m.deliveryId) delivered.add(m.deliveryId);
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
  assert.ok(runs.every(r => r.status === 'succeeded'));
  assert.equal(new Set(runs.map(r => r.threadId)).size, 2);
  const files=runs.map(r=>{const files=app.tasks.publishedArtifacts(r.id);assert.equal(files.length,1);return files[0]!;});
  assert.ok(files.every(file=>delivered.has(file.deliveryId)));
  assert.equal(new Set(files.map(file=>file.path)).size, 2);
  assert.ok(app.tasks.deliveries().every(delivery=>delivery.state==='recorded'));
  const intervals = runs.map(r => {
    const events = app.store.events(r.id);
    return { start: events.find(e => e.type === 'engine_started')!.at, end: r.endedAt! };
  });
  assert.ok(Math.max(...intervals.map(x => x.start)) < Math.min(...intervals.map(x => x.end)), 'real_worker_intervals_must_overlap');
  for (const [i,r] of runs.entries()) {
    const content = readFileSync(files[i]!.path, 'utf8');
    assert.match(content, /待确认/);
    const goal=app.tasks.version(r.taskId,r.version).goal;assert.match(goal,/a\.md|b\.md/);
    assert.match(content, goal.includes('a.md') ? /林青/ : /陈舟/);
  }
  const report = { scenarioId: 'HMR-PARALLEL-001', sourceType: 'requirements-derived', fixtureSourceType: 'synthetic', at: new Date().toISOString(), model: config.model, passed: true, workerIntervalsOverlap: true, runs: runs.map((r,i) => ({ id:r.id, taskId:r.taskId, workerId:r.workerId, threadId:r.threadId, status:r.status, resultId:files[i]!.resultId, sha256:files[i]!.sha256, usage:r.usage ? JSON.parse(r.usage) : null })), mainUsage: JSON.parse(app.store.meta('mainUsage') ?? 'null'), transcriptSaved:false, costAmount:null };
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
