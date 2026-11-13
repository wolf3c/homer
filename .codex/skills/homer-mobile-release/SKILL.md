---
name: homer-mobile-release
description: 为 Homer 的 Android APK 和 iOS App 执行打包、签名核验、真机安装、GitHub/App Store 分发及官网下载状态接入；防止混用 QA 签名、应用标识、版本或旧内嵌页面。桌面打包使用 homer-github-build。
---

# Homer 移动端发行

在 `/Users/wolf3c/Project/homer` 工作。先完成用户本次授权的阶段，不把打包、安装、上传、提交审核、正式发布当成同一件事。同一任务内已明确授权的动作继续完成，新任务以本轮授权为准；不让用户重复提供签名位置、包标识或固定地址；仅对确实缺少的授权、破坏数据的迁移或新的实质风险集中询问。

## 固定身份和资料

| 项目 | 既定值／来源 |
| --- | --- |
| 正式 Android / iOS 标识 | `com.homer.mobile`，不换标识解决签名或商店冲突 |
| Android 正式签名 | 见 [Android 流程](references/android.md)，复用原密钥，绝不每次生成 |
| Apple Team / 商店记录 | `FUNQ8PQ8CX` / Homer AI / App Store ID `6830019784`；执行时核对权限和记录 |
| 产品版本 | `mobile/app.json` 与 `mobile/package.json`、锁文件一致；Android `versionCode` 和 iOS `buildNumber` 各自递增 |
| APK / iOS 制品 | `.codex/private/releases/homer-android/<version>-<build>/`、`homer-ios/<version>-<build>/`；先确认 Git 忽略，保留旧包 |
| 官网和二维码 | `https://super-tree.com/homer/app` |
| 安卓发行数据 | Homer `mobile/android-releases.json`，公开读取 `https://raw.githubusercontent.com/wolf3c/homer/main/mobile/android-releases.json`；只维护安卓项，不占用桌面 Latest |
| iOS／旧版过渡数据 | Yezi2 `public/homer/mobile-releases.json`；iOS 维持原路径，安卓项仅保留旧客户端过渡快照，不作为新版安卓来源 |

