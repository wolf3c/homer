#!/usr/bin/env node
// Synthetic protocol fixture. No model calls or user content.
import { createInterface } from "node:readline";
const send = value => process.stdout.write(JSON.stringify(value) + "\n");
const event = (method, params) => send({ method, params });
let count = 0, current, timer;
const threadId = "web-synthetic-thread";
createInterface({ input: process.stdin }).on("line", line => {
  const m = JSON.parse(line);
  if (m.method === "thread/memoryMode/set") send({id:m.id,result:{}});
  if (m.method === "initialize") send({ id: m.id, result: { userAgent: "fixture/0.163.0" } });
  if (m.method === 'model/list') send({id:m.id,result:{data:[]}}); // Synthetic peer reports no tier catalog; dedicated Fast tests cover advertised priority.
  if (m.method === "config/read") send({ id: m.id, result: { config: { mcp_servers: {} } } });
  if (m.method === "thread/start" || m.method === "thread/resume") send({ id: m.id, result: { thread: { id: threadId, path: "/synthetic/not-yet-written-rollout.jsonl" }, activePermissionProfile: { id: "homer" }, approvalPolicy: "never" } });
  if (m.method === "turn/start") {
    const turnId = "web-turn-" + ++count, itemId = "web-item-" + count;
    current = turnId;
    event("turn/started", { threadId, turn: { id: "retired-turn" } });
    event("item/agentMessage/delta", { threadId, turnId: "retired-turn", itemId, delta: "PRE_ACK_STALE" });
    event("turn/started", { threadId, turn: { id: turnId } });
    event("item/agentMessage/delta", { threadId, turnId, itemId, delta: "合成" });
    setTimeout(() => send({ id: m.id, result: { turn: { id: turnId, status: "inProgress" } } }), 15);
    setTimeout(() => {
      event("item/agentMessage/delta", { threadId: "wrong-thread", turnId, itemId, delta: "FOREIGN" });
      event("item/agentMessage/delta", { threadId, turnId: "old-turn", itemId, delta: "STALE" });
      event("turn/started", { threadId, turn: { id: "retired-turn" } });
      event("item/agentMessage/delta", { threadId, turnId, itemId, delta: "增量" });
    }, 5);
    timer = setTimeout(() => {
      const tokenUsage={total:{totalTokens:12,inputTokens:10,outputTokens:2},last:{totalTokens:12,inputTokens:10,outputTokens:2},modelContextWindow:1000};
      event('thread/tokenUsage/updated',{threadId:'wrong-thread',turnId,tokenUsage:{total:{totalTokens:999}}});
      event('thread/tokenUsage/updated',{threadId,turnId:'retired-turn',tokenUsage:{total:{totalTokens:999}}});
      event('thread/tokenUsage/updated',{threadId,turnId,tokenUsage});
      event("item/completed", { threadId, turnId, item: { id: itemId, type: "agentMessage", text: "合成增量" } });
      event("turn/completed", { threadId, turn: { id: turnId, status: "completed" } });
      event('thread/tokenUsage/updated',{threadId,turnId,tokenUsage:{total:{totalTokens:999}}});
    }, 120);
  }
  if (m.method === "turn/interrupt") {
    clearTimeout(timer);
    send({ id: m.id, result: {} });
    event("turn/completed", { threadId, turn: { id: current, status: "interrupted" } });
  }
});
