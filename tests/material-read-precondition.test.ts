// Synthetic contracts and local files only; no model, account or external channel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, unlinkSync, symlinkSync, linkSync } from 'node:fs';
import { join } from 'node:path';
import { Homer } from '../src/service.js';
import {WorkerProgressStore} from '../src/worker-progress.js';
import { MediaStore } from '../src/media-store.js';
import type { Actor, Contract } from '../src/recursive-tasks.js';
import { fixture, contract, main, delegate, running, complete, accept } from './recursive-fixture.js';

mkdirSync('.codex/scratch/recursive-agent-implementation', { recursive: true });
type InputKind = Contract['inputs'][number]['type'];
function setup(kinds: InputKind[] = [], resultKind: Contract['resultKind'] = 'markdown') {
  const f = fixture();
  const media = new MediaStore(f.store.db, join(f.dir, 'media'));
  const ref = media.intent('user-synthetic', 'synthetic-binding', 'file', 'source.txt');
  media.ready(ref, media.claim(ref)!, Buffer.from('Synthetic attachment'), 'text/plain');
  writeFileSync(join(f.files.materials, 'sample.md'), '# Synthetic material');
  writeFileSync(join(f.files.materials, 'changed.md'), '# Changed material');
  let resultId: string | undefined, producerId: string | undefined;
  if (kinds.includes('result')) {
    const producer = delegate(f, 'producer'); producerId = producer.taskId;
    const producerActor = running(f, producer.taskId);
    resultId = complete(f, producerActor, producer.taskId).resultId;
    f.tasks.endSegment(producerActor.runId!, producerActor.epoch!, {status:'completed',text:'Synthetic final result'}, true);
    accept(f, producer.taskId, resultId);
  }
  const inputs = kinds.map(type => ({ type, id: type === 'material' ? 'sample.md' : type === 'result' ? resultId! : ref.assetId + '@' + ref.revision }));
  const c: Contract = { ...contract(resultKind), goal: 'Generate a synthetic report from the task instructions', inputs };
  const root = f.tasks.createRoot(main, { operationId: 'read-precondition', title: 'Synthetic report', executorKind: 'worker', contract: c,
    authority: { sourceRequestId: 'user-synthetic', description: 'Synthetic report only', materials: ['sample.md', 'changed.md'], resultIds: resultId ? [resultId] : [], attachments: [ref.assetId + '@1', ref.assetId + '@2'], collaborateTaskIds: producerId ? [producerId] : [], maxActiveMs: 10000 } });
  const actor = running(f, root.taskId), run = f.tasks.run(actor.runId!);
  // Use the actual worker read/stage dispatchers, with only unrelated clocks and
  // native-memory callbacks stubbed. RecursiveTasks/Files/MediaStore remain real.
  const host = Object.create(Homer.prototype) as any;
  Object.assign(host, { tasks: f.tasks, files: f.files, store: f.store, media, workerProgress: new WorkerProgressStore(), closing: false,
    accountClocks() {}, workerActor: () => actor, memory: { validateRun() {} }, registerChannelCapabilities() {} });
  const slot = { id: run.id, epoch: run.epoch };
  const read = () => host.workerTool(slot, { tool: 'read_material', arguments: {}, callId: 'read', threadId: actor.threadId, turnId: actor.turnId });
  const markdown = (operationId = 'write', worker: Actor = actor) => f.tasks.writeMarkdown(worker, { operationId, filename: 'report.md', content: '# Synthetic report' });
  const events = () => Number(f.store.db.prepare("SELECT count(*) n FROM events WHERE runId=? AND type='material_read'").get(run.id)!.n);
  const checkpoint = () => JSON.parse(f.tasks.run(run.id).checkpointJson ?? '{}');
  function steer(nextInputs: Contract['inputs']) {
    const task = f.tasks.task(root.taskId);
    const change = f.tasks.update(main, { operationId: 'steer-' + task.headVersion, taskId: task.id, version: task.headVersion, expectedTaskRevision: task.revision,
      mode: 'steer', contract: { ...c, inputs: nextInputs }, children: [], queuedDisposition: [] });
    return () => {
      f.tasks.inspect(actor, { taskId: task.id });
      f.tasks.adopt(actor, { operationId: 'adopt-' + change.version, taskId: task.id, version: change.version, expectedTaskRevision: f.tasks.task(task.id).revision, contractHash: change.contractHash });
    };
  }
  return { f, media, ref, root, actor, run, slot, host, read, markdown, checkpoint, events, steer };
}

