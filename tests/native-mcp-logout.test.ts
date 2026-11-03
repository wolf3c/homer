import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, join } from 'node:path';
import { NativeCapabilities } from '../src/native-capabilities.js';
test('native MCP logout needs the owner, exact native config version and an HTTP connection', async () => {
    const home = resolve('.codex/scratch/native-capabilities-expansion/logout-contract');
    let calls = 0;
    const manager = new NativeCapabilities(home, async (method) => method === 'config/read' ? { layers: [{ name: { type: 'user', file: join(home, 'config.toml') }, version: 'current', config: { mcp_servers: { remote: { url: 'http://127.0.0.1:1/mcp', enabled_tools: ['echo'] }, local: { command: '/usr/bin/true', enabled_tools: [] } } } }] } : { data: [] }, () => false, async (name, server) => { assert.equal(name, 'remote'); assert.equal(server.url, 'http://127.0.0.1:1/mcp'); calls++; });
    const input = { action: 'oauth_logout', name: 'remote', expectedVersion: 'current', approve: true };
    await assert.rejects(() => manager.manage(input, 'agent'), /capability_user_approval_required/);
    await assert.rejects(() => manager.manage({ ...input, approve: false }, 'user'), /capability_user_approval_required/);
    await assert.rejects(() => manager.manage({ ...input, expectedVersion: 'stale' }, 'user'), /capability_config_conflict/);
    await assert.rejects(() => manager.manage({ ...input, name: 'local' }, 'user'), /capability_oauth_unavailable/);
    assert.equal(calls, 0);
    assert.deepEqual(await manager.manage(input, 'user'), { loggedOut: true, application: 'isolated_configuration_only' });
    assert.equal(calls, 1);
});
