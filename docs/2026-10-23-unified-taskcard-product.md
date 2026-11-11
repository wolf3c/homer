# 工作状态紧凑行与内联展开（2026-10-23）

用户已认可 Background Inbox 下拉缩进展开 Demo，并批准最简方案实施。本节是当前实现；后面的完整 TaskCard 实施记录保留为历史。源码提交不表示已部署，本轮没有重启运行服务。

## 当前实现

- 仅在原 `ui/task-status.tsx` 增加一个文件内共用 TaskStatusRow，替换根事项/Worker 两处 TaskCard 展示。复用已安装 Base UI Collapsible、固定官方 TaskStateIcon、AgentPlan 和 TodoList；没有新增源文件、业务实体、数据模型、接口、依赖或持久状态。
- 外观适配固定 BackgroundInbox `208cc81de222d85b8c3877445187828cff09feeb`：384px 最大宽度、13px 标题、11px 状态、12px 图标、44px 最小点击高度；自然高度、细线缩进、默认收起、父层收起卸载子层，不增加高度测量或第二层详情弹窗。原 Avatar/Popover/刷新/分页与局部主题保持。
- 现有 task/version/run/epoch/thread/turn 身份、状态/计数、单 Worker 合并、任务树、进展读取及取消/迟到隔离、待答定位均沿原 owner。不导入 Demo 三状态、ready 计数、模拟耗时或 DemoTask。当前总览没有可靠耗时，本次不增加接口/计时器。
- 计划与已有公开进展可以同时显示；二者均缺失时沿原摘要/空说明规则。执行明确结束后继续隐藏末次工具进度；未知和停止待确认不凭旧结束字段隐藏内容。验收、部分成果及正式交付语义保持。
- 样式由原编译器生成并限定在工作状态作用域。官方 vendor 源码/哈希/许可证保持，组合层来源记录已在 vendor README 说明。其他工作树改动保留。

## 当前验证

使用 Node 22.22.0、已有 Playwright/Chrome 和合成任务随机端口，未使用生产端口或真实模型。维护现有浏览器测试及 runner，没有另建测试应用。

- 回归先红：旧产品在计划存在时隐藏最新公开进展，新增行为用例确实超时；修改后通过。
- 14 项状态、进展、官方源码、CSS 隔离和许可证测试通过。
- 七组浏览器场景首轮全部通过；补充 Enter/Tab 与暗色断言后定向复验统一展示和展示回归。采用每组最新结果，共 146 项检查通过，另有 2000/8000 条合成数据场景通过。
- 实测 320/390/704/1440px；44px 点击区、紧凑字体图标、子层缩进、列表无横向溢出、无第二层弹窗、父层重开子层复位、普通刷新保留展开、Enter/Space/Tab/Escape、焦点、长中文、暗色及 reduced-motion 均覆盖。实际点击已验证展开区没有被旧高度裁切。
- 迟到响应、缓存保留、断线/超时恢复、原待答焦点、原授权成果 Canvas、分页与大计数继续通过。外部请求拦截记录 0，业务写请求 0，浏览器异常 0。
- Web TypeScript 检查和 Vite 构建通过；构建保留原有大 chunk 提示。
- 全仓类型检查仍有 24 条既有诊断。TypeScript 内存 host 使用本次文件实施前内容对照，前后都是相同 24 条，新增/移除均为 0；未修改无关测试或类型。

当前证据：`.codex/scratch/background-inbox-product-20261023/verification.json`、`typecheck-comparison.json`、`build.log`。初始文件保存在 baseline/；首轮完整浏览器结果与新增断言复验结果分别在 evidence/all-cases-first.json 和 evidence/browser-results.json。

真实截图在 evidence/：mobile-320/390-child-expanded.png、desktop-704/1440-child-expanded.png、mobile-390-dark-expanded.png，以及各尺寸 collapsed/nested 图。截图中的任务、对话和成果均为合成数据，不能当作生产验证。

复现沿本文件历史记录的构建与 runner 命令，将输出目录换为 `.codex/scratch/background-inbox-product-20261023/evidence`，构建子目录为 web-build；使用已有 Playwright 模块即可，不安装依赖。仅在隔离 scratch 构建，不覆盖运行版。

## 本轮提交前复审

用户要求 review 并仅提交本次改动。复核发现原实现误删了仍用于其他消费者的 TaskCard 共享 44px 点击区及焦点样式；已恢复实施前规则，仅追加新任务行样式。新增真实浏览器 CSS 合同检查先红后绿，避免顶部改造移除其他组件的可访问性边界。

