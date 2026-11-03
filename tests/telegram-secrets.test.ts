import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { TelegramApi } from "../src/channels/telegram-api.js";
import { TelegramStore } from "../src/channels/telegram-store.js";
import { MacTelegramSecrets, TelegramSettings, readTelegramToken, type TelegramSecrets } from "../src/channels/telegram-secrets.js";

// Requirement-derived synthetic fixtures. No actual Keychain or account access.
const token = "123456:synthetic_fixture_value_123456789";
const reference = "telegram-12345678-1234-1234-1234-123456789abc";
test("TG secret writes use stdin, isolated Keychain namespace and verified readback", async () => {
  const calls: { args: string[]; input?: string }[] = [];
  const secrets = new MacTelegramSecrets(async (args, input) => {
    calls.push({ args, input });
    return { status: 0, text: args[0] === "find-generic-password" ? Buffer.from(token).toString("base64") : "" };
  });
  await secrets.set(reference, token);
  assert.equal(calls.some(call => call.args.join(" ").includes(token)), false);
  assert.equal(calls[0]?.args.join(" "), "-i");
  assert.match(calls[0]?.input ?? "", /Homer\.Telegram\.v1/);
  assert.equal(calls[0]?.input?.includes(token), false);
  assert.equal(await secrets.get(reference), token);
  await assert.rejects(secrets.set("other-app-secret", token), /invalid_secret_reference/);
  const mismatch = new MacTelegramSecrets(async () => ({ status: 0, text: "" }));
  await assert.rejects(mismatch.set(reference, token), /keychain_unavailable/);
});

test("TG trusted setup checks bot/webhook first, stores only secret reference, retains original conversation", async () => {
  const db = new DatabaseSync(":memory:"), store = new TelegramStore(db), values = new Map<string, string>();
  const secrets: TelegramSecrets = {
    async get(id) { const value = values.get(id); if (!value) throw new Error("missing"); return value; },
    async set(id, value) { values.set(id, value); }, async delete(id) { values.delete(id); },
  };
  const methods: string[] = [];
  let webhook = "";
  const settings = new TelegramSettings(store, secrets, "original-main", input => new TelegramApi(input, (async url => {
    const method = String(url).split("/").at(-1)!; methods.push(method);
    return Response.json({ ok: true, result: method === "getMe" ? { id: 123456, is_bot: true } : { url: webhook } });
  }) as typeof fetch));
  webhook = "https://synthetic.invalid/sensitive-endpoint";
  await assert.rejects(settings.configure(token), /existing_webhook/);
  assert.equal(values.size, 0); assert.equal(store.connection("123456"), undefined);
  webhook = ""; const result = await settings.configure(token);
  assert.deepEqual(result, { botId: "123456", bound: false });
  assert.deepEqual(methods, ["getMe", "getWebhookInfo", "getMe", "getWebhookInfo"]);
  assert.equal(store.connection("123456")?.conversationId, "original-main");
  assert.equal(store.connection("123456")?.enabled, 0);
  assert.equal(JSON.stringify(db.prepare("SELECT * FROM tg_credentials").all()).includes(token), false);
  assert.equal(values.size, 1);
  await settings.forget("123456"); assert.equal(values.size, 0); db.close();
});

test("TG hidden input refuses non-interactive callers rather than accepting chat/pipe secrets", async () => {
  const { PassThrough } = await import("node:stream");
  const input = new PassThrough();
  await assert.rejects(readTelegramToken(input as never, input as never), /trusted_tty_required/);
});
