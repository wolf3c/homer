import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { TelegramApi, TelegramApiError, TELEGRAM_UPDATES } from "../src/channels/telegram-api.js";
import { TelegramStore } from "../src/channels/telegram-store.js";
import { TelegramAdapter } from "../src/channels/telegram-adapter.js";
import { renderTelegramRich, splitTelegramText } from "../src/channels/telegram-render.js";
import type { MainGeneration, TelegramHost, TelegramUpdate } from "../src/channels/telegram-contract.js";

// Requirement-derived synthetic fixtures. No account, model or Telegram connection.
const token = "123456:synthetic_fixture_value_123456789";
const generation: MainGeneration = { id: "generation-a", messageId: "main-message-a", threadId: "original-main", turnId: "turn-a", sourceRequestId: "tg:123456:10", visibility: "main_user" };
function fixture() {
  let now = 1_800_000_000_000;
  const db = new DatabaseSync(":memory:"), store = new TelegramStore(db);
  store.configure("123456", "original-main"); store.enabled("123456", true);
  const pair = store.pairing("123456", now);
  store.proposePair("123456", pair, "789123", "789123", now);
  store.approvePair("123456", pair, "789123", "789123", now);
  const calls: { method: string; body: Record<string, unknown> | FormData }[] = [];
  let failure: { method: string; code: number; retry?: number } | undefined;
  let uncertain = false;
  const api = new TelegramApi(token, (async (url: string | URL | Request, init?: RequestInit) => {
    const method = String(url).split("/").at(-1)!;
    const body = init?.body instanceof FormData ? init.body : JSON.parse(init?.body as string) as Record<string, unknown>;
    calls.push({ method, body });
    if (uncertain) { uncertain = false; throw new Error("synthetic transport lost response"); }
    if (failure?.method === method) { const value = failure; failure = undefined; return Response.json({ ok: false, error_code: value.code, parameters: { retry_after: value.retry } }, { status: value.code }); }
    return Response.json({ ok: true, result: method.endsWith("Draft") || method === "answerCallbackQuery" ? true : { message_id: calls.length + 100 } });
  }) as typeof fetch);
  const submissions: unknown[] = [], stops: unknown[] = [], answers: unknown[] = [], statuses: string[] = [];
  const host: TelegramHost = {
    async submit(value) { submissions.push(value); }, async stop(value) { stops.push(value); return "stopped"; },
    async respond(value) { answers.push(value); }, async artifact() { return { filename: "synthetic-result.md", bytes: Buffer.from("# 合成成果") }; },
  };
  const adapter = new TelegramAdapter("123456", store, api, host, value => statuses.push(value), () => now);
  const update = (update_id = 10, text = "合成请求", from = 789123): TelegramUpdate => ({ update_id, message: { message_id: update_id + 20, date: now / 1000, chat: { id: 789123, type: "private" }, from: { id: from }, text } });
  const advance = (ms = 1000) => { now += ms; };
  return { db, store, api, host, adapter, calls, submissions, stops, answers, statuses, update, advance, now: () => now,
    fail: (method: string, code: number, retry?: number) => { failure = { method, code, retry }; }, loseResponse: () => { uncertain = true; } };
}

test("TG pairing requires a local challenge AND explicit candidate approval", () => {
  const db = new DatabaseSync(":memory:"), store = new TelegramStore(db);
  store.configure("123456", "original"); store.enabled("123456", true);
  const code = store.pairing("123456", 1000);
  assert.equal(store.proposePair("123456", "unknown", "1", "1", 1000), false);
  assert.throws(() => store.approvePair("123456", code, "1", "1", 1000), /pairing_mismatch/);
  assert.equal(store.proposePair("123456", code, "1", "1", 1000), true);
  assert.equal(store.connection("123456")?.ownerId, null);
  assert.throws(() => store.approvePair("123456", code, "2", "2", 1000), /pairing_mismatch/);
  store.approvePair("123456", code, "1", "1", 1000);
  assert.equal(store.connection("123456")?.ownerId, "1");
  assert.throws(() => store.pairing("123456"), /pairing_unavailable/);
  store.unbind("123456");
  assert.equal(store.connection("123456")?.enabled, 0);
  db.close();
});

