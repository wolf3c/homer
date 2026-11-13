# Homer 桌面 v0.1.14 发行准备

状态：2026-11-13，v0.1.14 / build 299 已公开并设为 Latest。三平台构建、云端完整校验及 Apple 芯片隔离验收通过；固定标签与 Latest 公开下载核验通过；本机安全安装因未结束的待授权工作阻塞，状态见下文。工作区未提交产品改动未纳入候选。

## 来源与边界

- 仓库 `wolf3c/homer`，默认分支与本地分支均为 `main`；核对时远端为 `6da63e4adec9a6dadb6e404c8af347c5574fab8e`，本地产品基线为 `e5ea2e8f53d6d37071f523d88d714f3f6ba94fe6`。远端为本地祖先，本地领先 10 个提交，无分叉。最终构建 SHA 须为获准提交本轮发行元数据后的完整 SHA，推送后回读确认并固定到标签。
- 上一正式桌面版及当前 Latest 为 [v0.1.13](https://github.com/wolf3c/homer/releases/tag/v0.1.13)，Release ID `443142581`，源码 `0184dd81bca18df5f4de7070eefabc0440af9291`，build 298。本机 `/Applications/Homer.app` 封存清单同为 0.1.13 / 298 / 同一来源。
- 已读取现有桌面 Release 的合并或平台清单；最高可核对 build 为 298（包括草稿 0.1.12 / 297、0.1.9 / 294、0.1.5 / 290）。0.1.2 草稿无清单，不将其视为成功发行；保留旧草稿及标签。本轮取下一补丁版本 0.1.14 / build 299；本地与远端 v0.1.14 标签占用须在创建前再次核对。
- 本轮只改根 `package.json`、`package-lock.json` 的产品版本及本记录，不提交其他工作区改动。build 299 通过工作流输入显式传入，不改手机版本号。
- 获准同步时完整推送上述已提交 main 和本轮发行提交，包含既有文档、测试、Skill 和移动端提交；不按目录挑选公开源码。本轮仅构建桌面，不构建或上传 Android / iOS，不部署官网。

## 上版以来的完整发行差异

相对 v0.1.13 源码标签，已提交差异覆盖 42 个文件；产品变化与同期维护如下，不将未提交优化当作已完成能力。

- 原生历史桥支持 WebSocket，沿用历史转换、端点与授权边界，支持 HTTP / SOCKS 代理并保留 HTTP 路径；新增代理依赖已进入根锁文件。离线协议、断连及错误路径回归已随提交存在，本轮准备阶段未执行真实模型专项。
- 引用使用现有组件展示，批注紧邻原文以正文呈现；图片保留紧凑的组件下载入口，移除重复控件；截图绘制使用十字光标；桌面窗口标题统一为「荷马」。
- 同期已提交 iOS Photos 权限与 build 10 送审记录、签名钥匙串防护及测试分类维护。本轮桌面包不等同于手机重新发行。
- v0.1.13 的分发与 Latest 核验记录，以及构建 Skill 的本机空闲安装流程维护。发行说明只描述本次桌面用户实际变化，完整中英文说明以最终 Release 正文为唯一维护处。

## 构建输入

| 项目 | 本轮候选 |
| --- | --- |
| 类型 / 目标 | `desktop` / `desktop-three` |
| 标签 / 产品版本 / build | `v0.1.14` / `0.1.14` / `299` |
| 源码 | 已提交产品基线加仅含本轮三个文件的发行提交；远端完整 SHA 回读后填写 `expected_sha` |
| 上传 | `upload_release_draft=true`；三平台同一 SHA / run / attempt，云端完整下载校验 |
| Apple 芯片 | macOS 27.0+，Developer ID 签名、公证和 stapling |
| Intel Mac | macOS 14.0+，Developer ID 签名、公证和 stapling |
| Windows x64 | Windows 11，未签名 NSIS，保留原生更新清单及摘要复核 |
| 网站 / 网关 | `https://super-tree.com` / `https://models.super-tree.com` |
| 工具链 | 仓库 `.nvmrc` 指定 Node 22.22.0；Codex 0.163.0；现有 Electron 与平台锁定依赖 |

复用 `.github/workflows/homer-build.yml`、同步模板及现有构建入口，不修改构建行为。核对平台归档、哈希与原生辅助程序路径保持既有配置；Intel 显式传 `--minimum-macos 14.0`，ARM 默认 27.0，Windows 显式传 `--unsigned-windows`。双服务地址由工作流显式传入。云端从固定 SHA checkout，不读取本机未提交源码。

## 准备检查

已只读核对远端默认分支、管理员权限、Actions 开启及工作流 active；默认分支含已注册工作流，远端文件解码后与 HEAD、本地工作流及模板逐字一致。正式签名所需 Secret 名称均存在，未读取或输出值；名称存在不等于证书、公证或构建成功。

- `node --test --test-reporter=spec tests/github-build-plan.test.mjs tests/github-release-draft.test.mjs`：29/29 通过，零失败、取消或跳过。仅执行规划、YAML、合成草稿协议及本地 HTTP 流式传输检查；不编译产品、不访问真实发行写接口。
- 断言根版本与锁文件两处版本均为 0.1.14；与 HEAD 的 JSON 差异仅这三个版本字段。工作流仅含手动触发，默认桌面三平台及草稿直传，全部 Actions 固定完整 SHA。
- 工作流、模板、构建/规划/依赖入口、平台依赖锁及上述两份测试均与 HEAD 一致；v0.1.14 本地与远端标签均未占用。
- `git diff --check` 通过。本轮测试 fixture 由测试收尾删除，核对 `.codex/scratch/` 无残留 `release-draft-test-*`；准备阶段未留下安装包、源码副本或后台进程。

这些结果仅为发行准备证据，不替代最终源码 SHA 的产品构建、平台验收或发布后下载核验。

## 验收与发布条件

1. 正式构建前，复核未提交改动边界、提交树和最终远端 main / 标签 SHA。仅提交本轮三个文件，其他未提交工作保留；若 main 被并行任务推进，先核对范围，不静默纳入新提交。
2. 同一运行三平台构建和 `verify-draft` 必须通过，11 个附件齐全，版本/build、完整 SHA、来源标记、双服务地址、签名与摘要符合输入。只下载 Apple 芯片包及小清单；Intel / Windows 大包复用云端完整校验证据。
3. Apple 芯片真实签名、公证、Gatekeeper 及独立合成 profile 产品验收；针对本次变更验证引用、图片和截图交互及离线桥协议。真实账号、付费模型、渠道通信和权限变更不纳入默认验收；未运行项目保持未验证。
4. 验收通过后按 Skill 已有本机安装授权等待日常执行全部完成，安全退出、停机备份、安装同一包并核验原资料；不强停、不丢草稿、不清队列。状态未知或存在无法无损保留的资料时保留包并报告实际阻塞。
5. 发布同一草稿前补齐并回读中英文用户更新说明及原 Latest 附件基线；公开后验收固定标签及所选 Latest 分支，不重传包或移动标签。
6. 本轮不声称完整原生升级、Intel / Windows 实机或生产功能已通过。用户在知悉完整原生升级仍未验收、Latest 同时影响下载与自动更新后，明确指示「通过后公开并直接设为 Latest」；本轮按此决定执行，不将未运行的原生升级或其他平台实机验收改记为通过。

## 授权与收尾

本轮用户明确授权：「确认，提交这三个发行文件、推送 main、创建标签并正式签名公证，继续构建和验收，通过后公开并直接设为 Latest。」按此连续推进，无需再次确认已授权动作；不以工作流绿色代替产品验收或升级证据。其他未提交文件、旧失败草稿、旧标签、手机发行及官网部署均不在本轮修改范围。

准备阶段不安装依赖、不编译产品、不调用真实模型、不操作日常实例。静态检查的临时输出使用 `.codex/scratch/`，完成后按 `work-cleanup` 回收；本记录和版本元数据保留供用户审阅与继续发行。

## 执行记录

- 发行提交 `65125aae77472bd7f99d330ce68261e307d470c4` 仅含本记录及两个根版本文件。远端 main、v0.1.14 标签和目标工作流回读均符合该完整 SHA；此前本地已提交 main 完整同步，未提交产品工作保留。
- [运行 43408212732 / attempt 1](https://github.com/wolf3c/homer/actions/runs/43408212732/attempts/1)，workflow_dispatch，操作者 wolf3c，2026-11-13 18:19:00（Asia/Shanghai）触发，ref v0.1.14；目标 SHA、desktop / desktop-three、build 299、草稿直传均符合本轮输入。未重跑或混合 attempt。
- Mac ARM 正式签名、公证、打包和上传已成功；原始回执版本/build、SHA、preparation=false、publishable=true、双服务地址及 Developer ID / notarized and stapled 标记均通过检查。Intel / Windows 和最终云端 verify-draft 随后全部成功；plan、三平台 build、verify-draft 五个 job 全部 success，来自同一 SHA / run / attempt。Windows 的真实 electron-builder 更新清单契约检查及 Mac 临时签名材料清理步骤均成功。

## 固定源码的本地回归

从最终提交导出独立源码快照，复用项目依赖，不读取工作区未提交产品覆盖。快照目录不会自动采用根 `.nvmrc`，首轮系统 Node 26 的检查不作为最终工具链证据；改用绝对 Node 22.22.0 路径及对应 npm PATH 后完整重跑。

- `npm run build`、`npm run typecheck`：Node 22.22.0 下通过。
- Node 22.22.0 / tsx / VM modules，定向 `native-history-bridge.test.ts`、`electron-shell.test.mjs`、`quote-navigation-ui.test.mjs`、`user-message-bubble-ui.test.mjs`、`test-suites.test.mjs`：465/465 通过，零失败、取消或跳过。原生桥只用合成本地协议，不调用真实模型。
- 图片组件实际浏览器检查 60 项，引用定位 42 项，覆盖 1440 / 390 / 320 宽度。另用当前引用操作验证新增、删除不丢草稿、刷新恢复、编辑批注、发送精确来源及正文呈现，共 24 项通过。已查看合成截图，无横向溢出或未解释的运行时错误。
- 实际图片批注组件验证绘制模式 computed cursor=crosshair、真实鼠标拖拽、Enter 保存备注及合法区域；已查看合成截图。首轮指针早于组件布局完成，按既有浏览器辅助程序等待布局并分段拖拽后通过；未改产品源码。
- 旧 `quote-components.browser.mjs` 的 composer-quote 选择器在上一版已失效；旧 `image-file-annotations.browser.mjs` 在 fixture 的已移除 artifact 接口处失败。这两项保留为未通过，不改断言迎合实现；本轮使用上述当前交互和独立组件检查覆盖实际变更，不声称旧脚本或其全部场景已通过。

尚未执行默认全量测试、真实账号、付费模型、跨渠道通信或完整原生自动升级。上述源码浏览器检查尚须结合实际正式包验收。

## Apple 芯片正式包验收

完整下载 `Homer-mac-arm64.zip`，409875670 字节，SHA-256 `765d8c8b34dcbb36728ca8990c612bfc32c983e419ecc5ee89ce9c79b93b13b5`，与原始回执及平台清单一致。ZIP 内封存清单的版本/build、SHA、正式包标记及双服务地址与回执一致；仅正常解压，未修改 App 或重新打包。

- `codesign --verify --deep --strict`、stapler validate、Gatekeeper 均通过，系统报告 Notarized Developer ID。
- `desktop-update-codesign.test.mjs` 真实验签表达式专项 1/1 通过；正式包双服务地址和批注运行时/许可证定向检查 2/2 通过。
- 基于本次提交 `electron-desktop.test.mjs` 前四项的正式 Electron 隔离验收 4/4 通过，零失败或跳过：发送与正常重启、未连接账号只读、完整进程崩溃后同一会话及精确附件恢复、SILK 预览与访问控制；追加实际窗口标题「荷马」断言。每次正常退出均核对 owner、runtime/gateway 锁及 lease 释放，崩溃恢复未手动删锁。
- 测试使用独立合成 profile，只预置首启导览已读标记；未调用需要回环网站账号服务的 daily 场景，未改签名包、发送真实消息、调用付费模型、注册唤醒或扩大权限。
- 本地与云端网页构建的部分资源文件名/字节不同，因此未复用“本地 UI 等同正式包”的假设；直接用正式包 `homer/dist/web` 重新执行图片 60 项、引用交互 24 项、引用定位 42 项浏览器检查，全部通过，覆盖 1440 / 390 / 320 宽度，并查看合成截图。正式包实际界面验收与源码检查分别记录。

本机自动安装尚待日常执行结束：只读核对日常实际资料根为 `~/Library/Application Support/Homer Desktop`，无 adoption 外部路径；仍存在未结束 Worker、pending_main 授权/问答及运行中消息。已安装的 `upgradeStatus().safe` 明确要求 Worker、执行与 pending_main/pending_user 全部清空，不能把 rpc_wait 当作常驻空闲。未停止日常实例、取消任务、清队列、替换应用或改动资料；保留同一已验证 ZIP 供后续安全安装；完成验收后的解压 App 在下方收尾中回收，需要安装时从该 ZIP 正常解压。

## 完整草稿校验与公开

三平台原始回执、平台与合并清单、全部 11 个附件身份/大小/SHA-256、正式包标记及双服务地址均核对通过。Windows 回执明确未签名，原生 latest.yml 的固定版本 URL、size 和 SHA-512 字段一致；Intel 最低系统为 macOS 14.0。只在本机完整下载 ARM 大包；其余平台完整下载校验证据来自云端 verify-draft。

中英文更新说明在公开前写入并逐字回读一致，完整用户日志只维护于同一 Release 正文。发布前匿名 API 曾限流，等待重置后成功核对原 Latest v0.1.13 / Release ID 443142581 及全部 11 个附件 ID、大小和摘要未变化；没有把限流或 404 当作无 Latest。原基线与 [v0.1.13 发行记录](desktop-release-0.1.13-preparation.md) 中同版表格一致。

公开前再次核对本次草稿 ID、附件身份、不可变标签和原 Latest；随后按本轮明确授权执行 `gh release edit v0.1.14 --repo wolf3c/homer --verify-tag --draft=false --prerelease=false --latest`。没有重传附件、移动标签或部署官网。

[固定版本页面](https://github.com/wolf3c/homer/releases/tag/v0.1.14)，Release ID 444092207，公开时间 `2026-11-13T10:50:06Z`（北京时间 18:50:06），draft=false、prerelease=false。认证与匿名 API 回读 Latest 均为本版；匿名分发核验通过。

| 附件 | ID | 字节数 | SHA-256 |
| --- | ---: | ---: | --- |
| `Homer-mac-arm64.zip` | 743224045 | 409875670 | `765d8c8b34dcbb36728ca8990c612bfc32c983e419ecc5ee89ce9c79b93b13b5` |
| `Homer-mac-x64.zip` | 743245804 | 377890511 | `943d2df988dab520d59f652ce16771f9f4271187b1ed4f91ea3981f88fd47b84` |
| `Homer-windows-x64.exe` | 743270881 | 291073609 | `8c85ea6313ec1ae351d08a85aa01c8576bb6ebcba89ba977eaa724407f05ce59` |
| `latest.yml` | 743271352 | 484 | `c0d9e6da3ffd4599270b44529118041e04fdf6c9849afe34f93f7991c412d98e` |
| `release-manifest-macos-arm64.json` | 743224823 | 977 | `6e4465d099755d4dd511a00a25676a95ba310addd0e4da8d132c4b5272b9ca73` |
| `release-manifest-macos-x64.json` | 743246616 | 963 | `456bc37228cdc5ec064c9adece9104883a2984869bc8c91059a53ad00afab188` |
| `release-manifest-windows-x64.json` | 743271469 | 961 | `8e4f07214b91c2f2fdfa07124ca38810ebeab9f87a0b1493297ad02ba21109a4` |
| `release-manifest.json` | 743273660 | 2643 | `37b6f9f2e62a8238434971a172508153805228e619988d116bba178ae0243eb1` |
| `RELEASES-darwin-arm64.json` | 743224784 | 319 | `4be1495dbc1892970abdc97f91712aed2824b85bd2af580e975ac253861111e4` |
| `RELEASES-darwin-x64.json` | 743246564 | 317 | `bffdb7ad76754f403e477ce0e8d2510843ad99c74ff0e0f046e050b78e8d3c12` |
| `SHA256SUMS` | 743273615 | 519 | `fa23a9ad487623bb8ca6f97ea20ae0055e2cda38bce604b98d83fb5e006863f9` |

## 发布后匿名分发核验

- 固定标签及 Latest 匿名 API 均为 v0.1.14 / Release ID 444092207，draft=false、prerelease=false，中英文正文逐字一致。全部 11 个附件名称、ID、大小和 SHA-256 与公开前基线一致，复用同一运行 verify-draft 的完整下载证据。
- 三平台固定标签和 Latest 大包各匿名 GET 起始 1024 字节，共 6 次均为 206，Content-Range 总大小、样本长度和文件名符合基线；Latest 重定向均经过 v0.1.14 同名固定标签 URL。未保存临时存储 URL 或鉴权值。
- 8 个小附件的固定标签及 Latest 入口全部匿名完整下载，共 16 次大小和 SHA-256 一致，包括 SHA256SUMS、合并/平台清单和三份原生更新清单。
- 官网及 README 的现有 GitHub Latest 入口现已交付本版；本轮未部署或修改官网，也未迁移旧官网 feed 客户端。Intel / Windows 实机和所有平台完整原生自动升级仍未验收；Latest 切换按本轮明确决定执行，没有将该缺口改记为通过。

## 本机安装阻塞与保留材料

公开后再次只读核对：日常仍安装 v0.1.13 / build 298，7 个未结束 Worker 处于 rpc_wait，另有 7 项 pending_main 授权及 1 条运行中会话消息。持续观察过程中已从最初 8 个未结束 Worker 降为 7 个，但尚未满足实际运行代码的安全升级条件；需要日常 Agent 处理待授权工作并结束执行，不能由本发行任务代为批准、取消或清理。

因此本轮本机升级在安全停机前阻塞：未退出/强停日常实例，未清队列、删锁或处理用户草稿，未做停机备份和应用替换，未声称日常数据迁移/保留核验完成。不重复索要安装授权；现有安装授权仍适用于后续空闲后的完整安全流程。

保留 `.codex/scratch/github-build/43408212732/1/Homer-mac-arm64.zip`、ARM 原始小回执、合并清单与 SHA256SUMS，供按同一版本/SHA/run/attempt 安全安装和摘要复核；不重新下载或改包。安装及原资料核验完成、或明确不再需要本机安装时清理这些材料。解压 App、合成 profile、源码快照及已完成检查的中间资料按 work-cleanup 回收，签名包未来可从保留 ZIP 正常解压。

## 本轮收尾

按 work-cleanup 核对本轮 App/浏览器进程及两个任务目录均无打开文件后，实际删除源码快照、合成 profile、解压 App、浏览器 profile、截图、临时脚本、日志及已完成分发的小清单副本，分配块合计约 1056 MiB；不将该值等同于 APFS 可用空间变化。收尾后文件系统可用空间约 24 GiB。

仅保留上述 ARM ZIP、ARM 小回执、合并清单与 SHA256SUMS（约 391 MiB），用途及清理条件见本机安装阻塞段。公开来源、全部附件摘要及验收结论已在本记录、固定 Release 和 Git/Actions 留存。本轮没有停机资料备份，因为安全停机条件尚未满足；没有删除任何日常数据、原安装、其他任务未提交工作、旧标签或草稿。观察到其他任务继续修改 src/service.ts 和 ui/desktop-chat-apps.tsx，均未暂存或纳入本次发行。
