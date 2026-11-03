import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { prepareTelegramMigration } from "../src/channels/telegram-migration.js";
import { TelegramStore } from "../src/channels/telegram-store.js";
import { TelegramSettings } from "../src/channels/telegram-secrets.js";

test("TG migration backs up committed WAL consistently with private permissions, skips current schema and rejects unknown version", async t => {
  const root = mkdtempSync(resolve(".codex/scratch/telegram-plan/migration-fixture-"));
  const db = new DatabaseSync(join(root, "synthetic.sqlite"));
  t.after(() => { db.close(); rmSync(root, { recursive: true, force: true }); });
  db.exec("PRAGMA journal_mode=WAL;CREATE TABLE synthetic_history(text TEXT); INSERT INTO synthetic_history VALUES('合成持久正文');");
  await prepareTelegramMigration(db, root);
  const filename = readdirSync(join(root, "backups"))[0]!;
  assert.equal(statSync(join(root, "backups", filename)).mode & 0o777, 0o600);
  const backup = new DatabaseSync(join(root, "backups", filename));
  try { assert.equal(backup.prepare("SELECT text FROM synthetic_history").get()?.text, "合成持久正文"); assert.equal(backup.prepare("SELECT 1 FROM sqlite_master WHERE name='tg_schema'").get(), undefined); }
  finally { backup.close(); }
  const store = new TelegramStore(db);
  new TelegramSettings(store, { async get() { throw new Error("not_expected"); }, async set() {}, async delete() {} }, "original-main");
  await prepareTelegramMigration(db, root); assert.equal(readdirSync(join(root, "backups")).length, 1);
  db.exec("UPDATE tg_schema SET version=999");
  await assert.rejects(prepareTelegramMigration(db, root), /schema_incompatible/);
  assert.equal(db.prepare("SELECT text FROM synthetic_history").get()?.text, "合成持久正文");
});

test("TG failed backup fails closed without creating channel schema or deleting original data", async t => {
  const root = mkdtempSync(resolve(".codex/scratch/telegram-plan/migration-failure-"));
  const db = new DatabaseSync(":memory:");
  t.after(() => { db.close(); rmSync(root, { recursive: true, force: true }); });
  db.exec("CREATE TABLE synthetic_history(text TEXT); INSERT INTO synthetic_history VALUES('合成正文');");
  writeFileSync(join(root, "backups"), "合成阻挡文件");
  await assert.rejects(prepareTelegramMigration(db, root), /migration_backup_failed/);
  assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name='tg_schema'").get(), undefined);
  assert.equal(db.prepare("SELECT text FROM synthetic_history").get()?.text, "合成正文");
});
