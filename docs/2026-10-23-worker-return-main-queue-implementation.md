# 主 Agent 统一消息队列：实施与验收

2026-10-23。依据 [已审阅方案](2026-10-23-worker-return-main-queue-plan.md) 和用户“Implement the plan”授权实施，随后按用户要求审查并提交源码。本记录描述本任务代码；共享工作区同时有其他改动，不表示整个工作区已达到发布条件。未发布、迁移生产数据或调用真实模型/渠道。

## 已实现的行为

同一主 Agent 授权域及线程内，Web、微信、Telegram 用户输入和发给主 Agent 的 Worker 业务回传，共用 `agent_messages/agent_receipts` 与 `MainInputs`。默认按服务持久 seq 接收顺序，Web 可交叉移动所有尚未领取的业务输入。没有渠道优先级、十秒插队或问题答案分段。领取锁定当前输入，能力刷新后的原请求续接也不让后续输入穿插。

Worker 原生 commentary、final 流、计划、工具过程继续由原展示 owner 负责，不逐字生成业务通知。Worker 的真实终结由现有结果 owner 生成 `result_ready/terminal`；显式 `agent_send`、现有阻塞/修订/审阅通知，以及原子登记的 `interaction_required` 才进入本队列。Worker 之间消息和有明确 targetRunId 的消息仍遵守原收件人与 Run 边界。

主 Agent 只领取一条回传，理解、检查和答复仍由 Agent 动态判断。完成、失败须有公开处理结果，或在同轮已产生正式交付；其他新进展、阻塞、需决策由 Agent 判断，纯确认可静默。已确认停止的纯回执允许静默。非空检查不自动评判正文质量，不生成固定业务总结，也不自动验收 Worker。

问题先由主 Agent 回答，必要时询问用户并结束本轮。原 Worker 可以继续等待，但不占用主 Agent 的领取轮。用户后续答复仍按同一队列进入，由主 Agent 回答原 Worker。原生停止、工具 ACK、当前原生轮的授权回执保留执行控制路径；业务消息不能借此插队或取得权限。

## 最小实现与数据归属

| Owner | 本任务修改 |
| --- | --- |
| `src/recursive-main-inputs.ts` | 用户/Worker 联合投影；准确 task/version/source 归属；共用 rank、队首、领取及排序事务；分页正文最多 80 项；未知来源只统计、不执行 |
| `src/recursive-tasks.ts::queueInteraction`、`src/worker-interactions.ts::open` | 在原问题保存事务内写入一次原 inbox 通知；复用原 operation 幂等键，不嵌套 BEGIN |
| `src/service.ts` | 所有业务模型轮统一从 `scheduleInputs` 领取；原内部调度入口仅唤醒它；取消内存优先级与能力续接让位；旧审阅也经过同一领取路径，已准备交付仅负责传输 |
| `src/recursive-tools.ts`、`prompts/main.md` | 说明当前领取、必要汇报与等待释放合同；主 inbox_read 只返回当前条，inbox_ack 不能确认未领取条目 |
| `src/main-process.ts` | 汇报写入原 MainProcess/history 消息；校验原来源、线程、正文后提供渠道恢复读取，不新增报告表或 reportId |
| `src/web-contract.ts`、`src/web-server.ts`、`src/web-homer.ts`、`src/web-history-pages.ts` | 原 dispatch endpoint 协商 `sources:'all'`；原 move/receipt endpoint 增加 messageId 分支；原用户编辑、取消与 operationId 继续使用 |
| `ui/homer-message-queue.tsx`、`ui/queue-operations.ts`、局部 CSS | 官方 MessageQueue 原 slots 接联合数据；保留来源、展开与服务排序；Worker 不可编辑或取消；操作未知时锁定并查原操作；窄屏按钮换行 |
| `src/channels/wechat-homer.ts`、`wechat-channel.ts`、`telegram-homer-bridge.ts` | 原用户入口、身份校验和接收事务保持；协调正文复用原 outbox，按原来源路由，恢复不重跑模型 |

没有新增持久表、列、第二队列、调度器、待办实体或报告覆盖状态。用户位置仍在原 payload.queueOrder；Worker 仅在实际移动时写所属 operation.detailsJson.mainQueueOrder。原 Worker payload 不改写。两种位置共用一组 seq 槽位，在同一事务更新相关 revision；排序不改 task/version、渠道身份或授权。历史数据不按当前任务状态重写。

`dispatchSnapshot` 与有界队首使用相同资格和 rank。待处理页的总数及 orderVersion 来自服务；跨页邻居由服务提供，不能用本页尾部替代全队列尾部。用户移动与 claim 的胜负由同库事务/CAS 决定；旧 opid 重试返回原结果，队列变化使旧游标失效。旧客户端未协商全来源时遇到 Worker 会收到 `queue_sources_required`，不能把用户子集谎报为完整顺序。旧用户 requestId 操作回执继续可核对。

