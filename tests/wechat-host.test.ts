import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { WechatChannel } from "../src/channels/wechat-channel.js";
import { WechatApi, type WechatQrStatus } from "../src/channels/wechat-api.js";
import { WechatManagement } from "../src/channels/wechat-management.js";
import { createWebServer,fetch } from "./web-connected-fixture.js";
import type { WebBridge } from "../src/web-contract.js";

test("loopback WeChat management exposes local PNG only, guards origins, invalidates old QR and never owns another service", async () => {
  const db = new DatabaseSync(":memory:"); let status: WechatQrStatus = { status: "wait" }, calls = 0;
  class Api extends WechatApi {
  constructor(){super(async()=>Response.json({ret:0}));}
    override async beginQr() { calls++; return { qrcode: "synthetic-only", qrcode_img_content: "https://liteapp.weixin.qq.com/synthetic-only-login-payload" }; }
    override async pollQr() { return status; }
  }
  const channel = new WechatChannel(db, { async submit() { throw new Error("not_expected"); }, async artifact() { throw new Error("not_expected"); } }, new Api(), { async get() { throw new Error("not_expected"); }, async set() { throw new Error("not_expected"); }, async delete() { throw new Error("not_expected"); } });
  const management = new WechatManagement(channel);
  const bridge: WebBridge = { wechat: management, state: async () => ({ threadId: "synthetic", messages: [], isRunning: false, activeMessageId: null, work: [], interactions: [], upgrade: { phase: "running" } }), async submit() {}, async stop() {}, async respond() {}, async artifact() { throw new Error("not_expected"); } };
  const web = await createWebServer({ bridge, port: 0 });
  const post = (path: string, body: unknown = {}, origin = web.url) => fetch(web.url + "/api/channels/wechat/" + path, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  try {
    assert.equal((await post("login", {}, "https://foreign.example")).status, 403); assert.equal(calls, 0);
    const response = await post("login"), text = await response.text(), login = JSON.parse(text) as { id: string; imagePath: string; status: string };
    assert.equal(response.status, 200); assert.equal(login.status, "wait"); assert.match(login.imagePath, /^\/api\/channels\/wechat\/login\/[a-f0-9-]{36}\/qr\.png$/);
    assert.doesNotMatch(text, /liteapp|payload|qrcode|qrCodeUrl|bot_token/); assert.equal(management.canUpgrade(), false);
    const png = await fetch(web.url + login.imagePath), bytes = Buffer.from(await png.arrayBuffer());
    assert.equal(png.headers.get("content-type"), "image/png"); assert.equal(png.headers.get("cache-control"), "no-store");
    assert.deepEqual(bytes.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])); assert.equal(bytes.readUInt32BE(16), 320);
    assert.equal((await fetch(web.url + login.imagePath, { headers: { Origin: "https://foreign.example" } })).status, 403);
    assert.equal((await fetch(web.url + login.imagePath + "?payload=denied")).status, 400);
    assert.equal((await post("login/poll", { id: login.id, verifyCode: "bad" })).status, 409);
    status = { status: "expired" }; assert.equal((await (await post("login/poll", { id: login.id })).json() as { status: string }).status, "expired");
    assert.equal(management.canUpgrade(), true); assert.equal((await fetch(web.url + login.imagePath)).status, 409);
    const second = await (await post("login")).json() as { id: string; imagePath: string };
    assert.notEqual(second.id, login.id); assert.equal((await fetch(web.url + login.imagePath)).status, 409);
    assert.equal((await post("disable")).status, 200); assert.equal((await fetch(web.url + second.imagePath)).status, 409);
    const state = await (await fetch(web.url + "/api/channels/wechat")).text(); assert.doesNotMatch(state, /payload|token|ownerId|peerId|qrCodeUrl/);
    assert.equal(JSON.parse(state).status, "disabled"); assert.equal(management.canUpgrade(), true);
    assert.equal((await post("reconnect")).status, 409); assert.equal((await post("disconnect")).status, 200);
  } finally { await management.close(); await web.close(); db.close(); }
});
