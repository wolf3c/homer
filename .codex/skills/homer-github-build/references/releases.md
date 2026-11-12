# Homer GitHub Releases 分发

准备分发、管理版本或获准发布时读取。按本次授权区分本地准备、仅构建、草稿上传与公开发布；下面命令为示例，不整段执行。默认发行路径是云端直接上传草稿，验收通过后公开同一份附件。

## 仓库、版本与文件名

本节及后文的构建、签名和 Release 命令针对桌面发行；移动端只在下方维护下载入口约定，不将桌面版本号、构建矩阵或 Latest 规则套用到移动端。

- 桌面版使用现有公开仓库 `wolf3c/homer` 的 GitHub Releases 分发，官网和 README 只提供下载入口。不新建分发仓库、下载服务、OSS 镜像、跳转接口或版本查询接口，不恢复 `models.super-tree.com` 的 Homer 下载入口；不为分发改变仓库可见性或扩大源码公开范围。以下命令中的 `OWNER/REPO` 均替换为 `wolf3c/homer`。
- 从目标源码提交的根 `package.json.version` 读取产品版本，与打包回执 `version`、安装包内部版本核对。正式标签采用 `vVERSION`；预发布采用如 `v1.2.0-rc.1`，对应产品版本也须一致。构建号是独立字段；正式构建必须以 `--build-number` 明确指定正整数，并事先核对已发行及已安装版本，确保递增。三平台同版使用同一构建号；同一 SHA 重跑保持原构建号，attempt 不是产品版本。候选包继续按提交历史计数。需要改版本时，先在授权范围内更新源码并重新构建、验收，不能只给旧包换标签。
- 同源码仓库发布时，远端标签解析到的实际 commit 必须等于构建 `gitSha`（annotated tag 要解引用到 commit）。创建或推送标签需在授权范围内；缺少标签时停止，不让 `gh release create` 自动从默认分支创建。禁止移动已发布标签或用不同字节覆盖已发布同版本附件；修复使用新版本，保留旧版固定链接供回退。
- 稳定附件名为 `Homer-mac-arm64.zip`、`Homer-mac-x64.zip`、`Homer-windows-x64.exe`；版本位于标签中，不在附件名重复。Mac 更新清单分别为 `RELEASES-darwin-arm64.json`、`RELEASES-darwin-x64.json`，其中 `updateTo.url` 指向同标签、同架构的固定名 ZIP。Windows 原生清单名为 `latest.yml`，指向同标签的 `Homer-windows-x64.exe`，保留真实 SHA-512 和大小。
- 草稿直传由 `scripts/github-release-draft.mjs` 核对原始回执、流式计算包摘要，使用固定名上传原字节，不解包、重打包或修改签名包。平台脱敏清单保留来源与摘要供合并；最终生成 `SHA256SUMS` 和 `release-manifest.json`，记录版本、build、源码 SHA、run / attempt、包名映射、字节数、SHA-256、签名及最低系统。不上传含绝对路径的原始回执、凭据、用户数据或日志。

## 固定下载链接

本节统一维护下载入口，其他文档引用对应小节，不另建分发方案。每次以实际公开的 Release 为准；地址格式本身不能证明附件已发布或可用。

### 桌面端

官网与中英文 README 共用下表。`TAG` 为已发布标签，`ASSET` 必须与附件名大小写和后缀完全一致；URL 路径段按需编码。使用 GitHub 公布的链接，不保存其跳转后的临时存储 URL。

| 用途 | URL 格式 |
| --- | --- |
| 最新正式版页面，用户选择平台 | `https://github.com/wolf3c/homer/releases/latest` |
| 最新正式版 Mac ARM ZIP 直链 | `https://github.com/wolf3c/homer/releases/latest/download/Homer-mac-arm64.zip` |
| 最新正式版 Mac Intel ZIP 直链 | `https://github.com/wolf3c/homer/releases/latest/download/Homer-mac-x64.zip` |
| 最新正式版 Windows NSIS 安装器直链 | `https://github.com/wolf3c/homer/releases/latest/download/Homer-windows-x64.exe` |
| Mac ARM／Intel 原生更新清单 | `https://github.com/wolf3c/homer/releases/latest/download/RELEASES-darwin-arm64.json` ／ `RELEASES-darwin-x64.json`（同目录） |
| Windows 原生更新清单 | `https://github.com/wolf3c/homer/releases/latest/download/latest.yml` |
| 固定版本页面 | `https://github.com/wolf3c/homer/releases/tag/TAG` |
| 固定版本附件，用于验收、复现和回退 | `https://github.com/wolf3c/homer/releases/download/TAG/ASSET` |

