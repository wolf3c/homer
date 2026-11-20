# 浏览器与 Preview 优化复审（2026-11-18）

基于 main `e3434e27` 加本事项精确候选复审，源码提交为 `d7262abc28790928f66a5070b3afffd380c786ea`，不混入共享树的消息图片、队列、模型或其他方案改动。本文记录源码与隔离验证；提交身份以 Git 为准，未安装、推送或部署。用户正在使用的测试窗口保留。

## 当前行为

- 各 Preview 使用 PreviewToolbar 呈现身份及场景操作；标签只负责选择／关闭。浏览器显示实际标题和域名，导航为图标，真实原生HTML仅显示一个操作栏。
- AnnotationButton 始终显示“批注”，活动时仅图标／文字变蓝，保留aria-pressed、禁用和键盘焦点。图片、网页及文本共享圆号和边框；图片编号中心在区域左上边线上。
- 图片初始普通态和退出后的普通态共用既有Annotorious节点；批注模式只切绘制／编辑，尺寸位置不跳变。删除缩放按钮、手动比例状态及专属ResizeObserver；按宽度适应并使用原正文滚动。系统截图仍默认开启批注。
- 网页／HTML复用React Grab选择原语；恢复悬停虚线框，按帧合并移动，同一目标不重复触发React更新。原备注、草稿、来源校验和引用协议保持。
- 用户接手／交还只在页面确由工具创建或引用认领后出现；它仅控制原任务后续写入，不启动任务或重放操作。多Worker仍各自绑定后台页。

## 复审修正

1. 原窄屏标签逻辑只对focus-visible滚动，导致程序focus仍可能被裁切。沿原ensureVisible区分当前指针按下与程序／键盘聚焦；指针按下期间不移动目标，关闭后回焦及resize仍沿原逻辑。完整图片专项现已通过，未删除失败断言。
2. 浏览器操作Promise原来吞掉异常而返回undefined。现在保留原错误，缺失选择器的原生回归明确得到preview_target_missing。
3. 页面认领后的弹窗继承当前owner和agentAssigned，旧Worker不能读取。此前createWindow丢弃Electron传入的webContents，最小探针稳定卡死；复用完整options后正常返回。创建前overrideBrowserWindowOptions设置原安全／预加载／会话配置；原生测试验证opener、同一session、sandbox/contextIsolation/nodeIntegration及批注bridge，未改成拦截或外开策略。
4. 空的初始浏览器URL不再使域名展示抛异常。原生HTML根据真实渲染内容隐藏外层文件操作栏，避免仅凭文件扩展名漏显／重复；保留原授权读取。
5. 强制颜色模式的按下态使用系统Highlight；普通活动态只有前景色。悬停命中不变时不重复notify，无新轮询／缓存／后台扫描。

## 验证

下表记录已完成的源码复审。新检出可用下文的专项入口重跑。

| 隔离候选检查 | 结果 |
| --- | --- |
| 浏览器来源、HTML资源边界、草稿、表单、Composer、阅读及组件回归 | 186/186 |
| Electron壳契约（Node22 + tsx + vm modules） | 410/410 |
| 完整图片专项（含原程序focus失败断言） | 1440/390/320px，30组通过；Chrome退出0、forced=false、watchdog=false |
| Preview进入反馈、其他文件类型、普通及浮动截图合成编辑 | 三宽度通过；Electron退出0、错误为空 |
| 原生浏览器、双Worker、真实MCP来源、悬停／保存／导航关闭／交接／弹窗 | 11组通过；Electron45，错误为空，退出0 |
| UI／后端类型、独立UI及批注runtime构建、样式检测 | 通过 |

原始材料保存在本机 `outputs/preview-final-review-2026-11-18/`。`summary.json` 和 `candidate.json` 记录结果与候选文件哈希，`native-complete/product-report.json`、`images/canvas-image-preview-results.json`、`entry/verification.json` 和 `popup-probe.json` 是分项回执。原生整窗、网页和 HTML 悬停截图在 `native-complete/`，图片初始、批注和退出截图在 `images/`。这些原始材料随本机目录保留，新检出只包含这里的结论和复验入口。

### 性能与实际边界

本机两张合成后台页面连续20次有界ARIA读取合计 **42.1ms**，只是本轮局部样本，不外推真实网站、整机并发或LLM速度。操作仍逐页互斥；图片模式切换保持同一Blob、不额外读取，删除了手动缩放渲染与测量状态。悬停每帧至多命中一次，同一目标不重复更新；不是通过减少授权或省略错误获得速度。

未跑全量npm test；未验真实模型、安装版、Windows、移动真机、日常账号／登录、OAuth／CAPTCHA。合成MCP和原生内容链通过不等于这些能力通过。

早期证据保留为历史：沙箱进程身份失败在同候选获准环境重跑186/186；壳测试首次缺tsx，补正确命令后410/410；弹窗旧实现卡死由最小探针定位并修复；首次显式webContents=undefined导致普通open失败，转交完整options后闭环通过。native测试局部等待现在正确await异步条件，子Electron有独立超时回收。此前悬停、系统截图和程序焦点的未通过状态，以本节最终结果更新，不倒改旧记录。

## 复验入口

使用项目 Node 22、既有依赖和独立构建产物。原生窗口按[内置浏览器专项](testing.md#内置浏览器正式源码2026-11-17)设置 `HOMER_PREVIEW_UI`、`HOMER_PREVIEW_RUNTIME` 和 `HOMER_PREVIEW_EVIDENCE` 后运行 `node scripts/test.mjs --preview-electron`。进入反馈按[截图及图片批注专项](testing.md#preview-顶栏与图片批注进入反馈2026-11-17)重跑。

完整图片专项从仓库根运行，使用本轮构建的 UI 和独立报告目录。

```sh
mkdir -p .codex/scratch
preview_run=$(mktemp -d "$PWD/.codex/scratch/preview-image-XXXXXX")
(cd ui && ../node_modules/.bin/vite build --configLoader runner --outDir "$preview_run/web")
HOMER_COMPONENT_BUILD="$preview_run/web" HOMER_BROWSER_EVIDENCE="$preview_run/evidence" \
node tests/canvas-image-zoom.browser.mjs
```

为每次运行指定独立的输出目录，核对报告和退出码，图片专项还要核对报告中的 `forced`、`watchdog` 字段。原生窗口报告另保留环境及页面错误。
