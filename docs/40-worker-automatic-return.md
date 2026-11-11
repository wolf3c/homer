> 本文保留 2026-10-23 的回传实现及合成验证；当前 Worker 会话回传、事项结案和验收边界见[主 Agent 与 Worker 会话架构](architecture/main-worker-chat-architecture.md)。

# Worker 宿主自动回传

日期：2026-10-23。状态：维护源码已实现；本页只记录本次源码和隔离合成验证，不代表日常环境已采用。引擎协议沿用项目固定的 Codex 0.163.0；本次没有启动真实模型或验证其他版本。

## 已确认的最小规则

Worker 直接用自然语言回答，结束当前执行。删除 `task_complete` 的工具目录、路由和领域入口，不保留双轨完成协议，不要求固定 JSON 或原生 structured final。宿主保存真实执行事实及已收到内容，业务结果由委派者审阅。

| 事实 | 谁负责 | 不能据此推定 |
| --- | --- | --- |
| 一轮 completed/failed/interrupted，或连接断开导致 unconfirmed | Engine 与宿主 | 目标成功、进程退出 |
| 已登记 task_wait 的正常轮结束 | 原等待机制，parked/ready 后原线程续接 | 整个 Worker 任务完成 |
| 其余执行终态及公开正文、暂存文件 | 宿主自动保存 offered 候选并通知 | 已验收、已正式交付 |
| succeeded/partial/failed 等业务结果 | task_review 的协调者 | 用户已收到说明 |
| 根汇总结算及正式交付准备 | 主 Agent 的 publish_delivery | 渠道已收录、用户已读 |
| 内部 inbox_ack、对外 recorded | 原消息及渠道机制 | ACK 等于已向用户说明，或 recorded 等于用户已读 |

## 实现与已有数据复用

1. `src/engine.ts` 在 `TurnResult` 中携带 completed 公开 agentMessage 的 itemId、phase、text。按 itemId 去重，接受原生 `turn/completed.items` 中未单独到达的正文；保留 status、errorCode。扩充已有 nativeCompleted 事件，不新增第二种终态事件。Worker 的返回不等待无关的后台查询完成，进程退出仍单独确认。
2. `src/service.ts` 将 completed 公开消息及真实轮终态写入当前 Run 的已有 checkpointJson；只取准确 thread/turn/epoch，不取工具输出、推理或增量拼接。失败路径关闭当前 Worker 后同样进入 endSegment；断线/超时不冒充业务失败。引擎关闭未确认时保留 lease 和 uncertain 屏障。
3. `src/recursive-tasks.ts` 的 endSegment 是唯一自动收尾入口。已登记正常等待时继续原等待；否则在一个 SQLite 事务中写候选、Run/Task 状态和已有 result_ready/terminal 通知。重复原 Run/epoch/turn 的回调复用 operations 回执；停止或旧 epoch 的回调不产生新变化。
4. 文件只纳入准确 Run/契约版本的已登记 staged 行。有文件时复用最早文件 Result 承载报告，其他行用已有 completionResultId 关联；无文件时才新增一行已有 structured Result。所有候选 outcome=NULL，保留原 resultId/文件路径/hash。全部文件先供审阅，正式发布才选择公开文件；不扫描目录猜成果。
5. 主结果 payload 使用 `{text,messages,execution}`；execution 记录 status、errorCode、nativeOutputError、exitConfirmed。text 优先采用 final_answer；无明确 phase 的旧原生正文可作为正文；只有 commentary 时 text 为空，原文仍保存在 messages。卡片只取正文短摘，不新增摘要模型调用。

没有新增表、列、消息队列、持久实体、依赖或 schema 迁移。checkpoint 中的 workerOutput/workerTerminal 仅供本次未提交回传恢复，提交结果后清除。实际文件安全、来源、待答、子任务权限、原主线程及渠道发送机制继续由原 owner 负责。

## 审阅与交付

`task_review` 增加可选 evidence、children 字段。对新 outcome=NULL 候选，由协调者明确给出 outcome，检查实际正文和整个文件组，提供必需 criteria 的证据；partial 必须有 gaps，已有孩子须逐一处置，成功的必需依赖仍须满足。无必需标准、无孩子时可省略空对象/数组。缺正文、缺要求文件、未知进程退出或在途未知副作用不能直接通过成功验收；返工沿用 request_changes。

历史候选已有非空 outcome 时，保留原语义和操作回执，不要求改写旧数据。重启恢复遇到旧 staged 候选时复用原主结果及原选定文件集合，不创建第二份主结果或扩大旧文件集合。旧 pending/uncertain 发送不因新回传而自动重放。

主执行根汇总不再单独调用完成工具：在已有 `publish_delivery` 中使用 resultId=null，并提供 outcome、evidence、children，与 text 一次验证、结算和准备交付；失败则整事务回滚。发布已有验收结果的原调用保持有效。没有为主 Agent 创建虚假的 Worker Run。