Latest 指向最新已验收并设为 Latest 的桌面正式版，不是每次构建，也不按平台分别找最新版。切换前，该 Release 必须包含官网和 README 已提供的全部平台固定名安装包、Mac 两架构原生清单、Windows latest.yml 及摘要／分发清单；缺附件不会自动回退到该平台旧版。此时保持原 Latest，用固定标签测试链接交付，不能混入旧版本冒充齐全。移动版必须明确 `--latest=false`；预发布版同时保持 `prerelease=true`。草稿不能作为公开入口。

采用新来源的桌面客户端直接读取 Latest 原生清单，因此切换同时是自动更新放量，须验证所有启用来源版本的兼容、完整性、适用的签名、安全停止、数据保留及最终 URL 的真实原生升级；缺证据不切换。清单内 ZIP 仍指向同一不可变固定标签，不解析 GitHub 标题／正文，也不新增 API 查询。Windows 未签名正式包同样生成并上传 latest.yml，包内显式关闭 Authenticode 且没有发布者时才允许更新；ready 前和安全停止后的安装前都复核 SHA-512／大小。签名模式继续严格验签，不把摘要称为发布者证明。客户端合同及旧客户端过渡见 [桌面自动更新](../../../../docs/desktop-app-update.md)。

接入范围与顺序：

- 官网 `https://super-tree.com/homer` 沿用现有“下载桌面版”和系统识别，提供手动选择其他平台的入口；macOS 区分 Apple 芯片与 Intel，不能仅凭识别为 macOS 就默认下载 ARM 包。无法确定架构时让用户选择；手机或未知系统保留通用桌面下载入口。
- `README.md`、`README.zh-CN.md` 及官网下载入口固定使用桌面 Latest；详情跳到 Latest 页面，去掉写死的版本/build。保留旧 Latest 时，这些入口继续交付旧版，新测试版只用固定标签链接，不为每版改 README 或官网。
- 首次接入 Latest 入口需获准部署官网一次；之后常规发版仅核验 GitHub，无需交接 Yezi2、复制 feed 或再次部署。只有官网自身确需改动或旧客户端过渡时使用后文交接流程。
- Intel Mac 和 Windows 使用本节列出的固定附件名；Linux 桌面尚未接通，不提供下载链接。既有本地包不能代替最新已审查源码的发行候选。

### 移动端

两个入口共用固定地址：`https://super-tree.com/homer/app`。复用最新官网首页的移动下载区域，不新增页面服务、跳转接口或分发仓库。

| 入口 | 接入约定 |
| --- | --- |
| Homer 官网首页 | 在跨设备区域提供“下载手机 App”，进入该固定区域，分别展示 Android 与 iOS 的安装入口和实际可用状态。 |
| 桌面 Homer「设置 → 移动设备」 | 提供“下载手机 App”按钮及编码同一固定地址的下载二维码。明确标注“下载安装”和“添加设备/扫码配对”，安装 App 后再按现有流程配对；下载码不含配对凭据。 |

固定的是官网地址及下载二维码，页面内的平台链接随正式发行更新：

- Android：使用现有 `wolf3c/homer` Releases 中已发布并验收的正式签名 APK，页面引用固定版本附件地址。移动 Release 使用不与桌面冲突的独立标签并保留移动端版本/build 序列，不覆盖旧附件，不设置为桌面 Latest，也不使用桌面的 `/releases/latest/download/…` 作为 APK 地址。发布时更新官网区域内链接，无需修改已安装桌面端或重新生成下载码；官网更新仍走既有部署流程。
- iOS：指向原 Homer AI 应用的固定 App Store 页面，仅在该页面实际可获取安装包后开放；上传、审核中不等于可下载。Android 与 iOS 独立展示状态，不要求两端同步发版。
- 首次接入前核对真实下载/商店状态；未发布的平台显示“准备中”，不提供失效链接。后续更新保留旧可用入口，待新包校验通过再切换。需验证两个入口定位到同一区域、下载二维码可打开正确页面、Android 下载摘要一致、iOS 指向原应用；不重复 TURN 长测。

