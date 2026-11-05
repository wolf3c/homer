#!/usr/bin/env node
// Requirement-derived offline Codex protocol peer, never a production config.
import { createInterface } from "node:readline";
if (process.argv.includes("--version")) { console.log("codex-cli synthetic-telegram"); process.exit(0); }
const send = value => process.stdout.write(JSON.stringify(value) + "\n");
const event = (method, params) => send({ method, params });
const trustedArg = process.argv.find(value => value.startsWith("mcp_servers.homer_interactions="));
const trusted = trustedArg ? JSON.parse(trustedArg.slice(trustedArg.indexOf("=") + 1).replace(/("(?:[^"\\]|\\.)*")=/g, "$1:")) : undefined;
let count = 0, threadId = "telegram-synthetic-original", current, timer;
const rich = "合成增量正文\n\n| 事项 | 状态 |\n| --- | --- |\n| 材料 | 已核对 |\n\n```ts\nconst ready = true;\n```\n\n$$\nx^2+y^2=z^2\n$$\n\n<details>\n<summary>展开合成细节</summary>\n合成折叠正文\n</details>";
createInterface({ input: process.stdin }).on("line", line => {
  const m = JSON.parse(line);
  if (m.method === "initialize") send({ id: m.id, result: { userAgent: "fixture/0.163.0" } });
  if (m.method === 'model/list') send({id:m.id,result:{data:[]}}); // Synthetic peer has no tier catalog; Fast capability enforcement is covered separately.
  if (m.method === "config/read") send({ id: m.id, result: { config: { mcp_servers: trusted ? { homer_interactions: trusted } : {} } } });
  if (m.method === "mcpServerStatus/list") send({ id: m.id, result: { data: [{ name: "homer_interactions", tools: Object.fromEntries(["work_directory", "file_checkpoint", "capabilities", "inspect_interaction", "respond_interaction", "escalate_interaction", "runtime_capabilities", "inspect_attachment", "inspect_result_file", "quote_current_message", "prepare_combined_delivery"].map(name => [name, {}])) }] } });
  if (m.method === "thread/start" || m.method === "thread/resume") {
    threadId = m.params.threadId ?? threadId;
    send({ id: m.id, result: { thread: { id: threadId }, activePermissionProfile: { id: "homer" }, approvalPolicy: "never" } });
  }
  if (m.method === "thread/memoryMode/set") send({ id: m.id, result: {} });
  if (m.method === "turn/start") {
    const turnId = "telegram-turn-" + ++count, itemId = "telegram-item-" + count; current = turnId;
    // Exercise visible deltas arriving before the turn/start acknowledgement.
    event("turn/started", { threadId, turn: { id: turnId } });
    event("item/agentMessage/delta", { threadId, turnId, itemId, delta: "合成" });
    event("item/reasoning/textDelta", { threadId, turnId, itemId: "reasoning", delta: "PRIVATE_REASONING_NOT_VISIBLE" });
    event("item/agentMessage/delta", { threadId: "foreign-thread", turnId, itemId, delta: "FOREIGN_NOT_VISIBLE" });
    setTimeout(() => send({ id: m.id, result: { turn: { id: turnId, status: "inProgress" } } }), 15);
    setTimeout(() => event("item/agentMessage/delta", { threadId, turnId, itemId, delta: rich.slice(2) }), 200);
    timer = setTimeout(() => {
      event("item/completed", { threadId, turnId, item: { id: itemId, type: "agentMessage", text: rich } });
      event("turn/completed", { threadId, turn: { id: turnId, status: "completed" } });
    }, 2400);
  }
  if (m.method === "turn/interrupt") {
    clearTimeout(timer); send({ id: m.id, result: {} });
    setTimeout(() => event("turn/completed", { threadId, turn: { id: current, status: "interrupted" } }), 80);
  }
});
