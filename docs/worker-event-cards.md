# Worker 对话事件卡片

卡片保存主 Agent 当时的操作或接收事实，不表示任务当前状态。聊天正文直接采用现有固定官方 TaskCard：waiting 静态空心点表示已交办，done 静态勾号表示收到结果，failed 静态叉号仅表示明确启动失败。历史卡不用 working，不持续转圈；已交办不证明已开始运行，收到结果不证明验收通过或正式交付。业务验收、outcome、正式交付及文件授权保持独立。

默认只有标题和中文事件名称，标题按钮展开原正文。只传原 event.title、eventKind 和 body；不传 result、actions、elapsed，不建立摘要、适配组件或额外展开状态。正文以普通 React 文本显示并保留换行，不渲染 HTML/Markdown。只有官方展开按钮，没有停止、重试、任务跳转或“部分完成”标签。

## 唯一数据来源

- 交办：成功操作采用的准确版本 `contract.presentation.title/description`；未提供则显示中性缺失说明，不展示长 goal。新工具说明要求提供公开展示文案。旧 `dispatch_work` 仅保留合适长度的公开 title，没有公开描述时不猜补。
- 收到结果：准确宿主 `result_ready` 通知指向的 primary result `payload.text` 的前640字符；旧记录继续读取原 `payload.summary`。缺失说明“已收到结果，未提供摘要”。只做确定性展示截取，不新增摘要模型，不读取主 Agent 答复、其他 payload 字段或成果文件正文补摘要。
- 启动失败：主 Agent 工具调用的明确拒绝，或宿主终止通知中的启动前证据。白名单错误映射为中文；未知原因显示中性说明。启动RPC未确认、中途报错、取消及失联不归此类。

`presentationJson` 可选存于准确 task_version，旧契约保持可读。`worker_card_events` 为唯一卡片正文，`snapshotJson.schemaVersion=1`；过程节点只存 eventKey 和原段内位置。未支持的快照格式显示缺失提示。事件包含来源身份、宿主观测时间，失败额外记录受控错误分类及阶段；不保存完整调用参数或原始错误。

## 事务与重放

交办卡与业务创建同一事务；消息接收回执、原生主轮 ACK 的过程锚点与收到结果卡同一事务。事件和节点引用通过保存点一起写入，异常时一起回滚。事件引用只经仍执行中的原过程追加；已结束的过程仅允许相同事件重放，禁止添加新事件。重复操作或通知保留第一次事件、时间、来源消息和位置；内容冲突报错，不覆盖历史。结果事件按接收方主线程及resultId去重，独立任务或不同结果不按同名、同任务合并。

只采用宿主持久通知及其准确接收方。旧入口复用 operations 已有的 `(actorAgentId,scopeId,operationId)` 唯一索引，从准确任务的宿主操作读取通知，再核对Run／结果，不扫描主Agent全部历史，也不新增冗余索引。页面快照每批最多200个事件键，以主键批量读取；不再计算实时任务的重复快照集合。`agent_send` 中同名 `terminal/result_ready` 不构成宿主完成或启动失败。Worker 递归委派不自动生成主对话卡片。旧适配器审阅和交付沿准确Run的通知，重复读到同一结果不新增卡片。

## 界面与兼容

事件卡始终在所属 Working／Worked 外部、对应正式答复之前，按原事件顺序只渲染一份；展开过程只显示原公开说明与真实工具记录。现有 ProcessNodeView 是唯一渲染 owner，原 key 和父节点保持，父层切换不卸载卡片。卡片正文独立默认收起，由官方内部状态管理；普通刷新及父层切换保留用户选择与焦点，不新增展开状态表。纯文本、自然换行、完整标题提示和原生按钮支持可访问阅读。旧实时关联项不回填事件；仅显示“旧后台工作记录（当时的事件内容未保留）”，原存储不删除。任务总览仍读取原业务事实。

TaskCard 来源为 assistant-ui 固定提交 `cebe9ddefa8cccee674bcb40c06f485d5bbfe7b8`，MIT；沿用 `ui/vendor/task-status` 的原源码、许可证和生成样式。根节点复用已有 `.homer-task-status` 局部主题，不增加包装容器或编译入口；官方最大宽384px、标题13.5px、状态图标、内距和圆角保持。事件 CSS 仅补44px点击区、焦点描边、外部间距及正文换行，原人形图标、角标、大标题和手机放大规则已移除。未改服务端、数据库、Web协议、依赖或锁文件。

