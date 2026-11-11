# 原生标题栏代码审查与提交

2026-10-25。在本次授权范围和已运行检查内，未发现需要继续修改产品逻辑的问题。已补充最小左栏三个全局入口、长标签操作及连续 resize 的回归覆盖，并将原生标题栏产品改动独立提交。结论限于下面列出的合成运行和既有准确来源证据，不代表完整发行包、真实账号或所有系统环境验收。

## 准确提交与范围

入场为共享 `main`，HEAD `d15253d76c0c2b8e4c749ad75d5900d5823b9684`，暂存区为空。它已包含实施交付记录 `cce82fe16f4c087506c8474b53a724d32415220d` 之后的输入栏和工作状态提交；没有回退这些提交，也没有把其他 dirty 内容纳入候选。

产品提交：`a512b0d60c94807217f38ac517b00cd2fb2edc1e`，tree `cdf69a85d3b90a412259939af7d66b45dedad722`，标题 `Integrate macOS window controls into the existing header`。共 9 个路径，301 行新增、6 行删除。

| 路径 | 提交边界及审查结论 |
| --- | --- |
| `packaging/electron/main.mjs` | 仅 macOS 构造期 hiddenInset/WCO、真实系统按钮坐标及一个 resize listener；没有自绘按钮、preload 或新 IPC。原尺寸下限、菜单、导航、下载、权限、sandbox、关闭隐藏、activate、退出确认及 ACK/exit0 合同保留 |
| `ui/homer-app.tsx` | WCO 能力一次识别并锁定；全屏 visible=false 不撤标记。必要的首次 geometrychange 识别后立即移除，effect 卸载也清理。原 Group 两个 Panel 只调整 native 约束，无新布局 owner 或 Reader key |
| `ui/homer-styles.css` | 仅 4 行原生限定的 WCO 避让、drag/no-drag 与品牌隐藏规则；原字体、行高、全局目标和状态宽度 owner 保留 |
| `ui/canvas-panel.css` | 仅 6 行原生规则；可见 rail 统一承担 no-drag，内部元素恢复初始值，避免 Electron45 将横滚离屏子项的矩形侵入左侧可拖区 |
| `tests/electron-shell.test.mjs` | 原生窗口及非 macOS 打包守卫断言；新增连续 100 次宽窗、100 次窄窗、1 次返回宽窗的 setter 次数核对 |
| `tests/native-titlebar.browser.mjs` | 真实产品 renderer/router 与准确窗口处理器的合成回归；本轮增加 native 左栏 240px 时三个全局入口、预览恢复标签、长 rail 悬停/title 和键盘激活。明确使用浏览器输入，不称 HID |
| `ui/DESIGN.md` | 只提交新增原生标题栏章节，其他改动留在工作区 |
| `docs/2026-10-23-electron-desktop.md` | 只提交新增原生标题栏段落，既有安装记录等 dirty 内容保留 |
| `docs/2026-10-25-native-titlebar-integration.md` | 保留实施阶段证据，首段明确其历史时点；后续复验以本报告为准 |

没有修改 vendor、依赖、包锁、后端业务、输入栏清理、模型渠道或持久数据。固定 Electron45 的原生类型声明已在本地核对；本轮没有引入新 API。原生按钮 setter 支持 macOS，未使用 macOS 不支持的 `setTitleBarOverlay`。

## 准确候选与验证

全部临时文件位于 `.codex/scratch/native-titlebar-review-commit-20261025/`。先从入场 HEAD 用 Git archive 导出完整源码，再只叠加上表精确内容；逐个核对所有 tracked 输入，确认其他源码与入场 HEAD 一致。构建、测试依赖只读复用现有 node_modules。候选源码字节、实际产品 tree、构建资产及日志摘要见 [身份清单](patches/2026-10-25-native-titlebar-review-identities.json)。

