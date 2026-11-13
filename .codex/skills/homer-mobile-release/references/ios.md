# iOS App Store

保持 `com.homer.mobile`、Team `FUNQ8PQ8CX`、商店名 Homer AI、App Store ID `6830019784`。开发证书、设备 QA 或 archive 成功都不能替代 Apple Distribution 与 App Store 状态核验。不临时换 Team 或包名。设备范围遵守 `mobile/app.json` 和最新用户决定：2026-11-04 已明确先仅支持 iPhone（`supportsTablet: false`）；恢复 iPad 支持须另行确认并完成对应验收。

## 先核对既有材料

- 来源与版本遵守主 skill；读取 `mobile/app.json` 的 `ios.buildNumber`，同时核对本地 IPA/archive 和 App Store Connect 已上传 build，递增 iOS 自己的序列。
- 使用现有 Apple 登录/Keychain、项目 Team 的证书和描述文件。凭据、证书、profile 不进入源码、公开清单或聊天。缺少权限时只停对应操作，先完成其他准备。
- 最近期成功 archive/export 及 `ExportOptions.plist` 保存在 `.codex/private/releases/homer-ios/<version>-<build>/`；导出采用 `method=app-store-connect`、`teamID=FUNQ8PQ8CX`，执行前核对，不照搬旧版本路径或 App 记录。
- 审核资料先核对 [移动端说明](../../../../mobile/README.md)及其中隐私/支持入口；若本地存在 `docs/ios-app-store-preparation.md`，仅作为内部提审记录核对，不将其中历史状态当作当前商店状态，不另写第二套协议。隐私和支持使用 Homer 官网，不能恢复 AMH 下载地址。

## 构建与签名

在独立候选先重建移动页面并完成定向检查；显式设置 `EXPO_PUBLIC_HOMER_RELEASE_CHANNEL=stable`、`EXPO_NO_DOTENV=1`。使用当前 Expo/Xcode/CocoaPods 链生成并安装现有锁定依赖，不为截图自动下载模拟器或升级 SDK。

### 锁屏与账号保护

签名 archive、export（包括 destination=upload）统一使用 `scripts/ios-xcodebuild.mjs`，保持已有用户 HOME、Xcode 账号和钥匙串。该入口先启动 `caffeinate -di`，检查控制台锁屏状态；锁屏时每秒检查并等待解锁，状态无法读取则失败关闭，不启动 Xcode。执行期间防休眠进程退出也会停止 Xcode；结束或取消后回收自己的防休眠进程及被中止的构建进程组。不修改系统电源设置、账号或钥匙串。纯 `xcodebuild -version`／`-help` 不涉及签名，可直接读取。

输出出现 `-25308`、`errSecInteractionNotAllowed`、`missing Xcode-Username/Token` 或账号凭据错误时，入口立即停止命令并返回非零，不自动重试、重登录、清空钥匙串或递增 build。调用链必须在失败后停止；若输出经过管道写私有日志，须保留 `pipefail`，不能用 `;` 接下一条签名／上传命令。先解锁并检查 Xcode 账号状态及私有日志，再决定是否需要用户恢复登录；上传失败另查商店是否已有结果。

限制：`caffeinate` 防止自动息屏和空闲休眠，不能阻止手动锁屏、合盖或系统强制锁定；操作期间出现这些情况仍可能触发 Xcode 的账号加载缺陷。错误监测发生在 Xcode 已报错之后，不能撤销它已发生的账号配置写入。无人值守 API Key 认证尚未接入。

现有命令形状（bash，从候选根目录执行；`IOS_XCODEBUILD` 指向含此防护的已审查检出，不要求旧版冻结候选已包含脚本；版本和路径替换为本次值）：

```sh
set -euo pipefail
IOS_XCODEBUILD="/absolute/path/to/reviewed-homer-checkout/scripts/ios-xcodebuild.mjs"
node "$IOS_XCODEBUILD" -workspace mobile/ios/Homer.xcworkspace -scheme Homer \
  -configuration Release -destination 'generic/platform=iOS' \
  -archivePath "$IOS_RELEASE/Homer.xcarchive" -derivedDataPath "$IOS_SCRATCH/derived-data" \
  -allowProvisioningUpdates DEVELOPMENT_TEAM=FUNQ8PQ8CX CODE_SIGN_STYLE=Automatic \
  MARKETING_VERSION="$IOS_VERSION" CURRENT_PROJECT_VERSION="$IOS_BUILD" archive
node "$IOS_XCODEBUILD" -exportArchive -archivePath "$IOS_RELEASE/Homer.xcarchive" \
  -exportOptionsPlist "$IOS_RELEASE/ExportOptions.plist" \
  -exportPath "$IOS_RELEASE/export" -allowProvisioningUpdates
```

`-allowProvisioningUpdates` 会请求 Apple 签名资源：仅在已授权签名资料操作、现有 Team/标识一致时使用，不把只读资料准备当作该授权。

核验最终导出 IPA，而非只核验 archive：

1. 解到任务 scratch，读取 Info.plist 的标识、marketing version、build、最低系统、支持设备族，匹配本次范围。
2. `codesign --verify --deep --strict APP`；读实际证书/Team、entitlements 和 `embedded.mobileprovision`，要求发行身份、正确 application-identifier/Team、`get-task-allow=false`，App Store profile 不含设备名单。原始 profile/完整 entitlement 输出保留在私有文件，不打印凭据或设备标识。
3. 核对嵌入页面、许可与版本提示原生模块确实进入候选。StoreKit 源文件存在不代表已链接；QA/TestFlight 的非 production 分支应跳过正式更新检查，不修改逻辑强行展示。
4. 对最终 IPA 记录摘要、字节数和来源，保留 archive/dSYM/export 和私有验证资料；不拿重新签名的 QA App 充当 App Store IPA。

## 上传、审核、上线

- 使用现有 App Store Connect 应用与上传链；先查询该版本/build 是否已存在。上传失败或状态不明先查询，不盲目重传或递增版本。
- 等待构建处理完成，再核对选中的 build、隐私入口/公开政策、App Privacy、年龄与内容/加密问卷、截图、支持地址和审核配对说明。复用实际界面素材，不能把 AI 合成界面或拉伸 iPhone 图冒充 iPad 真机截图。
- 法律协议/交易商等本人声明按真实事实处理，不能代用户猜测或提交；缺项集中列出。已确认的账号/公司授权不重复询问，未确认的跨主体要求也不能臆造为阻塞。国家/地区遵守用户选择与平台实际条件，未处理地区单独报告，不擅自改为全球可用。
- 审核配对复用现有主端、登录与现场二维码；提供可用主端下载和合法审核访问条件，不用过期/长期二维码，不要求审核员购买订阅，不新增手机模型计费机制。
- 只在“提交审核”已获授权且资料可审阅时提交。上传、等待审核、审核通过、商店可获取分别记录；审核中不把官网 iOS 标为 available。
- 上线后确认原 App Store 页面及实际可安装地区，按合同填写实际最低系统和已核验 storefront。不能拿手机语言、IP 或商店页面 HTTP 200 推断可安装地区。
