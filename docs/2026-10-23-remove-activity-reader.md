# 2026-10-23 移除活动详情阅读器

> 历史候选和验收记录；当前活动界面约束见 [UI 设计说明](../ui/DESIGN.md)。下文提交和运行状态仅代表当时。

用户在原因调查后明确取消活动详情阅读功能，并授权实际实施。此次范围覆盖此前保留另一任务“查看活动”入口的旧边界。修改在 `/Users/wolf3c/Project/homer` maintree 完成；没有创建 worktree、分支或任务，没有提交、发布、重启、真实模型调用、生产数据修改或对外消息。

**交付状态：源码候选已移除，未由本任务更新运行版。** 上一轮只读调查于 2026-10-23 11:18–11:19（Asia/Shanghai）核实原4780服务为 source `95ec060eed2f7f8f60767ee8e42264e1f9bc77d27b36fc3ea9f844f389bec3de`、UI `653a07ef25d3e3db583b3e0c9d219bd1e1f2bd47b3dfc169dd6e25ba37379e4d`；本轮实施验收全部使用隔离合成服务，未再读取生产业务接口。不能把本地构建或截图视为运行版已经采用。

## 行为与清理范围

此前顶部只隐藏“任务”按钮，`TaskOverviewPanel entryVisible={false}` 仍承接 ActivityReader 的任务导航。现在从客户端移除整条链路，不换成新阅读器、Dialog、Drawer 或等价入口。

| 文件 | 本次准确增量 |
| --- | --- |
| `ui/process-nodes.tsx` | 删除 ActivityReader、ActivityNavigationContext、ReadableActivity 和 reading 状态；删除“查看活动”“查看关联任务”“查看任务与版本”及活动内成果/原答复跳转；LegacyWorkerLinks 改为仅含原中性说明的 LegacyWorkerNotes；普通过程懒读保留，客户端不再传 itemId |
| `ui/homer-app.tsx` | 删除活动导航 Provider、activityTask/visitActivityTask、ActivityTaskRequest 导入及旧 TaskOverviewPanel 挂载；保留 TaskStatusPopover 原接线、locateTaskInteraction、locateMessage、openArtifact、locateArtifact 和普通原答复阅读 |
| `ui/task-overview.tsx`、`ui/task-overview.css` | 删除无剩余产品消费者的旧总览/详情组件、TaskFacts/RunHistory、活动准确记录区及右侧全高侧栏样式；不保留“手上的事／返回总览”分支 |
| `ui/process-nodes.css` | 删除活动链接和 reader 专属 CSS；保留公开活动文字、事实状态与 Worker 事件样式 |
| `ui/package.json`、`package-lock.json` | 只移除旧 FocusScope 的直接 workspace 依赖声明；同版本包仍被保留的 Radix 等组件传递依赖，未卸载、安装或升级包 |
| 相关测试 | 更新活动浏览器/组件合同；删除仅覆盖旧侧栏的 `task-overview-refresh.browser.mjs`、`task-readability.browser.mjs` 及 interruption 投影测试中的两项已删 UI 展示断言；后端记录与权限断言保留 |
| 设计与维护说明 | `ui/DESIGN.md` 新节优先；10-22 活动候选/审查、状态浮层说明及10-23 RunActivity说明标为历史/范围已替代；vendor README 同步说明。旧发布记录不改写 |

公开动作、对象、结果、原调用身份/次序/数量及失败/未知说明仍在同一个官方 RunActivity 列表内。新 Worker 不可变事件卡仍无按钮，收起时保留、展开后按序且只显示一份；旧 Worker 缺少事件正文时的中性说明保留。官方 RunActivity/TaskCard 源码、布局与交互没有本轮定制。

保留顶部当前状态 TaskCard、根事项/Worker/子 Worker 逐层默认收起、单 Worker 合并、待答/审批、队列、模型默认、原生记忆及原正式答复。普通 FileList/Canvas 和跨线程授权原答复仍有独立消费者；`artifact-origin` 对话框属于这一成果路径，保留其权限、准确文件集合及原消息定位，不承接活动导航。

`src/activity-facts.ts`、`src/task-overview.ts`、任务/结果 owner、WebProcessNode.activityLinks 和公开 HTTP/IPC 读取合同仍有数据/工具/测试消费者；服务端历史事实、公共 itemId 读取参数及任务状态投影不因 UI 取消而删除。没有数据库迁移或跨层重构。

## 验证结果

- Red → green：删除前，两项“仅保留原折叠按钮／没有活动入口”的组件断言确实失败；修改后通过。另补迟到普通过程读取在线程切换后被中止、不能复活阅读器的行为检查。
- 最终相关回归61/61通过：公开活动、原组件、过程投影/懒读、Worker历史、TaskCard状态/公开进展、任务记录与Web只读owner。完整范围与日志在任务scratch的 `focused.log`。
- 真实候选产品UI在320/390/1440px，39项浏览器检查通过：新旧事实及Worker事件没有详情或关联按钮；DOM连关闭状态的旧侧栏也不存在；无逐项itemId读取或旧详情请求；普通刷新、线程变化与迟到响应不能恢复旧导航；顶部层级、原待答定位、Canvas及准确原答复、关闭还焦和无横向溢出通过。
- 既有独立成果回归81项通过、页面异常0：含普通FileList/Canvas、文件集合切换、授权旧答复及兄弟文件、错误/撤销和资源释放。使用相同候选构建与隔离合成owner；无真实模型、审批提交、上传或外发。
- `tsc --noEmit -p ui/tsconfig.json`、`tsc --noEmit -p tsconfig.json`、隔离Vite构建通过。官方RunActivity CSS一致性检查通过；TaskCard CSS生成结果无新增差异。Vite仍提示已有大chunk，不在本范围优化。
- 候选JS/CSS中“查看活动／查看关联任务／查看任务与版本／手上的事／返回总览”及 `.task-dialog`、`.activity-reader` 均为0处。

