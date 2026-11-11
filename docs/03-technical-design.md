> 本文保留各阶段的技术设计与证据；旧协作合同、Matter 和旧库迁移描述不代表现行实现。当前协作边界见[主 Agent 与 Worker 会话架构](architecture/main-worker-chat-architecture.md)。

# 技术方案

## 1. 技术基线与边界

2026-10-19 隔离候选的当前行为见[执行架构候选](34-flexible-execution-candidate.md)；下列早期版本限制按日期阅读。

已确认：Codex 是唯一执行引擎，通过 App Server 接入。早期 M0 使用 Codex CLI 0.154.0；当前本机订阅入口为官方稳定 0.163.0 / gpt-6.1-sol medium。Worker 交互协议按这两个版本的本机生成类型核对；升级版本需重验接口。

已确认：M0 先通过 CLI 测试；后续已批准并实现共享 Homer 的本地浏览器对话页，见 [Web 界面](10-web-interface.md)。不引入桌面壳。IM 接入按各自渠道文档验收。

M0 已采用 TypeScript、Node 22.22.0 与内置 SQLite，在当前 Mac 本机单用户运行；未来部署位置和正式商业调用方式仍待决定。

不依赖 Cindy 内部代码来证明可行，也不默认复制其代码；借鉴其主会话与独立执行分离的机制。需要复用代码时另查许可与边界。

## 2. 逻辑结构

```text
CLI / 本地 Web / IM 渠道适配器
                      |
消息入口与回复路由：会话、引用、附件、身份
                      |
产品服务：事项记录、授权请求、执行调度、成果索引
                      |
Codex App Server 适配
           |                       |
主 Agent 会话              独立任务会话
接待、规划、派发            研究、制作、核验
           |                       |
           +------ 工具能力 --------+
                 浏览器 / 文档 / MCP
```

逻辑模块不等于需要多个微服务。首版优先单一产品服务，避免多引擎兼容平台和不必要的分布式组件。

## 3. 核心数据归属

| 对象 | 负责保存什么 |
| --- | --- |
| 事项 Matter | 用户目标、验收条件、讨论上下文、当前状态、成果关联 |
| 执行 Run | 某次执行的引擎会话关联、状态、时间、错误、用量和停止请求 |
| 执行事件 Event | 已确认的启动、输入接收、工具结果、结束等事实 |
| 授权请求 Approval | 具体动作、所属事项与执行、有效期、用户处理结果 |
| 成果 Artifact | 文件位置、类型、生成来源、验证状态和版本关联 |

事项是一项用户目标；Run 是一次尝试，同一事项可以有多个 Run。引擎历史由引擎管理，产品保存必要关联和业务状态，不复制出第二套引擎历史。

产品任务库是事项与执行的正式记录。Agent 的临时计划管理内部步骤，不能替代产品事项库。

## 4. 主 Agent 与派发

- 主 Agent 使用定制指令与受控工具，负责接待、澄清、拆分、派发和验收。
- 派发工具创建持久执行记录和待启动请求；后台启动成功后记录实际引擎标识。
- 派发过程处理「记录已保存但尚未启动」「启动成功但回执中断」等情况，不能靠模型再次调用来修补，避免重复执行。
- 独立任务得到明确目标、验收条件、所需材料、工具范围及执行上限，不默认继承全部主对话。
- 主 Agent 派发后结束当前处理或继续接待；结果以事件返回，必要时触发新的处理。
- 首版不要求引擎内部子 Agent；独立任务机制先满足多事项并行。

## 5. 状态与重启

Run 建议状态：queued / running / waiting_user / succeeded / failed / cancelled / interrupted。

取消请求是单独的控制记录；得到停止确认后才进入 cancelled。事项是否完成由验收判断，不能只依据 Run 的 succeeded。

用户要求变更、授权回复与执行结果按稳定标识关联，重复事件应幂等处理。

重启后先对账；不能证明仍在运行的执行标记 interrupted，并提供继续或重试选项。P0 不承诺精确恢复任意工具调用中间状态。外部动作结果不明确时先核实，不自动重放发送、付款或删除。

## 6. 执行资源与隔离

每个执行隔离上下文与工作文件；当前不设固定并发数量上限，由主 Agent 决定派发。浏览器、GUI 与同一目标文件的写入要协调，不假设多个 Agent 能共享同一桌面同时点击。

当前实现为每个 Run 一个独立 App Server 进程，主 Agent 另有一个进程。Worker 待答时保留该进程、thread、turn 和原请求；其他 Worker 继续运行。

主 Agent 与执行任务均采用官方支持的商业鉴权方式；不假定个人订阅额度可以作为第三方产品统一售卖的底层资源。

## 7. 能力接入与后续扩展

