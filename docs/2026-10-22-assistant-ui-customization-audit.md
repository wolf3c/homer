# Homer assistant-ui 自定义审查与最小清理建议

日期：2026-10-22。审查已提交于 `88f06f1`；用户随后授权实施，第二阶段已完成 A1–A3、B1–B3。以下矩阵保留实施前的依据与定位，实际结果见文末。

原则：**如无必要，无增实体。** 删除没有当前消费者的层、旧展示遗留和重复声明；有明确产品、身份、恢复、授权或可访问性职责的代码保留。不能把迁移代码、增加包装或取消错误处理称为简化。

## 结论与边界

当前最明确的问题是已退出产品调用链的旧展示仍有残留，不是所有自定义都有问题。建议先清理死 CSS，再去掉无人消费的消息操作 Context；其后独立处理仅服务于旧 Worker 展示的函数及测试。官方组件的业务接线、已批准视觉与必要安全边界不动。

本次实施不升级依赖、不替换引擎或协议、不引入组件/adapter/注册/主题/状态系统，不部署，不读取生产数据库、聊天或凭据，不调用真实模型。不从 Demo 引入 TaskCard、TaskGroup、TaskTray、SubagentList 或 ToolTimeline。队列、日期时间、活动详情的并行工作优先保留，每次实施前按当前内容重新核对。

盘点位置为宿主任务指定的 `/Users/wolf3c/Project/homer`，实际 `pwd` 一致。可用的 workspace 信息接口没有返回额外登记目录，不能声称完成了宿主数据库核验。根目录及 `ui/` 没有实体 `AGENTS.md`；采用本任务所附全局规则。读取了 `ui/DESIGN.md` 全文及 `ui/vendor/assistant-ui/README.md`。设计文件按最上方当前专项与末尾明确覆盖条款处理，保留未被覆盖的合同。旧“无任务入口”、旧 Worker 状态行、旧文件卡等描述不能覆盖较新批准。

审查过程中 HEAD 已从交办材料的 `77c2c99b107ebbf1bc38d256f6842a447aa7ad69` 变为 `a658fb86884e7d860ab86ea33098b8865f79e17d`，且存在大量既有 tracked/untracked 改动。HEAD 不是本次 dirty 源码或生产构建的身份。审查基于逐文件读取，源码指纹另见临时证据；不将其他人的改动归为本轮成果。

## 证据与真实调用链

证据等级：**S** 为当前源码及锁定安装源码；**U** 为实际取回并核验 hash 的固定官方源码；**V** 为本轮实际验证；**H** 为尚需界面或行为实验的假设。未测性能，不报告加速、内存或包体收益。没有本轮截图，不给视觉评分或 WCAG 全面合规结论。

锁定依赖以 `ui/package.json` 与根 `package-lock.json` 为准：`@assistant-ui/react@0.15.29`、`core@0.3.30`、`react-lexical@0.2.19`、`react-markdown@0.14.23`。本地 `node_modules` 对应 package 版本已核对；使用已安装实现判定 API，未把官网最新版功能当作已安装能力。

固定官方 commit 为 `1f41f91643fdb56e5d8dbd14db65f742740738a1`。本轮通过 HTTPS 重新取回以下公开源文件，字节数与 README 记录一致：

