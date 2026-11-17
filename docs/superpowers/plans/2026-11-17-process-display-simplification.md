# Homer 过程展示与副本精简方案

> 状态：用户已批准实施和提交 main，源码及定向验收完成；提交以 Git 记录为准，未安装或部署。

**目标：**不再展示实时工作进展和工具详情，停止仅为它们留存的副本，同时保全事项名称、消息、Homer 操作、Worker 反馈与审批等现有业务功能。

**做法：**沿用现有过程节点、消息、操作和回执。去掉展示消费者及正文采集，保留原控制与协作字段；Worker 的纯展示内存缓存可以移除。不新增表、缓存、开关、事件总线、归档层或第二套历史。

第 1 节确定范围，第 2 节给出依赖依据，第 3—4 节确定代码改法，第 5—6 节说明影响和验证；实施时不另造规格文档。

## 1. 授权、范围与结论

用户同意不展示当前工作状态和工具详情，允许精简为此保留的副本；要求气泡上方事项名称、Homer 操作、处理 Worker 反馈审批等功能不受影响，其他功能影响降至最低，超出范围的影响事先说明。用户随后明确批准按此方案实施，范围与未授权影响保持本节约束。

可以做到：停止新增 Main 的工具参数／结果展示副本，移除 Worker 的近期展示缓存，不改变业务执行、公开消息和授权协议。**不能把“取消展示”直接实现为删除整个过程节点或所有工具事件。**现有节点兼有正式答复、标题关联、输入消费和未确认操作状态；保留它们比另造替代实体更简单。

### 实施边界

- 实施已批准的源码／测试／文档变更，不改历史数据或产品配置，不运行真实模型。
- 取消的是进度／工具展示，不是任务管理、消息、审批和服务可用性提示。
- 气泡事项名称和已绑定的事项关系保持；不以文字、时间或当前最新任务猜测归属。
- 保留 Worker 原始公开反馈、用户原始授权、回执、未知执行与停止确认语义。
- 不新增持久实体、配置或兼容缓存；不为本次需求重构协作架构。
- 保护共享工作区并行改动；用户本轮已授权精确提交 main；不推送或部署。

### 界面范围

| 界面内容 | 本方案处理 | 原因 |
| --- | --- | --- |
| Main“当前对话／当前事项 · 读取文件／运行命令／压缩”等动态过程、过程耗时、展开的工具步骤／参数／结果 | 不再显示，包括失败轮中的工具详情 | 用户已同意取消的展示 |
| Main 非 final 的 commentary 在过程展开区的进展展示 | 随过程区停止展示；原公开文字先保留存储 | 不把隐藏进展延伸为删改公开消息历史 |
| Worker 卡内近期计划、最近输出／工具进展、后续待办快照 | 不再显示，停止专门的 progress 读取 | 属于当前进展副本；原始反馈另有持久化路径 |
| Worker“工具步骤／参数与结果／加载更早记录” | 不再显示 | 属于工具详情 |
| 任务列表、事项名称、生命周期状态、计数、筛选、目标、笔记、下一步负责人 | 保持 | 它们用于管理事项与定位待办，不等于工具进度 |
| Worker“会话原文”、其他版本与执行事实、错误／停止事实 | 保持现有入口与内容 | 删除整个“执行记录”会误删这些现有能力 |
| 正式答复、公开 Worker 反馈、附件、引用／复制、来源、时间戳 | 保持 | 是对话及交付内容 |
| 交办／收到回复／启动失败的 Worker 事件卡及其原有显示位置 | 保持；原过程内的卡片沿用原折叠，静态标为“协作记录” | 现有业务消息呈现与标题来源；不新增卡片或移到正文外另占位置 |
| 待审批／咨询卡、已答回执、失效提示、任务中的“前往原待答卡” | 保持 | 用户必须能决定、答复和定位 |
| 停止按钮、输入排队／编辑、连接恢复、服务更新或不可用提示、整条回复失败／停止／未确认提示 | 保持 | 控制与故障告知，不能跟随进度区一起隐藏 |

这里保留的“生命周期状态／执行事实”是原有任务管理信息，不显示正在调用什么工具。如果用户希望连这些信息、事件卡、会话原文也隐藏，那是额外范围，应另行说明并取得决定；本方案不预先扩大。

## 2. 调研基线与实际依赖

