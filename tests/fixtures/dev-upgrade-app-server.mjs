#!/usr/bin/env node
// Offline synthetic peer for real process/lock/handoff tests; never a product default.
import { createInterface } from "node:readline";
import { existsSync, writeFileSync, appendFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import {spawnSync} from "node:child_process";
import {pathToFileURL} from "node:url";
if (process.argv.includes("--version")) { console.log("codex-cli synthetic-upgrade"); process.exit(0); }
const home = process.env.CODEX_HOME;
const log = record => appendFileSync(join(home, "process-events.jsonl"), JSON.stringify(record) + "\n");
const send = value => process.stdout.write(JSON.stringify(value) + "\n");
const trustedArg = process.argv.find(a => a.startsWith("mcp_servers.homer_interactions="));
const trusted = trustedArg ? JSON.parse(trustedArg.slice(trustedArg.indexOf("=") + 1).replace(/("(?:[^"\\]|\\.)*")=/g, "$1:")) : undefined;
let worker = false, thread, turn, count = 0;
const pending = new Map();
const tool = (name, args) => new Promise((resolve, reject) => {
  const id = "tool-" + ++count;
  pending.set(id, {resolve, reject});
  send({ id, method: "item/tool/call", params: { threadId: thread, turnId: turn, callId: id, tool: name, arguments: args } });
});
async function gate(name) { while (!existsSync(join(home, name))) await new Promise(r => setTimeout(r, 15)); }
function complete(text) {
  send({ method: "item/completed", params: { threadId: thread, turnId: turn, item: { id: "reply-" + turn, type: "agentMessage", phase: "final_answer", text } } });
  send({ method: "turn/completed", params: { threadId: thread, turn: { id: turn, status: "completed" } } });
}
createInterface({ input: process.stdin }).on("line", line => { void receive(JSON.parse(line)); });
async function receive(m) {
  if (!m.method) {
    if (pending.has(m.id)) {
      const {resolve, reject} = pending.get(m.id); pending.delete(m.id);
      const text = m.result?.contentItems?.[0]?.text;
      if(m.error||m.result?.success===false)reject(Error(m.error?.message??text??'synthetic_tool_failed'));
      else resolve(text?JSON.parse(text):m.result);
    }
    return;
  }
  if (m.method === "initialize") send({ id: m.id, result: { userAgent: "synthetic/0.163.0" } });
  if (m.method === "thread/memoryMode/set") send({id:m.id,result:{}});
  if (m.method === 'model/list') send({id:m.id,result:{data:[]}}); // Synthetic peer reports no tier catalog; dedicated Fast tests cover advertised priority.
  if (m.method === "config/read") send({ id: m.id, result: { config: { mcp_servers: trusted ? { homer_interactions: trusted } : {} } } });
  if (m.method === "mcpServerStatus/list") send({ id: m.id, result: { data: [{ name: "homer_interactions", tools: Object.fromEntries((trusted?.enabled_tools??[]).map(n => [n, {}])) }] } });
  if (m.method === "thread/start" || m.method === "thread/resume") {
    worker = trusted?.args?.at(-1) === "worker";
    thread = m.params.threadId ?? (worker ? "synthetic-worker-" + process.pid : "synthetic-main");
    log({ event: "started", pid: process.pid, worker, thread, resumed: m.method === "thread/resume" });
    if (m.method === "thread/resume" && existsSync(join(home, "hold-resume"))) {
      writeFileSync(join(home, "resume-waiting"), "1"); await gate("release-resume");
    }
    send({ id: m.id, result: { thread: { id: thread }, activePermissionProfile: { id: "homer" }, approvalPolicy: worker ? "on-request" : "never" } });
  }
  if (m.method === "turn/start") {
    turn = "turn-" + ++count;
    send({ id: m.id, result: { turn: { id: turn, status: "inProgress" } } });
    send({ method: "turn/started", params: { threadId: thread, turn: { id: turn } } });
    const text = m.params.input.map(i => i.text ?? "").join("");
    const input = text.startsWith('[内部协作输入') ? JSON.parse(text.split('\n')[1]) : undefined;
    if (worker) {
      writeFileSync(join(home, "worker-running"), String(process.pid));
      // Only this controlled fixture source is changed; no account or real model.
      const base=dirname(home),source=join(base,"src/synthetic-self-development.ts"),test=join(home,"self-development.test.mjs");
      writeFileSync(source,readFileSync(source,"utf8").replace('"before"','"after"'));
      writeFileSync(test,'import{test}from"node:test";import assert from"node:assert/strict";import{syntheticGreeting}from'+JSON.stringify(pathToFileURL(source).href)+';test("synthetic source change",()=>assert.equal(syntheticGreeting,"after"));');
      const check=spawnSync(process.execPath,['--import','tsx','--test',test],{cwd:base,stdio:'ignore',timeout:15000});
      writeFileSync(join(home,"self-development-tested.json"),JSON.stringify({synthetic:true,sourceModified:true,testExit:check.status}));
      await gate("release-worker");
      await tool("read_material", {});
      const file = await tool("write_markdown", { filename: "result.md", content: "# Synthetic result\n林青：2026-10-20；待确认。" });
      complete("written\n" + file.path);
    } else if (text === "dispatch-synthetic") {
      const task = await tool("task_create", { title: "Synthetic", goal: "Synthetic result" });
      await tool("worker_open", { taskId: task.taskId, message: "Read meeting.md and write the synthetic result." });
      complete("dispatched");
    } else if (text === "hold-main") {
      writeFileSync(join(home, "main-running"), "1"); await gate("release-main"); complete("main-finished");
    } else if (input?.kind === 'worker_reply') {
      const reply = await tool('worker_read', {workerId:input.workerId,messageId:input.messageId}), filePath = reply.messages[0].text.trim().split('\n').at(-1);
      if(readFileSync(filePath,'utf8')!=="# Synthetic result\n林青：2026-10-20；待确认。")throw Error('synthetic_result_mismatch');
      const result = await tool('accept_result', {runId:input.runId,messageId:input.messageId,filePath});
      await tool('work_inspect', {resultId:result.resultId});await tool('task_update', {taskId:input.taskId,action:'settle',outcome:'succeeded'});
      await tool('publish_delivery', {taskId:input.taskId,resultIds:[result.resultId],text:'synthetic-delivered'});complete('');
    } else complete("synthetic-reply");
  }
  if (m.method === "turn/interrupt") send({ id: m.id, result: {} });
}
