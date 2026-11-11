# 双来源真实账号推理验收

2026-11-02，Asia/Shanghai。**最新本机账号复验部分通过：Codex Main／Worker 及切回后续聊成功；荷马推理因 Token 额度不足被拒绝（旧版误报 `engine_rate_limited`），荷马 Worker 与成功双向续聊仍未通过。** 以下先保留此前隔离资料中跨来源历史修复及双向续聊成功的记录；本机已安装版本与原日常资料的最新结果见文末。 首轮 15:25–15:35 发现阻碍；修复后 15:55–15:57 完整复验，16:02–16:03 通过代理保留复核；补齐启动取消保护后的最终代码于 16:11–16:13 完成双向续聊，16:16 完成停机保全核对。未提交、安装或发布。

## 根因与最小修复

首轮原生接口返回 HTTP `400`，字段 `input[6].content`，错误码 `array_above_max_length`，最大长度 0、实际长度 1。后续仅在内存检查请求结构，确认第 6 项为荷马历史中的 `reasoning`：带一个 plaintext `reasoning_text` 内容项，同时带供应商 opaque 字段。原生接口不接受这种组合。

固定 Codex 0.163.0 没有按来源转换历史的恢复选项；传入 `thread/resume.history` 会忽略原 thread ID，也不满足本任务。使用其进程级 `openai_base_url` 入口，在 `src/native-history-bridge.ts` 增加一个内存中的 loopback 请求边界，仅供明确选择 Codex 来源的推理引擎使用：

- 将非空 plaintext reasoning 的文本投影为普通 assistant 历史消息，只改变发送副本。原 native rollout 不改写、不删除，普通消息、工具调用、工具输出及原生 encrypted reasoning 原样保留。
- 内置 provider 仍为 `openai`；OAuth、原生账号读取、Token 存储及刷新仍由 Codex 负责。只转发客户端提供的认证头，不读取凭据文件、不缓存认证头、不新增授权文件或账号实体。控制连接不经过该边界。
- 仅监听 `127.0.0.1`，仅转发固定 ChatGPT 的 Responses 与模型目录路径；拒绝浏览器来源和缺少认证的请求，不跟随上游重定向，不记录请求体或认证头，不自行重试。
- 使用 SSE；固定客户端的 WebSocket 探测在转发模型请求前被拒绝。关闭请求压缩以便转换 JSON。此处是传输选择，不涉及模型来源回退或不确定工具操作的重放。
- 复用已安装的 Undici 7.30.1，声明为直接运行时依赖，处理 HTTP／SOCKS 代理和流式传输，避免另写网络协议；没有执行依赖安装。保留 `NO_PROXY` 语义，代理失败不会改为直连。引擎确认停止后释放监听器及连接。若桥接监听启动期间收到取消，释放监听器并返回 `engine_closed`，不再启动 Codex。

