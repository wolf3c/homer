// Explicit real-model verification. Only a dedicated non-sensitive scratch workspace is allowed.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { sampleProcessTree } from "../src/processes.js";
import { codexVersion, engineError } from "../src/engine.js";
import {
  MEETING_REVISION,
  assertMeetingArtifact,
} from "../tests/scenarios/meeting-revision.js";
const scenario = MEETING_REVISION;
const saveTranscript = process.argv.includes("--save-public-transcript");
const configPath = process.argv[2];
if (!configPath)
  throw new Error(
    "Usage: npm run test:real -- .codex/scratch/acceptance.config.json",
  );
const config = loadConfig(configPath);
const evidence = resolve(".codex/scratch/scenario-regressions", scenario.id);
mkdirSync(evidence, { recursive: true });
assert.ok(
  config.workspace.startsWith(resolve(".codex/scratch") + "/"),
  "Real acceptance requires a dedicated scratch workspace",
);
const dbPath = join(config.runtime, "homer.sqlite");
assert.equal(rows().length, 0, "Use a fresh runtime for the scenario");
mkdirSync(join(config.workspace, "materials"), { recursive: true });
copyFileSync(
  scenario.fixture.path,
  join(config.workspace, "materials", scenario.fixture.filename),
);
const child = spawn(
  process.execPath,
  [
    "--disable-warning=ExperimentalWarning",
    "dist/cli.js",
    "--config",
    resolve(configPath),
    "--json",
  ],
  { stdio: ["pipe", "pipe", "pipe"] },
);
const messages: any[] = [];
const checks: any[] = [];
const resources: any[] = [];
let exitCode: number | null | undefined;
let stderrBytes = 0;
let stage = "startup";
child.stderr.on("data", (b) => (stderrBytes += b.length));
child.on("exit", (code) => (exitCode = code));
child.stdin.on("error", () => {});
createInterface({ input: child.stdout }).on("line", (line) => {
  try {
    const m = JSON.parse(line);
    messages.push({ ...m, at: Date.now() });
    console.log(m.type, m.runId ?? "");
  } catch {}
});
const deadline = Date.now() + 12 * 60 * 1000;
async function wait<T>(
  fn: () => T | undefined | false,
  timeout = 180000,
): Promise<T> {
  const end = Math.min(deadline, Date.now() + timeout);
  while (Date.now() < end) {
    const found = fn();
    if (found) return found;
    if (exitCode !== undefined) throw new Error("CLI exited " + exitCode);
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error("acceptance_wait_timeout");
}
function rows(sql = "SELECT * FROM runs ORDER BY createdAt,rowid", parameters: string[] = []) {
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      return db.prepare(sql).all(...parameters) as any[];
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}
function publication(runId: string) {
  const files=rows("SELECT r.id,r.filePath,r.sha256 FROM results r JOIN deliveries d ON d.taskId=r.taskId JOIN json_each(d.resultIdsJson) i ON i.value=r.id WHERE r.runId=? AND r.kind='file' AND d.state='recorded' AND d.revokedAt IS NULL",[runId]);
  assert.equal(files.length,1,'one_formal_file_required');
  return files[0]!;
}
function delivered(runId: string) {
  const ids=new Set(rows("SELECT d.id FROM deliveries d JOIN json_each(d.resultIdsJson) i JOIN results r ON r.id=i.value WHERE r.runId=? AND d.state='recorded' AND d.revokedAt IS NULL",[runId]).map(row=>row.id));
  return messages.find(message=>message.type==='delivery'&&ids.has(message.deliveryId));
}
function send(text: string) {
  child.stdin.write(text + "\n");
}
async function say(text: string) {
  const at = messages.length;
  send(text);
  return wait(() => messages.slice(at).find((m) => m.type === "reply"));
}
function sample(phase: string) {
  resources.push({ phase, ...sampleProcessTree(child.pid!) });
}
const sampler = setInterval(() => {
  try {
    sample(
      rows().some((r) => r.status === "running")
        ? "worker-active"
        : "main-or-idle",
    );
  } catch {}
}, 500);
try {
  await wait(() => messages.find((m) => m.type === "progress"));
  sample("idle");
  stage = "T01";
  await say(scenario.messages.remember);
  const countBefore = rows().length;
  const second = await say(scenario.messages.recall);
  assert.match(second.text, /海鸥47/);
  assert.equal(rows().length, countBefore);
  checks.push({ test: "T01", passed: true });
  stage = "T02-dispatch";
  const at = messages.length;
  send(scenario.messages.dispatch);
  const run = await wait(() =>
    rows().find(
      (r) => r.createdAt >= messages[at - 1]!.at && r.status === "running",
    ),
  );
  const activeAtQuery = Date.now();
  stage = "T03";
  sample("worker-before-status-query");
  send(scenario.messages.progress);
  sample("main-query-and-worker");
  const statusReply = await wait(() =>
    messages
      .slice(at)
      .filter((m) => m.type === "reply")
      .at(1),
  );
  assert.ok(statusReply.text.length > 0);
  assert.ok(
    rows("SELECT type,code,at FROM events").some(
      (e) =>
        e.type === "main_tool" &&
        ["list_work", "work_inspect", "worker_read"].includes(e.code) &&
        e.at >= activeAtQuery &&
        e.at <= statusReply.at,
    ),
    "Progress must query persistent facts through a main tool",
  );
  checks.push({
    test: "T03",
    passed: true,
    runId: run.id,
    querySentWhileStatus: "running",
    queryAt: activeAtQuery,
    replyAt: statusReply.at,
    statusAtReply: rows().find((r) => r.id === run.id)?.status,
  });
  stage = "T02/T04";
  const delivery = await wait(() => delivered(run.id));
  const result = rows().find((r) => r.id === run.id)!;
  assert.equal(result.status, "succeeded");
  assert.notEqual(
    result.threadId,
    rows("SELECT value FROM meta WHERE key='mainThread'")[0]?.value,
  );
  const originalFile=publication(run.id);
  assert.ok(originalFile.filePath.startsWith(config.workspace + "/outputs/"));
  const original = readFileSync(originalFile.filePath, "utf8");
  assertMeetingArtifact(original);
  const acceptanceEvents = rows("SELECT runId,type FROM events").filter(
    (e) => e.runId === run.id,
  );
  assert.ok(acceptanceEvents.some((e) => e.type === "engine_started"));
  assert.ok(delivery.text.trim());
  const originalHash = createHash("sha256").update(original).digest("hex");
  checks.push({
    test: "T02/T04",
    passed: true,
    runId: run.id,
    threadId: result.threadId,
    resultId: originalFile.id,
    sha256: originalHash,
  });
  stage = "T05";
  send(scenario.messages.revise.replace("{taskId}", run.taskId));
  const revision = await wait(() =>
    rows().find((r) => r.taskId === run.taskId && r.version > run.version),
  );
  await wait(() => delivered(revision.id));
  const revised = rows().find((r) => r.id === revision.id)!;
  assert.equal(revised.status, "succeeded");
  const revisedFile=publication(revised.id);
  assert.notEqual(revisedFile.filePath, originalFile.filePath);
  assert.ok(revised.threadId);
  assert.equal(
    createHash("sha256").update(readFileSync(originalFile.filePath)).digest("hex"),
    originalHash,
  );
  const revisedText = readFileSync(revisedFile.filePath, "utf8");
  assertMeetingArtifact(revisedText, true);
  checks.push({
    test: "T05",
    passed: true,
    taskId: run.taskId,
    runId: revised.id,
    threadId: revised.threadId,
    resultId: revisedFile.id,
    originalPreserved: true,
  });
  stage = "shutdown";
  child.stdin.end();
  await new Promise<void>((r) => child.once("exit", () => r()));
  assert.equal(exitCode, 0);
} catch (e) {
  const errorCode =
    e instanceof assert.AssertionError
      ? "scenario_assertion_failed"
      : engineError(e);
  checks.push({
    test: stage,
    passed: false,
    errorCode,
  });
  console.error(
    `回归未通过：${scenario.id} / ${stage}，${errorCode}；请检查本次元数据并修正后使用新目录重跑。`,
  );
  child.kill("SIGTERM");
  process.exitCode = 1;
} finally {
  clearInterval(sampler);
  writeFileSync(
    join(evidence, "core-checks.json"),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        scenarioId: scenario.id,
        sourceType: scenario.source.type,
        fixtureSourceType: scenario.fixture.sourceType,
        environment: {
          node: process.version,
          platform: process.platform,
          arch: process.arch,
          codex: codexVersion(config.codexBin),
        },
        requiresModel: true,
        cost: {
          mayBeBilled: true,
          amount: null,
          note: "Only available token usage is recorded; no exact monetary cost is known.",
        },
        model: config.model,
        checks,
        resources,
        usage: rows().map((r) => ({
          id: r.id,
          status: r.status,
          usage: r.usage ? JSON.parse(r.usage) : null,
        })),
        mainUsage:
          rows("SELECT value FROM meta WHERE key='mainUsage'").map((r) =>
            JSON.parse(r.value),
          )[0] ?? null,
        transcriptSaved: saveTranscript,
        stderrBytes,
      },
      null,
      2,
    ),
  );
  if (saveTranscript)
    writeFileSync(
      join(evidence, "public-sample-transcript.jsonl"),
      messages.map((m) => JSON.stringify(m)).join("\n") + "\n",
    );
}
