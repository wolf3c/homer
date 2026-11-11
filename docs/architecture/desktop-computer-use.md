# 桌面版内嵌 Cua Driver

macOS ARM64 的本机 Worker 已接入原厂 Cua Driver。默认直接操作已有 Chrome 窗口的活动页。Developer ID 候选包已用包内 Codex 和真实模型完成远程调试关闭时的登录态复用、导航、点击和纯视口附件交付。

Windows x64 源码已接入同一组 Worker 工具。官方驱动 ZIP 和 SDK 已核对摘要，Windows 辅助程序已交叉编译。签名候选包和 Windows 交互桌面的真实 Worker 尚未验收。

## 首版范围

已验收范围为 macOS ARM64；Windows x64 待签名候选验收。驱动随 Homer 安装。用户在原会话提出任务，主 Agent 沿现有流程派给 Worker，截图作为原会话附件交付。

| 路径 | 首版动作 |
| --- | --- |
| 网页 | 复用已经打开的 Chrome 和登录状态。使用指定窗口的活动标签页，未指定时使用最靠前的可见 Chrome 窗口。支持导航、点击和纯视口截图，Chrome 远程调试保持关闭。 |
| 临时 Chrome | 用户要求隔离时，首次 `browser_open` 传 `isolated: true`。Homer 启动已验证签名的本机 Chrome，使用访客模式和全新临时 profile。只操作首个网址的来源，无需开启远程调试。 |
| 指定桌面窗口 | `desktop_read` 通过现有审批卡确认唯一窗口，随后可用 `desktop_click`、`desktop_type` 和 `desktop_read` 的 `save_as` 截取窗口。 |

目标不明确或无法操作时沿原对话说明。网页表单输入、窗口选择器和其他平台留待实际需求。

## 接入与授权

