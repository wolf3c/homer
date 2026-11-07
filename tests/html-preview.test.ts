import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWebServer } from './web-connected-fixture.js';
import type { WebBridge } from '../src/web-contract.js';

test('HTML preview serves a constant sandboxed shell without loosening API origin rules or loosening the main page CSP', async () => {
  let calls = 0;
  const bridge: WebBridge = {
    state: async () => { calls++; throw Error('not_used'); },
    submit: async () => { calls++; }, stop: async () => { calls++; },
    respond: async () => { calls++; },
  };
  const web = await createWebServer({ bridge, port: 0 });
  try {
    // Deliberately use native fetch without access credentials.
    const shell = await globalThis.fetch(web.url + '/preview/interactive');
    assert.equal(shell.status, 200);
    assert.match(shell.headers.get('content-type') ?? '', /^text\/html/);
    const policy = shell.headers.get('content-security-policy') ?? '';
    for (const directive of ["default-src 'none'", "connect-src 'none'", "form-action 'none'", "frame-src about:", 'sandbox allow-scripts'])
      assert.ok(policy.split(';').map(x => x.trim()).includes(directive), directive);
    assert.doesNotMatch(policy, /allow-same-origin|allow-top-navigation|allow-popups/);
    const html = await shell.text();
    assert.match(html, /隔离 HTML 预览/);
    assert.equal((await globalThis.fetch(web.url + '/preview/interactive')).status, 200);
    assert.equal(await (await globalThis.fetch(web.url + '/preview/interactive')).text(), html);
    // HTTP access is unpaired; the isolated browser frame still has no network capability.
    assert.equal((await globalThis.fetch(web.url + '/api/state', { headers: { Origin: 'null' } })).status, 403);
    assert.equal((await globalThis.fetch(web.url + '/preview/interactive?file=private')).status, 400);
    assert.equal((await globalThis.fetch(web.url + '/preview/interactive', { headers: { Origin: 'https://untrusted.invalid' } })).status, 403);
    const main = await globalThis.fetch(web.url + '/connect');
    const mainScripts = (main.headers.get('content-security-policy') ?? '').split(';').find(x => x.trim().startsWith('script-src'));
    assert.equal(mainScripts?.trim(), "script-src 'self'");
    assert.equal(calls, 0);
  } finally { await web.close(); }
});