| 检查 | 实际结果 |
| --- | --- |
| UI TypeScript | `tsc --noEmit -p ui/tsconfig.json` 无诊断 |
| 隔离构建 | 单独生成 HTML 批注 runtime 和 Vite8.3.4 UI；成功，只有既有大 chunk 提示。未运行会写维护树 dist 或生成样式的默认完整构建 |
| Electron 主入口合同 | 11/11 通过。真实 main 链接 OS fixture，覆盖窗口安全、关闭隐藏、退出取消、ACK 缺失、非零退出、超时及重复 quit 不重复发送 |
| 原生产品窗口 | 最终维护测试 8 组检查通过，1440/1080/801/800/799/380×420、原生按钮坐标、44/52px 顶栏、左右约束、零页面溢出正常 |
| 三个全局入口 | 浏览器输入分别打开/关闭微信设置、工作状态，收起/重开预览；最小左栏 240px 下正常，外窗 bounds 不变，标签数量和活动项保留 |
| 长标签 | 可见 rail no-drag，Tab/关闭子项计算为 none；关闭邻项回焦、横滚、完整 title 属性、`:hover`、Home/End/Enter 激活均通过。没有将 title 属性核对视为原生 tooltip 视觉通过 |
| HTML 与图片 | HTML 默认空 sandbox、明确启用才执行一次；801/800/799/380/1440 和真实全屏往返保留 iframe、Tab、actions、Composer 身份。图片 Annotorious、临时输入同样保持；合成 composition Enter 不提交，明确 Enter 保存原主草稿；切文件销毁旧上下文 |
| Web 三屏 | `tests/compact-header.browser.mjs` 18 组通过：1440/390/320、状态原阈值、普通两个 25% 下限、无 native 留白、长 rail、模态隔离、滚动锚、Composer 留底、HTML 身份及粗指针目标 |
| 模型与消息 | 原生和 Web 使用随机端口、独立 profile 与不执行的 fake engine；模型调用、消息提交均为 0 |
| 差异及输入保全 | 精确产品 tree 差异检查通过，未提交凭据、归档、profile、截图或构建产物；入场文件除本轮两份测试和历史报告首段外，字节全部保留 |

原生合成窗口实际运行 Electron45.0.0、Chromium156.0.8078.48、内部 Node24.22.0，macOS27.0 arm64；原生/Web 测试脚本使用 Node22.22.0。UI 构建最初尝试使用本机 Node26.9.0，最终 UI 构建使用 Node22.22.0；没有改变项目 Node22 支持声明。

原生入口逐字采用候选 main 的 createWindow、菜单、安全、关闭、before-quit 以及 stdout/close 协议。仅替代打包/codesign/profile bootstrap，连接真实 HTTP router 和假后端。因此本次不是完整签名包或已安装 App 的启动验收。

首次隔离 UI 构建的别名漏了 `?raw`，导致找不到批注 runtime；过早启动的合成窗口随后等待 Composer 超时并正常退出。修正仅发生在 scratch 构建配置，随后准确候选构建和全部上述最终检查通过。失败日志与截图保留为 `build.log`、`native-window.log`、`attempt-before-ui-build-failure.*`，未改产品逻辑或弱化断言。

## 几何与性能口径

本轮采用同一个准确候选 renderer，分别配入场 HEAD 的默认标题栏 main 和最终 main，按同 outer bounds、zoom=1 配对。原生几何来自 BrowserWindow，网页几何来自 DOM rect，正文上沿为 native inset 加 DOM top；没有从 PNG 缩放比例估算 CSSpx。

| 外窗尺寸 | 默认 native inset / 正文上沿 | 合并 native inset / 正文上沿 | 正文净增 |
| --- | --- | --- | --- |
| 1440/1080/801 × 780 | 32 / 76 CSSpx | 0 / 44 CSSpx | 32 CSSpx |
| 800/799 × 780 | 32 / 84 CSSpx | 0 / 52 CSSpx | 32 CSSpx |
| 380 × 420 | 32 / 84 CSSpx | 0 / 52 CSSpx | 32 CSSpx |

新增 main 路径为单个 resize listener，每次读取 bounds 和当前按钮位置；201 次合成 resize 只有跨断点时共 2 次 `setWindowButtonPosition`，每个事件仍会调用两个原生 getter。renderer 只在首次识别时改变一次能力状态，geometry 监听识别后移除、卸载时清理；全屏释放/恢复避让由 CSS env 处理。没有新增轮询、mousemove IPC、ResizeObserver 或第二 Reader。真实全屏往返与尺寸变化中的实例恒等检查通过。

