# Homer 测试范围与执行入口

默认回归验证 Homer 自身的对话、调度、审批、成果交付、持久化、权限和适配契约。真实依赖集成与开发发布验收单独选择；测试位置、已有工具或环境变量不能代替明确选择。

## 真实 HOME 与独立 CODEX_HOME（2026-11-16）

默认 runner 为每个测试进程预载 `tests/fixtures/synthetic-home.mjs`，新建合成 HOME 和独立 CODEX_HOME，子进程随之继承；直接使用 `core-system-proxy.mjs` 的离线入口也预载同一夹具。显式原生测试及诊断入口各自保留合成 HOME。测试 profile 的桌面入口和 runtime 继续使用 `profile/host-home`；正式入口的系统目录来自受信任 `userInfo()`，VM 测试用合成系统用户信息，不访问日常 profile。缺失、相对、不存在或非目录 HOME 均在引擎启动前拒绝，不自动创建任意用户目录。

相关离线入口（项目 Node22.22.0）：

```sh
node --import ./tests/fixtures/core-system-proxy.mjs --import tsx \
  --experimental-vm-modules --test --test-concurrency=1 \
  tests/engine-user-home.test.ts tests/desktop-user-home.test.mjs \
  tests/electron-shell.test.mjs tests/desktop-update-runtime.test.mjs \
  tests/project-mcp-engine.test.ts tests/test-suites.test.mjs
npm run typecheck
npm test
```

HOME 原生检查登记为独立 `home-native`，默认 `npm test` 不运行，必须显式提供与源码候选匹配的固定二进制及已构建 service。当前夹具要求 macOS，不能用跳过代替 Windows 验收：

```sh
npm run build:service
HOMER_TEST_SERVICE_MODULE=file:///absolute/candidate/dist/service.js \
HOMER_TEST_CODEX_BIN=/absolute/path/to/candidate-pinned/codex \
node scripts/test.mjs --home-native
```

专项只在新建的系统临时目录中使用合成 `.gitconfig`、账号文件、AGENTS、原生配置、历史和附件；独立回环 Responses 返回合成 SSE，不连接真实账号或模型。原生命令用只读 fixture 权限，配置 `inherit=none`，核对实际命令的 HOME／CODEX_HOME、Git 作者与提交者可解析、仓库局部覆盖、子目录、Git worktree 及无 Git 边界。提供方令牌不得进入命令环境；原有自定义 shell 设置保留，目录外写入必须失败。探针发现 HOME 超出允许的两个合成目录时不执行 Git，防止回归时读取真实身份。

旧会话先在合成旧 host-home 下执行真实原生命令并持久化，再以新 HOME 恢复：Main 通过实际 Homer 启动路径，Worker 通过同一个原生 thread ID。核对原历史文件完整字节前缀、附件、动态工具声明和 cwd 保留；当前夹具同时比较 Main／Worker 的实际原生权限档、sandbox、审批策略、审核者及选中的文件系统／网络配置，不能比较两份缺失值。控制连接仅从独立 CODEX_HOME 读取用户配置与账号，不生成模型轮次。确认所有者退出后才核对保全摘要并回收夹具。下述早期 0.163 记录只比较权限档与审批策略，完整快照检查在 0.171 补验时加入。

2026-11-16：从 `22a21bcee59b5b472be0042d66e12725319d00c8` 导出独立副本，只叠加 HOME 相关实现和测试差异；不混入共享工作区继续进行的 0.171 升级、用量／权限、渠道或 UI 改动。Node22.22.0／Codex0.163.0 下服务构建、完整类型检查、上述六文件定向离线 **488/488** 和 17 份 MJS 语法检查通过；HOME 原生 **5/5**、原有目录原生 **10/10** 通过，零取消／跳过，全部为本地合成上游。目录专项同时验证旧 Main 的完整、压缩与检查点缺失历史，以及原生项目根／指令／配置／信任的边界。冻结的 36 份实现／测试文件，按相对路径和文件字节排序计算 SHA-256（每项为路径、NUL、内容、NUL）：`8ea13b43894e6cf03eac29d1372b3feef81cbdb9be220282eb2c10bdfe26178a`。

完整默认核心最后一轮为 **2536/2539**，零取消／跳过，不能声明全绿。两项 `message-image-preview.test.mjs` 失败在未叠加 HOME 改动的同一 HEAD、相同 Node／依赖中复现为 **1/3**。另一项旧回执 CLI 检查因本轮自检准备在测试副本中创建了 0755 的私有父目录而正确拒绝；仅将该合成父目录改为 0700 后，`main-receipt-transition.test.mjs` 整文件 **9/9** 通过，未放宽权限断言，此后没有再跑完整核心。第一轮另因深层副本超出 macOS Unix socket 路径上限中断 Windows 电源夹具；缩短副本路径后该文件 **8/8** 通过，最终全量中的该文件也全部通过，没有更改电源实现或断言。

首轮原生检查证实仅传 App Server 的 HOME 不足，`inherit=none` 下实际命令回退到了系统 HOME；探针当场停止 Git 读取。显式传入原生命令路径后通过，未放宽权限或环境过滤。尝试给测试原生进程再包一层 OS 沙箱曾导致 `engine_permission_failed`，该夹具实验不计为产品回归；去掉额外层后沿原生沙箱验收。离线全量首次揭示旧 Windows runtime VM 缺 USERPROFILE，按新入口契约补齐合成字段，保留原停止确认与 owner 释放断言。

目录付费验证驱动只运行 `--self-check`：合成文件可读、目录外不可读、写入被拒、token 计量及确认退出通过，付费 trials 为零，没有提供授权文件。两次夹具准备分别被源码范围检查和缺少相对脚本依赖拒绝，均在原生启动前；补齐独立副本的布局后通过，未修改范围检查或运行代码。历史六份目录 LLM 报告与基线逐字节相同。最终差异检查通过，原有三个 UI 暂存文件的补丁摘要未变；不提交本轮文件，也不处理并行任务的修改。

收尾已确认测试所有者退出，回收隔离源码／基线副本、构建、合成 HOME／CODEX_HOME／runtime、日志和备份，逻辑大小约 163 MiB；共享依赖、固定原生二进制及日常资料保留。仅在本任务 scratch 留约 60 KiB 的 HOME 候选补丁与归属清单，供当前未提交改动复核；本轮改动完成审查并提交或明确撤销后删除，不作为运行依赖。验证结论及可重复入口以上述维护文档和测试源码为准。

