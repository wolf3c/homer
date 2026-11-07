import { spawn, execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
import { HOST_MCP_TOOLS, WorkerInteractionMcp } from "../src/worker-interaction-mcp.js";
import { MAIN_TOOLS } from "../src/tools.js";
import { RECURSIVE_TOOLS } from "../src/recursive-tools.js";

const tools = [...MAIN_TOOLS, ...RECURSIVE_TOOLS];

const requestedBin = process.argv[2] ?? "codex";
const codexBin = requestedBin.includes("/") ? resolve(requestedBin) : requestedBin;
const codexVersion = execFileSync(codexBin, ["--version"], { encoding: "utf8", timeout: 5000 }).trim();
assert.equal(codexVersion, "codex-cli 0.163.0", "fixed Codex 0.163.0 required");
const root = resolve(".codex/scratch/worker-interactions");
mkdirSync(root, { recursive: true });
const dir = mkdtempSync(join(root, "compat-"));
const home = join(dir, "codex"), hostHome = join(dir, "host-home"), tmp = join(dir, "tmp");
for (const path of [home, hostHome, tmp]) mkdirSync(path, { mode: 0o700 });
let hostCalls = 0;
const capabilities = { runtime: { version: "synthetic-compatibility-probe" } };
const server = new WorkerInteractionMcp(dir, async (tool,args:any) => {
  if(tool==='runtime_capabilities'&&args&&Object.keys(args).length===0){hostCalls++;return capabilities;}
  throw new Error("interaction_probe_tool_denied");
});
function toml(value: any): string {
  if (value && typeof value === "object" && !Array.isArray(value))
    return "{" + Object.entries(value).map(([key, item]) => JSON.stringify(key) + "=" + toml(item)).join(",") + "}";
  return JSON.stringify(value);
}
function processServer(withMcp: boolean) {
  const settings: Record<string, unknown> = {
    approval_policy: "never", web_search: "disabled", "features.shell_tool": false,
    "features.plugins": false, "features.apps": false, "features.memories": false,
    "memories.generate_memories": false, "memories.use_memories": false,
    "features.skill_search": false, "features.skip_host_skill_discovery": true,
    "analytics.enabled": false, "feedback.enabled": false,
    model_provider: "synthetic_boundary",
    "model_providers.synthetic_boundary": { name: "Synthetic local boundary", base_url: "http://127.0.0.1:9/v1", wire_api: "responses", supports_websockets: false, requires_openai_auth: false },
  };
  if (withMcp) settings["mcp_servers.homer_interactions"] = {
    command: process.execPath,
    cwd: server.directory,
    args: ["--import", resolve("node_modules/tsx/dist/loader.mjs"), resolve("src/worker-interaction-mcp-stdio.ts"), server.path],
    startup_timeout_sec: 15,
  };
  const child = spawn(codexBin, ["app-server", "--stdio", ...Object.entries(settings).flatMap(([key,value]) => ["-c", key + "=" + toml(value)])], {
    cwd: dir, env: { HOME: hostHome, PATH: "/usr/bin:/bin:/usr/sbin:/sbin", TMPDIR: tmp, CODEX_HOME: home }, stdio: ["pipe", "pipe", "pipe"],
  });
  child.stderr.resume();
  let sequence = 0;
  const pending = new Map<number, { resolve: (v: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  const exited = new Promise<void>(done => child.once("exit", () => done()));
  child.on("error", () => { for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error("native_probe_spawn_failed")); } pending.clear(); });
  createInterface({ input: child.stdout }).on("line", line => {
    const message = JSON.parse(line);
    if (message.id !== undefined && !message.method) {
      const item = pending.get(message.id);
      if (item) { pending.delete(message.id); clearTimeout(item.timer); message.error ? item.reject(new Error("native_probe_rpc_error")) : item.resolve(message.result); }
    }
  });
  const request = (method: string, params: unknown): Promise<any> => new Promise((resolve,reject) => {
    assert.notEqual(method, "turn/start", "protocol probe must not call a model");
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("native_probe_timeout:" + method)); }, 20000);
    pending.set(id, { resolve,reject,timer });
    child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
  });
  return {
    request,
    async init() { const initialized = await request("initialize", { clientInfo: { name: "homer-protocol-probe", version: "1" }, capabilities: { experimentalApi: true } }); assert.equal(resolve(initialized.codexHome), home); child.stdin.write(JSON.stringify({ method: "initialized" }) + "\n"); },
    async close() { child.kill(); let timer: NodeJS.Timeout | undefined; await Promise.race([exited,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error("native_probe_stop_unconfirmed")),5000);})]).finally(()=>clearTimeout(timer)); for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error("probe_closed")); } pending.clear(); },
  };
}
let first: ReturnType<typeof processServer> | undefined, second: ReturnType<typeof processServer> | undefined;
try {
  await server.start();
  first = processServer(false);
  await first.init();
  const start = await first.request("thread/start", { cwd: dir, model: "gpt-6.1-sol", modelProvider: "synthetic_boundary", approvalPolicy: "never", sandbox: "read-only", dynamicTools: tools, environments: [] });
  const id = start.thread.id;
  await first.request("thread/memoryMode/set", {threadId:id,mode:"disabled"});
  await first.request("thread/inject_items", { threadId: id, items: [{ type: "message", role: "user", content: [{ type: "input_text", text: "Synthetic compatibility marker only. No model execution." }] }] });
  const history = await first.request("thread/read", { threadId: id, includeTurns: true });
  assert.equal(history.thread.id, id);
  // Read only the synthetic rollout created by this probe, never an account's history.
  const readRollout = (path: string) => { assert.ok(path.startsWith(home + "/")); return readFileSync(path, "utf8"); };
  const originalRollout = readRollout(history.thread.path);
  assert.ok(originalRollout.includes("Synthetic compatibility marker only"));
  const metadata = (rollout: string) => rollout.split("\n").filter(Boolean).map(line => JSON.parse(line)).find(item => item.type === "session_meta").payload;
  const originalTools = metadata(originalRollout).dynamic_tools;
  assert.deepEqual(originalTools, tools);
  await first.close(); first = undefined;
  second = processServer(true);
  await second.init();
  const resumed = await second.request("thread/resume", { threadId: id, excludeTurns: true, cwd: dir, approvalPolicy: "never" });
  assert.equal(resumed.thread.id, id);
  await second.request("thread/memoryMode/set", {threadId:id,mode:"disabled"});
  const inventory = await second.request("mcpServerStatus/list", { threadId: id, detail: "full", limit: 100 });
  const local = inventory.data.find((item: any) => item.name === "homer_interactions");
  assert.ok(local);
  assert.deepEqual(Object.keys(local.tools).sort(), HOST_MCP_TOOLS.map(t=>t.name).sort());
  // Actual native RPC -> stdio MCP -> Homer socket, no model or auth.
  const result=await second.request('mcpServer/tool/call',{threadId:id,server:'homer_interactions',tool:'runtime_capabilities',arguments:{}});
  assert.notEqual(result.isError,true);assert.deepEqual(JSON.parse(result.content[0].text),capabilities);assert.equal(hostCalls,1);
  const resumedRollout = readRollout(resumed.thread.path);
  assert.ok(resumedRollout.includes("Synthetic compatibility marker only"));
  assert.deepEqual(metadata(resumedRollout).dynamic_tools, originalTools);
  const evidence = { codex: codexVersion, modelCalled: false, isolatedHome: true, sameThreadAfterProcessRestart: true, syntheticHistoryPreserved: true, originalDynamicToolsPreserved: true, originalDynamicToolCount: tools.length, threadMemoryModeDisableBeforeAndAfterResume: true, actualNativeMcpRuntimeCapabilities: true, hostCalls, trustedMcpToolNames: Object.keys(local.tools).sort() };
  writeFileSync(join(root, "native-tool-compatibility-evidence.json"), JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify(evidence));
} finally {
  await first?.close();
  await second?.close();
  await server.close();
}