2026-11-17 复审，cwd 为 `/Users/wolf3c/Project/homer`，HEAD 仍为 `bf5261ac`；前一提交 `14ac5eae` 增加显式绑定回复的事项标题。工作区新增了媒体资源／移动路由等并行改动，已核对它们未改变本文的三条标题来源与展示接口可选契约；不纳入本次改动。以下结论以本轮读取的源码为准，不代表安装版验收。没有读取私人会话、runtime 数据库或调用真实模型。

以下第 2 节记录实施前依赖；第 7 节记录实际结果。

### 2.1 Main：不是只有 UI 的一张日志

- [engine.ts](../../../src/engine.ts) 的 `safeNativeProcess`／`publishNativeProcess` 将原生 ThreadItem 转为工具事件；[tool-content.ts](../../../src/tool-content.ts) 的 `nativeToolContent` 提取命令、cwd、输出、MCP 参数结果、文件 changes 等。内容有遮蔽和截断，不是原生历史完整镜像。
- [service.ts](../../../src/service.ts) 的 Main `nativeProcess` 监听器把事件交给 `processes.native`；`mainActivity` 包装宿主工具，采集参数、结果及业务 `PublicActivity`。`emitMain` 还把轻量工具名称／状态写进 `conversation_tools`。
- [main-process.ts](../../../src/main-process.ts) 在 SQLite `meta` 的 `publicMainNode:v1:*` 保存过程节点。`items` 混有工具元数据、公开文字、final_answer、Worker 事件引用；节点还有来源、回合、消费及完成信息。`finish` 不清空工具正文，成功 UI 隐藏不等于数据已删除。
- `headers` 对已结束节点做轻量投影，仍保留业务 activity、Worker 事件和 final_answer；工作中的节点则返回完整 value。只删 React 组件仍会继续采集、写库和传输正文。
- [conversation-projection.ts](../../../src/conversation-projection.ts) 依靠过程节点放置原始用户请求、正式答复、继续处理、内部协调结果，避免空占位和重复回复。[web-history-pages.ts](../../../src/web-history-pages.ts) 依靠节点索引、原始位置和 readEpoch 分页。不能把 `process` 置空或将节点从历史查询整体过滤掉。
- [message-quote.ts](../../../src/message-quote.ts) 的 `messageSourceParts` 读取原生 final_answer 条目的身份及文本；[web-history.ts](../../../src/web-history.ts) 的引用校验也读取这些节点。只保留一份拼接 `node.final` 会改变多条正式答复、引用及复制。

### 2.2 事项名称的三条链路必须全部保全

[web-homer.ts](../../../src/web-homer.ts) 的 `withTaskSources` 和 [homer-app.tsx](../../../ui/homer-app.tsx) 的 `AssistantMessage` 共同决定标题：

1. 正式 `send_user_message` 回复：`conversation_messages.taskId/taskVersion/operationKey` → task_versions／tasks → `taskSources`。`14ac5eae` 覆盖了没有过程节点的正文和附件回复，不得回退。
2. 协调 Worker 回传或通知：节点 `sourceMessageIds/sourceKind/turnIds` → agent_messages／agent_receipts／operations／runs → 经过原有作用域校验的 `taskSources`。不能按请求号关联所有同源任务。
3. 交办／收到回复事件：过程项的 `workerEvent` → [worker-card-events.ts](../../../src/worker-card-events.ts) 快照提供标题；没有对应事件的业务操作还用 `kind:'tool'` 项中的 `activity.target` 补足标题归属。`withTaskSources` 会排除已有事件覆盖的来源，避免重复。

因此必须保留 `recordWorkerDelegation`、`recordWorkerReceipt`、`workerEvent` 引用／快照、`PublicActivity`／target 和操作校验。**去掉工具正文不能顺手去掉整个 `mainActivity` 包装器或所有 `kind:'tool'` 行。**保持当前标题去重、多事项拼接、未知来源提示和无正文内部消息的呈现条件，不造新标题字段或索引。

### 2.3 Worker：纯展示内存与真实反馈分开

