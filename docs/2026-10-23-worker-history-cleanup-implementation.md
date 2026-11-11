# Worker 历史归档与删除：实施记录

2026-10-23；依据[已批准方案](2026-10-23-worker-history-cleanup-plan.md)。源码候选，不代表运行版已经采用。真实归档 **0**、真实删除 **0**；未读生产库/真实聊天/凭据/原生 HOME，未运行真实模型、外发业务或上线操作。初次交付未创建分支、worktree 或提交；本次追加 review/commit 边界见后文。

## 一页概要

主 Agent 现在有三个明确语义的工具候选：`archive_work`、`restore_work`、`delete_work`。沿原 `list_work` 和 `work_inspect` 查对象、版本、证据；用户已经明确授权准确目标时执行，范围不明确先在对话说明对象和不可逆影响。代码绑定当前真实用户来源、主 Agent/thread，并核当前版本、Run 和安全事实；**来源绑定不是逐目标机器授权证明**，语义授权仍由主 Agent 遵守，`confirmed:true` 等额外字段会被拒绝。

| 调用 | 实际效果 | 保留/边界 |
| --- | --- | --- |
| `archive_work` | 合资格 Task 从默认列表和顶部计数移出 | 不停止 Worker，不改业务 outcome，不删原生对话、消息或成果 |
| `restore_work` | 同一 Task 取消归档，恢复默认发现 | 不启动 Run；不恢复永久删除 |
| `delete_work` 无 runId | 真正清除该 Task 的合资格内部 `send` 消息 payload，保留 `{"historyDeleted":true}` 信封 | 不清 user_input、宿主结果通知、主对话、不可变 Worker 卡、成果/验收/交付、需求版本或操作回执；无正文可删就不标记 deleted |
| `delete_work` 带准确 runId/revision | 调固定 Codex 0.163.0 `thread/delete`，只删该已登记 Worker 对话 | Task/result/文件保留；主 thread、活跃线程、有原生后代或后代事实不明均跳过；不手删 HOME/SQLite/rollout |

新 Worker 回传 owner 会把完成正文和 messages 保存为 result 候选；验收后的这份结果副本也保留。因此删除原生对话不代表清除所有 Worker 文本副本，更不代表删除正式成果。

不要求先归档。Task、Run 和原生 thread 沿既有准确 ID 独立选择，不引入统一清理对象。多个获准对象逐个调用，成功、跳过、失败和未知分别回执；每次回执就是实际处理数，不合成“全批成功”。没有年龄策略、自动定时清理、preview/execute、计划/token/批次实体、回收站或管理页。

只新增 **tasks.historyState 一列**（visible/archived/deleted），recursive schema **3→4**。不新增表。原生操作复用 `operations`：kind=`delete_worker_history`，details 仅 runId/threadId/binding/phase（checking/deleting），状态和原响应沿原字段。归档和正文清除使用原短事务、operationId/hash 幂等与 Task revision CAS；原生 RPC 不持数据库长事务。

## 安全与故障合同

- 保护整棵相关子事项的实际 Run/lease/退出确认、暂停需续接、未验收结果、未确认交付、待答/未送达决定、等待、开放 PendingItem、未处理用户来源、上传及外发未知。UI settled 不单独构成资格。删除中的同 Task/祖先不可新执行或 claim。
- 同一 `agent_messages/agent_receipts` 队列仍为事实源。pending/offered/received/uncertain/blocked 均阻断。内部 send 的业务 ACK 还须有结束且持久化的公开处理报告；同一消息仍有 working/unknown 主消费轮时，旧报告不能解除保护。宿主通知正文始终保留，未处理 receipt 同样保护；不新造第二套回传队列。
- 待删消息被 replyTo/causation、等待、原答复 quote、结果 payload/evidence 中的精确消息 ID 引用时跳过，返回阻断 ID。不递归拆引用。结果、验收、交付、Task/Run/version 身份骨架仍能读取；正文标记不能冒充原业务消息，Worker 自带同名字段不能冒充宿主删除。
- 原生删除先核确切 Run/任务/CAS、Homer 专属存储、线程 notLoaded 和活跃/归档元数据中的原生后代。RPC 前再次核身份、CAS 与保护事实。回执失败不等于未删除：保留 uncertain，同 operationId 只读原 thread；仅可信 `thread not found` 才收尾为已删，绝不自动重发 delete。checking 阶段中断可明确记失败，因为删除尚未发送。
- 原 native operation 的回执可由 `work_inspect(operationId,operationScopeId)` 核对。精确 Run inspect 返回指定 Run 的 revision，另从既有 operation 派生 `nativeHistory`，说明已删或仍未知，不增加 Run 列。旧公开 Worker 卡保持当时内容；不恢复已取消的活动阅读器。
- 原生删除与 Task 正文清除是两次独立操作，不承诺跨存储全成全败或撤销。永久清除不可回退，备份/记忆中的派生事实不在本期擦除范围。SQLite 可复用页不等于文件立即变小，WAL 也可能暂留旧页；字节回收回执为 null，未测量收益。没有 VACUUM/文件 GC/备份、成果或开发目录删除。

