import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {supportedChange} from '../scripts/dev-build.mjs';
const root=resolve('.');
test("HMR-UPGRADE-001: watch scope excludes runtime, generated output, docs and scratch", () => {
  for (const p of ["src/service.ts", "prompts/main.md", "assets/sample.txt", "package-lock.json"]) assert.equal(supportedChange(root, p), true);
  for (const p of ["dist/service.js", ".codex/scratch/test.ts", ".codex/private/test.json", "docs/a.md", "node_modules/a.js"]) assert.equal(supportedChange(root, p), false);
});
