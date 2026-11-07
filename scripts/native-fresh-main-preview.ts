// Offline development preview ONLY. Never starts an engine or opens a native HOME.
// The live maintenance owner still needs personal login, idle, shutdown and backup.
import { DatabaseSync, backup } from 'node:sqlite';
import { chmodSync, copyFileSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Store } from '../src/store.js';
import { Files } from '../src/files.js';
import { ConversationHistory } from '../src/web-history.js';
import { RecursiveTasks } from '../src/recursive-tasks.js';
import { MainInputs } from '../src/recursive-main-inputs.js';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const identifier = (value: string) => '"' + value.replaceAll('"', '""') + '"';
const within = (root: string, path: string) => { const r = relative(root, path); return !!r && !r.startsWith('..') && !isAbsolute(r); };
function capture(db: DatabaseSync) {
  return {
    schema: hash(db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all()),
    tables: Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'meta' ORDER BY name").all().map(row => {
      const name = String(row.name), rows = db.prepare('SELECT * FROM ' + identifier(name) + ' ORDER BY rowid').all();
      return [name, { count: rows.length, hash: hash(rows) }];
    })),
    metadata: db.prepare('SELECT key,value FROM meta ORDER BY key').all(),
  };
}
export function freshMainReadiness(db: DatabaseSync) {
  const checks: Record<string, [string, string]> = {
    requests: ['requests', "state!='completed'"],
    runs: ['runs', "status IN ('queued','running') OR phase IN ('uncertain','stopping')"],
    tasks: ['tasks', "state!='settled' OR controlState='stopping'"],
    receipts: ['agent_receipts', "state IN ('pending','offered','received','uncertain','blocked')"],
    interactions: ['worker_interactions', "state IN ('pending_main','pending_user') OR (state IN ('approved','denied','answered') AND deliveredAt IS NULL)"],
    operations: ['operations', "state IN ('accepted','dispatching','uncertain')"],
    conversation: ['conversation_messages', "status IN ('queued','processing','running')"],
  };
  const pending = Object.fromEntries(Object.entries(checks).map(([name, [table, where]]) => [name, Number(db.prepare('SELECT count(*) n FROM ' + identifier(table) + ' WHERE ' + where).get()!.n)]));
  return { pending, ready: !Object.values(pending).some(Boolean) };
}
export async function previewFreshMain(snapshot: string, directory: string) {
  snapshot = resolve(snapshot); directory = resolve(directory);
  const allowed = [resolve('.codex/private'), resolve('.codex/scratch')];
  if (!allowed.some(root => within(root, directory))) throw Error('fresh_main_private_destination_required');
  mkdirSync(directory, { mode: 0o700 }); chmodSync(directory, 0o700);
  if (realpathSync(directory) !== directory) throw Error('fresh_main_symlink_destination_denied');
  const before = join(directory, 'before.sqlite'), candidate = join(directory, 'candidate.sqlite');
  const source = new DatabaseSync(snapshot, { readOnly: true });
  try { await backup(source, before); } finally { source.close(); }
  chmodSync(before, 0o600); copyFileSync(before, candidate); chmodSync(candidate, 0o600);
  const baseline = new DatabaseSync(before, { readOnly: true });
  const prior = capture(baseline), readiness = freshMainReadiness(baseline);
  const oldThread = baseline.prepare("SELECT value FROM meta WHERE key='mainThread'").get()?.value;
  baseline.close();
  if (!oldThread) throw Error('fresh_main_original_binding_required');
  if (!readiness.ready) throw Error('fresh_main_pending_work');
  const store = new Store(candidate);
  let receipt;
  try {
    const history = new ConversationHistory(store.db);
    const tasks = new RecursiveTasks(store, new Files(join(directory, 'empty-workspace')));
    tasks.migrate();
    const inputs = new MainInputs(tasks, history);
    const oldHistoryCount = history.list(String(oldThread)).length, oldQueueCount = inputs.list().length;
    // Exactly the proposed live metadata change, ONLY in this new offline copy.
    store.transaction(() => store.db.prepare("DELETE FROM meta WHERE key IN ('mainThread','mainUsage')").run());
    const bindingRemovedForNativeThreadStart = store.meta('mainThread') === undefined;
    // A clearly synthetic placeholder, not an RPC or actual Codex thread.
    store.setMeta('mainThread', 'synthetic-fresh-main-preview');
    inputs.reconcile(); history.reconcile();
    const noOldInputClaimed = inputs.claim() === undefined;
    let crossThreadRequestRetryRejected = oldQueueCount === 0;
    const oldInput = inputs.list()[0]?.input;
    if (oldInput) {
      try { inputs.accept(oldInput); }
      catch (error) { crossThreadRequestRetryRejected = error instanceof Error && error.message === 'request_id_conflict'; }
    }
    const after = capture(store.db);
    const changedMetadata = [...new Set([...prior.metadata, ...after.metadata].map(r => String(r.key)))].filter(key => prior.metadata.find(r => r.key === key)?.value !== after.metadata.find(r => r.key === key)?.value).sort();
    const allBusinessTablesUnchanged = hash(prior.tables) === hash(after.tables);
    const schemaUnchanged = prior.schema === after.schema;
    const newThreadHistoryEmpty = history.list('synthetic-fresh-main-preview').length === 0;
    const originalThreadHistoryRetained = history.list(String(oldThread)).length === oldHistoryCount;
    const originalQueueRowsRetained = inputs.list().length === oldQueueCount;
    const integrity = store.db.prepare('PRAGMA quick_check').get()?.quick_check;
    const foreignKeyViolations = store.db.prepare('PRAGMA foreign_key_check').all().length;
    receipt = { at: new Date().toISOString(), offline: true, noEngineChannelOrAccount: true, noNativeHomeOpened: true, actualThreadCreated: false, automaticActivationAllowed: false,
      readiness, changedMetadata, tablesCompared: Object.keys(prior.tables).length, allBusinessTablesUnchanged, schemaUnchanged, bindingRemovedForNativeThreadStart,
      originalThreadHistoryRetained, originalQueueRowsRetained, newThreadHistoryEmpty, noOldInputClaimed, crossThreadRequestRetryRejected,
      oldHistoryCount, oldQueueCount, integrity, foreignKeyViolations,
      passed: schemaUnchanged && allBusinessTablesUnchanged && hash(changedMetadata) === hash(['mainThread', 'mainUsage']) && bindingRemovedForNativeThreadStart && originalThreadHistoryRetained && originalQueueRowsRetained && newThreadHistoryEmpty && noOldInputClaimed && crossThreadRequestRetryRejected && integrity === 'ok' && foreignKeyViolations === 0 };
  } finally { store.close(); }
  const rollback = join(directory, 'rollback-offline.sqlite'); copyFileSync(before, rollback); chmodSync(rollback, 0o600);
  const result = { ...receipt, rollbackCopyBytesMatch: readFileSync(before).equals(readFileSync(rollback)) };
  writeFileSync(join(directory, 'fresh-main-preview-receipt.json'), JSON.stringify(result, null, 2), { flag: 'wx', mode: 0o600 });
  return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [snapshot, directory] = process.argv.slice(2);
    if (!snapshot || !directory) throw Error('fresh_main_snapshot_and_new_directory_required');
    const receipt = await previewFreshMain(snapshot, directory);
    process.stdout.write(JSON.stringify(receipt) + '\n'); if (!receipt.passed) process.exitCode = 1;
  } catch (error) {
    // Native/runtime/private contents are never interpolated into diagnostics.
    const code = error instanceof Error && /^[a-z][a-z0-9_]{1,90}$/.test(error.message) ? error.message : 'fresh_main_preview_failed';
    console.error('未完成：' + code + '。日常配置及数据库未修改。'); process.exitCode = 1;
  }
}