test("TG inbox checkpoint is atomic, deduplicated and owner scoped", async () => {
  const f = fixture();
  const stranger = f.update(11, "陌生人合成正文", 123);
  f.adapter.receive([f.update(), f.update(), stranger]); await f.adapter.idle();
  assert.equal(f.submissions.length, 1);
  assert.equal(f.store.connection("123456")?.offset, 12);
  assert.equal(f.db.prepare("SELECT count(*) AS n FROM tg_inbox").get()?.n, 1);
  assert.equal(f.db.prepare("SELECT body FROM tg_inbox").get()?.body, null);
  const before = f.store.connection("123456")?.offset;
  assert.throws(() => f.store.ingest("123456", [f.update(12), { update_id: NaN }], f.now()), /invalid_update/);
  assert.equal(f.store.connection("123456")?.offset, before);
  assert.equal(f.store.route("tg:123456:12"), undefined);
  f.db.close();
});

test("TG native thinking and real deltas use one draft, formal finish persists separately", async () => {
  const f = fixture(); f.adapter.receive([f.update()]); await f.adapter.idle();
  await f.adapter.event({ type: "start", generation }); await f.adapter.idle();
  assert.equal(f.calls[0]?.method, "sendRichMessageDraft");
  assert.equal((f.calls[0]?.body as { rich_message: { blocks: { type: string }[] } }).rich_message.blocks[0]?.type, "thinking");
  await f.adapter.event({ type: "delta", generationId: generation.id, sequence: 0, text: "真实" });
  assert.equal(f.calls.length, 1);
  f.advance(); await f.adapter.tick();
  assert.match(JSON.stringify(f.calls[1]?.body), /真实/);
  assert.equal((f.calls[0]?.body as { draft_id: number }).draft_id, (f.calls[1]?.body as { draft_id: number }).draft_id);
  await f.adapter.event({ type: "delta", generationId: generation.id, sequence: 1, text: "增量" });
  await f.adapter.event({ type: "finish", generationId: generation.id, text: "真实增量", status: "completed" });
  for (let i = 0; i < 4; i++) { f.advance(); await f.adapter.tick(); }
  const final = f.calls.find(c => c.method === "sendRichMessage");
  assert.ok(final); assert.match(JSON.stringify(final.body), /真实增量/);
  assert.equal("draft_id" in final.body, false);
  assert.equal(f.store.draft(generation.id)?.state, "closed");
  f.db.close();
});

test("TG native stop matches original main generation only, never a Worker", async () => {
  const f = fixture(); f.adapter.receive([f.update()]); await f.adapter.idle();
  await f.adapter.event({ type: "start", generation }); await f.adapter.idle();
  f.adapter.receive([{ update_id: 11, stopped_message_generation: { chat: { id: 789123, type: "private" }, draft_id: 999 } }]); await f.adapter.idle();
  assert.equal(f.stops.length, 0);
  const draftId = f.store.draft(generation.id)!.draftId;
  const stop: TelegramUpdate = { update_id: 12, stopped_message_generation: { chat: { id: 789123, type: "private" }, draft_id: draftId } };
  f.adapter.receive([stop, stop]); await f.adapter.idle();
  assert.deepEqual(f.stops, [generation]);
  f.adapter.receive([{ ...stop, update_id: 13 }]); await f.adapter.idle();
  assert.equal(f.stops.length, 1);
  assert.equal(f.store.draft(generation.id)?.state, "stop_requested");
  f.db.close();
});

