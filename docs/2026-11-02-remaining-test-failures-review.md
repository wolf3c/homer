# 剩余 62 个测试失败：离线根因、修复和复核

日期：2026-11-02，Asia/Shanghai。以下为早前冻结工作区的修复记录；当前分组提交及保留范围见文末，不代表全部差异已提交。接续[上一轮离线归因](2026-11-02-offline-test-compatibility-review.md)。本轮只使用合成引擎、测试数据库和已有本地依赖；付费模型调用为 0。没有启动、停止、安装、更新或读取日常 Homer 的账号和业务数据，没有提交或发布。

## 范围和对照

后续按用户要求将可选本地媒体工具集成拆为独立入口，见[默认测试与本地媒体工具集成的边界](2026-11-02-local-media-test-boundary.md)。本文件保留拆分前的原始全量结果；Whisper 识别失败并未因分类调整而被视为通过。

上一轮的 62 项是移除审核、发布、Main 等待与收尾四文件补丁后仍然失败的条目，不能归为那四文件补丁引入的回归。本轮在 1402 个文件的冻结源码副本中继续排查，逐项保留失败证据，再核对当前 owner、已批准产品文档和合成运行行为。

运行使用 Node 22.22.0、独立 HOME/TMPDIR/CODEX_HOME、Node 远端 TCP/DNS 拦截，允许测试需要的 loopback 和 Unix socket；没有提供真实模型连接。重型构建串行、后台优先级。隔离副本有独立 Git 上下文，避免源码快照工具误把外层仓库路径当前缀。读取文档的 Python 环境和语音模型只链接已有文件；未安装、下载或恢复凭据。

## 按根因分组

下表数量对应原清单，合计 62；不是本轮新增测试的数量。同一项可同时需要产品修复和 fixture 更新，不把混合原因强行归为单一类型。

| 原条目数 | 范围（均在 tests/） | 根因与处理 |
| ---: | --- | --- |
| 5 | `web-history-maintenance-contract`、`web-history-worker-headers`、`tool-message-projection` | **真实摘要读取缺陷及旧 final fixture**：结束节点的默认摘要包含普通 commentary，带入 1 MiB 正文。只在摘要 SQL 增加 `phase=final_answer`；原有两个 Worker/字节上限测试原样通过。其余 fixture 改用真实 phased item，不再仅填写已非正文 owner 的聚合 final 指针。 |
| 2 | `telegram-worker-roundtrip`、`wechat-service` | **真实渠道追问身份丢失及旧适配替身**：统一队列生成 coordination 后，渠道没有得到原 interactionId；Telegram 未建立可回复卡片。由持久化 host 通知恢复准确交互身份，沿既有 question 路径投递；微信端到端测试改用真实 HomerWechat 适配器。 |
| 25 | `reception-*`、`waiting-activity`、`recursive-host`、`telegram-atomic-acceptance`、`web-acceptance`、`web-dev-host`、`web-service`、`web-upload-host`、`wechat-homer` | **过时队列、ACK、终态和替身契约**：当前统一 FIFO 不再按 interrupt/first_launch 重排业务输入；收到原生 ACK 后才正式显示用户消息，received/processed 不留在待发送列表。测试核对原持久化 ID、revision、generation、CAS 和去重；补真实 onStarted ACK、正式公共消息和当前 transaction/history owner。宿主关闭只证明进程关闭，不能伪造原生 terminal：unknown/uncertain 与队列是否可继续分别验证。 |
| 14 | `user-message-bubble-ui`、`waiting-status-ui`、`web-feedback-host`、`restore-official-components`、`run-activity-facts-ui`、`task-status-count-ui`、`task-status-css` | **过时抽取式测试和 UI 契约**：补实际闭包、EventTarget、精确 mutation requestId；feedback 精确抽取绑定，连接测试仍由完整真实 effect 驱动重连、流替换和清理。按已有 DESIGN 验证真实失败条目和缓存失效，不恢复已移除的失败次数汇总。保留上游 hash，精确逆转现有六行状态适配后验原字节；CSS 验实际 spinner、命名空间和 reduced-motion，新增真实 TaskCard 行为覆盖。 |
| 13 | `task-overview-native`、`task-readability-origin`、`task-readability`、`worker-card-host`、`worker-card-query` | **过时查询、发布及信息边界假设**：当前增加有界 update/requirements 查询，仍验证固定查询数、只读和索引；改用真实发布 owner 和准确 receipt 查询，保留 20000 条噪声下无表扫描。Worker 隐私断言见下文，未允许私有 Worker 内容进入卡片。 |
| 1 | `dev-upgrade` | **失效故障注入**：旧 `async start()` 字符串已不匹配当前签名，工具描述的字符串替换也无匹配。显式断言唯一 start 声明并注入原故障，直接改变合成工具 description 验迁移守卫；原超时和回滚断言不变。最初记录的 contender `status=null` 本轮未重现，不臆断其历史原因。 |
| 1 | `release-css-snapshot` | **过时生成文件**：首次隔离构建先刷新 CSS，暂时掩盖失败；在正确快照上下文恢复原附件 CSS 后，原测试稳定报 `attachment_css_stale`。采用既有生成器的准确附件输出，删除 14 行已不在声明输入中的规则；测试及生成器均不改。另一份无关 task-status CSS 生成差异不保留。 |
| 1 | `media-audio` | **明确环境缺项，保留失败**：现有 TTS、SILK 编解码成功，但本机没有 whisper-cli 可执行文件；已有模型文件不能替代它。保留原 ASR 识别断言，未跳过、改为模拟成功或下载工具。 |

