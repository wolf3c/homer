# 预览重复文件标题行移除

2026-10-25，以下保留本任务独立候选的实施与验证记录。后续已批准的紧凑顶部栏覆盖当时的手机尺寸约定：桌面批注按钮仍为28px／14px图标，手机／粗指针为44px触摸目标，工具栏为52px；旧尺寸冲突已由该明确授权解决。当前组合验收见 [紧凑顶部栏](2026-10-25-compact-header.md)，本轮审查及提交见 [后续审查记录](2026-10-25-annotation-header-followup-review-commits.md)。下文49px收益仅属于原独立候选，不作为当前组合断言。基线 HEAD `493ead1576ba08e59987f9db96a55ae4843a90b9`；安装版 build62 保持冻结。没有读取真实账号、运行数据或调用模型。

文件名原来同时出现在 Tabs 和 CanvasSplitHeader。本次删除后者的整个消费者 DOM，包括整预览关闭 X；文件名仍由原 Base UI Tab 呈现，完整名称可由 title／aria-label 读取。原 HTML／图片“批注”移到标签栏右端稳定容器，位于 Tab 和 List 外。文字和图标仍为 28px／14px；250px 面板实测按钮宽 61px，不压缩图标。文本和不支持格式不增加批注模式按钮或操作行。

HomerApp 的 tabs／activeId／canvasOpen、单 reader 与唯一 annotationDraft 没有改动。CanvasPanel 持有一个 DOM 容器引用；CanvasReader 仍拥有原 HTML 加载／active 状态和图片入口，透过 React Portal 投影动作。图片原 lazy 组件与内部 Portal 保留。尺寸变化不重挂 iframe、图片 native editor、annotation layer 或 actions target；切换文件仍销毁旧上下文。固定 vendor 源文件和生成 CSS 未改，无依赖变化。

手机实测原全局开关所在背景有 `aria-hidden=true`，不能作为模态内部唯一退出。因此在同一标签栏末端保留语义为“收起预览”的 PanelRight 图标，复用原 onClose，不删除标签。桌面有标签时只使用原全局开关。无标签空态或受控 webSource 保留最小单栏名称与收起 fallback，PDF／受控网页的正文安全退出也保留并准确命名。没有放开背景或设置 modal=false。

初始焦点由旧 header close ref 改为活动 Tab，无标签时为 fallback 收起按钮；Dialog.Title／aria-label 包含准确来源名，Tab/Panel 关联仍由 Base UI 生成。原来源入口回焦、入口卸载后的顶部开关 fallback、末标签收起、邻项选择、手动箭头／Enter／Space 激活均保留。图片 Escape 先取消临时编辑；返回焦点打开的原生 tooltip 先消费一次 Escape，再退出绘制，最后收起预览。未改共享备注表单、HTML 原生英文或键盘行为。

## 实测结果

全部为需求推导的合成文件／HTTP 随机端口／独立 Chrome profile，fake engine 明确禁止执行，外部网络请求由测试浏览器拦截。未使用生产账号或模型。Chrome 版本及逐项结果保存在任务 scratch 的 results.json。

| 检查 | 结果 |
| --- | --- |
| 旧构建基线及红灯 | 三屏记录实际重复标题；新无标题断言在旧构建出现 `true !== false` |
| 1440／390／320 正文高度 | 标签栏以下正文各净增 **49 CSSpx**，等于删除的旧 header 实测高度 |
| 新布局专项 | 三屏通过；真实拖动到 **249.75 CSSpx** 面板；长中文／ASCII、多标签横滚、无全页横滚、HTML native Exit、加载中取消与迟到导入、同 iframe 身份、手机焦点循环／背景隔离及退出 |
| Tabs／批注流程 | 127 项三屏通过；手动激活、邻项与末项关闭、准确回焦、静态 HTML／一次激活／ACK 保存／切换销毁、文本原位 marker、图片保存 chip／临时几何取消、原生实例跨尺寸身份、Escape 分层、无自动发送 |
| 无标签 fallback | 三屏通过；受控网页准确名称、原 sandbox／WebPreview、正文退出、空态收起、回焦和无 inert 残留 |
| UI types | `tsc -p ui/tsconfig.json --noEmit` 通过 |
| 固定官方来源 | `official-canvas-upstream.test.mjs` 2 项通过 |
| 局部 CSS | `build-run-activity-css.mjs --canvas-split --check` 通过；未重生成 CSS |
| 本地构建 | Vite 通过；已有 bundle 大小提示保留 |

