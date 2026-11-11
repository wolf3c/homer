# 助手正式回答气泡

2026-10-24，本地源码实施与复核完成；本记录随气泡改动提交，未部署、安装或重启。

## 实现与官方依据

参照 [assistant-ui Message primitive 官方示例](https://www.assistant-ui.com/docs/primitives/message)（2026-10-24 查阅）的 `MessagePrimitive.Root` 内层圆角内容容器，在现有 `AssistantMessage` 内增加一个局部气泡，不复制官方 Thread，不增加或升级依赖。

- `ui/homer-app.tsx`：正文、对应原请求引用及准确 messageId 的成果文件共用一个容器；复用原内容与附件消费者。仅过程或无正文、引用、成果时不生成气泡。Working／Worked、Worker 事件、来源列表、操作和时间仍在外部。
- `ui/homer-styles.css`：局部 `assistant-message-bubble`，沿现有 surface／line、13px 圆角及用户气泡内距；左对齐、短句收缩，最长不超出原阅读区。字号、行高、主题和用户气泡不变。
- `ui/DESIGN.md`：补充上述维护边界。

未改变消息投影、ProcessNodes、MessageDetails、Markdown 定义、选文身份、文件授权或 HTML 预览实现。共享工作区已有修改保留；回退只撤回本次上述气泡 hunk 和新增文档，不恢复整份文件。

最终复核发现 `ui/homer-app.tsx` 的另一个独立 hunk 出现并行顶部栏布局变化，已原样保留，未纳入本任务补丁。下面的截图和验证对应本次隔离候选构建，不包含构建后出现的该变化；`own-changes.patch` 仅保留本任务 hunk，`source-identities.json` 区分已验候选与复核时的共享文件。

提交前逐项复核空正文、仅成果、引用与过程混合、流式组件身份、操作及来源边界，未发现需要修正的问题。气泡仅新增一个容器与局部 CSS，没有新增状态、effect、定时器、网络读取或依赖；附件沿原路径每次渲染筛选一次，并供紧凑状态判断复用，不增加筛选次数。没有宣称全应用性能基准或生产性能保证。

## 验证

实际构建产品 UI，以全新隔离 Chrome 和内存 HTTP／SSE 提供需求推导的合成输入；未访问真实历史、生产库、凭据或模型。修改前实际页面无助手气泡，基线断言按预期失败。证据与可重跑夹具均位于 `.codex/scratch/assistant-message-bubble-20261024/`。

- `cd ui && ../node_modules/.bin/tsc --noEmit`：通过。
- `cd ui && ../node_modules/.bin/vite build --configLoader runner --outDir ../.codex/scratch/assistant-message-bubble-20261024/candidate-web`：通过，仅原有大 bundle 提示。
- `check-browser.mjs`：320／390／1440px，各浅色／深色媒体偏好，共84项断言通过。覆盖短／长中文、Markdown／公式／表格／代码局部滚动、混合过程与正式正文单显、仅过程无空气泡、键盘展开与引用、选文提交准确 messageId／选文、流式复制最新文字、Markdown／代码块／气泡 DOM 稳定及历史阅读位置。
- `check-media.mjs`：390／1440px，共8项断言通过。覆盖原请求引用及批注、图片解码失败、普通文件下载失败、HTML 默认源码及静态预览空 sandbox／禁脚本 CSP。
- `node --import tsx --test tests/process-nodes-ui.test.mjs tests/message-quote.test.ts tests/chat-timestamps.test.ts`：18项通过。现有 `conversation-projection.test.ts` 在本次 scratch 目录作为工作目录独立执行：9项通过。首次受只读沙箱限制的临时目录失败已通过隔离执行解决，无产品失败遗留。

提交前额外以 `1930e16` 为基线，只应用本任务四个文件的改动，在 `review/tree/` 创建无分支的隔离副本：UI 类型检查和独立构建通过；该基线的上述四组现有回归共26项全部通过；针对该构建的两套浏览器验证共92项断言全部通过。与先前共享候选的27项计数差异来自基线已有测试数量，不是跳过失败用例。复核证据在 `review/typecheck.log`、`review/build.log`、`review/focused-tests.log`、`review/browser/results.json` 和 `review/media-browser/results.json`，精确提交补丁为 `review/commit.patch`。这次验证不依赖未提交的其他产品改动。

浏览器结果见 `browser/results.json`、`media-browser/results.json`；完整气泡截图见 `media-browser/1440-complete-bubble.png` 和 `media-browser/390-complete-bubble.png`；长文及过程截图见 `browser/1440-light-conversation.png`、`browser/390-light-conversation.png`。当前产品没有独立深色配色，深色媒体偏好仍沿原主题；不把该检查称为新增深色主题。上述均为本地候选证据，不表示运行版已采用。
