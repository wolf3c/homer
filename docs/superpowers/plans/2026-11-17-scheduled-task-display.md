# Homer 定时任务展示：仅保留 Preview

> **状态：源码已实施，定向离线及正式组件合成渲染验收。** 未提交、安装或部署，未读取或操作真实计划；实施结果及限制见第 8 节。

目标：**对话用普通答复，所有结构化展示集中到右侧 Preview。** 保留本地 Demo v5已确认的右侧列表、只读详情和引用chip；v5中的左侧卡片不再属于实施范围。复用现有数据、组件和发送路径，不新增业务实体。

## 1. 最终功能

| 位置／动作 | 行为 |
| --- | --- |
| 对话 | Homer正常答复创建、修改或取消结果；不显示定时任务卡片，不读取创建回执来组装界面 |
| 定时任务中心 | 现有右侧Preview的唯一“定时任务”标签，统一展示本实例本人可见的全部安排，不区分Homer／Worker；启用记录在前，停用记录收起，更多按需读取 |
| 列表卡片 | 标题、规则、投递时间；状态在标题行右侧，对话图标在规则行右侧。规则异常不能被隐藏 |
| 只读详情 | 点击列表卡片打开详情；顶部定时图标＋任务名，官方SpecSheet列出规则、显示时区、当前状态、投递时间、必要说明，完整任务内容放最后；字段区滚动，标题与关闭按钮保持可见 |
| 引用chip | 点击对话图标将准确安排带入原输入框，保留可移除chip，不覆盖原草稿、附件或其他引用；不自动发送、不打开详情。桌面保留Preview，窄屏回对话 |
| 修改与取消 | 用户发出指令，Homer使用原 `schedule_list/update/cancel`；没有编辑表单、时间选择器、启停开关、直接取消按钮或运行历史 |

“全部”仍遵守原实例、来源和设备权限，不把中心变成Worker或群渠道的全量读取工具。创建成功只表示安排已保存，到点入箱也不表示业务完成；普通回复继续沿原工具事实表达，不新增自动回执文案或特殊消息。

## 2. 数据读取与刷新

只增加一个只读操作：`POST /api/schedules/read`，沿现有 `WEB_CHAT_POST → createWebChat → WebBridge` 同时供桌面与配对移动端使用。

- 列表：`{readEpoch, view:'list', offset?, limit?}`，默认20、上限100，返回thread/readEpoch、当前摘要与nextOffset。只返回id/revision、推导标题、规则、时间及状态字段；完整text在详情需要时读取，不塞入普通state包。
- 详情：`{readEpoch, view:'detail', scheduleId}`，返回该安排当前完整text和展示字段；响应附宿主显示时区。每次打开读取当前值，不把列表快照当成最新详情。
- 服务端取得实例与线程范围，复用 `validateScheduleSource` 校验来源，不接受客户端提供owner/authority，也不依赖活动模型轮。沿已有allowPreparing能力允许仍获准但渠道准备中的来源读取，真正撤权仍拒绝；权限过滤后分页。
- Preview打开、原state事件、重连及页面恢复时重读。只在打开时刷新，合并在途读取，用现有thread/readEpoch和请求取消处理旧响应；不加轮询、持久缓存、新revision或事件总线。加载下一页按id去重；state刷新从首屏重读，清除旧分页，数量只代表当前已加载项。
- 不以 `history.page.revision` 变化作为唯一刷新条件：它不监听schedules；当前 `service.db.onChange → StatePublication` 会发送state事件，即使历史revision相同，打开的列表也要刷新。
- 读取失败用现有错误行说明，不能显示成空列表或把旧详情标为当前值。明确来源拒绝可过滤记录，存储故障应让读取失败，不照搬原工具allowed的笼统catch。无需新审批、恢复面板或自动写操作重试。

不读取 `schedule_create` 历史回执，不判断创建者，不匹配消息／thread／turn，不增加scheduleReceipts或来源绑定字段，不做历史迁移。中心只读现有安排；即使创建后的对话失败，实际已保存的安排仍在中心可见。

## 3. 状态：只展示有依据的事实