CUA、浏览器、Office、通知优先使用现成组件，经适配暴露为工具。MCP、Skills、插件的机制不同，分别实现发现与配置，不假设任意包可互装。

后续能力目录至少记录来源、版本、依赖、权限、配置状态和验证状态。安装成功、账号连接成功和真实任务执行成功分别记载。

IM 手机确认复用同一授权请求对象和原执行关联，避免另建无法回传的消息流程；不能假定 IM 通知能直接完成扫码、生物识别等外部身份验证。

## 8. 核验与诊断

记录状态、耗时、错误码和用量；默认不记录原始提示词、工具参数／结果、文档内容、凭据和完整敏感 URL。

文档检查至少包括能打开、结构符合要求，涉及计算时核验数据与公式；排版质量需要渲染检查。

## 9. 现阶段证据限制

M0 原型及实测范围见 [验证记录](07-m0-validation.md)。没有生产成功率或精确金额成本数据；本项目没有复用或审查 Cindy 源码。

## 10. 渠道分离与消息路由（设计建议）

核心服务不依赖 CLI 输入输出、某个 IM SDK 或平台卡片格式。P0 只实现 CLI 适配器和必要消息边界，不提前建设通用渠道插件平台。

入口消息至少关联渠道、发送者、会话、消息标识、正文，以及可选的引用和附件；核心处理产生回复、进度、确认请求、成果或错误等事件，由适配器输出。具体类型与字段在实现时收口。

- 主会话、业务事项和 Codex 线程是不同标识，不直接把某个 IM 会话等同于某个执行线程。
- 路由优先使用明确回复引用和事项标识，其次结合对话判断；存在歧义时询问。
- 确认动作必须匹配身份、请求标识、执行与有效期。技术校验由程序负责，不能只依赖模型理解「同意」。
- IM 重投递按平台稳定消息标识去重；发送结果不确定时保留未确认状态，不无条件重发。CLI 也应支持同一请求标识的重复提交处理。
- 关联路由信息与发送回执应持久化。CLI 首版可在重连后补取未读结果；断开命令行客户端不自动代表取消任务。
- 客户端与执行服务的生命周期要分开说明。若首版采用单进程且退出会中断任务，必须明确报告并进入重启对账，不能宣称后台仍在工作。
- 后续 IM 首先验证单用户私聊；群聊、共享身份、多租户属于另行定义的范围。
- 渠道接入需发送者绑定或允许名单。收到 IM 消息不等于获得新的工具权限，连接某个 IM 也不等于获准读取其全部历史。
- 终端正文与附件中的内容作为数据处理，不拼接执行为 shell 命令；避免为诊断默认记录私密聊天正文。

## 11. M0 实现收缩方案

本节保留最初 M0 的实施基线；后续已实现的稳定宿主、Web 与渠道边界分别见 [开发版自动升级](09-development-upgrade.md)、[Web 界面](10-web-interface.md) 及渠道文档，不以历史基线否定当前入口。M0 功能边界以需求文档第 9 节为准。

- TypeScript + Node 22.22.0；`node:sqlite` 保存正式事项状态，不加运行时 npm 依赖。开发依赖由 package-lock.json 锁定。
- 一个 CLI 应用进程，分别管理主 Agent App Server 和多个独立 Worker App Server。主线程串行处理输入／审阅／交付，Worker 独立异步执行；生命周期各自可停止，无 daemon 或 HTTP 服务。
- 公开 stdio JSON-RPC：initialize/initialized、thread/start/resume、turn/start/interrupt；动态工具及 completed/tokenUsage 事件按线程和轮次关联。当前协议仍含实验能力；生成探针放 `.codex/scratch/protocol/`。
- SQLite 中 matters、runs、events、requests 与 meta 是正式记录。Run 状态为 queued / running / awaiting_review / succeeded / failed / cancelled / interrupted。running 包含启动阶段，threadId、turnId 分别来自真实引擎回执。
- 主 Agent 原有动态工具 list_work、dispatch_work、inspect_run、review_artifact、stop_work 保持原定义；新增三个交互工具经 Homer 自有本地 MCP 接入，见第 12 节。每条输入可以多次派发；重复 requestId 不重复执行，正文哈希冲突拒绝。修订沿用 matterId、新建独立 Worker 线程与输出目录。
- Worker 仅有绑定本 Run 输入的 read_material、只读上一成功成果的 read_previous、独占创建文件的 write_markdown，以及正式业务提问工具 ask_main；它们通过 Codex 动态工具调用执行。固定材料读取不再让模型填路径。
- 文件 I/O 由宿主按根路径、真实路径、普通文件、链接、大小与文件名检查，拒绝遍历和覆盖。原生成成果放 workspace/outputs/<matterId>/<runId>/，旧 Run 不改写。
- 原生文件／执行工具受命名 permissions profile 限制：`:root=deny`、`:minimal=read`、Codex 运行目录与本线程空工作目录可读，无原生写权限，命令网络关闭；shell、浏览器、图像、应用、插件、hooks 和子 Agent 关闭；保留官方工具执行宿主 code_mode_host，以承载白名单工具调用。Worker 原生请求进入第 12 节的交互通道；宿主仍只允许本 Run 目录读取的明确子集，不增加 shell、原生写入或网络能力。模型通过白名单宿主工具读写成果；隔离不依赖提示词。
- Worker 完成不等于通过：先验证文件范围、存在、普通文件和非空，再进入 awaiting_review；主 Agent 必须在当前轮 inspect_run 读取原文和实际成果，才能 review_artifact。失败保留历史，不自动重试。
- 结束先保存再串行回传主 Agent，stdout 写入回执成功才标 delivered；断在写入与记账之间可能重复投递，不能保证人已经看见或精确一次送达。
- 停止先保存 stopRequestedAt，禁用此 Run 后续宿主工具；请求 turn/interrupt，再确认本应用创建的进程组退出。确认后 cancelled；超时为 failed/timeout，无法确认则 interrupted。程序正常退出停止工作；EOF 等待已提交工作，如果只剩等待用户的 Worker 则明示并停止，Ctrl-C 或 /quit 停止。
- runtime 独占锁防止两份 CLI 共用数据库。崩溃后核对记录的引擎进程身份并停止残留，只把 queued/running/awaiting_review 标 interrupted，不自动重放；主线程用 thread/resume 继续。
- 当前只记录可获得的 tokenUsage 数值，不估造扣费。完整进程树的资源与耗时见验证记录。已有引擎历史由 Codex 保存，宿主不另存原始提示词／工具参数／工具结果诊断。

