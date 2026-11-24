# Preview 的桌面按需定位授权

**状态（2026-11-23）** 首轮最小改动已接入源码。macOS 打包声明定位用途，Preview 的「网站定位授权」可由用户主动打开 macOS 或 Windows 的系统位置设置。网页定位审批已接入源码，已在隔离 Electron 使用虚构坐标验证回调。支持范围覆盖 Apple 芯片 Mac、Intel Mac 和 Windows x64。各平台的系统授权、真实定位、打包界面和配对闭环仍待验。Linux x64 可编译源码，桌面打包规划当前明确拒绝该目标，因此记录其提供方差异，待支持 Linux 桌面时再纳入实施和验收。 [网页权限审批方案](preview-architecture.md#网页权限审批方案) · [平台构建规划](../../scripts/github-build-plan.mjs#L8)

## 工具栏定位入口优化（2026-11-24）

**状态**　左侧定位图标与面板的局部让位已接入源码。macOS 隔离 Electron 在 1280、390 和 320 CSS px 验证原生网页向下让位、仍然可见、关闭后恢复同一视图且保留输入，以及键盘打开和 Esc 回焦。使用本地 HTTPS 和虚构坐标验证拒绝、本次允许、记住及撤销，系统设置由替身校验调用和手动路径。现有两项审批回归、Preview 链接与本地 HTML 模态批注定向用例通过。测试基于独立源码副本，真实系统定位、安装包、Windows 及配对真机仍待验。

采用 Chrome 将站点信息放在网址左侧、把站点管理与首次权限请求分别呈现的布局。Homer 继续使用定位图标和现有审批卡。图标位于网页标题及域名左侧，桌面复用 32 CSS px 工具按钮，窄屏使用 44 CSS px 点击区。标题和域名可截断，面板显示完整来源。320px 下与现有导航、批注按组换行，定位请求出现或消失时不额外增加一行。移除工具栏下方原「网站定位授权」和等待审批的常驻行。[Chrome 站点权限说明](https://support.google.com/chrome/answer/114662?hl=en) · [Chromium 请求提示文案](https://chromium.googlesource.com/chromium/src/+/HEAD/components/permissions_strings.grdp)

| 状态 | 展示和操作 |
| --- | --- |
| 普通 HTTPS 页面 | 单个定位图标。点击后先显示当前来源与「未保存授权」，不会发起定位请求。 |
| 有效请求待处理 | 标题右侧出现「待审批」，点击用现有审批 ID 直接定位原对话卡。窄窗若仅显示图标，保留「查看定位审批」可访问名称。原卡继续提供本次允许、记住此站点和拒绝。站点管理入口仍可打开。 |
| 本次获准 | 审批卡沿原回执显示决定。工具栏只有拿到对应当前请求的可靠回执才显示「本次已允许」。当前页面投影缺少该字段，首轮用「未保存授权」，不为短暂提示增加状态。 |
| 已记住 | 按完整来源和具体权限匹配，分别呈现「位置」和「近似位置」。可逐项撤销。二级「已记住的网站」保留已有跨站列表、空状态和逐项撤销，返回后聚焦二级入口。 |
| 请求未获准 | 现有 `locationDenied` 也可能来自回调失效等情况，文案用「上次请求未获准」，不写成永久拒绝或归因于系统。已有记住记录仍按原数据展示。 |
| 系统定位关闭或未知 | Demo 的关闭态为模拟。现有桥接只打开设置，没有定位开关或授权状态读数。产品首轮显示「可检查系统位置设置」，用户明确点击后才沿用现有 macOS／Windows 跳转及手动路径；导航、打开面板和审批均不主动调用系统授权。 |
| 本地／附件或不合格来源 | 不展示此页可授权或系统位置设置。原桥接若已提供跨站授权管理，保留「已记住的网站」入口。 |

### 最小接入

1. 在 [BrowserPreview](../../ui/browser-preview.tsx) 内替换旧折叠区及待审批行。复用 [PreviewToolbar](../../ui/preview-toolbar.tsx)、现有图标按钮和网页样式文件。共享工具栏若缺少前置位置，只加一个可选插槽，其他阅读器继续沿旧调用。面板打开时调用现有 `locationGrants()`，成功后才判断「未保存授权」。当前站点按与宿主相同的无凭据 HTTPS `origin` 比对，不以截断标题、裸域名或网页正文判断。撤销使用原完整键和返回的列表，读写失败就地提示。切换页面、来源或文档时关闭面板，迟到的列表回执不得覆盖新页面状态。
2. 沿用 [审批跳转和卡片](../../ui/homer-app.tsx)、[授权存取和请求有效性](../../packaging/electron/preview-pages.mjs)、[系统设置桥接](../../packaging/electron/main.mjs)。审批 ID、权限分区、持久化键、失效和回执语义随原链路。打开面板及查看审批不改变页面控制权，批注、用户接手及交还使用原按钮。后续匹配请求不复用已撤销的记录，已交付坐标和持续定位的边界沿下文。此项只改管理界面，无需另建审批、权限服务、数据表、系统状态探测、坐标采集或页面截图。
3. 面板由宿主 DOM 渲染，打开后焦点进入面板，Esc 或关闭按钮返回图标，点击宿主面板外部关闭并允许正常焦点移动。原生网页里的点击不传播到宿主 DOM，首轮允许网页照常交互并保留面板，不新增原生点击转发。较窄时限制面板在预览区内并允许内容滚动。沿用现有来源、标签和文档有效性，换页时清理旧浮层，不把旧焦点交给新页面。

### 原生网页叠层

网页是独立的 `WebContentsView`。Portal、CSS `z-index` 或 HTML 顶层浮层不能单凭宿主布局覆盖它。现有全局对话框判定会把网页整体隐藏，和并行调查记录的空白问题是同一路径。[原生视图边界及生命周期](../../packaging/electron/preview-pages.mjs)

定位面板使用局部让位。打开时在工具栏与网页占位框之间留出面板高度，面板对齐定位图标，网页继续沿原占位框测量及 `present` 更新原生矩形。面板使用带名称的非模态区块，原全局隐藏规则保持适用。宿主先让出空间，待现有 `present` 回执确认网页边界更新后，再显示面板并允许交互。面板高度随内容和窗口受限，要保留网页可见区。收起后恢复原边界和同一 WebContents。这个取舍允许面板打开时网页纵向让位，和 Demo 悬浮在网页上的效果有差别。若必须让网页保持原位，再请用户确认取舍并评估并行调查的叠层方案；定位入口本身不引入新窗口或原生覆盖视图，也不改通用显隐判断。

### 最少验收

- **宿主 UI。** 桌面和 390／320px 验证左置图标、标题截断、待审批入口、44px 窄屏热区、面板防溢出以及键盘打开和关闭回焦。覆盖当前站点、跨站历史、精确与近似权限分开撤销、空列表、读取失败、切换页面后迟到回执。系统状态未知时确认没有「定位已关闭」的断言，设置调用只由点击触发。
- **隔离 Electron。** 用有滚动和输入的本地合成网页验证打开、关闭、调整分栏或缩放、切标签时面板可点，网页仍可见且恢复同一实例及输入。叠加设置等真实模态并按顺序关闭，核对不存在错误恢复。以独立已知基线核对批注及并行白屏调查涉及的路径，不把既有问题计为本改动通过或已修复。
- **权限回归。** 复跑[原生网页专项](../../tests/browser-preview.electron.test.mjs)中的虚构坐标用例，核对原审批只提交一次、拒绝后重试、撤销后按原规则检查、过期决定不入新页、用户接手不变。系统设置用替身验证目标参数，安装版设置跳转、首次系统提示和真实定位仍按下文独立验收。

## 用户流程

1. **网页需要定位时先检查站点授权。** 复用现有审批卡及已记住的站点决定。等待审批时保留原请求，拒绝、超时、页面失效或任务停止时结束该请求。从启动 Homer 到打开普通网页，均不主动申请系统定位权限。
2. **站点允许后，才处理电脑系统权限。** 首次批准站点、命中已记住的站点授权，都进入同一系统权限流程。电脑已允许定位时继续原请求。需要系统授权或修改设置时，按主机平台引导用户。配对手机只提交站点决定，卡片提示「请在运行荷马的电脑上完成定位设置」。桌面保留到原 Preview 页的入口。
3. **用户决定后继续。** 允许时只继续同一有效请求，最终结果以网页的定位回调为准。定位服务关闭、拒绝、受管理员策略限制或提供方不可用时，按可核实的原因提示。恢复后从网站已知入口重新请求，已经失效的页面、文档或任务不会自动回放。原因尚未核实时，只显示「网页尚未取得位置」。远程桌面和配对手机都由运行 Homer 的主机提供位置，不能据此推定主机一定可定位，也不以手机或远程控制端位置代替主机位置。

站点权限与系统权限分别生效。「记住此站点」只记录同一浏览配置、来源和具体权限的站点决定。系统权限关闭时，站点记录仍可查看和撤销，网页无法仅凭站点记录越过系统限制。

分别记录「站点已批准」「系统授权状态」「网页已取得位置」。系统提示一旦出现，用户在系统里作出的选择可能改变 Homer 的应用权限，即使原网页已经关闭。系统返回后仍须核对原页面、文档及任务有效性，失效时丢弃该请求的结果。新的网页请求重新检查两层权限。 [原页面有效性检查](../../packaging/electron/preview-pages.mjs#L211) · [Apple 的系统授权 API](https://developer.apple.com/documentation/corelocation/cllocationmanager/requestwheninuseauthorization())

撤销会删除记住的授权，后续权限检查不再使用该记录。已交付的坐标无法收回。同一文档的新定位调用是否重新触发权限检查、已有 `watchPosition` 是否停止、打开新文档后是否重新审批，须分开实测。若用户要立即结束当前页面的持续定位，引导关闭对应 Preview 页面。精确与近似权限分别匹配，允许近似定位不能授权精确定位。最终精度取决于系统与定位提供方。 [现有站点授权撤销](../../packaging/electron/preview-pages.mjs#L177)

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
