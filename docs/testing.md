# Homer 测试范围与执行入口

默认回归验证 Homer 自身的对话、调度、审批、成果交付、持久化、权限和适配契约。真实依赖集成与开发发布验收单独选择；测试位置、已有工具或环境变量不能代替明确选择。

## ChatGPT 模型设置

配置、原生目录、账号桥、持久化、线程参数及设置草稿的离线回归沿现有测试文件维护，自动进入默认核心；固定上游组件源码校验登记在显式 `vendor` 分组。

```sh
node --experimental-vm-modules --import tsx --test \
  tests/model-config.test.ts tests/native-account.test.ts tests/native-account-service.test.ts \
  tests/desktop-profile.test.mjs tests/desktop-permissions-ui.test.mjs \
  tests/electron-shell.test.mjs tests/mobile-turn-build.test.mjs
node --test tests/model-selector-upstream.test.mjs
node scripts/build-run-activity-css.mjs --model-selector --check
npm run typecheck
npx --no-install tsc --noEmit -p ui/tsconfig.json
npm run build
npm test
```

测试使用合成 native control、VM Electron、隔离 profile 及本地协议替身，覆盖完整两角色校验、默认覆盖删除、原子保存、分页与隐藏模型、速度权限、失效目录、草稿保留、可信窗口和确认期间导航失效。真实固定引擎的检查扩展既有 `desktop-source-resume.test.mjs`（显式 `engine` 分组）：

```sh
HOMER_TEST_CODEX_BIN=/absolute/path/to/codex node --import tsx --test tests/desktop-source-resume.test.mjs
```

要求已存在的 Codex 0.163.0；独立 HOME／CODEX_HOME、合成模型目录和回环 Responses 验证 `thread/settings/update`、Standard／Fast／Ultrafast、标准清除旧档以及 openai → homer → openai 保留原线程及推理历史。不访问日常账号或收费模型，不以原生模型目录缺少测试档位来推断服务档生效。

交互式 UI 复验运行 `node --import tsx tests/fixtures/desktop-model-settings-browser.mjs --serve`，用内置浏览器打开打印出的回环地址。该 fixture 打包实际 DesktopSettings 与局部官方 CSS，桌面桥完全合成；默认、`?scenario=failure`（首读失败后可重试）、`missing`、`plus` 和 `cancel` 分别检查保存重读、缺失模型、权限收回及取消。`stale-apply` 验证应用被拒后单次重读目录和失效提示；`account-error` 验证账号暂时未知时草稿保留、操作禁用及重查恢复。需要验证桌面、390px、320px、无搜索、无可调深度、三档闪电、键盘、Escape、焦点与 Portal 102；截图保存到 `.codex/scratch/`。此入口仅供显式浏览器检查，不进入默认测试，Ctrl+C 清理该次临时目录。

2026-11-11 在 Node 22.22.0 上，定向七文件584项通过；补充完整角色与草稿、目录未知及失效深度提示，以及复审发现的应用拒绝后单次重读、临时账号未知时保留草稿回归后，设置 UI 94项通过。固定上游源码4项、两端类型检查、构建及最终默认核心2177项通过，均无失败或跳过。固定引擎专项1项通过，包含全部三档与同线程断言；实际设置 Dialog 在桌面、390px及320px完成交互检查，复审新增两条异常路径也通过实际组件的合成浏览器复验。源码通过不表示已安装；真实 Pro $500／企业权限及收费调用、打包后的 Windows／macOS 验收未执行。

## Worker 消息移入对话区

2026-11-11：现有来源、消息包装、过程、队列和主输入回归共143项通过，无跳过；前后端类型检查及隔离 Vite 构建通过。新行为先以9项预期失败确认，再验证实现。覆盖无正文但已开始的可信来源、未开始及跨线程拒绝、精确收到回复快照、缺标题、静默成功、隐藏后的排序屏障、零可见行分页、回焦及用户待发送消息；原有安全、回执和排序断言保留。

```sh
node --import ./tests/fixtures/core-system-proxy.mjs --import tsx --test --test-concurrency=1 \
  tests/{taskcard-sources,taskcard-performance,chat-timestamps,message-queue-web,main-queue-sources}.test.ts \
  tests/{main-chat-display-ui,process-nodes-ui,internal-coordination-ui,restore-official-components,main-composer}.test.mjs
npx --no-install tsc --noEmit -p ui/tsconfig.json
npm run typecheck
```

真实组件验收扩展已有 `web-history-active-pages.browser.mjs`，复用原合成宿主和临时 Chrome profile。先构建当前产品入口到独立 scratch，再显式执行专项：

```sh
node scripts/build-preview-annotation.mjs
(cd ui && ../node_modules/.bin/vite build --configLoader runner \
  --outDir ../.codex/scratch/worker-processing-implementation-20261111/web --emptyOutDir)
HISTORY_FOLLOWUP_BUILD="$PWD/.codex/scratch/worker-processing-implementation-20261111/web" \
HOMER_SYNTHETIC_ROOT="$PWD/.codex/scratch/worker-processing-implementation-20261111/synthetic" \
HOMER_BROWSER_EVIDENCE="$PWD/.codex/scratch/worker-processing-implementation-20261111/browser" \
node --import ./tests/fixtures/core-system-proxy.mjs --import tsx tests/web-history-active-pages.browser.mjs
```

1440、390、320px三组新增场景及原390px分页/草稿场景通过，验证接收前后、标题早于答复、同一消息接续、混合队列与持久取消、展开保留、焦点、草稿、历史阅读位置、刷新和尺寸切换，零真实模型调用。缺少过程条目时仍为原状态行；展开验收使用已有 `start(initialText)` 合成公开进展。取消通过同一 `MainInputs.cancel` 真实 owner 绑定到合成 bridge，未替换产品服务或隐藏 DOM 冒充取消。结果和截图保存在上述 browser 目录，产品源码及专项脚本是复验来源。本次复核在 Node 22.22.0 上通过完整默认核心回归：2130项通过，零失败、取消或跳过。未进行真实账号/模型、日常实例、安装或发布验收。


## 三类范围