| 当前事实 | 文案 |
| --- | --- |
| enabled=true、无errorCode、nextFireAt在未来 | 已启用 |
| enabled=true、无errorCode、nextFireAt已到 | 到期待投递；显示“原定投递”，不猜原因 |
| errorCode非空 | 规则异常；若同时停用，以停用为主并保留异常说明 |
| enabled=false | 已停用，不推断取消或完成 |
| 当前id/revision匹配confirmed取消回执 | 已取消后续投递；旧修订回执不能覆盖新值 |
| confirmed投递操作与scheduled_message精确对应 | 附加“原定X的消息已进入Homer收件箱”；不是工作完成，scheduledAt不是实际入箱时间 |
| 无可用下次时间／读取未确认 | 时间或状态未确认，不造正常值 |

为保持v5中真实的取消／入箱说明，只保留**状态用途**的既有 `schedule_cancel`、`schedule_delivery` 回执查询，以及delivery与入箱消息的对应；它们不是对话卡片关联，不涉及创建回执、助手消息或原生历史。批量读取必要事实，不展示pending/offered/received等队列内部状态，不新建执行记录。

一次时间保存为UTC，按宿主IANA时区显示并标注；周期使用规则自身时区。普通固定规则用中文，其余直接显示cron＋时区，不另写日历解析器。标题从正文首句推导，不增持久title；前端不自行判定已经投递。

## 4. chip 如何准确进入 LLM 输入

保持v5效果，只在原Composer草稿增加一个可选 `{scheduleId,label}` UI值，复用已有上下文区、保存和移除按钮；不冒充MessageQuote或resourceReference，不新增服务端引用协议。

1. 图标选择该ID并显示chip，再次选择替换这枚chip；用户明确发送。chip本身不让空草稿变成可发送消息，答题或排队编辑等冲突输入状态不写入普通草稿。
2. `MainComposer.submitDraft` 在原 `prepareMessage` 前，将chip作为短上下文拼入普通text。例如实际模型输入：

   ```text
   用户选择的定时任务：{"scheduleId":"schedule-完整UUID","label":"整理 AI 行业简报"}

   把这个改到每天上午十点。
   ```

   用JSON序列化数据；完整ID用于定位，名称只供阅读。不携带缓存revision、任务全文或授权声明，它仍是普通用户消息。
3. 原 `canSubmitMessage` 目前只检查未拼接正文，`prepareMessage`只组包；因此合成后再次使用原 `canSubmitMessage` 校验16000字符，再执行现有 `messageInputFits` 传输预算检查。超限保留正文和chip，不扩展上限。
4. 只生成一份原requestId/input快照，沿原发送、排队及回执路径处理。清空普通草稿时同时清空chip；未知发送继续用原pending的已拼接text，不再拼一次。聊天历史、排队编辑和失败恢复保留这份普通文本，不再反解析成chip协议。
5. Homer按完整ID调用原 `schedule_list({scheduleId})`，读取当前内容与revision，再按用户指令调用update/cancel。不能按同名标题定位或使用缓存revision；只问详情就只查，查不到／无权限时不换相似任务代替。版本冲突及结果未知沿原工具规则核对，不自动重做或另建安排。

需要在 `ui/conversation-client.ts` 原草稿辅助函数接上这一个值：`restoreComposerDraft` 当前会重建对象，必须显式保留chip；用同一拼接函数比较已接收pending与当前草稿，避免发送中刷新后重复恢复；`restoreRejectedSourceDraft` 的空草稿判断计入新chip，不能覆盖用户新选的安排。恢复原pending时直接使用已拼接text，不恢复一枚会重复拼接的chip。普通草稿临时切换到答题时，一并保存／恢复此值；不另建草稿管理器。

完整ID让LLM能使用已有工具准确定位；chip不授权修改其他任务或新增持续安排。现有工具身份、来源权限、expectedRevision与幂等机制保持，不新增LLM工具、提示词框架或模型自批流程。

## 5. 修改哪些代码

2026-11-17复核，cwd `/Users/wolf3c/Project/homer`，HEAD `b11e2c64`；共享树有并行调整，实施按函数定位并保全其他事项改动。