test("TG plain native draft uses empty Thinking then real text and final sendMessage without a draft ID", async () => {
  const f = fixture(); f.adapter.receive([f.update()]); await f.adapter.idle();
  await f.adapter.event({ type: "start", generation, mode: "plain" }); await f.adapter.idle();
  const thinking = f.calls.find(item => item.method === "sendMessageDraft")!;
  assert.equal((thinking.body as Record<string, unknown>).text, "");
  await f.adapter.event({ type: "delta", generationId: generation.id, sequence: 0, text: "合成纯文本增量" });
  f.advance(); await f.adapter.tick();
  assert.ok(f.calls.some(item => item.method === "sendMessageDraft" && (item.body as Record<string, unknown>).text === "合成纯文本增量"));
  await f.adapter.event({ type: "finish", generationId: generation.id, text: "合成纯文本增量", status: "completed" });
  for (let i = 0; i < 3; i++) { f.advance(); await f.adapter.tick(); }
  const final = f.calls.find(item => item.method === "sendMessage" && (item.body as Record<string, unknown>).text === "合成纯文本增量")!;
  assert.ok(final); assert.equal("draft_id" in final.body, false);
  assert.equal(f.calls.some(item => item.method === "sendRichMessage"), false);
  await f.adapter.close(); f.db.close();
});

test("TG unchanged active preview refreshes before expiry and prevents handoff until terminal", async () => {
  const f = fixture(); f.adapter.receive([f.update()]); await f.adapter.idle();
  assert.equal(f.adapter.canUpgrade(), true);
  await f.adapter.event({ type: "start", generation }); await f.adapter.idle();
  assert.equal(f.adapter.canUpgrade(), false);
  const before = f.calls.filter(item => item.method === "sendRichMessageDraft").length;
  f.advance(10000); await f.adapter.tick();
  assert.equal(f.calls.filter(item => item.method === "sendRichMessageDraft").length, before + 1);
  await f.adapter.event({ type: "finish", generationId: generation.id, text: "合成正式回复", status: "completed" });
  await f.adapter.idle(); assert.equal(f.adapter.canUpgrade(), true);
  await f.adapter.close(); f.db.close();
});

test("TG stop control stays responsive while host input acceptance waits", async () => {
  const f = fixture(); f.adapter.receive([f.update()]); await f.adapter.idle();
  await f.adapter.event({ type: "start", generation }); await f.adapter.idle();
  let release!: () => void;
  f.host.submit = async () => new Promise<void>(resolve => { release = resolve; });
  f.adapter.receive([f.update(11)]);
  f.adapter.receive([{ update_id: 12, stopped_message_generation: { chat: { id: 789123, type: "private" }, draft_id: f.store.draft(generation.id)!.draftId } }]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.stops.length, 1); release(); await f.adapter.idle(); f.db.close();
});

test("TG render keeps native tables, code, formulas and disclosure blocks", () => {
  const input = "| 项目 | 值 |\n| --- | --- |\n| A | 1 |\n\n```ts\nconst x = 1;\n```\n\n$$x^2 + y^2$$\n\n<details>\n<summary>验证细节</summary>\n合成正文\n</details>";
  const result = renderTelegramRich(input);
  assert.equal(result.degraded, false);
  assert.deepEqual(result.messages[0]?.blocks.map(b => b.type), ["table", "pre", "mathematical_expression", "details"]);
  const split = splitTelegramText("合成😀".repeat(3000));
  assert.equal(split.join(""), "合成😀".repeat(3000)); assert.ok(split.every(p => p.length <= 4000));
  assert.ok(split.every(p => !/[\uD800-\uDBFF]$/.test(p)));
});

test("TG rich refusal has readable explicit fallback; lost final response is uncertain, never resent", async () => {
  const f = fixture(); f.adapter.receive([f.update()]); await f.adapter.idle();
  await f.adapter.event({ type: "delivery", id: "result", sourceRequestId: generation.sourceRequestId, text: "可读合成成果" });
  await f.adapter.tick(); f.advance(); f.fail("sendRichMessage", 400); await f.adapter.tick();
  f.advance(); await f.adapter.tick();
  assert.ok(f.calls.some(c => c.method === "sendMessage" && JSON.stringify(c.body).includes("可读合成成果")));
  assert.ok(f.statuses.includes("presentation_degraded"));
  await f.adapter.event({ type: "delivery", id: "unknown", sourceRequestId: generation.sourceRequestId, text: "不确定交付" });
  f.advance(); f.loseResponse(); await f.adapter.tick();
  const count = f.calls.length;
  for (let i = 0; i < 3; i++) { f.advance(); await f.adapter.tick(); }
  assert.equal(f.calls.length, count);
  assert.equal(f.db.prepare("SELECT state FROM tg_outbox WHERE id='delivery:unknown:0'").get()?.state, "uncertain");
  f.db.close();
});

