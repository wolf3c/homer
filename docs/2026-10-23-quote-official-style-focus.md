# 选文引用恢复官方外观与引用后聚焦

2026-10-23，源码实施与隔离验收完成，未部署、未重启。按共享 main 开发；开始 HEAD 为 `d8e0bd776e10588d5f99ecd7f97d702869d0b5b8`。工作区原有并行修改保留，本说明仅覆盖下列引用样式和焦点接线。

## 当前行为与修改

原浮动引用按钮被本地 CSS 放大到44px高，外层54px高；点击写入引用后不聚焦输入框。固定版本的 SelectionToolbar Quote primitive 本身只调用 `setQuote` 并清除选区，Lexical 自带 FocusPlugin 只处理 autofocus/runStart，没有引用焦点事件。

- `quote.tsx` 未改。移除 SelectionToolbar 的44px最小尺寸与自定义焦点覆盖，保留官方工具类。按钮现为28px高，外层38px高；按钮内距4px/10px、图标间距6px、字号14px/行高20px，外层内距4px/边框1px。
- 局部采用同一固定 registry 的圆角规则：外层 `.625rem`，按钮减2px，实际为10px/8px。官方 `border-border` 映射到 Homer 的既有 `--line`。仅对浮动引用的 `focus-visible` 回退宿主全局按钮修饰，恢复原生焦点圈；官方 primitive 继续负责固定定位和 z-index。
- 既有主题角色继续映射 Homer 的 surface/ink/soft/line 等变量，因此颜色仍随 Homer 宿主主题。没有安装官方整套主题，也未扩大为其他 Quote 表面的视觉调整。ComposerQuotePreview 的44px删除热区及焦点保持，QuoteBlock 保持。
- SelectionToolbar 根节点在 click 冒泡时请求焦点，发生在官方 Quote primitive 写入引用、清除选区之后。组件及 primitive 绑定没有重写。
- HomerComposerInput 内的 HomerFocusPlugin 注册真实 Lexical 编辑器的焦点方法。同一 thread 下的浮动引用、消息底部引用、删除引用和原 focusInput 调用共享此回调。`editor.focus()` 恢复原光标或落到文字末尾，使用离散更新和 `SKIP_SCROLL_INTO_VIEW_TAG`，同时沿 Lexical 自身的 `preventScroll` DOM 聚焦，防止阅读位置跳底。
- 焦点回调按 threadId 隔离，编辑器卸载后清理；禁用编辑器不响应聚焦。不监听 quote 状态变化，不在草稿恢复或后台 quote 更新时请求焦点，不使用全局 DOM 查询，不增加另一份引用状态。

普通引用仍保存在 runtime composer.quote；既有文字、准确 messageId/选区、草稿、排队编辑限制、发送身份和未知回执路径保持。消息底部原有16000字符截断与提示保持。Sources 的“引用与链接”不在本次范围。

## 固定来源

- [Quote 源码](https://github.com/assistant-ui/assistant-ui/blob/1f41f91643fdb56e5d8dbd14db65f742740738a1/packages/ui/src/components/react/assistant-ui/elements/quote.aui.tsx)：实际下载文件的 Git blob 为 `08f953566d8fc5d978eff8376f8416ae310fb0fa`。本地差异仍仅为 cn/CSS 导入与中文标签。
- [同版 registry 主题](https://github.com/assistant-ui/assistant-ui/blob/1f41f91643fdb56e5d8dbd14db65f742740738a1/apps/registry/app/globals.css)：局部复用 radius 和 border-border 语义；未加载全局 CSS。
- 当前安装的 `@assistant-ui/react` 0.15.29、`@assistant-ui/react-lexical` 0.2.19 和 Lexical 0.51.0 源码用于确认 primitive/focus 的实际行为，未升级依赖。

## 验证

证据目录：`.codex/scratch/quote-official-style-focus-20261023/`，全部采用需求推导的内存合成数据、隔离 Chrome profile 和本地 HTTP/SSE fixture；未访问真实模型或业务数据。

- 修改前的隔离构建在 `selected quote focuses the real editor immediately` 断言稳定失败，截图和计算样式位于 `red/`。
- `tests/quote-components.browser.mjs`：320/390/1440 共61项检查记录通过，另有精确尺寸、主题、来源身份及阅读位置断言。覆盖真实选文、鼠标引用、Tab/Enter 和原生焦点圈、直接追加输入、已有文字、删除/再次引用、刷新恢复、替换引用、未知回执原请求重试、较新草稿保护，以及排队编辑拒绝新引用、状态待核实禁止保存和取消后恢复普通草稿。
- 截图与计算样式位于 `acceptance-final/selection-toolbar-{width}.png`、`selection-toolbar-keyboard-390.png`、`quote-focused-{width}.png`、`toolbar-style-{width}.json`，检查记录为 `results.json`。
- `tests/message-actions.browser.mjs`：320/390/1440 共48项检查记录通过，覆盖共用焦点链、可见 Markdown 文本、原身份、16000字符限制和发送。
- `node --import tsx --test tests/main-composer.test.mjs tests/message-quote.test.ts`：16项通过，包括焦点注册/卸载、禁用输入、禁止滚动标签和原 IME/草稿/上传/回执合同。
- `node scripts/build-run-activity-css.mjs --quote --check` 通过；`tsc --noEmit -p ui/tsconfig.json` 通过；Vite 构建输出仅在隔离 candidate-web，构建通过，保留既有大包体提示。最终相关 diff whitespace 检查通过。

额外运行的 `tests/web-multi-quotes.test.ts` 有一条当前工作区的独立失败：`old quote rows and exact legacy input hashes remain readable and idempotent, including trusted source` 在第56行用 `history.list()[0]` 查旧插入行；当前 list 按 rowid 返回，该位置实际为 fixture 先插入的无引用源消息，断言收到 undefined。本次没有修改这个测试或后端历史读取，未扩大范围修复；其余5项通过。该失败不计入上述通过结果。

窄屏证据来自桌面 Chrome 的视口模拟，未验证真机软键盘弹起。没有将源码完成解释为已上线。

## 提交前复审

用户随后要求 review 与 Git commit。从 `f365c54850782608e6e9f66f806f36bdf4044407` 单独提取本次代码块，排除共享文件中的问答、队列及其他并行修改；纯源码快照和验证记录保留在证据目录 `review/`。

未发现新的生产代码缺陷。焦点回调保持稳定，仅在明确操作时执行一次 Lexical 更新；没有新增轮询、全局 DOM 搜索、quote 订阅或依赖。回调按线程隔离并随编辑器卸载清理，浮层空白点击不触发聚焦。

复审修正两处测试问题：排队编辑断言不再依赖并行任务的单一提示文案，仍核对原引用、草稿和保存限制；消息操作测试等待内存服务收到请求后核对发送次数，避免把输入框提前清空误当作请求已到达。独立提交快照通过16项单测、61项选文浏览器检查、48项消息操作浏览器检查，以及 UI 类型、Quote CSS 重现和隔离构建。结果与截图位于 `review/quote-browser-final/` 和 `review/message-actions-browser-final/`。

## 回退

只回退本次 Quote source/generated CSS、HomerComposerInput 焦点 context/plugin、homer-app 的工具栏冒泡与局部 provider、MessageDetails 焦点调用，以及对应测试/说明的准确代码块。共享 main 存在其他任务修改，不能整体还原这些文件。修改前相关文件快照位于本任务 `baseline/`，仅用于逐块比较。
