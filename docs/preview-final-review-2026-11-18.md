# 浏览器与 Preview 优化复审（2026-11-18）

基于 main `e3434e27` 加本事项精确候选复审，不混入共享树的消息图片、队列、模型或其他方案改动。本文记录源码与隔离验证；提交身份以 Git 为准，未安装、推送或部署。用户正在使用的测试窗口保留。

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

以下outputs报告及截图保留本机供本轮审阅，不作为运行依赖；新检出可按已提交的专项入口重建。

| 隔离候选检查 | 结果 |
| --- | --- |
| 浏览器来源、HTML资源边界、草稿、表单、Composer、阅读及组件回归 | 186/186 |
| Electron壳契约（Node22 + tsx + vm modules） | 410/410 |
| 完整图片专项（含原程序focus失败断言） | 1440/390/320px，30组通过；Chrome退出0、forced=false、watchdog=false |
| Preview进入反馈、其他文件类型、普通及浮动截图合成编辑 | 三宽度通过；Electron退出0、错误为空 |
| 原生浏览器、双Worker、真实MCP来源、悬停／保存／导航关闭／交接／弹窗 | 11组通过；Electron45，错误为空，退出0 |
| UI／后端类型、独立UI及批注runtime构建、样式检测 | 通过 |

[结构化汇总](../outputs/preview-final-review-2026-11-18/summary.json) · [原生报告](../outputs/preview-final-review-2026-11-18/native-complete/product-report.json) · [图片报告](../outputs/preview-final-review-2026-11-18/images/canvas-image-preview-results.json) · [进入反馈报告](../outputs/preview-final-review-2026-11-18/entry/verification.json) · [弹窗探针对照](../outputs/preview-final-review-2026-11-18/popup-probe.json)。

实际截图：[原生整窗](../outputs/preview-final-review-2026-11-18/native-complete/product-native-window.png)、[网页悬停](../outputs/preview-final-review-2026-11-18/native-complete/web-hover.png)、[HTML悬停](../outputs/preview-final-review-2026-11-18/native-complete/html-hover.png)、[图片初始](../outputs/preview-final-review-2026-11-18/images/initial-390.png)、[图片批注](../outputs/preview-final-review-2026-11-18/images/active-390.png)、[图片退出](../outputs/preview-final-review-2026-11-18/images/exit-390.png)。

### 性能与实际边界

本机两张合成后台页面连续20次有界ARIA读取合计 **42.1ms**，只是本轮局部样本，不外推真实网站、整机并发或LLM速度。操作仍逐页互斥；图片模式切换保持同一Blob、不额外读取，删除了手动缩放渲染与测量状态。悬停每帧至多命中一次，同一目标不重复更新；不是通过减少授权或省略错误获得速度。

未跑全量npm test；未验真实模型、安装版、Windows、移动真机、日常账号／登录、OAuth／CAPTCHA。合成MCP和原生内容链通过不等于这些能力通过。源码候选哈希见[candidate.json](../outputs/preview-final-review-2026-11-18/candidate.json)。

早期证据保留为历史：沙箱进程身份失败在同候选获准环境重跑186/186；壳测试首次缺tsx，补正确命令后410/410；弹窗旧实现卡死由最小探针定位并修复；首次显式webContents=undefined导致普通open失败，转交完整options后闭环通过。native测试局部等待现在正确await异步条件，子Electron有独立超时回收。此前悬停、系统截图和程序焦点的未通过状态，以本节最终结果更新，不倒改旧记录。

复验使用项目Node22、既有依赖、独立构建与新profile。现有入口：`tests/browser-preview.electron.test.mjs`（显式preview-electron）、`tests/canvas-image-zoom.browser.mjs`（历史文件名，现验证无缩放统一预览，不带--layout-only）、`tests/preview-annotation-entry.browser.mjs`；对应环境变量沿docs/testing.md。未新增产品配置或数据实体。
