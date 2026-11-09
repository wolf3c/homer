import { test } from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import { createWebServer } from './web-connected-fixture.js';
import {htmlPreviewShell} from '../src/html-preview.js';
import type { WebBridge } from '../src/web-contract.js';

test('HTML preview serves a constant sandboxed shell without loosening API origin rules or loosening the main page CSP', async () => {
  let calls = 0;
  const bridge: WebBridge = {
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
    for (const directive of ["default-src http: https: data: blob:", "connect-src http: https: ws: wss:", 'sandbox allow-scripts allow-forms'])
      assert.ok(policy.split(';').map(x => x.trim()).includes(directive), directive);
    assert.doesNotMatch(policy, /allow-same-origin|allow-top-navigation|allow-popups/);
    const html = await shell.text();
    assert.match(html, /隔离 HTML 预览/);
    assert.equal((await globalThis.fetch(web.url + '/preview/interactive')).status, 200);
    assert.equal(await (await globalThis.fetch(web.url + '/preview/interactive')).text(), html);
    // The public preview shell does not weaken authenticated API origin checks.
    assert.equal((await globalThis.fetch(web.url + '/api/history/state', { headers: { Origin: 'null' } })).status, 403);
    assert.equal((await globalThis.fetch(web.url + '/preview/interactive?file=private')).status, 400);
    assert.equal((await globalThis.fetch(web.url + '/preview/interactive', { headers: { Origin: 'https://untrusted.invalid' } })).status, 403);
    const main = await globalThis.fetch(web.url + '/connect');
    const mainScripts = (main.headers.get('content-security-policy') ?? '').split(';').find(x => x.trim().startsWith('script-src'));
    assert.equal(mainScripts?.trim(), "script-src 'self'");
    assert.equal(calls, 0);
  } finally { await web.close(); }
});

test('preview shell passes page content and optional annotation runtime into its isolated frame', () => {
  let receive: (event: unknown) => void = () => {};
  let inserted: {title: string; srcdoc: string; sandbox: string; setAttribute: (name: string, value: string) => void} | undefined;
  const frame = {title: '', srcdoc: '', sandbox: '', setAttribute(name: string, value: string) { if (name === 'sandbox') this.sandbox = value; }};
  const parent = {};
  const script = htmlPreviewShell.match(/<script>([\s\S]*)<\/script>/)?.[1];
  assert.ok(script);
  runInNewContext(script, {parent, URL, location: {href: 'http://localhost/preview/interactive'},
    addEventListener: (_: string, handler: typeof receive) => { receive = handler; },
    document: {createElement: () => frame, body: {replaceChildren: (child: typeof frame) => { inserted = child; }}}});
  const html = '<link href="https://example.test/a.css"><script src="https://example.test/a.js"></script><script>window.example=1</script>';
  receive({source: parent, origin: 'http://localhost', data: {type: 'homer-html-preview', html, runtime: ''}});
  assert.equal(inserted?.sandbox, 'allow-scripts allow-forms');
  assert.equal(inserted?.srcdoc, html);
  receive({source: parent, origin: 'http://localhost', data: {type: 'homer-html-preview', html, runtime: 'window.annotationRuntime=true;'}});
  assert.equal(inserted?.srcdoc, html + '<script>window.annotationRuntime=true;</script>');
});
