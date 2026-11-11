# 已提交完整版本上线验收（2026-10-23）

上海时间 2026-10-23 13:53，新版通过原 Terminal 启动入口在 `127.0.0.1:4780` 正常启动；13:54 完成在线历史、回执和队列读取验收。发布完整固定提交 `bff579afd679bc3198bc755800d86f164929050c`，包含 Sources。没有采用排除 Sources 的 `f2b7670`，没有拼入 main 的未提交开发内容。

## 发布身份与范围

| 身份 | 准确值 |
| --- | --- |
| 必要现网前置提交 | `5fc7087809b72c1a75af8bcddefa2b301fe2d0c2` |
| 发布固定 Git SHA（含 CSS 修复） | `bff579afd679bc3198bc755800d86f164929050c` |
| sourceHash | `f42ba8ea7f6cb1770388dc8d862f6f8b1e6d012724e64d83a083ba60e656f728` |
| UI hash | `e3f996878dc0ab1ee2b261005f5057901a43ce5c485ea53f6f99142234c45517` |
| 密封 manifest | `77a6afdf07d5380d973d64b2ece91b023347f9b48f740fd528f1faad7e9dff1f` |
| 实际 launcher / host PID | `20557` / `21363` |
| 输入 / 密封文件 | 292 / 260 |

本次采用已提交的 high 默认、统一 TaskCard、官方消息复制与引用、Quote、代码复制、Attachment／Image／File、原 Run Activity、活动详情阅读器移除、底部用量移除、ApprovalCard 展示、Sources 与旧历史 RunActivity。日期验收提交没有引入新的日期运行行为。现网既有 schema3 owner／生命周期、gateway history／receipts／queue.move／artifact origin、跨页队列 nextRequestId 与 native MCP／Skill／timeout 边界已准确纳入前置提交；没有新增后端权限规则。原配置字节、独立原生配置、账户、主线程及工具指纹保持。

## 失败纠正与验证

首次 `5fc7087` 正常冷启动被 `dev_candidate_check_failed` 拒绝，展开检查为 `run-activity_css_stale`：已提交 ApprovalCard 使用的共享 surfaces 新增工具类，原 RunActivity CSS 未同步。该次没有启动业务 owner，没有恢复覆盖数据库。修复在 main 提交为 `bff579a`，添加 source-only CSS 回归并重新冻结完整 Git 树。旧候选 hash 和首次失败记录保留为历史证据，不作为实际上线身份。

- 准确 Git archive 的源码冷构建（与正常启动同一 buildCandidate）、服务端类型、UI 类型及 Vite 构建通过；source-only 回归检查全部已声明官方 CSS 分支通过。
- 新构建 Sources／旧历史 RunActivity 合成浏览器在 320／390／1440 三屏共 45 项通过，实际查看 320px 展开截图。既有已审 TaskCard／RunActivity／跨页队列／ApprovalCard 共 133 项浏览器组合证据复用；Sources 独立审阅另有 78 项浏览器、12 项合同记录，不重复计为本轮新增测试。
- 已有针对性组合验证 240 项，239 通过，1 项恢复状态差异在原密封运行源码也复现：rejected 期望 failed、实际 uncertain；未改断言，未声称全仓全绿。
- 对维护点只读备份进行旧 owner→候选→旧 owner 离线兼容预演，61 张业务表、3 张网关表的 schema／旧列／全部行均保留，integrity 为 ok、FK 为 0。`bff579a` 后端字节与该预演候选一致，因此复用该证据，没有重复备份或迁移真实库。
- 原 launcher、业务 child、HTTP、离线 peer 的合成历史 state／receipts 转发、queue move 与 artifact origin 授权拒绝路径已有通过证据；本轮实际服务 state／历史分页／空回执查询／dispatch 队列读取均为 HTTP 200，没有移动真实队列或重放请求。
- 实际新 launcher／host、260 文件密封 manifest、89 个依赖包及公开 JS／CSS 的字节与冻结构建一致。实际模型配置为 `gpt-6.1-sol`／`high`，main 与 Worker Fast 默认开启；没有真实模型工作轮或 Fast 服务速度实测。

## 停服维护点与数据连续性

原服务通过准确 launcher 的一次 SIGTERM 正常退出，未强杀原生操作、清锁或等待全部历史工作清空。13:13 一致维护点备份保留 449 文件及 210 引用；业务／网关 owner 旧→新→旧兼容预演通过。首次失败后逐表确认仍等于维护点，未执行数据库恢复；本轮复用该完整维护点。

实际上线后旧表 schema、旧列、全部业务行保持；正常启动变化仅两个可验证的新 host 所有 engine lease、微信连接 generation +1、无 pending transport 下的合同指纹更新。主线程与工具指纹不变，3 条 agent_receipts uncertain 和 6 条 wechat_outbox uncertain 原样保留，210 文件引用 hash 保持。微信 connected，Telegram offline；没有发送真实消息、上传、审批重放或业务操作。

## 保留与回退边界

旧密封、旧冻结源码、原配置／入口及一致维护点组合保存在 main 下 Gitignored 私有目录，不纳 Git。新版冻结输入、实际密封及依赖均位于 main 的私有运行目录，运行入口不依赖本任务临时 worktree；这些仍被运行引用的目录不可删除。临时构建、合成浏览器与首次失败证据留在任务 `.codex/scratch/` 支持复核，不批量清理其他任务内容。

若上线后产生新事实，不能用维护点旧库覆盖回退；须先保护新增事实并做前向修复，或验证当前库与旧程序的准确兼容性后正常切换。没有 push、tag、remote 操作，没有改动其他人的工作树或暂存内容。后续 main 文档或功能提交不自动进入本次冻结运行版本。

准确机器证据：[验收 JSON](patches/2026-10-23-committed-live-release-verification.json)。前置整合：[整合说明](2026-10-23-live-baseline-integration.md)；源码冷启动 CSS 修复：[说明](2026-10-23-release-css-closure.md)。
