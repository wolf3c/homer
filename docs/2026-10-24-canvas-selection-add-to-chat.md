# Canvas 选区 Add to chat

2026-10-24，本地源码实施与隔离验收。起止 HEAD 为 `5afa91483870fd69fb281bc1bd5c2e24470dd3ba`；未提交、创建分支或 worktree，未部署、安装或重启。安装 build52 未采用本次源码。

文本、代码、Markdown 与 HTML 源码预览现在只在当前正文有效选区附近显示“添加到对话”，删除顶部固定“引用选中内容”按钮及普通文本的空工具栏。单击、触摸或 Tab/Enter 导入后，原主 Composer 显示准确来源与摘录，并可直接输入；窄屏先正常关闭原 Dialog。不会自动发送。

同日按用户要求仅将气泡原 `Add to chat` 文案汉化为“添加到对话”，可访问名称自动取按钮文字；样式、尺寸、定位、引用、焦点及生命周期保持。同步两处测试名称与维护说明，汉化前证据保留在原目录；汉化后的差异、三屏截图和验证另存 `.codex/scratch/canvas-selection-zh-20261024/`。此前下表记录原英文版本验收，不代替汉化后的验证。

汉化后当前 UI 类型检查、隔离 Vite 构建及原选区浏览器45项回归通过（1440／390／320，新增中文可访问名称断言），检查了鼠标／触摸及 Tab/Enter 添加、准确引用与原 Composer 焦点；三屏气泡未溢出。候选复用上次已验收 UI 快照，仅替换本轮文案，不包含并行滚动修改；未重跑图片／网页批注或全仓测试，未提交、发布或改变安装版。

## 复用与必要连接

- 已安装 assistant-ui 0.15.29 的 `SelectionToolbar.Root` 调用 `getSelectionMessageId`，`Quote` 写入消息引用，不能原样用于任意 Canvas DOM。没有伪造 Message/Thread/runtime，也没有改变原消息浮动 Quote。
- 气泡沿固定 Quote 工具条的实际 utility strings、data-slot 与 `quote.css`，保留28px按钮、4px内距及默认主题；不新增样式编译产物或44px覆盖。
- 已安装 Mantine `useTextSelection` 移入56行的独立 `PreviewSelectionToolbar`，不再让父 Canvas 随选区重渲染。Base UI 1.8.0 `Popover.Root/Portal/Positioner/Popup` 负责 Portal、原生 Range 虚拟锚点、flip/shift 碰撞、滚动跟随、外点与 Escape。Portal 留在原 Dialog 内，打开／关闭不自行转移焦点。
- 本地只接当前正文边界、原生 Range／文本快照、单次导入及原错误提示；新建选区即便偏移相同也可重新打开。激活前核对连接状态与当前选区，已卸载旧按钮不能导入；来源绑定原 artifact ID／哈希。Base UI 的 Dialog 与 Popover 在当前版本使用不同关闭树，因此父 Dialog 在气泡存在时取消自己的 Escape 关闭并允许事件继续交给 Popover。
- `previewSelectionText` 的唯一调用方从旧按钮换成气泡，输入改为保存的 Range／文本快照，数学源码提取算法保持。行内、块级、`math` fence、KaTeX 错误降级与代码混选共用原规则；未改服务端来源验证。
- 原 `MainComposer.addReference` 继续拥有导入限制、草稿正文／普通附件／请求身份、单引用互斥及焦点；导入失败保留原引用与草稿。主 Composer、服务端、队列、图片与网页批注实现均未修改。无新增依赖、全局选区监听、定位引擎或手写触摸事件框架；公式遍历只在激活动作时执行。

