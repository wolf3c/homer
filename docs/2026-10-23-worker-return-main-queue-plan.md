# Worker 回传进入主 Agent 统一队列与公开汇报方案

实施状态：用户随后明确授权实施，现有代码与隔离验收见 [实施与验收记录](2026-10-23-worker-return-main-queue-implementation.md)。以下保留第一阶段审阅时的方案和当时状态，未实施的描述是该阶段历史记录。

状态更新（2026-10-23）：下文保留第一阶段审阅时的方案与代码观察。用户随后授权实施和源码提交；实际实现、审查修正及隔离验收见 [实施记录](2026-10-23-worker-return-main-queue-implementation.md)。方案中的“尚未实施”等表述仅描述当时阶段，不代表当前源码状态。

2026-10-23，第一阶段修订审阅稿。**此阶段只更新方案，尚未实施、构建、测试、运行模型、迁移或上线，待CTO复核后再实施。** 一期完成的定义：同一主Agent授权域内，Web/微信/Telegram用户业务输入与Worker发给主Agent的业务回传，共用服务持久接收顺序和同一逐条领取路径；Web可交叉调整所有未领取项。主Agent判断何时需要说明新进展、结果、失败、阻塞或请用户决定；完成/失败不能仅显示Worker卡就结束。仅把Worker投影到列表不算交付。

本次相对初稿的准确增量：第1、3、5、8、10节补跨渠道输入、授权分区、服务接收顺序及混排验收；第3、6、7、11节取消过程commentary/final自动入队、每条新文字强制汇报和报告覆盖判定，恢复Agent动态判断；第4、8、9节改为保留现有用户rank和接口owner的最小增量，不再搬迁全部rank或整套换成v2。第7节同时复用原ack/过程锁，取消仅为收尾而增加的recorded回执合同。历史源码观察与附录保留为初次读取证据，本次复读证据在文末。

## 1. 用户目标与范围

用户要求：①“Worker 回来的各种消息”进入主 Agent 的 Message Queue，用户能调整顺序，主 Agent 逐一按序处理；②主 Agent 应理解回传并总结当前情况，帮助用户决定下一步，不能仅展示 Worker 卡。

用户进一步明确：“用户和Worker给主Agent的信息都在同一个队列排序，主Agent逐一处理；微信/Telegram等渠道用户消息也一样”，以及“如果有必要比如完成失败”应向用户说明。这里的统一包括业务输入入口，不仅是报告输出路由；“有必要”由主Agent结合实际新事实判断，不解释为所有过程文字都必须唤醒主Agent并逐条通知。

主 Agent 的判断、验收、是否续接或继续派工仍由 Agent 按实际目标、证据、预算和授权决定。代码负责身份、接收、排序、串行领取、回执与恢复；不增加固定协调工作流、自动验收、通用消息总线、第二持久队列、二次待办或新 runtime。Worker 有问题先问主 Agent，主 Agent 能答就答，缺信息或需要用户决定才问用户；用户答复后由主 Agent 整理回原 Worker。一次完成或一张完成卡均不代表正式交付。

一期包括Web、微信、Telegram接收后的用户业务输入，普通Worker根任务及子任务给主Agent的业务通知、求助/提问、失败/阻塞和显式进展消息，旧legacy协调入口，Web统一排序及必要的公开汇报。微信/Telegram无需新建拖动UI，用户在Web能移动本授权域内任一来源的pending项。Worker给另一个Worker的消息仍走原收件人inbox；主Agent线性串行不改变Worker并行执行。问答组件沿已经实施的 [问答精简合同](2026-10-23-question-flow-simplification-implementation.md)，本任务不重做其UI。

### 1.1 统一范围是同一主Agent授权域

复用现有Homer runtime、mainAgentId/mainThread以及入口已验证的用户来源和渠道绑定。Web登录/连接范围、微信bound owner及binding、Telegram trusted bot/chat/user/bindingVersion必须先通过原校验，才是该主Agent的输入。来自同一授权用户的各渠道消息可混排；不同用户、独立主线程或其他runtime的私有消息不可为了“全渠道”跨域汇总。sourceRequestId、task/version、channel origin与原授权范围不因移动而改变；同线程或名称相同本身不是跨用户授权。来源不符在接收前拒绝，缺准确归属的旧记录不猜当前用户。

## 2. 核查边界与依据

- Cindy 项目登记 `list_projects` 返回 `/Users/wolf3c/Project/homer`、exists=true；实际 cwd、Git 顶层、git-dir 和 common-dir 均指向该 maintree。另有 `.cindy-worktrees/tranquil-goodall`，本任务未在其中工作、未创建工作树。没有读取生产数据库、聊天记录、HOME 配置或凭据。
- 根及 `docs/`、`src/`、`src/channels/`、`ui/`、`ui/vendor/assistant-ui/` 没有额外 AGENTS.md，遵循任务给定的 Global Agent Guidelines。已读 `ui/DESIGN.md` 及固定组件说明。
- 应用指定的 [design-agent-owned-workflows 技能](</Users/wolf3c/Library/Application Support/CindyGlobal/owners/87403691aa9be3434bfd/bots/bot_1792116750356_mf01yl/skills/design-agent-owned-workflows/SKILL.md>)，区分 Agent 策略和代码可靠性；未调用真实业务或模型来验证判断。
- 源码读取绑定时间为 2026-10-23 14:21:35 北京时间；HEAD=`a0dcb01588a273661cee592d756eed78d2e00656`。工作区已有大量并行修改，本文依据实际文件，不把 HEAD 当作完整候选。实施前必须重新核前像、按 hunk 保留他人工作。
- 用户附件只用于确认可见现象：Working 正在处理协作结果、Worker 完成卡和两条用户待发送消息同时可见。截图不能证明模型未收到回传，也不能证明它已总结、验收或正式交付。附件原文和个人数据不复制进本文。

### 2.1 当前实际链路