test('empty inputs allow Markdown staging without a read or a fabricated material-read fact', () => {
  const s = setup(); try {
    const staged = s.markdown();
    assert.equal(readFileSync(staged.path, 'utf8'), '# Synthetic report');
    assert.equal(staged.state, 'staged');
    assert.equal(s.checkpoint().materialRead, undefined);
    assert.equal(s.events(), 0);
    assert.deepEqual(s.markdown(), staged);
    assert.throws(() => s.markdown('second-artifact'), /artifact_filename_conflict/);
    assert.throws(() => s.f.tasks.writeMarkdown(s.actor, { operationId: 'write', filename: 'report.md', content: 'changed' }), /operation_payload_conflict/);
    assert.equal(s.f.tasks.publishedArtifact(s.run.id), undefined);
  } finally { s.f.close(); }
});

for (const entry of ['binary', 'workspace'] as const) test('empty inputs allow ' + entry + ' staging without read_material', async () => {
  const s = setup([], 'file'); try {
    const bytes = Buffer.from('%PDF-1.4\nSynthetic');
    const dir = s.f.files.prepareRun(s.run.matterId, s.run.id);
    writeFileSync(join(dir, 'source.pdf'), bytes);
    const args = entry === 'binary' ? { operationId: 'binary', filename: 'report.pdf', dataBase64: bytes.toString('base64'), assetId: null, revision: null } : { operationId: 'workspace', path: 'source.pdf', filename: 'report.pdf' };
    const tool = entry === 'binary' ? 'stage_file_result' : 'stage_workspace_file';
    const staged = await s.host.workerMediaTool(s.slot, tool, args);
    assert.deepEqual(readFileSync(staged.path), bytes);
    assert.deepEqual(await s.host.workerMediaTool(s.slot, tool, args), staged);
    assert.equal(s.checkpoint().materialRead, undefined);
    assert.equal(s.events(), 0);
    const second = s.markdown('another-artifact');
    assert.notEqual(second.resultId, staged.resultId);
    assert.equal(readFileSync(second.path, 'utf8'), '# Synthetic report');
  } finally { s.f.close(); }
});

test('explicit empty read_material remains callable without claiming actual material was read', async () => {
  const s = setup(); try {
    assert.deepEqual(await s.read(), { materials: [], results: [], attachments: [] });
    assert.equal(s.checkpoint().materialRead, undefined);
    assert.equal(s.events(), 0);
    assert.equal(s.markdown().state, 'staged');
  } finally { s.f.close(); }
});

for (const kind of ['material', 'result', 'attachment'] as const) test(kind + ' input must be read successfully before any file entry stages', async () => {
  const s = setup([kind]); try {
    assert.throws(() => s.markdown(), /read_material_first/);
    assert.throws(() => s.f.tasks.writeFile(s.actor, { operationId: 'binary', filename: 'report.pdf', bytes: Buffer.from('%PDF-1.4\n') }), /read_material_first/);
    const dir = s.f.files.prepareRun(s.run.matterId, s.run.id);
    writeFileSync(join(dir, 'source.pdf'), '%PDF-1.4\n');
    await assert.rejects(() => s.host.workerMediaTool(s.slot, 'stage_workspace_file', { operationId: 'workspace', path: 'source.pdf', filename: 'report.pdf' }), /read_material_first/);
    const read = await s.read();
    if (kind === 'material') assert.equal(read.content, '# Synthetic material');
    if (kind === 'result') assert.equal(read.results.length, 1);
    if (kind === 'attachment') {assert.equal(read.attachments[0].assetId, s.ref.assetId);assert.deepEqual(read.attachments[0].reference,{type:'attachment',id:s.ref.assetId+'@1'});}
    assert.equal(s.checkpoint().materialRead, true);
    assert.equal(s.events(), 1);
    assert.equal(s.markdown().state, 'staged');
  } finally { s.f.close(); }
});

test('partial read failure leaves no success marker or event, and can retry after repair', async () => {
  const s = setup(['material', 'result', 'attachment']); try {
    unlinkSync(join(s.f.dir, 'media', s.ref.assetId));
    await assert.rejects(s.read, /ENOENT/);
    assert.equal(s.checkpoint().materialRead, undefined);
    assert.equal(s.events(), 0);
    assert.throws(() => s.markdown(), /read_material_first/);
    writeFileSync(join(s.f.dir, 'media', s.ref.assetId), 'Synthetic attachment');
    await s.read();
    assert.equal(s.markdown().state, 'staged');
  } finally { s.f.close(); }
});

for (const kind of ['material', 'result', 'attachment'] as const) for (const tool of ['stage_file_result', 'stage_workspace_file']) test(kind + ' read unlocks ' + tool, async () => {
  const s = setup([kind], 'file'); try {
    await s.read();
    const bytes = Buffer.from('%PDF-1.4\nSynthetic');
    const dir = s.f.files.prepareRun(s.run.matterId, s.run.id);
    writeFileSync(join(dir, 'source.pdf'), bytes);
    const args = tool === 'stage_file_result' ? { operationId: 'stage', filename: 'report.pdf', dataBase64: bytes.toString('base64'), assetId: null, revision: null } : { operationId: 'stage', filename: 'report.pdf', path: 'source.pdf' };
    const staged = await s.host.workerMediaTool(s.slot, tool, args);
    assert.deepEqual(readFileSync(staged.path), bytes);
  } finally { s.f.close(); }
});