## 准确改动范围

| 文件/owner | 本任务改动 |
| --- | --- |
| `src/recursive-tasks.ts` | historyState 迁移与显式 INSERT 列名；listHistory/historyActor/historyTarget/historyBlockers/archiveHistory/deleteHistory；check/canClaim/已删消息 reply 守卫；reconcile 原生检查中断；inspect 指定 Run/原生删除回执 |
| `src/recursive-tools.ts`、`src/worker-interaction-mcp.ts` | 三个 schema/路由，Worker 目录排除；runId/expectedRunRevision 只属于 delete schema，不污染共用 schema |
| `src/service.ts`、`src/tools.ts` | 当前主用户来源与专属 nativeRpc 接线；list_work 默认 20/最多 80 条、cursor/includeArchived；不改变内部 scheduler 全量 snapshot |
| `src/task-overview.ts` | 当前默认列表同源过滤自己和根 Task 的 historyState；既有事务通知触发读投影更新，不新增缓存或页面 |
| `src/engine.ts` | 固定协议 -32600 + 精确 not-found 文案转换为安全 `engine_thread_not_found`；其他错误不冒充不存在 |
| `src/store.ts`、`scripts/database-migration-preview.ts`、`scripts/pinned-build.mjs` | schema 4 守卫及正常 fingerprint/离线迁移校验兼容；只容许验证后的增列与 meta 变化，未知回执/原事实保留与回退断言仍在 |
| `tests/work-history.test.ts`、`tests/fixtures/work-history-app-server.mjs` | 复用现有合成 setup 和真实 Homer/Engine 路由，协议 peer 无模型；归档/永久删除/引用/授权/CAS/故障恢复/部分成功 |
| 现有 fixture 与迁移/overview 测试 | recursive-fixture 仅本任务增加可选 scratch 路径；更新 schema 版本断言和 overview 合成列。不新增测试框架 |

`WebHistoryPages` 已由原数据库提交通知失效，无须再增加专用游标/缓存失效层。Web/微信/Telegram 沿同一个主输入和工具 owner，不新增渠道写 API。UI 源码、QuestionFlow、Canvas、主对话原文、不可变事件、Files/媒体 owner 均无本任务改动。

## 验证、并行边界与采用

证据目录：`.codex/scratch/worker-history-cleanup-implementation-20261023/`。`preimages.json` 与 `preimages/` 保存写前源码/文档和哈希，不含用户数据。开始 HEAD=`eeb7b263eec4ede76db11a341772959753217504`；核验期间外部推进到 `ec34e5d9113fc29171fb81e0bc159ad53afc67cf`、`9b5d97c092e558d2d1863634abf4eb1827901e81`，且大量 tracked/untracked dirty。代码行号随并行变化，以函数和证据哈希定位；整份 Git diff 包含他人改动，不能当成本任务补丁。

先有意义红灯再实现：新增工具缺失、ACK 后未结束消费者、伪造 historyDeleted 等红灯均实际复现并修正。当前 owner 已将 Worker 返回改为原生结束后由主 Agent 验收，移除 task_complete；本任务只调整自己的 setup，未恢复旧接口或修改并行回传逻辑。27 项聚焦验收通过，含 14 项历史核心、5 项 overview、6 项离线迁移预演、2 项 pending 迁移；实际原生客户端对合成协议 peer 验证了删除、ACK 丢失、重连后不可读、一次且仅一次删除。没有用真实 Codex 用户历史验证删除。

复用现有真实 UI/Web owner 和隔离 Chrome，在 320/390/1440 三屏验证可见计数 1→归档 0→恢复 1、同一事项恢复、无横向溢出或页面异常，模型调用 0。UI 构建产物仅位于本任务 candidate/web。无新增管理页或 screenshot 流程产品入口。

最后结果引用守卫改动后核心 **14/14** 再次通过（core-final.log）；原工具 schema、overview 与多成果迁移兼容 **9/9**（compatibility-final.log）。服务最终编译 **exit 0**（build-release-candidate.log），产物在 candidate/dist；现有 Python reader/prompts 资源补齐，模块与提示资源导入核验通过，没有启动该候选服务。UI 的 Vite 构建通过（有原有大 chunk 提示），未运行会重写并行 UI 生成样式的整套 npm build。