[统一 FIFO/ACK 依据为 UI DESIGN](../ui/DESIGN.md) 的“主 Agent 统一待发送顺序”和“队列方案 B”，以及 [Worker 回传统一队列方案](2026-10-23-worker-return-main-queue-plan.md)。普通过程懒读、正式 final 和工具细节的 owner 依据为 UI DESIGN 和实际 `MainProcessHistory`/`process-details` 实现。测试修改不恢复旧产品行为。

## 两项产品修复的边界

`src/main-process.ts` 的摘要 SQL 只筛选已结束 user 节点的普通正文：Worker/WorkerEvent、任务动作摘要和所有公开 final 保留；工作中的节点、显式详情和公开 phase 过滤保持。该宽泛 SQL 在 10 月 30 日公开 phase 修补前已存在，不能把新发现的失败误归因于那次修改。

同一 owner 的 coordination 只从持久化 `senderAgentId=host`、`kind=interaction_required` 通知提取 interactionId，保留原 sourceRequestId、thread、正文一致性验证。Telegram/微信依据原 owner 的持久化 userQuestion 判断是否真的升级为用户问题，进一步核对真实 Run 和原来源，再复用既有 question 分支。未升级问题的协调失败说明或内部决策后的正式说明照常投递；曾升级且已解决的旧问题不重新发送。没有新增交互表、授权状态或旁路答复。

渠道测试保留原 Worker/thread、歧义答复不续跑、明确身份才答复、正式成果发布；另外校验假正文拒绝、Worker 伪造 host 问题无效、重试/恢复保持同一问题 ID 且不另发一条普通 delivery。

`worker-card-host` 原断言遍历整个完整 ProcessNode，误将主 Agent 已授权的业务工具 `input.contract.goal` 也当成 Worker 私有内容。当前 DESIGN 明确允许用户展开原工具参数。修订后仍严格断言所有 Worker snapshot、非工具正文公共字段、默认 bounded history 和启动诊断不含合成 PRIVATE 标记，并单独通过 scoped process detail 断言允许的准确工具 goal。没有删掉隐私标记或对整个节点放行。

## 安装兼容与并行修改