| 事实与源码 owner | 观察到的行为 | 结论 |
| --- | --- | --- |
| `src/recursive-tasks.ts::message/notify/send` | `agent_messages` 和对应 `agent_receipts.pending` 同步持久化；host notify 与 Worker `agent_send` 都会 wake | Worker 结果通常会自动通知协调者，不需要用户手工转发 |
| `::complete/review/failRun/holdChildren/stop` | 实际通知有 `result_ready`、`result_accepted`、`terminal`、`revision_requested`、`review_required`、`supervision_required`；`agent_send.kind` 可为自定义业务种类 | 不能只接成功完成这一种；同名任务不能作为去重键 |
| `::offerMainMessages` | 一事务按 seq 领取最多100条 `kind<>'user_input'` 且 targetRunId=NULL 的 pending/uncertain，全部转 offered | 当前是独立批量入口，未服从用户 Message Queue 顺序 |
| `service.ts::scheduleInternal` | offer 后过滤 legacy；普通协作设置 event=true、allowEmptyReply=true，提示“**不向用户聊天发布本轮正文**”；未 ack 的 offered/received 在 finally 变 blocked | 协作可以已经给到模型，却没有对用户的公开总结；blocked 也不是已成功处理 |
| `service.ts::mainTurn(onStarted)` | 创建 sourceKind=worker 的过程节点，给原消息记 received/turn；`recordWorkerReceipt` 从准确 host 通知生成不可变事件卡 | 卡是接收事实投影，不证明模型已完成判断，更不是公开汇报 |
| `main-process.ts::agent`、`conversation-projection.ts` | Worker 来源过程不收集公开 native final；用户回复 generation 仅为非 event 建立；主对话对 worker 节点只标“处理协作结果” | 仅改内部提示词或放开空正文检查，不能接通完整公开输出 |
| `service.ts::scheduleInteraction`、`worker-interactions.ts::open` | 问题先存 pending_main，ready hook 直接 enqueue 内部模型轮；可 respond，缺信息则 escalate 到 pending_user；没决定存在自动拒绝兜底 | 业务提问也绕过 MainInputs；仍应保留原 interaction 身份及真实送达事实 |
| `service.ts::scheduleReview/scheduleDelivery` | legacy 审阅/模型交付另行 enqueue；正式 deliveries 的发送和状态另归原 owner | 这些模型入口不统一便仍可越序；已生成交付的传输无需再次排模型输入 |
| `web-homer.ts::submit`、`channels/wechat-homer.ts::submit`、`channels/telegram-homer-bridge.ts::submit/respond` | 普通业务输入均调用同一app.submitMessage；微信source=wechat并在接收事务保存wechat_homer_receipts，Telegram source=telegram并同步persistAcceptance；Web沿原本地来源 | 渠道用户输入本来已共享MainInputs，不新增渠道调度；应将Worker接入相同持久选择器，而不是只改输出路由 |
| `web-history.ts::accept`、`recursive-main-inputs.ts::accept` | BEGIN IMMEDIATE事务中核requestId/thread/hash（含可信source）、插入原历史、user_input及receipt；成功commit后scheduleInputs | 统一默认次序取服务已提交agent_messages.seq，不按发送设备时间或渠道轮询先后猜测；接收幂等与渠道origin校验必须保留 |
| `recursive-main-inputs.ts::candidate/dispatchSnapshot/claim` | 只选择 user_input；优先级 DESC，再 queueOrder 或 seq；准备中队首不被跳过；claim 事务含 revision CAS、history/request/media 生命周期 | 现有事务和排序能力可扩展，但不能原封不动套 Worker |
| `::dispatchPage/move` | 80条正文分页；orderVersion/readEpoch/游标；只允许普通 pending 用户消息在连续 movable 段内移动，interaction、interrupt 和优先项分隔 | “同段”限制与本次任意业务消息交叉排序有明确合同冲突，目标应取消这一限制 |
| `service.ts::enqueue/drainMain` | 用户模型工作 priority=0，内部默认10；每个轮边界按优先级/时间排序，等待超过10秒的工作升为-1；已运行轮不被此排序抢占 | 不能简单说“内部总比用户优先”：实际有用户优先与老化插队，且不是持久队列顺序 |
| `service.ts::yieldMainInputs` | 能在已确认原生边界临时处理 priority=0 工作，原请求保留 received | 统一队列时须重核这个续接特例，不能让旧内存 priority 成为第二业务顺序 |
| `worker-progress.ts`、service Worker 事件监听 | 原生plan、完成的commentary/final和工具公开分类仅更新内存进度展示；没有入inbox或触发主Agent | 这是Worker过程展示，不等于显式发给主Agent的业务消息；不据此自动复制全部文字入队 |
| `web-history-pages.ts::dispatchQueue/projectQueue`、`web-contract.ts`、`ui/homer-message-queue.tsx` | 队列类型和投影依赖 input.requestId、user 历史行；有服务确认的顺序及未知操作核对；固定官方 Row 已有 leading/trailing/renderRow/onCancel 槽 | 需引入真实来源联合类型，不能伪造 user 消息来适配现有类型 |

因此，“自动给到主 Agent”总体已有路径，但当前是多入口、批量、部分明确静默的内部协调；与可排序用户队列和公开总结的用户目标不一致。本次是产品/调度合同改变，不将旧的允许空回复修复误报当成本次功能完成。

## 3. 哪些内容进入同一个队列

| 来源 | 入队与公开要求 | 最小边界 |
| --- | --- | --- |
| Web/微信/Telegram用户普通输入、定向回答Worker、明确改向消息 | 接收后均进入同一MainInputs服务顺序，可与Worker项交叉排序；原source、正文/引用/附件和origin保持 | 不按渠道分段、建队列或设优先级；当前原生live工具答复见控制边界 |
| 上述host结果、失败、返工、待审、监督/阻塞通知 | 原agent_message本身就是队列项，不复制影子消息；逐条领取后由主Agent核实、判断如何向用户说明 | 新的完成/失败必须向用户交代，其他事件按有无实质新进展判断；不是验收/交付承诺，旧版本仍为原版本 |
| Worker `agent_send` 发给主 Agent 的文字、求助及其他自定义业务 payload | 不按 kind 名称私设忽略白名单；全部进入业务队列，原文可读，按原 ID 处理 | 未知结构以安全文本显示，不执行 HTML 或解释为新授权 |
| WorkerInteractions 的 pending_main 问题/非直接用户授权的待协调请求 | 在原接收事务中，用稳定 interaction 身份登记一条主输入通知，引用原请求，不复制题目为用户输入 | 业务决定和真正响应仍归 WorkerInteractions；重复 open 不重复入队 |
| WorkerProgressStore中的原生commentary/final、plan和工具公开分类 | 保持原过程展示，不自动创建worker_update、不入业务队列、不因有文字便唤醒主Agent | Worker要主Agent协调的进展、阻塞、方案变化用现有agent_send；完成/失败已有准确host通知，不扫描截断展示文本提取业务 |
| token/心跳、流式delta、工具开始/结束、ACK、channel receipt | 保持原执行控制、传输或进度owner，不成为业务输入 | 明确区分发给主Agent的业务事件和执行过程，不要求主Agent解释每个底层报文 |

所有显式发给主Agent的业务输入都按序处理；是否需要新增用户说明，由主Agent结合已处理事实动态判断。新的完成/失败不能仅留卡片，实质进展、阻塞、风险或需用户决策应清楚说明；纯确认、重复事实、无新进展的内部协调可以不另发通知。代码不建立coveredReportId或报告覆盖判定子系统，不按文字相似、kind白名单或固定频率替Agent决定重要性。同一原ID/修订重投沿原幂等，不生新队列项；不同ID即使同名或同文仍分别按序领取，再由Agent判断内容。无新公开正文只能记录“本轮无公开输出”，不能据此声称已汇报；完成/失败必要说明缺失仍是验收缺口。

