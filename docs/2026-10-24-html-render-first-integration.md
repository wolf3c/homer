# HTML 成果默认网页与一键批注

2026-10-24，已将用户通过的 `html-preview-render-first-demo-20261024` 交互接入维护源码。工作分支为 `main`，任务开始 HEAD 为 `5afa91483870fd69fb281bc1bd5c2e24470dd3ba`。没有提交、创建分支/worktree、部署、安装、重启或访问真实账号/消息/模型，当前 Appbuild52 不因本次源码工作而采用这些变更。

## 产品行为与归属

HTML 从对话成果入口打开就显示真实静态网页。仍通过原 `connectionFetch('/api/files/:id')` 和发布成果 owner 读取准确文件、文件名及 SHA256；不把 HTML 写入主应用 DOM。原 sanitizer、空 `sandbox`、首位 CSP 禁脚本/禁网继续负责默认阅读。外部资源不被假装加载，内联 CSS 按原安全界限呈现。

标题仅保留文件名、铅笔短“批注”、次要源码/返回、关闭。`CanvasSplitHeader` 只增加可选 `actions?: ReactNode`，Document/Body 和原标题/关闭默认几何保持；沿用现有 TooltipIconButton。tooltip/aria 明示启用批注会运行当前网页脚本。连接中 `aria-busy=true`、`aria-pressed=false`，收到当前桥的真实 active 才按下；ready/connected 不等于正在选择。

一次标题操作才为当前成果 id+sha256 与当前 iframe 代际加载隔离 Agentation。仅增加 `allow-scripts`，没有 `allow-same-origin`、外站注入、MCP、webhook、endpoint 或网络例外。父层按真实 iframe window 和当前 token 判断消息，不信子页提供的来源 ID。动态 import 返回时校验当前代际；迟到 A 不会运行或导入 B。HTML 来源始终是正式 artifact ID/hash/title，子文档的 `about:srcdoc` 不会变成网页来源授权。

原 Agentation 深色 popup、toolbar、Add/Cancel、Send 和实际元素选择保留。原生 Exit、Ctrl+Shift+F、标题再次点击、源码、关闭都销毁运行 iframe 并退回静态；Pause 只暂停动画。超时或运行错误显示必要重试提示并退静态。清理当前监听器、计时器与 token；不能中断的 bundle 下载返回后也不会恢复旧授权。

已点 Add 的原始网页备注只在当前 thread 内按 artifact ID+sha256 的会话 Map 保留，关闭/重开和源码往返可恢复；不同文件、版本与 thread 不混用。未点 Add 的输入沿原库生命周期取消。未导入备注只在内存，静态/源码下准确说明已保留条数与会话范围；刷新仅重建原主草稿中已导入的网页引用。没有新增批注数据库、queue、entity 或持久运行时。

原生 onSubmit 仍调用正式 `onReference`，只导入原主 Composer；用户明确发送才走原 `/api/messages`、主队列和 Agent 上下文。正文、普通附件、单来源互斥、requestId/哈希/未知回执规则保持；失败保留备注和草稿，busy 防重复。源标题、元素与位置仍是来源数据，只有备注/正文进入用户意图。桌面聚焦原 Lexical 并保持历史位置；窄屏先关闭原 Base UI Dialog 再聚焦。HTML 源码继续已有安全文本多处批注，和网页元素批次分开。

原 337px 工具栏只在预览文档 shadow root 内补已验收的小于360px缩放。插入样式的 observer 只看 body 直接子节点，成功、超时或卸载即清理，不观察主应用。原分栏库 active 时，局部 CSS 临时让预览 iframe 不参与鼠标命中，释放后恢复；修复拖动进入隔离 iframe 后父文档丢失后续事件的问题。没有新拖动状态、事件订阅或全局禁用。

## 固定补丁、构建与许可

Agentation 仍为 **3.1.2 / PolyForm Shield License 1.0.0，不是 MIT**。仅采用用户批准的 5 hunks、+10/-2 补丁，原单一 `activeState/isActive` 保持：`defaultActive` 只在首次挂载读取、缺省 false，`onActiveChange` 报告原生状态且卸载不发 false。不是上游公开 API；不模拟 Start 点击，不以演示备注代替真实选择。

