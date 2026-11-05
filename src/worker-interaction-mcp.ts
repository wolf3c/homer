import {EXECUTION_TOOLS} from './execution-tools.js';
import { createServer, createConnection, type Server, type Socket } from "node:net";
import { createInterface } from "node:readline";
import { chmodSync, unlinkSync } from "node:fs";
import { join, relative } from "node:path";
import { randomUUID } from "node:crypto";
import { MAIN_INTERACTION_TOOLS } from "./worker-interaction-tools.js";
import type { Tool } from "./engine.js";
import { MEDIA_TOOLS,WORKER_MEDIA_TOOLS } from './media-tools.js';

import {CAPABILITY_TOOLS} from "./native-capability-tools.js";
import {INTERACTION_LIMITS} from './interaction-limits.js';

export const HOST_MCP_TOOLS = [...EXECUTION_TOOLS,...CAPABILITY_TOOLS,...MAIN_INTERACTION_TOOLS,...MEDIA_TOOLS];
export const WORKER_HOST_MCP_TOOLS = [...EXECUTION_TOOLS,...CAPABILITY_TOOLS,...WORKER_MEDIA_TOOLS];
const allowed = (name: unknown, catalog:readonly Tool[]): name is string => typeof name === "string" && catalog.some(tool => tool.name === name);
function code(error: unknown) {
  return error instanceof Error && /^[a-z][a-z0-9_]{1,70}$/.test(error.message) ? error.message : "interaction_mcp_failed";
}
// File writes and business collaboration use native dynamic call identity.
export class WorkerInteractionMcp {
  readonly path: string;
  readonly directory = process.cwd();
  private server?: Server;
  private sockets = new Set<Socket>();
  constructor(runtime: string, private handle: (tool: string, args: unknown) => Promise<unknown>,private catalog:readonly Tool[]=HOST_MCP_TOOLS) {
    const absolute = join(runtime, "hi-" + randomUUID().slice(0, 8) + ".sock");
    const local = relative(this.directory, absolute);
    this.path = Buffer.byteLength(local) < Buffer.byteLength(absolute) ? local : absolute;
  }
  async start() {
    if (Buffer.byteLength(this.path) > 100) throw new Error("interaction_socket_path_too_long");
    if (this.server) throw new Error("interaction_mcp_already_started");
    this.server = createServer(socket => {
      this.sockets.add(socket);
      socket.on("close", () => this.sockets.delete(socket));
      socket.on("error", () => {});
      socket.setTimeout(INTERACTION_LIMITS.connectMs, () => socket.destroy());
      let received = false, buffer = "";
      socket.setEncoding("utf8");
      socket.on("data", chunk => {
        if (received) return;
        buffer += chunk;
        if (Buffer.byteLength(buffer) > 160 * 1024) { socket.destroy(); return; }
        const end = buffer.indexOf("\n");
        if (end < 0) return;
        received = true;
        void (async () => {
          try {
            const message = JSON.parse(buffer.slice(0, end));
            if (!allowed(message.tool,this.catalog)) throw new Error("interaction_tool_denied");
            socket.setTimeout(INTERACTION_LIMITS.businessMs);
            const result = JSON.stringify({ result: await this.handle(message.tool, message.arguments) });
            if (Buffer.byteLength(result) > INTERACTION_LIMITS.responseBytes) throw new Error("interaction_response_too_large");
            socket.end(result + "\n");
          } catch (error) { socket.end(JSON.stringify({ error: code(error) }) + "\n"); }
        })();
      });
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(this.path, () => {
        try { chmodSync(this.path, 0o600); resolve(); }
        catch { reject(new Error("interaction_socket_permissions_failed")); }
      });
    });
  }
  async close() {
    for (const socket of this.sockets) socket.destroy();
    if (this.server?.listening)
      await new Promise<void>(resolve => this.server!.close(() => resolve()));
    this.server = undefined;
    try { unlinkSync(this.path); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("interaction_socket_cleanup_failed");
    }
  }
}

function hostCall(path: string, tool: string, args: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(path);
    let buffer = "", settled = false, dispatched=false;
    const fail = () => { if (!settled) { settled = true; reject(new Error(dispatched?"interaction_result_unconfirmed":"interaction_host_unavailable")); } socket.destroy(); };
    socket.setTimeout(INTERACTION_LIMITS.connectMs, fail);
    socket.on("error", fail);
    socket.on("end", () => { if (!settled) fail(); });
    socket.on("connect", () => {
      const request=JSON.stringify({ tool, arguments: args }) + "\n";
      // Once writing starts, a lost reply cannot prove that work did not run.
      dispatched=true;socket.setTimeout(INTERACTION_LIMITS.businessMs);socket.write(request);
    });
    socket.setEncoding("utf8");
    socket.on("data", chunk => {
      if (settled) return;
      buffer += chunk;
      if (Buffer.byteLength(buffer) > INTERACTION_LIMITS.responseBytes+1) { fail(); return; }
      const end = buffer.indexOf("\n");
      if (end < 0) return;
      try {
        const message = JSON.parse(buffer.slice(0, end));
        settled = true;
        if (typeof message.error === "string" && /^[a-z][a-z0-9_]{1,70}$/.test(message.error)) reject(new Error(message.error));
        else if (message.error) reject(new Error("interaction_mcp_failed"));
        else resolve(message.result);
        socket.end();
      } catch { fail(); }
    });
  });
}

export function runWorkerInteractionMcp(path: string,role:string='main') {
  if(!['main','worker'].includes(role))throw Error('interaction_role_denied');
  const catalog=role==='worker'?WORKER_HOST_MCP_TOOLS:HOST_MCP_TOOLS;
  const send = (message: unknown) => process.stdout.write(JSON.stringify(message) + "\n");
  createInterface({ input: process.stdin }).on("line", line => {
    void (async () => {
      let message: any;
      try {
        if (Buffer.byteLength(line) > 160 * 1024) return;
        message = JSON.parse(line);
        if (message.id === undefined) return;
        let result: unknown;
        if (message.method === "initialize") result = {
          protocolVersion: ["2024-11-05", "2025-03-26", "2025-06-18"].includes(message.params?.protocolVersion) ? message.params.protocolVersion : "2024-11-05",
          capabilities: { tools: {} }, serverInfo: { name: "homer-interactions", version: "0.1.0" },
        };
        else if (message.method === "ping") result = {};
        else if (message.method === "tools/list") result = { tools: catalog.map(({ type: _type, ...tool }) => tool) };
        else if (message.method === "tools/call") {
          try {
            if (!allowed(message.params?.name,catalog)) throw new Error("interaction_tool_denied");
            const value = await hostCall(path, message.params.name, message.params.arguments);
            const media=value as {mediaContent?:unknown[]};
            result = { isError: false, content: media?.mediaContent??[{ type: "text", text: JSON.stringify(value) }] };
          } catch (error) { const failure=code(error);result = { isError: true, content: [{ type: "text", text: failure },...(failure==='interaction_result_unconfirmed'?[{type:'text',text:'The request may still complete. Do not replay it. Inspect current state and any original host receipt. This error does not confirm cancellation.'}]:[])] }; }
        } else { send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "interaction_method_denied" } }); return; }
        send({ jsonrpc: "2.0", id: message.id, result });
      } catch {
        if (message?.id !== undefined) send({ jsonrpc: "2.0", id: message.id, error: { code: -32600, message: "interaction_invalid_request" } });
      }
    })();
  });
}