### 3.1 执行控制与授权回执不构成插队例外

准确 generation 的停止请求及停止确认、原生工具结果/ACK、当前主 Agent 原生提问的答案、ApprovalCard 的有限允许/拒绝，是对**已领取执行**的控制或授权回执。它们必须回到原 callback，不能排在自身尚未结束的模型轮后形成死锁；不会凭此打开一个新主 Agent业务轮，也不算后来 Worker通知已被处理。

原 `mainApprovals` 直接承接的 Worker 原生命令权限批准仍由用户对准确操作作决定；主 Agent不得用普通消息代替它。需要主 Agent理解的失败/阻塞、权限不足说明等仍单独入业务队列。若实现发现还有“控制回执会启动新的协调模型轮”的路径，应把启动部分改为入队，不能扩大控制定义掩盖越序。原 `/api/messages/interrupt` 中的停止控制可立即作用于准确旧 generation，其随附用户正文仍按普通业务尾部入队，不再 priority=1 插队。

## 4. 唯一事实源、身份和可操作范围

扩展现有 MainInputs，让它在 `agent_messages / agent_receipts` 上管理 user 与 worker 两类业务输入。保持 user 原 requestId/hash/history，不为 Worker 创建伪用户 conversation_input，也不把业务通知改成新的授权来源。

队列统一以 **messageId** 为身份，用户 requestId 是用户分支的原别名。读模型为 `origin=user|worker` 的联合类型，共有 messageId、receipt revision、source、threadId、state、位置与能力；user 分支保留 input/replyId/附件，worker 分支保留原 senderAgentId、senderRunId/epoch、taskId/taskVersion、resultId 或 interactionId、原事件身份和可读正文。Worker 标题仅用于展示；同名不同 ID 必须同时保留。

### 4.1 位置存储比较：保留现有owner，不搬迁用户rank

| 做法 | 修改与代价 | 本期判断 |
| --- | --- | --- |
| 全部迁入operations.detailsJson.mainInput | 搬迁/删除既有用户queueOrder，还增thread、claim、报告元信息；增加采用/回退窗口 | 无当前必要，不采用初稿这项重构 |
| 所有消息都写payload.queueOrder | 用户代码复用多，但Worker可提交任意同名业务字段；宿主改payload会混入原文/hash语义 | 不采用，不能信任Worker传来的rank或篡改原业务payload |
| 保留用户payload.queueOrder，Worker仅加宿主控制的operations.detailsJson.mainQueueOrder | 复用用户现有位置、原operation一对一归属和slot permutation；只给真正移动的Worker存一处位置 | **推荐最小做法**，无需全量用户rank迁移 |

MainInputs只定义一个`queueOrder(row)`读写规则：user_input读原payload.queueOrder，其余业务输入读宿主operation的mainQueueOrder；未移动均回落m.seq。两分支每条输入都只有一份可写rank，并在同一个SQL排序、move事务和claim选择器使用，不能再各自排队后合并。Worker payload里的queueOrder一律只是原业务数据，不参与调度；operation.kind/actor/response及已确认业务state不因移动改变。主thread/授权沿准确源记录解析，过程绑定沿原MainProcess和receipt，报告ID按原messageId确定，不再把所有元信息装进新mainInput容器。

没有人工移动时，全部来源按同一服务数据库已成功提交的agent_messages.seq领取；并发接收由原SQLite短写事务确定次序，回滚项不参与。Web设备时间、微信/Telegram事件时间、Worker客户端时间只可作原来源展示，不是排序依据。用户移动后以服务确认的rank为准，之后新项仍按服务seq入尾；新来的不抢占已领取轮。取消业务priority和10秒老化插队，interrupt仅保留原执行控制含义，不产生渠道优先级。

用户可移动所有尚未领取的业务输入，包括尚在准备附件的用户输入、定向答复和 Worker项。只允许编辑/取消自己原有可编辑的用户输入；Worker行不出现编辑或删除/取消回传操作，服务端同样拒绝。用户可以通过新消息表达“暂缓处理/停止工作”，由主 Agent按准确任务和权限处理；队列移除不等于停止 Worker。本期不增加删除 Worker事实或隐藏通知功能。

已有事件没有通用“原文修订”API；receipt revision 只代表队列/接收事实，不冒充原文版本。相同稳定源 ID、相同 payload 重试复用原消息；同 ID 内容变化返回冲突。确实存在 revision 的上游更新按准确 source revision 记录独立变更事实，不回写已处理历史；绝不按“最新同名任务”替换。

跨渠道不按文本去重。原事件经接收重试、网关恢复或多端查看/输出，必须保留其原canonical requestId/messageId、可信source和origin，只产生一次业务输入；输出到微信/Telegram不回灌成新的用户输入。同一requestId若改称另一source/用户/线程，现有history hash或渠道origin校验应拒绝冲突，不能冒充“同事件已成功接收两次”。用户在Web、微信、Telegram分别发送同一段文字属于不同事件，各自原ID与授权来源保留；无需新增跨渠道别名映射或内容去重索引。

## 5. 服务端真正按序领取

### 5.1 共用选择器与短事务

`dispatchSnapshot`、`candidate`、`runnableHead`、`claim`、`move` 必须使用同一业务资格及 rank 选择器。主线程归属从原可信用户接收或 task/version/sourceRequestId 获取并固定；不能依 UI 当前 thread、Worker提交的任意 thread 或 latest task 重新归属。缺来源的旧记录保留并明确“来源待核对”，不获得执行权限。

在每个确认安全的模型轮边界，仅有一个轻量唤醒工作进入原 `enqueue`；运行时重新 claim 当前持久队首，不能在唤醒时预领或保存旧队首。事务内核对当前 thread、活跃领取、state、revision、准备状态和来源/hash，成功后仅该项 pending→offered；模型 onStarted 再转 received、绑定准确 turn/process。一次仅领取一条，不再 offer100条。Worker waiting_user 或自身仍运行不占主 Agent执行锁。

Web/微信/Telegram的普通submit与业务答复继续使用现有`submitMessage → MainInputs.accept`，各自acceptance.persist仍在原接收事务中保存准确origin/receipt；Worker通知和interaction登记则直接复用同一agent_messages/receipts。四种来源提交成功后只唤醒上述同一个drain。不得新增渠道专属claim、渠道间优先选择或把渠道inbox暂存当作已进入主业务顺序；只有原服务接收事务成功后才获得业务位置。网关/渠道先收到而尚未业务接收时，保持“暂存/准备中”事实，不承诺跨传输全局发送时间顺序。

原 scheduleInputs/scheduleInternal/scheduleInteraction 只负责登记或唤醒同一 MainInputs drain；移除其独立业务 priority、10秒老化和批量 offer 的调度作用。legacy scheduleReview、需要模型生成正文的 scheduleDelivery 也必须从已排队的准确 result/terminal/review 通知触发，不保留隐藏模型入口；已有正式 delivery 仅发出持久结果的传输仍由原 owner 重试。`mainPending` 可以保留串行执行承载，不成为业务候选或优先级的事实源。

