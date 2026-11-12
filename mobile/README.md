# Homer App MVP

状态（2026-10-31）：已实施 [WebRTC 直连方案](../docs/architecture/mobile-device-pairing-architecture.md)。iOS／Android 共用原聊天页面；两台真机已通过公网扫码、真实模型聊天、文件上传／系统分享，补验已覆盖图片／HTML 预览、双向停用隔离及 8 MiB 文件往返。单文件仍限 1 字节至 8 MiB，完整覆盖范围和未验项见文末；不代表架构文档第 7 节全部用例均通过。

iOS / Android 共用 Expo + React Native WebView 工程，不维护第二份聊天页面。`build:ui` 使用原 Vite 入口和 `vite-plugin-singlefile` 将脚本、样式、字体内联到本地 HTML；App 不需要本地 HTTP 服务器。一次性邀请仅留在内存，安全存储只保存信令 origin、主端路由标识和设备凭据；手机不保存聊天数据库。

使用 Node 22.22.0：

```sh
# 仓库根目录
npm ci
cd mobile
npm ci
npm run build:ui
npm test
npm run typecheck
npm run bundle
npm run android
# macOS + Xcode + CocoaPods，选择已安装的 iOS Simulator 或已签名设备
npm run ios
```

`android` / `ios` 使用 Expo 自动生成各自原生工程，不维护第二份聊天前端。生成的原生目录与构建结果不提交；发布前仍需配置自己的应用标识、签名和分发渠道。当前技术组合要求 Android SDK 37 和 NDK 27.1.12297006，target SDK 为 37；Android 37 起通过 React Native 的系统权限 API 请求本地网络访问。iOS 依赖 Expo 58 的 Xcode / CocoaPods 环境。`bundle` 只验证 JavaScript / Hermes 包，不生成可安装 APK / IPA。

旧 HTTP 候选依赖的固定 HTTPS Tunnel 与 `mobile.json` 旧 `publicOrigin`／`port` 字段不属于新方案，不应据本文新建公网入口。主端二维码已迁移为共享信令 origin、主端 routeId 与一次性邀请。桌面默认信令为 `https://super-tree.com`，可选 `profile/mobile.json` 只配置 `signalOrigin`。公网信令已随 Yezi2 6.1.35 上线并通过验收，iPhone 实际扫码后已建立业务连接，Android 核心产品闭环已通过，证据及限制见文末。流程为「设置 → 移动设备 → 添加移动设备」，扫码、主端改名确认，再继续原主聊天；主端分别停用、启用或删除设备。

App 外部网页交给系统浏览器；主聊天、受保护成果和预览留在 WebView。文件经现有网页取回后，用 Expo FileSystem / Sharing 打开系统分享页，临时文件在动作结束后清除。首版单文件最多 8 MiB；不转交凭据，不增加原生聊天客户端。相册、定位、麦克风和后台通知均未申请。

当前前置检查（2026-10-29）：新二维码／保存格式／本地导航／分享及本地网络权限校验 5 项通过；本地 HTML 浏览器渲染、Node WebRTC 与浏览器文字及小二进制直连、真实 Yezi2 本地信令协商均通过。主端受信依赖复制已验证包含 `node-datachannel` 的平台二进制。Android 调试 APK 和 iOS 签名 Release 已安装并实际打开本地聊天页面；Android 调试包仍依赖 Metro。Android 已允许本地网络；VPN 排除后重启 App 已取得 Wi-Fi 候选，早先仅主机候选的直连失败，加入 STUN 后，同 Wi-Fi 环境与手机蜂窝网均已通过文字及 16 KiB 二进制往返，选中 UDP `prflx ↔ srflx`，未使用 relay；iPhone 11 Pro（iOS 26.6）的已安装 Release WebView 也已通过文字和 16 KiB 二进制直连，选中 UDP `host ↔ srflx`，无 TURN；该次连接信息通过 USB 临时交换，未经过 Yezi2 信令，VPN 配置未改。这些是真机技术链路测试，App 配对和聊天接线之后，真实 Homer 合成引擎的浏览器闭环已通过；iPhone 后续产品验证见下一段。上述技术通道结果不能替代完整原生业务验收。详细边界和复现命令见架构文档。

业务接线后的 iOS Release 已重新构建、安装并由 devicectl 成功启动；实际安全上下文、RTC API 和上述直连技术通道已验证，调试器已断开。Android arm64 独立 Release 测试包于 2026-10-30 构建成功，包含最新业务接线，无需 Metro；使用生成工程已有的调试密钥签名，尚未安装到手机，不作为正式分发包。原聊天正文／合成回复、附件上传／下载至 WebView 分享桥、刷新恢复和撤销已有真实 Homer 的浏览器闭环证据；iPhone 后续已通过实际扫码、SecureStore 冷启动、前后台恢复及公网信令业务连接。原生附件下载进入了分享处理，但曾因 Expo 异步文件写入缺少等待而失败；补上 await 后，已通过 iPhone 镜像实际点击打开系统分享页并取消返回；手机上传和真实模型后续补验见文末。