- `src/worker-progress.ts`（现已删除） 的 `records/executions/retained` 全是内存；包含近期计划、最近公开文本的 1600 字符副本、工具名、状态、时间和调用内容。无持久化或从原生历史重建。
- [worker-execution.ts](../../../src/worker-execution.ts) 只允许命令名、退出码、文件数及少数业务码等字段，排除 stdout、文件正文、查询、URL、任意 MCP JSON。上限为 256 次执行、每次 128 调用，正文每次 512 KiB、总计 16 MiB；不是需要删除的一套“完整工具记录”。
- service 的 `publicPlan`、`agentMessage`、`nativeProcess` 监听器和 `workerTool` 包装器向内存供数；web-homer 的 `progress/execution/call`、`progressRevision` 向 UI 供数。仓库中的消费者属于展示路径。
- `agentMessage` 同时调用 `tasks.recordWorkerOutput`；`nativeCompleted` 调用 `recordWorkerTerminal`；`saveReturn` 保存 Worker 消息和返回操作。[recursive-tasks.ts](../../../src/recursive-tasks.ts) 的 `workerRead` 从 agent_messages 读取公开原文与执行摘要，**不读 WorkerProgressStore**。Main 的 `list_work` 也直接读取任务数据，不依赖这份内存。
- `saveReturn` 优先用 final_answer 组成反馈；没有 final 时回退到公开 commentary／无 phase 的文字或 terminal.text，且保留各公开条目供 worker_read 分项读取。不能因取消“最近输出”就只接收 final 而丢掉这条回退路径。
- [task-execution-record.tsx](../../../ui/task-execution-record.tsx) 同时包含工具步骤、RunFacts、WorkerConversationRecord、其他执行版本；必须只删工具部分，保留原文的分页、长文本继续读取、刷新及作用域检查。

### 2.4 授权、恢复、控制与通知：保留的实际依赖

| 依赖 | 具体实现 | 本方案不删除的内容 |
| --- | --- | --- |
| Main 未确认工具效果 | main-process 的 `unconfirmedNativeEffectsSql`；service 的 `nativeForkAllowed`；recursive-tasks 的 `safeToUpgrade` | 原生工具身份、类别、状态、所属 thread/turn，以及节点终态证据；不需要参数结果正文 |
| Worker 未确认效果，含原生子线程 | engine 的 `nativeWorkerEffect`；[native-thread-bindings.ts](../../../src/native-thread-bindings.ts) 的 `recordWorkerEffect/hasUnconfirmedWorkerEffects` | 独立持久 effect 身份、归属和 pending／终态；不能随展示监听器删除 |
| 原生审批精确操作 | engine 的 `nativeItems`、[worker-native-requests.ts](../../../src/worker-native-requests.ts)、[main-native-approvals.ts](../../../src/main-native-approvals.ts)、[worker-interactions.ts](../../../src/worker-interactions.ts) | 原生回调、原始操作、authority、decision、deliveredAt、请求失效和回执；批准操作所需内容不是可删展示副本 |
| 插件／定时任务识别 | service 的 `hostMcpToolStarted`、pluginCallState、scheduleCalls.observe | 调用 ID 与参数指纹／观察；该事件不能因“包含参数”被停掉 |
| Main 原生回合绑定 | service 的 `nativeActivity.turnId`、`archiveApprovalScope`、`membershipTool`、原生审批校验 | 继续保留 nativeActivity 和回合观察，不以取消 UI 状态为由将其整体删除 |
| 输入与协作消费、防重放 | main-process 的 `mainProcessSourceSql/mainInputProcessingSql/coordination`；service 的 `recursiveTool`、协调交付；[recursive-main-inputs.ts](../../../src/recursive-main-inputs.ts) | sourceMessageIds、turnIds、state、final 身份及原操作回执；ACK／收到不等于完成 |
| 反馈与用户决定 | agent_messages、agent_receipts、operations、worker_interactions；web-homer 的 `withInteractionResponses` | 公开反馈、原始用户授权、待答及已答卡和单次交付；不改变 inspect/respond/escalate/ask_main |
| 通知、附件及跨渠道交付 | service 的 `notifyCommittedMessage/readCommittedMessage`、现有 message.committed Hook 与渠道路径 | 原正式消息提交、身份、附件关系及交付状态；不从被移除的进展生成替代通知 |
| 任务列表刷新 | service 的 `store.db.onChange → invalidateState`；[task-status-data.ts](../../../ui/task-status-data.ts) 的现有 state 通知／重连刷新 | 持久任务、Run、待答变化仍刷新列表；只删 progressRevision 与进度专用请求，不加新轮询或 revision |
| 限额／压缩循环控制 | engine 的 `publishExecution`；[execution-limits.ts](../../../src/execution-limits.ts) 的 `TurnExecution.evidence` | 原生执行证据及现有有界指纹；不删除原始协议输入，只停止展示副本采集 |

