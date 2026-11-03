import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync } from "node:fs";
import { resolve } from "node:path";
import { CodexEngine } from "../src/engine.js";
import type { Config } from "../src/config.js";
import type { InteractionResolution } from "../src/worker-interactions.js";

const binary = resolve("tests/fixtures/worker-interaction-app-server.mjs");
chmodSync(binary, 0o755);
const config: Config = { workspace: resolve(".codex/scratch"), runtime: resolve(".codex/scratch/worker-interactions"), codexHome: resolve(".codex/scratch/worker-interactions"), codexBin: binary, model: "approve", timeoutMs: 1000, mainTimeoutMs: 1000, stopGraceMs: 50, requiresOpenaiAuth: false };

test("HMR-INTERACTION-PROTOCOL: real adapter forwards and holds native JSON-RPC IDs until approval/denial", async () => {
  for (const action of ["approve", "deny"] as const) {
    let release!: (value: InteractionResolution) => void, count = 0;
    let delivered: unknown;
    const engine: CodexEngine = new CodexEngine(config, { cwd: resolve(".codex/scratch"), readRoots: [], instructions: "synthetic fixture", tools: [], onInteraction: async request => {
      count++; assert.equal(request.requestId, "approval-opaque"); assert.equal(request.threadId, engine.threadId); assert.equal(request.turnId, engine.turnId);
      return new Promise(resolve => { release = resolve; });
    } }, async () => ({}));
    engine.on("interactionDelivered", id => { delivered = id; });
    try {
      await engine.start(); const result = engine.turn("native request");
      while (!release) await new Promise(done => setTimeout(done, 5));
      assert.equal(count, 1);
      release({ status: action === "approve" ? "approved" : "denied", decision: { action, reason: "Fixture task scope" } });
      assert.deepEqual(JSON.parse((await result).text), { decision: action === "approve" ? "accept" : "decline" });
      assert.equal(delivered, "approval-opaque");
    } finally { await engine.close(); }
  }
});

test("HMR-INTERACTION-PROTOCOL: native question receives exact nonempty answers through adapter", async () => {
  const engine = new CodexEngine({ ...config, model: "question" }, { cwd: resolve(".codex/scratch"), readRoots: [], instructions: "fixture", tools: [], onInteraction: async () => ({ status: "answered", decision: { action: "answer", reason: "Known", answers: { format: ["Markdown"] } } }) }, async () => ({}));
  try { await engine.start(); assert.deepEqual(JSON.parse((await engine.turn("question")).text), { answers: { format: { answers: ["Markdown"] } } }); }
  finally { await engine.close(); }
});

test("HMR-INTERACTION-PROTOCOL: explicit native question denial is returned as refusal rather than empty answers", async () => {
  const engine = new CodexEngine({ ...config, model: "question" }, { cwd: resolve(".codex/scratch"), readRoots: [], instructions: "fixture", tools: [], onInteraction: async () => ({ status: "denied", decision: { action: "deny", reason: "Outside current task information" } }) }, async () => ({}));
  try { await engine.start(); assert.deepEqual(JSON.parse((await engine.turn("question")).text), { code: -32001, message: "interaction_question_declined" }); }
  finally { await engine.close(); }
});

test("HMR-INTERACTION-PROTOCOL: only the governed Main tools receive MCP call permission at process and thread scope", async () => {
  const engine = new CodexEngine({ ...config, model: "trusted-mcp" }, { cwd: resolve(".codex/scratch"), readRoots: [], instructions: "fixture", tools: [], interactionMcp: { command: process.execPath, args: ["synthetic-stdio.js"], cwd: resolve(".") } }, async () => ({}));
  try { await engine.start(); assert.equal((await engine.turn("policy")).text, "trusted-policy-scoped"); }
  finally { await engine.close(); }
});
