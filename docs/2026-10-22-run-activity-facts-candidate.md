# Homer Run Activity 公开活动事实候选（2026-10-22）

> 历史方案。2026-10-23 用户明确取消活动详情阅读器；下文 reader、任务侧栏及活动关联跳转已由 [功能移除记录](2026-10-23-remove-activity-reader.md) 替代。公开动作／对象／结果事实仍在原 Run Activity 中展示，数据事实与普通读取合同保留。

本批已完成可运行隔离候选与实际 Chrome 验收，尚未上线。没有创建 worktree、Git 提交、分支、标签或远程操作，没有访问生产 Homer 数据库、真实聊天、凭据、真实模型或 4780 接口，也没有改变其他任务状态。宿主登记目录（由当前任务工具只读返回）、`pwd` 和 Git 根目录均为 `/Users/wolf3c/Project/homer`。

## 结果与采用边界

官方 `ui/vendor/assistant-ui/run-activity.tsx`、`run-activity.css`、`collapsible-root.tsx` 和 LICENSE 未改动。沿既有固定 assistant-ui commit `1f41f91643fdb56e5d8dbd14db65f742740738a1` 的单层列表、字体、间距、chevron、细线、展开动画和键盘行为呈现，没有叠加 Tool Timeline。

Homer 数据适配负责动作、公开对象名和结果证据。Homer 新增 UI 仅为条目的“查看活动”、小型只读阅读 dialog，以及现有任务面板中的准确版本/Run 定位区；这些均不是 Run Activity 自动生成的能力。任务、Canvas、原答复的原有阅读与导航容器继续复用。Worker 事件卡的历史正文、图标、位置、不可点击语义和事件身份保持。

新调用的例子：`检查成果文件：季度经营数据…候选.md`，分别显示`调用已返回`与`文件已读取`；验收接受、要求修改和交付准备各用自己的回执类别。`交付已准备，正式交付尚未确认`不会因正常返回被写为交付成功，后续当前导航也不回填当时事实。

## 准确增量与并行边界

初始完整文件前像和 SHA-256 在 `.codex/scratch/run-activity-facts-20261022/before/` 与 `preimages.json`；源码不是以 Git HEAD 为前像。每次编辑使用 `expected.json` 校验当前字节。最终准确增量见 [候选补丁](patches/2026-10-22-run-activity-facts-candidate.patch)，逐文件 SHA、增删行和校验结果见 [候选绑定](patches/2026-10-22-run-activity-facts-bindings.json)。补丁只包含本批增量，不将原有未提交/未跟踪文件当成新增交付。

| 文件 | 本批职责 |
| --- | --- |
| `src/activity-facts.ts`（新增） | 公开事实/关联类型、动作与结果固定模板、公开名称过滤 |
| `src/recursive-tasks.ts` | 已完成调用的最少事实采集；按线程/准确版本/Run/结果关系和 publication/revocation 核验导航 |
| `src/service.ts` | 将参数与业务回执仅交给事实 owner；采集异常不改变业务结果；附件事实沿原 context/ref 校验；不扩展 MainProgress 渠道事件 |
| `src/main-process.ts` | 原工具条目的可选 activity 字段；原 ID、revision、seq 与终态去重保持 |
| `src/web-contract.ts`、`src/web-homer.ts` | Web-only 临时导航投影；复用原 history/process 路由和 epoch/thread 校验 |
| `src/task-overview.ts` | 详情按需、有界读取准确历史要求，不改变轻量当前摘要 |
| `ui/process-nodes.tsx`、`ui/process-nodes.css` | 公开事实行、轻量阅读、取消读取和焦点返回；旧记录如实说明；保留较新已读详情直至较新页头接管 |
| `ui/task-overview.tsx`、`ui/homer-app.tsx` | 接入原任务面板、Canvas、准确原消息；原版本与当前信息分别标示 |
| `tests/run-activity-facts.test.ts`、`tests/run-activity-facts-ui.test.mjs`（新增） | 业务/权限/回执、原版本返工、折叠回退的红绿回归 |
| `tests/run-activity-facts-browser-fixture.mjs`、`tests/run-activity-facts.browser.mjs`（新增） | 隔离合成场景与生产 UI/HTTP 的真实浏览器验收 |
| `tests/helpers/process-ui-loader.mjs` | 仅为测试导出现有 ProcessDetailsContext |
| `ui/DESIGN.md`、vendor README、本说明 | 设计、溯源、验证与回退边界 |