原生 Codex 仍通过 `thread/start/resume/fork` 管理会话，并使用独立 codexHome。不能由此断言所有工具参数结果都完整保存、永久可读或可替代 Homer 的接口；本轮没有验证私人原生会话。不增加“从 Codex 补回展示”的新读取层。

### 2.5 LLM 使用路径不变

Main 继续通过 list_work／work_inspect 读事项、原始授权和操作回执，通过 worker_read 读反馈，通过 inspect_interaction／respond_interaction／escalate_interaction 处理待答；Worker 继续 ask_main 并收到原回调结果。它们都不读取已取消的 UI 工具正文缓存。保留这些工具的名字、schema、身份、分页和返回语义；`worker_read` 所称“execution facts”是 Run／退出等事实，不是 WorkerProgressStore 工具页。

不修改提示词来要求模型补写进度、重复解释工具、重读原生日志或恢复被取消的面板；不新增“精简模式”说明或工具。审批所需的确切参数和公开文字仍沿原业务接口提供，不能把 UI 不展示误当成 LLM 无需获得这些内容。

## 3. 最简实现决策

### 3.1 Main：保留结构，移除展示正文

在原函数上直接减字段与调用，不建新服务：

```text
原生 item → 原引擎、审批、effect、限额处理（保持）
          → safeNativeProcess：仅工具身份／类别／状态／时间等元数据
          → MainProcessHistory.native：继续记录，禁止复制 content

宿主工具 → mainActivity：仍执行原 work、捕获业务 PublicActivity、记元数据
         → 原样返回结果／抛出错误；不 capture 参数／返回／异常正文

Main agentMessage → 原过程文字／final_answer 存储（保持）
正式消息／协作／审批 → 原事务、回执、消费和通知（保持）
```

具体约束：

- safeNativeProcess 去掉 `content:nativeToolContent(...)`，不能停止原始 ThreadItem 交给审批和效果观察。
- mainActivity 去掉为展示建立的 ToolContent、captureToolValue/captureToolError；保留 invoke 内 work、PublicActivity 采集、工具 start/end 和 finally 边界。保留 `context.toolActivities` 的结束／停止处理，不因名字带 activity 就删除。
- `MainProcessHistory.native/tool` 删除现有 content 赋值与新行构造字段；不加新的校验层。旧节点不做批量迁移或清空，正常生命周期更新仍可写回原记录。必要的旧 ToolContent 契约类型可保留，不为旧内容新造解析器或缓存。
- `emitMain` 停止新写纯展示用的 `history.tool`，保留 `processes.tool` 和原消息链；旧 conversation_tools 表及启动收敛逻辑先保留，避免历史清理／schema 变更。
- 旧工具正文只在现有 `MainProcessHistory.hydrate` 的工具项分支解构移除 content；headers、exact、list 已共用该函数，不在每个 Web／移动端重复清洗。hydrate 返回副本，不改 load/save 中的原对象；所有标题 activity、Worker 事件及 final_answer 原样保留。当前 exact/list 的内部消费者读取的是这些元数据和文字，不依赖工具 content。历史详情端点仍保留既有身份／epoch／作用域检查。
- 删掉 `headers` 中仅为过程头部提供的 counts 子查询及 `toolStatusCounts` 输出：当前仓库没有读取者，fork／升级检查直接查原工具状态，不查此汇总。保留原有分页 SQL 和轻量字段选择，不借机重写历史索引。
- Main commentary、final_answer、Worker 事件正文暂不做存储精简。这些是公开文字及消息呈现，不是工具输入输出副本；本次不把它们换成摘要。

### 3.2 UI：取消消费者，保全混合组件中的业务内容

