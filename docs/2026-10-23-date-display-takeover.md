# 日期与消息时间接手续查

2026-10-23；维护目录、实际目录与 Git 根均为 `/Users/wolf3c/Project/homer`，分支 main，调查时 HEAD `7597e1bfafa0cf015e1c14d3365e9cde98699183`。本轮补齐当前运行资源和隔离浏览器验收，修正一处过时测试加载器；没有新增日期产品实现、提交、发布或重启。

## 结论与未完成原因

日期功能已经实现、提交并进入当前运行资源。原长截图本身也已出现“今天”和消息时间。当前日期完全不显示的问题未复现；没有证据把它归因于缓存或新的状态接线缺陷。

历史上缺日期的资源确实存在：10-22 13:30 冻结的 `21c787…` 早于日期任务 14:52 开工，20:52 的旧调查仍观测到该资源。日期提交为 `6cd728b5028c3a696129e8627635a8452dfaf527`，后续 22:56 发布资源已包含该功能。本轮再次实际请求 4780，证实现在服务的是后续资源，不能继续以旧观察要求重新发布日期代码。

可核对的停滞点是实际浏览器验收尚未闭合：实现和提交已结束，之后分别做旧资源调查、发布时间调查及当前可见性重新排查。前两份报告各自完成其调查范围，没有补齐实际浏览器交互。旧调查报告明确记录 Chrome 启动 `SIGABRT`，没有进入页面；这是当时的验证障碍，不能当日期渲染缺陷。这些记录证明存在分阶段调查和重复的资源/时序核对，不足以解释全部墙钟耗时或主 Agent 每段等待的主观原因。

准确的最后暂停事项为 `task-23e280e5-afd8-4b3c-b1f1-6a66aecf1683`，Run `run-978bc518-523c-42be-b981-e417b6ea8344`。最小只读查询显示：10-23 11:34:51.262 开始，11:41:04.350 结束，`settled / cancelled / ended`，停止原因为用户暂停；运行记账 activeMs=102409。该 Run 没有 artifact/summary，也没有关联的持久 Worker 待答记录。记录未给出预算耗尽错误，不能推断全部墙钟时间均在执行或等审批；主端是否曾存在另一个原生审批回调仍未证实。本轮没有恢复它、答复审批或创建 Homer 执行者。

## 实际运行身份

2026-10-23 12:04:51（Asia/Shanghai）静态 HTTP 取样及本地密封核对：

| 对象 | 实际值 |
| --- | --- |
| 4780 launcher | PID 50823；命令指向 `release-inputs/95ec060…/scripts/dev.mjs` |
| sourceHash | `95ec060eed2f7f8f60767ee8e42264e1f9bc77d27b36fc3ea9f844f389bec3de` |
| manifest | `1d62b2c9b736cf6cc456198e265f009a7896767059eccb81a4a91cf68da892cd`；268 项文件逐项 SHA 核对无差异 |
| UI | `653a07ef25d3e3db583b3e0c9d219bd1e1f2bd47b3dfc169dd6e25ba37379e4d` |
| JS | `index-CKB7xglF.js`；SHA256 `aab4866b893aa80143ac6d0361a6f5c414a8c7b8dc8abfb31e4a27969d56f0ec` |
| CSS | `index-D7AyI2PW.css`；SHA256 `dcca885160d1daefc378220ebceb17b9139bde1e599151a802f4b11929acfb87` |

根入口、版本化 JS/CSS 均 HTTP 200、`Cache-Control: no-store`；资产字节与实际密封完全一致，JS/CSS 均包含 `message-day-separator` 和 `message-timestamp`。冻结输入内 `chat-date.ts`、`message-timestamps.tsx`、对应 CSS 与维护源逐字节相同；冻结 app 保有 provider、两个消息 wrapper 的日期及时间接线。

现有实现是 Homer 自有 `MessageDaySeparator`/`MessageTimestamp`，组合固定 `@assistant-ui/react@0.15.29`、core `0.3.30` 的消息 runtime/插槽。vendor 没有另一个 DaySeparator 源文件。本轮沿用当前实现和富内容合同，未升级依赖或重新选型。源码、提交、sourceHash 和实际运行资源是不同层次的身份。

## 最小修改

- `tests/chat-timestamps.test.ts`：修复当前消息 wrapper 使用 QuoteBlock 后，旧测试加载器未提供该绑定而产生的 `ReferenceError: QuoteBlock is not defined`。加载真实固定 vendor QuoteBlock，仅略过 CSS；复用同一个已导入的 assistant-ui 模块，避免 ESM/CJS 再加载第二套 core。富内容断言保持。
- `ui/DESIGN.md`：记录已实现且已验证的日期/时间规则，覆盖旧用户气泡段“不新增时间”的历史约束；保留同期其他章节。
- 本维护记录：保存原因、实际身份、验证边界和交付位置。

日期 helper、provider、消息 wrapper、产品样式和服务逻辑均无需本轮修改。日期按投影后的原数组顺序分段；无效时间不编造时间；内部 Worker 过程保持原位置且不独立生成日期/时间；正式交付消息按自身创建时间显示。桌面时间悬停/键盘聚焦可见，触屏常显；单日只在该段首条有效消息前显示日期。每次消息数组/当前日期更新集中计算一次 Map，未新增请求、轮询、业务状态或持久数据。

## 验证

