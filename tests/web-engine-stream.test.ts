import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { CodexEngine } from "../src/engine.js";
import type { Config } from "../src/config.js";

const config: Config = {
  workspace: resolve(".codex/scratch"), runtime: resolve(".codex/scratch/assistant-ui/engine"),
  codexBin: resolve("tests/fixtures/web-stream-app-server.mjs"), codexHome: resolve(".codex/scratch/assistant-ui/engine/home"),
  model: "synthetic", requiresOpenaiAuth: false, timeoutMs: 2000, mainTimeoutMs: 2000, stopGraceMs: 100,
};
test("main text deltas arrive before completion, scoped to the active thread and turn", async () => {
  const engine = new CodexEngine(config, { cwd: resolve(".codex/scratch"), readRoots: [], instructions: "Synthetic protocol test", tools: [] }, async () => ({}));
  const deltas: string[] = [];
  const usage:unknown[]=[];engine.on('usage',value=>usage.push(value));
  let finished = false, started = false;
  engine.on("textDelta", (value: { delta: string }) => { assert.equal(finished, false); assert.equal(started, true, "start callback precedes even pre-acknowledgement deltas"); deltas.push(value.delta); });
  try {
    await engine.start();
    assert.equal((engine as unknown as { resumable: boolean }).resumable, false, "empty threads have no persisted rollout and cannot be handed off");
    const result = await engine.turn("合成输入", { onStarted: id => { assert.equal(id, "web-turn-1"); started = true; } }); finished = true;
    assert.equal(result.text, "合成增量");
    assert.equal((engine as unknown as { resumable: boolean }).resumable, true);
    assert.deepEqual(deltas, ["合成", "增量"]);
    await new Promise(r=>setTimeout(r,10));
    assert.deepEqual(usage,[{total:{totalTokens:12,inputTokens:10,outputTokens:2},last:{totalTokens:12,inputTokens:10,outputTokens:2},modelContextWindow:1000}], 'foreign, stale and post-completion usage must not replace current counters');
  } finally { await engine.close(); }
});