- process-nodes 中把 ProcessNodeView 精简为原有 Worker 事件呈现：沿用 detailEvent 分类，原折叠内有事件时仅显示静态“协作记录”，沿用原成功收起后隐藏及焦点交接规则；没有事件则不显示折叠。直接使用项目已有 Collapsible（例如 WorkerConversationRecord 的现有用法），不用带 status／aria-busy／最新活动和 live region 的 RunActivity，也不给它伪造固定完成状态。移除动态标签、ProcessDuration、commentary／tool entries 和工具展开加载。Worker 事件已由 headers/hydrate 返回，不必为它加载全量过程。保留 ProcessMessageContent 的 children、WorkerEventCard、LegacyWorkerNotes，以及外部引用的 SemanticTaskIcon／InactiveInteractionNotes。交办卡与标题仍按原规则归类；不新增组件文件，不把原折叠内卡片搬出或静默丢掉。
- process-message 中 `projectProcessMessage` 只生成原有正式答复 parts；不生成工具 parts 或进展 entries。保持模型 final_answer 条目 ID、顺序、多条答案与宿主消息规则。移除无消费者的 ToolCallBody／工具 fallback 接线。
- homer-app 直接使用现有历史消息，不再为过程详情维护 `useProcessDetails` 和 `/api/history/process` 加载；移除仅用于动态标签的 `liveMainActivity/processActivityText`。保留标题循环及 `titledEvents` 所需业务去重、消息状态、输入停止目标、审批区、附件及失效提示。serviceActivityNotice 继续用来报告服务可用性。
- message-details 移除 LegacyToolActivities 展示；保留来源和消息操作。旧工具记录不再露出，不清库。
- 对应 web-history 的 list/byIds 删除 conversation_tools 读取与分组，既有可选 toolActivities 不再填充；表本身、旧数据与启动状态收敛保留。不是用空记录替代读取，也不删除消息来源、附件和反馈字段。
- task-status 移除 plan/output/next 及 progress 专用读取、缓存、刷新 effect；保留 useTaskStatusData、列表刷新、生命周期计数／筛选、展开身份、Pending 导航和过期连接禁用。不能直接删除混合着 navigation 的 controllers/effect。
- task-execution-record 在原文件删除 CallRow、工具页加载和调用详情，只保留 RunFacts、WorkerConversationRecord、执行版本选择；沿用现有折叠，不新增组件文件。移除 `workerExecution` 依赖，但不显示“工具尚未接入”的占位。

### 3.3 Worker：移除纯展示 store，不动公开反馈

```text
agentMessage(completed) → recordWorkerOutput（保留）→ saveReturn / worker_read
                       × workerProgress.message
publicPlan / nativeProcess × workerProgress.plan/tool/recordCall/completeCall
nativeWorkerEffect      → recordWorkerEffect（保留）
workerTool              → 原 guard、scope 校验 → workerToolWork（原样）
```

移除 service 的 WorkerProgressStore 实例、供数监听和 `readWorkerExecution/readWorkerCall`；workerTool 去掉仅用于展示的捕获／emit 包装。原 agentMessage、nativeCompleted、hostMcpToolStarted、nativeWorkerEffect 和交互交付监听保留。清除唯一消费者后删除 worker-progress 的运行时代码；worker-execution 的现有契约类型若仍被兼容接口引用则保留类型，不为了删文件另造类型或伪数据。

web-homer 停止声明 `workerExecution:1` 及可选 progress/execution/call 方法、progressRevision。WebBridge 已有可选契约，HTTP／聊天／移动端已有不可用错误路径，复用它们，不新造空缓存或假“完整历史”。dev-host 对 `taskOverview.progress` 的非空断言需改用现有不可用错误，防止旧请求变成未处理异常。scripts/dev 的旧转发保留或去掉纯死分支，以跨端测试为准，不扩大协议重构。

不可用分支只返回现有错误，不尝试恢复 store、重查原生会话、自动升级客户端或重试调用。任务 detail／原文／origin 的既有访问检查不变。兼容类型若保留，仅供现有可选桥接契约引用；不保留无消费者的 redaction／capture 运行时代码来解释旧类型。

## 4. 变更文件清单与不动范围