执行阶段以用户当前授权为准；准备授权本身不包含上传或发布。Android/iOS 打包、签名、安装与上线复用 [homer-mobile-release](../../homer-mobile-release/SKILL.md)。新版提示行为与验证维护在 [既有实现文档](../../../../docs/mobile-app-update-notice.md)；本流程不新增另一套版本查询、轮询、自动更新或强制升级机制。

## 发布前验收

以下证据齐全才发布；失败、跳过或未运行均记录为未验收，不靠工作流总体绿色替代。

1. **来源与完整性**：所有承诺平台来自同一已审查源码 SHA，分别核对其完整 run ID / attempt 与请求平台集合；同一运行不能混用旧 attempt。包的版本、构建号、来源和哈希符合原始回执。若正式签名 / 公证另行改变了包字节，使用该获准流程产生的最终回执与哈希，并对最终包重新验收，不沿用候选包校验值。
2. **安装与运行**：对本次实际分发的每个平台，在其承诺系统 / 架构上验收首次安装、首次启动、登录、任务、文件与图片、重启、升级后数据保留及卸载行为。媒体、手机通信和系统权限按承诺功能单独选择专项。使用独立测试目录 / 账号，不替换日常 Homer；没有目标环境证据的平台不标记通过。
3. **签名与系统信任**：Mac 正式分发验证 Developer ID、公证、stapling 及真实下载后的 Gatekeeper 路径。Windows 当前按用户选择分发未签名 NSIS，须明确未签名及一次手动安装基线，验收双阶段完整性检查、确认后安装和原数据保留；签名路径继续验证发布者，不可把未签名包称为已签名。
4. **公开内容与附件集合**：公开包不含本机路径配置、凭据或个人数据；第三方许可证 / notices 随包保留。发行说明列出更新、最低系统、架构、安装方法、已知限制及回退版本。固定名附件、`SHA256SUMS` 和分发清单齐全，哈希对应最终字节；单个附件须小于 GitHub 当前的 2 GiB 上限。临时 Actions 产物不是长期用户下载入口。