修正后 21 项相关测试（包含聊天 Worker 事件组件）、Web 类型检查与产品构建通过。统一展示最新 106 项、其他展示/身份/缓存/恢复检查沿已通过结果，总计 148 项浏览器检查；2000/8000 条合成数据场景通过。2000 条数据只挂载首批 20 行、加载更多到 40 行，折叠期间进展请求为 0，整页 DOM 为 510 个节点。本机最近一次打开至帧观测为 618ms，包含自动化等待和机器负载，不作为纯渲染耗时或生产性能承诺。

没有新增轮询、缓存、计时器、业务实体或数据读取路径；原读取/身份 owner 代码段与实施前逐字一致。共享样式修复仅恢复原合同，不改其他消费者的逻辑。全仓类型检查的 24 条既有诊断及新增 0 条的对照结论保持。

本轮证据另见 `.codex/scratch/background-inbox-product-20261023/review/`。提交仅包含工作状态的源码、样式、测试与来源/实施说明；共享文件的其他既有改动和其他任务暂存内容不带入本次提交。

## 回退边界

只撤销本次 task-status JSX/CSS、生成样式、浏览器测试和文档增量；不回退已有工作树，不改数据库或运行服务，不保留新旧双轨开关。

---

## 先前完整 TaskCard 实施记录（历史）


2026-10-23。用户已验收统一 TaskCard Demo，并明确批准“OK，按照这个实施代码”。本次在 `/Users/wolf3c/Project/homer` maintree 实施；产品源码已实现，线上未采用。初次交付没有提交、发布或生产重启；后续已按用户要求进行代码复审并准备本次独立提交。全程没有模型调用、生产数据库/聊天/凭据读取。

## 实现合同

`ui/task-status.tsx` 仍经 `homer-app.tsx` 的原 `TaskStatusPopover` 接线，使用 `useTaskStatusData`、`/api/tasks`、按根读取的公开进展及现有导航回调。没有第二套状态库、runtime、TaskTray、详情框架或 timeline。

- 根事项、Worker、子 Worker 均直接调用 `ui/vendor/task-status/task-card.tsx`。多 Worker 根事项是一条默认收起的紧凑行；展开才挂载 Worker，逐层按需展开。单 Worker 与根事项合并。删除无消费者的 `card.tsx` 及其导入和生成 CSS；`card-registry.json` 留作 10-22 采用时的历史溯源。
- 官方组件的本地非受控展开状态保持。React 身份采用 task/version/currentRun/epoch/thread/turn，不使用名称或数组下标。普通刷新不会重挂当前卡片；身份变化只重置对应卡片。父层收起卸载内部层级，重开后子层默认收起。展开纯事项层只显示结构，打开 Worker 后才按原 owner 读取公开进展。
- 停止请求未确认、状态未知、暂停和其他未执行结束的等待均为 `waiting`，保留具体中文 meta。`waiting` 不代表用户操作；只有原 owner 的有效答复/批准请求进入待处理数。
- 正在执行显示 `working` / 运行中，返工显示 `working` / 返工中。明确执行结束或结果返回可用 `done`；尚未验收显示“执行已结束 · 待验收”，部分成果和中断仍保留具体文字。确认执行失败（含结果明确 failed）为 `failed`，失败候选仍保留“执行失败 · 待验收”，确认取消为 `cancelled`。验收、正式交付仍须原事实确证，图标不触发发布、验收或任何业务状态迁移。
- 顶部原“完成”计数保持**确认成功执行**语义：不因扩展 `done` 展示而把部分成果、中断、失败或取消算作成功。工作中、完成按 Worker 含子 Worker 的现有树去重；根事项汇总不额外计数。根汇总可以同时显示运行图标及有效待处理数，不把子 Worker 成功推成根事项正式交付。全部子 Worker 失败/取消/中断时明确说明，不虚构候选验收事实。
- 原待答先重读总览，校验 task/version/run/epoch/thread/turn、interaction ID 和游标，再沿原回调定位原卡并还焦。断连额外中止在途导航，迟到响应不再调用旧入口。原主对话 owner 对 threadId 改变会暂停连接，继续保留该保护；readEpoch 改变则关闭并重置旧浮层。成果仍在原答复及原授权 Canvas 中。
- 初次加载、真正空集合、读取失败分开。刷新失败保留上次事项及计数、标记上次记录，失效导航禁用。公开进展的超时、重试、断线恢复及 scope 校验沿原链路。