| 文件 | 最小变更 |
| --- | --- |
| `src/engine.ts` | 停止展示用 nativeToolContent；原协议、nativeItems、effect、execution evidence 不动 |
| `src/service.ts` | Main 去 content 捕获和重复 history.tool 写入；Worker 去展示 store／捕获／读取；保留所有业务观察与回执 |
| `src/main-process.ts` | 删除 content 写入；hydrate 一处剥离旧正文；删除无消费者的头部 counts；保留原节点／控制字段／业务 activity／公开文字 |
| `src/web-history.ts` | 停止为 list/byIds 填充纯展示 toolActivities；旧表与数据不动 |
| `src/web-homer.ts`、`src/dev-host.ts` | 移除纯展示的 Worker 能力和供数；旧可选接口返回已有不可用错误；withTaskSources／withInteractionResponses 不改语义 |
| `ui/homer-app.tsx`、`ui/process-message.tsx`、`ui/process-nodes.tsx`、`ui/message-details.tsx` | 删过程／工具展示与详情缓存，保持标题、正文、事件卡及交互 |
| `ui/task-status.tsx`、`ui/task-execution-record.tsx` | 删近期进展／工具页；保留列表、生命周期事实、原文、版本与待答导航 |
| `src/worker-progress.ts`、`src/worker-execution.ts`、`src/tool-content.ts`、`ui/process-details.ts` | 消费者移除后删除死运行时代码；必要旧契约类型保留，不以删除文件为验收目标 |
| 现有相关 tests、必要的同名 CSS | 改写退役展示断言，新增下面的业务保护断言；仅清理明确无消费者的样式 |
| `docs/architecture/main-worker-chat-architecture.md`、`docs/architecture/README.md`、`docs/testing.md` | 实施时同步正文及索引中的实际实现／验证状态；实施时仅增补本事项状态，保留其他并行改动 |

本方案不改：tasks／runs／agent_messages／agent_receipts／operations／worker_interactions 的 schema 和状态机，MainInputs，原生线程绑定／fork 门禁，插件授权，定时任务、渠道发送、提示词、模型配置、账号、安装包或发布流程。web-server/web-chat/mobile-request 的现有工具接口拒绝路径优先保留；仅在离线契约证明缺口时做所需的最小接线修正。

## 5. 行为变化、额外影响与未知

**在用户同意范围内的变化：**看不到逐步进展、工具名／参数／结果／过程耗时；失败轮也不能从过程区展开工具排障。原过程折叠若还含 Worker 业务事件，仅保留静态“协作记录”，不显示处理阶段／工具／计时；这是保全业务卡片所需的标签变化。Worker 近期计划与输出快照消失，但消息原文可读，Homer 可继续 worker_read。旧历史中的工具详情也不再显示，不等于旧记录被删除。新工具执行不再增加相应正文副本；旧数据库大小不会自动缩小，不能承诺明显节省已有磁盘空间。

**必须事先说明的兼容影响：**停止提供 Worker progress/execution/call 能力后，旧页面、旧移动客户端或外部调用者可能显示已有“不可用／尚未接入”提示，不能保证新旧 UI 同样精简。这属于退役展示接口的兼容影响，不影响任务执行，但若要求旧客户端外观也完全一致，需要同步客户端版本并专项验收；未经决定不额外增加兼容层。Main 历史详情接口不再返回工具正文，也属于明确的详情能力移除。

**不纳入本方案的额外变化：**隐藏任务列表、生命周期事实、公开 Worker 会话、事件卡、审批说明或授权操作参数；删除 commentary/final_answer、历史工具行、原始 Codex 会话；更改通知、自动重试、停止、恢复、标题归属或审批语义。实施中若发现非展示消费者需要被删除字段，暂停该字段的删除并报告，不用新增实体补洞。

**未知和验收边界：**本轮已有合成实际界面证据，仍没有安装版、真实原生审批、真实引擎断线恢复或真机证据，也没有证明外部调用者不存在。定向验收通过不能宣称零回归。Main 元数据仍写在现有混合节点中、公开文字仍保存；这是避免功能迁移的最小方案，不承诺所有副本归零。

## 6. 实施任务与分层验证

下面的测试文件是现有验证入口，不要求逐个扩写或每次全跑。新增断言集中在三处实际变化：消息呈现、取消正文／缓存、可选详情接口退役；标题、审批和恢复优先复用既有回归。对没有改动的状态机不另造测试框架、超时重试或“保险”分支，也不修改上游 UI 基础组件来满足本方案。

### Review Focus

