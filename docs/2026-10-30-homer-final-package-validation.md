# Homer 最新 main 测试归因与 build 127 验证

最终版本、使用步骤及两端上线后的真实验收范围见 [最终交接及使用说明](2026-10-30-homer-account-final-handoff.md)。本记录保留实际测试与失败证据，不作为生产已验收声明。

2026-10-30。本轮直接在主树工作；不创建分支或 Git 工作树，不提交、不部署、不安装、不重启日常 Homer，不调用真实供应商。购买、生产接入和额度政策保持原状态。

当前阶段已转为 [三方发布准备](2026-10-30-homer-release-readiness.md)：购买关闭时优先复用 AMH 现网官方版本，不再重复合成测试。下文保留各轮实际观察；其中合成额度／旧 tokenQuota 记录不代表正式赠额政策，新 Token 固定零额。

## 输入与隔离

- 产品输入：`main 688443b96e90c8935b7dee2088b6b393cdf0156d`，版本 `0.1.0`，build `127`。
- 起始主树有 88 个无关已跟踪 dirty 路径；打包使用 `git archive` 的准确提交副本，不将脏整树当发布输入。该副本没有 Git 工作树元数据。
- 对照：`c964b2bbee0435d9a6f51bb12bdaf63a67924852`，早于凭据改名、Logo 和账号 UI 精简。两份源码都使用 Node 22、相同依赖和隔离 HOME/runtime；Node 网络限制为 loopback，固定 Codex 场景明确使用合成网关和合成 Key。
- 证据根：`.codex/scratch/main-release-validation-20261030/`。诊断记录不含真实凭据。

## 全仓检查与修正

使用准确提交副本逐文件运行全部 266 个已提交测试文件，避免旧套件在记忆测试处停滞而漏掉后续文件。最终环境使用独立 HOME、短 TMPDIR、没有 Codex 的受限 PATH 和只允许 loopback 的 Node 网络保护，不覆盖用例自己的模型、Codex 或数据配置。

- 独立复核成功的 4 个文件：reader-scroll 52/52、desktop-source 4/4、Electron 4/4、macOS runtime 12/12；只修改下表中的两个测试文件。
- 其余原先成功的 200 个文件在移除配置覆盖后全部成功结束，其中原有 8 项跳过仍保留，不算执行通过。
- 剩余 62 个文件已对照旧提交 62/62：53 个为相同失败内容，9 个两版均未结束。不同结果 0 个。未结束的文件不能证明没有回归，也不能算通过。
- 单独复跑账号、角色配置、权限界面、Electron 接线及 profile，331/331；前后端产品 TypeScript 在正式构建中通过。
- 包含测试源码的 `tsc --noEmit -p tsconfig.check.json` 两版各有 116 个错误。归一化 archive 根路径和源码坐标后，错误类型及内容完全一致；不将此项写为通过。

目前明确修正的是两处过时测试夹具，均保留原行为断言与超时：

| 文件 | 失败原因 | 最小修正及验证 |
| --- | --- | --- |
| `tests/reader-scroll.test.mjs` | Logo import 已更名，夹具仍注入 riverStone64/256，渲染前报未定义 | 注入 homerLogo64/256；原 52 项断言全部通过，包含固定提交产品模块复核。 |
| `tests/macos-desktop-runtime.test.mjs` | 网站连接夹具硬编码生产 origin，隔离包正确拒绝；网站角色明确 max，断言仍误用旧 profile 的 high | 从包 manifest 取得批准 origin，网站角色严格断言 max；继续验证原配置字节、thread、未知结果与回退不重放。先保留失败复现，再完整包测试 16/16 通过。 |

`desktop-source` 的失败属于 archive 子目录执行时 Git 路径前缀错误；在 maintree 运行未修改测试 4/4 通过。未改产品实现。账号测试没有因这些夹具修正减少覆盖。

其余完成对照的旧失败包括：测试仍导入已删除的 memory/native-memory/worker-execution-clock 模块，旧 fake process 缺少现行方法，UI 夹具缺少现行组件，以及旧 API/连接门禁断言和独立媒体工具前提未满足。比较不仅检查失败标题，也核对错误内容和模块导入失败的 TAP 前导错误；只归一化两个源码根、合成 UUID、时间戳及随机目录后缀。它们在旧基线中复现，不代表已修复。部分旧测试在当前主树中已有他人未提交删除，本轮不接收这些并行改动。

本轮未完成的文件：