原 RunActivity、不可变 Worker 交办/接收结果历史卡、模型默认值、队列、生命周期、CAS、审批权限、正式 publication/Canvas 授权与配置均不在本次增量内。10-22 文档与设计记录保留为历史，`ui/DESIGN.md` 新节明确覆盖旧 Card 分支。

## 官方复用边界与 Demo 对照

固定 assistant-ui 提交 `cebe9ddefa8cccee674bcb40c06f485d5bbfe7b8`，沿用现有 vendor 和 shadcn Popover，不安装或升级依赖。批准 Demo 的 `official/task-card.tsx` 与当前产品仅 `@/lib/utils` → `./utils` 导入不同；源码 hash 测试保留。完整保留官方 DOM、五种状态图标、字号、内部间距、截断、箭头及展开交互。

| 边界 | 实际实现与验证 |
| --- | --- |
| 四种根事项 | 同一个官方 TaskCard，默认只挂载四个根卡；不再有普通 Card / UnknownWorker 分支 |
| 多层展开 | 多 Worker 根、Worker、子 Worker 逐层出现；单 Worker 合并；父收起重开子层收起；刷新保持当前选择 |
| 状态与统计 | 使用真实投影；停止未确认/未知只改变展示，不增加待处理、运行或成功数；子项结束、根验收、正式交付各自核对 |
| 品牌与浮层 | 保留 Homer 当前正式头像/标题/计数/Popover/列表滚动/手机布局；卡片间外部间距沿批准 Demo 的 `gap-4` |
| 点击区与焦点 | 实测官方默认按钮不足 44px；仅宿主 CSS 补 `min-height:44px` 与 `focus-visible` 描边。四宽度按钮均 44px，含原边框的卡片约 46px |
| 主题和动画 | 保留局部官方 Neutral 主题、原主题作用域、reduced-motion；不引入 Tailwind reset、主题系统或 runtime |
| 内容与排序 | 产品显示原 owner 的名称、排序、公开工具类别、待答和成果，故数据顺序及部分文案不与 Demo 的合成数组相同；不复制 Demo 模拟结束、任务或统计 |

本轮通过只针对合成输入的真实产品接线，不以 Demo 的 39 项检查替代产品验收。截图中的底层对话、待答和文件均为隔离合成夹具。

## 验证与复现

维护的检查源：`tests/task-status.test.ts`、`tests/task-status-unified.browser.mjs`、`tests/task-status-unified-runner.mjs`、`tests/task-status-recovery.browser.mjs`，复用既有 `tests/task-status-browser-fixture.mjs`。没有新依赖。

```sh
# 在 maintree 根运行，测试只使用合成临时数据库与隔离 HTTP。
node --import tsx --test tests/task-status.test.ts tests/task-status-progress.test.ts tests/task-status-css.test.mjs tests/task-status-license.test.ts
node_modules/.bin/tsc --noEmit -p ui/tsconfig.json
node_modules/.bin/tsc --noEmit -p tsconfig.json
node scripts/build-task-status-css.mjs

# 从 ui 目录构建；不写生产 dist。
cd ui
../node_modules/.bin/vite build --configLoader runner --outDir ../.codex/scratch/taskcard-unified-product-20261023/web-build
cd ..

# 使用已有 Playwright/Chrome；HOMER_PLAYWRIGHT_MODULE 是本机已存在模块入口。
HOMER_PLAYWRIGHT_MODULE=/Users/wolf3c/.npm/_npx/31e32ef8478fbf80/node_modules/playwright/index.mjs node --import tsx tests/task-status-unified-runner.mjs
```

已观察结果：

- 14 项相关单元/owner/许可/官方源码/作用域 CSS 测试通过；状态映射先红后绿。
- 74 项真实产品卡片检查、9 项迟到响应/身份/读取代际/线程保护检查、2 项已确认进展保留检查、10 项断线与超时恢复检查通过，共 95 项；另有两组大集合场景。
- 320/390/704/1440px、键盘打开、Escape 回焦、长中文、reduced-motion、空/加载/失败均验证；同一身份刷新保留展开，准确重绑定不复用旧计划。有效待答原入口、过期待答提示与授权成果 Canvas 均可达。
- 2000 条合成任务只先挂载 20 个根事项，加载更多到 40 个并保持按钮焦点；8000 条合成任务的大计数在 320px 不溢出。性能数字仅是本机单次合成观察，不是生产承诺。
- UI 和服务源码 `tsc --noEmit` 通过。实际产品 Vite 构建通过，保留现有大 chunk 提示。
- 全仓 `npm run typecheck` 未通过：25 条诊断。使用 TypeScript 内存 host 将本次文件替换为起始前像后，诊断仍为同样 25 条，新增 0 条。涉及旧连接测试、时间/附件测试、旧 JSX/模块声明等文件，本轮未修。
- 浏览器运行器仅允许隔离服务同源读取和已核实只读的历史 POST 查询，外部请求 0，业务写请求 0；无真实模型调用。