执行本次平台前只读相应参考：[Android](references/android.md)、[iOS](references/ios.md)。公开字段、状态、缓存和版本判断唯一遵守 [Yezi2 发行合同](../../../../yezi2/docs/homer/2026-11-03-mobile-release-data-contract.md)；GitHub 分发沿用 [既有 Releases 流程的移动端章节](../homer-github-build/references/releases.md#移动端)。跨仓链接要求 Homer、Yezi2 同级检出。

## 每次构建的共同入口

1. 读 `AGENTS.md`、`mobile/README.md`、`mobile/app.json`、锁文件及[更新约定](../../../docs/mobile-app-update-notice.md)，并核对本地既有发行记录（如存在）。核对 Git HEAD、目标路径 diff、既有本地/商店 build；从最大已用 build 递增，不只看可能滞后的 app.json，不套用 Yezi2 或桌面版本。
2. 用户提到其他 chat 的“最新优化”时，先 `read_thread`，再核对实际提交和文件。正式新制品默认从已审查的精确提交冻结；不把整个 dirty 工作区打包，也不偷带未确认改动。若用户明确指定已有的基线加补丁候选，保留该候选 SHA、完整补丁、输入摘要与限制，不伪称纯提交构建。准确提交与候选不一致时先解决来源差异。
3. 使用独立 `.codex/scratch/mobile-release-<日期>/` 工作目录，先核对可用磁盘和已有缓存，不清其他项目或证据。Node 读取 `.nvmrc`；复用当前 SDK、依赖锁和正式签名材料，不顺带升级工具链。不要直接在共享主工作区运行可能清空生成目录的 Expo prebuild。iOS 签名 archive、export 和 upload 统一通过仓库 `scripts/ios-xcodebuild.mjs` 入口；按 [iOS 参考](references/ios.md#锁屏与账号保护) 等待解锁、保持防休眠并在凭据错误后停止，不裸跑这些 `xcodebuild` 操作。
4. 正式包显式设置 `EXPO_PUBLIC_HOMER_RELEASE_CHANNEL=stable` 和 `EXPO_NO_DOTENV=1`，不带 QA 诊断、测试答复、私有环境文件。更新提示还校验正式应用 ID；iOS TestFlight/非 production 商店环境不会提醒，不能为测试绕过。
5. 在候选执行 `npm run build:ui`，使用新生成的 `mobile/.generated/chat.mjs`；不能只改源码或复用旧 Metro/Hermes bundle。许可说明必须随内嵌页面进入包内；保留移除开发调试注入的现有构建步骤。
6. 定向执行移动端 `npm test`、`npm run typecheck`；没有相关协议/RTC 改动，不重复 TURN 长测或真实模型矩阵。`npm run bundle` 只是 JS 验证，不是 APK/IPA。完成平台构建后核对包内版本、签名、内嵌页面来源与最终摘要，不能降低校验取得通过。

## 安装和上线顺序

1. 安装前枚举实际设备、应用标识、已安装版本和证书；仅操作明确目标。签名相同且 build 递增才走覆盖安装。签名不同不能靠 `-r`、`-d`、改包名或重签 debug 绕过；说明数据影响并取得卸载授权。QA 与正式包分别记录，不动 VPN 或日常桌面 Homer。
2. 安装后读回版本、包标识、证书并实际启动，检查首屏；覆盖更新另检查绑定和用户数据保留。仅启动不等于配对/通道或更新提示验收。需要配对时复用现有主端二维码，不新建演示服务。
3. Android 使用现有 `wolf3c/homer` 的独立移动标签、固定版本 APK 附件；不占用桌面 Latest、不覆盖已发布附件。iOS 走原 App Store 应用，上传与审核通过分别记录。
4. APK 的匿名下载、摘要、正式签名及覆盖安装验收通过后，才在授权范围内将 Homer `mobile/android-releases.json` 的安卓项写为 `available`，复用原 schema／字段；不得从文件名猜最低 API、ABI 或签名兼容性。清单提交／推送须有当前授权，源码存在不等于 Raw 地址已上线。iOS 仍只维护原官网 JSON，只有实际可安装后才开放。另一平台不改；上传失败、审核中或没有可用地址，不能写“已发布”。
5. 官网安卓读取代码首次上线需单独获准部署一次，之后常规安卓发版只维护 GitHub 清单，不逐版交接 Yezi2 或部署官网。仅当官网代码、iOS 配置或旧版过渡实际需改动时，沿 Yezi2 原发布流程处理并排除并行改动；部署使用其 `yezi2-mup-deploy` skill，不覆写容器或新建代理／Worker。新安卓 App 更新按钮直接打开校验后的 APK；iOS 更新按钮、官网入口和下载二维码保持 `/homer/app`。
6. 最终匿名检查各自 HTTPS JSON 的原文、字段／版本、MIME、缓存及官网下载行为。安卓另核验 GitHub Raw 的跨域及缓存传播，不能套用官网头或承诺固定撤回时限；iOS 原缓存要求不变。HTTP 200 必须真正解析 JSON，不能把 SPA HTML 当清单。失败保留上一已验收版本，未完成首发保持 `coming_soon`；新安卓读取失败不回退旧官网记录。不恢复 `models.super-tree.com` 下载。

## Yezi2 配置交接与收尾

安装入口达到上述可用条件后，在既有发行记录中保留核验依据；安卓清单本身维护在 Homer，只有官网实际需改动时才整理 Yezi2 交接：

- 平台、产品版本、Android `versionCode`／iOS `buildNumber`、源码 SHA 和实际分发状态。
- Android 固定标签 APK 地址、最终 SHA-256、最低 API 和 ABI；iOS 原应用商店地址、实际可获取版本、最低系统及已核验地区。字段和 `available` 条件以 Yezi2 发行合同为准；商店上传或审核中不能作为可获取证据。
- 安卓记录只写 Homer `mobile/android-releases.json`，iOS 继续写 Yezi2 原 JSON。旧官网安卓记录保留供旧安装过渡，不每版同步；确需引导旧客户端升级时另按当前授权修改。交接记录只保存依据，不维护第二份可变安卓配置。

官网确需改动且用户指定 Yezi2 chat 时，先读取其最新进展再在消息授权范围内交接；不因安卓发版自动复用历史长 chat、发送消息或新建聊天，也不重复修改其文件或另行部署。配置和部署沿用已有授权及 Yezi2 发布流程，缺少授权时先准备具体交接材料并说明缺口，不将 App 分发授权扩大为网站部署授权。

按“安装和上线顺序”第 4–6 项完成配置与线上核验，分别记录 Android 和 iOS 的状态；本地 JSON、测试通过或部署命令成功都不能代替生产响应及页面实际显示。用户只授权打包、上传或部分平台时，在该范围完成后交代剩余接入事项，不自动增加其他平台、原生或真实模型验收。

最终分别报告“安装包／商店分发”“Yezi2 配置”“官网部署与线上核验”的完成状态和阻塞项。只有线上 JSON 与固定下载区域核验完成，才标记官网接入完成；另一平台未发布不妨碍已验收平台独立上线。

## 发布与回退边界

- GitHub 公共仓库的安装包发布不授权上传内部源码历史、运维文档、密钥或完整 verification 文件。先核对远端标签和目标；分发仓库的标签提交与实际应用源码 SHA 分开记录。发行附件只使用经过核验的说明、APK 和摘要，公开安卓清单不含私有字段；Git 源码同步仍遵守项目 AGENTS.md 及本轮授权，具体分发复用已有 Releases 流程。
- 密钥/密码/描述文件仅保存在原私有位置；不写 skill、源码、命令参数、日志或公开清单。不要把 Android keystore、Apple certificate/profile 当作可重新生成的缓存。
- 失败先确认失败阶段和远端是否已有结果；不盲目重复上传、覆盖附件或重复提交审核。网络恢复后先查现状再补缺失项。发现错误包保留证据，移动端修复发更高 build，不能靠自动卸载或降级恢复。
- 交付只报告实际完成的层次：源码与检查、签名制品、真机安装、公开下载、官网状态、App Store 审核/可获取。把非敏感版本/摘要/源码映射和限制更新到既有发行记录；私有原始材料留在 ignored 目录。
