import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync,cpSync,existsSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {loadPrompts} from '../src/prompts.js';
import {fixture} from './prompt-resources-fixture.js';
test("HMR-PROMPTS-001: compiled loader resolves packaged resources from a different cwd", () => {
  const f = fixture();
  try {
    const compiled = pathToFileURL(resolve("dist/prompts.js")).href;
    const probe = spawnSync(process.execPath, ["--input-type=module", "-e", `const {loadPrompts}=await import(${JSON.stringify(compiled)}); process.stdout.write(JSON.stringify(loadPrompts()));`], { cwd: f.root, encoding: "utf8" });
    assert.equal(probe.status, 0, probe.stderr);
    assert.deepEqual(JSON.parse(probe.stdout), loadPrompts());
  } finally { f.cleanup(); }
});

test("HMR-PROMPTS-001: package dry run contains dist and the two maintained prompt resources", () => {
  const f = fixture();
  try {
    const pack = spawnSync("npm", ["pack", "--dry-run", "--ignore-scripts", "--json"], { encoding: "utf8", env: { ...process.env, npm_config_cache: join(f.root, "npm-cache") } });
    assert.equal(pack.status, 0, pack.stderr);
    const files: string[] = JSON.parse(pack.stdout)[0].files.map((file: { path: string }) => file.path);
    for (const name of ["dist/cli.js", "dist/prompts.js", "prompts/main.md", "prompts/worker.md"]) assert.ok(files.includes(name), name);
    const skills=files.filter(name=>name.startsWith('.codex/'));
    assert.equal(skills.length,13,'release carries only the four complete maintained Skill directories');
    assert.ok(files.filter(name=>name.startsWith("prompts/")).every(name=>["prompts/main.md","prompts/worker.md"].includes(name)));
    const bundled=['homer-initialize','homer-tool-management','homer-feedback','homer-archive-review'];
    assert.ok(skills.every(name=>bundled.some(skill=>name.startsWith('.codex/skills/'+skill+'/'))));
    for(const name of bundled)assert.ok(skills.includes('.codex/skills/'+name+'/SKILL.md'));
    assert.ok(skills.includes('.codex/skills/homer-feedback/scripts/submit-feedback.mjs'));
  } finally { f.cleanup(); }
});

test("HMR-PROMPTS-001: packaged CLI reports the missing resource and releases its runtime lock", () => {
  const f = fixture();
  try {
    cpSync(resolve("dist"), join(f.root, "dist"), { recursive: true });
    mkdirSync(join(f.root, "scripts"));
    cpSync(resolve("scripts/windows-security.mjs"), join(f.root, "scripts/windows-security.mjs"));
    writeFileSync(join(f.root, "package.json"), '{"type":"module"}');
    const runtime = join(f.root, "runtime");
    writeFileSync(join(f.root, "test.config.json"), JSON.stringify({ runtime, workspace: join(f.root, "workspace"), codexBin: process.execPath, codexHome: f.root, nativeCodexHome: f.root, model: "mock", requiresOpenaiAuth: false }));
    const probe = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", join(f.root, "dist/cli.js"), "--json", "--config", join(f.root, "test.config.json")], { cwd: f.root, encoding: "utf8" });
    assert.equal(probe.status, 1);
    const message = JSON.parse(probe.stdout.trim());
    assert.equal(message.type, "error"); assert.match(message.text, /prompt_file_missing:main.md/);
    assert.equal(existsSync(join(runtime, "cli.lock")), false);
  } finally { f.cleanup(); }
});