Review 发现并行的顶部状态展示调整已移除原 TaskCard 点击区规则，因此事件卡的44px和焦点约束直接由事件样式负责，不修改并行的顶部样式，也不依赖顶部组件是否挂载。

Web声明 `features.workerEventCards=1`，现有history协议仍为3，刷新提示继续沿已有uiVersion机制。发布时服务与网页应作为配套版本采用。此次隔离候选没有执行正在使用页面与新服务混发的升级；旧程序回退也需另行兼容验证，不能假定其解析新ProcessItem安全。

## 验证与采用边界

自动回归使用合成输入和伪引擎，覆盖真实宿主工具、队列、ACK、业务事务、通知、分页、React展开及纯文本转义。浏览器脚本 `tests/web-history-worker-headers.browser.mjs` 使用构建网页、本机随机端口和独立资料，检查1440/704/390/320像素、键盘展开、刷新、系统深色偏好及无外网请求。产品现有主题变量继续负责配色；不新增深色主题。

本次仅制作隔离候选与补丁。没有生产迁移、部署、服务重启、真实模型执行或文件发布；采用前按原发布流程审阅当前源差异、备份与配套版本，不删除新表新列作为回退手段。

## 2026-10-23 TaskCard 替换验证

- 先将现有 UI 测试改为已确认的默认收起、静态三态和纯文本合同，旧大卡按预期失败；替换后相关23项 UI 测试全部通过。
- 事件、通知、批量查询、顶部状态和 UI 合计55项定向测试，修改前后均为54通过、1项既有失败：`tests/worker-card-query.test.ts` 调用不存在的 `owner.workerRunMessages`。保留该失败，不更改服务端或删减断言。
- 前端 `tsc -p ui/tsconfig.json --noEmit` 通过；Vite真实产品构建输出至任务 scratch，不覆盖 `dist/web`。固定官方源码SHA和局部CSS隔离测试通过；未重新生成或改写官方组件样式。
- `tests/web-history-worker-headers.browser.mjs` 在1440/704/390/320px全部通过：默认一行、384px最大宽、13.5px标题、44px点击区、Tab/Enter/Space、长中文及HTML字面量、外层过程移动不重复、重挂默认收起、深色/减少动画。页面无异常或外部请求，真实模型调用与业务提交均为0。
- 复用 `tests/task-status-unified-runner.mjs unified`，顶部当前状态74项浏览器检查通过，原计数及根事项/Worker/子Worker折叠保持。
- 补充活动列表浏览器脚本在既有文案断言处提前失败，未执行到本次卡片场景：预期“记录已读取”，实际为“已读取”。通过 scratch 构建覆盖恢复本次修改前的三个展示文件，同一脚本出现相同失败；不修改无关文案或放宽断言。

复现定向测试：`node --import tsx --test --test-concurrency=1 tests/process-nodes-ui.test.mjs tests/process-presentation.test.mjs tests/run-activity-facts-ui.test.mjs tests/worker-card-events.test.ts tests/worker-card-host.test.ts tests/worker-card-query.test.ts tests/task-status.test.ts tests/task-status-css.test.mjs`。

本次证据目录：`.codex/scratch/worker-event-taskcard-product-20261023/`。`browser/worker-event-browser-checks.json` 为四屏事件卡证据，`browser-results.json` 为顶部状态证据，`verification.json` 记录检查与来源哈希；`browser/worker-events-1440.png`、`worker-events-390.png` 及对应展开/深色PNG均为真实产品构建截图。测试使用 Chrome 响应式视口与合成数据，不代表实体手机/Safari或生产环境验收。此替换不增加协议或存储迁移，回退只需撤回本次展示代码和匹配测试/文档，不改历史数据。

## 2026-10-23 Review 与独立提交验证

从提交基线 `1b52588` 导出独立副本，只叠加本次事件卡代码、对应测试和设计段落，排除并行的顶部展示、问答、Canvas等未提交修改。审查发现事件点击区依赖顶部宿主规则的问题，已将44px及焦点约束归回事件样式；不改顶部并行源码，也不新增组件或状态。