- `tests/dev-upgrade.test.mjs`
- `tests/telegram-host-upgrade.test.mjs`
- `tests/wechat-host-upgrade.test.mjs`
- `tests/memory-service.test.ts`
- `tests/memory-invalidation.test.ts`
- `tests/native-memory-adoption-service.test.ts`
- `tests/native-execution-recovery.test.ts`
- `tests/service.test.ts`
- `tests/web-engine-stream.test.ts`

逐文件失败对照保存在证据根的 `neutral-failure-classification.json`，SHA-256 `479d8a8ec0be0e0e2e4ccc4dd4509f3000a26ce220783093889f914feffce303`；记录每个文件两版的实际失败内容和不完整状态。完整套件仍有旧失败及未完成检查，不能宣称所有测试通过或三方验收完成。

诊断修正记录：第一轮曾统一设置 HOMER_CODEX_BIN、HOMER_CODEX_HOME 和 HOMER_DATA_HOME，发现会覆盖用例自己的假引擎及路径后，已移除并复核全部 266 文件；第一轮汇总不作为最终归因。另修正只读 archive 执行根、macOS Unix socket 路径过长，以及临时网络保护层必须保持 fetch 的 Promise 拒绝语义，均未改产品。保留各轮清单、主要失败复现及更正结果，不通过延长超时或删断言凑绿。

执行与证据索引（均位于证据根）：`neutral-comparison.py`/`neutral-passing-files.py` 使用 Node `22.22.0`、现有 tsx CLI 和 `--test --test-concurrency=1 --test-reporter=tap` 逐文件运行；`neutral-comparison.json` 记录新旧退出状态和日志摘要。`focused-neutral-result.json`/`focused-neutral.log` 记录 331 项；`reader-fixed-archive-result.json` 记录 52 项；`desktop-source-main.log` 记录 4 项。`packaged-tests-final-result.json` 保存实际包测试命令与退出码，`package-verification.json` 保存完整包校验结果。生成器和网络保护只属于诊断临时产物，不进入产品。

## 正式 macOS 包

- 从准确提交构建，无 preparation overlay；公开 origin 为 `https://super-tree.com` 与 `https://models.super-tree.com`。
- 固定 Node `22.22.0`、Codex `0.163.0`、Electron `45.0.0`。manifest 1761 个资源与 2 个代码文件的 SHA-256 均匹配；ASAR 主进程和 preload 与已提交源码一致。
- `codesign --verify --deep --strict`、ZIP 完整性及包内版本检查通过；签名为 ad-hoc，未提供 Developer ID 或公证证据。manifest 的 publishable 字段不代表已满足外部分发签名要求。
- ZIP：`/Users/wolf3c/Project/homer/.codex/scratch/main-release-validation-20261030/source/.codex/scratch/formal-build/forge/make/zip/darwin/arm64/Homer-darwin-arm64-0.1.0.zip`。
- ZIP SHA-256：`552a87c72c265efd8f7d2b48bc91e2d7912b253471f84c3090c02d7bca653789`，326962932 字节。
- sourceHash：`f2f81e6e9e49fba82bfb19611d3526f4a16e2323e78b4c20c3b67415423a6c70`；uiHash：`2bf90d292708bb7586da7db62e2335a915f0899864fa006321d74ec8a312c5ae`。
- 首次从 dirty 主树执行打包被锁文件检查正确拒绝；未放宽检查，改用准确提交副本后成功。仅恢复独立、锁定的维护工具，不改项目依赖。

## 包内运行与三方复验边界

联调 App 从正式包 APFS clone，仅修改公开 loopback origin、preparation 标记并重新 ad-hoc 签名；1761 个编译资源摘要与正式包相同。正式 App 与 ZIP 不改。下文保留失败和恢复过程，最终通过范围见“最终三方合成结果”。

首轮包内测试 16 项中 6 通过、10 失败，主要表现为 Electron 30 秒启动及 runtime 10 秒 URL 等待超时。保留原失败记录，没有延长等待或删断言。高负载现场诊断：最新 runtime 在约 24.99 秒发出 URL，随后正常停止并以 0 退出；该诊断不等于原测试通过。旧 build 123 的 bundled Node 也仅用独立合成 profile 做相同诊断，14.48 秒发出 URL、16.02 秒正常退出；没有打开旧 App 或日常 profile。两次现场负载不同，不能据此宣称性能等价，也不认定新的产品回归。一次高负载串行账号用例仍在 Electron 原 30 秒 launch 期限超时。无内容的协议相位诊断显示：窗口和 DevTools target 已创建，调试握手到达期限；此时主机 load 为 110–190。未禁用签名、跳过资源校验或更改超时；这仍不构成包内用例通过。负载回落到约 8–13 后，原 Electron 4 项全部通过（首次就绪约 5.9 秒，历史恢复用例约 2.5 秒），未修改任何超时。runtime 另 3 项夹具遗漏按上文修正后，修正后完整 16 项已通过，耗时约 61 秒，原超时未改。桌面 1440×780 和窄窗口 390×780 的真实 Electron 账号界面也已检查，截图在 `packaged-final-profiles/`。最终三方结果见下文。

