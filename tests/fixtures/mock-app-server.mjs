#!/usr/bin/env node
// A transport-only test peer. This is never selected by the product CLI or real acceptance.
import { createInterface } from "node:readline";
let count = 0;
let model;
let toolResponses = 0;
const send = (x) => process.stdout.write(JSON.stringify(x) + "\n");
const event = (method, params) => send({ method, params });
const item = (id, text) =>
  event("item/completed", {
    threadId: "mock-thread",
    turnId: id,
    item: { id: "item-" + id, type: "agentMessage", text },
  });
const complete = (id) =>
  event("turn/completed", {
    threadId: "mock-thread",
    turn: { id, status: model==='failed-turn'&&count===1?'failed':"completed", items: [] },
  });
createInterface({ input: process.stdin }).on("line", (line) => {
  const m = JSON.parse(line);
  if (!m.method) {
    if (m.id === "call") toolResponses++;
    return;
  }
  if (m.method === "initialize")
    send({ id: m.id, result: { userAgent: "mock/0.154.0" } });
  if (m.method === "config/read") {
    const external = process.argv.some((a) => a.includes("external-tools"));
    const disabled = process.argv.includes('mcp_servers.unexpected.enabled=false');
    const stubborn = process.argv.some((a) => a.includes("external-tools-stubborn"));
    send({
      id: m.id,
      result: {
        config: {
          mcp_servers: external ? { unexpected: { command: "blocked", enabled: stubborn || !disabled } } : {},
        },
        origins: {},
        layers: null,
      },
    });
  }
  if (m.method === "skills/list") send({ id: m.id, result: { data: [] } });
  if (m.method === "thread/start" || m.method === "thread/resume") {
    model = m.params.model;
    if (model === "missing-rollout" && m.method === "thread/resume") {
      send({ id: m.id, error: { message: "failed to read rollout for thread mock-thread" } });
      return;
    }
    send({
      id: m.id,
      result: {
        thread: { id: "mock-thread" },
        activePermissionProfile: { id: "homer" },
        approvalPolicy: "never",
      },
    });
  }
  if(m.method==='model/list')send({id:m.id,result:{data:[{id:model,model,inputModalities:model==='text-only'?['text']:['text','image']}]}});
  if (m.method === "turn/start") {
    if (model === "host-required" && !process.argv.includes("features.code_mode_host=true")) {
      send({ id: m.id, error: { message: "code-mode host is disabled" } });
      return;
    }
    count++;
    const id = "turn-" + count;
    if (model === "disconnect") {
      process.exit(7);
    }
    if (count === 2) {
      item("turn-1", "STALE");
      complete("turn-1");
    }
    send({ id: m.id, result: { turn: { id, status: "inProgress" } } });
    event("turn/started", { threadId: "mock-thread", turn: { id } });
    setTimeout(() => {
      item(id, model === "image-input-check" ? JSON.stringify(m.params.input) : model === "effort-check" ? m.params.effort : count === 1 ? "FIRST" : "SECOND");
      complete(id);
    }, 20);
  }
  if (m.method === "turn/interrupt") send({ id: m.id, result: {} });
});
