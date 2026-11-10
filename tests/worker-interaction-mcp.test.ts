import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { createConnection } from "node:net";
import { WorkerInteractionMcp,HOST_MCP_TOOLS,WORKER_HOST_MCP_TOOLS } from "../src/worker-interaction-mcp.js";

for(const role of ['main','worker'] as const)test("HMR-INTERACTION-PROTOCOL: bound "+role+" MCP inventory isolates memory/publication and returns business data without logging", async () => {
  const root = resolve(".codex/scratch/worker-interactions");
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(root + "/mcp-");
  const calls: string[] = [];
  const server = new WorkerInteractionMcp(dir, async (name, args) => {
    calls.push(name);
    if ((args as any).interactionId === "fail") throw new Error("private provider body token=synthetic");
    return { state: "pending_main", details: { question: "synthetic business question" } };
  },role==='worker'?WORKER_HOST_MCP_TOOLS:HOST_MCP_TOOLS);
  let child: ReturnType<typeof spawn> | undefined;
  try {
    await server.start();
    if(process.platform==='win32')assert.match(server.path,/^\\\\\.\\pipe\\homer-hi-/);
    else assert.equal(statSync(server.path).mode & 0o777, 0o600);
    child = spawn(process.execPath, ["--import", "tsx", resolve("src/worker-interaction-mcp-stdio.ts"), server.path,role], { stdio: ["pipe", "pipe", "pipe"] });
    const pending = new Map<number, (value: any) => void>();
    let seq = 0, stderr = "";
    child.stderr!.on("data", chunk => { stderr += chunk; });
    createInterface({ input: child.stdout! }).on("line", line => {
      const message = JSON.parse(line);
      pending.get(message.id)?.(message);
      pending.delete(message.id);
    });
    const rpc = (method: string, params: unknown) => new Promise<any>((done, reject) => {
      const id = ++seq;
      const timer = setTimeout(() => reject(new Error("test_mcp_timeout")), 3000);
      pending.set(id, value => { clearTimeout(timer); done(value); });
      child!.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
    assert.equal((await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "synthetic-test", version: "1" } })).result.serverInfo.name, "homer-interactions");
    const tools = (await rpc("tools/list", {})).result.tools;
    assert.deepEqual(tools.map((tool: any) => tool.name), role==='main'?['work_directory','inspect_interaction','respond_interaction','escalate_interaction','runtime_capabilities','inspect_attachment']:['work_directory','inspect_attachment']);
    const inspected=role==='main'?'inspect_interaction':'work_directory';
    const response = await rpc("tools/call", { name: inspected, arguments: { interactionId: "request-a" } });
    assert.equal(response.result.isError, false);
    assert.equal(JSON.parse(response.result.content[0].text).details.question, "synthetic business question");
    const failure = await rpc("tools/call", { name: inspected, arguments: { interactionId: "fail" } });
    assert.equal(failure.result.content[0].text, "interaction_mcp_failed");
    assert.equal((await rpc("tools/call", { name: "shell", arguments: {} })).result.isError, true);
    for(const forbidden of ['file_checkpoint','task_create','task_update','worker_open','worker_send','worker_read','worker_interrupt','work_inspect','accept_result','task_delegate','task_review','task_stop','task_continue','task_takeover','agent_send','inbox_read','inbox_ack','adopt_version','pending_add','pending_list','pending_update','memory_search','memory_forget','publish_delivery'])assert.equal((await rpc('tools/call',{name:forbidden,arguments:{ownerId:'main'}})).result.isError,true);
    if(role==='worker')for(const forbidden of ['quote_current_message','prepare_combined_delivery','runtime_capabilities','inspect_result_file'])assert.equal((await rpc('tools/call',{name:forbidden,arguments:{ownerId:'main'}})).result.isError,true);
    const wait=await rpc('tools/call',{name:'task_wait',arguments:{}});
    assert.equal(wait.result.isError,true);
    if(role==='main'){
      assert.equal(wait.result.content[0].text,'interaction_tool_denied');
      const direct=await new Promise<any>((done,reject)=>{
        const socket=createConnection(server.path);let data='';
        socket.on('error',reject);socket.setTimeout(3000,()=>{socket.destroy();reject(Error('test_mcp_timeout'));});
        socket.on('connect',()=>socket.write(JSON.stringify({tool:'task_wait',arguments:{}})+'\n'));
        socket.on('data',chunk=>{data+=chunk;});socket.on('end',()=>done(JSON.parse(data)));
      });
      assert.equal(direct.error,'interaction_tool_denied');
    }
    assert.equal((await rpc('tools/call',{name:'capabilities',arguments:{action:'discover'}})).result.isError,true);
    assert.deepEqual(calls,[inspected,inspected]);
    assert.equal(stderr, "");
  } finally {
    child?.kill();
    if (child && child.exitCode === null && child.signalCode === null) await new Promise<void>(done => child!.once("exit", () => done()));
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