test('empty inputs do not bypass workspace paths, symlinks or hard links', async () => {
  const s = setup([], 'file'); try {
    const dir = s.f.files.prepareRun(s.run.matterId, s.run.id);
    const outside = join(s.f.dir, 'outside.pdf');
    writeFileSync(outside, '%PDF-1.4\n');
    const stage = (path: string) => s.host.workerMediaTool(s.slot, 'stage_workspace_file', { operationId: 'stage', path, filename: 'report.pdf' });
    for (const path of ['../outside.pdf', outside]) await assert.rejects(() => stage(path), /path_denied/);
    symlinkSync(outside, join(dir, 'linked.pdf'));
    await assert.rejects(() => stage('linked.pdf'), /symlink_denied/);
    linkSync(outside, join(dir, 'hardlinked.pdf'));
    await assert.rejects(() => stage('hardlinked.pdf'), /file_type_or_size_denied/);
    assert.equal(s.checkpoint().materialRead, undefined);
    assert.equal(readFileSync(outside, 'utf8'), '%PDF-1.4\n');
  } finally { s.f.close(); }
});

for (const failure of ['missing-material', 'wrong-source', 'wrong-revision', 'missing-result'] as const) test('read failure preserves the gate: ' + failure, async () => {
  const s = setup(failure === 'missing-material' ? ['material'] : failure === 'missing-result' ? ['result'] : ['attachment']); try {
    if (failure === 'missing-material') unlinkSync(join(s.f.files.materials, 'sample.md'));
    else if (failure === 'wrong-source') s.f.store.db.prepare('UPDATE media_assets SET requestId=? WHERE id=?').run('other-synthetic-source', s.ref.assetId);
    else if (failure === 'wrong-revision') s.f.store.db.prepare('UPDATE media_assets SET revision=2 WHERE id=?').run(s.ref.assetId);
    else {
      const input = s.f.tasks.contract(s.root.taskId, 1).inputs[0]!;
      // Remove this synthetic audit reference without disabling foreign-key enforcement.
      s.f.store.db.prepare('UPDATE agent_receipts SET resultRef=NULL WHERE resultRef=?').run(input.id);
      s.f.store.db.prepare('DELETE FROM results WHERE id=?').run(input.id);
    }
    await assert.rejects(s.read, failure === 'wrong-source' ? /media_scope_denied/ : failure === 'wrong-revision' ? /media_asset_not_found/ : failure === 'missing-result' ? /result_not_found/ : /material_missing/);
    assert.equal(s.checkpoint().materialRead, undefined);
    assert.equal(s.events(), 0);
    assert.throws(() => s.markdown(), /read_material_first/);
  } finally { s.f.close(); }
});

test('adopting a new attachment revision requires its own successful read', async () => {
  const s = setup(['attachment']); try {
    await s.read();
    s.steer([{ type: 'attachment', id: s.ref.assetId + '@2' }])();
    assert.throws(() => s.markdown(), /read_material_first/);
    await assert.rejects(s.read, /media_asset_not_found/);
    assert.equal(s.checkpoint().materialRead, undefined);
    assert.equal(s.events(), 1);
    s.f.store.db.prepare('UPDATE media_assets SET revision=2 WHERE id=?').run(s.ref.assetId);
    assert.equal((await s.read()).attachments[0].revision, 2);
    assert.equal(s.markdown().state, 'staged');
  } finally { s.f.close(); }
});

for (const hasInputs of [false, true]) test('queued contracts do not change the active version read requirement: inputs=' + hasInputs, () => {
  const s = setup(hasInputs ? ['material'] : []); try {
    const task = s.f.tasks.task(s.root.taskId);
    s.f.tasks.update(main, { operationId: 'queue', taskId: task.id, version: 1, expectedTaskRevision: task.revision, mode: 'queue', contract: { ...contract('markdown'), inputs: hasInputs ? [] : [{ type: 'material', id: 'changed.md' }] }, children: [], queuedDisposition: [] });
    assert.equal(s.f.tasks.run(s.run.id).contractVersion, 1);
    if (hasInputs) assert.throws(() => s.markdown(), /read_material_first/);
    else assert.equal(s.markdown().state, 'staged');
  } finally { s.f.close(); }
});