新增维护回归：`tests/preview-header-row.browser.mjs`、`tests/preview-header-fallback.browser.mjs`；前者没有基线文件时也可独立运行，显式采集基线后额外校验准确 CSSpx。`tests/preview-tabs.browser.mjs` 增加图片 Portal 位置、原生实例跨尺寸身份与 Escape 层级断言。既有浏览器用例对旧 headerclose 的选择器改为实际可用收起动作，保留原断言；已有旧业务合同的用例未在此轮全面迁移或全量运行。并行 `annotation-enter-save.browser.mjs` 只替换关闭选择器，不改表单键盘测试内容。

## 复现与交付

所有临时材料仅位于 `.codex/scratch/preview-header-row-removal-20261025/`。前像保存在 `before/`，整体工作区基线保存在 `dirty-before.patch`、`index-before.patch`、`status-before.txt`，本轮补丁为 `task-only.patch`。补丁基于本次前像，保留已有 dirty；不是把整个共享 dirty 导出为本轮变更。`preservation.json` 记录 HEAD/index 和未触碰前像核对。

本轮末期发现外部并发改动：`ui/homer-app.tsx` 移动全局品牌栏并缩小 Logo，`ui/homer-styles.css` 修改顶栏布局；同一 `ui/canvas-panel.css` 将标签栏改成桌面 44px／手机 52px，并将手机批注按钮覆盖为 44px。后者直接违反本任务明确保留的 28px 合同；组合复核实际出现桌面净增 `46 !== 49`。这些外部改动没有被覆盖、撤销或纳入本轮补丁。准确差异见 `external-overlap.patch`；已批准尺寸的本轮 CSS 保存在 `task-source/ui/canvas-panel.css`。

最终隔离构建通过 `freeze-original-header.vite.config.mjs` 只在 Vite load 时读取原全局 main/CSS 前像及本轮 CSS，不改共享文件；三屏 PNG／49px 结论对应此独立候选。当前共享分支的组合布局必须由 CTO 协调外部尺寸覆盖后再验，不能将这些截图当作其验证。此处是具体的同文件写入冲突，不要求重新批准原方向。

```sh
node_modules/.bin/vite build --config .codex/scratch/preview-header-row-removal-20261025/freeze-original-header.vite.config.mjs --configLoader runner --logLevel warn
HOMER_SYNTHETIC_ROOT=.codex/scratch/preview-header-row-removal-20261025/synthetic HISTORY_FOLLOWUP_BUILD=.codex/scratch/preview-header-row-removal-20261025/web HOMER_REVIEW_EVIDENCE_ROOT=.codex/scratch/preview-header-row-removal-20261025/browser node --import tsx tests/preview-header-row.browser.mjs
HOMER_SYNTHETIC_ROOT=.codex/scratch/preview-header-row-removal-20261025/synthetic HISTORY_FOLLOWUP_BUILD=.codex/scratch/preview-header-row-removal-20261025/web HOMER_REVIEW_EVIDENCE_ROOT=.codex/scratch/preview-header-row-removal-20261025/tabs node --import tsx tests/preview-tabs.browser.mjs
HOMER_REVIEW_EVIDENCE_ROOT=.codex/scratch/preview-header-row-removal-20261025/fallback node --import tsx tests/preview-header-fallback.browser.mjs
node_modules/.bin/tsc -p ui/tsconfig.json --noEmit
node --test tests/official-canvas-upstream.test.mjs
node scripts/build-run-activity-css.mjs --canvas-split --check
```

三屏可审阅 PNG：`browser/html-1440.png`、`browser/html-390.png`、`browser/html-320.png`，另有 text、249.75px 面板、图片 actions 及受控网页截图。没有上传媒体。实体手机、原生虚拟键盘、真实端侧 IME、Electron 安装版未测试；不把本地浏览器结果当作生产证据。未运行全仓 suite，未修改原消息 scroll anchor／Composer owner、全局品牌栏、安装版、模型／渠道或持久数据。
