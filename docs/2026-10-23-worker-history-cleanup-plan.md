# Worker 对话与历史事项清理：最简方案

2026-10-23 已批准方案。**首选：直接增加 `archive_work`、`restore_work`、`delete_work` 三个主 Agent 工具，复用现有查询、用户来源和 operation 回执；首期同时交付归档、取消归档与真实删除。** 源码候选及实际验证见[实施记录](2026-10-23-worker-history-cleanup-implementation.md)，不代表已上线。

## 一页概要

- **有必要做。** 用户确实无法通过正式工具清理历史；源码也缺相应接口。历史分页能减少读取量，不能删除数据。但未测量磁盘和延迟，不能断言历史是主要性能/空间瓶颈。
- **主 Agent 判断价值。** 沿已有 list/inspect 查准确对象和证据，用普通对话提出清单及影响；用户已明确授权具体范围就执行，范围不清才先询问。不把“旧、失败、取消”写成自动删除条件。
- **三个直接动作。** 归档只收起 Task；restore 只取消归档，不启动执行；delete 清除指定 Task 的可删内部消息正文，或删除指定 Run 的 Worker 原生对话。两个删除目标独立，不连带成果。
- **代码保护事实。** 活跃/暂停需续接、待答/未验收、未消费回传、未知副作用、外发未确认、待删正文有引用时跳过并说明原因。首期不级联删除、不重写引用，不为清理解决所有历史孤儿。
- **只加必要状态。** 建议仅新增 `tasks.historyState` 一列；保留 Task 身份骨架，原生删除进度复用 `operations`。不增加统一清理对象、preview/execute 工具、预览记录、token、批次计划、回收站、管理页、扫描服务或定时策略。
- **一次首期交付。** 不要求先归档才能删除，不先发布只有归档的版本。成果/附件/工作区/备份、Cindy Session、旧开发 worktree 均不在清理范围；不新增 GC/VACUUM，不修改 Codex。

方案审阅阶段仅修改本文，真实归档、删除均为 0。其后用户已授权实施源码与合成验证，结果另见实施记录；本文保留已批准的设计合同及调查边界，不能作为运行宿主已采用能力的证明。

## 1. 已核实的能力与证据边界

原调查核过指定截图、Cindy 项目登记、实际 cwd 与 Git 根，均对应 `/Users/wolf3c/Project/homer` maintree；未操作既存 worktree。截图仅提出两条收起建议，明确清理为0，不能用模型自报替代源码核验。

原调查 HEAD 为 `a03c72ad5839792dc5c22a5dcf86892a0961bb8d`；本次修订开始读时为 `916fb81e2f663ea0630085061b90e0ac262b6fd4`，收尾读取时并行工作已推进至 `eeb7b263eec4ede76db11a341772959753217504`。本轮仅复核必要入口，不声称重新审过整个新 HEAD。本文写前前像 SHA-256 为 `e19f255267b538a2c62d6eeba9d4cccd484d1b3a82f24d0a536046bc805c821d`，已重读，保留必要事实并按本次要求替换原方案设计。源码行号定位读时工作目录，**不代表干净提交或运行宿主版本**。本次所查 `src/service.ts`、`src/main-native-approvals.ts`、`ui/DESIGN.md` 已有他人修改；原调查另涉及队列、Web、交互和 UI 的 dirty 工作均未改动。

遵守任务附带 AGENTS 指南及已读 `ui/DESIGN.md` 的不可变 Worker 卡、TaskCard 和取消活动阅读器规定。此前使用 product-manager、OpenAI Docs 必要部分；指定的 design-agent-owned-workflows、review-native-tool-reuse 未在已查技能源找到，未声称读过，按请求已明确列出的职责边界设计。

