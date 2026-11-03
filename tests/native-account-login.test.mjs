import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { nativeLoginContext, nativeAccountStatus } from '../scripts/native-account-login.mjs';
const root = resolve('.codex/scratch/native-login-entry-tests');
mkdirSync(root, { recursive: true });
function fixture() {
  const dir = mkdtempSync(join(root, 'synthetic-')), state = join(dir, 'status.json'), audit = join(dir, 'audit.json'), bin = join(dir, 'synthetic-native.cjs'), config = join(dir, 'homer.json');
  writeFileSync(state, JSON.stringify({ code: 1, text: 'Not logged in' }));
  writeFileSync(bin, '#!' + process.execPath + '\n' + `const fs=require('node:fs');const args=process.argv.slice(2);if(args[0]==='--version'){console.log('codex-cli 0.163.0');process.exit(0);}fs.writeFileSync(${JSON.stringify(audit)},JSON.stringify({args,env:process.env}));const state=JSON.parse(fs.readFileSync(${JSON.stringify(state)}));console.error(state.text);process.exit(state.code);\n`, { mode: 0o700 });
  const raw = { appData: join(dir, 'app-data'), codexHome: join(dir, 'legacy-native'), codexBin: bin, workspace: join(dir, 'workspace'), runtime: join(dir, 'runtime') };
  writeFileSync(config, JSON.stringify(raw));
  return { dir, state, audit, bin, config, raw };
}
test('native account entry uses only dedicated HOME, file storage and minimal environment', async () => {
  const f = fixture(), context = nativeLoginContext(f.config);
  assert.equal(context.home, join(f.dir, 'app-data/codex'));
  assert.equal(context.env.CODEX_HOME, context.home);
  assert.equal(context.env.HOME, join(context.home, 'host-home'));
  assert.equal(await nativeAccountStatus(context).then(x => x.loggedIn), false);
  const audit = JSON.parse(readFileSync(f.audit));
  assert.deepEqual(Object.keys(audit.env).filter(key=>process.platform!=='darwin'||key!=='__CF_USER_TEXT_ENCODING').sort(), Object.keys(context.env).sort());
  assert.equal(audit.env.OPENAI_API_KEY, undefined); assert.equal(audit.env.HTTPS_PROXY, undefined);
  assert.ok(audit.args.includes('cli_auth_credentials_store="file"'));
  assert.ok(audit.args.includes('features.memories=false'));
  assert.deepEqual(audit.args.slice(-2), ['login', 'status']);
});
test('native account status never relays native credential fragments or unknown output', async () => {
  const f = fixture();
  writeFileSync(f.state, JSON.stringify({ code: 0, text: 'Logged in using an API key - SYNTHETIC_CREDENTIAL_FRAGMENT' }));
  const result = spawnSync(process.execPath, ['scripts/native-account-login.mjs', f.config, 'status'], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: f.dir, OPENAI_API_KEY: 'SYNTHETIC_NOT_INHERITED', HTTPS_PROXY: 'http://synthetic.invalid' } });
  assert.equal(result.status, 0); assert.equal(JSON.parse(result.stdout).kind, 'api_key');
  assert.equal((result.stdout + result.stderr).includes('SYNTHETIC_CREDENTIAL_FRAGMENT'), false);
  const audit = JSON.parse(readFileSync(f.audit)); assert.equal(audit.env.OPENAI_API_KEY, undefined); assert.equal(audit.env.HTTPS_PROXY, undefined);
  writeFileSync(f.state, JSON.stringify({ code: 0, text: 'SYNTHETIC_UNEXPECTED_PRIVATE_OUTPUT' }));
  await assert.rejects(nativeAccountStatus(nativeLoginContext(f.config)), /native_login_status_unconfirmed/);
});
test('native account entry refuses legacy HOME overlap and symlink destination', () => {
  const f = fixture();
  writeFileSync(f.config, JSON.stringify({ ...f.raw, nativeCodexHome: f.raw.codexHome + '/nested' }));
  assert.throws(() => nativeLoginContext(f.config), /native_login_home_not_isolated/);
  mkdirSync(join(f.dir, 'other-home')); symlinkSync(join(f.dir, 'other-home'), join(f.dir, 'linked-home'));
  writeFileSync(f.config, JSON.stringify({ ...f.raw, nativeCodexHome: join(f.dir, 'linked-home') }));
  assert.throws(() => nativeLoginContext(f.config), /native_login_home_symlink_denied/);
});
test('native subscription entry does not accept or replace an existing API-key login', () => {
  const f = fixture(); writeFileSync(f.state, JSON.stringify({ code: 0, text: 'Logged in using an API key - SYNTHETIC_OTHER_LOGIN' }));
  const result = spawnSync(process.execPath, ['scripts/native-account-login.mjs', f.config, 'login'], { encoding: 'utf8' });
  assert.equal(result.status, 1); assert.match(result.stderr, /native_subscription_login_required/);
  assert.equal((result.stdout + result.stderr).includes('SYNTHETIC_OTHER_LOGIN'), false);
  assert.deepEqual(JSON.parse(readFileSync(f.audit)).args.slice(-2), ['login', 'status']);
});