`schemaHash` 对 12 个 SQLite owner 的完整文件字节取哈希；本轮只有 `src/channels/wechat-homer.ts` 这个 owner 改变，内容为路由逻辑，未改 DDL。指纹从已审核的 `782386a959d765de6b5521cd4f638ae6997e0777ba913c0e12855c7baf6ad382` 变为 `ee1189f5f4a173e99b7769014e122b4b4bb66a2adf039318ea479a7912ec5305`。

`scripts/desktop-profile.mjs` 只增加精确向前兼容目标；782 来源只能新增到当前 ee1189 候选的路径，不获得回退 f703 的许可。旧 marker 保持原字节，未知指纹、未批准 a7c、Codex 不匹配及反向新建配置仍拒绝。兼容、profile 和设备定向检查 19/19 通过。没有运行真实安装或日常数据库升级。

工作区并行更新了同脚本的 `saveDesktopModelSource` 临时文件清理；该不重叠修改原样保留，不归入本任务修复。 冻结后还有桌面配置/权限、移动 TURN 测试和相关文档等无关更新；它们不在本次冻结全量的覆盖范围内，合入时不覆盖这些文件。只保留经原测试证明过时的 `ui/vendor/assistant-ui/attachment.css` 重生成结果，另一份 task-status CSS 仍用原文件。本任务未修改产品 UI 组件、生成器或上游 hash 文件，也未增加依赖。

## Review 与验证

独立只读 review 发现并关闭两项 P2，没有把首次修法直接交付：

1. 初稿把所有携 interactionId 的 coordination 都转成问题，会吞掉未升级问题的正式协调失败说明或内部决策后的说明。新增两个渠道各四种状态的测试，先复现 4 个失败；改为依据持久化 userQuestion 区分升级事实后，连同原问答、恢复、服务交互和配置组 **63/63 通过**。已回答旧问题仍不回退成普通消息；中间版本的兼容指纹未保留。
2. 初稿把连接测试缩到 unavailable 监听器，让测试代码接管 activeEvents/disposed，失去真实重连和清理保护。已改回完整生产 effect，使用真实 HistoryWindow/ActiveReadPage；完整文件 **7/7 通过**。分别删除抽取源码中的 activeEvents 赋值和 cleanup disposed 赋值，两次负向检查都准确失败；产品 UI 源码未改。

附件 CSS 追加审查确认只删除四条已不在声明输入中的规则（14 行），原生成器和原检查测试不变；附件、TaskCard 和连接最终组 **12/12 通过**。最终 review 没有剩余可操作发现。类型检查曾发现新 receipt 测试未收窄 SQLite ID，已增加字符串断言并重新通过；修订后 TypeScript 和服务/UI 构建均通过。

| 定向验证 | 观察结果 |
| --- | --- |
| 接收状态/查询及等候活动 | 15/15 通过 |
| 真实合成网关/SSE/IPC/300 deltas/背压 | 6/6 通过 |
| 升级回滚与 Web 宿主交接 | 3/3 通过；93.18 秒，原测试超时不变 |
| 投影、Task 读取和 Worker 卡片所属组 | 41/41 通过；另有 Worker/工具正文相邻组 25/25 |
| 渠道、问答和 Web 接受/上传修复组 | 42/42 通过；review 后新增边界组见上文 63/63 |
| UI 替身、缓存、回执及组件组 | 各最终子组合计 33 项通过；真实 effect 及 CSS 最终组另见上文 |
| 本地文档和音频组 | 5 项中 4 通过，1 项缺少 whisper-cli，保留失败 |
| 固定引擎的本机合成协议组 | 20/20 通过，不使用真实模型服务 |

这些子集存在交叠，不相加为全量通过数。首次全量尝试随本次会话中断结束，停在第 386 项，没有 exit 或汇总记录，不能称为完整验证。此前出现的 5 个额外失败均指向隔离副本缺失已有固定引擎路径；核对现有 Codex 0.163.0 二进制 SHA256 后，只链接其已有安装包，不提供凭据，相关 20 项通过。中断日志保留，随后重新完成完整套件。

