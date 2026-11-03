import {syntheticUserFetch} from './web-user-connection.mjs';
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdirSync, mkdtempSync, cpSync, symlinkSync, writeFileSync, readFileSync, appendFileSync, existsSync, rmSync, chmodSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { schemaHash } from "../scripts/dev-build.mjs";

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, timeout = 45000) {
  const end = Date.now() + timeout;
  while (!await check()) { if (Date.now() > end) throw new Error("telegram_host_fixture_timeout"); await delay(40); }
}
test("Telegram schema owners prevent unreviewed automatic handoff", () => {
  const files = new Map([["src/channels/telegram-store.ts", Buffer.from("synthetic-schema")], ["src/channels/telegram-secrets.ts", Buffer.from("synthetic-credential-reference")]]);
  const first = schemaHash({ files }); files.set("src/channels/telegram-store.ts", Buffer.from("changed")); assert.notEqual(schemaHash({ files }), first);
  const second = schemaHash({ files }); files.set("src/channels/telegram-secrets.ts", Buffer.from("changed")); assert.notEqual(schemaHash({ files }), second);
});

// Actual stable launcher, IPC host, engine protocol peer and SQLite. Entirely
// synthetic private fixture: no production runtime, real model or Bot account.
test("TG local settings shares Web/CLI/WeChat host and survives stable handoff with one original main", { timeout: 120000 }, async () => {
  const root = resolve("."), parent = join(root, ".codex/scratch/telegram-plan"); mkdirSync(parent, { recursive: true });
  const base = mkdtempSync(join(parent, "host-upgrade-"));
  for (const name of ["src", "scripts", "prompts", "assets", "package.json", "package-lock.json", "tsconfig.json"]) cpSync(join(root, name), join(base, name), { recursive: true });
  symlinkSync(join(root, "node_modules"), join(base, "node_modules"), "dir");
  for (const name of ["home", "runtime", "workspace/materials"]) mkdirSync(join(base, name), { recursive: true });
  const binary = join(base, "synthetic-codex.mjs"); cpSync(join(root, "tests/fixtures/dev-upgrade-app-server.mjs"), binary); chmodSync(binary, 0o755);
  const config = join(base, "synthetic.config.json");
  writeFileSync(config, JSON.stringify({ workspace: "workspace", runtime: "runtime", codexHome: join(base, "home"), codexBin: binary, model: "synthetic-only", effort: "medium", requiresOpenaiAuth: false, timeoutMs: 10000, mainTimeoutMs: 10000, stopGraceMs: 100 }));
  const reserve = createServer(); await new Promise(resolve => reserve.listen(0, "127.0.0.1", resolve)); const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
  const url = `http://127.0.0.1:${port}`, events = [], errors = [];
  const launch = () => spawn(process.execPath, ["--disable-warning=ExperimentalWarning", join(base, "scripts/dev.mjs"), "--web", "--port", String(port), "--config", config, "--json"], { cwd: base, stdio: ["pipe", "pipe", "pipe"] });
  let child = launch();
  let lines = "", exited = false, completed = false;
  const observe = process => {
    process.stdout.on("data", data => { lines += data; const parts = lines.split("\n"); lines = parts.pop(); for (const line of parts) { try { events.push(JSON.parse(line)); } catch {} } });
    process.stderr.on("data", data => errors.push(String(data))); process.on("exit", () => { exited = true; });
  };
  observe(child);
  const fetch=syntheticUserFetch(join(base,'runtime/web-connection/connect-homer.html'));
  const state = async () => { try { return await (await fetch(url + "/api/state")).json(); } catch { return undefined; } };
  const lock = () => JSON.parse(readFileSync(join(base, "runtime/cli.lock"), "utf8")).pid;
  try {
    await until(async () => (await state())?.upgrade?.phase === "running" || exited); assert.equal(exited, false, JSON.stringify({ events, errors }));
    const first = await state(), originalPid = lock();
    assert.equal((await (await fetch(url + "/api/channels/telegram")).json()).configured, false);
    assert.equal((await (await fetch(url + "/api/channels/wechat")).json()).status, "unconfigured");
    const page = await fetch(url + "/settings/telegram"); assert.equal(page.status, 200); assert.match(await page.text(), /Bot Token/);
    assert.equal((await fetch(url + "/settings/telegram.js")).status, 200);
    const backups = readdirSync(join(base, "runtime/backups")); assert.equal(backups.length, 1); assert.equal(statSync(join(base, "runtime/backups", backups[0])).mode & 0o777, 0o600);
    child.stdin.write("synthetic-persist-main\n"); await until(() => events.some(e => e.type === "reply" && e.text === "synthetic-reply"));
    const promptFile = existsSync(join(base, "prompts/main.md")) ? join(base, "prompts/main.md") : join(base, "src/prompts.ts");
    appendFileSync(promptFile, promptFile.endsWith(".md") ? "\n<!-- synthetic Telegram host upgrade -->\n" : "\n// synthetic Telegram host upgrade\n");
    const settingsFile = join(base, "src/channels/telegram-settings-page.ts");
    const settingsMarker = "synthetic-new-settings";
    await until(async () => { const s = await state(); return s?.upgrade?.phase === "running" && s.upgrade.version !== first.upgrade.version; });
    assert.notEqual(lock(), originalPid); assert.throws(() => process.kill(originalPid, 0));
    const after = await state(); assert.equal(after.threadId, first.threadId); assert.equal(after.messages.filter(m => m.role === "user").length, 1);
    assert.equal((await (await fetch(url + "/api/channels/telegram")).json()).configured, false);
    assert.equal((await (await fetch(url + "/api/channels/wechat")).json()).status, "unconfigured");
    assert.equal(readdirSync(join(base, "runtime/backups")).length, 1);
    // A prompt-only handoff remains automatic. Resident executable changes
    // require explicit gateway restart even if a source review were approved.
    const adoptedPid = lock();
    writeFileSync(settingsFile, readFileSync(settingsFile, "utf8").replace("Bot Token", "Bot Token " + settingsMarker));
    await until(() => events.some(e => JSON.stringify(e).includes("dev_gateway_changed_restart_required")));
    assert.equal(lock(), adoptedPid);
    assert.equal((await state()).upgrade.version, after.upgrade.version);
    assert.equal(await (await fetch(url + "/api/update/review")).json(), null);
    assert.doesNotMatch(await (await fetch(url + "/settings/telegram")).text(), /synthetic-new-settings/);
    assert.equal(after.isRunning, false); assert.equal(after.work.length, 0);
    child.stdin.write("/quit\n"); await until(() => exited, 10000);
    assert.equal(existsSync(join(base, "runtime/cli.lock")), false);
    exited = false; lines = ""; child = launch(); observe(child);
    await until(async () => (await state())?.upgrade?.phase === "running" || exited);
    assert.equal(exited, false);
    const restarted = await state();
    assert.equal(restarted.threadId, first.threadId);
    assert.equal(restarted.messages.filter(m => m.role === "user").length, 1);
    assert.match(await (await fetch(url + "/settings/telegram")).text(), /synthetic-new-settings/);
    child.stdin.end(); await delay(150); assert.equal(exited, false);
    completed = true;
  } finally {
    child.kill("SIGINT"); await until(() => exited, 10000).catch(() => child.kill("SIGTERM"));
    if (!exited) await until(() => exited, 5000);
    assert.equal(existsSync(join(base, "runtime/cli.lock")), false);
    assert.doesNotMatch(JSON.stringify(events) + errors.join(""), /bot_token|database is not open/);
    if (completed) rmSync(base, { recursive: true, force: true });
  }
});
