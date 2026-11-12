# GitHub 多平台构建准备

## 当前流程（2026-11-12 复核）

本轮桌面 `v0.1.8` / build `293` 已完成三平台构建、云端完整校验及正式公开分发核验，Latest 已从 v0.1.7 切到本版；Apple 芯片 Mac 的签名与隔离合成验收通过，Intel / Windows 未实机验收。源码、运行、包摘要、官网交接状态及完整验收边界见 [v0.1.8 发行记录](desktop-release-0.1.8-preparation.md)。官网部署尚未执行。以下 v0.1.2 段落及后续历史准备记录不构成本轮授权。

2026-11-12 后续源码调整：Mac／Windows 原生清单、官网下载及 README 入口直接使用 GitHub Latest。Windows 未签名正式包同样封存 app-update.yml、产出并上传 latest.yml，后台下载后确认安装；ready 前和安装前复核大小／SHA-512，签名模式仍验签。三平台完整草稿为 11 个附件。尚未构建、原生验收或部署，不改变上述 v0.1.8 的发行事实；旧 Windows 用户需手动安装支持版本一次。常规发版不再复制官网清单或逐版交接 Yezi2；首次上线新入口仍需获准部署一次，旧 Mac 客户端按 [旧客户端过渡](desktop-app-update.md#旧客户端过渡) 处理。

历史 v0.1.2（build 287）的准备与后续失败记录见 [0.1.2 构建准备](desktop-release-0.1.2-preparation.md)，不作为当前发行状态或执行条件。现行默认入口、阶段确认及必要时的官网交接统一见 [homer-github-build](../.codex/skills/homer-github-build/SKILL.md)。

`desktop-three` 构建 Apple 芯片 Mac、Intel Mac 和 Windows x64，系统要求分别为 macOS 27、macOS 14 和 Windows 11。Mac 使用 Developer ID 签名、公证及临时钥匙串；Windows 使用未签名 NSIS，`--unsigned-windows` 仅控制签名，不再关闭更新。版本由 `release_tag` 对齐 `package.json.version`，三平台共用显式 `build_number`，构建提交固定为 `expected_sha`。平台和 runner 以 `scripts/github-build-plan.mjs` 为准。

维护源是 `packaging/github/homer-build.yml.template`，与同一仓库中的 `.github/workflows/homer-build.yml` 保持同步。本地与 GitHub 共用 `main`，完整推送已提交文件，直接从目标提交构建；不再维护目录白名单或独立公开文件树。隐私、凭据和内部运营材料位于 Git 忽略的 `.codex/private/`。公开边界及历史整合见[仓库公开与同步](repository-publication.md)。模板默认 `upload_release_draft=true`：

- 已存在的版本标签必须解析到本次源码 SHA；不自动创建或移动标签。旧轮次草稿冲突或残缺上传在依赖安装前失败，避免重复打包消耗额度。
- 构建后直接上传固定名安装包、两份 Mac 更新清单、Windows latest.yml 和脱敏平台清单到草稿。安装包字节保持不变；不将大包重复存入 Actions artifact，原始小回执只保留 1 天。
- `verify-draft` 在全部请求平台构建成功后，在云端完整流式下载并校验大小和 SHA-256，再上传 `SHA256SUMS` 和合并的 `release-manifest.json`。同一发行不混合 SHA / run / attempt，不覆盖同名不同字节的附件。
- 只下载本次需要产品验收的平台。验收通过并获准公开后，发布同一草稿，无需重新上传。按 [Releases 分发流程](../.codex/skills/homer-github-build/references/releases.md) 核验固定标签；切换 Latest 还须完成启用平台的原生升级、签名、安全停止及兼容验收，并获得对应授权。保持旧 Latest 时官网及新客户端继续使用旧版，只有官网实际需改动时才交接。

仅构建时显式设置 `upload_release_draft=false`，包保存在 Actions artifact 1 天；源码编译仍走 artifact。默认输入不构成用户上传或发布授权。工作流只手动触发，同标签排队，草稿操作使用临时 `GITHUB_TOKEN` 的 `contents: write`；不自动公开、改 Latest 或删除旧包，不使用额外长期 Token。

草稿直传及云端完整校验已在本版三平台运行中通过，证据见上方 v0.1.8 发行记录；离线协议检查入口仍为 `node --test tests/github-build-plan.test.mjs tests/github-release-draft.test.mjs`，不替代云端或目标设备验收。

以下为最初准备及 TURN 整合的历史记录，涉及平台、权限、产物保留期和分发顺序的旧描述不再作为当前操作指令。

## 历史准备记录

状态：2026-11-03，仅准备，尚未启用或执行本 GitHub 工作流；构建须由用户明确授权。

复用入口：项目 Skill [`homer-github-build`](../.codex/skills/homer-github-build/SKILL.md)。以后可用 `$homer-github-build` 指定准备、源码编译或桌面安装包构建；明确要求开始构建前仍只做准备。

## 当前交付

`packaging/github/homer-build.yml.template` 是未启用的工作流模板，不在 `.github/workflows/` 中，GitHub 不会把它识别为工作流。即使后续上传源码，也不会触发该模板。

模板支持两种明确分开的请求：`kind=source` 使用现有 `npm run build`，保存源码编译的 `dist/`，不能当作桌面 App；`kind=desktop` 接入现有 Mac ARM 打包入口，产生 ad-hoc 签名的候选 ZIP 和构建回执，不做 Developer ID 签名或公证。

每次必须传 `target` 和已审查的 `expected_sha`。`scripts/github-build-plan.mjs` 是平台与 runner 的唯一配置源；规划 job 在依赖安装前验证完整 SHA、阻止 ref 漂移、生成仅含请求平台的矩阵。只有明确选择 `target=all` 才请求全部平台；桌面 `all` 因包含未适配平台而整体失败，不悄悄缩减范围。下表为当前配置说明，变更以规划入口为准。

| 目标 | 源码编译 runner | 桌面打包 |
| --- | --- | --- |
| macOS ARM64 | `macos-26` | 使用 `xcode-27`；依赖安装前检查 SDK 27，配置已接通但未实际构建。 |
| macOS Intel x64 | `macos-26-intel` | 未适配，在规划阶段报错。 |
| Windows x64 | `windows-2022` | 未适配，在规划阶段报错。 |
| Linux x64 | `ubuntu-22.04` | 未适配，在规划阶段报错。 |

源码编译四个平台均未运行；Windows Server 构建不代替 Windows 11 桌面验收，Linux 仅覆盖所列基线。Mac SDK 能编译不等于 runner 的系统能运行 App；当前候选包最低运行系统仍为 macOS 27。

构建 job 的 checkout 设置 `fetch-depth: 0`，规划 job 保留默认浅克隆。桌面入口使用 `git rev-list --count` 生成构建号，需要完整提交历史；源码编译与桌面打包共用这一构建 checkout。

Mac ARM 桌面 job 在干净 checkout 执行 `npm ci` 后，调用 `node scripts/build-desktop.mjs --source-sha SHA --maintenance REPOSITORY_ROOT --scratch REPOSITORY_ROOT/.codex/scratch/github-build/desktop --website-origin https://super-tree.com --gateway-origin https://models.super-tree.com`。现有入口负责源码冻结、上游依赖完整性校验和 `.app` 签名；不采用本地未提交覆盖或发布模式。工作流分别上传实际 ZIP 和 `desktop-build-result.json`，下载后按回执核对源码、大小和 SHA-256。

使用现有 Node/npm 和构建入口，不新增依赖。官方 Actions 固定完整提交 SHA。未来启用后也仅允许手动触发，无 push、PR、tag 或定时触发，无 Release 发布或正式签名步骤，仓库权限仅 `contents: read`。产物含目标平台、源码 SHA 和 attempt，保留 7 天，不上传整份工作区、凭据或本地运行数据。

## 桌面安装包接入前的缺口

当前源码与构建入口仍以 macOS ARM64 为准。用户已确认本次只完善构建流程：接通 Mac ARM，其他桌面平台明确阻止，不扩展为运行时移植。下列模块已有其他优化工作的改动，本次不改动这些文件。

| 范围 | 现有约束 | 后续必须完成的工作 |
| --- | --- | --- |
| `scripts/build-desktop.mjs` | 平台与架构限制；Swift ARM64 / macOS 27 编译目标；固定工具路径。 | 按目标选择构建路径和编译目标，保留来源、哈希及隔离目录校验。 |
| `scripts/prepare-desktop-dependencies.mjs`、`packaging/macos/dependencies-lock.json` | Node / Codex 归档及校验值固定为 Darwin ARM64。 | 分别核对目标平台实际可用的上游归档、许可证和完整性；未核对不能共用旧哈希或删除校验。 |
| `packaging/electron/forge.config.mjs`、`scripts/desktop-icon.mjs` | `.app` 布局、macOS 签名、公证、ZIP 和图标流程。 | 为目标平台安排资源布局、图标和安装器；正式签名另行配置。 |
| `packaging/electron/main.mjs`、`scripts/desktop-runtime.mjs` | 拒绝非 macOS / 非 ARM64；固定 Node、Codex、系统工具路径与启动环境。 | 适配目标路径、`.exe`、子进程生命周期和菜单，保留权限边界与退出确认。 |
| `src/desktop-resources.ts`、`src/media-decode.ts`、`packaging/macos/ImageDecoder.swift` | 资源验证依赖 `.app`，图片解码依赖 ImageIO。 | 接入对应平台图片处理，保留尺寸、内容和资源完整性约束。 |
| `src/channels/telegram-secrets.ts`、`src/channels/wechat-secrets.ts` | 依赖 macOS 系统钥匙串。 | 明确其他平台的凭据保存方式，不能用明文回退冒充等价支持。 |
| `src/config.ts` 及相关主机/进程模块 | 默认数据目录和系统操作尚未完成 Windows / Linux 验收。 | 核对目录、文件权限、Shell、进程终止和系统权限路径。 |
| `package.json`、锁文件及相关测试 | 包含原生依赖，例如 `node-datachannel`。 | 逐目标核对预构建或编译条件及 Node ABI；新增专项登记到 `scripts/test.mjs`，维护测试文档。 |

Intel 版必须调整当前 `LSMinimumSystemVersion: 27.0`、Swift 编译目标和运行时门槛，并在选定最低系统上验证。Apple 已说明 Tahoe 26 是最后支持 Intel Mac 的主要版本；不能仅修改架构参数。

## 首次启用及用户通知开始构建后的顺序

1. 重新核对优化工作的完成状态、本地改动与 GitHub 源码差异。由已审查的目标提交构建，不沿用本次准备时的旧快照。
2. 仅核对请求范围内的平台准备情况、runner 可用性、Actions 固定版本及 Node 版本。未适配桌面平台直接阻止，不要求先完成所有平台才允许源码编译或 Mac ARM 打包。
3. 在用户授权的上传范围内，将模板放到 `.github/workflows/homer-build.yml`，同时上传规划脚本。查询远端默认分支并确认该路径已在默认分支注册、包含 `workflow_dispatch`、工作流未禁用；所选 ref 也须包含对应工作流和脚本。仅存在于候选分支不足以首次手动触发。缺少上传授权或文件时保留阻塞，不擅自 commit / push。
4. 解析所选 ref 的完整提交，传 `kind`、`target`、`expected_sha` 手动触发，跟踪确切的 run ID / attempt，核对 `headSha`。规划失败不能重发碰碰运气；先解决版本或平台原因。依赖安装本身可能编译原生模块，也属于当前禁止执行的构建工作。对后续失败定位修复，不删除真实断言或降级为跳过。
5. 在对应桌面系统验收首次安装、登录、任务、文件与图片、重启及数据保留；手机通信、媒体和系统权限按承诺功能专项验收。
6. 正式签名、付费资源、提交/push 和 Releases 发布分别按届时授权处理；“可以构建”不自动等于“可以发布”。

本次不调用 `npm ci`、构建脚本、带编译副作用的测试、GitHub workflow dispatch、签名或发布。没有创建延时构建或自动启动任务。

## 重试与产物集合

采用整轮重跑，不采用仅失败 job 或指定 job 重跑。源码和工作流未变时，运行结束后使用 `gh run rerun RUN_ID --repo OWNER/REPO`，不传 `--failed` 或 `--job`；确认 attempt 已增加后，按该 attempt 跟踪全部请求平台。源码或工作流修改后，旧运行重跑仍使用旧 SHA，须在上传授权范围内发布修复提交并核对新 SHA，再以原 `kind` / `target`、新的 `expected_sha` 发起新运行。

每轮只收集同一 run ID / attempt 的产物，要求所有请求平台的 job 在该 attempt 完成、产物齐全，并按桌面回执核对哈希；不从旧 attempt 补齐。如果外部做过部分重跑，不把其结果当作整轮验收。失败请求先核对状态与原因，不盲目重发、不自动重试。正式签名及发布授权边界不变。

## GitHub Releases 分发准备

分发操作按 Skill 的 [Releases 分发流程](../.codex/skills/homer-github-build/references/releases.md) 执行，集中维护版本与标签、固定文件名和下载链接、发布前验收、草稿上传、Latest 切换及发布后核验。只有验收通过并获准发布的安装包才进入该流程；当前 ad-hoc Mac ARM 候选包尚不具备正式公证分发的验收证据。

2026-11-03 已统一桌面下载约定：官网与中英文 README 提供入口，安装包放在现有 `wolf3c/homer` 的 GitHub Releases。具体地址、系统与架构选择、附件命名、Latest 切换和核验顺序只维护在[固定下载链接及发行流程](../.codex/skills/homer-github-build/references/releases.md#固定下载链接)，本页不重复建表或描述操作顺序。

移动端的官网首页入口与桌面「设置 → 移动设备」下载入口共用[移动端固定地址约定](../.codex/skills/homer-github-build/references/releases.md#移动端)。页面内的 Android 安装包与 iOS 商店链接各按实际发行更新，不占用桌面 Latest，不新增分发服务；这不扩展当前桌面构建矩阵。移动端新版提示不属于本流程。

此前 TURN 工作的本地签名包继续保留，但不是本次最新跨平台发行候选。当前仍等待用户确认优化完成并明确通知开始构建；本次只更新现有 docs 与 Skill，不修改官网、README 下载入口或启用工作流，也不构建、上传或发布。

本次仅补充分发指引，没有增加发布工作流或写权限，没有修改产品版本、创建标签、远端草稿或 Release，也没有上传附件。以后明确要求构建仍只授权构建，分发动作按届时用户授权执行。

## 核验范围与依据

本次仅执行不导入产品或编译工具的规划测试，以及模板 YAML、触发条件、任务依赖、固定 Actions 引用、只读权限、上传路径及文档引用的静态检查。规划测试命令为 `node --test tests/github-build-plan.test.mjs`。没有安装依赖、产生产品构建产物或验证跨平台功能。启用后仍需 GitHub 实际解析、工具链和打包运行验证。

- [GitHub runner 与架构](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
- [工作流路径、手动触发与语法](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)
- [Apple 对 Intel Mac 的支持说明](https://developer.apple.com/videos/play/wwdc2025/102/)


## TURN 发行候选收尾（2026-11-03）

以 `14cc013b6d138ff3f2fe96833d2d9e5326a70e20` 的最新 main 为基线，合并原 detached 候选 `c77dedcbdd0043d9bc4e16efeda76083c0abfc27` 的五项提交：`b57aa60`（TURN 与账号接线）、`a35ace2` / `7fd9104` / `9ab5176`（macOS 签名）、`c77dedc`（移动端内嵌许可）。合并保留两侧历史，旧制品来源提交仍可从 Git 查询；不再以旧 candidate worktree 作为后续构建入口。

冲突按最新 main 的网站授权边界解决：不恢复手工 Token、旧 DeepSeek 启动入口或已删除脚本；标准桌面入口在网站模型和 Codex 模型下均可把已应用账号交给 TURN owner，网站模型凭据不会传给 Codex 引擎。保持现有重启应用、缓存、刷新和重连机制，保留显式 native 回退启动行为、移动更新提示、下载二维码及构建来源校验。

版本元数据归入主线：产品与移动端 `0.1.1`，Android `versionCode=4` 对齐已经发行的 APK，iOS `buildNumber=3`；没有因此重新构建、签名或发布。后续发行仍须各端独立递增。旧 Android build 4 的精确输入仍为 `a3b8059` 加其制品旁记录的覆盖，不能倒推为本次合并提交构建。

本地验证（Node 22.22.0，独立源码 worktree，复用已安装依赖，无依赖升级）：

- TURN、账号接线、手机协议及设备 UI：264 项通过。命令：`node --experimental-vm-modules --import tsx --test --test-concurrency=1 tests/mobile-turn.test.ts tests/mobile-turn-lifecycle.test.mjs tests/mobile-turn-build.test.mjs tests/electron-shell.test.mjs tests/mobile-client.test.mjs tests/mobile-devices-ui.test.mjs`。
- `tests/electron-package.development.test.mjs` 与 `tests/mobile-ui-build.test.mjs`：5 项通过，2 项需要现有安装包的检查未运行；内嵌页面实际浏览器测试含更新提示和完整许可说明，不生成 APK/IPA/桌面安装包。
- `HOMER_YEZI2_ROOT=/Users/wolf3c/Project/yezi2 node --import tsx --test tests/mobile-turn-rtc.integration.mjs`：5 项本地合成联调通过，信令及签发 fixture 仅回环监听；不是公网 TURN 验收，也不调用模型。
- `node --test mobile/*.test.mjs`：31 项通过；`tsc --noEmit -p tsconfig.json` 和 `tsc --noEmit -p ui/tsconfig.json` 通过。

收尾只处理上述候选增量。共享工作区其余修改继续保留为未提交状态，不纳入合并。旧 worktree 中的本地签名制品、原生工程及截图合成资料移至 Git 忽略的 `.codex/private/turn-candidate-retained-20261103/`，只停止该目录的历史截图合成服务，不操作日常 Homer。根目录 `.codex/private/releases/` 下已发行 APK 保持原位。清理后的路径对应关系在保留目录的 `retention.json` 中记录。

2026-11-06 清理保留的 Android 工程内可重建 `.gradle` 项目缓存；APK、ProGuard 映射和原生调试符号的 SHA-256 在清理前后均一致。独立生成的 `index.android.bundle` 与保留 APK 的 `assets/index.android.bundle` 逐字节一致，已删除独立副本；需要时可从 APK 提取内容，sourcemap 仍保留，文件系统扩展属性未验证可恢复。

同日清理该保留目录中 `formal-macos-5` 的 Swift 模块缓存及 `formal-macos-4/5` 的 Node 编译缓存；其他构建材料与正式发行制品保留。

没有重跑公网长测、完整全量回归、安装包签名/公证或真机覆盖升级；没有 push、修改官网入口、恢复上线或提交 App Store 审核。源码整合完成不等于新制品已经发行。