最终 `node scripts/test.mjs --test-reporter=tap`：**1907 项，1897 通过、1 失败、9 跳过、0 取消**，退出码 1，耗时 619.43 秒。唯一失败为 `ILINK-AUDIO-01` 的 `media_asr_unavailable`；原清单中的其余 61 项已在当前合同和完整离线套件中消除。9 个既有条件跳过涉及明确要求包/真实网站/指定原生引擎的用例，未为全绿新增 skip。没有宣称全量全绿或实际安装通过。

完整运行期间 1402 文件快照的实现、测试和资源字节没有改变；唯一变化是本报告的上轮入口文档新增后续链接。

最终采用 41 个文件：3 个产品 TS owner、1 个精确兼容守卫、1 个合成宿主 helper、32 个测试、1 份必要生成 CSS、1 份组件来源 README 和 2 份维护记录。逐文件与初始快照核对后采用，仅 desktop-profile 有不重叠并行修改，已原样保留；没有覆盖其他无关变更。合入源码与已审核候选逐字节一致，当前工作区 `tsc -p tsconfig.check.json` 再次通过，差异空白检查通过，自有全量测试进程组已退出。运行中出现的其他工作区更新未被冒充为冻结全量已验证。

本地可复核证据位于 `.codex/scratch/homer-offline-62-20261102-gxn_yn3b/`：`before/`、`work/`、`source-manifest.json`、`changed-files.json`，以及各组 `*-exit.json`/日志。UI 归因在 `ui-failure-attribution.md`；投影及接收组记录在 work 下各自命名的 scratch 子目录。维护结论以本文件为准，不要求保留原始运行内容才能理解修复。

未做付费或真实渠道/模型复测、实际桌面安装与日常数据库迁移、真实界面布局和真机验收。离线合成回路不代表这些真实环境已通过。

## 分组提交收敛（2026-11-02）

本节对应从 `c1bc021` 开始的最小提交整理，以上全量记录只描述早前冻结工作区，不代表本次提交候选的全量验收。Telegram/微信相关问题按用户要求暂不处理。

### 本次提交

1. 摘要读取：只提交 `src/main-process.ts` 中已结束用户节点的普通 commentary 过滤条件，保留完整 final、Worker 事实、工作中节点和显式详情。新增独立的 `main-process-summary.test.ts`，复用现有合成数据库 fixture；基线明确在摘要大小断言失败，修复后通过。没有纳入同文件原有的公开 phase 过滤或渠道 coordination 身份改动。
2. 离线回归：同步读取器作用域、消息队列临时目录、合成主回复的 final 事件、精确引用/问答/ACK、只读查询计数、工具正文投影、Worker 卡片隐私与获准工具详情、队列回执的双身份、详情缓存、TaskCard 的真实 disclosure 和原上游来源守卫。既有测试在核心/专项拆分后的文件位置上逐段整理；未恢复已拆出的专项。
3. 附件 CSS 仅删除已不在声明输入中的四条生成规则；使用原生成器的 `--attachment --check` 检查通过。TaskCard 说明分别指向核心交互和显式 vendor 来源检查。
4. 开发 fixture：修正合成 preload 的服务模块导出转发，以及升级故障注入对当前 `Homer.start` 和工具目录的精确命中。只做隔离模块探针及源代码注入检查，没有运行大型构建或安装升级流程。

### 验证和 review

