import { test } from "node:test";
import assert from "node:assert/strict";
import { WorkerExecutionClock } from "../src/worker-execution-clock.js";

test("HMR-INTERACTION-001: waiting for main/user pauses the active budget without renewing it", context => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000 });
  let stops = 0;
  const clock = new WorkerExecutionClock(100, () => { stops++; });
  context.mock.timers.tick(40);
  clock.pause();
  clock.pause();
  context.mock.timers.tick(10000);
  assert.equal(stops, 0);
  clock.resume();
  clock.resume();
  context.mock.timers.tick(59);
  assert.equal(stops, 0);
  context.mock.timers.tick(1);
  assert.equal(stops, 1);
  clock.resume();
  context.mock.timers.tick(1000);
  assert.equal(stops, 1);
  clock.close();
});

test("HMR-INTERACTION-001: stopped waiting Workers never restart an execution timer", context => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000 });
  let stops = 0;
  const clock = new WorkerExecutionClock(100, () => { stops++; });
  clock.pause();
  clock.close();
  clock.resume();
  context.mock.timers.tick(10000);
  assert.equal(stops, 0);
});
