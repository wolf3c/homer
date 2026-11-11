# 原生记忆替代：实施要求与固定版本验收

## 当前源码边界（2026-11-04）

旧 Homer 记忆工具、业务表、快照注入和管理接口已经退役。`src/engine.ts` 只在原生能力且使用 Homer 专属 HOME 的分支启用 `features.memories` 与 `memories.dedicated_tools`；受限分支关闭。新 Main 的原生线程默认 memory mode 为 enabled，新 Worker 为 disabled，恢复已有线程保留其原模式，不按新角色重写。工具可用与线程是否参与后台生成是两件事。

普通来源不覆盖原生 extraction 模型或生成策略；桌面 DeepSeek 分支按实际选定模型设置 extraction/consolidation，并仅允许新 Main 生成。记忆文件、汇总和采用由 Codex 管理，Homer 不提供第二套记忆库，也不承诺记忆质量或费用硬上限。

离线入口：`tests/native-memory-only.test.ts`、`tests/native-memory-engine.test.ts`；固定引擎的实际线程模式检查为 `tests/native-memory-defaults-offline.test.mjs`，属于显式 engine 专项，需要独立 HOME 和已有固定二进制。见[测试边界](testing.md)。

## 历史实现与验收记录

以下日期、部署状态、旧模块和通过数只描述当时版本，不是当前待办、当前运行状态或回退要求。

更新：2026-10-22。维护源码只保留 Codex 原生记忆，旧 Homer 自建后端、七个 `memory_*` 工具、Worker `suggest_memory`、旧 Web/IPC 管理入口和旧记忆迁移脚本已移除。不再提供后端选择、旧记忆快照注入或旧数据兼容。

原生记忆由 `src/engine.ts` 在 Homer 专属 HOME 的原生能力分支启用，存储、检索、采用和后台汇总仍由固定 Codex 管理；受限引擎分支保持原生记忆关闭，不回落到自建记忆。Homer 不再创建记忆业务表或运行空的记忆适配器。用户要求通过主对话交给原生工具处理，记忆内容不能代替执行授权。

本次源码清理未操作生产数据库、原生 HOME、原主线程或部署。验证使用合成引擎与离线协议端，不以此声称重新完成真实模型记忆效果验收。旧后端已经退役；下文保留此前原生接入和后台行为的历史证据，所列旧源码、迁移脚本、配置开关及当时版本不是当前可执行入口或回退要求。

2026-10-22 清理验证：Node 22.22.0，本地服务及 Web 完整构建通过。新增 `tests/native-memory-only.test.ts` 三项合同检查通过，覆盖原生及受限分支均不再出现旧工具/旧表、原主线程及工具指纹恢复、旧 Web 管理接口返回 404；原生配置和 Worker 结果链使用离线协议端及假引擎验证。审阅阶段当前工作区十二份定向测试共 65 项通过；清理前源码仅叠加本次差异的隔离副本服务编译通过、对应 64 项通过（不含后来新增用例）。新增 Worker 卡片测试中的一个旧钩子空引用已清理，其九项检查通过。此前两批相关回归分别为 203/208、168/173 通过；共九项失败均在清理前源码基线上复现，一项升级交接构建用例在 120 秒超时，保持未验。完整类型检查仍为相同的 18 条既有诊断，没有新增诊断。未更改这些无关问题以换取通过。

## 历史发布状态（2026-10-19）

### 当时切换结果：原生 note 后端

**2026-10-19T02:00:21Z日常4780由原更新器完成原生后端切换；汇总政策修正采用版为 `02d9a13051eb`；后续首次初始化接线采用后的当前日常版本为 `36ba44e97bfc`，唯一记忆权威为 Codex0.163原生 note。唯一原有已确认记忆已迁移，原主对话重连后原生检索/读取通过。** 旧 Homer 后端已停止保存、检索、注入及候选提升；原条目/来源/操作/任务表和只读备份保留，不参与当前记忆采用。没有双系统同时写入，也没有把代码采用当作迁移完成。

