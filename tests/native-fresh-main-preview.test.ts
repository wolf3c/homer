// Requirements-derived synthetic records. No engine, account or channel client.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Store } from '../src/store.js';
import { Files } from '../src/files.js';
import { ConversationHistory } from '../src/web-history.js';
import { WorkerInteractions } from '../src/worker-interactions.js';
import { RecursiveTasks } from '../src/recursive-tasks.js';
import { MainInputs } from '../src/recursive-main-inputs.js';
import { WechatStore } from '../src/channels/wechat-store.js';
import { TelegramStore } from '../src/channels/telegram-store.js';
import { previewFreshMain } from '../scripts/native-fresh-main-preview.js';

function fixture() {
  mkdirSync(resolve('.codex/scratch/native-capabilities-expansion'), { recursive: true });
  const dir = mkdtempSync(resolve('.codex/scratch/native-capabilities-expansion/fresh-main-test-'));
  const path = join(dir, 'source.sqlite'), store = new Store(path);
  new WorkerInteractions(store.db);
  const history = new ConversationHistory(store.db);
  const tasks = new RecursiveTasks(store, new Files(join(dir, 'workspace')));
  tasks.migrate(); new WechatStore(store.db); new TelegramStore(store.db);
  store.setMeta('mainThread', 'synthetic-old-main');
  store.setMeta('mainUsage', JSON.stringify({ totalTokens: 100 }));
  store.setMeta('mainToolsHash', 'synthetic-tools-unchanged');
  const inputs = new MainInputs(tasks, history);
  const request = { requestId: 'synthetic-old-request', text: '请记住：以后报告都用中文。' };
  inputs.accept(request);
  return { dir, path, store, inputs, history, close() { store.close(); rmSync(dir, { recursive: true, force: true }); } };
}
function finish(f: ReturnType<typeof fixture>) {
  const item = f.inputs.claim()!;
  f.inputs.finish(item.messageId, item.revision, 'completed');
  f.history.finish(item.replyId, 'Synthetic completed reply.', 'completed');
  f.store.finishRequest(item.input.requestId, 'Synthetic completed reply.');
}
test('fresh main preview keeps old history, queue and channel rows; only two metadata bindings change', async () => {
  const f = fixture(); try {
    finish(f);
    const before = readFileSync(f.path);
    const r = await previewFreshMain(f.path, join(f.dir, 'preview'));
    assert.equal(r.passed, true);
    assert.deepEqual(r.changedMetadata, ['mainThread', 'mainUsage']);
    assert.equal(r.allBusinessTablesUnchanged, true);
    assert.equal(r.originalThreadHistoryRetained, true);
    assert.equal(r.newThreadHistoryEmpty, true);
    assert.equal(r.noOldInputClaimed, true);
    assert.equal(r.crossThreadRequestRetryRejected, true);
    assert.equal(r.noEngineChannelOrAccount, true);
    assert.equal(r.automaticActivationAllowed, false);
    assert.deepEqual(readFileSync(f.path), before);
  } finally { f.close(); }
});
test('fresh main preview refuses an unclaimed old request instead of deleting or replaying it', async () => {
  const f = fixture(); try {
    await assert.rejects(previewFreshMain(f.path, join(f.dir, 'preview')), /fresh_main_pending_work/);
    assert.equal(f.inputs.list()[0]!.state, 'queued');
    assert.equal(f.store.meta('mainThread'), 'synthetic-old-main');
  } finally { f.close(); }
});
test('fresh main preview refuses an existing Telegram conversation binding instead of rebinding it', async () => {
  const f = fixture(); try {
    finish(f); new TelegramStore(f.store.db).configure('12345', 'synthetic-old-main');
    await assert.rejects(previewFreshMain(f.path, join(f.dir, 'preview')), /fresh_main_telegram_binding_review_required/);
    assert.equal(f.store.meta('mainThread'), 'synthetic-old-main');
  } finally { f.close(); }
});
test('fresh main preview requires a new private or scratch destination and cannot overwrite its input', async () => {
  const f = fixture(); try {
    finish(f);
    await assert.rejects(previewFreshMain(f.path, join(f.dir, 'source.sqlite')), /EEXIST/);
    await assert.rejects(previewFreshMain(f.path, '/tmp/homer-unscoped-preview'), /fresh_main_private_destination_required/);
    assert.equal(f.store.meta('mainThread'), 'synthetic-old-main');
  } finally { f.close(); }
});