本轮主端／移动页面浏览器业务测试 2/2 通过，覆盖聊天与附件，以及实际设置界面的两台设备绑定、改名、停用／恢复和删除隔离。Yezi2 6.1.35 / 6135 已于 2026-10-30 20:01 发布成功，线上源码与统一候选 `e305f3ddd2a1f36c610556f5d4cee8753e4f177c` 一致；Linux native 检查、任务排空、网站浏览器／免费 MCP 两轮验收及公网 WSS 8 项检查均通过。本次完整构建的合成配置／独立空数据库浏览器验证也已通过，统计传输及存储 ACL 使用合成替代，不代表真实存储或统计交付验收。Homer 主端已通过默认 origin 实际连接公网信令并打开移动设备设置页；iPhone 已连接并启动 App；iPhone 实际扫码、手机聊天和生命周期验证已通过；附件系统分享已通过。

复现不依赖 Metro 的本轮 Android arm64 测试包：先执行上文的 `build:ui` 并生成原生工程，再在 `mobile/android` 先运行 `./gradlew :app:createBundleReleaseJsAndAssets --rerun-tasks`，然后运行 `./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a`。本地生成的聊天模块可能未触发增量 JS 打包，验收包应强制刷新该任务并检查 APK 中的实际产物。保持默认 Release lint 和 R8 检查，首次需要下载已声明的 Android 构建依赖；此命令沿用生成工程的测试签名。

2026-10-30 iPhone 启动修复：WKWebView 的 load-end 可能早于网页模块监听器注册，导致首次连接事件丢失。网页注册监听器后发送 ready，App 复用既有连接入口补发；不增加服务或重试计时器。两项回归先失败再通过；`tests/mobile-client.test.mjs` 与 `tests/mobile-request.test.mjs` 共 8 项通过，App 的 5 项测试、App／UI 类型检查通过。修复包通过标准 Expo Hermes 导出后未重新编译原生代码，沿用原测试身份重新签名并安装，无新建签名配置；临时诊断未包含在该包内。iPhone 连续三次冷启动恢复同一设备和历史，不需重扫；用户两次手动发送在主端各执行一次，手机均显示合成回复。当时待验的手机上传及真实模型已在下述补验完成；Android 产品验收仍待完成。

2026-10-30 原生分享补验：Expo 58 `File.write()` 返回 Promise；原先未等待写完就调用 Sharing，实际 iPhone 返回 `ERR_FILE_PERMISSION`。已在写入和临时文件删除处补上 await，回归测试先失败再通过，启动／分享／请求定向测试现为 9/9，App 类型检查通过。不含诊断的修复包已安装；通过 iPhone 镜像真实点击，48 字节合成文本文件打开系统分享面板并取消返回，未发给任何人。另通过镜像输入并提交合成消息，主端只接受一次，手机显示合成回复。镜像需要手机锁屏；当前工具中文输入尚未成功，英文输入与点击已验证。

2026-10-30 重试补验：在同一台 iPhone、同一合成设备停用条件下，旧 `WebView.reload()` 实际复现 `NSURLErrorDomain -1004`。改为用 React key 重新挂载同一本地 HTML，保留原生绑定；修复包在停用条件下重试仍正常加载本地聊天页，重新启用后再点重试恢复同一绑定、历史和输入框。该对照由 iPhone 镜像实际点击完成；未重发聊天消息。此处采用真实原生对照验证，不以浏览器模拟 WKWebView 的加载行为。


