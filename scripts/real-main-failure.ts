// Deliberately terminate only this test's own main App Server; verify factual fallback delivery.
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
    "请新建一个缺失输入验收事项，读取 missing-public-notes.md 并写 Markdown。这个文件确实不存在，允许执行一次检查；读取失败就报告失败，绝不能编造材料或成果。",
    "real-main-engine-failure",
  );
  const lease = JSON.parse(app.store.meta("lease:main")!);
  assert.equal(processIdentity(lease.pid), lease.identity);
  // The PID comes from an engine created and leased by this Homer instance, never a process search.
  process.kill(lease.pid, "SIGTERM");
  await app.idle();
  const run = app.store.runs()[0]!;
  assert.equal(run.status, "failed");
  assert.equal(run.errorCode, "material_missing");
  assert.equal(run.artifact, null);
  assert.equal(run.delivery, "delivered");
  assert.ok(
    messages.some(
      (m) => m.type === "delivery" && m.text.includes("系统事实回执"),
    ),
  );
  assert.ok(
    app.store.events(run.id).some((e) => e.type === "delivery_degraded"),
  );
  Object.assign(evidence, {
    passed: true,
    runId: run.id,
    events: app.store.events(run.id),
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
