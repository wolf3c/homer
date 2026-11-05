// Real natural-language queue, clarification, missing input, and idempotent CLI checks.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { DatabaseSync } from "node:sqlite";
import { resolve, join } from "node:path";
import { mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { engineError } from "../src/engine.js";
const saveTranscript = process.argv.includes("--save-public-transcript");
const configPath = process.argv[2];
if (!configPath) throw new Error("Pass a dedicated scratch config");
const resolvedConfigPath = resolve(configPath);
const config = loadConfig(resolvedConfigPath);
assert.ok(config.workspace.startsWith(resolve(".codex/scratch") + "/"));
const evidence = resolve(".codex/scratch/real-routing");
mkdirSync(evidence, { recursive: true });
mkdirSync(join(config.workspace, "materials"), { recursive: true });
writeFileSync(
  join(config.workspace, "materials", "long-meeting.md"),
  "# 虚构长会议\n" +
    Array.from(
      { length: 180 },
      (_, i) =>
        `- 测试行动${i + 1}：准备第${i + 1}项非敏感说明。负责人、时间均待确认。`,
    ).join("\n"),
);
copyFileSync(
  "tests/fixtures/meeting-notes.md",
  join(config.workspace, "materials", "meeting-notes.md"),
);
const checks: any[] = [];
const transcript: any[] = [];
function rows(sql = "SELECT * FROM runs ORDER BY createdAt,rowid",parameters:string[] = []) {
  try {
    const db = new DatabaseSync(join(config.runtime, "homer.sqlite"), {
      readOnly: true,
    });
    try {
      return db
        .prepare(sql)
        .all(...parameters) as any[];
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}
function launch(extra: string[] = []) {
  const child = spawn(
    process.execPath,
    [
      "--disable-warning=ExperimentalWarning",
      "dist/cli.js",
      "--config",
      resolvedConfigPath,
      "--json",
      ...extra,
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  const messages: any[] = [];
  let exited = false;
  let code: number | null = null;
  child.stderr.resume();
  child.stdin.on("error", () => {});
  child.on("exit", (c) => {
    exited = true;
    code = c;
  });
  createInterface({ input: child.stdout }).on("line", (line) => {
    try {
      const m = JSON.parse(line);
      messages.push(m);
      transcript.push(m);
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
  fn: () => T | undefined | false,
  timeout = 240000,
): Promise<T> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error("routing_wait_timeout");
}
async function say(p: ReturnType<typeof launch>, text: string) {
  const at = p.messages.length;
  p.child.stdin.write(text + "\n");
  return wait(() => p.messages.slice(at).find((m) => m.type === "reply"));
}
let live: ReturnType<typeof launch> | undefined;
try {
  assert.equal(rows().length, 0, "Use a fresh runtime");
  live = launch();
  await wait(() => live!.messages.some((m) => m.type === "progress"));
  await say(
    live,
    "请新建事项“长会议详解”，读取 long-meeting.md，把180项行动全部写成 Markdown，每项补充200字通用执行说明，并明确这只是建议不是会议承诺。不要省略原编号，负责人和时间仍待确认。",
  );
  const first = await wait(() =>
    rows().find((r) => r.status === "running" && r.turnId),
  );
  await say(
    live,
    "再新建另一事项“短会议清单”，读取 meeting-notes.md，整理成 Markdown 行动清单，未知负责人或时间标待确认，讨论和暂缓不升级为行动承诺。",
  );
  const second = rows().find((r) => r.id !== first.id);
  assert.ok(second);
  assert.ok(["running", "succeeded"].includes(second.status));
  assert.ok(second.startedAt < (rows().find((r) => r.id === first.id)!.endedAt ?? Date.now() + 1));
  checks.push({
    test: "T06-real-concurrent-dispatch",
    passed: true,
    active: first.id,
    second: second.id,
  });
  const ambiguous = await say(live, "把那个按负责人重新整理一下。");
  assert.match(ambiguous.text, /哪|指|明确|？|\?/);
  assert.equal(rows().length, 2);
  checks.push({
    test: "T06-real-ambiguity",
    passed: true,
    noUnexpectedRun: true,
  });
  await say(
    live,
    `停止“长会议详解”这项工作，runId 是 ${first.id}。只停止它，保留另一项工作。`,
  );
  const stopped = rows().find((r) => r.id === first.id)!;
  assert.ok(["cancelled", "failed", "succeeded"].includes(stopped.status));
  if (stopped.status === "cancelled") {
    assert.ok(stopped.stopRequestedAt);
    assert.equal(JSON.parse(stopped.checkpointJson??'{}').workerExitConfirmed,1);
    assert.equal(rows('SELECT key FROM meta WHERE key=?',['lease:'+stopped.id]).length,0);
  }
  checks.push({
    test: "T08-real-natural-stop-or-terminal-noop",
    passed: true,
    runId: first.id,
    status: stopped.status,
    stopRequested: !!stopped.stopRequestedAt,
  });
  await wait(() => {
    const ids=new Set(rows("SELECT d.id FROM deliveries d JOIN json_each(d.resultIdsJson) i JOIN results r ON r.id=i.value WHERE r.runId=? AND d.state='recorded' AND d.revokedAt IS NULL",[second.id]).map(row=>row.id));
    return live!.messages.some(message=>message.type==='delivery'&&ids.has(message.deliveryId));
  });
  assert.equal(rows().find((r) => r.id === second.id).status, "succeeded");
  live.child.stdin.end();
  await wait(() => live!.exited);
  assert.equal(live.code, 0);
  const missing =
    "请新建一个缺失输入验收事项，读取 missing-public-notes.md 并写 Markdown。这个文件确实不存在，允许执行一次检查；读取失败就报告失败，绝不能编造材料或成果。";
  live = launch([
    "--request-id",
    "real-missing-input-once",
    "--message",
    missing,
  ]);
  await wait(() => live!.exited);
  assert.equal(live.code, 0);
  const failed = rows().find((r) => (r.sourceRequestId ?? r.requestId) === "real-missing-input-once");
  assert.ok(failed);
  assert.ok(!['queued','running'].includes(failed.status));
  assert.equal(rows('SELECT outcome FROM tasks WHERE id=?',[failed.taskId])[0]?.outcome,'failed');
  const missingReply=rows("SELECT payloadJson FROM agent_messages WHERE kind='worker_reply' AND senderRunId=?",[failed.id])[0];
  assert.ok(missingReply);assert.match(JSON.parse(missingReply.payloadJson).text,/不存在|未找到|缺失|missing|not found/i);
  assert.equal(Number(rows("SELECT count(*) n FROM results WHERE taskId=? AND kind='file'",[failed.taskId])[0]!.n),0);
  checks.push({
    test: "T07-real-missing-input",
    passed: true,
    runId: failed.id,
    taskId: failed.taskId,
    outcome: 'failed',
    fabricatedFiles: false,
  });
  const count = rows().length;
  live = launch([
    "--request-id",
    "real-missing-input-once",
    "--message",
    missing,
  ]);
  await wait(() => live!.exited);
  assert.equal(live.code, 0);
  assert.equal(rows().length, count);
  assert.ok(live.messages.some((m) => m.type === "reply"));
  checks.push({
    test: "T10-real-duplicate-request",
    passed: true,
    noDuplicateRun: true,
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
    join(evidence, "routing-checks.json"),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        model: config.model,
        sourceType: "synthetic",
        transcriptSaved: saveTranscript,
        checks,
      },
      null,
      2,
    ),
  );
  if (saveTranscript)
    writeFileSync(
      join(evidence, "public-routing-transcript.jsonl"),
      transcript.map((m) => JSON.stringify(m)).join("\n") + "\n",
    );
}
