import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MEETING_REVISION,
  assertMeetingArtifact,
} from "./scenarios/meeting-revision.js";

test("HMR-MEETING-001: provenance separates the requirement from its synthetic fixture", () => {
  assert.equal(MEETING_REVISION.id, "HMR-MEETING-001");
  assert.equal(MEETING_REVISION.source.type, "requirements-derived");
  assert.equal(MEETING_REVISION.fixture.sourceType, "synthetic");
  assert.ok(MEETING_REVISION.source.references.length);
  assert.ok(
    readFileSync(MEETING_REVISION.fixture.path, "utf8").includes("虚构"),
  );
  assert.equal(MEETING_REVISION.execution.offline.requiresModel, false);
  assert.equal(MEETING_REVISION.execution.real.requiresModel, true);
});

test("HMR-MEETING-001: semantic checks accept verified Markdown without a whole-document snapshot", () => {
  assertMeetingArtifact(readFileSync("examples/meeting-actions.md", "utf8"));
  assertMeetingArtifact(
    readFileSync("examples/meeting-actions-by-owner.md", "utf8"),
    true,
  );
});

test("HMR-MEETING-001: fabricated dates, lost pending ownership, promoted discussions and missing grouping fail", () => {
  const original = readFileSync("examples/meeting-actions.md", "utf8");
  const revision = readFileSync("examples/meeting-actions-by-owner.md", "utf8");
  assert.throws(() =>
    assertMeetingArtifact(
      original.replace(/(检查导出流程 \| 陈舟 \| )待确认/, "$12026-10-21"),
    ),
  );
  assert.throws(() =>
    assertMeetingArtifact(
      original.replace(
        /(整理试用反馈 \| )待确认 \| 待确认/,
        "$1林青 | 2026-10-21",
      ),
    ),
  );
  assert.throws(() =>
    assertMeetingArtifact(
      original.replace(
        /## 二、仅讨论事项[\s\S]*?## 三、/,
        "## 二、明确行动\n\n帮助文档：已安排，周五完成。\n\n## 三、",
      ),
    ),
  );
  assert.throws(() =>
    assertMeetingArtifact(
      revision.replace(/^###.*(?:林青|陈舟).*$/gm, "### 负责人"),
      true,
    ),
  );
});