| 官方源文件 | 字节 | SHA-256 |
| --- | ---: | --- |
| [RunActivity](https://github.com/assistant-ui/assistant-ui/blob/1f41f91643fdb56e5d8dbd14db65f742740738a1/packages/ui/src/components/react/assistant-ui/elements/run-activity.tsx) | 3481 | `1b838ae6054c2c45535701af231291436e77da1d6215a2c2a80a313de5aaeace` |
| [MessageQueue](https://github.com/assistant-ui/assistant-ui/blob/1f41f91643fdb56e5d8dbd14db65f742740738a1/packages/ui/src/components/react/assistant-ui/elements/message-queue.tsx) | 2860 | `5eb1cd94c8e5a2a927a1f7a41e7af69947e5b7821a77e47daefb1498a97e0e3b` |

固定组件为本地 vendor 适配，不是直接从上述 React npm 包导出的完整成品。安装 primitives 无自带 Homer 品牌外观，删除本地 CSS 并不能自动获得完整官方主题。

当前入口及职责：

```text
ui/homer-app.tsx
  connectionFetch / ConnectionEvents → WebState
  HistoryWindow / ActiveReadPage → 有界页面与读取版本
  useExternalStoreRuntime → AssistantRuntimeProvider
    ThreadPrimitive.Root / Viewport / Empty / Messages / ScrollToBottom
      UserMessage / AssistantMessage → MessagePrimitive.Root / Parts
        MarkdownTextPrimitive → Highlight / Mermaid / LazyMarkdownImage
        ProcessMessageContent → 固定 RunActivity / WorkerEventCard / 活动阅读
        FileList → Canvas；MessageDetails → 官方 copy hook + 必要反馈
    MainComposer → ComposerPrimitive.Root → 官方 LexicalComposerInput
      HomerInputPlugin → 原 form 提交 / IME / 文件事件
      ComposerPrimitive.Attachments → Attachment primitives / 原上传 owner
      HomerMessageQueue → 固定 MessageQueue / Row + 业务编辑 / 排序接线
    SelectionToolbarPrimitive.Root / Quote
  TaskOverviewPanel；QuestionFlow / 授权卡；微信连接
  /settings/capabilities → CapabilitySettings / ChatgptConnection / NativeDiscovery
```

`src/conversation-projection.ts:55` 为过程消息设置 `toolActivities:[]`；`src/web-history.ts:109,124` 仍为真实历史返回链接和旧工具活动。这是不同来源，不能仅看到 RunActivity 就认定 MessageDetails 的历史内容全部重复。

## 一、可以有依据删除或直接缩减的项

下表定位为本轮读取时的位置，实施时应按符号/selector 重新定位。风险均指实施风险，不是已经发生的线上问题。

| 编号、位置与类别 | 需求、当前消费者与官方能力证据 | 负面影响 | 结论及准确替代 | 变化、风险、回退与最小验证 |
| --- | --- | --- | --- | --- |
| A1 `ui/process-nodes.css:12–19,23`，旧展示 CSS | `.process-worker-row/summary/label/primary/repeat/facts/name/stale` 是旧 Worker 状态行。当前 `process-nodes.tsx:100–124` 只渲染旧记录中性说明/关联入口与不可变事件卡；无这些 class 的产品产生点。旧浏览器测试还断言 `.process-worker-row` 不存在。S | 保留一套已退出界面的布局、截断和状态样式，使维护者误以为仍有第二种实时 Worker 行。 | 删除这些完整规则；保留 `.process-workers`、事件卡、关联入口、44px 操作及 reduced-motion。无需替代组件。 | 目标是零可见变化。风险为并行代码重新引入消费者；写前重扫。只恢复本批被删规则即可回退。跑现有过程渲染用例与合成浏览器，确认旧说明/事件卡及焦点不变。 |
| A2 `ui/message-details.css:1` 的 `.composer-drag-active`；`ui/canvas-panel.css:20` 的 `.artifact-preview-row`，死 CSS | UI TS/TSX/HTML 无 class 产生点；前者没有拖拽状态写入，后者已由 Canvas 文件选择器等现有结构承担。S | 无效 selector 增加误导；拖拽规则让人误以为已有激活反馈。 | 仅删两个规则，不删拖放事件，不删 Canvas 切换文件。 | 零可见变化；不承诺改善未实现的拖拽反馈。写前搜索新消费者，检查拖放和成果打开/返回。回退只补回各规则。 |
| A3 `ui/homer-styles.css:25` 的 `.native-tool-choices` 及 label/input，死 CSS | 能力页已沿原生默认提供能力，`capability-settings.tsx` 无复选框 class；该类三个规则无 UI 消费者。S | 遗留“逐工具勾选”视觉暗示与当前设计相反。 | 删除三个规则，保留 `.native-approval-actions` 等准确审批 UI。 | 无功能/权限变化；只检查合成能力页及真实授权卡仍可呈现，不执行安装/授权。并行编辑主样式时可后置本项。 |
| B1 `ui/message-details.tsx:6–10`，`ui/homer-app.tsx:30,580–592,627`，无消费者 Context/闭包 | `MessageActionsContext` 只有定义和 Provider，无 `useContext`、Consumer 或其他使用；`edit/regenerate/enabled` 无人读取。`actions.regenerate` 内的历史定位、requestId 与未确认存储写入均不可达。S | 多一层 Provider、每次 render 重建操作对象，并保留一条看似可用的重新回答路径；业务责任与当前界面不符。未测 render 开销。 | 删除 Context 定义/import/Provider 及整个 `actions` 对象；同时删除仅由该死路径发布的 `homer-unconfirmed-updated` 监听 effect（`:162`）。不新增替代层。 | 当前可见功能不变。**保留** `editDraft/setEditDraft`、`:232` effect 与`:616`“复制文字与引用到输入草稿”，它们仍服务旧排队编辑恢复。保留正常未确认存储及重试。需按 hunk 修改热文件，恢复仅限本轮删改。类型检查、复制、旧草稿恢复和未确认发送回归。 |
| B2 `ui/process-nodes.tsx:9–19` `workerDescription`；`ui/process-presentation.ts:42–73` `workerPrimaryStatus/workerOccurrenceKey/repeatedWorkerSnapshots`，旧状态/去重算法 | 产品无调用；仅 `tests/process-nodes-ui.test.mjs`、`process-presentation.test.mjs`、`process-reading.test.mjs` 与 loader 测试/导出它们。事件卡已改用自身固定内容；旧记录不再显示这些计算结果。S | 测试仍保护已退出产品的状态拼接/快照去重，给未来恢复错误展示留下入口。 | 独立小批删除四个导出和仅验证这些死导出的旧断言、loader 导出。保留 `WorkerItem`、`projectProcessItems`、真实计时/终态函数与当前事件/旧说明测试。 | 不删除业务状态或重写后端，不将测试改成迎合新行为；是撤下无产品消费者的旧展示合同。需复核是否有新消费者，活动详情并行写 `process-nodes.tsx` 时后置。本批删除可独立补回。跑现有过程渲染/事件与历史兼容测试。 |
| B3 `ui/vendor/assistant-ui/collapsible-root.tsx:1–2`，单纯 re-export 文件 | 唯一消费者为 `run-activity.tsx:6–10`；文件只有 Radix 的 Root/Trigger/Content 别名导出，无逻辑。S | 一个没有独立职责的间接模块。 | RunActivity 直接从**现有** `@radix-ui/react-collapsible` 导入 `Root as Collapsible / Content as CollapsibleContent / Trigger as CollapsibleTrigger`，删 re-export 文件，并修正 vendor README 当前接线说明；原官方文件 hash/许可作为来源记录保留。 | 不更换 Radix、DOM、props、动画或数据 owner；减少一个文件。风险为 provenance 说明不一致或并行新增 import。类型/构建、展开/收起动画及关闭后 inert/focus 检查。回退 import 和原两行文件。 |

## 二、必要保留的最少自定义

这些项有当前消费者与明确职责。保留不等于永远不可缩减；进一步删除须证明官方锁定版覆盖同一合同，且实际减少维护实体。

| 编号、位置与类别 | 具体需要、当前消费者、锁定版等价性 | 代价与边界 | 建议、影响及最小验证 |
| --- | --- | --- | --- |
| R1 `ui/homer-styles.css:1–43,45–114`、`homer-app.tsx:90–133,596–600`，品牌/主体 CSS | 用户批准河石灰 Logo、暖灰/白色表面、中文正文、760px 阅读区、内容气泡及复制区。primitives 不提供该品牌主题。S | CSS 增量叠加使覆盖顺序难读；这不证明品牌多余。 | 保留必要视觉与44px/窄屏/焦点；只删明确死规则，较大 cascade 整理另见 H1。截图核对 1440/390/320px；Logo 资产不改。 |
| R2 `homer-app.tsx:517–533`，runtime 业务数据适配 | 当前 WebState 投影到 ThreadMessageLike；原身份、process、媒体、引用、状态由服务提供，official external runtime 负责消息渲染。S | metadata 看似冗长，但删除会断开准确消息/成果/过程。messageCache 有当前 alive 删除路径。 | 保留单一投影和有界缓存，不引入第二 runtime/消息序列。核对单显 final、占位隐藏、claim/ACK 后原用户泡位置及分页。 |
| R3 `homer-composer-input.tsx:20–78`，官方输入上的 form/文件适配 | 官方 `LexicalComposerInput.tsx` KeyboardPlugin 的 Enter 调 `aui.composer.send()`，且运行中无官方 queue capability 会拒绝；Homer 则沿业务 form 处理排队与保存编辑。`submitMode="none"` 后 `requestSubmit()` 是同一提交入口。官方已有基本 IME 判断，但不能单删宿主 Enter 桥并假设业务提交等价。S | 存在两层事件模型；未用的可选回调 API 可后审，不能误删正在使用的 onPaste 编辑附件限制。 | 保留 SyncPlugin 为文本唯一同步 owner，保留 IME/Shift+Enter/文件接线；不恢复 textarea。合成 IME Enter 不发、正常 Enter 只发一次、运行中排队、编辑保存和粘贴文件验证。 |
| R4 `homer-app.tsx:136–301`、`conversation-client.ts`，草稿/未确认与编辑恢复 | 正常草稿、编辑草稿及操作身份各有不同生命周期；claimed 不可保存，unknown 不重放。`:232/616` 仍有真实恢复消费者。S | state/ref/storage 三种表示需严格核对，但不是三个可互换的数据源。 | 保留当前 owner 和所有未知结果/后写草稿保护。不删除 storage key、不迁移持久数据。正常草稿→排队编辑→取消/保存、刷新、领取竞态、未确认核对后不覆盖新草稿。 |
| R5 `homer-attachment-adapter.ts:12–86`、`homer-app.tsx:233–260`，业务上传适配与输入保护 | 官方 adapter 可管理附件集合，不知道 Homer thread/request/upload/asset/revision、确认/撤销协议和 lease。批处理预检阻止无效批次的部分上传，adapter 校验保护单个入口/重试；二者不能简单视为重复。S | WeakMap、deferred、submitted 各有职责；submitted 在 send-clear 时消费，显式 discard 与发送清理不能合并。 | 保留身份、8MiB/10个限制、批序、未知上传原身份重试和失败保留，不新加上传队列。合成上传、失败重试、移除失败保留、发送不 discard 验证。 |
| R6 `homer-attachments.tsx:7–28`，官方附件内必要预览/失败反馈 | 官方 `AttachmentThumb.tsx` 仅展示扩展名/类型或 children，不创建图片 URL；`AttachmentRemove.ts` 调 `remove()` 未返回 Promise。当前每行 URL effect 和本地 await/catch 有明确缺口。S | Controls Context 为官方附件 slot 传当前状态；删除需另建接线，不会减少职责。 | 保留官方 Attachments/Root/Name/Remove/Thumb 及 URL 清理、失败反馈与准确 ID。URL 随附件移除释放；失败项不消失；刷新仅保留确认元信息。 |
| R7 `message-details.tsx:12–47`，官方 copy hook + 宿主按钮/反馈 | 安装版 `ActionBarCopy.tsx` 不接受自定义 writer；`core/src/store/primitive-predicates.ts:48–53` 对 streaming assistant 禁用 Copy。hook 可以接同步启动的 writer，宿主补 pending/error，按当前 message 清理异步回写。S | 并非复刻完整 ActionBar；删本地 writer 会丢失败说明/流式复制或浏览器用户激活。 | 保留 hook 和小按钮，不用完整 ActionBar 取代。流式复制当前文本、双击 pending、剪贴板拒绝反馈、消息切换与用户泡44px验证。非runtime备用分支另见 H2。 |
| R8 `vendor/assistant-ui/run-activity.tsx`/CSS 与 `process-nodes.tsx:125–168`，固定官方结构 + 业务生命周期 | 官方 API 接受 status/entries/open/onOpenChange/durationLabel；不负责保存身份、真实耗时、terminal once、历史懒读。当前局部 CSS 是官方 utility 的等价映射。S/U | Radix Presence 动画及关闭后 `inert/aria-hidden` 是现有依赖与焦点适配，不能删为“纯官方”。 | 保留14px、间距、单层列表/细线、200ms/reduced-motion，计时不猜测。只做 B3 直接 import。验证首次终态收起一次、手动重开、焦点、懒读旧响应与断线状态。 |
| R9 `process-nodes.tsx:33–71,108–112`，活动只读入口 | ActivityReader 核对 node/item/thread/revision，取消旧读取；关联任务/版本/Run、成果、原交付由既有 owner 再核对。官方 RunActivity 无该阅读数据能力。S/U | 独立 dialog 有焦点/加载成本；没有第二过程树或通用详情框架。 | 保留轻量准确读取，不换成随当前任务变化的历史文本。活动加载/失败、关闭 abort、回焦、跳任务/原答复/Canvas；禁止触碰其并行实现。 |
| R10 `process-nodes.tsx:100–124`，旧兼容说明/不可变 Worker 事件卡 | 旧无事件记录只说明内容未保留；新卡片 title/body/eventKey 取固定事件，折叠后仍单显。官方“任务卡”不是同一合同。S | 两种来源有兼容成本，不能把旧记录伪造成新事件。 | 保留事件正文/图标角标及无按钮语义；不引 Demo。同事件重放、终态展开/折叠各一次、历史不随验收变化、不出现卡片按钮。 |
| R11 `vendor/assistant-ui/message-queue.tsx:8–29`、`homer-message-queue.tsx:19–106`，官方内部 fork + slots | 固定官方只有 running（必填）、queued{id,text}、onCancel，计数为 loaded length，无编辑、锁定、分页、排序。Homer 的 optional running、准确总数/编号、row slots 和 disabled 支持真实业务。S/U | 与 upstream 有差异，但回归原版会删已批准功能/误报数量。 | 保留最小 slots/结构、中文、14px/44px/760px；不引官方 runtime queue。真实 sourceRequestId 不猜最近泡，旧服务不伪称总量；验收同当前队列浏览器用例。 |
| R12 `homer-message-queue.tsx:11–17,31–106`、`queue-operations.ts:28–75`，服务队列接线/临时拖动 | dnd-kit 仅预览临时 DOM 顺序；MainInputs.move 以版本/CAS提交。pending operation 为结果未知恢复身份，page 为有界读取，不是另一个调度器。S | 需维护版本、取消、失效焦点与同段边界，直接 primitive 不提供。 | 保留独立手柄、键盘/菜单替代、刷新/领取/换序后失效；不删旧运行分支。验证拖动取消不提交、跨段被阻止、原 operation 核对、窄屏保存/独立停止。 |
| R13 `file-list.tsx:27–49`、`file-list.css`、`homer-app.tsx:85–89`，纯成果列表 | FileList 只管理名称、类型、点击/可访问说明，caller 管真实 ID/权限/顺序；当前主对话与原记录调用。官方附件不是正式 publication 列表。S | `ArtifactFiles` 是消费 ArtifactsContext 的小桥，不是第二文件 owner；移除只会在多个 caller 重复同一接线。 | 保留紧凑列表，不加第二卡片/详情容器/下载。多文件/同名不同 ID、长名、44px与原归属检查。 |
| R14 `canvas-panel.tsx:10–122`、`homer-app.tsx:535–575,624–625`，成果/原答复与隔离 | 官方对话组件不承担 publication 授权、准确兄弟文件、对象 URL、HTML默认源码/用户主动隔离预览、桌面并排/移动 modal。S | 多个 abort/ref/dialog 各承接身份与焦点；抽统一 reader 并不能证明更简单。 | 保留原实现与URL释放；仅删 A2 死样式。验证准确ID切换、旧响应丢弃、回原答复/焦点、隔离模式与撤销，不实际加载外站。 |
| R15 `homer-app.tsx:303–330`、`question-flow.tsx:5–26`，结构化问答及授权恢复 | QuestionFlow 的问题ID/选项/审阅回调消费 WebInteraction；授权独立，原交互/线程/Run与确认身份不可换为通用选择组件。S | local/session草稿、busy/accepted 的差异有恢复合同。 | 保留问题流程、拒绝/过期/未确认处理与16k限制；不替模型提交审批。合成逐题、自由答、审阅、刷新与原回调失效测试。 |
| R16 `task-overview.tsx:14–132`，产品功能与准确历史 | 已批准按需只读总览；summary/history/read epoch、要求版本/Run/验收/publication分别表达。官方任务展示元素没有 Homer 数据读取与权限合同。S | 有业务复杂度；不能以减少文件数为由把任务详情混进消息runtime或历史事件。 | 保留现有面板、按需查询、FocusScope及回焦。合成总览/详情、Escape层次、同名版本及成果原归属；不重画整套UI。 |
| R17 `history-window.ts:7–62`、`active-read-page.ts:4–30`、`lazy-media.tsx:7–24`，读取有界性/媒体 | 历史窗口最多5页，revision/epoch拒绝旧覆盖；活跃页有读取token；媒体2请求预算/IntersectionObserver/URL清理。Thread runtime 不提供这些服务协议。S | 存在有界缓存和取消逻辑，未测额外优化收益。 | 保留现有 owner/创建失效路径，不用新的cache层。历史定位、分页、断线/旧epoch与媒体卸载验证。 |
| R18 `chat-date.ts`、`message-timestamps.tsx`/CSS，日期时间展示 | 当前正式消息渲染消费者存在；真实 createdAt、时区、日界/唤醒更新、隐藏runtime占位。是已在并行推进的产品项。S | 当前设计旧段“无时间”与新增任务需求需由其 owner 处理，本轮不据旧条款删除。 | 保留，不触碰。仅在最终联合验证时确认未被本轮误改；不在此新增日期系统。 |
| R19 `waiting-status.ts`、`homer-app.tsx:280,525–533,579,601–605`，状态/停止/用量 | 主活动、后台Worker、连接/升级、发送未知分别归属；独立停止目标准确 activeMessageId；用量按有效原生计数。S | 文案和两个停止入口可能像重复，但 onCancel 为 runtime adapter 合同，不能未经测试删除。 | 保留状态真假、独立停止及必要错误反馈，不估费用/进度。主结束后台仍跑、停止未确认、离线草稿和用量折叠检查。 |
| R20 `homer-app.tsx:58–63,119`、`markdown-code.tsx:6–10`、`mermaid-diagram.tsx`，Markdown/数学/图表 | 正式答复用 MarkdownTextPrimitive，Canvas/公开进展用不同渲染上下文；数学/图表为已批准内容能力，公开进展限制外部图片。S | renderer 配置部分相似但内容边界不同。强行统合会增加可选分支或改变资源策略。 | 保留当前库与安全降级；不加统一renderer实体。数学、Mermaid失败回退、长中文/表格及允许链接测试。 |
| R21 `capability-settings.tsx`、`native-discovery.tsx`、`chatgpt-connection.tsx`、`wechat-connection.tsx`、`web-connection-client.ts`，业务管理/通道 | 入口均在当前 UI 调用链。配置已保存/当前已采用、bound/online、用户主动授权/安装有实际区别；连接包装绑定当前 gateway。assistant-ui 无该业务owner。S | 可见内容较多但不是重复对话组件；改写会涉及本轮排除的权限/运行语义。 | 保留；本轮仅 A3 死CSS。合成入口可读即可，不真实登录/安装/扫码/变更配置。更新审阅页由服务端生成，不纳入此轮前端改造。 |
| R22 `composer-icons.tsx`、`file-list.tsx:14–24`、vendor内SVG，局部图标 | 已有小型ComposerIcon供输入区复用，FileList类型图标和Worker事件图标语义不同；vendor保留固定官方几何。S/U | arrow/close 路径确有少量重复，但抽统一注册器或引lucide依赖会扩大实体。 | 保留现状，不新增图标平台；若只删几行却耦合vendor与业务组件，不值得。许可文件继续保留。 |

## 三、可替换但尚不应直接动的项

| 编号与定位 | 已知事实和不足 | 决策、影响与验证门槛 |
| --- | --- | --- |
| H1 `homer-styles.css:4,8,32–43,45–66` 与 `message-details.css:1`，叠加CSS | 旧 `.user-message` 的 surface/padding/radius 被后部新泡覆盖；`.composer:focus-within` 与 base border/shadow相同；旧64px `.composer-thumbnail`/旧flex预览被 `.composer …` 覆盖。S。但尚无本轮 computed-style/截图证明所有尺寸、焦点与导入顺序等价。H | 推荐后续**原地删除被完整覆盖的声明**，不新建token/theme/组件、不整文件格式化。先录桌面/窄屏、focus/blocked、附件准备/失败/展开的computed style，再删再比。第一批不包含这些声明。 |
| H2 `message-details.tsx:12,25,35`，非runtime备用复制分支 | 当前仅两处 `<MessageDetails runtime …>`，非runtime路径无产品caller。S。去掉布尔模式会使组件更窄，但需要复核测试fixture和正在推进的消息操作。 | 推荐在 B1 后单独收窄为当前runtime合同；暂不在首批合并，避免把必要异步保护一起删。保留 pending/error/可选文本能力；以现有流式复制和失败场景验证。 |
| H3 `message-details.tsx:32–34`，旧工具/链接详情容器 | 新process消息不附旧工具list，但旧历史可附 `toolActivities`；sources由实际回复链接提取并明确未核验。S。尚无证据证明所有页面均无消费，或用户愿意撤销“引用与链接”入口。 | 保留，不能以“又一层details”直接删除。若同一准确消息在合成兼容页真有重复，再在展示owner有条件消重；不删原history字段、不统一详情框架。 |
| H4 `process-presentation.ts:13–39`，旧tool分组中间结构 | RunActivity已经单层，caller仍先构造tools组再flatMap。S。该投影还承担最新revision、稳定插入位置及旧workers分离，并有真实消费者。 | 暂缓。单纯重写返回类型会触及多个调用/测试，收益不等于删掉死函数。只有证明可在现有owner直接简化且不增加替代层，再提出准确增量。 |
| H5 MainComposer/form 与 Lexical DROP 的两级拖放 | editor捕获正文内drop，form接正文外上下文/底栏drop，`defaultPrevented`防重复。S。不能把双handler当双上传owner。 | 保留。可选未用 onKeyDown/onDrop 参数属于窄API清理候选，但收益小；不为此重构组件，先覆盖正文内/外一次上传与编辑阻止附件路径。 |
| H6 依赖声明与多种Markdown上下文 | 项目直接声明一些 Lexical依赖，官方输入内部也使用它们；`react-markdown`在Canvas/过程仍直接使用。S。尚未完成独立依赖归属/构建兼容审查。 | 不移除/升级包或重写lockfile；不得将“外层未import”当整个依赖没用。本轮无必要增减依赖。 |

CSS扫描特意排除误报：`.aui-lexical-input/.aui-lexical-placeholder` 来自安装库，`.katex-display` 来自KaTeX，`.lazy-media-voice` 来自动态拼接，`.is-delegated/is-result_received/is-start_failed` 来自事件kind拼接。它们都不能因本地无完整字面量而删除。

## 最小实施顺序、准确文件与验收

先实施下面两批，能独立验证及回退；CTO 可在同任务审阅后继续，无须再次向用户索要原则性清理许可。B2/B3 是有证据的小批后续项；H类不与首批捆绑。涉及功能删减/设计冲突/持久语义改变或同时写同一代码时，指出准确hunk及影响，继续不冲突项。

### 第一批：只删除死 CSS（A1–A3）

拟改产品文件仅：

- `ui/process-nodes.css`：删旧 `.process-worker-*` 规则，保留当前 `.process-workers` 兼容说明及事件卡。
- `ui/message-details.css`：只删 `.composer-drag-active`。
- `ui/canvas-panel.css`：只删 `.artifact-preview-row`。
- `ui/homer-styles.css`：只删 `.native-tool-choices` 三条规则；主样式若同hunk并行变化则后置，不覆盖。

完成标准：四类死规则消失，零新增selector/组件/依赖；现有DOM/状态/协议/视觉不变；源码增量中无他人改动。复用合成页面在1440/390/320px留前后图，验证Worker新卡/旧说明、附件拖放、Canvas文件切换、焦点与横向溢出。没有覆盖所有状态的静态CSS扫描不能替代此检查。

### 第二批：移除不可达消息操作 Context（B1）

拟改产品文件仅 `ui/message-details.tsx` 与 `ui/homer-app.tsx`，按上表准确符号删定义/import/Provider、actions闭包及失去唯一publisher的监听。`createContext` 在主文件仍有真实用途，不误删。保留整个有效复制逻辑、队列操作、`editDraft` 及恢复按钮。无可见按钮或有效操作减少，不恢复设计文档提及但当前未接入的“编辑/重新回答/朗读/反馈”；缺失功能的产品决定不属于本清理。

完成标准：Context无残留且无替代Context；旧草稿复制仍可到主输入；正常/未知发送沿原身份、刷新保留后写草稿；流式复制和失败反馈不变。热文件写前重新读取并检查内容/指纹，以小hunk修改；发生同代码并行写时不套用静态patch。

### 后续独立批次（B2、B3）

B2 准确文件：`ui/process-nodes.tsx`、`ui/process-presentation.ts`、`tests/helpers/process-ui-loader.mjs`、`tests/process-nodes-ui.test.mjs`、`tests/process-presentation.test.mjs`、`tests/process-reading.test.mjs`。仅删除对应死导出的断言/导出，不减少事件卡、当前旧记录说明、准确身份/终态/计时测试，不整文件重写。

B3 准确文件：`ui/vendor/assistant-ui/run-activity.tsx`、删除 `ui/vendor/assistant-ui/collapsible-root.tsx`、更新 `ui/vendor/assistant-ui/README.md`。保留 LICENSE、官方输入文件原hash和所有CSS。不是引入新的Collapsible组件。

### 检查与隔离

第一阶段已完成 `node_modules/.bin/tsc --noEmit -p ui/tsconfig.json`，exit 0；三份建议patch的 `git apply --check` 均为 exit 0，未应用。全部50份取证源文件与读取时指纹一致。结果记录于 `stage1-validation.json`。没有运行全套测试、浏览器、候选构建或生产验证。文档/预览patch均不代表清理已完成。

第二阶段先复用现有稳定验证；死CSS、不可达Context与re-export不另写镜像测试。若实施时出现可独立断言的有效行为变化，先写红测，再修改，并重新判断是否超出清理范围。

- 类型：上述 UI tsc 命令。
- 定向过程：`node_modules/.bin/tsx --test tests/process-reading.test.mjs tests/process-presentation.test.mjs tests/process-nodes-ui.test.mjs`，先核fixture仅用内存/任务scratch；不连接生产。
- 定向输入/附件：`tests/main-composer.test.mjs`、`tests/homer-attachment-adapter.test.ts`，及已有 `tests/ui-component-simplification.browser.mjs` 的合成fixture；若仅删 A类，优先用一次相关合成浏览器覆盖而非重复全仓。
- 构建：使用现有 Vite CLI 和 config，将 `outDir` 指向本轮 `.codex/scratch/.../candidate-web`，不运行默认清空共享 `dist/web` 的构建。可用 `node_modules/.bin/vite build ui --config ui/vite.config.ts --configLoader runner --outDir /Users/wolf3c/Project/homer/.codex/scratch/assistant-ui-simplification-20261022/candidate-web`；UI类型单独执行。输出目录权限和fixture先核对，再运行。
- 浏览器复用现有脚本支持的 `HOMER_COMPONENT_BUILD`、`HOMER_BROWSER_EVIDENCE` 指向本轮candidate/证据目录；前后使用同一合成输入及viewport。若已有脚本硬编码其他路径，先核实，不启动可能访问生产的默认 dev/server。
- 运行前像/候选各构建一次即可；相关源码再变或检查失败才重跑。若并行变更导致基线变化，区分本批增量与其他变化，不声称像素差异全由本清理产生。

证据位于 `.codex/scratch/assistant-ui-simplification-20261022/`，已核 Git-ignore。`.codex` 在默认沙箱为只读；已通过工具审批仅创建/写入本任务审查目录，未更改目录权限。目录含源码身份清单、官方源对照与建议patch，不包含生产数据。可维护结论保存在本文，不依赖临时目录作为唯一来源。

审阅材料：`A-dead-css-PROPOSED.patch`、`B1-unused-context-PROPOSED.patch`、`B3-direct-radix-PROPOSED.patch`。`proposal-bindings.json` 记录每份建议的文件前像与候选 hash，`review-before/` 保留对应前像；`source-inventory.json` 记录本轮读取源码身份。补丁仅为建议，不是已实施差异，也不能跨并行更新直接套用。B2因牵涉旧测试，先列准确删除范围，不与首批补丁捆绑。

回退只恢复本批准确删改hunk，不 `git checkout/reset` 整文件，不回退共享HEAD/其他工作。第一阶段没有产品源码变更；第二阶段前像与实际增量保存在下述实施目录。

## 第二阶段实施结果

2026-10-22，用户明确要求实施本计划。本次实现基线 HEAD 为 `453f843`，工作区既有的队列编辑修正、主样式变更及其他未提交内容均保留。实施前再次搜索真实调用点、保存当前前像并构建；没有直接将旧审查前像整文件覆盖到当前源码。

### 实际删减

| 审查项 | 已实施的准确范围 | 保留内容 |
| --- | --- | --- |
| A1 | `ui/process-nodes.css` 删除旧 `.process-worker-*` 展示规则 | `.process-workers` 旧记录说明、44px操作、当前事件卡与 reduced-motion |
| A2 | `ui/message-details.css` 删除 `.composer-drag-active`；`ui/canvas-panel.css` 删除 `.artifact-preview-row` | 输入/容器拖放、附件预览、Canvas文件选择与焦点 |
| A3 | `ui/homer-styles.css` 删除 `.native-tool-choices` 三条规则 | 授权操作、能力页、品牌变量及其他样式；没有做整文件整理 |
| B1 | `ui/message-details.tsx` 删除 Context 定义；`ui/homer-app.tsx` 删除该 import/Provider、无人消费的 actions 闭包与失去唯一发布者的事件监听 | 全部有效复制逻辑；`editDraft/setEditDraft`、旧草稿复制按钮、正常/编辑草稿恢复与未确认发送合同 |
| B2 | `ui/process-nodes.tsx` 删除 `workerDescription`；`ui/process-presentation.ts` 删除 `workerPrimaryStatus/workerOccurrenceKey/repeatedWorkerSnapshots` | 投影、真实计时、终态及旧记录兼容；没有删除任何业务状态字段或事件数据 |
| B2 测试 | `tests/helpers/process-ui-loader.mjs` 去掉死导出；`tests/process-nodes-ui.test.mjs`、`tests/process-presentation.test.mjs`、`tests/process-reading.test.mjs` 仅删除对应的5个旧函数用例 | AST 对照确认所有保留测试体逐字一致；事件卡、历史身份、final单显、终态与时钟用例均保留 |
| B3 | `ui/vendor/assistant-ui/run-activity.tsx` 直接导入相同 Radix exports；删除 `collapsible-root.tsx`；更新 vendor README | 固定官方DOM/CSS、typed props、Presence、inert/aria-hidden、动画与许可 |

没有新增产品组件、adapter、Context、状态 owner、依赖或主题实体。H1–H6 依原计划暂缓：本次没有整理完整 CSS cascade、收窄非runtime复制模式、取消历史工具/链接入口、重写过程投影、合并拖放事件或调整依赖。

### 验证中发现的既有测试竞态

原 `tests/ui-component-simplification.browser.mjs` 在前像和候选均失败于附件重试后的URL/缩略图断言。对前像在**同一次断言求值**内取证：已创建3个、已撤销2个URL，只有一个活动URL，但重试替换附件行时旧缩略图已经移除，新行预览尚未渲染。此前单独等待到的已加载图片不能保证下一次求值仍是当前行。

对该既有浏览器测试只修改等待条件：同时等待上传状态结束、当前缩略图加载完成及活动URL数为1，保留原URL断言和移除后全部释放的断言；不加固定sleep，不修改附件产品实现。前像与候选使用该相同等待条件后，三个尺寸的全部57项检查均通过。这是验证取样的稳定化，不是删除断言以消除产品失败。

### 实际验证结果与限制

| 检查 | 结果 |
| --- | --- |
| UI 类型检查 `node_modules/.bin/tsc --noEmit -p ui/tsconfig.json` | 通过 |
| 定向过程、主输入与附件5个测试文件 | 基线48条通过；删除5个仅验证死导出的旧用例后，保留43条全部通过 |
| UI前像及候选 Vite构建 | 均通过，输出仅在本任务scratch；既有大chunk提示保留，未宣称性能或包体改善 |
| 综合浏览器 `ui-component-simplification.browser.mjs` | 相同稳定等待条件下，前像/候选各57项通过，1440/390/320px |
| 过程阅读 `process-reading.browser.mjs` | 前像/候选各24项通过，三个尺寸；官方指标、顺序、旧兼容、异常与终态合同保持 |
| 收起焦点 `run-activity-focus.browser.mjs` | 三个尺寸通过；关闭动画中不能Tab/程序聚焦进入面板，重开后可达 |
| 活动与Canvas `run-activity-facts.browser.mjs` | 候选36项通过，三个尺寸；原版本/任务、只读活动、Canvas、返回焦点、迟到响应与连接变化保持 |
| 固定合成内容前后图像及计算样式 | 三个尺寸各5种状态，共15组/30张截图；采样的计算样式相同，逐像素差异为0 |
| 旧排队编辑草稿复制与刷新 | 前像/候选均保留原新消息草稿、旧文字/引用/批注及原requestId；未发出新消息或停止请求 |
| 最终增量审阅 | 按实施前像逐文件核对；既有队列/日期/活动等其他改动保留，未整文件回盖 |

图像场景包括折叠/展开的过程、Worker事件与旧说明、恢复后的输入草稿、附件预览及完整文件名。截图对照使用固定合成数据、相同视口及reduced-motion，并隐藏光标闪烁；正常动画/焦点另由原浏览器用例检查。0像素差异仅适用于这些选定场景，不代表覆盖所有页面或生产运行。

全部HTTP均为隔离fixture的随机本地端口；需要后端的fixture使用内存数据库和禁止执行的fake engine，其调用计数为0。没有生产数据库、真实对话、账号、授权写入、真实模型、上线或全仓测试。证据目录不属于产品静态资产。

实施证据位于 `.codex/scratch/assistant-ui-simplification-20261022/implementation/`：

- `before-identities.json`、`before/`：实际实施前像；`additional-preimages.json` 标明浏览器测试等待修正的可逆前像。
- `before-web/`、`after-web/`：同一工作区前后构建。
- `implementation.patch`、`stage2-validation.json`：仅本轮增量、文件身份和验证索引。
- `before-components-exact/failure-context.json`：前像原断言的同次取样证据。
- `before-components-settled/`、`after-components-settled/`、`before-process/`、`after-process/`、`after-focus/`、`after-activity/`：现有用例结果及截图。
- `visual-review/visual-review.json` 和同目录前后PNG：15组比较结果；桌面示例 `before-expanded-1440.png` / `after-expanded-1440.png`，窄屏附件示例 `before-attachment-filename-320.png` / `after-attachment-filename-320.png`。

回退时以本轮前像和 `implementation.patch` 的准确hunk为准，遇到后续并行变化先核对，不恢复整个共享文件或HEAD。原审查阶段 `*-PROPOSED.patch` 继续只是历史建议，实际实施以本节记录与源码为准。

## 复审与提交边界

用户随后要求复审并提交。逐项检查本轮前像增量、当前消费者、保留测试体、异步保护和实际暂存内容，未发现这批精简引入的待修正缺陷。结论限定于本轮删除范围与以下本地验证，不表示对整个工作区或生产运行的全面认证。

消息操作 Context 及事件监听只有已删除闭包作为消费者/发布者；正常发送、原草稿恢复和复制的异步身份保护仍有自己的有效入口。旧 Worker 函数没有产品调用点，保留测试不再依赖死导出。直接导入的 Radix exports 与原转导出完全相同，没有更改组件生命周期或关闭时的焦点保护。未新增循环、effect、定时器、请求、状态或依赖。

同一实施前后构建的全部3个 JS/CSS 产物测量如下。gzip 为本地逐文件压缩计算，非线上传输观测；不能从体积推导实际延迟或吞吐提升。

| 指标 | 前像 | 精简后 | 减少 |
| --- | ---: | ---: | ---: |
| JS/CSS 总字节 | 2,436,108 | 2,433,471 | 2,637 |
| 本地 gzip 总字节 | 770,713 | 770,013 | 700 |

主入口仍有既有大 chunk，未在本轮引入额外分包或升级方案。没有生产性能压测，因此不承诺所有负载下的响应时间。

工作区类型检查及43条定向测试复验通过。为确认提交不依赖其他未提交内容，将**准确 Git 索引**中的有限源码和直接测试依赖复制到本任务 `review-index/` 临时目录，复用现有 node_modules，没有创建分支、Git worktree 或生产服务。该快照的UI类型检查、Vite构建和三个过程测试文件的29条用例均通过；隔离合成浏览器在1440/390/320px共57项检查通过，结果记录于 `review-index-browser/`。

`ui/homer-app.tsx` 与 `ui/homer-styles.css` 只按本轮hunk暂存，既有队列编辑修正和其他主样式改动仍留工作区。另将本轮修改但此前未跟踪的 vendor README、过程阅读测试、综合浏览器测试纳入提交；为使浏览器测试可独立运行，一并审查并纳入其现有直接依赖 `tests/fixtures/composer-browser-server.mjs`、`tests/web-history-browser-cdp.mjs`。这些辅助文件只服务隔离合成测试，不进入产品bundle。其他未提交内容及临时构建、截图、浏览器配置均不提交。
