import {createConnection} from 'node:net';
import type {EngineOptions} from '../../src/engine.js';

export function mcpCall(path: string, tool: string, args: unknown, meta?: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(path);
    let data = '';
    socket.setTimeout(2500, () => socket.destroy(Error('test_mcp_timeout')));
    socket.on('error', reject);
    socket.on('connect', () => socket.write(JSON.stringify({tool, arguments: args, meta}) + '\n'));
    socket.on('data', chunk => { data += chunk; });
    socket.on('end', () => { try { resolve(JSON.parse(data)); } catch (error) { reject(error); } });
  });
}

export async function callHostMcp(options: EngineOptions, tool: string, args: unknown): Promise<any> {
  const mcp = options.interactionMcp;
  if (!mcp) throw Error('test_mcp_missing');
  const roleIndex = mcp.args.indexOf(options.role === 'worker' ? 'worker' : 'main');
  const path = mcp.args[roleIndex - 1];
  if (roleIndex < 1 || !path) throw Error('test_mcp_socket_missing');
  const response = await mcpCall(path, tool, args);
  if (response.error) throw Error(response.error);
  return response.result;
}
