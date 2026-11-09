import {messageFilesForRun} from './message-file-evidence.js';
// Explicit real CLI/model acceptance. Only newly prepared synthetic material is used.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
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
const config = { ...loadConfig(input), runtime, workspace: join(base, "workspace") };
mkdirSync(runtime, { recursive: true, mode: 0o700 });
mkdirSync(config.workspace, { recursive: true });
const samplePath=join(config.workspace, "sample.md");
writeFileSync(samplePath, "# 合成材料\n这是公开合成的权限与问答回归材料，行动负责人和日期均待确认。\n");
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
function filesForRun(runId:string){
  const db=new DatabaseSync(database,{readOnly:true});
  try{return db.prepare(messageFilesForRun).all(runId);}finally{db.close();}
}
function artifactText(runId:string){
  const files=filesForRun(runId);
  assert.equal(files.length,1);
  const file=files[0]!,id=String(file.assetId);
  assert.match(id,/^asset-[a-f0-9-]{36}$/);
  const bytes=readFileSync(join(runtime,"media",id));
  assert.equal(createHash("sha256").update(bytes).digest("hex"),file.sha256);
  return bytes.toString("utf8");
}
async function until(check: () => boolean, timeout = 240000, whileCliOpen = true) {
  const deadline = Date.now() + timeout;
  while (!check()) {
    if (whileCliOpen && exited) throw new Error("real_cli_exited");
    if (Date.now() > deadline) throw new Error("real_interaction_timeout");
    await new Promise(done => setTimeout(done, 100));
  }
}
const send = (text: string) => child.stdin.write(text + "\n");
const count = (type: Message["type"]) => messages.filter(message => message.type === type).length;
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
  send(`请现在派发一个独立文件任务，材料 ${samplePath}。验收目标明确要求 Worker 先按地址读取材料，再必须调用 ask_main 一次询问主Agent刚才记住的合成标题；即使goal带了标题也必须确认，然后把实际返回的合成标题和材料中的负责人/日期待确认写入 Markdown。主Agent知道答案，应直接 respond_interaction 回答，不用问用户。Worker 回报后核对正文和文件，用 send_user_message 发送选定的 Markdown 附件。`);
  await until(() => rows("runs").some(run=>filesForRun(run.id).length>0));
  const direct = rows("worker_interactions").find(item => item.source === "ask_main");
  assert.ok(direct && direct.state === "answered" && direct.deliveredAt);
  assert.ok(JSON.parse(direct.decision).answer.includes(marker));
  const run = rows("runs").find(item => item.id === direct.runId);
  assert.equal(run.status, "succeeded"); assert.ok(artifactText(run.id).includes(marker));
  stage = "escalate_user";
  send(`请现在先派发第二个独立任务，材料 ${samplePath}，不要在派发前问用户。Worker 必须先按地址读取材料，再调用 ask_main 询问‘用户专门指定的合成展示版式是什么？’。该版式尚未告知主Agent，用户要求禁止推测或替选；主Agent须使用 escalate_interaction 询问用户，并通过 send_user_message 将问题呈现给 CLI 用户。Worker 得到真实答复后，写入包含版式标签及材料事实的 Markdown，回报路径后由主Agent 发送选定附件。这是验收所必需的用户选择。`);
  await until(() => rows("worker_interactions").some(item=>item.source==="ask_main"&&item.state==="pending_user") && messages.some(message=>message.type==="reply"&&/版式/.test(message.text)));
  const waiting = rows("worker_interactions").find(item=>item.source==="ask_main"&&item.state==="pending_user");
  assert.ok(waiting.userQuestion);
  const originalWorker = rows("runs").find(item => item.id === waiting.runId);
  stage = "unrelated_chat";
  const before = count("reply");
  send("请仅回答‘仍可对话’，这条消息不回答也不改变 Worker 正在等待的版式问题。不要派新任务，不要对待答做决定。");
  await until(() => count("reply") > before);
  assert.ok(messages.filter(message => message.type === "reply").at(-1)!.text.includes("仍可对话"));
  assert.equal(rows("worker_interactions").find(item => item.id === waiting.id).state, "pending_user");
  stage = "original_worker_continue";
  send(`回答待答ID ${waiting.id}：用户指定合成展示版式为「${label}」。请查看该待答并 respond_interaction 返回原Worker继续，不能重新派任务。`);
  await until(() => filesForRun(waiting.runId).length>0);
  const answered = rows("worker_interactions").find(item => item.id === waiting.id);
  const continued = rows("runs").find(item => item.id === waiting.runId);
  assert.equal(answered.state, "answered"); assert.ok(answered.responseUserMessageId);
  assert.equal(continued.status, "succeeded"); assert.equal(continued.threadId, originalWorker.threadId); assert.equal(continued.pid, originalWorker.pid);
  assert.ok(artifactText(continued.id).includes(label));
  const checkNative = process.argv.includes("--native");
  if (checkNative) {
    stage = "native_read_approval";
    // Use the existing structured approval entry, which line-oriented CLI
    // input cannot express, on the same resumed conversation and isolated DB.
    send("/quit");await until(() => exited, 10000);assert.equal(exitCode,0);
    const app=new Homer(config,async()=>{});
    try {
      await app.start();
      assert.equal(app.store.meta("mainThread"),originalMain);
      await app.message(`请派第三个独立任务，材料 ${samplePath}。Worker先使用原生 request_permissions 工具请求仅对自己当前运行目录 cwd 的 filesystem read 权限（不要写、网络或会话授权）。Homer 先查看原生请求，使用现有审批卡请求本次用户决定，得到决定后回复原 Worker。Worker 按地址读取材料并写一个简短 Markdown 记录材料事实，回报路径后由 Homer 发送选定附件。`,"interaction-native");
      const pending=()=>app.interactions.list().find(item=>item.source==="native"&&item.kind==="authorization"&&item.state==="pending_user");
      await until(()=>!!pending(),240000,false);
      const card=app.interactions.inspect(pending()!.id),run=app.tasks.run(card.runId);
      assert.equal(card.details.method,"item/permissions/requestApproval");
      const {fileSystem,network}=(card.details.params as any).permissions;
      const entries=fileSystem?.entries??[];
      assert.ok(entries.every((entry:{access:string})=>entry.access==="read"));
      const reads=[...(fileSystem?.read??[]),...entries.map((entry:{path:{path:string}})=>entry.path.path)];
      assert.deepEqual(reads,[app.tasks.workingDirectory(run.id)]);
      assert.notEqual(network?.enabled,true);
      assert.equal(fileSystem?.write?.length??0,0);
      const decision=app.submitMessage({requestId:"interaction-native-decision",interactionId:card.id,text:"允许本次操作"});
      assert.equal(decision.fresh,true);
      await until(()=>filesForRun(run.id).length>0,240000,false);
      await app.idle();
      const approved=app.interactions.inspect(card.id);
      assert.equal(approved.state,"approved");assert.ok(approved.deliveredAt);
      assert.equal(approved.responseUserMessageId,"interaction-native-decision");
      assert.equal(app.tasks.run(run.id).threadId,run.threadId);
      assert.match(artifactText(run.id),/待确认/);
    } finally { await app.close(); }
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