| 类别 | 入口 | 选择依据与前提 |
| --- | --- | --- |
| 默认核心 | `npm test` | 项目 Node/npm 依赖、基础系统工具与合成 fixture；可以启动本地协议子进程、HTTP 和临时数据库，不依赖真实模型连接 |
| 可选媒体集成 | `npm run test:local-media` | 涉及媒体读取/识别或发行承诺时；需要 FFmpeg/ffprobe、媒体 Python 依赖、Whisper 和模型 |
| 实际引擎集成 | `npm run test:engine` | 涉及引擎版本、适配、恢复或记忆协议时；固定 Codex 与合成提供方的用例不证明真实模型质量 |
| 主提示词恢复 | `npm run test:prompt-resume` | 评估修复后的 Codex 和更新官方引擎锁时运行。使用显式引擎与包内服务模块，见 [提示词恢复专项](../tests/scenarios/prompt-resources.md#原生请求检查) |
| 账号跨系统集成 | `npm run test:account` | 涉及登录/账号/网关契约或相关发行时；指定的隔离网站、AMH、桌面包和合成登录材料 |
| RTC 依赖集成 | `npm run test:rtc` | 涉及 Chrome/原生 WebRTC 兼容时；需要真实 Chrome 和当前平台的原生依赖 |
| 开发发布验收 | `npm run test:development` | 涉及构建、开发启动、交接、回退、打包、图标或相应发行时；包含编译产物、Git 历史、macOS 工具、Python PTY 和浏览器等前提，不是轻量默认回归 |
| 第三方源码维护 | `npm run test:vendor` | 供应源码、补丁、CSS 或许可文件变化及发行时；验证本地固定源码完整性，不连接上游服务 |
| 桌面产物验收 | `npm run test:desktop:acceptance` | 对明确提供的桌面包、引擎和编译模块验收；保留原有显式路径门槛 |

`npm run check` 仍为构建、类型检查和默认核心回归，不执行上表专项。无需依次运行所有命令：按改动及本次发行实际承诺的能力选择，已有有效证据和未验证项分别记录。普通测试分类调整只验证入口隔离、受影响的离线案例和类型，不据此扩展为全量或发布验收。

默认核心不是纯 JavaScript 跨平台测试：进程身份与锁保护实际使用 `/bin/ps`，部分合成 fixture 使用 `/usr/bin/false`、POSIX 脚本和本地进程/套接字。这些属于 Homer 自身的进程安全与协议契约，保留真实断言；不等同于要求安装可选媒体工具或浏览器。

多渠道首版的离线验收可用 `node --import ./tests/fixtures/core-system-proxy.mjs --import tsx --test tests/channel-host.test.ts tests/channel-plugin.test.ts`。两个文件由默认核心自动发现，使用临时数据库、合成引擎、实际 stdio MCP 桥和内存适配器。覆盖文字收件、消息及准确附件外送、订阅、换绑与重启恢复。

Telegram 群背景的离线验收可用 `node --import tsx --test tests/telegram-context.test.ts tests/telegram-channel.test.ts`。使用合成消息和引擎，验证窗口外的回复链、重叠去重、群和话题隔离、撤权与重启时的待执行请求、限流降级、主 Agent 输入、触发文本持久化及原消息回送。

多渠道真实引擎专项可单独运行 `node --import tsx --test tests/channel-native.engine.test.ts`。使用项目固定 Codex 0.163.0、隔离的 HOME／CODEX_HOME 和 runtime、回环 Responses 服务与模拟适配器。验证旧线程恢复、真实 MCP 调用、补读去重、换绑与未知发送恢复。需要本地已有项目固定引擎；不使用真实模型或渠道。

微信离线回归可用 `node --import ./tests/fixtures/core-system-proxy.mjs --import tsx --test tests/wechat-channel.test.ts`，由默认核心自动发现。使用临时资料与合成 iLink 响应，覆盖扫码授权、私聊来源、重放与轮询退避、解绑、订阅及附件跨重启外送和回执分流。主库和渠道库无需改表。

2026-11-07 的双微信测试账号实网验收覆盖原入口回复、事项订阅、解绑、重启和无新入站 30 分钟后的文字及可打开附件。真实 ChatGPT 配合两个模拟入口分别验证了追问、明确换绑和不指定入口的通知请求。macOS ARM64 本地候选包内宿主也通过微信和 Telegram 重启前后收发。隔日探测独立记录，30 分钟结果不代表平台承诺的通知窗口。

GitHub 构建规划的离线契约可单独运行 `node --test tests/github-build-plan.test.mjs`：只使用 Node 标准库，验证指定平台、未适配桌面目标阻止和完整 SHA 匹配，不执行依赖安装、产品编译或 GitHub 请求。该文件由默认核心自动收集，不属于真实构建专项。

Release 草稿直传的离线契约运行 `node --test tests/github-release-draft.test.mjs`：使用合成包、内存 GitHub 协议及回环 HTTP，验证标签来源、固定附件名、Mac 更新 URL、脱敏清单、完整下载摘要、缺平台及拒绝覆盖已发布版本，不访问 GitHub、不打包或签名。由默认核心自动收集；首次真实云端构建及设备验收分别记录，离线通过不替代它们。

### Windows 截图批注

定向离线回归覆盖两端的桌面壳、设置和截图发送合同。Windows 原生专项需要专用的 Windows x64 交互桌面、Node 22.22.0、已准备的 Electron 45 和未发布候选的 `Homer.exe`。框选会先在内存取主显示器的一帧，运行前确保该显示器上只有合成测试内容。在 PowerShell 运行以下命令。

```powershell
$env:HOMER_WINDOWS_TEST_APP = 'C:\path\to\candidate\Homer.exe'
npm run test:windows-capture
```

专项用真实 Electron 加载候选包里的壳、浮层和会话界面，在两个合成窗口前台分别触发全局键。用回环合成会话检查窗口与区域的像素、反向裁切、批注、发送及历史图片字节。Windows Server runner 的取图探针、Windows 候选打包和 Windows 11 端到端分别记录。[实施与现有证据](desktop-screenshot-annotation.md#6-windows-11-x64)

### 桌面自动更新：源码离线检查

当前 Mac／Windows 更新源及官网下载入口为 GitHub Latest。未签名 Windows 正式包携带显式配置和 latest.yml，后台下载、确认后安全安装；ready 前及安装前流式复核普通文件、大小和 SHA-512，签名模式仍严格验签。复用原 VM／合成归档，不调用真实 PowerShell、安装器、产品构建或日常账号。真实原生升级仍待单独验收。

2026-11-12 未签名 Windows 实施：关键行为用例先红后绿，提交前五文件离线回归 460/460 通过、0 失败、0 跳过；补充的读取期间路径替换用例覆盖两种签名模式及两个校验阶段。未签名构建显式禁用 electron-builder 的 signExecutable，避免环境证书意外启用签名。运行时夹具补齐了当前源码已导入的 readDesktopChatGPTConfig 和 chatgptModelConfig，复用真实模型配置函数，原停止断言保持。准确复验命令：

```sh
node --experimental-vm-modules --import tsx --test tests/electron-shell.test.mjs tests/electron-package.test.mjs tests/github-release-draft.test.mjs tests/desktop-update-stop.test.mjs tests/desktop-update-runtime.test.mjs
```

性能抽查（macOS ARM64、Node 22.22.0，合成 256 MiB 文件，直接执行当前验证函数）：ready／安装前分别 513／502 ms，最大读取块 64 KiB，采样 RSS 峰值增量 45 MiB，事件循环最大延迟 10.7 ms。此为本机合成样本，不能替代 Windows 磁盘、杀毒软件及原生升级性能验收。

覆盖显式未签名／签名及畸形配置、损坏／缺失／非普通文件、SHA-512／大小缺失或不符、缓存及 ready 后替换、异步候选更换、确认／ACK／exit0、失败退出重开、原生清单固定名改写、11 附件集合、缺清单及云端坏下载。官网实际 Svelte 组件隔离回归通过，检查中英文桌面／390px 的“未签名”及原下载／焦点行为；Svelte 静态检查无错误。未运行 Meteor、安装包构建、真实模型、Windows 原生升级、生产官网或 CDN 验收。

以下为上一轮切换 GitHub 来源的历史验证记录。

2026-11-12 更新源切换先以旧地址复现四项定向断言失败，再修改主进程、Forge Windows 配置及生成壳的配置 URL；下列三文件离线回归通过，覆盖 Mac 两架构 feed、Windows generic 地址、未签名禁用、验签及原安全重启合同。未运行产品构建、原生更新、安装或日常 App：

```sh
node --experimental-vm-modules --import tsx --test tests/electron-shell.test.mjs tests/electron-package.test.mjs tests/github-release-draft.test.mjs
```

Yezi2 的设备识别／三平台 Latest 链接和旧 feed／下载 handler 共 11 项离线检查通过；现有真实 Svelte 组件的隔离浏览器回归通过，覆盖中英文、1280／390px、发行详情链接、无固定 build、44px、Escape 和焦点恢复。夹具只转译组件并使用合成账号与商品，不运行 Meteor 或发行构建，不代表生产官网或 GitHub 原生更新已验收。准确网站命令与旧 feed 保留边界见 [官网合同](../../yezi2/docs/homer/desktop-release-data-contract.md)。以下为此前实现的历史验证记录。

2026-11-04 提交前在当前 main 的干净候选重验：下述十文件主命令 455/455、浏览器边界 2/2、静态签名配置 1/1 通过，均无跳过；后端／UI noEmit 与差异检查通过。候选排除其他任务的未提交用例，因此不直接沿用共享脏树的历史数量。未安装新增依赖、构建、安装或发布；真实原生功能与性能未验证，下列共享脏树 schema 基线失败保留原证据范围。

2026-11-04 停止证明与恢复的最小回归（按改动选取）：

```sh
node --experimental-vm-modules --import ./tests/fixtures/core-system-proxy.mjs --import tsx --test tests/electron-shell.test.mjs tests/desktop-update-runtime.test.mjs tests/desktop-update-stop.test.mjs tests/desktop-update-ui.test.mjs tests/process-lock.test.ts tests/engine-rpc-lifecycle.test.ts
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
node --check packaging/electron/main.mjs
```

固定 Node 22.22.0 下六文件最新结果 389/389 通过、0 跳过，后端 noEmit 和差异检查通过。本次沿原 fixture 新增三个案例：首次采样期间父进程已退出的孤儿、与 owner 同时创建且归属不明的孤儿均拒绝确认，合法外部父链继续放行；前两个修改前失败，修改后 19 项进程相关检查通过。此前新增或扩展的 22 个案例继续保留：EOF 后新后代／孤儿、外部 PID 复用、未知时间／快照失败及合法外部进程；停止中报错与 ACK／exit0 的交错顺序、窗口销毁、取消后显式退出，以及缺失证明／超时后的迟到回执、恢复后迟到的安装前验签不能继续安装。保守拒绝边界与状态规则唯一见 [第 6 节](desktop-app-update.md#6-安全停止后才重启)。本次未改 shell 或恢复流程；未调用真实 PowerShell／NSIS、未构建、安装、提交或发布，下列原生未验证项和已有 schema 基线失败不变。

定向执行：

```sh
# 使用项目固定 Node 22.22.0；仅源码、合成子进程和隔离临时目录。
node --experimental-vm-modules --import ./tests/fixtures/core-system-proxy.mjs --import tsx --test tests/electron-shell.test.mjs tests/electron-package.test.mjs tests/desktop-profile.test.mjs tests/desktop-update-stop.test.mjs tests/desktop-update-runtime.test.mjs tests/desktop-update-ui.test.mjs tests/process-lock.test.ts tests/engine-rpc-lifecycle.test.ts tests/homer-account.test.ts tests/web-upgrade.test.mjs
HOMER_TEST_ENGINE_MODULE="$PWD/src/engine.ts" node --import ./tests/fixtures/core-system-proxy.mjs --import tsx --test tests/desktop-browser-boundary.test.mjs
node --test --test-name-pattern='formal packaging requires' tests/electron-package.development.test.mjs
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
node node_modules/typescript/bin/tsc --noEmit -p ui/tsconfig.json
```

主命令沿默认核心文件扩展，没有新增测试文件或改变分类；browser-boundary 仍属原桌面专项，本轮仅通过显式源码路径与 tsx 运行其合成权限断言，不运行包验收。development 文件只显式筛选既有静态签名配置断言；其余构建／产物案例未执行。UI 仍只在内存转译产品 hooks／JSX，用 React DOM 合成环境验证，不生成 UI 包。

本轮 2026-11-04 Windows 源码结果：主命令 431/431、浏览器边界 2/2、静态签名配置 1/1 通过，均无跳过；后端／UI 的 noEmit 类型检查、受影响脚本语法与 diff 检查通过。依赖仅更新声明与锁文件，未安装新增包；测试通过库替身验证协议，不证明实际打包、库动态加载或 Sharp 原生编解码。既有 671 条包记录的版本与完整性未变；新增依赖只进入 Windows 生成 payload，Mac 运行依赖集合保持。

额外执行 `node --import ./tests/fixtures/core-system-proxy.mjs --import tsx --test tests/mobile-desktop-profile.test.mjs`：2 通过、1 失败。固定 schema owner 指纹断言期待 ee1189f5…，本次冻结的共享脏树实际为 fe5ffd2c…；同一冻结输入使用修改前的 sourceSnapshot／schemaHash 逻辑仍得相同结果，确认本轮 Windows 适配未改变该指纹。主检出当前也复现这条既有断言失败。未改相关 schema owner、测试预期或兼容白名单；该基线问题须在后续发行验收前由所属变更处理，不能据此放宽兼容门槛。

三目标的真实窗口／读屏／阅读位置、原生资源与签名升级、正式按用户基线／数据保留、Windows Authenticode／ACL／进程树／无 UAC／NSIS 失败恢复、真实库缓存、上传后的最终 URL 与官网／CDN 均未验证。Windows 发行仍未就绪；获准构建前按 [桌面更新方案](desktop-app-update.md) 第 8.D 节登记真实专项前置条件，不放宽原桌面验收门槛。

历史记录（本轮不以旧数量代替 Windows 验证）：2026-11-04 Mac／共享源码六文件 270/270、静态签名配置 1/1、UI 类型检查退出码 0。

2026-11-04 安装失败恢复定向检查：`node --experimental-vm-modules --test tests/electron-shell.test.mjs tests/desktop-update-stop.test.mjs tests/desktop-update-runtime.test.mjs tests/desktop-update-ui.test.mjs`，261/261 通过、0 跳过。新增八个离线案例：同步抛错／异步报错后的显式重试、退出、取消，以及未保存编辑／页面切换保护；同时覆盖隐藏提示、取消后菜单重试、重复回执，并强化缺少 ACK、非零退出、信号退出不能放行的原断言。六个核心案例先红后绿，使用原 VM fixture，不启动 Electron 或原生安装器；真实失败恢复仍未验证。未修改 UI 源码、打包配置或接口，本次不重复无关构建／类型检查，也不执行安装、提交或发布。

2026-11-04 窗口销毁恢复补充：沿上一段相同四文件命令，265/265 通过、0 跳过。原 VM shell fixture 模拟窗口 close／closed／window-all-closed、页面销毁及销毁后脚本拒绝；新增三个“先关窗、后报错”的重试／退出／取消回归（修改前均失败），并验证无父窗口弹窗、取消后菜单重试、不再停止 runtime、不自动重建页面、不重复安装或 relaunch。另新增确认期间新开窗口拒绝旧确认，并扩展未知停止断言至窗口已销毁的情况；原存活页面、未保存编辑和导航保护仍通过。JS 语法检查通过。未启动 Electron 或原生安装器，真实窗口与安装失败恢复仍未验收；未构建、安装、提交或发布。

Homer 内置文字反馈的离线契约：`node --import tsx --test tests/homer-feedback.test.mjs tests/first-launch-distribution.test.mjs tests/first-launch-distribution.development.test.mjs`。反馈测试使用独立 scratch 目录、合成项目配置及替身 fetch，验证完整 Skill 分发、输入/隐私检查、接收回执和失败不重试；`homer-feedback.test.mjs` 由默认核心自动收集，分发 development 文件仍按原专项归类。首次启动的合成宿主回归按下述代理隔离命令运行 `tests/first-launch-initialization.test.ts`。

反馈真实外发不在默认测试内。脚本已填入用户提供的 Homer 公开写入 projectKey，以及 TraceMind 在线接入指引返回的 HTTPS 用户反馈接收地址（不得填 MCP token）；配置缺失时返回 `not_configured`。另行授权后用独立 Homer runtime/CODEX_HOME 和合成内容验收真实 Agent 调用，在 TraceMind 端按同一反馈编号核对，验证线上项目归属、协议、来源屏蔽、共享限流及大陆网络；离线通过不能替代这些证据。脚本不采集用户身份，但服务端可能记录 IP。

2026-11-03 反馈审查与验证：隔离源码中的反馈／分发测试 13/13 通过，无跳过；覆盖中文分块、长度边界、安装后执行、响应体超时、回执缺失、不重试和固定候选目录复制。`npm pack --dry-run --ignore-scripts --json` 确认 Skill 与脚本均进入包清单，不生成安装包。macOS 原生沙箱禁止读取 CODEX_HOME 父目录、允许读取 Skill 子目录并禁网时，原 Node 命令复现 `EPERM`，加入 `--preserve-symlinks-main` 后取得模拟回执，未放宽权限。Skill 已采用该命令。首次初始化 14 项测试在干净 main 基线与候选中均为 10 通过、4 失败：旧的 failed/uncertain 预期、已移除的 observe fixture、processing 恢复和 FIFO 顺序断言；本任务未修改这些基线断言，也未把其他未提交修正纳入提交。

2026-11-08 首启候选基于 `598be7cee93d`。新增的三项启动回归在基线上均失败，候选通过。Node 22.22.0 下，合成宿主、旧输入恢复与 FIFO、归档 Skill 选择、反馈、账号界面及分发和包清单共 147 项通过，零跳过。`npm run build:service` 与 `npm run typecheck` 均通过。验证使用独立临时数据和合成引擎。打包桌面、跨项目账号专项和真实模型未运行。

2026-11-09 旧首启轮退役回归在 `bc38033` 基线上复现旧排队输入被执行。Node 22.22.0 下 82 项定向检查、2033 项默认测试和类型检查通过，默认测试零跳过。9 项打包 macOS 合成验收通过。桌面新实例零自动模型调用。两次正常重启沿用原线程，未领取的旧首启回执转为取消，结果未知的旧回执未重放，真正的排队消息只执行一次。此处验收使用合成引擎，真实账号未参与。

2026-11-03 17:29–17:36（Asia/Shanghai）另行授权的真实验收：独立 Homer 源码实例和 CODEX_HOME，真实 DeepSeek Agent 自动读取 Skill、整理合成问题并提交；TraceMind 的 Homer 项目按唯一标记和编号 `oa5eBtwTtR3bQip2o` 回查只有一条，标题和正文与提交内容一致，无联系方式、附件或关联行为证据。首次初始化出现 `engine_rpc_failed`，随后 Agent 继续反馈；验收程序总时限在提交后 3.4 秒中断回执等待，服务端稍后入库，因此仅确认真实投递与收件，不代表 Agent 成功回执闭环已通过。没有重发、更新或重启日常 Homer。此次审查不再次真实外发；无代理大陆网络、共享限流阈值及复杂敏感内容脱敏仍未验证。

默认入口预加载 `tests/fixtures/core-system-proxy.mjs`，仅将 `/usr/sbin/scutil --proxy` 替换为固定的无代理设置，不查询本机系统代理，不修改系统配置或代理环境变量。显式专项不加载此替身。`model-config.test.ts` 的合成 CLI/host 子进程单独显式加载它；新增同类子进程也必须显式加载，不能假定普通 `spawn` 会继承 `--import`。代理解析和环境变量转发仍由 `proxy.test.ts` 的真实函数断言覆盖；本机系统代理发现能力未据此验收。

离线定向运行引擎相关核心文件时使用 `node --import ./tests/fixtures/core-system-proxy.mjs --import tsx --test <测试文件>`；直接运行文件不会自动获得默认入口的代理隔离。

默认入口仅在测试子进程的环境副本中清除 `HOMER_MCP_ENGINE_MODULE`、`HOMER_MCP_SERVICE_MODULE`、`HOMER_RECEPTION_SOURCE`，让 MCP/reception 核心回归使用当前仓库源码；不改调用者环境或其他变量。显式专项保留这些变量，但不会因此自动加入核心文件。需要兼容预览时，显式设置所需变量并直接运行对应文件，例如 `HOMER_MCP_ENGINE_MODULE=/绝对路径/engine.ts node --import ./tests/fixtures/core-system-proxy.mjs --import tsx --test tests/project-mcp-lifecycle.test.ts`。原有断言和环境变量控制的维护案例均保留；预览必须使用隔离源码及合成 fixture，不指向日常安装或运行目录。本次仅隔离这三个变量，不处理 UI 的源码覆盖入口。

2026-11-02 源码覆盖隔离的定向证据：新增三个合成入口案例修改前 2 通过、1 失败（默认入口实际加载了替代源码）；修改后入口回归 14/14 通过、0 跳过。验证默认隔离、显式专项和直接文件预览保留覆盖能力，以及无关环境变量保留；四份 MCP/reception 测试内容未改。本轮未运行完整核心或真实兼容预览验收。

2026-11-02 代理隔离的定向证据：入口回归 11/11 通过，新增哨兵案例修改前失败、修改后通过；合成 CLI/host 新建与恢复、代理解析、进程锁及合成 MCP 生命周期共 8 个选定案例通过。未运行全量或真实系统代理验收，未改变其他已记录的未验证项。

专项需要的已有变量仍由原案例定义：engine 中的 `HOMER_TEST_CODEX`、`HOMER_TEST_CODEX_BIN`、`HOMER_OFFLINE_CODEX_BIN`，以及两份 DeepSeek 案例使用的项目固定引擎路径；account 中的 `HOMER_TEST_APP`、`HOMER_TEST_CONNECTION`、`HOMER_TEST_SYNTHETIC_LOGIN` 和网站/网关地址等。不要指向日常 Homer 的账号、runtime、CODEX_HOME 或安装。没有增加第二套连接配置，也不自动安装或下载工具。

已存在的 71 份 `*.browser.mjs` 和 4 份 `*.integration.mjs` 不由默认入口收集。它们仍按各文件的明确入口运行：四份移动联调需要 `HOMER_YEZI2_ROOT`，并非 `test:rtc` 单个依赖互通案例的替代。`scripts/real-*` 等真实模型任务仍需单独的授权、数据范围和预算；发版选择专项不自动授权付费调用。

## macOS CUA 启动与失败收尾

macOS CUA 启动与失败收尾的定向离线检查：

```bash
node --experimental-vm-modules --import tsx --test tests/desktop-cua-driver.test.mjs tests/desktop-cua-lifecycle.test.mjs tests/chrome-cua.test.ts tests/worker-interaction-mcp.test.ts tests/desktop-update-runtime.test.mjs tests/desktop-source.test.mjs
```

这两份新增测试属于默认核心：SDK 子进程仅导入测试临时目录里的合成 SDK，生命周期用 VM 替身，不启动 Chrome、不调用原生驱动或模型、不读取账号。覆盖独立进程与 BigInt、异步启动、十五秒预算、SDK 原因脱敏、父连接断开、阻塞构造器取消、关闭挂起时强制退出、首次读取回滚、清理未确认占用、隔离失败停止、helper 错误分类及未知输入不重放。上述六份定向测试 90 项通过；新增模块已纳入候选源码清单。真实 SDK 的主线程／工作线程双重加载探针曾出现 SIGABRT，产品改为独立 Node 子进程。合入前复核另覆盖损坏／缺字段回执与输入派发后取消：读取失败返回受控协议码，动作保留结果未确认及绑定，不继续输入；合法省略结构化 JSON 的动作回执仍可成功。

2026-11-11 原生验收使用已安装签名 Homer 的独立测试资料和本任务新建的 Chrome，只将 scratch 编译的候选模块与新 helper 用于探针，SDK、驱动和解码器仍为经资源校验的包内版本。先确认旧 helper 无法读取视口，单次 AX 启用请求约 2.2 秒后恢复；候选复用路径首个 helper 约 2.19 秒成功，显式隔离带 AX 启动参数。两条路径均完成真实读取、一次点击和原尺寸纯视口 PNG，尺寸分别为 `2400 × 1472`、`2400 × 1584`，已检查截图；错误窗口与非 Chrome 目标被拒绝，回收均确认。另验一次审批后桌面读取、首读 AX 失败清理后显式重绑、隔离取消后禁止默认回落；真实 SDK 连续启停、1 ms 启动超时分类和启动中取消均通过。新 Swift helper 编译及实际锁屏专用码通过。此范围未使用真实模型、日常资料或既有浏览器窗口，未重打包、安装或发布，不能代替完整安装包与真实 Worker 验收。

合入前使用普通 Node 22.22.0 在独立 worktree 运行完整默认核心：2142 项通过，零失败、取消与跳过；后端及测试类型检查通过。签名安装包的 Node 会拒载开发目录中 Team ID 不同的原生依赖，不用于本轮完整源码检查。

合成 SDK 的独立 IPC 测量（Node 22.22.0）只验证代理传输开销：6 次子进程引导中位数约 24.5 ms，100 次小回包往返 p95 约 0.08 ms，40 次 1 MiB 回包 p95 约 1.09 ms；不代表真实截图、冷系统启动或低配设备的端到端时延。

## Windows x64 CUA

离线回归验证 Windows 依赖锁和签名后资源清单、Worker 命名管道、Chrome 地址栏校验、截图范围、同帧预览缩小以及未确认退出时保留 profile。使用 Node 22.22.0：

```sh
node --experimental-vm-modules --import tsx --test tests/chrome-cua.test.ts tests/desktop-update-runtime.test.mjs tests/electron-package.test.mjs
```

包内冒烟需要 Windows x64 和本地 Authenticode 候选包。沿用 `scripts/build-desktop.mjs` 的签名构建入口，使用已审查的提交、配置好的证书和发布者，不加 `--unsigned-windows`，只保留本地候选产物。当前 GitHub 工作流的 Windows 包未签名，不能替代此步。在隔离账号中将 `HOMER_TEST_WINDOWS_APP` 指向含 `Homer.exe` 的绝对目录，再运行：

```powershell
node scripts/test.mjs --cua-windows
```

该专项核对资源清单和嵌套签名，使用包内 Node 检查 Worker 命名管道，再使用原厂 SDK 和私有驱动，核实无驱动回执时结束 Job、宿主被强杀后回收及残留目录清理。通过只代表包内通信和进程链可用。

真实 Worker 验收在同一候选包、已解锁的 Windows 交互桌面和独立测试账号中进行。`--test-profile` 会替换引擎，不能用于这一步。用户话术只描述任务：

1. 打开同一应用的两个测试窗口，批准指定窗口，读取、点击、键入并保存 PNG。观察目标应用状态，确认另一窗口未变。
2. 用已安装的 Chrome 登录合成站点，确认无远程调试参数、端口和 `DevToolsActivePort`。要求 Worker 在原标签页导航并点击，服务端确认登录态和一次点击。分别核对正常与高 DPI、书签栏开关下的纯视口 PNG。再显式要求临时隔离，核对独立 profile 和未登录状态。
3. 从原会话下载桌面和网页 PNG，对照任务原件的 SHA-256；至少一张大于 2 MiB。依次复测取消、驱动无响应和强退重开，确认已有 Chrome 保留、临时 Chrome 及子进程和 profile 已回收，未知动作不重放。另测强杀完整宿主进程树时的旧引擎退出证明；被现有接管检查拦下时保留失败证据。

本轮只运行了离线检查、官方归档核验及 Windows x64 辅助程序交叉编译。没有签名候选包或 Windows 交互桌面，包内冒烟和真实 Worker 验收仍未运行。

## 结果与过滤

- 默认启动时列出专项未运行／未验证，不因已有环境变量而启用专项。
- 原真实断言、环境门槛和已有条件跳过均保留。本次不新增缺项跳过。专项启动时提示 skipped/not-run 仍未验证；退出码 0 不代表被跳过的案例通过。
- 断言失败保留非零退出；空套件明确失败；信号和 Node 测试参数继续传递。指定 `--test-name-pattern` 未执行的案例同样没有验收证据。
- 可按稳定案例名过滤，例如 `npm run test:development -- --test-name-pattern=HMR-UPGRADE-001`；需要编译资源的案例须先在独立副本准备构建。直接指定测试文件也是显式执行，不受默认收集边界保护。

移动设备下载弹窗的焦点回归可单独运行 `node --test tests/mobile-download-focus.development.test.mjs`。该开发专项需要项目 Node 依赖及已安装的 Chrome；使用隔离浏览器配置和合成设备数据，阻断页面外部请求。

## 分类维护与本次拆分

`scripts/test.mjs` 是入口分类的唯一维护清单；默认核心排除所有显式清单文件，本地媒体沿用 `*.local-media.test.ts/mjs` 命名。新增专项文件必须登记，入口回归 `tests/test-suites.test.mjs` 用合成失败案例验证专项不会泄漏到默认运行。

| 原混合文件 | 默认保留 | 移出的文件 |
| --- | --- | --- |
| `dev-upgrade.test.mjs` | 监视排除范围 | `dev-upgrade.development.test.mjs` |
| `web-feedback-host.test.ts` | 反馈协议、身份、冻结及合成流式 fixture | `web-feedback-host.development.test.ts` |
| `electron-package.test.mjs` | 合成清单及打包钩子契约 | `electron-package.development.test.mjs` |
| `first-launch-distribution.test.mjs` | Skill 分发及用户文件/链接保护 | `first-launch-distribution.development.test.mjs` |
| `task-status-css.test.mjs` | CSS 范围、动画、无障碍及状态渲染 | `task-status-css.vendor.test.mjs` |
| `prompts.test.ts` | 读取、缺失、快照及合成同线程恢复 | `prompts.development.test.ts` |

提示词案例复用 `prompt-resources-fixture.ts`。六份原文件中的 29 个测试体及 163 处 assert 调用逐字保留；其中 19 个案例留在默认，10 个移到专项。31 份整文件仅调整收集归属，未改其内容。网关禁用令牌案例、历史调查脚本等待确认删除/转移项全部保留。

2026-11-02 本轮静态核对及离线定向验证结果：

- 入口行为先在原脚本复现 7 项失败；修改后 10/10 通过，覆盖默认排除、已有环境变量不启用专项、显式选取、参数/失败传播和跳过未验证提示。
- 六份拆分后默认文件共 19/19 通过、0 跳过；TypeScript `tsc -p tsconfig.check.json` 通过。
- 实际入口清单互斥且所有列入文件存在：核心 282、开发发布 21、vendor 8、引擎 5、账号 2、RTC 1、本地媒体 10、桌面 7 个文件。文件数是本轮快照，不代替案例执行结果。
- 独立只读 review 未发现阻断采用的 P1/P2；31 份整文件校验不变，29 个原测试体及 163 处断言保持。采用前核对修改路径没有并发冲突，并验证采用内容与隔离版本一致。

证据保留在 `.codex/scratch/test-boundaries-20261102-7h1i065z/` 的对照副本、入口/定向/类型检查日志和静态校验记录。未运行任何完整套件、真实专项、工具安装或付费调用；此前 Whisper 缺失、全量磁盘不足及 Web 热更新未验证记录仍有效，不因分类调整变成通过。

提交范围说明：上述计数与检查记录来自当时完整工作区，不是单独提交的全量结果。本次提交只收录测试边界及隔离调整；其他未提交功能的新增测试、原生图片能力、打包修复和历史公共指南保持在工作区，待各自功能提交。原已提交用例的断言随归类保留，未重新进行真实工具或完整验收。

提交候选复核：在当前 HEAD 加本次边界改动的独立副本中，入口与轻量核心定向检查 30/30 通过、0 跳过；原已提交测试的 461 处断言静态核对均保留。较大范围的候选试跑曾在主恢复案例处达到 120 秒上限，未计为通过；未追加全量或真实专项。

## 网站授权与开发 Token 退役的离线检查

使用项目 Node 22：`node --experimental-vm-modules --import ./tests/fixtures/core-system-proxy.mjs --import tsx --test tests/homer-account.test.ts tests/electron-shell.test.mjs tests/desktop-permissions-ui.test.mjs tests/desktop-deepseek-engine.test.mjs`。仅使用临时凭据、本地假服务、VM 桌面壳和协议 fixture；`desktop-deepseek-engine` 名称下保留的是网站 Main/Worker、双向来源与同一主对话断言。手填 Token 实验脚本及其专属测试已删除。包内私有管道拒绝手填 Token 的检查沿现有 `macos-desktop-runtime.test.mjs` 桌面专项，必须指定隔离测试包与目录，不指向日常资料。

会员通用模型配置离线专项：`node --import tsx --test --test-name-pattern='pinned generic|adopts delivered membership context' tests/deepseek-pinned.test.ts`。仅使用固定 Codex 0.163.0、全新 scratch HOME 和脚本化回环 Responses；覆盖两角色窗口回读，以及恢复线程后模型名/自定义 effort 切换、null 清除旧推理强度。仅此名称过滤不会运行文件内其他引擎案例；未调用真实模型，不替代真实网关容量或安装验收。完整合同与能力字段见 [会员模型配置](2026-11-04-membership-context-config.md)。

## 会员视频工具验收（2026-11-06）

Homer → New API 正常路径在隔离环境通过。New API 为 `v1.0.0-rc.45-homer-turn-2b914532dbe5`，可执行文件的 SHA-256 `beb0ba83c888cacfbfe4f482109ebc022c61201c1c9b2aa846a322eadc053190` 与生产容器一致。验收使用独立 SQLite 和有限额的测试 Token，由脚本驱动 Homer 会话，通过实际 Web 界面的审批卡确认，模拟百炼返回用量和 MP4。测试请求只进入本机隔离网关。

| 检查项 | 实际结果 |
| --- | --- |
| 提交与查询 | 确认前零提交，确认后只提交一次。`wan3.0-video` 按 5 秒、720P、16:9、有声提交，查询到 `completed` |
| 播放与下载 | 聊天内可播放，浏览器下载与原文件逐字节一致。`ffprobe` 读回 5.000 秒、1280×720、H.264 视频轨和 AAC 音轨 |
| 结算 | 同一任务只有一条消费日志。测试 Token 剩余额度从 1,000,000 降至 794,521，已用额度增加 205,479，与日志一致，按配置折合约 300 积分 |

常规离线回归运行 `node --import tsx --test tests/membership-web-tools.test.ts`，覆盖 Main 和 Worker、审批拒绝、提交结果丢失、停止与重启取回、回执权限及异常下载。本次隔离验收费用为零。生产真实生成、百炼账单、网关跨 Token 隔离及零余额取回仍待单独验收。

## 手机新版轻提示定向检查（2026-11-03）

源码验证入口：

```sh
npm test --prefix mobile
npm run typecheck --prefix mobile
npx tsc --noEmit -p ui/tsconfig.json
node --import tsx --test tests/mobile-client.test.mjs tests/mobile-request.test.mjs
node --import tsx --test tests/mobile-ui-build.test.mjs
node scripts/build-mobile-ui.mjs .codex/scratch/mobile-update-implementation-20261103/ui
```

前四项为离线合成检查；移动测试中的原生壳、SecureStore、SDK 和发行响应均为合成夹具，键值区分绑定、取消和更新关闭记录。浏览器项需已有 Playwright／Chrome，沿 development 专项登记，使用独立合成快照和 scratch 输出，不访问日常账号／runtime，也不发真实模型请求。UI 打包仍使用实际产品入口，过滤仅供本地 Live 调试的注入脚本；不生成原生安装包。

2026-11-03 的历史记录为移动测试 32/32、桥接／请求 17/17、浏览器 2/2 通过，均无跳过；两端类型检查和独立 UI 打包通过。autolinking 只验证元数据可发现，不能替代原生编译链接。真实键盘／读屏、有消息时阅读锚点、iOS storefront、正式覆盖安装及 Yezi2 缓存撤回传播／实际安装包下载仍待后续定向验收；额外内置浏览器 file:// 复核遭工具策略拒绝，不算通过。详细范围见 [手机提示方案](mobile-app-update-notice.md#验收清单与当前证据)。未运行无关全量、TURN 长测、原生构建、安装、发布或付费模型任务。


## 补丁成果预览

`node --test tests/diff-viewer-preview.test.mjs tests/mobile-client.test.mjs` 验证实际 CanvasReader、固定 DiffViewer 与 parser、MIME 分流、资源门槛、原文／下载、异常和共享移动下载适配；使用合成 HTTP、DOM 与剪贴板，不连接账号或模型。新增 `diff-viewer-preview.test.mjs` 由默认核心自动收集。

真实浏览器继续使用已存在的 `tests/preview-tabs.browser.mjs`，不加入默认测试或创建新的专项入口。先对当前 UI 做类型检查，生成 Canvas CSS，并将 Vite 产物输出到独立 scratch：

```sh
node scripts/build-run-activity-css.mjs --canvas-split
node node_modules/typescript/bin/tsc -p ui/tsconfig.json --noEmit
(cd ui && ../node_modules/.bin/vite build --configLoader runner --outDir ../.codex/scratch/patch-preview-review/web)
HOMER_PATCH_PREVIEW=1 \
HOMER_SYNTHETIC_ROOT=.codex/scratch/patch-preview-review/fixture \
HISTORY_FOLLOWUP_BUILD="$PWD/.codex/scratch/patch-preview-review/web" \
HOMER_REVIEW_EVIDENCE_ROOT=.codex/scratch/patch-preview-review/browser \
node --import tsx tests/preview-tabs.browser.mjs
```

需要项目 Node 22 依赖、现有预览批注 runtime 构建产物和已安装的 Chrome；缺少 runtime 时先按既有构建流程在独立副本准备，不操作日常 Homer。测试使用新建 Chrome profile、合成 HTTP owner 和临时存储，阻断页面外部请求；覆盖 1440／390／320px、真实输入事件、下载字节、剪贴板、回退、切换及资源清理，记录截图和局部 long task。手机宽度模拟不代替 iOS／Android 实机验收。浏览器脚本退出 0 仍须人工审阅截图；记录长任务不代表无卡顿。


## 合成浏览器回归

工作状态与事项标题可定向运行 `tests/task-status-count.browser.mjs` 和 `tests/task-status-pinned-runner.mjs pinned`，截图写入显式指定的 `HOMER_BROWSER_EVIDENCE`。完整产品入口使用 `HISTORY_FOLLOWUP_BUILD` 指定当前源码的 UI 构建，合成数据使用独立 `HOMER_SYNTHETIC_ROOT`。

`pinned` 同时覆盖长事项、长 Worker 回复及真实执行记录的整页滚动回归，先确认隐藏读屏状态元素存在，再检查 1440×900、1440×520 与 390×780 下整页和外层分栏无滚动范围，顶栏与输入区保持窗口边界。实际滚轮及键盘检查列表独立滚动、关闭重开后的阅读位置、事项展开收起和窄窗 Escape 回焦；测试仅使用合成数据与独立 Chrome profile。2026-11-11 本机 Chrome 合成验收 69 项通过，相关离线检查 11 项及 UI 类型检查通过；未打包安装。

HTML 预览定向运行 `node --import tsx tests/html-annotation-lifecycle.browser.mjs` 与 `node --import tsx tests/html-render-first.browser.mjs`，分别指定独立 `HOMER_REVIEW_EVIDENCE_ROOT`；后者还需上述 UI 构建与合成目录。覆盖原生 Add 失败保留输入、重试和 ACK、退出与跨断点、1440／390／320px 的实际 Tab 焦点环、脚本预览与主输入发送。保存即写主草稿，测试沿原 Add／update／delete／clear 协议，不等待旧 Send 导入。

macOS 启动 Chrome 的执行会话需要具备 LaunchServices 和 WindowServer 访问权限。若在 `_RegisterApplication` 阶段 SIGABRT，先按崩溃报告中的进程号及实际启动时间核对系统日志；仅有退出信号不足以判定根因。2026-11-07 的 PID 94978 被明确记录为 `Sandbox restriction`。在具备相应权限的执行会话中使用原启动器及全新 profile 验证，保留 Chrome 沙箱，独立 profile 不访问日常浏览器资料。

2026-11-09 在 Homer 0.1.6 build 291 的实际 Worker 中，默认 `:read-only` 同时拒绝了 profile 写入和上述系统服务访问，Chrome 在加载页面前 SIGABRT。经单次审批后，Chrome 157.0.8103.38 的 `--screenshot` 能写出 PNG，但退出时线程池仍有 Chrome Safe Storage 的 Keychain 查询，watchdog 以退出码 2 终止进程。若需用 Chrome 命令行截图验证本地合成页面，可在全新、一次性且无账号数据的 profile 上加 `--use-mock-keychain`。同一 Worker 仅增加此参数后，`--dump-dom` 和 `--screenshot` 均以 0 退出，PNG 字节与对照一致。该参数只用于合成测试，实际浏览器资料或登录流程应使用正常的 Keychain。项目浏览器专项继续使用下文的 CDP 流程。

`scripts/test.mjs --browser` 显式运行 12 个已维护入口（另有一份共享 fixture），不自动收集其他历史浏览器脚本，也不进入默认测试。本专项沿现有 macOS Chrome 路径运行，需要 Node 22、项目现有依赖和当前源码的 UI 构建；在独立源码副本生成 annotation runtime、CSS 和 Vite 产物，不使用日常账号、runtime 或 CODEX_HOME。

```sh
HISTORY_FOLLOWUP_BUILD="$PWD/.codex/scratch/browser-regression/web" \
HOMER_SYNTHETIC_ROOT="$PWD/.codex/scratch/browser-regression/runtime" \
HOMER_BROWSER_EVIDENCE="$PWD/.codex/scratch/browser-regression/evidence" \
node scripts/test.mjs --browser
```

构建目录必须指向事先生成的当前 UI。覆盖文件列表、过程折叠和焦点、后续待答及队列页、精确授权/撤销、分页/重连/延迟图片锚点、完整正文复制及文件字节、长文排版和真实 100%/200% Chrome 缩放。旧原生选择框、源码默认、活动阅读器和应用内成果下载入口不恢复；旧线程原答复授权仍从真实 HTTP owner 检查。历史 V2 构建对比已退役，长文样本保留在 kerning 入口；测量值不代表性能达标。退出码之外仍需审阅截图；窄屏模拟不代替移动真机验收。


## 固定原生协议与合成验收入口

这些检查需要已有的 Codex **0.163.0** 二进制和项目 Node 22 依赖；不自动下载、升级或使用日常 HOME。原生进程是真实的，但模型响应及 MCP 服务均由本地合成 fixture 提供，不使用真实账号或付费模型。

```sh
HOMER_TEST_CODEX_BIN=/absolute/path/to/codex node --import tsx --test tests/native-protocol.engine.test.mjs
```

该文件登记在显式 `engine` 分组，默认测试不执行。覆盖项目配置层与信任、原生 MCP 回环调用、压缩终态与关闭、原生 Skill 发现和禁用、本地插件安装与卸载、同一线程安全恢复。执行探针在独立 Codex 配置中明确选择权限，并核对读写、网络与工具采用。生产启动参数的回归覆盖默认配置、冷恢复及 `controlOnly` 隔离。

原生工具接线候选在 Node 22.22.0 下运行 `npm run check`，2042 项通过，零跳过。固定 Codex 0.163.0 专项通过 6 项，覆盖 Main／Worker 实际调用、原生 MCP、Skill、插件和同线程冷恢复。隔离 macOS ARM64 包用真实 ChatGPT 验证了空配置下批准一次、显式允许执行时直接运行，两组都通过独立 Chrome profile 完成本地测试页的输入与点击。合成请求另验证了原生审批的长命令可以完整显示和执行。超过审批卡完整展示上限的命令仍会拒绝。Windows 待验。

2026-11-08 隔离候选基于 `1e042f870aa0`。普通主轮将 `$skill` 随正文交给固定 Codex 解析。每轮原生目录强刷、首次启动及真实归档的结构化选择沿用原有路径。使用 Codex 0.163.0、独立 HOME 和合成回环 Responses 比较保留与省略普通主轮结构化选择的 8 次请求。唯一启用项两边都注入正文，禁用项均未注入，两个同名启用项仅在旧路径注入两份正文。附件提取内容里的裸名称两边都经原生文本解析注入，属于现存行为。描述标记与正文标记分别核对。普通主轮、首次启动及归档的定向服务回归共 33 项通过。

2026-11-08 主轮附件正文隔离候选（基线 `868d4e2`）。主轮用户文本保留附件元数据及引用，正文经现有 `inspect_attachment` 结果返回。固定 Codex 0.163.0、独立 HOME 和回环合成上游对照复现旧路径的附件 Skill 正文注入。候选上游收到含裸 `$skill` 的完整 TXT 工具结果，首次读取和历史重读均未注入对应 Skill。同轮用户显式 Skill 和结构化归档 Skill 仍注入。归档选择由服务测试覆盖，原生协议探针直接提交结构化输入。声明支持图片的合成模型接收一张 PNG 和六张 MP4 抽帧。附件工具、历史授权、归档及本地图片和视频定向回归 25 项通过。文件名、引用和预览摘录不在本次范围。未运行真实模型或验证各附件格式的实际任务表现。

2026-11-08 ChatGPT 新会话直连复验（基线 `ab71391`）。固定 Codex 0.163.0 与隔离回环 TLS 上游覆盖 Main 派工、新 Main／Worker 的 WebSocket 101、426 后 zstd SSE 回退、HTTP CONNECT 和 `NO_PROXY`。重启后两个线程以原 ID 经现有历史桥续聊，并带回首轮历史。拒绝 CONNECT 时，基线与候选都没有推理请求到达上游，账号检查均直达回环。候选在代理放行时通过代理发出账号检查，拒绝后由 Codex 的启动 GET 重试采用系统路由，CFNetwork 对测试回环地址选择直连。跨来源恢复、历史桥及代理定向回归 8 项通过。未使用真实账号或模型。

2026-11-08 固定 UI 维护入口复验（基线 `9d47409`）。固定 UI 启动器与同版本冻结后端共用完整动态工具指纹。隔离合成测试 3 项通过，覆盖原线程启动、UI 回退、篡改与锁拒绝，以及旧的部分指纹被拒绝。固定 Codex 0.163.0 回环专项在主服务中以原 `threadId` 续聊，上游收到前一轮用户消息和助手回复。桌面服务、CLI 和恢复检查 88 项通过，服务构建及类型检查通过。历史冻结包与新启动器混用未验。

交互式合成调试可显式准备独立的 UI 构建和 `HISTORY_FOLLOWUP_BUILD`，再运行 `node --import tsx scripts/recursive-acceptance.ts`。真实账号、打包桌面及 Chrome 的结果分别记录。Chrome 使用独立 profile，以 DevTools 就绪和原进程退出为准。

## 授权与咨询完成卡片

离线回归（Node 22，合成数据与临时数据库）：

```sh
node --import tsx --test tests/web-history-loading.test.ts tests/main-native-approvals.test.ts tests/service-main-native-approvals.test.ts tests/worker-interactions.test.ts tests/question-flow-contract.test.ts tests/approval-card-ui.test.mjs tests/user-message-bubble-ui.test.mjs
npm run typecheck
./node_modules/.bin/tsc --noEmit -p ui/tsconfig.json
```

显式浏览器专项：

```sh
node scripts/build-preview-annotation.mjs
HOMER_BROWSER_EVIDENCE="$PWD/.codex/scratch/interaction-completion-browser" node --import tsx tests/interaction-completion.browser.mjs
```

脚本构建实际产品界面，复用合成 HTTP/SSE 服务、原审批处理器和历史展示投影；使用本机已有 Chrome、独立浏览器资料及 scratch 内合成 SQLite 数据库，不连接账号或真实模型。覆盖 1440、390、320px 的允许、拒绝、多题和自由回答，允许流程先模拟回执未知并显式重试，再核对刷新、关闭并重开数据库后仍只有一张完成卡片。审批完成态检查固定 ApprovalCard 的原生状态区与准确决定文案，移除所有审批按钮和详情入口；咨询完成态检查固定 QuestionFlow 的 `receipt` 状态、全部原问题和答案同时可见、自由文字原样换行，且没有提交控件、自定义箭头或题号；刷新及重开数据库后保留同一份完整回执。每种场景保存 PNG，汇总写入指定证据目录的 `results.json`。可用 `HOMER_COMPONENT_BUILD` 指定已构建的隔离产品 UI。此脚本登记于显式 browser 清单，不进入默认离线测试。

审批、咨询原有专项继续使用 `tests/approval-card.browser.mjs` 和 `tests/question-flow.browser.mjs`，分别检查提交、重复点击、连接变化、迟到回执、失效与草稿。以上均为合成验收，不代表日常资料、真实账号或已安装 App 验收。