原 capability refresh 的 `yieldMainInputs` 目前会临时抽取用户工作，和本次“已领取轮锁定”冲突。本方案明确采用最小调整：停止在工具刷新等待期间主动抽取任何新业务输入，原请求完成采用、受限续接或明确结束后，统一领取下一条。原请求/generation及工具变更op保持，续接不重新冒充一次输入。实施时以已有 continuation 行为级测试确认，不改变工具安装授权或重放已完成安装；不能继续留下priority=0抽取特例。

### 5.2 顺序、分页与竞态

- 全部 pending 业务只有一个可移动范围；取消 `segmentStartRequestId` 所代表的交互/优先分段屏障。processing/uncertain 单独锁定，不是可移动范围中的暗中优先项。
- move 事务继续使用 operationId、expectedRevision、expectedOrderVersion、threadId/readEpoch；对全部 pending 执行 slot permutation，受影响项增加 receipt revision，操作快照同事务持久化。自移为明确 no-op；锚点被领取则冲突，不能挪到猜测位置。
- claim 先赢：该项锁定，旧 move 被拒且保留草稿；move 先赢：下一次 claim 服从新持久位置。移动不停止当前模型，服务确认前不宣称已生效。
- orderVersion 包含所有相关输入的 ID/rank/receipt state/revision/可移动性，正文只水合本页80条；不能全量加载正文来排序。第80条的真实 successor 和全局队首锚点由服务提供，可把第二页项移至全队首；旧游标在重排、领取、版本/epoch变化后失效并重读。
- preparing 队首阻挡后续自动领取，UI准确说明，用户可将任意后续 Worker/用户项移到它之前；准备失败用明确未执行结果关闭原项，再处理下一条。不得为吞吐静默跳过准备中项。
- 多设备以服务 CAS 为准；重启重建展示索引，持久 rank、原 ID 与操作回执不丢。未知 ACK 保留原 payload/opid，按准确新接口核对；迟到响应不得覆盖另线程、另操作或新草稿。

### 5.3 防止工具从侧门提前消费

只改调度不足：目前主 Agent的 `inbox_read` 能枚举所有未处理消息，普通用户轮还注入 Worker待答摘要。主 Agent协调轮的 inbox_read/ack 受当前 claimed message 约束，不能读后一批就 ack。真实用户恢复轮可核对同域内已经领取、原过程已经结束的 blocked/uncertain 历史及确认原条；历史读取不重新领取或自动重跑业务，不能暴露 pending 后续条目。Worker自己的 inbox/targetRunId 合同保持。原 `pendingForMain` 发现只包括已经按序处理并升级的 pending_user，不提前注入尚未领取的 pending_main 业务原文。

respond_interaction 对尚未处理的 pending_main 必须匹配当前领取通知；已经按序领取但因模型失败而blocked的原问题，可以由后续明确用户恢复输入引用原处理事实后继续协调，不能把尚排在后面的新问题冒充恢复。已升级 pending_user 则允许真实用户输入按原流程答复，校验原 interaction/run/epoch 与用户上下文。工具可以按需 inspect 当前任务真实状态，但读取最新状态不等于领取/ack 后续消息，汇报不能声称后面的队列项已经处理。旧任务状态、完成通知和已经正式交付的事实不得从未来消息反推。

## 6. 主 Agent公开汇报与等待释放

主Agent收到按序领取的业务输入后，动态决定是否需要新增用户说明。实施采用更小做法：公开正文直接复用原 MainProcess.messageId 和已存在的助手历史记录，不新建 `coord-report` 记录或报告实体；稳定身份独立于原用户 replyId 和正式 deliveries，渠道重试沿原身份。无正文不将原处理过程宣称为报告。MainProcess继续记录准确来源、turn及不可变Worker事件，模型最终公开正文经本轮完成后写入主对话历史。不伪造用户generation，不把Worker所有native commentary/final公开，也不再让已有sourceKind=worker隐藏规则吞掉主Agent已选择发布的正文。

报告表达内容由Agent组织：本次做了什么、哪些结论可靠、哪些没验证或被阻塞、接下来准备怎么处理、是否需要用户决定。不是每条必填的固定模板，不由代码自动摘要Worker原文或计算报告覆盖。可以结合此前已处理事实，但不能提前合并未领取通知。“已收到结果，证据尚不足，已请求补充”是合法处理，不得写成“已验收通过”。本轮Agent已用原publish_delivery正式交付并清楚说明时，无需再生成重复报告；保留原delivery身份及实际输出事实，不增加报告覆盖状态。

Worker提问轮 inspect 后可直接答复，也可 escalate、自然语言向用户询问然后**结束主轮**。结束本轮表示已协调/已询问，不等待 Worker完成或用户答复；下一项可以领取。用户答复是普通可排序业务输入，主 Agent再检查活性、整理并 respond 原 Worker；不自动广播，不重建 Worker冒充续接。纯 `agent_send` 求助由原 replyTo/targetRunId 和原 agent_send答复；决定持久接收不等于 Worker实际读到。

原scheduleInteraction在模型没作决定时自动deny的兜底不适合拿来收尾排队业务问题。本方案改为明确“协调未完成”、保留原仍有效问题及已发生决定；不为让队列前进自动拒绝Worker业务提问，也不自动反复唤醒。真正失去callback或原Run失效仍按原owner过期。用户后续要求继续时走上面的准确恢复边界，不把故障问题重建为另一任务。

提示与验收合同明确要求主Agent对新的完成/失败作有意义说明，并按实质进展、阻塞、风险、需决策情况决定其他报告；不能仅卡片静默结束。对已有信息足以答复的Worker小问题，主Agent可直接解决，再判断是否有值得通知用户的新情况，不硬性要求每问必报。纯确认或无新进展可以无公开正文，不制造通知噪声；代码不按消息kind或相似文本替Agent作这项判断。

保留`allowEmptyReply`对原生已送达控制回执及合理无公开输出轮的支持，不全局取消，也不以空正文推导“已汇报”。代码只保存实际输入、业务ack/工具操作、原生终态与公开输出是否真实存在；不会为缺失模型说明合成成功summary。验收中新的完成/失败只留卡无主Agent说明仍不合格；模型忘记说明不能凭turn completed宣布需求已满足。语义质量是Agent职责，确定性代码检查和假引擎测试不能证明真实模型始终判断正确，不能为此另造报告覆盖/重要性判定系统。实际模型失败则按第7节保留原回传、已执行操作及失败事实，不无限自动重试。

## 7. 客观状态与失败恢复

不建一套平行状态机；复用receipt、operations幂等快照、MainProcess已有sourceMessageIds/turn/status、conversation_messages、WorkerInteractions和渠道outbox。除Worker移动位置外不集中复制这些事实进新mainInput元信息；公开消息ID可直接由原输入ID确定。明确以下事实不等价：

