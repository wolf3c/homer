---
name: homer-github-build
description: 准备或执行 Homer 的 GitHub Actions 多平台构建及 GitHub Releases 安装包分发，核对源码、平台适配、产物、版本和下载链接；用于 Mac ARM、Mac Intel、Windows、Linux 的构建或发布流程，不用于普通开发编译或开源许可评估。
---

# Homer GitHub 构建

**当前流程：**桌面发行默认云端构建后直接上传 Release 草稿，云端完整下载校验后再验收、公开，不经本机中转。Mac 使用 Developer ID 签名及公证；Windows 当前未签名且禁用自动更新。

在 Homer 仓库根目录工作。复用[构建准备说明](../../../docs/github-build-preparation.md)、[工作流维护模板](../../../packaging/github/homer-build.yml.template)和[平台规划入口](../../../scripts/github-build-plan.mjs)。`.github/workflows/homer-build.yml` 与模板同步。以 GitHub 与本地共用的 `main` 为源码主线，完整推送已提交内容，不按目录导出白名单或另建公开源码副本。隐私、凭据和内部运营材料保存在 Git 忽略的 `.codex/private/`，公开边界与历史整合记录见 [仓库公开与同步](../../../docs/repository-publication.md)。

## 默认入口与阶段推进

- 单独调用本 Skill 即启动桌面发行流程，主动完成本地准备，不以只读预检或要求用户重新填写惯例参数结束。默认 `kind=desktop`、`target=desktop-three`、草稿直传，仅 Apple 芯片 Mac 做实机验收；沿用已确认的服务地址和系统基线。用户明确要求只读咨询、检查、准备、维护 Skill 或其他构建范围时，以该请求为准，不执行未授权的构建或远端写操作。
- 未指定源码时，以本地最新已提交的 `main` 为候选，核对上版以来的完整发行差异并保留其他任务的未提交工作，不假设其他优化已经完成。没有指定版本时，已有未发行的产品版本优先作为候选，否则从上一桌面正式版推导下一补丁版本；build 核对已发行和可核对的已安装值后，取已核对最大值加一。检查标签占用与版本一致性后更新本地版本元数据和准备记录；存在冲突或缺少关键输入时先完成独立准备，再集中澄清，不猜测。
- 准备完成即给出可审阅的源码差异、版本/build、平台、服务地址、签名、验收范围及检查结果，并一次性确认尚缺授权的执行动作：提交、推送、创建标签、Mac 正式签名、公证、构建、草稿上传及相应验收。默认参数本身不构成这些动作的授权。本轮已明确授权的动作直接连续完成，不再要求用户重复说“开始构建”；不自动监控其他聊天或安排延时构建。
- 满足本轮约定的构建、云端校验与指定平台验收条件后，立即报告结果并推进到下一授权边界；未满足时先报告失败或验收缺口，不提出无条件发布。默认发行流程若尚缺公开发布或 Latest 决策，同次回复中直接提出公开同一草稿及明确 Latest 策略的具体确认，不等用户询问“下一步是什么”；已有授权则继续发布、分发核验及官网交接。用户明确限定仅构建、仅准备或仅到草稿时，交付该范围并说明剩余状态，不扩大任务。官网生产部署和自动更新配置仍按各自授权执行。
- 将请求明确映射为 `kind=source`（源码编译）或 `kind=desktop`（桌面候选包）。源码 `dist/` 不是可安装桌面产品；用户要安装包时不能以源码编译产物替代。
- 平台范围优先沿用用户要求。系统最低版本、安装器格式或签名要求会改变交付而又未知时，先完成可独立进行的准备，再集中澄清。
- 仅构建时显式传 `upload_release_draft=false`。获准准备 Release 草稿或执行发行流程时传 `true`（工作流默认值），包含创建草稿和上传，不等于公开发布。commit、push、创建标签、正式签名、购买资源、公开发布及 Latest 变更仍须在当前授权范围内。

## 核对源码与入口

