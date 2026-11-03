import {syntheticUserFetch} from './web-user-connection.mjs';
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdirSync, mkdtempSync, cpSync, symlinkSync, writeFileSync, readFileSync, appendFileSync, existsSync, rmSync, chmodSync } from "node:fs";
import { resolve, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { schemaHash, sourceSnapshot } from "../scripts/dev-build.mjs";

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, timeout = 45000) {
  const end = Date.now() + timeout;
  while (!await check()) { if (Date.now() > end) throw new Error("wechat_host_fixture_timeout"); await delay(40); }
}

test("wechat schema owners block automatic handoff", () => {
  const files = new Map([["src/channels/wechat-store.ts", Buffer.from("synthetic-schema")], ["src/channels/wechat-homer.ts", Buffer.from("synthetic-receipts")]]);
  const first = schemaHash({ files }); files.set("src/channels/wechat-store.ts", Buffer.from("changed")); assert.notEqual(schemaHash({ files }), first);
  const second = schemaHash({ files }); files.set("src/channels/wechat-homer.ts", Buffer.from("changed")); assert.notEqual(schemaHash({ files }), second);
});

// Real supervisor/host/SQLite and synthetic protocol peers only. The copied
// fixture API replaces fetch before compilation; no product injection option.
test("same stable host manages QR, defers upgrade while scanning, restores one main thread and closes channel before database", { timeout: 150000 }, async () => {
  const root = resolve("."), parent = join(root, ".codex/scratch/wechat-integration"); mkdirSync(parent, { recursive: true });
  const base = mkdtempSync(join(parent, "host-"));
  for (const name of ["src", "scripts", "prompts", "assets", "package.json", "package-lock.json", "tsconfig.json"]) cpSync(join(root, name), join(base, name), { recursive: true });
  symlinkSync(join(root, "node_modules"), join(base, "node_modules"), "dir");
  for (const name of ["home", "runtime", "workspace/materials"]) mkdirSync(join(base, name), { recursive: true });
  const binary = join(base, "synthetic-codex.mjs"); cpSync(join(root, "tests/fixtures/dev-upgrade-app-server.mjs"), binary); chmodSync(binary, 0o755);
  const apiFile = join(base, "src/channels/wechat-api.ts"), original = readFileSync(apiFile, "utf8");
  assert.ok(original.includes("private fetcher: typeof fetch = fetch"));
  writeFileSync(apiFile, 'import { syntheticFetch } from "../wechat-synthetic-fetch.js";\n' + original.replace("private fetcher: typeof fetch = fetch", "private fetcher: typeof fetch = syntheticFetch"));
  writeFileSync(join(base, "src/wechat-synthetic-fetch.ts"), `export const syntheticFetch: typeof fetch = async input => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith('/get_bot_qrcode')) return new Response(JSON.stringify({qrcode:'synthetic-only',qrcode_img_content:'https://liteapp.weixin.qq.com/synthetic-host-payload'}));
    if (path.endsWith('/get_qrcode_status')) return new Response(JSON.stringify({status:'wait'}));
    throw new Error('unexpected_fixture_network');
  };`);
  // Widen the preflight/reject scheduling window in this isolated fixture.
  // An active QR must prevent prepare altogether, not tolerate transient 409s.
  const hostFile=join(base,"src/dev-host.ts");
  writeFileSync(hostFile,readFileSync(hostFile,"utf8").replace('frozen = true;\n    if (!app.upgradeStatus().safe', 'frozen = true;\n    await new Promise(resolve=>setTimeout(resolve,100));\n    if (!app.upgradeStatus().safe'));
  const config = join(base, "synthetic.config.json");
  writeFileSync(config, JSON.stringify({ workspace: "workspace", runtime: "runtime", codexHome: join(base, "home"), codexBin: binary, model: "synthetic-only", effort: "medium", requiresOpenaiAuth: false, timeoutMs: 10000, mainTimeoutMs: 10000, stopGraceMs: 100 }));
  const reserve = createServer(); await new Promise(resolve => reserve.listen(0, "127.0.0.1", resolve)); const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
  const url = `http://127.0.0.1:${port}`, events = [], errors = [];
  const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", join(base, "scripts/dev.mjs"), "--web", "--port", String(port), "--config", config, "--json"], { cwd: base, stdio: ["pipe", "pipe", "pipe"] });
  let lines = "", exited = false, completed = false;
  child.stdout.on("data", data => { lines += data; const parts = lines.split("\n"); lines = parts.pop(); for (const line of parts) { try { events.push(JSON.parse(line)); } catch {} } });
  child.stderr.on("data", data => errors.push(String(data))); child.on("exit", () => { exited = true; });
  const fetch=syntheticUserFetch(join(base,'runtime/web-connection/connect-homer.html'));
  const state = async () => { try { return await (await fetch(url + "/api/state")).json(); } catch { return undefined; } };
  const post = (path, body = {}) => fetch(url + path, { method: "POST", headers: { Origin: url, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const lock = () => JSON.parse(readFileSync(join(base, "runtime/cli.lock"), "utf8")).pid;
  try {
    await until(async () => (await state())?.upgrade?.phase === "running" || exited); assert.equal(exited, false, JSON.stringify({ events, errors }));
    const first = await state(), originalPid = lock();
    assert.equal((await (await fetch(url + "/api/channels/wechat")).json()).status, "unconfigured");
    child.stdin.write("synthetic-persist-main\n"); await until(() => events.some(e => e.type === "reply" && e.text === "synthetic-reply"));
    const loginText = await (await post("/api/channels/wechat/login")).text(), login = JSON.parse(loginText);
    assert.equal(login.status, "wait"); assert.doesNotMatch(loginText, /liteapp|payload|qrcode|bot_token/);
    const png = await fetch(url + login.imagePath); assert.equal(png.status, 200); assert.equal(png.headers.get("cache-control"), "no-store");
    assert.equal(Buffer.from(await png.arrayBuffer()).readUInt32BE(16), 320);
    assert.equal((await (await post("/api/channels/wechat/login/poll", { id: login.id })).json()).status, "wait");
    const promptFile = existsSync(join(base, "prompts/main.md")) ? join(base, "prompts/main.md") : join(base, "src/prompts.ts");
    appendFileSync(promptFile, promptFile.endsWith(".md") ? "\n<!-- synthetic QR scan upgrade -->\n" : "\n// synthetic QR scan upgrade\n");
    await until(() => events.some(e => e.text?.includes("构建检查通过"))); await delay(500);
    assert.equal(lock(), originalPid, "active phone scan must not be interrupted by handoff");
    assert.equal((await fetch(url + login.imagePath)).status, 200);
    for(let attempt=0;attempt<20;attempt++){
      assert.equal((await state()).upgrade.phase,"running","busy QR preflight must not freeze the gateway");
      assert.equal((await fetch(url+login.imagePath)).status,200);await delay(20);
    }
    await post("/api/channels/wechat/disable");
    await until(async () => { const s = await state(); return s?.upgrade?.phase === "running" && s.upgrade.version !== first.upgrade.version; });
    assert.notEqual(lock(), originalPid); assert.throws(() => process.kill(originalPid, 0));
    const after = await state(); assert.equal(after.threadId, first.threadId); assert.equal(after.messages.filter(m => m.role === "user").length, 1);
    assert.equal((await (await fetch(url + "/api/channels/wechat")).json()).status, "disabled");
    assert.equal((await fetch(url + login.imagePath)).status, 409);
    child.stdin.end(); await delay(150); assert.equal(exited, false);
    assert.equal(events.filter(e => e.type === "reply" && e.text === "synthetic-reply").length, 1);
    const snapshot = sourceSnapshot(base, config); assert.ok(snapshot.files.has("src/channels/wechat-management.ts"));
    completed = true;
  } finally {
    child.kill("SIGINT"); await until(() => exited, 10000).catch(() => child.kill("SIGTERM"));
    if (!exited) await until(() => exited, 5000);
    const db = new DatabaseSync(join(base, "runtime/homer.sqlite"));
    try { if (completed) assert.equal(db.prepare("SELECT status FROM wechat_connection").get().status, "disabled"); } finally { db.close(); }
    assert.equal(existsSync(join(base, "runtime/cli.lock")), false);
    assert.doesNotMatch(JSON.stringify(events) + errors.join(""), /synthetic-host-payload|bot_token|database is not open/);
    if (completed) rmSync(base, { recursive: true, force: true });
  }
});