| 用户可理解的事实 | 确认证据 | 不代表什么 |
| --- | --- | --- |
| 已接收/已入队 | 原源记录与pending receipt同事务存在；各渠道origin/receipt也原子接收；interaction通知原子登记或幂等补齐 | 不代表模型看过；渠道暂存未提交服务不算业务入队 |
| 已领取 | MainInputs CAS pending→offered，准确 revision/claim关联 | 不代表 native turn已经开始 |
| 已送交模型 | onStarted绑定 received、turn/process | 不代表处理成功 |
| 已处理业务 | 精确 inbox_ack操作或该输入处理结果；实际工具操作查各自 opid | 不代表已公开汇报、Worker收到或任务验收 |
| 已公开汇报 | 原过程messageId对应实际主Agent历史正文，或原正式delivery正文已提交；无正文只记无公开输出 | Web已可读不等于微信送达或用户已读，卡片/ack不代表汇报 |
| 已答复 Worker | 原 interaction决策 + deliveredAt，或 agent_send原消息接收事实 | 决策已记录不等于执行成功 |

主Agent inbox_ack可以先于最终正文返回，因此**不能只看receipt已processed就领取下一条**。更小做法是保留原ack幂等操作及processed/rejected返回，不增加recorded/deferred协议。原enqueue本来串行等待该轮结束；MainInputs活跃领取检查还必须包含本授权域已有MainProcess的working/unknown事实，不能只检查尚为offered/received的receipt。onStarted原事务已同时保存sourceMessageIds与真实turn，ack不会删除它们。原生终态确认后，实际报告（若有）与过程收尾在同一短事务保存，才释放下一次领取；原native未知继续锁定并核对。复用原过程owner，不建第二执行锁表或调度器。

若模型有正文却没有ack，保留正文但原receipt结束为blocked，不算业务已处理；不靠全表finally更新其他项。blocked是非自动调度的可读事实，不计pending总数、不成为移动屏障，后续明确输入可让Agent重新核对。若业务ack/答复已提交而模型失败，保留这些真实操作和过程失败记录，不能重放业务来补说明。若本轮合法选择无公开正文，也不造空报告或“已汇报”状态。必须覆盖ack之后、报告/过程收尾之前崩溃窗口。

| 故障窗口 | 恢复要求 |
| --- | --- |
| 接收或排序 ACK丢失 | 查同ID/hash/opid；缺回执不是失败证据，不新建消息或新排序操作重放 |
| offered 后尚未发起 native | 有确证未启动才允许安全恢复原领取；不能因没有 onStarted 就假定请求没到 native |
| native接受/结束未知、late响应 | 保持 uncertain 与原领取身份；先核对/关闭准确引擎，未确认安全前暂停新模型轮；迟到终态只影响原 process |
| 已确认模型失败 | 保存原回传、已发生业务及明确失败说明，结束该轮后可处理下一项；不自动重跑业务、派工或回答 |
| ack/答复Worker已提交，但模型失败未产出正文 | 原receipt即使processed，仍沿原process核失败/未知；保留原业务op/decision及送达事实，公开准确宿主失败说明，不能称为Agent总结；后续整理须核原op，不二次答复。正常纯确认无正文不伪装为失败 |
| 模型正文已得到、报告提交事务失败 | 不重跑模型/业务；能从准确已保存终态正文恢复时，仅幂等补写同reportId；正文不可恢复则说明未确认，不猜总结 |
| 报告已落历史、渠道ACK未知 | 同reportId仅重放输出到原outbox，渠道仍沿原unknown处理；不再领取原业务项或自动再答Worker |
| 重启失去live interaction callback | 原WorkerInteractions.reconcile保守expired；待处理通知仍按序说明失效，不能复活callback、改送新Run或绕过终态/预算 |

`blocked` 表示当前处理没有完成进展，并非可反复自唤醒的 pending。正常问用户等待以原 pending_user/等待记录承接，释放执行轮；模型真正失败的原输入以已有failed/uncertain事实显示。新的外部事实或明确用户续接可产生新队列输入，旧消息留档，不建二次待办系统。

## 8. Web、原生工具与渠道合同

### 8.1 官方 MessageQueue 的最小扩展

沿固定官方MessageQueue/MessageQueueRow单层列表与leading/trailing/renderRow槽，保留字号、宽度、编号、手柄和展开正文。简短来源区分“你 · Web/微信/Telegram”与“Worker · 标题 · 结果/提问/更新”，保持后端原source与ID，不改历史为Web用户输入；标题不充身份。用户行沿原授权可编辑/取消，Worker仅移动/读取。官方onCancel本来可选，不为隐藏取消复制组件。微信/Telegram仍用原消息输入，跨渠道所有pending的统一排序在Web完成，不增加渠道内拖动UI。

移除 DnD同段 group与跨段拒绝，所有pending共用可移动范围；保留44px、文本选取与触屏滚动、键盘排序和中文结果播报。当前 maintree实现可见手柄，但未找到 docs所述更多菜单的实际渲染，不能把旧文档当验收证据；本任务需在原 trailing槽提供上移/下移/移到队首以保证手机、键盘和跨页真实可操作。来源原文展开使用安全文本，不新增历史卡按钮或活动详情入口，不改不可变Worker历史卡和正式交付身份。

### 8.2 最小公共合同扩展：原接口内显式协商来源

现DispatchQueuePage强制user/input.requestId，Worker没有这些事实；因此完全不改DTO不能满足需求。但这不要求所有API改成v2，也不要求迁移原用户requestId、编辑、取消和receipt。

| 做法 | 修改/风险 | 本期选择 |
| --- | --- | --- |
| 不协商便向旧dispatch-v1页追加Worker | 老客户端直接访问input/user可能崩溃；伪造这些字段又损坏来源语义 | 不采用 |
| 整套dispatch-v2、queueProtocol=2、替换全部操作 | 可明确版本，但扩大用户API、旧操作核对和网关采用范围 | 初稿方案，现撤回，当前没有这项全量替换的必要 |
| 原endpoint/方法增加显式全来源能力与身份联合分支 | 只新增必须的Worker读模型和move/receipt身份，保留原用户分支/返回快照 | **推荐**，同一个MainInputs与原操作owner |

建议在原`features.queueDispatch=1`之外增加`features.queueSources=1`。新页请求仍是`/api/history/queue`、`view=dispatch-v1`，但显式传`sources=all`，返回同样标记的全来源页，items为origin联合类型。这个opt-in是必需合同，不能在未协商的旧页结构里偷塞Worker：

