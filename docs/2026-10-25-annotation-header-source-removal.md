# 批注按钮统一与移除 HTML 源码切换

2026-10-25。用户授权：“同意对批注按钮的优化，取消查看源码按钮，不需要该功能”。维护源码基于共享 main 的 `a6040cc62fb2e76ece3fb62b138b31ab9da516c8`；未提交、安装、重启或发布，不能据此认定 App build58 已采用。

## 行为与修改边界

HTML 原按钮受到稍后加载的附件 `size-6 / p-1 / text-sm` utilities 覆盖，实际 24×24px，文字把 SVG 压到 0×14px。`ui/canvas-panel.css` 现在在 Canvas 内共用 HTML／图片规则：auto 宽、28px 高、水平8px、12px文字、5px间距、14×14px不收缩图标、细边框与7px圆角。hover、真实 pressed、focus-visible 和 reduced-motion 也由该局部规则限定。未改通用 utilities、导入顺序或其他官方控件。

`ui/canvas-panel.tsx` 删除 HTML 查看源码／返回按钮、Code2／Eye 导入、模式状态、源码 pre 分支及其专属文本选区入口。共享文本批注引擎和历史引用不删除。HTML tooltip 使用当前 Dialog 的动作容器；加载中明确可取消，只有原生 active 才显示 pressed／SquarePen。

默认 HTML 仍读取原授权文件、清洗并静态渲染；主动批注才加载禁网 opaque iframe，继续不授予 allow-same-origin。取消、失败、原生退出和关闭沿原 generation/token/runtime owner 清理，保存备注仍按会话与准确成果 hash 保留。原主草稿、原请求与未知回执重试未改。

仅两个产品文件、三个既有浏览器测试和对应设计／来源说明属于本任务。`ui/DESIGN.md` 与 `ui/vendor/assistant-ui/README.md` 只维护本任务章节；并行共享表单章节和其他 dirty 保留。图片“添加到对话（N）”、全局 header、关闭按钮、Agentation 原生 Popup／Toolbar、Run Activity、自动同步及多标签均不在本轮实施范围。

## 验证与证据

本任务目录为 `.codex/scratch/annotation-button-source-removal-20261025/`。`before/` 保存开始时实际工作文件；`identity-before.json`、`before-index.txt` 与 `before-status.txt` 记录共享前像。`task-only.patch` 只包含本轮变化，针对捕获的工作前像重放，排除随后出现的并行文档章节及批注数据 owner 改动；`task-result/` 是该独立补丁的结果。`current-hunks.patch` 则只将相同职责的改动放到最后读取的共享版本上，保留其他修改，已通过当前树只读反向预检。两份补丁均在 scratch 完整正向重放核对；没有重写工作源码或应用回退。`delivery.json` 分别记录本任务结果、共享当前文件与补丁哈希。

