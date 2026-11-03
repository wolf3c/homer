import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codexProxyEnvironment } from '../src/engine.js';

test('HMR-CHAT-001: Codex receives existing proxy environment without unrelated secrets', () => {
  assert.deepEqual(codexProxyEnvironment({ HTTPS_PROXY: 'http://127.0.0.1:9999', NO_PROXY: 'localhost', PRIVATE_TEST_SECRET: 'not-forwarded' }, ''), {
    HTTPS_PROXY: 'http://127.0.0.1:9999', NO_PROXY: 'localhost',
  });
});
test('HMR-CHAT-001: macOS system proxy reaches model transport when shell proxy is unset', () => {
  const settings = 'HTTPEnable : 1\nHTTPPort : 7890\nHTTPProxy : 127.0.0.1\nHTTPSEnable : 1\nHTTPSPort : 7890\nHTTPSProxy : 127.0.0.1';
  assert.deepEqual(codexProxyEnvironment({}, settings), {
    HTTP_PROXY: 'http://127.0.0.1:7890', HTTPS_PROXY: 'http://127.0.0.1:7890',
  });
  assert.deepEqual(codexProxyEnvironment({}, 'HTTPSEnable : 0\nHTTPSPort : 7890\nHTTPSProxy : 127.0.0.1'), {});
});