先核对 `origin` 仓库身份、当前分支、HEAD、工作区未提交改动及已有 `.github/workflows/`，再比较本地与远端主线的领先、落后和分叉情况。构建使用最新已审查的目标提交；有未同步提交时，按当前 commit / push 授权完整同步，随后回读远端 ref 并核对完整 SHA。未提交改动单独报告，保留其他任务的工作。

只读核对远端分支 SHA 与目标提交，并确保工作流固定 checkout 本次提交。记录仓库、ref、完整 SHA、目标平台及构建类型；提交标题或聊天中的“已 push”不能代替远端核对。

按本次目标读取准备说明中的适配表，再核对实际文件，不能把历史缺口当成永久事实：

- 源码编译：`.nvmrc`、根目录与 UI 的 `package.json` / 锁文件、构建脚本及工作流。Node 版本以仓库为准，不在 Skill 写死副本。
- 桌面包：额外检查 `scripts/build-desktop.mjs`、`scripts/prepare-desktop-dependencies.mjs`、`scripts/desktop-runtime.mjs`、`scripts/desktop-source.mjs`、Electron 配置及目标平台资源。核对 Node / Codex 归档、哈希、原生依赖、图片解码、凭据保存和子进程路径。
- Intel Mac：核对最低系统版本和 Swift 编译目标。现有 macOS 27 门槛不能直接用于 Intel；必须确定并验证可用的系统基线。

平台与 runner 只维护在规划入口。桌面支持 `desktop-three`（两个 Mac 与 Windows）或单个平台；Linux 桌面与包含 Linux 的 `all` 在规划阶段失败，不缩减请求或降级为源码编译。源码编译可选择单个平台或 `all`。

若目标平台尚不受支持，给出具体文件、失败路径及所需改动，不删除平台、完整性或权限校验来绕过。仅在用户已授权相应适配时实施；未就绪的平台保留未构建状态。

## 准备或启用工作流

仅首次启用前的准备任务将模板留在 `packaging/github/`，尚不创建 `.github/workflows/homer-build.yml`。工作流已存在时直接维护现有文件，并与模板保持同步。准备任务只做 YAML、路径和 Actions 引用等静态检查，不调用 workflow dispatch、安装依赖或运行可能编译的测试。

获准构建后，优先复用已有工作流。首次启用时，在授权范围内将模板放到 `.github/workflows/homer-build.yml`，并确保规划脚本和目标源码一起上传。没有 commit / push 授权时只准备文件并说明缺项，不擅自上传。

首次启用和每次调用前，只读检查：

1. 确认仓库身份、远端默认分支、Actions 可用及当前身份具有触发权限；不要假定默认分支叫 main。可用 `gh repo view OWNER/REPO --json defaultBranchRef` 查询。
2. 核对 `.github/workflows/homer-build.yml` 已在远端默认分支存在，包含 `workflow_dispatch`，且工作流未被禁用。GitHub 要求默认分支先注册该工作流；仅上传到候选分支不足以首次触发。用 GitHub 文件读取工具或 `gh api --method GET repos/OWNER/REPO/contents/.github/workflows/homer-build.yml -f ref=DEFAULT_BRANCH` 核对，缺失时报告需要上传到默认分支，不盲目 dispatch。
3. 将用户选定 ref 解析为完整 SHA，核对该提交也包含已审查的工作流、规划脚本及构建入口。只有满足这些前提才触发；`expected_sha` 必须传刚核对的完整 SHA。工作流会在规划阶段将它与 `github.sha` 比较，ref 漂移即失败，尚不安装项目依赖。

模板在依赖安装前核对 Node、架构和 Mac SDK，正式构建通过 `--distribution --release-tag TAG --build-number BUILD` 显式指定版本。Mac 签名与公证 Secrets 仅进入临时钥匙串并在结束时清理；Intel 显式设置最低 macOS 14，ARM 为 macOS 27。Windows 当前传 `--unsigned-windows`，不生成自动更新清单。SDK 可编译不等于目标设备验收通过。

桌面构建必须显式同时传入 `--website-origin`、`--gateway-origin`，沿用本次确认的服务地址；缺少任一项应由构建入口拒绝，不省略参数或绕过校验。

