import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { TelegramChannel } from "../src/channels/telegram-channel.js";
import { TelegramManagement } from "../src/channels/telegram-management.js";
import { TelegramApi } from "../src/channels/telegram-api.js";
import { createWebServer,fetch } from "./web-connected-fixture.js";
import type { WebBridge } from "../src/web-contract.js";

test("TG local management guards origin/query, keeps secret out of replies and requires exact local owner approval", async t => {
  const db = new DatabaseSync(":memory:"), secrets = new Map<string, string>();
  let calls = 0;
  const token = "123456:synthetic_fixture_value_123456789";
  const channel = new TelegramChannel(db, { async submit() {}, async stop() { return "unconfirmed"; }, async respond() {}, async artifact() { throw new Error("not_expected"); } }, "original-main", {
    secrets: { async get(id) { return secrets.get(id)!; }, async set(id, value) { secrets.set(id, value); }, async delete(id) { secrets.delete(id); } },
    createApi: input => new TelegramApi(input, (async (url, init) => {
      calls++;
      const method = String(url).split("/").at(-1);
      if (method === "getMe") return Response.json({ ok: true, result: { id: 123456, is_bot: true } });
      if (method === "getWebhookInfo") return Response.json({ ok: true, result: { url: "" } });
      if (method === "getUpdates") {
        await new Promise<void>(resolve => { const signal = init!.signal!; if (signal.aborted) resolve(); else signal.addEventListener("abort", () => resolve(), { once: true }); });
        throw new Error("synthetic_abort");
      }
      throw new Error("unexpected_fixture_network");
    }) as typeof fetch),
  });
  const management = new TelegramManagement(channel);
  const bridge: WebBridge = { telegram: management, state: async () => ({ threadId: "original-main", messages: [], isRunning: false, activeMessageId: null, work: [], interactions: [], upgrade: { phase: "running" } }), async submit() {}, async stop() {}, async respond() {}, async artifact() { throw new Error("not_expected"); } };
  const web = await createWebServer({ bridge, port: 0 });
  t.after(async () => { await management.close(); await web.close(); db.close(); });
  const post = (path: string, body: unknown = {}, origin = web.url) => fetch(web.url + "/api/channels/telegram/" + path, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await post("configure", { token }, "https://foreign.example")).status, 403); assert.equal(calls, 0);
  assert.equal((await fetch(web.url + "/api/channels/telegram?token=denied")).status, 400);
  assert.equal((await post("configure", { token: 123 })).status, 409); assert.equal(calls, 0);
  const configured = await (await post("configure", { token })).text();
  assert.doesNotMatch(configured, /synthetic_fixture|secretRef|reference|123456:/); assert.equal(JSON.parse(configured).configured, true);
  assert.equal(management.canUpgrade(), true);
  assert.equal((await post("connect")).status, 200);
  const pairing = await (await post("pair")).json() as { code: string };
  assert.match(pairing.code, /^[a-f0-9]{32}$/);
  channel.store.ingest("123456", [{ update_id: 1, message: { message_id: 1, date: Date.now() / 1000, chat: { id: 789123, type: "private" }, from: { id: 789123 }, text: "/start " + pairing.code } }]);
  const candidate = await (await post("pair/candidate", { code: pairing.code })).json();
  assert.deepEqual(candidate, { userId: "789123", chatId: "789123" });
  assert.equal((await post("pair/approve", { code: pairing.code, userId: "999123", chatId: "789123" })).status, 409);
  assert.equal((await (await post("pair/approve", { code: pairing.code, ...candidate })).json() as { bound: boolean }).bound, true);
  const page = await fetch(web.url + "/settings/telegram"); assert.equal(page.status, 200); assert.equal(page.headers.get("cache-control"), "no-store");
  const html = await page.text(); assert.match(html, /type="password"/); assert.doesNotMatch(html, /<script[^>]*>[^<]+<\/script>|synthetic_fixture/);
  const js = await (await fetch(web.url + "/settings/telegram.js")).text(); assert.doesNotMatch(js, /localStorage|sessionStorage\.setItem|console\./);assert.doesNotMatch(js,/sessionStorage|X-Homer-Connection/);
  assert.equal((await post("disconnect")).status, 200);
  assert.equal((await post("forget")).status, 200); assert.equal(secrets.size, 0);
});