### 实际工程结构

```text
src/                 CLI、协议、任务服务、SQLite、文件边界和提示词
scripts/             显式真实 Codex 验收入口
tests/               行为／协议测试与虚构会议样例
examples/            无凭据配置及经过真实验收的成果示例
docs/                产品、技术、运行与验证文档
.codex/private/      默认运行数据库、锁与工作文件，已忽略
.codex/scratch/      公开样例的协议探针与验收临时证据，已忽略
```

配置位置与隔离限制见 [运行说明](06-running-homer.md)。M0 支持第 12 节的原进程交互恢复；不支持进程退出后的工具调用恢复。运行中修改任务的追加方式另行实现，不属于本次交互范围。

### 并行执行补充（2026-10-16）

按用户要求移除单 Worker 及每消息一次派发限制，不增加调度策略型提示词。主 Agent 调用多少次 dispatch_work，就创建多少个独立 Run；程序维护以 runId 为键的 Worker 集合，每个进程、超时、停止请求和成果目录互不混用。主会话的消息、审阅和交付仍串行，以免同一会话多轮同时写入。

runs.requestId 是一次工具派发的幂等键，由来源请求、引擎线程、工具 callId 计算；新增可空 sourceRequestId 关联原用户消息，允许一条消息多个 Run。旧库启动时仅新增字段和索引，不重建表、不删除历史；旧记录 sourceRequestId 为空时沿用 requestId 关联。重复用户请求回传所有关联 Run，重复工具回执不重复派发。运行中同 Matter 修订限制保持原行为。

主会话以 SQLite meta.mainThread 为恢复锚点；正常重启必须 thread/resume 同一线程，并核对返回标识。恢复失败或返回其他标识不得覆盖原记录，也不得自动新建。主工具定义指纹变化时，当前 Codex 无法直接更新旧线程动态工具，因此返回 main_tools_migration_required 并保留原线程及指纹；通用动态工具迁移尚未实现；本次新增交互使用本地 MCP，在保留原动态工具和同一线程的前提下加载，不以丢弃上下文换取启动。首次启动没有 mainThread 才创建新主会话。相同配置的普通重启可延续上下文，仍受 Codex 上下文窗口及压缩影响。运行目录、更换账号等迁移不能通过新 runtime 假装延续完成。


## 12. Worker 授权与业务提问（2026-10-16）

引擎将 `item/commandExecution/requestApproval`、`item/fileChange/requestApproval`、`item/permissions/requestApproval` 和 `item/tool/requestUserInput` 关联原生 JSON-RPC ID、thread/turn/item 与当前 Run，保留回调。只接受绑定当前活跃执行的请求；未知方法、非法请求或过期执行明确拒绝。`ask_main({question})` 是 Worker 的正式业务问题通道，调用期间不结束原 Run。普通最终文本中的提问仍不能可靠自动识别；没有成果时原有 `artifact_missing` 检查继续生效。