for (const initial of [[], ['material']] as InputKind[][]) test('adopted new material cannot reuse a previous read: initially ' + initial.join(','), async () => {
  const s = setup(initial); try {
    await s.read();
    const adopt = s.steer([{ type: 'material', id: 'changed.md' }]);
    assert.equal(s.f.tasks.run(s.run.id).contractVersion, 1);
    assert.throws(() => s.markdown('before-adopt'), /run_adopt_required/);
    await assert.rejects(s.read, /run_adopt_required/);
    adopt();
    assert.equal(s.f.tasks.run(s.run.id).contractVersion, 2);
    assert.throws(() => s.markdown('after-adopt'), /read_material_first/);
    assert.equal((await s.read()).content, '# Changed material');
    const staged = s.markdown('after-read');
    assert.equal(s.f.tasks.inspect(s.actor, { resultId: staged.resultId }).actualResult!.version, 2);
  } finally { s.f.close(); }
});

test('adopting an empty contract permits staging and preserves other checkpoint state', async () => {
  const s = setup(['material']); try {
    await s.read();
    const before = s.checkpoint();
    s.steer([])();
    const { materialRead: _read, ...rest } = before;
    assert.deepEqual(s.checkpoint(), rest);
    assert.equal(s.markdown().state, 'staged');
    assert.equal(s.events(), 1);
  } finally { s.f.close(); }
});

test('empty contracts still reject new writes from stale epochs and replaced runs', () => {
  const s = setup(); try {
    assert.throws(() => s.markdown('stale-epoch', { ...s.actor, epoch: s.actor.epoch! + 1 }), /run_epoch_stale/);
    const task = s.f.tasks.task(s.root.taskId);
    s.f.tasks.update(main, { operationId: 'replace', taskId: task.id, version: 1, expectedTaskRevision: task.revision, mode: 'stop_replace', contract: { ...contract('markdown'), inputs: [] }, children: [], queuedDisposition: [] });
    assert.throws(() => s.markdown('stale-run'), /run_epoch_stale/);
  } finally { s.f.close(); }
});

test('instructions remain goal text; unsupported input types cannot bypass authority validation', () => {
  const s = setup(); try {
    const task = s.f.tasks.task(s.root.taskId);
    assert.throws(() => s.f.tasks.update(main, { operationId: 'invalid-input', taskId: task.id, version: 1, expectedTaskRevision: task.revision, mode: 'steer', contract: { ...contract('markdown'), inputs: [{ type: 'instruction', id: 'synthetic' }] } as unknown as Contract, children: [], queuedDisposition: [] }), /task_authority_input_denied/);
    assert.equal(s.markdown().state, 'staged');
  } finally { s.f.close(); }
});


test('multiple files share the adopted material gate and a new version clears it', async () => {
  const s = setup(['material']); try {
    await s.read();
    s.steer([{ type: 'material', id: 'changed.md' }])();
    assert.equal(s.checkpoint().materialRead, undefined);
    for (const filename of ['first.md', 'second.md']) {
      assert.throws(() => s.f.tasks.writeMarkdown(s.actor, { operationId: filename, filename, content: '# Report' }), /read_material_first/);
    }
    await s.read();
    const files = ['first.md', 'second.md'].map(filename => s.f.tasks.writeMarkdown(s.actor, { operationId: filename, filename, content: '# Report' }));
    assert.notEqual(files[0]!.resultId, files[1]!.resultId);
    for (const file of files) assert.equal(s.f.tasks.inspect(s.actor, { resultId: file.resultId }).actualResult!.version, 2);
  } finally { s.f.close(); }
});

test('historical malformed revisions are rejected without coercion or marking material read',async()=>{
 const s=setup(['attachment']);try{
  s.f.store.db.prepare('UPDATE task_versions SET inputsJson=? WHERE taskId=? AND version=1').run(JSON.stringify([{type:'attachment',id:s.ref.assetId+'@1e0'}]),s.root.taskId);
  await assert.rejects(s.read,/task_attachment_reference_invalid/);assert.equal(s.events(),0);assert.equal(s.checkpoint().materialRead,undefined);
 }finally{s.f.close();}
});

test('revocation after creation rejects a fresh read while retaining task, run and creation receipt',async()=>{
 const s=setup(['attachment']);try{
  const task=s.f.tasks.task(s.root.taskId),receipt=s.f.store.db.prepare("SELECT responseJson FROM operations WHERE operationId='read-precondition'").get()!.responseJson;
  s.media.revoke('user-synthetic');await assert.rejects(s.read,/media_scope_denied/);
  assert.deepEqual(s.f.tasks.task(s.root.taskId),task);assert.equal(s.f.tasks.run(s.run.id).status,'running');
  assert.equal(s.f.store.db.prepare("SELECT responseJson FROM operations WHERE operationId='read-precondition'").get()!.responseJson,receipt);
  assert.equal(s.events(),0);assert.equal(s.checkpoint().materialRead,undefined);
 }finally{s.f.close();}
});
