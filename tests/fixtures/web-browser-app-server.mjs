#!/usr/bin/env node
// Synthetic offline browser acceptance peer. Never selected by a product config.
import { createInterface } from "node:readline";
import { createConnection } from "node:net";
import { resolve } from "node:path";
if (process.argv.includes("--version")) { console.log("codex-cli synthetic-web"); process.exit(0); }
const send = value => process.stdout.write(JSON.stringify(value) + "\n");
const trustedArg = process.argv.find(value => value.startsWith("mcp_servers.homer_interactions="));
const trusted = trustedArg ? JSON.parse(trustedArg.slice(trustedArg.indexOf("=") + 1).replace(/("(?:[^"\\]|\\.)*")=/g, "$1:")) : undefined;
const worker=trusted?.args?.at(-1)==='worker';
let thread, turn, cwd, sequence = 0, generation = 0;
const pending = new Map();
const call = (method, params) => new Promise(accept => {
  const id = "synthetic-call-" + ++sequence; pending.set(id, accept); send({ id, method, params: { threadId: thread, turnId: turn, callId: id, ...params } });
});
const tool = (name, args) => call("item/tool/call", { tool: name, arguments: args });
const mcp = (tool, args) => new Promise((accept, reject) => {
  const socket = createConnection(resolve(trusted.cwd, ['main','worker'].includes(trusted.args.at(-1))?trusted.args.at(-2):trusted.args.at(-1))); let bytes = "";
  socket.on("connect", () => socket.write(JSON.stringify({ tool, arguments: args }) + "\n"));
  socket.on("data", chunk => { bytes += chunk; if (bytes.includes("\n")) { const value = JSON.parse(bytes); socket.end(); value.error ? reject(new Error(value.error)) : accept(value.result); } });
  socket.on("error", reject);
});
const complete = text => {
  send({ method: "item/completed", params: { threadId: thread, turnId: turn, item: { id: "reply-" + turn, type: "agentMessage", phase: "final_answer", text } } });
  send({ method: "turn/completed", params: { threadId: thread, turn: { id: turn, status: "completed" } } });
};
async function stream(text, slow = false) {
  const own = ++generation;
  send({ method: "item/started", params: { threadId: thread, turnId: turn, item: { id: "reply-" + turn, type: "agentMessage", phase: "final_answer", text: "" } } });
  for (const delta of text.match(/.{1,12}|\n/g) ?? []) {
    if (own !== generation) return;
    send({ method: "item/agentMessage/delta", params: { threadId: thread, turnId: turn, itemId: "reply-" + turn, delta } });
    await new Promise(accept => setTimeout(accept, slow ? 230 : 30));
  }
  if (own === generation) complete(text);
}
createInterface({ input: process.stdin }).on("line", line => { void receive(JSON.parse(line)); });
async function receive(m) {
  if (!m.method) {
    const accept = pending.get(m.id); if (!accept) return; pending.delete(m.id);
    const text = m.result?.contentItems?.[0]?.text;
    let result = m.result; if (text) { try { result = JSON.parse(text); } catch { result = { error: text }; } }
    accept(result); return;
  }
  if (m.method === "thread/memoryMode/set") send({id:m.id,result:{}});
  if (m.method === "initialize") send({ id: m.id, result: { userAgent: "synthetic/0.163.0" } });
  if (m.method === 'model/list') send({id:m.id,result:{data:[]}}); // Synthetic peer reports no tier catalog; dedicated Fast tests cover advertised priority.
  if (m.method === "config/read") send({ id: m.id, result: { config: { mcp_servers: trusted ? { homer_interactions: trusted } : {} } } });
  if (m.method === "mcpServerStatus/list") send({ id: m.id, result: { data: [{ name: "homer_interactions", tools: Object.fromEntries((trusted?.enabled_tools??[]).map(name => [name, {}])) }] } });
  if (m.method === "thread/start" || m.method === "thread/resume") {
    cwd = m.params.cwd; thread = m.params.threadId ?? (worker ? "web-synthetic-worker-" + process.pid : "web-synthetic-main");
    send({ id: m.id, result: { thread: { id: thread }, activePermissionProfile: { id: "homer" }, approvalPolicy: worker ? "on-request" : "never" } });
  }
  if (m.method === "turn/start") {
    turn = "web-turn-" + ++sequence;
    send({ id: m.id, result: { turn: { id: turn, status: "inProgress" } } });
    send({ method: "turn/started", params: { threadId: thread, turn: { id: turn } } });
    const text = m.params.input.map(part => part.text ?? "").join("");
    if (worker) {
      await tool("read_material", {});
      await tool("ask_main", { question: "合成验收：成果使用列表还是表格？" });
      await call("item/permissions/requestApproval", { itemId: "synthetic-permission", permissions: { fileSystem: { read: [cwd] } } });
      await tool("write_markdown", { filename: "合成行动清单.md", content: "# 合成行动清单\n\n| 事项 | 状态 |\n| --- | --- |\n| 核对材料 | 已核对 |\n\n此文件来自离线合成验收。" });
      complete("合成成果已写入。");
    } else if (text.startsWith("[Worker待答]") || text.startsWith("[用户答复原待答]")) {
      const interactionId = text.match(/interactionId=([\w-]+)/)[1], item = await mcp("inspect_interaction", { interactionId });
      if (text.startsWith("[Worker待答]")) {
        await mcp("escalate_interaction", { interactionId, question: item.kind === "authorization" ? "合成验收：允许本任务读取自己的成果目录吗？" : "成果用列表还是表格？", reason: "此项需要你的明确选择。" });
        complete("需要你补充本次任务的选择。");
      } else {
        await mcp("respond_interaction", item.kind === "authorization" ? { interactionId, action: /拒绝|不允许/.test(text) ? "deny" : "approve", permissions: item.details.params.permissions, reason: "依据本条用户明确答复" } : { interactionId, action: "answer", answer: "按表格呈现", reason: "依据本条用户明确答复" });
        complete("已将你的答复送回原任务。");
      }
    } else if (text.startsWith("[执行结果待审阅]")) {
      const runId = text.match(/runId=([\w-]+)/)[1]; await tool("inspect_run", { runId });
      await tool("review_artifact", { runId, accepted: true, summary: "合成行动清单已核对，包含事项与状态。", reason: "与合成材料一致。" }); complete("已核对。");
    } else if (text.startsWith("[执行结果待交付]")) {
      await tool("list_work", {}); complete("合成行动清单已完成，可以在「正在办」下载成果。");
    } else if (/生成成果|派发任务/.test(text)) {
      await tool("dispatch_work", { title: "整理合成行动清单", goal: "按合成材料制作行动清单，格式由用户确定。", material: "synthetic.md", matterId: null });
      await stream("我已开始整理材料。需要补充的信息会在这里询问你，后台任务会继续。", false);
    } else await stream("先核对材料，再交付成果。\n\n我会保留明确的负责人和时间，将不确定的内容留作待确认。\n\n| 事项 | 当前状态 |\n| --- | --- |\n| 阅读材料 | 已完成 |\n| 整理成果 | 待交办 |\n\n```ts\nconst task = { status: 'ready' };\n```\n\n这是离线合成验收的回答。", /持续|慢速/.test(text));
  }
  if (m.method === "turn/interrupt") {
    generation++;
    send({ id: m.id, result: {} });
    send({ method: "turn/completed", params: { threadId: thread, turn: { id: turn, status: "interrupted" } } });
  }
}