- 最终选定的独立核心/组件/来源检查 99/99 通过；Web 服务本次修改的引用、原 Worker 问答和输入归档三个用例 3/3 通过。共 102 个独立用例，无新增代码 skip 或放宽断言。
- 首轮候选预检 117 项中 115 通过、2 失败，原日志保留。Web 上传失败为旧测试引用已退役的 `memory_jobs`；整个上传测试改动本次未纳入。主进程终态的新断言依赖尚未提交的服务修复；该段也未纳入。原始 HEAD 的测试及 fixture 对照仍复现终态断言 `0 !== 1`，所以不能宣称完整 `web-service.test.ts` 或默认全量通过。
- 源码及选定 TypeScript 测试无输出类型检查通过。原附件 CSS 生成检查、preload 导出与合成工厂探针、升级 fixture 精确注入检查通过；开发升级端到端仍未运行。
- 逐段 review 核对了摘要/详情边界、隐私断言、回执的双身份、缓存失效、真实组件交互、上游逐字节守卫及合成替身边界。提交候选以已提交代码为底稿，未混入引擎、账号、服务恢复、RTC 或正式 UI 组件的其他改动。

### 继续保留的差异

| 类别 | 保留原因及范围 |
| --- | --- |
| Telegram/微信及兼容目标 | 渠道路由、对应渠道测试、`desktop-profile` 的 ee1189 目标和配套测试按当前要求排除；账号来源相关差异也不纳入 |
| 尚无已提交底稿的测试 | `reception-reads/host/ipc/state/gateway`、`user-message-bubble-ui`、`web-history-maintenance-contract`、`worker-card-query`、`waiting-activity/status-ui`、`task-readability/origin`、`main-process` 等文件在该轮修复前已有未提交底稿；只拥有其中修正的证据不足以纳入整个文件 |
| 未提交原测试及其实现依赖 | `web-dev-host` 的后续端到端案例不在 HEAD 底稿中；`web-service` 的未知终态新断言等待独立服务修复归属和提交；`web-upload-host` 等待历史记忆契约处理，保留真实失败 |
| 已提交，无需重复纳入 | `web-feedback-host` 的反馈转发闭包修正已经随此前核心/开发拆分进入 HEAD |
| 其他对话/历史归属未确认 | 引擎、服务、账号、原生图片、桌面签名、Finder 元数据、RTC/UI 等差异不因同处工作区而纳入本次提交 |

原始差异、隔离候选和验证日志位于 `.codex/scratch/remaining-converge-rokbp4cz/`。本次使用独立 HOME/CODEX_HOME、测试数据库和远端网络拦截；没有运行全量、安装工具、付费调用或操作日常 Homer。上述保留项没有删除，也不算作已验证或已提交。

## 提交后复核与最小补提（2026-11-02）

复核基线为 main 的 `c1abea5e7c8e0ced740e128aa147162b5fd3afa6`。以下四组已经在 main，不重复合并或改写历史；候选使用该提交的独立 worktree，没有带入共享工作区的其他修改。

| 已提交组 | 本轮 review 重点与结论 |
| --- | --- |
| `97f411a` 测试边界 | 核心和显式专项按执行路径区分；代理替身只拦截 scutil 的 --proxy；源码覆盖变量仅在核心入口清除。专项保留真实断言和未验证提示。 |
| `c1bc021` 审核与交付 | 参数诊断只返回 schema 字段，不回显未知参数或值；无 Run 的等待在写入前拒绝。成功验收只消费审核者自己的新确认，部分/失败通知保留；发布仍显式选择文件、先 prepared 后由宿主记录，并保留操作重放。兼容名单保持精确来源、目标和引擎版本，未知及反向升级拒绝。 |
| `9ea6c39` 摘要读取 | 只从结束用户节点的默认摘要排除普通 commentary；完整 final、Worker 事实、工作中节点和显式详情仍保留。没有增加查询或写入。 |
| `ff68acd` 离线 fixture | 保留队列双身份、ACK、真实 final、隐私、缓存失效、组件交互和原上游哈希断言。附件 CSS 用原生成器检查；开发故障注入与 preload 不冒充完整升级验收。 |

发现并处理两项遗漏：

1. `tests/workspace-file-publication.test.ts` 的 Markdown 暂存回归未随早前提交收录。剩余差异全部属于本对话：已有文件未暂存时必须拒绝验收，暂存后才能验收、显式发布并下载原字节。只扩展现有 setup 和新增这一案例，不修改产品实现。
2. `tests/web-feedback-host.test.ts` 的历史注释仍把直接 history 检查描述成完整 HTTP/IPC 回路；改为准确指向保留的 development 专项，测试正文及断言不变。