期间消息队列任务修改了 `ui/homer-app.tsx` 并补充 vendor README；已暂停写这些文件、逐部分核对，确认其队列/输入框及独立队列溯源段落与本批过程接线不重叠。本批没有恢复或覆盖这些并行改动。最终补丁在保留其当前内容的上下文中只抽取本批增量。固定候选保存的是验证时的源码快照，之后其他任务改变的文件不自动进入已验收 bundle。

## 事实与权限合同

- `work_inspect`、`inspect_run`、`inspect_result_file`、`inspect_attachment`：只从已完成的 owner 操作确认记录/文件/材料是否读取。附件内容提取当前不可用单独表达，不把附件登记等同于内容读取。
- `task_review`、`review_artifact`：接受、要求修改、拒绝/终止、待明确决定分别记录。要求修改关联的是原被审结果、原版本和原 Run，不能跳到新排队版本。
- `publish_delivery`：保存本次结构化回执类别；prepared 不表示正式交付成功，recorded 只表示宿主/渠道回执，不表示用户已读。
- `task_delegate`：只用明确创建回执记录任务创建。无可靠结构化事实的调用继续显示真实调用状态，不编造对象、业务成功或空详情入口。原生工具仍只显示既有安全类别，不解析原始 shell/文件参数。
- 公开名来自明确公开的 `presentation.title` 或 owner 验证的成果文件 basename/附件名；不采用私有 goal、材料正文、模型正文或原始输出来生成摘要。路径形态、控制字符和明显凭据形式不进入名称。
- 没有新增持久状态数据库、任意文件/URL/shell/原始工具结果读取接口或模型摘要服务。只有原过程条目增加可选字段；旧记录无需迁移或补写。公开事实采集失败不会改变原调用回执。
- `activityLinks` 是 Web 按需投影，不持久化，ID 本身不构成权限。任务 owner 核验来源线程、版本、Run/result 关系；成果沿既有 publication、撤销、文件读取/hash 校验；原答复仍经既有准确消息入口。现有 dev-host 与 gateway 对 `history.process` 透明传递，无需修改路由或转发。
- 旧 Worker 快照只有准确关系通过时提供独立关联入口，注明当时详情缺失、下方是当前记录。泛化旧工具记录说明公开详情不足；无可读内容不显示详情按钮。读取失败说明当前无法核对，不声称永久丢失。
- 关闭、快速重开、节点/revision/线程及连接变化都有旧请求取消/身份检查。现有应用在线程标识改变时暂停连接并保留旧对话；活动阅读沿该合同停止读取并撤去导航，不改变主线程切换策略。
- 修正了一个可稳定复现的显示竞态：较新详情返回后，收起曾清掉它并显示旧页头“调用已返回”。现在沿现有详情状态保留较新证据，更新页头按 revision 正常接管，没有增加第二份业务状态。

任务生命周期、返工/停止决策、原生记忆、MAIN_TOOLS 指纹、审批权限、待发送队列和正式成果归属均未由本批改变。

## 可打开候选与复现

当前两个隔离入口（仅本机，进程存活期间可反复打开）：

