# Electron + Forge 桌面包装

> 历史桌面方案；当前构建与发布入口见 [桌面构建准备](github-build-preparation.md) 和 [桌面更新](desktop-app-update.md)。

2026-10-23。首批范围为本机 macOS arm64、已有 Homer 账号、手动更新和本机 ad-hoc 签名。固定 Electron 45.0.0、Forge 8.0.1、Node 22.22.0、Codex 0.163.0。Windows/Linux 的安装包、平台运行时和原生图像解码尚未实现或验证。

## 代码归属

`packaging/electron/main.mjs` 负责单实例、窗口、菜单、导航及下载边界、启动随包 Node、确认退出。没有 preload、IPC 桥、渲染器 Node 权限、托盘、守护进程、自动更新或新增业务状态。渲染器继续使用原有 HTTP/SSE；后端继续使用既有 stdio `url/error/stopped/quit` 协议。

2026-10-25 维护源码接入 macOS 原生标题栏同行：hiddenInset、构造期 titleBarOverlay 和真实系统按钮；宽窗 x12/y15，≤800px x12/y19。仅一个 resize 处理，位置相同不调用 setter；不使用 macOS 不支持的 setTitleBarOverlay。原窗口尺寸、菜单、关闭隐藏、退出确认／ACK和安全边界保持。renderer 仅识别 WCO 布局能力和当前 CSS env 几何，没有系统控制 API。实际产品合成验证、回退与限制见 [标题栏接入报告](2026-10-25-native-titlebar-integration.md)；不代表已安装 build66 采用。

`packaging/electron/forge.config.mjs` 负责 Forge 的 ASAR、应用资源复制、签名与 ZIP。`scripts/build-desktop.mjs` 只准备既有后端、经锁定校验的运行时、ImageIO 辅助程序和输入清单，然后调用 Forge。旧 Swift/AppKit/WKWebView 主壳、手写 Info.plist、手工发行签名脚本及其专用测试已移除；`ImageDecoder.swift` 和依赖校验锁保留。

稳定 bundle id 为 `app.homer.desktop.candidate`。后端保持 `Contents/Resources/homer`，Codex 保持 `Contents/Resources/runtime`，Node 和 ImageIO 辅助程序保持 `Contents/MacOS`，避免改动已有身份绑定与数据协议。

## 数据与退出

真实数据继续沿既有 `desktop-adoption.json` 采用，保持原 canonical 账号、数据库、主 thread 和聊天路径。Electron 只把缓存放入 profile 的 `host-home/electron`，该目录同样拒绝符号链接。没有首次登录入口；未连接账号继续只读，能力页 404 不恢复登录流程。

关窗只隐藏；菜单或 Cmd+Q 经确认后只发送一次 `quit`。只有收到后端 `stopped` 且子进程实际 `close` 的退出码为 0、无信号，才允许应用退出。超时、非零退出或缺少确认都保留现场，不强杀、不清锁、不自动重发。进程确认晚于超时到达时，需用户再次退出。原生退出确认由 Electron 提供。

主页面限制在本次后端给出的 `127.0.0.1` origin，拒绝跨源主导航、webview、权限请求与跨源重定向下载。外部 HTTP(S) 链接经确认交给系统浏览器。渲染器开启 sandbox/contextIsolation，关闭 nodeIntegration，无原生 API 桥。

## 构建

使用 Node 22.22.0 安装锁定的开发依赖（普通开发环境运行 `npm ci`，Electron 官方安装脚本获取对应运行时）。正式构建必须指定已提交的完整 SHA；代码从 `git archive` 提取，维护目录只提供依赖，不提供产品源码。桌面入口未提交或仍含旧壳时拒绝正式构建。业务文件的其他未提交内容不进入包。

```sh
npm run desktop:make -- \
  --source-sha <完整40位已提交SHA> \
  --maintenance <已安装锁定依赖的维护目录> \
  --scratch .codex/scratch/electron-desktop-build \
  --website-origin https://super-tree.com \
  --gateway-origin https://models.super-tree.com
```

`--archive-source <已核验归档所在目录>` 可复用既有官方 Node/Codex 归档；未提供时仍按既有锁定机制获取与校验。

两个网站连接地址必须同时提供，缺少任一项会在准备源码前拒绝构建；打包后再次核对 App 清单中的地址与输入一致。

本机体验可使用 `--local-working-tree` 冻结工作树源码；该模式标记为 `localWorkingTree:true`、`preparation:true`、`publishable:false`，不能用于正式分发，也不能与 `--prepare-candidate` 同时使用。

开发验收可显式追加 `--prepare-candidate`：只叠加清单中的 8 个桌面输入，排除 7 个旧壳文件，保留准确 Git 基线及每个叠加输入的 SHA256。此模式写入 `preparation:true/publishable:false`，应用只接受带合成标记的 `--test-profile`，不得用于真实 profile 或正式安装。

Forge 输出在 `<scratch>/forge/Homer-darwin-arm64/Homer.app` 和 `<scratch>/forge/make/zip/darwin/arm64/`；`desktop-build-result.json` 记录 Git、源码、UI、schema、工具合同、运行时、ZIP 身份。`desktop-manifest.json` 覆盖实际最终 ASAR、后端与原生辅助程序。签名失败阻断构建；保留官方 Node/Codex 原字节和原签名。