| 当前事实 | 准确入口 |
| --- | --- |
| 主工具有 list/派工/检查/停止/验收，递归工具有消息/续接/交付，没有历史归档、恢复或删除工具 | [tools.ts:23](../src/tools.ts#L23)、[recursive-tools.ts:17](../src/recursive-tools.ts#L17)、[MCP目录:15](../src/worker-interaction-mcp.ts#L15) |
| `list_work` 返回全量业务 snapshot；`work_inspect` 读业务契约、Run、结果及成果文件，不读原生对话全文 | [service.ts:627](../src/service.ts#L627)、[service.ts:1186](../src/service.ts#L1186)、[recursive-tasks.ts:985](../src/recursive-tasks.ts#L985) |
| 已有主历史分页、过程懒读；Task overview 仍读取所有 Task 当前版本，状态筛选常量不是归档能力 | [web-history-pages.ts:159](../src/web-history-pages.ts#L159)、[task-overview.ts:78](../src/task-overview.ts#L78) |
| PendingItems 已有 open/closed、分页、来源和 CAS；媒体另有到期 GC；均不是 Task/Worker 删除 owner | [pending-tools.ts:7](../src/pending-tools.ts#L7)、[media-store.ts:139](../src/media-store.ts#L139) |
| Task 完成、原生退出、验收、交付相互独立；关闭 engine 不删除持久线程 | [recursive-tasks.ts:1205](../src/recursive-tasks.ts#L1205)、[service.ts:1533](../src/service.ts#L1533)、[engine.ts:877](../src/engine.ts#L877) |
| 主 Actor 与真实用户来源已有宿主绑定，operation 已有去重/hash/状态/回执，native control 已有无模型 RPC 承载 | [service.ts:1575](../src/service.ts#L1575)、[service.ts:1582](../src/service.ts#L1582)、[recursive-tasks.ts:454](../src/recursive-tasks.ts#L454)、[service.ts:227](../src/service.ts#L227) |

结论：**Homer 尚无完整业务清理 owner；Codex 有可复用线程能力，尚未接出。** 现有通用 shell 不算受支持的清理接口，不能绕过引用、授权及原生 owner。未读取运行宿主目录或调用生产接口，不能宣称当前主 Agent 实际已采用新能力。

固定版本证据沿用原调查：`engine.ts:450` 校验 `0.163.0`，固定二进制 `--version` 报 `codex-cli 0.163.0`；没有启动模型或调用删除。官方同版本[协议注册](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/app-server-protocol/src/protocol/common.rs#L536)有 thread/archive、thread/unarchive、thread/delete；[delete 实现](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/app-server/src/request_processors/thread_delete.rs#L28)可能连带原生 spawn 后代，[移除准备](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/app-server/src/request_processors/thread_processor.rs#L1002)可能关闭已加载线程。因此必须先核安全，不能靠原生 API 替 Homer 保护活跃工作。后续以固定二进制的独立合成 HOME 验证，不按最新在线文档假定本机支持。

## 2. 对象与三个工具的准确语义

| 对象 | 本期怎么处理 |
| --- | --- |
| Task | 业务事项及版本、父子/依赖、验收/交付的归属；不是一段聊天。归档/取消归档只改历史可见性；删除只清获准的内部过程正文，保留下述骨架 |
| Run / Worker | Run 是某 Task 的一次执行，Worker 身份为 Task 的 executorAgentId；可能多次尝试。指定 runId 才能准确选到某次原生对话，不按任务标题或“最新 Worker”猜测 |
| 原生 thread | 由已登记 Run.threadId 解析到 Homer 专属存储；和 Task 生命周期独立。删它不删除 Task/result，不代表停止工作，也不修改主 thread 或记忆 |
| 其他历史 | 不可变公开 Worker 事件、主对话/原答复、成果文件保持；Cindy Session 和开发 worktree 不属于 Homer 业务历史。PendingItems 首期继续用原 open/closed，不新增其清理状态 |

沿已有 `list_work`、`work_inspect` 发现/检查，不增加候选扫描工具。工具按现有 work 命名，**每次只处理一个准确对象**；同批授权可逐个调用并汇总部分成功，无批次实体。

- `archive_work({operationId, taskId, version, expectedTaskRevision})`：归档该 Task。默认列表/顶部计数按根事项展示时，先核其子项不会被遮住；有活跃/待处理子项即跳过。不停止 Worker、不变更验收/交付、不归档原生 thread。
- `restore_work({operationId, taskId, version, expectedTaskRevision})`：仅将 archived→visible。visible 返回已恢复；deleted 返回不可恢复。无永久删除撤销，不重放消息、不启动 Run，不强制采用删除的确认门槛。
- `delete_work({operationId, taskId, version, expectedTaskRevision, runId?, expectedRunRevision?})`：不传 runId 时删该 Task 的合资格内部消息正文；传 runId 时只删该 Run 的原生对话，并要求 expectedRunRevision、Run.taskId 匹配。服务端解析 threadId/HOME；不收任意路径、外部 threadId、confirmed 或 approved 参数。两种删除互不隐含，想删两者分别调用。

首期原生删除仅处理**已确认退出且没有原生 spawn 后代**的 Worker thread。用固定协议关系过滤分别核活跃/归档目录的元数据；发现后代即跳过并说明“原生删除会连带子对话，本期不级联”，无法完整核实也跳过。Homer 子 Task 与原生后代不是一回事；不为解决它们新增递归清理引擎，不手动删原生 HOME/库/rollout。此保守范围仍提供真实的单对话删除，不阻碍 Task 归档或正文清除。

## 3. 删除到底清什么，留什么

Task 删除限定于 `agent_messages` 中由已有 `operations.kind='send'` 产生的内部消息，且相关接收/协调已全部正式结束、正文无已知引用。清除其 `payloadJson` 原正文，替换为明确的 `{"historyDeleted":true}`，保留消息 ID/seq、sender/recipient、Task/version、Run/epoch、kind、replyTo/causation/targetRunId、原 operation/payloadHash 和 receipt。**不碰 user_input、宿主结果/终态通知或公共事件快照**，不增加任意 JSON 字段识别/清理器。读时返回“内部正文已删除”，不把标记当原业务 payload 继续执行。

任一待删消息被 replyTo/causation、未决等待、未结任务或现有原答复引用，默认跳过该 Task 删除并列出阻断 ID；不拆引用、不递归删引用方。无法证明旧格式可安全清除，也跳过。Run checkpoint、契约、操作回执等本期保留，避免为很小的空间收益扩展清除规则。

必须保留原 Task/Run/version/父子/依赖身份骨架、需求及真实来源、result 与 review、completion 文件组、publication/delivery、原正式答复和成果授权。Task 的历史状态变 deleted 只是最小留痕，**实际正文清除与状态修改同事务完成**；回执给出真实清除条数。若该 Task 没有可删正文，返回 no_deletable_content，保持原状态，需要收起可调用 archive，不能仅改 hidden 就报删除。

原生对话删除确经固定 `thread/delete`，成功后正文不再可读；Task/result/文件保持。Run 原 threadId 保留用于引用说明和回执核对。若两类内容仅删其一，分别报事实，不能称“整事项连成果永久删除”。已删除正文/对话不可恢复，摘要重建不是撤销。既有记忆/备份可能仍有派生事实，不承诺安全擦除所有痕迹。

归档仅减默认噪声，不释放正文空间；上下文压缩也不是删除历史。SQL 清除通常产生可复用页，不保证主库文件变小，WAL 仍可能暂存旧页；见原调查的 SQLite [VACUUM](https://www.sqlite.org/lang_vacuum.html)、[WAL](https://www.sqlite.org/wal.html)依据。本期不引入空间维护、VACUUM、auto_vacuum 或额外 GC，不删成果/附件/共享文件、工作区、Git、发布冻结和备份。

## 4. 授权与保护：沿用现有边界

**首选不新增授权实体或参数。** 像现有 rootAuthority 一样，由 `service.mainActor()/mainContext` 绑定真正已领取的用户消息；代码验证当前主 Agent、主 thread、主轮仍有效、真实 sourceRequestId 及 Homer 资源归属，拒绝 Worker、事件轮或模型伪造来源发起新清理。已存在回执可只读核对。语义上“用户究竟允许删哪些对象”仍由主 Agent 阅读可信用户对话并遵守，sourceRequestId 不是逐目标机器批准证明；不能虚称已有细粒度删除授权系统。

主 Agent 缺少准确授权时，先用普通对话列对象/ID、保留内容及不可逆影响，结束本轮，待用户答复后执行；已有准确授权直接调用，不逐条再确认。不是让 delete 工具创建 preview 或等待一个新 token。模型传 confirmed:true 无效；工具安装、失败/取消状态、Worker 建议、“自己优化自己”不授予删除权。Web/微信/Telegram 通过同一用户输入与主 Agent 工具入口执行，不新开管理 API；首期不自动定时清理，不将本次研究当执行授权。

现 `MainNativeApprovals.openOperation()` 是安装/配置专用（[入口:105](../src/main-native-approvals.ts#L105)），不是现成通用删除确认。首选不扩它、不套 command approval。如果后续另要求“代码必须独立验证用户对精确 IDs 的批准”，才需在既有 interaction owner 内扩一种准确操作及真实用户提交绑定；这是额外合同，本稿不假装自然语言来源已实现它，也不默认加上。

原 owner 每次执行前在同一事务核当前 version/revision 与以下事实，不能依赖早先清单或 UI done：

- 全部相关 Run 的活跃、排队、sealing、暂停/需续接、recovery、停止/退出未确认、有效 lease/live callback/后台执行；Task 完成不等于原生已退出，重启丢失证据即跳过。
- 待答/审批、未验收/未交付、准备中上传、delivery/outbox 未确认、unknown 副作用、未激活版本和仍需处理子事项。取消/失败不自动解除保护，不为清理顺手关闭它们。
- 待删正文的依赖、消息/原答复引用。指向保留 result/publication/身份骨架的关系照常保留；本期不删结果文件，不需要为此维护全工作区引用。新引用写入与删除共享现有数据库事务/状态检查，避免先检查后另事务删除的窗口。

兼容既有 MainInputs 与[Worker 回传统一队列方案](2026-10-23-worker-return-main-queue-plan.md)：pending/offered/received/uncertain/blocked、已领未结束、业务 ACK 后公开报告未落地、Worker 决定或外发未确认都保护；不能只看 processed。按原 messageId/receipt/process/报告事实核对，正式处理闭环后才成为候选；证据缺失就跳过，不改队列、不提前 ACK、不重做统一排队。当前清理请求及其来源、主 thread 永远不在自己的删除范围。

## 5. 同库与原生调用失败怎样处理

归档/恢复和 Task 正文删除都是**单对象短事务**：核资格/CAS→原 operation 幂等写入→更新状态或清正文→失效读投影。直接调用，不先创建计划。并发新引用和消息发送必须检查原 Task.historyState；已删正文不能被迟到消息重写，原 run/epoch 事件只能记录必要事实，不能复活旧工作。

原生删除跨存储，复用原 `operations`，不加表/调度器：

1. 在该 Task 的原 operation scope 记录 runId、原 threadId、存储绑定标识和当前步骤，并核资格；原生 RPC 期间只以这个 accepted/uncertain 操作占用相关对象，不持 SQLite 长事务。现有变更/续接/claim 入口检查该占用，避免同时启用被删线程。
2. 用已有 native control 调用精确 thread/delete；确认后将原 operation 收尾。Task 正文删除和原生删除是两次独立操作，没有合成的跨存储“全成全败”合同。
3. RPC失败/ACK丢失保留 failed/uncertain。用 `work_inspect(operationId, operationScopeId)` 查原回执；只做同绑定、精确线程的元数据核对，不自动重发删除或模型操作。not-found 仅在曾登记、存储绑定正确且服务可用时证明目标不存在，连接/权限故障不等于已删。
4. 进程重启后保留 unknown，用户明确继续核对时由原工具/owner完成原 operation；确认已删的步骤不重做，不能核实则保持未知。无需后台恢复服务，不能用恢复旧生产库补偿已经发生的删除。

多对象由 Agent 逐个执行，某项跳过/失败不妨碍其他授权项；逐项返回准确 ID、状态、清除正文数/对话数、原因，最后汇总。复用原 operationId/hash 防重放；同 opid 换目标或参数拒绝，CAS冲突后重新 inspect，不自动套新版本重试。占用/删除守卫只管相关对象，不把全局 safeToUpgrade 当授权。

工具回执至少区分 archived、restored、deleted、already_deleted、skipped、failed、uncertain、no_deletable_content；占用/释放字节没有测量就报未知。原生 API 成功不冒充业务结果删除，归档不冒充释放空间。

## 6. 必要代码与数据改动

只新增 `tasks.historyState TEXT NOT NULL DEFAULT 'visible'`，取 visible/archived/deleted。理由：业务 settled/outcome 不能兼作历史可见性，删除后需要保留被结果/交付引用的 Task 骨架。最小 tombstone 就是**原 tasks.id/headVersion/revision + historyState=deleted**；操作时间/删除范围/原 threadId 记原 operations.detailsJson，不再建 tombstone 表、不加 Run 删除时间列、PendingItem 状态列。

| 文件/函数 | 首期最小改动 |
| --- | --- |
| `recursive-tools.ts` 的目录/call；`worker-interaction-mcp.ts` 的主/Worker目录 | 三个 schema/路由；只接主 Agent，不能因共用 RECURSIVE_TOOLS 自动给 Worker 删除权 |
| `service.ts` 的 mainTool/recursiveTool、mainActor/rootAuthority、nativeRpc | 复用当前真实用户来源与无模型 control RPC；原生步骤和回执核对在原 owner 内完成，不建 history service |
| `recursive-tasks.ts` 的 migrate/insertTask/check/inspect 与 mutation | 一列迁移、显式 INSERT 列名；简单 archive/restore、正文 delete、原生占用与已删引用守卫、原 operation 回执。两个可见性动作可共用一个布尔参数内部方法，无通用清理对象层 |
| `tools.ts` 的 list_work schema，`service.ts` 的工具发现分支 | 默认过滤归档/已删；保留精确 inspect 与含归档查询。不要改 scheduler 用的全量 snapshot；只给工具发现增加必要分页，不加候选扫描接口 |
| `task-overview.ts` 的 readTaskOverview、`web-history-pages.ts` 的 revision失效、必要 Web 读类型 | 顶部列表/计数同源过滤，删除正文显示准确说明；现有更新事务触发缓存失效，重启可重建 |

一列也需要增量 schema 采用；`insertTask()` 当前位置式 `INSERT INTO tasks VALUES`（[453行](../src/recursive-tasks.ts#L453)）须改列名。旧行默认 visible，不批量清理历史；原 Store schema 守卫与配套工具采用须保持兼容。旧版可能忽略新删除状态，不能回退旧程序后继续执行或用备份覆盖新事实；删除不可逆，优先前向修复。

**无需改动** Codex、Files/媒体 GC、PendingItems、主对话原文、不可变 Worker 卡快照、QuestionFlow、现有渠道协议/业务队列和发布冻结源。若实施发现某现有读接口确需新增已删说明，仅扩该结果字段，不顺手改整层。

原卡继续准确表示“当时交办/收到”，不回填归档/删除状态、不加按钮或当前状态角标；本次工具回执/已有 inspect 说明当前关联已删除。正式 FileList/Canvas/原答复沿原 result/publication 授权可读；精确读取已删正文返回已删说明，不404或跳到最新对象。默认发现/已有搜索结果排除已删正文，归档可显式查；仅失效受影响读缓存，主历史消息未删不强制重做全部游标。过期锚点沿原 expired 重读。无新管理页面，不恢复活动阅读器。

## 7. 首期交付与核心验收

**首期一次交付三个工具和可用真实删除，不依赖先归档。** 实施前仅最小核实固定二进制的无模型 thread/delete、元数据后代核查、Homer 专属绑定和队列最终处理事实；不读生产全库、不扫描用户文件。固定原生能力未通过合成验证则该路径明确 unsupported，不能把未验证的对话删除报完成。

复用现有合成 Store/主 Agent/原生及渠道夹具，先红例再实现，不加框架。保留六组核心验收：

1. archive 后默认发现/顶部计数变化；restore 取消归档且不执行；delete 无需先归档，restore 不能复活已删正文。
2. 准确 task/version/run 与真实用户来源绑定；错误来源、Worker/事件轮、外部 HOME 被拒；confirmed 参数无效，CAS冲突及原 operation 幂等正确。合成 Agent 仅调用获准 IDs，验收工具承载边界，不宣称已证明真实模型总能正确理解自然语言授权。
3. UI终态但 Run未退出、暂停续接、待答/待审、未消费回传、ACK后报告未落地、unknown外发/副作用均拒绝；正文有引用默认跳过，不级联。
4. 原生失败、未知回执/崩溃后只核原目标，不盲重放；有原生后代或无法核实则跳过，不为删除强制关闭活跃线程。
5. 业务事务清除后原内部正文不可读、原生成功后对话不可读；正式成果/验收/原答复引用仍可读，旧 Worker 卡不变，FK及现有读取回归通过。
6. 同批目标部分成功准确汇总清除数、跳过原因和占用未知；Web/微信/Telegram沿同一入口和权限，现有 TaskCard/已删说明做必要渲染核对，无新页面或真实外发。

建议按本稿实施首期，不再要求用户重选归档/恢复/删除原则；正式成果、主对话和全部审计的抹除，以及长期自动清理，都不默认扩入。

以上为已批准的设计合同。后续实施及合成验收见实施记录；**任何真实对象的归档、删除仍均为 0。**
