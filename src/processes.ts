import { execFileSync } from "node:child_process";
import {
  openSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
  closeSync,
} from "node:fs";
import { join } from "node:path";
export function processIdentity(pid: number): string | undefined {
  try {
    const s = execFileSync(
      "/bin/ps",
      ["-p", String(pid), "-o", "lstart=,pgid=,comm="],
      { encoding: "utf8", timeout: 3000, env: { ...process.env, LC_ALL: "C", LANG: "C" } },
    ).trim();
    return s || undefined;
  } catch {
    return undefined;
  }
}
export function acquireLock(runtime: string) {
  const path = join(runtime, "cli.lock");
  const identity = processIdentity(process.pid);
  if (!identity) throw new Error("process_identity_unavailable");
  try {
    const old = JSON.parse(readFileSync(path, "utf8"));
    if (processIdentity(old.pid) === old.identity)
      throw new Error("runtime_already_open");
    // Locale changes (and PID reuse) must never make a live lock look stale.
    // Only the absence of the owner permits removing its old lock.
    if (processAlive(old.pid)) throw new Error("runtime_lock_identity_unverified");
    unlinkSync(path);
  } catch (e) {
    if (e instanceof Error && ["runtime_already_open", "runtime_lock_identity_unverified"].includes(e.message)) throw e;
    if (
      (e as NodeJS.ErrnoException).code !== "ENOENT" &&
      (e as SyntaxError).name === "SyntaxError"
    )
      throw new Error("runtime_lock_invalid");
  }
  const fd = openSync(path, "wx", 0o600);
  writeFileSync(fd, JSON.stringify({ pid: process.pid, identity }));
  closeSync(fd);
  return () => {
    try {
      const old = JSON.parse(readFileSync(path, "utf8"));
      if (old.pid === process.pid && old.identity === identity)
        unlinkSync(path);
    } catch {}
  };
}
function processAlive(pid: number) {
  if (!Number.isSafeInteger(pid) || pid < 1) return true;
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
}
export async function terminateLease(lease: { pid: number; identity: string }) {
  if (processIdentity(lease.pid) !== lease.identity) return !processAlive(lease.pid);
  try {
    process.kill(-lease.pid, "SIGTERM");
  } catch {}
  const until = Date.now() + 1500;
  while (processIdentity(lease.pid) === lease.identity && Date.now() < until)
    await new Promise((r) => setTimeout(r, 30));
  if (processIdentity(lease.pid) === lease.identity) {
    try {
      process.kill(-lease.pid, "SIGKILL");
    } catch {}
  }
  return processIdentity(lease.pid) !== lease.identity;
}
export type Resources = {
  at: number;
  processCount: number;
  rssMiB: number;
  cpuPercent: number;
};
export function sampleProcessTree(rootPid = process.pid): Resources {
  const rows = execFileSync("/bin/ps", ["-axo", "pid=,ppid=,rss=,%cpu="], {
    encoding: "utf8",
    timeout: 3000,
  })
    .trim()
    .split("\n")
    .map((line) => line.trim().split(/\s+/).map(Number));
  const ids = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [pid, ppid] of rows)
      if (
        pid !== undefined &&
        ppid !== undefined &&
        ids.has(ppid) &&
        !ids.has(pid)
      ) {
        ids.add(pid);
        changed = true;
      }
  }
  const own = rows.filter((r) => r[0] !== undefined && ids.has(r[0]));
  return {
    at: Date.now(),
    processCount: own.length,
    rssMiB:
      Math.round((own.reduce((a, r) => a + (r[2] ?? 0), 0) / 1024) * 10) / 10,
    cpuPercent: Math.round(own.reduce((a, r) => a + (r[3] ?? 0), 0) * 10) / 10,
  };
}