AMH 已补完旧 Redis Token 格式的等待恢复验证：最终镜像 config ID 为 `sha256:f63443e7cb9d60c74498211c59d7325aeb08e49de3548b3317b4e113f709c5ef`，SQLite/PG/MySQL 分别 74/75/75 项客户端断言通过；PG/MySQL 均验证旧缓存缺字段时返回 503，等待原生 TTL 后同一充值引用恢复且不重复入账。产品 patch 未变。该项为 AMH 单方证据，不能替代三方结果。

yezi2 已完成使用原支付资产的生产模式包及购买、接入关闭状态下的独立运行/浏览器检查；其文件清单摘要为 `28fe9e4d0a97a503e7a893933535c15d4a0e3012afd89b0bf0093827db15b5fa`，不是归档摘要。该聊天随后收到用户“先只看 Yezi2，保持 Homer 接入和购买关闭”的要求，故此前未开启登录联调。用户现已在本聊天明确答复“允许仅隔离登录接入，完成三方复验”；只在本机独立合成实例临时开启登录，购买及生产接入仍关闭。

本轮已修通 AMH 3183 和网站 3180 本机入口：保留 internal 容器网络，仅用固定目标的 loopback 测试转发；没有改全局网络或产品程序。Homer 从本机核实两个健康入口均为 200。AMH 使用同一最终镜像，网站只读挂载上述最终包；Homer lab 重新配置两个 origin 并验签，1761 个编译资源与正式包仍完全一致。

网站源码身份须精确记录为 `56f736febe284323a2f7896e8e5c4cefefcc5218` 加明确的 Homer 未提交覆盖，排除并行 RTC；源码清单摘要 `87a16fe3bc230fbf49dfc64d2811b72fcc886487707c9fbac2be5ce39b23943c`。不能把该候选说成 master 提交本身。其 78478 项最终包清单已由网站负责人重新逐项核对。本轮没有新增构建、提交或产品源码改动。

同一网站合成用户已通过网站原授权接口预先创建有限 Token `id=4`，以便客户端首次初始化前获得测试额度；AMH 先确认其零额，再沿用既有 release_client 夹具的 100000 数值注入，原引用重放返回同一收据、仅一条入账。本人查询不包含共享 user_quota，购买、订单均未参与；该测试数值不代表正式额度政策。输入身份与摘要见 `triad-input-lock.json`。

第一次正式包联调尝试失败，记录于 `triad-attempt-1/`：网站真实浏览器登录已完成，随后首个 Electron launch 触发原 30000ms 期限，尚未到 Homer callback/Token 交付或模型请求；包含清理的整段耗时约 159.4 秒。现场负载采样升到约 185.72，AMH 上游计数仍只有原预检 probe=1，Token 未消费。隔离进程复查为 0；不据此认定产品回归，也不声称三方通过。保留原测试期限、断言与输入，待资源窗口复跑；所有购买、生产接入和真实付费调用继续关闭。

第二次尝试在原 5 秒网站健康请求处失败，尚未创建桌面 profile 或发起模型调用；启动前负载约 185.54，证据保存在 `triad-attempt-2/`。两个服务的独立预检均为 200，不能把预检或这两次未完成尝试写成完整联调通过。下一次仍使用原测试，在负载回落且原 5 秒健康请求成功后发起；只调度测试时机，不修改期限、断言或产品。

截至本机 13:08，又完成一次最长 10 分钟的资源窗口检查：仅在一分钟负载小于 35 且原 5 秒网站健康检查成功时才启动同一用例；窗口内未满足条件，调度器以 3 退出，没有发起第三次测试。末段观察到负载约 115–193，最终采样 164.48；`triad-resource-window.json` 保留末次采样。现场还观察到约 10.5 GiB swap 和 10.8 GiB 压缩内存，不能仅凭负载认定产品性能回归。

