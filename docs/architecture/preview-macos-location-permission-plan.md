# Preview 的桌面按需定位授权

**状态（2026-11-23）** 首轮最小改动已接入源码。macOS 打包声明定位用途，Preview 的「网站定位授权」可由用户主动打开 macOS 或 Windows 的系统位置设置。网页定位审批另行集成，其隔离 Electron 虚构坐标验证已完成。支持范围覆盖 Apple 芯片 Mac、Intel Mac 和 Windows x64。各平台的系统授权、真实定位、打包界面和配对闭环仍待验。Linux x64 可编译源码，桌面打包规划当前明确拒绝该目标，因此记录其提供方差异，待支持 Linux 桌面时再纳入实施和验收。 [网页权限审批方案](preview-architecture.md) · [平台构建规划](../../scripts/github-build-plan.mjs#L8)

## 用户流程

1. **网页需要定位时先检查站点授权。** 复用现有审批卡及已记住的站点决定。等待审批时保留原请求，拒绝、超时、页面失效或任务停止时结束该请求。从启动 Homer 到打开普通网页，均不主动申请系统定位权限。
2. **站点允许后，才处理电脑系统权限。** 首次批准站点、命中已记住的站点授权，都进入同一系统权限流程。电脑已允许定位时继续原请求。需要系统授权或修改设置时，按主机平台引导用户。配对手机只提交站点决定，卡片提示「请在运行荷马的电脑上完成定位设置」。桌面保留到原 Preview 页的入口。
3. **用户决定后继续。** 允许时只继续同一有效请求，最终结果以网页的定位回调为准。定位服务关闭、拒绝、受管理员策略限制或提供方不可用时，按可核实的原因提示。恢复后从网站已知入口重新请求，已经失效的页面、文档或任务不会自动回放。原因尚未核实时，只显示「网页尚未取得位置」。远程桌面和配对手机都由运行 Homer 的主机提供位置，不能据此推定主机一定可定位，也不以手机或远程控制端位置代替主机位置。

站点权限与系统权限分别生效。「记住此站点」只记录同一浏览配置、来源和具体权限的站点决定。系统权限关闭时，站点记录仍可查看和撤销，网页无法仅凭站点记录越过系统限制。

分别记录「站点已批准」「系统授权状态」「网页已取得位置」。系统提示一旦出现，用户在系统里作出的选择可能改变 Homer 的应用权限，即使原网页已经关闭。系统返回后仍须核对原页面、文档及任务有效性，失效时丢弃该请求的结果。新的网页请求重新检查两层权限。 · [Apple 的系统授权 API](https://developer.apple.com/documentation/corelocation/cllocationmanager/requestwheninuseauthorization())

撤销会删除记住的授权，后续权限检查不再使用该记录。已交付的坐标无法收回。同一文档的新定位调用是否重新触发权限检查、已有 `watchPosition` 是否停止、打开新文档后是否重新审批，须分开实测。若用户要立即结束当前页面的持续定位，引导关闭对应 Preview 页面。精确与近似权限分别匹配，允许近似定位不能授权精确定位。最终精度取决于系统与定位提供方。

## 实施顺序

### macOS：先补打包用途说明

在 macOS Forge 打包的 `extendInfo` 添加 `NSLocationUsageDescription`，建议文案为「当你允许预览中的网站使用位置时，荷马需要访问此 Mac 的位置。」这只是用途声明。当前 0.1.23 安装包已有位置签名项，应用签名启用了 Hardened Runtime，未发现 App Sandbox 项。沿用现有打包签名流程，以隔离候选的真实签名产物复核主应用的用途说明、bundle ID、签名和 entitlements。仅当系统证据表明调用由 Helper 承担时，再核对其签名身份与授权归属。 [Forge 打包配置](../../packaging/electron/forge.config.mjs#L40) · [Apple 的 macOS 用途说明](https://developer.apple.com/documentation/bundleresources/information-property-list/nslocationusagedescription)

按发行路径准备 Apple 芯片和 Intel 的 Developer ID 签名、公证候选，核对主应用及相关 Helper 的身份与签名方式。每个平台用同一候选、隔离浏览配置和可信本地 HTTPS 页面，在单独授权的测试环境分别完成两项验收。若候选 bundle ID 与正式版不同，只证明该候选的系统授权行为。

1. **已授权后的实际定位。** 在系统已允许该候选定位时，经站点批准验证网页能收到真实定位。单独记录采用的提供方和精度档位。如果此步失败，先检查签名归属、系统服务和提供方。增加授权桥无法解决已经授权时的定位故障。
2. **首次系统提示。** 在独立测试身份或干净系统快照中，确认系统定位已开启、该候选权限尚未决定。前台批准站点后，观察是否出现系统提示、提示归属及用途文案。核对用户允许后网页结果，以及启动、拒绝站点和后台等待的行为。隔离浏览配置只隔离站点决定，系统应用权限也要单独隔离。

分别记录站点回调、系统提示和网页结果。出现提示与 `callback(true)` 均不代表网页已经定位。

Electron 45 在 macOS 初始化了 Core Location 的系统权限管理器，但公开的 `systemPreferences` 只有摄像头和麦克风的请求接口。Chromium 在系统权限待定时可以等待状态变化。包内声明能否让该版本在批准站点后主动弹框，必须以签名候选实测为准。若现成路径满足要求，保留这一项打包改动即可。 [Electron 初始化](https://github.com/electron/electron/blob/v45.0.0/shell/browser/electron_browser_main_parts_mac.mm#L36) · [Electron 权限接口](https://github.com/electron/electron/blob/v45.0.0/docs/api/system-preferences.md) · [Chromium 启动定位的授权条件](https://chromium.googlesource.com/chromium/src/+/refs/tags/156.0.8078.48/services/device/geolocation/geolocation_provider_impl.cc#291)

### macOS：仅在实测必要时增加原生请求

若用途说明、签名、前台状态和系统定位开关均可核对，仍出现系统权限待定且没有弹框，再评估一个最小 macOS 原生桥。桥只提供授权状态和按需调用 `CLLocationManager.requestWhenInUseAuthorization()`，使用授权变化回调交还状态。优先让调用归于签名的 Homer 应用身份，避免默认采用独立命令行 Helper，以免授权记到另一个进程。若必须用 Helper，先验证系统提示和设置列表显示的主体，以及该决定对 Electron 定位的实际作用。候选构建还需核对 Apple 针对所用 API 的用途说明要求。 [Apple 的前台授权 API](https://developer.apple.com/documentation/corelocation/cllocationmanager/requestwheninuseauthorization())

只从桌面宿主启动原生请求。系统权限为待定、站点已明确允许、原请求仍有效且 Homer 在前台时，同一时刻只启动一次。用户决定、页面导航、关闭或任务终止后，按现有生命周期核对是否还可以把结果交回原网页。桥只传授权状态，不读取坐标。未经可归因的实测，不在 UI 中承诺系统弹框一定出现。

系统定位关闭、Homer 已被拒绝或受限制时，引导用户到「系统设置 → 隐私与安全性 → 定位服务」。沿用现有桌面设置入口，若系统版本不支持直接定位到该页面，则显示手动路径。

### Windows：先验证系统定位和设置入口

Homer Windows x64 使用 NSIS 安装的桌面应用形态。对应 Chromium 在 Windows 默认使用系统提供方（`PlatformOnly`），其源码有 WinRT 定位及 `RequestAccessAsync` 路径。Microsoft 对传统桌面应用的说明以系统「位置服务」及适用版本上的「允许桌面应用访问你的位置」开关为准。Chromium 有请求入口，实际安装包是否经该入口、会否出现系统提示，均需实测。首轮不添加 UWP 清单或原生桥。 [Homer Windows 打包](../../scripts/build-desktop.mjs#L129) · [Chromium 平台模式](https://chromium.googlesource.com/chromium/src/+/refs/tags/156.0.8078.48/services/device/public/cpp/device_features.cc#153) · [Chromium Windows 定位实现](https://chromium.googlesource.com/chromium/src/+/refs/tags/156.0.8078.48/services/device/public/cpp/geolocation/system_geolocation_source_win.cc#419) · [Microsoft 桌面应用定位规则](https://support.microsoft.com/en-us/windows/windows-location-service-and-privacy-3a8eee0a-5b0b-dc07-eede-2a5ca1c49088)

用与当前发行一致的 Windows 11 x64 未签名 NSIS 候选隔离安装，验证系统已开启、关闭、桌面访问不可用和受策略管理等状态。需要用户启用时，在桌面提示「设置 → 隐私和安全性 → 位置」，并提供用户主动点击的设置入口。复用 Homer 的桌面宿主设置跳转，固定目标为 `ms-settings:privacy-location`。如果策略锁定、打开失败或系统没有对应开关，显示手动路径和已确认的限制。是否需要原生集成，以该安装候选的结果决定。 [当前发行形态](../desktop-release-0.1.23-preparation.md#L7) · [Microsoft 设置 URI](https://learn.microsoft.com/en-us/windows/apps/develop/launch/launch-settings) · [Homer 宿主打开系统设置](../../packaging/electron/main.mjs#L820)

### 定位服务选择

核对隔离候选实际采用的提供方。macOS 默认先走系统提供方，特定条件下可能网络回退。Windows Chromium 默认采用系统模式。Linux 的该版本 Chromium 默认采用网络模式，系统定位还受构建选项和发行环境影响。首轮验证不新增 Google 服务。若后续确需启用，先确认 API Key 管理、结算、费用及实际发出的数据，再单独取得用户决定。Google 定位接口可接收 Wi‑Fi 接入点信息，并可能按请求 IP 推断位置。缺少 Key 只说明当前没有已核实的 Google 定位配置。 [Chromium 平台模式](https://chromium.googlesource.com/chromium/src/+/refs/tags/156.0.8078.48/services/device/public/cpp/device_features.cc#153) · [Chromium 提供方实现](https://chromium.googlesource.com/chromium/src/+/refs/tags/156.0.8078.48/services/device/geolocation/location_provider_manager.cc#389) · [Electron 的 Google 定位配置](https://github.com/electron/electron/blob/v45.0.0/docs/api/environment-variables.md#google_api_key) · [Google 定位请求字段](https://developers.google.com/maps/documentation/geolocation/requests-geolocation)

Homer 的审批链只处理站点、精度权限类型、决定和回执，不采集、记录或转发坐标。经授权的网页会收到定位结果，可以自行传输它。系统定位服务也可能联网，即使没有配置 Google Key。真实验收前确认实际提供方与网络边界。可信本地测试页只在内存中判断定位结果，坐标不写入 DOM、URL、日志、截图、诊断或配对消息。证据只记录结果状态、提供方与精度档位。

## 验收范围

| 场景 | 通过条件 |
| --- | --- |
| 启动、普通浏览、拒绝或失效 | 无系统定位弹框。关闭页面、导航或停止任务后，迟到的系统决定不应用到新请求。 |
| macOS 已授权定位、首次电脑授权 | Apple 芯片与 Intel 签名候选各自验证两项。分别确认已获系统授权时网页能定位，以及首次授权时系统是否提示、用户同意后能否继续。 |
| Windows 系统定位 | 在 x64 安装候选观察桌面应用的实际权限模型，核对开关开启时本地网页能定位、关闭时结果和文案一致、固定设置入口落到「位置」。覆盖可用的禁用或策略场景。 |
| 已允许、拒绝、关闭、受限制 | 已允许时按原请求继续。系统拒绝、关闭或受限时有对应引导，用户主动恢复后可经已知的网页入口重试。 |
| 撤销与持续定位 | 分别检查同文档新请求、正在执行的 `watchPosition`、新文档首个请求及关闭 Preview 后的行为。现阶段文案只承诺后续权限检查不再复用已撤销的记录。 |
| 配对手机与电脑前后台 | 分别配对 Mac 和 Windows 主机，确认手机决定可送达，手机提示对应的主机操作，电脑授权或设置变化不会释放过期的网页请求。 |
| 保护位置数据 | 各平台用可信本地 HTTPS 测试页。虚构坐标验证审批、精确与近似授权隔离、撤销及回执。真实结果验证在单独授权的隔离测试环境进行，输出仅记录成功状态、提供方和精度档位，坐标不进入对话、日志、截图、诊断或配对消息。 |

首轮离线验证已覆盖 Apple 芯片与 Intel 的 Forge 用途配置、macOS 与 Windows 的固定设置入口和受信 IPC 参数。仍需签名 macOS 候选及实际 Windows NSIS 候选验收设置落点、真实定位及首次系统提示。没有新增原生桥，未运行真实定位或更改设备权限。