- 全来源页统一messageId、global position、movable/editable/cancellable、before/next messageId、orderVersion/readEpoch和80条cursor；user分支保留旧input/user字段，worker分支用准确源事实。全页、candidate和claim共享第4节queueOrder，不另写排序器。
- 原`/api/messages/move`支持两个明确身份形状：旧requestId/beforeRequestId保持，新增messageId/beforeMessageId用于所有来源。两者互斥，仍必传operationId、expectedRevision/OrderVersion、threadId/readEpoch；不得把messageId塞进requestId假装用户。新分支scope为messageId，旧scope为requestId；原kind=user_queue_change和幂等事务继续复用。null仍表示全pending队尾，队首锚点由服务提供。
- 原`/api/history/receipts`的operations条目增加messageId/opid联合分支，原requestIds数组与requestId/opid保留；Worker不进入acceptedRequestIds。原用户接收/edit/cancel/已确认response一字不改，旧unknown操作可准确核对。只根据传入身份形状查对应原scope，不用猜测回退。
- 统一功能激活后，未协商sources=all的旧dispatch页/尚未提交的旧排序操作明确返回需刷新状态，不让旧页面把用户子集当全部顺序；原用户接收/edit/cancel/receipt继续可用。旧move的已提交opid须先核原缓存并返回原response，不能因客户端旧而破坏重试幂等；未确认且尚无提交证据时不换payload重试。新客户端连旧服务按queueSources缺失明确无法核对全来源并关闭排序，不静默降级为本地数组或声称已展示完整队列。
- `src/web-server.ts`当前会重建dispatchQueue输入、只转readEpoch/cursor，必须补传sources；`web-contract.ts`与`web-homer.ts`沿原方法增联合类型/校验，`dev-host.ts`、`scripts/dev.mjs`仍用原闭包转发，确认不丢新字段。源文件改变仍触发既有gateway fingerprint/升级兼容检查，不能当纯UI热替换；不为此先行改顶层协议号，真实采用时按原握手证据决定。

这是有限的opt-in合同扩展，不是零协议改动。最少充分理由是Worker缺用户身份、统一移动需要messageId、未知操作需要同身份核对；超出这三件事的用户API重构不属本期。

### 8.3 公开汇报的渠道身份

现微信 `reply` 以原requestId去重，Telegram原reply也绑定用户接收的replyId；给同一派工来源发第二个reply会被合并/拒绝。不能复用原replyId、伪造正式deliveries或仅在Web可见却宣称渠道兼容。

在 service `Message` 增加明确 coordination事件，携带原 MainProcess.messageId 与正文，不新增报告身份。桥回查原过程、唯一 sourceMessageId、准确 task/version/sourceRequestId、主线程及历史正文后接收；事件中的 requestId 不能代替真实归属校验。不取最近用户、不广播到当前绑定的其他人。微信扩展 `WechatVisibleEvent` 的coordination类型，使用现有queueText和原消息事件键，保持非reply去重模式；Telegram桥将此可靠正文映射到既有channel文本outbox事件，id为原messageId，与正式root delivery区分，不带artifact授权。现有渠道outbox仍只是传输，不是第二业务调度队列。

Web主对话是持久公开事实；渠道断开/解绑按原路由报告未确认，不恢复旧凭据、不转发到新用户。传输重试只重放报告文本，不重跑模型。原生工具目录/主thread/权限与自身记忆保持；如修改工具说明导致toolsHash变化，走原能力采用/升级校验，不伪造已采用。本任务不使用普通散文批准命令，不将报告当root正式验收。

## 9. 旧记录采用、迁移与回退

已有DDL提供无枚举CHECK的kind/state、payloadJson、operations.detailsJson/唯一幂等键、receipt revision/turn/processedBy/resultRef。第4节较小方案**无需新增持久表/列，也无需全量用户rank迁移**；Worker仅在实际移动时写mainQueueOrder。仍需做旧记录采用检查和原子补齐必要通知，不把“无DDL迁移”写成“没有采用风险”。Web active/process/temp索引是可重建投影，需补创建和更新/删除失效路径，不能留仅user_input过滤让Worker静默消失。

激活前用合成库预演并生成仅计数/身份摘要的预览；实际生产采用另经原发布授权。本修订不执行任何迁移。切换时暂停旧业务调度，按以下边界采用：

1. 保持既有user payload.queueOrder、正文/hash、request/opid和已确认移动回执。原pending Worker缺mainQueueOrder直接以seq参与同一候选；不批量改写payload。现有用户人工顺序继续有效，新合并使用同一rank/seq规则；旧priority分段取消，不能压过用户排序。这是明确行为合同改变，不是暗中兼容例外。
2. 原main收件人的pending业务消息直接采用原ID、原task/version/source和receipt，不为采用另造重复通知。仅对仍活跃且尚无队列通知的pending_main interaction，以稳定身份在短事务幂等补齐；新interaction接收与通知同事务。不能先wake模型再持久化通知。
3. 旧offered/received/uncertain保守保持unknown和锁定，先按真实引擎恢复规则核对；旧processed/rejected不重放、不追溯补发汇报。旧blocked不自动重放可能已经做过的业务，显示需核对原处理事实；用户明确继续才成为可处理的新输入。
4. 保留已完成历史卡、正式delivery、interaction决策及送达事实；必要补齐事务失败整体回滚，temp投影重建。切换成功前不运行新drain，成功后旧offerMainMessages/scheduleReview不能并行领取；无需为rank再建一套迁移标记/影子值。

来源无法确定的旧孤立消息要显示数量及只读说明，不猜当前thread/task授权；不能为让迁移通过删除回传。已结束历史无需批量重写，旧native公开进度因原来只是内存事实，不声称能恢复其全文。

回退只撤本任务源码/资源hunk。新报告、原回传、原user rank、Worker mainQueueOrder、业务op/decision和outbox不删除。旧调度器即使能读用户rank，仍会忽略Worker位置、优先用户/批量内部消息，**不能直接降级后继续自动派发**；保留能识别全来源的MainInputs或暂停派发并回到兼容版本，保留用户接收和原receipt核对。少做rank迁移降低了数据回滚风险，不等于旧调度满足新合同。发布固定SHA与已有密封输入隔离，本任务未提交内容不混入其他发布。

## 10. 实施清单与验收

这是同一任务后续阶段的具体计划，待CTO复核本修订稿后才进入实施，一般技术细节沿原用户授权无需再批准。若要缩小“同授权域所有pending可交叉排序、按序逐条”或“必要时由主Agent说明，完成/失败不能只卡片结束”，必须提出准确影响，不自行加例外。

