// Safe real-Codex lifecycle and isolation checks. No private source content is used.
import { spawn, execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import { DatabaseSync } from "node:sqlite";
import { resolve, join, dirname } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { sampleProcessTree, processIdentity } from "../src/processes.js";
import { engineError } from "../src/engine.js";
const configPath = process.argv[2];
if (!configPath)
  throw new Error("Usage: tsx scripts/real-controls.ts scratch-config.json");
const config = loadConfig(configPath);
assert.ok(config.workspace.startsWith(resolve(".codex/scratch") + "/"));
const evidence = resolve(".codex/scratch/real-controls");
mkdirSync(evidence, { recursive: true });
mkdirSync(join(config.workspace, "materials"), { recursive: true });
writeFileSync(
  join(config.workspace, "materials", "long-meeting.md"),
  "# 虚构会议记录\n\n" +
    Array.from(
      { length: 180 },
      (_, i) =>
        `- 测试行动${i + 1}：准备第${i + 1}项非敏感说明。负责人、时间均待确认。`,
    ).join("\n"),
);
const checks: any[] = [];
const resources: any[] = [];
function rows(sql = "SELECT * FROM runs ORDER BY createdAt,rowid") {
  try {
    const db = new DatabaseSync(join(config.runtime, "homer.sqlite"), {
      readOnly: true,
    });
    try {
      return db.prepare(sql).all() as any[];
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}
function launch(path = configPath!) {
  const child = spawn(
    process.execPath,
    [
      "--disable-warning=ExperimentalWarning",
      "dist/cli.js",
      "--config",
      resolve(path),
      "--json",
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  const messages: any[] = [];
  let exited = false;
  let code: number | null = null;
  child.stdin.on("error", () => {});
  child.stderr.resume();
  child.on("exit", (c) => {
    exited = true;
    code = c;
  });
  createInterface({ input: child.stdout }).on("line", (line) => {
    try {
      const m = JSON.parse(line);
      messages.push(m);
      console.log(m.type, m.runId ?? "");
    } catch {}
  });
  return {
    child,
    messages,
    get exited() {
      return exited;
    },
    get code() {
      return code;
    },
  };
}
async function wait<T>(
  fn: () => T | false | undefined,
  timeout = 180000,
): Promise<T> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error("controls_wait_timeout");
}
function send(p: ReturnType<typeof launch>, text: string) {
  p.child.stdin.write(text + "\n");
}
function sample(p: ReturnType<typeof launch>, phase: string) {
  resources.push({ phase, ...sampleProcessTree(p.child.pid!) });
}
async function running(p: ReturnType<typeof launch>) {
  const before = new Set(rows().map((r) => r.id));
  send(
    p,
    "请新建事项，读取 long-meeting.md，将全部180项行动逐条写成完整 Markdown 表格，保留每一项的编号、负责人和截止时间待确认字段，不要省略。",
  );
  return wait(() =>
    rows().find((r) => !before.has(r.id) && r.status === "running" && r.turnId),
  );
}
let live: ReturnType<typeof launch> | undefined;
try {
  assert.equal(rows().length, 0, "Use a fresh runtime");
  live = launch();
  await wait(() => live!.messages.some((m) => m.type === "progress"));
  sample(live, "idle");
  const run = await running(live);
  sample(live, "active-worker-before-SIGINT");
  live.child.kill("SIGINT");
  await wait(() => live!.exited);
  assert.equal(live.code, 0);
  const stopped = rows().find((r) => r.id === run.id);
  assert.equal(stopped.status, "cancelled");
  assert.ok(stopped.stopRequestedAt);
  assert.equal(stopped.errorCode, "stop_confirmed");
  assert.equal(processIdentity(stopped.pid), undefined);
  checks.push({
    test: "T08-real-safe-stop",
    passed: true,
    runId: run.id,
    status: stopped.status,
    code: stopped.errorCode,
  });
  live = launch();
  await wait(() => live!.messages.some((m) => m.type === "progress"));
  const crashRun = await running(live);
  sample(live, "before-crash");
  live.child.kill("SIGKILL");
  await wait(() => live!.exited);
  live = launch();
  await wait(() => live!.messages.some((m) => m.type === "progress"));
  assert.equal(rows().find((r) => r.id === crashRun.id).status, "interrupted");
  assert.equal(rows().find((r) => r.id === run.id).status, "cancelled");
  assert.equal(rows().length, 2);
  assert.equal(processIdentity(crashRun.pid), undefined);
  send(live, "请查询所有尚未完成的事项，说明停止和中断的实际状态；不要重试。");
  await wait(() => live!.messages.some((m) => m.type === "reply"));
  assert.equal(rows().length, 2);
  live.child.stdin.end();
  await wait(() => live!.exited);
  assert.equal(live.code, 0);
  checks.push({
    test: "T09-real-crash-restart",
    passed: true,
    runId: crashRun.id,
    status: "interrupted",
    replayed: false,
    previousStoppedRecordPreserved: true,
  });
  // Invoke the installed Codex sandbox directly so denial is an OS result, independent of prompt compliance.
  const allowed = join(config.workspace, "materials");
  const outside = join(evidence, "outside-public.txt");
  writeFileSync(outside, "PUBLIC_DENIED_SENTINEL");
  const profile = `{":root"="deny",":minimal"="read",${JSON.stringify(dirname(config.codexBin))}="read",${JSON.stringify(allowed)}="read"}`;
  try {
    execFileSync(
      config.codexBin,
      [
        "sandbox",
        "-C",
        allowed,
        "-P",
        "homer_security",
        "-c",
        `permissions.homer_security.filesystem=${profile}`,
        "-c",
        "permissions.homer_security.network.enabled=false",
        "/bin/sh",
        "-c",
        'cat "$1"; printf bad > "$2"',
        "probe",
        outside,
        join(allowed, "unauthorized.md"),
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10000 },
    );
    throw new Error("isolation_unexpected_success");
  } catch (e: any) {
    assert.ok(e.status !== 0);
    assert.ok(!String(e.stdout ?? "").includes("PUBLIC_DENIED_SENTINEL"));
    assert.match(String(e.stderr), /Operation not permitted/);
    checks.push({
      test: "T11-real-OS-sandbox",
      passed: true,
      readOutsideDenied: true,
      writeDenied: true,
      commandExit: e.status,
    });
  }
  try {
    execFileSync(
      config.codexBin,
      [
        "sandbox",
        "-C",
        allowed,
        "-P",
        "homer_security",
        "-c",
        `permissions.homer_security.filesystem=${profile}`,
        "-c",
        "permissions.homer_security.network.enabled=false",
        "/usr/bin/nc",
        "-zv",
        "127.0.0.1",
        "9",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10000 },
    );
    throw new Error("network_unexpected_success");
  } catch (e: any) {
    assert.match(String(e.stderr), /Operation not permitted/);
    checks.push({
      test: "T11-real-network-denial",
      passed: true,
      permissionDenied: true,
    });
  }
  // Timeout a genuine App Server turn, using a distinct runtime and the same authorized connection.
  const timeoutConfig = join(evidence, "timeout.config.json");
  writeFileSync(
    timeoutConfig,
    JSON.stringify(
      {
        ...config,
        runtime: config.runtime + "-timeout",
        timeoutMs: 1000,
      },
      null,
      2,
    ),
  );
  live = launch(timeoutConfig);
  await wait(() => live!.messages.some((m) => m.type === "progress"));
  send(
    live,
    "请读取 long-meeting.md，把全部180项行动逐条写成完整 Markdown 表格，不要省略。",
  );
  const tdb = () => {
    try {
      const db = new DatabaseSync(
        join(config.runtime + "-timeout", "homer.sqlite"),
        { readOnly: true },
      );
      try {
        return db.prepare("SELECT * FROM runs").all() as any[];
      } finally {
        db.close();
      }
    } catch {
      return [];
    }
  };
  const timed = await wait(() => tdb().find((r) => r.status === "failed"));
  assert.equal(timed.errorCode, "timeout");
  assert.ok(timed.stopRequestedAt);
  live.child.stdin.end();
  await wait(() => live!.exited);
  assert.equal(live.code, 0);
  checks.push({
    test: "T08-real-timeout",
    passed: true,
    runId: timed.id,
    status: timed.status,
    code: timed.errorCode,
  });
} catch (e) {
  checks.push({
    passed: false,
    errorCode:
      e instanceof assert.AssertionError
        ? "scenario_assertion_failed"
        : engineError(e),
  });
  live?.child.kill("SIGTERM");
  process.exitCode = 1;
} finally {
  writeFileSync(
    join(evidence, "lifecycle-checks.json"),
    JSON.stringify(
      { at: new Date().toISOString(), model: config.model, checks, resources },
      null,
      2,
    ),
  );
}