1. 同一来源下多个事项、纯附件正式回复及无正文内部协调：标题不能丢失、重复或误归属。
2. final_answer 的流式增量、多条正式答案、旧历史和引用：隐藏过程不能隐藏正文或改变条目身份。
3. Worker 请求等待 Main／用户决定，回调失效、已答及交付未知：入口、决定和恢复不能依赖展示 store。
4. 工具结束未知、晚到终态、重启／换来源／升级：去正文仍必须挡住原先未确认效果。
5. 新旧桌面／移动客户端、列表展开和重连：保留原文、待答导航及控制；持久状态变化仍刷新任务列表，旧详情请求明确不可用，不伪造成功。

### Task 1：固定业务保护断言，精简 UI

**Files:** 上述 UI 文件；复用 `tests/taskcard-sources.test.ts`、`tests/internal-coordination-ui.test.mjs`、`tests/process-nodes-ui.test.mjs`、`tests/official-sources-history.test.ts`、`tests/message-source-selection.test.mjs`、`tests/quote-navigation-ui.test.mjs`、`tests/task-status.test.ts`、`tests/web-history-window.test.ts`。

**Interfaces:** 输入仍为 DisplayMessage／ProcessNode／OverviewTask；保留 taskSources、final_answer、workerEvent、原 TaskDetail／WorkerConversation 和待答导航，不增加 DTO。

- [ ] 先补断言：正文／附件正式回复的 `taskId/taskVersion` 标题；交办／回传／通知、多事项、错误 scope 和改名后的原规则；标题去重与事件卡不丢失。
- [ ] 补断言：所有工具状态下均无动态进展／工具入口；有业务事件时仍有静态协作折叠，无 aria-busy 或当前活动播报；无事件则无空折叠。多 final、流式正文、复制引用、附件、来源和失败／未知提示保留；旧 conversation_tools 不显示。
- [ ] 补断言：Worker 列表、任务事实、原文分页／继续读取、其他版本和 Pending 导航保留；不再发 progress/execution/call 请求。
- [ ] 原 state 通知及重连刷新案例中，仅改变持久 Run／待答状态而没有 progressRevision，计数、原文入口和待答导航仍更新；不靠工具事件维持刷新。
- [ ] 运行对应离线案例，确认新增“无进展／工具”断言在旧实现失败；业务基线断言通过，再做 3.2 节的最小 UI 修改并复验。

### Task 2：切断新增正文／缓存，保持业务协议

**Files:** 第 4 节后端文件；复用 `tests/main-process.test.ts`、`tests/main-process-summary.test.ts`、`tests/worker-progress-host.test.ts`、`tests/worker-execution-read.test.ts`、`tests/tool-call-history.test.ts`、`tests/internal-coordination-output.test.ts`、`tests/native-thread-fork-gate.test.ts`、`tests/native-thread-bindings.test.ts`、`tests/service-main-native-approvals.test.ts`、`tests/service-mcp-tool-approval.test.ts`、`tests/schedule-host.test.ts`。

**Interfaces:** MainProcessHistory 保留原节点身份／终态／业务 activity；Worker 输出仍从 recordWorkerOutput/saveReturn 到 workerRead；既有可选展示接口退役，不改业务工具 schema。

- [ ] 补一个带可识别合成命令／MCP 输入输出的用例：调用结果和异常仍原样到调用者，但新过程持久行无 content／参数输出正文；业务 activity 和最终答复保持。Main／Worker、start／terminal 均覆盖。
- [ ] 旧节点 fixture 带工具 content：普通页、活动节点页、过程详情均不返回正文；只读查询后数据库 fixture 原值不变；业务 activity、Worker 事件、分页、标题和 final_answer 保持。新增检查使用 hydrate 现有路径，不为此增加产品中的全表扫描。
- [ ] 去 Worker store 前证明：无缓存也能 recordWorkerOutput、saveReturn、worker_read，反馈消费与消息只提交一次；审批 inspect/respond/escalate、原生回调交付及过期仍正常。
- [ ] Worker 没有 final、只有公开 commentary，以及有多条公开条目两种情况仍保存原反馈／nativeMessages；work_inspect 仍返回原授权／回执。取消 UI 文本副本不能改变模型可读原文。
- [ ] 断言未知 Main／Worker effect 仍阻止 fork／升级，晚到终态仅更新原条目；插件调用指纹、定时观察与限额 evidence 未丢失。沿原接口恢复，不重放业务命令。
- [ ] 先运行上述新增断言，再按 3.1／3.3 节修改；退役展示测试改为“没有采集／能力不可用”断言，不删其中的 scope、防重放或错误处理保护。