| 检查 | 观察结果与范围 |
| --- | --- |
| 日期回归红绿 | 修改前 7 通过、1 失败，准确失败为漏传 QuoteBlock；修正后 8/8 通过，无 duplicate core 警告。覆盖跨年今天/昨天、完整日期、上海/洛杉矶、DST、缺失时间、历史顺序、投影隐藏、流式 DOM 身份及富内容插槽。 |
| UI 类型 | `node node_modules/typescript/bin/tsc -p ui/tsconfig.json --noEmit`，exit 0。 |
| 服务类型 | 同上 `-p tsconfig.json --noEmit`，exit 0。没有声称全库 test/config 类型检查通过。 |
| 冻结前端构建 | Node 22.22.0、Vite `build --configLoader runner --outDir <scratch>/current-web`，exit 0；仅保留原大 chunk 提示。未运行修改共享 CSS 的生成命令或覆盖日常 dist。 |
| 浏览器 | 新隔离 Chrome profile，实际密封 UI 与本轮冻结候选各跑 320/390/1440，六组均通过，无页面异常、非本地页面请求或业务写入。全部请求为隔离服务 GET；未触真实业务/模型。 |
| 浏览器行为 | 同屏三种日期、00:00 时间、title/语义时间、键盘聚焦、桌面 hover、模拟触屏常显；跨午夜后 focus 更新；390px 上海/洛杉矶切换；SSE 正文增量保持消息/time DOM；追加较早日期不重排；隐藏占位和内部 Worker 不产生日期；Worker 正文/过程行、引用/批注、附件名称、Markdown 表格及代码块保留；三屏文档宽度均等于视口。 |

浏览器使用固定合成时钟和合成数据，读取同一份实际密封资源的副本，不访问用户正在使用的标签页或聊天正文。这证明资源在相应显示条件下可用，无法回溯某次真实标签页的滚动位置、设备时区或旧页面是否重载。页面恢复测试由 focus 触发，没有声称等待真实午夜或完成所有移动设备验收。原 Worker 折叠区内部全功能不属于本次复验，保留其既有独立验收。

合成验证初次因 fixture 未提供 history protocol=3 而未显示主对话；随后修正 CDP 布尔返回、触控参数及测试数据，原失败日志保留。一次额外的旧过程详情展开检查未通过，未将其当日期缺陷修复；最终将检查限定为本项影响的过程行与正文保留。全部最终六组结果在 `browser-results.json`，不能将中间失败称通过。

冻结后发现其他任务移除 MainComposer 用量区及其独占 CSS、更新 vendor/设计说明。逐项 diff 确认三个日期模块、消息 wrapper 与 provider 未变；本轮不覆盖这些修改。浏览器证据绑定本轮冻结快照，不声称验收同期其他更新的最终组合。

## 证据与后续

临时证据仅在 `.codex/scratch/date-display-takeover-20261023/`：`served-evidence.json`、`original-task-state.json`、`source-before.json`、`verify-browser.mjs`、`browser-results.json`、命令日志及 `served-{320,390,1440}.png` / `current-{320,390,1440}.png`。截图全部为明确标识的合成记录。浏览器及合成服务已关闭，正式服务和原暂停任务保持。

本项状态：日期功能已实现/已提交/运行资源已采用；本轮浏览器验证已完成。本文件所在提交仅纳入测试加载器修正、日期设计说明和本维护记录，未发布。无需为本项增加日期产品发布增量；若用户仍指出具体消息缺日期，应在该准确可见范围只读核对，而不能据旧资源结论重复开发或笼统归因缓存。

## 提交前审查

用户随后授权 review 与 Git commit。审查基于 HEAD `0e8f26b689b4d84cd929d27fe3769e12ffa58228`，真实索引起初为空；仅提取本批三个路径的准确 hunk。`ui/DESIGN.md` 中其他任务的 ApprovalCard、Quote 等未提交段落保留在工作目录，不混入本批提交。

加载器按真实模块的导入路径解析 vendor 依赖，仅去除准确的 `./quote.css` 导入。`@assistant-ui/react` 返回测试已导入的同一模块命名空间，其他 require 继续正常解析并抛出错误；没有 catch 吞错、替代 QuoteBlock 或放宽富内容断言。接手阶段修改前失败日志、修正后 8 项通过与无重复 core 警告均保留。审查未改测试代码，日期模块、QuoteBlock、utils、投影模块及两个生产消息 wrapper 与原验收前像一致；复用原通过记录，不重跑无关检查。

以下 SHA256 绑定接手阶段的准确证据；冻结候选是当时维护源的隔离构建，区别于当前在线资源，也不代表本次提交新增产品代码：

| 证据 | SHA256 |
| --- | --- |
| `source-before.json`（187 项输入的逐文件 SHA 清单） | `d3bd07aaf75fb9912bdeb48b5c3df7c40031bb595ce485c4d92b4102d0a3ec06` |
| `current-web/assets/index-k7JSSrYx.js` | `8086a48d150a6e757be492f118493f83d8d96e99df5e9f4f3937458e3943277c` |
| `current-web/assets/index-To0Qrj7E.css` | `d9bf169d253926e05b7e1304bf731d64b227d2b9c9d8bce26d2a0394c07e97b2` |
| `browser-results.json`（Chrome 156.0.8078.48，2026-10-23T04:09:40.342Z） | `ac58d905e3ecf492b52e6d240b1e88d743326c8455c1440a8d08742a07480e1e` |
| `tests/chat-timestamps.test.ts`（修正后源码） | `8f460c7c4e1513a3c2ec43b2dac390f16386c7947864a6639e0e44e2ac212093` |
| `date-tests-final.log`（Node 22.22.0，2026-10-23T04:12:01.972225Z 开始，exit 0） | `19fe1a2c7e388c8dcf26687163f514983865329bf37927733af37412659b888a` |

本批纯测试/文档变更不增加生产请求、依赖、渲染或计时开销，也不证明生产性能提升。没有新增 benchmark、真实模型调用或生产操作。用户原标签页当时的具体显示状态仍未核实。
