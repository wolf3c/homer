import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { acquireLock, terminateLease, processIdentity } from "../src/processes.js";

test("HMR-UPGRADE-001: a live owner with legacy or unknown identity cannot be treated as a stale lock", async () => {
  const root = resolve(".codex/scratch/dev-upgrade"); mkdirSync(root, { recursive: true });
  const runtime = mkdtempSync(join(root, "lock-"));
  const contents = JSON.stringify({ pid: process.pid, identity: "legacy-locale-identity" });
  const originalLocale = process.env.LC_ALL;
  const stableIdentity = processIdentity(process.pid);
  try {
    process.env.LC_ALL = "zh_CN.UTF-8";
    assert.equal(processIdentity(process.pid), stableIdentity, "new identities are independent of terminal locale");
  } finally {
    if (originalLocale === undefined) delete process.env.LC_ALL;
    else process.env.LC_ALL = originalLocale;
  }
  writeFileSync(join(runtime, "cli.lock"), contents);
  let release: (() => void) | undefined;
  try {
    assert.throws(() => { release = acquireLock(runtime); }, /runtime_lock_identity_unverified/);
    assert.equal(readFileSync(join(runtime, "cli.lock"), "utf8"), contents);
    assert.equal(await terminateLease({ pid: process.pid, identity: "legacy-locale-identity" }), false);
  } finally { release?.(); }
});