Worker 的问题身份必须来自宿主登记的通知；普通 Worker 自报同名 kind/interactionId 仍只是业务数据。来源不明的旧通知保留原文、原回执，并显示只读数量；不猜当前授权域。合法的 null/标量业务负载也不会破坏队首读取。

## 处理、公开输出与恢复

复用 `pending → offered → received → processed/rejected`、`blocked/uncertain` 和原 MainProcess 工作状态，不新增整套状态机。领取事务也检查同域原过程的 working 状态，ACK 提前提交不能释放当前模型。启动确认关闭所有原引擎 lease 后，仅以宿主关闭事实释放旧过程所有权，原结果仍为 unknown，不提升未确认的 native final。入队不代表模型已读，模型已读或 ACK 不代表已汇报，Worker 完成不代表验收或正式交付。

原生 ACK 与过程来源记录同事务落库；模型结束后原过程消息保存正文。完成/失败缺必要正文会记录协调失败并公开说明，不把空回复记作正常汇报。单纯交互控制已确认送达仍保留允许空回复的原合同，不全局取消 allowEmpty。已确认关闭的失败轮记录失败边界；无法确认结束的轮保留 unknown/uncertain，不伪造完成。

本轮未确认消费的回传按事实转 blocked 或 uncertain，不自动退回 pending。真实用户恢复轮可通过原 inbox 工具读取同域内已经领取、原过程已经结束的 blocked/uncertain 历史并确认原条；不能读取或 ACK 尚未领取的后续输入。崩溃、模型失败、业务 ACK 结果未知不会自动重新执行原回传或重答 Worker。公开正文已持久但渠道发送未知时，只按同一消息 ID 恢复原 outbox；不再调用模型。协调正文是一条普通公开说明，不携带正式成果文件授权。微信/Telegram 中其身份不会随着问题后来被回答而改变，避免恢复时重复发成另一类通知。

Worker 输入的宿主收尾先完成原 legacy 发布等已授权后续动作，再结束原过程。旧 adapter 将同一份模型正文复制成正式交付时，仅保留正式交付这一公开副本并关联原过程，渠道恢复不会再制造一份协调报告。Agent 自己已发布正式交付后仍另写的非空说明则保留原输出事实，不通过自动“报告覆盖”判定抹掉其内容。

## 验收证据

输入均为需求推导的合成材料；SQLite、运行目录、假引擎和浏览器隔离，未使用生产聊天、凭据、数据库或真实渠道 API。任务临时证据在 `.codex/scratch/worker-return-main-queue-20261023/`，可维护的测试源保留在 tests。

核心定向回归 **96/96** 通过：

```sh
node --import tsx --test --test-reporter=spec \
  tests/main-queue-host.test.ts tests/main-queue-sources.test.ts \
  tests/message-queue-order.test.ts tests/message-queue-web.test.ts \
  tests/message-queue-scheduler.test.ts tests/recursive-main-inputs.test.ts \
  tests/recursive-queue-transactions.test.ts tests/recursive-targeted-messages.test.ts \
  tests/main-capability-continuation.test.ts tests/service-interactions.test.ts \
  tests/root-worker-notifications.test.ts tests/telegram-homer-bridge.test.ts
```

额外微信协调输出恢复用例通过；两个渠道的协调专项为 **2/2**，Telegram 其中一项已计入上述 96 项。

| 场景 | 观测结果 |
| --- | --- |
| Web U1 / 微信 U2 / Worker W1 / Telegram U3 | 使用真实接收桥和合成渠道身份；Web dispatch、真实 HTTP move/receipt、服务领取与假引擎 turn 一致；新回传不抢占原轮 |
| U1/W1/U2/W2，移动 W2 到前 | 持久领取顺序为 W2/U1/W1/U2；同文不同 ID 保留，原事件重试不重复 |
| 80 项分页、跨页移动、重启、另一设备旧版本 | 全局邻居保真；旧游标/版本拒绝；原 opid 可恢复；已领取/未知条不重放 |
| claim-before-move、move-before-claim、事务中途失败 | 锁定边界准确，排序、revision、operation 全部回滚或一并提交 |
| 必要汇报空正文、模型失败、ACK 后异常 | 有可靠失败说明；已完成操作不重跑；公开消息与原过程、历史正文一致 |
| Worker 问题及用户回复 | 自主答复、升级询问、等待时承接其他消息、原 Worker 恢复、原生权限边界及晚到响应回归通过 |
| 来源/身份边界 | 跨来源同 requestId 冲突，不同 ID 同文保留；未确定来源不执行；Worker 不能冒充宿主问题通知 |
| 渠道公开输出重试与恢复 | 校验原正文、原路由和绑定；仅入一次原 outbox，不重跑业务，不冒充正式交付 |