维护源码在 `ui/vendor/agentation-3.1.2/`：准确原件、输出、类型镜像、完整 LICENSE、输入哈希锁、差异、统计和修改说明。`scripts/patch-preview-agentation.mjs` 验证安装包全部锁定输入、原件、精确补丁输出及许可；正常 build/dev 的 `build-preview-annotation.mjs` 必须先验证。版本/字节不匹配就失败，不修改共享 node_modules，不下载升级或模糊应用。

| 固定源码 | SHA256 |
| --- | --- |
| 原版 ESM | `1a4d069438c9f218d20eab31150e5c2b1c6ef05c526135bd10dd492950023b1e` |
| 修改 ESM | `dad6472d5c828cf9ebfa70a37b8317ac63fdd31fbe1731ca436d22a5782ab629` |
| 原版类型 | `ad53930a48adf24d58dd40e6d469c2e54f8133c619e490af9a4a77e84c78b438` |
| 修改类型 | `c26b1e60aff2a341cd0462cdf12621896f0c192a8d126085f437e57650c273c8` |

完整 PolyForm Shield、原版权、modified-source 说明及运行包 React/React DOM/Scheduler 许可进入正常 notices 输出。只是在用户本机使用方案内接入源码；不宣称商业许可或公开分发豁免。未来升级必须重新审查状态 owner、输入哈希与补丁并复跑原版缺省路径和产品浏览器合同。

正常构建连续两次生成的 **73 个文件逐字节相同**。当前共享候选（含并行图片任务的源码）主入口 1,860,567 字节 / gzip 571,411 字节，懒加载 HTML runtime chunk 666,781 / gzip 167,351 字节，iframe IIFE 660,805 / gzip 167,092 字节；gzip 为固定 mtime、level 9。普通聊天及静态 HTML 不请求批注 chunk。保留已有大于500kB chunk 提示，不据此保证所有设备性能。正常生成器还会重写一处不属于本任务的 task-status CSS，已恢复开工原字节，没有将其作为 HTML 改动交付。

## 验证与证据

任务证据目录为 `.codex/scratch/html-preview-product-integration-20261024/`。所有内容和账号身份均为需求推导的合成输入，Chrome 156.0.8078.48 使用新 profile；只访问任务专属 HTTP 端口，fake engine 不执行真实模型。不是生产运行证据，也没有验证实体 iOS/WKWebView 或真实软键盘。

| 验证 | 观察结果 |
| --- | --- |
| 精确前像红测 | 默认源码、无短标题批注入口、仍需原生第二次 Start；`red-results.json` |
| 最终当前共享源码三屏 | 54 项通过，1440/390/320；`verified-browser/browser-results.json`，每次 1 个标题入口、0 次原生 Start 点击；含真实 popup、多备注恢复、脚本提示、Space、原主 Composer/HTTP、窄屏关闭与真实 Lexical 输入 |
| 最终生命周期 | 19 项通过；`verified-lifecycle/results.json`，错误 window/token、重复握手单实例、慢加载切换、失败/忙态保留、跨断点、原生快捷键/退出、未保存输入、超时/错误、只读、新哈希/thread |
| 宽屏并列/拖动 | 4 项通过；`verified-layout/results.json`，2560px 摘要与预览并列、实际鼠标拖窄到800px以内、同一 iframe 保持、导入不跳历史、外层额外滚动为0、Composer 贴底 |
| 补丁缺省兼容 | 13 项通过；`compat/compat-results.json`，原版/补丁省略 props 时均保持原生手动启动，扩展初值/回调/卸载行为一致 |
| 引用/授权/发布/旧队列合同 | 39 项通过；`contracts-final.log` |
| 实际 Homer 服务 HTTP 与 Agent 上下文 | 7 项通过；`service-http-v2.log`。HTML 批次经原 `/api/messages` 到真实服务 owner、主队列和 fake Agent 上下文；伪哈希/标题拒绝，来源后来过期仍允许原请求准确重试，新请求拒绝；备注授权与来源分离保持 |
| 原文本多处批注 | 43 项通过；`verified-text/browser-results.json`，原 IME、恢复、未知回执、分栏和多处备注回归 |
| 原选区/HTML源码 | 45 项通过；`verified-selection/browser-results.json`，包括原代码、有效/错误/混合 math fence 与 HTML 源码安全引用 |
| 数学/慢加载 | 34 项通过；`verified-edge/browser-results.json` |
| 原图片/网页合同 | 31 项通过；`image-browser/browser-results.json`，为并行图片接入之前的单矩形实现，不能作为后来的多区域实现验收 |
| 官方 Canvas / 受控外站桥 | 分别102/21项通过；`official-browser/`、`external-bridge/` |
| 类型/正常构建 | UI及服务端源码类型通过。全仓仍12条既有诊断，`final-typecheck.log` 与开工 `typecheck-before.log` 逐字节相同。不是全仓全绿 |