- [默认展开的公开活动](http://127.0.0.1:53061)：点击“查看活动”阅读；可进入任务原版本、Canvas、原交付答复。
- [旧记录缺失与准确关联](http://127.0.0.1:53070)：展开 Worked；缺详情的条目没有空按钮，准确旧关联在卡片外提供入口。

在维护根目录启动相同候选，端口每次随机分配并打印：

```sh
node --import tsx .codex/scratch/run-activity-facts-20261022/demo.mjs
```

Ctrl+C 只关闭这两个隔离服务。演示使用内存数据库、scratch 文件和不允许执行的 fake engine；不会打开 Homer 宿主或真实模型。正式静态 UI bundle 位于 `.codex/scratch/run-activity-facts-20261022/candidate/web/`，服务端候选及媒体 reader 位于 `candidate/service/`；固定源码与身份在 `candidate-source/`、`candidate-source-identities.json`。没有覆盖共享 `dist/`。

验证入口为 `node .codex/scratch/run-activity-facts-20261022/validate.mjs`。它从固定源码依次执行行为测试、类型检查、隔离构建及四组浏览器验收，结果写入 `validation.json` 和 `logs/`。如需从维护源码重建，使用原 `tsconfig.json` 的 tsc（将 outDir 指向本任务 scratch），复制 `src/media-documents.py`，在 `ui/` 进行 `tsc --noEmit`，再用 Vite build 将产物输出到本任务 `candidate/web/`。不要启动默认代理到 4780 的 Vite dev server。

维护的合成夹具与测试是可重建场景来源；scratch 内的 demo、截图和日志是临时证据，不放入产品资源目录。

## 实际页面截图

均来自已构建生产 UI、隔离 HTTP owner 与真实 Chrome，并非设计稿。

| 状态 | 320px | 390px | 1440px |
| --- | --- | --- | --- |
| 默认展开 | [截图](../.codex/scratch/run-activity-facts-20261022/browser/default-expanded-320.png) | [截图](../.codex/scratch/run-activity-facts-20261022/browser/default-expanded-390.png) | [截图](../.codex/scratch/run-activity-facts-20261022/browser/default-expanded-1440.png) |
| 查看活动详情 | [截图](../.codex/scratch/run-activity-facts-20261022/browser/activity-detail-320.png) | [截图](../.codex/scratch/run-activity-facts-20261022/browser/activity-detail-390.png) | [截图](../.codex/scratch/run-activity-facts-20261022/browser/activity-detail-1440.png) |
| 旧数据缺失 | [截图](../.codex/scratch/run-activity-facts-20261022/browser/legacy-missing-320.png) | [截图](../.codex/scratch/run-activity-facts-20261022/browser/legacy-missing-390.png) | [截图](../.codex/scratch/run-activity-facts-20261022/browser/legacy-missing-1440.png) |

## 验证结果与限制

固定候选验证记录：`.codex/scratch/run-activity-facts-20261022/validation.json`。

| 检查 | 观察结果 |
| --- | --- |
| 新活动/公开回执/权限/返工原版本/React过程合同 | 32/32 通过 |
| 既有过程、任务面板、历史分页 owner 回归 | 29/31 通过；2项旧夹具错误见下 |
| 服务端源码 `tsc -p tsconfig.json --noEmit` | 通过 |
| UI `tsc --noEmit` | 通过；并行队列任务在固定快照前已修正其最初暂态类型错误 |
| 全仓 `tsc -p tsconfig.check.json --noEmit` | 未通过；18条既有附件/旧测试与配置诊断，未出现本批文件的新诊断 |
| 服务端构建 + media reader、Vite正式UI构建 | 通过；原有 >500kB chunk 提示保留 |
| 新实际浏览器活动验收 | 320/390/1440px 全通过，共30项场景检查 |
| 既有过程阅读浏览器验收 | 三种宽度全通过，共24项场景检查 |
| 官方样式、动画、reduced-motion 与键盘焦点专项 | 三种宽度全通过 |

两项旧后端失败是 `tests/main-process.test.ts` 的 `real accepted publication…` 与 `real publish tool…`，均因夹具的 `app.inputs` 缺 `dispatchSummary()` 报错。使用本次保存的准确 `src/web-homer.ts` 等前像运行同两项，得到同样两项错误，已记录在 `baseline-verification.json`；没有为本批改测试来掩盖它们。

全仓类型诊断位于既有 `tests/homer-attachment-adapter.test.ts`、`tests/interruption-recovery-projection.test.ts`、`tests/web-history-observation.test.ts` 和 `ui/homer-attachment-adapter.ts`：`.ts` 导入配置、NodeNext 相对扩展名、缺 JSX、缺声明和既有类型不匹配。源码与 UI 各自正式构建配置通过。此次没有把全仓检查宣称通过，也没有重复所有历史验收。

浏览器由 Chrome `156.0.8078.48` 的新任务专属 profile 执行；非本地请求均被拦截，合成场景的 fake engine、真实发送、停止调用计数为0。已检查长中文/长文件名、同名不同任务、原版本、失败/拒绝/中断/未知、只返回证据、读取失败、关闭/切换/线程失效、原答复位置、Canvas/任务返回焦点、折叠、单层列表及不横向溢出。历史分页、重复项、正式答复/成果归属和待答继续由相关现有行为测试与过程浏览器用例核对。

未验证生产数据库/真实聊天/微信或 Telegram 实际收发/真实模型/生产上传或发布；本批也未运行独立发布/宿主换版集成。事实缺少安全公开名或业务回执时保留调用状态；旧通用记录不会自动获得无法证明的业务详情。任务原版本/Run 读取按现有上限有界，超出范围说明本次未返回，不冒用当前版本。此次只提供候选验收。

## 回退

候选未上线，无生产数据或数据库迁移需要回退。停止 demo 即撤下预览。源码回退应先核对候选绑定和当前并行改动，再仅反向应用本批补丁；`git apply --reverse --check docs/patches/2026-10-22-run-activity-facts-candidate.patch` 为只读预检。本次不执行回退，不使用 `git checkout`/`restore` 或整文件覆盖。旧程序会忽略可选 activity 字段；需要回退时不批量改写已存在记录。
