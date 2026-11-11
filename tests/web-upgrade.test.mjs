import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { resolve, join } from "node:path";
import { sourceSnapshot, supportedChange, schemaHash, dependencyHash, backendHash, uiHash, buildUiCandidate, candidateGuard, gatewayFingerprint } from "../scripts/dev-build.mjs";

test("UI source and lock are candidate inputs; generated UI and dependencies are excluded", () => {
  const parent = resolve(".codex/scratch/assistant-ui"); mkdirSync(parent, { recursive: true });
  const base = mkdtempSync(join(parent, "snapshot-"));
  for (const path of ["src", "ui/node_modules", "ui/dist"]) mkdirSync(join(base, path), { recursive: true });
  writeFileSync(join(base, "package.json"), JSON.stringify({ type: "module" }));
  writeFileSync(join(base, "package-lock.json"), "{}");
  writeFileSync(join(base, "ui/package.json"), JSON.stringify({ dependencies: { react: "synthetic" } }));
  writeFileSync(join(base, "ui/homer-app.tsx"), "synthetic-ui-source");
  writeFileSync(join(base, "ui/node_modules/generated.js"), "excluded");
  writeFileSync(join(base, "ui/dist/generated.js"), "excluded");
  writeFileSync(join(base, "src/web-history.ts"), "schema-v1");
  const first = sourceSnapshot(base);
  assert.equal(first.files.get("ui/homer-app.tsx").toString(), "synthetic-ui-source");
  assert.equal(first.files.has("ui/node_modules/generated.js"), false);
  assert.equal(first.files.has("ui/dist/generated.js"), false);
  assert.equal(supportedChange(base, "ui/homer-app.tsx"), true);
  assert.equal(supportedChange(base, "ui/node_modules/generated.js"), false);
  assert.equal(supportedChange(base, "ui/dist/generated.js"), false);
  writeFileSync(join(base, "ui/package.json"), JSON.stringify({ dependencies: { react: "changed" } }));
  const changedDeps = sourceSnapshot(base);
  assert.notEqual(dependencyHash(first), dependencyHash(changedDeps));
  writeFileSync(join(base, "src/web-history.ts"), "schema-v2");
  assert.notEqual(schemaHash(first), schemaHash(sourceSnapshot(base)));
});


test("UI and business fingerprints are independent; incompatible UI protocol is refused before compilation",async()=>{
  const files=new Map([["package.json",Buffer.from('{"type":"module"}')],["package-lock.json",Buffer.from('{}')],["ui/protocol.json",Buffer.from('{"version":1}')],["ui/homer-app.tsx",Buffer.from('synthetic-ui')],["src/service.ts",Buffer.from('synthetic-service')]]);
  const first={files:new Map(files),configBytes:Buffer.from('synthetic-config')};
  files.set('ui/homer-app.tsx',Buffer.from('changed-ui'));
  const second={files:new Map(files),configBytes:first.configBytes};
  assert.equal(backendHash(first),backendHash(second));assert.notEqual(uiHash(first),uiHash(second));
  files.set('src/service.ts',Buffer.from('changed-service'));
  const third={files:new Map(files),configBytes:first.configBytes};
  assert.notEqual(backendHash(second),backendHash(third));assert.equal(uiHash(second),uiHash(third));
  await assert.rejects(buildUiCandidate(resolve('.'),undefined,third,{deps:dependencyHash(third),webProtocol:2}),/dev_web_protocol_incompatible/);
});


test("a declared UI protocol alone cannot bypass changes to the resident gateway contract",async()=>{
  const snapshot={files:new Map([["package.json",Buffer.from('{"type":"module"}')],["package-lock.json",Buffer.from('{}')],["ui/protocol.json",Buffer.from('{"version":1}')],["src/web-contract.ts",Buffer.from('changed-contract')]]),configBytes:Buffer.alloc(0)};
  await assert.rejects(buildUiCandidate(resolve('.'),undefined,snapshot,{deps:dependencyHash(snapshot),webProtocol:1,gatewayHash:'resident-old-contract'}),/dev_gateway_changed_restart_required/);
});

test('resident gateway imports require restart even after source review',()=>{
 const first={files:new Map([['package.json',Buffer.from('{"type":"module"}')],['package-lock.json',Buffer.from('{}')]]),configBytes:Buffer.alloc(0)};
 const baseline={deps:dependencyHash(first),schema:schemaHash(first),gatewayHash:gatewayFingerprint(first)};
 for(const path of ['src/web-server.ts','src/update-review-page.ts','src/web-upload.ts','src/media-policy.ts','src/processes.ts']){
  const next={...first,files:new Map(first.files)};next.files.set(path,Buffer.from('changed resident executable'));
  assert.throws(()=>candidateGuard(next,baseline),/dev_gateway_changed_restart_required/);
 }
});