精确输出哈希、raw/gzip、完整许可、受保护文件和 index 条目核对在 `verified-build-manifest.json`。截图均为真实页面：`verified-browser/default-{1440,390,320}.png`、`one-click-popup-{width}.png`、`source-{width}.png`、`tooltip-{width}.png`、`composer-{width}.png`；另有超时/已连接仍忙态和宽屏摘要/拖窄/焦点截图。

保留初次失败记录，没有将它们改称成功：红测按钮定位器、测试脚本字符串、Header 缺少原样式作用域、原生 Exit 销毁 CDP session、夹具 HTML MIME、原生入场/焦点时序、分栏跨 iframe 事件丢失、Node HTTP 缺少 Origin。HTML 发布旧 fixture 缺少实际 `previewArtifact`；已绑定 `Homer.prototype.previewArtifact`，未实例化真实 Homer 或复制模拟校验规则。正常成功以表中最终记录为准。

复跑入口（先将 `HISTORY_FOLLOWUP_BUILD`、`HOMER_SYNTHETIC_ROOT` 和证据目录设为自己的任务 scratch，不能指向运行中的服务/用户数据）：

```sh
npm run build --workspace=homer-web -- --outDir ../.codex/scratch/html-preview-product-integration-20261024/verified-web
node --import tsx tests/html-render-first.browser.mjs
node --import tsx tests/html-annotation-lifecycle.browser.mjs
node --import tsx tests/html-preview-layout.browser.mjs
node tests/agentation-preview-compat.browser.mjs
node --import tsx --test tests/agentation-preview-patch.test.mjs tests/html-preview.test.ts tests/canvas-html-publication.test.ts
node --import tsx --test --test-name-pattern='preview|file annotations|all text remarks' tests/web-service.test.ts
```

## 共享开发与回退边界

任务没有暂存文件，Git index 条目与开工一致；package/lock、已验收 `ui/homer-styles.css` 滚动修复及 `ui/process-nodes.tsx` Worker 卡片与开工字节相同。文本多批注的既有未提交内容保留。

执行期间，另一任务在共享 main 接入了图片多区域，并扩展 `CanvasPanel`/`HomerApp` 与图片来源合同。本任务没有实施、回退或验收其图片功能。最终54项 HTML、19项生命周期及4项布局在包含这些并行改动的准确候选上通过；原单区域31项结果单独标明。后续图片验收归其 owner，不能将其并入本次 HTML 成果声称已验收。

本次修改为 HTML 预览/桥、正常构建固定补丁、Header 的必要槽、thread 会话备注接线、分栏局部 iframe 命中修正与相应测试/维护文档。`before/` 保留开工前像，`task-only.patch` 为 HTML 任务归属差异；共享文件另保留当前快照及身份说明。该补丁面向开工前像供 review，不应在后来的并行图片源码上整文件回滚。回退只能精确移除 HTML owner 的 hunk，并协调保留已共享的 Header actions 槽与图片/文本合同。未提交、未安装，运行 App 不变。