test("TG callback is owner/card scoped, acked, durable, one shot and resumes exact interaction", async () => {
  const f = fixture(); f.adapter.receive([f.update()]); await f.adapter.idle();
  await f.adapter.event({ type: "interaction", id: "question-a", sourceRequestId: generation.sourceRequestId, runId: "worker-a", text: "合成授权？", kind: "authorization", expiresAt: f.now() + 60_000, options: [{ id: "yes", label: "允许", text: "批准这一次" }] });
  await f.adapter.tick(); f.advance(); await f.adapter.tick();
  const card = f.calls.find(c => JSON.stringify(c.body).includes("inline_keyboard"))!;
  const handle = (card.body as { reply_markup: { inline_keyboard: { callback_data: string }[][] } }).reply_markup.inline_keyboard[0]![0]!.callback_data;
  assert.ok(Buffer.byteLength(handle) <= 64); assert.equal(handle.includes("worker"), false);
  const messageId = f.db.prepare("SELECT messageId FROM tg_interactions WHERE id='question-a'").get()?.messageId as number;
  const callback = (update_id: number, from = 789123, message_id = messageId): TelegramUpdate => ({ update_id, callback_query: { id: `callback-${update_id}`, from: { id: from }, data: handle, message: { message_id, date: f.now() / 1000, chat: { id: 789123, type: "private" } } } });
  f.adapter.receive([callback(11, 99), callback(12, 789123, messageId + 1)]); await f.adapter.idle();
  assert.equal(f.answers.length, 0);
  f.adapter.receive([callback(13), callback(14)]); await f.adapter.idle();
  assert.equal(f.answers.length, 1);
  assert.equal((f.answers[0] as { interactionId: string }).interactionId, "question-a");
  assert.ok(f.calls.some(c => c.method === "answerCallbackQuery")); f.db.close();
});

test("TG restart retains checkpoint/route/counter and freezes uncertain sends", async () => {
  const f = fixture(); f.adapter.receive([f.update()]); await f.adapter.idle();
  const origin = f.store.route(generation.sourceRequestId)!;
  const first = f.store.createDraft(generation, origin, "plain");
  f.store.enqueue("crash-send", origin, "text", { text: "合成回复" }); f.store.outboxState("crash-send", "sending");
  const next = new TelegramStore(f.db); next.reconcile("123456");
  assert.equal(next.connection("123456")?.offset, 11);
  assert.equal(next.draft(generation.id)?.state, "closed");
  const later = next.createDraft({ ...generation, id: "later" }, origin, "plain");
  assert.ok(later.draftId > first.draftId);
  assert.equal(f.db.prepare("SELECT state FROM tg_outbox WHERE id='crash-send'").get()?.state, "uncertain");
  assert.equal(next.trusted(origin), true); next.unbind("123456"); assert.equal(next.trusted(origin), false);
  f.db.close();
});

test("TG actual verified document bytes are multipart; local paths never become download URLs", async () => {
  const f = fixture(); f.adapter.receive([f.update()]); await f.adapter.idle();
  await f.adapter.event({ type: "delivery", id: "file-result", sourceRequestId: generation.sourceRequestId, text: "成果已完成", resultId: "result-file" });
  for (let i = 0; i < 4; i++) { await f.adapter.tick(); f.advance(); }
  const upload = f.calls.find(c => c.method === "sendDocument")?.body;
  assert.ok(upload instanceof FormData);
  const file = upload.get("document") as File;
  assert.equal(file.name, "synthetic-result.md"); assert.equal(await file.text(), "# 合成成果");
  assert.equal(upload.has("document_url"), false); f.db.close();
});

