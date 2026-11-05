import {syntheticUserFetch} from "./web-user-connection.mjs";
import {createServer} from "node:net";
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, readFileSync, existsSync, chmodSync, symlinkSync, appendFileSync, readdirSync, unlinkSync } from "node:fs";
import { resolve, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { sourceSnapshot } from "../scripts/dev-build.mjs";
import {waitForDevCondition} from './fixtures/dev-condition.mjs';
import {fixtureBuildEnvironment,fixtureBuildEvidence} from './fixtures/dev-build-trace.mjs';

const root = resolve(".");
const delay = ms => new Promise(r => setTimeout(r, ms));
async function until(check, timeout = 20000) {
  const end = Date.now() + timeout;
  while (!await check()) { if (Date.now() > end) throw new Error("dev_test_timeout"); await delay(30); }
}
test("HMR-UPGRADE-001: real subprocess handoff preserves thread/data/input, defers busy work and rolls back failed starts", { timeout: 120000 }, async t => {
  const parent = join(root, ".codex/scratch/dev-upgrade"); mkdirSync(parent, { recursive: true });
  const base = mkdtempSync(join(parent, "e2e-"));
  for (const name of ["src", "scripts", "prompts", "assets", "package.json", "package-lock.json", "tsconfig.json"]) if (existsSync(join(root, name))) cpSync(join(root, name), join(base, name), { recursive: true });
  symlinkSync(join(root, "node_modules"), join(base, "node_modules"), "dir");
  for (const dir of ["home", "runtime", "workspace/materials"]) mkdirSync(join(base, dir), { recursive: true });
  writeFileSync(join(base, "workspace/materials/meeting.md"), "# Synthetic\n林青：2026-10-20；待确认。");
  writeFileSync(join(base,"src/synthetic-self-development.ts"),'export const syntheticGreeting = "before";\n');
  const binary = join(base, "synthetic-codex.mjs"); cpSync(join(root, "tests/fixtures/dev-upgrade-app-server.mjs"), binary); chmodSync(binary, 0o755);
  const config = join(base, "synthetic.config.json");
  writeFileSync(config, JSON.stringify({ workspace: "workspace", runtime: "runtime", codexHome: join(base, "home"), codexBin: binary, model: "synthetic-only", effort: "medium", requiresOpenaiAuth: false, timeoutMs: 60000, mainTimeoutMs: 60000, stopGraceMs: 200 }));
  const reserve=createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
  const url='http://127.0.0.1:'+port,fetch=syntheticUserFetch();
  const approve=async()=>{await buildUntil(async()=>{try{return !!(await(await fetch(url+'/api/update/review')).json())?.hash;}catch{return false;}});const review=await(await fetch(url+'/api/update/review')).json();assert.ok(review.files.length);assert.equal((await fetch(url+'/api/update/approve',{method:'POST',headers:{Origin:url,'Content-Type':'application/json'},body:JSON.stringify({hash:review.hash})})).status,200);};
  const events = [], errors = [];
  const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", join(base, "scripts/dev.mjs"), "--web","--port",String(port),"--config", config, "--json"], { cwd: base, env:fixtureBuildEnvironment(base), stdio: ["pipe", "pipe", "pipe"] });
  let lines = "", exited = false;
  child.stdout.on("data", bytes => { lines += bytes; const parts = lines.split("\n"); lines = parts.pop(); for (const l of parts) { try { events.push(JSON.parse(l)); } catch {} } });
  child.stderr.on("data", bytes => errors.push(String(bytes)));
  child.on("exit", () => { exited = true; });
  const notices = text => events.filter(e => e.text?.includes(text));
  const send = text => child.stdin.write(text + "\n");
  const active = () => notices("开发版已生效").length;
  const db = () => new DatabaseSync(join(base, "runtime/homer.sqlite"));
  const query = (sql, ...params) => { const d = db(); try { return d.prepare(sql).all(...params); } finally { d.close(); } };
  const lockPid = () => JSON.parse(readFileSync(join(base, "runtime/cli.lock"))).pid;
  const promptFile = existsSync(join(base, "prompts/main.md")) ? join(base, "prompts/main.md") : join(base, "src/prompts.ts");
  const edit = text => appendFileSync(promptFile, "\n" + (promptFile.endsWith(".md") ? "<!-- " + text + " -->" : "// " + text) + "\n");
  const assertDead = pid => assert.throws(() => process.kill(pid, 0));
  const buildUntil=check=>waitForDevCondition(check,{signal:t.signal,events:[],exited:()=>exited});
  const buildReady=check=>waitForDevCondition(check,{signal:t.signal,events,exited:()=>exited});
  try {
    await buildReady(() => active() === 1); assert.equal(exited, false, JSON.stringify({ events, errors }));
    const originalPid = lockPid();
    const initialBuilds = join(base, ".codex/scratch/dev-upgrade/builds");
    const contender = spawnSync(process.execPath, [join(initialBuilds, readdirSync(initialBuilds)[0], "dist/cli.js"), "--config", config, "--json", "--message", "synthetic-lock-probe"], { cwd: base, encoding: "utf8", timeout: 5000 });
    assert.equal(contender.status, 1); assert.match(contender.stdout, /runtime_already_open/);
    assert.equal(lockPid(), originalPid);
    const thread = query("SELECT value FROM meta WHERE key='mainThread'")[0].value;
    send("dispatch-synthetic");
    await until(() => existsSync(join(base, "home/worker-running")));
    const workerPid = Number(readFileSync(join(base, "home/worker-running")));
    await until(()=>existsSync(join(base,"home/self-development-tested.json")));
    assert.deepEqual(JSON.parse(readFileSync(join(base,"home/self-development-tested.json"),"utf8")),{synthetic:true,sourceModified:true,testExit:0});
    assert.match(readFileSync(join(base,"src/synthetic-self-development.ts"),"utf8"),/"after"/);
    await until(()=>notices("等待真实用户审阅").length===1);assert.equal(lockPid(),originalPid);await approve();
    await buildReady(() => notices("构建检查通过").length === 1);
    await delay(600); assert.equal(lockPid(), originalPid); process.kill(workerPid, 0);
    send("while-worker-busy"); await until(() => events.some(e => e.type === "reply" && e.text === "synthetic-reply"));
    writeFileSync(join(base, "home/release-worker"), "1");
    await until(() => active() === 2); assertDead(originalPid); assertDead(workerPid);
    assert.equal(query("SELECT value FROM meta WHERE key='mainThread'")[0].value, thread);
    const savedRuns = query("SELECT * FROM runs"); assert.equal(savedRuns.length, 1); assert.equal(savedRuns[0].status, "succeeded"); assert.equal(query("SELECT state FROM deliveries WHERE taskId=?",savedRuns[0].taskId)[0]?.state,"recorded");
    const savedRequests = query("SELECT * FROM requests");
    // A main round also blocks handoff; changes within debounce coalesce.
    send("hold-main"); await until(() => existsSync(join(base, "home/main-running")));
    const mainPid = lockPid(); edit("coalesce 1"); edit("coalesce 2");
    await buildReady(() => notices("构建检查通过").length === 2); assert.equal(lockPid(), mainPid);
    const beforeReplies = events.filter(e => e.type === "reply").length;
    writeFileSync(join(base, "home/hold-resume"), "1");
    writeFileSync(join(base, "home/release-main"), "1");
    await until(() => existsSync(join(base, "home/resume-waiting")));
    assertDead(mainPid);
    // Submit while the old process has exited and the new engine is gated.
    for (let i = 0; i < 8; i++) send("handoff-input-" + i);
    await delay(150);
    assert.equal(events.filter(e => e.type === "reply").length, beforeReplies + 1);
    writeFileSync(join(base, "home/release-resume"), "1");
    await until(() => active() === 3);
    await until(() => events.filter(e => e.type === "reply").length === beforeReplies + 9);
    assert.equal(query("SELECT count(*) n FROM requests")[0].n, savedRequests.length + 9);
    assert.deepEqual(query("SELECT * FROM runs"), savedRuns);
    for (const request of savedRequests) assert.deepEqual(query("SELECT * FROM requests WHERE id=?", request.id)[0], request);
    // Compile failure leaves current immutable process usable.
    const goodSource = readFileSync(join(base, "src/prompts.ts"), "utf8"); const goodPid = lockPid();
    appendFileSync(join(base, "src/prompts.ts"), "\nconst broken: = ;\n");await approve();
    await buildUntil(() => notices("dev_candidate_check_failed").length > 0); assert.equal(lockPid(), goodPid);
    send("after-bad-build"); await until(() => events.filter(e => e.type === "reply").length === beforeReplies + 10);
    writeFileSync(join(base, "src/prompts.ts"), goodSource);
    // Runtime-only startup failure occurs after lock acquisition and requires rollback.
    const servicePath = join(base, "src/service.ts"), goodService = readFileSync(servicePath, "utf8");
    writeFileSync(servicePath, goodService + "\nprocess.exit(29);\n");await approve();
    await buildUntil(() => notices("dev_candidate_import_failed").length > 0);
    assert.equal(lockPid(), goodPid, "candidate top-level exit cannot kill the stable launcher or current host");
    const startSignature='async start(options:{keepManagementOnFailure?:boolean}={}) {';
    assert.equal(goodService.split(startSignature).length,2,'rollback fixture must match the unique Homer.start declaration');
    writeFileSync(servicePath, goodService.replace(startSignature,startSignature+'\n    if (this.store.meta("mainThread")) { await this.close(); throw new Error("synthetic_start_failure"); }'));
    await approve();await buildUntil(() => notices("正在恢复旧版").length > 0);
    send("during-rollback");
    await buildUntil(() => notices("开发版已恢复旧版").length === 1);
    await until(() => events.filter(e => e.type === "reply").length === beforeReplies + 11);
    assert.equal(query("SELECT value FROM meta WHERE key='mainThread'")[0].value, thread);
    assert.deepEqual(query("SELECT * FROM runs"), savedRuns);
    writeFileSync(servicePath, goodService);
    // Dependency/tool/schema guards must never reach the runtime.
    const manifest = join(base, "package.json"), originalManifest = readFileSync(manifest, "utf8");
    const p = JSON.parse(originalManifest); p.devDependencies.synthetic = "1.0.0"; writeFileSync(manifest, JSON.stringify(p));
    await buildUntil(() => notices("dev_dependencies_changed_restart_required").length > 0);
    writeFileSync(manifest, originalManifest);
    const tools = join(base, "src/tools.ts"), originalTools = readFileSync(tools, "utf8");
    writeFileSync(tools, originalTools+'\nMAIN_TOOLS[0]!.description += " Synthetic tool migration probe.";\n');await approve();
    await buildUntil(() => notices("main_tools_migration_required").length > 0);
    writeFileSync(tools, originalTools);
    const storePath = join(base, "src/store.ts"), originalStore = readFileSync(storePath, "utf8");
    appendFileSync(storePath, "\n// schema change guard\n");
    await buildUntil(() => notices("dev_schema_change_requires_review").length > 0);
    // Generated files don't enter the watched fingerprint.
    const hash = sourceSnapshot(base, config).hash;
    mkdirSync(join(base, "dist"), { recursive: true }); writeFileSync(join(base, "dist/generated.js"), "ignored");
    assert.equal(sourceSnapshot(base, config).hash, hash);
    // Quit while the replacement is still restoring the engine, without orphaning it.
    unlinkSync(join(base, "home/release-resume")); unlinkSync(join(base, "home/resume-waiting"));
    writeFileSync(storePath, originalStore); edit("quit during startup");
    await until(() => existsSync(join(base, "home/resume-waiting")));
    const lastPid = lockPid(); send("/quit");
    await delay(100); writeFileSync(join(base, "home/release-resume"), "1");
    await until(() => exited);
    assertDead(lastPid); assert.equal(existsSync(join(base, "runtime/cli.lock")), false);
    const engineEvents = readFileSync(join(base, "home/process-events.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
    for (const e of engineEvents) assertDead(e.pid);
    assert.equal(query("PRAGMA integrity_check")[0].integrity_check, "ok");
    writeFileSync(join(base, "verified-checks.json"), JSON.stringify({ verified: true, synthetic: true, realAccount: false, realModel: false, workerSourceModification: true, workerProjectTestExit:0, offline: true, realProcesses: true, handoffs: active() - 1, rollback: true, threadPreserved: true, runsPreserved: true, exactlyOnceInputCount: 8, engineProcessesCleaned: engineEvents.length, checks: ["busy-worker", "busy-main", "delivery-before-switch", "immutable-build", "failed-build", "failed-start-rollback", "input-handoff", "same-thread", "same-business-data", "dependencies-guard", "tools-guard", "schema-guard", "watch-exclusions", "exit-cleanup"] }, null, 2));
  } finally {
    if(!existsSync(join(base,'verified-checks.json')))t.diagnostic(JSON.stringify({fixture:'dev-upgrade',buildStages:fixtureBuildEvidence(base)}));
    if (!exited) { send("/quit"); await until(() => exited, 5000).catch(() => child.kill("SIGTERM")); }
    if (errors.length) writeFileSync(join(base, "test-stderr.txt"), errors.join(""));
  }
});
