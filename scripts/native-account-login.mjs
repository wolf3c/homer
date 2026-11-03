// Native account login only. Tokens and device codes stay in the native CLI/Terminal.
// No auth-file reader, credential copier, model request or session migration here.
import { spawn } from 'node:child_process';
import { readFileSync, realpathSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join, relative, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
const within = (root, path) => { const rel = relative(root, path); return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel)); };
export function nativeLoginContext(configPath) {
  const absolute = resolve(configPath), config = JSON.parse(readFileSync(absolute, 'utf8'));
  const appData = resolve(config.appData ?? join(homedir(), 'Library/Application Support/Homer'));
  const home = resolve(config.nativeCodexHome ?? join(appData, 'codex'));
  const oldHome = config.codexHome ? resolve(config.codexHome) : undefined;
  if (home === '/' || home === homedir() || home === join(homedir(), '.codex') ||
      (oldHome && oldHome !== home && (within(oldHome, home) || within(home, oldHome))))
    throw Error('native_login_home_not_isolated');
  const runtime = resolve(dirname(absolute), config.runtime ?? join(appData, 'runtime'));
  const workspace = resolve(dirname(absolute), config.workspace ?? join(appData, 'workspace'));
  if ([runtime, workspace].some(path => within(path, home) || within(home, path)))
    throw Error('native_login_home_overlaps_business_data');
  mkdirSync(home, { recursive: true, mode: 0o700 });
  if (realpathSync(home) !== home) throw Error('native_login_home_symlink_denied');
  const hostHome = join(home, 'host-home');
  mkdirSync(hostHome, { recursive: true, mode: 0o700 });
  if (realpathSync(hostHome) !== hostHome) throw Error('native_login_host_home_symlink_denied');
  const bin = realpathSync(resolve(config.codexBin));
  const env = { HOME: hostHome, CODEX_HOME: home, PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'zh_CN.UTF-8', ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}) };
  const settings = { sqlite_home: home, log_dir: join(home, 'log'), cli_auth_credentials_store: 'file', mcp_oauth_credentials_store: 'file', 'analytics.enabled': false, 'feedback.enabled': false, 'features.hooks': false, 'features.plugins': false, 'features.apps': false, 'features.multi_agent': false, 'features.multi_agent_v2': false, 'features.memories': false, 'memories.generate_memories': false, 'memories.use_memories': false };
  const args = Object.entries(settings).flatMap(([key, value]) => ['-c', key + '=' + JSON.stringify(value)]);
  return { bin, home, cwd: hostHome, env, args };
}
async function captured(context, args) {
  return await new Promise((accept, reject) => {
    const child = spawn(context.bin, args, { cwd: context.cwd, env: context.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let text = '', expired = false;
    const timer = setTimeout(() => { expired = true; child.kill('SIGTERM'); }, 15000);
    const collect = data => { if (text.length < 4096) text += data.toString('utf8').slice(0, 4096 - text.length); };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    child.on('error', () => { clearTimeout(timer); reject(Error('native_login_command_unavailable')); });
    child.on('close', code => { clearTimeout(timer); if (expired) reject(Error('native_login_status_timeout')); else accept({ code, text }); });
  });
}
export async function nativeAccountStatus(context) {
  const version = await captured(context, ['--version']);
  if (version.code !== 0 || version.text.trim() !== 'codex-cli 0.163.0') throw Error('native_login_fixed_version_required');
  const result = await captured(context, [...context.args, 'login', 'status']);
  // Never relay raw native status: other credential types may include key fragments.
  if (result.code === 0 && /Logged in using ChatGPT/i.test(result.text)) return { loggedIn: true, kind: 'chatgpt' };
  if (result.code === 0 && /API key/i.test(result.text)) return { loggedIn: true, kind: 'api_key' };
  if (result.code !== 0 && /Not logged in/i.test(result.text)) return { loggedIn: false, kind: 'none' };
  throw Error('native_login_status_unconfirmed');
}
export async function runNativeAccountLogin(configPath, action) {
  if (!['status', 'login'].includes(action)) throw Error('native_login_action_invalid');
  const context = nativeLoginContext(configPath), status = await nativeAccountStatus(context);
  if (action === 'login' && status.loggedIn && status.kind !== 'chatgpt') throw Error('native_subscription_login_required');
  if (action === 'status' || status.loggedIn) { console.log(JSON.stringify({ ...status, codexHome: context.home, fixedVersion: '0.163.0', noModelRequest: true })); return; }
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw Error('native_login_requires_personal_terminal');
  console.log('请本人完成下方 Codex 原生设备登录。验证码只在此终端显示，不要发给助手。');
  console.log('登录目录：' + context.home);
  const code = await new Promise((accept, reject) => {
    const child = spawn(context.bin, [...context.args, 'login', '--device-auth'], { cwd: context.cwd, env: context.env, stdio: 'inherit' });
    child.on('error', () => reject(Error('native_login_command_unavailable'))); child.on('close', accept);
  });
  if (code !== 0) throw Error('native_login_not_completed');
  const confirmed = await nativeAccountStatus(context);
  if (!confirmed.loggedIn || confirmed.kind !== 'chatgpt') throw Error('native_subscription_login_unconfirmed');
  console.log('Homer 专属 Codex 原生登录已完成。尚未创建新主对话，请保留日常窗口，等待安全空闲切换；旧对话不会导入。');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await runNativeAccountLogin(process.argv[2], process.argv[3]); }
  catch (error) { console.error('未完成：' + error.message + '。原日常绑定未变；可修正后重试此入口。'); process.exitCode = 1; }
}