官方依据：[assistant-ui Quote](https://www.assistant-ui.com/elements/quote)、[Base UI Popover](https://base-ui.com/react/components/popover)。实际上下文要求和属性以已安装源码核对，未把这次部分复用称为完整官方 SelectionToolbar。

## 验证

证据根：`.codex/scratch/canvas-selection-add-to-chat-20261024/`。`plan.md`、`before/`、`before.json`、前像状态／index 与独立前像构建均保留。先在旧生产 UI 复现选区只有固定按钮、没有气泡，再对候选运行真实 Chrome。

| 检查 | 结果与证据 |
| --- | --- |
| 新选区浏览器回归 | 45项通过，1440／390／320；`final-browser/browser-results.json` |
| 原公式与边界浏览器回归 | 34项通过，三屏整段／局部／错误／fence公式、迟到 HTML 批注、长度限制恢复；`final-math-browser/browser-results.json` |
| 原文本／图片／网页批注回归 | 31项通过，真实 Annotorious 与 Agentation、合成 HTTP／队列；`annotation-browser/browser-results.json` |
| 引用、公式、附件、主队列、HTML测试 | 30项通过，`unit-tests.log` |
| 合成服务端来源验证 | 5项通过，`service-tests.log`，包含正确来源／公式接收和伪造文本／哈希拒绝 |
| 旧队列原草稿与客户端恢复 | 7项通过，`draft-recovery-tests.log` |
| 类型与构建 | 当前 UI、服务端源码和隔离候选 UI 类型检查通过，最终隔离 Vite 构建通过；全仓类型检查仍为12处既有诊断，与本轮前像逐字节相同，并非本次新增错误 |
| 差异检查 | `git diff --check`、三个浏览器脚本语法检查通过；逐文件前像／候选源码匹配与任务专用差异见 `final-verification.json`／`task-only.patch` |

新回归覆盖：无选区不显示／不占顶栏、中文多段／重复文本、代码／Markdown／HTML源码、鼠标／触摸点击、真实 Tab/Enter、清选／外点／Escape、滚动及长选区碰撞、真实分栏拖窄和视口缩窄、代码正文节点不重挂、跨聊天选区拒绝、切换文件及关闭销毁、禁止接收时导入失败保留原消息引用／正文／附件、恢复的答题状态禁止导入、成功后单引用互斥且保留正文／附件／requestId。导入焦点检查直接发送 CDP 文本输入，不先手工聚焦编辑器；断言没有自动提交消息。

截图均为合成内容：

- 修改前：`baseline-browser/before-fixed-button-1440.png`。
- 桌面／手机气泡：`final-browser/selection-bubble-1440.png`、`selection-bubble-390.png`、`selection-bubble-320.png`。
- 导入后真实输入焦点：`final-browser/import-composer-focused-1440.png`、`import-composer-focused-390.png`、`import-composer-focused-320.png`。
- 拖窄：`final-browser/dragged-narrow-preview.png`。

全部浏览器使用全新隔离 Chrome、合成文件／内存数据库与禁止执行的 fake engine；通过组没有页面错误或外部请求。未读取真实业务、账号或凭据。Chrome 宽度与触摸模拟不等于原生 iOS/WKWebView 选区手柄／性能验收，安装版未实机验证。构建保留原大 chunk 警告，不因此调整分包。

构建准备中曾在仓库 ignored `dist/preview-annotation/` 重生成一次批注运行时（该脚本不解析 `--help`）；已与相同前像源码的隔离构建逐字节核对，未操作已安装资源。最终验收资产均来自本任务 scratch 的 `candidate/dist/web`。

## 修改边界

运行代码仅 `ui/canvas-panel.tsx`、`ui/canvas-panel.css`、`ui/preview-selection.ts` 和新增 `ui/preview-selection-toolbar.tsx`。新增 `tests/canvas-selection-toolbar.browser.mjs`，两份原批注浏览器测试只更换选文入口选择器；同步 `ui/DESIGN.md`、vendor README 与本文。`ui/DESIGN.md` 原有未提交内容保留；并行出现的 `ui/process-nodes.tsx` 及原有 `ui/markdown-code.tsx` 等其他 dirty 未修改、未纳入本任务差异。候选为本次保存的源码快照，不冒称包含后续并行改动。