终态通知进入已有 `agent_messages/agent_receipts`，由统一主队列领取，与各渠道用户业务消息使用相同队列顺序；不增优先级、第二队列或主动抢读。主 Agent 核实后决定审阅、返工及向用户说明。主回复失败或为空时不凭空生成正式交付，不把“结果已收到”标成“用户已获告知”。

## 失败和恢复

- Worker 忘记任何完成动作：无需模型补调用；正常自然语言最终回答照常回传。缺最终正文也产生可检查的空结果/文件候选，业务不自动成功。
- 先有文件/正文，随后失败：保留已收到内容和真实执行错误，协调者决定可接受部分、失败或返工。
- 宿主在已收到 completed 公开正文后、收尾提交前退出：重启先按原 lease 机制确认旧进程关闭，再从 checkpoint 回传。没有真实轮终态时明确 restart_unconfirmed，保留 recovery，禁止把存下的文字推断成成功。
- 已提交候选后重启：保留候选和同一通知，不重复创建结果。通知已经被领取但未处理时沿原收据恢复，仍不代表主 Agent 已完成说明。
- 显式停止：保留原停止协议、epoch fence 和取消语义，把已收到正文及 resultIds 放进原终态通知，不另造一条“完成成功”事件；未知副作用不自动重试。

宿主崩溃前尚未收到的内容、只存在于未完成增量中的文字不能保证找回。本方案不会为此增加模型补摘要、自动恢复执行或通用协调平台。

## 验证边界

所有本次输入均为 requirements-derived synthetic；仅隔离 scratch 数据、伪引擎及协议夹具，无生产数据库、真实聊天、凭据或模型调用。未构建 dist、部署、提交或切换服务。

可重复入口：`tests/automatic-worker-return.test.ts`、`tests/engine-rpc-lifecycle.test.ts`、`tests/service.test.ts`，以及递归等待/发布、多个文件、停止、回执恢复和 Worker 卡片的现有测试。执行日志保留在 `.codex/scratch/automatic-worker-return-20261023/`，旧文档历史通过数不能替代本次验证。

| 检查 | 实际结果 | 日志 |
| --- | --- | --- |
| 自动回传、原生协议、旧入口、递归业务、多文件、停止恢复等 27 个测试文件 | 258/258 通过，0 跳过 | final-related-tests.txt |
| 真实 Homer + 合成引擎的完整/部分递归树 | 2/2 通过，原线程 wait/wake、正式文件发布 | final-recursive-host.txt |
| 维护源码 `tsc -p tsconfig.json --noEmit` | 通过 | final-source-typecheck.txt |
| `tsc -p tsconfig.check.json --noEmit` | 24 条错误，位于未涉及本次实现的聊天、附件、历史观察及 JSX 测试/适配文件 | final-typecheck.txt |
| 扩展旧查询测试 | 210/211 通过；旧 worker-card-query 测试仍调用已不在当前队列实现中的私有 workerRunMessages，未恢复该过期路径 | final-integration-tests.txt |

全项目类型检查和旧查询测试的问题不算本次通过，也未顺带修复。没有运行全量 npm check 或真实模型/手机验收；本次修改不改变页面布局，未宣称浏览器渲染验收。

## 提交前审阅

2026-10-23 补充审阅修正：

- 等待轮终态已保存但宿主未收尾就重启时，旧 Worker 已退出，必须进入 recovery；不能留在无法续接的 parked/ready。正常等待段重复回调保持 parked/ready，不生成假完成候选。
- 停止与终态竞争时优先采用完整 workerTerminal.messages，避免被较早 commentary 检查点遮盖。终态监听器或持久化失败会拒绝 turn Promise，不能让调用者无限等待。
- 新候选没有正文或文件时，既不能判 succeeded，也不能用 gaps 把空成果判成 partial。
- 移除逐条消息重复拼接且无人读取的全文，重复公开消息与重复终态不重写检查点。查询计划实际命中 operations 的复合唯一索引、results_run 和 one_completed_result_per_run，无新增索引或全历史扫描；这不是生产负载压测。

以上缺口均先由合成回归复现，再修正。RED/GREEN 与 SQL 查询计划记录在同一 scratch 目录的 review-* 日志中。

提交边界：统一主队列已由独立提交 `ab0c706` 完成，本提交接入其现有通知消费机制。本次按代码块只提交自动回传核心、原五工具兼容、相关已跟踪测试迁移和新增专项测试；工作区中其他记忆、UI 修改和其他任务的未跟踪测试不混入本提交。对具体提交内容另在 scratch/commit-preview 导出精确快照，以 Node 22.22.0 独立检查，不依赖其他未提交源码。

最终提交快照：`commit-preview-release-tests.txt` 61/61、`commit-preview-host-tests.txt` 22/22、`commit-preview-release-typecheck.txt` exit 0。宿主组明确排除既有累计时限用例，本次保留 HEAD 原用例，不混入工作区中其他时限修改。组合工作区 `review-final-related-tests.txt` 261/261；随后增加的等待回调去重用例随 `review-duplicate-wait-green.txt` 46/46 复核。其余全项目检查限制保持上述记录，未进行生产压测或真实模型验收。