2026-10-31 iPhone 补验：使用镜像实际完成系统分享保存、Files 选择器上传，48 字节测试文件在主端逐字节一致。随后用已有 Homer 账号、随包 Codex 0.163.0 和现行桌面启动配置运行实际 CodexEngine；手机两次请求分别通过算式／随机标记检查、上传文件全文／随机标记检查，主端各接受一次、两次原生 turn 正常完成且有用量事件，电脑与手机显示一致。未改产品代码或权限规则、未重新发布；样本和剩余边界见[架构文档的最新补验](../docs/architecture/mobile-device-pairing-architecture.md#iphone-文件上传与真实模型补验2026-10-31)。

2026-10-31 Android 补验：Pixel 8 Pro / Android 17，安装最新 arm64 独立 Release（41,269,295 字节，无需 Metro）。用户扫码后，实际 App 经公网信令直连主端，真实模型三次请求各完成一次：算式回复正确、读取上传的 38 字节文本准确、强制停止并冷启动后仍可回忆文件标记。原媒体接口读回文件逐字节一致；点击下载打开 Android 系统分享页，取消返回，未发送给其他应用。原生 turn／完成／用量事件各 3，无模型错误事件；电脑与手机显示一致。

限制：在系统文件选择器停留数分钟后，首次上传遇到 `mobile_not_connected`；连接自动恢复，点击已有“重试上传”后成功，文件和草稿保留。此结果不代表长时间后台上传连续可用。两台真实 App 的撤销隔离、图片／HTML 成果及其余附件边界尚未覆盖；详细证据见[架构文档的 Android 补验](../docs/architecture/mobile-device-pairing-architecture.md#android-真实聊天与附件补验2026-10-31)。本轮未改产品源码、未提交或发布。


### 扩展真机验收（2026-10-31，以上历史记录以本节为准）

- 预览：iPhone 实际打开正式 PNG 成果及本地 HTML；Android 打开本地 HTML，上传合成 PNG 后显示内联图并可放大，真实模型正确识别左绿、中黄、右蓝。
- 边界：两台手机均完成恰好 8 MiB ZIP 的上传和原生下载／分享，读回大小及 SHA-256 与原文件一致。Android 原生选择器另验证 0 字节、8 MiB + 1 字节均在本地拒绝，1 字节文件上传成功；两台均验证移除已上传草稿附件，两台均验证取消系统选择不产生上传。
- 隔离：主端停用 iPhone 后，Android 仍可上传 8 MiB 并收到真实模型回复；停用 Android 后，iPhone 仍可收到真实回复。被停用端不可发送，重新启用后原绑定恢复；最终两台均启用。

本轮只修正两处：系统选择器返回时若尚未重连，用现有暂停附件草稿保留选件，恢复后由用户点击“重试上传”；主端不再把 node-datachannel 的发送已排队返回值当作错误断线。未增加依赖、服务或离线发送队列。附件／请求／原生壳定向测试 21/21、真实 RTC／通道／撤销 6/6 通过，生产源码及 UI 类型检查通过。仓库级 `npm run typecheck` 仍报既有探针、测试及 NodeNext 导入问题；未宣称全仓检查通过。

当前修复包已安装：Android APK 41,269,423 字节，SHA-256 `f84bd8411434436222af2815ef905d3c95eb3ec7258545c7e8bb8de3b553059e`；iOS 沿用既有签名壳，Hermes bundle SHA-256 `47e2c760f536ac0f2cb7ca74906269237a8f502f8af1287c7a9c55486f925a0d`。仍为测试包。真机删除绑定／重配、超限文件下载、第 7 节其余异常矩阵未据此覆盖；超限分享桥拒绝已有本地测试。未提交、未部署；证据和复现详见架构文档的扩展验收。

提交前复核：共 91 项定向检查通过，覆盖共享 HTTP、设备与附件、实际本地 RTC、隔离 Yezi2 信令、打包和浏览器业务；服务、UI、App 类型检查通过。删除无调用方的处理器注入选项，修正模块导入与原生桥类型声明，未增加产品能力或依赖。全仓类型检查仍受旧探针／测试错误阻塞；本次未重跑真机或部署，具体复核范围见[架构文档](../docs/architecture/mobile-device-pairing-architecture.md#提交前复核2026-10-31)。


### 主工作树合并验证（2026-10-31）

本次将移动端提交 `1b23b77` 合入主工作树 `main`（合并前 `cd7b1a0`）；此前 worktree 的其他祖先提交已在 main。保留主分支现有品牌、输入上下文排序、账号设置及状态发布逻辑。冲突后的接合只补齐既有能力：图片草稿预览复用原作用域校验，以 `media.preview` 经 RTC 传递；移动端构建先调用现有预览脚本生成器；更新已审查的桌面配置兼容指纹，并关闭停止期间响应的 HTTP 保活连接。未新增服务、数据表、依赖或发送队列。

验证基于 Node 22.22.0：仅导出待提交内容的隔离副本完成服务端／UI 构建和类型检查，92/92 项定向检查通过，覆盖共享 HTTP、RTC、信令、运行时封装、浏览器图片草稿恢复及双设备隔离；App 类型检查、原生壳单元检查和当前主工作树全仓类型检查通过。其他未提交改动仍留在工作区，未纳入本次提交。本轮没有重新安装真机包、调用真实模型或部署；历史真机结果不等同于合并后安装包验收。

## 手机新版轻提示

2026-11-12：安卓 App 和官网安卓下载入口的源码改为读取 GitHub 上的 [`mobile/android-releases.json`](android-releases.json)，沿用现有字段校验及提醒规则；更新按钮直接打开已校验的固定标签 APK，由系统浏览器下载、用户确认安装。iOS 继续使用原官网 JSON、StoreKit 条件和 `/homer/app` 更新入口。Android 0.1.1 / build 6 已采用新来源并公开分发，GitHub 清单已上线且匿名完整下载／摘要通过；同签名覆盖安装与 Activity 启动通过。手机真实更新查询和绑定／数据保留仍待验，官网读取代码尚未部署。

源码已接入，详见[方案与实际验证](../docs/mobile-app-update-notice.md)。仅 `com.homer.mobile` 的非开发包且显式 `EXPO_PUBLIC_HOMER_RELEASE_CHANNEL=stable` 才检查；iOS 还须 App Store production 环境与可靠 storefront。QA、TestFlight、未知身份默认禁用。

正式候选后续获准打包时，需在实际 JS／Hermes 打包进程设置该变量（包括 Gradle 打包任务），不能只在 prebuild 时设置。当前不增加默认 stable 值，也不运行安装或发行命令。新增本地 iOS 模块及 `expo-application` 需要后续原生依赖链接与构建；已有安装不能只替换网页来获得这些能力。