本轮验证：

- 23 个定向文件 213/213 通过；另行检查合成引擎协议、桌面 profile 兼容和模型配置，85/85 通过，共 298 个独立用例，无跳过。
- 产品源码和选定 TypeScript 测试的 no-emit 类型检查通过；附件 CSS `--attachment --check`、两项开发 fixture 的语法检查及 diff whitespace 检查通过。
- 性能证据限定为离线契约：1001 个任务仍用 6 次只读 SELECT（本次单次样本约 11 ms）；含约 1 MiB commentary 的结束节点摘要小于 4 KiB，详情仍可完整读取。没有新增运行时抽象、依赖、轮询或缓存；这不代表生产负载及全应用性能验收。
- 使用独立 HOME/CODEX_HOME/TMPDIR、合成引擎和远端 TCP/DNS 拦截，没有运行全量、真实媒体、真实模型、大型构建、安装、渠道或日常 Homer 操作。未重新执行已记录失败的主进程终态和旧 memory_jobs 上传候选；不能宣称整个默认套件通过。

以下增量已逐组对照历史补丁，但暂不纳入提交：13 个未跟踪测试（reception 五项、user-message-bubble-ui、web-history-maintenance-contract、worker-card-query、waiting 两项、task-readability 两项、main-process）的底稿归属尚未确认；web-service 新终态断言依赖本对话开始前的服务修改；web-upload-host 的 ACK fixture 依赖其他修改删除旧 memory_jobs 断言，媒体版还依赖原有图片案例；web-dev-host 的新版案例底稿尚未提交。它们需要先明确并收录对应底稿/实现，再做定向验证，不能整体认领文件。

公开 getting-started 指南中的测试说明段落及媒体报告新增链接也仍保留：指南底稿未提交，现有 `docs/testing.md` 已覆盖核心边界，无需为重复说明纳入整份指南。Telegram/微信继续排除。其他对话的账号、引擎、服务、RTC 和正式 UI 修改不在本次补提中。

可复查的候选、日志和初始工作区指纹保留于 `.codex/scratch/final-code-review-uqrzxn3i/`；候选 worktree 在提交合入后清理，历史归属及失败证据保留。

### 进一步按补丁收敛

此前将 `web-upload-host.test.ts` 整个文件的旧 memory_jobs 失败作为 ACK fixture 也不能提交的理由，粒度过粗。本次只收录本对话的一行 `onStarted` 修正，保留 HEAD 中原有数据库断言；其他对话对该断言的删除仍留在工作区。离线探针从实际测试源码提取唯一 Engine 类，基线因未发送 ACK 失败，候选通过 ACK 顺序、输入/图片保留和可选 callback 兼容检查；该文件及依赖的 no-emit 类型检查通过。此证据只验证合成 fixture 协议，不声称完整 Web 上传测试通过；旧 memory_jobs 集成障碍仍然存在，没有删除或放宽断言。

媒体边界报告的链接改指向已提交的 `docs/testing.md`，不再依赖未提交的公开指南。链接目标存在，逐段 review 和 diff 检查通过。其余 17 个文件中的本对话增量仍依赖未提交底稿/实现：已准备逐项归属及仅撤回本人增量的预览，尚未执行撤回，也没有收录整份未跟踪文件。证据位于 `.codex/scratch/owned-delta-closeout-u5q1ug3w/`。本次没有运行全量、真实集成、安装或付费调用，没有操作日常 Homer。

## Telegram / 微信追问身份收敛（2026-11-03）

本轮基线 `90a1f48`，用户现已授权处理此前排除的本对话渠道补丁。从历史 before/work 快照逐段恢复到干净候选；没有纳入共享工作区其他对话的原生流式回复、多文件交付、服务、账号、RTC 或正式 UI 改动。