1. 经包资源校验的本机 Worker 沿现有 MCP 发现 `browser_open`、`browser_read` 和 `browser_click`，发现时零驱动启动。底层用原厂 `list_windows`、`get_window_state`、`click` 和键盘工具。导航把目标 Chrome 窗口切到前台，核对焦点在该窗口的工具栏，输入后核对地址再回车。点击用最近一次视口快照及原厂 `capture_id`，由宿主换算到窗口像素。 [Worker MCP](../../src/worker-interaction-mcp.ts) · [原厂窗口与输入](https://cua.ai/docs/cua-driver/concepts/how-cua-driver-works)
2. 仅对主会话本机来源的当前 Worker 轮次开放。已配对移动端沿用主会话来源，外部聊天渠道的任务不注册这些工具。宿主绑定 `PID + window_id`，调用前核对事项版本和轮次。明确的浏览器任务省去标签页和网站审批卡。桌面首次读取时由用户批准具体窗口，宿主在批准后重新核对窗口和进程身份。点击和键入只接受该窗口最新快照的元素令牌。macOS 沿「本机权限」授予辅助功能和屏幕录制；Windows 使用同一桌面会话的原生 UI Automation，不额外安装工具或申请管理员权限。 [宿主接线](../../src/service.ts)
3. 从目标 Chrome 的原生无障碍树读取可见网页区域。macOS 缺少网页 AX 节点时，helper 只向已绑定的 Chrome 进程请求一次 `AXEnhancedUserInterface`，随后最多等待约三秒；Chromium 有两秒防抖，不能根据设置调用的返回值立即判失败，也不能在轮询中反复设置。每次重读均复核同一窗口，保留原有节点预算、唯一视口、HTTP(S)、父子边界及窗口包含关系检查。Homer 自建访客 Chrome 同时带 `--force-renderer-accessibility`，已有 Chrome 不重启、不追加启动参数。快照前后核对页面和尺寸，匹配原厂截图坐标，再由包内解码器裁剪。Windows 用 UI Automation 定位唯一可见的 `RootWebArea` 和地址栏，不匹配本地化标题；原厂窗口帧裁掉的 1 px 边缘不计入截图，无法确认坐标就拒绝裁剪。`browser_read` 返回预览和坐标，指定 `save_as` 时保存原尺寸 PNG 并只返回文件回执，沿用 2 MiB MCP 回包上限。主 Agent 从原会话交付原件。 [macOS 视口定位](../../packaging/macos/ChromeViewport.swift) · [Windows 视口定位](../../packaging/windows/CuaWindows.cs) · [消息与附件统一交付](main-worker-chat-architecture.md#消息与附件统一交付)
4. Homer 只为显式隔离的任务启动 Chrome。Windows 先以全新 profile 打开空白页，按新进程和窗口归属确认目标，再走同一导航流程。发现企业策略覆盖 profile 或禁用访客模式时拒绝隔离。宿主在临时会话中校验网页来源后才返回截图或派发点击。桌面窗口 PNG 和两种网页 PNG 沿用同一文件回执与附件交付。

Windows 的 Worker 工具走本机命名管道；Unix 仍使用私有文件套接字。Windows 桌面截图在捕获前后核对窗口外框，拒绝无法区分为原厂桌面区域回退的图像。浏览器预览超过回包限制时，从同一帧缩小，点击仍绑定原始捕获 ID。

## 按需启停

首次浏览器调用或桌面审批通过后，由签名的随包 Worker 宿主经原厂 SDK 启动私有驱动。每个 Worker 轮次绑定一个控制目标。私有会话目录承载启动标记和临时 Chrome profile，原厂驱动二进制仍在签名包内。 [桌面操作](../../src/desktop-cua.ts) · [桌面运行时](../../scripts/desktop-runtime.mjs)

macOS 的私有 SDK 对象由随包 Node 的独立子进程持有，仅代理 metadata、工具调用、shutdown 和句柄销毁，使用支持 BigInt 的私有 IPC。启动握手与 metadata 共用十五秒预算，宿主事件循环不等待同步构造器；审批、目标选择、文件回执和进程归属仍由原宿主维护。真实 SDK `0.46.1` 的主线程／Node 工作线程双重加载探针出现 SIGABRT，因此不采用线程承载。父连接断开时代理退出；优雅关闭超时后，宿主独立终止代理并等待退出，再核实所属驱动与 Chrome 回收，无法确认就保留占用。Windows 保留原三秒启动和 Job 路线。异常只传递受控错误码，不记录 SDK 原始异常、stderr、窗口内容或工具输入输出。 [SDK 进程代理](../../src/desktop-cua-driver.ts)

初始化失败或本轮首次 `desktop_read`／`browser_read` 失败时，先结算 pending，再关闭自身驱动并确认资源回收，成功后撤销未完成绑定。清理无法确认则返回 `cua_cleanup_unconfirmed` 并保留占用。隔离启动失败保留本轮停止状态，后续调用返回 `cua_session_stopped`，不能隐式回落个人 Chrome。已有成功会话和结果未知的输入不自动重绑或重放。

启动握手超时返回 `cua_driver_startup_timeout`，其余启动失败返回 `cua_driver_startup_failed`。macOS helper 将进程不可用、系统权限不足、AX 窗口列表不可读、原绑定窗口无法匹配、网页 AX 树缺失、视口无效及页面协议不支持分别编码；执行超时返回 `chrome_helper_timeout`。已确认锁屏时优先返回 `cua_screen_locked`，无法读取会话信息时继续原窗口校验。`chrome_bound_window_unavailable` 仅说明原绑定窗口未匹配，不能解释为系统没有 Chrome 窗口。MCP 仍只接受受控错误码，未知原始异常继续脱敏。

2026-11-11，先在独立签名测试实例和自建 Chrome 中确认：旧 helper 先无法读取视口，单次 AX 启用请求后约 2.2 秒恢复，设置返回 `-25208` 不代表启用未发生。随后在同一隔离边界验证 scratch 中编译的候选模块、新 helper 与包内真实 SDK、解码器：复用路径首次 helper 约 2.19 秒后成功；复用与显式隔离均完成读取、一次点击及原尺寸纯视口 PNG，分别为 `2400 × 1472` 和 `2400 × 1584`。错误窗口和非 Chrome 进程均被明确拒绝。一次审批后桌面读取返回 14 个元素；首次网页 AX 读取失败后清理并显式重绑成功，隔离取消后后续读取保持停止，无个人窗口发现。真实 SDK 连续两轮启动关闭、1 ms 握手超时分类与启动中取消均确认回收。新 helper 编译及实际锁屏专用码通过；定向离线回归 90 项通过，覆盖启动、错误分类、绑定回滚、隔离停止边界和候选源码带入。以上为隔离源码模块验收，未重打包产品或调用真实模型，不代替安装包验收；未安装或发布。

任务结束、取消、撤权、超时或应用退出时，先封住调用，再让原厂结束会话。macOS 按会话启动路径和 profile 回收进程组。Windows 将原厂私有驱动和临时 Chrome 放入同一 [Windows Job Object](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)，已有 Chrome 不加入。驱动无响应时结束 Job，确认成员归零才删除临时目录。宿主进程退出也会触发回收；启动阶段复查残留会话。Homer 对原生引擎和旧宿主的接管仍要求原有退出证明，强杀整个进程树后的产品重启须单独验收。点击或输入发出后若丢失回执，恢复后先观察，结果保持未知。 [进程回收](../../src/cua-processes.ts) · [任务重启恢复](main-worker-chat-architecture.md#重启后原任务怎样继续)

## 打包与验收

候选固定 Cua Driver `0.46.1` 和 Codex `0.163.0`。沿现有桌面依赖锁校验上游归档摘要和 npm integrity；SDK、动态库和驱动位于 ASAR 外。打包清单记录最终签名后的包内字节，随包附许可证和第三方声明。macOS 使用 Developer ID，Windows 复用现有 Authenticode 路线，系统随附的 .NET Framework 编译器负责构建辅助程序。Windows 的包内验证和真实 Worker 验收分开记录，见[测试说明](../testing.md#windows-x64-cua)。 [依赖准备](../../scripts/prepare-desktop-dependencies.mjs) · [桌面构建](../../scripts/build-desktop.mjs) · [固定版本发布](https://github.com/trycua/cua/releases/tag/cua-driver-rs-v0.46.1)

2026-11-10 的 ARM64 探针使用独立 Electron `45.0.0` 临时应用和 ad-hoc 签名。官方 macOS universal 驱动归档 SHA-256 为 `7d39975454f3117baa8e20735ff5219dd40bfb97a4ba70a99861975ab07872ac`。探针启动隔离 Chrome，点击回环合成页面并确认按钮状态变化，得到 `2400 × 1472` PNG。越界来源被拒绝，结束后确认驱动、Chrome、观察到的 9 个子进程及临时 profile 均已回收。首个导航需要将 `about:blank` 纳入清单。来源受限的网页清单与通用桌面 `click` 混用会被驱动拒绝。 [启动页清单规则](https://github.com/trycua/cua/blob/cua-driver-rs-v0.46.1/libs/cua-driver/rust/crates/cua-driver-core/src/session_manifest.rs#L1485-L1507)

同一探针验证了桌面驱动启动、权限查询与退出。临时身份的辅助功能和屏幕采集均未授权，桌面动作未验收。独立 Codex `app-server` 通过上游 MCP 对照发现并查询了工具，没有发起模型请求。签名产品、故障收尾和实际 Worker 交付按下表验收。

Developer ID 小样沿 Forge 签名规则对两个 SDK 原生文件签名，保留了上游驱动签名，并核对了签名后的 SHA-256。签名 Electron 的工作线程成功加载 SDK、启动和关闭私有驱动。macOS 27.2 的辅助功能权限入口在「隐私与安全 → 设备控制和数据访问」。系统授权后，宿主与驱动均确认辅助功能和屏幕录制有效。小样按标题绑定测试窗口，验证实际点击、键入和 `700 × 464` PNG。同一应用另一扇窗口的读取、点击和键入均返回 `bounded_resource_outside_manifest`。

签名小样的网页流程连续三次从全新的 Chrome profile 绑定准确的标签页，通过最新语义快照的引用点击，并生成 `2400 × 1472` 的视口 PNG。未授权来源被拒绝，正常结束后驱动、Chrome 进程组和 profile 均已回收。早期一轮 CDP 导航超时，产品候选包仍须复验。

签名小样注入启动及关闭无回执，两个阶段的测试界面均能处理点击。强退后驱动已退出，自建 Chrome 进程组和临时 profile 仍在。小样重开保留占用，测试确认同一进程组退出并清理 profile 后才放行。私有 Worker 不接受 `CUA_DRIVER_BROWSER_PROFILE_ROOT`，小样通过独立 `HOME` 将 profile 放在受管目录。 [私有 Worker 环境校验](https://github.com/trycua/cua/blob/cua-driver-rs-v0.46.1/libs/cua-driver/rust/crates/cua-driver-sdk/src/worker.rs#L526-L541)

2026-11-10，Developer ID 小样使用独立 profile 和预先登录的本地合成站点。中文 Chrome `157.0.8103.40` 无远程调试启动参数，结束前核对了 `DevToolsActivePort` 和 Chrome TCP 监听均不存在。原厂 CUA 按 `PID + window_id` 读取窗口，在后台实际点击按钮和链接，并通过短暂前台的 `⌘L`、输入、回车打开另一个网址。服务端确认按钮只触发一次，导航复用了同一登录态。关闭驱动后 Chrome 仍在，测试随后回收自己的 Chrome 进程组和 profile。全程零模型请求。

后续签名小样在同一中文 Chrome 中从原生 `AXWebArea` 读取视口，分别得到默认布局 `2000 × 1346` 和展开书签栏 `2000 × 1278` 的 PNG。两种尺寸均与测试页的视口尺寸及像素比一致，首行像素验证属于网页。此前关闭调试的 CDP 对照在 `existing_profile` 准备阶段卡在英文 `New Tab` 匹配。显式 `isolated_new` 对照保持未登录，并成功回收自建 Chrome 和 profile。 [原厂按钮定位](https://github.com/trycua/cua/blob/cua-driver-rs-v0.46.1/libs/cua-driver/rust/crates/platform-macos/src/browser/setup_ui.rs#L390-L398)

2026-11-10，本地 Developer ID 候选 build 403 使用独立 Homer 资料、包内 Codex `0.163.0`、真实模型及中文 Chrome `157.0.8103.40`。隔离启动中的登录转接只提供测试账号会话，工具调用和任务交付均由候选包执行。用户话术只描述任务。合成站点确认导航保留原标签页和登录态，按钮实际触发一次。首个导航调用通过，任务全程没有审批卡或 shell 调用。原会话下载了 `2400 × 1526` 的纯视口 PNG，文件为 `10247488` 字节，SHA-256 `c5f92dbedcdefb9ffdb53b5aa8a928679890bac0c6c4904c6aea6fa4796e267a`，与任务原件一致。待机未启动驱动，Worker 结束后驱动已退出，原 Chrome 保留至测试清理。候选包仅供本地验收。

同日，包内原厂 `isolated_new` 连续三次绑定标签页后在首次 `Page.navigate` 超时，合成服务器均收到零请求。采样中的 Chrome 线程在调用系统钥匙串。用相同 Chrome 和启动参数作对照，普通新 profile 两次超时，仅加测试用 mock keychain 的两次均立即到达。Chrome 自带访客模式保持正常钥匙串设置，两次均立即到达。因此产品使用独立访客进程，把读取、点击和截图留给原厂驱动，避免改变 Chrome 的凭据保护。 [Chromium 钥匙串接口说明](https://chromium.googlesource.com/chromium/src/%2B/908c4a63c9225eb606e47a515f64b3f3fac6ad1b/components/os_crypt/sync/os_crypt.h)

访客方案的签名候选源摘要为 `4a2b4b9c1762889d9f3e6270671e7a30e22bc75a24a92bca266cdda51d554af9`。包内 Codex `0.163.0` 用真实模型在合成桌面窗口完成读取、点击、键入和 `700 × 464` PNG 交付。只批准一次，另一扇窗口保持原状态。真实 Worker 在临时访客 Chrome 加载页面并实际点击一次，远程调试关闭，网页流程无审批卡。原会话下载的 `2400 × 1584` 纯视口 PNG 为 `8393050` 字节，SHA-256 为 `781a79333070726aada59951fb6d3bdeccb140439f1e49a80dc11117c0e6a178`。两张原件均与任务文件的哈希一致。

同一签名包在取消和驱动无响应时确认原驱动、独立 Chrome 进程组和 profile 回收。驱动超时后的再次读取被拒绝。强退试验保留了运行中的驱动和临时 Chrome，再打开同一 Homer 资料时先回收残留，原会话 ID 保持一致，恢复阶段零模型轮次，原动作未重放。锁屏时原厂读取返回 `cua_screen_locked`，本机解锁后完成了可见桌面的操作验收。

已有 Chrome 的回归也使用同一签名包。原标签页和测试登录态保留，导航和点击各生效一次，原会话下载的 `2400 × 1526` PNG 与任务原件哈希一致。会话结束回收驱动，原 Chrome 窗口仍可使用。

| 顺序 | 通过条件 |
| --- | --- |
| 1. 签名小样 | 关闭 Chrome 远程调试，直接操作已登录的测试标签页，验证导航、点击、截图和 Chrome 保留。显式隔离使用全新 profile，结束后清理。授予辅助功能后验证指定桌面窗口的实际点击、键入和截图。 |
| 2. 签名产品候选包 | 验证目标绑定、原生拒绝和退出边界。核对网页截图只含视口。覆盖取消、无响应、强退及重启，核对自建 Chrome 与 profile 回收，确认未知动作不会重放。 |
| 3. 实际 Worker | macOS ARM64 本地签名候选用真实模型验收指定桌面窗口、临时访客 Chrome、原会话附件交付和故障回收。已有 Chrome 路径保留独立的登录态与视口回归。 |