- 红测用修改前真实 Vite 编译页面及合成 HTTP 成果，几何断言实际失败：高24px、水平4px、14px字、SVG 0×14px。`red.log` 与 `red/header-geometry-1440.json` 保留结果。
- UI `tsc -p ui/tsconfig.json --noEmit` 在本次准确前像和修改后均无诊断。此前其他检查中的 12／137 诊断不是本轮前像结果，不能混作本轮基线。
- 真实 UI 使用原 Vite 配置隔离构建到本目录 `before-web/` 与 `web/`，没有覆盖安装 App。既有大 chunk 提示仍存在。附件与 Canvas CSS 使用原编译器、仅重定向临时输出路径，以 `--check` 验证一致，没有重生成 vendor 文件。
- `tests/html-render-first.browser.mjs`：67项检查通过。1440／390／320px 从真实文件入口进入 Canvas；实测按钮高28px、SVG 14×14px，长标题截断、无源码／返回入口、当前 Dialog tooltip、键盘 Tab／Space、静态不执行脚本、一次真实单击选元素、原生 Add／Send／Exit、两条备注与原正文保留。1440px 另做真实窄分栏拖拽；无横滚、焦点不跳历史。最终结果及三屏 PNG 见 `green/`。
- `tests/html-annotation-lifecycle.browser.mjs`：21项检查通过。包括加载取消与迟到代际、错误窗口／token、重复握手、导入失败／忙时、connected 不冒充 active、超时重试、原生快捷键退出、hash／thread 隔离及关闭清理。正向激活使用真实固定 Agentation，故障注入仅影响负向路径。
- `tests/canvas-selection-toolbar.browser.mjs`：45项三屏检查通过。文本／代码／混合 Markdown 与数学源码的准确引用、原草稿／附件／请求身份保持；HTML 没有文本选区入口，既有引用不被改写。
- `tests/image-file-annotations.browser.mjs`：首轮63项三屏检查完整通过，见 `image/`。包含普通看图不加载批注器、lazy Portal、28px按钮／14px图标、Dialog tooltip、Enter／Space／Escape、保存／关闭、独立批量导入和未知回执重试。后续只补强共用 focus／hover／reduced-motion 优先级；其重复执行曾在原生手柄拖动未改变几何的断言失败，保留于 `image-final-first-attempt/`，再一次在初始等待 Composer 时超时且无运行异常，保留于 `image-final/`。本轮未修改该测试或图片业务 owner，不能把这些重复执行报为全量通过。最终按钮范围曾尝试用 `image-header-probe.mjs` 独立挂载真实 CanvasPanel／lazy ImageAnnotation 复查；此时共享 Canvas API 已改变为必填 `annotationDraft`，原夹具不能再挂载，等待超时。该尝试没有成功结果 JSON，不记为通过，也未为适配它修改其他任务代码。
- 19项相关单测通过：`official-canvas-upstream`、`html-preview`、`agentation-preview-patch`、`canvas-html-publication`、`preview-reference`。来源校验、CSP、原生固定补丁与旧引用合同保留。

验证使用本机隔离 Chrome、新建合成数据和非生产随机端口，未调用模型、真实账号或真实聊天。手机宽度由 Chrome 模拟，未验证实体手机／WKWebView。长标题夹具曾未达到桌面截断条件，后加长；焦点测量改为等待既有 transition-all 完成，避免把过渡中间值误作最终样式。旧失败截图保留作过程证据，最终成功以结果 JSON 和交付哈希为准。共享目录最后出现的 `ui/homer-app.tsx:492` 尾随空白不属本轮修改；仅本任务文件通过 diff whitespace 检查，不宣称整个共享目录无问题。

最终巡检发现另一组共享变化已替换 `ui/canvas-panel.tsx` 的参数、文本／图片消费者及备注数据 owner 为 `annotationDraft`，`ui/homer-app.tsx` 等调用方也在变化。本轮按钮与源码移除代码块仍保留，但该组合不等于上述通过的冻结构建。没有覆盖这些变化、控制其他任务或继续修改其 API。当前共享组合需要负责集成者完成后重新构建、适配对应测试并验收；本轮只交付独立实现和已观测证据，不把旧成功结果外推到该组合。

复跑时将 `HOMER_SYNTHETIC_ROOT`、`HOMER_REVIEW_EVIDENCE_ROOT` 指向本任务内新的子目录，`HISTORY_FOLLOWUP_BUILD` 指向本任务 `web/`，使用已有 `node_modules/.bin/tsx` 运行上述浏览器测试。隔离构建命令为 `node_modules/.bin/vite build ui --configLoader runner --outDir ../.codex/scratch/annotation-button-source-removal-20261025/web`，前置条件是现有已验证的 `dist/preview-annotation/runtime.js`。

## 回退

这是可逆的客户端变更，没有数据迁移。需要回退时，先核对当前共享前像，对 `task-only.patch` 做反向预检再按本任务代码块回退；不得整文件恢复开始前快照，以免覆盖并行改动。本轮未执行回退。