| 文件／位置 | 最小修改 |
| --- | --- |
| **新增** `src/schedule-display.ts` | 只读列表／详情、必要状态事实与公开DTO，消费现有db和宿主范围；不写库、不读创建历史 |
| `src/service.ts`：validateScheduleSource附近 | 提供可信本人UI的只读入口，复用实例和来源校验；不改变scheduleTool认证或调度 |
| `src/web-homer.ts`：bridge构造 | 仅接只读入口；不改page、历史消息投影或正式答复 |
| `src/web-contract.ts`、`src/web-chat.ts` | WebBridge增加只读方法、WEB_CHAT_POST注册一个read操作，沿原验证和有界读取方式分派 |
| **新增** `ui/scheduled-messages.tsx` | 列表、卡片、详情共用组件；一个selectedScheduleId与打开按钮ref，不为每张卡片建缓存或Dialog |
| `ui/homer-app.tsx`：MainComposer／previewTabs | chip草稿与发送前拼接；原Preview增加唯一schedule标签。不改AssistantMessage |
| `ui/conversation-client.ts`：草稿类型与恢复函数 | 保留chip、统一拼接比较、防止覆盖新草稿；ConversationInput仍沿原text |
| `ui/canvas-panel.tsx`：CanvasPanel | 在原Tabs与容器中增加定时内容分支；原Group/Panel、文件tab、唯一Reader、批注和回焦保持 |
| vendor、局部CSS构建、测试和文档 | 固定官方源码与许可，沿现有样式编译；补必要回归，实施后更新定时架构／索引、DESIGN和testing状态 |

**无需改动：**对话消息类型、`src/conversation-projection.ts`、`src/main-process.ts`、`src/web-history-pages.ts`、AssistantMessage、`ui/chat-date.ts`，也不改 `src/schedules.ts` 调度、原 `src/schedule-tools.ts` 工具／回执、主队列或Worker生命周期。无schema迁移、创建者分类、来源补字段。

桌面 `src/web-server.ts` 和移动 `ui/mobile-request.ts` 已经共享webChatPost的固定POST分派，预计不需专用分支；以传输回归确认，不重复写两套接口。

## 6. 组件复用与必要验收