只读进程归属确认，`roadstar2 game` 的 Node 测试进程工作目录为 `/Users/wolf3c/Project/roadstar`；另一个移动连接聊天也在重跑失败测试。同期 Codex Renderer/Service、WindowServer 同样占用 CPU，无法把全机负载唯一归因到某个聊天。已向用户提供精确聊天入口及暂停重型测试 10 分钟的操作建议，没有停止或向无授权的其他聊天派发任务。没有修改测试超时、断言、产品或系统配置。

三方复验仍未完成。等待可用资源后，使用同一网站包清单、AMH 镜像和 Homer build 127，依次运行 `run-triad.py browser <隔离登录夹具>`、`cadence <成功 profile>`、`audit <成功 profile>`；成功后由 AMH 原生停用同一合成 Token、等待正常缓存失效，再运行 `disabled <成功 profile>` 并核对上游计数不增加。上述 runner 位于证据根；仍需重新核对隔离服务有效期和健康状态。已请求网站先正常停止本轮隔离实例，再协调 AMH 收尾；保留候选、夹具与证据，不新增删除。

隔离收尾已核对：网站 13:09:00、Mongo 13:09:01 正常退出，均为 0、无 OOM；3180 转发与控制器已退出，配置读取次数保留为 19，网站映射 1、订单 0。随后 AMH gateway 13:14:33、假上游与 Redis 13:14:34 均退出 0、无 OOM，3183 已关闭。合成 Token 4 保持启用，余额 100000、已用 0、充值记录 1；上游仍仅原 probe=1，本轮新增模型请求为 0，没有执行停用验证。两方 `stop-completion.json` 分别保存在其本轮证据根，候选、AMH 数据库、fixture 和日志保留；网站 Mongo 的保留缺口见下文。没有执行删除操作或停止其他实例。网站当前并行主干已到 `daa119d22f289db3697464a09f18efa35a344498`，该变化未进入本轮固定候选，不把它冒称已复验输入。

13:35 用户确认 `roadstar2 game` 已暂停并要求继续。负载随后回落到约 4–9，两个入口在原 5 秒期限内均返回 200；Homer main、正式包与原测试未变。恢复时查出网站测试 Mongo 使用 tmpfs，停止后数据库文件实际未保留；AMH 只保留身份哈希，不能反推出原网站 uid。因此本轮明确重建合成网站身份，经原授权接口取得新 Token 5，原 Token 4 与旧证据保持不动，不冒称原网站数据库恢复。测试 Mongo 改为 ignored private 目录持久挂载，并另存本轮合成身份；不改产品。新 Token 经原生接口从零额注入既有 fixture 的 100000，独立引用重放仅一条入账；上游计数仍从 probe=1 继续。候选身份与本轮输入记录于 `resume-1335/input-lock.json`。

第三次原用例在网站登录阶段失败，证据保存在 `triad-attempt-3/`。只读 DOM 和遮盖输入的截图显示密码校验失败，提交按钮未渲染；网站负责人核对新 fixture 密码含连字符，不符合已有至少 8 位字母/数字的规则。该失败不是高负载或定位文案变化，未进入 Homer callback 或模型调用。最小修正由网站仅通过原 Accounts 方法更新同一合成用户的测试密码，保留 uid、Token 5 和额度，不改产品、原测试或超时。

## 最终三方合成结果

同一固定候选在修正合成密码后通过：Homer build 127 / `688443b…`、AMH 最终镜像 `f63443e…`、网站 `56f736…` 加已锁 Homer 覆盖及 `28fe9e…` 包清单。Homer 原 `tests/homer-account-integration.test.mjs` 与执行副本逐字节一致，没有改断言或期限。成功 profile 为 `.codex/scratch/account-mvp/three-projects/20261030/synthetic-YbOEXY/`；本轮命令和结果保存于证据根 `resume-1335/`。

