// Terminate only this test's leased main engine; the Worker's original reply must survive.
import { resolve, join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { Homer, type Message } from "../src/service.js";
import { loadConfig } from "../src/config.js";
import { engineError } from "../src/engine.js";
import { processIdentity } from "../src/processes.js";

const path = process.argv[2];
if (!path) throw new Error("Pass a fresh dedicated scratch config");
const config = loadConfig(path);
assert.ok(config.workspace.startsWith(resolve(".codex/scratch") + "/"));
const evidenceDir = resolve(".codex/scratch/real-main-failure");
mkdirSync(evidenceDir, { recursive: true });
const messages: Message[] = [];
const app = new Homer(config, async (message) => {
  messages.push(message);
  console.log(message.type, message.runId ?? "");
});
const evidence: Record<string, unknown> = {
  at: new Date().toISOString(),
  model: config.model,
  passed: false,
};
try {
  assert.equal(app.store.runs().length, 0, "Use a fresh runtime");
  await app.start();
  await app.message(
    "请新建任务并派 Worker 检查 missing-public-notes.md。这个文件确实不存在，允许执行一次检查；只回复缺失输入的结论，不生成文件或正式成果，绝不能编造材料。",
    "real-main-engine-failure",
  );
  const lease = JSON.parse(app.store.meta("lease:main")!);
  assert.equal(processIdentity(lease.pid), lease.identity);
  // The PID comes from an engine created and leased by this Homer instance, never a process search.
  process.kill(lease.pid, "SIGTERM");
  await app.idle();
  const run = app.store.runs()[0]!;
  assert.ok(run && !['queued','running'].includes(run.status));
  const reply=app.store.db.prepare("SELECT payloadJson FROM agent_messages WHERE kind='worker_reply' AND senderRunId=?").get(run.id);
  assert.ok(reply,'worker_original_reply_must_survive_main_failure');
  const payload=JSON.parse(String(reply.payloadJson));
  assert.equal(payload.runId,run.id);assert.equal(payload.threadId,run.threadId);
  assert.match(payload.text,/不存在|未找到|缺失|missing|not found/i);
  assert.equal(Number(app.store.db.prepare("SELECT count(*) n FROM results WHERE taskId=? AND kind='file'").get(run.taskId)!.n),0);
  Object.assign(evidence, {
    passed: true,
    runId: run.id,
    taskId: run.taskId,
    originalReplyPreserved: true,
    fabricatedFiles: false,
  });
} catch (e) {
  evidence.errorCode = engineError(e);
  process.exitCode = 1;
} finally {
  try {
    await app.close();
  } catch (e) {
    evidence.passed = false;
    evidence.closeErrorCode = engineError(e);
    process.exitCode = 1;
  }
  writeFileSync(
    join(evidenceDir, "main-failure-checks.json"),
    JSON.stringify(evidence, null, 2) + "\n",
  );
}