- **ScheduleCard**仅用于中心，继续用v5的官方源码适配版；保留标题／时钟／规则／时间，移除开关与运行历史，增加状态、独立详情触发和引用动作。不是未修改的官方成品。
- **SpecSheet**使用固定提交 `1f41f91643fdb56e5d8dbd14db65f742740738a1` 的原组件，仅适配cn/range导入，字段渲染不裁剪；固定源码及差异说明见[vendor记录](../../../ui/vendor/assistant-ui/README.md#schedule-center-2026-11-17)。调用侧不提供重复标题，任务内容最后。
- **Dialog**复用 `ui/vendor/assistant-ui/attachment-dialog.tsx`。详情字段区滚动，关闭回原列表卡片；Escape先关详情，不连带关Preview。
- **Preview**只增加一个UI标签变体，不伪装文件、不加第二套Reader或容器；窄屏沿现有呈现并验证嵌套焦点。
- 与[已批准的过程精简](2026-11-17-process-display-simplification.md)无展示依赖：不读工具正文、过程节点或Worker进度缓存，不恢复被删除的数据采集。原schedule工具认证与业务回执继续由现有系统负责。

实施保留三组定向验收，实际执行结果见第 8 节：

1. **只读中心**：新增 `tests/schedule-display.test.ts`，覆盖Homer／Worker计划统一读取、权限、分页、状态事实、完整详情与零写入。模型未登录可读，渠道准备中与真正撤权分开；schedules变化且历史revision相同仍刷新。不再写创建回执、thread/turn、对话归属、空回复或历史补卡测试。
2. **传输与chip**：扩展 `tests/web-service.test.ts`、`tests/mobile-request.test.mjs`、`tests/main-composer.test.mjs`。确认共享read操作、chip保存／移除／恢复、完整ID实际进入文本、重名不混淆、拼接后超限保留草稿、已接收／未知发送不重复拼接、不覆盖新chip。原revision和操作回执规则沿原回归；离线不能宣称真实模型已验收。
3. **正式组件合成渲染**：新增 `tests/schedule-display.browser.mjs`，登记到 `scripts/test.mjs` 显式browser清单；1440/390/320px验证右侧中心、长文详情、键盘／回焦、图标不冒泡／不发送、原文件Preview和草稿保持。普通对话无新增结构化卡片。浏览器正常退出code 0、forced=false、watchdog=false，截图不能替代交互断言。

复用现有本人设备认证、宿主来源校验、原工具写权限和发送快照；不增加审批、锁、恢复中心或状态机。只跑相关离线／类型与明确选择的合成浏览器检查，不自动跑全量、真实模型、日常实例、安装或真机。实施后据实际结果更新架构状态并按work-cleanup回收临时资源。

## 7. 本次删除与证据边界

已删除全部对话卡片设计：读取创建回执、判定创建者、Main／Worker来源追踪、thread/turn与助手消息匹配、scheduleReceipts字段、对话页附加查询、旧记录补卡、无正文消息呈现，以及相应文件改动和测试。普通答复不加专用自动确认流程。

保留范围只有 **Preview中心 → 只读详情 → 引用chip → 原对话与工具**。旧计划无需迁移，按现有规则记录在中心读取即可；不再存在历史卡片关联的覆盖问题。

v5仅作为已确认的视觉参考，旧截图中的左侧卡片不属于最终范围。正式组件整合、只读API及chip已在源码实施；当前验收和安装边界见下节。


## 8. 实施与验证（2026-11-17）

已按上述范围接线：顶栏时钟入口激活原Preview的唯一定时标签，与文件标签共存；读取只走一个本人只读API；状态从现有schedule、取消回执和精确入箱对应生成。列表不下发完整正文，详情每次打开读当前值；没有对话卡片、创建回执关联、任务写API或schema变更。普通正文、附件、其他引用保留，chip随原草稿保存与答题切换恢复；发送前完整ID以JSON拼入普通文本，再检查长度及原96KiB预算。

除第5节所列文件，构建在 `ui/package.json` 加上现有CSS脚本的 `--schedules` 调用，`scripts/dev-build.mjs` 校验该生成样式；只新增这一局部组件样式入口。单独CSS编译使用唯一系统临时目录并finally回收。`tests/reader-scroll.test.mjs` 的原HomerApp提取夹具补入新增图标与组件绑定；`tests/web-service.test.ts` 中并行长引用用例只补类型窄化，原断言语义不变。

验证结果：

| 范围 | 本轮证据 |
| --- | --- |
| 数据、组件来源、移动传输、共享chat及阅读回归 | `schedule-display.test.ts`、`mobile-request.test.mjs`、`web-chat.test.ts`、`reader-scroll.test.mjs`：80/80，通过；含权限过滤后分页、当前取消修订、入箱并非完成、异常规则／无效时区、零写入和SpecSheet原件hash |
| 原调度与收件箱 | `schedules.test.ts`、`schedule-inbox.test.ts`：23/23，通过；仅独立数据库，不操作真实安排 |
| chip草稿与发送 | `main-composer.test.mjs` 中本次两项：2/2，通过；保存／恢复、空chip、拼接后超限保留、答题冲突、完整ID与pending不重复拼接 |
| 实际宿主只读HTTP | `web-service.test.ts` 中schedule read一项：1/1，通过；无活动模型，原队列claim形成可信来源、外实例不可见、旧epoch和伪owner拒绝、列表无正文、详情完整、读取零写入 |
| 类型与构建 | 两端产品类型、完整 `tsconfig.check.json`、独立Vite产品构建、schedules生成CSS一致性均通过；不覆盖共享dist |
| 正式UI合成浏览器 | `schedule-display.browser.mjs`：1440／390／320px，文件标签切换、普通对话无卡片、长文末行／滚动、引用不冒泡不发送、移除／刷新恢复、完整ID发送一次、state刷新及读取失败非空列表。截图在[实现验收材料](../../../outputs/task-abe2d7f4-schedule-implementation/README.md) |

浏览器中发现并修复窄屏Preview遮住详情的问题；沿现有Dialog消费侧将详情／遮罩置于Preview之上，并验证关闭按钮实际鼠标命中，不能只用元素存在断言。详情标题和关闭按钮不随正文滚走，窄屏保持16px侧边距。Chrome正常退出0、forced=false、watchdog=false；不是安装版或真实手机结论。

**保留限制：**通用Composer文件额外57项通过，6项历史恢复用例受沙箱只读 `.codex/scratch` 限制未完成，提权重跑未获批准；不将该文件称全绿，不修改夹具来绕过权限。数据来源校验沿原宿主函数；本轮未重跑真实渠道撤权／准备态专项或真实模型的schedule_list→update/cancel判断。没有新增LLM提示框架，完整ID定位仍由既有工具身份、来源、revision及回执规则约束。未运行默认全量、安装、真实模型或实体手机验收。


## 9. 提交前复审（2026-11-17）

以 main `90dfb0b2` 导出独立临时快照，仅叠加本事项精确补丁，不包含共享树的渠道、媒体和阅读改动。权限沿原宿主来源校验；取消只认当前revision，投递只认confirmed操作与收件箱消息精确对应。无新增写接口或权限捷径。详情按需读全文；引用仅传完整ID及标题，发送沿原幂等快照，超限／新草稿／答题冲突保留原数据。未发现需要新增业务实体或防御性流程的问题。

此前6项历史恢复用例已安全复跑通过，完整Composer文件63/63通过；组合为0／1／81条旧回执 × inspect／ignore，覆盖当前请求一次处理、只读原文、跨80项分页、保全旧回执及Run、重启不重放。上轮EPERM发生于fixture建目录，不能视为功能故障。精确候选合成回归161/161和单项只读HTTP1/1通过，两端及完整类型检查通过。独立快照先生成既有批注runtime后构建；不使用共享dist。

性能边界维持最小实现：仅激活定时Preview时读取，单次默认20／上限100，权限过滤后分页；正文仅详情读取；同批状态事实共用两条查询、合并在途重读，不加轮询或全局列表缓存。查询仍随现有state事件更新，未承诺超大日程库或真实设备延迟指标。UI独立候选的宽窄屏复验及提交结果在验收材料中补记。未运行真实模型或操作真实计划。


六项原测试同属 `composer sends one current request without replaying historical receipts`，本轮全部通过：

| 后缀 | 含义 |
| --- | --- |
| `0 inspect` | 无旧回执的查看行为基线；当前用户输入仍只执行一次 |
| `0 ignore` | 无旧回执的普通新要求基线；不产生历史工具调用 |
| `1 inspect` | 明确查看1条旧回执，调用work_inspect／worker_read；不改旧回执及Run |
| `1 ignore` | 忽略1条旧回执处理新要求，旧记录不阻塞输入或自动执行 |
| `81 inspect` | 跨80项分页查看指定旧回执，不逐条启动模型轮次 |
| `81 ignore` | 跨80项分页处理新要求，读取次数有界且旧记录不重放 |

每项还重开宿主核对只发生一轮用户处理；0项的inspect只是组合基线，没有不存在的记录可查看。原失败均在fixture mkdtemp时EPERM，未触及上述断言。最新精确候选Chrome三种宽度通过，页面错误0，正常退出0且无forced／watchdog。[候选复验材料](../../../outputs/task-abe2d7f4-schedule-implementation/review-verification.json)。

## 9. 对话中的定时任务小卡片

输入框和已发送用户气泡共用定时引用卡片及现有引用条样式，任务标题单行截断。输入框保留独立移除入口和原输入焦点。已发送卡片按 ID 打开既有只读详情，关闭后回到触发卡片。附件和其他引用继续使用各自组件。

新宿主通过 `features.scheduleReference` 声明支持可选引用字段。发送时沿用原模型正文，宿主校验结构与正文前缀一致，并核对当前主对话可读的任务 ID 和标题。同一条历史记录用可空列保存显示引用，保持旧引用 JSON 可由旧宿主读取。原模型正文已经绑定 ID 和标题，受理、排队和送交仍沿用原文的幂等校验，回退时旧宿主可继续处理队列。气泡仅对有该字段且匹配的消息投影可见正文。复制与整条引用仍使用原文，选文引用继续定位气泡正文。旧宿主沿用文本发送，旧消息仅凭前缀无法证明引用来源，按原文渲染。队列保持原编辑语义，保留原前缀时保留引用，修改或移除前缀后回到普通文本。

隔离验收通过宿主来源校验、队列编辑和旧宿主同库回退。真实界面浏览器专项在 1440、390、320 px 核对长标题、原文复制、精确详情 ID、回焦和旧消息显示。Chrome 正常退出，无强制终止或 watchdog。验证使用合成数据库及本地夹具，安装版和移动真机待验。