test("TG API rejects conflict/webhook safely, includes required update types and sanitizes errors", async () => {
  const calls: Record<string, unknown>[] = [];
  const api = new TelegramApi(token, (async (_url, init) => {
    calls.push(JSON.parse(init!.body as string) as Record<string, unknown>);
    return Response.json({ ok: false, error_code: 429, description: "synthetic confidential content", parameters: { retry_after: 7 } }, { status: 429 });
  }) as typeof fetch);
  await assert.rejects(api.updates(19), (error: unknown) => error instanceof TelegramApiError && error.retryAfterMs === 7000 && !String(error).includes("confidential"));
  assert.deepEqual(calls[0]?.allowed_updates, TELEGRAM_UPDATES); assert.equal(calls[0]?.offset, 19);
  assert.equal(JSON.stringify(api).includes(token), false);
});

test("TG 429 retries only after retry_after, while progress coalesces to latest delta", async () => {
  const f = fixture(); f.adapter.receive([f.update()]); await f.adapter.idle();
  await f.adapter.event({ type: "start", generation }); await f.adapter.idle();
  f.advance(); f.fail("sendRichMessageDraft", 429, 5);
  await f.adapter.event({ type: "delta", generationId: generation.id, sequence: 0, text: "第一段" });
  await f.adapter.idle();
  const count = f.calls.length;
  for (let i = 1; i <= 3; i++) {
    f.advance(); await f.adapter.event({ type: "delta", generationId: generation.id, sequence: i, text: "增量" }); await f.adapter.tick();
  }
  assert.equal(f.calls.length, count);
  f.advance(2000); await f.adapter.tick();
  assert.match(JSON.stringify(f.calls.at(-1)?.body), /第一段增量增量增量/);
  f.db.close();
});

test("TG natural answer needs exact live card; expired/replayed answer never becomes a new instruction", async () => {
  const f = fixture(); f.adapter.receive([f.update()]); await f.adapter.idle();
  await f.adapter.event({ type: "interaction", id: "question-natural", sourceRequestId: generation.sourceRequestId, runId: "worker-natural", text: "合成问题", kind: "question", expiresAt: f.now() + 10_000, options: [] });
  await f.adapter.tick(); f.advance(); await f.adapter.tick();
  const messageId = f.db.prepare("SELECT messageId FROM tg_interactions").get()?.messageId as number;
  f.adapter.receive([f.update(11, "同意")]); await f.adapter.idle();
  assert.equal(f.answers.length, 0); assert.equal(f.submissions.length, 1);
  const answer = f.update(12, "合成具体答案"); answer.message!.reply_to_message = { message_id: messageId };
  f.adapter.receive([answer]); await f.adapter.idle();
  assert.equal(f.answers.length, 1);
  const replay = f.update(13, "同意"); replay.message!.reply_to_message = { message_id: messageId };
  f.adapter.receive([replay]); await f.adapter.idle();
  assert.equal(f.answers.length, 1); assert.equal(f.submissions.length, 1);
  f.db.close();
});

test("TG stale inputs are held and cross-chat/group/topic messages never enter main", async () => {
  const f = fixture(), stale = f.update(10); stale.message!.date -= 3601;
  const group = f.update(11); group.message!.chat.type = "group";
  const other = f.update(12); other.message!.chat.id = 54321;
  const topic = f.update(13); topic.message!.message_thread_id = 22;
  f.adapter.receive([stale, group, other, topic]); await f.adapter.idle();
  assert.equal(f.submissions.length, 0); assert.equal(f.store.connection("123456")?.offset, 14);
  assert.equal(f.db.prepare("SELECT state FROM tg_inbox").get()?.state, "held");
  f.store.releaseHeld("tg:123456:10"); await f.adapter.tick(); await f.adapter.idle();
  assert.equal(f.submissions.length, 1); f.db.close();
});