全量验收仍未通过：初始化接线整合后的实际共享源码原始 `npm run check` 退出1，508通过、4失败、0取消、2跳过；剩余为网关启动、更新器30秒编译终止、音频和Office本机解码超时。定向72项通过不能代替全检，具体日志、同源对照和预算证据见[首次初始化实际采用记录](32-first-launch-initialization-skill-requirements.md#历史触发接线的实际采用与验证边界)。整合前492通过/1取消等结果保留为阶段历史，不冒作最新全检。

2026-10-19T03:15:11Z首次初始化接线维护已由原更新器采用；原生note文件、旧记忆表、原thread、认证、微信及6条uncertain复核保持，没有重复迁移。初始化Skill实际采用及整合后的最新完整检查统一见[首次启动初始化Skill](32-first-launch-initialization-skill-requirements.md#历史触发接线的实际采用与验证边界)；下述492通过/1取消为该次整合前的记忆续接验收记录。

用户已通过持久文字明确接受原生后台汇总及额外模型用量，知悉失败重试无法保证固定总调用或费用。因此先前费用许可阻塞已解除，不再提问。旧 rollout 自动提取仍关闭，不因汇总授权重新提取历史。此前接受的撤回与保守 Worker 失效语义继续有效。

| 当前检查 | 真实结果 |
| --- | --- |
| 数据归属 | 原生记忆实际落在 `~/Library/Application Support/Homer/codex/memories`，专属 CODEX_HOME 绑定保持；不读写全局 Codex、不复制鉴权或其他会话 |
| 原主对话 | 保持 `01a14cdb-1d34-7600-b067-2f1eb4928132`；迁移前后主引擎91128→92715，thread不变，真实 `search/read` 已通过 |
| 迁移 | 1条 active owner→1条真实原生 note，正文hash一致；1条来源映射及最终正文/版本保留在私有只读计划和旧源备份。临时导入文件核验后移除 |
| 单一后端 | 真实 `/api/memory` 返回 backend=native；主引擎原生工具开启、旧 rollout提取关闭；旧 memory_* 不在启用目录，历史写入口明确409 `memory_native_tools_required` |
| 旧源保持 | entries1、sources1、operations1、jobs39、suppressions0、snapshots0；迁移和召回后均未增加或改变。不是通过清空旧数据实现停用 |
| 渠道与工作 | 原启动器/工具指纹、专属ChatGPT连接、微信connected及6条 uncertain 保留；原业务既有行保持，没有回套业务DB、重放或外发 |
| 草稿与界面 | 切换时原标签页草稿及UI hash核验保持。后续复核时原标签页已不在调试列表，不能再次声称当前草稿已核验；未重开或操作其他页面。无UI改动，无配置入口新增 |
| 原生撤回 | 停止采用＋保留撤回说明；旧正文仍可能search/read，不声称物理删除。原主thread七步真实验收沿用已通过记录，不重复合成偏好请求 |
| Worker保护 | 原生文件变化保守使所有使用过记忆的未发布成果失效，拒绝迟到工具及旧审阅/纳入/发布，不自动重派。nativeRevision已推进，当前11项定向契约全部通过 |

### 本次执行与验收

- 当前版本一致性备份、只读源、恢复副本完整性/数量/thread校验及1→1迁移干跑均退出0。维护点为 ignored private 下 `before-1792375090926`，匹配切换前 `9cee268c19a7`。
- `native-note-authorized-cutover.mjs` 的prepare/publish/verify均退出0；候选 `bc9926d0fb44` 仅增加内部后端/已接受调度配置，没有修改主thread、连接或业务schema。
- `scripts/native-memory-import.mjs --stage/--import/--verify`均已实际完成。原生add/read及重连后search/read均被观测，文件hash匹配。本次仅2个原主对话真实前台请求，无Worker或外发。后台另有原生汇总尝试，其token/费用未完整观测，不计入前台用量冒充总费用。
- 重连验收脚本在真实verify完成后发生一次状态读取 `TypeError`；导入回执已是passed。以原请求ID、工具记录、前后PID和当前原thread只读恢复确认通过，未重发任何模型请求；失败回执保留。
- 切换前本轮完整 `npm run check` 退出0：490通过、2项历史专用验收跳过。切换后11项原生Engine/Service/Worker/fence/递归成果定向检查退出0；汇总提示词后续候选检查单独记录，不将前批结果冒作后续结果。
- 初始化整合前运行只读核验于2026-10-19T03:00:51.544Z退出0，确认当时版本02d9a13051eb、迁移1条、原thread及单一原生后端；回执状态为 `runtime_verified_with_test_failures`，明确区分运行核验通过和全检仍有取消。该记忆检查续接阶段未改生产源码/提示词/配置，原已切换后端保持，未重复迁移或真实七步请求。普通最终核验回执 `native-note-cutover-verification.json` 只含数量、hash和状态；私有计划、旧源及原生备份不作为公开交付，不输出敏感正文。

### 后台汇总的真实限制与修正

**2026-10-19T03:21:58Z最新只读核验：真实 `memory_consolidate_global` 已是 `done`、`last_error=null`，`MEMORY.md` 1701字节、`memory_summary.md` 901字节，非空且hash已留证。** 日常正常使用后自然完成，未人工加速退避、修改job、预置摘要或重复真实记忆请求；旧rollout提取仍关闭，stage1输出0、原生thread数1。此前 `failed_invalid_artifacts` 已是历史失败，不再作为当前阻塞。证据为 `first-launch-current-runtime-and-checks.json`，只含状态、数量、大小和hash；本次未读取或回传摘要正文。该成功不证明有费用硬上限、后续每次汇总成功或已重验所有摘要内容。

新维护脚本 `scripts/native-memory-consolidation-output-probe.mjs` 用固定0.163、无凭据loopback及全新临时HOME，验证原生内部汇总通过其真实Shell工具在获准memory_root写出两个合成文件后，job进入done。最初here-document因沙箱不允许系统临时文件失败，直接输出方式通过；没有扩大权限、改真实jobs、在真实HOME预置摘要或把合成通过当作真实汇总成功。

该实测也证明内部汇总会继承主提示词。原生政策已明确Homer业务派工/材料/成果步骤的适用范围，并提示内部汇总按原生任务写获准目录、避免依赖系统临时文件；不授权主对话绕过权限。此项旨在消除已证实的提示词继承所带来的潜在冲突，不把它声称为真实模型未输出文件的唯一根因。17项定向检查通过；原更新器prepare/publish/verify均退出0，采用版02d9a13051eb。原生失败退避未被加速，当时修正后的真实汇总仍待自然输入验证，现已由上述done实证取代；未新增循环请求，也不承诺三次封顶。

实际账户配额在2026-10-19T01:59:31Z返回周窗口已用24%、hasCredits=true、unlimited=false；没有取得固定余额或总费用保证。Cindy宿主只读状态返回本任务运行中，未暴露剩余时限/费用预算；本条消息不代表延长deadline。

### 汇总政策采用的维护点与检查

政策更新前维护点匹配原生已启用版bc9926d0fb44，独立保留当时业务/transport配置与源码、当前原生SQLite完整性副本及2份note（1条迁移事实＋1份此前合成撤回），不复制鉴权或rollout。准备日志曾复用启用前的backendSelected/legacyStillEnabled展示常量，运行配置和后续verify均为native；该展示已修正，保留原日志，不能用那一行推断后端曾退回。

两次候选全check分别出现3项、2项网关/更新器相关超时，保留退出1日志；候选单独按文件串行重跑网关/更新器3项全部通过，没有改断言或放宽超时。最终实际源码默认并行全check退出1：484通过、6失败、2跳过；随后 `npm run check -- -- --test-concurrency=1` 完整构建/类型检查，但并发参数位于文件列表后未生效，仍为并行测试，退出1：488通过、2失败、2跳过。剩余为 `tests/dev-upgrade.test.mjs` 的 `dev_test_timeout` 和 `tests/web-dev-host.test.mjs` 的 `web_dev_test_timeout`。原生记忆定向检查通过；不将前批490通过或候选定向通过冒作本次全量通过。失败日志保留为 `native-note-final-root-check.log`、`native-note-final-file-serial-check.log`，实际源码独立 `node --test tests/dev-upgrade.test.mjs` 退出0、2通过；实际源码独立 `node --test tests/web-dev-host.test.mjs` 也退出0、1通过。两项全检失败路径独立复核均通过，但全检本身仍为退出1，不声称干净全绿。不修改断言、超时或生产更新器。

### 全检失败定位与 fixture 修正（2026-10-19续接）

两项确切失败分别为：

| 用例与原失败路径 | 观测与定位 |
| --- | --- |
| `tests/dev-upgrade.test.mjs` / HMR-UPGRADE-001，原第56行 | 等待首个候选“构建检查通过”，抛 `dev_test_timeout`；该轮用例33.64秒。旧helper每次只给20秒，短于生产单次编译允许的30秒，且未将候选拒绝与真正等待区分 |
| `tests/web-dev-host.test.mjs`，原第34行 | 初次等待running，抛 `web_dev_test_timeout`；该轮用例45.39秒。启动包含服务编译、UI类型检查、Vite及导入/引擎恢复，旧45秒不是这条多阶段流程的生命周期上限 |

此前没有保留这两次失败时子进程的逐阶段计时，不能反推唯一系统原因或断言每次都是CPU竞争。补充的默认并发完整诊断检查退出0、490通过/2跳过，记录27个编译/Vite阶段（最长10.435秒），观察到8个可用并行度、系统负载最高19.25；其中预期的坏源码编译退出1属于原回退验收步骤，整体检查通过。资源竞争符合历史现象，但这次成功不能单独证明历史根因。已证明且可修复的是fixture期限与真实构建生命周期冲突，未见原生记忆产品路径回归。

`tsx`参数探针中，两份500毫秒合成测试放在文件参数后传`--test-concurrency=1`，START时间相同（1792377467526），因此先前“串行已排除竞争”的说法撤回。没有据此修改package并发配置、串行化测试或扩大产品编译超时。

修正仅在两项测试及共享fixture helper：构建就绪使用原有120秒TestContext.signal，遇到候选拒绝或进程退出立即明确失败；原状态/内容/进程/线程/回退断言和120秒总上限保持。非构建业务等待保持原边界。确定性时钟反例复制旧20秒轮询后，命令 `node --test --test-name-pattern='valid build' tests/dev-fixture-wait.test.mjs` 退出1、`dev_test_timeout`；修正后3项测试退出0，覆盖合法构建跨过短轮询截止、候选拒绝立即报具体code、进程退出和父级取消终止等待，不依赖机器负载或盲目重跑。

修正后的原始默认并发 `npm run check` 退出1：490通过、3失败、2跳过；无计时preload、不加串行参数。原Web用例通过，更新器在共用main忙碌更新构建时立即报 `dev_fixture_build_rejected:dev_candidate_check_failed`，另有网关第48行恢复等待与TG第44行更新等待超时。此时观察系统负载40.87/并行度8；尚无这次失败编译的退出信号，不能仅凭高负载将它定为外部阻塞。6份构建回归fixture集中诊断检查已退出0、13通过，仍不能替代全检。两项fixture已增加持久的本地编译阶段记录，仅含阶段、耗时、退出码/信号、负载；失败时带入诊断，不含参数、配置或输出正文，诊断写入失败不改变编译行为。随后一轮完整默认并发检查退出1，486通过、7失败、2跳过，记录在 `native-note-fixture-evidence-full-check.log`，下方给出具体阻塞。生产代码、提示词与运行配置未改，版本仍02d9a13051eb，无需为纯fixture/文档改动重启日常或重复迁移。后台汇总、旧rollout策略、原生数据和业务数据保持。

### 历史全检的30秒编译终止证据

保留fixture诊断后，原两项失败均再次出现，已从泛化轮询超时定位到实际TypeScript子进程：

| 同一默认并发全检中的构建 | 实际退出 |
| --- | --- |
| updater首个候选（e2e-kkxC6T） | TypeScript 30125毫秒，code=null、signal=SIGTERM；记录负载28.79/可用并行度8。初次同fixture编译7433毫秒、code=0 |
| Web初次构建（web-dev-w5rt2w） | TypeScript 30022毫秒，code=null、signal=SIGTERM；记录负载63.83/可用并行度8 |

这与未修改的 `scripts/dev-build.mjs:command` 中 `spawn timeout:30000`、默认SIGTERM一致：构建预算到期后真实拒绝，helper没有把它隐藏为通过，也没有获得TypeScript编译错误码。Node22.22.0/TypeScript5.9.3依赖保持。另一次读到机器内存24GiB、memory_pressure空闲53%；不将该失败称为已证实OOM。高负载是观测条件，不宣称还原每个旧进程的全部调度原因。

全检结束后，用原失败updater fixture的同一份源码/hash、同一 `buildCandidate` 与原30秒阶段上限做受控重编译，退出0、6004毫秒、源码hash前后不变（`exact-failed-source-recompile.json`）。这排除了该候选稳定的源码编译错误，明确暴露全检环境下执行预算不足；不等同于全检通过。Web同源对照也退出0、7500毫秒、源码hash不变，见 `exact-failed-web-source-recompile.json`。

该历史轮其余5项失败保留，未无证据归入同一原因：网关候选安全边界等待 `gateway_fixture_timeout`；pinned回退初次启动 `pinned_test_timeout`；TG更新等待 `telegram_host_fixture_timeout`；音频端到端 `media_decode_timeout`；voice-result未产生实际ASR来源断言失败。音频路径使用本机whisper-cli/base模型，生产ASR预算90秒未修改。这5项及Web用例在下述最终原始全检中通过，不再列作当前未通过用例；历史失败原因没有因此全部还原。

### 初始化整合前完整检查：当时剩余120秒整体验收边界

为区分编译、媒体及宿主恢复阶段，补充临时全局计时观察器的一轮完整 `npm run check` 退出0，493通过、2跳过（`native-note-remaining-failures-diagnostic.log`）。真实本地ASR两次分别19413/15521毫秒退出0。该观察器可能改变调度，不能用这次成功替代原始命令。

随后移除全局preload与并发参数，执行原始 `npm run check`，退出1：492通过、0失败、1取消、2跳过，总495项，耗时136354.8135毫秒；日志为 `native-note-uninstrumented-final-check.log`。未通过项只有 `tests/dev-upgrade.test.mjs:21` 的 HMR-UPGRADE-001，120023毫秒被 `testTimeoutFailure` 取消（既有总上限120000毫秒）。不能声称其全部后续断言执行完成。两项合成fixture的本地子进程阶段诊断仍开启，不将此称为完全无观察器。

同轮 updater fixture `e2e-CPBorE` 记录如下；时间相对fixture建立，并非精确测试起点：

| 编译序号 | 耗时毫秒 | 相对完成毫秒 | 退出码 |
| --- | ---: | ---: | ---: |
| 1 | 28150 | 29382 | 0 |
| 2 | 22120 | 55015 | 0 |
| 3 | 16321 | 74816 | 0 |
| 4 | 10777 | 88060 | 1（预期坏源码回退步骤） |
| 5 | 7824 | 96847 | 0 |
| 6 | 6589 | 104665 | 0 |
| 7 | 6032 | 113466 | 0 |
| 8 | 11317 | 126649 | 0（已跨取消时刻） |

每阶段均在原30秒编译预算内；第一阶段合法构建28.150秒也直接证明旧20秒fixture轮询过短。前7段编译累计97.813秒，含取消后完成的尾段共109.130秒，不能把全部109秒记作取消前耗时。启动时负载9.26/并行度8，阶段退出时负载最高63.26；这是当前宿主默认并发下真实执行预算边界，尚不能证明所有历史失败具有同一系统原因，也未证明原生记忆产品回归。

本次没有提高120秒测试总上限或生产编译/ASR预算、给suite加串行、修改原断言或停止其他用户进程。完成干净全检仍需在资源稳定的执行环境中保留原预算验收；若该环境仍不满足，再单独审阅多次构建整体验收的拆分方案。当前不再碰运气重复运行、不将带观察器的一轮全绿作为关闭依据。生产源码、提示词和配置在本次fixture修正后未改，日常仍为02d9a13051eb，无需因纯fixture/文档改动重启；未回退原生数据、重复迁移/真实七步请求或增加原生汇总请求。

### 保留迁移后的回退边界

源库及恢复副本保留只读，专属原生note及撤回历史始终保留。配置撤回不能直接重新采用旧事实：生产护栏在出现native指纹后拒绝静默回到旧后端，要求逐项对账切换后的新增note/纠正/撤回，前向处理后选择唯一后端。禁止整库回套业务DB或重放结果未知请求。当前无需数据回退。

## 历史实施与验证记录

下文截至各标题所载时间，包含“未切换”“未导入”和此前空答复记录，均属于已经被上方当前状态取代的历史阶段。保留失败、许可变化及当时未验项以支持审阅，不将它们当作当前阻塞。

更新：2026-10-19。用户最新明确要求：**“Codex 原生记忆替代，这个应该做了，改用原生，数据放在 Homer 应用数据目录下”。已授权实施必要的专属配置、现有 Homer 自身记忆迁移及通过验收后的安全上线。** 同一原主对话保存、重启召回、纠正、遗忘及 Worker 保护仍是完成门槛；已有记忆必须保留，切换后两套不同时运行。不读写共享 `~/.codex`、不复制鉴权、无关会话或私人记忆。以下历史探针结果保留，不能把本次授权或方案当作已完成切换。

**启用前历史结论（已由上方当前状态取代）：尚未切换后端。真实原主对话的原生 note 七步闭环已通过，单一后端及保守 Worker 保护代码已实施；旧服务继续提供唯一记忆来源。** 本轮已实施 Engine/Service 的专属主引擎原生工具接线、固定版本校验、迁移备份/干跑脚本及隔离/真实验收。预检版本 `c0fe0dc1a1c9` 经原更新器采用后，原 thread 成功完成保存、同 thread 召回、自动重连召回、纠正、撤回、再次重连后撤回及清理后召回。后台汇总实际失败于缺少 `MEMORY.md`（`failed_invalid_artifacts`），逐条物理删除/revision 精度已按用户明确接受的撤回和保守失效语义处理；当前真正剩余的限制是原生 note 与无法单独关闭的、无次数硬上限的后台汇总绑定。七步通过不能掩盖该调度冲突。

预检开关关闭阶段为 `d6e80ede1c82`。后续接线代码经原更新器采用为 `5d32bc955599`，Worker 提示词分离后为 `d9765841315c`，回退与隐私保护完善后为 **`9cee268c19a7`**；三次均保持原配置，未选择原生后端，旧记忆服务继续运行。未导入唯一真实记忆、未更换原 thread、未恢复旧业务 DB。两份自有合成偏好 note 已清理，保留一份明确撤回 note，防止后续误作有效偏好；没有宣称物理清除会话历史。历史证据和本轮实测应分开阅读。

## 历史基线：本轮真实采用与剩余决策（2026-10-18）

| 项目 | 观察结果 |
| --- | --- |
| 代码归属 | 本任务完成全部相关生产 TS、脚本、测试和文档；没有等待其他 writer 或将未实现工作记成完成 |
| 原生接线 | `Config.nativeMemoryTools` 为无 UI 的内部验收开关；仅允许专属 HOME 的原生主引擎，拒绝 Worker/control/shared HOME；检查二进制0.163.0及有效 features/use/dedicated_tools；提取保持关闭 |
| 旧后端边界 | 预检不选择新后端，旧注入/保存及 Worker fence 保留；当前配置已撤去验收开关。此项是必要真实验证接线，不是最终双后端产品方案 |
| 七步实测 | 同原 thread，7个原队列真实模型请求；每步核验实际 `memories__add_ad_hoc_note/search/read` 调用，除保存外各步均查原生存储；自动子引擎 PID 两次变化，thread不变，纠正后为amber，撤回/清理后为null |
| 异常修正 | 独立 peer恢复原 thread 被现 owner拒绝 `thread/resume -32600`，未启动模型轮；改走原 owner。首轮验收脚本误读队列字段退出，原请求实际完成；修正后恢复已完成请求，未重发保存 |
| 后台汇总 | 原生 `memory_consolidate_global` 实际 `error / failed_invalid_artifacts`，日志定位缺少 `MEMORY.md`；stage1输出0。固定重试延迟3600秒，字段 retry_remaining=2（不是实际调用上限，见后续专项实测）；关闭验收开关阻止后续启动重试。未修改真实 job表、预置/伪造摘要或将主轮token当后台用量 |
| 费用边界 | 原生提取/汇总模型显式使用当前gpt-6.1-sol，当前专属ChatGPT账号及模型目录核对通过。loopback观察12次前台+1次后台；generate=false和空environments均不保证零后台。真实后台token总量未观测，不宣称硬预算或已完整核算 |
| 备份与干跑 | 新维护点业务/原生SQLite备份、恢复副本完整性及数量/thread校验通过。原库备份设只读；1条active owner→1条native note，1条来源，pending/non-owner/suppression均0，最终正文hash一致。计划只存私有目录，未向模型发送原始事实，未实际导入 |
| 数据保持 | 正常更新两次均保持原终端owner、原thread、UI及草稿、微信连接和6条uncertain；回退只撤去验收配置，不覆盖业务DB，七步新增请求记录及原生撤回note仍保留 |

**用户已明确接受的语义（2026-10-18后续持久指令）：** 忘记采用“停止采用＋追加撤回说明”，历史 note 和聊天正文可保留并被原生 search/read 返回，不宣称物理删除；旧 rollout 自动提取保持关闭。任何原生记忆变化都保守使所有使用过记忆的未发布 Worker 成果失效，不保存第二份事实、不自动重派，等待用户明确重做。这两项已经决定，不再以先前工具回执空值为阻塞。

候选已补齐单一原生后端和元数据失效接线：主 MCP 移除历史 memory_*，旧自动保存/注入/成果候选提升停止；Worker 无原生全库与 suggest_memory。原生文件变化在任务关键边界同步核验，已有 memory_snapshots 只保存指纹版本，新增/纠正/撤回、重启、拒绝迟到写入和旧成果审阅/纳入/发布均已有隔离测试。候选尚未据此切换真实配置或导入唯一记忆，接线代码及 Worker 提示词已由原更新器采用（阶段版本 5d32bc955599 → d9765841315c → 9cee268c19a7），后端配置保持旧服务。

**独立的后台调度限制：** 固定版没有官方 note-only 后台关闭开关。`memories/write/src/start.rs` 在每个符合条件的根输入轮检查 memories feature，然后始终依次调用 phase1 和 phase2；`generate_memories=false` 只阻止旧 rollout 提取资格。原生 memories 工具扩展也要求同一 memories feature 和 use_memories，关闭 feature 会同时失去 note 工具。临时会话或伪装 subagent 会改变持久化/来源语义，不能用于当前原主对话。配额门槛失败时 guard 默认放行，100%门槛也不是硬停。最新专项 loopback 还证实 retry_remaining=0 不阻止 phase2 再次调用，已更正先前“剩余2次”的含义，并向 CTO 提交“保持旧后端等待原生开关 / 明确接受无硬上限的原生汇总”的选择；不重问已接受的撤回和 Worker 语义。

完成命令与证据（退出码按日志/进程回执）：

- 隔离Engine/Service行为测试先RED退出1，接线后GREEN退出0；候选完整 `npm run check` 退出0，481通过、2跳过。
- `scripts/native-memory-lifecycle-acceptance.mjs` 无凭据loopback退出0，最新 `lifecycle-XheHgo`；同thread读新note通过，撤回后旧note仍可搜索/读取。曾以“空environments禁后台”断言失败，已按真实源码和实测纠正，未隐藏该失败。
- `scripts/native-memory-main-queue-acceptance.mjs --run-existing-thread .codex/private/local-chatgpt.config.json --continue-existing-remember` 退出0，七步均completed；真实回执 `main-queue-native-lifecycle.json`。
- `scripts/native-memory-migration-preview.mjs` 和 `scripts/native-memory-migration-dry-run.mjs` 退出0。普通回执只有数量/hash/目录；私有计划不属于用户交付文档，也不是运行中的第二记忆库。
- 正常预检采用/撤去的prepare、publish、verify、close、verify-closed均退出0；回执 `native-tools-preflight-release.json`、`native-tools-preflight-closed.json`。首次root全check因发布脚本未保持可执行fixture模式而1项spawn失败，已保持模式并移除新测试对共享fixture的chmod；修正后6项定向测试和root完整check均退出0，root为481通过/2跳过。跳过的是历史固定图标发布两项受控专用验收，不是本轮原生契约。

预检关闭批次的只读复核：源码完整hash `d6e80ede1c82e3db67e89f0a2ff838e00033b32f73c5c3e98a357e441a824f86`；固定二进制SHA-256 `8813367285524ac798dd96d1b071aea30d58708c7226fd236cd275cf1cfdee31`。`verify-native-memory-handoff.mjs` 退出0，核对切换前原业务各表的既有行hash未丢失/变化（渠道连接generation除外）、唯一原thread、草稿、工具hash、原生配置原字节恢复及后台无running job。实际7轮前台计数为input 1,642,357（cached 1,636,864）、output 66；此数据来自原生rollout本轮token事件，不能代表后台汇总用量。最后备份仍为1条条目/1来源/1操作，来源job从32增加为39，七次验收请求保留。最终回执 `native-memory-adoption-verification.json`。

预检批次变化（不含后续后端接线）：`src/config.ts`、`src/engine.ts`、`src/service.ts`；测试为新增两项原生接线契约及固定fixture有效配置回读。未改UI/提示词文件/Skill、业务schema、五项主工具、渠道及审批/续接逻辑。恢复预演仅作用于副本；未来切换回退仍须保留新增原生事实、逐项前向处理，不准整库回套。


### 历史基线：后续生产接线与安全采用（仍未切换）

- `memoryBackend="native"` 选择唯一原生后端，且必须显式记录 `nativeMemoryBackground="native"` 的已审阅调度策略；目前真实配置没有这两项。该字段承认原生调度，不实现费用上限。
- 生产代码新增 NativeMemory 元数据 fence；原 Memory 仅用于未迁移模式。原生模式移除主 MCP 的 memory_* 和 Worker 的 suggest_memory，旧观察/自动保存/候选提升均不再写事实。历史宿主管理/API写入口清楚拒绝，不伪造成功回执。主/Worker 记忆政策从维护的提示词资源加载；旧模式生成的两份提示词逐字保持原文本。
- 后续新增行为先 RED 再 GREEN：无旧库写入、全部消费者失效、同 thread 绑定、迟到工具、审阅/纳入/发布、重启、符号链接/失败及回退误用保护。定向10项通过；候选全 `npm run check` 退出0，490通过/2历史跳过。root曾有一次更新器用例超时；独立串行重跑2项已退出0，未改断言或放宽超时。最终root检查和只读收据见下方最新核验。
- 三次正常更新分别采用 5d32bc955599、d9765841315c、9cee268c19a7，仅接线代码变化，后端保持旧服务。每次都复核原启动器/原 thread/草稿/UI hash、工具指纹、微信和6条 uncertain，业务表只有连接 generation 变化。无真实模型请求新增，无原生 job 表写入；当前唯一旧记忆仍为1条、1来源、1操作，来源job保持39。
- 新维护点匹配 9cee268c19a7，业务/原生 SQLite 备份和恢复副本完整性、数量及 thread 一致；原源设只读。1→1 note 干跑保留来源、正文 hash 及最终有效正文，真实导入尚未执行。`native-memory-import.mjs` 已通过语法检查；它的实际模型导入和重连确认保持未验。
- 未改 UI、Skill 内容、业务 schema、五项主动态工具、认证、渠道及审批/原请求续接机制；无新增入口、依赖、持久后台任务或首次初始化/账号流程。源码和迁移脚本在仓库正常位置，普通证据在 scratch，私有备份/计划在 ignored private；不包含敏感正文的用户交付记录即本文。

### 历史基线：最新核验与命令退出码

当前原更新器采用版 **9cee268c19a7**，源码快照 hash `9cee268c19a799fc9390c407e9b961cbbfeb66b33cbd8a716837fdf9a2769d02`；固定 Codex0.163.0二进制重新核对 SHA-256仍为 `8813367285524ac798dd96d1b071aea30d58708c7226fd236cd275cf1cfdee31`。只读交付核验时间 2026-10-19T01:56:49.186Z，`verify-native-note-backend-handoff.mjs` 退出0；唯一结论仍是 **未切换后端、未导入真实记忆**。

| 本批命令/范围 | 退出码与结果 |
| --- | --- |
| 候选 `npm run check`（含回退保护） | 0；490通过、2历史专用验收跳过 |
| root最终串行 `npm run check` | 0；490通过、2历史专用验收跳过，`native-note-root-serial-check.log` |
| `tsx --test tests/native-memory-adoption-service.test.ts tests/native-memory-fence.test.ts tests/native-memory-recursive.test.ts` | 0；10通过，包含先RED后GREEN的宿主隔离、失效、Worker提示词及回退保护 |
| `node --test tests/dev-upgrade.test.mjs` 单独重跑 | 0；2通过；此前并行检查中的1次 `dev_test_timeout` 保留在 `native-note-root-prompts-check.log`，未改测试断言 |
| `scripts/native-memory-background-budget-probe.mjs` | 0；2前台＋2后台的无凭据loopback，重试计数0仍再调用 |
| `scripts/native-memory-migration-preview.mjs`、`native-memory-migration-dry-run.mjs` | 各0；维护点匹配9cee268c19a7，恢复副本和1→1来源/最终正文hash通过，无模型调用、无真实导入 |
| `node --check scripts/native-memory-import.mjs`、`native-memory-background-budget-probe.mjs` | 各0；不当作真实迁移执行证明 |
| 本批三次 prepare/publish/verify 与最后只读核验 | 各0；原更新器采用，原启动器、草稿/UI、原thread、微信、6 uncertain及原业务行保持，未回套业务DB |

本批新增真实模型请求为0；七步真实验收和其费用元数据沿用前批，不重发、不重新污染偏好。当前原生全局job仍是原 `error/failed_invalid_artifacts`、retry_remaining字段2、stage1输出0，无running；没有把该字段当作剩余调用承诺。专属目录保持 `/Users/wolf3c/Library/Application Support/Homer/codex`；实际源库/原生库备份、私有迁移计划保存在 ignored private，普通回执为 `native-note-backend-handoff.json`、`native-note-guard-release.json`、`native-note-fixed-binary-recheck.json`，只含数量、hash和验证元数据。

回退材料分别保留每次代码采用前的源码、配置、业务/transport备份及核验。当前未启用新后端，因此无需任何数据回退；后续进入原生后若出现新记忆或未知写入，必须按前述对账护栏前向处理，不能整库覆盖。未验项只有真实1条导入、导入后的原thread重连确认、日常后端实际选择及成功的原生后台汇总；已接受的撤回与Worker范围不再列为阻塞。

### 历史基线：2026-10-19 续接复核

后台费用/调度问题收到的回执为 `(no answer)`，同时明确要求不再重复提问。此回执没有新增放宽后台调用的授权，原有“不暗开无限后台任务”约束继续适用；撤回与 Worker 保守失效两项既有批准保持有效。没有再次提问、重复原主对话七步验收或启用原生后端。

只读核验命令退出0，当前版本、专属目录、唯一原 thread、草稿、工具指纹、微信连接、六条 uncertain 及原业务既有行均保持。唯一旧记忆仍为1条，已备份但未导入；原生无 running job。本次新增真实模型请求0。接线与保护代码已经采用，实际后端替代仍受上述固定版本调度限制阻断；完整检查490通过/2跳过是前批结果，本次仅文档与验证元数据更新，没有复跑或重新计作新结果。

### 历史基线：汇总错误与 note 采用分开验收

固定 V1 的 `validate_consolidation_artifacts_for_version` 要求根目录存在普通文件 `MEMORY.md`，并存在首行为 `v1` 的 `memory_summary.md`；真实首次失败定位为前者缺失，两者在该维护点均未产出。当前 gpt-6.1-sol 已通过实际 note 工具调用，但没有证据证明它已成功完成该原生汇总写文件流程；不能从模型目录存在推断成功，也没有补造产物掩盖错误。原生 note 的 list/search/read 直接读取扩展存储，七步真实验收在没有这些汇总文件时通过，所以汇总成功不是直接 note 迁移的技术前置。

后台调度与汇总成功是另外两件事：无汇总产物时，开启原生 note feature 仍可能启动汇总模型。固定调度采用租约和至少3600秒失败重试延迟；虽然记录初始 retry_remaining=3，全局 phase2 的领取 SELECT/UPDATE 并不检查该字段。最新无凭据实测已证明 retry_remaining=0、退避过期后仍会再次调用模型，因此既不是三次封顶，也不是 token/费用上限，不能宣传为零后台、有界总调用或硬预算。保留原生调度时，候选显式使用当前模型，不启用旧 rollout 提取；完全禁止汇总则固定版官方接口暂不能同时提供内置 note 工具。没有改写 jobs、伪造模型、换主 thread 或建立平行记忆服务规避这一边界。

### 历史基线：失败重试上限专项实测（新证据）

`scripts/native-memory-background-budget-probe.mjs` 使用固定0.163、全新临时 HOME、无凭据 loopback，未读写日常数据。第一轮产生1次前台和1次后台请求，原生 job 失败于 `failed_invalid_artifacts`。仅修改该合成库，将 retry_remaining 置0、retry_at置0模拟退避到期；同一合成 thread 第二轮又产生1次前台和1次后台请求，计数仍0。命令退出0，`exhaustedRetryCounterDoesNotStopPhase2=true`。没有等待/加速真实租约、修改真实 jobs 或重复七步真实请求。

与固定源码 `state/src/runtime/memories.rs:try_claim_global_phase2_job` 一致：全局任务只判断重试时间、租约及成功后6小时冷却，不读取 retry_remaining；失败虽递减该计数，却不构成后续停止条件。源码的 phase1 确实有次数检查，不能拿它替代 phase2 的行为。此项构成原“不能暗开无限后台任务”要求下的具体冲突，note 工具可用和汇总是否成功均不能消除它。

## 历史基线：本次实施边界与完成条件

当前自建链路由 `src/memory.ts` / `memory-store.ts` 保存和检索，`src/service.ts` 注入主轮、收集回执并隔离旧 Worker，`src/engine.ts` 在进程配置、thread 配置及 `thread/memoryMode/set` 三处关闭原生记忆。目标是让固定 Codex 原生系统独自负责记忆生成、存储、查询和采用；Homer 只保留必要的业务授权、任务生命周期、迁移回执及失效保护，不能另建一套权威记忆库或手工生成原生摘要。

| 方面 | 实施要求与可核验结果 |
| --- | --- |
| 原主对话 | 沿用当前唯一主 thread；仅在安全边界自动重连子引擎并恢复同一 thread。新 thread 能读取摘要不代表原主对话已采用；不用本人重启或重发原请求弥补接线缺口 |
| 对话体验 | 记忆常开、无新增配置入口；用户通过对话查询、记住、纠正和忘记。保存成功须区分 note 已落盘、后台已汇总、本对话已采用；只有追加撤销说明时不得回“已彻底删除” |
| 单一后端 | 同一次切换关闭旧注入、旧自动保存、旧候选提升及旧写工具的成功回执；保留历史数据不表示继续使用旧后端。只改 enabled 或 features.memories 不算替代完成 |
| Worker 与成果 | 保留纠正/遗忘后的失效保护，以及审阅、纳入、正式发布时拒绝旧成果的契约。不向 Worker 暴露整库，不静默给在飞任务替换事实，不自动重派或重放外部操作。原生工具没有现成条目 revision/epoch 映射时，先说明用户可见影响和最小方案，不能删除保护换取通过 |
| 原请求续接 | 保留 request/reply/thread/generation 与各轮审批归属；停止在刷新等待及轮间仍有效；未知工具结果不重试。沿用[已有自动续接契约](30-tool-acquisition-requirements.md#原任务自动续接交付2026-10-18)，不为记忆另建队列 |
| 数据归属 | 以实际配置回读确认专属 CODEX_HOME、HOME、SQLite、日志及认证存储；应用更新保留用户数据，不打包进候选。专属目录已采用，不能重复要求登录或改全局 Codex |
| 后台调用 | 先确认当前 provider 与提取/汇总模型兼容，记录实际模型、可观测用量和有界调度；不能把主对话用量充作后台总费用。原生配额检查不是通用硬预算保证，见下方源码核对 |
| 真实验收 | 只复用原主 thread，用明确标注的合成偏好，最少请求验证保存→同 thread 召回→重连后召回→纠正不采用旧事实→遗忘不重建；完成后清理自有合成记忆并验证，不创建真实测试 thread 或微信外发 |

迁移前先在自然空闲维护点准备业务库与专属原生数据的一致性备份，完成只读干跑，核对条目数量、状态、来源、最终有效内容及纠正/遗忘约束。敏感正文只进入已忽略的 `.codex/private/`，普通日志与报告只保留数量、hash 和验证元数据。旧源保留只读备份；部分失败必须能识别已写入项及未写入项，不能换 ID 盲重试。

回退先停止新记忆写入并核对切换后的新增原生记忆，逐项保留和处理后再启用单一后端；不得回套整个业务 DB、丢掉新增记忆或重放未知任务。先在副本预演恢复。若原生机制要求删除真实旧记忆、清空全部原生记忆、丢来源/遗忘语义或更换主 thread，须先给出具体冲突与可审阅方案，不能把迁移授权理解为允许丢数据。

完成证据须分别覆盖：无凭据 loopback/临时 HOME 的行为 RED/GREEN、固定原生协议及源码、迁移与恢复预演、相关及完整 `npm run check`、原请求/Worker/审批/停止/更新回归、日常安全更新实际采用，以及原草稿、渠道、六条 uncertain、工具/Skill 与数据目录保持。UI 无变动则不新增记忆入口；若改动 UI，另验605px与桌面渲染。没有实际运行的检查保持待验，不复用旧通过数冒充本批结果。

本次普通证据统一置于 `.codex/scratch/native-memory-adoption-20261018/`，私有备份与迁移回执置于 `.codex/private/native-memory-adoption-20261018/`。若关键保存/遗忘或 provider 兼容性被实证阻断，应交付可独立完成部分、精确阻塞及最小选择，不继续无效探针或转做平行记忆服务。

### 历史基线：固定源码核对：不是新增实测通过项

已读项目保留的固定源码副本 `codex-rs/ext/memories/src/local/ad_hoc_note.rs`：原生 note 使用 `create_new(true)`，已存在文件返回错误，工具没有原地覆盖/单条删除参数。`memories/write/templates/extensions/ad_hoc/instructions.md` 要求汇总每条 note，也明确要求不删除 note 文件。这支持“可追加纠正/遗忘说明”，不能证明旧正文物理移除或旧 rollout 永不重建。完整遗忘仍须行为验收。本次另尝试从 `rust-v0.163.0` tag逐文件重复核对上述文件及start/guard，raw.githubusercontent.com请求超时/连接错误，命令退出1，未完成新的在线hash比对；不将此网络失败视为原生记忆能力失败，源码线索须与固定二进制实测分开。

`memories/write/src/start.rs` 在根启动后异步运行提取及汇总；`guard.rs` 的配额检查在非 Codex 后端或配额查询无结果时放行（`unwrap_or(true)`）。因此 `min_rate_limit_remaining_percent` 不能作为所有第三方 provider 的硬预算；模型配置、提取数量、失败重试及中断后行为必须按本次实际配置验证。源码阅读没有调用真实模型，也不表示第二阶段或费用边界已通过。

原生接口没有 Homer 条目ID/revision或来源引用清单，无法沿用逐条引用校验；已按用户接受的保守范围完成适配。`src/native-memory.ts` 只读取专属原生目录计算内容/文件身份指纹，在原业务 meta 和 memory_snapshots 保存失效元数据，既不复制事实也不检索事实。任何新增、修改或撤回均使旧 Worker 快照失效；运行中执行由已有停止链结束，关键审阅/纳入/发布边界同步复核并拒绝，重启及正文回退不恢复旧资格。事务内使用 savepoint 加入任务所有者事务，不能嵌套 BEGIN 或替调用者提交；相关回归曾先暴露该问题，修正后通过。主轮仅重置其空消费者元数据以允许原生保存同轮完成，采用事实依赖原生当前读取及最新撤回规则；不向 Worker 自动注入原库或原生全库。

### 历史基线：本次基线复核（2026-10-18，尚未切换）

重新执行维护脚本，V1与V2命令均退出0，固定回执版本为0.163.0，各自使用新建的无凭据 HOME 和 loopback provider。两次均确认 note 保存/重启读取、追加纠正/遗忘及实际模型MCP污染状态转换；`realLifecyclePassed=false`，同进程与重启原thread摘要刷新仍为false，`forgetIsAppendOnlyNotPhysicalDeletion=true`。V1第一阶段1条输出，但退出观察时第二阶段仍running；V2第一阶段假响应解析失败、第二阶段failed_agent。没有把脚本整体退出0称为原生替代验收通过，也没有重跑真实模型。

同批只读聚合查询旧库：1条active owner记忆、1条来源、1条操作回执、0条遗忘抑制、32条来源job、0条Worker快照，六条uncertain仍在。未读取或输出记忆正文，该基线查询未做实际备份、导入、删除或回退；后续已完成的新维护点只读备份/恢复预演及干跑见前文，仍未导入真实记忆。首次聚合命令未按配置文件目录解析runtime，SQLite只读打开失败，退出1；按 `src/config.ts` 的相对路径规则修正后退出0，没有创建或修改数据库。

本批元数据位于 `.codex/scratch/native-memory-adoption-20261018/product-docs/`：`native-v1-baseline.log`、`native-v2-baseline.log`、`legacy-memory-counts.json`。两次完整合成探针收据分别位于 `.codex/scratch/native-memory-feasibility/probe-0O9yTv/` 与 `probe-jZHlTk/`。此处描述较早的文档基线批次；后续生产接线、配置预检与七步真实模型验收已在前文单列，不再以“只修改文档”描述本轮交付。

## 历史基线：固定版本证据

依据本机固定二进制 `codex-cli 0.163.0`、其生成协议、空 HOME 的实际RPC与纯 loopback 脚本化 Responses。不是最新在线文档推定。OpenAI Docs 的[Memories说明](https://learn.chatgpt.com/docs/customization/memories)说明后台生成及当前控制，[配置参考](https://learn.chatgpt.com/docs/config-file/config-reference)说明相关设置；它们只作对照，不证明本机固定版本行为。

| 范围 | 实际观察 | 含义与限制 |
| --- | --- | --- |
| 公开管理RPC | 固定协议及实际调用支持 `thread/memoryMode/set`、`memory/status`、`memory/reset`；`memory/list`、`memory/correct`、`memory/forget` 返回 unknown variant / `-32600` | 没有证据把单条纠正/遗忘映射为这些RPC；`memory/status`返回V2汇总线程数/readiness，不是条目目录 |
| 原生内置工具 | 最新V1/V2按 `input.additional_tools` / `functions.exec` / `ALL_TOOLS` 实际调用 `memories__add_ad_hoc_note`、list/read/search | 保存note→重启同一合成thread→搜索/读取原note、追加纠正及追加忘记均成功。旧顶层tools夹具的不可见判断被纠正；不是即时改写/删除所有旧摘要 |
| 新根读取 | 在新HOME预置唯一合成摘要marker，原生将其带入新合成thread的实际请求；`MEMORY.md`正文未自动整份带入 | 验的是原生注入，不是模型理解或自动保存；预置marker与用户聊天内容不同，避免把聊天回声当记忆 |
| 长驻/重启同thread | 把摘要文件换成第二个唯一marker，同进程下一轮及重启后恢复**原合成thread**均仍带旧marker，不带新marker；新合成根thread才带新版 | 当前启动/恢复不刷新缓存摘要。后续七步真实验收已证明同thread直接search/read新note及纠正/撤回可生效；单一后端接线现已实施但真实配置尚未选择，compaction刷新未验，不能靠新建真实thread掩盖 |
| 根启动提取 | 仅对新合成SQLite回填8小时旧时间以准备调度资格。同根恢复没有新增提取请求；第二个合成根启动后出现提取请求和 `memory_stage1` job | 二进制候选SQL亦含当前thread排除条件；不据此宣称所有空闲定时行为已穷尽。没有实等8小时，没有迁改真实rollout或state |
| 第一阶段 | 默认/V1探针接受脚本化结构化响应，原生 `memory_stage1=done`，专属库1条stage1结果 | 只证明接线与落盘；结果由假模型指定，不能称自动准确提取。`gpt-6.1-sol`只是探针显式模型名，不证明真实提取模型可用性或花费 |
| V2 | 固定版本接受 `memories.version="v2"`，使用独立root/SQLite；摘要缓存现象相同 | V2第一阶段已触发，但夹具响应未满足其解析契约，记录 `expected value at line 1 column 1`；属于当前假响应不匹配，不能推断原生V2不支持或已完成 |
| 第二阶段 | 出现 `memory_consolidate_global` job，但探针未验证成功生成/更新汇总文件 | 短探针结束时可能仍持有lease或记录 `failed_agent`；没有把后台job存在或第一阶段成功当完整记忆成功。需要核真实模型/原生写文件工具与权限、租约和重试 |
| MCP外部上下文 | 开启 `disable_on_external_context=true`；host RPC调用仍enabled，最新合法模型 `functions.exec` 实调Mock MCP形成completed item后，V1/V2原thread均变 `polluted` | 原生污染状态转换已通过；不等于已验证汇总移除/旧rollout再提取。Homer自有MCP也属待核来源，不能默认豁免或静默关闭过滤 |
| 全库reset | 在新HOME实际删掉V1/V2摘要/registry，状态归零，原合成rollout仍保留 | 不是单条忘记，也不删除历史或证明旧rollout将永不重新提取。未验证纠正/遗忘后从旧rollout重建的结果 |

接口缺少即时回执、暂未验证旧Worker fence，并不单独构成建设新管理层的理由。允许按原生可接受的异步/追加note语义继续验证；但必须先明确“保存已排队/文件已写入/已汇总/本对话已采用”的区别，不能冒称即时生效。尚无理由为此新增第二套权威DB、加载器、Worker版本库或按任务代理。

## 历史基线：可重复的隔离检查

```sh
node --disable-warning=ExperimentalWarning scripts/native-memory-feasibility.mjs
HOMER_PROBE_MEMORY_VERSION=v2 node --disable-warning=ExperimentalWarning scripts/native-memory-feasibility.mjs
node --disable-warning=ExperimentalWarning scripts/native-data-update-acceptance.mjs
```

- 探针只允许固定0.163；创建全新 `.codex/scratch/native-memory-feasibility/probe-*/application-data/codex` 与host-home、workspace，initialize回执路径/版本不匹配即拒绝继续。环境不继承账号变量或代理，所有模型响应由127.0.0.1假端点生成；不调用真实模型、真实账号、真实微信或日常Homer，也不读复制真实记忆/鉴权/会话。
- 默认/V1、V2 两次维护脚本均退出0，协议/注入缓存/隔离断言通过；这**不表示真实四步闭环通过**。完整记录有 `realMemoryLifecycleAcceptancePassed:false`，未通过项保留。V2改为核对实际 `memories_v2_1.sqlite` 后单独复验，未拿V1空表冒充V2结果。
- 仅新合成库回填时间，phase1响应为脚本化JSON。普通对话、背景任务完成通知按thread ID区分；每轮取对应请求marker，避免把背景模型响应误判成原thread采纳。
- 早期夹具使用JSON对象代替TOML、试图覆盖保留provider ID `openai`，导致初始化失败/超时；均已修正为TOML和自有loopback provider。只正常终止该准确归属失败探针，没有操作日常；这些不算原生记忆失败。
- 最新脚本语法检查退出0；默认/V1及V2补全实际工具断言后各退出0。记忆产品行为未改，没有为脚本改动重跑整套396项。

## 历史基线：2026-10-18补验：原生note与MCP污染

维护脚本修正工具目录路径及模型MCP调用：`functions.exec`中原生工具以 `memories__*` 命名，MCP从 `ALL_TOOLS` 选出确切已授权绑定。只使用新合成HOME、脚本loopback响应，无真实模型或账号。V1/V2均有耐久断言：

1. 用户显式合成保存请求→原生add_ad_hoc_note返回成功；原生list/search能查到 `extensions/ad_hoc/notes/2026-10-18T00-30-00-synthetic-save.md`。
2. 正常关闭/重启引擎并恢复**同一个**thread；原生read与search仍返回该note。证明存储和工具查询，不证明模型自主回忆，也没有把聊天回声算作召回。
3. 纠正创建第二个追加note；遗忘创建第三个note。原生search仍返回原偏好、纠正和忘记说明三份内容。因此当前语义为追加用户指令，**没有物理删去旧条目**。不由此判定原生不可接受，但需真实模型遵守最终指令及旧rollout重建不恢复被忘记内容后，才能切换。
4. 模型经原生MCP实际调用成功后，同thread `memory_mode=polluted`；host端直接RPC调用仍enabled。两者区分清楚。尚未证明Homer业务MCP适用方式、污染输出清理及后续恢复，不能关过滤换取表面成功。

证据：`.codex/scratch/native-capabilities-expansion/native-memory-tool-path-asserted-v1.log`、`native-memory-tool-path-asserted-v2-retry.log`，各自新HOME的完整JSON收据。两次 `adHocToolStorageAssertionsPassed` 与 `modelMcpExternalContextFilterPassed` 均true，`realMemoryLifecycleAcceptancePassed`仍false。V2第一次因后台请求正常取消触发夹具未处理 `ECONNRESET` 退出1；仅在请求确已aborted且错误码匹配时忽略该断连，重跑退出0。没有残留归属探针引擎，没有触碰日常。

V1第一阶段done/1结果、第二阶段 `failed_invalid_artifacts`；V2第一阶段假响应仍 `expected value at line 1 column 1`、第二阶段 `failed_agent`。这些汇总夹具/产物未通过项仍保留；不因为note工具可用而宣布完整替代完成。长驻摘要刷新限制仍复现。

## 历史基线：专属数据与更新保留

原生记忆须使用 `<Homer应用数据>/codex`（macOS默认 `~/Library/Application Support/Homer/codex`），进程HOME指其 `host-home`，`sqlite_home`指原生HOME，`log_dir`指其 `log`；凭据交给原生专属file store。此前“主thread仍绑定旧目录”已由[专属目录采用](28-native-home-adoption.md)取代。本次2026-10-18 21:12（Asia/Shanghai）只读重核：4780业务版本 `f2fcbd9e881a`、主thread `01a14cdb-1d34-7600-b067-2f1eb4928132`、`boundToNativeHome=true`、ChatGPT connected、配置路径为上述专属目录，微信 connected、无活动主轮/Worker/待答，pendingConfiguration=false。此项只证明已有绑定和当时空闲，不证明原生记忆启用；任何运行操作前仍须重新核对，不能沿用旧PID或空闲快照。

摘要目录 `memories/`、`memories_v2/` 及marker由夹具预置，不能算原生自动生成成果。原生实际创建V1 `memories_1.sqlite`、V2 `memories_v2_1.sqlite`、`memories_extensions/`、sessions、state、thread_history及 `logs_2.sqlite`。`log_dir`已由有效配置回读确认，但短探针未创建对应log目录。V2按其实际库核对；目录/SQLite存在不等于闭环成功。最新原生工具实际返回note路径 `extensions/ad_hoc/notes/<文件名>.md`，重启后同thread原生read/search可读；这是新合成HOME证据，不是已有记忆迁移。

扩展原有正常更新验收：15类合成marker（含V1/V2摘要、registry、SQLite及extension marker）在正常成功构建、明确失败构建后逐一hash不变，候选未打包这些用户数据；退出0。extension marker只是保留覆盖，不证明该note已被原生工具创建。缓存/日志按正常有界留存，不要求永久保存日志正文。程序更新与经用户授权的“忘记/reset”删除是不同动作。

## 历史基线：已有记忆迁移映射（已获授权，尚待执行验收）

| 现有数据 | 后续迁移候选 | 必须保留/确认 |
| --- | --- | --- |
| active owner偏好/事实 | 经迁移干跑核对的原生追加note或经验证的原生import入口 | 原ID、revision、来源hash/时间与新native引用关系放私有迁移回执；不是第二套运行时记忆。不能伪装成原生rollout或Claude导入 |
| active matter事实 | 优先留在原业务事项/成果来源；原生如有已验证作用域再映射 | 不把事项局部事实悄悄升为全局偏好；不静默遗漏已有记忆 |
| pending | 保留原库待核，不能直接变成已确认native记忆 | 来源及原状态保留 |
| suppressions/已忘记主题 | 必须先证明原生遗忘note/排除机制能阻止旧内容重新采用 | 不把空库reset或删文件当单条永久遗忘；验收未过不迁 |
| sources/operations/revisions | 原库及私有只读迁移回执保留审计关联 | 不复制真实聊天全文、私人Codex记忆或鉴权来凑来源 |
| jobs/snapshots/Worker引用 | 先自然空闲，排空或按原规则结束；旧快照失效后切单一后端 | 不并行双写，不给存量Worker热换正文；不为此新建版本冻结体系 |

历史可行性阶段未读取/导出真实条目；本次迁移已获授权，仍先做新维护点一致性备份和只读干跑，再核每条映射/数量/hash、待确认与忘记主题，不破坏原Task/Run/队列/publication。真实敏感内容不进入普通日志或源码，不额外发给模型来凑验收；原库保留只读备份。保留备份不等于两套同时提供权威记忆。

切换时需一个明确后端选择，先停止旧记忆注入/自动沉淀/写工具，再启用通过验收的原生路径；现有MemoryStore启动会恢复“常开”，不能只改一项enabled配置来假装切换。Worker仍按原授权与范围处理，不因主记忆启用就继承全库；原生后台汇总agent不成为第二个Homer业务管理者。

## 历史基线：真实切换的唯一剩余决策与回退边界

1. 撤回语义、全局保守 Worker 失效已经接受并实现；七步真实验收保留，不再重复，不另建真实 thread。新增离线测试覆盖历史工具无成功回执、旧事实无注入、无旧自动保存/候选提升、运行中 Worker 停止、迟到写入及旧成果审阅/纳入/发布拒绝。
2. 当前固定版无 note-only 后台开关，失败计数为0仍可再次调用，且现有汇总产物失败。按“不暗开无限后台任务”的现有要求，后端配置继续保持旧服务。只有明确接受无硬上限的原生汇总，或原生提供可验证关闭/限额机制后，才能选择 native 后端；不能通过伪造摘要、改真实 job 表、无效模型名、临时会话或假 subagent 绕过。
3. 启用前基线时已有1条记忆的只读备份、恢复副本和1→1迁移干跑通过，彼时尚未真实导入（已由顶部1条真实迁移完成取代）。`scripts/native-memory-import.mjs` 提供 stage/import/verify，使用原 owner 队列与原生 add/read/search，固定请求ID和目标文件，结果不明不重放，普通回执只含元数据。真实导入、原生落盘及重连后迁移召回尚未执行，不把脚本语法或合成服务测试当迁移成功。
4. 后续切换须再核当前空闲、专属 HOME/认证、原 thread、草稿和6条 uncertain，建立匹配实际版本的新维护点；保持现有更新器的所有 guard。旧原库不删除、不整库回套；只读备份和原生新增 note 均保留。切换后的新事实必须逐项对账并前向处理，不能直接复用旧事实覆盖。
5. 已进入原生模式的业务库会保留失效保护指纹。候选对随后误用旧后端配置直接拒绝 `native_memory_rollback_requires_reconciliation`，避免新记忆落盘后静默采用旧库。只有核对全部新增/纠正/撤回和来源后，才可清理失效引用并明确恢复唯一旧后端；存在未知结果或未对账新事实时保持当前数据、先修复原生路径，不能把旧整库恢复当回退。该启用前基线时尚未进入原生模式；现已切换原生且未发生跨模式回退，见顶部当前状态。

## 历史基线：证据归属

历史探针维护源码：`scripts/native-memory-feasibility.mjs`、扩展后的 `scripts/native-data-update-acceptance.mjs`。历史可行性批次没有生产Engine/Service/UI改动；不以此句描述后续替代实现。当前文档修订也不等同于生产切换。

可复验回执在 `.codex/scratch/native-memory-feasibility/`：`maintained-v1-receipt-location.json`、`maintained-v2-receipt-location.json` 指向各新HOME的无真实正文探针记录；`maintained-v1-final-probe.log`、`maintained-v2-selected-store-probe.log`、`native-memory-update-preservation.log` 记录本次命令结果。`fixed-binary-*-strings.json` 仅是二进制静态线索，不能代替成功RPC/工具调用。真实业务和凭据未进入这些材料。
