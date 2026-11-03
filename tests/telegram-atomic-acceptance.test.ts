import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { Homer } from "../src/service.js";
import { TelegramHomerBridge } from "../src/channels/telegram-homer-bridge.js";
import type { EngineLike, EngineOptions, TurnResult } from "../src/engine.js";

// Synthetic source-isolation and crash-window checks against the actual Homer.
// No model process, Telegram network, Keychain or existing runtime is used.
async function fixture(t: { after(fn: () => unknown): void }) {
  mkdirSync(resolve(".codex/scratch/telegram-plan"), { recursive: true });
  const root = mkdtempSync(resolve(".codex/scratch/telegram-plan/atomic-fixture-"));
  mkdirSync(join(root, "workspace")); mkdirSync(join(root, "runtime"));
  const turns: string[] = [];
  class Engine extends EventEmitter implements EngineLike {
    threadId: string;
    resumable = true;
    constructor(options: EngineOptions) { super(); this.threadId = options.threadId ?? "synthetic-main"; }
    async start() { return this.threadId; }
    async turn(text: string, options?: { onStarted?: (id: string) => void }): Promise<TurnResult> {
      turns.push(text); options?.onStarted?.("synthetic-turn");
      return { status: "completed", text: "合成回复" };
    }
    async interrupt() { return true; }
    async close() { return true; }
  }
  const app = new Homer({ workspace: join(root, "workspace"), runtime: join(root, "runtime"), codexBin: "/usr/bin/false", codexHome: join(root, "home"), model: "synthetic", effort: "medium", requiresOpenaiAuth: false, timeoutMs: 10000, mainTimeoutMs: 10000, stopGraceMs: 100 }, async () => {}, options => new Engine(options));
  await app.start();
  const bridge = new TelegramHomerBridge(app), store = bridge.channel.store;
  store.configure("123456", "synthetic-main"); store.enabled("123456", true);
  const code = store.pairing("123456"); store.proposePair("123456", code, "789123", "789123"); store.approvePair("123456", code, "789123", "789123");
  store.ingest("123456", [{ update_id: 10, message: { message_id: 30, date: Date.now() / 1000, chat: { id: 789123, type: "private" }, from: { id: 789123 }, text: "合成请求" } }]);
  const input = { requestId: "tg:123456:10", text: "合成请求", origin: store.route("tg:123456:10")! };
  t.after(async () => { await bridge.close(); await app.close(); rmSync(root, { recursive: true, force: true }); });
  return { app, bridge, store, input, turns };
}

test("TG acceptance rolls back canonical history, channel receipt and inbox mutation before any main turn", async t => {
  const f = await fixture(t);
  // Fail after receipt INSERT and inbox UPDATE, proving the entire core-owned transaction rolls back.
  f.app.store.db.exec("CREATE TRIGGER synthetic_receipt_failure AFTER UPDATE OF state ON tg_inbox WHEN NEW.state='accepted' BEGIN SELECT RAISE(ABORT,'synthetic_receipt_failure'); END");
  await assert.rejects(f.bridge.submit(f.input), /synthetic_receipt_failure/);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.turns.length, 0);
  assert.equal(f.app.conversationState().messages.length, 0);
  assert.equal(f.app.store.db.prepare("SELECT count(*) AS n FROM conversation_inputs").get()?.n, 0);
  assert.equal(f.app.store.db.prepare("SELECT count(*) AS n FROM tg_acceptances").get()?.n, 0);
  assert.equal(f.store.inbox("123456").length, 1);
  assert.ok(f.store.route(f.input.requestId)); // The earlier durable transport inbox survives for recovery.
  f.app.store.db.exec("DROP TRIGGER synthetic_receipt_failure");
  await f.bridge.submit(f.input); await f.app.idle();
  assert.equal(f.turns.length, 1);
  assert.equal(f.app.store.db.prepare("SELECT state,body FROM tg_inbox").get()?.state, "accepted");
});

test("TG duplicate verifies original peer/message/reply receipt and never dispatches twice", async t => {
  const f = await fixture(t);
  await f.bridge.submit(f.input); await f.app.idle();
  await f.bridge.submit(f.input); await f.app.idle();
  assert.equal(f.turns.length, 1);
  const state = f.app.conversationState();
  assert.equal(state.messages.length, 2);
  const receipt = f.app.store.db.prepare("SELECT replyId FROM tg_acceptances").get();
  const rawReply = f.app.history.list(state.threadId).find(m => m.id === receipt?.replyId)!;
  assert.equal(rawReply.requestId, f.input.requestId);
  assert.equal(rawReply.role, "assistant");
  const processes = state.processNodes.filter(node => node.replyMessageId === receipt?.replyId);
  assert.equal(processes.length, 1, "duplicate acceptance cannot create a second processing segment");
  assert.equal(state.messages[1]?.id, processes[0]!.messageId);
  assert.equal(state.queue.some(row=>row.input.requestId===f.input.requestId),false,'received input leaves the display queue');
  const queued = f.app.inputs.list().filter(row => row.input.requestId === f.input.requestId);
  assert.equal(queued.length, 1);
  assert.equal(queued[0]!.replyId, receipt?.replyId);
  await assert.rejects(f.bridge.submit({ ...f.input, origin: { ...f.input.origin, messageId: 999 } }), /inbox_origin_mismatch/);
  f.app.store.db.exec("DELETE FROM tg_acceptances");
  await assert.rejects(f.bridge.submit(f.input), /acceptance_missing_or_conflicting/);
  assert.equal(f.turns.length, 1);
});

test("TG source conflicts with local/WeChat IDs before persist, and cannot adopt an unmapped canonical Telegram input", async t => {
  const f = await fixture(t);
  f.app.submitMessage({ requestId: f.input.requestId, text: f.input.text }, { source: "wechat", persist() {} });
  await f.app.idle();
  await assert.rejects(f.bridge.submit(f.input), /request_id_conflict/);
  assert.equal(f.app.store.db.prepare("SELECT count(*) AS n FROM tg_acceptances").get()?.n, 0);
  assert.equal(f.store.inbox("123456").length, 1);
  assert.throws(() => f.app.submitMessage({ requestId: f.input.requestId, text: f.input.text }), /request_id_conflict/);
  const orphan = { requestId: "tg:123456:11", text: "合成请求" };
  f.store.ingest("123456", [{ update_id: 11, message: { message_id: 31, date: Date.now() / 1000, chat: { id: 789123, type: "private" }, from: { id: 789123 }, text: orphan.text } }]);
  f.app.submitMessage(orphan, { source: "telegram", persist() {} }); await f.app.idle();
  await assert.rejects(f.bridge.submit({ ...orphan, origin: f.store.route(orphan.requestId)! }), /acceptance_missing_or_conflicting/);
  assert.equal(f.turns.length, 2);
});