候选、日志、截图及详细 JSON 位于 `.codex/scratch/taskcard-unified-product-20261023/`。主要截图为 `mobile-390-collapsed.png`、`mobile-390-nested.png`、`desktop-1440-collapsed.png`、`desktop-1440-nested.png`；另有 320px 和 704px 版本。前像在 `before/`，当前准确增量、源码/构建身份与类型基线证据随交付保存在该目录。

单独打开隔离候选：

```sh
HISTORY_FOLLOWUP_BUILD="$PWD/.codex/scratch/taskcard-unified-product-20261023/web-build" HOMER_SYNTHETIC_ROOT="$PWD/.codex/scratch/taskcard-unified-product-20261023/synthetic-runtime" node --import tsx tests/task-status-browser-fixture.mjs
```

打开命令首行 JSON 中的 `url`，点击顶部“工作状态”。端口为自动分配的本地隔离端口，拒用 4780；关闭该测试进程即可结束。若环境限制 `.codex/scratch` 写入，需要对应临时目录的测试执行权限，不要改用生产目录。

## 提交前代码复审

2026-10-23，用户要求审查本轮代码并 Git commit。审查覆盖状态/统计事实、准确身份、异步失效、组件复用、渲染规模和暂存边界，修正两处问题：

- 展开记录原本只存 task ID，Worker 的 version/Run/epoch/thread/turn 变化后，React 已收起新卡，旧展开标记仍会自动请求其进展。现在记录并比对完整执行身份，不让已收起的新 Run 沿用旧读取标记；手动刷新时对仍展开的旧身份进行一次读取仍合法。回归检查区分这次合法读取与身份切换后的额外第三次读取。
- progressRevision 改变后，旧代码先丢弃全部已确认公开计划/输出；若重读失败便失去已知事实。现在刷新只保留旧 workers 数据，不保留旧 error/loading/unavailable 标记；展示仍逐项经过 `progressMatches` 的完整身份检查。读取成功的新集合可清除缺失项，旧 Run 进展不能进入新卡，失败后仍可收起重开重试。

两处问题均通过修正前的隔离产品构建复现，再在修正后的真实产品构建验证。没有新状态库、轮询、依赖或调度改动。原 20 根事项首批渲染、按根共享公开进展读取和全量去重统计保持；95 项交互检查及两个大集合场景通过。类型和构建证据保留在任务 scratch 的 `review/`，本机合成耗时不作为生产性能保证。

Git 提交只纳入本次 13 个相关文件；`ui/DESIGN.md` 只暂存统一 TaskCard 小节，其他任务的已有及后续章节保留原暂存/未暂存状态。暂存差异和源码 hash 在提交前核对。未发布或采用到线上。

## 增量审查与回退

工作区存在大量其他任务修改。交付补丁以本任务开始时的逐文件前像为基线，不以 Git HEAD 为基线；不要整体回退工作区。`ui/DESIGN.md` 仅新增本次覆盖节，历史事实保持。

产品改动仅 `src/task-status.ts`、`ui/task-status.tsx`、`ui/task-status.css`、`ui/vendor/task-status/{card.tsx,SOURCE-SHA256.json,components.css,README.md}`；另有上述测试、设计节和本文。`task-card.tsx`、AgentPlan、TodoList、Popover、状态数据 hook、业务读取和 `homer-app.tsx` 接线未被改写。

回退前先比对交付后的 hash。若相符，在准确增量补丁上使用 `git apply --reverse --check` 预览后再反向应用；若文件已有其他人后续修改，仅逆转本次必要 hunk。恢复 `card.tsx` 及其 hash 后重编局部 CSS、重跑相关测试。没有持久业务数据或 schema 变化，不需要数据迁移。

本候选由当时 maintree 的完整实际 UI 构建，包含工作区本来已有的并行 UI 增量；本任务不宣称那些增量由本轮完成或获得发布批准。所有验证均为本地证据，线上尚未采用。
