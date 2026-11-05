import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { Files } from "../src/files.js";
const base = resolve(".codex/scratch/files-tests");
test("T04/T07/T11: scoped file I/O denies traversal, absolute paths, symlinks and empty artifacts", () => {
  rmSync(base, { recursive: true, force: true });
  mkdirSync(base + "/materials", { recursive: true });
  mkdirSync(base + "/outputs", { recursive: true });
  writeFileSync(base + "/materials/meeting.md", "notes");
  writeFileSync(base + "/outside.md", "outside");
  symlinkSync(base + "/outside.md", base + "/materials/link.md");
  const f = new Files(base);
  assert.equal(f.readMaterial("meeting.md"), "notes");
  for (const p of ["../outside.md", base + "/outside.md", "link.md"])
    assert.throws(() => f.readMaterial(p));
  assert.throws(() => f.readMaterial("missing.md"), /material_missing/);
  const dir = f.prepareRun("task-1", "run-1");
  assert.equal(dir, base + "/outputs/task-1/run-1");
  assert.throws(() => f.prepareRun("../task-1", "run-1"), /id_denied/);
  assert.throws(() => f.prepareRun("task-1", "../run-1"), /id_denied/);
  assert.throws(() => f.writeMarkdown(dir, "../evil.md", "text"));
  assert.throws(() => f.writeMarkdown(dir, "empty.md", " "));
  const artifact = f.writeMarkdown(
    dir,
    "actions.md",
    "# Actions\n\nReal action.",
  );
  assert.equal(f.verify(dir, artifact).bytes > 0, true);
  assert.throws(
    () => f.writeMarkdown(dir, "actions.md", "overwrite"),
    /artifact_exists/,
  );
  symlinkSync(base + "/outside.md", dir + "/linked.md");
  assert.throws(() => f.verify(dir, dir + "/linked.md"));
});