- `MainProcessHistory.coordination` 只从宿主 `interaction_required` 持久化消息提取 interactionId；Worker 自行填写相同 payload 不能伪造宿主追问身份。原消息、接收 Agent、原输入和主线程校验保留。
- Telegram / 微信将已升级为用户待答的协调输出关联到原 interaction，通过既有渠道路径投递。原请求不符、已答复、取消或过期时不重发；未升级的普通协调报告仍发送。没有新服务、缓存、轮询、依赖或数据库迁移。
- 微信服务级合成测试改用实际 HomerWechat 适配器，仍断言歧义不误答、明确编号回到原 Worker、主线程不分叉、原文件字节及原来源上下文。Telegram 保留真实工具调度、原 Worker 和正式文件交付断言，增加追问重试/恢复身份检查。
- 桌面 schema owner 只有 wechat-homer 的路由逻辑改变，DDL 未变。明确允许已审核 782386 → ee1189 目标，保留旧目标、原 marker 和精确 Codex 版本要求；未知指纹及反向升级仍拒绝。没有操作已安装 profile。
- 原始 Telegram 原子验收案例把原始 replyId 与公开 process messageId 当成同一个 ID。本轮最小修正分别检查原始回复、唯一公开处理节点及对应展示消息，同时检查展示队列退出、持久化输入/回执仍唯一。其他对话对此案例的扩展未纳入。

验证与 review：

1. 在 HEAD 产品源码上运行新增待用户回答案例，Telegram、微信各复现一次失败：被错误排入普通报告，实际 1、期望 0。恢复候选后通过。
2. 第一组渠道定向验证 95/95 通过；随后加入跨请求、取消、过期共 6 项安全回归，只重跑受影响的三个测试文件，30/30 通过。最终覆盖 101 个不同案例，无跳过；不是全量测试。
3. 产品源码及五个选定 TypeScript 测试文件通过 no-emit 类型检查；桌面兼容 mjs 在上述定向测试中执行。最终 diff whitespace 检查通过。
4. 查询计划确认协调来源查询及新增 interaction/run 主键读取均使用索引，无全表扫描。普通输出没有额外追问查询；待答路径增加固定数量的主键读取。既有历史恢复枚举未改，本轮不宣称大历史或生产吞吐性能验收。
5. 人工逐段 review 核对了来源/线程/Run 归属、待答终态、幂等身份、普通协调报告保留、原文件权限以及精确升级白名单。候选只包含上述 10 个实现/测试文件和本记录。

证据保留于 `.codex/scratch/channel-review-20261103-_ff8_bo_/`（候选 worktree 合入后移除）。使用独立 HOME/CODEX_HOME/TMPDIR、合成引擎/API/凭据及远端 TCP/DNS 拦截；未运行全量、安装、付费调用、真实账号、媒体工具、浏览器或大型构建，未操作日常 Homer。真实 Telegram/微信服务端、客户端呈现、网络中断恢复及长期负载仍未验收；后续涉及这些能力或正式承诺它们时，才显式安排对应专项。

## 本对话 17 处待处理增量最终收尾（2026-11-03）

用户授权仅处理本对话修改的部分。复核时 main 已包含其他对话的 `00979a3`；该提交和工作区其他改动均保留。此前列出的 17 个文件与归属清单中的内容哈希全部一致，未发现后续覆盖，因此按已准备的精确逆向补丁撤回本人增量。没有删除文件，没有整体接管或提交其他对话的测试底稿。

