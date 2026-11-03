import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { TelegramChannel } from "../src/channels/telegram-channel.js";
import { TelegramApi, TelegramApiError } from "../src/channels/telegram-api.js";
import type { TelegramHost, TelegramUpdate } from "../src/channels/telegram-contract.js";

// Offline channel E2E with a synthetic host/Telegram server, not real model/phone acceptance.
test("TG trusted local setup -> explicit pairing -> original host -> offline result -> reconnect", async t => {
  const db = new DatabaseSync(":memory:"), secrets = new Map<string, string>();
  let next: TelegramUpdate[] = [], releasePoll: (() => void) | undefined;
  const submitted: { requestId: string; text: string }[] = [], messages: unknown[] = [];
  const token = "123456:synthetic_fixture_value_123456789";
  let channel!: TelegramChannel;
  let newOwner: TelegramChannel | undefined;
  t.after(async () => { await channel?.close(); await newOwner?.close(); db.close(); });
  const until = async (predicate: () => boolean) => {
    const deadline = Date.now() + 3000;
    while (!predicate()) { if (Date.now() >= deadline) throw new Error("synthetic_condition_timeout"); await new Promise(resolve => setTimeout(resolve, 5)); }
  };
  const host: TelegramHost = {
    async submit(value) { submitted.push(value); }, async stop() { return "stopped"; }, async respond() {},
    async artifact() { return { filename: "fixture.md", bytes: Buffer.from("# 合成文件") }; },
  };
  const api = new TelegramApi(token, (async (url, init) => {
    const method = String(url).split("/").at(-1);
    if (method === "getMe") return Response.json({ ok: true, result: { id: 123456, is_bot: true } });
    if (method === "getWebhookInfo") return Response.json({ ok: true, result: { url: "" } });
    if (method === "getUpdates") {
      const signal = init!.signal!;
      if (!next.length) await new Promise<void>(resolve => {
        const done = () => { signal.removeEventListener("abort", done); releasePoll = undefined; resolve(); };
        releasePoll = done; signal.addEventListener("abort", done, { once: true });
        if (signal.aborted) done();
      });
      if (signal.aborted) throw new TelegramApiError("uncertain");
      const result = next; next = [];
      return Response.json({ ok: true, result });
    }
    messages.push(JSON.parse(init!.body as string));
    return Response.json({ ok: true, result: { message_id: 100 + messages.length } });
  }) as typeof fetch);
  channel = new TelegramChannel(db, host, "original-main", {
    createApi: () => api,
    secrets: { async get(id) { return secrets.get(id)!; }, async set(id, value) { secrets.set(id, value); }, async delete(id) { secrets.delete(id); } },
  });
  await channel.configureLocal(token);
  const pairing = await channel.beginPairing();
  await channel.connect();
  next = [{ update_id: 1, message: { message_id: 1, date: Date.now() / 1000, chat: { id: 789123, type: "private" }, from: { id: 789123 }, text: "/start " + pairing.code } }];
  releasePoll?.();
  await until(() => channel.pairingCandidate(pairing.code) !== null);
  assert.deepEqual(channel.pairingCandidate(pairing.code), { userId: "789123", chatId: "789123" });
  assert.equal(channel.view().bound, false);
  await channel.approvePairing(pairing.code, "789123", "789123");
  next = [{ update_id: 2, message: { message_id: 2, date: Date.now() / 1000, chat: { id: 789123, type: "private" }, from: { id: 789123 }, text: "合成交办" } }];
  releasePoll?.();
  await until(() => submitted.length === 1);
  assert.equal(submitted.length, 1); assert.equal(submitted[0]?.requestId, "tg:123456:2");
  await channel.disconnect();
  const before = messages.length;
  await channel.event({ type: "delivery", id: "offline-worker-result", sourceRequestId: "tg:123456:2", text: "离线期间的主 Agent 合成总结" });
  assert.ok(channel.view().pending >= 1);
  assert.equal(messages.length, before);
  newOwner = new TelegramChannel(db, host, "original-main", {
    createApi: () => api,
    secrets: { async get(id) { return secrets.get(id)!; }, async set(id, value) { secrets.set(id, value); }, async delete(id) { secrets.delete(id); } },
  });
  assert.equal((await newOwner.restore()).enabled, false);
  assert.equal(newOwner.store.connection("123456")?.conversationId, "original-main");
  await newOwner.connect();
  // Two queued formal sends are deliberately throttled; do not busy poll a real service.
  await until(() => messages.some(m => JSON.stringify(m).includes("离线期间的主 Agent 合成总结")));
  assert.ok(messages.some(m => JSON.stringify(m).includes("离线期间的主 Agent 合成总结")));
  await newOwner.forget(); assert.equal(secrets.size, 0); assert.equal(newOwner.view().configured, false);
  await channel.close(); await newOwner.close();
});
