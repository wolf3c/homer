import assert from "node:assert/strict";

// This catalog is maintained test material, never an automatic capture of user conversations.
export const MEETING_REVISION = {
  id: "HMR-MEETING-001",
  title: "CLI 交代会议整理、查询、交付及完成后修订",
  source: {
    type: "requirements-derived",
    background:
      "从用户确认的 M0 流程转写为公开测试步骤，未收录真实用户会议或聊天。",
    references: ["docs/02-requirements-and-mvp.md#9", "M01–M08", "T01–T05"],
    issueId: null,
  },
  fixture: {
    path: "tests/fixtures/meeting-notes.md",
    filename: "meeting-notes.md",
    sourceType: "synthetic",
    background:
      "人名、会议事项与日期均为虚构，特意保留未知字段、讨论及暂缓事项。",
  },
  initialConditions: [
    "从项目根目录执行，使用新建的专用 scratch workspace 和独立 runtime。",
    "输入 fixture 复制为 materials/meeting-notes.md；无既有 Run 或成果。",
    "真实回归先构建 dist，使用明确获准的连接、Codex 0.154.0、gpt-6.1-sol。",
  ],
  messages: {
    remember: "这轮无敏感信息验收的代号是海鸥47，请记住。只需回答收到。",
    recall: "刚才的验收代号是什么？只回答代号。",
    dispatch:
      "请读取 meeting-notes.md，把会议笔记整理成行动清单并写入 Markdown。保留未明确负责人或时间的待确认项，讨论和暂缓事项不得升级为已承诺行动。新建一个事项。",
    progress: "现在刚才那项会议整理工作是什么状态？请查询实际记录，简短回答。",
    revise:
      "请修订事项 {matterId}：将刚才的行动清单按负责人分组，未确认的单独列出。保留原来的事实和讨论、暂缓事项。请生成新版本，不覆盖原文件。",
  },
  steps: [
    {
      id: "remember",
      action: "send",
      message: "remember",
      observe: "主对话回复，无 Worker。",
    },
    {
      id: "recall",
      action: "send",
      message: "recall",
      observe: "保持刚才的上下文，无新增 Run。",
    },
    {
      id: "dispatch",
      action: "send",
      message: "dispatch",
      observe: "主 Agent 工具派发持久 Matter/Run 和独立 Worker。",
    },
    {
      id: "query",
      action: "wait-running-then-send",
      message: "progress",
      observe: "执行中仍能询问；从实际工具和持久状态获取进度。",
    },
    {
      id: "deliver",
      action: "wait-delivery",
      observe: "真实非空 Markdown，通过路径及内容验收后交付路径。",
    },
    {
      id: "revise",
      action: "send-after-delivery",
      message: "revise",
      observe: "填入上次 matterId，同 Matter 新 Run、新 Worker 及新文件。",
    },
    {
      id: "verify",
      action: "wait-delivery",
      observe: "按负责人分组，原文件哈希保持；退出时没有活跃执行。",
    },
  ],
  expected: [
    "林青：初稿，2026-10-20 前；陈舟：导出流程，日期待确认。",
    "试用反馈的负责人和日期待确认；帮助文档仅讨论；预算暂缓。",
    "修订有林青、陈舟和未确认信息分组；不要求逐字或排版完全相同。",
  ],
  forbidden: [
    "预写文件冒充模型成果",
    "杜撰负责人／日期或将讨论、暂缓升级为承诺",
    "覆盖原文件",
    "主 Agent 与 Worker 共用执行线程",
    "仅凭引擎结束就报成功",
  ],
  cleanup:
    "等待 EOF 正常收尾或 Ctrl-C 安全停止；确认进程及锁释放后，仅清理本次专用 workspace/runtime。需保留失败元数据供调查，不删除既有证据。重跑换新目录；不使用日常工作区。",
  execution: {
    offline: {
      requiresModel: false,
      entry: "npm run test:scenarios",
      cost: "不调用 Codex 或模型，费用为 0；脚本化 Fake 只验证宿主契约，不证明自然语言理解。",
    },
    real: {
      requiresModel: true,
      entry: "npm run test:real -- <专用配置>",
      cost: "会调用获准模型，可能计费；记录可得 tokenUsage，金额未知，不推算为 0。",
    },
  },
} as const;

// Bounded checks for this fixed fixture, supplemented by the product main Agent's source review.
// These assert facts and grouping, not a universal Markdown parser or an exact text snapshot.
export function assertMeetingArtifact(content: string, revision = false) {
  const lines = content.split(/\r?\n/);
  const date = /\d{4}-\d{2}-\d{2}/;
  assert.ok(
    lines.some((l) => /初稿/.test(l) && /2026-10-20\s*前/.test(l)),
    "初稿期限须保留“前”",
  );
  assert.match(content, /林青/);
  assert.match(content, /陈舟/);
  const exports = lines.filter((l) => /导出流程/.test(l));
  assert.ok(
    exports.some((l) => /待确认|未确定/.test(l) && !date.test(l)),
    "导出检查的日期应待确认",
  );
  const feedback = lines.filter((l) => /整理试用反馈/.test(l));
  assert.ok(
    feedback.some(
      (l) => /待确认|未确定/.test(l) && !date.test(l) && !/林青|陈舟/.test(l),
    ),
    "反馈不得补造负责人或日期",
  );
  const discussion = lines.filter((l) => /帮助文档/.test(l));
  assert.ok(
    discussion.some((l) => /讨论/.test(l)),
    "须保留帮助文档的讨论事项",
  );
  for (const line of discussion) {
    assert.ok(
      !/(?:已安排|已承诺|已批准|必须完成)/.test(
        line.replace(
          /(?:不|未|非)[^|。；\n]{0,18}(?:已安排|已承诺|已批准|必须完成)/g,
          "",
        ),
      ),
      "讨论不得升级为行动承诺",
    );
  }
  assert.ok(
    lines.some((l) => /预算/.test(l) && /暂缓/.test(l)),
    "预算须保持暂缓",
  );
  if (revision) {
    for (const owner of ["林青", "陈舟"])
      assert.match(content, new RegExp(`^#{1,4}.*${owner}`, "m"));
    assert.match(content, /^#{1,4}.*(?:未确认|待确认)/m);
  }
}