没有全仓重测，也没有声称所有旧测试通过。另行核对的 `interruption-recovery-projection.test.ts` 直接运行受既有Node CSS加载限制；使用现有esbuild空CSS处理方式比较准确前像后：旧9项4通过5失败，删去两项专属旧UI测试后为7项3通过4失败。保留的4项失败在修改前后相同：一项仍断言官方恢复前的额外SSR摘要，三项旧mock缺 `inputs.dispatchSummary`。没有改这些断言或放宽owner合同；证据为 `owner-baseline.json` 和前后日志。

另有独立已知限制：手机Canvas返回准确原答复时，模态关闭随后把焦点还给成果按钮。390px修改前/后准确构建对照结果一致；320px也观察到该行为。本轮保留原行为并单列，不宣称手机这一步聚焦原消息通过。证据为 `canvas-focus-baseline.json`。Canvas普通关闭、状态浮层关闭和待答聚焦另有成功检查。

## 候选身份与复查

本轮隔离构建资源（不是新的release sourceHash或密封发布）：

| 资源 | SHA-256 |
| --- | --- |
| `index-BjldQw39.js` | `8f0e5eb4004c8322bf6f695373110dd0fbab5452d1d91be8c75bc0f5d3df6bdb` |
| `index-C9TpVjJG.css` | `dd4bf1484cdcef68359bfcebb0d52aab49aeea3d208f779bcf46fcbdcbdfb7e6` |

前像、构建、检查、准确增量及合成截图全部在 `.codex/scratch/remove-activity-reader-20261023/`。这些可重生成输出不代替本维护说明、产品代码与维护测试源。

| 屏宽 | 公开事实无活动入口 | 顶部TaskCard层级 | 普通Canvas |
| --- | --- | --- | --- |
| 320 | [截图](../.codex/scratch/remove-activity-reader-20261023/browser/public-facts-320.png) | [截图](../.codex/scratch/remove-activity-reader-20261023/browser/task-status-320.png) | [截图](../.codex/scratch/remove-activity-reader-20261023/browser/canvas-320.png) |
| 390 | [截图](../.codex/scratch/remove-activity-reader-20261023/browser/public-facts-390.png) | [截图](../.codex/scratch/remove-activity-reader-20261023/browser/task-status-390.png) | [截图](../.codex/scratch/remove-activity-reader-20261023/browser/canvas-390.png) |
| 1440 | [截图](../.codex/scratch/remove-activity-reader-20261023/browser/public-facts-1440.png) | [截图](../.codex/scratch/remove-activity-reader-20261023/browser/task-status-1440.png) | [截图](../.codex/scratch/remove-activity-reader-20261023/browser/canvas-1440.png) |

从项目根复现：

```sh
node_modules/.bin/tsc --noEmit -p ui/tsconfig.json
node_modules/.bin/tsc --noEmit -p tsconfig.json
HOMER_SYNTHETIC_ROOT="$PWD/.codex/scratch/remove-activity-reader-20261023/synthetic-runtime" node --import tsx --test tests/run-activity-facts-ui.test.mjs tests/legacy-activity-reading-ui.test.mjs tests/process-nodes-ui.test.mjs tests/process-reading.test.mjs tests/process-presentation.test.mjs tests/run-activity-facts.test.ts tests/run-activity-upstream.test.mjs tests/task-status.test.ts tests/task-status-progress.test.ts tests/task-overview.test.ts tests/task-overview-web.test.ts
```

在 `ui/` 中构建至专属scratch：

```sh
../node_modules/.bin/vite build --configLoader runner --outDir ../.codex/scratch/remove-activity-reader-20261023/web-build
```

浏览器复现使用机器上已有Playwright安装，通过 `HOMER_PLAYWRIGHT_MODULE` 指向其 `index.mjs`；不安装新依赖。项目根执行：

```sh
HISTORY_FOLLOWUP_BUILD="$PWD/.codex/scratch/remove-activity-reader-20261023/web-build" \
HOMER_SYNTHETIC_ROOT="$PWD/.codex/scratch/remove-activity-reader-20261023/synthetic-runtime" \
HOMER_BROWSER_EVIDENCE="$PWD/.codex/scratch/remove-activity-reader-20261023/browser" \
node --import tsx tests/run-activity-facts.browser.mjs
```

需要手动复开隔离候选，可运行scratch的 `preview.mjs`，打开其打印的随机loopback地址，展开最后一条Working；它只有合成材料，不启动Homer或模型。Ctrl+C仅关闭该预览。

## 回退边界

`before.json` 记录本任务前像，`changes.json` 记录当前后像；`candidate.patch` 只含本任务前后准确差异。交付时反向patch的 `git apply --check --reverse` 通过，未实际回退。需要回退时先核对后像SHA，确认期间无同hunk并行修改，再仅反向应用该patch；如有漂移逐hunk处理。禁止整文件恢复共享主App、DESIGN或lockfile，禁止用Git HEAD代替dirty前像。没有数据、历史或业务状态需要回滚；是否发布候选仍需独立授权。