| 顺序 | 修改owner与交付 | 红绿证据 |
| --- | --- | --- |
| 1 | 原fake engine/临时SQLite固化U1/W1/U2/W2及跨渠道混排红例，补MainInputs联合类型与单一rank选择器；保留现有user rank | 旧实现对Worker混排claim、无伪用户历史Worker和公开正文失败；不能只测UI数组 |
| 2 | `recursive-tasks.ts`消息登记/主收件人claim/ack限制、`worker-interactions.ts`原子通知；原Web/微信/Telegram接收owner与持久origin保持 | 同源幂等、原文冲突、receipt CAS、全部业务种类及身份分区；不新增native过程文字适配 |
| 3 | `service.ts`统一drain，收敛三个入口及legacy模型审阅/交付，限制主inbox提前消费；`recursive-tools.ts`按主/Worker说明当前领取边界但保留ack返回；`prompts/main.md`补必要汇报职责 | 假引擎实际输入顺序、主线程过程锁、等待释放、失败不重放及动态公开输出；无新recorded状态 |
| 4 | 原history/MainProcess输出关联、Web投影/active索引/分页，原endpoint的sources=all和messageId联合分支；`web-contract.ts`、`web-server.ts`、`web-homer.ts`、`dev-host.ts`、`scripts/dev.mjs` | 实际HTTP→网关/IPC→service移动→claim，原用户接口/receipt保持，新字段不丢；无整套v2替换 |
| 5 | `ui/homer-message-queue.tsx`、`ui/queue-operations.ts`联合身份与排序/只读操作；必要的`homer-app.tsx`编辑目标收窄；同槽补最小排序菜单；同步DESIGN/vendor差异记录 | 真实渲染列表/操作/claim一致；不用复制官方组件；旧客户端不谎报完整顺序 |
| 6 | `channels/wechat-homer.ts`、`wechat-channel.ts`、`telegram-homer-bridge.ts`原输入来源校验和共享submit回归，以及原outbox报告事件/恢复 | 同授权域跨渠道输入同序；不同来源不越权，独立报告不互吞；ACK未知不重复业务，不冒formal delivery |

受影响测试复用 `message-queue-order/web/scheduler`、`recursive-main-inputs/queue-transactions/targeted-messages`、`root-worker-notifications`、`receipt-result-recovery`、`service-interactions`、`worker-interaction-mcp`、`main-process`、`web-history-active-page`、`wechat-homer`、`telegram-homer-bridge`与原browser fixture；仅增不能由这些覆盖的跨owner断言。不要重写全部问答或队列框架。

| 必验场景 | 通过标准 |
| --- | --- |
| U1/W1/U2/W2，用户调为W2/U1/W1/U2 | dispatch页、服务claim、fake engine实际turn及公开处理顺序完全相同；各类task/run/interaction归属准确 |
| Web U1 / 微信 U2 / Worker W1 / Telegram U3交错接收 | 原真实桥接owner+合成渠道origin提交；默认按同库成功commit/seq，Web全来源页=服务claim=假引擎接收顺序，客户端/渠道时间故意乱序仍不改服务次序 |
| Web将上例调为Telegram U3 / Worker W1 / Web U1 / 微信 U2 | 所有未领取项均可移动且下一次claim服从服务确认；来源、原requestId/task/interaction、origin和授权不改变；无渠道优先级、10秒插队或微信专属UI要求 |
| 跨渠道重试/同事件输出与不同身份 | 同原canonical事件在网关/桥接重试只入一次，渠道输出不回灌；相同requestId改source/origin/线程冲突且原项不丢；不同渠道不同ID同文各自保留，不能按正文去重或跨用户认成同一事件 |
| 主线程/渠道授权分区 | 非原授权域的peer/chat/user/binding或独立thread在接收前拒绝；Web全来源读取、move及报告路由不可跨域；同名Worker和同文消息不扩授权 |
| agent_send/结果/失败/求助/阻塞及Worker过程展示 | 显式业务事件共用drain，无隐藏模型路径；WorkerProgressStore的commentary/final/plan保持展示，不自动入队；工具/ACK不冒业务项 |
| 重复ID、同ID变化、不同ID同名 | 相同投递不增项或重做；变化冲突或准确source revision新事实；不同ID保留，不按标题/文本去重 |
| move先于claim及claim先于move | 前者服从新rank，后者明确锁定冲突；无重复、丢失或部分rank提交；模拟事务中断全回滚 |
| 165+混合消息、第二页移到首位、未载入successor | 每页≤80，body不全量水合；cursor失效正确；跨页不是仅排当前数组 |
| preparing队首与准备失败 | 不自动跳过；用户可把Worker移前；失败关闭原输入且明确没执行，不吞后项 |
| 重启/多设备/旧操作receipt | 顺序和opid持久；stale epoch/version拒绝；旧receipt能核对且不被重领；未知项不擅自重试 |
| 当前轮执行时并行Worker来新通知 | 新项入尾，不抢占当前已领取轮；下一条从最新服务次序领取；无10秒老化插队 |
| 主inbox_read/ack尝试消费后项 | 主侧被限制；Worker侧准确recipient/targetRun合同不退化；普通待答摘要不泄漏未来输入 |
| Worker求助已有答案 | 主Agent回答原Worker、不转强制用户表单；有需说明的新情况可公开报告，简单已解决确认不强制通知；deliveredAt与决定分别断言 |
| Worker求助需用户、用户回答 | 升级后结束主轮，后续用户项不等Worker完成；用户答复经原队列处理再回同interaction，不重建Worker、不广播 |
| 业务ack/decision后、报告/过程收尾前崩溃 | ack原processed返回不变，但原working/unknown process仍阻止新模型；原op保持一次，报告未知/失败可见；恢复仅补实际正文或明确新输入，不二次答Worker |
| 模型失败、native ACK未知、late响应 | 已确认失败释放轮；未确认原生执行先封锁新模型直到安全；原回传不丢、操作不重放、迟到不污染新轮 |
| 新完成/失败、纯确认、无新进展、正式交付 | 合成新完成/失败必须出现主Agent有意义正文，旧隐藏路径应失败；正常纯确认可无新增公开消息，空正文不记已汇报，不增覆盖判定状态；Worker卡不冒验收，进展报告不生成formal delivery |
| Web/微信/Telegram报告 | 同一个reportId出现在原历史/正确渠道outbox；重启或投递未知不新生报告，不发送至新绑定用户，不重复正式交付 |
| 新旧客户端/网关及两种位置存储 | 未协商不误报用户子集为全队列；sources=all与新messageId分支保真，旧requestId/opid可核对；旧user rank未迁移、Worker业务payload未改，混合slot事务仍一致 |
| 隔离浏览器320/390/1440px | 实际合成宿主+UI；混排来源/原文可读、Worker无edit/cancel、44px操作与键盘/触屏排序可达、无横向溢出、草稿/焦点/IME/未知ACK不丢 |

后续只运行已审计为合成的focused测试；先红例再实现，再同组绿例与相关类型检查；共享协议扩大后再跑相关渠道/问答/历史回归。浏览器用独立profile、scratch runtime、随机localhost端口和禁外网夹具，截图/日志仅放 `.codex/scratch/worker-return-main-queue-20261023/`。不启动日常runtime，不读真实生产库或调用模型。技术测试能验证身份/顺序/正文存在和提示合同，不能证明真实模型总结永远有质量；真实模型效果验证需以后明确隔离授权，不能虚报本阶段已验证。

