import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.js";

test("T02/T05/T10: durable dispatch is idempotent; revisions reuse matter, retain history", () => {
  const s = new Store(":memory:");
  const first = s.dispatch({
    requestId: "req-1",
    title: "会议",
    goal: "行动清单",
    material: "meeting.md",
  });
  const dup = s.dispatch({
    requestId: "req-1",
    title: "会议",
    goal: "行动清单",
    material: "meeting.md",
  });
  assert.equal(first.id, dup.id);
  assert.equal(s.runs().length, 1);
  assert.equal(s.claim()?.id, first.id);
  assert.equal(s.claim(), undefined);
  s.finish(first.id, "failed", "engine_failed");
  const second = s.dispatch({
    requestId: "req-2",
    matterId: first.matterId,
    title: "会议",
    goal: "修订",
    material: "meeting.md",
  });
  assert.equal(first.matterId, second.matterId);
  assert.notEqual(first.id, second.id);
  assert.equal(s.runs().length, 2);
  s.close();
});

test("T06: independent runs can be claimed together; updates to an active matter are rejected", () => {
  const s = new Store(":memory:");
  const a = s.dispatch({
    requestId: "a",
    title: "A",
    goal: "A",
    material: "a.md",
  });
  s.claim();
  const b = s.dispatch({
    requestId: "b",
    title: "B",
    goal: "B",
    material: "b.md",
  });
  assert.equal(b.status, "queued");
  assert.equal(s.claim()?.id, b.id);
  assert.equal(s.runs().filter(r => r.status === "running").length, 2);
  assert.throws(
    () =>
      s.dispatch({
        requestId: "c",
        matterId: a.matterId,
        title: "A",
        goal: "edit",
        material: "a.md",
      }),
    /matter_busy/,
  );
  s.finish(a.id, "failed", "missing_file");
  assert.equal(s.run(b.id)?.status, "running");
  s.close();
});

test("T08/T09: stop requests are separate; reboot interrupts active and queued work without replay", () => {
  const s = new Store(":memory:");
  const a = s.dispatch({
    requestId: "a",
    title: "A",
    goal: "A",
    material: "a.md",
  });
  s.claim();
  s.requestStop(a.id);
  assert.equal(s.run(a.id)?.status, "running");
  assert.ok(s.run(a.id)?.stopRequestedAt);
  s.dispatch({ requestId: "b", title: "B", goal: "B", material: "b.md" });
  s.reconcile();
  assert.ok(s.runs().every((r) => r.status === "interrupted"));
  assert.equal(s.claim(), undefined);
  assert.equal(s.finish(a.id, "succeeded"), false);
  s.close();
});

test("T10: terminal events and delivery receipts are idempotent, restart keeps unacknowledged delivery", () => {
  const s = new Store(":memory:");
  const a = s.dispatch({
    requestId: "a",
    title: "A",
    goal: "A",
    material: "a.md",
  });
  s.claim();
  assert.equal(s.finish(a.id, "failed", "engine_failed"), true);
  assert.equal(s.finish(a.id, "failed", "engine_failed"), false);
  assert.equal(s.pendingDeliveries().length, 1);
  s.reconcile();
  assert.equal(s.pendingDeliveries().length, 1);
  s.markDelivered(a.id);
  s.markDelivered(a.id);
  assert.equal(s.pendingDeliveries().length, 0);
  assert.equal(s.events(a.id).filter((e) => e.type === "finished").length, 1);
  s.close();
});

test("T09: a new Store reads completed history and interrupts unfinished disk records exactly once", async () => {
  const { resolve } = await import("node:path");
  const { mkdirSync, rmSync } = await import("node:fs");
  const base = resolve(".codex/scratch/store-restart");
  rmSync(base, { recursive: true, force: true });
  mkdirSync(base, { recursive: true });
  const first = new Store(base + "/homer.sqlite");
  const done = first.dispatch({
    requestId: "done",
    title: "完成",
    goal: "done",
    material: "meeting.md",
  });
  first.claim();
  first.finish(done.id, "failed", "observed_failure");
  const active = first.dispatch({
    requestId: "active",
    title: "运行",
    goal: "active",
    material: "meeting.md",
  });
  first.claim();
  first.engine(active.id, {
    threadId: "observed-thread",
    turnId: "observed-turn",
  });
  first.setMeta("mainThread", "persistent-main");
  first.close();
  const second = new Store(base + "/homer.sqlite");
  second.reconcile();
  second.reconcile();
  assert.equal(second.meta("mainThread"), "persistent-main");
  assert.equal(second.run(done.id)?.errorCode, "observed_failure");
  assert.equal(second.run(active.id)?.status, "interrupted");
  assert.equal(second.run(active.id)?.threadId, "observed-thread");
  assert.equal(
    second.events(active.id).filter((e) => e.type === "finished").length,
    1,
  );
  assert.equal(second.claim(), undefined);
  second.close();
});

test("T10: older databases retain request links after additive multi-dispatch migration", async () => {
  const { resolve } = await import("node:path");
  const { mkdirSync, rmSync } = await import("node:fs");
  const dir = resolve(".codex/scratch/store-migration");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  let base = new Store(dir + "/legacy.sqlite");
  const old = base.dispatch({ requestId: "legacy", title: "legacy", goal: "legacy", material: "a.md" });
  base.db.exec("DROP INDEX runs_source_request; ALTER TABLE runs DROP COLUMN sourceRequestId");
  base.close();
  base = new Store(dir + "/legacy.sqlite");
  assert.equal(base.runsForRequest("legacy")[0]?.id, old.id);
  assert.equal(base.run(old.id)?.goal, "legacy");
  const a = base.dispatch({ requestId: "call-a", sourceRequestId: "parent", title: "a", goal: "a", material: "a.md" });
  const b = base.dispatch({ requestId: "call-b", sourceRequestId: "parent", title: "b", goal: "b", material: "b.md" });
  assert.equal(base.dispatch({ requestId: "call-a", sourceRequestId: "parent", title: "a", goal: "a", material: "a.md" }).id, a.id);
  assert.deepEqual(base.runsForRequest("parent").map(r => r.id), [a.id, b.id]);
  base.close();
});
