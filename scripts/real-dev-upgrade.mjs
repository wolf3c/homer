// Explicit opt-in: two real model turns, synthetic text, separate workspace/runtime.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdirSync, mkdtempSync, cpSync, existsSync, symlinkSync, writeFileSync, appendFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { loadConfig } from "../dist/config.js";
if (!process.argv[2]) throw new Error("explicit_authorized_config_required");
const root = resolve("."), original = loadConfig(resolve(process.argv[2]));
mkdirSync(join(root, ".codex/scratch/dev-upgrade"), { recursive: true });
const base = mkdtempSync(join(root, ".codex/scratch/dev-upgrade/real-"));
for (const path of ["src", "scripts", "prompts", "assets", "package.json", "package-lock.json", "tsconfig.json"]) if (existsSync(path)) cpSync(path, join(base, path), { recursive: true });
symlinkSync(join(root, "node_modules"), join(base, "node_modules"), "dir");
const config = { ...original, workspace: join(base, "workspace"), runtime: join(root, ".codex/private/dev-upgrade-real-" + randomUUID()) };
mkdirSync(join(config.workspace, "materials"), { recursive: true });
writeFileSync(join(config.workspace, "materials/synthetic.md"), "# Synthetic upgrade test\nNo user documents.\n");
const configPath = join(base, "synthetic.config.json"); writeFileSync(configPath, JSON.stringify(config));
const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", join(base, "scripts/dev.mjs"), "--config", configPath, "--json"], { cwd: base, stdio: ["pipe", "pipe", "ignore"] });
let replies = [], versions = [], exited = false, failure;
createInterface({ input: child.stdout }).on("line", line => {
  const m = JSON.parse(line);
  if (m.type === "reply") replies.push(m.text);
  if (m.text?.includes("开发版已生效")) versions.push(m.text.match(/已生效 ([a-f0-9]+)/)?.[1]);
  if (m.type === "error" || /启动.*失败|服务退出|候选未生效/.test(m.text)) failure = "real_upgrade_service_failed";
});
child.once("exit", () => { exited = true; });
const until = async predicate => {
  const end = Date.now() + 120000;
  while (!predicate()) {
    if (exited || failure || Date.now() > end) throw new Error(failure ?? "real_upgrade_timeout");
    await new Promise(r => setTimeout(r, 100));
  }
};
const mainThread = () => {
  const d = new DatabaseSync(join(config.runtime, "homer.sqlite"));
  try { return d.prepare("SELECT value FROM meta WHERE key='mainThread'").get().value; } finally { d.close(); }
};
const result = { at: new Date().toISOString(), synthetic: true, model: config.model, effort: config.effort, realModel: true, passed: false };
try {
  await until(() => versions.length === 1);
  const thread = mainThread(), marker = "HomerSynthetic" + randomUUID().slice(0, 8);
  child.stdin.write(`请记住仅用于测试的合成暗号 ${marker}。直接回答已记住，不要派任务。\n`);
  await until(() => replies.length === 1);
  if (/主 Agent 未完成/.test(replies[0])) throw new Error("real_seed_failed");
  const promptPath = join(base, "prompts/main.md");
  if (existsSync(promptPath)) appendFileSync(promptPath, "\n<!-- Synthetic build upgrade check. -->\n");
  else appendFileSync(join(base, "src/prompts.ts"), "\n// Synthetic build upgrade: no prompt behavior change.\n");
  await until(() => versions.length === 2);
  result.sameThread = mainThread() === thread;
  child.stdin.write("请只回答刚才测试用的完整合成暗号，不要派任务。\n");
  await until(() => replies.length === 2);
  result.markerRecalled = replies[1].includes(marker);
  result.versions = versions;
  result.passed = result.sameThread && result.markerRecalled && versions[0] !== versions[1];
  if (!result.passed) throw new Error("real_continuity_failed");
} catch (error) { result.error = error.message; process.exitCode = 1; }
finally {
  replies = []; // Never persist model response bodies in validation evidence.
  child.stdin.write("/quit\n");
  const end = Date.now() + 15000;
  while (!exited && Date.now() < end) await new Promise(r => setTimeout(r, 100));
  result.cleanExit = exited && !existsSync(join(config.runtime, "cli.lock"));
  if (!exited) child.kill("SIGTERM");
  const d = new DatabaseSync(join(config.runtime, "homer.sqlite"));
  result.requestCount = d.prepare("SELECT count(*) n FROM requests").get().n;
  result.leasesRemaining = d.prepare("SELECT count(*) n FROM meta WHERE key LIKE 'lease:%'").get().n;
  result.integrity = d.prepare("PRAGMA integrity_check").get().integrity_check;
  d.close();
  result.passed &&= result.cleanExit && result.leasesRemaining === 0;
  writeFileSync(join(base, "real-upgrade-checks.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, evidence: join(base, "real-upgrade-checks.json") }));
  if (!result.passed) process.exitCode = 1;
}