本轮没有做整包性能基准、用户机器速度承诺或重复 bundle 对比；4 份产品源码与实施交付 hash 一致，只增加测试及文档。本次证据支持新增工作的次数有界和实例稳定，不证明真实长会话、吞吐或全部平台性能。

## 证据复用与未测边界

实施阶段的四份产品源码 hash 与本次提交逐字一致，故复用其真实 HID header 拖动、Separator 拖动、当前 Maximize 偏好下双击还原、真实红/黄/绿系统按钮证据；保留原阶段来源，不称本轮重测。旧样机的 52 项检查未计入本次产品通过数。相关输入 hash 和原生 PNG 摘要在身份清单中。

本轮对 PID2926/window13641 的准确合成窗口取得系统 AX 和原生截图，名称为 AXWindow“荷马”、AXWebArea“Homer · 荷马”。电脑操作工具连续将新快照判为 `STALE_SNAPSHOT`，点击未送达；未改路由、工具或权限绕过它。因此三个全局入口的逐项 HID 点击、真实 rail tooltip 悬停仍未完成；已通过的浏览器输入明确另列。当前原生截图为 `hid-before.png`，380px 的本轮截图 `native-final/candidate-renderer-380.png` 只含 renderer，不冒充原生按钮图。

全屏悬停系统栏是否遮住正文、真人 IME 候选、VoiceOver、多屏、其他 macOS 双击偏好、实体设备 200% 仍未验证。Ctrl+Cmd+F 在实施阶段准确前像与最终原菜单下均无动作，本轮不添加菜单功能；绿色按钮及原生 API 全屏往返有证据。Windows/Linux 本轮仅检查原有 macOS 打包守卫，不声称实际运行支持。

未运行整仓 suite 或真实模型/渠道检查；本轮通过不能解释为此前无关生命周期、媒体查询 fixture 基线问题已解决。没有以安装版或生产账号作验收。

## 提交与保全

使用 scratch 临时 index 建立并审阅准确产品 tree，提交时对 `refs/heads/main` 做旧 HEAD 比较交换，并用 index lock 保护共享暂存区；确认新 SHA/tree 后保留原空暂存语义。没有使用 all-dirty、创建分支/worktree、push、tag、安装或部署。入场 1208 个 tracked/untracked 路径的字节摘要保留于 scratch；只有本轮两份测试及实施报告历史标注改变，其他入场文件全部一致。

产品提交后 `ui/DESIGN.md` 的其他 125 行新增/67 行删除，以及桌面说明的其他 12 行新增仍为原有工作区内容；它们没有混入提交。最终报告与身份清单另作一个文档提交，产品 commit/tree 不受报告影响。

已安装 `/Applications/Homer.app` manifest 前后仍为 build66、`gitSha=12aeb6b188791b820426e30900ac49ca695d09af`，SHA256 `f1263d8babdacdf6db3948745adddd838843246442af77a6e2e0732a0ec985c3`。本项尚未采用，没有启动、重启或替换安装版，也没有操作真实账号、数据或锁。

回退应只逐 hunk 撤销本产品提交中的 native 构造选项、WCO/Panel 和 CSS 增量，恢复 N32 默认标题栏；没有数据迁移。共享树存在大量其他 dirty，不能恢复整文件或自动回放旧 task-only patch 覆盖它们。

重跑使用提交中的 `tests/electron-shell.test.mjs`、`tests/native-titlebar.browser.mjs` 和既有 `tests/compact-header.browser.mjs`，明确指定任务目录的 UI 构建、合成数据根与现有 Electron/Playwright 路径。隔离构建应将 `../dist/preview-annotation/runtime.js?raw` 精确映射至 scratch 生成的 runtime，并保留 `?raw`。本轮执行脚本、配置、准确源码、日志、截图、前像和补丁均保留于任务 scratch；可维护源码及非敏感验证身份已随提交保留。
