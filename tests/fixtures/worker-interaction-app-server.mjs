#!/usr/bin/env node
// Synthetic native AppServer peer; never used by the product or model checks.
import { createInterface } from "node:readline";
const send = message => process.stdout.write(JSON.stringify(message) + "\n");
let model, instructions, turn = "native-turn";
const trustedArgument = process.argv.find(arg => arg.startsWith("mcp_servers.homer_interactions="));
const trusted = trustedArgument ? JSON.parse(trustedArgument.slice(trustedArgument.indexOf("=") + 1).replace(/("(?:[^"\\]|\\.)*")=/g, "$1:")) : undefined;
const names = ["work_directory", "inspect_interaction", "respond_interaction", "escalate_interaction", "runtime_capabilities", "inspect_attachment", "schedule_create", "schedule_list", "schedule_update", "schedule_cancel"];
createInterface({ input: process.stdin }).on("line", line => {
  const m = JSON.parse(line);
  if (m.method === "initialize") send({ id: m.id, result: { userAgent: "fixture/0.163.0", codexHome: process.env.CODEX_HOME } });
  if (m.method === 'model/list') send({id:m.id,result:{data:[]}}); // Synthetic peer reports no tier catalog; dedicated Fast tests cover advertised priority.
  if (m.method === "config/read") send({ id: m.id, result: { layers: [], config: { features: { memories: true }, memories: { dedicated_tools: true }, mcp_servers: trusted ? { homer_interactions: trusted } : {} } } });
  if (m.method === "mcpServerStatus/list") send({ id: m.id, result: { data: [{ name: "homer_interactions", tools: Object.fromEntries(names.map(name => [name, {}])) }] } });
  if (m.method === "thread/start" || m.method === "thread/resume") {
    model = m.params.model;
    instructions = m.params.developerInstructions;
    if (m.method === "thread/resume" && (m.params.threadId !== "native-thread" || "dynamicTools" in m.params)) process.exit(3);
    if (trusted) {
      const scoped = m.params.config.mcp_servers.homer_interactions;
      if (JSON.stringify(scoped) !== JSON.stringify(trusted) || scoped.enabled_tools.length !== names.length || scoped.default_tools_approval_mode !== "prompt" || names.some(name => scoped.tools[name]?.approval_mode !== "approve")) process.exit(2);
    }
    send({ id: m.id, result: { thread: { id: "native-thread" }, activePermissionProfile: { id: "homer" }, approvalPolicy: "never" } });
  }
  if (m.method === "turn/start") {
    send({ id: m.id, result: { turn: { id: turn, status: "inProgress" } } });
    send({ method: "turn/started", params: { threadId: "native-thread", turn: { id: turn } } });
    if (model === "trusted-mcp" || model === "prompt-reload") {
      send({ method: "item/completed", params: { threadId: "native-thread", turnId: turn, item: { id: "reply", type: "agentMessage", text: model === "prompt-reload" ? instructions : "trusted-policy-scoped" } } });
      send({ method: "turn/completed", params: { threadId: "native-thread", turn: { id: turn, status: "completed" } } });
      return;
    }
    const common = { threadId: "native-thread", turnId: turn, itemId: "item-1", startedAtMs: 1 };
    setTimeout(() => send({ id: "approval-opaque", method: model === "question" ? "item/tool/requestUserInput" : "item/commandExecution/requestApproval", params: model === "question" ? { ...common, questions: [{ id: "format", header: "Format", question: "Which format?", isOther: true, isSecret: false, options: null }], isBlocking: true, autoResolutionMs: null } : { ...common, kind: "command", command: "node --version", cwd: "/synthetic", environmentId: null, availableDecisions: ["accept", "decline"] } }), 5);
  }
  if (m.id === "approval-opaque" && !m.method) {
    send({ method: "serverRequest/resolved", params: { threadId: "native-thread", requestId: m.id } });
    send({ method: "item/completed", params: { threadId: "native-thread", turnId: turn, item: { id: "reply", type: "agentMessage", text: JSON.stringify(m.result ?? m.error) } } });
    send({ method: "turn/completed", params: { threadId: "native-thread", turn: { id: turn, status: "completed" } } });
  }
  if (m.method === "turn/interrupt") send({ id: m.id, result: {} });
});