扩大回归期间共享源码持续变化，曾出现旧 fixture、队列优先级和公开回传断言失败；不能将其宣称为全项目通过。该次失败后未退出的合成测试树已按准确进程关系结束，仅涉及本任务测试进程。本任务新 schema 曾污染共享 required 字段，已修正隔离并复测。初始全量 typecheck 有既有 24 处测试/UI 类型错误；并行修改中又先后出现 recursive-main-inputs.ts:169 的 Row 未定义类型、service.ts 未使用 internalScheduled，均未擅改其他 owner。最终完整 typecheck **exit 2，46 处错误**（typecheck-current.log），集中在脚本/测试/UI；无 src 或新增 work-history 测试错误，包含并行更新的 recursive-fixture 未使用参数问题。不能据服务构建通过声称完整检查通过。

功能 hunk 的 diff review 完成：新测试/协议 peer/文档均不含真实原文或凭据；源迁移、原 operation、来源/引用/并发边界与已批准方案一致。共享 service.ts 的 diff --check 仍报告并行行的两处尾空白（1825/1838 读时位置），不在本任务 hunk，未顺手清理；其余本任务相关检查无空白错误。最终源码哈希见 candidate-source-hashes.json，用于复核，不是可覆盖共享文件的回退补丁。

正常采用需要以后获准发布：现有 schema/tool fingerprint owner 会要求兼容审查；本轮未迁移日常库或把候选塞进冻结发布。schema 4 一旦采用，旧程序不能继续写；不通过恢复旧生产库撤销删除。尚未采用时可只撤回本任务功能 hunk 和新测试/说明，保留他人改动；已采用后优先前向修复，已删正文/原生对话不可恢复。

## 本次 code review 与提交边界

用户进一步授权 review 和 Git commit。复核后修正了以下问题：

- list_work 的分页原先仍全量读取 matters/interactions/deliveries；现在由原 owner 按当前页 ID 在 SQL 层选择，默认调用语义保持，不额外建服务或实体。
- 删除前原先按每条消息重复扫描结果 JSON、处理报告；现在整批检查，报告 CTE 一次物化。32 条消息的合成测试确认结果引用扫描仅一次，准确删除数为 32。没有实测生产延迟或空间，不承诺容量上限与性能倍数。
- 清理测试原先依赖未提交的 Worker 完成流程；现在直接生成合成终态事实，再走原验收/交付 owner，验证重点仍为真实清理、原生协议与主工具入口，不把并行回传改造带入提交。
- 重启后的原生回执投影优先使用 operation 当前状态，避免旧 checking 响应遮住 uncertain。补充合成回归，未知状态不会被误报为仍在检查。

按 hunk 暂存并直接虚拟读取 Git index 验证，不建立 worktree/源码副本。提交版本服务类型检查 **0 错误**，核心/工具/迁移 **18/18 通过**。扩展任务生命周期/消息/停止/MCP 回归为 **29/40**；同一环境下 HEAD 基线也是 **29/40**，11 个失败名称完全相同（旧 memory fixture、通知 fixture、目录断言），不宣称全项目通过。相关日志为 index-build-final.log、index-tests-final.log、index-regression.log、head-regression.log。部分 MCP 测试自启动子进程使用原 tsx/工作目录，属于同环境对照，不冒充完全冻结的子进程构建验证。

本次提交只含清理功能、必要 SQL 过滤、原生错误分类、相关合成测试和两份说明；保留并行 Worker 回传、UI、渠道、记忆移除及其他 dirty 改动。别的未提交测试中的 schema 4 适配仍留在工作目录，未将其整份文件纳入。暂存 diff --check 通过。无真实归档/删除、部署、重启或外发。

## 合成调用示例

下列 ID 为示例；实际先 inspect 得到当前准确版本，不能复制示例 revision 或用工具参数自授删除权。

```json
{"operationId":"history-archive-synthetic-1","taskId":"task-synthetic-1","version":1,"expectedTaskRevision":9}
```

相同结构用于 archive_work/restore_work。delete_work 不带 runId 清合资格内部正文；指定原生对话时：

```json
{"operationId":"history-delete-synthetic-1","taskId":"task-synthetic-1","version":1,"expectedTaskRevision":9,"runId":"run-synthetic-1","expectedRunRevision":7}
```

list_work 用 `{"includeArchived":true,"limit":20}` 查归档，沿 nextCursor 翻页；已删除骨架按准确 taskId/runId inspect。多个准确授权目标逐个处理并汇总，不因其中一个 skipped/uncertain 把整批报成功。