上述 0.163 阶段未安装或重启日常 Homer，不迁移、复制或删除日常账号、历史、runtime、附件或旧 host-home。没有付费 LLM 调用、提交、推送或部署。Windows 仅有 VM／协议证据；0.171 升级候选、本机真实 Git 配置／提交、真实账号／模型和安装验收不在当时结论内。正式环境及原生项目配置边界见[架构正文](architecture/account-and-model-connection.md#真实-home-与独立-codex_home2026-11-16)，当前候选补验如下。

### 0.171 HOME 补验（2026-11-16）

复核当前 `0.171.0-alpha.7` 候选，未再修改 HOME 运行实现。正式 Electron → runtime → Main／Worker／控制连接仍传真实系统 HOME；测试使用合成 HOME，专属 CODEX_HOME 和数据路径保持。HOME 差异不增加目录扫描、刷新或权限覆盖；启动前的目录存在检查及环境传递不改变 cwd、原生项目根、trust 或审批选择。

Node22.22.0／macOS ARM64 下，从完整冻结源码重新构建 service 后，HOME 原生 **8/8**、目录原生 **10/10**、生产绑定／旧版续办 **6/6**、Worker 门禁定向离线 **7/7** 通过，最终完整核心 **2737/2737**，均无失败、取消或跳过；服务构建及完整类型检查通过。冻结源清单 SHA-256 为 `7e539ca6a82729fe4d20fac52681e10f0f505e893b01ee9b8920173ef26fb71f`，算法为排序后的相对路径、NUL、该文件 SHA-256 的十六进制文本、NUL。它覆盖当时完整源码，不是前述 36 文件摘要。0.171 二进制 SHA-256 为 `4e37dbc4dcad2aa285e1d246823e0466ea62171a8dbd6d1684d77e9da3abcb2e`。

| 补验范围 | 实际断言 |
| --- | --- |
| HOME 与账号 | `inherit=none` 下真实原生命令采用所选 HOME／CODEX_HOME，自定义 shell 设置保留，提供方令牌不下传。控制连接能读到独立 CODEX_HOME 的合成 API 账号；移除该账号后，即使普通 HOME 中存在另一账号仍返回未登录；两个账号文件与保留文件摘要不变 |
| 旧 Main／Worker | 分别覆盖 0.171 同版旧 HOME 和真实 0.163 引擎／旧适配器生成的历史；恢复原线程、原 rollout 路径、完整历史字节前缀及原附件。Main 经实际 Homer 启动，保留动态工具和 Store 指针；Worker 原生恢复，另以生产绑定专项覆盖旧版 Worker 续办 |
| 目录与权限 | Main／Worker 恢复前后实际权限快照相等；命令目录外写入失败。先证明本地 HTTP 目标可达及 curl 可执行，再证明原生命令联网被拒。保留 Git 局部覆盖、子目录、linked worktree、无 Git 及用户主目录兜底；目录专项保留多级指令、配置／trust 和四种旧 Main 历史状态 |
| 驱动自检 | 既有目录 LLM 驱动只运行 `--self-check`，核对可读／拒读／拒写、合成 token 计量、确认退出。旧 Main 原线程、历史、附件、工具和完整当前提示保留；提示恢复产生零模型请求，付费 trials 为零，未提供授权文件 |

真实 0.163 旧历史的可重复入口要求同时提供旧固定二进制与旧版编译后的引擎模块；本次旧适配器来自 `22a21bcee59b5b472be0042d66e12725319d00c8` 原始导出，未叠加 HOME 或 0.171 改动。省略这对参数时 HOME 专项仅有同版的六例，不能声称验证过旧版本迁移：

```sh
HOMER_TEST_SERVICE_MODULE=file:///absolute/current-candidate/dist/service.js \
HOMER_TEST_CODEX_BIN=/absolute/current-candidate/codex \
HOMER_TEST_CODEX_BASELINE_BIN=/absolute/isolated-0.163/codex \
HOMER_TEST_BASELINE_ENGINE_MODULE=file:///absolute/isolated-original-0.163/dist/engine.js \
node scripts/test.mjs --home-native

HOMER_TEST_CODEX_BIN=/absolute/current-candidate/codex \
HOMER_TEST_PREVIOUS_CODEX_BIN=/absolute/isolated-0.163/codex \
node --import ./tests/fixtures/synthetic-home.mjs --import tsx --test \
  --test-concurrency=1 --test-name-pattern='production (main|worker)|isolated 0.163' \
  tests/native-thread-continuity.engine.test.ts
```

本轮修正测试观察边界：0.171 内部发送改走 `nativeRequest`，旧 spy 无法捕获真实权限，现要求快照非空并比较完整字段；测试及 LLM 驱动直接启动固定二进制，避免 shell `exec` 改变租约进程身份。目录历史种子使用生产支持的 `homer` provider，保留来源／线程校验；账号管理 fixture 与生产控制连接一致，原生目录请求也只指向本地替身。续办专项只忽略主动拒绝的 HTTP 426 握手连接上的预期 `ECONNRESET`，其他错误及所有业务断言保留。

前序失败不计通过：不完整源码副本缺少 assets／mobile 的整轮作废；早期编译遇并行改动尚未接齐，后续完整快照已通过。一次原生续办出现上述预期连接重置，修正 fixture 后整组 6/6 通过。第一次完整核心为 2735/2736，失败是并行 Worker 签收失败红例；其所属修复纳入最终冻结源码后，门禁整组 7/7 通过。最后重跑期间共用临时引擎被另一任务清理，产生启动失败及取消；复制现有同摘要官方运行时到本任务目录后，HOME／目录整组重新通过，未安装任何程序。

最终确认生产源、提示词与启动脚本和冻结候选一致。同期两个非 HOME 专项测试继续更新，追加当前专项分类定向 2/2 通过；共享 HEAD 因并行任务的独立提交变为 `e4b90213`，本轮未执行仓库 Git 写入，原三个 UI 暂存补丁摘要未变。确认测试所有者退出后，回收本任务源码／旧版副本、官方运行时副本、合成 HOME／CODEX_HOME／runtime、失败夹具和日志，合计约 532 MiB 逻辑体积；共享依赖、其他任务的固定引擎、日常数据与先前 HOME 归属材料保留。仅留本轮精简归属补丁与清单供未提交改动复核，审查提交或明确撤销后删除。

上述隔离补验阶段未读取日常账号或真实 Git 身份，未迁移日常数据，未追加付费验证或执行提交、推送、部署、安装、重启。Windows 原生、真实 OAuth 刷新、真实模型行为及安装版效果仍未验证；本节的 API 账号和所有模型响应都是合成资料。真实 HOME 下用户级 Skill 的共享边界见[环境与账号边界](architecture/account-and-model-connection.md#真实-home-与独立-codex_home2026-11-16)，这些结果不能解释为全部用户上下文隔离，也没有验证真实仓库的提交。

### HOME 剩余改动提交整理（2026-11-16）

以本地 main 的 `860ca50a` 为基线，只提取尚未提交的 HOME 片段。目录上下文的 `423863e9`／`9a8c4487` 保持；`d0e46946` 已纳入合成 HOME 夹具、目录／续办共用测试及 Windows runtime 的合成 USERPROFILE，不重复纳入。共享文件保留原 HEAD 的其他行为，不混入工作区的渠道、UI、电源、模型默认值或测试清单删项；原有三个 UI 暂存文件保持独立。

原生 HOME 专项、目录恢复、生产绑定／旧版续办及驱动的相关文件与已验版本逐字节一致，HOME 实现片段也保持；复用上述冻结候选的原生 8/8、10/10、6/6、零付费驱动自检、完整核心 2737/2737 和完整类型检查结果，未将其称为当前共享工作树的重新全量验收。新候选仅由该基线及 HOME 剩余片段组成，在无 Git 元数据的独立源码目录导出验证，复用项目依赖，不读取日常 profile。

为核对当前 HEAD 的接合与共享片段分离，重新执行上述六文件定向离线 **490/490**、服务编译和 **16 份 MJS 语法检查**，均通过；定向测试零失败、取消、跳过。另核对独立暂存差异、原暂存摘要、原生已验文件摘要和敏感资料模式。没有重跑完整核心或原生专项，没有下载引擎、追加模型调用、安装、重启或修改日常 Homer 数据。构建与测试副本、两轮归属补丁／清单在本地提交确认后按任务收尾回收；维护测试与本记录保留，作为复现入口。

## Codex 0.171.0-alpha.7 源码升级

2026-11-16：共享引擎、三平台官方包元数据、精确预发布版本握手和会员目录已接入源码。只有会员 GPT-6.1 家族生成 `tool_mode: code_mode_only`；DeepSeek 保持 `tool_mode: null`。ChatGPT／会员跨来源通过原生 fork 和 Homer 自有持久分支映射继续原 Homer 会话；同来源继续原生 resume。设计与维护成本见[跨来源兼容方案](superpowers/specs/2026-11-16-codex-0.171-provider-continuity-design.md)。

环境固定为 macOS ARM64、Node 22.22.0、官方 Codex 0.171.0-alpha.7。专项均使用独立 HOME／CODEX_HOME／runtime、合成凭据和回环上游，不读取日常账号或调用付费模型。旧版迁移仅在新目录执行已有 0.163.0 二进制，不复用安装版数据。

| 检查 | 通过证据与边界 |
| --- | --- |
| 打包 | runtime 46/46、Electron package 12/12。ARM 官方归档、43 个文件及 37 项 voice manifest 摘要已核验，包含 `codex-code-mode-host`；Intel／Windows 仅官方 SHA-256／SRI 元数据，未下载或执行 |
| 分支适配 | 23/23：Main／Worker、双模式、同源恢复／双向分支、冷恢复、旧绑定、原生轮次审计、指针冲突、迟到／撤销／来源变化、错误原生 ID／供应商／父关系、记忆拒绝／缺失／错误；发布前零模型请求 |
| 绑定与记忆 | 绑定／效果事实 67/67，只读记忆适配 12/12。实际 Store 事务／savepoint、重启、精确 root／child owner、未知结果不可清除、真实终态不可回退，无生命周期记录总量限制 |
| Worker 门禁 | 签收／停止／原生请求／恢复联合 131/131。包括 `rpc_wait` 中并行开始、EOF 排空终态、签收写入失败、ACK 前取消；撤销 epoch 与权限保持，退出证明不能代替效果证明 |
| 会员工具闭环 | 40/40：通用目录及 GPT-6.1 Code Mode Only × Main／Worker × HTTP／WS 与八类失败／回退。核对 custom `exec`／Lark 暴露、JavaScript、本地随机结果回传、最终文本、工具一次和冷恢复 |
| 来源与交付 | 原生来源传输 11/11、实际 Homer 渠道 2/2、定时任务 1/1。三次来源切换后保持主会话、既有 Worker、原生祖先、准确轮次、消息／订阅／附件和未知发送边界 |
| DeepSeek | 11/11：压缩／续办／冷恢复、错误码无宿主重试、真实 MCP、上下文及推理设置；原生请求的工具目录未混入 Code Mode 的 custom `exec` |
| 原生继承 | 7/7：生产适配器的 Main／Worker × Enabled／Disabled、活跃 goal 的两次 fork／冷恢复、0.163 Enabled／Disabled 旧会话。祖先状态不改，工具不重放，启动不生成模型或预热请求 |
| 原生能力与停机 | 原生协议 6/6，另有插件启用／真实 stdio MCP／受控目录连接及残留子进程退出 1/1。只按预先捕获身份清理，未知／重用身份继续阻塞 |
| 提示词与目录 | 提示词／动态工具恢复 5/5（含 0.163 种子）、实际 Homer 目录专项 10/10。完整／压缩／检查点中断历史、附件、动态工具及原 rollout 字节前缀保留 |

原生专项按文件显式选择，不能直接运行含真实账号入口的整个 engine 清单：

```sh
: "${HOMER_TEST_CODEX_BIN:?指定官方 0.171.0-alpha.7 的绝对路径}"
: "${HOMER_TEST_PREVIOUS_CODEX_BIN:?指定仅用于合成旧目录的 0.163.0 二进制}"
node --import ./tests/fixtures/synthetic-home.mjs --import tsx --test \
  tests/native-thread-continuity.engine.test.ts \
  tests/native-membership-websocket.engine.test.mjs tests/desktop-source-resume.test.mjs \
  tests/channel-native.engine.test.ts tests/scheduled-native.engine.test.ts \
  tests/native-memory-defaults-offline.test.mjs tests/native-plugin-shutdown.engine.test.mjs \
  tests/native-protocol.engine.test.mjs tests/deepseek-pinned.test.ts tests/deepseek-continuation.test.ts
```

`deepseek-continuation.test.ts` 还要求显式 `HOMER_OFFLINE_CODEX_BIN` 指向同一候选。提示词／目录入口要求 `HOMER_TEST_SERVICE_MODULE=file:///absolute/candidate/dist/service.js`，相邻 prompts 和脚本资源须来自同一源码候选；旧种子通过 `HOMER_TEST_CODEX_BASELINE_BIN` 显式选择，三者均不可指向日常数据目录。

首轮原生联合 72/73 的唯一失败来自系统 Skill 旧夹具只拦截公开 request，漏掉新增的私有原生发送路径。已改在实际发送边界重现旧禁用行为，全部能力／恢复断言保留；随后原生协议整组 6/6 通过。提示词原生直接覆盖的旧假设在新版不成立，测试改为实际调用 Homer 已有 `adoptMainPrompt`，核对当前规则在旧规则之后且原历史不变，没有新增产品覆盖或重写历史。检查点中断可保留两份当前提示词，继续沿既有边界，不宣称严格去重。

会员传输夹具关闭其合成目录的插件，插件能力由独立原生检查验证。记忆连接、业务连接、原生预热分别计数；成功 WS 的业务请求仍沿每个进程的原连接，最多允许一个未承载业务的原生预热连接。此处通过不证明真实网关的传输或计费行为。

完整类型检查及服务编译通过；最终共享工作树默认核心 **2737/2737**，零失败／取消／跳过，生产源文件在该轮期间保持不变。前一轮 2734/2736 包含当时刚补入、尚未修复的签收失败红例，以及专项分类夹具的子进程超时。签收与停止修复后联合 131/131 通过，未放宽分类、退出、安全或真实结果断言。更早的 2640/2660 及 2612/2613 均保留原结果，不能当作全绿。

已确认本轮测试所有者退出，回收下载／解压引擎、编译副本、原型和八个合成原生资料目录，逻辑大小约 571 MiB。约 8 MiB 改动前源码快照及少量脱敏检查记录暂留，用于这批未提交改动的精确归属与审阅；本轮审阅提交或撤回后删除。可重复入口和结论以上述维护源码与文档为准。

本次仅本地提交源码及验收记录，不安装、不重启日常 Homer，不改日常配置／数据库／历史，不推送或发布。最终 Homer 候选已补验真实会员网关 HTTP Code Mode Only：本次下发 Main Terra／medium、Worker Terra／high，6 个请求全为 HTTP 200，双角色模型生成 JavaScript→本地 Code Mode Host→随机回执回传→匹配最终文本全部通过，宿主实际 Worker 回传成功。预检 1/1、注册边界 3/3，通过后只进行一次实网任务，无宿主重试；日常配置和进程身份不变，详见[实网报告及入口](member-code-mode-live-validation-2026-11-16.md)。Mac Intel／Windows 实机、真实 WS、Sol、签名和安装尚未验证。以下历史记录继续对应其明确记录的旧引擎。

### 本地提交候选复核（2026-11-16）

以当前 `e4b90213` 为基线，仅叠加本轮 Codex 升级、跨来源适配及会员验收相关的 82 个文件／精确片段；不混入并行 HOME 运行实现、渠道、UI、电源或模型默认值改动，保留现有三项 UI 暂存。升级原生测试复用的合成 HOME 夹具作为测试依赖一并纳入，不改变日常 HOME 行为。

独立候选在 Node22.22.0 下完整类型检查和服务编译通过；默认核心 **2672/2674**，零取消／跳过。两项失败均为 `message-image-preview.test.mjs` 的既有预览／下载卡断言，在未叠加本轮改动的同一 `e4b90213`、同一依赖与 Node 下复现为 **1/3**，不改动、删除或跳过这些 UI 断言。不能用此前共享树的 2737/2737 声称该独立候选全绿。

固定官方 0.171.0-alpha.7 的原生继承／0.163 迁移 7/7、实际 Homer 双角色 Code Mode Only 合成闭环 1/1、插件／MCP／捕获子进程停机 1/1 通过。显式专项使用独立 HOME／CODEX_HOME、合成凭据和回环上游，没有追加付费模型调用。此前六个实际会员请求对应实网报告明确散列的共享源码快照，包含未提交的并行 HOME 实现；本次窄提交的原生合成验证单独记录，不将它冒充为再一次实网验收。

本轮仅本地提交，不推送、安装或重启日常 Homer，也不改日常配置或数据。提交后按既定审阅条件回收本任务的源码副本、下载包、旧归属快照及过时检查材料，维护源码与本文为复验依据。

## 用量优化与原生权限（2026-11-16）

本次独立提交候选从 main `22a21bcee59b5b472be0042d66e12725319d00c8` 提取，仅包含本轮权限恢复、目录指引和模型审批投影；不混入共享工作区并行的 Codex 0.171、provider／HOME、渠道或 UI 改动。使用 Node **22.22.0**、主线固定 Codex **0.163.0**；子进程 PATH 固定到相同 Node。没有注入 200K 压缩值、scope 或模型窗口，未设置时沿原生默认，显式原生配置继续生效。

最小离线入口：

```sh
node --import ./tests/fixtures/core-system-proxy.mjs --import tsx --test \
  tests/engine-runtime-policy.test.ts tests/engine-main-context.test.ts \
  tests/interaction-inspection.test.ts tests/project-mcp-service-directory.test.ts
```

本次扩展定向 **159/159** 与完整 `tsc -p tsconfig.check.json`、`git diff --check` 通过；扩展范围还包括 service-interactions、worker-native-owner、worker-interactions、main-native-approvals、engine-rpc-lifecycle、main-mailbox-delivery 和 main-mailbox-projection。命令、文件、权限和 MCP 的批准／拒绝都经真实 Homer 宿主、独立 SQLite 及合成引擎运行，检查完整改动与移位、网络目标、deny 路径、许可范围和不可批准标记。升级后的非空问题／用户决定／回执仍提供，完整宿主记录保持不变。自批、跨请求、过期／撤权和原回调防重放沿既有门禁验证。

固定原生专项登记在 `scripts/test.mjs` 的 engine 清单，不进入默认核心：

```sh
HOMER_TEST_CODEX_BIN=/absolute/path/to/project-pinned/codex \
node --import ./tests/fixtures/core-system-proxy.mjs --import tsx --test tests/usage-optimization.engine.test.ts
```

原生专项 **5/5** 通过，仅使用新建 HOME／CODEX_HOME、本地合成 Responses 和测试目录，不读取日常账号或调用外部模型。代理也只允许夹具回环目标；合成 ChatGPT 分支显式选择该原生内置 API 目录支持的 GPT-6.1 Sol，不改变产品模型默认。Main／Worker 启动策略快照及独立 `command/exec` 验证工作区内写入、回环 HTTP 成功、目录外写入失败；恢复原只读／离线线程后采用明确的新设置且不新增模型轮；可信项目的只读或禁网限制仍能收窄低层全权限配置。配置与 trust 原字节不变。

同线程压缩两例：合成上游报告 210K 输入，原生默认不触发压缩，显式原生 150K 阈值触发一次；各保持两个正常请求、原线程、已有 rollout 字节前缀和配置原字节，额外压缩请求独立计数。隔离线程通过原生 `thread/memoryMode/set` 禁用记忆生成，避免后台合并污染计数，产品记忆配置不变。专项观察原生标准输出协议，不依赖其他未提交任务增加的私有 RPC 方法。

独立完整核心回归为 **2550/2552**，无取消或跳过；两项失败均为干净 main 基线已复现的 message-image-preview 断言，未发现本次新增回归。干净 main 基线为 **2530/2534**，另外两项 test-suites 的 development／vendor 入口超时；这两项单独复跑 **2/2** 通过，候选完整回归也通过，没有放宽断言或超时。两项图片失败名称为：

- `decoded image removes its duplicate card and restores fallback across lazy reloads and revision changes`
- `HTTP preview failure retains the named download card and reports a failed download`

独立只读审查未发现新增源码问题，并核对了 0.163.0 原生权限层级。新增成本仅是启动时配置层线性扫描和审批浅投影，没有额外数据库查询、深拷贝或网络请求。对原 102 条检查结果按本投影重算，紧凑 JSON UTF-8 长度为 **826,940 → 213,870 字节（减少 74.14%）**；78 条审批中位数 **1,884**、最大 **4,649** 字节。保留准确操作、原授权和完整既有数据；这些数字不代表 token、延迟或套餐节省比例。

日常实例的工作区可写／按需审批／网络开启只保存在获授权的专属原生配置，不进入 Git，也不是对所有实例注入的默认值。未迁移业务库或历史，未安装、重启或发布。服务器 `command/exec` 和策略快照不替代真实模型工具执行；实模决策、目录指引遵循情况、Windows 和实际套餐降耗仍未验证。

## 主信箱与审批恢复

2026-11-15 本地提交候选复核：仅叠加本任务主信箱修复及错配审批回归，排除并行的图片、渠道与 UI 改动。独立候选的相关八文件 **127/127**、完整 `tsc -p tsconfig.check.json` 与 UI 类型检查通过。默认核心为 **2532/2534**，零取消／跳过；以下两项既有图片预览测试失败：

- `decoded image removes its duplicate card and restores fallback across lazy reloads and revision changes`
- `HTTP preview failure retains the named download card and reports a failed download`

干净 HEAD 的 `tests/message-image-preview.test.mjs` 单独对照同样为 **1/3**，准确复现这两个失败；该文件与图片实现不在本提交内，未为全绿修改、删除或跳过断言。此前 **2590/2590** 对应包含其他改动的完整工作树，不能用于声明独立候选全绿。提交复核未使用日常资料或追加真实 LLM；既有实模记录只代表各自当时的源码快照。

2026-11-15 补齐错配审批的隔离合成回归：`tests/service-interactions.test.ts` 使用真实 Homer 宿主、MCP 分派和独立 SQLite，合成引擎先检查当前文件审批，再两次回复另一事项已批准并送回的历史审批。两次均被 `interaction_inspection_required` 拒绝；当前通知保持 `received`，当前审批／原授权／消息正文、历史审批及两轮失败记录保留，独立新消息仍能处理，原通知和回调不重放。新增用例 **1/1**、相关四文件 **50/50**、默认核心 **2590/2590**，零失败／取消／跳过；`tsc -p tsconfig.check.json` 通过。在隔离源码副本中移除审批检查或恢复失败回执的 `blocked` 回写，新增用例均按预期失败。新增错配审批回归阶段仅修改测试与本记录，未改产品源码、日常资料或认证，未调用真实 LLM。

2026-11-15 最新实模：修正边界后仅追加未知操作 **1 轮、1/1 通过**，零失败／取消／跳过，没有模型重试，历史实际业务轮共五个；前两轮原始结果保留。当前 `gpt-6.1-terra / medium / standard`，固定 Codex 0.163.0。准备时并行目录提示变更触发零业务轮源检查中止；精确审阅后，77/77 合成检查通过，再冻结并执行唯一模型轮。原操作完整不变且 uncertain、无新增 Worker、received 与升级阻塞保持，全部断言通过。本轮没有 task_update 调用，笔记用途分支仍只作此前合成覆盖；未重复前两例或重跑本次模型。详见[新记录](main-mailbox-llm-validation-2026-11-15.md)。日常认证／数据库／任务未改，迁移与原生安装未执行；下文 2026-11-14 的失败及离线结果按原观察窗口保留。

2026-11-14 当前复核：基于 `423863e` 的未提交 main 工作树，默认核心 **2589/2589**，零失败／取消／跳过；相关协作与模型夹具联合 **73/73**，完整测试类型检查通过。此前源码／UI 类型及消息图片浏览器 **45 项**通过；本次真实验收只改测试、夹具和文档。私密路径祖先校验和原子迁移回归已纳入核心。经用户明确允许只借用 ChatGPT 短期凭据，三个真实 Main 场景各运行一次：**审批恢复、失效通知通过；未知操作首轮因测试断言错误中断，经用户批准的一次补验又触发 task_update 工具白名单限制，完整验收仍未通过**。合计四个实际业务轮，无自动重试；工具名不能区分笔记与业务动作，本次未追认通过。[详细结果与限制](main-mailbox-llm-validation-2026-11-14.md)。日常迁移与原生安装未运行。

使用 Node 22.22.0，并将子进程 PATH 固定到同一 Node。以下核心用例只创建独立 SQLite、合成消息和执行器，不加载日常账号、原生历史或安装版：

```sh
node --import tsx --test --test-concurrency=1 \
  tests/main-mailbox-delivery.test.ts tests/main-mailbox-projection.test.ts \
  tests/main-receipt-migration.test.ts tests/main-receipt-transition.test.mjs \
  tests/service-interactions.test.ts tests/engine-rpc-lifecycle.test.ts
```

覆盖 received 终态、准确 native 身份与 ACK 失败的执行归属、未处理/未送回的审批、显式用户恢复、旧库证据分类、跨库/过时预览拒绝、原子回滚与真实旧 Store 拒读，以及旧格式 CLI 的私密预览→兼容收束→新版迁移。合成资料验证不能代表日常迁移或原生安装已通过。验收记录与剩余门槛维护在[实施计划](superpowers/plans/2026-11-14-interaction-receipt-recovery.md)。

真实模型入口为 `tests/main-mailbox-recovery.engine.test.ts`，登记在 engine 清单并从默认核心排除。固定 macOS／Codex 0.163.0。独立测试 API 入口显式设置 `HOMER_MAILBOX_MODEL_TEST=1`、绝对 `HOMER_TEST_CODEX_BIN`、`HOMER_MAILBOX_TEST_BASE_URL`（不含凭据/查询的 HTTPS）、`HOMER_MAILBOX_TEST_MODEL`、可选 `HOMER_MAILBOX_TEST_EFFORT`（默认 low）和仅进程内的 `HOMER_MAILBOX_TEST_TOKEN`，只运行该单文件。经用户明确允许的 ChatGPT 短期凭据路径，另设 `HOMER_MAILBOX_TEST_AUTH_KIND=chatgpt-external` 和仅进程内的 `HOMER_MAILBOX_TEST_CHATGPT_ACCOUNT_ID`，不设 BASE_URL；采用固定引擎的外部短期 token 接口，不提供 refresh token，不复制认证文件／历史。由获授权的一次性私密执行入口只读原配置，测试本身不发现日常路径。入口在校验 canonical 祖先、权限及 Git 忽略后，于 `.codex/private/mailbox-model/` 创建全新 workspace/runtime/CODEX_HOME；不发现日常账号或凭据。Main 使用真实模型，历史失败、原 Worker 回调与资料为合成。审批恢复、过期通知、未知操作各一个业务轮，不通过重试挑选成功样本。先实际验证合成文件可读、目录外不可读、工作区不可写；工具网络禁用，Apps／Plugins／Hook、宿主 Skill 发现及记忆生成关闭。失败和成功均只输出场景、工具名、状态与计数；确认所有者退出后回收原生资料，停止未确认则保留。缺条件或模型选错均失败，不能以宿主拦截冒称模型正确。

2026-11-14 真实模型验收准备：原先正常审批案例已改成“已签收通知的历史协调失败→普通新用户消息恢复”，保留原通知和失败状态；用户消息没有偷偷绑定审批答案入口。调用通过真实宿主分派观测，不裁剪模型工具或替代授权检查；记录工具错误和禁止动作，检查审批原生回包只授予本轮目录读取且仅送回一次。失效通知不得答复或复活；未知操作必须实际读取原 operationKey 回执，不能只看任务概览，原回执、Worker 数及升级阻塞保持。预先定义的这些条件不会因模型表现而放宽。

无凭据、零模型轮的固定原生预检证实：合成目录读取成功、目录外读取被拒、写入被拒、工具网络连接被拒，进程确认退出。实际 Main 使用当前 `gpt-6.1-terra / medium / standard`；认证文件与 Main 配置运行前后摘要相同。两例通过；未知操作实际读取原回执、无禁止动作／工具错误，宿主按契约保留 `unknown`，但测试误要求 `completed`，导致原操作完整比较和升级门禁断言未执行。测试已通过真实 Homer 的离线重放先复现再修正，并在断言前采集后置状态。另一个启动角色误判在零业务轮时修复，不能与实际模型轮混算。首轮结果未覆盖；在下一条单独授权前没有自动追加模型轮。

用户随后明确批准仅补验未知操作一次，使用 `--test-name-pattern='^real Main mailbox decision: unknown-operation$'`，结果 **1 项失败、0 通过／取消／跳过**，退出码 1；前两例未重跑，没有自动重试。原操作完整不变、仍 uncertain，任务／Worker 各一个，received 保持，upgradeSafe=false；但 task_update 不在预先白名单。生产提示词允许用该工具维护笔记，它也承载目标／办理动作，本次只记录工具名，不能判断用途；保留失败，不放宽规则追认通过。该补验阶段没有改生产源码或白名单。随后获授权的用途边界修正仅改验收夹具与入口，见下方；未追认旧结果，任何新实模须明确授权。计划的真实 LLM 项继续未勾选，不能推进日常迁移或原生升级。

本轮验收边界修正：共享 `mailboxModelTrace` 观察器按实际字段区分 task_update 用途，仅绑定原 taskId 的纯 notes 更新取得参数豁免。goal、pause／resume／cancel／settle、混合参数、跨任务、继承或未知字段、异常类型继续失败。执行后检查原任务状态、版本／授权、Worker 与原 operation 完整不变，笔记精确写入，仅允许合法笔记 revision／时间变化或完整不变的幂等结果；调用未完成、效果不明、错误或其他禁止动作均不能通过。原单轮、received、unknown、原操作和升级门禁检查不变，不裁剪真实工具或替代宿主授权。

用途记录仅输出固定 purpose、targetMatches、allowed、outcome、notesEffectValid；不输出 ID、正文、参数、返回值、错误或路径。allowed 只表示本用例的参数分类，最终检查必须同时满足调用完成、效果核实和全部安全条件。真实入口与离线测试共用这一观察器，避免另写一套判断。真实 Homer＋合成引擎、类型伪装与跨任务、业务动作、异常效果、未完成调用及脱敏联合 **73/73** 通过。执行命令：

```sh
node --import tsx --test --test-concurrency=1 \
  tests/main-mailbox-model-fixture.test.ts tests/main-mailbox-delivery.test.ts \
  tests/service-interactions.test.ts tests/worker-interactions.test.ts
```

终版默认核心 **2589/2589**、完整 `tsc -p tsconfig.check.json` 退出 0，零失败／取消／跳过。未显式启用的实模入口仍在凭据读取和引擎启动前拒绝。本轮不追加真实 LLM，不读取日常认证或修改日常数据库／任务；两轮原模型结果保持原样，实际业务轮仍为 4，未知操作完整实模验收仍未通过。

日常资料迁移、正式签名候选及真实原生更新另待确认。现有 Electron 合成测试和禁用 autoUpdater 的测试 profile 都不能替代这项验收。

2026-11-15，另获本轮明确授权后，执行日常业务数据的在线备份和**只读副本门禁预演**；这不是默认测试的范围。源数据库连接保持 readOnly／query_only，使用 SQLite 在线 backup API，不普通复制活动 WAL；附件与原生历史按字节及引用核对，不加载账号、Homer、模型或渠道。备份完整性、保全与离线恢复比较通过；迁移预演在所有者及真实待办门禁下拒绝，副本仍为旧格式，未执行完整语义转换，更未写日常库。旧格式维护入口也只执行 preview，没有 apply。不能清 lease、改审批或重标历史状态来制造通过。

本次相关纯数据库／分类／旧格式回归 **39/39**，零失败／取消／跳过；在线备份另用合成 WAL 并发写入验证读事务快照与源只读边界。实际资料备份、逐行身份与指纹是私密运营材料，只在 Git 忽略且访问受限的 `.codex/private/` 保留，公开文档不保存真实行、内容或凭据。副本指纹不得用于正式 live apply；正式操作前必须重新取得受控备份／预览并确认原所有者退出。备份副本不启动第二个实例，预演拦截也不等于 schema 迁移已通过。

## Worker 目录上下文 v0.8

离线测试覆盖只读发现、五类标记、一级压缩、排除区、链接、路径转义、空与部分失败、截止时间／轮次失效、Main／Worker MCP 隔离和既有传输保护，以及根准备、独占创建、冲突、冷加载和关闭竞态。`work_directory` 和动态工具声明保持原样；测试使用合成目录事实，不扫描真实主目录。

固定原生验收独立登记为 `directory-native`，默认 `npm test` 不执行。不调用真实或付费模型，只连接拒绝其他路由的本地合成 Responses；不复用账号、HOME、runtime 或 `CODEX_HOME`。临时原生目录位于系统临时目录、在实际 Git 工作树外，以验证确实没有项目根的情形；确认本任务进程退出后删除。

```sh
npm run build:service
HOMER_TEST_SERVICE_MODULE=file:///absolute/source/dist/service.js \
HOMER_TEST_CODEX_BIN=/absolute/path/to/codex \
node scripts/test.mjs --directory-native
```

使用 Node 22.22.0、Codex 0.163.0。三项综合原生检查覆盖新建及旧 Main 原线程恢复、新 MCP 的实际调用、原动态声明与历史保留、实际 Homer 派工 cwd 与上层规则、Worker 未暴露新工具，以及无 Git 四层继承、同层 override、无兄弟规则加载、Git／自定义根、主目录外 cwd 行为、原生项目配置和信任、Skill 发现、畸形配置和标记冲突失败、Git 不受无关冲突阻断。候选文件夹查询失败时 Worker 仍能按系统主目录启动；新增兜底才揭示的受信任项目层根标记，已与原生配置方式对照其实际指令继承。

2026-11-14 提交前复审：在基线 `c6f8fd2` 上仅叠加本次改动的隔离副本中，Node 22.22.0 类型检查、服务构建与相关离线 162 项通过；Codex 0.163.0 原生专项连续三轮各 3 项通过，零失败、零跳过。完整默认离线 2432 项中 2430 通过、2 失败、零跳过；两项图片预览失败已在未修改的同一 HEAD 中单独复现，不记为完整通过。

同步至已提交的 `c9b6d28` 后，独立候选再次通过完整类型检查、服务构建、162 项定向离线与 3 项原生专项；上面的完整核心数字属于 `c6f8fd2` 基线，不混入其他未提交工作。

独立只读复审确认并修正了跨设备显式根被提前去重、失效根误报完整、默认入口链接重定向以及 `ENOTDIR` 误挡有效 Git 根，均有先失败后通过的回归。原生专项也覆盖自定义标记路径遇普通文件时继续使用 Git 根；合成上游明确拒绝外部代理请求，预期的客户端断连由夹具收口，其他错误仍失败。

本机 macOS ARM64／APFS 的合成负载为 300 个一级分支、3301 个业务目录，同一目录连续五次只读查询中位数 290 ms，范围 256–322 ms。仅代表本机合成负载。沿用按需元数据遍历，不增加缓存、后台扫描或并发框架。

真实用户主目录 `.homer-project-root` 未创建，日常 Homer 数据未使用，原 `work_directory` 文件和动态工具声明按基线做字节比较。Windows Known Folders、junction 和原生加载尚未实机验收。2026-11-14 经单独付费授权，在提交 `423863e` 的独立快照上完成 6 个真实 Main 场景：目录查询门控 6/6 符合预期，含子层规则加载的 cwd 标准 4/6 通过；两个样本选在父目录，仍需改进。Main 用量为 324,270 token、17 个工具轮次；原生后台请求用量未采集，不能当作账号总消耗。逐例耗时、隔离方式、计量修正及限制见[真实 LLM 报告](worker-directory-llm-validation-2026-11-14.md)。未做旧实现对照，净收益仍未证实。

2026-11-14 后续最小调整只修改 `list_work_directories` 说明和 Main 目录短规则，明确导航入口、任务子目录定位及原生指令加载边界。Node 22.22.0 全项目类型检查通过；目录发现／宿主 MCP／根准备／提示资源／派工契约六文件 35 项，以及旧 Main 提示采用与失败重试单项通过，共 36 项，零失败、零跳过。扫描逻辑、`work_directory`、`worker_open` 动态声明与原指纹按修改前内容核对保持不变。该离线阶段未重跑真实引擎、付费模型或完整默认核心，不把此前六例结果视为新说明的效果验证。

```sh
node node_modules/typescript/bin/tsc -p tsconfig.check.json --noEmit
node --import ./tests/fixtures/core-system-proxy.mjs --import tsx --test --test-concurrency=1 \
  tests/work-directories.test.ts tests/work-directories-service.test.ts \
  tests/worker-project-root.test.ts tests/worker-interaction-mcp.test.ts \
  tests/prompts.test.ts tests/recursive-tools.test.ts
node --import ./tests/fixtures/core-system-proxy.mjs --import tsx --test \
  --test-name-pattern='a legacy main adopts the current prompt once and retries an unacknowledged injection' \
  tests/service.test.ts
```

2026-11-14 随后经当轮付费授权，以 `423863e` 独立快照只叠加两处说明完成十次真实 Main 复验：原六场景通过 3/6（原说明为 4/6），客户合同含重复为 1/3，Atlas 为 0/3，账簿助手为 0/1；明确／默认适用三例均零查询通过。十次实际 Main 均加载新规则、Worker cwd 均与回执一致，不能确认这版修改改善选择。Main 用量 478,045 token、24 个工具轮次；另记同线程十条零输出响应的 99,040 输入，是否收费未知。指标、任务范围、源快照哈希和实际观察边界见[第二轮报告](worker-directory-llm-validation-2026-11-14-r2.md)。显式复验入口为 `scripts/worker-directory-llm-validation.mjs --paid <spec.json>`；`--self-check` 仅本地合成请求，不进入默认测试或自动付费流程。未更改提示词以追求通过，未推送或部署。

2026-11-14 第三轮先原样复现 R2 Atlas 一次，确认新工具可用、Main 规则已采用但省略 `workingDirectory`，默认派工失败。随后只在隔离 Main 候选中明确“目录由 Main 在派工前定位并显式传入”，固定十次、首败即停，最终十次均通过：合同及 Atlas 各 3/3，账簿助手 1/1，明确／默认适用 3/3 均零查询；九个本机资料任务全部显式给出正确 cwd，规则与调整后派工句均进入原生历史。候选提示资源离线五项通过，脚本语法检查及每阶段本地合成隔离自检通过。候选 Main 用量 826,454 token、46 个工具轮次；本轮另有 27,658 token 的失败诊断。该实验当时未替换正式提示词，扫描、查询说明、业务接口及动态指纹保持原样；2026-11-15 集成状态见下文。根因、备选方案、逐例数据、成本与限制见[第三轮报告](worker-directory-llm-validation-2026-11-14-r3.md)。复验入口支持在私有 spec 中用 `trials` 选择既有样本、`stopOnFailure` 控制预定的首败停止；只增加测试观测与预算控制，不进入默认测试，也不代表旧会话、Windows 或真实 Worker 任务已验收。

2026-11-15 已按第三轮通过的候选原文同步正式 `prompts/main.md`：目录规则置于派工段落前，派工句改为先确定目录再调用 `worker_open`。仅更新这两处产品文字；扫描、工具说明、`work_directory`、`worker_open` 及动态工具指纹按本轮修改前的内容核对不变，历史 R3 JSON 保持原字节。Node 22.22.0 全项目类型检查通过，上述六份定向离线测试 35 项及旧 Main 提示采用／失败重试单项通过，共 36 项，零失败／取消／跳过。工具与原生根检查仍用合成目录和协议，无日常账号或运行资料；夹具自行清理临时数据。本轮未追加付费验证、完整默认核心或真实引擎专项，也未提交、推送、安装或部署；此前 10/10 仍只代表第三轮隔离候选的样本结果。

2026-11-15 提交前复审：在 `423863e` 上只叠加目录上下文改动的独立候选中，整份 `prompts/main.md` 的 SHA-256 为 `b08f75fc3601b807b8fc95532cf6e8038efae16fd2c939142332e1713a5c4b82`，与 R3 通过的候选完全一致；查询说明也与当时快照相同。扫描、`work_directory`、`worker_open`、Main 动态声明、MCP 路由、根准备及提示采用的实现按基线逐字节核对未变。Node 22.22.0 类型检查与服务构建通过；上述 36 项加 `main-tools-resume-compatibility.test.mjs` 四项，共 **40/40** 定向离线通过。当前及 v0.1.4 指纹可沿原线程恢复，未知指纹仍拒绝。Codex 0.163.0 的 `directory-native` 三项及 `native-main-tools-resume.test.mjs` 单项共 **4/4** 通过；补充断言确认新建／旧 Main 实际请求恰有一份完整当前提示，旧线程中新提示位于旧规则之后，并保留线程、历史和工具声明。付费验证入口仅运行 `--self-check`，合成读写边界、token 观测及正常关闭通过；修正缺失 token 被转成零、空响应集合误报零及自检关闭未确认仍可退出成功的问题，不回写历史 JSON。全部请求仅到本地合成服务，无日常账号或 runtime。

复审也执行了原生引擎自身替换提示的四项对照：官方 0.163.0 直接 `thread/resume` 仍保留旧提示，四项均失败，与[原生对照专项的既有边界](../tests/scenarios/prompt-resources.md#原生请求检查)一致；它要求测试中的原生替换行为，不能当作 Homer `thread/inject_items` 采用路径的结果。本轮未修改引擎或放宽断言，Homer 实际追加新版的恢复路径按上段独立验收。本次提交仅目录相关文件和混合文件中的对应片段，其他未提交／已暂存工作保留；未追加付费调用、推送、安装、部署或完整默认核心回归。

### Homer 注入路径的四种历史状态（2026-11-15）

本轮以 `9a8c448` 的独立源码副本运行 Node 22.22.0／官方 Codex 0.163.0，运行时源码及正式提示资源不改；Main 文件 SHA-256 仍为 `b08f75fc3601b807b8fc95532cf6e8038efae16fd2c939142332e1713a5c4b82`。新增检查并入既有 `directory-native`，默认核心不执行，原生引擎自身替换提示的四项对照保持原样。

每例先由真实原生接口持久化合成旧指令、用户／助手记录和附件，再由实际 Homer 的启动／采用逻辑恢复原线程。中断通过关闭引擎后截取真实记录的持久前缀构造，不修改日常记录。第一次 `turn_context` 在业务消息之前，因此两个中断状态各补一例“已有历史”的后续检查点变体，共六例，分别确认初始上下文边界和已有用户／助手记录保留。

下表计数是实际模型请求中**完整现行 Main 提示词（含目录规则）**的份数，不是只匹配规则关键词；每例均由 Homer 注入一次，且冷重启不再注入。

| 历史状态 | 中断检查点 | 先压缩的请求 | 首次业务请求 | 冷重启后业务请求 |
| --- | --- | ---: | ---: | ---: |
| 完整历史 | — | — | 1 | 1 |
| 已有压缩历史 | — | — | 1 | 1 |
| 中断后直接续聊 | 初始 | — | 2 | 2 |
| 中断后先压缩 | 初始 | 2 | 1 | 1 |
| 中断后直接续聊 | 已有历史之后 | — | 1 | 1 |
| 中断后先压缩 | 已有历史之后 | 1 | 1 | 1 |

六例均确认完整新提示及目录规则进入 developer 请求、位于残留旧规则之后，线程 ID／记录路径不变，存活的原始历史前缀逐字节不变，原附件和动态工具声明／指纹保留。未压缩的已有用户／助手记录仍进入请求；压缩后检查原生合成摘要和原始记录分别保留，不要求摘要等于原文。恢复及冷重启本身均没有模型请求，新提示哈希已记录且冷重启不重复注入。初始检查点缺失时，原生重建与 Homer 的一次注入会产生两份相同新版提示，直接续聊后再冷重启仍为两份；先压缩样本随后归为一份。此处有额外上下文成本，不能宣称所有恢复请求恰好一份，本轮不修改运行时去重策略。

按该隔离基线，完整 Main 正文含资源授权段为 3,762 个字符、9,850 个 UTF-8 字节，不能把它们当成计费 token。重复的是整份 Main，外层消息分别还带原生宿主说明和新版覆盖说明。若正文占 T token，则这一项多占约 T 的有效上下文，并在压缩移除前持续存在，不是每轮继续添加一份；缓存复用不会将上下文中的两份文字删除为一份，见[官方缓存说明](https://developers.openai.com/api/docs/guides/prompt-caching)。本轮没有真实 token／费用增量、线上发生频率或模型质量对照数据。

处理决定：保留当前恢复及按版本一次注入，不增加去重，不根据初始检查点缺失或历史文本命中跳过注入，也不为消除重复主动触发模型压缩。现有回归要求完整新版至少一份、Homer 每版注入一次，并记录原生实际份数，不把当前两份固化为必须行为。原因与后续修复条件见[架构正文](architecture/main-worker-chat-architecture.md#worker-会话工具)。这里的一次是本矩阵采用成功且哈希已记录后的行为；注入成功但回执或哈希未确认的崩溃窗口仍沿用现有可再追加的边界，不承诺跨崩溃严格一次。表中的一／两份也不是所有失败恢复的数量上限。

关闭隔离编译副本中 Homer 的注入分支作为负对照，六例均在“缺少一次新版注入”断言失败；恢复原编译字节后执行正式专项。完整专项首轮曾为 8/9，失败源于本地合成 HTTP 服务逐 Buffer 解码使跨块中文变成替换字符；已用拆开一个中文字符字节的确定性用例先复现失败，再以 `setEncoding('utf8')` 修正夹具读取，保留完整提示比较断言。最终 **10/10** 通过，零失败／取消／跳过：原三项、六项注入状态和一项 UTF-8 回归。服务构建、测试语法及差异检查通过。

本次本地提交复审：在 `013992c` 上只叠加本轮四份相关文件／片段的独立候选中，运行时源码与正式 Main 资源仍与 `9a8c448` 相同；Node 22.22.0 类型检查、服务构建、测试语法及差异检查通过，目录原生专项再次 **10/10**，零失败／取消／跳过。另修正 UTF-8 用例等待首块数据时吞掉早期连接错误的问题；仅在隔离测试副本中关闭回环监听作负对照，立即得到 `ECONNREFUSED`，恢复原测试字节后执行正式专项。没有新增运行时分支或改变工具接口，其他在做的修改与原有暂存内容不进入本次提交。

沿用本节 `--directory-native` 命令；仅运行新增矩阵时可直接用 `node --test --test-name-pattern='Homer prompt injection preserves' tests/worker-directory-context.engine.test.mjs`，仍需显式设置本节两个环境变量。全部 Responses 来自拒绝其他路由的本地合成服务，使用独立 HOME、runtime、CODEX_HOME 和合成目录，不读取账号认证或使用日常 Homer 数据。仅更新测试与验收文档，原 `work_directory`、`worker_open`、扫描、正式提示词和恢复实现均保持原样；首次隔离验证阶段未提交；本次复审仅本地提交相关测试与文档，不推送或部署。该原生专项未验证真实模型在旧 Main 中的 cwd 选择、真实摘要质量、真实掉电／进程崩溃或 Windows；后续完整旧历史三个实模样本见下节，其他历史状态仍待实模验证。这些原生隔离结果不能扩大为实模效果或发布验收。

### 旧 Main 恢复后的隔离实模（2026-11-15）

以 `5d90119` 的独立快照和 `423863e` 的旧 Main 资源构造完整旧线程，原生接口写入合成消息及附件，不调用模型造历史；实际 Homer 沿原线程恢复并采用新版后，按预案只执行 K1、U2、K3 三个真实 Main 业务轮。GPT-6.1 Terra / medium / 默认服务档位，三例 **3/3** 通过，未重开业务轮或观察到原生重试。明确文件零查询并选择合同 `current`；未知 Atlas 查询一次、展开两次并选择 `native`；默认文案零查询且显式沿用 `Main`。原线程、旧历史前缀、附件及工具声明均保留，Worker 原生 cwd 与规则加载正确，Main cwd 未变。

Main 业务用量 **167,427 token**、7 个工具轮次；10 条业务模型响应，首次派工分别 6.653、14.752、5.762 秒。用量逐字段匹配原生历史和正输出响应；另有三条同线程零输出响应共 29,712 输入，不能混作业务轮或账号总账。Worker 仅接保持等待的回环服务，未付费解题；源认证／profile 摘要及真实主目录标记状态不变，所有隔离所有者正常退出。初次带 paid 标志的入口曾在本地探针匹配阶段失败，尚未进入实模；修正并加入两个后台干扰对照后才执行上述三例，失败记录保留，未重复业务样本。详见[报告与边界](worker-directory-legacy-main-llm-validation-2026-11-15.md)及[结构化证据](worker-directory-legacy-main-llm-validation-2026-11-15.json)。

复用 `scripts/worker-directory-llm-validation.mjs`：私有 spec 可增加 `legacyPromptsDirectory`，必须位于独立源码快照内，提供旧 `main.md` 和同版 `worker.md`；由原生资源加载器附加公共授权段。旧 Main 模式要求显式 `trials`，最多三个业务轮；无模型的旧历史准备完成后，再为 Main 恢复与业务阶段启动 180 秒计时；本轮为 `['K1','U2','K3']`，行为失败不重试，隔离／认证／运行异常停止整批，达到 12 次用量更新或 180 秒门限中断本轮。脚本仍不进入默认测试；`--self-check` 不读认证、不进入付费分支，包含旧线程准备／恢复的零模型请求检查。运行前构建服务，完整 spec 与执行方式沿用[现有显式入口](worker-directory-llm-validation-2026-11-14-r2.md#复验入口与收尾)。

本次只支持这三个完整旧历史合成样本的效果判断；未覆盖压缩、初始检查点异常或重复新版的实模效果，也没有新建 Main／旧提示对照，不改变保留当前恢复及不增加去重的决定。验证脚本、报告和目录验收状态已更新；运行时实现、日常数据及用户配置未改，首次验证交付时未提交。提交前复审仅修正旧历史准备期间可能出现的未监听超时，先复现未处理拒绝，再确认准备失败可返回并关闭宿主；同基线服务构建、语法、原生零付费自检和全部计量复算通过，付费执行哈希与修正后哈希分别保留。此次只本地提交本轮相关脚本、报告和文档片段，不追加付费调用，不推送或部署。

## 桌面防休眠与系统唤醒

2026-11-16 提交前隔离复核：以 main `4a284da2` 为基线，仅提取本轮 14 文件中的电源修复、回归和文档片段，未包含其他对话的未提交改造。Node 22.22.0 下，沿上述九文件命令运行的独立候选 **545/545** 通过，零失败／取消／跳过，退出码 0；完整类型检查及差异检查通过。该候选覆盖 Mac 编译／主 RunLoop 通知、首次注册识别、签名拒绝、Mac／Windows 恢复参数、轮询中唤醒的等待与关闭、宿主到期消息单次入箱及匹配回执。下列 **2739/2739** 对应共享工作树完整默认回归，不能替代独立候选范围；本次未重新运行真实休眠或实网专项。

2026-11-16 最终修复后共享工作树完整默认回归：北京时间 18:33:49—18:44:10，以项目 Node 22.22.0 将父／子进程 PATH 一并固定后执行原始 `npm test`，**2739/2739 通过，零失败／取消／跳过／待办，退出码 0**。运行前后及追加记录前逐项复核的 1,343 个输入文件字节一致；输入取 `git ls-files -co --exclude-standard` 去重排序、排除非测试输入 `outputs/`，逐文件 SHA-256 后对 `{path,sha256}` 数组 JSON 计算的指纹为 `107f4f68aafc3c429d5e45e42f837cae98675a8ebe97f4ba7d18db14ac3cc7c5`。本轮未发现需要新增修复的问题，未改变功能源码、测试、默认清单或安全断言；结果与此前 551 项定向及真休眠证据分别记录，不扩大为安装版完整恢复或实网补收通过。验收记录更新并同步后清理本轮临时日志和指纹文件，复验沿用原测试入口；未提交、安装、发布、创建系统唤醒事件或操作休眠。

2026-11-16 恢复链路复审：真实唤醒遇到未结束的清醒轮询时，原 `resume()` 会在补排的完整恢复结束前返回；以一行 `await` 修复，不增加状态、接口或依赖。三种回归先失败，再验证完成、20 秒超时和关闭取消均正常等待并释放保护。Node 22.22.0 下九文件联合 **551/551** 通过，零失败／取消／跳过：`node --import tsx --experimental-vm-modules --test tests/{macos-power-native,macos-power,desktop-power,desktop-power-host-ipc,desktop-update-runtime,electron-shell,channel-power,desktop-execution-power,windows-power}.test.*`；完整类型检查和 `git diff --check` 通过。原生编译／通知、首次注册边界、各跳恢复回执、到期消息单次入箱及签名拒绝继续通过；本轮未重跑默认全量、注册系统事件或实际休眠，未提交、安装或发布。下列真实休眠结果是先前独立验收，不等于新源码在安装版的完整恢复已通过。

2026-11-16 真实休眠对照验收：已安装 0.1.15（300，仍导入 `dispatch_main`）与 11-13 隔离编译修复 client 同时监听；候选二进制及三项原生源码指纹复核一致，ad-hoc 仍不能访问特权服务。安装版测试前出现过 `macos_power_connection_failed`，经用户重新开启后台运行后，签名客户端授权／查询／关闭恢复正常；该连接故障的根因尚未确认，不记为 didWake 修复的一部分。目标 17:54:06（北京时间）；系统记录 17:51:01 Software Sleep → 17:54:06 Wake，原因含 `rtc/HID Activity`，用户确认自动醒来。隔离修复 client 在 17:54:06 收到 1 次通知（目标后约 0.948 秒），安装版在同一观察窗（至 17:54:17）收到 0 次。**隔离修复客户端的真实系统通知复验通过**；主应用与原 HTTP 服务进程身份保持、原端口恢复并再次返回 200。原生列表为空、两客户端 close 确认且退出 0、测试身份残留 0，Homer 全局事件数 **0 → 1 → 0**。新源码没有安装，不能据此声明安装版已采用修复，或其 UI、恢复回执、在途任务及渠道补收完整通过；源码恢复链路仍以上述 535 项回归为证。本轮没有重跑默认全量、提交、安装新版本或发布。结论固化后清理本轮及两轮前序临时对照目录，复验入口仍保留在源码和测试中。 本轮候选 SHA-256：`9b49a95e9d90be3253203908f5987b566304dc5792629e3c17af01898103b07d`；`PowerClient.swift` SHA-256：`5dd32226464adffabb32e351a79b9f1d42eea9b44efcb15b2cb69c1257e8b13a`。

2026-11-13 `didWake` 源码修复验收：无休眠探针复现 `dispatchMain()` 不处理主 RunLoop 通知，改为 `CFRunLoopRun()` 后通过；编译真实 client 的隔离夹具向其主 RunLoop 注入本进程通知，确认输出 wake 且状态／关闭协议仍响应，ad-hoc 不能访问特权服务的边界保留。Mac 原生通知改用完整休眠恢复检查，Windows 定时入口仍为清醒检查；双通知合并、匹配回执、延后确认和错误回执均覆盖。宿主真实恢复入口在独立 SQLite 写入到期消息，重复恢复仅一条，不启动模型，等待渠道恢复后才答复。九文件联合 **535/535** 通过，零失败／取消／跳过，另通过语法和差异检查。测试包含 native、Mac adapter、coordinator、host IPC、runtime、Electron、channel、execution、Windows adapter；未重复默认全量。修复未安装，旧安装版当轮缺少恢复回执，不能追认其动作已执行；原生真实休眠复验已由 11-16 对照完成，安装版采用新代码后的完整恢复链路仍待验。已保留隔离编译的 ad-hoc 通知客户端用于下一轮对照，不注册服务、不替换日常应用。

2026-11-13 接电、上盖打开、用户手动休眠专项（安装版 0.1.13／298）：目标 14:20:24（北京时间）；系统日志记录 14:16:51 Software Sleep、14:17:19 DarkWake、14:18:04 Maintenance Sleep、14:20:24 完整 Wake，最后原因含 `rtc/HID Activity`。用户确认自动醒来，时刻与唯一测试计划吻合，但日志混合 HID，不能单凭该字段断言 RTC 是唯一原因。主应用进程与原 HTTP 服务身份保持，原端口恢复 200，实际设置页可打开且显示“当前无需系统唤醒”，未改偏好并已恢复原页面。测试身份列表为空、关闭回执确认、客户端退出 0，系统 Homer 事件数复查为 0。**部分通过**：系统睡眠／按时唤醒、宿主基础可用及清理已获证据；独立签名监测客户端直到目标后两分钟仍未采集 `didWake` 通知，原生通知路径不记通过，亦不能据此断言独立的 Electron 恢复路径失效。未验证在途模型／Worker 自动续跑或实网渠道补收。保留最小监测证据用于该通知问题排查，未提交、安装新版本或发布。

2026-11-13 经用户授权的真实系统计划专项：使用已安装 0.1.13（298）的签名客户端及独立测试身份，仅创建一个 60 分钟后的 wake，随即读回并撤销，不等待触发。创建回执／原生查询的事件 ID 和 UTC 时间完全一致，系统队列仅出现一次；撤销后原生列表为空，系统队列无测试身份残留，重复撤销无害、关闭回执确认、客户端退出 0。Homer 全局事件数 **0 → 1 → 0**，其他身份未受影响。未执行休眠、安装、提交或发布；此结果不能替代真实唤醒、宿主恢复和实网收件验收。

2026-11-13 首次注册修复的定向验收：Node 22.22.0 下，`macos-power-native`、`macos-power`、`desktop-power`、`desktop-power-ui`、`electron-shell`、`desktop-power-packaging` 六文件联合 **470/470** 通过，零失败／取消／跳过。原生契约覆盖完整服务待注册，以及缺文件、错误可执行路径、损坏清单、不安全权限和符号链接拒绝；client/helper 实际编译与 ad-hoc 签名不可注册检查保留。实际设置组件通过隔离内存桥验证待授权入口、拒绝后可重试、刷新不重复请求；不代表系统授权成功。未重复全量默认回归。用户批准后台运行后，已安装 0.1.13（298）的真实服务加载、root 运行与内核可执行路径、三组件签名及同 Team、XPC 已授权状态／空事件查询／连接关闭均通过；系统 Homer 事件数为零。设置页界面读取超时，不记为通过；修复源码尚未安装，产品首次授权界面及实际睡眠仍待验；系统计划专项见下段。未提交、安装新版本或发布。

使用普通 Node **22.22.0**。默认核心包含 `desktop-power` 协调／执行／profile／IPC／设置／打包契约、`channel-power`，以及 Mac／Windows 的合成适配检查；不会注册系统计划或修改电源策略。相关平台和工具专项必须显式选择：

```sh
node scripts/test.mjs --power-macos
node scripts/test.mjs --power-electron
node scripts/test.mjs --power-browser
# 仅在 Windows 上运行：
node scripts/test.mjs --power-windows
```

- `power-macos`：macOS＋已安装 Swift SDK，内存中的 owner／事件解析、arm64 优化编译、ad-hoc 签名标识及未授权状态；不注册、注销 helper 或安排真实事件。
- `power-electron`：macOS／Windows 交互桌面及项目 Electron。隔离进程短暂申请系统／显示保护，并验证所有 ID 在结束时释放；不让机器休眠。API 接受保护不等于真实睡眠验收。
- `power-browser`：已安装 Chrome；实际设置组件、1440px 与 320px、开关／间隔、键盘／焦点、失败／未知／重试与迟到回执。夹具仅用内存桥，结束关闭浏览器和服务。
- `power-windows`：Windows 自带 PowerShell／ScheduledTasks 的真实构造与序列化边界，注册／查询／撤销函数由测试替身接收；Mac 不满足平台前置，不能算通过。

2026-11-12 在冻结的 103 文件隔离候选中执行 `node scripts/test.mjs`：**2352/2352 通过，零失败／取消／跳过，退出码 0，耗时约 243 秒**。父 Node 与 PATH 子进程均为 22.22.0；统计为默认入口报告总数，未重复加总 VM 子套件。首轮仅 Unix socket 测试夹具因深目录路径截断失败；修为 Unix 相对路径／Windows 原生命名管道后，相关 10 项及完整默认回归通过，伪造、超限和无 owner 拒绝断言均保留。VM 子套件保持非空断言，视频夹具仍保留真实超限流、审批及精确文件校验。

主目录和候选中的 985 个源码／测试输入运行前后相同，SHA-256 指纹为 `5d9275aa4096b0700fefa0b74875972c99c78c4fce4ca22d2130748b8a87cfd8`。两端类型检查、后台编译、联合定向 98 项及归档 5 项通过。性能断言覆盖 1000 次相同状态通知不再计算日期、100 次执行变化不再额外查询原生事件；安排改变、5 秒校准、恢复、执行前保护及 60 秒原生复核保持有效。此前 Mac JS／原生／打包 31 项、隔离 Electron 1 项（7 个真实 API 断言）、39 项实际设置检查及 Vite 构建证据保留，本次未重复可选专项。

真实电源验收仍需独立资料与账号、Developer ID 签名的完整 Mac 候选或 Windows 签名候选和对应设备。由用户明确授权系统组件及休眠操作后，分别记录请求读回、实际醒来、宿主恢复、一次持久入箱；覆盖接电／电池、主动睡眠／合盖／锁屏、授权拒绝／撤销、崩溃、升级和卸载。Telegram 先测所有提供间隔及长轮询断连边界；微信、钉钉的离线保留契约未证实，保持正常在线收件。详细门槛见[电源架构](architecture/desktop-power-management.md#7-实施归属与验证)。本轮未执行上述签名安装、真实休眠或实网收件。

## 定时消息

以下四个文件由默认核心自动收集，仅使用项目 Node/npm 依赖、可控时钟、独立 SQLite、合成引擎与本地 socket，不运行日常 Homer 或访问外部模型。

```sh
node --disable-warning=ExperimentalWarning --import tsx --test --test-concurrency=1 \
  tests/schedules.test.ts tests/host-tool-calls.test.ts \
  tests/schedule-inbox.test.ts tests/schedule-host.test.ts
```

2026-11-12：普通 Node 22.22.0 下上述四文件 46 项通过，覆盖日期／DST、COMMIT 故障和重开库、背压、坏规则、两角色四工具、回执、撤权、schema 6→7、普通恢复和接管暂停；入箱即停用一次安排。未登录仍到期入箱、Main 初始化与群 `preparing` 期间保持原 `pending`、就绪后仅消费一次、期间撤权拒绝均已覆盖。最终联合候选完整默认核心 **2352/2352，零失败／取消／跳过，退出码 0**，985 输入指纹稳定，两端类型检查及归档 5 项通过。队列显示沿原投影验证，不新增管理页或工具。

固定引擎专项登记在 `engine` 清单，可仅运行本文件：

```sh
node --disable-warning=ExperimentalWarning --import tsx --test tests/scheduled-native.engine.test.ts
```

专项使用仓库已准备的固定 Codex 0.163.0、独立 runtime／CODEX_HOME 和回环 Responses 服务，不读取日常账号，也不安装引擎。已验证 Main／Worker 的原线程恢复、四工具目录、真实原生调用证据、原回执查询及隔离；两条规则、六条变更操作。它不验证真实模型的时间理解或业务判断，也不替代安装包和系统睡眠／唤醒专项。架构与联合全量状态见[定时任务方案](architecture/scheduled-tasks-architecture.md#8-当前状态)。

## ChatGPT 模型设置

配置、原生目录、账号桥、持久化、线程参数及设置草稿的离线回归沿现有测试文件维护，自动进入默认核心；固定上游组件源码校验登记在显式 `vendor` 分组。

```sh
node --experimental-vm-modules --import tsx --test \
  tests/model-config.test.ts tests/native-account.test.ts tests/native-account-service.test.ts \
  tests/desktop-profile.test.mjs tests/desktop-permissions-ui.test.mjs \
  tests/electron-shell.test.mjs tests/desktop-management.test.mjs tests/mobile-turn-build.test.mjs
node --test tests/model-selector-upstream.test.mjs
node scripts/build-run-activity-css.mjs --model-selector --check
npm run typecheck
npx --no-install tsc --noEmit -p ui/tsconfig.json
npm run build
npm test
```

测试使用合成 native control、VM Electron、隔离 profile 及本地协议替身，覆盖完整两角色校验、默认覆盖删除、原子保存、分页与隐藏模型、速度权限、失效目录、选择保留、可信窗口和跨来源确认期间导航失效。`electron-shell` 执行真实 `preload.cjs` 并接入实际注册的账号处理器，断言完整两角色参数转发、同来源不停止／重启和安全错误；实际 runtime 输入解析另验证超过原 128 字符上限的配置能完整到达绑定回调。`desktop-management` 验证采用旧资料时写入实际 profile、磁盘失败保全文件与内存；`desktop-profile` 交错两个实际写入器，验证取得排他文件后再读取合并，不丢快捷键或模型字段。`model-config` 验证活跃轮次不变、下一轮使用新模型／深度／三档速度、标准清除、图片能力变化和原生更新失败后重试。UI 延迟回执覆盖后台刷新先于／晚于保存失败的情况，错误提示均保留。真实固定引擎的检查扩展既有 `desktop-source-resume.test.mjs`（显式 `engine` 分组）：

```sh
HOMER_TEST_CODEX_BIN=/absolute/path/to/codex node --import tsx --test tests/desktop-source-resume.test.mjs
```

要求已存在的 Codex 0.163.0；独立 HOME／CODEX_HOME、合成模型目录和回环 Responses 验证同一原生线程、进程内通过 `thread/settings/update` 切换模型、深度、Standard／Fast／Ultrafast、标准清除旧档，以及 openai → homer → openai 保留原线程及推理历史。不访问日常账号或收费模型，不以原生模型目录缺少测试档位来推断服务档生效。

交互式 UI 复验运行 `node --import tsx tests/fixtures/desktop-model-settings-browser.mjs --serve`，用内置浏览器打开打印出的回环地址。该 fixture 打包实际 DesktopSettings 与局部官方 CSS，桌面桥完全合成；默认自动保存、`?scenario=failure`（首读失败后可重试）、`missing`、`plus` 分别检查保存重读、缺失模型与权限收回。`website`／`cancel` 验证跨来源的应用及取消，`save-failure` 首次保存失败后可重试；`stale-apply` 验证保存被拒后单次重读目录和失效提示；`account-error` 验证账号暂时未知时选择保留、操作禁用及重查恢复。需要验证桌面、390px、320px、无搜索、无可调深度、三档闪电、键盘、Escape、焦点与 Portal 102；截图保存到 `.codex/scratch/`。此入口仅供显式浏览器检查，不进入默认测试，Ctrl+C 清理该次临时目录。

2026-11-11 在 Node 22.22.0 上，定向七文件584项通过；补充完整角色与草稿、目录未知及失效深度提示，以及复审发现的应用拒绝后单次重读、临时账号未知时保留草稿回归后，设置 UI 94项通过。固定上游源码4项、两端类型检查、构建及最终默认核心2177项通过，均无失败或跳过。固定引擎专项1项通过，包含全部三档与同线程断言；实际设置 Dialog 在桌面、390px及320px完成交互检查，复审新增两条异常路径也通过实际组件的合成浏览器复验。源码通过不表示已安装；真实 Pro $500／企业权限及收费调用、打包后的 Windows／macOS 验收未执行。

2026-11-12 修复 preload 参数拒绝和 runtime 行长度导致的完整角色参数丢失，同来源改为自动保存、下一轮生效。真实 preload／主进程组合、活跃轮次隔离、profile 交错写入和后台读取吞掉保存错误均补充回归；相关新增失败先复现后修正。最终 Node 22.22.0 默认核心2187项、账号／移动设备界面116项全部通过，零失败、零跳过；两端类型检查、构建及固定 Codex 0.163.0 的隔离专项1项通过。构建保留现有大分包提示。实际组件在内置浏览器复验桌面、390px、320px、自动保存、重开保留、保存失败及重试、恢复默认、控件回焦、Escape、三档闪电及 Portal 102；跨来源仍需明确应用，未误触自动切换。测试页、临时服务和重复中间产物已清理；未安装、发布或调用真实账号与收费模型。

## Worker 消息移入对话区

2026-11-11：现有来源、消息包装、过程、队列和主输入回归共143项通过，无跳过；前后端类型检查及隔离 Vite 构建通过。新行为先以9项预期失败确认，再验证实现。覆盖无正文但已开始的可信来源、未开始及跨线程拒绝、精确收到回复快照、缺标题、静默成功、隐藏后的排序屏障、零可见行分页、回焦及用户待发送消息；原有安全、回执和排序断言保留。

```sh
node --import ./tests/fixtures/core-system-proxy.mjs --import tsx --test --test-concurrency=1 \
  tests/{taskcard-sources,taskcard-performance,chat-timestamps,message-queue-web,main-queue-sources}.test.ts \
  tests/{main-chat-display-ui,process-nodes-ui,internal-coordination-ui,restore-official-components,main-composer}.test.mjs
npx --no-install tsc --noEmit -p ui/tsconfig.json
npm run typecheck
```

真实组件验收扩展已有 `web-history-active-pages.browser.mjs`，复用原合成宿主和临时 Chrome profile。先构建当前产品入口到独立 scratch，再显式执行专项：

```sh
node scripts/build-preview-annotation.mjs
(cd ui && ../node_modules/.bin/vite build --configLoader runner \
  --outDir ../.codex/scratch/worker-processing-implementation-20261111/web --emptyOutDir)
HISTORY_FOLLOWUP_BUILD="$PWD/.codex/scratch/worker-processing-implementation-20261111/web" \
HOMER_SYNTHETIC_ROOT="$PWD/.codex/scratch/worker-processing-implementation-20261111/synthetic" \
HOMER_BROWSER_EVIDENCE="$PWD/.codex/scratch/worker-processing-implementation-20261111/browser" \
node --import ./tests/fixtures/core-system-proxy.mjs --import tsx tests/web-history-active-pages.browser.mjs
```

1440、390、320px三组新增场景及原390px分页/草稿场景通过，验证接收前后、标题早于答复、同一消息接续、混合队列与持久取消、展开保留、焦点、草稿、历史阅读位置、刷新和尺寸切换，零真实模型调用。缺少过程条目时仍为原状态行；展开验收使用已有 `start(initialText)` 合成公开进展。取消通过同一 `MainInputs.cancel` 真实 owner 绑定到合成 bridge，未替换产品服务或隐藏 DOM 冒充取消。结果和截图保存在上述 browser 目录，产品源码及专项脚本是复验来源。本次复核在 Node 22.22.0 上通过完整默认核心回归：2130项通过，零失败、取消或跳过。未进行真实账号/模型、日常实例、安装或发布验收。


## 三类范围

| 类别 | 入口 | 选择依据与前提 |
| --- | --- | --- |
| 默认核心 | `npm test` | 项目 Node/npm 依赖、基础系统工具与合成 fixture；可以启动本地协议子进程、HTTP 和临时数据库，不依赖真实模型连接 |
| 可选媒体集成 | `npm run test:local-media` | 涉及媒体读取/识别或发行承诺时；需要 FFmpeg/ffprobe、媒体 Python 依赖、Whisper 和模型 |
| 实际引擎集成 | `npm run test:engine` | 涉及引擎版本、适配、恢复或记忆协议时；固定 Codex 与合成提供方的用例不证明真实模型质量 |
| 主提示词恢复 | `npm run test:prompt-resume` | 评估修复后的 Codex 和更新官方引擎锁时运行。使用显式引擎与包内服务模块，见 [提示词恢复专项](../tests/scenarios/prompt-resources.md#原生请求检查) |
| 账号跨系统集成 | `npm run test:account` | 涉及登录/账号/网关契约或相关发行时；指定的隔离网站、AMH、桌面包和合成登录材料 |
| RTC 依赖集成 | `npm run test:rtc` | 涉及 Chrome/原生 WebRTC 兼容时；需要真实 Chrome 和当前平台的原生依赖 |
| 开发发布验收 | `npm run test:development` | 涉及构建、开发启动、交接、回退、打包、图标或相应发行时；包含编译产物、Git 历史、macOS 工具、Python PTY 和浏览器等前提，不是轻量默认回归 |
| 第三方源码维护 | `npm run test:vendor` | 供应源码、补丁、CSS 或许可文件变化及发行时；验证本地固定源码完整性，不连接上游服务 |
| 桌面产物验收 | `npm run test:desktop:acceptance` | 对明确提供的桌面包、引擎和编译模块验收；保留原有显式路径门槛 |

`npm run check` 仍为构建、类型检查和默认核心回归，不执行上表专项。无需依次运行所有命令：按改动及本次发行实际承诺的能力选择，已有有效证据和未验证项分别记录。普通测试分类调整只验证入口隔离、受影响的离线案例和类型，不据此扩展为全量或发布验收。

默认核心不是纯 JavaScript 跨平台测试：进程身份与锁保护实际使用 `/bin/ps`，部分合成 fixture 使用 `/usr/bin/false`、POSIX 脚本和本地进程/套接字。这些属于 Homer 自身的进程安全与协议契约，保留真实断言；不等同于要求安装可选媒体工具或浏览器。

多渠道首版的离线验收可用 `node --import ./tests/fixtures/core-system-proxy.mjs --import tsx --test tests/channel-host.test.ts tests/channel-plugin.test.ts`。两个文件由默认核心自动发现，使用临时数据库、合成引擎、实际 stdio MCP 桥和内存适配器。覆盖文字收件、消息及准确附件外送、订阅、换绑与重启恢复。

Telegram 群背景的离线验收可用 `node --import tsx --test tests/telegram-context.test.ts tests/telegram-channel.test.ts`。使用合成消息和引擎，验证窗口外的回复链、重叠去重、群和话题隔离、撤权与重启时的待执行请求、限流降级、主 Agent 输入、触发文本持久化及原消息回送。

多渠道真实引擎专项可单独运行 `node --import tsx --test tests/channel-native.engine.test.ts`。使用项目固定 Codex 0.163.0、隔离的 HOME／CODEX_HOME 和 runtime、回环 Responses 服务与模拟适配器。验证旧线程恢复、真实 MCP 调用、补读去重、换绑与未知发送恢复。需要本地已有项目固定引擎；不使用真实模型或渠道。

微信离线回归可用 `node --import ./tests/fixtures/core-system-proxy.mjs --import tsx --test tests/wechat-channel.test.ts`，由默认核心自动发现。使用临时资料与合成 iLink 响应，覆盖扫码授权、私聊来源、重放与轮询退避、解绑、订阅及附件跨重启外送和回执分流。主库和渠道库无需改表。

2026-11-07 的双微信测试账号实网验收覆盖原入口回复、事项订阅、解绑、重启和无新入站 30 分钟后的文字及可打开附件。真实 ChatGPT 配合两个模拟入口分别验证了追问、明确换绑和不指定入口的通知请求。macOS ARM64 本地候选包内宿主也通过微信和 Telegram 重启前后收发。隔日探测独立记录，30 分钟结果不代表平台承诺的通知窗口。

GitHub 构建规划的离线契约可单独运行 `node --test tests/github-build-plan.test.mjs`：只使用 Node 标准库，验证指定平台、未适配桌面目标阻止和完整 SHA 匹配，不执行依赖安装、产品编译或 GitHub 请求。该文件由默认核心自动收集，不属于真实构建专项。

Release 草稿直传的离线契约运行 `node --test tests/github-release-draft.test.mjs`：使用合成包、内存 GitHub 协议及回环 HTTP，验证标签来源、固定附件名、Mac 更新 URL、脱敏清单、完整下载摘要、缺平台及拒绝覆盖已发布版本，不访问 GitHub、不打包或签名。由默认核心自动收集；首次真实云端构建及设备验收分别记录，离线通过不替代它们。

### Windows 截图批注

定向离线回归覆盖两端的桌面壳、设置和截图发送合同。Windows 原生专项需要专用的 Windows x64 交互桌面、Node 22.22.0、已准备的 Electron 45 和未发布候选的 `Homer.exe`。框选会先在内存取主显示器的一帧，运行前确保该显示器上只有合成测试内容。在 PowerShell 运行以下命令。

```powershell
$env:HOMER_WINDOWS_TEST_APP = 'C:\path\to\candidate\Homer.exe'
npm run test:windows-capture
```

专项用真实 Electron 加载候选包里的壳、浮层和会话界面，在两个合成窗口前台分别触发全局键。用回环合成会话检查窗口与区域的像素、反向裁切、批注、发送及历史图片字节。Windows Server runner 的取图探针、Windows 候选打包和 Windows 11 端到端分别记录。[实施与现有证据](desktop-screenshot-annotation.md#6-windows-11-x64)

### 桌面自动更新：源码离线检查

当前 Mac／Windows 更新源及官网下载入口为 GitHub Latest。未签名 Windows 正式包携带显式配置和 latest.yml，后台下载、确认后安全安装；ready 前及安装前流式复核普通文件、大小和 SHA-512，签名模式仍严格验签。复用原 VM／合成归档，不调用真实 PowerShell、安装器、产品构建或日常账号。真实原生升级仍待单独验收。

2026-11-12 未签名 Windows 实施：关键行为用例先红后绿，提交前五文件离线回归 460/460 通过、0 失败、0 跳过；补充的读取期间路径替换用例覆盖两种签名模式及两个校验阶段。未签名构建显式禁用 electron-builder 的 signExecutable，避免环境证书意外启用签名。运行时夹具补齐了当前源码已导入的 readDesktopChatGPTConfig 和 chatgptModelConfig，复用真实模型配置函数，原停止断言保持。准确复验命令：

```sh
node --experimental-vm-modules --import tsx --test tests/electron-shell.test.mjs tests/electron-package.test.mjs tests/github-release-draft.test.mjs tests/desktop-update-stop.test.mjs tests/desktop-update-runtime.test.mjs
```

性能抽查（macOS ARM64、Node 22.22.0，合成 256 MiB 文件，直接执行当前验证函数）：ready／安装前分别 513／502 ms，最大读取块 64 KiB，采样 RSS 峰值增量 45 MiB，事件循环最大延迟 10.7 ms。此为本机合成样本，不能替代 Windows 磁盘、杀毒软件及原生升级性能验收。

覆盖显式未签名／签名及畸形配置、损坏／缺失／非普通文件、SHA-512／大小缺失或不符、缓存及 ready 后替换、异步候选更换、确认／ACK／exit0、失败退出重开、原生清单固定名改写、11 附件集合、缺清单及云端坏下载。官网实际 Svelte 组件隔离回归通过，检查中英文桌面／390px 的“未签名”及原下载／焦点行为；Svelte 静态检查无错误。未运行 Meteor、安装包构建、真实模型、Windows 原生升级、生产官网或 CDN 验收。

以下为上一轮切换 GitHub 来源的历史验证记录。

2026-11-12 更新源切换先以旧地址复现四项定向断言失败，再修改主进程、Forge Windows 配置及生成壳的配置 URL；下列三文件离线回归通过，覆盖 Mac 两架构 feed、Windows generic 地址、未签名禁用、验签及原安全重启合同。未运行产品构建、原生更新、安装或日常 App：

```sh
node --experimental-vm-modules --import tsx --test tests/electron-shell.test.mjs tests/electron-package.test.mjs tests/github-release-draft.test.mjs
```

Yezi2 的设备识别／三平台 Latest 链接和旧 feed／下载 handler 共 11 项离线检查通过；现有真实 Svelte 组件的隔离浏览器回归通过，覆盖中英文、1280／390px、发行详情链接、无固定 build、44px、Escape 和焦点恢复。夹具只转译组件并使用合成账号与商品，不运行 Meteor 或发行构建，不代表生产官网或 GitHub 原生更新已验收。准确网站命令与旧 feed 保留边界见 [官网合同](../../yezi2/docs/homer/desktop-release-data-contract.md)。以下为此前实现的历史验证记录。

2026-11-04 提交前在当前 main 的干净候选重验：下述十文件主命令 455/455、浏览器边界 2/2、静态签名配置 1/1 通过，均无跳过；后端／UI noEmit 与差异检查通过。候选排除其他任务的未提交用例，因此不直接沿用共享脏树的历史数量。未安装新增依赖、构建、安装或发布；真实原生功能与性能未验证，下列共享脏树 schema 基线失败保留原证据范围。

2026-11-04 停止证明与恢复的最小回归（按改动选取）：

```sh
node --experimental-vm-modules --import ./tests/fixtures/core-system-proxy.mjs --import tsx --test tests/electron-shell.test.mjs tests/desktop-update-runtime.test.mjs tests/desktop-update-stop.test.mjs tests/desktop-update-ui.test.mjs tests/process-lock.test.ts tests/engine-rpc-lifecycle.test.ts
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
node --check packaging/electron/main.mjs
```

固定 Node 22.22.0 下六文件最新结果 389/389 通过、0 跳过，后端 noEmit 和差异检查通过。本次沿原 fixture 新增三个案例：首次采样期间父进程已退出的孤儿、与 owner 同时创建且归属不明的孤儿均拒绝确认，合法外部父链继续放行；前两个修改前失败，修改后 19 项进程相关检查通过。此前新增或扩展的 22 个案例继续保留：EOF 后新后代／孤儿、外部 PID 复用、未知时间／快照失败及合法外部进程；停止中报错与 ACK／exit0 的交错顺序、窗口销毁、取消后显式退出，以及缺失证明／超时后的迟到回执、恢复后迟到的安装前验签不能继续安装。保守拒绝边界与状态规则唯一见 [第 6 节](desktop-app-update.md#6-安全停止后才重启)。本次未改 shell 或恢复流程；未调用真实 PowerShell／NSIS、未构建、安装、提交或发布，下列原生未验证项和已有 schema 基线失败不变。

定向执行：

```sh
# 使用项目固定 Node 22.22.0；仅源码、合成子进程和隔离临时目录。
node --experimental-vm-modules --import ./tests/fixtures/core-system-proxy.mjs --import tsx --test tests/electron-shell.test.mjs tests/electron-package.test.mjs tests/desktop-profile.test.mjs tests/desktop-update-stop.test.mjs tests/desktop-update-runtime.test.mjs tests/desktop-update-ui.test.mjs tests/process-lock.test.ts tests/engine-rpc-lifecycle.test.ts tests/homer-account.test.ts tests/web-upgrade.test.mjs
HOMER_TEST_ENGINE_MODULE="$PWD/src/engine.ts" node --import ./tests/fixtures/core-system-proxy.mjs --import tsx --test tests/desktop-browser-boundary.test.mjs
node --test --test-name-pattern='formal packaging requires' tests/electron-package.development.test.mjs
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
node node_modules/typescript/bin/tsc --noEmit -p ui/tsconfig.json
```

主命令沿默认核心文件扩展，没有新增测试文件或改变分类；browser-boundary 仍属原桌面专项，本轮仅通过显式源码路径与 tsx 运行其合成权限断言，不运行包验收。development 文件只显式筛选既有静态签名配置断言；其余构建／产物案例未执行。UI 仍只在内存转译产品 hooks／JSX，用 React DOM 合成环境验证，不生成 UI 包。

本轮 2026-11-04 Windows 源码结果：主命令 431/431、浏览器边界 2/2、静态签名配置 1/1 通过，均无跳过；后端／UI 的 noEmit 类型检查、受影响脚本语法与 diff 检查通过。依赖仅更新声明与锁文件，未安装新增包；测试通过库替身验证协议，不证明实际打包、库动态加载或 Sharp 原生编解码。既有 671 条包记录的版本与完整性未变；新增依赖只进入 Windows 生成 payload，Mac 运行依赖集合保持。

额外执行 `node --import ./tests/fixtures/core-system-proxy.mjs --import tsx --test tests/mobile-desktop-profile.test.mjs`：2 通过、1 失败。固定 schema owner 指纹断言期待 ee1189f5…，本次冻结的共享脏树实际为 fe5ffd2c…；同一冻结输入使用修改前的 sourceSnapshot／schemaHash 逻辑仍得相同结果，确认本轮 Windows 适配未改变该指纹。主检出当前也复现这条既有断言失败。未改相关 schema owner、测试预期或兼容白名单；该基线问题须在后续发行验收前由所属变更处理，不能据此放宽兼容门槛。

三目标的真实窗口／读屏／阅读位置、原生资源与签名升级、正式按用户基线／数据保留、Windows Authenticode／ACL／进程树／无 UAC／NSIS 失败恢复、真实库缓存、上传后的最终 URL 与官网／CDN 均未验证。Windows 发行仍未就绪；获准构建前按 [桌面更新方案](desktop-app-update.md) 第 8.D 节登记真实专项前置条件，不放宽原桌面验收门槛。

历史记录（本轮不以旧数量代替 Windows 验证）：2026-11-04 Mac／共享源码六文件 270/270、静态签名配置 1/1、UI 类型检查退出码 0。

2026-11-04 安装失败恢复定向检查：`node --experimental-vm-modules --test tests/electron-shell.test.mjs tests/desktop-update-stop.test.mjs tests/desktop-update-runtime.test.mjs tests/desktop-update-ui.test.mjs`，261/261 通过、0 跳过。新增八个离线案例：同步抛错／异步报错后的显式重试、退出、取消，以及未保存编辑／页面切换保护；同时覆盖隐藏提示、取消后菜单重试、重复回执，并强化缺少 ACK、非零退出、信号退出不能放行的原断言。六个核心案例先红后绿，使用原 VM fixture，不启动 Electron 或原生安装器；真实失败恢复仍未验证。未修改 UI 源码、打包配置或接口，本次不重复无关构建／类型检查，也不执行安装、提交或发布。

2026-11-04 窗口销毁恢复补充：沿上一段相同四文件命令，265/265 通过、0 跳过。原 VM shell fixture 模拟窗口 close／closed／window-all-closed、页面销毁及销毁后脚本拒绝；新增三个“先关窗、后报错”的重试／退出／取消回归（修改前均失败），并验证无父窗口弹窗、取消后菜单重试、不再停止 runtime、不自动重建页面、不重复安装或 relaunch。另新增确认期间新开窗口拒绝旧确认，并扩展未知停止断言至窗口已销毁的情况；原存活页面、未保存编辑和导航保护仍通过。JS 语法检查通过。未启动 Electron 或原生安装器，真实窗口与安装失败恢复仍未验收；未构建、安装、提交或发布。

Homer 内置文字反馈的离线契约：`node --import tsx --test tests/homer-feedback.test.mjs tests/first-launch-distribution.test.mjs tests/first-launch-distribution.development.test.mjs`。反馈测试使用独立 scratch 目录、合成项目配置及替身 fetch，验证完整 Skill 分发、输入/隐私检查、接收回执和失败不重试；`homer-feedback.test.mjs` 由默认核心自动收集，分发 development 文件仍按原专项归类。首次启动的合成宿主回归按下述代理隔离命令运行 `tests/first-launch-initialization.test.ts`。

反馈真实外发不在默认测试内。脚本已填入用户提供的 Homer 公开写入 projectKey，以及 TraceMind 在线接入指引返回的 HTTPS 用户反馈接收地址（不得填 MCP token）；配置缺失时返回 `not_configured`。另行授权后用独立 Homer runtime/CODEX_HOME 和合成内容验收真实 Agent 调用，在 TraceMind 端按同一反馈编号核对，验证线上项目归属、协议、来源屏蔽、共享限流及大陆网络；离线通过不能替代这些证据。脚本不采集用户身份，但服务端可能记录 IP。

2026-11-03 反馈审查与验证：隔离源码中的反馈／分发测试 13/13 通过，无跳过；覆盖中文分块、长度边界、安装后执行、响应体超时、回执缺失、不重试和固定候选目录复制。`npm pack --dry-run --ignore-scripts --json` 确认 Skill 与脚本均进入包清单，不生成安装包。macOS 原生沙箱禁止读取 CODEX_HOME 父目录、允许读取 Skill 子目录并禁网时，原 Node 命令复现 `EPERM`，加入 `--preserve-symlinks-main` 后取得模拟回执，未放宽权限。Skill 已采用该命令。首次初始化 14 项测试在干净 main 基线与候选中均为 10 通过、4 失败：旧的 failed/uncertain 预期、已移除的 observe fixture、processing 恢复和 FIFO 顺序断言；本任务未修改这些基线断言，也未把其他未提交修正纳入提交。

2026-11-08 首启候选基于 `598be7cee93d`。新增的三项启动回归在基线上均失败，候选通过。Node 22.22.0 下，合成宿主、旧输入恢复与 FIFO、归档 Skill 选择、反馈、账号界面及分发和包清单共 147 项通过，零跳过。`npm run build:service` 与 `npm run typecheck` 均通过。验证使用独立临时数据和合成引擎。打包桌面、跨项目账号专项和真实模型未运行。

2026-11-09 旧首启轮退役回归在 `bc38033` 基线上复现旧排队输入被执行。Node 22.22.0 下 82 项定向检查、2033 项默认测试和类型检查通过，默认测试零跳过。9 项打包 macOS 合成验收通过。桌面新实例零自动模型调用。两次正常重启沿用原线程，未领取的旧首启回执转为取消，结果未知的旧回执未重放，真正的排队消息只执行一次。此处验收使用合成引擎，真实账号未参与。

2026-11-03 17:29–17:36（Asia/Shanghai）另行授权的真实验收：独立 Homer 源码实例和 CODEX_HOME，真实 DeepSeek Agent 自动读取 Skill、整理合成问题并提交；TraceMind 的 Homer 项目按唯一标记和编号 `oa5eBtwTtR3bQip2o` 回查只有一条，标题和正文与提交内容一致，无联系方式、附件或关联行为证据。首次初始化出现 `engine_rpc_failed`，随后 Agent 继续反馈；验收程序总时限在提交后 3.4 秒中断回执等待，服务端稍后入库，因此仅确认真实投递与收件，不代表 Agent 成功回执闭环已通过。没有重发、更新或重启日常 Homer。此次审查不再次真实外发；无代理大陆网络、共享限流阈值及复杂敏感内容脱敏仍未验证。

默认入口预加载 `tests/fixtures/core-system-proxy.mjs`，仅将 `/usr/sbin/scutil --proxy` 替换为固定的无代理设置，不查询本机系统代理，不修改系统配置或代理环境变量。显式专项不加载此替身。`model-config.test.ts` 的合成 CLI/host 子进程单独显式加载它；新增同类子进程也必须显式加载，不能假定普通 `spawn` 会继承 `--import`。代理解析和环境变量转发仍由 `proxy.test.ts` 的真实函数断言覆盖；本机系统代理发现能力未据此验收。

离线定向运行引擎相关核心文件时使用 `node --import ./tests/fixtures/core-system-proxy.mjs --import tsx --test <测试文件>`；直接运行文件不会自动获得默认入口的代理隔离。

默认入口仅在测试子进程的环境副本中清除 `HOMER_MCP_ENGINE_MODULE`、`HOMER_MCP_SERVICE_MODULE`、`HOMER_RECEPTION_SOURCE`，让 MCP/reception 核心回归使用当前仓库源码；不改调用者环境或其他变量。显式专项保留这些变量，但不会因此自动加入核心文件。需要兼容预览时，显式设置所需变量并直接运行对应文件，例如 `HOMER_MCP_ENGINE_MODULE=/绝对路径/engine.ts node --import ./tests/fixtures/core-system-proxy.mjs --import tsx --test tests/project-mcp-lifecycle.test.ts`。原有断言和环境变量控制的维护案例均保留；预览必须使用隔离源码及合成 fixture，不指向日常安装或运行目录。本次仅隔离这三个变量，不处理 UI 的源码覆盖入口。

2026-11-02 源码覆盖隔离的定向证据：新增三个合成入口案例修改前 2 通过、1 失败（默认入口实际加载了替代源码）；修改后入口回归 14/14 通过、0 跳过。验证默认隔离、显式专项和直接文件预览保留覆盖能力，以及无关环境变量保留；四份 MCP/reception 测试内容未改。本轮未运行完整核心或真实兼容预览验收。

2026-11-02 代理隔离的定向证据：入口回归 11/11 通过，新增哨兵案例修改前失败、修改后通过；合成 CLI/host 新建与恢复、代理解析、进程锁及合成 MCP 生命周期共 8 个选定案例通过。未运行全量或真实系统代理验收，未改变其他已记录的未验证项。

专项需要的已有变量仍由原案例定义：engine 中的 `HOMER_TEST_CODEX`、`HOMER_TEST_CODEX_BIN`、`HOMER_OFFLINE_CODEX_BIN`，以及两份 DeepSeek 案例使用的项目固定引擎路径；account 中的 `HOMER_TEST_APP`、`HOMER_TEST_CONNECTION`、`HOMER_TEST_SYNTHETIC_LOGIN` 和网站/网关地址等。不要指向日常 Homer 的账号、runtime、CODEX_HOME 或安装。没有增加第二套连接配置，也不自动安装或下载工具。

已存在的 71 份 `*.browser.mjs` 和 4 份 `*.integration.mjs` 不由默认入口收集。它们仍按各文件的明确入口运行：四份移动联调需要 `HOMER_YEZI2_ROOT`，并非 `test:rtc` 单个依赖互通案例的替代。`scripts/real-*` 等真实模型任务仍需单独的授权、数据范围和预算；发版选择专项不自动授权付费调用。

## macOS CUA 启动与失败收尾

macOS CUA 启动与失败收尾的定向离线检查：

```bash
node --experimental-vm-modules --import tsx --test tests/desktop-cua-driver.test.mjs tests/desktop-cua-lifecycle.test.mjs tests/chrome-cua.test.ts tests/worker-interaction-mcp.test.ts tests/desktop-update-runtime.test.mjs tests/desktop-source.test.mjs
```

这两份新增测试属于默认核心：SDK 子进程仅导入测试临时目录里的合成 SDK，生命周期用 VM 替身，不启动 Chrome、不调用原生驱动或模型、不读取账号。覆盖独立进程与 BigInt、异步启动、十五秒预算、SDK 原因脱敏、父连接断开、阻塞构造器取消、关闭挂起时强制退出、首次读取回滚、清理未确认占用、隔离失败停止、helper 错误分类及未知输入不重放。上述六份定向测试 90 项通过；新增模块已纳入候选源码清单。真实 SDK 的主线程／工作线程双重加载探针曾出现 SIGABRT，产品改为独立 Node 子进程。合入前复核另覆盖损坏／缺字段回执与输入派发后取消：读取失败返回受控协议码，动作保留结果未确认及绑定，不继续输入；合法省略结构化 JSON 的动作回执仍可成功。

2026-11-11 原生验收使用已安装签名 Homer 的独立测试资料和本任务新建的 Chrome，只将 scratch 编译的候选模块与新 helper 用于探针，SDK、驱动和解码器仍为经资源校验的包内版本。先确认旧 helper 无法读取视口，单次 AX 启用请求约 2.2 秒后恢复；候选复用路径首个 helper 约 2.19 秒成功，显式隔离带 AX 启动参数。两条路径均完成真实读取、一次点击和原尺寸纯视口 PNG，尺寸分别为 `2400 × 1472`、`2400 × 1584`，已检查截图；错误窗口与非 Chrome 目标被拒绝，回收均确认。另验一次审批后桌面读取、首读 AX 失败清理后显式重绑、隔离取消后禁止默认回落；真实 SDK 连续启停、1 ms 启动超时分类和启动中取消均通过。新 Swift helper 编译及实际锁屏专用码通过。此范围未使用真实模型、日常资料或既有浏览器窗口，未重打包、安装或发布，不能代替完整安装包与真实 Worker 验收。

合入前使用普通 Node 22.22.0 在独立 worktree 运行完整默认核心：2142 项通过，零失败、取消与跳过；后端及测试类型检查通过。签名安装包的 Node 会拒载开发目录中 Team ID 不同的原生依赖，不用于本轮完整源码检查。

合成 SDK 的独立 IPC 测量（Node 22.22.0）只验证代理传输开销：6 次子进程引导中位数约 24.5 ms，100 次小回包往返 p95 约 0.08 ms，40 次 1 MiB 回包 p95 约 1.09 ms；不代表真实截图、冷系统启动或低配设备的端到端时延。

## Windows x64 CUA

离线回归验证 Windows 依赖锁和签名后资源清单、Worker 命名管道、Chrome 地址栏校验、截图范围、同帧预览缩小以及未确认退出时保留 profile。使用 Node 22.22.0：

```sh
node --experimental-vm-modules --import tsx --test tests/chrome-cua.test.ts tests/desktop-update-runtime.test.mjs tests/electron-package.test.mjs
```

包内冒烟需要 Windows x64 和本地 Authenticode 候选包。沿用 `scripts/build-desktop.mjs` 的签名构建入口，使用已审查的提交、配置好的证书和发布者，不加 `--unsigned-windows`，只保留本地候选产物。当前 GitHub 工作流的 Windows 包未签名，不能替代此步。在隔离账号中将 `HOMER_TEST_WINDOWS_APP` 指向含 `Homer.exe` 的绝对目录，再运行：

```powershell
node scripts/test.mjs --cua-windows
```

该专项核对资源清单和嵌套签名，使用包内 Node 检查 Worker 命名管道，再使用原厂 SDK 和私有驱动，核实无驱动回执时结束 Job、宿主被强杀后回收及残留目录清理。通过只代表包内通信和进程链可用。

真实 Worker 验收在同一候选包、已解锁的 Windows 交互桌面和独立测试账号中进行。`--test-profile` 会替换引擎，不能用于这一步。用户话术只描述任务：

1. 打开同一应用的两个测试窗口，批准指定窗口，读取、点击、键入并保存 PNG。观察目标应用状态，确认另一窗口未变。
2. 用已安装的 Chrome 登录合成站点，确认无远程调试参数、端口和 `DevToolsActivePort`。要求 Worker 在原标签页导航并点击，服务端确认登录态和一次点击。分别核对正常与高 DPI、书签栏开关下的纯视口 PNG。再显式要求临时隔离，核对独立 profile 和未登录状态。
3. 从原会话下载桌面和网页 PNG，对照任务原件的 SHA-256；至少一张大于 2 MiB。依次复测取消、驱动无响应和强退重开，确认已有 Chrome 保留、临时 Chrome 及子进程和 profile 已回收，未知动作不重放。另测强杀完整宿主进程树时的旧引擎退出证明；被现有接管检查拦下时保留失败证据。

本轮只运行了离线检查、官方归档核验及 Windows x64 辅助程序交叉编译。没有签名候选包或 Windows 交互桌面，包内冒烟和真实 Worker 验收仍未运行。

## 结果与过滤

- 默认启动时列出专项未运行／未验证，不因已有环境变量而启用专项。
- 原真实断言、环境门槛和已有条件跳过均保留。本次不新增缺项跳过。专项启动时提示 skipped/not-run 仍未验证；退出码 0 不代表被跳过的案例通过。
- 断言失败保留非零退出；空套件明确失败；信号和 Node 测试参数继续传递。指定 `--test-name-pattern` 未执行的案例同样没有验收证据。
- 可按稳定案例名过滤，例如 `npm run test:development -- --test-name-pattern=HMR-UPGRADE-001`；需要编译资源的案例须先在独立副本准备构建。直接指定测试文件也是显式执行，不受默认收集边界保护。

移动设备下载弹窗的焦点回归可单独运行 `node --test tests/mobile-download-focus.development.test.mjs`。该开发专项需要项目 Node 依赖及已安装的 Chrome；使用隔离浏览器配置和合成设备数据，阻断页面外部请求。

iOS 签名防护的离线回归：`node --test tests/ios-xcodebuild.development.test.mjs`，使用 Node 22.22.0 和 POSIX 进程组（macOS／Linux）。以合成控制台状态和独立 Node 子进程替代 ioreg、caffeinate、xcodebuild，验证解锁前不得签名、无法读状态时失败关闭、防休眠进程丢失、输出分块中的凭据错误、退出码和取消／终止回收。属于 development 显式清单，不访问真实账号、钥匙串或 Apple 服务，不执行真实构建／上传，也不主动锁屏复现账号丢失。

2026-11-13：该防护与 `tests/test-suites.test.mjs` 联合 **28/28** 通过，零失败／取消／跳过；新文件已登记 development，默认核心不会隐式运行。真实 macOS 只读冒烟经防护入口调用 `-version`，返回 Xcode 27.2 / 27B52、退出 0；首次冒烟发现登录完成字段应为 `kCGSessionLoginDoneKey`，已用本机实际字段修正夹具和识别逻辑，保留未知状态拒绝断言。未执行真实签名、导出、上传或账号变更；手动／强制锁屏及合盖仍无法由防休眠断言阻止。

## 分类维护与本次拆分

`scripts/test.mjs` 是入口分类的唯一维护清单；默认核心排除所有显式清单文件，本地媒体沿用 `*.local-media.test.ts/mjs` 命名。新增专项文件必须登记，入口回归 `tests/test-suites.test.mjs` 用合成失败案例验证专项不会泄漏到默认运行。

桌面更新签名要求真实命令专项：需要 macOS、项目 Node 22.22.0 和现有项目依赖。明确指定已签名的官方 Homer 应用，运行 `HOMER_TEST_APP=/Applications/Homer.app node scripts/test.mjs --desktop-codesign`。此入口只读取应用签名，不启动应用或访问账号、runtime、CODEX_HOME；本机已安装官方包仅可作为此只读专项的受测对象，不将它用于其他运行时验收。测试从产品 `setupDesktopUpdate` 内唯一的 codesign 调用提取实际参数，执行 `/usr/bin/codesign --verify --strict -R '=anchor apple generic and identifier "app.homer.desktop" and certificate leaf[field.1.2.840.113635.100.6.1.13] exists' /Applications/Homer.app`；同时验证去掉 `=` 的旧参数和错误身份要求均被拒绝。缺少应用、非 macOS、执行错误或超时均失败，不静默跳过，不进入默认测试。

Mac 的签名初始化失败会将 `updateState` 置空，导致启动 runtime URL 触发和菜单手动触发均无法执行 `checkForUpdates()`。产品只补 `-R` 要求的 `=` 前缀，保留失败关闭与身份限制。该结论不扩大到 Windows。两条调用路径通过现有 VM 壳入口分别验证，使用合成 stable 清单、runtime URL 和 Electron API 替身，不在默认测试中运行真实 codesign：

```sh
node --experimental-vm-modules --import ./tests/fixtures/core-system-proxy.mjs --import tsx --test --test-name-pattern='stable Mac |Intel Mac |update remains disabled|test profile never' tests/electron-shell.test.mjs
node --test --test-name-pattern='default core excludes every audited specialist|explicit desktop-codesign' tests/test-suites.test.mjs
```

2026-11-12 本地验证：macOS 27.2／arm64、Node 22.22.0，只读受测对象为官方 Homer 0.1.10（build 295）。真实命令专项 1/1、Mac 控制流定向回归 10/10、入口分类定向回归 2/2 通过，均为零跳过。真实命令使用产品参数退出 0、去掉 `=` 退出 1、错误身份退出 3。三个独立的内存源码对照也按预期失败：恢复旧参数使真实专项失败；断开 runtime URL 自动触发使更新器调用数为 0（应为 1）；断开菜单手动触发使调用数停留在 1（应为 2）。对照未修改共享源码或已安装应用，最终检查沿修复后的产品源码执行。

此前高负载试跑出现 codesign 超时，完整入口分类试跑为 11 通过／6 个子进程超时失败，随后两项定向试跑也曾超时；较宽的 Electron 回归另观察到 5 项失败（四项资料迁移锁恢复、一项 preload 方法数量断言），入口测试当时被中断。以上共享工作区试跑均不计为通过，当时未扩展修复这些案例；后续独立提交候选的复核结果如下。

2026-11-12 提交候选复核：在 `a4c6822` 上仅叠加本次 codesign 修复、测试和验证文档，排除并行任务的改动，使用独立源码副本和 Node 22.22.0 运行以下两文件完整离线回归，398/398 通过、零跳过；同一候选中的真实签名专项再次 1/1 通过、零跳过。此结果仅覆盖该提交候选，不代表共享工作区或完整 `npm test` 通过。

```sh
node --experimental-vm-modules --import ./tests/fixtures/core-system-proxy.mjs --import tsx --test --test-concurrency=1 tests/electron-shell.test.mjs tests/test-suites.test.mjs
```

VM 验证仅证明产品控制流，真实命令专项仅证明产品签名参数；真实原生更新器、最终 feed/URL 拉取、原生菜单交互、安装重启和数据保留仍需新版构建及原生升级验收。

| 原混合文件 | 默认保留 | 移出的文件 |
| --- | --- | --- |
| `dev-upgrade.test.mjs` | 监视排除范围 | `dev-upgrade.development.test.mjs` |
| `web-feedback-host.test.ts` | 反馈协议、身份、冻结及合成流式 fixture | `web-feedback-host.development.test.ts` |
| `electron-package.test.mjs` | 合成清单及打包钩子契约 | `electron-package.development.test.mjs` |
| `first-launch-distribution.test.mjs` | Skill 分发及用户文件/链接保护 | `first-launch-distribution.development.test.mjs` |
| `task-status-css.test.mjs` | CSS 范围、动画、无障碍及状态渲染 | `task-status-css.vendor.test.mjs` |
| `prompts.test.ts` | 读取、缺失、快照及合成同线程恢复 | `prompts.development.test.ts` |

提示词案例复用 `prompt-resources-fixture.ts`。六份原文件中的 29 个测试体及 163 处 assert 调用逐字保留；其中 19 个案例留在默认，10 个移到专项。31 份整文件仅调整收集归属，未改其内容。网关禁用令牌案例、历史调查脚本等待确认删除/转移项全部保留。

2026-11-02 本轮静态核对及离线定向验证结果：

- 入口行为先在原脚本复现 7 项失败；修改后 10/10 通过，覆盖默认排除、已有环境变量不启用专项、显式选取、参数/失败传播和跳过未验证提示。
- 六份拆分后默认文件共 19/19 通过、0 跳过；TypeScript `tsc -p tsconfig.check.json` 通过。
- 实际入口清单互斥且所有列入文件存在：核心 282、开发发布 21、vendor 8、引擎 5、账号 2、RTC 1、本地媒体 10、桌面 7 个文件。文件数是本轮快照，不代替案例执行结果。
- 独立只读 review 未发现阻断采用的 P1/P2；31 份整文件校验不变，29 个原测试体及 163 处断言保持。采用前核对修改路径没有并发冲突，并验证采用内容与隔离版本一致。

证据保留在 `.codex/scratch/test-boundaries-20261102-7h1i065z/` 的对照副本、入口/定向/类型检查日志和静态校验记录。未运行任何完整套件、真实专项、工具安装或付费调用；此前 Whisper 缺失、全量磁盘不足及 Web 热更新未验证记录仍有效，不因分类调整变成通过。

提交范围说明：上述计数与检查记录来自当时完整工作区，不是单独提交的全量结果。本次提交只收录测试边界及隔离调整；其他未提交功能的新增测试、原生图片能力、打包修复和历史公共指南保持在工作区，待各自功能提交。原已提交用例的断言随归类保留，未重新进行真实工具或完整验收。

提交候选复核：在当前 HEAD 加本次边界改动的独立副本中，入口与轻量核心定向检查 30/30 通过、0 跳过；原已提交测试的 461 处断言静态核对均保留。较大范围的候选试跑曾在主恢复案例处达到 120 秒上限，未计为通过；未追加全量或真实专项。

## 网站授权与开发 Token 退役的离线检查

使用项目 Node 22：`node --experimental-vm-modules --import ./tests/fixtures/core-system-proxy.mjs --import tsx --test tests/homer-account.test.ts tests/electron-shell.test.mjs tests/desktop-permissions-ui.test.mjs tests/desktop-deepseek-engine.test.mjs`。仅使用临时凭据、本地假服务、VM 桌面壳和协议 fixture；`desktop-deepseek-engine` 名称下保留的是网站 Main/Worker、双向来源与同一主对话断言。手填 Token 实验脚本及其专属测试已删除。包内私有管道拒绝手填 Token 的检查沿现有 `macos-desktop-runtime.test.mjs` 桌面专项，必须指定隔离测试包与目录，不指向日常资料。

会员通用模型配置离线专项：`node --import tsx --test --test-name-pattern='pinned generic|adopts delivered membership context' tests/deepseek-pinned.test.ts`。仅使用固定 Codex 0.163.0、全新 scratch HOME 和脚本化回环 Responses；覆盖两角色窗口回读，以及恢复线程后模型名/自定义 effort 切换、null 清除旧推理强度。仅此名称过滤不会运行文件内其他引擎案例；未调用真实模型，不替代真实网关容量或安装验收。完整合同与能力字段见 [会员模型配置](2026-11-04-membership-context-config.md)。

## 会员视频工具验收（2026-11-06）

Homer → New API 正常路径在隔离环境通过。New API 为 `v1.0.0-rc.45-homer-turn-2b914532dbe5`，可执行文件的 SHA-256 `beb0ba83c888cacfbfe4f482109ebc022c61201c1c9b2aa846a322eadc053190` 与生产容器一致。验收使用独立 SQLite 和有限额的测试 Token，由脚本驱动 Homer 会话，通过实际 Web 界面的审批卡确认，模拟百炼返回用量和 MP4。测试请求只进入本机隔离网关。

| 检查项 | 实际结果 |
| --- | --- |
| 提交与查询 | 确认前零提交，确认后只提交一次。`wan3.0-video` 按 5 秒、720P、16:9、有声提交，查询到 `completed` |
| 播放与下载 | 聊天内可播放，浏览器下载与原文件逐字节一致。`ffprobe` 读回 5.000 秒、1280×720、H.264 视频轨和 AAC 音轨 |
| 结算 | 同一任务只有一条消费日志。测试 Token 剩余额度从 1,000,000 降至 794,521，已用额度增加 205,479，与日志一致，按配置折合约 300 积分 |

常规离线回归运行 `node --import tsx --test tests/membership-web-tools.test.ts`，覆盖 Main 和 Worker、审批拒绝、提交结果丢失、停止与重启取回、回执权限及异常下载。本次隔离验收费用为零。生产真实生成、百炼账单、网关跨 Token 隔离及零余额取回仍待单独验收。

## 手机新版轻提示定向检查

2026-11-12 安卓 GitHub 清单接入：复用 schema、五秒／32 KiB 限制、安装包身份和最高关闭版本。新增来源选择、原生校验后直开 APK、旧官网安卓记录不参与新版选择及平台故障隔离断言；iOS 仍使用原官网 JSON、StoreKit 条件和固定更新入口。在 Node 22.22.0、仅含本任务补丁的隔离源码中，移动端 38/38、网页桥接／请求 21/21、官网四文件离线 19/19、隔离浏览器 1/1 通过，均 0 失败、0 跳过；移动端 noEmit 通过。浏览器覆盖桌面／390px、中英文、原来源快照隔离、单平台失败及准备中状态，使用合成数据和 CORS 响应，不访问真实账号或下载 APK。未运行产品构建、原生安装或真实模型。GitHub 新清单、真机网络、签名覆盖安装和生产缓存均未验收。

以下为既有检查入口，UI 打包及浏览器专项仍按当轮授权选择；本轮只执行离线回归和隔离组件验证。

官网隔离检查（从同级 Yezi2 源码副本执行）：

```sh
node --test tests/homer_mobile_releases.test.mjs tests/homer_desktop_releases.test.mjs tests/homer_update_feeds.test.mjs tests/installer_downloads.test.mjs
HOMER_FULL_APP=0 HOMER_BROWSER_TEST_PORT=3197 node --test tests/homer_authorize_browser.test.mjs
```

后一项只编译合成浏览器夹具并启动独立 Chrome／本地测试服务，退出时关闭；不运行 Meteor 或生成产品发行包。

源码验证入口：

```sh
npm test --prefix mobile
npm run typecheck --prefix mobile
npx tsc --noEmit -p ui/tsconfig.json
node --import tsx --test tests/mobile-client.test.mjs tests/mobile-request.test.mjs
node --import tsx --test tests/mobile-ui-build.test.mjs
node scripts/build-mobile-ui.mjs .codex/scratch/mobile-update-implementation-20261103/ui
```

前四项为离线合成检查；移动测试中的原生壳、SecureStore、SDK 和发行响应均为合成夹具，键值区分绑定、取消和更新关闭记录。浏览器项需已有 Playwright／Chrome，沿 development 专项登记，使用独立合成快照和 scratch 输出，不访问日常账号／runtime，也不发真实模型请求。UI 打包仍使用实际产品入口，过滤仅供本地 Live 调试的注入脚本；不生成原生安装包。

2026-11-03 的历史记录为移动测试 32/32、桥接／请求 17/17、浏览器 2/2 通过，均无跳过；两端类型检查和独立 UI 打包通过。autolinking 只验证元数据可发现，不能替代原生编译链接。真实键盘／读屏、有消息时阅读锚点、iOS storefront、正式覆盖安装及 Yezi2 缓存撤回传播／实际安装包下载仍待后续定向验收；额外内置浏览器 file:// 复核遭工具策略拒绝，不算通过。详细范围见 [手机提示方案](mobile-app-update-notice.md#验收清单与当前证据)。未运行无关全量、TURN 长测、原生构建、安装、发布或付费模型任务。


## 补丁成果预览

`node --test tests/diff-viewer-preview.test.mjs tests/mobile-client.test.mjs` 验证实际 CanvasReader、固定 DiffViewer 与 parser、MIME 分流、资源门槛、原文／下载、异常和共享移动下载适配；使用合成 HTTP、DOM 与剪贴板，不连接账号或模型。新增 `diff-viewer-preview.test.mjs` 由默认核心自动收集。

真实浏览器继续使用已存在的 `tests/preview-tabs.browser.mjs`，不加入默认测试或创建新的专项入口。先对当前 UI 做类型检查，生成 Canvas CSS，并将 Vite 产物输出到独立 scratch：

```sh
node scripts/build-run-activity-css.mjs --canvas-split
node node_modules/typescript/bin/tsc -p ui/tsconfig.json --noEmit
(cd ui && ../node_modules/.bin/vite build --configLoader runner --outDir ../.codex/scratch/patch-preview-review/web)
HOMER_PATCH_PREVIEW=1 \
HOMER_SYNTHETIC_ROOT=.codex/scratch/patch-preview-review/fixture \
HISTORY_FOLLOWUP_BUILD="$PWD/.codex/scratch/patch-preview-review/web" \
HOMER_REVIEW_EVIDENCE_ROOT=.codex/scratch/patch-preview-review/browser \
node --import tsx tests/preview-tabs.browser.mjs
```

需要项目 Node 22 依赖、现有预览批注 runtime 构建产物和已安装的 Chrome；缺少 runtime 时先按既有构建流程在独立副本准备，不操作日常 Homer。测试使用新建 Chrome profile、合成 HTTP owner 和临时存储，阻断页面外部请求；覆盖 1440／390／320px、真实输入事件、下载字节、剪贴板、回退、切换及资源清理，记录截图和局部 long task。手机宽度模拟不代替 iOS／Android 实机验收。浏览器脚本退出 0 仍须人工审阅截图；记录长任务不代表无卡顿。


## 合成浏览器回归

工作状态与事项标题可定向运行 `tests/task-status-count.browser.mjs` 和 `tests/task-status-pinned-runner.mjs pinned`，截图写入显式指定的 `HOMER_BROWSER_EVIDENCE`。完整产品入口使用 `HISTORY_FOLLOWUP_BUILD` 指定当前源码的 UI 构建，合成数据使用独立 `HOMER_SYNTHETIC_ROOT`。

`pinned` 同时覆盖长事项、长 Worker 回复及真实执行记录的整页滚动回归，先确认隐藏读屏状态元素存在，再检查 1440×900、1440×520 与 390×780 下整页和外层分栏无滚动范围，顶栏与输入区保持窗口边界。实际滚轮及键盘检查列表独立滚动、关闭重开后的阅读位置、事项展开收起和窄窗 Escape 回焦；测试仅使用合成数据与独立 Chrome profile。2026-11-11 本机 Chrome 合成验收 69 项通过，相关离线检查 11 项及 UI 类型检查通过；未打包安装。

HTML 预览定向运行 `node --import tsx tests/html-annotation-lifecycle.browser.mjs` 与 `node --import tsx tests/html-render-first.browser.mjs`，分别指定独立 `HOMER_REVIEW_EVIDENCE_ROOT`；后者还需上述 UI 构建与合成目录。覆盖原生 Add 失败保留输入、重试和 ACK、退出与跨断点、1440／390／320px 的实际 Tab 焦点环、脚本预览与主输入发送。保存即写主草稿，测试沿原 Add／update／delete／clear 协议，不等待旧 Send 导入。

macOS 启动 Chrome 的执行会话需要具备 LaunchServices 和 WindowServer 访问权限。若在 `_RegisterApplication` 阶段 SIGABRT，先按崩溃报告中的进程号及实际启动时间核对系统日志；仅有退出信号不足以判定根因。2026-11-07 的 PID 94978 被明确记录为 `Sandbox restriction`。在具备相应权限的执行会话中使用原启动器及全新 profile 验证，保留 Chrome 沙箱，独立 profile 不访问日常浏览器资料。

2026-11-09 在 Homer 0.1.6 build 291 的实际 Worker 中，默认 `:read-only` 同时拒绝了 profile 写入和上述系统服务访问，Chrome 在加载页面前 SIGABRT。经单次审批后，Chrome 157.0.8103.38 的 `--screenshot` 能写出 PNG，但退出时线程池仍有 Chrome Safe Storage 的 Keychain 查询，watchdog 以退出码 2 终止进程。若需用 Chrome 命令行截图验证本地合成页面，可在全新、一次性且无账号数据的 profile 上加 `--use-mock-keychain`。同一 Worker 仅增加此参数后，`--dump-dom` 和 `--screenshot` 均以 0 退出，PNG 字节与对照一致。该参数只用于合成测试，实际浏览器资料或登录流程应使用正常的 Keychain。项目浏览器专项继续使用下文的 CDP 流程。

`scripts/test.mjs --browser` 显式运行 13 个已维护入口（另有一份共享 fixture），不自动收集其他历史浏览器脚本，也不进入默认测试。本专项沿现有 macOS Chrome 路径运行，需要 Node 22、项目现有依赖和当前源码的 UI 构建；在独立源码副本生成 annotation runtime、CSS 和 Vite 产物，不使用日常账号、runtime 或 CODEX_HOME。

```sh
HISTORY_FOLLOWUP_BUILD="$PWD/.codex/scratch/browser-regression/web" \
HOMER_SYNTHETIC_ROOT="$PWD/.codex/scratch/browser-regression/runtime" \
HOMER_BROWSER_EVIDENCE="$PWD/.codex/scratch/browser-regression/evidence" \
node scripts/test.mjs --browser
```

构建目录必须指向事先生成的当前 UI。覆盖文件列表、过程折叠和焦点、后续待答及队列页、精确授权/撤销、分页/重连/延迟图片锚点、完整正文复制及文件字节、长文排版和真实 100%/200% Chrome 缩放。旧原生选择框、源码默认、活动阅读器和应用内成果下载入口不恢复；旧线程原答复授权仍从真实 HTTP owner 检查。历史 V2 构建对比已退役，长文样本保留在 kerning 入口；测量值不代表性能达标。退出码之外仍需审阅截图；窄屏模拟不代替移动真机验收。


## 固定原生协议与合成验收入口

这些检查需要已有的 Codex **0.163.0** 二进制和项目 Node 22 依赖；不自动下载、升级或使用日常 HOME。原生进程是真实的，但模型响应及 MCP 服务均由本地合成 fixture 提供，不使用真实账号或付费模型。

```sh
HOMER_TEST_CODEX_BIN=/absolute/path/to/codex node --import tsx --test tests/native-protocol.engine.test.mjs
```

该文件登记在显式 `engine` 分组，默认测试不执行。覆盖项目配置层与信任、原生 MCP 回环调用、压缩终态与关闭、原生 Skill 发现和禁用、本地插件安装与卸载、同一线程安全恢复。执行探针在独立 Codex 配置中明确选择权限，并核对读写、网络与工具采用。生产启动参数的回归覆盖默认配置、冷恢复及 `controlOnly` 隔离。

原生工具接线候选在 Node 22.22.0 下运行 `npm run check`，2042 项通过，零跳过。固定 Codex 0.163.0 专项通过 6 项，覆盖 Main／Worker 实际调用、原生 MCP、Skill、插件和同线程冷恢复。隔离 macOS ARM64 包用真实 ChatGPT 验证了空配置下批准一次、显式允许执行时直接运行，两组都通过独立 Chrome profile 完成本地测试页的输入与点击。合成请求另验证了原生审批的长命令可以完整显示和执行。超过审批卡完整展示上限的命令仍会拒绝。Windows 待验。

2026-11-08 隔离候选基于 `1e042f870aa0`。普通主轮将 `$skill` 随正文交给固定 Codex 解析。每轮原生目录强刷、首次启动及真实归档的结构化选择沿用原有路径。使用 Codex 0.163.0、独立 HOME 和合成回环 Responses 比较保留与省略普通主轮结构化选择的 8 次请求。唯一启用项两边都注入正文，禁用项均未注入，两个同名启用项仅在旧路径注入两份正文。附件提取内容里的裸名称两边都经原生文本解析注入，属于现存行为。描述标记与正文标记分别核对。普通主轮、首次启动及归档的定向服务回归共 33 项通过。

2026-11-08 主轮附件正文隔离候选（基线 `868d4e2`）。主轮用户文本保留附件元数据及引用，正文经现有 `inspect_attachment` 结果返回。固定 Codex 0.163.0、独立 HOME 和回环合成上游对照复现旧路径的附件 Skill 正文注入。候选上游收到含裸 `$skill` 的完整 TXT 工具结果，首次读取和历史重读均未注入对应 Skill。同轮用户显式 Skill 和结构化归档 Skill 仍注入。归档选择由服务测试覆盖，原生协议探针直接提交结构化输入。声明支持图片的合成模型接收一张 PNG 和六张 MP4 抽帧。附件工具、历史授权、归档及本地图片和视频定向回归 25 项通过。文件名、引用和预览摘录不在本次范围。未运行真实模型或验证各附件格式的实际任务表现。

2026-11-08 ChatGPT 新会话直连复验（基线 `ab71391`）。固定 Codex 0.163.0 与隔离回环 TLS 上游覆盖 Main 派工、新 Main／Worker 的 WebSocket 101、426 后 zstd SSE 回退、HTTP CONNECT 和 `NO_PROXY`。重启后两个线程以原 ID 经现有历史桥续聊，并带回首轮历史。拒绝 CONNECT 时，基线与候选都没有推理请求到达上游，账号检查均直达回环。候选在代理放行时通过代理发出账号检查，拒绝后由 Codex 的启动 GET 重试采用系统路由，CFNetwork 对测试回环地址选择直连。跨来源恢复、历史桥及代理定向回归 8 项通过。未使用真实账号或模型。

2026-11-08 固定 UI 维护入口复验（基线 `9d47409`）。固定 UI 启动器与同版本冻结后端共用完整动态工具指纹。隔离合成测试 3 项通过，覆盖原线程启动、UI 回退、篡改与锁拒绝，以及旧的部分指纹被拒绝。固定 Codex 0.163.0 回环专项在主服务中以原 `threadId` 续聊，上游收到前一轮用户消息和助手回复。桌面服务、CLI 和恢复检查 88 项通过，服务构建及类型检查通过。历史冻结包与新启动器混用未验。

交互式合成调试可显式准备独立的 UI 构建和 `HISTORY_FOLLOWUP_BUILD`，再运行 `node --import tsx scripts/recursive-acceptance.ts`。真实账号、打包桌面及 Chrome 的结果分别记录。Chrome 使用独立 profile，以 DevTools 就绪和原进程退出为准。

## 授权与咨询完成卡片

离线回归（Node 22，合成数据与临时数据库）：

```sh
node --import tsx --test tests/web-history-loading.test.ts tests/main-native-approvals.test.ts tests/service-main-native-approvals.test.ts tests/worker-interactions.test.ts tests/question-flow-contract.test.ts tests/approval-card-ui.test.mjs tests/user-message-bubble-ui.test.mjs
npm run typecheck
./node_modules/.bin/tsc --noEmit -p ui/tsconfig.json
```

显式浏览器专项：

```sh
node scripts/build-preview-annotation.mjs
HOMER_BROWSER_EVIDENCE="$PWD/.codex/scratch/interaction-completion-browser" node --import tsx tests/interaction-completion.browser.mjs
```

脚本构建实际产品界面，复用合成 HTTP/SSE 服务、原审批处理器和历史展示投影；使用本机已有 Chrome、独立浏览器资料及 scratch 内合成 SQLite 数据库，不连接账号或真实模型。覆盖 1440、390、320px 的允许、拒绝、多题和自由回答，允许流程先模拟回执未知并显式重试，再核对刷新、关闭并重开数据库后仍只有一张完成卡片。审批完成态检查固定 ApprovalCard 的原生状态区与准确决定文案，移除所有审批按钮和详情入口；咨询完成态检查固定 QuestionFlow 的 `receipt` 状态、全部原问题和答案同时可见、自由文字原样换行，且没有提交控件、自定义箭头或题号；刷新及重开数据库后保留同一份完整回执。每种场景保存 PNG，汇总写入指定证据目录的 `results.json`。可用 `HOMER_COMPONENT_BUILD` 指定已构建的隔离产品 UI。此脚本登记于显式 browser 清单，不进入默认离线测试。

审批、咨询原有专项继续使用 `tests/approval-card.browser.mjs` 和 `tests/question-flow.browser.mjs`，分别检查提交、重复点击、连接变化、迟到回执、失效与草稿。以上均为合成验收，不代表日常资料、真实账号或已安装 App 验收。


## 2026-11-13 引用与批注显示简化

`QuoteSource` 统一使用固定 assistant-ui `QuoteBlock.Text` 默认两行截断；每段引用后紧接对应批注，批注使用普通消息正文样式，保留原始文字与换行。取消编号、专用分组及其间距 CSS，不改输入、发送协议、持久化或来源定位。

定向离线回归（Node 22.22.0）：

```sh
node --import tsx --test tests/quote-navigation-ui.test.mjs tests/message-quote.test.ts tests/web-multi-quotes.test.ts
node scripts/build-run-activity-css.mjs --quote --check
```

本次 17 项通过，零失败或跳过；官方 Quote CSS 检查通过。独立 Vite 构建通过；真实 HomerApp 接入内存 HTTP/SSE 合成消息，在隔离 Chrome 的 1100×675 视口截图核对单引用、长原文两行显示、多引用与逐段批注、普通正文，并点击第二段引用定位到对应原消息。未连接日常资料、账号或真实模型，未安装或部署。未执行完整浏览器脚本、移动视口及浏览器控制台专项检查；现有浏览器脚本仅同步本次截断预期及删除外层后的选择器。

用户已确认上述合成截图。独立只读代码审查未发现阻断提交的问题；同步更正 vendor 说明中历史引用取消截断的旧描述。提交前在最新工作树复验上述 17 项和 Quote CSS 检查均通过，UI 与项目类型检查也均通过（`tsc --noEmit -p ui/tsconfig.json`、`tsc --noEmit -p tsconfig.check.json`）。前一轮并行渠道文件导致的类型错误已消失；完整浏览器脚本、移动视口及控制台专项仍未验证。临时合成服务已退出、端口已释放，独立 web 构建已回收。

恢复提交时补齐 `user-message-bubble-ui` 与 `chat-timestamps` 两个生产组件 eval 夹具的 `React.Fragment` 绑定，保留全部原断言；定向执行 `node --import tsx --test tests/user-message-bubble-ui.test.mjs tests/chat-timestamps.test.ts`，33 项通过，零失败或跳过。

## 2026-11-13 图片沿用现有菜单保存

用户进一步反馈后，移除图片角落下载按钮及专用交互样式，预览与放大图均不增加新下载入口；保留窄屏容器约束、相册用途声明、非图片与成果文件的原下载通路。`tests/image-file-components.browser.mjs` 在冻结 main 加本次图片组件改动的独立构建上完成 60 项浏览器检查，覆盖 1440／390／320px，包含无重复文件信息及下载控件、气泡／视口边界、原图 Blob 和默认图片菜单事件不被取消、触摸打开缩放、键盘／焦点、准确修订替换、旧 URL 回收及原有文件下载／失败重试。已查看两种手机宽度的最终截图，UI 类型检查、Vite 与移动内嵌 HTML 构建通过。

复验使用项目 Node 22.22.0：先在独立候选运行 `node scripts/build-preview-annotation.mjs` 及标准 Vite UI 构建，再设置 `HOMER_COMPONENT_BUILD` 为该构建目录、`HOMER_BROWSER_EVIDENCE` 为本轮 scratch 输出目录，执行 `node tests/image-file-components.browser.mjs`。夹具仅使用合成数据及独立 Chrome，阻断外部请求。DOM contextmenu 未被取消只证明源码保留默认菜单行为，不能替代 iOS／Android 原生菜单及保存的新真机验收；本轮未重复该真机操作。已送审 build 10 和公开安卓 APK 均未替换。

## 2026-11-13 ChatGPT WebSocket 模型传输

桥接和默认测试隔离：

```sh
node --import tsx --test tests/native-history-bridge.test.ts tests/test-suites.test.mjs
```

固定 Codex 0.163.0（包内引擎、合成凭据与回环上游，不使用真实模型）：

```sh
HOMER_TEST_CODEX_BIN=/absolute/path/to/codex node --import tsx --test tests/desktop-source-resume.test.mjs
```

本轮桥29项、测试边界及驱动故障22项合计51/51通过；固定引擎10个场景整批通过。默认离线回归保留 HTTP 断言，新增 WS 双跳握手及头部、原历史不变、分片文本、预热／增量、背压、服务错误透传、代理／NO_PROXY／远端 DNS／认证、64 MiB、15 秒握手和半开连接关闭。显式 suite 的默认排除、过滤与失败传播由 test-suites 回归覆盖。实模驱动另以假引擎、假授权及拒绝出站代理验证初始化超时、已开始生成后取消、源授权变化及关闭异常：都只启动一组、零模型请求、私有目录为空；测试不以 Node 超时会自动中断 async 回调为前提。

固定引擎专项覆盖 HTTP 426 回退，WS 混合来源及纯 ChatGPT 原线程冷恢复、动态工具一次执行与增量；401／429／503、断线、1009 及工具已完成后断线均遵循原生恢复／报错，工具不重复执行。源授权、原 thread 及 rollout 保留。该专项属于原有 engine 分组，不从默认 npm test 进入。

提交前使用 `c8517ef` 加本轮精确差异的独立候选，并显式固定 Node 22.22.0，完整 `npm run typecheck` 通过，默认核心 2382/2384；两项图片预览失败已在未改造基线复现，无取消或跳过。并行渠道、UI、电源和模型默认值改动未纳入候选及本提交。

真实性能是新增的 **live-transport 显式专项**，默认核心回归不会运行。必须明确提供测试授权路径及包内引擎；缺少条件报错，不自动发现日常账号，也不以跳过冒充通过：

```sh
HOMER_TEST_CODEX_BIN=/absolute/path/to/codex \
HOMER_TEST_AUTH_FILE=/absolute/path/to/test-auth.json \
npm run test:live-transport
```

测试使用当前候选 `nativeHistoryBridge`、固定 Terra/high/标准档与相同合成语料，约3.5万／37万token各做HTTP→WS、WS→HTTP。先读模型目录、关闭项目文档自动注入并核对初始usage差值≤64token，记录应用层字节、首文本、三轮耗时、预热、usage及错误类别。代理沿用现有引擎的代理解析；不保存认证头、请求／响应原文或用户内容。临时授权和原生运行数据仅在独立私有目录，退出后回收；源授权核对位于回收之后。测试取消会终止当前引擎，等待退出后删除HOME；任何样本或上游模型错误立即停止整个专项。测试观察器是回环测量入口，不增加生产配置或监控状态。

本轮包内Node22.22.0/Codex0.163.0的首次八样本实测完成，后续最终专项在第三个样本遇到服务端 `server_is_overloaded` 并停止，明确未通过；拒绝以早先成功结果替代。约37万token的既有完整样本显示上传约减少75%，耗时随上游容量明显波动。所有成功、失败和中止样本及真实Homer主／Worker原线程续办结果见[架构正文](architecture/account-and-model-connection.md#chatgpt-恢复会话的模型传输)。源码未安装；Windows实机与最终完整实网性能仍未验证。

## 2026-11-14 主 Agent 自动恢复 WebSocket

默认离线定向入口（Node 22.22.0，合成引擎／工具和独立 scratch 数据）：

```sh
node --import ./tests/fixtures/core-system-proxy.mjs --import tsx --test \
  tests/engine-rpc-lifecycle.test.ts tests/main-transport-recovery.test.ts \
  tests/main-queue-sources.test.ts tests/project-mcp-engine.test.ts
```

当前定向 **121/121** 通过，零失败／取消／跳过。覆盖根线程／当前进程／版本过滤、分片及整行上限、预热与 HTTP 排除、一次 Worker 信号、真实子进程诊断环境、显式禁用 provider、15 分钟无消息触发及滚动 10 分钟两次。恢复等待回复交付、Main MCP 回调及端点响应连接、原生反向工具回执和其他安全门；消息在恢复期间保持未认领，之后沿原线程执行一次；停止未确认及关闭不启动新 Main。新增队列排空边界与原生配置重复重建问题均先复现失败，再修复为通过。失败恢复保留原输入与线程，不产生工具派发或后台启动重试循环。恢复期间到达的 Worker 回传也在原队列保全，恢复后只处理一次。独立 review 的两项问题均补充 RED→GREEN：登录异步完成／断开／超时的唤醒，以及真实本机 MCP socket 的响应关闭边界（含客户端先断开、回调仍在运行）。较宽的受影响流程联合回归 **191/191** 通过，另有未修改的历史桥 **29/29** 通过，均零跳过。

前述固定引擎入口仍登记于显式 `engine` 专项。`desktop-source-resume.test.mjs` 将 Codex **0.163.0** 实际 stderr 交给候选 `CodexEngine` 的生产观察器，**10/10** 通过，零跳过；WS 原线程恢复、混合来源、模型设置、工具一次执行及增量断言保留，另断言 HTTP／预热／401／429／503／断线／1009／过载不误报 WS 完成。工具完成后断线的场景只执行一次工具。该验证使用合成凭据与回环上游，没有发现或读取日常授权文件。

此前共享工作区的完整 `npm run typecheck` 通过；修复 review 问题后的默认 `npm test` 为 **2462/2468**，零取消／跳过：6 项失败分别为 `diff-viewer-preview.test.mjs` 的 ResizeObserver 夹具、`image-reference-message.test.mjs` 的 3 项引用／AX 断言、`message-image-preview.test.mjs` 的 2 项下载卡断言。三份 UI 测试不导入本轮引擎／服务模块，按名称单独运行仍为相同 6 项失败；未修改并行 UI 或删除／跳过断言。独立 code review 的两项重要问题已修复并通过上述回归，无延后的小问题。真实网络提速、Windows 实机和安装验收未运行，该次验收未提交、安装或发布。

提交前从 `319093f` 构造独立候选，只叠加本轮 12 个文件的精确差异，排除并行渠道、UI、电源和模型默认值改动。Node **22.22.0** 下完整 `npm run typecheck` 通过，相关流程（含历史桥）**220/220**、固定 Codex **0.163.0** 回环专项 **10/10** 通过；默认核心 **2413/2415**，零取消／跳过。两项失败均在 `message-image-preview.test.mjs`，已在没有本轮改动的同一 `319093f` 干净基线及相同依赖中重现（1 通过／2 失败）。未修改、删除或跳过断言。本次仅提交源码，未安装或发布。

## 2026-11-14 会员 WebSocket

Homer 基线 `c6f8fd2`、网站基线 `877318c`；本轮差异由修改前快照单独归属，保留两仓并行工作。共享 Homer 工作区的配置／引擎／队列及会员工具定向 **306/306**、原生控制连接与专项分类 **28/28**、Electron 壳 **405/405** 通过，均无跳过；这些结果包含共享树当时的其他改动，不代表独立候选验收。配置交付及启用分支先复现失败，再实现通过；共享工作区完整类型检查通过。独立候选的执行版本和结果另行记录。

```sh
node --import ./tests/fixtures/core-system-proxy.mjs --import tsx --test --test-concurrency=1 \
  tests/homer-account.test.ts tests/model-config.test.ts tests/desktop-deepseek-engine.test.mjs \
  tests/engine-rpc-lifecycle.test.ts tests/main-transport-recovery.test.ts \
  tests/main-queue-sources.test.ts tests/project-mcp-engine.test.ts \
  tests/membership-web-tools.test.ts tests/worker-interaction-mcp.test.ts \
  tests/native-account-service.test.ts tests/test-suites.test.mjs
node --import tsx --experimental-vm-modules --test tests/electron-shell.test.mjs
npm run typecheck
```

网站仓库执行 `node --test tests/homer_runtime_config.test.mjs tests/homer_entry.test.mjs tests/homer_boundary_regressions.test.mjs`。新增断言覆盖旧客户端精确响应字段、未知能力头、独立角色、false 省略、非法值、真实 HTTP GET／兑换一致、五字段 PKCE 正文和失败原子保全；没有启动 Meteor 生产配置或真实账户。

`tests/native-membership-websocket.engine.test.mjs` 登记于显式 `engine` 专项，直接调用共享源码的生产 `CodexEngine`，**20/20** 通过。Main／Worker 的 WS、旧 HTTP、426、401／429／503、429 错误帧、断线、1009 及工具回执后断线均到达原生终态。成功路径核对相同 thread ID 冷恢复、完整历史、一次工具、后续增量和文本保全；WS 根线程正 token 完成才产生 Worker 提示，预热不提示。共享源码的原有混合来源专项 **11/11** 通过，新增 `openai → homer(WS) → openai`，保留原生加密及外国明文推理、工具结果、rollout 和文件。

```sh
: "${HOMER_TEST_CODEX_BIN:?明确指定固定 Codex 0.163.0 二进制}"
node --import tsx --test --test-concurrency=1 \
  tests/native-membership-websocket.engine.test.mjs tests/desktop-source-resume.test.mjs
```

专项使用独立 HOME／runtime／工作目录、合成 Token 和回环上游；缺二进制的跳过不能算验收。独立原生记忆连接与业务请求分开计数。实测部分预热失败和断线会由固定 Codex 自行转 HTTP，会员 `request_max_retries`／`stream_max_retries` 仍为 0；401／429／503 在上游两种传输都拒绝时正常失败。工具已执行后的断线转 HTTP 保留回执，工具仍只执行一次。宿主没有额外重发、截断历史或伪造终态。

最终从未改动的 `c6f8fd2` 导出独立源码，仅应用本轮生产代码和测试差异，不混入并行改动，也不移动主工作区 HEAD。使用显式绝对路径固定 Node **22.22.0**：完整类型检查通过，固定 Codex **0.163.0** 的会员及混合来源联合专项 **31/31** 通过，零跳过；默认核心 **2423/2425**，两项失败均为 `message-image-preview.test.mjs`。相同依赖、相同 Node 下，未叠加本轮改动的 `c6f8fd2` 基线为 **2413/2415**，相同两项失败，零取消／跳过。共享树默认核心另为 **2472/2478**，其余四项失败来自并行 `diff-viewer-preview.test.mjs` 与 `image-reference-message.test.mjs`。未修改这些 UI 文件或删减断言。隔离目录首次误用系统 Node 26.9.0 的不完整运行已作废，未作为上述 Node22 验收。网站源码以显式 Node22 复验 **29/29**，零跳过。

独立只读 code review 未发现生产代码阻断问题，指出共享与候选测试证据归属的措辞问题，已更正并用上述独立检查收口。原工作区的并行改动及其暂存状态均保留；本轮仅提交会员 WS 的精确差异，不混入并行改动。临时 SDK、模块缓存、源码副本和合成运行目录在验收后回收，维护测试入口及脱敏结果留作复验依据。

计费专项执行本地 `homer-rc45/upstream` 的真实网关代码副本，Go **1.26.11**、全新 HOME 和 SQLite、内存 Redis、回环上游，控制器与 relay 共 **123** 个测试／子测试通过，零失败或跳过。源码 `.go`、go.mod、go.sum 的排序路径及内容 SHA-256 为 `b3f0a445491046b431c8b967ba478b3e67b95e5c44ccbf61287e2b3b0a246310`（不含 Homer 夹具）；这不证明线上网关版本。复用既有鉴权、请求结算和余额断言，新增可重复使用的 `tests/fixtures/membership-websocket-billing_test.go`，复制到独立网关 controller 测试包后运行：

```sh
# 只在不含私有配置／日常数据库的独立网关副本中执行。
SQL_DSN= LOG_SQL_DSN= TEST_RESPONSES_SQL_DSN= TEST_RESPONSES_LOG_SQL_DSN= \
go test -mod=readonly -p 4 ./controller ./relay \
  -run 'HomerMembershipWebSocket|ResponsesWS|ResponsesWebSocket|ResponsesStreamOutcomes' \
  -count=1 -timeout=180s
```

夹具初始化正式启动同样使用的嵌入翻译库，避免只运行既有撤权案例时缺启动初始化导致的空指针，不改网关产品源码。核对连接复用、每次 create 撤权／限流、重复终态一次结算、初始拒绝退款、已交付部分输出断线结算、HTTP／WS 相同价目及用户／Token／日志配平。新增预热与增量生成组合：token 定价下 usage 为零的预热扣零，按请求定价仍按价目扣费，重复预热终态不会扣第二次或结清后续生成。没有真实余额、支付、凭据或模型请求。

本次未启用网站 WS 设置、安装或发布；实际部署网关及上游兼容性、真实会员计费和网络性能仍待独立验收后才可启用。

### 提交前复核（2026-11-14）

本轮按明确的本地提交授权再次复核精确候选，保留并行目录、渠道、UI 和电源改动及已有暂存内容。Node22.22.0 完整类型检查、固定 Codex0.163.0 原生专项31/31、网站独立协议回归29/29通过，均无跳过。完整核心复验2423/2425，仍仅为前述在未改基线复现的两项图片预览失败。网站兼容配置的本地提交为 `7d4fe165`，未部署或改动正式设置。计费123项为上一阶段相同网关源码及未修改夹具的合成验收记录，本次复核未重复运行 Go 或调用真实金融／模型接口。

首次在托管隔离路径运行核心回归时，未修改的 Windows 模拟夹具创建114字节 Unix socket路径，出现五项管道错误并卡在等待循环；该运行已中止，无完整汇总。把同一生产与测试文件逐字节导出至项目 scratch 的短路径后，socket路径102字节，原 Windows 文件8/8通过，再完成上述完整核心复验。未改任何 Windows 源码或断言。

新增测试诊断只保留数值：Main、Worker 的WS样本均为恢复前最大请求 `input` 57659字节、最后热轮增量141字节；HTTP对应热轮58397字节。指标仅覆盖JSON `input`，总传输、真实网络延迟及供应商容量需另行测量。生产实现继续复用Codex原生传输和既有队列，无新代理层、历史副本缓存、依赖或重试管理器。独立只读复核未发现实现阻断项；作者同时澄清预热可能按原价目收费，未增加收费或补偿策略。

提交前又将合成WS上游的响应缓存限定到每条物理连接，使跨连接旧 `previous_response_id` 直接失败，避免全局测试缓存掩盖冷恢复缺陷。收紧后重新运行会员原生专项20/20，零失败或跳过，独立审查者复核通过；混合来源11项及核心执行路径未改动。

### 真实会员入口验收（2026-11-14）

**截至2026-11-14，隔离Azure路径已完成真实Responses WS生成，完整协作与性能对照尚未完成。** 最新通过结论见[11月15日隔离续验](#真实会员隔离续验2026-11-15)。当日累计预算上限为人民币1元，覆盖先前所有调用；按网关价目累计等值费用0.9900114元后停止调用。未更改正式入口、渠道或网站能力配置，没有安装或发布。

使用已提交 Homer `c9b6d28fe9377b09ef4aa288af4ad76524930677`、Node22.22.0／固定Codex0.163.0，独立HOME、runtime、CODEX_HOME与工作目录。读取已安装应用的固定引擎、Node及资源清单用于校验，没有启动或重启日常Homer。此前正式Terra路径的HTTP调用计入预算；续验改用现有低价Azure `gpt-6-luna`，性能探针固定high／标准档，实际Homer使用Main medium、Worker high。没有运行35K／370K token性能测试。

#### 认证、真实路径及正式启用边界

- 渠道只读查询原先失败于 `ACCESS_TOKEN_LEGACY_RETIRED`。经用户提供的新短期 `channel:read` PAT，分页渠道查询成功，越权查询用户资料仍返回 `ACCESS_TOKEN_SCOPE_DENIED`，没有扩大管理员权限。
- 正式模型入口WS握手返回400；只读Nginx配置检查确认 `/v1/` 缺Upgrade／Connection转发。SSH回环直达正式后端能收到101，但Terra的WS `response.create` 返回503 `model_not_found`。后续只读元数据确认5条启用渠道均未启用Responses WS，GPT为Azure type3；当前网关WS选择不接纳此类渠道。原生Codex能回退HTTP，不能把网关101或HTTP成功记为上游WS完成。
- 用户明确授权后，仅在私密隔离运行目录复用一个现有Azure上游Key；生产侧读取在只读SQL事务中完成，没有变更生产数据。管理PAT不用于模型调用。隔离网关复用现有OpenAI兼容type1，Azure Base URL加 `/openai`，只在隔离数据库启用WS，并以原生 `header_override` 发送 `api-key`。单独Bearer握手曾返回302；未跟随重定向，也没有把Key放进查询参数。加上该头后真实Azure握手及 `response.completed` 均成功，返回内容断言通过。
- 临时原生网关仅监听回环，使用独立SQLite、用户和有限额Token，价格表达式复制自当时公开价目；没有使用正式渠道数据库写入或改造生产网关代码。网关源码复制指纹 `67231d4012d358082647c520cbe5c13eb209b112643a051a1dfc8e922c9dac17`，仅覆写回环监听及合成首页embed，二进制SHA-256 `f362773141c6f0017cd519e27b0e5c381fa876eea6c68e2f93d25b82f3cc3dbd`。正式返回版本 `v1.0.0-rc.49-homer-60edc9933242` 与此复制指纹分别记录，不能视为同一源码证明。

真实请求走“候选Homer／固定Codex → 回环观察器 → 隔离原生网关 → 真实Azure Responses”，本次不是只测一个替代模型的转发器。观察器只保存数值、线程哈希与布尔断言，不留消息正文、认证或工具参数／结果。网关的前端101时间仅代表本机入口；上游WS成立由原生网关WS执行路径、直接握手探针和真实完成事件共同确认，不能用约1ms的本机101估算Azure握手速度。

#### Main／Worker、队列与原线程

此前正式Terra HTTP基线保留两份完整样本：首次派工至空闲12.16s／8.64s，重启后原Worker续办11.60s／8.28s，每份13次模型请求，JSON请求正文577148／586849字节。两份均恢复同一Main与Worker thread ID、工具一次、两次Worker run完成、全部所属引擎安全关闭。第二份还断言冷恢复请求包含首轮随机标记及唯一原工具回执，Worker实际能回忆该标记和结果；这些不是HTTP／WS配对性能数据。

续验实际调用生产 `Homer`／`CodexEngine`，保留消息队列、协作工具、持久化及安全关闭。只开放验收需要的现有协作工具，并加入一个常量测试工具；在Worker执行该工具时向Main提交新的队列消息。没有媒体、搜索、命令或日常会话操作。

证据最完整的WS样本中，15次模型请求完成，其中4次为 `generate:false` 预热。Main与Worker重启后thread ID不变，冷恢复请求保留随机标记和原工具回执，Worker实际复述正确；工具总计一次，工具期间入队消息完成。Worker重启前后各收到一次原生WS成功信号。热轮可见 `previous_response_id` 与149字节的 `input`；同一Worker首次实际输入20847字节，整条请求分别为16911／37609字节。这个比例只描述输入JSON，不能替代总网络流量或HTTP配对结论。

**上述关键断言通过，不等于完整WS流程通过。** 最后Main协作收尾被本地预算预留拦截，相关引擎轮次失败；后续复测也未取得整套通过结果。所有失败样本及费用保留，没有删除断言或把预算拒绝记成上游故障：

| WS流程样本 | 完成的模型请求 | 工具执行 | 结果与限制 |
| --- | ---: | ---: | --- |
| 首次准备 | 0 | 0 | 隔离Unix socket路径过长，未发模型请求；缩短测试目录后修正。 |
| 原线程与队列证据 | 15 | 1 | 原线程、历史、入队与一次工具断言通过；最终Main收尾被预算估算拦截，整套失败。 |
| 结算观察复核 | 2 | 0 | 观察器漏读Azure原生 `cache_write_tokens`，错误等待结算；修正观察器并补回归，原生账单正常。 |
| 分词估算复测 | 12 | 1 | 队列与一次工具检查通过；冷恢复后续请求因剩余预留不足被拦截，整套失败。 |

额度闸门只用于测试：串行派发，等待原生账单与Token余额一致后继续；计入先前费用，限制输出并对输入估算留余量。最初按JSON字节估算过于保守，后续采用网关已有GPT-6分词器，增加25%及2048 token余量，并核对真实usage未越过预留；这不是模型分词的数学上界，不应复制为生产计费策略。实际协作耗时含本次串行额度闸门，不能推断生产并行性能。

#### 同模型HTTP／WS短上下文对照

受剩余额度限制，真实比较缩至一组同模型短上下文样本；没有额外注入大语料，首轮原生输入仍分别为6386／6388 token。固定high、标准档及512输出上限。

| 指标 | HTTP | WebSocket |
| --- | ---: | ---: |
| 首个生成请求首文本 | 3.662s | 4.083s |
| 首轮引擎总耗时 | 4.004s | 18.675s，含12.938s预热 |
| 首个生成请求JSON字节 | 33155 | 33497，另有11088字节预热 |
| 三轮总耗时 | 14.112s | 未完成，不能比较 |
| 冷恢复同线程 | 3.837s，通过 | 此对照未执行至该步 |
| 工具执行 | 1次 | 第二轮在派发前被预算闸门拒绝，0次 |

HTTP三轮、一次工具与冷恢复通过；WS首轮生成完成并收到原生WS成功信号，后续因预算预留不足结束。原生重试／HTTP回退尝试也被本地闸门阻止，没有额外上游派发。此次冷样本没有显示WS提速；单次网络波动、预热和未完成对照不足以判断稳定时延或长历史收益。完整交叉顺序、WS三轮／冷恢复的配对性能仍未验证。

#### 计费、离线自检与收尾

先前正式HTTP结算32条，共61708 quota，即0.9009368元。续验隔离网关新增37条结算，共6101 quota，即0.0890746元，包括真实WS探针、预热、成功轮次及后来被本地拦截流程中已经产生的调用。所有37条观察到的完成usage与原生账单按输入、输出、缓存读取及推理强度逐条匹配；19条还独立匹配原生缓存写入字段，较早18条未记录该字段，不能声称其缓存写入也经wire独立核对。

隔离37条逐条复算均一致：`round(((input-cacheRead-cacheWrite)*0.1 + output*0.5 + cacheRead*0.01 + cacheWrite*0.125)*0.5)`。日志quota之和、Token `used_quota`、用户与渠道用量相等，余额与已用之和始终回到初始6785 quota。累计67809 quota，按平台公开500000 quota／美元基准及7.3元／美元基准计0.9900114元；这是平台配置的额度换算，不是市场汇率。剩余0.0099886元小于下一项完整原生验收所需预留，因此停止调用，没有提高限额或充值。计费核对覆盖本次HTTP／WS的网关价目和本地结算；Azure供应商最终账单、正式生产WS结算仍未核验。预热实际收费，不能默认免费。

观察器与额度闸门4项离线测试通过，包含握手前不提前升级、分片文本与元数据、取消后不迟到派发、历史费用不能遗漏、临时扣额不能当结算以及原生缓存写入。纯合成回环的固定Codex驱动完成HTTP→WS、WS→HTTP四个会话、20次生成、4次预热、每会话一次工具及原thread ID冷恢复；这类离线通过不替代真实性能验收。

收尾保留脱敏逐请求样本、价目复算及失败原因供当前审阅；停止所属网关、Codex及测试进程，停用并删除隔离授权、数据库与rollout，回收临时Go SDK／网关源码副本和编译缓存。短期只读渠道PAT保留于用户指定配置，不扩权。正式WS入口和Azure type3接入、完整实模协作及交叉性能尚需单独完成；不得据本轮记录启用正式网站的能力标志。


### 真实会员隔离续验（2026-11-15）

**隔离WS协作闭环、Main／Worker原线程恢复、队列防重放、工具一次和计费核对已通过。性能对照已完成，结果不支持承诺整体提速。** 用户将累计预算提高到5元，继续计入此前0.9900114元；按网关价目计入历史后累计等值费用1.4923098元。已停止真实调用，没有更改正式入口、渠道、账号权限或网站能力配置，没有安装或发布。

仍使用Homer `c9b6d28fe9377b09ef4aa288af4ad76524930677`、Node22.22.0与固定Codex0.163.0，模型 `gpt-6-luna`。实际Homer为Main medium／Worker high，对照统一high／标准档、512输出上限、272000窗口及244800压缩阈值。每次运行独立runtime、工作目录和CODEX_HOME，子引擎HOME由现有 `CodexEngine` 指向隔离目录；没有启动日常Homer或读取其模型凭据。

#### 隔离路径与授权

短期渠道PAT现返回 `ACCESS_TOKEN_EXPIRED`。按用户已给的Azure Key复用授权，通过现有SSH运维通路，在两次只读SQL事务中确认同一启用Azure渠道及部署映射，并仅复制其一个启用Key到0700私密目录中的0600文件；没有续签或扩权PAT。当前价目版本仍为 `a42d372ccf0b5dd13ecf71203521f9d2`，公开额度换算仍为500000 quota／美元基准、7.3元／美元基准。

路径仍为候选Homer／固定Codex → 回环观察器 → 隔离原生New API → 真实Azure。复用OpenAI兼容type1及 `header_override` 的 `api-key` 头，没有改变正式Azure type3或入口设置。独立数据库只包含合成用户、有限额Token与本次渠道；自动渠道测试默认关闭，更新频率未启用。上游TLS校验保持默认，Key不进入URL。

原生网关复制源码指纹与前一日相同：`67231d4012d358082647c520cbe5c13eb209b112643a051a1dfc8e922c9dac17`。本轮二进制SHA-256为 `c9a6078677d1b60e811b26d6826fc57099fd81e16ad6229ba59f87aa1f834e18`，仍只有回环监听与合成首页embed覆写；这是隔离候选证据，不能代替正式部署镜像的源码证明。没有新增生产代码、依赖、传输配置、数据库实体或重试管理器。

#### 实际Homer闭环与消息队列

| 路径 | 首次派工至空闲 | 重启后的续办至空闲 | 完成模型请求 | 预热 | 常量工具 |
| --- | ---: | ---: | ---: | ---: | ---: |
| HTTP | 16.891s | 15.944s | 15 | 0 | 1 |
| WS | 21.989s | 19.705s | 19 | 4 | 1 |

两条路径均实际调用生产 `Homer`／`CodexEngine`：

- 同一Main及同一Worker在关闭／启动后保留原thread ID；冷恢复请求保留首轮随机标记和唯一原工具回执，Worker真实回复能复述该标记与结果。两次Worker run对应同一Worker及原线程，全部原生轮次完成，所属引擎安全退出。
- 在Worker执行常量工具期间向Main入队一条独立用户消息；宿主队列和处理历史证明该输入只对应一个Main process、一个原生turn，状态完成。重启后再次核对同一记录，重新提交相同request ID返回 `fresh:false`，没有新增模型请求或处理记录。
- 宿主操作账本只有一条确认的 `worker_open` 和一条确认的 `worker_send`；常量工具唯一call ID且只执行一次。检查覆盖用户输入与Worker结果回传共同进入现有串行队列的实际路径，没有为验收替换队列或改写原生历史。
- WS所有业务请求均经WS完成，Worker重启前后各收到一次真实生成完成信号。预热与被排除的独立原生记忆巩固请求分别计数，均不能作为业务回复或WS成功信号。

本轮首份WS补测的17个模型请求及功能断言已完成，但观察器把主动阻止的原生记忆请求误计入业务拒绝，最终断言失败。保留失败样本和2320 quota费用；新增离线回归验证“记忆请求零派发、非法业务消息仍报错”，修正观察器分类后重跑完整WS取得上述通过结果。生产代码未变，业务拒绝仍须为零。

#### HTTP／WS交叉顺序性能

分别使用无额外语料、2000行校准语料及2278行目标语料，实测首轮输入约6.4K、31.4K及35K token。每组顺序固定HTTP→WS→WS→HTTP，每种协议2个样本；同组首轮token差2，三轮内容及常量工具相同。每个会话三轮包含4次实际生成，关闭后沿原thread ID再生成一次；WS另有首轮和冷恢复各一次 `generate:false` 预热。12个会话全部通过，工具各一次，后续热轮使用原生 `previous_response_id`；WS最后热轮 `input` 均为160字节，35K对应HTTP为164597／164253字节。WS后续热轮没有重新携带首轮大语料；两种协议均未重放工具。

以下为每种协议2个样本的算术均值。三轮计时从首次 `turn` 到第三轮完成，包含该阶段实际等待的WS预热；冷恢复指标从新引擎 `start` 完成后的首次 `turn` 开始，进程启动时间不包含在内。首文本只从对应生成请求派发开始，不包含预热。请求JSON统计未压缩正文，包含对应阶段的预热，排除WebSocket帧、HTTP头和TLS；不能直接当成总网络字节。

| 首轮输入token | HTTP三轮 | WS三轮 | HTTP三轮请求JSON | WS三轮请求JSON | WS正文减少 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 6366–6368 | 6.837s | 8.632s | 140.59 KiB | 87.03 KiB | 38.1% |
| 31386–31388 | 8.875s | 9.640s | 626.76 KiB | 208.99 KiB | 66.7% |
| 34980–34982 | 8.045s | 9.287s | 694.61 KiB | 226.10 KiB | 67.5% |

| 首轮输入token | 协议 | 首生成请求首文本 | 连接建立后两轮 | 冷恢复后首轮 | 含冷恢复的全部请求JSON |
| --- | --- | ---: | ---: | ---: | ---: |
| 6366–6368 | HTTP | 1.976s | 4.659s | 1.648s | 179.22 KiB |
| 6366–6368 | WS | 1.422s | 3.885s | 4.147s | 139.85 KiB |
| 31386–31388 | HTTP | 2.325s | 6.363s | 1.779s | 785.76 KiB |
| 31386–31388 | WS | 2.116s | 4.593s | 5.157s | 383.27 KiB |
| 34980–34982 | HTTP | 2.485s | 5.364s | 1.694s | 870.65 KiB |
| 34980–34982 | WS | 2.189s | 4.258s | 5.176s | 417.53 KiB |

全部三轮样本按执行顺序保留：

- 6366–6368：http 6.895s, websocket 9.077s, websocket 8.186s, http 6.779s。
- 31386–31388：http 10.210s, websocket 8.851s, websocket 10.430s, http 7.541s。
- 34980–34982：http 10.021s, websocket 8.428s, websocket 10.145s, http 6.070s。

35K组三轮JSON减少67.5%，计入冷恢复后全部请求JSON减少52.0%；后续两轮平均5.364s→4.258s。首轮预热及冷恢复增加实际等待，三轮总平均仍为HTTP 8.045s、WS 9.287s。其他两组也呈现“热轮较快、总体并未稳定更快”的本次样本结果。样本量及云端缓存／负载波动不足以建立固定提速比例；没有把任一百分比作为验收门槛。WS减少重复上传，不减少服务端计费所依据的完整上下文usage。

#### 计费、检查与收尾

续验123条原生结算与123条观察到的完成usage逐条匹配，全部独立核对输入、输出、缓存读取、原生缓存写入及推理强度。按当时复制的价目逐条复算均一致，日志总quota、Token `used_quota`、用户与渠道用量都为34404；Token已用与余额240252之和仍为初始274656。含历史67809 quota累计102213 quota，按已复核的7.3／500000折合1.4923098元，未超过累计5元。所有失败样本费用也已计入。

123次中含20次预热，按当前网关价目核算2216 quota／等值0.0323536元；未观察到该价目之外的WS附加扣额或重复扣额。缓存命中差异按真实usage收费，不能把两种协议的费用差异全归因于传输。该结果验证隔离原生网关的价目和账本正确，不等于Azure供应商最终账单或正式会员账户WS结算已经核验。

观察器／五元额度闸门5项测试通过；固定Codex会员协议专项20/20通过、零跳过，覆盖Main／Worker旧配置缺省字段、426回退、401／429／503、事件限流、断线、超限及工具结果后断线。纯合成对照驱动4会话、20生成、4预热及原线程冷恢复通过。没有修改生产源码，本轮没有重复全量核心测试或安装验收。

脱敏逐请求样本、汇总和独立Decimal价目复算保留于本次scratch供当前审阅，正文提供可持续保存的版本、方法、数值与范围。已停止隔离网关及全部所属引擎，停用并删除隔离Token、Key副本、数据库、rollout和原始日志，回收临时Go SDK、源码副本、编译缓存及依赖符号链接；共享依赖保留。正式入口／正式Azure渠道、37万token、附件场景及供应商最终账单未在本轮验收，正式启用仍须独立处理。

## 桌面升级门禁最小修复（2026-11-16）

生产仅调整 `prepareDesktopProfile` 的建档 Codex 相等检查及 `unconfirmedNativeEffectsSql` 的严格 webSearch 例外；不改资料或停止协议。新增回归先在旧代码下失败，再验证通过。

定向离线检查（Node 以仓库 `.nvmrc` 为准）：

```sh
node --experimental-vm-modules --import ./tests/fixtures/synthetic-home.mjs --import tsx --test --test-concurrency=1 \
  tests/desktop-profile.test.mjs tests/main-mailbox-projection.test.ts tests/desktop-update-runtime.test.mjs
```

106/106 通过、零跳过。覆盖 profile 建档版本不同仍保留原标记/账号/文件、损坏或缺字段拒绝、实际 schema 8 读取及不支持 schema 5 拒绝；runtime 入口集成使用真实 profile 读取和 SQLite，仅替换原生宿主启动。SQL 的升级、原生 fork、旧回执恢复预检及 fresh-main 预检四个调用方均覆盖同轮 completed 放行、轮次错配、空/缺失轮次、缺失或宿主终态、运行中、命令/文件/外部工具/其他类别继续阻塞，并比较未知历史原文不变。

复用现有原生连续性专项，显式指定固定 0.171.0-alpha.7 与 0.163.0 两份二进制：

```sh
HOMER_TEST_CODEX_BIN=/absolute/candidate/codex \
HOMER_TEST_PREVIOUS_CODEX_BIN=/absolute/baseline-0.163/codex \
node --import ./tests/fixtures/synthetic-home.mjs --import tsx --test --test-concurrency=1 \
  tests/native-thread-continuity.engine.test.ts
```

7/7 通过、零跳过：两角色/两种记忆模式、原生目标保留，以及 0.163 旧线程在 0.171 中续接并保留原回执、工具不重放。只用独立合成 HOME/CODEX_HOME、合成凭据及本地 Responses 服务，不读取日常账号或调用生产模型。

`tests/macos-desktop-runtime.test.mjs` 的既有包内资料保留案例补入 Codex 0.163.0 旧标记及账号记录逐字保留断言，沿现有 desktop 专项登记执行；本轮未重建安装包，该正式包专项未运行。VM 入口和原生协议通过不代替正式包安装、安全重启、回退或日常资料保留验收。

最终候选从已提交 `ee89cce37b89691db09b8c3ed0b5a66dbf100c86` 导出，仅应用本轮增量，排除共享工作区其他未提交代码。最终定向组 106/106、固定引擎 7/7、完整类型检查和源码构建通过；共享工作区完整类型检查亦通过。

默认 `npm test` 为 **2700/2702**，零跳过/取消。两项失败均为 `tests/message-image-preview.test.mjs` 的 `decoded image removes its duplicate card and restores fallback across lazy reloads and revision changes`、`HTTP preview failure retains the named download card and reports a failed download`。未应用任何本轮补丁的同一提交基线定向重跑 1/3 通过、相同两项失败；不为本轮全绿修改已有图片断言，也不混入其他任务的图片修复。

本轮未提交、推送、重建或发布安装包，未停止、安装或改动日常 Homer。正式包专项和原生安装/安全重启/数据保留仍未验收；源码编译不是安装包构建。

收尾：确认隔离目录无打开文件后，按 work-cleanup 回收源码/基线副本和原始日志约 171,044,864 分配字节，不将该数值等同于 APFS 可用空间变化。仅保留 `.codex/scratch/upgrade-blockers-20261116/` 内约 474,532 字节的初始快照、本轮补丁及验证摘要，用于区分并行未提交片段；完成精确审阅/暂存后删除。共享测试目录、原安装材料和日常数据未作跨任务清理。

## 2026-11-13 普通图片预览缩放专项

新增 tests/canvas-image-zoom.browser.mjs，登记到显式 browser 清单，不进入默认 npm test。使用现有Node22、React/Vite、playwright-core和已安装的macOS Chrome；完整HomerApp与CanvasPanel读取合成HTTP/图片，不接账号、模型、日常runtime或CODEX_HOME。独立helper只服务本图片专项，不修改历史分页共享夹具。

在仓库根目录先构建独立UI，再执行定向验收；以下为本次路径，可替换为新任务的独立目录：

    node node_modules/vite/bin/vite.js build ui --config ui/vite.config.ts --configLoader runner --outDir ../outputs/task-e5c80f76-image-zoom-implementation/web --emptyOutDir
    HOMER_COMPONENT_BUILD=outputs/task-e5c80f76-image-zoom-implementation/web HOMER_BROWSER_EVIDENCE=outputs/task-e5c80f76-image-zoom-implementation/evidence-standard-final node tests/canvas-image-zoom.browser.mjs

仅对合成测试的mock-keychain对照，另指定HOMER_IMAGE_ZOOM_MOCK_KEYCHAIN=1和不同证据目录；默认不启用该开关，不改变真实App或日常Chrome。结果分别记录uiPassed、整体passed、模式、退出码／信号／强制终止／watchdog，不能只凭PNG或功能断言判定整体通过。

本次1440／390／320px的25组交互记录全部完成：三图适应、加减、100%原像素、原生滚轮、重置、准确换图与修订、加载失败禁用、Blob复用、消息缩略图与浮层、原批注分支隔离。原生指针标签切换保留，同时核对程序聚焦、键盘整项可见、关闭后焦点及resize。窄屏指针原失败事件与诊断保留，未删弱断言。

UI类型检查、官方Canvas两项离线检查、脚本语法和独立Vite构建通过。标准模式最终uiPassed为true，但Chrome退出码2且watchdog为true，整体专项仍失败；mock-keychain对照25组通过，Chrome退出0、无信号、未强制终止、watchdog为false。两模式分开保存于本任务outputs，mock正常退出不证明真实Keychain正常。已查看实际三屏截图；移动真机、真实屏幕阅读器及已安装Homer未验收，也未安装或部署。

2026-11-15在HEAD 7771599及当前并行图片组件改动的组合上重新复审，未发现新增问题。UI类型检查、官方Canvas2/2、脚本语法与独立构建通过；标准与mock-keychain模式各完成1440／390／320px的25组交互，均整体通过，Chrome退出0、无信号、未强制终止且watchdog=false。新结果分别保留于本事项outputs的review-20261115-standard与review-20261115-mock，不覆盖此前watchdog失败，也不据此推断历史失败原因；仍属源码合成验收。

交付前回收无占用profile与重复构建；保留结果、对照、指针诊断和必要PNG供本轮效果确认，确认后可按任务归属清理。

2026-11-17 在 HEAD 994fc5f4 与当前工作区组合上复审，标准模式1440／390／320px共25组全部通过，Chrome退出0、无信号、未强制终止、watchdog=false。沙箱内首次启动SIGABRT，未执行功能检查；获准在沙箱外运行独立profile后完成。UI类型检查、Vite构建和官方Canvas／Diff定向离线15/15通过；实际宽窄屏截图已核对。既有watchdog失败仍保留，不推断历史原因；未运行安装版、移动真机、真实屏幕阅读器或全量专项。Diff离线夹具补ResizeObserver桩仅支持合成布局，几何验收由浏览器专项承担。


## 消息显示简化复审（2026-11-17）

新增display-simplification.test.ts覆盖来源数量／完整标题和桌面打开stub；两项browser脚本登记到显式browser清单，不进入默认npm test。它们使用独立Chrome/profile、mock-keychain和合成HTTP，不接账号、真实模型或日常runtime。

    node --import tsx --test tests/display-simplification.test.ts tests/official-sources-history.test.ts tests/official-sources-upstream.test.mjs tests/official-sources-legacy-activity-ui.test.mjs tests/quote-navigation-ui.test.mjs tests/message-source-consistency.test.ts tests/message-source-selection.test.mjs tests/web-server.test.ts
    HOMER_COMPONENT_BUILD=/private/tmp/message-display-review/dist/web HOMER_BROWSER_EVIDENCE=/private/tmp/message-display-review/evidence node tests/display-simplification.browser.mjs
    HOMER_COMPONENT_BUILD=/private/tmp/message-display-review/dist/web HOMER_BROWSER_EVIDENCE=/private/tmp/message-display-review/evidence node tests/display-simplification-extra.browser.mjs

浏览器命令中的独立构建和证据目录须替换为实际路径。专项检查1080／390px正文、过程、Canvas图片／链接／公式、Mermaid图内图片及旧规模之外的渲染，点击图内链接实际打开新窗口；成功过程仍隐藏，失败保留源码。核对Chrome退出0、forced=false、watchdog=false，不能只看PNG。长引用16000／96KiB放宽未纳入本提交，超长引用发送实验不计入本次通过项。手机真机、任意外站及系统真实打开未验。结论见docs/message-display-simplification-2026-11-17.md。

生产CSP回归：node --import tsx tests/display-production-images.browser.mjs，沿用上述HOMER_COMPONENT_BUILD／HOMER_BROWSER_EVIDENCE。该显式browser项直接使用真实createWebServer承载静态页面、SSE和媒体，覆盖普通网页及desktop-token模式的HTTP／HTTPS正文、过程、Canvas和Mermaid图片，断言无img-src违规且远程请求不带桌面token。旧策略阻挡已有反例；主页面仅放开img-src的http:／https:，其他指令、HTML预览及截图面板不变。移动App从内联HTML加载，不继承该HTTP CSP；原生网络策略及真机仍未验。

## Markdown 附件相对图片专项（2026-11-17）

默认离线回归 `tests/markdown-resources.test.ts` 使用已有独立SQLite／附件夹具，覆盖保存的原路径、子目录与../、编码路径、正文快照、原.md删除／修改、图片变化／缺失、无原路径、原有消息授权及文件检查。`mobile-request.test.mjs`验证手机资源URL到`media.read`的参数与二进制回传；桌面鉴权断言沿用`electron-shell.test.mjs`。不读取日常账号／runtime／CODEX_HOME，不调用模型。

```sh
node --import tsx --test tests/markdown-resources.test.ts tests/artifact-reveal.test.ts tests/web-chat.test.ts tests/mobile-request.test.mjs
node --import tsx --experimental-vm-modules --test tests/web-server.test.ts tests/electron-shell.test.mjs tests/reader-scroll.test.mjs
```

显式browser清单登记`markdown-resources.browser.mjs`，不进入默认npm test。使用Node22、已安装Chrome、playwright-core与现有UI依赖；真实Canvas Preview通过合成HTTP连接真实媒体读取宿主，在1440／390px验证同目录、子目录、../、中文空格图片解码、缺图提示、气泡相对路径不变及原.md删除后更新图片重开。构建直接使用现有CSS，避免重写并行生成文件。

```sh
node scripts/build-preview-annotation.mjs
node node_modules/vite/bin/vite.js build ui --configLoader runner --outDir /private/tmp/homer-markdown-preview-images-build --emptyOutDir
HOMER_COMPONENT_BUILD=/private/tmp/homer-markdown-preview-images-build HOMER_BROWSER_EVIDENCE=outputs/markdown-preview-images-20261117 node --import tsx tests/markdown-resources.browser.mjs
```

本轮19+479项定向回归、两端类型检查及独立构建通过；两种宽度各四张图片解码，缺图有失败提示，快照正文保留，重新打开图片更新。Chrome正常退出0，forced=false、watchdog=false。截图与JSON保留于上述outputs目录供评审；构建和已退出profile按任务收尾清理。首轮四图已解码，但缺图未滚入懒加载区域导致断言超时；补测试滚动后通过，未为此修改产品。手机仅完成适配与宿主操作的合成验证，未运行真机／真实RTC、安装版或全量专项。

本轮提交前复审：图片读取仅查询已授权附件元数据及原路径，不逐图重读／hash整份Markdown；正文读取保留原完整性校验。约1 MB合成报告连续10次图片读取仅触发1次正文读取的回归通过，不新增缓存或持久状态。精确提交候选488项定向离线回归、两端类型检查、独立构建及1440／390px实际Preview通过，Chrome退出0、forced=false、watchdog=false；独立复核无阻断。候选验证发现错误提示原依赖并行未提交代码，本事项仅纳入必要failed状态／文案，onError回调继续留其他事项。沙箱内4项桌面锁恢复失败在获准沙箱外重跑后通过；未运行安装版、真机或真实RTC。

精确提交候选（仅含本事项改动）复审：488项定向回归零失败／零跳过、后端与UI类型检查及独立构建通过。沙箱内四项桌面锁恢复断言失败，获准沙箱外完整定向重跑488/488通过；未修改锁恢复实现。资源读取开销回归与独立只读复核通过。


## 过程展示与副本精简（2026-11-17）

只选离线协议与合成界面，不使用日常 runtime、账号或真实模型。`tests/process-display-slim.browser.mjs` 已登记 browser 专项；Browser 插件技能不可用，本次沿项目 Playwright／独立 mock-keychain Chrome 入口验证。

```sh
npm run typecheck
npx tsc --noEmit -p ui/tsconfig.json
node --import ./tests/fixtures/synthetic-home.mjs --import ./tests/fixtures/core-system-proxy.mjs --import tsx --test --test-concurrency=1 tests/main-process-summary.test.ts tests/main-process.test.ts tests/internal-coordination-ui.test.mjs tests/taskcard-sources.test.ts tests/internal-coordination-output.test.ts tests/worker-progress-host.test.ts tests/worker-execution-read.test.ts tests/task-status-progress.test.ts tests/native-thread-fork-gate.test.ts tests/native-thread-bindings.test.ts tests/service-main-native-approvals.test.ts tests/service-mcp-tool-approval.test.ts tests/process-nodes-ui.test.mjs tests/tool-message-projection.test.mjs tests/main-chat-display-ui.test.mjs tests/legacy-activity-reading-ui.test.mjs tests/run-activity-facts-ui.test.mjs tests/process-reading.test.mjs tests/process-presentation.test.mjs tests/web-history-window.test.ts tests/task-status.test.ts tests/reader-scroll.test.mjs tests/quote-navigation-ui.test.mjs tests/chrome-cua.test.ts tests/task-overview-native.test.ts tests/mobile-request.test.mjs tests/schedule-host.test.ts tests/official-sources-history.test.ts tests/official-sources-legacy-activity-ui.test.mjs tests/reception-reads.test.ts tests/task-creation-labels.test.ts tests/tool-service-observer.test.ts tests/worker-card-host.test.ts tests/user-message-bubble-ui.test.mjs tests/tool-call-history.test.ts tests/run-activity-complete.test.ts tests/worker-card-events.test.ts
node scripts/build-preview-annotation.mjs
(cd ui && ../node_modules/.bin/vite build --configLoader runner --outDir /private/tmp/homer-process-slim-web)
HOMER_COMPONENT_BUILD=/private/tmp/homer-process-slim-web HOMER_BROWSER_EVIDENCE=/private/tmp/homer-process-slim-browser node tests/process-display-slim.browser.mjs
```

实际结果：318/318，无跳过；两端类型检查及独立构建通过。浏览器 1080／390px 都验证了事项名、正式正文、隐藏所有工具状态／正文、无 progress/execution/process 读取、静态 Worker 事件、完成后焦点回消息、任务列表原文入口与审批拒绝／已答显示；无页面或控制台错误。Chrome 正常退出 0，forced=false、watchdog=false。审批按钮与 HTTP 回执为合成 fixture，业务审批／授权语义由上述离线测试覆盖，不能替代真实原生审批验收。

退役的 captureToolValue／WorkerProgressStore／详情缓存纯单元与旧布局断言随实现移除，业务身份、scope、晚到终态、错误、回执、原文、引用和分页断言在现有整合测试保留并改为无正文／缓存路径，不以跳过换全绿。补跑的 `chat-ui-enrichment` 一组 52 项中 51 通过、旧“排除 unsafe URL”断言失败；该断言及任务前 message-links 源码在隔离对照中同样失败，保留未修复，未混入链接策略调整。

当前评审证据在 `/private/tmp/homer-process-slim-20261117-run8c5/`：最终日志、browser/result.json、四张 PNG 与本事项相对共享树基线的 patch；只保留供本轮核阅／精确集成，完成后可回收。构建、测试副本和已退出 Chrome profiles 在交付前按 work-cleanup 回收。未运行全量、真实模型、安装版／真机，不表示日常 Homer 已采用。

提交前已在最新 HEAD `787afc68` 上隔离本事项构造精确候选，307 项定向检查无失败／跳过，两端类型检查、独立构建及 1080／390px 合成实际界面通过，Chrome exit 0、forced=false、watchdog=false。复审发现全局历史版本会引起已展开 Worker 详情重复读取，已改为按 Task／Run 生命周期字段触发；请求次数回归先复现 11 次，再验证无关更新保持 1 次、Run 变化后为 2 次，不新增缓存或版本实体。新回归已纳入上述命令。沙箱内进程身份查询导致的候选测试失败在获准沙箱外原样重跑后通过，未改断言或锁实现。未进行真实模型、原生审批、安装版或真机验收，提交状态以 Git 记录为准。

## 会员原生 Auto Review（2026-11-17）

普通离线回归：`node --import tsx --test tests/membership-auto-review.test.ts tests/deepseek-model.test.ts tests/desktop-deepseek-engine.test.mjs`，30/30 通过。新单测覆盖隐藏 Luna、父模型保全及同名去重；现有协议夹具补充原生审批响应字段。当前公共配置接口的 main／worker 均有 context 与 capabilities；没有读取凭据或调用真实模型，也未为旧配置补兼容。

显式引擎专项（登记在 `scripts/test.mjs` 的 engine 清单，但本次没有运行整个 engine 清单）：

```sh
HOMER_TEST_CODEX_BIN='/Applications/Homer.app/Contents/Resources/runtime/codex/vendor/aarch64-apple-darwin/bin/codex' node --import tsx --test tests/native-membership-auto-review.engine.test.mjs
```

必须明确提供固定版本二进制；测试不使用缺项 skip，版本不符则失败。每例在 `/private/tmp` 建立独立 HOME/CODEX_HOME、合成会员 Token 与回环 Responses，并在 finally 关闭引擎、服务器和数据库后删除。各角色分别覆盖 allow、deny、401、显式 user、never、同名 Luna、无效 JSON、停止、Terra Code Mode Only。捕获实际 model／URL／鉴权，审批后的本地合成文件证明执行与否；停止案例在 interrupt 后释放迟到 allow 并验证不执行。每例冷恢复，allow 案例另验证会员→ChatGPT→会员 fork，未在 ChatGPT 来源运行模型轮。

此前来源往返用例复现切回 ChatGPT 仍继承 auto_review，已通过显式目标来源配置修复；停止测试曾误将 interrupt 返回 false 当作失败，现改为等待真实原生终态，不以 ACK 判断完成。失败历史不追认。最终完整专项 **18/18 通过，零失败／跳过／取消**；相关普通离线回归 **30/30**、完整类型检查通过。

类型检查：`node node_modules/typescript/bin/tsc -p tsconfig.check.json`。不涉及真实付费模型、会员审核效果、线上网关路由或账单验收；未安装或重启日常应用。源码自带 Luna 窗口是模型元数据，不是本次添加的费用防线。

提交前已在最新 HEAD `787afc68` 上隔离本事项构造精确候选，307 项定向检查无失败／跳过，两端类型检查、独立构建及 1080／390px 合成实际界面通过，Chrome exit 0、forced=false、watchdog=false。复审发现全局历史版本会引起已展开 Worker 详情重复读取，已改为按 Task／Run 生命周期字段触发；请求次数回归先复现 11 次，再验证无关更新保持 1 次、Run 变化后为 2 次，不新增缓存或版本实体。新回归已纳入上述命令。沙箱内进程身份查询导致的候选测试失败在获准沙箱外原样重跑后通过，未改断言或锁实现。未进行真实模型、原生审批、安装版或真机验收，提交状态以 Git 记录为准。

提交前复核（2026-11-17）：仅含本事项改动的独立候选基于 `b11e2c64`，使用项目 Node 22.22.0 验证相关回归 30/30、打包 Codex 回环 18/18、完整类型检查通过；零真实模型调用。此候选不包含共享工作树的其他未提交片段。

## 定时任务 Preview 展示（2026-11-17）

数据读取及chip沿默认离线测试收集；正式渲染登记在显式browser清单，不默认启动浏览器或访问日常实例。

```sh
node --import tsx --test tests/schedule-display.test.ts tests/mobile-request.test.mjs \
  tests/web-chat.test.ts tests/reader-scroll.test.mjs
node --import tsx --test tests/schedules.test.ts tests/schedule-inbox.test.ts
node --import tsx --test --test-name-pattern='schedule chip|chip alone' tests/main-composer.test.mjs
HOMER_SYNTHETIC_ROOT=/absolute/isolated-temp node --import tsx --test \
  --test-name-pattern='schedule read uses host' tests/web-service.test.ts
node node_modules/typescript/bin/tsc --noEmit -p ui/tsconfig.json
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.check.json
node scripts/build-run-activity-css.mjs --schedules --check
```

以上依次80／23／2／1项通过（106项），类型及CSS一致性通过。HTTP用例只使用独立合成runtime，核验无活动引擎时仍可通过宿主原授权来源读取、外实例过滤、epoch／伪owner拒绝、正文按需和零写入。SpecSheet保留官方字段renderer的hash校验。通用Composer额外57项通过，6项旧历史恢复fixture需写沙箱只读目录而未完成，提权重跑未获批准，不宣称该文件全绿；没有为了测试改产品权限或夹具。

显式产品UI检查（先将当前ui通过Vite构建到独立目录，勿覆盖在用dist）：

```sh
HOMER_COMPONENT_BUILD=/absolute/isolated-web-build \
HOMER_BROWSER_EVIDENCE=/absolute/isolated-evidence \
node tests/schedule-display.browser.mjs
```

当前1440／390／320px均通过：原文件与schedule标签共存和切换；普通对话无卡片；SpecSheet长内容完整且位于末行；详情关闭实际命中、键盘／回焦、引用不冒泡不发送、chip移除与刷新恢复、完整ID在真实POST普通文本只拼一次、state刷新及失败未确认提示。启动隔离Chrome、只连接本地HTTP／SSE合成fixture，使用mock keychain，不连接真实计划／模型。必须同时核对退出码0、forced=false和watchdog=false，不能只看PNG。源码及证据见[实施方案](superpowers/plans/2026-11-17-scheduled-task-display.md#8-实施与验证2026-11-17)；未覆盖安装版、真机、真实LLM调用或渠道实网专项。

## Preview 顶栏与图片批注进入反馈（2026-11-17）

显式专项 `tests/preview-annotation-entry.browser.mjs` 使用真实 HomerApp / CanvasPanel / Annotorious，以及普通与 floating ScreenshotDialog；仅合成 HTTP、图片和上传回执，独立 Electron profile，不连接日常账号、runtime、真实截图采集或模型。已登记 browser 清单。现有 Node 22.22.0、Electron / Playwright / esbuild 依赖即可运行，不安装工具。

```sh
# 从仓库根目录运行；先用当前源码构建到独立临时目录。
(cd ui && ../node_modules/.bin/vite build --configLoader runner --outDir /private/tmp/homer-preview-entry-web)
HISTORY_FOLLOWUP_BUILD=/private/tmp/homer-preview-entry-web HOMER_BROWSER_EVIDENCE=outputs/preview-entry-review node tests/preview-annotation-entry.browser.mjs
node --import tsx --test tests/annotation-comment-form.test.mjs tests/annotation-draft.test.ts
node_modules/.bin/tsc --noEmit -p ui/tsconfig.json
```

1440／390／320px 正式组件合成验证通过：单行标题／标签及重要操作、长标题可见性、图片／纯文／Markdown／HTML回退／音视频／未知格式顶栏，200ms边框、引导淡出／拖选即隐藏、备注保存、退出、Esc回焦、定时器清理与减少动画，以及两种截图弹窗的既有完成／取消规则。此处不验证媒体解码、真实浏览器接管或真实截图权限；图片缩放与网页地址等专用工具功能仍保留。截图和结果见 [本轮证据](../outputs/task-42f3ced3-annotation-entry/implementation/README.md)。

2026-11-17复审：基于 `dfee7228` 的独立候选在项目Node 22.22.0通过70/70定向离线（含完整main-composer、共享表单、草稿）、UI类型、构建及三宽度正式组件专项。并行浏览器事项补齐 `BrowserPreviewContext` 夹具绑定后，共享完整Composer／批注表单／草稿70/70回归通过；共享UI类型、构建及1440／390／320px正式组件专项通过。此前失败记录保留为历史诊断，最终结果见 `implementation/review/integrated-offline-final.log` 与 `integrated-final-browser/verification.json`。本事项精确提交不包含浏览器专属夹具或生产代码。安装版／真实采集／原生触摸未验收。
