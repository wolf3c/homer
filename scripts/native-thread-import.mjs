// File-only selected-thread import. The maintenance owner must first confirm
// personal native login, natural idle, normal shutdown, backups and lock release.
// No engine, auth-file reader, global config loader or index writer is created.
import { readFileSync, existsSync, realpathSync, lstatSync, mkdirSync, writeFileSync, openSync, closeSync, fsyncSync, unlinkSync } from 'node:fs';
import { resolve, join, dirname, relative, isAbsolute, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const inside = (root, path) => { const rel = relative(root, path); return !!rel && !rel.startsWith('..') && !isAbsolute(rel); };
function safeDirectories(home, path) {
  let current = home;
  for (const part of relative(home, path).split('/').filter(Boolean)) {
    current = join(current, part);
    if (!existsSync(current)) mkdirSync(current, { mode: 0o700 });
    if (!lstatSync(current).isDirectory() || lstatSync(current).isSymbolicLink() || realpathSync(current) !== current)
      throw Error('selected_rollout_destination_scope');
  }
}
export function importSelectedRollout({ sourceHome, destinationHome, threadId, expectedToolsHash, backupDirectory }) {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(threadId) || !/^[0-9a-f]{64}$/.test(expectedToolsHash))
    throw Error('selected_rollout_identity_invalid');
  const source = realpathSync(sourceHome), destinationRoot = resolve(destinationHome), backupRoot = realpathSync(backupDirectory);
  if (realpathSync(destinationRoot) !== destinationRoot || source === destinationRoot || inside(source, destinationRoot) || inside(destinationRoot, source))
    throw Error('selected_rollout_home_not_isolated');
  if (![resolve('.codex/private'), resolve('.codex/scratch')].some(root => inside(root, backupRoot)))
    throw Error('selected_rollout_private_backup_required');
  const index = new DatabaseSync(join(source, 'state_5.sqlite'), { readOnly: true });
  let selected;
  try { selected = index.prepare('SELECT rollout_path FROM threads WHERE id=?').get(threadId)?.rollout_path; }
  finally { index.close(); }
  if (typeof selected !== 'string' || !inside(join(source, 'sessions'), resolve(selected)) || !basename(selected).endsWith('-' + threadId + '.jsonl') || !existsSync(selected) || realpathSync(selected) !== resolve(selected) || !lstatSync(selected).isFile())
    throw Error('selected_rollout_source_scope');
  const destination = join(destinationRoot, relative(source, selected));
  if (existsSync(destination)) throw Error('selected_rollout_destination_exists');
  const bytes = readFileSync(selected), sourceHash = sha(bytes), newline = bytes.indexOf(10);
  let meta;
  try { meta = JSON.parse(bytes.subarray(0, newline < 0 ? bytes.length : newline).toString('utf8')); }
  catch { throw Error('selected_rollout_metadata_invalid'); }
  if (meta.type !== 'session_meta' || meta.payload?.id !== threadId) throw Error('selected_rollout_thread_mismatch');
  const toolsHash = sha(JSON.stringify(meta.payload.dynamic_tools));
  if (toolsHash !== expectedToolsHash) throw Error('selected_rollout_tools_mismatch');
  const backup = join(backupRoot, 'selected-rollout.before.jsonl');
  writeFileSync(backup, bytes, { flag: 'wx', mode: 0o600 });
  if (sha(readFileSync(selected)) !== sourceHash) throw Error('selected_rollout_source_changed');
  safeDirectories(destinationRoot, dirname(destination));
  const descriptor = openSync(destination, 'wx', 0o600);
  try { writeFileSync(descriptor, bytes); fsyncSync(descriptor); }
  catch (error) { closeSync(descriptor); unlinkSync(destination); throw error; }
  closeSync(descriptor);
  const destinationHash = sha(readFileSync(destination));
  if (destinationHash !== sourceHash || sha(readFileSync(selected)) !== sourceHash) throw Error('selected_rollout_copy_changed');
  return { threadId, toolsHash, source: selected, destination, backup, sourceHash, destinationHash, bytes: bytes.length, selectedFilesCopied: 1, authOrOtherSessionsCopied: false, sourceUnchanged: true, nativeIndexNotCopied: true };
}
