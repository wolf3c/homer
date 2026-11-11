> 本文为 2026-10-25 的历史协作方案；旧任务合同和派工接口已被[主 Agent 与 Worker 会话架构](architecture/main-worker-chat-architecture.md)替代，以下实施与验收状态仅对应当时版本。

# Homer 主 Agent、一级 Worker 与原生协作

更新：2026-10-25。维护源码按已批准方案完成收敛；未提交、未安装、未发布。合成协议、业务与浏览器验证见[验收记录](15-recursive-agent-validation.md)。真实原生 smoke 被隔离认证失败阻塞，不能据此宣称原生子 Agent 已在本轮贯穿成功。

## 职责与归属

Homer 管主 Agent 与一级业务 Worker。主可按实际任务动态创建多个同级 Worker，验收候选成果并决定正式交付；Worker 负责自身目标，按需使用固定 Codex 0.163.0 的原生子 Agent 完成内部拆分、通信、等待与整合。内部拆分方式、人数与顺序由 Agent 决定。

需要独立新业务时，父 Worker 通过原 `agent_send` 或 `ask_main` 报主判断。没有 promotion 队列、native child registry、业务镜像 Task/Run/Result、调度器或原生协作 UI 树。父 final 只表示父报告的结果，不证明每个原生子 Agent 成功。

保留两个现有业务入口：`dispatch_work` / `legacyDispatch` 建立主直接管理的独立 Worker 根；`task_delegate` 建主聚合根或在主聚合根下建直属 Worker。非空 parent 必须是 main 执行的根，执行者必须是 worker。Worker 无法创建或管理业务下级，领域层在写 operation 前拒绝，工具调用层与 Worker MCP 目录使用同一角色 allowlist。

同级 Worker 的已有通信和能力管理仍可用，保持原授权、来源、协作范围、epoch/revision、路径/hash、CAS 与幂等规则。未把 capabilities 改成只读，未禁 peer 通信，未改主五工具指纹兼容或强建主 thread。

## 数据合同

- Task 是独立业务契约，Run 是其一次执行尝试；版本、targetVersion、明确 adopt、恢复/停止事实仍归原 owner。
- `parentTaskId` 可空或指向 main 根；`rootTaskId`、`parentVersion` 与 `coordinatorAgentId` 继续供业务分组与直属验收使用，coordinator 只允许 main。
- `child_resolutions` 记录主聚合对直属 Worker 的准确结果版本采用、缺口、停止或交回主处理。它不存原生子 Agent。
- `task_dependencies` 保留同级依赖与环检测；`run_waits` 保留等待主答、消息或明确业务结果版本。原生内部协作不登记这些等待。
- `operations`、`agent_messages`、`agent_receipts`、pending 主队列、TaskVersion、results 与 deliveries 保留原语义。通知来自父业务 Worker，主仍按原 CAS 单次领取。
- 删除无消费者的 `Authority.parent`、Task `createdByRunId` 与 Worker checkpoint.children；业务祖先、后代闭包和多级文件采用链改为根与直属范围。

新空库直接创建最终 schema。删除旧递归数据映射及其专属升级路径，不增加树转换、历史枚举或自动清理。已有同版本 schema 若仍含业务多层或 Worker coordinator，在 pending/recovery 写入之前以 `task_business_layer_unsupported` 拒绝，保留原事实。仅版本号一致不能作为可部署证据。本轮没有重建生产表、迁移真实数据库或处理中途业务。运行现有数据前仍须独立核对部署与数据处置授权；源码完成不是安装许可。

## 原生审批 owner

审批仍来自真实 AppServer 连接。`WorkerNativeRequests.entries` 将一次请求绑定到当前父 segment，业务 owner 为 WorkerSlot、Run epoch 与原父执行段；请求自身的真实 thread/turn/item/requestId 保留，用于原协议关联。

合法 Worker callback 可在 executing/rpc_wait 接收。旧 epoch、segment 或 closing fence 失效后不能释放决定；普通动态工具继续严格校验父 thread/turn 与 executing，不为子 Agent 放宽。原生子 Agent 继承父 MCP endpoint 只能在父授权范围内使用原通用工具，不能创建业务 Worker、正式发布或响应真实用户审批。

`serverRequest/resolved` 在父 thread 过滤前送到已有 entry，先记送达后结束回调活性。子 turn 结束只失效对应请求，父段结束失效整段请求。文件/命令审批复用原 nativeItems 缓存，以真实 thread/turn/item 精确关联，避免并发同名 item 串内容。main profile 仍严格相等。

等待状态由现有 entries 的未送答请求与 `WorkerInteractions.hasPending` 派生，不另建计数或协作状态。首项进入 rpc_wait，最后一项结束才恢复执行。审批须由用户对准确操作作出决定，原 requestId 只回送一次，拒绝不重试；普通问题仍回父协调或原 ask_main 通道。

## 结果、文件与生命周期

父自主原生等待、整合后 final。宿主沿原 `recordWorkerTerminal` 保存父 terminal 和 fence，再关闭 Worker 连接。关闭先 `stdin.end()`，让固定引擎排空和 `shutdown_threads`；上游 Unix watchdog 为 45 秒，宿主给 46 秒有界窗口，超时才对自身进程组用原 TERM/stopGrace/KILL 兜底。继续消费 stdout 与 exit，确认退出才释放 lease。

yield/park 保留引擎，interrupt ACK 不等于退出；退出未知仍保留 lease/recovery，不标成功、不盲重试。main 引擎关闭路径保持原合同。

父的一份候选正文与已暂存文件组通过现有上行通道送主，回传不代表验收或正式交付。材料读取、文件原字节/hash、精确采用版本与显式发布继续校验；只有根或直属 Worker 被纳入的准确已验收文件可获得正式下载许可。

## 界面与配置

工作状态按主业务根分组，只显示直属 Worker，独立 Worker 根仍按原合并行显示；删除子 Worker 展开、深层计数与“含子 Worker”文案。保留现有 TaskCard/Collapsible、响应式摘要/Popover、缓存/分页、精确执行身份、原待答定位、文件与外置 Worker 事件卡。详见 [UI 合同](../ui/DESIGN.md)。

保持原专属 native home、目录、能力管理与权限 profile；不新建 child account/context/cwd 平台。Worker V2 已开启、main 关闭，固定模型 `gpt-6.1-sol / high / Fast`，本次不升级引擎或改变模型策略。usage 继续采用现有原生后台汇总，不镜像子树计费。