工作流保持手动触发、固定源码及 Actions SHA。同标签运行排队，不取消进行中的上传。草稿查询与上传 job 使用临时 `GITHUB_TOKEN` 的 `contents: write`，无需新增长期 Token；不自动公开、切换 Latest 或覆盖附件。构建运行不注入日常账户、生产模型凭据或本机 runtime。

## 执行、跟踪与取回

优先使用可用 GitHub 工具；缺少手动触发、运行跟踪或下载能力时使用已认证的 `gh`，不输出凭据。以下是获准构建后的命令形状，执行时将占位值替换为已核对的参数：

```sh
gh workflow list --repo OWNER/REPO
gh workflow run homer-build.yml --repo OWNER/REPO --ref REVIEWED_REF -f kind=source -f target=windows-x64 -f expected_sha=REVIEWED_FULL_SHA -f upload_release_draft=false
gh workflow run homer-build.yml --repo OWNER/REPO --ref REVIEWED_REF -f kind=desktop -f target=desktop-three -f expected_sha=REVIEWED_FULL_SHA -f release_tag=TAG -f build_number=BUILD -f upload_release_draft=true
gh run list --repo OWNER/REPO --workflow homer-build.yml --event workflow_dispatch --limit 10 --json databaseId,headSha,status,conclusion,url,createdAt,attempt
gh run view RUN_ID --repo OWNER/REPO --attempt ATTEMPT --json headSha,status,conclusion,jobs,url,attempt
gh release download TAG --repo OWNER/REPO --pattern Homer-mac-arm64.zip --pattern release-manifest.json --pattern SHA256SUMS --dir .codex/scratch/github-build/RUN_ID/ATTEMPT
```

两个触发命令是不同请求的示例，只执行符合本次请求的一条。所跟踪运行的 `headSha` 必须等于 `expected_sha`；优先记录 dispatch 返回的运行 URL / ID，再核对工作流、输入目标、触发时间、操作者及 attempt。若需操作者信息，用运行详情 API，不从展示标题猜测。若 ref 漂移、运行 ID 不确定或触发请求结果不明，先核对已有运行，不盲目再次触发。长任务使用有界等待，保持进度更新。

草稿模式先核对远端标签指向本次 SHA，标签须已在授权内创建。构建 job 直接上传固定名安装包、Mac 更新清单和脱敏的平台清单；最终 `verify-draft` job 完整流式下载所有请求平台的附件，比对大小及 SHA-256，再上传 `SHA256SUMS` 和合并的 `release-manifest.json`。它不安装依赖，不在本机或 Actions artifact 重复保存大包。原始构建回执只在 Actions 保存 1 天。

只下载本次获准验收的平台，目录按 run ID / attempt 隔离。验收通过后公开同一草稿，不重新上传安装包。源码编译或 `upload_release_draft=false` 才使用 `gh run download` 取回 Actions 产物，保留期同为 1 天。所有平台须来自同一 SHA / run / attempt，不能从旧轮补齐；Mac `.app` 始终保持在原签名 ZIP 内。

桌面回执中的 `gitSha`、`preparation`、签名类型须符合本次请求；按回执 `artifacts` 中的文件 basename 匹配下载包，比较字节数及 SHA-256，缺包、重名或不一致即失败，不将 runner 的绝对路径当作本地路径。记录运行 URL、源码 SHA、平台、文件名、大小和 SHA-256；非敏感且供后续发布使用的验证结论保存到正常 docs，凭据与原始敏感日志不进入文档。

核对下载 ZIP 内 `Homer.app/Contents/Resources/desktop-manifest.json` 和构建回执 `desktop-build-result.json` 中的 `account.websiteOrigin`、`account.gatewayOrigin`，两处均须与本次确认的构建输入一致；任一缺失或不一致即验收失败，不交付，不能仅凭构建成功判定配置完整。

## 失败处理

先区分依赖安装、源码编译、原生模块、打包、签名和上传阶段，修正本次授权内的问题。草稿已有附件时先检查状态，不能直接靠整轮重跑修复上传。同名且摘要完全相同的附件可复用，不同字节或混合 attempt 会失败并保留草稿；不 `--clobber`、删包或移动标签来绕过。需要清理失败草稿或换版本时，先明确处理范围及授权。