| 检查 | 实际结果 |
| --- | --- |
| 真实浏览器登录、PKCE 自动交付、正常重启、原生本人额度、主 Agent／Worker 文件交付、再次启动恢复 | 原用例 1/1 通过，退出 0，37.00 秒。固定真实 Codex 0.163.0 经实际 AMH 镜像访问脚本假上游。 |
| 配置检查时机 | 退出 0，4.44 秒。启动检查 1 次；仅推进隔离 Electron 的单调时钟跨 1 小时，连续两条用户消息只再检查 1 次，未改操作系统时钟。凭据字节、thread 和历史保持，初始化计数仍为 1。 |
| 凭据持久化 | 停用前、后两次审计均退出 0。文件权限 0600，无旧 deepseek.json；分别扫描 194、3605 个文件，额外包含 Token 的文件为 0，Renderer 状态无 Token。 |
| 原生停用 | 仅对新 Token 5 以原 status_only 接口停用，等待原生 10 秒 mutation fence 自然结束；不直接写 Redis、不全局清缓存。原生拒绝与桌面用例 1/1 通过，退出 0，14.09 秒，原生状态为 401。回复失败可见，无伪成功，用户输入只追加一次，原历史保留。 |
| 停用后上游与余额 | 停用前后计数完全一致：夹具分类 main/max 9、worker/max 3、background/medium 1、原 probe/max 1，均 serviceTier=unset。实际 Worker 角色由运行／交付记录同时证明，不仅依赖夹具分类。新 Token 剩余 98920、已用 1080、合计 100000，有限额度且无 user_quota；原 Token 4 仍为 100000/0、启用。 |

主／Worker 已采用配置均为各自 `baseUrl=http://127.0.0.1:3183/v1`、`model=deepseek-flash`、`effort=max`、`fast=false`；后台记忆的 medium 为此前明确接受的固定引擎行为。`hello.md` 的运行状态 succeeded、结果 accepted、交付 recorded/succeeded，实际文件 SHA-256 为 `20e50d43bbaf788b0f943e5f18a208a158a1fd1c8e82fbcba7316d815137567a`，与数据库一致；重启及拒绝验证后仍保留。

执行入口为证据根 `run-triad.py` 的 `browser`、`cadence`、`audit`、`disabled` 模式，实际 Node 22 命令、用例过滤、退出码和耗时保存于对应 `triad-*-result.json`。`model-file-evidence.json`、`upstream-before-disable.json`／`upstream-after-disable.json` 和 `completion.json` 保存无秘密的复核结果；账号及失败界面截图已实际检查。网站最终 configReads 为 24，订单 0、唯一新映射 Token 5，购买 false、products 空、tokenQuota 未定。

本轮通过的是最终候选的隔离登录／配置／本人额度／模型协议／文件交付／停用闭环。没有新增产品实现；仅修正本轮网站测试密码及设施持久化。购买、真实供应商兼容／性能、生产域名和 TLS 路径、生产账号及上线后的运行情况均未在本轮验证。全仓旧失败和 9 个未结束文件仍按上文保留，不因本轮闭环通过而改为全绿。下一阶段应核对各项目发布所需配置与回退，获准上线后做小范围生产冒烟，不继续重复或扩大本机合成测试。

最终网站、Mongo、代理均已退出 0、无 OOM，3180 关闭，持久 Mongo 文件与身份记录保留。随后 AMH gateway 于 13:57:02、Redis／fake-resume1 于 13:57:03 正常退出 0、无 OOM，3183 关闭，计数和额度状态保持；没有清理、构建、部署、安装或动其他实例。两方最终停止证据分别为网站 `resume1/stop-completion.json` 与 AMH `stop-completion-resume1.json`，两方维护文档均已同步本轮准确通过范围。

## 保全与后续准入

`/Applications/Homer.app` 保留 build 123；原日常 profile、凭据、历史数据库、任务和文件不作为测试输入，不读写真实 Token。本轮未确认全仓测试通过、生产可用或真实供应商兼容/性能。正式安装和上线仍需单独授权。

最终保全核对：HEAD 仍为 `688443b96e90c8935b7dee2088b6b393cdf0156d`；排除本轮两个测试文件和两个说明文档后，无关 tracked diff SHA-256 与起始一致，暂存区仍为空，已安装 App manifest 摘要及正式 ZIP 摘要未变，详见 `preservation-check.json`。本轮诊断遗留的 18 个独立合成进程已发送 SIGTERM，复查该任务证据根下相关 Node/Electron 进程为 0，未向日常 Homer 发出停止信号；未新增清理。

资源窗口结束后再次核对上述保全摘要全部一致，见 `preservation-check-after-window.json`；该次实测可用空间 5663825920 字节（约 5.27 GiB）。这是当时余量，不是本轮清理释放量；本轮没有执行新增删除。

最终续跑保全见 `resume-1335/preservation-final.json`：HEAD、空暂存区、安装 App 和正式 ZIP 摘要均未变。期间他人新增 `docs/PRODUCT.md` dirty；排除此并行新增路径与本轮四个文件后，起始其余 tracked diff 摘要仍完全一致。本轮不修改、接收或回退该并行文档。末次实测可用空间 3862130688 字节（约 3.60 GiB），没有把空间波动写成清理收益。
