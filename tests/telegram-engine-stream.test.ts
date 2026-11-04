import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { Homer, type Message } from "../src/service.js";
import { TelegramHomerBridge } from "../src/channels/telegram-homer-bridge.js";
import { TelegramApi } from "../src/channels/telegram-api.js";
import type { TelegramUpdate } from "../src/channels/telegram-contract.js";

const until = async (check: () => boolean) => {
  const end = Date.now() + 15000;
  while (!check()) { if (Date.now() > end) throw new Error("telegram_protocol_pipeline_timeout"); await new Promise(resolve => setTimeout(resolve, 10)); }
};
// Actual CodexEngine child protocol, actual Homer/history and native Telegram
// sender. Both external peers are synthetic; this is not a real model/phone pass.
test("TG actual engine increments -> native Thinking -> exact stop terminal -> same main resumes with four rich block types", { timeout: 25000 }, async t => {
  mkdirSync(resolve(".codex/scratch/telegram-plan"), { recursive: true });
  const root = mkdtempSync(resolve(".codex/scratch/telegram-plan/engine-pipeline-"));
  mkdirSync(join(root, "workspace")); mkdirSync(join(root, "runtime"));
  const events: Message[] = [], sent: { method: string; body: Record<string, unknown> }[] = [], secrets = new Map<string, string>();
  let bridge: TelegramHomerBridge | undefined, next: TelegramUpdate[] = [], releasePoll: (() => void) | undefined;
  const token = "123456:synthetic_fixture_value_123456789";
  const api = new TelegramApi(token, (async (url, init) => {
    const method = String(url).split("/").at(-1)!;
    if (method === "getMe") return Response.json({ ok: true, result: { id: 123456, is_bot: true } });
    if (method === "getWebhookInfo") return Response.json({ ok: true, result: { url: "" } });
    if (method === "getUpdates") {
      const signal = init!.signal!;
      if (!next.length) await new Promise<void>(resolve => { const done = () => { signal.removeEventListener("abort", done); releasePoll = undefined; resolve(); }; releasePoll = done; if (signal.aborted) done(); else signal.addEventListener("abort", done, { once: true }); });
      if (signal.aborted) throw new Error("synthetic_abort");
      const result = next; next = []; return Response.json({ ok: true, result });
    }
    sent.push({ method, body: JSON.parse(init!.body as string) as Record<string, unknown> });
    return Response.json({ ok: true, result: method.endsWith("Draft") ? true : { message_id: 100 + sent.length } });
  }) as typeof fetch);
  const app = new Homer({ workspace: join(root, "workspace"), runtime: join(root, "runtime"), codexHome: join(root, "home"), codexBin: resolve("tests/telegram-stream-peer.mjs"), model: "synthetic", requiresOpenaiAuth: false, timeoutMs: 10000, mainTimeoutMs: 10000, stopGraceMs: 500 }, async message => { events.push(message); await bridge?.handleMessage(message); });
  t.after(async () => { await bridge?.close(); await app.close(); rmSync(root, { recursive: true, force: true }); });
  await app.start(); bridge = new TelegramHomerBridge(app, { createApi: () => api, secrets: { async get(id) { return secrets.get(id)!; }, async set(id, value) { secrets.set(id, value); }, async delete(id) { secrets.delete(id); } } });
  await bridge.channel.configureLocal(token); await bridge.channel.connect();
  const pairing = await bridge.channel.beginPairing();
  const feed = (update: TelegramUpdate) => { next.push(update); releasePoll?.(); };
  const input = (updateId: number, text: string): TelegramUpdate => ({ update_id: updateId, message: { message_id: updateId + 10, date: Date.now() / 1000, chat: { id: 789123, type: "private" }, from: { id: 789123 }, text } });
  feed(input(1, "/start " + pairing.code)); await until(() => bridge!.channel.pairingCandidate(pairing.code) !== null);
  await bridge.channel.approvePairing(pairing.code, "789123", "789123");
  feed(input(2, "合成持续主回复"));
  await until(() => sent.some(item => item.method === "sendRichMessageDraft" && JSON.stringify(item.body).includes("thinking")));
  await until(() => sent.some(item => item.method === "sendRichMessageDraft" && JSON.stringify(item.body).includes("合成增量正文")));
  assert.equal(events.some(item => item.type === "main_terminal"), false, "a native content draft must precede the terminal event");
  const firstStart = events.find(item => item.type === "main_start"); assert.ok(firstStart && firstStart.type === "main_start");
  const draft = bridge.channel.store.draft(firstStart.generationId)!;
  feed({ update_id: 3, stopped_message_generation: { chat: { id: 789123, type: "private" }, draft_id: draft.draftId } });
  await until(() => events.some(item => item.type === "main_terminal" && item.status === "interrupted"));
  await until(() => sent.some(item => item.method === "sendRichMessage"));
  assert.equal(sent.filter(item => item.method === "sendRichMessage").length, 1, "terminal and reply are one formal message");
  assert.equal(bridge.gaps.size, 0);
  feed(input(4, "合成继续四类富内容"));
  await until(() => events.filter(item => item.type === "main_start").length === 2);
  feed({ update_id: 5, stopped_message_generation: { chat: { id: 789123, type: "private" }, draft_id: draft.draftId } });
  await until(() => events.some(item => item.type === "main_terminal" && item.status === "completed"));
  await until(() => sent.filter(item => item.method === "sendRichMessage").length === 2);
  const final = JSON.stringify(sent.filter(item => item.method === "sendRichMessage").at(-1)!.body);
  for (const type of ["table", "pre", "mathematical_expression", "details"]) assert.ok(final.includes('"type":"' + type + '"'), type);
  assert.doesNotMatch(JSON.stringify(sent), /PRIVATE_REASONING_NOT_VISIBLE|FOREIGN_NOT_VISIBLE/);
  assert.equal(app.store.meta("mainThread"), "telegram-synthetic-original");
  const starts = events.filter(item => item.type === "main_start"); assert.equal(starts.length, 2); assert.notEqual(starts[0]!.generationId, starts[1]!.generationId);
  assert.ok(events.findIndex(item => item.type === "main_start") < events.findIndex(item => item.type === "delta"));
  await until(() => events.filter(item => item.type === "reply").length === 2);
  await until(() => app.store.db.prepare("SELECT count(*) n FROM tg_outbox WHERE state='pending'").get()?.n === 0);
  const outbox = () => app.store.db.prepare("SELECT id,groupId,state FROM tg_outbox ORDER BY id").all();
  const completed = outbox();
  const formal = completed.filter(row => String(row.groupId).startsWith("generation:"));
  assert.deepEqual(formal.map(row => row.groupId).sort(), starts.map(start => "generation:" + start.generationId).sort());
  assert.ok(formal.every(row => row.state === "sent"));
  assert.equal(completed.some(row => String(row.groupId).startsWith("delivery:reply:")), false);
  await bridge.restore(); await bridge.restore();
  // Let the real adapter pump run twice after reconnect, rather than merely
  // checking the queue before it has a chance to send an erroneous fallback.
  await new Promise(resolve => setTimeout(resolve, 600));
  assert.deepEqual(outbox(), completed);
  assert.equal(sent.filter(item => item.method === "sendRichMessage").length, 2);
  assert.equal(bridge.gaps.size, 0);
});