| 原文件 | 本次处置及原因 |
| --- | --- |
| `tests/reception-reads.test.ts` | 撤回对未提交底稿的 FIFO 和 SQL 计划适配；原案例保留。已提交的主队列契约测试仍在，不为此次收尾接管该文件。 |
| `tests/reception-host.test.ts` | 撤回 observedAtMs、冻结事件与引擎 ACK fixture 适配；原宿主场景保留。 |
| `tests/reception-ipc.test.ts` | 撤回展示队列/持久化回执位置适配；原 IPC 案例和断言保留，未运行 IPC 专项。 |
| `tests/reception-state.test.ts` | 撤回 MainInputs fixture 和时间字段适配；原状态只读断言保留。 |
| `tests/reception-gateway.test.mjs` | 撤回展示队列与消息状态适配；原网关、构建和交接案例保留，未执行大型构建。 |
| `tests/user-message-bubble-ui.test.mjs` | 撤回本人引入的打包 fixture 和气泡状态适配；原 UI 测试底稿保留，未改 UI 实现。 |
| `tests/web-history-maintenance-contract.test.ts` | 撤回对未提交历史分页案例的适配；多个公开 final 与普通长日志的摘要边界转入已提交的 `main-process-summary.test.ts`，不复制其分页 fixture。 |
| `tests/worker-card-query.test.ts` | 撤回对未提交查询案例的私有宿主接口适配；保留原 20000 条通知和 601 条快照性能断言。已提交的 `worker-card-host` 伪造通知、事件身份场景仍保留。 |
| `tests/waiting-activity.test.ts` | 撤回内存数据库 fixture 和控制状态接口适配；原活动状态案例保留。 |
| `tests/waiting-status-ui.test.mjs` | 撤回网关/历史流 fixture 适配及额外源码覆盖变量；原断流与过期回调案例保留。 |
| `tests/task-readability.test.ts` | 撤回返回字段及查询数适配；原任务读取断言保留。 |
| `tests/task-readability-origin.test.ts` | 撤回宿主原型和直接文字发布 fixture 适配；原来源/交付断言保留。 |
| `tests/main-process.test.ts` | 撤回本人增加的 scratch 父目录创建；未收录整份未提交测试。 |
| `tests/web-dev-host.test.mjs` | 撤回本人为新版未提交案例增加的回执查询和对应断言适配；其他对话的新版案例保留。 |
| `tests/web-service.test.ts` | 撤回依赖未提交服务终态实现的替换案例，恢复修改前的真实终态断言；不能据此声称该案例已通过。 |
| `tests/web-upload-host.local-media.test.ts` | 撤回未提交图片案例的 ACK/空输入 fixture 适配；原图片识别断言保留，媒体专项未运行。 |
| `docs/public/getting-started.md` | 撤回本人添加的重复测试边界说明；原指南保留，已提交的 `docs/testing.md` 仍是该边界说明来源。 |

收尾后的唯一代码增量是现有 `tests/main-process-summary.test.ts` 的两行增强：加入第二个尚未 completed 的公开 final，并精确要求两个 final 都留在结束节点摘要中。原约 1 MiB commentary、摘要小于 4 KiB、Worker 事实、详情完整性和只读断言均保留；没有修改产品代码、配置或运行时。

验证：独立 worktree 中该回归 1/1 通过，无跳过；产品源码及该测试的 no-emit 类型检查通过。16 个恢复后的测试文件通过 TypeScript 静态解析，仅证明语法有效，不表示它们已执行或语义通过。17 个文件分别与已审阅的撤回预览逐字节一致，撤回前后所有其他已记录文件字节未变，diff whitespace 检查通过。

原测试中可能仍有旧接口、不完整 fixture 或未提交实现依赖；它们属于保留下来的底稿，不通过删除真实断言、批量修复或扩大提交范围来掩盖。本轮不重跑这些集成/开发专项，不运行全量、安装、付费调用或日常 Homer。上文历史记录中的“17 处仍待处理”至此已关闭：本人增量已撤回，独立摘要回归已纳入本次提交，其他对话的文件仍由其原任务处理。

精确逆向补丁、前后副本、哈希核对及离线日志保留于 `.codex/scratch/owned-final-closeout-20261103-zdm0clj0/`；本次候选 worktree 合入后清理，证据目录保留。