`tsc --noEmit -p tsconfig.json`、`tsc --noEmit -p ui/tsconfig.json` 通过。Vite 仅构建到任务 scratch，通过，保留原大 chunk 提示。

`tests/main-queue.browser.mjs` 使用独立无登录 Chrome、真实 Homer/HTTP/SQLite 和假引擎，19 项断言通过：混合来源、Worker 无编辑/取消、真实移动、未知响应查回执、320/390/1440 三宽度无溢出以及无 JS 错误。保留六张系统 light/dark 媒体环境截图；本任务未新增或改造全局主题。实际观察 320px 时摘要被按钮挤压，已按原设计约定让动作换行并复核截图。

## 尚未宣称通过的范围与发布边界

全仓 `tsconfig.check.json` 仍有其他测试/附件模块的类型错误，例如旧 connectionDirectory/connectionFile、测试跨 .ts 导入、附件适配和 JSX 检查配置；不属于这次队列行为修改。扩展运行 `main-process.test.ts` 与 `worker-interaction-mcp.test.ts` 时，15 项中 6 项失败：旧原生 engine 替身缺 messages、旧 Homer 替身缺 dispatchSummary，以及工具清单未包括工作历史的三个工具。微信完整旧套件另有一项未适配原生 ACK 的历史用户泡断言失败。均保留原事实，不为使其通过而改动无关产品行为。

本任务定向通过不等于整个共享 dirty tree 可发布。生产采用、旧数据预览、整体集成回归及固定发布 SHA 仍按原发布流程执行；本任务没有混入其他固定发布输入。无需 DDL/rank 全量迁移，但不能直接降级成忽略 Worker 位置的旧业务调度器继续运行。

如回退，仅撤本任务源代码 hunk；保留原回传、排序位置、问题决策、业务 operation、公开消息与渠道 outbox。先暂停自动业务领取或使用认识全来源顺序的版本，不能删除已确认事实来伪装未处理。

## 提交前独立审查（2026-10-23）

以 `1b52588d5725b343f6095f90ef6fcfe9cad5f4e0` 为基线导出临时副本，只叠加本任务 hunk；不依赖共享工作区其他未提交源码。提交前同步到 `c84977626af7e234c82a096d18c3d96ebbbdead1` 的已提交 Worker 卡片改动；不覆盖它的源码或文档。Worker 自动终结、问答 UI、记忆系统、Canvas 等并行未提交修改不纳入本次提交。合成 Worker 引擎依据实际工具清单产生相同结果通知，原 `task_complete` 合同及并行的新终结合同均可验收队列，本任务没有改造 Worker 终结方式。

审查修正保持原 owner：协调发送直接使用持久校验后的正文与原来源，删除重复来源查询；分页的邻居位置从逐项查找改为一次临时 Map，复杂度为 O(N + 80)；80 项 Worker 结果正文改为一次关联读取，整页总计 5 次查询（含原元数据读取），新增合成回归约束查询数不随每项增长；来源待核对数量从已有收件人/状态索引起查，不扫描全部历史消息。未增加持久索引、缓存、表、列或其他实体。

异常路径审查还复现了原过程仍 working、claim 返回空后立即反复调度的空转风险。修正为仅实际领取或已持久拒绝队首后推进；占用未解除时等待真实唤醒。新增有界红绿回归验证阻塞不空转，另验证队首原文校验失败仍持久失败并处理下一条；不新增轮询器、计时器或状态实体。

隔离内存数据库的 1,000 条历史过程、每条约 16 KB 正文，原过程占用查询 20 次采样中位数约 6.3 ms、P95 约 8.0 ms；此为本机合成读耗时，不作为生产延迟保证。80 项正文读取有界，排序仍保留完整未领取顺序与 CAS，未用分页或缓存近似代替实际领取顺序。

精确候选的 **69/69** 项相关回归通过，微信协调专项另 **1/1** 通过；服务端/前端类型检查、Vite 临时构建通过。独立 Chrome 的 **19/19** 项混排/真实排序/未知回执/320、390、1440 宽度及 light/dark 媒体环境验收通过，无 JavaScript 错误。新增结果预览的有界读取和调度双边界测试已计入 69 项。前文 96 项为共享工作区阶段的历史验证。

隔离副本补齐旧测试所需的临时父目录后，旧 `recursive-queue-transactions.test.ts` 仍有 15 项因 `memory_jobs` 表或 `app.memory` 已不存在而失败；在未叠加本任务的同一 HEAD 上分别复现表缺失与 `adopt` 缺失。未为通过这些旧断言修改记忆功能或混入其他任务的测试迁移；队列排序原子回滚另由本次通过的 `message-queue-order.test.ts` 覆盖。全仓测试通过与生产采用均不在此宣称。
