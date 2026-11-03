import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { Store } from "../src/store.js";
import { ConversationHistory } from "../src/web-history.js";
import { TelegramStore } from "../src/channels/telegram-store.js";

// Synthetic private business data. Real user runtime/DB is never opened.
test("TG additive migration and disk restart retain original core/history and freeze crash windows", t => {
  const root = mkdtempSync(resolve(".codex/scratch/telegram-plan/persistence-fixture-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "synthetic.sqlite"), backup = join(root, "pre-telegram.sqlite");
  let core = new Store(path);
  core.setMeta("mainThread", "original-main");
  let history = new ConversationHistory(core.db);
  const previous = history.accept("original-main", { requestId: "pre-telegram", text: "合成旧问题" });
  history.finish(previous.replyId, "合成旧回答", "completed");
  core.startRequest("pre-telegram", "synthetic-hash"); core.finishRequest("pre-telegram", "合成旧回答");
  const before = JSON.stringify(history.list("original-main"));
  core.close(); copyFileSync(path, backup); // Offline copy of a cleanly closed fixture DB.
  core = new Store(path);
  let tg = new TelegramStore(core.db);
  tg.configure("123456", "original-main"); tg.enabled("123456", true);
  const code = tg.pairing("123456"); tg.proposePair("123456", code, "789123", "789123"); tg.approvePair("123456", code, "789123", "789123");
  tg.ingest("123456", [{ update_id: 99, message: { message_id: 123, date: Date.now() / 1000, chat: { id: 789123, type: "private" }, from: { id: 789123 }, text: "合成新请求" } }]);
  const origin = tg.route("tg:123456:99")!;
  const draft = tg.createDraft({ id: "g-before-restart", messageId: "main-message", threadId: "original-main", turnId: "turn-before-restart", sourceRequestId: "tg:123456:99", visibility: "main_user" }, origin, "rich");
  tg.inboxState("tg:123456:99", "dispatching");
  tg.enqueue("result-before-crash", origin, "text", { text: "合成结果" }); tg.outboxState("result-before-crash", "sending");
  core.close(); core = new Store(path); tg = new TelegramStore(core.db); tg.reconcile("123456");
  history = new ConversationHistory(core.db);
  assert.equal(core.meta("mainThread"), "original-main"); assert.equal(JSON.stringify(history.list("original-main")), before);
  assert.equal(core.request("pre-telegram")?.response, "合成旧回答");
  assert.equal(tg.connection("123456")?.offset, 100); assert.equal(tg.connection("123456")?.ownerId, "789123");
  assert.deepEqual(tg.route("tg:123456:99"), origin);
  assert.equal(tg.connection("123456")?.nextDraft, draft.draftId + 1);
  assert.equal(core.db.prepare("SELECT state FROM tg_outbox").get()?.state, "uncertain");
  assert.equal(core.db.prepare("SELECT state FROM tg_inbox").get()?.state, "uncertain");
  assert.equal(tg.draft("g-before-restart")?.state, "closed");
  core.close();
  // Reverting a migration means stopping, then restoring the consistent fixture backup.
  copyFileSync(backup, path); core = new Store(path); history = new ConversationHistory(core.db);
  assert.equal(core.meta("mainThread"), "original-main"); assert.equal(JSON.stringify(history.list("original-main")), before);
  assert.equal(core.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='tg_inbox'").get(), undefined);
  core.close();
});