独立副本的34项UI/状态/官方源码与CSS测试、前端类型检查、Vite构建均通过；事件卡1440/704/390/320px检查和原顶部74项浏览器检查均通过。新增浏览器断言确认Tab焦点描边为2px，展开/收起不增加过程详情请求；默认正文未挂载、无旋转动画，无新增轮询或数据读取。官方组件源码和依赖保持。

在同一基线仅还原两个事件展示文件进行产物对照：JS减少534字节、CSS减少1090字节，合计gzip减少400字节，没有新增资源文件。该对照衡量产物体积；四屏交互与零额外详情请求是对应的运行证据。证据位于上述目录的 `review-commit/`，包括四屏截图、`browser/worker-event-browser-checks.json`、顶部 `browser-results.json` 与 `bundle-comparison.json`。此前工作区扩展回归中的旧查询方法、活动文案断言问题保持单独记录，不混入此提交修复。

## 2026-10-24 事件卡固定在过程外部

共享 main 的 HEAD 为 `5afa91483870fd69fb281bc1bd5c2e24470dd3ba`，本次产品源码仅修改 `ui/process-nodes.tsx`：从 RunActivity entries 排除 Worker 事件，并移除现有外部卡片映射的 `!open` 条件。复用原 WorkerEventCard、官方 TaskCard 和稳定事件 key；官方源码、CSS、消息气泡、投影、执行、计时及权限均未改。同步相关 UI 回归和本行为文档，保留工作区其他修改；未提交、发布、安装或重启产品。

- 先在原实现观察到两项新身份断言失败，最小改动后通过；事件卡始终同一外部父节点，父层切换不重挂，卡内展开与焦点保留。补充延迟读取、跨轮、多事件、无事件、只有事件及无过程检查。
- `tests/worker-card-outside-activity.browser.mjs` 使用真实产品构建、独立 Chrome 156、随机端口与内存数据库，在1440／390／320px共19组检查通过。覆盖运行／完成／失败／中断／unknown、事件重放及顺序、真实“创建任务”工具文本、正式气泡、键盘、历史阅读无额外跳底、桌面摘要与预览布局；卡片移除计数均为0，无横向溢出、页面异常或外网请求，无模型调用或业务提交。
- 8个相关测试文件合计61项：60通过，保留既有 `tests/worker-card-query.test.ts:25` 的 `owner.workerRunMessages is not a function`，该失败亦见上方2026-10-23记录。额外运行 `tests/main-process.test.ts` 为8通过、5失败，均为后端模拟缺少 `active.messages`／主轮输入／`inputs.dispatchSummary`；该文件不消费本次 UI 改动，未修改后端模拟或断言。详细日志留在证据目录。
- UI `tsc --noEmit`、隔离 Vite 构建及 `git diff --check` 通过；构建仅有原有大块体积提示。官方 TaskCard、RunActivity、过程CSS和服务端过程／投影文件与HEAD一致。

证据位于 `.codex/scratch/worker-card-outside-activity-20261024/`，包含 `plan.md`、初始HEAD／dirty／index、任务补丁和 `verification.json`。`before-browser/` 与 `after-browser/` 各含 `collapsed-{1440,390,320}.png`、`expanded-{1440,390,320}.png`，前后同一合成事件与步骤可对比；各自的 `browser.json` 分别证明旧重挂和新身份保持。修改后另有 `summary-1440.png` 和 `preview-{1440,390,320}.png`。这是本地 Chrome 响应式验证，不代表安装版或实体手机采用。

重现修改后浏览器检查（不会生成主题或覆盖 `dist/web`）：

```sh
node node_modules/vite/bin/vite.js build ui --outDir "$PWD/.codex/scratch/worker-card-outside-activity-20261024/after-web" --configLoader runner
HOMER_SYNTHETIC_ROOT=.codex/scratch/worker-card-outside-activity-20261024/fixtures HISTORY_FOLLOWUP_BUILD=.codex/scratch/worker-card-outside-activity-20261024/after-web HOMER_BROWSER_EVIDENCE=.codex/scratch/worker-card-outside-activity-20261024/after-browser node --import tsx tests/worker-card-outside-activity.browser.mjs
```