### Task 3：跨端核对、文档和交付

**Files:** 现有 Web／移动桥相关 tests、文档与清理范围内的死代码；不新增浏览器基础设施。

- [ ] 两端类型检查：项目 Node 版本下运行 `npm run typecheck`、`npx tsc --noEmit -p ui/tsconfig.json`；先核对该配置仍是前端检查入口。类型检查不得用新增 any／无条件空返回绕过缺口。
- [ ] 定向离线命令沿项目夹具运行，例如 `node --import ./tests/fixtures/synthetic-home.mjs --import ./tests/fixtures/core-system-proxy.mjs --import tsx --test --test-concurrency=1 tests/taskcard-sources.test.ts tests/main-process.test.ts tests/internal-coordination-output.test.ts tests/native-thread-fork-gate.test.ts`；其他上述 .ts/.mjs 按对应现有 loader／命令选择，不默认执行全量或真实引擎专项。
- [ ] 在独立合成目录运行现有浏览器夹具，对桌面宽屏和 390px 窄屏核对：无实时进展／工具详情，事项标题、正文附件、审批咨询与完成回执、Worker 原文入口、列表及停止控件仍可用。记录实际点击及原尺寸截图；浏览器须正常退出且 watchdog:false，不能仅凭截图判通过。
- [ ] HTTP 与移动聊天操作各验证一次：tasks.list/detail/origin、历史分页／定位、待答卡正常；退役的 progress/execution/call 返回原不可用错误，不暴露缓存或产生假历史。离线验证 UI 请求不再访问这些接口；旧客户端兼容影响按第 5 节记录。
- [ ] 当前授权不含真实引擎／原生审批／安装验收；若后续明确选择专项，仅用隔离账号目录／CODEX_HOME，定向验证一次原线程续办、授权卡和中断恢复；不重放未知操作。未运行项保持未验证，不把合成通过写成安装版零影响。
- [ ] 实施后才更新架构正文／索引及测试说明中的实际状态。按 work-cleanup 清理本任务独占临时 fixture、构建和浏览器资料，保留仍待验的具体材料并标明条件；不清并行 outputs 或日常数据。

## 7. 实施结果与边界

用户批准后已在共享 main 工作树实施；本轮另获准复审、精确提交 main 并清理本事项资源，不推送、安装或部署。新 Main 工具事件和宿主包装器不再采集参数／结果正文；hydrate 一处移除旧返回正文；Worker 展示 store 与 UI 详情缓存退役。标题、公开文字、协作卡、任务事实、原文入口、审批、效果／消费／回执路径保留。没有 schema、配置、模型工具或提示词变更，没有新产品实体。

两条新增无正文／无进度入口断言先在旧实现失败，再在实现后通过。最终 318 项定向离线全部通过，无跳过；完整后端／测试类型检查、前端类型检查及独立 Vite 构建通过。1080／390px 合成实际页面均通过标题、正文、事件折叠、焦点、Worker 原文、审批拒绝及无进度／工具详情请求核对；无页面／控制台错误，Chrome exit 0、forced=false、watchdog=false。静态独立复审发现的焦点交接、空容器留白和 fixture 断引用已修复，复核无剩余阻断。

历史补跑另有旧链接过滤断言失败，在任务前源码／原断言的独立对照中同样失败，未修改链接功能来消除它。没有运行全量、真实模型、真实原生审批、安装或真机验收；不声称零风险。命令、范围、证据和清理条件见[测试说明](../../testing.md#过程展示与副本精简2026-11-17)。

提交前独立复审补充：已修复 `history.page.revision` 造成 Worker 详情重复读取；只以现有 Task／Run 生命周期字段触发读取，新增回归从11次请求降为无关更新仍1次、Run变化后2次。最新 `787afc68` 上仅含本事项的精确候选通过307项定向离线、两端类型、独立构建和1080／390px实际合成页面；不将此前共享树318项当作精确候选证据。沙箱进程身份查询限制下的失败获准在沙箱外原样复跑通过，未修改锁实现或断言。旧纯展示辅助函数的进一步清扫不作为本轮阻断，不扩大到原生回合观察或其他协议。