公开固定标签与切换 Latest 分开判断。Latest 前须按 [桌面自动更新](../../../../docs/desktop-app-update.md#2-接口归属与对齐) 完成已启用平台的原生升级、最终 URL 和来源兼容验收；可先按授权公开并保持旧 Latest，以最终公开地址完成验证。不得先切 Latest 再让正式用户承担首次原生验收。

验收记录保存到正常 `docs/`，记录日期、版本、来源、证据及未覆盖项；操作临时文件留在上述 scratch。公开材料仅保留非敏感字段。

### 每次桌面正式发行的更新说明

每个正式桌面版的 GitHub Release 正文是完整用户更新日志的唯一维护处。发布前对照上一已公开的桌面正式标签与本次发行源码、验收记录，筛选已核实且用户能感知的变化；不把原有能力写成新增，不推断未验证的平台或效果。无法核实的变化不写成事实，明确验收缺口。

正文先写中文「更新说明」，再写对应英文 “What’s new”：优先列 2–4 项实质变化，每项用简短、具体的用户场景标题（可用 emoji）及一小段通俗文字说明能做什么或解决了什么。按实际变化调整数量，不凑条目；不要以内部架构、提交或构建术语作开头。之后分别用中英文写系统要求、安装方式、签名和已知限制，明确旧资料兼容与平台验收边界；保留必要的构建号、源码标识和校验文件信息。技术记录放在用户说明之后。

草稿阶段拟好并核对双语正文，公开前确认它与固定标签、附件、实际验收一致；公开后读取该固定标签 Release，核对正文、状态和附件集合。仅获准构建时只在本地准备，不创建或更新草稿；获准草稿时可更新该草稿。编辑已公开 Release 必须有相应授权。不得因补写说明而更改标签、附件或 Latest。

## 云端直接上传草稿

获准创建草稿及上传后，调用桌面工作流并传 `upload_release_draft=true`（默认）。仅构建时显式设为 `false`，避免将默认值当作额外授权。创建标签属于单独的远端写操作；工作流只接受已经存在且解析到 `expected_sha` 的标签，不自动创建或移动。

1. 规划阶段在安装依赖前校验版本、build、源码 SHA、远端标签及已有草稿的 run / attempt；已公开同标签、旧轮次占用或只有残缺附件而没有来源清单时提前失败，不浪费打包额度。
2. 每个平台在 runner 中按其签名策略构建，直接将安装包、修正过 URL 的原生更新清单及脱敏平台清单上传草稿。三平台完整草稿为 11 个附件；Windows latest.yml 与两份 Mac 清单同样进入摘要和流式下载验证。大包不再存入 Actions artifact；原始小回执保留 1 天。不需要额外 PAT，使用临时 `GITHUB_TOKEN`。
3. 全部构建成功后，`verify-draft` 在云端完整流式下载所有请求平台的附件，对照同一 SHA / run / attempt 的清单校验大小和 SHA-256，生成合并分发清单及 `SHA256SUMS` 并上传、回下载核对。不在本机中转，也不保存第二份大包。
4. 草稿不能公开下载。只为用户指定的平台从草稿下载并做产品验收；通过后补齐发行说明，按授权公开同一 Release，不重新上传安装包。按后文执行固定标签及获准的 Latest 核验；只有官网实际需改动时交接 Yezi2。

同标签工作流排队；失败或缺平台时保留草稿，不自动公开。已有同名附件只有字节数及摘要完全相同才复用，不覆盖或删除。换 SHA、build 或 attempt 不能混入原草稿；先核对已有结果，再按授权处理失败草稿或使用新版本，不能盲目整轮重跑。

## 手工上传备用路径与公开发布

先核对发布授权涵盖的仓库、标签、附件、正式 / 预发布及是否切换 Latest，再操作。确认远端标签已正确存在、该版本尚未发布；若已有草稿，检查其身份、附件和哈希后继续，不重复创建。请求超时或上传失败时先查询状态，只补传明确缺失的附件；不自动重试、不使用 `--clobber`，不删除原附件来绕过冲突。草稿上传不完整时保持草稿并报告，不提前发布。

只有已有包、旧工作流或关闭草稿直传时才使用下面的手工上传备用路径。将已核验原包仅重命名外层文件放入 `.codex/scratch/github-build/releases/TAG/`，准备脱敏分发清单和摘要；禁止解包重打包。示例针对 Mac ARM；实际平台清单以本次请求为准，显式列出文件，不上传整个 scratch。

```sh
gh release create TAG --repo OWNER/REPO --verify-tag --draft --latest=false --title "Homer VERSION" --notes-file .codex/scratch/github-build/releases/TAG/release-notes.md
gh release upload TAG --repo OWNER/REPO .codex/scratch/github-build/releases/TAG/Homer-mac-arm64.zip .codex/scratch/github-build/releases/TAG/SHA256SUMS .codex/scratch/github-build/releases/TAG/release-manifest.json
gh release view TAG --repo OWNER/REPO --json tagName,isDraft,isPrerelease,assets,url
gh release download TAG --repo OWNER/REPO --dir .codex/scratch/github-build/releases/TAG/draft-verification --pattern Homer-mac-arm64.zip --pattern SHA256SUMS --pattern release-manifest.json
```

手工上传须回下载比较字节数及 SHA-256；草稿直传已由 `verify-draft` 完成这一步，无需全平台重复下载到本机。两条路径都要确认附件集合、说明、标签及产品验收记录。发布前保留本次已完整校验的 Release ID / 标签、附件 ID、大小及 SHA-256。另在未登录状态记录原 Latest 的 Release ID / 标签及各附件的同类元数据，作为保留原 Latest 时的比较基线。紧邻发布前复核，发生变化先核对原因。

若原 Latest 不存在，先确认仓库确实公开且可以访问，并从公开版本列表确认没有已发布的正式版，才能记录“无 Latest”；单个 404、鉴权失败、限流或网络错误都不能直接当作该结论。获得本次发布授权且上述验收已通过后，按本次是否切换 Latest 选择命令。下面仅适用于获准切换 Latest 的正式版：

```sh
gh release edit TAG --repo OWNER/REPO --verify-tag --draft=false --prerelease=false --latest
```

正式版保留原 Latest 时使用下面的第一条；预发布（包括首次只有预发布版）使用第二条。只执行符合本次授权的一条，不能沿用切换 Latest 的示例：

```sh
gh release edit TAG --repo OWNER/REPO --verify-tag --draft=false --prerelease=false --latest=false
gh release edit TAG --repo OWNER/REPO --verify-tag --draft=false --prerelease --latest=false
```

已授权整段发布流程时不重复索要同一授权，授权仅到草稿时停在草稿。

## 发布后的分支验收

默认复用同一 Release 在发布前的完整下载校验（云端 `verify-draft` 或手工回下载），发布后按以下步骤做匿名核验。

1. 核对固定标签版本页的公开状态及正式 / 预发布标记。用公开 Release API 核对 Release ID、标签及完整附件集合。逐项比对附件名称、ID、大小和 `digest`，与发布前的基线一致才复用完整 SHA-256 证据。
2. 对每个承诺平台的固定标签直链发匿名 GET，最多请求起始 1 KiB（`Range: bytes=0-1023`，较小附件的末尾按已知大小截断）。跟随 HTTPS 重定向，核对文件名、`206`、`Content-Range` 的起止位置及总大小、实际收到的样本长度。读响应体前确认 `206`，并限制读取大小。服务器忽略 Range 时中止抽查并排查，单凭 HEAD 或跳转不能判定通过。
3. 完整下载并比对 `SHA256SUMS`、`release-manifest.json` 和适用的更新清单，再按下表核验 Latest。

完整校验证据缺失、附件 ID / 大小 / 摘要变化，或公开下载异常需要排查时，按受影响附件补做完整下载并与预期 SHA-256 比对。出现不一致时先定位原因，不能用重算结果覆盖基线。用户明确要求发布后全量复核时按其要求执行。记录发布前的完整 SHA-256 校验和发布后的匿名抽查各自结果。

| 本次发布方式 | Latest 的验收标准 |
| --- | --- |
| 正式版且获准切换 Latest | Latest 的 Release ID / 标签须为本次版本；按本次附件基线比对公开元数据，并匿名抽查各平台 Latest 直链。每条直链须跳转到该附件的固定标签 URL。 |
| 未切换 Latest，且发布前已有 Latest（正式版或预发布均适用） | Latest 的 Release ID / 标签须保持发布前基线；按原 Latest 的附件基线比对公开元数据，并匿名抽查其已有下载入口。每条 Latest 直链须跳转到原附件的固定标签 URL。本次包只通过本次固定标签链接验收和交付。 |
| 首次只有预发布版，发布前已确认无 Latest | 确认本次为已公开预发布、没有正式版，Latest 继续不存在；Latest 页面 / 直链返回 404 属预期，不要求下载成功。本次固定标签直链仍按上文核验，不能把该处 404 豁免应用到本次包。 |

无法取得发布前基线、状态不明确、原 Latest 意外改变，或任何实际附件缺失 / 哈希不符时，保留未验收状态并定位，不通过擅自切换 Latest、重发或覆盖附件来迎合检查。只有本次固定标签下载与所选 Latest 分支都通过，才报告分发验收通过；未切换时明确说明 Latest 仍为旧版，首次只有预发布版时只交付固定标签链接，不宣传“最新版正式下载”。

保留 GitHub 标准下载 URL，不保存跳转后的临时地址或输出鉴权值。在 `docs/` 留下版本、源码与标签映射、附件名 / 哈希、原 Latest 基线（或确认不存在的依据）、本次切换决策、分支验收结果和下载链接。失败时明确区分“Release 已发布”和“分发验收通过”。

发现已发布问题时保留原包和证据，说明受影响版本。需要把 Latest 指回已验收旧版、修改公开说明或撤回发行时，按用户授权执行；不擅自删 Release、删包或移动标签。包字节修复仍走新版本流程。 回指不含 latest.yml 的旧版时，新 Windows 客户端可能无法检查更新，不能宣称已自动降级；按实际附件状态核验，不增加兜底更新地址。

## Yezi2 配置交接与上线核验

常规发版只补齐 Homer 的发行记录并核验 GitHub Latest，不创建 Yezi2 聊天或修改官网。只有官网功能、系统支持／安装提示确需改变，或另获准一次性旧官网 feed 过渡时，才交接以下必要内容：

- 版本、build、标签、源码 SHA，以及本次选择的 Latest 策略。
- 已发布平台的附件名、标准下载 URL、字节数与 SHA-256、最低系统、签名状态和已知限制；未发布的平台不提供下载入口。
- 在发行记录和 Yezi2 交接中写明安装方式及旧资料限制。官网是否展示提示、展示什么文案，以用户对该版本的最新决定为准。
- 仅旧客户端过渡涉及官网 feed：列明原路径、最终清单与固定标签包、启用来源和已完成的原生验收。Mac v0.1.8 及以前仍内置旧官网 URL，新源码不会自动迁移它们；未获授权则保留原 handler／字节，通过手动安装新版过渡。旧未签名 Windows 需手动安装支持更新版本一次，不新增 Windows 官网 feed 或桥接服务。

确需交接且本轮允许创建聊天时，每个新发行版本在 Yezi2 项目新建独立聊天，例如「Homer vVERSION 官网下载接入」，不恢复跨版本旧长聊天。同版本已有目标时复用并记录标识；用户本轮指定目标或禁止新建时以该指令为准。

新聊天只接收本次发行记录路径、上列已核验的发行信息、本轮授权与禁止动作、受影响配置及完成标准，不搬运旧聊天记录或历史授权。产品与配置事实以当前仓库文件为准，发现并行改动先核对归属并保留。主聊天跟进到可审阅改动及下方本地验收结果；需要额外授权时，由主聊天汇总具体范围向用户确认。

既定交接授权仅用于上述实际需要改动的官网范围及本地验收；生产部署、提交推送、旧 feed 切换和 GitHub Latest 变更仍按本轮各自授权处理，不从旧聊天继承。用户明确限制本次不交接或不新建时不创建聊天，也不发送任务。

本地验收完成最小相关检查，在中英文桌面及 390px 视口渲染三平台 Latest 下载、发行详情链接、系统要求及安装提示；无固定版本/build 副本，Mac 架构无法识别时让用户选择。旧 feed 过渡另核对清单、标签、架构及原生升级证据。保留移动端配置和其他任务改动。

已获准部署时，沿用 Yezi2 的发布流程，上线后核验本次接入项：

1. 打开实际线上首页，确认 Latest 链接、详情入口、系统要求和安装提示；不凭初始 HTML 缺少文字判定客户端渲染失败。跟随三平台重定向核对桌面 Latest 的实际附件，不误用移动版。
2. 仅本次获准变更旧 feed 时，匿名请求 `/homer/updates/stable/darwin-{arm64,x64}/RELEASES.json`，核对状态、JSON MIME、原文、版本和同架构固定标签 URL；`200 text/html` 或 SPA 回退不能算通过。
3. 仅旧 feed 过渡检查官网 no-store、缺失 404 和 CDN 传播；GitHub Latest 的常规分发检查复用前文流程，不要求每版更新官网清单。

分别记录 Release 分发、Yezi2 本地配置与验收、网站部署和线上核验的状态。未部署或无法取得生产响应时明确剩余项。

## 官方依据

- [Release 下载链接](https://docs.github.com/en/repositories/releasing-projects-on-github/linking-to-releases)
- [Releases 权限与附件限制](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)
- [创建草稿及验证远端标签](https://cli.github.com/manual/gh_release_create)
- [发布及 Latest / prerelease 标记](https://cli.github.com/manual/gh_release_edit)
- [Latest 排除草稿和预发布版](https://docs.github.com/en/rest/releases/releases#get-the-latest-release)
- [上传及覆盖附件的行为](https://cli.github.com/manual/gh_release_upload)