## 11. 审阅重点、风险和待确认边界

用户这次澄清已经确定产品目标，不再要求用户重选“跨渠道统一、线性逐条、必要时由主Agent说明、Worker先问主Agent”。本稿无新增必须交用户选择的产品问题；CTO本次只复核技术边界，**复核前不实施**：

1. **同一授权域及两种接收事实。** 共享服务提交顺序，保留暂存与业务入队区别、各渠道原origin；不同用户/线程不混排，不以设备时间补排序，不增跨渠道内容去重/身份映射。
2. **过程展示与业务通知。** 全部显式主Agent业务消息按序；过程commentary/final不自动复制。报告由Agent按新事实动态判断，完成/失败不能卡片静默结束；纯确认不制造噪声，不增报告覆盖子系统。
3. **最少必要合同变更。** 保留user rank和ack返回，Worker只加一处宿主位置；原接口opt-in全来源与messageId分支，实际过程锁防ack早于轮结束。若合成红例证明该复用不能保证原子性/幂等，应提出准确失败路径和最小替代，不能先恢复全量metadata/v2重构。
4. **原生live答复/停止。** 仅解除准确当前执行的控制/授权回调；不启动旁路业务轮。Worker业务通知不借此插队。独立问答组件与原审批权限不重做。

主要风险为共享MainInputs联合类型、legacy隐藏模型入口、ack后崩溃、网关采用和渠道报告去重；都有准确owner及合成验收。首期不做过程流自动消息化、拖动后自动中断、批量模型消费、通用优先级、Worker事实编辑/删除、失效回调重放、自动summary或固定返工/验收流程，也不修改其他任务发布候选。

本阶段仅更新同一方案。已做源码/文档静态复读；实现、红绿测试、浏览器、真实模型、数据采用、生产与效果评估均未完成。下一步是CTO复核修订稿；其后才沿同一任务实施，不新建任务绕过原4h预算或终态限制。

## 附录：关键前像指纹

以下SHA-256为2026-10-23 14:21:35北京时间实际工作区文件，仅用于后续识别并行变化，不是可发布清单或覆盖授权。

| 文件 | SHA-256 |
| --- | --- |
| `src/recursive-main-inputs.ts` | `d2aaa2161fb72550ce072a2b189a822843f9a5c001b1210d0ea321880a7ae2d0` |
| `src/recursive-tasks.ts` | `d36977b6f0221205e591c28241509be19bd6c37fc7f06e45b7fe27e8f9f16881` |
| `src/recursive-tools.ts` | `0fb56706007dd4c02e3d0583e695e53982889448a2ba1d8dce993b6dd7799056` |
| `src/service.ts` | `d5488e63731ba9cf45de0c7e53f48d2b6402e21b24da63eadd64d7cdf54c119f` |
| `src/worker-interactions.ts` | `d06d97b7895a3b99809540f05846642c9ff68a2fbf7b5b47fafa90364abb7850` |
| `src/main-native-approvals.ts` | `fdb11778c8f6da06cf2889343400c542cb0862dd07d417147e40e63797749d10` |
| `src/main-process.ts` | `1214e412d2c55e465d3e9eae082ff2a68da6add2b7257b2ce36ac69b9a167c88` |
| `src/conversation-projection.ts` | `390610ea08047883f37d8c7bd55ea1e7eb41f9bdd73faf9caf48c5c7fc4ebb55` |
| `src/web-history-pages.ts` | `0854a2c057fb32bcbeb5b87ca48911908bffc4b6f54d4d40039aca23ce40c921` |
| `src/web-contract.ts` | `63426a346f2cd04b5b2e39eaefef56790bb325bd27d90393f79274e5939dc961` |
| `src/web-homer.ts` | `7f0b01d54285250c0091e01217d69cf312a4d43b732b4a28e5d7ea4aa3ea65a0` |
| `src/web-server.ts` | `c18b6d9373bb86b5d53a68e310c9da1491e62643c68f684dcbb7867021ff8a4f` |
| `src/worker-progress.ts` | `bda58e6505f70c5ab1e037d3105dd8e73bd3b4a90438880bdb1739bd7b0af71f` |
| `ui/homer-message-queue.tsx` | `860c5df49f529501f5a97be4d1ad7be8bb8f5703be1cb355f3b35ac5243be038` |
| `ui/queue-operations.ts` | `2b5964e040dedab43db4c045f02af8ffa639b930c869d74074afb2a7cc2db6f6` |
| `ui/homer-app.tsx` | `0a06297520daf38cb51181479d427eb3f97aa5a7fd5650e9f884bb6e36385bc5` |
| `ui/DESIGN.md` | `80d42ccce9d2e2d461f2ae6805613f3c4f58643b0d4b6f317ba30cf0399e3f65` |
| `prompts/main.md` | `6c5f895a88c8fa379cc063ef1fa7ef4a3f4359ec1ef6b682142827e737d3cd8a` |

交付复读时 `ui/homer-app.tsx` 已被并行工作更新，SHA-256变为 `3b36cfd48a33332bc6191b53e45ad8b2456757cba2cc8a578a6a3e4fdd8c407c`。已重读Composer排队编辑/问答互斥、队列接入与操作关联，方案仍以原MessageQueue owner为边界；本文没有改动该文件。其余表列关键源码在复读时与上表一致。链接与文档空白检查完成；未执行产品测试，不以静态检查代替行为验证。

### 本次修订的复读证据

2026-10-23 14:43:43北京时间静态复读：MainInputs、RecursiveTasks、service、WorkerInteractions、MainProcess、Web contract/server/bridge、DESIGN及MessageQueue关键前像仍与上表一致。新增明确核对的`web-history.ts::accept`包含source/thread/hash与BEGIN IMMEDIATE；微信submit的origin/附件验证和同步persist、Telegram submit/respond的trusted route及persistAcceptance、Web submit/respond调用同一app.submitMessage，均已按实际源码核对。没有读取日常渠道数据或真实用户消息。

| 本次补充绑定文件 | SHA-256 |
| --- | --- |
| `src/web-history.ts` | `70f476cd08b4648d32e9757e890a25679ed42b74d9196939e3be223e73893362` |
| `src/channels/wechat-homer.ts` | `a2f67bdf36b9d82d212737535497abf48c82cd09befefeed88306b8ee3402dc0` |
| `src/channels/telegram-homer-bridge.ts` | `1f1c68dbe832305a4e28afee4cc37e39afed24080535be0fa847eb5a160a8165` |

本轮写入范围仅本文件；未修改产品、测试、配置、脚本或其他任务文档，未构建、运行测试、实际迁移、调用模型/业务、操作Git元数据或发布。已检查本地链接、表格结构及尾部空白，并复查旧初稿的强制流文字入队、逐条必报、全量rank搬迁和v2替换均只作为撤回方案说明，不再作为实施要求。