尚未上传草稿附件时，重试采用本次请求的整轮工作流，不采用仅失败 job 或指定 job 重跑，也不自动重试。

源码与工作流未变、原因允许重试时，待运行结束后使用下面的整轮命令。它重用原始 SHA / ref，不传 `--failed`、`--job` 或 `-j`：

```sh
gh run rerun RUN_ID --repo OWNER/REPO
```

触发前记录旧 attempt，触发后确认 attempt 已增加，再跟踪新 attempt 的全部请求平台；不能把重跑启动前仍显示的旧结论当作结果。请求结果不明确时先查询运行状态，不盲目重复提交。只下载新 attempt 的完整产物集合；如果他人做了部分重跑或集合不完整，本轮不验收，定位后按授权范围整轮重跑。

如果修复涉及源码或工作流变更，旧运行的 rerun 不会使用新提交；在具备上传授权并核对新远端 SHA 后重新 dispatch，再完整验收新运行。规划输入错误、平台未适配或 SHA 不匹配时，先解决原因。

不运行真实模型、账户、通信、媒体或发布专项来追求全绿；按项目测试边界单独选择。

## GitHub Releases 分发

准备分发、管理版本或获准发布时，读取 [Releases 分发流程](references/releases.md)。每次桌面正式发布前按该文档准备并核对固定标签 Release 的中英文用户更新说明，发布后回读验证；Release 正文是完整日志的唯一维护处。流程为“云端构建 → 草稿直传及云端完整校验 → 指定平台验收 → 公开同一 Release 并核验分发 → Yezi2 接入手动下载 → 获准部署后核验线上”。不把工作流绿色当作产品验收通过。

桌面下载统一使用现有 `wolf3c/homer` Releases；官网与中英文 README 遵循参考文档中的[下载地址约定](references/releases.md#固定下载链接)，不维护第二套地址表、不新增分发服务。草稿不能作为公开链接，发布并核验后才接入入口。

官网和桌面「设置 → 移动设备」的手机 App 下载入口统一引用[移动端约定](references/releases.md#移动端)。本 Skill 的构建矩阵、版本号和 Latest 执行流程仍针对桌面；Android/iOS 的打包、签名、安装和上线使用 [homer-mobile-release](../homer-mobile-release/SKILL.md)。

发布前记录原 Latest 的身份及附件校验基线，发布后按“切换 Latest / 保留原 Latest / 首次只有预发布版”选择验收分支。本次固定标签链接始终核验本次产物；只有获准切换 Latest 时，才要求 Latest 指向本次版本。发布后默认按[轻量核验](references/releases.md#发布后的分支验收)复用发布前的完整 SHA-256 证据，并匿名抽查公开下载。

桌面正式 Release 公开并通过分发核验后，按既定交接授权自动推进官网手动下载配置及本地验收，无需用户再次提醒。新版本新建 Yezi2 项目交接聊天、同版本复用的路由规则、精简交接内容及授权边界统一见 [Yezi2 配置交接与上线核验](references/releases.md#yezi2-配置交接与上线核验)。

## 完成标准

准备任务交付配置及现有工作流状态、准确的缺口说明与静态检查结果；首次启用前的配置保持未启用。构建任务逐平台报告成功、失败或未运行，并附运行及产物证据；源码编译、安装包生成、签名、安装和功能验收分别标记，不互相替代。

涉及源码同步时，回读确认远端 ref 指向本次目标提交，README、文档及工作流随完整提交同步，并报告尚未提交或未同步的工作。无需按目录或文件重新挑选发布副本。

授权仅到构建时交付 Actions 产物；草稿流程分别报告上传、云端校验和指定平台验收。按上方阶段推进规则交付结果或提出下一阶段的具体确认，不以工作流成功代替验收。不替换日常 Homer 安装。

正式发布任务分别报告 Release 分发核验、Yezi2 本地接入验收、官网上线核验。只有拿到对应证据才标记该项完成。用户明确限制本次不交接时，以本次范围为准。