该配置入口也用于 [Codex 官方假服务测试配置](https://github.com/openai/codex/blob/main/codex-rs/app-server/tests/common/config.rs)。没有修改固定 Codex 二进制。

## 真实输入与结果

沿用上次的隔离资料、工作目录、Codex Home、binding 和原主 thread；没有导入日常版凭据或电脑上的另一套配置。主工作树 `main` 当前源码驱动真实 `Homer`／`CodexEngine`，运行包内 Node 22.22.0 和固定 Codex 0.163.0。验收工厂只增加按角色记录目标域名的 CONNECT 观测，不替换模型引擎、不解密 TLS。

| 阶段 | Main | Worker | 结果 |
| --- | --- | --- | --- |
| 荷马 | `deepseek-flash / max / Fast false`，provider `homer` | 实际业务委派，同配置 | 两角色均连向 `models.super-tree.com`；计算 1517 正确 |
| 荷马 → Codex | 同一主 thread，`gpt-6.1-sol / medium / Fast false`，provider `openai`、原生 ChatGPT 登录 | Main 实际委派独立业务 Worker，`gpt-6.1-sol / high / Fast false` | 两角色均连向 `chatgpt.com`；回忆荷马口令成功，Worker 计算 2021 正确，任务验收成功 |
| Codex → 荷马 | 同一主 thread 恢复，使用网站交付配置 | 未新增 Worker | 本轮新回复正确回忆两阶段口令与计算结果，无工具调用 |
| 最终代码复核 | 再次从荷马切至 Codex，随后切回荷马 | Codex Main 再次实际委派 Worker | 双向回忆与 2021 结果再次正确；各阶段均确认停止后才保存来源 |

Codex 阶段 Main、Worker 均未启用网站 Token。前两次 Codex 业务阶段的荷马额度分别保持 657.97820、635.22118 积分不变。截至 16:11 最后一次可查询时，本次修复复验累计消耗 149.03534 积分，可用 617.05294 积分。最后一轮 Codex 推理及任务结算成功后，附加的网站额度查询返回 `UNAVAILABLE`，导致该脚本顶层 `completed=false`；失败点不在推理。随后仅补切回荷马续聊，未重放已完成委派，续聊成功；但额度查询仍不可用，最终余额及本轮费用未核对。没有独立供应商逐请求账单，CONNECT 次数也不等于模型请求次数。

荷马引擎另会访问 ChatGPT 能力或目录服务，不能把所有 `chatgpt.com` 连接解释成模型回退。选源结论结合实际 provider、配置、角色连接及真实完成结果，而非只看域名。

本次修复复验新增 4 个业务 Worker（荷马 1、Codex 3），均正常交付、结算；连同此前验收，资料中 6 个 Worker task 均为 `settled / succeeded`，run 均为 `succeeded / ended`，无 run 错误。

## 回归与保全

- 账号、引擎协议、桌面选源、停止与桥接等相关回归 **296/296** 通过；包含启动中取消不产生子进程、活动流关闭取消上游并释放监听器。类型检查及差异空白检查通过。
- 固定 Codex 测试 `tests/desktop-source-resume.test.mjs` **1/1** 通过，实际执行 `openai → homer → openai` 的三次假服务推理，包含 plaintext 与 native encrypted 两种 reasoning。检查原 thread、两阶段标记、原生密文及外国 reasoning 文本保留，不再仅注入／读取 OpenAI 历史。使用隔离 HOME、合成凭据和禁止外连的 MockAgent，没有真实上游访问。
- 本地重跑：`HOMER_TEST_CODEX_BIN=<固定引擎绝对路径> node --import tsx --test tests/desktop-source-resume.test.mjs`。
- 原主 thread、binding 及最初 11 条消息逐值保持；最终共 51 条消息。此前记录的 40 个 plaintext reasoning 项仍保留原类型、内容项及 opaque 字段，没有用发送投影覆盖历史。
- 原两个交付文件哈希保持，网站凭据文件字节未变，原生 ChatGPT 登录保留；切换没有退出任何账号。
- 最终隔离资料来源为 `website`。所有验收引擎停止，owner 锁、CLI 锁与持久租约均释放；最终产品文件 hash 与真实验收记录一致。日常运行中的 Homer 未改动，其他未提交工作保留。

脱敏证据位于 `.codex/scratch/dual-source/history-compat/`：`probe.json`（只留结构）、`live.json`、`live-final.json`、`live-verified.json`、`reverse-verified.json`、`verification.json`、`preservation-final.json`、回归输出及验收脚本。首轮失败证据仍在 `.codex/scratch/dual-source/live-20261102/`。`verification.json` 将最后两份记录合并核对，并明确保留额度查询缺口，没有将辅助查询失败改记为整脚本成功。私有数据库维护点只保存在 Git 忽略目录，没有凭据副本。

范围：本次验证了当前源码和固定引擎中的真实推理链路，未构建或安装新桌面包，未重做按钮、全部渠道、全部原生工具或长对话压缩验收；不代表这些项目已经通过。

## 本机已安装版本与原日常资料复验（17:37–17:50）

本轮结论为**部分通过，双来源真实推理尚未完整验收**。沿用 `/Applications/Homer.app` build 152（源码清单 `f4289f53f992f22581778401fa6aec84b6367a3643fbb943bb1a8088f6867f18`）、包内 Node 22.22.0 与 Codex 0.163.0。实际加载安装包内的 `Homer`／`CodexEngine`，使用日常版原资料、工作目录、Codex Home、原生账号、旧荷马凭据及原主 thread；与上文隔离资料的通过记录分开评价。

按角色设置临时 CONNECT 观测器，转接本机原代理；只记录目标域名，不解密 TLS、不记录凭据或请求体，不修改系统代理。App 与观测进程分阶段独占原资料，每阶段确认全部停止后才进入下一阶段。两次来源变更均通过已安装 App 的“应用并重启”及原生确认按钮完成，没有直接改来源文件。

| 阶段 | Main 实际配置／流向 | Worker 实际配置／流向 | 真实结果 |
| --- | --- | --- | --- |
| 初始 Codex | `gpt-6.1-sol / medium / Fast false`，`openai`，原生 ChatGPT 登录，`chatgpt.com` | 独立业务 Worker，`gpt-6.1-sol / high / Fast false`，`openai`，`chatgpt.com` | Main 委派、Worker 交付 2021、Main 验收结算均成功；未启用荷马 Token |
| Codex → 荷马 | 同一主 thread，`deepseek-flash / high / Fast false`，`homer`，旧荷马 Token，`models.super-tree.com` | **未创建，未验证** | 首轮推理失败；宿主记录 `engine_rate_limited`，未完成跨来源回忆，未由验收脚本重放该请求 |
| 荷马 → Codex | 同一主 thread，恢复原生 ChatGPT 配置，`chatgpt.com` | 本阶段不要求新建 Worker | 新请求成功回忆 Codex 口令、荷马失败请求中的口令及已完成的 2021；明确荷马 Worker 未执行。此项仅证明失败后能在原对话继续，不能替代荷马成功续聊 |

只读额度查询成功，旧荷马凭据当前可用 **5.65604 积分**。`engine_rate_limited` 同时涵盖限流与额度类拒绝；现有脱敏证据不足以进一步确定是哪一种，不能把低余额直接当作唯一根因。未充值、重新登录、退出账号、自动回退来源或重放不确定操作。目标域名、实际 provider 和完成状态共同支撑流向结论；没有供应商逐请求账单，CONNECT 次数不代表推理次数。

原日常资料最初 **2144 条消息逐值保持**；主 thread、binding、既有 native rollout 字节前缀、资料采用记录、源配置、旧荷马凭据和原生认证文件字节均保持。本轮仅新增 1 个 Codex 业务 Worker，task 为 `settled / succeeded`，run 为 `succeeded / ended`；荷马失败阶段没有新 run。验收引擎退出后持久租约为 0，CLI／desktop owner 锁均释放。最终来源恢复为开始时的 `codex`，随后重新打开原 App，页面再次确认 Codex 生效且默认选中 ChatGPT 卡片、原凭据仍已连接；没有修改产品代码、重新打包、提交或发布。

账号页面实际确认：Codex 生效时默认选中 ChatGPT 卡片；荷马生效时默认选中荷马卡片，显示“已连接（原凭据）”，Codex 仍为已登录。自动重启后电脑控制工具两次返回 `noWindowsAvailable`，即使用户已显示窗口仍不能绑定；用户协助正常退出并停止工作后，重新打开可继续控制。此处是桌面控制验收缺口，不能据此声称重启后的窗口恢复完全通过。

脱敏记录及带断言的临时验收脚本位于 `.codex/scratch/dual-source-real-installed-20261102/`：三阶段 JSON、`website-failure.json`、`website-wallet.json`、`preservation.json` 与汇总 `verification.json`。运行前的业务及网关数据库维护点留在 Git 忽略的 `.codex/private/dual-source-real-installed-20261102/`，没有备份凭据。尚缺荷马成功推理、荷马 Worker 流向及两边均成功的双向续聊；需在上游拒绝原因解除后另行继续，不应将此前隔离资料的成功替代本机当前账号结果。


## 额度与限流分类修复（源码，未更新安装包）

后续只读核对固定 Codex 的原生日志：17:43:57–17:44:22 同一主 thread 的五次拒绝均为 HTTP 403，明确包含 `token quota is not enough`。Token 可用 5.656040 积分、请求预留需要 35.238560 积分，属于 Token 额度不足；预留金额不能当作最终账单。同期没有 HTTP 429 或限流证据。此前仅凭宿主错误码无法区分的缺口由此收敛，原始验收记录保留。

最小修复沿用 `src/engine.ts` 的唯一原生错误分类入口：明确的不足信号映射为 `engine_quota_insufficient`，HTTP 429／rate limit 映射为 `engine_rate_limited`；仅出现 quota 的未知错误保持通用失败，不推断为额度或限流。Main 沿已有失败回复与 `input-outcome` 显示安全中文原因；Worker 启动失败复用已有错误白名单，不公开供应商原文。没有新增提醒组件、数据表或凭据逻辑。

荷马 provider 的 `request_max_retries` 和 `stream_max_retries` 均设为 0，Main／Worker 共用该设置；不修改原生 ChatGPT 账号或另一来源配置。固定 Codex 0.163.0 配合 loopback 假服务的 Main／Worker × HTTP 403／429 四例均只产生一次模型请求；连同原有 MCP 用例共 5/5 通过。合成宿主、原生协议、Worker 提示和对话投影定向回归 82/82 通过；最终 `npm test` 核心回归 1882/1882 通过，类型与差异空白检查通过。实际隔离网页已确认两类中文说明可见；仅改宿主返回文本会被已有原生答复投影隐藏，因此使用既有送交结果位置展示，未冒充模型答复。

本轮没有真实推理请求、充值、登录、来源切换、日常资料写入或安装发布；本机 build 152 仍是旧分类。账号、历史及原主对话未操作，用户的其他未提交工作保留。提醒视觉设计另在用户独立的 Impeccable Live 对话中预览，未接入正式 UI。


## 已确认提醒设计接入正式 UI（源码，未安装）

用户在独立设计对话确认中性卡片，并明确要求同步原对话接入正式 UI、充值复用现有入口。正式组件复用 `ui/desktop-permissions.tsx` 中的桌面账号桥接及原设置 Dialog，放在原输入区上方，与 Composer 同宽。白色面、暖灰边框、炭灰文字、深色“充值”及“查看账号与额度”沿确认稿；默认不显示金额，也不显示金额未知的占位说明。正式 copy 与交互约定已维护到 `ui/DESIGN.md`。

当前宿主仅在内存提供 `modelFailure`：原失败消息身份、三类安全错误码和来源，随既有 WebState 发布；新请求开始清除，服务重启不从历史重建，不新增数据表或通知存储。额度不足、明确限流与未知失败分开；旧错误文字及旧 `main_turn_failed` 日志均不作为额度不足证据。原持久失败记录、主 thread、账号和任务语义保留。

充值按钮仅对明确的荷马来源及可信桌面账号桥接开放，调用已有 `openWebsite`：沿原主进程固定 origin 打开 `/homer`。未新增支付地址、订单、IPC 或登录操作；Codex 额度不足不提供荷马充值按钮。账号操作经原 dirty guard 打开同一个设置 Dialog 的账号页，Escape 关闭返回准确入口。关闭提醒只收起当前卡片、回焦输入框，不发送、重试、切源或修改请求状态。打开网站失败显示安全提示，不暴露原始异常。

验证：先记录结构化信号及组件接线缺失的 red，再实现；定向宿主／设置／对话投影 61/61 通过，最终核心 `npm test` 1888/1888 通过，前后端类型检查通过，隔离 Vite 构建通过（保留已有大 chunk 提醒）。正式渲染使用真实 Homer 合成引擎、隔离 SQLite 和模拟桌面桥接，没有真实账号、推理或支付。实际核对充值调用、同一账号 Dialog、Escape 回焦、关闭保留草稿和新失败重新显示；限流和未知失败没有充值或重试按钮。390px 与 320px 均无横向溢出、卡片与 Composer 左右边界一致，窄屏所有操作高44px。浏览器未观察到 error／warn。

合成证据留在 `.codex/scratch/quota-reminder-live-20261102/`：`integration-red.log`、`integration-green.log`、`core-tests.log`、前后端类型与 UI 构建日志、`integrated-desktop.jpg`、`integrated-mobile.jpg`、`integrated-320.jpg` 及隔离预览脚本。设计预览的模拟支付弹窗未复制到正式 UI。未真实充值、重新登录、真实推理、操作日常 App、安装、提交或发布；实体手机、屏幕阅读器及真实服务跳转仍未验收。
