// Explicit real CLI/model acceptance. Only newly prepared synthetic material is used.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { engineError, codexVersion } from "../src/engine.js";
import { Homer, type Message } from "../src/service.js";

const input = process.argv[2];
if (!input) throw new Error("explicit_config_required");
const stamp = Date.now();
const base = resolve(".codex/scratch/worker-interactions/real-" + stamp);
const runtime = resolve(".codex/private/wi-" + stamp);
const config = { ...loadConfig(input), runtime, workspace: join(base, "workspace"), mainTimeoutMs: 180000, timeoutMs: 180000 };
mkdirSync(runtime, { recursive: true, mode: 0o700 });
mkdirSync(join(config.workspace, "materials"), { recursive: true });
writeFileSync(join(config.workspace, "materials", "sample.md"), "# 合成材料\n这是公开合成的权限与问答回归材料，行动负责人和日期均待确认。\n");
const configPath = join(runtime, "test.config.json");
writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 });
const marker = "合成标题-" + randomUUID().slice(0, 8), label = "合成版式-" + randomUUID().slice(0, 8);
// Resume a normally created current-version main conversation after shutdown.
const initial = new Homer(config, async () => {});
let preparedThread: string;
try {
  await initial.start();
  await initial.message(`请记住本次公开合成测试标题为「${marker}」，只回复已记住，暂不派任务。`,'interaction-remember');
  preparedThread=initial.store.meta('mainThread')!;assert.ok(preparedThread);
} finally { await initial.close(); }
const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", resolve("dist/cli.js"), "--json", "--config", configPath], { stdio: ["pipe", "pipe", "pipe"] });
child.stderr.resume();
const messages: Message[] = [];
let exited = false, exitCode: number | null = null, stage = "startup";
child.on("exit", code => { exited = true; exitCode = code; });
createInterface({ input: child.stdout }).on("line", line => {
  try { messages.push(JSON.parse(line)); } catch { /* Do not log raw CLI/provider output. */ }
});
const database = join(runtime, "homer.sqlite");
function rows(table: "runs" | "worker_interactions" | "meta") {
  const db = new DatabaseSync(database, { readOnly: true });
  try { return db.prepare("SELECT * FROM " + table).all() as any[]; } finally { db.close(); }
}
function artifact(runId:string){
  const db=new DatabaseSync(database,{readOnly:true});
  try{const files=db.prepare("SELECT r.filePath FROM results r JOIN deliveries d ON d.taskId=r.taskId JOIN json_each(d.resultIdsJson) i ON i.value=r.id WHERE r.runId=? AND r.kind='file' AND d.state='recorded' AND d.revokedAt IS NULL").all(runId);assert.equal(files.length,1);return String(files[0]!.filePath);}finally{db.close();}
}
async function until(check: () => boolean, timeout = 240000) {
  const deadline = Date.now() + timeout;
  while (!check()) {
    if (exited) throw new Error("real_cli_exited");
    if (Date.now() > deadline) throw new Error("real_interaction_timeout");
    await new Promise(done => setTimeout(done, 100));
  }
}
const send = (text: string) => child.stdin.write(text + "\n");
const count = (type: string) => messages.filter(message => message.type === type).length;
const reportPath = join(base, "interaction-checks.json");
try {
  await until(() => messages.some(message => message.type === "progress" && message.text.includes("Homer 已启动")));
  stage = "remember";
  send("刚才记住的公开合成测试标题是什么？只回复该标题，暂不派任务。");
  await until(() => count("reply") === 1);
  assert.ok(messages.find(message => message.type === "reply")!.text.includes(marker));
  const originalMain = rows("meta").find(item => item.key === "mainThread").value;
  assert.equal(originalMain, preparedThread!);
  stage = "ask_main_direct";
  send("请现在派发一个独立文件任务，材料 sample.md。验收目标明确要求 Worker 先 read_material，再必须调用 ask_main 一次询问主Agent刚才记住的合成标题；即使goal带了标题也必须确认，然后把实际返回的合成标题和材料中的负责人/日期待确认写入 Markdown。主Agent知道答案，应直接 respond_interaction 回答，不用问用户。");
  await until(() => count("delivery") >= 1);
  const direct = rows("worker_interactions").find(item => item.source === "ask_main");
  assert.ok(direct && direct.state === "answered" && direct.deliveredAt);
  assert.ok(JSON.parse(direct.decision).answer.includes(marker));
  const run = rows("runs").find(item => item.id === direct.runId);
  assert.equal(run.status, "succeeded"); assert.ok(readFileSync(artifact(run.id), "utf8").includes(marker));
  stage = "escalate_user";
  send("请现在先派发第二个独立任务，材料 sample.md，不要在派发前问用户。Worker必须先 read_material，再调用 ask_main 询问‘用户专门指定的合成展示版式是什么？’。该版式尚未告知主Agent，用户要求禁止推测或替选；主Agent须使用 escalate_interaction 询问用户。Worker得到用户真实答复后，写入包含版式标签以及材料事实的Markdown。这是验收所必需的用户选择。");
  await until(() => count("question") >= 1);
  const question = messages.find(message => message.type === "question")!;
  const waiting = rows("worker_interactions").find(item => item.id === question.interactionId);
  assert.equal(waiting.state, "pending_user");
  const originalWorker = rows("runs").find(item => item.id === waiting.runId);
  stage = "unrelated_chat";
  const before = count("reply");
  send("请仅回答‘仍可对话’，这条消息不回答也不改变 Worker 正在等待的版式问题。不要派新任务，不要对待答做决定。");
  await until(() => count("reply") > before);
  assert.ok(messages.filter(message => message.type === "reply").at(-1)!.text.includes("仍可对话"));
  assert.equal(rows("worker_interactions").find(item => item.id === waiting.id).state, "pending_user");
  stage = "original_worker_continue";
  send(`回答待答ID ${waiting.id}：用户指定合成展示版式为「${label}」。请查看该待答并 respond_interaction 返回原Worker继续，不能重新派任务。`);
  await until(() => count("delivery") >= 2);
  const answered = rows("worker_interactions").find(item => item.id === waiting.id);
  const continued = rows("runs").find(item => item.id === waiting.runId);
  assert.equal(answered.state, "answered"); assert.ok(answered.responseUserMessageId);
  assert.equal(continued.status, "succeeded"); assert.equal(continued.threadId, originalWorker.threadId); assert.equal(continued.pid, originalWorker.pid);
  assert.ok(readFileSync(artifact(continued.id), "utf8").includes(label));
  const checkNative = process.argv.includes("--native");
  if (checkNative) {
  stage = "native_read_approval";
  send("请创建第三个独立任务，材料 sample.md。Worker先使用原生 request_permissions 工具请求仅对自己当前运行目录 cwd 的 filesystem read 权限（不要写、网络或会话授权），理由是合成审批回归。等待原生审批结果后再 read_material，写一个简短 Markdown 记录材料事实。主Agent对本Run已允许读取的明确子集应直接批准；任何越界请求应拒绝，不能问用户假装测试通过。");
  await until(() => count("delivery") >= 3 || count("question") >= 2);
  if (count("question") >= 2) throw new Error("native_request_unexpected_escalation");
  const native = rows("worker_interactions").filter(item => item.source === "native");
  const nativeApproved = native.some(item => item.kind === "authorization" && item.state === "approved" && item.deliveredAt);
  assert.ok(nativeApproved, "native_approval_not_observed");
  }
  const nativeApproved = rows("worker_interactions").some(item => item.source === "native" && item.kind === "authorization" && item.state === "approved" && item.deliveredAt);
  assert.ok(rows("runs").every(item => item.status === "succeeded"));
  assert.equal(rows("runs").length, checkNative ? 3 : 2);
  assert.equal(rows("meta").find(item => item.key === "mainThread").value, originalMain);
  const report = { scenarioId: "HMR-INTERACTION-001", sourceType: "requirements-derived", fixtureSourceType: "synthetic", at: new Date().toISOString(), passed: true, codex: codexVersion(config.codexBin), model: config.model, effort: config.effort, cli: true, directMainAnswer: true, userEscalation: true, unrelatedMessageWhileWaiting: true, originalWorkerContinued: true, mainThreadRestartRecall: true, nativeVerification: checkNative ? "observed" : "not_run", nativeApprovalObserved: nativeApproved, mainThreadPreserved: true, mainThread: originalMain, mainUsage: JSON.parse(rows("meta").find(item => item.key === "mainUsage")?.value ?? "null"), runs: rows("runs").map(({ id, taskId, workerId, threadId, status, usage }) => ({ id, taskId, workerId, threadId, status, usage: usage ? JSON.parse(usage) : null })), interactions: rows("worker_interactions").map(({ id, runId, source, kind, state, deliveredAt }) => ({ id, runId, source, kind, state, deliveredAt })), transcriptSaved: false, costAmount: null };
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: true, model: config.model, report: reportPath }));
} catch (error) {
  const report = { passed: false, stage, code: engineError(error), cliErrorCodes: messages.filter(message => message.type === "error").map(message => /^[a-z][a-z_]{1,80}$/.test(message.text) ? message.text : "cli_error"), model: config.model, effort: config.effort, exitCode, runs: (() => { try { return rows("runs").map(({ id, status, errorCode }) => ({ id, status, errorCode })); } catch { return []; } })(), interactions: (() => { try { return rows("worker_interactions").map(({ id, source, state }) => ({ id, source, state })); } catch { return []; } })(), transcriptSaved: false };
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.error(JSON.stringify({ ...report, report: reportPath })); process.exitCode = 1;
} finally {
  if (!exited) { child.stdin.write("/quit\n"); await until(() => exited, 10000).catch(() => { child.kill("SIGTERM"); }); }
}