test("TG background parallel results retain their own original reply targets", async () => {
  const f = fixture(); f.adapter.receive([f.update(10), f.update(11)]); await f.adapter.idle();
  await f.adapter.event({ type: "delivery", id: "worker-second", sourceRequestId: "tg:123456:11", text: "第二项先完成" });
  await f.adapter.event({ type: "delivery", id: "worker-first", sourceRequestId: "tg:123456:10", text: "第一项后完成" });
  for (let i = 0; i < 5; i++) { await f.adapter.tick(); f.advance(); }
  const delivered = f.calls.filter(c => c.method === "sendRichMessage").map(c => c.body as { reply_parameters: { message_id: number } });
  assert.deepEqual(delivered.map(c => c.reply_parameters.message_id), [31, 30]); f.db.close();
});

test("TG restart of dispatching input is uncertain rather than re-executed; additive migration preserves core", () => {
  const f = fixture();
  f.db.exec("CREATE TABLE core_sentinel(threadId TEXT); INSERT INTO core_sentinel VALUES('original-main')");
  f.store.ingest("123456", [f.update()], f.now()); f.store.inboxState("tg:123456:10", "dispatching");
  const store = new TelegramStore(f.db); store.reconcile("123456");
  assert.equal(store.inbox("123456").length, 0);
  assert.equal(f.db.prepare("SELECT state FROM tg_inbox").get()?.state, "uncertain");
  assert.equal(f.db.prepare("SELECT threadId FROM core_sentinel").get()?.threadId, "original-main");
  f.db.prepare("UPDATE tg_schema SET version=99").run();
  assert.throws(() => new TelegramStore(f.db), /schema_incompatible/);
  assert.equal(f.db.prepare("SELECT threadId FROM core_sentinel").get()?.threadId, "original-main"); f.db.close();
});

test("TG closing a channel blocks later output even when enabled intent is retained", async () => {
  const f = fixture(); f.adapter.receive([f.update()]); await f.adapter.idle();
  await f.adapter.close();
  await f.adapter.event({ type: "start", generation }); await f.adapter.idle();
  await f.adapter.tick();
  assert.equal(f.calls.length, 0); f.db.close();
});

test("TG after a week the offset-free probe can reset a smaller random update ID safely", () => {
  const f = fixture(); f.store.ingest("123456", [f.update(100_000)], f.now());
  f.advance(8 * 86400_000);
  f.store.ingest("123456", [f.update(20)], f.now());
  assert.equal(f.store.connection("123456")?.offset, 21); f.db.close();
});

test("TG long poll confirms only committed inbox offset; 409 stops consumer without deleting webhook", async () => {
  const f = fixture(), offsets: (number | undefined)[] = [];
  f.api.inspect = async () => "123456";
  f.api.updates = async offset => {
    offsets.push(offset);
    if (offsets.length === 1) return [f.update()];
    throw new TelegramApiError("conflict", 0, 409);
  };
  await f.adapter.start(); await new Promise(resolve => setImmediate(resolve)); await f.adapter.idle();
  assert.deepEqual(offsets, [undefined, 11]);
  assert.equal(f.submissions.length, 1); assert.equal(f.store.connection("123456")?.enabled, 0);
  assert.ok(f.statuses.includes("conflict"));
  assert.ok(f.calls.every(call => call.method !== "deleteWebhook")); await f.adapter.close(); f.db.close();
});

test("TG one uncertain chunk pauses its own remaining chunks/file but not independent results", async () => {
  const f = fixture(); f.adapter.receive([f.update()]); await f.adapter.idle();
  await f.adapter.event({ type: "delivery", id: "large", sourceRequestId: generation.sourceRequestId, text: "合成".repeat(20_000), resultId: "result-large" });
  await f.adapter.event({ type: "delivery", id: "other", sourceRequestId: generation.sourceRequestId, text: "独立合成成果" });
  await f.adapter.tick(); f.advance(); f.loseResponse(); await f.adapter.tick();
  for (let i = 0; i < 8; i++) { f.advance(); await f.adapter.tick(); }
  const sent = f.calls.filter(c => c.method === "sendRichMessage");
  assert.equal(sent.length, 2); assert.match(JSON.stringify(sent[1]?.body), /独立合成成果/);
  assert.equal(f.calls.some(c => c.method === "sendDocument"), false); f.db.close();
});
