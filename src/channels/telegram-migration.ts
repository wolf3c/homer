import { backup, type DatabaseSync } from "node:sqlite";
import { chmod, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

// Run once before mounting the channel, while the sole host has not started
// engines/ingress. Back up SQLite consistently (including committed WAL), never
// copy live main/WAL files separately or let a failed backup trigger migration.
export async function prepareTelegramMigration(db: DatabaseSync, runtime: string) {
  const has = (name: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
  const columns = (table: string) => (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(row => row.name);
  const current = ["tg_schema", "tg_connections", "tg_credentials", "tg_pairs", "tg_inbox", "tg_routes", "tg_acceptances", "tg_outbox", "tg_drafts", "tg_interactions", "tg_buttons", "tg_answers"].every(has) &&
    columns("tg_connections").includes("lastUpdate") && columns("tg_outbox").includes("groupId");
  if (has("tg_schema") && db.prepare("SELECT version FROM tg_schema").get()?.version !== 1) throw new Error("telegram_schema_incompatible");
  if (current) return;
  const directory = join(runtime, "backups");
  const destination = join(directory, "telegram-before-schema-" + Date.now() + "-" + randomUUID() + ".sqlite");
  try { await mkdir(directory, { recursive: true, mode: 0o700 }); await backup(db, destination); await chmod(destination, 0o600); }
  catch {
    await rm(destination, { force: true }).catch(() => {});
    throw new Error("telegram_migration_backup_failed");
  }
  // The destination is deliberately not logged or exposed through web state.
}