`worker_authorities` 保存宿主从真实用户派发消息和自主范围配置捕获的任务授权。`worker_interactions` 是业务状态表，保存问题／操作详情、来源、关联执行、授权依据、决定与理由、升级问题、用户回复关联、传输回执。授权 `approve/deny` 与问题 `answer/deny` 分开，回答不能赋予操作权限。详情仅经显式查看提供给主 Agent；`events` 仅存 ID、类型、稳定分类，不记录这些正文。

| 状态 | 等待对象／含义 |
| --- | --- |
| pending_main | 等主 Agent；主队列只排入事件轮次，不等待 Worker 的 Promise |
| pending_user | 主 Agent 已记录升级问题并结束本轮；原 Worker 保持等待 |
| approved / denied / answered | 已记录明确决定；`deliveredAt` 区分是否收到原通道发送／原生 resolved 回执 |
| cancelled / expired | 停止、进程退出、轮次结束或重启丢失回调；旧批准不可再用 |

主 Agent 先 `inspect_interaction`，必要时 `inspect_run` 查看目标、原材料、实际成果、事件顺序和交互摘要，再 `respond_interaction`。仅超范围或无法判断时 `escalate_interaction`，自然语言询问用户并结束本轮；后续真实用户消息由宿主关联到原待答项。模型或系统事件不能伪造用户消息 ID。明确拒绝也回到原 Worker。若主 Agent 没有调用答复或升级工具，宿主明确拒绝该项，不用空答案继续。

相同决定的重复答复在原执行仍活跃时幂等；冲突、错误 ID、停止后或过期答复拒绝。多个问题按各自关联键处理。计时器只扣实际执行预算，待答时间排除，答复不会重置预算。停止先使待答失效、关闭计时器，再中断原进程；启动先对账残留进程与 Run，再将失去回调的待答或未发送决定标为 expired，不重放外部动作。已送达决定保留为历史，不作为新权限。

原生决策只使用实际协议枚举：命令／文件单次 accept/decline；权限仅显式请求的路径／entry 子集与 turn scope，不接受会话授权、策略修改、通配扫描或扩大范围。本期宿主的批准校验只支持本 Run 目录真实路径内的读取子集，其余能力明确拒绝；没有因为默认自主空间开放任意安装或命令。秘密输入 `isSecret` 被拒绝，不经主对话收集凭据。

保留主对话采用独立的 `homer_interactions` stdio MCP，连接当前 Homer 的权限为 0600 的本地 Unix socket，仅提供 `inspect_interaction`、`respond_interaction`、`escalate_interaction`。宿主只对这三个业务工具设置 MCP 调用许可；每项 Worker 操作的批准仍须走上述判断。原有五个 dynamicTools 及其指纹不变，继承的其他 MCP 仍逐项禁用；有效 command/args/cwd 与工具目录必须匹配。原生 thread/resume 继续同一 ID 和历史，不执行新建／复制聊天迁移。工具元数据不兼容及历史不可恢复仍保留原指针并明确报错。该方案须用真实同线程恢复和工具调用验证；不宣称原生支持动态工具在线改写。

当前线程保留 `environments: []`，没有为审批测试额外启用原生执行环境。在本机 0.163.0 的真实 Worker 中，`request_permissions` 未被提供；官方同版工具注册也要求环境可用。故原生桥接、暂停与权限校验以协议 fixture 为证，不能写成原生模型审批已实测。正式 ask_main 的真实闭环独立验收。

## 13. 提示词资源与恢复契约

`loadPrompts()` 只读取 `prompts/main.md` 和 `prompts/worker.md`，按 import.meta.url 解析并建立启动快照。产品方法通过 developerInstructions 附加，保留 Codex 原生基础指导。旧自主范围与记忆政策资源和配置注入已移除，旧配置残留字段忽略；真实用户要求和来源授权仍保留。

新建/原生默认恢复 thread 已验证。历史自定义 baseInstructions 仍优先继承，不能靠改 RPC 字段宣称已迁移；固定 0.163.0 未发现保留历史和同 thread 的默认 base 重置入口。当前候选的目录、角色、开放网络、用户控制认证、原生记忆和采用边界统一见[执行架构候选](34-flexible-execution-candidate.md)。以下早期章节按其日期保留。

## 递归候选与持久输入队列

后续批准的实现已在同一 Store 和服务 pump 中区分 Task/版本、Run/epoch、稳定 Agent 及根 Matter 投影。内部消息/收据也承载主 user_input；不存在每层调度器或第二套 inbox。内部成果与父验收不会进入用户聊天，只有根正式 publication 才授予交付/下载许可。主输入默认 FIFO，编辑/撤回与 claim CAS，打断先持久化再确认准确 generation；记忆只采用当前处理 revision。详细契约见[递归架构](12-recursive-agent-architecture.md)，候选验收与尚未完成的模型/日常门槛见[递归验收](15-recursive-agent-validation.md)。早期 M0 限制仅描述其历史基线。
