import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Config } from './config.js';
import { usesHomerNativeHome } from './config.js';
const toml = (value: unknown): string => value !== null && typeof value === 'object' && !Array.isArray(value) ? '{' + Object.entries(value).map(([key, item]) => JSON.stringify(key) + '=' + toml(item)).join(',') + '}' : JSON.stringify(value);
// 0.163.0 has a native CLI logout, not an AppServer MCP logout RPC. The CLI
// alone reads/removes its own file credential store; Homer never reads tokens.
export async function nativeMcpLogout(config: Config, name: string, server: Record<string, unknown>) {
    if (!usesHomerNativeHome(config) || !/^[a-z][a-z0-9_-]{0,63}$/.test(name) || !server.url)
        throw Error('capability_oauth_unavailable');
    const cwd = join(config.codexHome, 'homer-control'), hostHome = join(config.codexHome, 'host-home');
    mkdirSync(cwd, { recursive: true, mode: 0o700 });
    mkdirSync(hostHome, { recursive: true, mode: 0o700 });
    const run = (args: string[], version = false) => new Promise<string>((resolve, reject) => {
        const child = spawn(config.codexBin, args, { cwd, env: { HOME: hostHome, CODEX_HOME: config.codexHome, PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, LANG: process.env.LANG }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
        let text = '', expired = false, killTimer: NodeJS.Timeout | undefined;
        child.stdout.on('data', (value: Buffer) => { if (version && text.length < 1024)
            text += value.toString('utf8'); });
        child.stderr.resume();
        const kill = (signal: NodeJS.Signals) => { if (child.pid && child.exitCode === null)
            try {
                process.kill(-child.pid, signal);
            }
            catch { } };
        const timer = setTimeout(() => { expired = true; kill('SIGTERM'); killTimer = setTimeout(() => kill('SIGKILL'), 1000); }, 10000);
        child.on('error', () => { clearTimeout(timer); if (killTimer)
            clearTimeout(killTimer); reject(Error('capability_native_logout_failed')); });
        child.on('close', code => { clearTimeout(timer); if (killTimer)
            clearTimeout(killTimer); if (expired || code !== 0)
            reject(Error(expired ? 'capability_native_logout_timeout' : 'capability_native_logout_failed'));
        else
            resolve(text.trim()); });
    });
    if (await run(['--version'], true) !== 'codex-cli 0.163.0')
        throw Error('capability_native_version_or_home_mismatch');
    await run(['-c', 'mcp_oauth_credentials_store="file"', '-c', 'sqlite_home=' + JSON.stringify(config.codexHome), '-c', 'log_dir=' + JSON.stringify(join(config.codexHome, 'log')), '-c', 'analytics.enabled=false', '-c', 'feedback.enabled=false', '-c', 'features.hooks=false', '-c', 'mcp_servers.' + name + '=' + toml(server), 'mcp', 'logout', name]);
}