目前仅为本机 ad-hoc 签名候选，没有 Developer ID、公证或可公开分发保证。最低系统限制沿本次已验证基线保持 macOS 27.0，未声称支持更旧系统。

## 验证与边界

```sh
npm run test:desktop:shell
node --test tests/electron-package.test.mjs
HOMER_TEST_APP=<候选.app绝对路径> node --test --test-concurrency=1 tests/electron-desktop.test.mjs
HOMER_TEST_APP=<候选.app绝对路径> node --test --test-concurrency=1 tests/macos-desktop-runtime.test.mjs
```

测试只使用本任务 scratch 中的合成账号和假 Codex，不调用真实模型、生产服务或读取真实账号。真实窗口测试经过实际菜单退出，检查 owner、租约与锁回收，验证发送、原 thread 重启恢复、390/1440 宽度、关闭后激活，以及未连接账号的只读/404/409。

首次 ESM 顶层等待 ready 导致真实启动超时，修正为 ready 回调后原超时标准通过。Forge 8 的资源 hook 使用包含 `.app` 的目录，已用实际打包及独立合同验证。失败日志保留，不用单元测试代替真实应用启动证据。

真实窗口复测另发现已有 Web SSE 关闭竞态：初始快照仍在读取时关闭服务，晚到的 SSE 会漏过回收，阻塞严格退出。两个路由现在直接检查 `server.listening`，关闭后返回 503 并用 `Connection: close` 正常结束响应。没有新增关闭状态；`tests/web-server.test.ts` 对两个路由均先复现失败，再以原一秒断言通过。此为本次唯一共享后端行为修正。

最终结果为 34 项桌面/来源/账号合同、6 项 Web 传输、7 项包内后端入口、2 项真实 Electron 窗口验收通过。主工作区合入后另有 16 项桌面检查与同 6 项 Web 检查通过，未把重复运行累加为新增覆盖。最终 build-006 的后端 manifest 与已通过 7 项入口检查的 build-005 完全相同；真实窗口直接使用 build-006，并通过实际菜单正常退出。八个输入、测试源码、日志 hash 与 ZIP 身份见[验证记录](patches/2026-10-23-electron-desktop-verification.json)。

旧 build-004 的失败合成 UI 壳曾卡在应用级原生提示中；仅在其后端自行退出、owner 与 CLI 锁全部释放后回收了该空壳，不计为正常退出证据。最终版本的错误提示使用已有窗口作为父窗口，保持事件处理。

本次不改业务 UI、账号语义、旧工具精确兼容或原生浏览器保护。全仓检查未重复运行；不宣称历史类型检查和其他既有失败全部解决，也没有测量真实性能。正式发布仍需提交后的准确 SHA 重建，并按既有数据采用流程验收；准备包通过不代表真实数据采用或安装完成。

## 2026-10-24 复审与提交依据

以上为 2026-10-23 的准备快照。本次复审另修正三处边界：系统浏览器调用失败时捕获拒绝并给出安全提示；隐藏窗口退出前显示已有窗口，让原生确认可见；构建前逐项核对 TypeScript、Vite、Electron 和两项 Forge 工具的安装版本与 Git 树中的锁文件。三个新增回归均先复现失败，再保持原断言通过。另移除重复的缓存路径检查与 origin 条件，复用现有路径边界；没有新增业务实体、状态、桥接层或生产依赖。

审阅后的 37 项合同、6 项 Web、7 项包内入口和 2 项真实 Electron 窗口检查全部通过，共 52 项。签名后的松散候选目录曾丢失 node_modules，应用完整性校验正确拒绝启动，两个失败测试壳未打开数据目录；验收改用 SHA256 核实后的 ZIP 解压副本，完整签名校验和真实菜单退出通过。没有重签损坏目录或放宽任何校验。详细输入、测试源码、日志 hash、恢复副本和性能观测保存在原[验证记录](patches/2026-10-23-electron-desktop-verification.json)的 `review20261024` 中；早期记录保持其原日期和版本含义。

本机 macOS 27.0 arm64、Playwright 调试连接、假 Codex 和合成对话的一次观测：首次界面及主对话就绪 9.818 秒，同账号重启就绪 3.464 秒；一秒空闲窗口内 4 个 Electron 进程 CPU 合计约 0.94%，工作集合计约 537 MiB。按 [Electron MemoryInfo](https://www.electronjs.org/docs/latest/api/structures/memory-info) 的 KiB 单位换算；工作集求和包含共享页重复计数，不含独立 Node/Codex，并非应用独占物理内存。[CPU 指标](https://www.electronjs.org/docs/latest/api/structures/cpu-usage)在首次取样后等待一秒再读取。文件缓存和机器其他负载未控制，没有原 Swift 壳的同条件比较，也没有真实模型吞吐、长会话或峰值负载测量。

性能观测代码仅在现有测试中，没有加入应用采集、缓存或后台轮询；完整签名与资源校验保留。当前证据支持上述合成场景的正确性与正常退出，不作跨设备、真实负载或绝对性能保证。本次提交只包含本方案代码和验证文档，保留维护工作区其他修改；正式构建继续绑定提交后的准确 SHA，安装尚未执行。
